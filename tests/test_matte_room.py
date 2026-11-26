#!/usr/bin/env python3
"""Room matches on a painted title window. Run with python tests/test_matte_room.py."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "kit"))
import mask_refine as matte


class MatteRoomTests(unittest.TestCase):
    def setUp(self):
        self.frames = np.full((10, 96, 120, 3), 100, np.uint8)
        self.alphas = np.zeros((10, 96, 120), np.float32)
        self.person = [190, 80, 100]
        self.frames[:, 32:88, 48:80] = self.person
        self.alphas[:, 32:88, 48:80] = 1
        self.frames[:, 64:80, 24:48] = 20
        self.alphas[6:, 64:80, 24:48] = 1

    def test_room_on_four_frames(self):
        rgb, alpha = self.frames.tobytes(), self.alphas.tobytes()
        hits = matte.room_patches(self.frames, self.alphas)
        self.assertEqual(self.frames.tobytes(), rgb)
        self.assertEqual(self.alphas.tobytes(), alpha)
        self.assertEqual([hit["frame"] for hit in hits], [6, 7, 8, 9])
        for hit in hits:
            patch, = hit["patches"]
            x0, y0, x1, y1 = patch["box"]
            self.assertTrue(24 <= x0 * 120 < 36 < x1 * 120 <= 48)
            self.assertTrue(64 <= y0 * 96 < 72 < y1 * 96 <= 80)
            self.assertGreater(patch["size"], 300)

    def test_real_arm(self):
        self.frames[6:, 64:80, 24:48] = self.person
        self.assertEqual(matte.room_patches(self.frames, self.alphas), [])

    def test_cut_in_the_clear_samples(self):
        # One channel changes on a cut. The mean is close enough to match either shot.
        self.frames[5:, :, :, 0] += 20
        self.assertEqual(matte.room_patches(self.frames, self.alphas), [])

    def test_small_patch(self):
        self.alphas[6:, 64:80, 24:48] = 0
        self.alphas[6:, 64:68, 44:48] = 1
        self.assertEqual(matte.room_patches(self.frames, self.alphas), [])

    def test_patch_inside_a_sleeve(self):
        self.alphas[6:, 60:84, 20:50] = 1
        self.frames[6:, 60:84, 20:50] = self.person
        self.frames[6:, 64:80, 24:48] = 20
        self.assertEqual(matte.room_patches(self.frames, self.alphas), [])


if __name__ == "__main__":
    unittest.main()
