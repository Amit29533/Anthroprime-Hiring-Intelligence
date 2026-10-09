#!/usr/bin/env python3
"""Single-profile local experiment. No credential storage, retries or challenge bypass.

Playwright is loaded only for a live run; fixture tests need only Python's stdlib.
This is not a Netlify function or an officially supported LinkedIn integration.
"""

import argparse
import json
import os
import pathlib
import re
import sys
import time
from urllib.parse import urlsplit


class ExtractionError(RuntimeError):
    pass


def profile_url(value):
    if not isinstance(value, str) or len(value) > 500:
        raise ExtractionError("Enter a valid HTTPS LinkedIn member profile URL.")
    if any(ord(c) < 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise ExtractionError("Invalid profile URL.")
    value = value.strip()
    if " " in value:
        raise ExtractionError("Invalid profile URL.")
    try:
        url = urlsplit(value)
        valid = (
            url.scheme == "https"
            and url.hostname in {"linkedin.com", "www.linkedin.com"}
            and not url.username
            and not url.password
            and url.port is None
            and re.fullmatch(r"/in/([A-Za-z0-9][A-Za-z0-9._-]{2,99})/?", url.path)
        )
    except ValueError:
        valid = False
    if not valid:
        raise ExtractionError("Use https://www.linkedin.com/in/<handle>/ with no extra path.")
    handle = re.fullmatch(r"/in/([^/]+)/?", url.path).group(1)
    if handle in {".", ".."}:
        raise ExtractionError("Invalid profile handle.")
    return f"https://www.linkedin.com/in/{handle.lower()}/"


def clean_lines(text):
    """Preserve paragraph boundaries; remove adjacent accessibility duplicates."""
    lines = []
    for raw in (text or "").splitlines():
        line = re.sub(r"[ \t\r\f\v]+", " ", raw).strip()
        if line and (not lines or line != lines[-1]):
            lines.append(line)
    return lines


def check_page(page, expected):
    # URL-based gates plus visible challenge elements. Never log redirect URLs.
    current = page.url
    path = urlsplit(current).path.lower()
    if any(x in path for x in ("authwall", "/login", "/checkpoint", "/uas/", "captcha")):
        raise ExtractionError("LinkedIn requires login or manual verification. Extraction stopped.")
    challenges = page.locator(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], #captcha, '
        'form[action*="checkpoint"], input[name="captchaUserResponse"]'
    )
    for item in challenges.all():
        if item.is_visible():
            raise ExtractionError("A verification challenge is visible. Extraction stopped.")
    try:
        actual = profile_url(current)
    except ExtractionError:
        raise ExtractionError("LinkedIn left the requested profile. Extraction stopped.") from None
    if actual != expected:
        raise ExtractionError("The loaded profile does not match the requested profile.")


def remaining_timeout(deadline, maximum=2000):
    if deadline is None:
        return maximum
    remaining = int((deadline - time.monotonic()) * 1000)
    if remaining <= 0:
        raise ExtractionError("Profile extraction took too long. No result was saved. Retry after the profile finishes loading.")
    return min(maximum, remaining)


def first_visible_text(page, selectors, deadline=None):
    for selector in selectors:
        # Hidden first matches must not suppress later visible matches.
        for loc in page.locator(selector).all()[:20]:
            remaining_timeout(deadline)
            if loc.is_visible():
                lines = clean_lines(loc.inner_text(timeout=remaining_timeout(deadline)))
                if lines:
                    return " ".join(lines)
    return None


def section_items(page, anchor, warnings, max_items=15, deadline=None):
    try:
        remaining_timeout(deadline)
        section = page.locator(f"section:has(div#{anchor})").first
        if not section.count():
            warnings.append(f"{anchor}: section absent or not loaded")
            return []
        section.scroll_into_view_if_needed(timeout=remaining_timeout(deadline, 3000))
        # Only outer list entries; nested entries otherwise duplicate job groups.
        entries = section.locator("li").all()[:100]
        result, seen = [], set()
        for entry in entries:
            remaining_timeout(deadline)
            nested = entry.evaluate("el => Boolean(el.parentElement.closest('li'))")
            if nested or not entry.is_visible():
                continue
            lines = clean_lines(entry.inner_text(timeout=remaining_timeout(deadline)))
            if not lines or re.fullmatch(r"Show all.*|Show more|Show less", " ".join(lines), re.I):
                continue
            key = tuple(lines)
            if key not in seen:
                seen.add(key)
                result.append(lines)
            if len(result) >= max_items:
                warnings.append(f"{anchor}: output capped at {max_items} entries")
                break
        if not result:
            warnings.append(f"{anchor}: no visible list entries; markup may have changed")
        return result
    except ExtractionError:
        raise
    except Exception:
        warnings.append(f"{anchor}: extraction failed; review this section manually")
        return []


def extract_about(page, warnings, deadline=None):
    try:
        remaining_timeout(deadline)
        section = page.locator("section:has(div#about)").first
        if not section.count():
            warnings.append("about: section absent or not loaded")
            return None
        section.scroll_into_view_if_needed(timeout=remaining_timeout(deadline, 3000))
        texts = []
        for item in section.locator("span[aria-hidden='true']").all()[:50]:
            remaining_timeout(deadline)
            if item.is_visible():
                lines = clean_lines(item.inner_text(timeout=remaining_timeout(deadline)))
                lines = [x for x in lines if x.lower() not in {"about", "see more", "show more", "show less"}]
                if lines:
                    texts.append("\n".join(lines))
        if not texts:
            warnings.append("about: no visible content; markup may have changed")
            return None
        return max(texts, key=len)[:10000]
    except ExtractionError:
        raise
    except Exception:
        warnings.append("about: extraction failed; review manually")
        return None


def visible_snapshot(page):
    dom_script = pathlib.Path(__file__).with_name("linkedin_visible_profile.js").read_text(encoding="utf-8").rstrip()
    if dom_script.endswith(";"):
        dom_script = dom_script[:-1]
    return page.evaluate("(" + dom_script + "\n)()")


def merge_snapshots(previous, current):
    """Retain visible rows across lazy/virtual rendering; never infer absent facts."""
    if not current:
        return previous
    if not previous:
        previous = {"sections": {}, "warnings": []}
    for field in ("name", "headline", "company", "location", "about"):
        if current.get(field) and not previous.get(field):
            previous[field] = current[field]
    for key, rows in current.get("sections", {}).items():
        combined = previous["sections"].setdefault(key, [])
        for row in rows:
            if row not in combined:
                if len(combined) < 15:
                    combined.append(row)
                else:
                    previous["warnings"].append(f"{key}: output capped at 15 entries")
    previous["warnings"] = list(dict.fromkeys(previous["warnings"] + current.get("warnings", [])))
    if all(previous.get(field) for field in ("headline", "company", "location")):
        previous["warnings"] = [warning for warning in previous["warnings"] if not warning.startswith("intro:")]
    return previous


def extract_profile(page, expected, captured=None, *, deadline=None, progress=None):
    report = progress or (lambda message: None)
    remaining_timeout(deadline)
    check_page(page, expected)
    modern = merge_snapshots(captured, visible_snapshot(page))
    name = (modern or {}).get("name") or first_visible_text(page, ["main h1"], deadline)
    if not name or len(name) > 200:
        raise ExtractionError("No valid profile name found. The page may be blocked or changed.")
    warnings = list(modern.get("warnings", [])) if modern else []
    data = {
        "format": "anthro-linkedin-profile",
        "version": 1,
        "url": expected,
        "name": name,
        "headline": (modern or {}).get("headline") or first_visible_text(page, ["main section div.text-body-medium.break-words"], deadline),
        "company": modern.get("company") if modern else None,
        "location": (modern or {}).get("location") or first_visible_text(page, ["main section span.text-body-small.inline.t-black--light.break-words"], deadline),
        "about": (modern or {}).get("about") or extract_about(page, warnings, deadline),
    }
    for key, anchor in (
        ("experience", "experience"), ("education", "education"),
        ("skills", "skills"), ("certifications", "licenses_and_certifications"),
    ):
        remaining_timeout(deadline)
        report(f"Reading {key}...")
        check_page(page, expected)
        if modern and anchor in modern.get("sections", {}):
            data[key] = modern["sections"][anchor]
            if not data[key]:
                warnings.append(f"{anchor}: no visible entries; review manually")
        else:
            data[key] = section_items(page, anchor, warnings, deadline=deadline)
    check_page(page, expected)
    # Only extracted profile fields, not the full main region (recommendations,
    # notifications and unrelated people can appear there). Keep line breaks.
    blocks = [data[k] for k in ("name", "headline", "company", "location", "about") if data[k]]
    for key in ("experience", "education", "skills", "certifications"):
        if data[key]:
            blocks.append(key.title())
            blocks.extend("\n".join(item) for item in data[key])
    text = "\n\n".join(blocks)
    data["raw_text"] = text[:50000]
    if len(text) > 50000:
        warnings.append("raw_text: truncated at 50,000 characters")
    data["warnings"] = warnings
    data["requires_review"] = True
    data["completeness"] = "visible sections only; not a complete-profile guarantee"
    return data


def scrape(url, li_at=None, jsessionid=None, headful=False, timeout_ms=30000, *, playwright_factory=None, login=False, login_prompt=None, browser_channel="chromium", progress=None):
    report = progress or (lambda message: None)
    stage = "starting the browser"
    expected = profile_url(url)
    if not login and (not isinstance(li_at, str) or not li_at.strip() or any(c.isspace() for c in li_at)):
        raise ExtractionError("Set LI_AT locally to a valid session cookie; never paste it into chat.")
    if not login and jsessionid and any(c in jsessionid for c in "\r\n"):
        raise ExtractionError("Invalid JSESSIONID cookie.")
    if not 5000 <= timeout_ms <= 120000:
        raise ExtractionError("Timeout must be between 5,000 and 120,000 milliseconds.")
    if browser_channel not in {"chromium", "chrome", "msedge"}:
        raise ExtractionError("Choose chromium, chrome or msedge for the local browser.")
    if playwright_factory is None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise ExtractionError("Install Playwright and its Chromium browser in a local virtual environment.") from None
        playwright_factory = sync_playwright
    browser = context = None
    try:
        with playwright_factory() as runtime:
            try:
                launch_options = {"headless": not (headful or login)}
                if browser_channel != "chromium":
                    launch_options["channel"] = browser_channel
                browser = runtime.chromium.launch(**launch_options)
                context = browser.new_context(locale="en-US")
                if not login:
                    cookies = [{"name": "li_at", "value": li_at, "url": "https://www.linkedin.com/", "httpOnly": True, "secure": True}]
                    if jsessionid:
                        cookies.append({"name": "JSESSIONID", "value": jsessionid, "url": "https://www.linkedin.com/", "secure": True})
                    context.add_cookies(cookies)
                page = context.new_page()
                page.set_default_timeout(timeout_ms)
                if login:
                    # The user signs in directly to LinkedIn. The ephemeral browser
                    # manages its own cookies; never inspect or export its session.
                    stage = "opening LinkedIn sign-in"
                    report("Opening LinkedIn sign-in...")
                    page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded", timeout=timeout_ms)
                    answer = (login_prompt or input)(
                        "Sign in to LinkedIn in the opened browser. When finished, press Enter here (or type cancel): "
                    )
                    if answer.strip():
                        raise ExtractionError("Sign-in cancelled. No profile was extracted.")
                    report("Sign-in confirmed; loading the requested profile (up to 30 seconds)...")
                stage = "loading the requested profile"
                page.goto(expected, wait_until="domcontentloaded", timeout=timeout_ms)
                check_page(page, expected)
                stage = "waiting for the profile header"
                report("Profile opened; waiting for the profile header (up to 15 seconds)...")
                page.locator('main h1:visible, main a[componentkey^="ProfileVerificationTriggerRef-"] h2:visible').first.wait_for(state="visible", timeout=15000)
                stage = "reading visible profile sections"
                deadline = time.monotonic() + 25
                # Capture before every scroll so virtualized sections are retained.
                captured = visible_snapshot(page)
                for step in range(12):
                    remaining_timeout(deadline)
                    report(f"Loading visible sections {step + 1}/12...")
                    page.mouse.wheel(0, 800)
                    page.wait_for_timeout(500)
                    check_page(page, expected)
                    captured = merge_snapshots(captured, visible_snapshot(page))
                result = extract_profile(page, expected, captured, deadline=deadline, progress=report)
                report("Extraction finished; closing the temporary browser...")
                return result
            finally:
                # A context close failure must not prevent browser cleanup.
                try:
                    if context is not None:
                        context.close()
                finally:
                    if browser is not None:
                        browser.close()
    except (EOFError, KeyboardInterrupt):
        raise ExtractionError("Sign-in cancelled. No profile was extracted.") from None
    except ExtractionError:
        raise
    except Exception:
        # Browser exceptions may contain URLs or other session-derived details.
        raise ExtractionError(f"Failed while {stage}. Check connectivity and finish sign-in in the opened browser before pressing Enter. No result was saved.") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--out", help="New JSON output file (existing files are never overwritten)")
    parser.add_argument("--headful", action="store_true")
    parser.add_argument("--login", action="store_true", help="Open a temporary browser for normal LinkedIn sign-in; no cookie copying")
    parser.add_argument("--browser", choices=["chromium", "chrome", "msedge"], default="chromium", help="Use installed Chrome/Edge, or the Playwright Chromium download")
    parser.add_argument("--no-raw", action="store_true")
    parser.add_argument("--timeout-ms", type=int, default=30000)
    args = parser.parse_args()
    try:
        progress = (lambda message: print(message, flush=True)) if args.out else None
        result = scrape(args.url, None if args.login else os.environ.get("LI_AT"), None if args.login else os.environ.get("JSESSIONID"), args.headful, args.timeout_ms, login=args.login, browser_channel=args.browser, progress=progress)
        if args.no_raw:
            result.pop("raw_text", None)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        if args.out:
            fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                file.write(output + "\n")
            print("Saved reviewed-draft output. Inspect warnings before importing.")
            if not any(result.get(key) for key in ("experience", "education", "skills", "certifications")):
                print("WARNING: No professional sections captured. Do not treat this as a complete profile; review it manually.")
        else:
            print(output)
        return 0
    except ExtractionError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except OSError:
        print("Error: Could not write output. Choose a writable, new file path.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
