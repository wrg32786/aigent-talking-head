---
name: aigent-talking-head
description: "Turn a phone clip into a styled 9:16 talking-head reel, locally: kinetic captions, titles in front of or behind the head, 30 overlay graphics planned from what the presenter says, editing principles built in (the magazine preset), 56 transitions, 51 effects, beat-synced music, film finishes, presets, Reel.md recipes, platform exports (TikTok, Reels, Shorts, 4:5, 1:1) and an MCP server. Every command, flag, output and failure is listed in contract.json. Use when someone asks to make a reel from a selfie or talking-head clip, add captions and titles to a vertical video, remake the style of a reel they like, or check a finished reel before posting."
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

## Workflow (the recommended agent flow: draft, plan, review, render, verify)

1. **Offer the menu first.** Ask: a saved preset (`npm run preset`), a recipe (`examples/recipes/*.Reel.md` or their own), customize, or let you choose (`--preset auto`). Run `npm run menu` and point them at `showcase/GALLERY.md`, and at `docs/effects.md` for transitions, title entrances, caption entrances and caption styles as looping previews. `npm run list -- transitions|titles|captions|graphics|effects --json` gives the exact names, one-liners, flags and preview paths for one kind. Suggest 2 or 3 options per category. Ask which platform it is for (TikTok, Reels, Shorts, a 4:5 feed post, square). Offer the menu again before the final render.
2. **Draft** (transcribes and stops before rendering). The clip goes in `inbox/` or is passed by path.
   ```
   npm run reel -- inbox/<file> --name <job> --draft
   ```
   Transcription uses Whisper `small.en` by default (fast on a CPU). `--model large-v3` is the most accurate and slow (a ~3 GB download the first time; a one-line notice prints before any download).
3. **Plan.** Propose graphics from what they say:
   ```
   npm run plan -- <job>
   ```
   It reads the transcript and writes `jobs/<job>/Reel.md` with a `reel-graphics` block: a number becomes a stat callout (an odometer for big numbers) or a price tag, a counted or comma list a checklist, "step two" a step counter, a quote a quote card, "X vs Y" a versus card, a command or terminal talk a terminal session, "I'm <name>" a lower third, and the call to action at the end a CTA card or button. Each line says `why`. Every word on a proposal is a word they say (the same spoken gate the render runs), the file passes `npm run reelmd -- check`, and no two proposals share the screen.
4. **Review with the user.** Show them the Graphics block and the transcript (`jobs/<job>/clips/clips.md`). Fix names and brands that transcription got wrong by adding an `## Aliases` section (`- aigent: agent`, `- Gwyn: Guinn`): the plan then writes the word they mean, and the spoken gate accepts the word it heard. Run `npm run plan -- <job> --fresh` to propose again (lines without `why`, the ones you or they wrote, always stay). Add or change graphics from the table below. `npm run reelmd -- check jobs/<job>/Reel.md` must print `REELMD PASS`.
5. **Render**, with the platform's export:
   ```
   npm run reel -- --recipe jobs/<job>/Reel.md --clips jobs/<job>/clips --name <job> --force --export reels
   ```
   The layout pass keeps captions and titles off the graphics (they move the shortest way clear, never further into the face, or hide while the graphic is up) and, with `--export`, keeps everything inside the platform's safe area. Later edits to `build/captions.js` or `build/cut.json`: `npm run reel -- --rebuild --name <job>` (the export is remembered).
6. **Optional effects pass.** Write an `fx.json` plan (header of `kit/fx.cjs`, menu in `effects/CATALOG.md`), then `npm run fx -- --name <job> --plan fx.json`.
7. **Verify before handing over.** `npm run verify -- <job>` (and `--export <name>` for the export) must print `VERIFY PASS`. It fails on any overlap between graphics, captions and titles (measured from pixels at the middle of every graphic's window) and on anything in the platform's UI zones. Then look at `jobs/<job>/verify/contact.png` yourself.
8. **Hand over** the path of the newest `jobs/<job>/reel-vN.mp4` (and `reel-vN-<export>.mp4`). Offer to save the look: `npm run reelmd -- export <job> --out my-style.Reel.md` or `npm run preset -- --save <name> --from <job>`.

Without a plan, `npm run reel -- inbox/<file>` still makes a reel in one command (captions and titles, no graphics).

**Agents with tools.** `npm run mcp` is an MCP server with the same flow as tools (menu, list_effects, draft, plan, validate, render, verify), schemas generated from `contract.json`. Setup for Claude Code, Cursor and Codex: `docs/mcp.md`. Without MCP, pass `--json` to `reel`, `plan`, `verify` and `export`: the last line printed is one JSON result.

## Commands

Run each as `npm run <command> -- <args>` from the repo root. Full flag list with types and defaults: `contract.json`.

| Command | What it does | Key args and flags |
|---|---|---|
| `reel` | clip to draft, then to `reel-vN.mp4` | `[videos...]`, `--clip`, `--clips`, `--name`, `--model small.en\|large-v3`, `--export tiktok\|reels\|shorts\|feed45\|square`, `--json`, `--preset <name>\|auto`, `--recipe`, `--recipe-titles`, `--tighten <s>`, `--no-tighten`, `--cards auto\|off`, `--music-energy low\|mid\|high\|auto`, `--no-sfx-cap`, `--look kinetic\|oneword\|muse\|classic\|one-word`, `--style`, `--theme aigent\|neutral`, `--title-layer front\|behind\|auto`, `--caption-position top\|middle\|bottom`, `--caption-layer`, `--caption-entrance pop\|unfurl\|cascade\|orbit\|warp\|crystallize\|compute\|levitate\|undulate`, `--panel-layer`, `--fonts`, `--finish`, `--bed`, `--bed-start`, `--beat-sync`, `--no-beat-sync`, `--mask birefnet\|mediapipe`, `--no-mask`, `--no-titles`, `--no-punch`, `--sfx off`, `--draft`, `--rebuild`, `--force` |
| `verify` | check a finished reel: ffprobe, loudness, overlap, safe area, mask, copy | `<job>`, `--export <name>`, `--json`, `--file`, `--fps`, `--jobs` |
| `plan` | propose graphics (and, with cards on, colour and chapter cards) from what was said into a Reel.md | `<job>`, `--out`, `--base <Reel.md>`, `--max`, `--fresh`, `--cards`, `--no-cards`, `--dry`, `--json` |
| `export` | re-export a finished reel for a platform | `<job>`, `--export tiktok\|reels\|shorts\|feed45\|square`, `--file`, `--json` |
| `mcp` | MCP server on stdio (docs/mcp.md) | none |
| `check` | lint a job's copy and plan, or self-test the repo | `[job]`, `--warn-only` |
| `smoke` | end-to-end test on synthetic clips | `--whisper`, `--effects`, `--keep` |
| `fx` | effects pass over a reel or any video | `--name <job>` or `<video>`, `--plan fx.json`, `--list`, `--still 1.2,6.5`, `--out`, `--captions on\|off`, `--mask`, `--allow-demo-copy`, `--pill`, `--sfx off` |
| `preset` | list, show or save presets | `--show <name>`, `--save <name> --from <job>` |
| `reelmd` | Reel.md recipes | `check <Reel.md>`, `compile <Reel.md> [--out dir]`, `export <job> [--out Reel.md] [--name n]`, `package <Reel.md> <dir>` |
| `teardown` | reference reel to a Reel.md | `<video>`, `--out`, `--name`, `--engine rea\|lite`, `--install`, `--model`, `--no-asr`, `--no-ocr`, `--vlm`, `--reuse` |
| `capture` | public page to a screen card | `<urls...>` or `--recipe <Reel.md> [--list]`, `--scroll 8`, `--width 780`, `--force`, `--image-only` |
| `menu` | every option | `--json` |
| `list` | one part of the effects menu by kind (transitions, titles, captions, graphics, effects, editing); animated previews in `docs/effects.md` | `-- <kind>`, `--json` |
| `menu:render` | re-render the effects menu previews in `docs/menu/` and rewrite `docs/effects.md` | `--only <section>`, `--docs-only` |
| `brand:import` | brand guide to a draft preset | `<file>`, `--name`, `--out` |
| `music` | list or add music beds | `[files...]`, `--replace` |
| `chrome` | print the Chrome in use | none |
| `effects:setup` | effects venv | `--birefnet` |
| `contract` | check contract.json against the CLIs | none |

Maintainer commands (`showcase`, `effects:update`, `effects:check`, `effects:catalog`, `fonts:examples`) are in the contract too.

Precedence when a reel is made: flags, then the recipe, then its preset, then defaults.

## Graphics

30 overlay graphics, each with its own entrance and exit, drawn in the theme's colours and fonts. Add them as lines in a Reel.md `reel-graphics` block (`#01 2-5 | type stat-callout | text 10,000+ | sub readers`) or as `captions.js` flips with the mode. Fields and defaults: `kit/graphics.json` and the `graphics` section of `contract.json`. Offer them with the rest of the menu (`npm run menu`, `showcase/sheets/graphics.jpg`).

| Type | Mode | What it is | Main fields |
|---|---|---|---|
| `ordinal-sticker` | 9 | list number on a flat accent seal | `text`, `layer front\|behind` |
| `app-label` | 10 | icon tile and label | `text`, `icon` |
| `screen-card` | 11 | your screenshot or screen recording in a card, with an optional pointer and camera | `src` or `source`, `border`, `cursor x y; x y`, `cam z x y; z x y` |
| `lower-third` | 12 | name tag | `text`, `sub` |
| `stat-callout` | 13 | big number that counts up (or rolls, `style odometer`), with a label | `text`, `sub`, `style` |
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
| `data-chart` | 24 | bars or a line that grow on their beats while values count up | `text`, `sub`, `values 1.2k; 3.8k`, `labels`, `kind bar\|line`, `cues` |
| `chapter-card` | 25 | CHAPTER 02 and a title rising out of a mask | `text`, `sub`, `step`, `of` |
| `logo-bug` | 26 | your mark in a corner with its name | `text`, `icon`, `corner tl\|tr\|bl\|br`, `opacity` |
| `channel-bug` | 27 | LIVE pill, running clock and channel name | `text`, `live`, `clock`, `corner` |
| `terminal-session` | 28 | `$` commands type on, then their output lands | `text` (`\n` for a new line), `title`, `cues` |
| `news-strap` | 29 | broadcast lower third with a tag tab | `text`, `sub`, `tag` |
| `ticker` | 30 | a band whose items scroll by | `text` (label), `items a; b; c`, `speed` |
| `split-flap` | 31 | departure-board tiles flip to your words | `text`, `sub` |
| `feature-cards` | 32 | two to four cards deal in as you say each feature | `items`, `details`, `glyph a;b`, `cues` |
| `release-pill` | 33 | glass pill with a NEW chip | `text`, `tag`, `sub` |
| `cta-button` | 34 | a pointer clicks a lit button | `text`, `sub`, `cues` |
| `hud-callout` | 35 | brackets lock onto a region, a leader draws to a label | `text`, `sub`, `x`, `y`, `w`, `h` |
| `flash-card` | 36 | full-frame one-word cards, hard cut on each beat | `text` (one word per card), `cues`, `bg` |
| `keyword-caption` | 37 | a caption line with an accent block behind the keyword | `text`, `keyword`, `tag`, `case` |
| `number-pop` | 38 | list intro: the numbers 1 to N pop in on tiles around the head | `count`, `cues`, `color` |

Glyphs: check, star, bolt, heart, fire, play, bell, spark, plus, lock, arrow, rocket, terminal, chart, world, cpu. Every graphic takes `x`, `y` (0 to 1) and `color`.

- Words on a graphic must be words the user says in its window (the fields under `spoken` in `kit/graphics.json`). On a recipe job the kit drops a graphic whose `required` field is not said, leaves off any other unsaid field and keeps the graphic (a CTA keeps its button when only the sub line is not said), keeps only the checklist, ticker and feature rows that are said, and ticks each row as it is said. A near-homophone counts ("aigent" heard as "agent", "Grok" as "grock"), and so does anything in the recipe's `## Aliases`; the log names every such match. Do not write words the user never says.
- While a graphic is up, captions and titles that would sit on it move clear (shrinking to no less than 70% if the room is short) or hide, and never move further into the face. Two graphics should not share the screen: give them separate times (`npm run plan` does). `npm run verify` fails on any overlap. `"layout": false` in `build/captions.js` turns the pass off (only to compare before and after).
- `cues` (words the user says, `;` between, or seconds into the graphic) time the beats of a data chart, terminal session, feature cards, CTA button, flash cards, keyword caption or screen card pointer: each lands when its word is said. A cue that is never said is spread between its neighbours.
- `layer front|behind|auto` on modes 11 to 38. Behind puts the graphic under the top of the head only (hair and crown), never the face or chin. Auto is behind for a screen card, and for the others behind only when the graphic sits high in the frame (y below 0.45). It needs the person mask (`npm run effects:setup`).

## Editing principles (the magazine preset)

Common short-form editing advice built in as options; `--preset magazine` or `- preset: magazine` (Brand kit) turns on all of them, and the AIgent look stays the default. `npm run list -- editing` lists the names; `docs/guide.md` "Editing principles built in" explains each in plain words; `examples/recipes/magazine.Reel.md` shows every line.

- Fonts: pairings `playfair` and `dmserif` set three faces per phrase (serif numeral or hero, one italic serif word, sans). `"lockup": {"accent": "script"}` or `| accent script |` on any pairing with a script role.
- Placement: `"place": "left|right|above|chest|face"` on a title or caption, `| place face |` in `reel-titles`, preset `titlePlaces` for drafted titles. Face sits behind the head (titles: unless `layer front`), so it needs the person mask.
- Cards: `reel-cards` block (`#01 4.2-5.4 | bg olive | chapter 1`), mode 8 flips with `bg` and `chapter`, or `--cards auto` / `- cards: auto`. `npm run plan -- <job> --cards` writes proposals (chapter cards on a counted list, colour cards on short lines to land, a `number-pop` intro).
- Music: `--music-energy low|mid|high|auto`, Music `- energy:` and `- bed: auto`. `--bed` wins.
- Sound: `"sfxMap": true` (whoosh on transitions, swipe on cards, pop on text and numbers, typing under typewriter, click on big punches). The density cap `"sfxCap": {"minGap": 0.25, "per10": 6}` is on by default; `--no-sfx-cap` or `"sfxCap": false` turns it off.
- Effects: `"punch": 0.12` (10 to 15%), the `typewriter` title and caption entrance, soft transitions with `glitch: off`.
- No dead air: `--tighten 0.3` / `- tighten: 0.3` cuts pauses inside a line to jumps; `--no-tighten` keeps them.

## Transitions

56 named cuts for `cut.json` segments (`"transition": "<name>"`, optional `"transitionDur"`) or a recipe shot (`| transition <name>`); the glitch seam is the default and right most of the time. The list is `kit/transitions.json`.

- Stock ffmpeg xfade: cut, crossfade, dissolve, fade-fast, fade-slow, film, dip, dip-black, flash, dip-white, whip, whip-left, whip-right, push-left, push-right, swipe-up, swipe-down, cover-left, cover-right, cover-up, reveal-left, reveal-right, wipe, wipe-left, wipe-right, wipe-up, wipe-down, luma-wipe, soft-wipe, iris, iris-open, iris-close, circle-crop, doorway, barn-door, zoom, zoom-through, pixelate, blur, blur-cross, radial, clock, squeeze, slice, blinds, wind, warp, diagonal, distance.
- Drawn (xfade expressions written for the kit in `kit/xfx.cjs`, in the theme accent): `slats`, `checkerboard`, `light-leak`, `zoom-blur`, `news-ribbon`, `breaking-news`.
- The outgoing shot holds its last frame for the blend, so caption times never move. One or two named transitions per reel reads better than one on every cut.

## Exports

`--export <name>` on `reel` (or `npm run export -- <job> --export <name>` for a finished reel) writes `reel-vN-<name>.mp4` beside the reel. Presets are in `kit/exports.json`:

| Name | Frame | Length cap | Safe area (top, bottom, left, right px) |
|---|---|---|---|
| `tiktok` | 1080x1920 | 600 s | 160, 440, 60, 140 |
| `reels` | 1080x1920 | 180 s | 220, 420, 60, 120 |
| `shorts` | 1080x1920 | 180 s | 160, 380, 60, 140 |
| `feed45` | 1080x1350 (4:5 crop) | 140 s | 60, 120, 60, 60 |
| `square` | 1080x1080 (1:1 crop) | 140 s | 50, 90, 50, 50 |

Render with `--export` (not just `npm run export`) so the layout pass moves titles, captions and graphics inside the safe area. `npm run verify -- <job> --export <name>` checks the size, the length cap and the safe area, and shades the UI zones red on the stills.

## Inputs

- Video: `.mov`, `.mp4`, `.m4v`, `.mkv`, `.webm` or `.avi`. With no path, `reel` takes every video from the newest recording session in `inbox/` (`--newest` for one).
- Optional: a Reel.md recipe (`docs/reel-md.md`), a preset name, a bed name or audio file, a logo, an `fx.json` plan, a brand guide.

## Outputs

- `jobs/<name>/clips/`: `clips.json` and `clips.md` (best take per sentence, retakes flagged).
- `jobs/<name>/build/`: `cut.json`, `captions.js`, `theme.js` and overlay frames. These are the source of truth after a draft: edit them, then `--rebuild`.
- `jobs/<name>/reel-vN.mp4` and `reel-fx-vN.mp4`: numbered, earlier versions kept.
- `jobs/<name>/reel-vN-<export>.mp4` with `--export`.
- `jobs/<name>/Reel.md` from `npm run plan`.
- `jobs/<name>/build/layout.json`: what the layout pass moved, hid or placed in the safe area. `build/boxes.json`: the boxes verify measured.
- `jobs/<name>/verify/`: stills (including the middle of every graphic's window), `contact.png`, `report.md`.
- `teardown/<name>/`: `Reel.md`, `teardown.md`, `contact.jpg`.

Success lines to look for: `CHECK PASS`, `SMOKE PASS`, `VERIFY PASS`, `REELMD PASS`, `PLAN OK`, `CONTRACT PASS`, `READY` (effects:setup), `Reel: <path>`. With `--json` the last line is a JSON result with `ok`.

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
| `VERIFY FAIL ... overlaps` | two graphics at once: move one in the Reel.md; a caption on a graphic: render again (the layout pass runs on every render) |
| `VERIFY FAIL ... UI zone` | render with `--export <name>` so the layout keeps clear of that platform's UI |
| `No transcript in <job>` (plan) | draft first: `npm run reel -- <clip> --name <job> --draft` |
| `WARNING: ... person mask is not set up` | behind or auto layers stay in front; ask, then `npm run effects:setup` |
| `spoken match: ... sounds alike` | check the word, and add it under `## Aliases` if it is right |
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
