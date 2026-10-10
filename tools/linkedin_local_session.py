"""Dedicated local browser profile, fixed 24-hour reuse limit and interactive imports.

Never reads/exports cookies, never exposes a local HTTP endpoint. The website
receives only the explicitly pasted professional profile JSON.
"""
import contextlib
import csv
import json
import os
import pathlib
import shutil
import stat
import subprocess
import time
import uuid

from linkedin_profile_extractor import (
    ExtractionError, check_page, extract_profile, merge_snapshots, profile_url,
    remaining_timeout, scroll_profile, visible_snapshot, wait_for_profile_intro,
)

SESSION_TTL = 24 * 60 * 60
MARKER = "anthroprime-linkedin-session-v1"


def linked(path):
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


class SessionStore:
    def __init__(self, base, now=time.time):
        self.root = pathlib.Path(base).resolve() / "remembered-session"
        self.now = now
        if linked(self.root):
            raise ExtractionError("The local session folder is linked elsewhere; refusing to use it.")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.anchor = self.root.resolve()
        marker = self.root / "owner.json"
        if linked(marker):
            raise ExtractionError("Invalid session ownership marker.")
        if not marker.exists():
            if list(self.root.iterdir()):
                raise ExtractionError("Session folder contains unrecognized files; choose another helper folder.")
            marker.write_text(json.dumps({"owner": MARKER}), encoding="utf8")
        if json.loads(marker.read_text(encoding="utf8")) != {"owner": MARKER}:
            raise ExtractionError("Unrecognized session folder; refusing cleanup.")
        if os.name == "nt":
            identity = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, check=True)
            sid = next(csv.reader(identity.stdout.strip().splitlines()))[-1]
            result = subprocess.run(["icacls", str(self.root), "/inheritance:r", "/grant:r", f"*{sid}:(OI)(CI)F"], capture_output=True)
            if result.returncode:
                raise ExtractionError("Could not make the remembered session folder private.")
        self.profile = self.root / "browser-profile"
        self.meta = self.root / "expires.json"
        for path in (self.profile, self.meta, self.root / "helper.lock"):
            if linked(path):
                raise ExtractionError("A session path is linked elsewhere; refusing to use it.")

    @contextlib.contextmanager
    def lease(self):
        # OS releases the lock if the helper crashes; a second helper cannot
        # open/delete the browser profile while the first is using it.
        with (self.root / "helper.lock").open("a+b") as lock:
            if os.fstat(lock.fileno()).st_size == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise ExtractionError("The LinkedIn helper is already open. Use that window or close it first.") from None
            try:
                yield
            finally:
                lock.seek(0)
                if os.name == "nt":
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def valid(self):
        try:
            meta = json.loads(self.meta.read_text(encoding="utf8"))
            now = self.now()
            return (meta.get("owner") == MARKER and
                    isinstance(meta.get("created"), (int, float)) and
                    isinstance(meta.get("expires"), (int, float)) and
                    meta["expires"] == meta["created"] + SESSION_TTL and
                    meta["created"] <= now < meta["expires"])
        except (OSError, ValueError, TypeError):
            return False

    def remember(self):
        created = self.now()
        fd = os.open(self.meta, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf8") as stream:
            json.dump({"owner": MARKER, "created": created, "expires": created + SESSION_TTL}, stream)

    def forget(self):
        # Delete only this helper's fixed profile, after resolving the target.
        if linked(self.root) or self.root.resolve() != self.anchor or linked(self.profile) or self.profile.resolve().parent != self.anchor:
            raise ExtractionError("Unsafe session cleanup target; refusing deletion.")
        if self.profile.exists():
            def writable(function, path, _):
                candidate = pathlib.Path(path).resolve()
                if not candidate.is_relative_to(self.profile.resolve()):
                    raise ExtractionError("Unsafe cleanup path.")
                os.chmod(candidate, stat.S_IWRITE | stat.S_IREAD)
                function(path)
            shutil.rmtree(self.profile, onerror=writable)
        if linked(self.meta):
            raise ExtractionError("Unsafe session metadata path.")
        self.meta.unlink(missing_ok=True)


def copy_profile(text):
    """Use the existing Windows Set-Clipboard path; JSON goes through stdin.

    The PowerShell code is constant: profile text is never interpreted as code
    or placed in process arguments. UTF-8 is explicit in Windows PowerShell 5.1.
    """
    if os.name != "nt":
        return False
    if len(text.encode("utf8")) > 200 * 1024:
        return False
    try:
        powershell = pathlib.Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
        script = "$ErrorActionPreference='Stop'; [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())"
        result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", script],
            input=text, encoding="utf8", capture_output=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired, KeyError):
        return False


def read_profile(page, url, report):
    expected = profile_url(url)
    report("Loading the requested profile...")
    page.goto(expected, wait_until="domcontentloaded", timeout=30000)
    check_page(page, expected)
    report("Recognizing the profile intro...")
    captured = wait_for_profile_intro(page, expected)
    deadline = time.monotonic() + 25
    for step in range(12):
        remaining_timeout(deadline)
        report(f"Loading visible sections {step + 1}/12...")
        scroll_profile(page, deadline)
        page.wait_for_timeout(500)
        check_page(page, expected)
        captured = merge_snapshots(captured, visible_snapshot(page))
    return extract_profile(page, expected, captured, deadline=deadline, progress=report)


def run_helper(url, base, *, browser_channel="msedge", forget=False, prompt=input,
               report=print, clipboard=copy_profile, factory=None, store_factory=SessionStore):
    store = store_factory(base)
    with store.lease():
        if forget:
            store.forget()
            report("Remembered LinkedIn login removed from this helper. Other browser logins are unchanged.")
            return
        if factory is None:
            from playwright.sync_api import sync_playwright
            factory = sync_playwright
        if browser_channel not in {"chromium", "chrome", "msedge"}:
            raise ExtractionError("Unsupported browser.")
        requested = profile_url(url)
        report("AnthroPrime LinkedIn helper v2026.10.10.1 — local session, 24-hour reuse limit")
        report("Paste a profile URL for another import; commands: refresh, revoke, quit. No passwords here.")
        with factory() as runtime:
            context = None
            try:
                while True:
                    if not store.valid() and context is not None:
                        context.close()
                        context = None
                    if context is None:
                        reused = store.valid()
                        if not reused:
                            store.forget()
                        options = {"headless": False, "locale": "en-US"}
                        if browser_channel != "chromium":
                            options["channel"] = browser_channel
                        context = runtime.chromium.launch_persistent_context(str(store.profile), **options)
                        page = context.new_page()
                        page.set_default_timeout(5000)
                        if not reused:
                            page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded", timeout=30000)
                            if prompt("Sign in in this browser, then press Enter here (or type cancel): ").strip():
                                raise ExtractionError("Sign-in cancelled.")
                            # Remember only after navigating to the requested profile
                            # without login/challenge redirects, not on mere Enter.
                            page.goto(requested, wait_until="domcontentloaded", timeout=30000)
                            check_page(page, requested)
                            store.remember()
                        report("Reusing the remembered login." if reused else "Login remembered for up to 24 hours.")
                    try:
                        clipboard("")  # A failed attempt cannot leave the helper's last result ready to paste.
                        result = read_profile(page, requested, report)
                        result.pop("raw_text", None)
                        payload = json.dumps(result, ensure_ascii=False, indent=2)
                        if len(payload.encode("utf8")) > 200 * 1024:
                            raise ExtractionError("Captured profile exceeds the website's file limit; use pasted text.")
                        output = pathlib.Path(base) / ("profile-" + uuid.uuid4().hex + ".json")
                        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                        with os.fdopen(fd, "w", encoding="utf8") as stream:
                            stream.write(payload)
                        report("Ready: click Paste extracted profile in AnthroPrime." if clipboard(payload) else "Clipboard unavailable; import the saved JSON file.")
                        report(f"Saved locally: {output}")
                        if not any(result.get(key) for key in ("experience", "education", "skills", "certifications")):
                            report("WARNING: No professional sections captured; this is not a complete profile.")
                    except ExtractionError as error:
                        report(f"Extraction stopped: {error}")
                    except Exception as error:
                        report(f"Browser read failed ({type(error).__name__}); no result copied. Check the open page. Type refresh to sign in again.")
                    while True:
                        value = prompt("Next profile URL, retry, refresh, revoke or quit: ").strip()
                        if value.lower() in {"quit", "cancel"}:
                            return
                        if value.lower() in {"refresh", "revoke"}:
                            context.close()
                            context = None
                            store.forget()
                            report("Local remembered login removed.")
                            if value.lower() == "revoke":
                                return
                            break
                        try:
                            requested = requested if value.lower() == "retry" else profile_url(value)
                            break
                        except ExtractionError as error:
                            report(str(error))
            finally:
                if context is not None:
                    context.close()
                if not store.valid():
                    store.forget()
