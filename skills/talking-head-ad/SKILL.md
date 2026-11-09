---
name: talking-head-ad
description: "Turn a teammate's phone recording (dropped in inbox/) into a vertical 9:16 talking-head reel: clean cuts with retakes skipped, themed captions drafted from the transcript, woosh hits on every cut, a ducked music bed, verified by transcript and frame reads. HeyGen cinematic takes are an optional extra source. Use when someone says 'make a reel from my clip' or is making or fixing a presenter ad."
---

# Talking-head ad

The main path: a teammate records on their phone, drops the file in `inbox/`, and you turn it into a reel. It runs in four stages:

- **Clips.** Whisper transcribes the recording, splits it into sentences and flags flubbed retakes.
- **Cut.** The keep clips are joined, with a glitch hit and a woosh on every seam.
- **Overlay.** A canvas layer adds captions and cards, styled by a theme.
- **Sound.** The music bed, if any, ducks under the voice.

Every version gets checked by re-transcribing it and by reading frames. All scripts live in `../../kit`.

## Phone clip to reel (start here)

1. Find the clip: the newest video in `inbox/`, or the file the teammate names. If the inbox is empty, ask them to drop it in.
2. Ask which theme if they haven't said: `neutral` (default) or `aigent` (AIgent brand only), or their own `kit/themes/<name>.js`. Ask for a music file if they want one.
3. Draft it: `npm run reel -- inbox/<file> --theme <name> [--bed music.wav] [--cropx 0.4] --draft`
   - `--cropx` moves the 9:16 crop for a sideways clip (0 left, 0.5 centre, 1 right). Read `jobs/<name>/clips/clips-sheet.png` to check the face is in frame.
   - `--model medium.en` is faster than the default large-v3 for a first pass.
4. Read `jobs/<name>/clips/clips.md`. `npm run reel` already dropped every `retake` row. Remove slates and asides ("Okay, take two...") from `build/cut.json`, and trim the `out` of clips that end mid-move.
5. Edit `build/captions.js`. It's a draft of plain captions with the last phrase before each seam made a spray hero word. Turn key words into stickers (mode 2), add a count-up, card or CTA (see step 4 below), and fix any misheard words against what the teammate said.
6. Build it: `npm run reel -- --rebuild --name <name>` writes `jobs/<name>/reel-vN.mp4`, a new number each time.
7. Verify (step 6 below), then hand over the reel path. Offer the effects pass (next section) if they want more motion.

Leave out `--draft` to go straight to `reel-v1.mp4` in one command. The draft step is better when someone will watch it.

## Pick effects (optional second pass)

After the reel is cut and captioned, you can add effects from [`effects/CATALOG.md`](../../effects/CATALOG.md) (51 starter effects by Vibha Ramprakash; machine-readable in `effects/catalog.json`). Set up once with `npm run effects:setup`.

1. **Read the transcript** (`jobs/<name>/build/captions.js` or `clips/clips.md`) and mark the moments with output-clock times: hook (first 2 s), key claims, numbers or proof, lists or steps, reveals, objections ("but", "no", "stop"), and the CTA. Note the energy of each part (calm, medium, high) from the delivery and the words.
2. **Tell the user what's available**, briefly: the moments you found, and for each one 2 or 3 effect options from the catalog that fit the moment and its energy, with a one-line "what it does". Offer a menu preset if one fits (below). Ask them to pick, or to say "you choose".
3. **Build the plan**: 3 to 6 effects. A hook effect in the first 2 s, a CTA effect at the end, and no more than one `high` effect every 5 s. Use each effect's typical duration. Put real copy and numbers in every required option (ask for numbers; never invent them). The "Needs your copy" table in `effects/CATALOG.md` (and `required` / `requiredIf` / `fromProfile` in `catalog.json`) lists what each effect needs. Pull headlines, labels and stats from the transcript where you can. 31 effects ship with the upstream author's brand, handle or demo stats as defaults, and `npm run fx` refuses the plan until you replace them. `glass-widgets`, for example, needs `title`, `text` (the big number), `sub` and `chart` (`label::value::bar|values`); its calendar and "now editing" lines fill in with today's date and the job name. Put the teammate's name and handle in `"profile"`. The "Edited by Claude" pill on `glass-widgets` stays off unless the user asks for it: then add `"pill": true` (or their own text, `"pill": "Made by |Sam"`) to that entry, or pass `--pill`. Save it as `jobs/<name>/fx.json`:
   ```json
   {"profile": {"name": "Sam", "handle": "@sam.makes"},
    "effects": [{"fx": "lean-in", "start": 0.3, "end": 1.2},
                {"fx": "checklist", "start": 6.0, "end": 10.0, "text": "Record::on your phone|Drop::in inbox|Ask::for the reel", "title": "Your workflow"},
                {"fx": "countdown-flip", "start": 18.5, "end": 21.5}]}
   ```
4. **Captions.** Effects rated `off` hide captions for their window automatically, `check` ones need a look, and `safe` ones keep captions on. Only one effect in the caption band at a time, and none while a sticker, hero word or CTA caption is up.
5. **Check, then render.** `npm run fx -- --name <name> --plan jobs/<name>/fx.json --still <middle of each effect>`; read every PNG in `build/fx/` (face covered? text cut off? captions crowded?). Fix the plan, then run without `--still` to get `jobs/<name>/reel-fx-vN.mp4`. The audio is exactly the reel's.
6. Fix the notes the command prints (pacing, durations, missing copy) before you hand it over. `--allow-demo-copy` only fills neutral `[placeholders]` for a quick look; never ship that.

**Effects menu presets** (offer one when the user doesn't know what they want):
- **Calm explainer**: `dot-reveal` or `backdrop-word` on the hook, `todo` or `apple-toggles` on the list, `slow-push` on the key claim, `led-sign` on the CTA.
- **Punchy hook**: `lean-in` or `backdrop-word` on the hook, `reject-stamp` or `huge-strike` on the objection, `match-cut` on the reveal, `countdown-flip` or `comment-box` on the CTA.
- **Product demo**: `locked-on` on the hook, `checklist` or `the-bill` on the steps, `liquid-glass-graph` or `over-the-shoulder-zoom` on the numbers, `tap` on the CTA.
- **Social proof**: `cover-star` or `orbit` on the hook, `headline-wall`, `profile-wall` or `messages` on the proof, `pastel-word` or `tap` on the CTA.
- **Cinematic minimal**: `spotlight` on the hook, `slow-push` on the claim, `moody` or `timeline` between sections.

Effects need a face in frame for anything marked `face`. A grade (`moody`, `swipe`) or `dot-reveal` works without one. These are starter versions of the author's effects; say so if the user compares them to a reel they saw.

## Manual pipeline

Use this when mixing sources or when you need finer control. Work in a job folder:

```
<job>/
  seg1.mp4 seg2.mp4 ...   (or clips/ from the clip-raw-footage skill)
  build/                  (write captions.js and cut.json here; render.mjs copies in overlay.html and theme.js)
```

## 1. Get the takes

**Phone or camera footage (main path)**
- Run the `clip-raw-footage` skill on the raw file, then use its clips as segments.
- A raw file can also go straight into `cut.json`. Add `cropX` to place the face, and `"norm": true` for camera audio.

**Optional: HeyGen takes** (`create_video_from_cinematic_avatar`; needs a HeyGen account)
- Settings: `seedance_2`, 9:16, 1080p, 12 to 13 s per take. A take costs about 177 credits.
- Prompt for a seated presenter with a slow dolly push-in and a gentle arc, at eye level, with no cuts.
- Write one gesture per line, for example: lean in on the question, open hands on the promise, count on the number, point at camera on the CTA and hold it.
- Put the exact dialogue in quotes, followed by "said once each, no repeated words".
- Save the prompt next to the take. Cinematic videos can't be listed back through the API, so a lost prompt is gone (see `kit/example/cinematic-retake-request.md`).

## 2. Hear every take before you cut

- `TX_MODEL=large-v3 python3 kit/tx.py seg1.mp4 seg2.mp4 seg3.mp4` (Windows: `py -3 kit/tx.py ...`) writes `words.json` and flags repeated words. A HeyGen take said "build, build", and only a large-model pass on the raw take caught it.
- Map speech blocks with `ffmpeg -i take.mp4 -af silencedetect=n=-35dB:d=0.25 -f null -`.
- Whisper word times on HeyGen cinematic takes run 0.3 to 0.6 s early, so time captions from the silence blocks (or pass `--shift 0.4` to `autocaption.mjs`).

## 3. Cut (`build/cut.json`, then `node ../../kit/assemble.cjs ad-v1.mp4` from `build/`)

- Start and end each segment inside its silences. Trim dead openings: one take opened on an empty room before the presenter walked in. Hide a whip-in under the seam glitch. Leave about 0.5 s of breath at each seam.
- **Removing a word:** find its edges with high-band (>4 kHz) against low-band (<1 kHz) energy in 10 ms windows, so the next word's "s" or "k" survives.
  - Example: "free school" became "school". "free" is the hiss of "f", then the voiced "ree". The "s" of "school" is the next high-band burst.
  - End the cut at that burst. A cut 0.12 s too long left only "ool".
  - Join the two halves with a 20 ms acrossfade, and put a card pop and an F hit on the jump cut.
- `node ../../kit/timeline.mjs` prints every segment and word on the output clock. Use `--cuts` to print just the seams.
- Schema and examples: `kit/assemble.cjs` header, `kit/example/cut.*.json`.

## 4. Captions (`build/captions.js`, then `node ../../kit/render.mjs <seconds>` from `build/`)

- Draft them: `node ../../kit/autocaption.mjs --out captions.js [--hero] [--shift 0.4]` reads `words.json` (from `tx.py`) or the clips' `clips.json` and writes timed plain captions. Or copy `kit/example/captions.awakening-hero.js` and write them by hand. Either way, edit the `flips`. Each flip is `{start, end, text, mode}`.
- Modes:
  - 0 caption
  - 1 spray hero word
  - 2 sticker
  - 3 count-up
  - 4 takeover card
  - 5 logo plate
  - 6 CTA sticker
- `end: 99` holds a flip to the end of the video.
- Check a few frames first: `node ../../kit/render.mjs 0 "2.7,13.6,25.9"` writes `stills/`.
- **Theme.** `build/theme.js` sets colours, fonts and logo. `render.mjs` copies `kit/themes/neutral.js` there if it's missing (`THEME=aigent` picks the AIgent preset). Edit it per job, or add `"theme": {...}` overrides in `captions.js`. A logo plate (mode 5) needs `"logo": "file.svg"` in `captions.js` (file in `build/`) or `theme.logo`; without one, mode 5 draws nothing.
- AIgent theme rules (AIgent jobs only):
  - Captions are Hanken Grotesk 400 in `#f1e8dc`.
  - Hero words, stickers and cards are Sofia Sans Extra Condensed caps, weight 760 to 860, tracking -0.01em.
  - `#5cf9e2` is the only cyan. Never use orange, magenta or pure white.
  - Cards are square. Drips fall from the measured bottoms of the letters.
- Keep the caption band at about Y=1300, below the face. Measure the face per take; text never covers it.
- A lone floating word with nothing behind it fails QA.
- Never write copy the offer contradicts. The Skool group is paid, so the ad can't say "free school".
- The Skool mark (`kit/example/skool-logo.svg`) is only for The AIgent's own Skool group. Never use it for another brand.

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
