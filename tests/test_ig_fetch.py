#!/usr/bin/env python3
"""ig_fetch.py must print the plain Instagram refusal for any InstaloaderException, including
BadResponseException, with no traceback (Studio report 6).

    python3 tests/test_ig_fetch.py
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "kit" / "ig_fetch.py"


class IgFetchErrors(unittest.TestCase):
    def _fake_pkg(self, d, exc_name="BadResponseException", message="Please wait a few minutes before you try again"):
        pkg = Path(d) / "instaloader"
        pkg.mkdir()
        (pkg / "exceptions.py").write_text(
            "class InstaloaderException(Exception):\n    pass\n\n"
            "class LoginRequiredException(InstaloaderException):\n    pass\n\n"
            "class ConnectionException(InstaloaderException):\n    pass\n\n"
            "class QueryReturnedBadRequestException(InstaloaderException):\n    pass\n\n"
            "class BadResponseException(InstaloaderException):\n    pass\n",
            encoding="utf-8",
        )
        (pkg / "__init__.py").write_text(
            "from . import exceptions\n\n"
            f"class Post:\n"
            f"    @staticmethod\n"
            f"    def from_shortcode(ctx, shortcode):\n"
            f"        raise exceptions.{exc_name}({message!r})\n\n"
            "class Instaloader:\n"
            "    def __init__(self, **kwargs):\n"
            "        self.context = None\n"
            "    def download_post(self, post, target=None):\n"
            "        pass\n",
            encoding="utf-8",
        )

    def _run(self, exc_name):
        with tempfile.TemporaryDirectory() as d:
            self._fake_pkg(d, exc_name)
            out = os.path.join(d, "out")
            env = {**os.environ, "PYTHONPATH": d + os.pathsep + os.environ.get("PYTHONPATH", "")}
            r = subprocess.run([sys.executable, str(KIT), "ShortCode1", out],
                               capture_output=True, text=True, env=env)
            return r

    def test_bad_response_is_a_plain_refusal_with_no_traceback(self):
        r = self._run("BadResponseException")
        err = (r.stderr or "") + (r.stdout or "")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Instagram refused the anonymous download (BadResponseException:", err)
        self.assertIn("Please wait a few minutes before you try again", err)
        self.assertIn("This helper does not log in", err)
        self.assertNotIn("Traceback", err)

    def test_login_required_still_prints_the_same_plain_line(self):
        r = self._run("LoginRequiredException")
        err = (r.stderr or "") + (r.stdout or "")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Instagram refused the anonymous download (LoginRequiredException:", err)
        self.assertNotIn("Traceback", err)


if __name__ == "__main__":
    unittest.main()
