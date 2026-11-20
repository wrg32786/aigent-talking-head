---
name: clip-raw-footage
description: "Cut raw talking-head footage (phone, camera, Zoom) into clean, transcribed, sentence-bounded clips with retakes flagged, ready to drop into a talking-head ad cut. Use when someone hands over raw takes and wants usable pieces."
---

# Clip raw footage

`kit/clip.py` turns one raw recording, or several takes of the same script (usually phone clips from `inbox/`), into numbered clips you can pick from, in four steps (five with several takes). On Windows run it as `py -3 kit/clip.py`. If the goal is a finished reel, `npm run reel` runs this for you; see the `talking-head-ad` skill.

1. **Transcribe.** It runs faster-whisper with word timestamps over the whole file.
2. **Split into sentences.** Short sentences merge with a neighbour until each clip is at least 3 s long, because shorter inserts read as jumpy.
3. **Flag retakes.** If a later sentence within 150 s repeats any 4-word phrase, the earlier one is marked `retake (see clip-NNN)`. A short lead-in that runs straight into a flub ("All right, welcome back.") gets the same mark. Restarts often reword the opener but keep the body, which is why it compares phrases rather than first words. **Nothing is deleted.**
4. **With several takes, pick the best take of each sentence.** Sentences are matched across files by a shared 4-word phrase or by wording that's at least 60% the same. Each match is scored on Whisper's word confidence, minus repeated words and fillers ("um", "like"), and the best one stays `keep`; the others are marked `retake (take2.mp4 is better)`. `--hook take3.mov` forces the first sentence from that take, for example the one shot from your most extreme angle (optional).
5. **Set clip ends from the audio, not from word stamps.** `kit/cutpoints.cjs` reads the level and the high band (so a soft "s" still counts as speech). Each clip starts at least 70 ms (usually 110 ms) before its first word sounds and ends at least 130 ms (usually 180 ms) after the last sound, never running into the next line. With no pause to cut in, the clip runs on to the next pause instead of cutting a word off. Check any footage with `node kit/cut-bench.mjs take.mp4 --words take.tx.json`: it prints mid-word cuts, lead-ins and tails for every cut path.

## Run

```
python3 kit/clip.py inbox/raw.mov --out clips --vertical            # center crop to 1080x1920
python3 kit/clip.py inbox/raw.mov --out clips --vertical --cropx 0.4 # face left of center
python3 kit/clip.py inbox/raw.mov --model large-v3                   # most accurate; small.en is the default
python3 kit/clip.py inbox/take1.mov inbox/take2.mov --vertical --hook take2.mov   # several takes, best sentence of each
python3 kit/clip.py take1.mov take2.mov --words words.json           # reuse tx.py word times, skips Whisper
```

Outputs in `clips/`:
- `clip-NNN.mp4`: H.264 at CRF 16, 24 fps, voice normalized to -16 LUFS. Pass `--vertical` for 1080x1920.
- `clips.json`: id, source take, source in and out, duration, status, score, text, and word times relative to the clip, plus the list of takes.
- `clips.md`: the same as a table for a human to scan, with a take column.
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
