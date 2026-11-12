# Teardown and remake

Tear down a reel you like, see what it is made of, change what you want, then remake it with your own clip and brand.

```
npm run teardown -- reference.mp4                 # writes teardown/reference/Reel.md, teardown.md, contact.jpg
npm run reel -- --recipe teardown/reference/Reel.md --clip inbox/my-clip.mp4
```

Local files you provide. The one exception is an optional helper for a single Instagram post:

```
pip install instaloader                                           # optional extra (MIT), not installed by default
npm run teardown -- --url https://www.instagram.com/reel/<code>/  # fetches that one post into teardown-in/ (gitignored), then tears it down
```

It fetches only the post you name, anonymously. It never logs in, and it does not fetch profiles, hashtags, stories or anything in bulk. If Instagram asks for a login or rate-limits the request, it stops and says so; download the video yourself instead. You must have the rights to the content, and you must follow Instagram's terms. Other sites (TikTok, YouTube and so on) are not supported: save the video yourself where the platform and the creator allow it, then pass the file.

## What runs

1. **rea-video** ([JuneYaooo/rea-video](https://github.com/JuneYaooo/rea-video), Apache-2.0) breaks the video down shot by shot and writes a [VIDEO.md](https://videomd.github.io/videomd/) package: cuts, captions and styled text with timing, colour, outline and entrance, stickers, music BPM and beats, sound effects, grade, framing and camera moves, plus its own `report.html`. It runs offline. A vision model is optional (`--vlm`, see rea-video's docs).
2. **Speech**: if rea-video's optional speech step is off, faster-whisper (already a kit dependency) transcribes the reference so you can see its timing.
3. **Extras** (`kit/teardown.py extras`): things a talking-head remake needs that rea-video does not measure. Front or behind for each big title (a MediaPipe person mask from the effects venv, when it is set up), corner darkening and noise per shot, and a labelled contact sheet.
4. **Mapping** (`kit/videomd2reel.cjs`): the breakdown becomes a Reel.md on the talking-head menu.

| Detected | Becomes |
|---|---|
| Running captions (words per cue, time on screen, box, highlight, case, outline) | caption style: `one-word`, `pill`, `karaoke`, `hormozi` or `kinetic`, and the look |
| Big text that is not a caption | up to 7 titles with text, times, the nearest entrance (cut to slam, pop to pop-zoom, type-on to stagger-rise, fade to blur-rise, slide to slide-left), and front or behind |
| Grade per shot | the nearest finish: `mono`, `teal`, `bleach`, `crushed`, `cool`, `warm`, `scan-lines`, `grain`, `vignette`, or none |
| Cuts, jump cuts, zoom moves | the shot list, big punches, punch on or off |
| Music and BPM | beat sync on, and the library bed with the closest tempo |
| Text and frame colours | brand kit colours |
| Speech | a `reel-script` block with the reference's lines and times |

## Install rea-video

```
npm run teardown -- reference.mp4 --install
```

That runs `pip install "rea-video[ocr] @ git+https://github.com/JuneYaooo/rea-video"` with the kit's Python (`PYTHON`, or `python3`; use a venv on systems that block a global pip), then swaps `opencv-python` for `opencv-python-headless` as rea-video's setup notes ask. An agent can also do it from rea-video's own line: "Install https://github.com/JuneYaooo/rea-video". The first breakdown downloads about 216 MB of audio separation models into `~/.cache/rea-video/models`. A 40 second reel takes about two minutes on a laptop CPU.

Without rea-video, `npm run teardown` falls back to the built-in analyzer (`kit/teardown.py analyze`, or `--engine lite`): cuts from frame differences, grade stats, OCR with rapidocr-onnxruntime if it is installed, faster-whisper speech, and the kit's beat grid. It is rougher: no caption styling, no entrance kinds, no camera moves.

## How sure is this

Measured on the 40 second demo reel in `kit/example/demo-reel/` (20 shots, effect labels as titles, kinetic captions, the yeehaw bed, no finish), and on a control reel rendered from the showcase presenter with known finishes:

- **Cuts**: rea-video found all 20 shots of the demo reel. The fallback finds the hard cuts and some effect changes, and misses some jump cuts on the same take.
- **Tempo**: 185 BPM measured, the bed is 92 BPM (double time). The bed suggestion counts half and double time.
- **Titles**: the big effect labels were found (SPOTLIGHT, ORBIT, COVER, VIEWS, HUGE, CRAYON, FOLLOW), with some OCR misspellings. Check the text; your remake should use your own words anyway.
- **Caption style**: our kinetic captions read as `hormozi` (caps, outline, about one word per cue). Close, but not the same style. Expect the nearest match, not the exact one.
- **Finish**: on the control reel (5 shots of the presenter with none, mono, teal, scan-lines and vignette), rea-video found the 5 shots and the mapping got none, mono and scan-lines right, read teal as cool, and missed the vignette. On the demo reel it read every shot as no finish except one warm one. Strong finishes (mono, scan-lines) are caught. Subtle ones (grain, chroma, light warm or cool) are often missed, and a warm room or a dark background can look like a finish. The thresholds are set to miss rather than invent.
- **Front or behind**: a colour test against the person mask. It works when the title colour differs from the person; it misses when the text matches the clothes or hair, and it needs the effects venv.
- **rea-video's own verdict** on how footage was made (live action, AI, 3D) is not used by the mapping. Without a vision model it can be wrong; it called parts of the real demo footage AI.

Always show the user the teardown report and contact sheet, and let them change the Reel.md before the remake renders.

## Files

`teardown/<name>/` (gitignored):

- `Reel.md`: the recipe. Edit it.
- `teardown.md`: what was detected, per title and per shot, and why.
- `contact.jpg`: sampled frames with the detected titles boxed and labelled.
- `videomd/`: rea-video's VIDEO.md package, `breakdown.json` and `report.html` (or `fallback.json` from the built-in analyzer).
- `titles.json`, `extras.json`, `speech.json`: intermediate data.
