#!/usr/bin/env python3
"""Python tests for kit/facezone.py (no video, no model). Run: python3 tests/test_facezone.py"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "kit"))

import facezone as FZ  # noqa: E402


def face(x, y, w, h, score=0.9):
    # YuNet row at analysis size: box, right eye, left eye, nose, mouth right, mouth left, score
    return [x, y, w, h, x + 0.3 * w, y + 0.4 * h, x + 0.7 * w, y + 0.4 * h, x + 0.5 * w, y + 0.6 * h,
            x + 0.35 * w, y + 0.78 * h, x + 0.65 * w, y + 0.78 * h, score]


class FaceZone(unittest.TestCase):
    def test_zone_is_brows_to_chin_with_margin_and_crown_above(self):
        x0, y0, x1, y1, crown = FZ.zone_of(face(200, 200, 100, 120), margin=0.18)
        s = FZ.OW / FZ.AW
        eye_y = (200 + 0.4 * 120) * s
        self.assertLess(y0, eye_y)                    # covers the eyes and brows
        self.assertGreater(y1, (200 + 120) * s)       # below the chin
        self.assertLess(x0, 200 * s); self.assertGreater(x1, 300 * s)
        self.assertLess(crown, y0)                    # the crown (hair, cap) sits above the zone

    def test_smoothing_holds_gaps_restarts_at_cuts_and_never_shrinks(self):
        a = [100.0, 400.0, 300.0, 700.0, 350.0]
        b = [700.0, 400.0, 900.0, 700.0, 350.0]       # a jump of more than 0.6 face widths: a cut
        raw = [a, None, a, [105.0, 402.0, 305.0, 705.0, 352.0], a, b, b, b] + [None] * 20
        z = FZ.smooth(raw, fps=8)
        self.assertIsNotNone(z[1])                    # a one-sample miss is held
        self.assertAlmostEqual(z[6][0], 700.0, delta=1)  # no smearing across the cut
        for r, s in zip(raw, z):
            if r and s:
                self.assertLessEqual(s[0], r[0] + 1e-6); self.assertLessEqual(s[1], r[1] + 1e-6)
                self.assertGreaterEqual(s[2], r[2] - 1e-6); self.assertGreaterEqual(s[3], r[3] - 1e-6)
        self.assertIsNone(z[-1])                      # no face for over a second: no zone

    def test_pick_prefers_the_big_face_near_the_last_zone(self):
        big, small = face(100, 100, 120, 140), face(400, 600, 40, 50)
        self.assertEqual(FZ.pick([small, big], None)[0], 100)


if __name__ == "__main__":
    unittest.main()
