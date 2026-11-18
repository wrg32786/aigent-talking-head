---
videomd: 1
name: magazine
description: A list video in the magazine style. Serif and sans mixed in one phrase, titles set around the head, olive and cream cards, numbered chapter cards, sound on the moves and no dead air.
source:
  file: inbox/my-clip.mp4
  duration: 30
shots: 0
lang: en
generator:
  name: aigent-talking-head
  version: 1.3.0
x-reel: 1
---

# Magazine

Common short-form editing advice, built in. One line turns it on: `- preset: magazine` below (or `npm run reel -- --preset magazine`). Every phrase mixes a serif numeral or hero word, one italic serif word and sans text. Titles sit beside your head, across your chest, or big over your face and behind your head. A short line you want to land cuts to a flat olive or cream card; a list gets a numbered chapter card per item and an intro where the numbers pop in around your head. The bed is picked by the energy of what you say. Pauses over 0.3 s are cut out, and every other cut punches in 12%.

## Brand kit
- preset: magazine
- theme: magazine
- fonts: playfair
- logo: none

## Music
- bed: auto
- energy: auto
- bed-volume: 0.14

## Style
- look: kinetic
- captions: kinetic
- titles: on
- title-layer: front
- title-places: left, face, right, chest
- transition: crossfade
- punch: 0.12
- tighten: 0.3
- cards: auto
- card-palette: olive, ivory, sage, clay
- sfx-map: on
- sfx-cap: 0.35/5

## Titles

```reel-titles
#01 0.3-1.8 | entrance typewriter | place left | accent script | text Five easy edits
#02 4.0-5.4 | entrance blur-rise | place face | text Fonts
#03 9.0-10.4 | entrance pop-zoom | place right | text Cards
#04 14.0-15.4 | entrance stagger-rise | place chest | text Sound
```

## Cards

```reel-cards
#01 2.6-3.8 | bg olive | chapter 1
#02 7.6-8.8 | bg ivory | chapter 2
#03 12.6-13.8 | bg olive | chapter 3
#04 21.0-22.4 | bg sage
```
