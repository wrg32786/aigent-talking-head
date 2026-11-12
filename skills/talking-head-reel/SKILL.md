---
name: talking-head-reel
description: "Make a vertical talking-head reel from a phone clip with aigent-talking-head: kinetic captions, titles in front of or behind the head, beat-synced music, film finishes, presets and 51 effects. Always offers the menu of options first. Use when someone says make a reel from my clip, edit my talking-head video, or add captions and titles to a selfie video."
---

# Talking-head reel

Turn the user's phone clip into a styled 9:16 reel with the aigent-talking-head kit.

## 0. Have the kit

Work inside an aigent-talking-head checkout (it has `kit/reel.cjs` and `package.json` with `npm run reel`). If there is none, install it first: read https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/INSTALL.md and follow it. `npm run smoke` must print `SMOKE PASS` before you make anything.

## 1. Offer the menu (mandatory)

Before you draft, and again before the final render. The options are easy to miss, so the user must see them.

1. Ask how they want to pick the look:
   - a saved preset (`npm run preset -- --list`, then `--preset <name>`),
   - a recipe (`examples/recipes/*.Reel.md`, their own Reel.md, or one from a teardown; see the talking-head-recipe and talking-head-teardown skills),
   - customize from the menu,
   - or let you choose (`--preset auto`, then say what you picked and why).
2. Run `npm run menu` and point them at `showcase/GALLERY.md` (labelled stills of every option).
3. Suggest 2 or 3 options per category that fit this reel: presets, film finishes (vary them across shots), beat sync, looks and caption styles (including one-word), font pairings, themes, title entrances, title layer (front, behind the head, or auto, per title), transitions, the 51 effects, the SFX pack, music beds.

## 2. Make it

```
npm run reel -- --clip inbox/<file> [--preset <name> | --recipe <Reel.md>] [--bed <name>] [--finish grain] --draft
```

Flags win over a recipe, a recipe wins over its preset. Review `jobs/<name>/clips/clips.md` and `jobs/<name>/build/captions.js` (fix misheard words, make titles read as headlines), offer the menu again, then render:

```
npm run reel -- --rebuild --name <name>
npm run verify -- <name>        # must print VERIFY PASS; look at jobs/<name>/verify/contact.png
```

## 3. Hand over

Give the path of `jobs/<name>/reel-vN.mp4`. Offer the effects pass (`npm run fx`) and offer to save the look: `npm run reelmd -- export <name> --out my-style.Reel.md` or `npm run preset -- --save <name> --from <job>`.

## Rules

- Copy: no em dashes, no "not X, but Y", no hype words. `npm run check -- <job>` lints it.
- You cannot hear. Let the user pick sounds and beds by ear.
- Number versions; never overwrite an earlier reel.
- The full manual (cut.json, captions.js, sound rules, HeyGen takes) is in the talking-head-ad skill in the same repo: `skills/talking-head-ad/SKILL.md`.
