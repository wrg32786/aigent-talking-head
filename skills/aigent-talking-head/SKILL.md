---
name: aigent-talking-head
description: "Turn a phone clip into a styled 9:16 talking-head reel, locally: kinetic captions, titles in front of or behind the head, 15 overlay graphics, 51 effects, beat-synced music, film finishes, presets and Reel.md recipes. Every command, flag, output and failure is listed in contract.json. Use when someone asks to make a reel from a selfie or talking-head clip, add captions and titles to a vertical video, remake the style of a reel they like, or check a finished reel before posting."
---

# aigent-talking-head

A local pipeline that turns one phone clip (or several takes) into a captioned, styled 9:16 reel. You drive it with `npm run` commands from the root of an aigent-talking-head checkout. Nothing is uploaded and no API key is needed. Every path below is relative to that checkout.

The machine-readable command list is `contract.json` at the checkout root ([on GitHub](https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/contract.json)): each command with its positional args, flags (type, allowed values, default), outputs, success line and failure messages. `npm run check` fails if it drifts from the code, so trust it over memory.

## When to use it

- "Make a reel from my clip", "edit my talking-head video", "add captions and titles to this selfie video".
- "Make it look like this reel": tear the reference down into a Reel.md recipe, then remake it with their clip.
- "Is this reel ready to post?": run `npm run verify` on the job.
- Only cutting clips from a long recording: use the clip-raw-footage skill (`skills/clip-raw-footage/SKILL.md`).

Not for: posting anywhere, downloading other people's videos in bulk, or footage the user has no rights to.

## Prerequisites

Work inside a checkout (it has `kit/reel.cjs` and a `package.json` with `npm run reel`). If there is none, install it first: read https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/INSTALL.md and follow it.

- Node.js 18 or newer, ffmpeg and ffprobe on PATH, Python 3.10 or newer (3.11+ for the BiRefNet mask), Chrome or Chromium.
- In the repo: `npm install`, then a venv with `requirements.txt` and `PYTHON` pointing at it (`INSTALL.md` has the exact lines for each OS).
- Check: `npm run chrome` prints a path, `npm run check` prints `CHECK PASS`, `npm run smoke` prints `SMOKE PASS` (several minutes, synthetic clips, no network).
- Optional, ask first: `npm run effects:setup` (effects pass and the person mask, several hundred MB) and `npm run teardown -- <file> --install` (rea-video, about 216 MB of models).

## Workflow

1. **Offer the menu first.** Ask: a saved preset (`npm run preset`), a recipe (`examples/recipes/*.Reel.md` or their own), customize, or let you choose (`--preset auto`). Run `npm run menu` and point them at `showcase/GALLERY.md`. Suggest 2 or 3 options per category. Offer it again before the final render.
2. **Draft.** The clip goes in `inbox/` or is passed by path.
   ```
   npm run reel -- --clip inbox/<file> [--preset <name> | --recipe <Reel.md>] [--bed <name>] [--finish grain] --draft
   ```
3. **Review.** Read `jobs/<name>/clips/clips.md` and fix `jobs/<name>/build/captions.js` (misheard words, headline titles). `npm run check -- <name>` lints the copy.
4. **Render.**
   ```
   npm run reel -- --rebuild --name <name>
   ```
5. **Optional effects pass.** Write an `fx.json` plan (header of `kit/fx.cjs`, menu in `effects/CATALOG.md`), then `npm run fx -- --name <name> --plan fx.json`.
6. **Verify before handing over.** `npm run verify -- <name>` must print `VERIFY PASS`. Then look at `jobs/<name>/verify/contact.png` yourself.
7. **Hand over** the path of the newest `jobs/<name>/reel-vN.mp4` (or `reel-fx-vN.mp4`). Offer to save the look: `npm run reelmd -- export <name> --out my-style.Reel.md` or `npm run preset -- --save <name> --from <name>`.

## Commands

Run each as `npm run <command> -- <args>` from the repo root. Full flag list with types and defaults: `contract.json`.

| Command | What it does | Key args and flags |
|---|---|---|
| `reel` | clip to draft, then to `reel-vN.mp4` | `[videos...]`, `--clip`, `--name`, `--preset <name>\|auto`, `--recipe`, `--recipe-titles`, `--look kinetic\|oneword\|muse\|classic\|one-word`, `--style`, `--theme aigent\|neutral`, `--title-layer front\|behind\|auto`, `--caption-position top\|middle\|bottom`, `--caption-layer`, `--panel-layer`, `--fonts`, `--finish`, `--bed`, `--bed-start`, `--beat-sync`, `--no-beat-sync`, `--mask birefnet\|mediapipe`, `--no-mask`, `--no-titles`, `--no-punch`, `--sfx off`, `--draft`, `--rebuild`, `--force` |
| `verify` | check a finished reel | `<job>`, `--file`, `--fps`, `--jobs` |
| `check` | lint a job's copy and plan, or self-test the repo | `[job]`, `--warn-only` |
| `smoke` | end-to-end test on synthetic clips | `--whisper`, `--effects`, `--keep` |
| `fx` | effects pass over a reel or any video | `--name <job>` or `<video>`, `--plan fx.json`, `--list`, `--still 1.2,6.5`, `--out`, `--captions on\|off`, `--mask`, `--allow-demo-copy`, `--pill`, `--sfx off` |
| `preset` | list, show or save presets | `--show <name>`, `--save <name> --from <job>` |
| `reelmd` | Reel.md recipes | `check <Reel.md>`, `compile <Reel.md> [--out dir]`, `export <job> [--out Reel.md] [--name n]`, `package <Reel.md> <dir>` |
| `teardown` | reference reel to a Reel.md | `<video>`, `--out`, `--name`, `--engine rea\|lite`, `--install`, `--model`, `--no-asr`, `--no-ocr`, `--vlm`, `--reuse` |
| `capture` | public page to a screen card | `<urls...>` or `--recipe <Reel.md> [--list]`, `--scroll 8`, `--width 780`, `--force`, `--image-only` |
| `menu` | every option | `--json` |
| `brand:import` | brand guide to a draft preset | `<file>`, `--name`, `--out` |
| `music` | list or add music beds | `[files...]`, `--replace` |
| `chrome` | print the Chrome in use | none |
| `effects:setup` | effects venv | `--birefnet` |
| `contract` | check contract.json against the CLIs | none |

Maintainer commands (`showcase`, `effects:update`, `effects:check`, `effects:catalog`, `fonts:examples`) are in the contract too.

Precedence when a reel is made: flags, then the recipe, then its preset, then defaults.

## Graphics

15 overlay graphics, each with its own entrance and exit, drawn in the theme's colours and fonts. Add them as lines in a Reel.md `reel-graphics` block (`#01 2-5 | type stat-callout | text 10,000+ | sub readers`) or as `captions.js` flips with the mode. Fields and defaults: `kit/graphics.json` and the `graphics` section of `contract.json`. Offer them with the rest of the menu (`npm run menu`, `showcase/sheets/graphics.jpg`).

| Type | Mode | What it is | Main fields |
|---|---|---|---|
| `ordinal-sticker` | 9 | list number on a flat accent seal | `text`, `layer front\|behind` |
| `app-label` | 10 | icon tile and label | `text`, `icon` |
| `screen-card` | 11 | your screenshot or screen recording in a card | `src` or `source`, `border` |
| `lower-third` | 12 | name tag | `text`, `sub` |
| `stat-callout` | 13 | big number that counts up, with a label | `text`, `sub` |
| `checklist` | 14 | rows that tick as you say them | `text`, `items a; b; c` |
| `quote-card` | 15 | a quote in italic serif with attribution | `text`, `sub` |
| `highlight` | 16 | marker circle, arrow, underline or box | `shape`, `x`, `y`, `w`, `h`, `text` |
| `step-counter` | 17 | STEP 2 OF 5 with a progress bar | `step`, `of` |
| `versus` | 18 | two halves and a VS badge | `left`, `right` |
| `icon-badge` | 19 | round badge with a Tabler glyph or your icon | `glyph`, `icon`, `text` |
| `sticker-pop` | 20 | a cluster of reaction stickers | `glyph a;b`, `count` |
| `price-tag` | 21 | swinging tag, old price struck through | `text`, `sub` |
| `cta-card` | 22 | end card with a pulsing follow button | `text`, `sub` (handle) |
| `code-card` | 23 | code typing itself on in an editor card | `text` (`\n` for a new line) |

Glyphs: check, star, bolt, heart, fire, play, bell, spark, plus, lock. Every graphic takes `x`, `y` (0 to 1) and `color`.

- Words on a graphic must be words the user says in its window (the fields under `spoken` in `kit/graphics.json`). On a recipe job the kit drops any that are not said, keeps only the checklist rows that are, and ticks each row as it is said. Do not write words the user never says.
- `layer front|behind|auto` on modes 11 to 23. Behind puts the graphic under the top of the head only (hair and crown), never the face or chin. Auto is behind for a screen card, and for the others behind only when the graphic sits high in the frame (y below 0.45). It needs the person mask (`npm run effects:setup`).

## Inputs

- Video: `.mov`, `.mp4`, `.m4v`, `.mkv`, `.webm` or `.avi`. With no path, `reel` takes every video from the newest recording session in `inbox/` (`--newest` for one).
- Optional: a Reel.md recipe (`docs/reel-md.md`), a preset name, a bed name or audio file, a logo, an `fx.json` plan, a brand guide.

## Outputs

- `jobs/<name>/clips/`: `clips.json` and `clips.md` (best take per sentence, retakes flagged).
- `jobs/<name>/build/`: `cut.json`, `captions.js`, `theme.js` and overlay frames. These are the source of truth after a draft: edit them, then `--rebuild`.
- `jobs/<name>/reel-vN.mp4` and `reel-fx-vN.mp4`: numbered, earlier versions kept.
- `jobs/<name>/verify/`: stills, `contact.png`, `report.md`.
- `teardown/<name>/`: `Reel.md`, `teardown.md`, `contact.jpg`.

Success lines to look for: `CHECK PASS`, `SMOKE PASS`, `VERIFY PASS`, `REELMD PASS`, `CONTRACT PASS`, `READY` (effects:setup), `Reel: <path>`.

## Failure modes

| You see | Do |
|---|---|
| `No video given and inbox/ has none` | ask for the clip, or pass its path |
| `build/cut.json exists. Use --rebuild ... or --force` | `--rebuild` to render edits, `--force` only to throw the draft away |
| `--look must be ...` (or any flag) | use a value from contract.json |
| `Chrome not found` | install Chrome or Chromium, or set `CHROME_PATH` |
| Python import errors or "externally managed environment" | use the venv from INSTALL.md and set `PYTHON` |
| `Effects are not set up yet` | ask, then `npm run effects:setup` |
| `Fix the plan first` (fx) | put the user's own copy in `fx.json`; never ship upstream demo text |
| `VERIFY FAIL` | fix what it lists and render again; don't explain it away |
| `CHECK` copy errors | rewrite the line: no em dashes, no "not X but Y", no hype words |
| teardown says rea-video not found | it falls back to the built-in analyzer; offer `--install` |

## Rules

- Offer the menu before drafting and again before the final render.
- You can't hear. Let the user pick sounds and beds by ear.
- Number versions and never overwrite an earlier reel (`reel` does this).
- Never post or upload anything. Hand over the file path.
- Teardown and capture only take material the user has the rights to; capture only public pages they confirmed.

## More

- Full manual (cut.json, captions.js, sounds, HeyGen takes): `skills/talking-head-ad/SKILL.md`
- Focused skills in the same repo: talking-head-reel, talking-head-recipe, talking-head-brand, talking-head-teardown, clip-raw-footage (each under `skills/`)
- Agent notes: `AGENTS.md`. Install from scratch: `INSTALL.md`.
