---
name: talking-head-ad
description: "Build an AIgent vertical talking-head video ad from HeyGen cinematic takes, real camera footage, or both: cut, brand-guide captions with spray hero words and letter-aligned drips, woosh hits on every cut, a ducked music bed, verified by transcript and frame reads. Use when making or fixing a presenter ad."
---

# Talking-head ad

This is the pipeline behind the AIgent "Awakening" hero ad (Nov 2026). It runs in four stages:

- **Takes.** Use HeyGen cinematic takes, real footage, or a mix of the two.
- **Cut.** Join the takes, with a glitch hit on every seam.
- **Overlay.** A canvas layer adds the captions and cards.
- **Sound.** Two woosh hits sit on the cuts, and the music bed ducks under the voice.

Every version gets checked by re-transcribing it and by reading frames.

All scripts live in `../../kit`. Work in a job folder like this:

```
<job>/
  seg1.mp4 seg2.mp4 ...   (or clips/ from the clip-raw-footage skill)
  build/                  (copy kit/overlay.html, kit/render.mjs, your logo; write captions.js and cut.json here)
```

## 1. Get the takes

**HeyGen cinematic** (`create_video_from_cinematic_avatar`)
- Settings: `seedance_2`, 9:16, 1080p, 12 to 13 s per take. A take costs about 177 credits.
- Prompt for a seated presenter with a slow dolly push-in and a gentle arc, at eye level, with no cuts.
- Write one gesture per line, for example: lean in on the question, open hands on the promise, count on the number, point at camera on the CTA and hold it.
- Put the exact dialogue in quotes, followed by "said once each, no repeated words".
- Save the prompt next to the take. Cinematic videos can't be listed back through the API, so a lost prompt is gone (see `kit/example/cinematic-retake-request.md`).

**Real footage**
- Run the `clip-raw-footage` skill on the raw file, then use its clips as segments.
- A raw file can also go straight into `cut.json`. Add `cropX` to place the face, and `"norm": true` for camera audio.

## 2. Hear every take before you cut

- `TX_MODEL=large-v3 py -3 -I kit/tx.py seg1.mp4 seg2.mp4 seg3.mp4` writes `words.json` and flags repeated words. A HeyGen take said "build, build", and only a large-model pass on the raw take caught it.
- Map speech blocks with `ffmpeg -i take.mp4 -af silencedetect=n=-35dB:d=0.25 -f null -`.
- Whisper word times on cinematic takes run 0.3 to 0.6 s early, so time captions from the silence blocks.

## 3. Cut (`build/cut.json`, then `node ../../kit/assemble.cjs ad-v1.mp4`)

- Start and end each segment inside its silences. Trim dead openings: one take opened on an empty room before the presenter walked in. Hide a whip-in under the seam glitch. Leave about 0.5 s of breath at each seam.
- **Removing a word:** find its edges with high-band (>4 kHz) against low-band (<1 kHz) energy in 10 ms windows, so the next word's "s" or "k" survives.
  - Example: "free school" became "school". "free" is the hiss of "f", then the voiced "ree". The "s" of "school" is the next high-band burst.
  - End the cut at that burst. A cut 0.12 s too long left only "ool".
  - Join the two halves with a 20 ms acrossfade, and put a card pop and an F hit on the jump cut.
- `node ../../kit/timeline.mjs` prints every segment and word on the output clock. Use `--cuts` to print just the seams.
- Schema and examples: `kit/assemble.cjs` header, `kit/example/cut.*.json`.

## 4. Captions (`build/captions.js`, then `node render.mjs <seconds>`)

- Copy `kit/example/captions.awakening-hero.js` and edit the `flips`. Each flip is `{start, end, text, mode}`.
- Modes:
  - 0 caption
  - 1 spray hero word
  - 2 sticker
  - 3 count-up
  - 4 takeover card
  - 5 logo plate
  - 6 CTA sticker
- `end: 99` holds a flip to the end of the video.
- Check a few frames first: `node render.mjs 0 "2.7,13.6,25.9"` writes `stills/`.
- Brand guide (AIgent Plinth):
  - Captions are Hanken Grotesk 400 in `#f1e8dc`.
  - Hero words, stickers and cards are Sofia Sans Extra Condensed caps, weight 760 to 860, tracking -0.01em.
  - `#5cf9e2` is the only cyan. Never use orange, magenta or pure white.
  - Cards are square. Drips fall from the measured bottoms of the letters.
- Keep the caption band at about Y=1300, below the face. Measure the face per take; text never covers it.
- A lone floating word with nothing behind it fails QA.
- Never write copy the offer contradicts. The Skool group is paid, so the ad can't say "free school".

## 5. Sound (in `cut.json`)

- `sfx.F` is the cinematic woosh. Put it on every cut and hidden jump.
- `sfx.D` is the quick woosh. Put it on cards moving in or out.
- Both are Will's picks by ear, and both are CC0. Each sound's measured peak lands on the time you give.
- Never use synthetic noise swooshes; they read as cheap static.
- To choose new sounds, run `node kit/fs.mjs "<query>"` (CC0 only). Build an audition with one 3 s seam clip per candidate and let a human pick by ear. An agent can't hear.
- `bed` is the music. A bed the human has timed starts at 0 with `bedNoFade`. It ducks under the voice automatically. Set `bedVol` about 0.16 for a bed near -13 LUFS, or 0.22 for one near -16.

## 6. Verify every version

- Re-transcribe the whole render. It must match the script word for word with the bed in. Before ducking, hi-hats turned "school" into "pool".
- Read frame strips across every seam and every hidden cut, plus a still of every caption mode.
- Loudness should land at about -14.7 LUFS integrated (`-af ebur128`).
- Number the versions (`name-vN.mp4`) and keep the old ones.
