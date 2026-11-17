---
videomd: 1
name: launch-day
description: A 40 second product launch reel built on the newer graphics (modes 24 to 37). A split-flap hook, chapter cards, a release pill, a terminal session, feature cards, a chart, a news strap, flash cards and a CTA button, one at a time. No Shots block, so every cut keeps the default finish and transition.
source:
  file: inbox/my-launch.mp4
  duration: 40
shots: 6
lang: en
generator:
  name: aigent-talking-head
  version: 1.3.0
x-reel: 1
---

# Launch day

Use it when you ship something and want the reel to feel like a launch. Every word on a graphic has to be a word you say near its time, so read the script below as a pattern: say your own product's name, numbers and features, and the kit keeps only what you say. Or skip the pattern and run `npm run plan -- <job> --base examples/recipes/launch-day.Reel.md` after a draft: it keeps this style and proposes graphics from your own words.

## Brand kit
- preset: aigent
- theme: aigent
- fonts: theme
- logo: none

## Music
- bed: rise-with-the-beat
- bed-start: 0
- bed-volume: 0.14
- beat-sync: on

## Style
- look: kinetic
- captions: kinetic
- caption-position: bottom
- titles: off
- finish-pool: grain
- punch: on

## Aliases
- aigent: agent, a gent

## Graphics

```reel-graphics
#01 0.4-2.6 | type split-flap | text Launch day | sub version two
#02 3-5.4 | type release-pill | tag NEW | text Version two is live
#03 5.8-7.6 | type chapter-card | step 1 | of 3 | text Install | sub one command
#04 7.8-12.2 | type terminal-session | title zsh | text $ npx skills add aigent\n✓ installed | cues npx
#05 12.6-14.4 | type chapter-card | step 2 | of 3 | text Features | sub what is new
#06 14.6-20.4 | type feature-cards | items Plans; Exports; MCP | details graphics from your words; TikTok, Reels and Shorts; tools for your agent | glyph spark; play; terminal | cues plans; exports; MCP
#07 20.8-24.8 | type data-chart | text Render time | sub minutes | values 9; 4; 2 | labels v1; v1.5; v2 | kind bar | cues nine; four; two
#08 25.2-27.4 | type keyword-caption | text Twice as fast | keyword fast
#09 27.8-30 | type news-strap | tag LIVE | text Out today | sub free and open source
#10 30.4-32.2 | type flash-card | text Record; Plan; Post | cues record; plan; post
#11 32.6-34.6 | type chapter-card | step 3 | of 3 | text Try it | sub link in bio
#12 35-39.4 | type cta-button | text Follow the aigent | sub link in bio | cues follow
```

## Script

```reel-script
#01 0.3-2.8 | say Launch day. Version two is out.
#02 3-5.6 | say Version two is live right now.
#03 5.8-12.4 | say Step one, install: run npx skills add aigent and you are done.
#04 12.6-20.6 | say Here is what is new: plans, exports and MCP.
#05 20.8-27.6 | say Render time went from nine minutes to four to two. Twice as fast.
#06 27.8-34.8 | say It is out today, free and open source. Record, plan, post. Try it, link in bio.
#07 35-39.6 | say Follow the aigent for more.
```
