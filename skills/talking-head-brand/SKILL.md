---
name: talking-head-brand
description: "Set up and apply brand styles for aigent-talking-head reels: list, show, save and pick presets (aigent, one-word, hormozi-bold, karaoke, minimal-clean, cinematic, editorial, magazine, muse-pill, retro-scan-lines, neutral), import a brand guide into a draft preset, or let the agent choose. Use when someone wants their reels on brand, asks for a house style, or hands over a brand guide."
---

# Brand presets

Work inside an aigent-talking-head checkout; if there is none, read https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/INSTALL.md and follow it.

## Ask first

How do they want the look picked?

1. **A saved preset.** `npm run preset -- --list`, `npm run preset -- --show <name>`, then `npm run reel -- --clip <file> --preset <name>`.
2. **Customize.** Start from a preset and change it with flags (`--finish`, `--fonts`, `--style`, `--title-layer`, `--bed`); flags always win.
3. **Let you choose.** `--preset auto`, then tell them what you picked and why.

Point them at the presets sheet (`showcase/sheets/presets.jpg`) and `npm run menu`.

## Brand guide (optional)

A guide helps but is not needed. If they have one (PDF, image or Markdown), drop it in `brand-guide/` or pass the file:

```
npm run brand:import -- brand-guide/guide.pdf
```

That writes a draft preset under `kit/presets/local/` (gitignored): palette, fonts mapped to shipped pairings, tone notes, a logo if it finds one. Show them the draft and confirm it before you use it on a reel they will ship.

## Save and share

- Save a finished job's style as a preset: `npm run preset -- --save <name> --from <job>`.
- Save it as a recipe others can read and remake: `npm run reelmd -- export <job> --out <name>.Reel.md` (see the talking-head-recipe skill). A Reel.md names its preset under `## Brand kit` and adds colours, fonts and logo.

## Rules

- AIgent is the default theme. For another brand use `--theme neutral` or their own `kit/themes/<name>.js`; never use the Skool mark for another brand.
- Shipped presets use library beds only. Their own music goes in with `--bed <file>`.
