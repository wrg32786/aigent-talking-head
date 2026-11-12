---
videomd: 1
name: cinematic
description: A slower 30 second reel with a film grade. Teal and orange on the talking shots, mono on the flashback, crossfades, editorial type and the cinematic-build bed.
source:
  file: inbox/my-clip.mp4
  duration: 30
shots: 5
lang: en
generator:
  name: aigent-talking-head
  version: 1.3.0
x-reel: 1
---

# Cinematic

Editorial fonts, kinetic captions, a film transition between shots. Each shot gets its own finish so the look changes with the story.

## Brand kit
- preset: cinematic
- theme: aigent
- colors: #101418, #e0a458, #2a9d8f
- fonts: editorial
- logo: none

## Music
- bed: cinematic-build
- bed-volume: 0.14
- beat-sync: on

## Style
- look: kinetic
- captions: kinetic
- titles: on
- title-layer: auto
- finish: none
- transition: film
- punch: on
- effects: spotlight, slow-push

## Shots

```videomd-timeline
#01 0-5 | story hook | finish teal,vignette
#02 5-11 | story then | finish mono,grain | transition crossfade
#03 11-18 | story turn | finish teal | punch big
#04 18-24 | story now | finish warm,grain
#05 24-30 | story payoff | finish crushed,vignette | punch big
```

## Titles

```reel-titles
#01 0.4-2.2 | entrance blur-rise | layer behind | text Ten years ago
#02 11.2-13 | entrance slide-left | layer front | text Then this
#03 24.3-26.5 | entrance stagger-rise | layer auto | text Now
```
