#!/usr/bin/env python3
"""Person crops on painted frames. Run with python tests/test_matte_crop.py."""
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "kit"))
import mask_refine as matte


class SquareSession:
    def __init__(self):
        self.calls = 0

    def raw(self, rgb):
        self.calls += 1
        red = cv2.resize(rgb[:, :, 0], (32, 32), interpolation=cv2.INTER_AREA)
        return cv2.resize((red > 127).astype(np.float32), rgb.shape[1::-1], interpolation=cv2.INTER_NEAREST)


class MatteCropTests(unittest.TestCase):
    def setUp(self):
        self.fake = SquareSession()
        self.frame = np.zeros((320, 160, 3), np.uint8)
        self.frame[200:280, 60:100, 0] = 255
        self.frame[222:226, 52:60, 0] = 255

    def test_thin_strand(self):
        self.assertLess(self.fake.raw(self.frame)[224, 55], 0.5)
        self.assertGreater(matte.matte_raw(self.fake, self.frame)[224, 55], 0.5)

    def test_arm_leaves_crop(self):
        self.frame[234:250, 75:150, 0] = 255
        whole = self.fake.raw(self.frame)
        alpha, _ = matte.matte_raw_boxed(self.fake, self.frame, (40, 180, 118, 300))
        self.assertTrue((whole[242:248, 128:145] > 0.5).all())
        np.testing.assert_array_equal(alpha[242:248, 128:145], whole[242:248, 128:145])

    def test_person_moves_clear_of_previous_box(self):
        _, box = matte.matte_raw_boxed(self.fake, self.frame)
        moved = np.roll(self.frame, -160, axis=0)
        alpha, _ = matte.matte_raw_boxed(self.fake, moved, box)
        self.assertTrue((alpha[50:110, 65:95] > 0.5).all())

    def test_pass_counts(self):
        _, box = matte.matte_raw_boxed(self.fake, self.frame)
        self.assertEqual(self.fake.calls, 2)
        matte.matte_raw_boxed(self.fake, self.frame, box)
        self.assertEqual(self.fake.calls, 3)
        matte.matte_raw_boxed(self.fake, np.full_like(self.frame, 255))
        self.assertEqual(self.fake.calls, 4)

    def test_empty_and_clamped_box(self):
        alpha = np.zeros((60, 80), np.float32)
        self.assertIsNone(matte.person_box(alpha))
        alpha[:30, 50:] = 1
        x0, y0, x1, y1 = matte.person_box(alpha)
        self.assertEqual((y0, x1), (0, 80))
        self.assertLess(x0, 50)
        self.assertGreater(y1, 30)


if __name__ == "__main__":
    unittest.main()
