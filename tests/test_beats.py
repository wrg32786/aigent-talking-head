#!/usr/bin/env python3
"""Python tests for kit/beats.py. Run: python3 tests/test_beats.py"""
from __future__ import annotations

import math
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "kit"))

import beats  # noqa: E402


def write_clicks(path: Path, seconds: float = 6.0, period: float = 0.5, sr: int = 22050, drop_at: float = 4.0) -> None:
    n = int(sr * seconds)
    samples = [0.0] * n
    click = int(0.012 * sr)
    i = 0
    while i * period < seconds:
        t0 = int(i * period * sr)
        amp = 0.95 if abs(i * period - drop_at) < 1e-6 else 0.7
        for k in range(click):
            if t0 + k < n:
                samples[t0 + k] = amp * math.sin(2 * math.pi * 1200 * k / sr) * (1 - k / click)
        i += 1
    # a short swell into the drop so RMS-rise detection has a before/after
    if drop_at > 0.2:
        a0 = int((drop_at - 0.25) * sr)
        for k in range(a0, min(n, int(drop_at * sr))):
            samples[k] *= 0.15
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(struct.pack("<h", max(-32767, min(32767, int(x * 32767)))) for x in samples)
        w.writeframes(frames)


class BeatsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import librosa  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("librosa is not installed")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.wav = Path(cls.tmp.name) / "clicks.wav"
        write_clicks(cls.wav)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_tempo_near_120(self):
        grid = beats.analyse(self.wav, start=0, duration=6)
        self.assertGreater(grid["duration_seconds"], 5.5)
        self.assertLess(abs(grid["tempo_bpm"] - 120), 8)
        self.assertGreaterEqual(len(grid["beats"]), 8)
        self.assertGreaterEqual(len(grid["onsets"]), 8)

    def test_times_are_reel_clock_after_start(self):
        grid = beats.analyse(self.wav, start=1.0, duration=4.0)
        self.assertLessEqual(grid["duration_seconds"], 4.15)
        self.assertTrue(grid["beats"], "expected beats")
        self.assertGreaterEqual(min(grid["beats"]), 0)
        self.assertLess(max(grid["beats"]), grid["duration_seconds"] + 0.15)
        self.assertEqual(grid["bed_start"], 1.0)

    def test_drops_are_intensity_filtered(self):
        grid = beats.analyse(self.wav, start=0, duration=6, drop_intensity_min=0.85)
        for d in grid["drops"]:
            self.assertGreaterEqual(d["intensity"], 0.85)
            self.assertIn("time", d)

    def test_cli_writes_json(self):
        out = Path(self.tmp.name) / "beat-grid.json"
        rc = beats.main([str(self.wav), "--start", "0", "--duration", "6", "--out", str(out)])
        self.assertEqual(rc, 0)
        self.assertTrue(out.is_file())
        data = out.read_text(encoding="utf-8")
        self.assertIn("tempo_bpm", data)
        self.assertIn("onsets", data)


if __name__ == "__main__":
    unittest.main()
