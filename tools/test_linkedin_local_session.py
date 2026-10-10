import contextlib
import importlib.util
import json
import pathlib
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import linkedin_local_session as helper
from linkedin_profile_extractor import ExtractionError

URL = "https://www.linkedin.com/in/test-candidate/"


class Page:
    url = URL
    def goto(self, *args, **kwargs):
        pass
    def set_default_timeout(self, value):
        pass
    def locator(self, selector):
        return type("Empty", (), {"all": lambda self: []})()


class Context:
    closed = False
    def new_page(self):
        return Page()
    def close(self):
        self.closed = True


class Runtime:
    def __init__(self):
        self.chromium = self
        self.contexts = []
    def launch_persistent_context(self, path, **kwargs):
        self.options = kwargs
        context = Context()
        self.contexts.append(context)
        return context


class SessionTests(unittest.TestCase):
    def test_expiry_is_fixed_not_sliding_and_clock_rollback_is_not_reused(self):
        with tempfile.TemporaryDirectory() as base:
            now = [1000]
            store = helper.SessionStore(base, now=lambda: now[0])
            store.remember()
            self.assertTrue(store.valid())
            now[0] += helper.SESSION_TTL - 1
            self.assertTrue(store.valid())
            now[0] += 1
            self.assertFalse(store.valid())
            now[0] = 999
            self.assertFalse(store.valid())

    def test_forget_removes_only_owned_browser_profile_and_metadata(self):
        with tempfile.TemporaryDirectory() as base:
            unrelated = pathlib.Path(base) / "normal-browser.txt"
            unrelated.write_text("keep")
            store = helper.SessionStore(base)
            store.profile.mkdir()
            (store.profile / "fictional-session").write_text("not a real credential")
            store.remember()
            store.forget()
            self.assertFalse(store.profile.exists())
            self.assertFalse(store.meta.exists())
            self.assertEqual(unrelated.read_text(), "keep")

    def test_unrecognized_folder_and_linked_cleanup_are_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            root = pathlib.Path(base) / "remembered-session"
            root.mkdir()
            (root / "unknown.txt").write_text("keep")
            with self.assertRaises(ExtractionError):
                helper.SessionStore(base)
        with tempfile.TemporaryDirectory() as base:
            store = helper.SessionStore(base)
            with patch.object(helper, "linked", return_value=True), self.assertRaises(ExtractionError):
                store.forget()

    def test_duplicate_helper_is_rejected_and_crash_releases_lease(self):
        with tempfile.TemporaryDirectory() as base:
            store = helper.SessionStore(base)
            with store.lease():
                with self.assertRaises(ExtractionError), store.lease():
                    pass
            with store.lease():
                pass

    def test_two_profiles_reuse_context_and_relaunch_skips_sign_in(self):
        with tempfile.TemporaryDirectory() as base:
            prompts, outputs = [], []
            runtime = Runtime()
            answers = iter(["", "https://www.linkedin.com/in/second-candidate/", "quit"])
            def prompt(message):
                prompts.append(message)
                return next(answers)
            def read(page, url, report):
                return {"format": "anthro-linkedin-profile", "version": 1, "url": url, "name": "Fictional", "skills": [["React"]], "raw_text": "excluded"}
            with patch.object(helper, "read_profile", side_effect=read):
                helper.run_helper(URL, base, prompt=prompt, report=lambda _: None,
                    factory=lambda: contextlib.nullcontext(runtime), clipboard=lambda text: outputs.append(text) or True)
            self.assertEqual(len(runtime.contexts), 1)
            self.assertTrue(runtime.contexts[0].closed)
            self.assertFalse(runtime.options["headless"])
            self.assertEqual(len(list(pathlib.Path(base).glob("profile-*.json"))), 2)
            results = [json.loads(text) for text in outputs if text]
            self.assertEqual(len(results), 2)
            self.assertNotIn("raw_text", results[0])
            self.assertEqual(sum("Sign in" in prompt for prompt in prompts), 1)
            prompts.clear()
            runtime = Runtime()
            with patch.object(helper, "read_profile", side_effect=read):
                helper.run_helper(URL, base, prompt=lambda message: prompts.append(message) or "quit",
                    report=lambda _: None, factory=lambda: contextlib.nullcontext(runtime), clipboard=lambda _: False)
            self.assertFalse(any("Sign in" in prompt for prompt in prompts))

    def test_failure_does_not_copy_result_and_revoke_closes_then_forgets(self):
        with tempfile.TemporaryDirectory() as base:
            runtime = Runtime()
            answers = iter(["", "revoke"])
            copies = []
            with patch.object(helper, "read_profile", side_effect=ExtractionError("Missing header")):
                helper.run_helper(URL, base, prompt=lambda _: next(answers), report=lambda _: None,
                    factory=lambda: contextlib.nullcontext(runtime), clipboard=lambda value: copies.append(value))
            self.assertEqual(copies, [""])
            self.assertTrue(runtime.contexts[0].closed)
            self.assertFalse(helper.SessionStore(base).valid())

    def test_refresh_replaces_context_and_does_not_collect_credentials(self):
        with tempfile.TemporaryDirectory() as base:
            runtime = Runtime()
            answers = iter(["", "refresh", "", "quit"])
            with patch.object(helper, "read_profile", return_value={"name": "Fictional"}):
                helper.run_helper(URL, base, prompt=lambda _: next(answers), report=lambda _: None,
                    factory=lambda: contextlib.nullcontext(runtime), clipboard=lambda _: True)
            self.assertEqual(len(runtime.contexts), 2)
            self.assertTrue(all(context.closed for context in runtime.contexts))

    def test_cancelled_new_login_forgets_profile_and_closes(self):
        with tempfile.TemporaryDirectory() as base:
            runtime = Runtime()
            with self.assertRaises(ExtractionError):
                helper.run_helper(URL, base, prompt=lambda _: "cancel", report=lambda _: None,
                    factory=lambda: contextlib.nullcontext(runtime))
            self.assertTrue(runtime.contexts[0].closed)
            self.assertFalse(helper.SessionStore(base).valid())

    def test_forget_command_never_launches_browser(self):
        with tempfile.TemporaryDirectory() as base:
            store = helper.SessionStore(base)
            store.remember()
            helper.run_helper(None, base, forget=True, report=lambda _: None,
                factory=lambda: self.fail("Forget launched a browser"))
            self.assertFalse(store.valid())

    def test_real_cli_forget_and_wrong_owned_folder_print_no_traceback(self):
        with tempfile.TemporaryDirectory() as base:
            script = pathlib.Path(__file__).with_name("linkedin_profile_extractor.py")
            command = [sys.executable, str(script), "--forget-session", "--session-root", base]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("login removed", result.stdout)
            (pathlib.Path(base) / "remembered-session" / "owner.json").write_text('{"owner":"someone-else"}')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("Unrecognized session folder", result.stderr)
            self.assertNotIn("Traceback", result.stderr)

    @unittest.skipUnless(sys.platform == "win32", "Windows clipboard implementation")
    def test_clipboard_never_interprets_profile_text_as_powershell(self):
        payload = '{"name":"Fictional अमिता $(Get-Secret)"}'
        with patch.object(helper.subprocess, "run", return_value=type("Result", (), {"returncode":0})()) as run:
            self.assertTrue(helper.copy_profile(payload))
            self.assertEqual(run.call_args.kwargs["input"], payload)
            self.assertNotIn(payload, " ".join(run.call_args.args[0]))
            self.assertEqual(run.call_args.kwargs["encoding"], "utf8")
        with patch.object(helper.subprocess, "run", side_effect=subprocess.TimeoutExpired("powershell",10)):
            self.assertFalse(helper.copy_profile(payload))


if __name__ == "__main__":
    unittest.main()
