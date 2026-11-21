# Reel.md

A Reel.md is the recipe for one talking-head reel, written in plain Markdown. People can read it, agents can write it, and `kit/reelmd.cjs` compiles it into the `cut.json` and caption settings the pipeline renders. Any finished reel can be exported back to a Reel.md, so a style you like can be shared, versioned and remade with someone else's clip.

```
npm run reelmd -- check examples/recipes/aigent-default.Reel.md     # parse, validate, print a summary
npm run reel -- --recipe examples/recipes/aigent-default.Reel.md --clip inbox/my-clip.mp4
npm run reelmd -- export <job>  --out my-style.Reel.md               # a finished job back to a recipe
npm run reelmd -- compile my-style.Reel.md --out build/              # recipe.cut.json + recipe.captions.json
npm run reelmd -- package my-style.Reel.md out/my-style              # a full VIDEO.md package
npm run teardown -- reference.mp4                                    # a reference reel to a Reel.md (docs/teardown.md)
```

## VIDEO.md compatible

Reel.md is a profile of [VIDEO.md](https://videomd.github.io/videomd/), the open format for describing a video layer by layer (spec and reference validator at [videomd/videomd](https://github.com/videomd/videomd), Apache-2.0). It does not compete with it:

- The front matter is a VIDEO.md card: `videomd: 1`, `name`, `description`, `source` (`file`, `duration`), `shots`, `lang`. Reel.md adds `x-reel: 1`. VIDEO.md readers ignore fields they do not know.
- The shot list is a fenced `videomd-timeline` block with VIDEO.md's line syntax: `#NN start-end | key value | key value`. Reel.md adds its own keys on the same lines.
- `npm run reelmd -- package` writes a full VIDEO.md package (`VIDEO.md`, `video/timeline.md`, `video/shots/NN.md`) that passes the `videomd` validator.
- A teardown made with rea-video is a VIDEO.md package, and `kit/videomd2reel.cjs` turns it into a Reel.md.

A Reel.md is one file because a recipe should be easy to paste into a chat. The full package form is there for tools that read VIDEO.md.

## A small example

````markdown
---
videomd: 1
name: my-style
description: Kinetic captions, one slam title behind the head, warm then teal.
source:
  file: inbox/my-clip.mp4
  duration: 20
shots: 3
lang: en
x-reel: 1
---

# My style

## Brand kit
- preset: aigent
- colors: #0b0f14, #22d3ee
- fonts: druk

## Music
- bed: rise-with-the-beat
- beat-sync: on

## Style
- captions: kinetic
- title-layer: front
- finish: grain

## Shots

```videomd-timeline
#01 0-4 | story hook | finish warm
#02 4-12 | story proof | punch big
#03 12-20 | story payoff | finish teal,vignette
```

## Titles

```reel-titles
#01 0.3-1.8 | entrance slam | layer behind | text Stop scrolling
#02 12.2-14 | entrance pop-zoom | text Do this
```
````

## Fields

Every section is optional except the card. Anything left out falls back to the preset, then to the built-in default.

**Brand kit** (`## Brand kit`)

| Key | Values | Maps to |
|---|---|---|
| preset | a name from `npm run preset -- --list`, `auto`, or `none` (`magazine` turns on every editing principle, see [guide.md](guide.md#editing-principles-built-in)) | the base style the rest of the recipe changes |
| theme | `aigent`, `neutral`, or `kit/themes/<name>.js` | `--theme` |
| colors | hex list | kept with the recipe for the brand kit and teardowns; the render uses the theme's colours |
| fonts | a pairing from `kit/fonts/pairings.json`, or a comma list to cycle | `--fonts` |
| logo | a file path next to the recipe, or `none` | `--logo` |

**Music** (`## Music`)

| Key | Values | Maps to |
|---|---|---|
| bed | a library name (`npm run music`), a file next to the recipe, `auto` (a library bed picked by energy), or `none` | `--bed` |
| energy | `low`, `mid`, `high` or `auto` (auto reads how fast you talk: 3.2 words a second or more is high, 2.3 or less is low) | `--music-energy`, picks a library bed tagged with that energy (`beds.json` `energy`) when the recipe names no bed or `bed: auto` |
| bed-start | seconds into the track | `--bed-start` |
| bed-volume | 0 to 1 (default 0.16) | `cut.json` `bedVol` |
| beat-sync | `on` or `off` | `--beat-sync` / `--no-beat-sync` |
| bpm | number | the reference tempo, written by teardowns for picking a bed; not used by the render |

**Style** (`## Style`)

| Key | Values | Maps to |
|---|---|---|
| look | `kinetic`, `oneword`, `muse`, `classic`, `one-word` | `--look` |
| captions | `kinetic`, `oneword`, `pill`, `hormozi`, `karaoke`, `classic`, `one-word` | `--style` |
| caption-position | `top`, `middle`, `bottom` | `--caption-position`, the captions' band |
| caption-color | `#rrggbb` | `--caption-color`, the caption word colour (the one-word word, classic and pill text, the hormozi highlight) |
| caption-outline | `none`, `thin`, `thick` (default thick) | `--caption-outline`, the one-word caption's outline |
| caption-shadow | `none`, `soft` (default soft) | `--caption-shadow`, the one-word caption's shadow |
| caption-case | `upper`, `lower`, `as-said` (default upper) | `--caption-case`, the one-word caption's letter case |
| caption-layer | `front`, `behind`, `auto` (default auto: behind for top captions, front elsewhere) | `--caption-layer`. Behind draws captions under the person mask, like a behind title: any part over the head or hair is hidden, the rest stays fully visible. The mask runs over the caption spans, and top one-word captions are lifted so they sit on the highest point the head reaches (only the bottom of the letters tucks behind the hair). The legibility check measures only the visible part |
| panel-layer | `front`, `behind`, `auto` (default auto, which is behind) | `--panel-layer`, every screen card and b-roll panel in the reel (a card's own `layer` wins). Behind draws the panels on their own layer, then the top of your head over them: the person mask from the top of your hair down to about half a head width (above the eyes, `kit/headmask.py --crown`). A panel that reaches into the top of your head goes behind your hair; your face, chin, neck and body never cover a panel, so a card at chest or chin level stays fully in front. Where your hair never reaches a panel it looks the same as front. The mask runs over every card span |
| caption-entrance | `pop`, `unfurl`, `cascade`, `orbit`, `warp`, `crystallize`, `compute`, `levitate`, `undulate`, `typewriter` (default pop) | `--caption-entrance`, how kinetic hero words come in: pop springs the whole word; the others move letter by letter (unfurl opens each letter from its left edge, cascade drops them in, orbit swings them in on an arc, warp stretches and settles, crystallize gathers scattered blurred letters, compute decodes from random characters, levitate floats them up, undulate rides a wave that calms). A caption flip's own `entrance` wins |
| titles | `on` or `off` | `--no-titles` |
| title-layer | `front`, `behind`, `auto` | `--title-layer` |
| finish | finish names, comma list, or `none` (on the whole reel) | `--finish` |
| finish-pool | finish names to vary across shots | the preset's `finishPool` |
| transition | a name from `kit/transitions.json` | segment `transition` |
| punch | `on`, `off`, or a zoom such as `0.12` (12%) | `--no-punch`; a number sets `cut.json` `punch` (every other cut punches in by that much) |
| tighten | `off`, `on` (0.3) or the longest pause to keep in seconds | `--tighten` / `--no-tighten`: no dead air, a pause inside a line longer than this cuts to a jump (0.12 s of breath stays) |
| cards | `auto` or `off` | `--cards`: colour cards on short lines to land, chapter cards and the number-pop intro on a counted list |
| card-palette | card colours to use, in order: `olive`, `ivory`, `sage`, `clay`, `blush`, `forest`, `navy`, `cream`, `paper`, `blue`, `ink`, or `#rrggbb` | the preset's `cardPalette` (chapter cards alternate the first two) |
| title-places | places drafted titles take in turn: `left`, `right`, `above`, `chest`, `face`, `center` | the preset's `titlePlaces` |
| sfx-map | `on` or `off` | `cut.json` `sfxMap`: a whoosh on named transitions, a swipe on cards, a pop on titles, graphics and list numbers, typing under a typewriter title, a click on a big punch-in |
| sfx-cap | `off`, or `min gap / per 10 s`, for example `0.4/4` (default 0.25/6, on for every reel) | `cut.json` `sfxCap`, `--no-sfx-cap` |
| glitch | `on` or `off` | `off` drops the glitch shake on every seam (the magazine preset) |
| effects | effect ids for the optional `npm run fx` pass | the preset's `effectsFavourites` |

**Shots** (fenced `videomd-timeline`, optional): one line per shot, in order, times in seconds on the reel clock. Leave the block out and every segment keeps the default finish, punch and transition; `shots:` in the card then only describes the reference (the check warns, it does not fail).

| Key | Values | Maps to |
|---|---|---|
| story | free text (hook, beat, payoff, ...) | a note for people and agents |
| finish | finish names, comma list | that segment's `finish` |
| punch | `big` | that segment's `bigPunch` |
| transition | a transition name | the transition into that segment |
| src, in, out | a file and its in and out points | full segments (see below) |
| framing | the reference's shot size: `close-up`, `extreme close-up`, `medium close-up`, `medium shot`, `wide` | with `--recut` (Studio's Recreate), that shot's punch: close-up 1.16, extreme close-up 1.3, medium close-up 1.06, medium or wider 1, never the same two shots in a row |
| cutaway | `on`: the reference cut away from the speaker here (B-roll, a screen) | `cut.json` `refShots` marks the shot, for B-roll |
| broll | with `cutaway on`: what the reference shows there, in a few words (`a screen recording of OmniRoute`) | the B-roll spot's idea and search, and its length is the shot's (`refShots` `broll`) |
| move | the camera inside the shot: `push` (a slow push-in), `pull` (a slow pull-out), `drift` (a gentle push, for a pan or a track) | that segment's `push` (zoom gained over the segment: 0.07, -0.07, 0.035) |
| shake | `on`: a handheld or shaking camera, or a shake cut | a shake hit on the cut into that segment (`cut.json` `hits`) |
| any `key~` | a guess, written by a teardown (VIDEO.md marks inferred keys with `~`) | not used by the render |

**Recut** (`npm run reel -- --recipe <Reel.md> --recut`, and every Studio Recreate draft): your edit is re-cut to the shot list. The shot lengths are scaled to your edit's length, and each cut goes on a word boundary: a seam you already have when one is near, else the quiet between two words read from the audio (`kit/shotplan.cjs`, with `kit/cutpoints.cjs`). A cut never lands inside a word: the quiet must hold the fade on both sides (at least 0.14 s). With no quiet near a reference cut, that cut is left out and the two shots play as one. The audio runs on across a new cut, only the picture changes (no glitch hit on it), and each shot gets its line's settings and framing. `cut.json` `refShots` lists the shots.

**Sound effects** (fenced `reel-sfx`, optional, written by a teardown): the reference's sounds and when they play. With `--recut` the times are scaled to your edit and placed as `cut.json` `sfxHits` (the density cap still applies), instead of the default whoosh and boom.

```reel-sfx
#01 2-2.2 | type pop | sound 11-pop-sticker
#02 6-6.6 | type ding | sound 14-ui-notification | on~ cut
```

| Key | Values | Maps to |
|---|---|---|
| type | what the reference's sound is: `pop`, `ding`, `click`, `whoosh`, `swipe`, `boom`, `riser`, `typing`, `shutter`, `cash`, `shimmer`, `glitch`, `tick`, `sub` | the kit sound when `sound` is left out (anything else: `10-pop-bubble`) |
| sound | a kit sound id (`npm run menu`, `kit/sfx/sfx.json`) | the `sfxHits` id |

**Titles** (fenced `reel-titles`): one line per kinetic title.

| Key | Values | Maps to |
|---|---|---|
| entrance | `stagger-rise`, `slam`, `blur-rise`, `slide-left`, `elastic`, `flip`, `pop-zoom`, `drop`, `typewriter` (each once per reel; drop lets each letter fall in from above with a small bounce; typewriter types the letters on behind a blinking caret) | the title's `entrance` |
| place | `left`, `right`, `above`, `chest`, `face`, `center` (default center) | the title's `place`: beside your head at eye level, above it, across your chest, or big over your face. `face` sits behind your head unless `layer front`, and moves above your head when the head would cover more than 22% of its letters. Your head is measured with the person mask |
| accent | `script`, or a word index | three faces in one phrase: one partner word in the pairing's italic serif (the `playfair` and `dmserif` pairings do this on every phrase) |
| layer | `front`, `behind`, `auto` | the title's `layer` |
| hero | word indexes, comma list | the title's `hero` |
| role | `hook`, `number`, `timer`, `brand` or `line` (a teardown writes it) | with `--recut`, your titles take the entrance, layer and place of the recipe title with the same role (the hook claim up front, a number, a time, a brand name), then the rest in order |
| text | the words | the title's `text` |

**Cards** (fenced `reel-cards`, optional): one line per colour card, times on the reel clock. The frame cuts to one flat colour while your voice runs on, and the caption words you are saying sit on it in the card's ink. With `chapter N` it is a numbered chapter card: a big serif numeral with your words under it, one per list item.

```reel-cards
#01 2.6-3.8 | bg olive | chapter 1
#02 7.6-8.8 | bg ivory | chapter 2
#03 21-22.4 | bg sage
```

| Key | Values | Maps to |
|---|---|---|
| bg | `olive`, `ivory`, `sage`, `clay`, `blush`, `forest`, `navy`, `cream`, `paper`, `blue`, `ink`, or `#rrggbb` | the card's colour (each named colour brings its own ink) |
| ink | `#rrggbb` | the word colour, when bg is a hex colour |
| chapter | a number | the numeral on a chapter card |

A card is at most 4 s. Titles that would start on a card are left off (the card is the headline). `- cards: auto` under Style proposes them from what you say instead (`kit/cards.cjs`), and `npm run plan -- <job> --cards` writes the proposals here for you to review.

**Graphics** (fenced `reel-graphics`, optional): one line per graphic, times on the reel clock. The kit's own generic designs, listed in `kit/graphics.json` and in `npm run menu`.

```reel-graphics
#01 2.5-3.5 | type ordinal-sticker | text FIRST | layer behind | color #f2e8a0
#02 2.8-4 | type app-label | text My App | icon my-icon.png
#03 4-9 | type screen-card | src my-screen.mp4 | border #d87b5b
#04 9.5-12 | type lower-third | text Will Gwyn | sub writes The AIgent
#05 12-15 | type checklist | text Ship it | items Record; Caption; Post
#06 15-17 | type stat-callout | text 10,000+ | sub readers
#07 17-19 | type versus | left Manual | right Agent
#08 19-21 | type highlight | shape arrow | text this part | x 0.62 | y 0.62
#09 21-24 | type cta-card | text Follow for more | sub @theaigent
```

| Key | Values | Maps to |
|---|---|---|
| type | `ordinal-sticker` (mode 9, entrance burst-pop), `app-label` (mode 10, tile-pop), `screen-card` (mode 11, card-rise), `lower-third` (12, bar-wipe), `stat-callout` (13, count-up), `checklist` (14, tick-in), `quote-card` (15, quote-unfold), `highlight` (16, draw-on), `step-counter` (17, step-tick), `versus` (18, split-slam), `icon-badge` (19, badge-spin), `sticker-pop` (20, scatter-pop), `price-tag` (21, chip-rise), `cta-card` (22, cta-rise), `code-card` (23, type-on), `data-chart` (24, bars-grow), `chapter-card` (25, chapter-wipe), `logo-bug` (26, bug-in), `channel-bug` (27, bug-in), `terminal-session` (28, term-rise), `news-strap` (29, strap-wipe), `ticker` (30, ticker-slide), `split-flap` (31, flap-in), `feature-cards` (32, cards-deal), `release-pill` (33, pill-pop), `cta-button` (34, button-press), `hud-callout` (35, lock-on), `flash-card` (36, flash-cut), `keyword-caption` (37, block-in), `number-pop` (38, num-pop) | the flip's `mode` |
| scene | with `type scene`: a scene id (`ref-...`) from `scenes.json` beside the Reel.md, else the scene library (`scenes/local/`, `SCENES_DIR`). A scene is HTML and CSS (no scripts, only `data:` URLs), `seconds`, and a `box` { x, y, w, h } as fractions of the frame; `{{text}}` in it shows the longest word you say from its start to a second later, and a scene that needs a word with none said there is left out. On `--recut` its time is scaled like the other graphics. Mode 39. | `scene`, `html`, `css`, `x`, `y`, `w`, `h` |
| text | the ordinal word, the label, the name, the number, the quote, the price, the line, or the code (`\n` for a new line; a code card keeps `/` as written, elsewhere ` / ` reads as a space) | the flip's `text` |
| sub | the small second line: lower third, stat label, quote attribution, old price (struck through), CTA handle | `sub` |
| items, at | checklist rows separated by `;`, and optional tick times in reel seconds (a recipe job sets them from when you say each row) | `items`, `at` |
| cues | words you say, separated by `;`, or seconds into the graphic: each beat lands when its word is said (chart bars, terminal commands, feature cards, the CTA button click, flash cards, the keyword caption, the screen card pointer). Repeated words land in order; a cue you never say is spread between its neighbours. A recipe job turns them into `at` times | `cues`, `at` |
| values, labels, kind | data chart: the numbers (`1.2k; 3.8k; 9k`, the format is kept as they count up), the label under each, and `bar` or `line` | the same keys |
| details | feature cards: a short line under each item, `;` between, in the same order (a line you never say is left blank) | `details` |
| tag, keyword, case | news strap, release pill, keyword caption: the small tag (BREAKING, NEW); the keyword caption's word on the accent block and `upper` or `as-said` | the same keys |
| corner, opacity, live, clock | logo bug and channel bug: `tl`, `tr`, `bl` or `br`; the bug's opacity (0 to 1); the LIVE pill word (default LIVE) and a clock start (`21:04` or `21:04:30`, `none` hides it; default counts up from the start) | the same keys |
| speed, bg | ticker scroll speed in px per second; flash cards: one ground colour (`#rrggbb`) for every card, else they alternate the accent and ink | the same keys |
| cursor, cam, style | screen card: pointer stops `x y; x y` (0 to 1 of the card, it clicks at each) and camera keys `zoom x y; zoom x y`; stat callout: `style odometer` rolls the digits instead of counting | the same keys |
| left, right | the two halves of a versus card (or `text A vs B`) | `left`, `right` |
| shape | highlight: `circle`, `arrow`, `underline` or `box` (the arrow's tip sits at x, y) | `shape` |
| glyph | icon badge, sticker pop, CTA card, feature cards: `check`, `star`, `bolt`, `heart`, `fire`, `play`, `bell`, `spark`, `plus`, `lock`, and outline only (not sticker pop) `arrow`, `rocket`, `terminal`, `chart`, `world`, `cpu`. Sticker pop and feature cards take several: `heart;star` | `glyph` |
| step, of, count, h, title | step counter: this step and how many; sticker pop: how many stickers; number pop: how many numbers (2 to 10); highlight: height (0 to 1); code card: the tab name | the same keys |
| layer | `front` or `behind` (ordinal sticker: the burst goes behind your head, with the person mask). Screen card and modes 12 to 38: `front`, `behind` or `auto`. Behind: the top of your head (hair and crown) goes over the graphic where it reaches into it; your face and body stay under it. Auto is behind for a screen card, and for the others behind when the graphic sits high in the frame (y below 0.45), else front | `layer` |
| color, ink | the graphic's colour (default the theme accent): the burst, bar, number, ticks, strokes, tag or button; ink is the word colour on an ordinal sticker or a price tag | `color`, `ink` |
| icon, tile | an image for the app tile or the icon badge (relative to the Reel.md), or leave it out for a generic glyph on a `tile` colour | `icon`, `tile` |
| src, border, in | an image or a video for the screen card (relative to the Reel.md), its border colour, and seconds into the video | `src`, `border`, `in` |
| x, y, w, size | position (0 to 1), card width (0 to 1), burst radius or tile side in pixels | the same keys |
| head, head-y | ordinal sticker: burst width in head widths, and its centre below the head centre in head widths. The remake measures your head with the person mask and sets size and y from them | `size`, `y` |
| source | screen card: a public page (`https://github.com/owner/repo`, a site, a tool's docs) or a file. A page is captured by `npm run capture -- --recipe <Reel.md>` (or `npm run reel -- --capture-sources`) to a screenshot and a short scrolling recording, cached in `assets/web/` (gitignored) | `src` |
| subject~, source~ | written by a teardown: what the reference showed in that card, and a web address read in it. Guesses, never captured until you write `source` | not used by the render |

With no `icon`, `src` or captured `source` the graphic is drawn as a neutral placeholder (a monogram tile, a skeleton app window), so a teardown never copies someone else's screenshots or logos. Modes 12 to 38 are drawn in code in the theme's colours and fonts with Tabler icons (MIT), a shared card look (two-layer shadow, top-lit fill, fine grain, rim light), spring and emphasized easing and motion blur on fast moves (the AIgent theme keeps their cards square). Each has its own exit over its last 0.35 s. Graphics outside your clip's length are dropped. A teardown detects the first three; you add the rest.

**Aliases** (`## Aliases`, optional): how transcription hears names and brands you say, one bullet per word, `;` or `,` between spellings. Captions and titles are written the way you spell the word. Without a recipe, `npm run reel -- --aliases "Gwyn: Guinn, Gwin"` does the same (and adds to a recipe's list).

```
## Aliases
- aigent: agent, a gent
- Gwyn: Guinn, Gwen
```

The spoken check counts any listed spelling as the word, and `npm run plan` writes the word you mean (aigent) where the transcript has the heard one (agent).

**Script** (fenced `reel-script`, optional): `#NN start-end | say <words>`. Written by teardowns so you can see the reference's timing. Your remake uses your own words.

## Planned recipes

`npm run plan -- <job>` writes a recipe for a drafted job from what you said: a Graphics block of proposals (each with a `why` field) and, if you pass `--base <Reel.md>`, that recipe's style, music and shots. Run it again with `--fresh` to replace its own proposals; lines without `why` are yours and always stay. Render it with `npm run reel -- --recipe jobs/<job>/Reel.md --clips jobs/<job>/clips --name <job> --force`.

With cards on (`--cards`, or a base recipe that uses them, such as `examples/recipes/magazine.Reel.md`) it also writes a Cards block: a chapter card on each item of a list you count off (first, second, number three), an olive or cream card on a short line to land, and a `number-pop` graphic over the hook of a list. Each line says why.

## How a recipe is applied

`npm run reel -- --recipe Reel.md --clip <file>` drafts the reel from your clip as usual (Whisper, best takes, retakes skipped), then lays the recipe over it:

- Brand kit, music and style apply like a preset.
- Shot lines apply in order to the segments drafted from your clip: shot 1 to segment 1, and so on. Extra shots are ignored; extra segments keep the defaults.
- Caption position and colour apply to your captions; graphics apply at their times (those past the end of your clip are dropped).
- Titles apply their entrance and layer, in order, to the titles drafted from your words. Add `--recipe-titles` to use the recipe's title text and times instead; a recipe title is kept only if you say its words around its time, otherwise it is dropped.
- On-screen words come from what you say, never from the reference (`kit/spoken.cjs`). Ordinal stickers show the ordinals you say ("second" gives a SECOND sticker as you say it), styled like the recipe's stickers in turn; recipe stickers with no ordinal said are dropped. App labels stay only if you name the app, and move to when you say it. A last check drops any title, sticker or label whose text you do not say in its window, and the log lists what was dropped and why. The same check covers the worded fields of modes 12 to 38 (`spoken` in `kit/graphics.json`). A graphic whose `required` field you do not say is dropped (a lower third without the name, a stat without the number); any other field you do not say is left off and the graphic kept (a CTA button keeps its button when you never say the sub line, a lower third keeps the name without the title). A checklist, ticker or feature cards keep the rows you say and tick each as you say it. A word heard as a near-homophone counts ("aigent" heard as "agent", "Grok" as "grock": same consonants, one letter apart); numbers never match loosely. The log lists every drop, every field left off and every loose match. Numbers count when said as words ("ten thousand" for 10,000) and a handle counts when said as words run together ("the aigent" for @theaigent). A code card is your code and a sticker pop has no words, so neither is checked. Screen cards keep the recipe's times (your file, a confirmed source, or a placeholder).
- App labels stay up at least 1.2 s, and the name's reveal always finishes, so the full name shows.
- When every shot names a `src`, `npm run reelmd -- compile` writes a complete `cut.json` you can drop into `jobs/<name>/build/` and render with `--rebuild`.

## Precedence

From strongest to weakest:

1. Flags on the command line (`--finish`, `--bed`, `--title-layer`, `--style`, ...).
2. The Reel.md.
3. The preset the Reel.md names (or `--preset`).
4. Built-in defaults.

After a draft, `build/cut.json` and `build/captions.js` are the source of truth. Edit them and run `npm run reel -- --rebuild --name <job>`. Export again to share the edited version.

## Credit

The idea of a shareable Markdown recipe that an agent reads came from [OpenMotion](https://github.com/nexu-io/openmotion)'s Motion.md (Apache-2.0). The card and timeline syntax follow [VIDEO.md](https://github.com/videomd/videomd) (Apache-2.0). No text or code was copied from either; see THIRD_PARTY.md.
