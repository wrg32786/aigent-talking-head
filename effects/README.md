# Effects pass (optional)

51 starter video effects from [claude-video-effects](https://github.com/Vibha-Ramprakash/claude-video-effects) by Vibha Ramprakash, run as a second pass over a reel you already cut and captioned. The effects follow your face and can sit behind your head. Your captions are added back on top afterwards, and the audio is exactly the reel's.

- **Pick:** [CATALOG.md](CATALOG.md) lists every effect by moment (hook, claim, list, reveal, proof, objection, CTA, transition), energy, needs, duration and caption compatibility, plus menu presets. The machine-readable version is [catalog.json](catalog.json).
- **Set up once:** `npm run effects:setup` (a Python venv at `effects/.venv`, about 150 MB: numpy, opencv-python, pillow, mediapipe).
- **Run:** `npm run fx -- --name <job> --plan fx.json --still 1.2,6.5` for check frames, then without `--still` for `jobs/<job>/reel-fx-vN.mp4`. `npm run fx -- --list` prints the menu. Plan format: see the header of `kit/fx.cjs`.

## How the upstream code is included

`vendor/claude-video-effects/` is a verbatim copy of the upstream files the pass needs, pinned to the commit in `vendor/claude-video-effects/UPSTREAM.json`: `scripts/fx.py`, `scripts/words.py`, `SKILL.md`, `requirements.txt`, `LICENSE`, `models/` (YuNet face detector, MediaPipe selfie segmenter and their NOTICE) and `fonts/` (with their licences). That's 3.4 MB, so it's vendored rather than fetched at setup: it works offline, a version is exactly what was reviewed, and the licence files travel with it. The upstream README and promo image aren't copied.

- **Update:** `npm run effects:update` (latest) or `npm run effects:update -- --ref <sha>`. It re-copies the files, records the new commit, flags any promotional links, then runs `npm run effects:check`.
- **Check:** `npm run effects:check` fails if the catalog doesn't cover exactly the effects in `fx.py`, if a runner patch no longer matches, or if `CATALOG.md` is stale (`npm run effects:catalog` regenerates it from the JSON).
- **Runner patches:** `fx_runner.py` runs the vendored `fx.py` unchanged on disk, with two small in-memory patches so the upstream author's handle and an "Edited by Claude" pill can be set from the plan instead of being hard-coded. `kit/fx.cjs` also fills `name`/`handle` from the plan's `profile` and refuses plans that leave required text on the upstream demo copy.

## Captions and effects

Our caption band sits at about 60 to 78% of the frame height (`captionY` 1300). Captions are composited after the effects, so camera moves never zoom or crop them. Each effect is rated in the catalog:

- `safe`: keep captions on.
- `check`: read a check frame; move the effect (`y`, `pos`) or hide captions for that window if they crowd.
- `off`: captions are hidden automatically for that window (put `"captions": "on"` on the plan entry to override, or `"captions": "off"` on any entry to hide them).

Pairing rule: one effect in the caption band at a time, and nothing in the band while a sticker, hero word or CTA caption is up.

## Credits

Effects code: MIT, Copyright (c) 2026 Vibha Ramprakash. Face tracking: OpenCV YuNet (MIT). Person cut-out: MediaPipe Selfie Segmenter (Apache-2.0). Fonts: Archivo Black, Instrument Serif, Space Mono, Inter, Anton, Montserrat, Playfair Display (SIL OFL 1.1; full text in `licenses/OFL-1.1.txt`) and Permanent Marker (Apache-2.0). These are starter versions of the author's effects.
