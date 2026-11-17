# Guide

The depth behind the [README](../README.md) quick start.

## What you get

Record yourself on your phone, drop the file in `inbox/`, and ask Claude (or any coding agent) to make the reel:

- clean clips cut on sentence boundaries, with flubbed retakes flagged and skipped, and the best take of each sentence picked when you record several takes
- tight cuts with a glitch seam and a 10% zoom punch on every cut, a bigger punch after the hook and into the payoff, and a few sounds on the key cuts only
- every spoken word animated (kinetic type, key words bigger in the accent colour), drafted from the transcript, in a theme and font pairing you pick
- one kinetic title per beat, in front of you by default, or behind your head when you choose (the person is cut out with a segmentation mask)
- a music bed from the library (`kit/music/`, 11 tracks, [CC0 1.0](../kit/music/LICENSE.md)) or your own track, ducked under the voice
- a numbered version (`reel-v1.mp4`, `reel-v2.mp4`, ...) every time you rebuild

HeyGen cinematic takes are an optional second source; they cut in the same way as phone clips.

Agents must offer the menu of finishes, looks, caption styles, fonts, themes, title entrances, transitions, 51 effects, SFX, music beds and brand presets before drafting and again before the final render, suggest 2 or 3 options per category, and vary finishes across scenes rather than one look on the whole reel.

## Phone clip to reel, in detail

1. **Install once** (see [Install](../README.md#install)), then check it works: `npm run smoke` should end with `SMOKE PASS`.
2. **Record** on your phone, upright (9:16) or sideways (it gets cropped to the centre). Say each line once; if you flub, pause and say the whole sentence again. The clipper keeps the last take.
3. **Drop** the file into `inbox/`.
4. **Make the reel.** Either ask your agent:

   > Make a reel from the newest clip in my inbox.

   or run it yourself:

   ```
   npm run reel                          # newest video in inbox/, AIgent theme
   npm run reel -- inbox/my-take.mov --theme neutral --cropx 0.4 --bed vinyl-sunrise --bed-start 0
   npm run reel -- inbox/my-take.mov --bed vinyl-sunrise --finish grain,vignette
   npm run music                         # list the music beds
   npm run reel -- inbox/take1.mov inbox/take2.mov --hook take2.mov --fonts druk
   ```

   Several takes of the same script? Drop them all in. `npm run reel` with no path uses every video from the newest recording session (files within 2 hours of the newest; `--newest` for just one), lines up the sentences across takes and keeps the best take of each. `--hook <file>` forces the first sentence from one take, for example the one you shot from your most extreme angle.

5. **Verify**: `npm run verify -- <clip-name>` checks size, frame rate, codecs, loudness, the person mask and the copy, and writes stills of every title plus a contact sheet to `jobs/<clip-name>/verify/`. Look at the contact sheet before you share the reel.
6. **Review** `jobs/<clip-name>/reel-v1.mp4`. To change anything, edit `jobs/<clip-name>/build/captions.js` (words, timing, hero words, stickers) or `build/cut.json` (which clips, trims), then `npm run reel -- --rebuild --name <clip-name>`.

The first run downloads the Whisper model (small.en, about 0.5 GB). Pass `--model large-v3` (about 3 GB) for the most accurate pass. Your footage, `jobs/` and `.env*` files are gitignored.

## Effects (optional)

After the reel is made, ask your agent to "add effects". It reads the transcript, finds the hook, claims, numbers, lists and CTA, and offers 2 or 3 effects for each from a menu of 51 (spotlight, backdrop word, checklist, glass graph, stamps, countdowns and more). Then it renders `jobs/<clip-name>/reel-fx-v1.mp4`, with your captions kept on top and the same audio.

```
npm run effects:setup                                     # once: Python venv with OpenCV + MediaPipe (~150 MB) and rembg + onnxruntime (~390 MB more, for the BiRefNet mask)
npm run effects:setup -- --birefnet                       # also download birefnet-general-lite (~214 MB) into rembg's cache
npm run fx -- --list                                      # the menu, by moment
npm run fx -- --name <clip-name> --plan fx.json --still 1.2,6.5   # check frames
npm run fx -- --name <clip-name> --plan fx.json           # render
```

The effects come from [claude-video-effects](https://github.com/Vibha-Ramprakash/claude-video-effects) by Vibha Ramprakash (MIT), vendored at a pinned commit. See [effects/README.md](../effects/README.md) for the catalog, the caption-safety rule and `npm run effects:update`. Labelled stills for every effect are in the [contact sheet](../showcase/sheets/effects.jpg) and the [gallery](../showcase/GALLERY.md).

## Looks, caption styles and fonts

`--look` picks the whole edit (`kinetic` default, `oneword`, `muse`, `classic`, `one-word`); `--style`, `--fonts`, `--no-titles`, `--title-layer front|behind|auto`, `--no-punch`, `--no-mask` and `--mask birefnet|birefnet-portrait|mediapipe` override single parts. `oneword` is the full one-word-at-a-time look (type cards, cycling pairings, kit/looks/oneword.md); `--style one-word` is the simple version, one big word at a time. The same `--mask` on `npm run fx` (or `"maskModel"` in `cut.json`) gives the effects that cut-out too.

| Look | Captions | Titles | Notes |
|---|---|---|---|
| `kinetic` (default) | `kinetic`: every phrase is a two-font lockup, the hero word slamming in big in the display face and the other words writing or rising in, each on its own word time, in the partner face | one per beat, in front by default | |
| `muse` | `pill`: 3 to 5 words in a lower-third pill | one per beat, in front by default | |
| `classic` | the original phrase captions + spray-painted hero word | none | the pre-1.2 look |

Caption styles: `kinetic` (font lockups), `pill`, `hormozi` (bold caps with a cyan active word), `karaoke` (colour wipe as each word is said), `classic`. Set `"captionStyle"` in `captions.js` to change one job.

Titles use 8 entrances (stagger rise, slam, blur rise, slide left, elastic, flip, pop zoom, drop), never the same one twice in a video, with a flicker only on the hook and the payoff. Set them by hand as mode 7 flips in `captions.js` (`"entrance"` to pick one, `"hero"` for the big word, `"layer": "front"|"behind"|"auto"` for whether the hero word sits in front or behind the head), or leave them to `autocaption.mjs --titles`. The job default is in front (`"titleLayer": "front"`). Auto puts only the strongest 1 or 2 punch titles behind, never consecutive ones. Titles rest high so the word stays readable (`"titleY"`, default 345); a behind slam lands lower, then rises to that height (`"titleSlamY"`, default 600; `"titleRise": false` to skip the rise). The smaller partner words of a behind title draw in front of the person. The person mask that puts those titles behind the head is `kit/mask.py`. MediaPipe is the default (fast). For a final reel, `--mask birefnet` (or `"maskModel": "birefnet"` in `cut.json`) uses rembg with birefnet-general-lite: slower on CPU (several seconds per title frame) but much tighter on hair and hands. Optional `"person": "person.mkv"` writes an edge-decontaminated person layer.

**`--look oneword`** is the high bar: one word on screen at a time, each word's size and face picked by its role (small filler, body words, a big italic-serif hero with the rest of the phrase building under it), flat-colour type cards cutting in as text-only b-roll, a key word as a title on the first and last beat (in front by default, or behind the head), and, with `--broll <folder>`, cutaways to your own clips while the voice runs on. Rules and numbers: [kit/looks/oneword.md](../kit/looks/oneword.md).

Font pairings (`--fonts`, or `"fonts"` in `captions.js`): `theme` (default), `modern`, `druk`, `elegant`, `editorial`, plus `literata`, `bricolage`, `pirata`, `michroma`, `redhat`, `jakarta`, `grotesk-times`, `avantgarde`, `recoleta`, `haas`, `wabbit`, `instrument` (see [kit/fonts/README.md](../kit/fonts/README.md)). List several to cycle them, one pairing per title: `--fonts literata,bricolage,michroma`. A pairing is two faces set together: every title and kinetic line is a lockup with the hero word big in the display face and the rest of the phrase in the partner face (script or sans/serif) beside, under or across it. `"hero"` on a phrase picks the hero word. All shipped fonts are SIL OFL Google Fonts; your own licensed fonts go in `kit/fonts/local/` (gitignored). See [kit/fonts/README.md](../kit/fonts/README.md).

Words and titles stay out of the way of effects: where an effect's catalog entry says `captions: off` they hide, and where it says `check` the caption track moves to the top of the frame.

## Edit rules

These are defaults in `cut.json`; `npm run check -- <job>` flags anything that breaks them.

- **Zoom punch.** `"punch": 0.1` scales every other segment 10% so each cut lands as a jump; `false` turns it off. `"bigPunch": true` on a segment eases in another 12% over 0.3 s; `npm run reel` puts it on the cut after the hook and the cut into the payoff. `"zoom"` and `"punchY"` per segment override the amount and the vertical centre.
- **Transitions.** The glitch seam stays the default. `"transition": "crossfade"` on a segment (or at the top level for all of them) uses an ffmpeg xfade instead; `"transitionDur"` sets the length. The 56 names (crossfade, dip, flash, whip, iris, zoom, pixelate, ...) are in `kit/transitions.json` and `effects/CATALOG.md`. Six are drawn by the kit as xfade expressions (`kit/xfx.cjs`): `slats`, `checkerboard` (in the theme accent), `light-leak`, `zoom-blur`, `news-ribbon` and its alias `breaking-news`.
- **Sounds.** Fewer and deeper. The locked cut-seam set is `whoosh`, `swipe`, `boom`, `click`, `typing` (mono 48 kHz WAV, CC0), used as `"sfx": {"whoosh": [3.2], "boom": [[12.4, 0.55]]}`. Never a sound on every cut, and the key moment (the payoff) gets the loudest one. A 31-sound cinematic pack in `kit/sfx/` (see `kit/sfx/sfx.json`) is auto-picked on `npm run fx` for each effect hit: category mapping, no-repeat rotation, the hit point aligned to the effect, risers ending on the hit, releases after heavy hits, ducked under the voice. Override per effect with `"sfx": "01-cinematic-hit-a"` or `"sfx": false`, or turn the pack off with `--sfx off`. You still pick sounds by ear.
- **Beat-sync.** When a bed is set, `kit/beats.py` analyses it from `bedStart` for the reel length and writes `build/beat-grid.json` (tempo, beats, onsets, energy, strong drops). `"beatSync": true` (the default with a bed; `--no-beat-sync` or `"beatSync": false` to turn it off) snaps zoom punches, SFX, fx hit points and title entrances to the nearest beat or onset within 120 ms (`"beatWindow"`), and adds a short camera shake on strong drops, at most two per shot. Speech cuts and lip sync do not move. Needs `librosa` (`pip install -r requirements.txt`).
- **Film finish.** `"finish": "grain"` (or a list, or `{ "grain": { "intensity": 0.4 } }`) applies an ffmpeg look to the picture, before titles and captions, so the type stays clean. Names: `grain`, `vignette`, `chroma`, `scan-lines`, `warm`, `cool`, `teal`, `crushed`, `mono`, `bleach`. Set it on the whole cut or on one segment. No LUT files or light-leak overlays. `--finish grain,vignette` on `npm run reel`.
- **Copy.** No em or en dashes, no "not X, but Y", no staged run-ups ("Here's the thing:"), no dramatic closers, no hype words. `npm run check` lints the captions, titles and card copy.
- **Script shape.** A hook, one reveal per beat, a payoff: 40 to 55 words, 15 to 20 s. Over 25 s, cut a middle sentence.

## Themes

The look of the captions lives in a theme file: colours, fonts, an optional web-font stylesheet and an optional logo.

| Theme | Look |
|---|---|
| `kit/themes/aigent.js` | Default. AIgent brand guide: cyan `#5cf9e2`, Hanken Grotesk and Sofia Sans Extra Condensed (Google Fonts). |
| `kit/themes/neutral.js` | Unbranded opt-out (`--theme neutral`). White captions, yellow accent, system fonts, no logo, works offline. |

The default is AIgent. Pass `--theme neutral` (or `THEME=neutral` for `render.mjs`) for an unbranded offline look, or add your own `kit/themes/<yours>.js`. The chosen file is copied into the job as `build/theme.js`, so you can edit colours for one job. A `"theme": {...}` block in `captions.js` overrides single fields, and `"logo": "file.svg"` there puts a logo on the logo-plate flips.

## Step by step (manual control)

`npm run reel` chains these. Run them yourself when you need finer control, or when mixing in HeyGen takes:

```
python3 kit/clip.py raw.mov --out clips --vertical  # 1. clips + clips.md + clips-sheet.png; pick the keepers
mkdir build && cd build                             # 2. job folder
cp ../kit/example/cut.real-footage.json cut.json    #    then edit the segs
python3 ../kit/tx.py ../seg1.mp4                    #    words.json for takes that didn't come from clip.py
node ../kit/timeline.mjs                            # 3. every word on the output clock
node ../kit/autocaption.mjs --out captions.js       # 4. draft captions from the word times, then hand-edit
node ../kit/render.mjs 0 "2.5,10,20"                # 5. caption stills first (copies overlay.html + theme.js in)
node ../kit/render.mjs 36.4                         #    full overlay frames
node ../kit/assemble.cjs ad-v1.mp4                  # 6. the cut
```

Hand-written `captions.js` still works exactly as before: skip step 4 and copy `kit/example/captions.awakening-hero.js` instead. Two skills sit on this kit:

| Skill | Use it when |
|---|---|
| [`skills/talking-head-ad`](../skills/talking-head-ad/SKILL.md) | You want the reel: phone clips (main path), HeyGen takes (optional), or both |
| [`skills/clip-raw-footage`](../skills/clip-raw-footage/SKILL.md) | You only want a long raw recording cut into clean, transcribed clips |

Agents: start at [AGENTS.md](../AGENTS.md).

## What's in the kit

| File | Does |
|---|---|
| `kit/reel.cjs` | `npm run reel`: inbox clip (or several takes) to draft reel in one command (clip, cut, captions, check, render, mask, assemble), plus `--draft` and `--rebuild`. |
| `kit/reelmd.cjs` | `npm run reelmd -- check\|compile\|export\|package`: Reel.md recipes ([spec](reel-md.md)), applied by `npm run reel -- --recipe`. Examples in `examples/recipes/`. |
| `kit/teardown.mjs`, `kit/videomd2reel.cjs`, `kit/teardown.py`, `kit/ig_fetch.py` | `npm run teardown -- <file>`: rea-video breakdown to Reel.md, report and contact sheet; built-in fallback analyzer the front/behind and vignette extras, and the optional single-post Instagram fetch ([docs](teardown.md)). |
| `INSTALL.md`, `skills/` | One-line agent install, and skills for `npx skills add wrg32786/aigent-talking-head`. |
| `kit/autocaption.mjs` | Drafts `captions.js` from Whisper word times (`words.json` or `clips.json`), in any caption style, with `--titles`. Never overwrites without `--force`. |
| `kit/check.mjs` | `npm run check [job]`: copy lint, titles, transitions, sounds, punches and script shape. |
| `kit/verify.mjs` | `npm run verify -- <job>`: ffprobe, loudness, title and punch stills, contact sheet, mask alpha, copy lint. Run it before every delivery. |
| `kit/rules.cjs` | The shared edit rules: sounds, entrances, punch amounts, transitions, copy lint, script shape. |
| `kit/mask.py` | Person mask for titles-behind-the-head. `--model birefnet` (rembg birefnet-general-lite, quality, weights downloaded on first use) or `--model mediapipe` (fast fallback). `kit/mask_refine.py` is the shared cleanup. |
| `kit/fonts/`, `kit/fonts.mjs` | Font pairings, their licence files and example stills (`npm run fonts:examples`). |
| `kit/transitions.json` | Transition names mapped to ffmpeg xfade modes. |
| `kit/themes/` | Theme presets: `aigent.js` (default) and `neutral.js`. |
| `kit/chrome.mjs` | Finds Chrome on Mac, Linux or Windows; `CHROME_PATH` overrides. |
| `kit/smoke.mjs` | `npm run smoke`: synthetic end-to-end test (includes the effects pass once `npm run effects:setup` has run). |
| `kit/fx.cjs` | `npm run fx`: the effects pass over a job's reel (check frames, render, captions kept on top). |
| `effects/` | Effect catalog, vendored claude-video-effects, setup, update and check scripts. |
| `kit/clip.py` | Raw footage (one file or several takes) to sentence clips. Best take per sentence, retakes flagged, ends set from the audio, voice at -16 LUFS, optional vertical crop, contact sheet. |
| `kit/tx.py` | Word timings for each take; flags repeated words. |
| `kit/timeline.mjs` | Maps segment word times onto the output clock and prints the seams. |
| `kit/overlay.html` | Caption layer, driven by `captions.js` and styled by `theme.js`. |
| `kit/render.mjs` | Renders the overlay to PNG frames (24 fps) or to stills. Run it from `build/`. |
| `kit/assemble.cjs` | The cut. Any number of segments from any source, cover-cropped to 1080x1920, zoom punch, glitch seams or named transitions, titles behind the person, overlay, locked-set and pack sounds (both ducked under the voice), ducked bed, -14 LUFS. |
| `kit/sfx-plan.cjs` | Pack manifest, validation, and effect-hit auto-pick. |
| `kit/fs.mjs` | Freesound search, CC0 only. |
| `kit/sfx/` | Locked cut-seam set (WAV + legacy woosh MP3s) and the 31-sound cinematic pack (`sfx.json`). |
| `kit/music/` | Our music beds (MP3, all at -13 LUFS) and `beds.json`. `npm run music` lists them, `npm run music:add -- <file>` adds one. See [kit/music/README.md](../kit/music/README.md). |
| `kit/example/` | The Awakening ad's real `cut.json` and `captions.js`, a real-footage cut, the HeyGen retake prompt, and the Skool mark used only by that ad. `demo-reel/` holds a finished reel, a before/after loop, and the plan files that built it. |
| `showcase/` | Labelled contact sheets, a [full gallery](../showcase/GALLERY.md), and [index.html](../showcase/index.html) (open from a full clone or zip). `npm run showcase` rebuilds them. |

## Rules the pipeline carries

- No clip of about 3 s or less. No dead air at the head of a clip. Never start a clip mid-sentence.
- Listen for repeated words in every raw take before cutting. Cut words at fricative edges so the next word survives.
- Text never covers the presenter's face. A lone floating word with nothing behind it is a fail.
- Use only the theme's faces and colours. On the AIgent theme the one cyan is `#5cf9e2`. Cards are square.
- Only real sounds, picked by a human ear. An agent can't judge audio, so give the human an audition.
- Re-transcribe the full render with the music in. It must match the script.
- `npm run verify` passes and someone has looked at the contact sheet before the reel goes out.

## Brand presets

A preset is a saved mix of theme, look, caption style, fonts, finishes (including a per-scene variety pool), transitions, effect favourites, and optional bed or SFX prefs.

Shipped styles, all built from existing options: `aigent` (default), `one-word` (one big word at a time, punchy), `hormozi-bold`, `karaoke`, `minimal-clean`, `cinematic`, `editorial`, `muse-pill`, `retro-scan-lines`, and `neutral`. Each has a labelled tile in the [presets sheet](../showcase/sheets/presets.jpg) and appears in `npm run menu`.

```
npm run preset -- --list
npm run reel -- inbox/take.mov --preset one-word
npm run reel -- inbox/take.mov --preset auto          # picks one and prints what it chose
npm run reel -- inbox/take.mov --preset cinematic --finish grain   # any flag wins over the preset
npm run preset -- --save my-style --from <job>        # user-saved, gitignored under kit/presets/local/
npm run brand:import -- brand-guide/guide.pdf         # optional; draft preset for the human to confirm
```

Three modes: use a saved preset, customize (flags and `cut.json` fields override the preset), or let the agent choose (`--preset auto`). A brand guide (PDF, image or markdown) is optional; drop it in `brand-guide/` or pass the file. Import extracts a colour palette, named fonts (mapped to shipped OFL pairings or `kit/fonts/local/`), tone notes, and a nearby logo if there is one. If `pdftoppm` or `pdftotext` are missing, the command says so and still accepts images and markdown.
