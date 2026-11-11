# Effects pass (optional)

51 starter video effects from [claude-video-effects](https://github.com/Vibha-Ramprakash/claude-video-effects) by Vibha Ramprakash, run as a second pass over a reel you already cut and captioned. The effects follow your face and can sit behind your head. Your captions are added back on top afterwards, and the audio is exactly the reel's.

- **Pick:** [CATALOG.md](CATALOG.md) lists every effect by moment (hook, claim, list, reveal, proof, objection, CTA, transition), energy, needs, duration and caption compatibility, plus menu presets. The machine-readable version is [catalog.json](catalog.json). `npm run menu` prints the full option menu (effects plus finishes, looks, fonts, themes, transitions, SFX and beds). The labelled gallery is [showcase/index.html](../showcase/index.html) (`npm run showcase` rebuilds it). Offer 2 or 3 effects per moment and point the user at the showcase so nothing stays hidden.
- **Set up once:** `npm run effects:setup` (a Python venv at `effects/.venv`, about 150 MB: numpy, opencv-python, pillow, mediapipe, plus rembg + onnxruntime for the BiRefNet person mask, another ~390 MB). `npm run effects:setup -- --birefnet` also downloads the birefnet-general-lite weights (~214 MB) into rembg's cache. The person mask itself is `kit/mask.py` (`--model birefnet` or `mediapipe`).
- **Run:** `npm run fx -- --name <job> --plan fx.json --still 1.2,6.5` for check frames, then without `--still` for `jobs/<job>/reel-fx-vN.mp4`. `npm run fx -- --list` prints the menu. Plan format: see the header of `kit/fx.cjs`.

## How the upstream code is included

`vendor/claude-video-effects/` is a verbatim copy of the upstream files the pass needs, pinned to the commit in `vendor/claude-video-effects/UPSTREAM.json`: `scripts/fx.py`, `scripts/words.py`, `SKILL.md`, `requirements.txt`, `LICENSE`, `models/` (YuNet face detector, MediaPipe selfie segmenter and their NOTICE) and `fonts/` (with their licences). That's 3.4 MB, so it's vendored rather than fetched at setup: it works offline, a version is exactly what was reviewed, and the licence files travel with it. The upstream README and promo image aren't copied.

- **Update:** `npm run effects:update` (latest) or `npm run effects:update -- --ref <sha>`. It re-copies the files, records the new commit, flags any promotional links, then runs `npm run effects:check`.
- **Check:** `npm run effects:check` fails if the catalog doesn't cover exactly the effects in `fx.py`, if a runner patch no longer matches, or if `CATALOG.md` is stale (`npm run effects:catalog` regenerates it from the JSON).
- **Runner patches:** `fx_runner.py` runs the vendored `fx.py` unchanged on disk, with small in-memory patches so the upstream author's handle comes from the plan, and the upstream "Edited by Claude" pill on `glass-widgets` is off by default. Opt in per entry with `"pill": true` (upstream text) or your own `"pill": "Made by |Sam"`, or for the whole plan with `npm run fx -- ... --pill`. `kit/fx.cjs` fills `name`/`handle` from the plan's `profile` and refuses plans that leave required copy unset. Optional fields that would show the author's content get neutral values (today's date, the job name). The runner also makes the `glass-widgets` stats card (`chart`) and its other fixed lines configurable. See "Needs your copy" in CATALOG.md for all 31 effects affected.

## Captions and effects

Our caption band sits at about 60 to 78% of the frame height (`kineticY` / `captionY` 1320). Kinetic titles sit behind the presenter at about Y=560. Captions and titles are composited after the effects, so camera moves never zoom or crop them. Each effect is rated in the catalog:

- `safe`: keep captions on.
- `check`: the caption track moves to the top of the frame (Y=330) for that window. Still read a check frame; move the effect (`y`, `pos`) or hide captions if they crowd.
- `off`: captions and titles are hidden automatically for that window (put `"captions": "on"` on the plan entry to override, or `"captions": "off"` on any entry to hide them).

`npm run fx` writes these windows to `build/fxzones.js` and re-renders the caption layer when they change.

Pairing rule: one effect in the caption band at a time, and nothing in the band while a sticker, hero word or CTA caption is up.

## Credits

Effects code: MIT, Copyright (c) 2026 Vibha Ramprakash. Face tracking: OpenCV YuNet (MIT). Person cut-out for the effects pass: MediaPipe Selfie Segmenter (Apache-2.0). The kit's title mask can also use rembg (MIT) with BiRefNet-general-lite weights (MIT, downloaded at first use); see the repo THIRD_PARTY.md. Fonts: Archivo Black, Instrument Serif, Space Mono, Inter, Anton, Montserrat, Playfair Display (SIL OFL 1.1; full text in `licenses/OFL-1.1.txt`) and Permanent Marker (Apache-2.0). These are starter versions of the author's effects.
