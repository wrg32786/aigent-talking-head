# aigent-talking-head

Turn a phone recording into a finished 9:16 reel. Record yourself on your phone, drop the file in `inbox/`, and ask Claude (or any coding agent) to make the reel. You get:

- clean clips cut on sentence boundaries, with flubbed retakes flagged and skipped
- tight cuts with a glitch hit and a woosh on every seam
- timed captions drafted from the transcript, in a theme you pick (neutral by default, or the AIgent look)
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
   npm run reel -- inbox/my-take.mov --theme aigent --cropx 0.4 --bed music.wav
   ```

5. **Review** `jobs/<clip-name>/reel-v1.mp4`. To change anything, edit `jobs/<clip-name>/build/captions.js` (words, timing, hero words, stickers) or `build/cut.json` (which clips, trims), then `npm run reel -- --rebuild --name <clip-name>`.

The first run downloads the Whisper model (large-v3, about 3 GB). Pass `--model medium.en` for a faster, smaller first pass. Your footage, `jobs/` and `.env*` files are gitignored.

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
npm run smoke                                   # synthetic clip end to end, about 30 s, no footage or keys needed
```

Chrome is found automatically in the usual Mac, Linux and Windows install paths or on PATH. Set `CHROME_PATH` to use a different one. Set `PYTHON` if your Python isn't `python3` (or `py` on Windows). `npm run smoke:whisper` also runs a tiny Whisper model.

Optional: a HeyGen account with Cinematic Avatar if you generate takes, and `FREESOUND_API_KEY` if you search for new sounds.

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
| `kit/reel.cjs` | `npm run reel`: inbox clip to draft reel in one command (clip, cut, captions, render, assemble), plus `--draft` and `--rebuild`. |
| `kit/autocaption.mjs` | Drafts `captions.js` from Whisper word times (`words.json` or `clips.json`). Never overwrites without `--force`. |
| `kit/themes/` | Theme presets: `neutral.js` (default) and `aigent.js`. |
| `kit/chrome.mjs` | Finds Chrome on Mac, Linux or Windows; `CHROME_PATH` overrides. |
| `kit/smoke.mjs` | `npm run smoke`: synthetic end-to-end test. |
| `kit/clip.py` | Raw footage to sentence clips. Retakes flagged, ends set from the audio, voice at -16 LUFS, optional vertical crop, contact sheet. |
| `kit/tx.py` | Word timings for each take; flags repeated words. |
| `kit/timeline.mjs` | Maps segment word times onto the output clock and prints the seams. |
| `kit/overlay.html` | Caption layer, driven by `captions.js` and styled by `theme.js`. |
| `kit/render.mjs` | Renders the overlay to PNG frames (24 fps) or to stills. Run it from `build/`. |
| `kit/assemble.cjs` | The cut. Any number of segments from any source, cover-cropped to 1080x1920, glitch seams, overlay, woosh hits, ducked bed, -14 LUFS. |
| `kit/fs.mjs` | Freesound search, CC0 only. |
| `kit/sfx/` | The two picked sounds. |
| `kit/example/` | The Awakening ad's real `cut.json` and `captions.js`, a real-footage cut, and the HeyGen retake prompt. |

## Rules the pipeline carries

- No clip of about 3 s or less. No dead air at the head of a clip. Never start a clip mid-sentence.
- Listen for repeated words in every raw take before cutting. Cut words at fricative edges so the next word survives.
- Text never covers the presenter's face. A lone floating word with nothing behind it is a fail.
- Use only the theme's faces and colours. On the AIgent theme the one cyan is `#5cf9e2`. Cards are square.
- Only real sounds, picked by a human ear. An agent can't judge audio, so give the human an audition.
- Re-transcribe the full render with the music in. It must match the script.

## Credits and licences

- `kit/sfx/F-cinematic-woosh-648729.mp3`: "Cinematic Woosh SFX-010" by AudioPapkin, Freesound 648729, CC0.
- `kit/sfx/D-quick-woosh-683101.mp3`: "quick woosh" by florianreichelt, Freesound 683101, CC0.
- `kit/skool-logo.svg`: the Skool wordmark, a trademark of Skool. It's included only to mark The AIgent's own Skool group in the Awakening example; it isn't in any theme. Don't use it for other brands.
- Music beds are not included. Bring your own licensed track.
