#!/usr/bin/env python3
"""Memory checks for the person mask. Run: python3 tests/test_matte_memory.py"""
import io
import os
import runpy
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1] / "kit"
sys.path.insert(0, str(KIT))

import mask_refine as matte


class MatteMemoryTests(unittest.TestCase):
    def test_portrait_need_by_provider(self):
        for provider, need in [("CPUExecutionProvider", 8.8), ("DmlExecutionProvider", 25.8)]:
            with self.subTest(provider=provider):
                self.assertEqual(matte.matte_need_gb("birefnet-portrait", provider), need)

    def test_default_uses_first_provider(self):
        with patch.object(matte, "matte_providers", return_value=["DmlExecutionProvider", "CPUExecutionProvider"]):
            self.assertEqual(matte.matte_need_gb("birefnet-portrait"), 25.8)

    def test_missing_runtime_uses_cpu(self):
        with patch.dict(sys.modules, {"onnxruntime": None}):
            self.assertEqual(matte.matte_need_gb("birefnet-portrait"), 8.8)

    def test_pick_provider_uses_cpu_when_directml_does_not_fit(self):
        with (
            patch.object(matte, "matte_providers", return_value=["DmlExecutionProvider", "CPUExecutionProvider"]),
            patch.dict(os.environ, {"MASK_PROVIDER": ""}, clear=False),
        ):
            self.assertEqual(matte.pick_provider("birefnet-portrait", free=24.6), "CPUExecutionProvider")
            self.assertEqual(matte.pick_provider("birefnet-portrait", free=26.0), "DmlExecutionProvider")
            self.assertEqual(matte.pick_provider("birefnet-portrait", free=6.0), "CPUExecutionProvider")

    def test_forced_directml_is_kept_even_when_short(self):
        with (
            patch.object(matte, "matte_providers", return_value=["DmlExecutionProvider", "CPUExecutionProvider"]),
            patch.dict(os.environ, {"MASK_PROVIDER": "dml"}),
        ):
            self.assertEqual(matte.pick_provider("birefnet-portrait", free=24.6), "DmlExecutionProvider")

    def test_short_directml_falls_back_to_cpu_and_would_load(self):
        output = io.StringIO()
        runtime = Mock()
        runtime.get_available_providers.return_value = ["CPUExecutionProvider", "DmlExecutionProvider"]
        with (
            patch.dict(sys.modules, {"onnxruntime": runtime, "rembg": Mock(), "mediapipe": None}),
            patch.dict(os.environ, {"MASK_FORCE": "0", "MASK_MODEL": "", "MASK_PROVIDER": ""}),
            patch.object(sys, "argv", ["mask.py", "unused-input", "unused-output", "--model", "birefnet-portrait"]),
            patch.object(matte, "cached_weights", return_value=True),
            patch.object(matte, "avail_gb", return_value=24.6),
            patch.object(matte, "matte_session", side_effect=AssertionError("attempted to load a model")),
            redirect_stdout(output),
        ):
            with self.assertRaises(AssertionError) as loaded:
                runpy.run_path(str(KIT / "mask.py"), run_name="__main__")
        self.assertIn("attempted to load a model", str(loaded.exception))
        self.assertRegex(output.getvalue(), r"uses the processor instead")

    def test_forced_short_directml_run_exits_before_loading(self):
        for args in (["--model", "birefnet-portrait"], []):
            with self.subTest(args=args):
                output = io.StringIO()
                runtime = Mock()
                runtime.get_available_providers.return_value = ["CPUExecutionProvider", "DmlExecutionProvider"]
                with (
                    patch.dict(sys.modules, {"onnxruntime": runtime, "rembg": Mock(), "mediapipe": None}),
                    patch.dict(os.environ, {"MASK_FORCE": "0", "MASK_MODEL": "", "MASK_PROVIDER": "dml"}),
                    patch.object(sys, "argv", ["mask.py", "unused-input", "unused-output", *args]),
                    patch.object(matte, "cached_weights", return_value=True),
                    patch.object(matte, "avail_gb", return_value=24.6),
                    patch.object(matte, "matte_session", side_effect=AssertionError("attempted to load a model")),
                    redirect_stdout(output),
                    self.assertRaises(SystemExit) as stopped,
                ):
                    runpy.run_path(str(KIT / "mask.py"), run_name="__main__")
                self.assertEqual(stopped.exception.code, 3)
                self.assertRegex(output.getvalue(), r"on the graphics chip.*needs about 25\.8 GB and 24\.6 GB is free")
                self.assertNotIn("DirectML", output.getvalue())
                if not args:
                    self.assertIn("Using the MediaPipe preview", output.getvalue())


if __name__ == "__main__":
    unittest.main()
