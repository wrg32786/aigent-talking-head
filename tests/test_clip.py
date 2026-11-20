#!/usr/bin/env python3
"""Tests for kit/clip.py cut boundaries, order, retakes and output, on synthetic audio (no Whisper: word times are
given with --words). Run: python3 tests/test_clip.py   (needs ffmpeg and ffprobe on PATH)"""
from __future__ import annotations

import array
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIP = ROOT / "kit" / "clip.py"
HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def make_video(path: Path, dur: float, tones, hiss=()):
    """A small test video whose audio is a 300 Hz tone wherever a word is "said" (tones: [(start, end)]), plus quiet
    6 kHz hiss spans (hiss: [(start, end)]) that sit under the -35 dB level threshold, like a soft "s"."""
    sr = 16000
    n = int(sr * dur)
    buf = array.array("h", [0]) * n
    for spans, amp, f in ((tones, 0.5, 300.0), (hiss, 0.008, 6000.0)):
        for a, b in spans:
            for k in range(int(a * sr), min(n, int(b * sr))):
                buf[k] = max(-32767, min(32767, buf[k] + int(32767 * amp * math.sin(2 * math.pi * f * k / sr))))
    wav = path.with_suffix(".wav")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(buf.tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=160x90:rate=24:duration={dur}",
                    "-i", str(wav), "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "128k", str(path)], check=True)
    wav.unlink()


def words_for(lines):
    """[(start, "Some words here.", step)] -> word list [s, e, w, p]: each word step long, 90% of it voiced."""
    out = []
    for t0, text, *rest in lines:
        step = rest[0] if rest else 0.3
        for i, w in enumerate(text.split()):
            out.append([round(t0 + i * step, 3), round(t0 + i * step + step * 0.9, 3), w, 0.9])
    return out


def tones_for(words, extend=None):
    extend = extend or {}
    return [(w[0], extend.get(i, w[1])) for i, w in enumerate(words)]


class ClipTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="clip-test-"))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_clip(self, files, words, *extra):
        (self.dir / "words.json").write_text(json.dumps(words))
        r = subprocess.run([sys.executable, str(CLIP), *files, "--words", "words.json", "--out", "clips", "--encoder", "x264", *extra],
                           cwd=self.dir, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.out = r.stdout
        return json.loads((self.dir / "clips" / "clips.json").read_text())

    def test_first_word_never_shaved(self):
        # a clip that is already cut: the first word starts at 0.00 s. The clip must start at 0, not 0.05.
        w = words_for([(0.0, "You can do this today.")])
        make_video(self.dir / "a.mp4", 2.0, tones_for(w))
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--min", "0.5")
        c = cj["clips"][0]
        self.assertLessEqual(c["src_in"], 0.0)
        self.assertGreaterEqual(c["words"][0][0], 0.0, "first word starts before the clip")

    def test_clip_never_ends_inside_a_word(self):
        # Whisper says the last word ends at 1.62 s; the voice runs to 1.9 s and a soft "s" (under the level threshold,
        # only in the band above 4 kHz) to 2.3 s. The next line starts at 4.0 s.
        w = words_for([(0.5, "You need that anymore."), (4.0, "Next line starts here.")])
        tones = tones_for(w, {3: 1.9})
        make_video(self.dir / "a.mp4", 6.0, tones, hiss=[(1.9, 2.3)])
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--min", "0.5")
        first = cj["clips"][0]
        self.assertEqual(first["text"], "You need that anymore.")
        # kit/cutpoints.cjs: at least 120 ms after the last sound, the "s" in the band above 3.5 kHz included
        self.assertGreaterEqual(first["src_out"], 2.3 + 0.12, f"cut inside the word's tail: {first['src_out']}")
        self.assertLessEqual(first["src_out"], 4.0 - 0.05, "ran into the next line")

    def test_piece_under_half_a_second_joins_the_line_before(self):
        # "anymore." then Whisper writes "more." again as its own sentence, 0.2 s long
        w = words_for([(0.5, "You do not need that anymore.")]) + [[2.35, 2.55, "more.", 0.6]] + words_for([(5.0, "A brand new line here.")])
        make_video(self.dir / "a.mp4", 7.0, tones_for(w))
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--min", "0.5")
        texts = [c["text"] for c in cj["clips"]]
        self.assertNotIn("more.", texts)
        self.assertTrue(texts[0].endswith("anymore. more."), texts)
        self.assertGreaterEqual(cj["clips"][0]["src_out"], 2.55)

    def test_different_files_keep_the_order_given(self):
        lines = {"c.mp4": "Third file talks about pricing plans.", "a.mp4": "First file talks about cameras.", "b.mp4": "Second file talks about lighting."}
        words = {}
        for name, text in lines.items():
            w = words_for([(1.0, text), (4.0, "And one more point here.")]) if name != "b.mp4" else words_for([(1.0, text), (4.0, "Lights matter more than lenses.")])
            # a and c share one line, b shares its opener shape with a: still different clips, not takes of one script
            words[name] = w
            make_video(self.dir / name, 6.0, tones_for(w))
        order = ["c.mp4", "a.mp4", "b.mp4"]
        cj = self.run_clip(order, words, "--min", "0.5")
        takes = []
        for c in cj["clips"]:
            if not takes or takes[-1] != c["take"]:
                takes.append(c["take"])
        self.assertEqual(takes, order, [(c["take"], c["text"]) for c in cj["clips"]])
        self.assertEqual(cj["order"], "files")

    def test_precut_clips_are_used_whole_in_order(self):
        order = ["clip-079.mp4", "clip-002.mp4", "clip-016.mp4"]
        words = {}
        for k, name in enumerate(order):
            w = words_for([(0.0, ["Cameras matter less than light.", "Pricing starts at nine dollars.", "Join the community this week."][k]),
                           (2.4, ["Window light works best.", "Cancel any time you like.", "The link is in my bio."][k])])
            words[name] = w
            make_video(self.dir / name, w[-1][1] + 0.3, tones_for(w))
        cj = self.run_clip(order, words, "--min", "0.5")
        self.assertEqual([c["take"] for c in cj["clips"]], order)
        for c in cj["clips"]:
            self.assertEqual(c["src_in"], 0.0)
            self.assertGreaterEqual(c["words"][0][0], 0.0)
            self.assertEqual(c["status"], "keep")

    def test_whole_flag(self):
        w = words_for([(1.5, "One sentence here."), (4.0, "And a second one.")])
        make_video(self.dir / "a.mp4", 6.0, tones_for(w))
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--whole")
        self.assertEqual(len(cj["clips"]), 1)
        self.assertEqual(cj["clips"][0]["src_in"], 0.0)

    def test_retakes_need_most_of_the_line(self):
        w = words_for([
            (0.5, "We don't write code, but we know how to talk to the AI."),
            (4.8, "We know how to get it to execute things."),
            (8.0, "We know how to get things done with it."),
            (11.5, "We know how to build systems."),
            (14.0, "Hopefully you just finished the..."),
            (16.5, "Hopefully you just finished the awakening course today."),
            (20.0, "This long line explains the free product and what you get when you join and how it works for you."),
            (28.0, "And you get the free product."),
        ])
        make_video(self.dir / "a.mp4", 31.0, tones_for(w))
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--min", "0.5")
        st = {c["text"]: c["status"] for c in cj["clips"]}
        for t in ["We know how to get it to execute things.", "We know how to get things done with it.", "We know how to build systems."]:
            self.assertTrue(st[t].startswith("keep"), (t, st[t]))
        self.assertTrue(st["Hopefully you just finished the..."].startswith("retake"), st)
        long = [k for k in st if k.startswith("This long line")][0]
        self.assertTrue(st[long].startswith("keep"), st[long])

    def test_lines_with_no_pause_to_cut_in_are_one_clip(self):
        # 0.13 s between two lines: no room for 120 ms after the last sound and 60 ms before the next, so a cut there
        # would clip a word. The two lines stay one clip; a real pause (0.6 s) still splits.
        w = words_for([(0.5, "First line is here."), (1.83, "Second line runs on."), (3.6, "Third line after a pause.")])
        make_video(self.dir / "a.mp4", 6.0, tones_for(w))
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--min", "0.5", "--plan-only")
        texts = [c["text"] for c in cj["clips"]]
        self.assertEqual(texts, ["First line is here. Second line runs on.", "Third line after a pause."], texts)
        self.assertLessEqual(cj["clips"][0]["src_out"], 3.6 - 0.06)
        self.assertGreaterEqual(cj["clips"][0]["src_out"], 1.83 + 3 * 0.3 + 0.27 + 0.12)

    def test_fragments_are_marked(self):
        w = words_for([(0.5, "A full sentence that is long enough."), (5.0, "Okay."), (8.0, "And then I thi-"), (11.0, "Back to the real point now.")])
        make_video(self.dir / "a.mp4", 14.0, tones_for(w))
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--min", "0.5")
        st = {c["text"]: c["status"] for c in cj["clips"]}
        self.assertTrue(st["Okay."].startswith("fragment"), st)
        self.assertTrue(st["And then I thi-"].startswith("fragment"), st)
        self.assertTrue(st["Back to the real point now."].startswith("keep"), st)

    def test_list_first_then_progress_and_paged_sheet(self):
        lines = [(0.5 + k * 1.8, f"Line {k} ok.", 0.25) for k in range(25)]
        w = words_for(lines)
        make_video(self.dir / "a.mp4", 0.5 + 25 * 1.8 + 1, tones_for(w))
        cj = self.run_clip(["a.mp4"], {"a.mp4": w}, "--min", "0.5", "--jobs", "3")
        self.assertEqual(len(cj["clips"]), 25)
        self.assertNotIn("pending", cj)
        i_list, i_prog = self.out.index("clips.json and clips.md written"), self.out.index("progress clips 1/25")
        self.assertLess(i_list, i_prog)
        self.assertIn("progress clips 25/25", self.out)
        self.assertTrue((self.dir / "clips" / "clips-sheet.png").exists())
        self.assertTrue((self.dir / "clips" / "clips-sheet-2.png").exists())
        for c in cj["clips"]:
            self.assertTrue((self.dir / c["file"]).exists(), c["file"])


if __name__ == "__main__":
    if not HAVE_FFMPEG:
        print("skipped: ffmpeg and ffprobe are needed")
        sys.exit(0)
    unittest.main(verbosity=2)
