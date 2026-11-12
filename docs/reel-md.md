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
| preset | a name from `npm run preset -- --list`, `auto`, or `none` | the base style the rest of the recipe changes |
| theme | `aigent`, `neutral`, or `kit/themes/<name>.js` | `--theme` |
| colors | hex list | kept with the recipe for the brand kit and teardowns; the render uses the theme's colours |
| fonts | a pairing from `kit/fonts/pairings.json`, or a comma list to cycle | `--fonts` |
| logo | a file path next to the recipe, or `none` | `--logo` |

**Music** (`## Music`)

| Key | Values | Maps to |
|---|---|---|
| bed | a library name (`npm run music`), a file next to the recipe, or `none` | `--bed` |
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
| titles | `on` or `off` | `--no-titles` |
| title-layer | `front`, `behind`, `auto` | `--title-layer` |
| finish | finish names, comma list, or `none` (on the whole reel) | `--finish` |
| finish-pool | finish names to vary across shots | the preset's `finishPool` |
| transition | a name from `kit/transitions.json` | segment `transition` |
| punch | `on` or `off` | `--no-punch` |
| effects | effect ids for the optional `npm run fx` pass | the preset's `effectsFavourites` |

**Shots** (fenced `videomd-timeline`): one line per shot, in order, times in seconds on the reel clock.

| Key | Values | Maps to |
|---|---|---|
| story | free text (hook, beat, payoff, ...) | a note for people and agents |
| finish | finish names, comma list | that segment's `finish` |
| punch | `big` | that segment's `bigPunch` |
| transition | a transition name | the transition into that segment |
| src, in, out | a file and its in and out points | full segments (see below) |
| any `key~` | a guess, written by a teardown (VIDEO.md marks inferred keys with `~`) | not used by the render |

**Titles** (fenced `reel-titles`): one line per kinetic title.

| Key | Values | Maps to |
|---|---|---|
| entrance | `stagger-rise`, `slam`, `blur-rise`, `slide-left`, `elastic`, `flip`, `pop-zoom` (each once per reel) | the title's `entrance` |
| layer | `front`, `behind`, `auto` | the title's `layer` |
| hero | word indexes, comma list | the title's `hero` |
| text | the words | the title's `text` |

**Graphics** (fenced `reel-graphics`, optional): one line per graphic, times on the reel clock. The kit's own generic designs, listed in `kit/graphics.json` and in `npm run menu`.

```reel-graphics
#01 2.5-3.5 | type ordinal-sticker | text FIRST | layer behind | color #f2e8a0
#02 2.8-4 | type app-label | text My App | icon my-icon.png
#03 4-9 | type screen-card | src my-screen.mp4 | border #d87b5b
```

| Key | Values | Maps to |
|---|---|---|
| type | `ordinal-sticker` (mode 9, entrance burst-pop), `app-label` (mode 10, tile-pop), `screen-card` (mode 11, card-rise) | the flip's `mode` |
| text | the ordinal word or the label | the flip's `text` |
| layer | `front` or `behind` (ordinal sticker: the burst goes behind your head, with the person mask) | `layer` |
| color, ink | burst colour and word colour (ordinal sticker) | `color`, `ink` |
| icon, tile | an image for the app tile (relative to the Reel.md), or leave it out for a generic glyph on a `tile` colour | `icon`, `tile` |
| src, border, in | an image or a video for the screen card (relative to the Reel.md), its border colour, and seconds into the video | `src`, `border`, `in` |
| x, y, w, size | position (0 to 1), card width (0 to 1), burst radius or tile side in pixels | the same keys |

With no `icon` or `src` the graphic is drawn as a neutral placeholder (a letter glyph, a fake code window), so a teardown never copies someone else's screenshots or logos. Graphics outside your clip's length are dropped.

**Script** (fenced `reel-script`, optional): `#NN start-end | say <words>`. Written by teardowns so you can see the reference's timing. Your remake uses your own words.

## How a recipe is applied

`npm run reel -- --recipe Reel.md --clip <file>` drafts the reel from your clip as usual (Whisper, best takes, retakes skipped), then lays the recipe over it:

- Brand kit, music and style apply like a preset.
- Shot lines apply in order to the segments drafted from your clip: shot 1 to segment 1, and so on. Extra shots are ignored; extra segments keep the defaults.
- Caption position and colour apply to your captions; graphics apply at their times (those past the end of your clip are dropped).
- Titles apply their entrance and layer, in order, to the titles drafted from your words. Add `--recipe-titles` to use the recipe's title text and times instead.
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
