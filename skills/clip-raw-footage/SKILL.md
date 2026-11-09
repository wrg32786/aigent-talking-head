---
name: clip-raw-footage
description: "Cut raw talking-head footage (phone, camera, Zoom) into clean, transcribed, sentence-bounded clips with retakes flagged, ready to drop into a talking-head ad cut. Use when someone hands over raw takes and wants usable pieces."
---

# Clip raw footage

`kit/clip.py` turns one raw recording (usually a phone clip from `inbox/`) into numbered clips you can pick from, in four steps. On Windows run it as `py -3 kit/clip.py`. If the goal is a finished reel, `npm run reel` runs this for you; see the `talking-head-ad` skill.

1. **Transcribe.** It runs faster-whisper with word timestamps over the whole file.
2. **Split into sentences.** Short sentences merge with a neighbour until each clip is at least 3 s long, because shorter inserts read as jumpy.
3. **Flag retakes.** If a later sentence within 150 s repeats any 4-word phrase, the earlier one is marked `retake (see clip-NNN)`. A short lead-in that runs straight into a flub ("All right, welcome back.") gets the same mark. Restarts often reword the opener but keep the body, which is why it compares phrases rather than first words. **Nothing is deleted.**
4. **Set clip ends from the audio, not from word stamps.** Each clip starts in the silence just before its first word, with a few frames of lead and never mid-sentence. It ends when the voice stops plus 0.15 s, never running into the next line.

## Run

```
python3 kit/clip.py inbox/raw.mov --out clips --vertical            # center crop to 1080x1920
python3 kit/clip.py inbox/raw.mov --out clips --vertical --cropx 0.4 # face left of center
python3 kit/clip.py inbox/raw.mov --model medium.en                  # faster; large-v3 is the default
```

Outputs in `clips/`:
- `clip-NNN.mp4`: H.264 at CRF 16, 24 fps, voice normalized to -16 LUFS. Pass `--vertical` for 1080x1920.
- `clips.json`: id, source in and out, duration, status, text, and word times relative to the clip.
- `clips.md`: the same as a table for a human to scan.
- `clips-sheet.png`: the first and last frame of every clip, one row each.

## Pick and cut

1. Read `clips.md`. Skip `retake` rows, slates ("Okay, video two...") and asides ("Hate all of that...").
2. Read `clips-sheet.png` for clips that end mid-move: a look-down, or walking out of frame. Trim the `out` of those segments.
3. Add the keepers to the ad's `cut.json` as `{"file": "../clips/clip-009.mp4", "in": 0, "out": <dur>}`. They're already vertical and normalized, so don't add `norm`.
4. Continue with the `talking-head-ad` skill from step 3, or let `npm run reel -- --clips clips` build the cut and captions from every keep clip.
5. Captions: the word times in `clips.json` feed `kit/autocaption.mjs`, so you don't need to run `tx.py` again on these clips.

## Notes

- Tested on 75 s of 1920x1080 phone footage (Nov 2026): 10 clips, the flubbed intro was correctly flagged against its redo, and the clips assembled with a HeyGen take in one cut.
- Raw camera audio sits near -32 LUFS, and the clipper normalizes it. If you use a raw file directly in `cut.json` instead, set `"norm": true`.
- A slate or a director's aside reads as a normal sentence to the clipper. A human or agent still makes the final pick from `clips.md`.
