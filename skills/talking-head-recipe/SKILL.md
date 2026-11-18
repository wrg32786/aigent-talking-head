---
name: talking-head-recipe
description: "Write, edit, share or apply a Reel.md, the plain-Markdown recipe for an aigent-talking-head reel (brand kit, music and beat sync, finish per shot, shot list, titles with entrance and front/behind layer, caption style, effects). Also recreates a style from a description of a reference reel. Use when someone wants to save a reel's style, reuse a look, describe the edit they want, or remake a style with a new clip."
---

# Reel.md recipes

A Reel.md is a VIDEO.md-compatible Markdown file that describes one reel's style and structure. Spec: `docs/reel-md.md` in the aigent-talking-head repo. Examples: `examples/recipes/`. Work inside an aigent-talking-head checkout; if there is none, read https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/INSTALL.md and follow it.

## Commands

```
npm run reelmd -- check my.Reel.md                      # validate and summarize
npm run reel -- --recipe my.Reel.md --clip inbox/x.mp4  # make a reel with it (add --draft to review first)
npm run reelmd -- export <job> --out my.Reel.md         # a finished reel back to a recipe
npm run reelmd -- compile my.Reel.md --out dir/         # recipe.cut.json + recipe.captions.json
npm run reelmd -- package my.Reel.md out/               # full VIDEO.md package
```

## Write one from a description

When the user describes a reel they like ("fast cuts, one word at a time, black and white flashback, big yellow title that slams in behind the guy's head"):

1. Start from the closest example in `examples/recipes/`, or the closest preset. If the user has already recorded, draft their clip and run `npm run plan -- <job> --base <that recipe>`: it adds graphics proposed from what they said.
2. Map each thing they said to a field: caption style, place and colour, look, caption layer (front, or behind the head: words over the hair are hidden by it), screen-card layer (behind the top of the head by default: hair goes over a card it reaches into, the face never does), titles (entrance, layer, text), graphics in a `reel-graphics` block (all 30 in `kit/graphics.json`: ordinal-sticker, app-label and screen-card, with their own icon and screen files or a confirmed public page as a card's `source`; and lower-third, stat-callout, checklist, quote-card, highlight, step-counter, versus, icon-badge, sticker-pop, price-tag, cta-card, code-card, data-chart, chapter-card, logo-bug, channel-bug, terminal-session, news-strap, ticker, split-flap, feature-cards, release-pill, cta-button, hud-callout, flash-card, keyword-caption and number-pop, whose words must be words the user says; names and brands transcription mishears go in `## Aliases`), the one-word caption look (`caption-outline`, `caption-shadow`, `caption-case`), finish per shot, punch, transition, bed and beat sync, colours, fonts. Use only names from `npm run menu`.
3. Write the shot list in story order (hook, beats, payoff) with times that fit their clip length. Keep entrances unique (nine exist, each once). For a list video, a `reel-cards` block gives each item a chapter card (`| bg olive | chapter 1`), and `place` on a title sets it beside the head, across the chest or big over the face (`examples/recipes/magazine.Reel.md`).
4. Run `npm run reelmd -- check` and fix every error.
5. Show the user the summary it prints and the parts you guessed. Let them change it.
6. Offer the menu for anything they did not specify (see the talking-head-reel skill), then make the reel with `--recipe`.

If they have the reference video itself, use the talking-head-teardown skill instead.

## Rules

- Flags beat the recipe; the recipe beats its preset; after a draft, `build/cut.json` and `build/captions.js` are the source of truth.
- Title text in a recipe is a pattern. By default the remake keeps the user's own words and applies the recipe's entrance and layer in order. `--recipe-titles` uses the recipe's text and times, only where the user says that text. Ordinal stickers and app labels likewise show only words the user says (the ordinal they speak, an app they name); the reference's words never appear.
- No em dashes in any copy you write into a recipe.
