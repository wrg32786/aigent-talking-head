#!/usr/bin/env python3
"""caption_layer must not write NaN when a word box sits entirely on the person (Studio report 6).

    python3 tests/test_teardown_extras.py
"""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("teardown_py", ROOT / "kit" / "teardown.py")
TD = importlib.util.module_from_spec(spec)
spec.loader.exec_module(TD)

try:
    import cv2  # noqa: F401
    import numpy as np
    HAS_CV = True
except ImportError:
    HAS_CV = False


@unittest.skipUnless(HAS_CV, "needs OpenCV and numpy")
class CaptionLayer(unittest.TestCase):
    def _run(self, img, mask, cues):
        old = TD.frame_at
        TD.frame_at = lambda *a, **k: img
        try:
            return TD.caption_layer("unused.mp4", cues, lambda im: mask)
        finally:
            TD.frame_at = old

    def _cue(self, **k):
        c = {"t0": 0.5, "t1": 1.0, "text": "NOW", "bbox": [0.25, 0.08, 0.3, 0.08], "line_h": 0.08, "conf": 0.9}
        c.update(k)
        return c

    def test_box_entirely_on_the_person_is_skipped_and_dumps_as_json(self):
        # a 720-wide frame, as caption_layer requests, with the person covering the whole picture
        img = np.full((1280, 720, 3), 80, np.uint8)
        mask = np.ones(img.shape[:2], np.uint8)
        samples = self._run(img, mask, [self._cue()])
        raw = json.dumps({"layer_samples": samples}, allow_nan=False)
        self.assertEqual(samples, [])
        self.assertEqual(json.loads(raw)["layer_samples"], [])

    def test_a_box_that_meets_the_person_and_the_background_still_samples(self):
        img = np.full((1280, 720, 3), 80, np.uint8)
        # bright letters on the right half of the word box (off the person)
        x0, y0 = int(0.25 * 720), int(0.08 * 1280)
        x1, y1 = int((0.25 + 0.3) * 720), int(min(1, 0.08 + 0.08 * 1.25) * 1280)
        mid = (x0 + x1) // 2
        img[y0:y1, mid:x1] = 255
        mask = np.zeros(img.shape[:2], np.uint8)
        mask[:, :mid] = 1  # person on the left, including the left half of the box
        samples = self._run(img, mask, [self._cue()])
        self.assertEqual(len(samples), 1)
        self.assertGreater(samples[0]["on_n"], 30)
        json.dumps(samples, allow_nan=False)
        for k in ("text_on_person", "text_off_person"):
            self.assertIsInstance(samples[0][k], float)
            self.assertTrue(samples[0][k] == samples[0][k])  # not NaN


if __name__ == "__main__":
    unittest.main()
