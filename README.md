# aigent-talking-head

Turn a phone recording into a finished 9:16 reel. Record yourself on your phone, drop the file in `inbox/`, and ask Claude (or any coding agent) to make the reel. You get:

- clean clips cut on sentence boundaries, with flubbed retakes flagged and skipped, and the best take of each sentence picked when you record several takes
- tight cuts with a glitch seam and a 10% zoom punch on every cut, a bigger punch after the hook and into the payoff, and a few sounds on the key cuts only
- every spoken word animated (kinetic type, key words bigger in the accent colour), drafted from the transcript, in a theme and font pairing you pick
- one kinetic title per beat, behind your head (the person is cut out with a segmentation mask)
- your music bed, ducked under the voice, if you add one
- a numbered version (`reel-v1.mp4`, `reel-v2.mp4`, ...) every time you rebuild

HeyGen cinematic takes are an optional second source; they cut in the same way as phone clips.

## Quick start: phone clip to reel

1. **Install once** (see [Install](#install)), then check it works: `npm run smoke` should end with `SMOKE PASS`.
2. **Record** on your phone, upright (9:16) or sideways (it gets cropped to the centre). Say each line once; if you flub, pause and say the whole sentence again. The clipper keeps the last take.
3. **Drop** the file into `inbox/`.
4. **Make the reel.** Either ask your agent:

   > Make a reel from the newest clip in my inbox.

   or run it yourself:

   ```
   npm run reel                          # newest video in inbox/, neutral theme
   npm run reel -- inbox/my-take.mov --theme aigent --cropx 0.4 --bed music.wav --bed-start 0
   npm run reel -- inbox/take1.mov inbox/take2.mov --hook take2.mov --fonts druk
   ```

   Several takes of the same script? Drop them all in. `npm run reel` with no path uses every video from the newest recording session (files within 2 hours of the newest; `--newest` for just one), lines up the sentences across takes and keeps the best take of each. `--hook <file>` forces the first sentence from one take, for example the one you shot from your most extreme angle.

5. **Verify**: `npm run verify -- <clip-name>` checks size, frame rate, codecs, loudness, the person mask and the copy, and writes stills of every title plus a contact sheet to `jobs/<clip-name>/verify/`. Look at the contact sheet before you share the reel.
6. **Review** `jobs/<clip-name>/reel-v1.mp4`. To change anything, edit `jobs/<clip-name>/build/captions.js` (words, timing, hero words, stickers) or `build/cut.json` (which clips, trims), then `npm run reel -- --rebuild --name <clip-name>`.

The first run downloads the Whisper model (large-v3, about 3 GB). Pass `--model medium.en` for a faster, smaller first pass. Your footage, `jobs/` and `.env*` files are gitignored.

## Effects (optional)

After the reel is made, ask your agent to "add effects". It reads the transcript, finds the hook, claims, numbers, lists and CTA, and offers 2 or 3 effects for each from a menu of 51 (spotlight, backdrop word, checklist, glass graph, stamps, countdowns and more). Then it renders `jobs/<clip-name>/reel-fx-v1.mp4`, with your captions kept on top and the same audio.

```
npm run effects:setup                                     # once: Python venv with OpenCV + MediaPipe (~150 MB) and rembg + onnxruntime (~390 MB more, for the BiRefNet mask)
npm run effects:setup -- --birefnet                       # also download birefnet-general-lite (~214 MB) into rembg's cache
npm run fx -- --list                                      # the menu, by moment
npm run fx -- --name <clip-name> --plan fx.json --still 1.2,6.5   # check frames
npm run fx -- --name <clip-name> --plan fx.json           # render
```

The effects come from [claude-video-effects](https://github.com/Vibha-Ramprakash/claude-video-effects) by Vibha Ramprakash (MIT), vendored at a pinned commit. See [effects/README.md](effects/README.md) for the catalog, the caption-safety rule and `npm run effects:update`.

## Install

| Need | Mac | Linux | Windows |
|---|---|---|---|
| Node 18+ | `brew install node` | your package manager or nodejs.org | nodejs.org installer |
| ffmpeg + ffprobe | `brew install ffmpeg` | `sudo apt install ffmpeg` | `winget install ffmpeg` |
| Python 3.9+ | `brew install python` | usually installed | python.org installer (gives `py`) |
| Chrome or Chromium | google.com/chrome | `google-chrome` or `chromium` package | google.com/chrome |

Then, in the repo folder:

```
npm install
python3 -m pip install -r requirements.txt      # Windows: py -3 -m pip install -r requirements.txt
npm run chrome                                  # prints the Chrome it found
npm run smoke                                   # synthetic clips end to end, several minutes, no footage or keys needed
npm run check                                   # copy lint self-test over the examples
```

Chrome is found automatically in the usual Mac, Linux and Windows install paths or on PATH. Set `CHROME_PATH` to use a different one. Set `PYTHON` if your Python isn't `python3` (or `py` on Windows). `npm run smoke:whisper` also runs a tiny Whisper model.

Optional: a HeyGen account with Cinematic Avatar if you generate takes, and `FREESOUND_API_KEY` if you search for new sounds.

## Looks, caption styles and fonts

`--look` picks the whole edit; `--style`, `--fonts`, `--no-titles`, `--no-punch`, `--no-mask` and `--mask birefnet|mediapipe` override single parts.

| Look | Captions | Titles | Notes |
|---|---|---|---|
| `kinetic` (default) | `kinetic`: every phrase is a two-font lockup, the hero word slamming in big in the display face and the other words writing or rising in, each on its own word time, in the partner face | one per beat, behind the head | |
| `muse` | `pill`: 3 to 5 words in a lower-third pill | one per beat, behind the head | |
| `classic` | the original phrase captions + spray-painted hero word | none | the pre-1.2 look |

Caption styles: `kinetic` (font lockups), `pill`, `hormozi` (bold caps with a cyan active word), `karaoke` (colour wipe as each word is said), `classic`. Set `"captionStyle"` in `captions.js` to change one job.

Titles use 7 entrances (stagger rise, slam, blur rise, slide left, elastic, flip, pop zoom), never the same one twice in a video, with a flicker only on the hook and the payoff. Set them by hand as mode 7 flips in `captions.js` (`"entrance"` to pick one, `"hero"` for the big word), or leave them to `autocaption.mjs --titles`. The person mask that puts those titles behind the head is `kit/mask.py`. MediaPipe is the default (fast). For a final reel, `--mask birefnet` (or `"maskModel": "birefnet"` in `cut.json`) uses rembg with birefnet-general-lite: slower on CPU (several seconds per title frame) but much tighter on hair and hands. Optional `"person": "person.mkv"` writes an edge-decontaminated person layer.

Font pairings (`--fonts`, or `"fonts"` in `captions.js`): `theme` (default), `modern`, `druk`, `elegant`, `editorial`. A pairing is two faces set together: every title and kinetic line is a lockup with the hero word big in the display face and the rest of the phrase in the partner face (script or sans/serif) beside, under or across it. `"hero"` on a phrase picks the hero word. All shipped fonts are SIL OFL Google Fonts; your own licensed fonts go in `kit/fonts/local/` (gitignored). See [kit/fonts/README.md](kit/fonts/README.md).

Words and titles stay out of the way of effects: where an effect's catalog entry says `captions: off` they hide, and where it says `check` the caption track moves to the top of the frame.

## Edit rules

These are defaults in `cut.json`; `npm run check -- <job>` flags anything that breaks them.

- **Zoom punch.** `"punch": 0.1` scales every other segment 10% so each cut lands as a jump; `false` turns it off. `"bigPunch": true` on a segment eases in another 12% over 0.3 s; `npm run reel` puts it on the cut after the hook and the cut into the payoff. `"zoom"` and `"punchY"` per segment override the amount and the vertical centre.
- **Transitions.** The glitch seam stays the default. `"transition": "crossfade"` on a segment (or at the top level for all of them) uses an ffmpeg xfade instead; `"transitionDur"` sets the length. The 50 names (crossfade, dip, flash, whip, iris, zoom, pixelate, ...) are in `kit/transitions.json` and `effects/CATALOG.md`.
- **Sounds.** Fewer and deeper. The locked cut-seam set is `whoosh`, `swipe`, `boom`, `click`, `typing` (mono 48 kHz WAV, CC0), used as `"sfx": {"whoosh": [3.2], "boom": [[12.4, 0.55]]}`. Never a sound on every cut, and the key moment (the payoff) gets the loudest one. A 31-sound cinematic pack in `kit/sfx/` (see `kit/sfx/sfx.json`) is auto-picked on `npm run fx` for each effect hit: category mapping, no-repeat rotation, the hit point aligned to the effect, risers ending on the hit, releases after heavy hits, ducked under the voice. Override per effect with `"sfx": "01-cinematic-hit-a"` or `"sfx": false`, or turn the pack off with `--sfx off`. You still pick sounds by ear.
- **Copy.** No em or en dashes, no "not X, but Y", no staged run-ups ("Here's the thing:"), no dramatic closers, no hype words. `npm run check` lints the captions, titles and card copy.
- **Script shape.** A hook, one reveal per beat, a payoff: 40 to 55 words, 15 to 20 s. Over 25 s, cut a middle sentence.

## Themes

The look of the captions lives in a theme file: colours, fonts, an optional web-font stylesheet and an optional logo.

| Theme | Look |
|---|---|
| `kit/themes/neutral.js` | Default. White captions, yellow accent, system fonts, no logo, works offline. |
| `kit/themes/aigent.js` | AIgent brand guide: cyan `#5cf9e2`, Hanken Grotesk and Sofia Sans Extra Condensed (Google Fonts). |

Pick one with `--theme` (or `THEME=aigent` for `render.mjs`). It's copied into the job as `build/theme.js`, so you can edit colours for one job, or copy a preset to `kit/themes/<yours>.js` for your own brand. A `"theme": {...}` block in `captions.js` overrides single fields, and `"logo": "file.svg"` there puts a logo on the logo-plate flips.

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
| [`skills/talking-head-ad`](skills/talking-head-ad/SKILL.md) | You want the reel: phone clips (main path), HeyGen takes (optional), or both |
| [`skills/clip-raw-footage`](skills/clip-raw-footage/SKILL.md) | You only want a long raw recording cut into clean, transcribed clips |

Agents: start at [AGENTS.md](AGENTS.md).

## What's in the kit

| File | Does |
|---|---|
| `kit/reel.cjs` | `npm run reel`: inbox clip (or several takes) to draft reel in one command (clip, cut, captions, check, render, mask, assemble), plus `--draft` and `--rebuild`. |
| `kit/autocaption.mjs` | Drafts `captions.js` from Whisper word times (`words.json` or `clips.json`), in any caption style, with `--titles`. Never overwrites without `--force`. |
| `kit/check.mjs` | `npm run check [job]`: copy lint, titles, transitions, sounds, punches and script shape. |
| `kit/verify.mjs` | `npm run verify -- <job>`: ffprobe, loudness, title and punch stills, contact sheet, mask alpha, copy lint. Run it before every delivery. |
| `kit/rules.cjs` | The shared edit rules: sounds, entrances, punch amounts, transitions, copy lint, script shape. |
| `kit/mask.py` | Person mask for titles-behind-the-head. `--model birefnet` (rembg birefnet-general-lite, quality, weights downloaded on first use) or `--model mediapipe` (fast fallback). `kit/mask_refine.py` is the shared cleanup. |
| `kit/fonts/`, `kit/fonts.mjs` | Font pairings and their OFL files. |
| `kit/transitions.json` | Transition names mapped to ffmpeg xfade modes. |
| `kit/themes/` | Theme presets: `neutral.js` (default) and `aigent.js`. |
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
| `kit/example/` | The Awakening ad's real `cut.json` and `captions.js`, a real-footage cut, the HeyGen retake prompt, and the Skool mark used only by that ad. |

## Rules the pipeline carries

- No clip of about 3 s or less. No dead air at the head of a clip. Never start a clip mid-sentence.
- Listen for repeated words in every raw take before cutting. Cut words at fricative edges so the next word survives.
- Text never covers the presenter's face. A lone floating word with nothing behind it is a fail.
- Use only the theme's faces and colours. On the AIgent theme the one cyan is `#5cf9e2`. Cards are square.
- Only real sounds, picked by a human ear. An agent can't judge audio, so give the human an audition.
- Re-transcribe the full render with the music in. It must match the script.
- `npm run verify` passes and someone has looked at the contact sheet before the reel goes out.

## Credits and licences

Code and docs: Apache-2.0, Copyright 2026 Will Gwyn (wrg32786). See [LICENSE](LICENSE). The files below keep their own licences and marks.

- `kit/sfx/F-cinematic-woosh-648729.mp3`: "Cinematic Woosh SFX-010" by AudioPapkin, Freesound 648729, CC0.
- `kit/sfx/D-quick-woosh-683101.mp3`: "quick woosh" by florianreichelt, Freesound 683101, CC0.
- `kit/sfx/whoosh.wav` and `kit/sfx/swipe.wav`: mono 48 kHz WAV conversions of the two Freesound files above, CC0.
- `kit/sfx/boom.wav`, `click.wav`, `typing.wav`: from [motion-pack](https://github.com/ANVEAI/motion-pack) by ANVEAI (sounds `snd.hit.deep_impact`, `snd.ui.click`, `snd.ui.typing_burst`), CC0 1.0 under its LICENSE-MEDIA.
- `kit/sfx/{hit,riser,release,whoosh,swipe,pop,ui,glitch,camera,paper,counter,sub,shimmer}/` and `kit/sfx/sfx.json`: 31-sound cinematic pack (Will-approved). DAEDAL Transition / UI packs, Kenney Interface Sounds, OpenGameArt / Freesound CC0 items, and original synths dedicated CC0. Full credits in [THIRD_PARTY.md](THIRD_PARTY.md).
- `kit/fonts/`: Google Fonts under the SIL Open Font License 1.1, each with its licence file. See [kit/fonts/README.md](kit/fonts/README.md).
- Ideas adapted, no code copied: the transition name map from motion-pack (MIT), the Hormozi and karaoke caption looks from [Capite](https://github.com/muneebkhan08/Capite) (MIT), the title entrances from [motion-anything](https://github.com/nexu-io/motion-anything) (Apache-2.0, reference only). See [THIRD_PARTY.md](THIRD_PARTY.md).
- `kit/example/skool-logo.svg`: the Skool wordmark, a trademark of Skool. It's included only to mark The AIgent's own Skool group in the Awakening example; it isn't in any theme. Don't use it for other brands.
- `effects/vendor/claude-video-effects/`: [claude-video-effects](https://github.com/Vibha-Ramprakash/claude-video-effects) by Vibha Ramprakash, MIT. Its models (YuNet, MIT; MediaPipe Selfie Segmenter, Apache-2.0) and fonts (SIL OFL 1.1, Permanent Marker Apache-2.0) keep their own licences; see `NOTICE` and `effects/README.md`.
- Person-mask quality backend (installed by `npm run effects:setup`, not vendored): [rembg](https://github.com/danielgatis/rembg) by Daniel Gatis, MIT; [onnxruntime](https://github.com/microsoft/onnxruntime) by Microsoft, MIT; birefnet-general-lite weights from [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) by ZhengPeng, MIT, downloaded on first use into rembg's cache. See [THIRD_PARTY.md](THIRD_PARTY.md).
- Music beds are not included. Bring your own licensed track.
