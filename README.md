# aigent-talking-head

The pipeline behind the AIgent talking-head video ads. It takes HeyGen cinematic takes, real camera footage, or a mix, and returns a finished 9:16 ad:

- tight cuts with a glitch hit on every seam
- AIgent brand-guide captions: spray-on hero words, drips that fall from the letters, square stickers and takeover cards, a logo plate
- the two woosh sounds we picked by ear
- your music bed, ducked under the voice
- a transcript and frame check on every version

It was built and proven on the "Awakening" hero ad in November 2026. Two skills sit on one shared kit:

| Skill | Use it when |
|---|---|
| [`skills/talking-head-ad`](skills/talking-head-ad/SKILL.md) | You have takes (HeyGen, camera, or both) and want the ad |
| [`skills/clip-raw-footage`](skills/clip-raw-footage/SKILL.md) | You have a long raw recording and want clean, transcribed clips to cut from |

Agents: start at [AGENTS.md](AGENTS.md).

## Requirements

- Node 18+, plus `npm install` (this pulls `playwright-core`). Chrome installed; set `CHROME_PATH` if it isn't at the Windows default.
- ffmpeg and ffprobe on PATH.
- Python 3 with `pip install -r requirements.txt` (faster-whisper; models download on first run).
- A HeyGen account with Cinematic Avatar, only if you generate takes.
- A Freesound API key in `FREESOUND_API_KEY`, only if you search for new sounds.

## Quick start

```
# real footage -> clips
py -3 -I kit/clip.py raw.mov --out clips --vertical
#   read clips/clips.md and clips/clips-sheet.png, pick the keepers

# job folder
mkdir build && cp kit/overlay.html kit/render.mjs build/
cp kit/example/captions.awakening-hero.js build/captions.js     # then edit the flips
cp kit/example/cut.real-footage.json build/cut.json            # then edit the segs
cd build
node ../kit/timeline.mjs                 # every word on the output clock
node render.mjs 0 "2.5,10,20"            # caption stills first
node render.mjs 36.4                     # full overlay frames
node ../kit/assemble.cjs ad-v1.mp4       # the cut
```

## What's in the kit

| File | Does |
|---|---|
| `kit/clip.py` | Raw footage to sentence clips. Retakes flagged, ends set from the audio, voice at -16 LUFS, optional vertical crop, contact sheet. |
| `kit/tx.py` | Word timings for each take; flags repeated words. |
| `kit/timeline.mjs` | Maps segment word times onto the output clock and prints the seams. |
| `kit/overlay.html` | Brand-guide caption layer, driven by `captions.js`. |
| `kit/render.mjs` | Renders the overlay to PNG frames (24 fps) or to stills. |
| `kit/assemble.cjs` | The cut. Any number of segments from any source, cover-cropped to 1080x1920, glitch seams, overlay, woosh hits, ducked bed, -14 LUFS. |
| `kit/fs.mjs` | Freesound search, CC0 only. |
| `kit/sfx/` | The two picked sounds. |
| `kit/example/` | The Awakening ad's real `cut.json` and `captions.js`, a real-footage cut, and the HeyGen retake prompt. |

## Rules the pipeline carries

- No clip of about 3 s or less. No dead air at the head of a clip. Never start a clip mid-sentence.
- Listen for repeated words in every raw take before cutting. Cut words at fricative edges so the next word survives.
- Text never covers the presenter's face. A lone floating word with nothing behind it is a fail.
- Use only the brand-guide faces and colours. The one cyan is `#5cf9e2`. Cards are square.
- Only real sounds, picked by a human ear. An agent can't judge audio, so give the human an audition.
- Re-transcribe the full render with the music in. It must match the script.

## Credits and licences

- `kit/sfx/F-cinematic-woosh-648729.mp3`: "Cinematic Woosh SFX-010" by AudioPapkin, Freesound 648729, CC0.
- `kit/sfx/D-quick-woosh-683101.mp3`: "quick woosh" by florianreichelt, Freesound 683101, CC0.
- `kit/skool-logo.svg`: the Skool wordmark, a trademark of Skool. It's included only to mark The AIgent's own Skool group in our ads.
- Music beds are not included. Bring your own licensed track.
