import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("extractor", pathlib.Path(__file__).with_name("linkedin_profile_extractor.py"))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)
URL = "https://www.linkedin.com/in/test-candidate/"


class Locator:
    def __init__(self, text="", visible=True, nested=False, children=None, fail=False):
        self.text, self.visible, self.nested = text, visible, nested
        self.children, self.fail = children or {}, fail

    @property
    def first(self):
        return self

    def all(self):
        return self.children.get("all", [self])

    def count(self):
        return len(self.all())

    def is_visible(self):
        return self.visible

    def inner_text(self, **kwargs):
        if self.fail:
            raise RuntimeError("private browser diagnostics")
        return self.text

    def locator(self, selector):
        return Locator(children={"all": self.children.get(selector, [])})

    def evaluate(self, expression):
        return self.nested

    def scroll_into_view_if_needed(self, **kwargs):
        if self.fail:
            raise RuntimeError("timeout")

    def wait_for(self, **kwargs):
        if self.fail:
            raise RuntimeError("timeout")


class Page:
    def __init__(self, url=URL, name="Mira Testcandidate"):
        self.url, self.name = url, name
        self.sections = {}
        self.challenge = False
        self.goto_error = False
        self.modern = None
        self.mouse = self

    def evaluate(self, script):
        return self.modern

    def wheel(self, x, y):
        pass

    def wait_for_timeout(self, timeout):
        pass

    def locator(self, selector):
        if selector == "main h1":
            return Locator(self.name)
        if selector.startswith("iframe"):
            return Locator(children={"all": [Locator()] if self.challenge else []})
        return self.sections.get(selector, Locator(children={"all": []}))

    def set_default_timeout(self, value):
        self.timeout = value

    def goto(self, url, **kwargs):
        if self.goto_error:
            raise RuntimeError("Cookie SECRET_COOKIE must not be printed")


class Browser:
    def __init__(self, page):
        self.page = page
        self.context_closed = self.browser_closed = False
        self.close_error = False

    def new_context(self, **kwargs):
        return self

    def add_cookies(self, cookies):
        self.cookies = cookies

    def new_page(self):
        return self.page

    def close(self):
        if not self.context_closed:
            self.context_closed = True
            if self.close_error:
                raise RuntimeError("context close failed")
        else:
            self.browser_closed = True


def factory_for(browser):
    class Runtime:
        chromium = None

        def launch(self, **kwargs):
            browser.launch_options = kwargs
            return browser

    runtime = Runtime()
    runtime.chromium = runtime
    return lambda: contextlib.nullcontext(runtime)


class ExtractorTests(unittest.TestCase):
    def test_normalizes_handle_and_tracking_query(self):
        self.assertEqual(extractor.profile_url("https://linkedin.com/in/Test-Candidate?trk=example#about"), URL)

    def test_normal_login_uses_ephemeral_browser_without_injecting_cookies(self):
        page = Page()
        browser = Browser(page)
        navigations = []
        page.goto = lambda url, **kwargs: navigations.append(url)
        prompts = []
        result = extractor.scrape(URL, "IGNORED_COOKIE", login=True,
            playwright_factory=factory_for(browser),
            login_prompt=lambda prompt: prompts.append(prompt) or "")
        self.assertEqual(navigations, ["https://www.linkedin.com/login", URL])
        self.assertEqual(len(prompts), 1)
        self.assertFalse(browser.launch_options["headless"])
        self.assertFalse(hasattr(browser, "cookies"))
        self.assertNotIn("IGNORED_COOKIE", json.dumps(result))
        self.assertTrue(browser.context_closed and browser.browser_closed)

    def test_login_cancel_and_closed_terminal_clean_up_before_profile_navigation(self):
        for answer in ("cancel", EOFError(), KeyboardInterrupt()):
            with self.subTest(answer=type(answer).__name__):
                page = Page()
                browser = Browser(page)
                navigations = []
                page.goto = lambda url, **kwargs: navigations.append(url)
                def prompt(_):
                    if isinstance(answer, BaseException):
                        raise answer
                    return answer
                with self.assertRaisesRegex(extractor.ExtractionError, "cancelled"):
                    extractor.scrape(URL, login=True, playwright_factory=factory_for(browser), login_prompt=prompt)
                self.assertEqual(navigations, ["https://www.linkedin.com/login"])
                self.assertTrue(browser.context_closed and browser.browser_closed)

    def test_progress_acknowledges_enter_before_navigation_and_has_no_session_data(self):
        page = Page()
        events = []
        page.goto = lambda url, **kwargs: events.append("navigate-login" if url.endswith("login") else "navigate-profile")
        extractor.scrape(URL, "SECRET_COOKIE", login=True,
            playwright_factory=factory_for(Browser(page)), login_prompt=lambda _: "",
            progress=events.append)
        confirmation = next(i for i, event in enumerate(events) if event.startswith("Sign-in confirmed"))
        self.assertLess(confirmation, events.index("navigate-profile"))
        self.assertIn("Loading visible sections 12/12...", events)
        self.assertIn("Reading skills...", events)
        self.assertNotIn("SECRET_COOKIE", " ".join(events))

    def test_navigation_failure_names_the_stage_without_private_diagnostics(self):
        page = Page()
        page.goto_error = True
        with self.assertRaisesRegex(extractor.ExtractionError, "loading the requested profile") as error:
            extractor.scrape(URL, "SECRET_COOKIE", playwright_factory=factory_for(Browser(page)))
        self.assertNotIn("SECRET_COOKIE", str(error.exception))

    def test_expired_read_budget_fails_without_saving_partial_success(self):
        for read in (
            lambda: extractor.section_items(Page(), "experience", [], deadline=5),
            lambda: extractor.extract_about(Page(), [], deadline=5),
            lambda: extractor.extract_profile(Page(), URL, deadline=5),
        ):
            with patch.object(extractor.time, "monotonic", return_value=6), self.assertRaisesRegex(extractor.ExtractionError, "took too long"):
                read()

    def test_render_budget_expiry_closes_browser(self):
        browser = Browser(Page())
        with patch.object(extractor.time, "monotonic", side_effect=[0, 26]), self.assertRaisesRegex(extractor.ExtractionError, "took too long"):
            extractor.scrape(URL, "SECRET_COOKIE", playwright_factory=factory_for(browser))
        self.assertTrue(browser.context_closed and browser.browser_closed)

    def test_header_wait_uses_semantic_snapshot_without_old_css_gate(self):
        page = Page(name="")
        snapshots = [None, {"name": "Mira", "sections": {}, "warnings": []}]
        with patch.object(extractor, "visible_snapshot", side_effect=snapshots):
            self.assertEqual(extractor.wait_for_profile_intro(page, URL)["name"], "Mira")

    def test_unrecognized_header_fails_with_specific_fallback_and_no_guess(self):
        with self.assertRaisesRegex(extractor.ExtractionError, "pasted profile text"):
            extractor.wait_for_profile_intro(Page(name=""), URL)

    def test_login_still_refuses_unauthenticated_profile(self):
        page = Page("https://www.linkedin.com/login")
        browser = Browser(page)
        with self.assertRaisesRegex(extractor.ExtractionError, "manual verification"):
            extractor.scrape(URL, login=True, playwright_factory=factory_for(browser), login_prompt=lambda _: "")
        self.assertTrue(browser.context_closed and browser.browser_closed)

    def test_installed_browser_channel_is_explicit_and_keeps_a_temporary_context(self):
        for channel in ("chrome", "msedge"):
            browser = Browser(Page())
            extractor.scrape(URL, login=True, browser_channel=channel,
                playwright_factory=factory_for(browser), login_prompt=lambda _: "")
            self.assertEqual(browser.launch_options, {"headless": False, "channel": channel})
            self.assertFalse(hasattr(browser, "cookies"))
            self.assertTrue(browser.context_closed and browser.browser_closed)
        with self.assertRaises(extractor.ExtractionError):
            extractor.scrape(URL, login=True, browser_channel="unexpected")

    def test_rejects_unsafe_or_wrong_urls(self):
        for url in (
            "http://www.linkedin.com/in/test-candidate/",
            URL + "../../feed/", URL + "details/experience/",
            "https://www.linkedin.com.evil.example/in/test-candidate/",
            "https://user:password@www.linkedin.com/in/test-candidate/",
            "https://www.linkedin.com:443/in/test-candidate/",
            "https://www.linkedin.com/in/%2e%2e/",
            "https://www.linkedin.com/company/example/",
            "https://www.linkedin.com/in/test-candidate\\x",
            URL + "\n", "https://www.linkedin.com/in/ab/",
        ):
            with self.subTest(url=url), self.assertRaises(extractor.ExtractionError):
                extractor.profile_url(url)

    def test_preserves_newlines_and_deduplicates_adjacent_lines(self):
        self.assertEqual(extractor.clean_lines("React\nReact\nNode.js\n  Four years  "), ["React", "Node.js", "Four years"])

    def test_auth_redirect_stops_without_echoing_query(self):
        with self.assertRaises(extractor.ExtractionError) as error:
            extractor.check_page(Page("https://www.linkedin.com/checkpoint/?secret=value"), URL)
        self.assertNotIn("secret", str(error.exception))

    def test_wrong_profile_or_offsite_redirect_stops(self):
        for url in ("https://www.linkedin.com/in/another-person/", "https://example.invalid/"):
            with self.subTest(url=url), self.assertRaises(extractor.ExtractionError):
                extractor.check_page(Page(url), URL)

    def test_visible_challenge_stops_on_profile_url(self):
        page = Page()
        page.challenge = True
        with self.assertRaises(extractor.ExtractionError):
            extractor.check_page(page, URL)

    def test_finds_later_visible_name(self):
        page = Page()
        page.sections["name"] = Locator()
        with patch.object(page, "locator", return_value=Locator(children={"all": [Locator("Hidden", False), Locator("Mira Testcandidate")]})):
            self.assertEqual(extractor.first_visible_text(page, ["main h1"]), "Mira Testcandidate")

    def test_nested_and_hidden_entries_excluded(self):
        page = Page()
        page.sections["section:has(div#experience)"] = Locator(children={"li": [
            Locator("Developer\nDeveloper\nExample Labs\n2022–2026"),
            Locator("Developer\nExample Labs\n2022–2026", nested=True),
            Locator("Hidden company", visible=False), Locator("Show all 5 experiences"),
        ]})
        warnings = []
        self.assertEqual(extractor.section_items(page, "experience", warnings), [["Developer", "Example Labs", "2022–2026"]])
        self.assertEqual(warnings, [])

    def test_section_limit_is_disclosed(self):
        page = Page()
        page.sections["section:has(div#skills)"] = Locator(children={"li": [Locator(str(i)) for i in range(20)]})
        warnings = []
        self.assertEqual(len(extractor.section_items(page, "skills", warnings)), 15)
        self.assertIn("capped", warnings[0])

    def test_section_failure_is_disclosed(self):
        page = Page()
        page.sections["section:has(div#education)"] = Locator(fail=True)
        warnings = []
        self.assertEqual(extractor.section_items(page, "education", warnings), [])
        self.assertIn("extraction failed", warnings[0])

    def test_missing_name_fails_instead_of_false_success(self):
        with self.assertRaises(extractor.ExtractionError):
            extractor.extract_profile(Page(name=""), URL)

    def test_modern_layout_uses_profile_fields_and_warns_about_collapsed_entries(self):
        page = Page(name="")
        page.modern = {"name": "Mira Testcandidate", "headline": "Developer", "company": "Example Labs", "location": "Example City", "about": None, "sections": {"experience": [["Developer", "Example Labs", "2022–2026"]]}, "warnings": ["experience: additional entries are collapsed; visible entries only"]}
        result = extractor.extract_profile(page, URL)
        self.assertEqual(result["company"], "Example Labs")
        self.assertEqual(result["experience"], [["Developer", "Example Labs", "2022–2026"]])
        self.assertIn("collapsed", result["warnings"][0])
        self.assertIn("Example Labs\n\nExample City", result["raw_text"])

    def test_about_preserves_paragraphs(self):
        page = Page()
        page.sections["section:has(div#about)"] = Locator(children={"span[aria-hidden='true']": [Locator("About"), Locator("React developer\nFour years\nsee more")]})
        self.assertEqual(extractor.extract_about(page, []), "React developer\nFour years")

    def test_scroll_snapshots_retain_sections_removed_by_virtual_rendering(self):
        page = Page(name="")
        page.modern = {"name": "Mira", "headline": "Engineer", "sections": {}, "warnings": []}
        def wheel(x, y):
            page.modern = {"name": None, "sections": {"skills": [["React"]]}, "warnings": []}
        page.wheel = wheel
        result = extractor.scrape(URL, "SECRET", playwright_factory=factory_for(Browser(page)))
        self.assertEqual(result["name"], "Mira")
        self.assertEqual(result["headline"], "Engineer")
        self.assertEqual(result["skills"], [["React"]])

    def test_merged_rows_are_unique_bounded_and_preserve_warning(self):
        first = {"name": "Mira", "sections": {"skills": [[str(i)] for i in range(15)]}, "warnings": []}
        result = extractor.merge_snapshots(first, {"sections": {"skills": [["0"], ["16"]]}, "warnings": []})
        self.assertEqual(len(result["sections"]["skills"]), 15)
        self.assertEqual(result["warnings"], ["skills: output capped at 15 entries"])

    def test_fixture_end_to_end_cleans_up_and_omits_secret(self):
        browser = Browser(Page())
        result = extractor.scrape(URL, "SECRET_COOKIE", playwright_factory=factory_for(browser))
        self.assertTrue(browser.context_closed and browser.browser_closed)
        self.assertEqual(result["name"], "Mira Testcandidate")
        self.assertTrue(result["requires_review"])
        self.assertEqual(len(result["warnings"]), 5)
        self.assertNotIn("SECRET_COOKIE", json.dumps(result))
        self.assertEqual(browser.cookies[0]["url"], "https://www.linkedin.com/")

    def test_navigation_error_redacted_and_cleanup_runs(self):
        page = Page()
        page.goto_error = True
        browser = Browser(page)
        with self.assertRaises(extractor.ExtractionError) as error:
            extractor.scrape(URL, "SECRET_COOKIE", playwright_factory=factory_for(browser))
        self.assertNotIn("SECRET_COOKIE", str(error.exception))
        self.assertTrue(browser.context_closed and browser.browser_closed)

    def test_browser_closes_when_context_close_fails(self):
        browser = Browser(Page())
        browser.close_error = True
        with self.assertRaises(extractor.ExtractionError):
            extractor.scrape(URL, "SECRET_COOKIE", playwright_factory=factory_for(browser))
        self.assertTrue(browser.browser_closed)

    def test_invalid_inputs_never_start_browser(self):
        def never():
            self.fail("Browser started for invalid input")
        for cookie in (None, "", "bad\ncookie"):
            with self.subTest(cookie=cookie), self.assertRaises(extractor.ExtractionError):
                extractor.scrape(URL, cookie, playwright_factory=never)
        with self.assertRaises(extractor.ExtractionError):
            extractor.scrape(URL, "cookie", timeout_ms=1, playwright_factory=never)

    def test_cli_output_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(pathlib.Path(directory) / "draft.json")
            args = ["extractor", URL, "--out", path, "--no-raw"]
            with patch.object(extractor.sys, "argv", args), patch.object(extractor, "scrape", return_value={"name": "Mira", "raw_text": "Mira"}), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(extractor.main(), 0)
                self.assertEqual(json.loads(pathlib.Path(path).read_text()), {"name": "Mira"})
                self.assertEqual(extractor.main(), 1)
                self.assertEqual(json.loads(pathlib.Path(path).read_text()), {"name": "Mira"})


    def test_download_contains_only_reviewed_sources_and_matches_manifest(self):
        import hashlib
        import zipfile
        root = pathlib.Path(__file__).resolve().parent.parent
        manifest = json.loads((root / "public/linkedin-local-extractor-manifest.json").read_text())
        archive_path = root / "public/linkedin-local-extractor.zip"
        self.assertEqual(hashlib.sha256(archive_path.read_bytes()).hexdigest(), manifest["archiveSha256"])
        with zipfile.ZipFile(archive_path) as archive:
            self.assertEqual(set(archive.namelist()), {"tools/linkedin_profile_extractor.py", "tools/linkedin_visible_profile.js", "README.md"})
            self.assertIsNone(archive.testzip())
            for source, expected in manifest["files"].items():
                content = (root / source).read_bytes().replace(b"\r\n", b"\n")
                self.assertEqual(hashlib.sha256(content).hexdigest(), expected)
                destination = "README.md" if source.startswith("docs/") else source
                self.assertEqual(archive.read(destination), content)


if __name__ == "__main__":
    unittest.main()
