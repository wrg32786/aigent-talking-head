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
| Caption place and colour | `caption-position` top, middle or bottom (median centre of the caption boxes) and `caption-color` (their median fill, snapped to white or black when close) |
| Caption outline, shadow and case | `caption-outline` none, thin or thick and `caption-shadow` none or soft (the ring of picture just outside the letters: a hard dark band is an outline, a milder darkening a shadow), and `caption-case` from the words read |
| Caption layer | `caption-layer` front or behind: for single words in the top 40% of the frame whose box meets the person (the mask shrunk a few pixels so its soft edge does not count), are the letters still there over the person? Letters that stop at the hairline (under a third of the text density beside them, in the same rows) are behind; behind when 60% or more of at least 2 such words are |
| Ordinal stickers, app labels, screen cards | a `reel-graphics` block (see below) |
| Big text that is not a caption | up to 7 titles with text, times, the nearest entrance (cut to slam, pop to pop-zoom, type-on to stagger-rise, fade to blur-rise, slide to slide-left), and front or behind |
| Grade per shot | the nearest finish (`mono`, `teal`, `bleach`, `crushed`, `cool`, `warm`, `scan-lines`, `grain`, `vignette`), only when it is strong or differs across shots; otherwise none (see below) |
| Cuts, jump cuts, zoom moves | the shot list, big punches, punch on or off |
| Music and BPM | beat sync on, and the library bed with the closest tempo |
| Text and frame colours | brand kit colours |
| Speech | a `reel-script` block with the reference's lines and times |

### Titles: what is left out

A title must not be the running caption. Big text is left out of the titles when:

- it matches the word being said at that moment (fuzzy, so OCR and Whisper misspellings still match), unless it is styled apart: at least 1.35 times the caption height, or boxed, multicolour or a decorative style;
- in a one-word caption reel, it is a single word in the caption band at caption size, up for 1.6 s or less;
- it belongs to a detected graphic (inside a screen card, or the word of an ordinal sticker or app label).

The report lists every left-out line and why.

### Finish: when one is assigned

A finish is kept only when the grade differs across shots or is strong. A mild warm or cool cast that is even across the shots is read as the room's light (a lamp, a window, warm walls), not a finish, and is listed as an ambient note in the report instead. Strong looks (mono, teal, scan-lines, crushed blacks) and looks on only some of the shots are kept.

### One-word captions: every word

In the one-word style every spoken word gets its own slot, back to back: a word shows from its start until the next word starts, at least 0.12 s each (words Whisper gives the same start are spread out, not dropped), and only a pause over 1.5 s clears the screen. While a title or an ordinal word is up, the spoken word it shows is not drawn twice; every other word still shows, moved above it when both sit at the top. `build/words.json` lists every slot.

### Graphics

Frames are sampled every 0.25 s at 540x960 and looked at for three kinds of graphic. Each becomes a line in `reel-graphics`, drawn in the remake with the kit's own generic designs (never the reference's assets):

| Graphic | Detected as | Becomes |
|---|---|---|
| Ordinal sticker | a large warm-yellow region with a spiky outline (low solidity), plus a short ordinal word (FIRST, 2nd, #3) read at the same time; front or behind from the person mask | `ordinal-sticker`, with the word (guessed from its place in the list when OCR could not read it, marked `text~`) |
| App label | a small square tile of high-contrast colour, with a label read below or beside it | `app-label`, the label text and tile colour, a generic glyph until you add `icon` |
| Screen card | a large dark rounded rectangle with a coloured border and at least two small UI text lines inside | `screen-card`, its border colour and place, a placeholder window until you add `src` (an image or a screen recording) |

Misses: a white or pale tile on a pale wall, and a sticker word that OCR cannot read (its text is guessed).

**Burst size.** The burst is measured when fully grown, as a share of the frame width and relative to the head (person mask): `head` is its width in head widths, `head-y` where its centre sits below the head centre. The remake measures your head the same way, so the burst frames your head as it framed theirs.

**Screen cards and their sources.** The teardown reads the text inside each card (`subject~`, the report's "Screen cards: what was shown") and any web address in it (`source~`; a raw.githubusercontent.com link becomes its repo; placeholder and session links are skipped), and names the tool shown just before it. The agent then proposes a public page for each card (the repo or site of the tool named), confirms the list with the user, writes `source <url>` on the cards, and captures them:

```
npm run capture -- --recipe teardown/<name>/Reel.md --list   # the sources, guesses marked
npm run capture -- --recipe teardown/<name>/Reel.md          # capture the confirmed ones (source, not source~)
npm run capture -- https://github.com/owner/repo --scroll 8  # or one page
```

Each page becomes `assets/web/<page>/shot.png` (the top of the page, or of the README on a repo) and `scroll.mp4` (a short smooth scroll), in dark mode, cached per URL (`--force` to redo). Only public pages: http and https only, no localhost or private network addresses (checked before loading, and for every request the page makes), a fresh browser profile with no cookies and no login.

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
- **Caption look**: on a test list reel, plain white lower-case words with no outline and no shadow were read as `caption-outline none`, `caption-shadow none`, `caption-case lower`; the same check on our outlined captions reads an outline.
- **Caption layer**: on a test list reel whose top words lose their tails behind the hair, 9 words met the person and 7 read behind, so the Style says `caption-layer: behind`. Words that only graze the soft edge of the mask are not counted, so a reel with captions well clear of the head gives no verdict and the default (auto) applies.
- **Graphics**: on a test list reel (5 numbered stickers, app tiles, screen recordings), all 5 stickers and their place were found (one word guessed), 4 of 5 app labels (a white tile was missed), and the screen recordings as 8 cards.
- **rea-video's own verdict** on how footage was made (live action, AI, 3D) is not used by the mapping. Without a vision model it can be wrong; it called parts of the real demo footage AI.

Always show the user the teardown report and contact sheet, and let them change the Reel.md before the remake renders.

## Files

`teardown/<name>/` (gitignored):

- `Reel.md`: the recipe. Edit it.
- `teardown.md`: what was detected, per title and per shot, and why.
- `contact.jpg`: sampled frames with the detected titles boxed and labelled.
- `videomd/`: rea-video's VIDEO.md package, `breakdown.json` and `report.html` (or `fallback.json` from the built-in analyzer).
- `titles.json`, `extras.json`, `speech.json`: intermediate data.
