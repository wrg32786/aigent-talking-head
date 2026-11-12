---
videomd: 1
name: aigent-default
description: The AIgent house style for a 25 second talking-head reel. Hook, three beats, payoff. Kinetic captions, cyan accent, one or two punch titles behind the head.
source:
  file: inbox/my-clip.mp4
  duration: 25
shots: 5
lang: en
generator:
  name: aigent-talking-head
  version: 1.3.0
x-reel: 1
---

# AIgent default

Every word animates in. One kinetic title per beat, in front of you, with the strongest one or two tucked behind your head. Grain and vignette alternate across shots.

## Brand kit
- preset: aigent
- theme: aigent
- colors: #0b0f14, #22d3ee, #ffffff
- fonts: theme
- logo: none

## Music
- bed: rise-with-the-beat
- bed-start: 0
- bed-volume: 0.16
- beat-sync: on

## Style
- look: kinetic
- captions: kinetic
- titles: on
- title-layer: auto
- finish-pool: grain, vignette
- transition: glitch
- punch: on
- effects: lean-in, backdrop-word, checklist

## Shots

```videomd-timeline
#01 0-3 | story hook | finish grain
#02 3-8 | story problem | punch big
#03 8-14 | story proof
#04 14-20 | story how
#05 20-25 | story payoff | punch big | finish vignette
```

## Titles

```reel-titles
#01 0.3-1.8 | entrance slam | layer behind | text Stop scrolling
#02 3.2-4.6 | entrance blur-rise | layer front | text The problem
#03 8.2-9.6 | entrance stagger-rise | layer front | text Proof
#04 20.2-22 | entrance pop-zoom | layer auto | text Do this
```
