---
name: talking-head-teardown
description: "Tear down a reference reel the user provides (a local video file) into a Reel.md recipe with rea-video, show the user what was detected (cuts, captions, titles and their entrances, front/behind, finishes, music tempo, colours), let them adjust it, then remake the style with their own clip and brand in aigent-talking-head. Use when someone says make it like this reel, copy this style, break down this video, or remake this with my clip."
---

# Teardown, then remake

Work inside an aigent-talking-head checkout; if there is none, read https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/INSTALL.md and follow it. Details: `docs/teardown.md`.

## 1. Get the reference

Only a local file the user gives you. Do not download from social platforms; if they send a link, ask them to save the video themselves where the platform and creator allow it, and pass you the file.

## 2. Tear it down

```
npm run teardown -- <reference.mp4>
```

rea-video (Apache-2.0) does the breakdown. If it is not installed, the command says so and uses the rougher built-in fallback. Ask before installing it (about 216 MB of models on first run): `npm run teardown -- <reference.mp4> --install`, or rea-video's own line "Install https://github.com/JuneYaooo/rea-video".

## 3. Show what was detected (mandatory)

Before any render, show the user:

- the summary the command prints,
- `teardown/<name>/teardown.md` (titles with entrance and layer, finish per shot with the reason, caption style, tempo and suggested bed, colours),
- `teardown/<name>/contact.jpg` (detected titles boxed and labelled).

Say plainly which parts are guesses: caption style and finishes are the nearest match on a short menu, subtle grades are often missed, front or behind is a colour test, and OCR misreads stylised type.

## 4. Let them adjust

Ask what to change, and edit `teardown/<name>/Reel.md`: their preset and colours under `## Brand kit`, their bed under `## Music`, finishes per shot, title entrances and layers (offer front or behind per title), caption style. Run `npm run reelmd -- check teardown/<name>/Reel.md` after every edit. Offer the menu for anything they want to swap (see the talking-head-reel skill).

## 5. Remake

```
npm run reel -- --recipe teardown/<name>/Reel.md --clip inbox/<their-clip>.mp4 --draft
```

Their own words stay; the recipe's title entrances and layers apply in order (`--recipe-titles` uses the reference's title text instead, only if the user wants that and the text is theirs to use). Review, offer the menu again, `npm run reel -- --rebuild --name <job>`, then `npm run verify -- <job>` must print `VERIFY PASS`.

## Rules

- Copy the style, not the content. Do not reuse another creator's footage, voice, logo or exact script in the remake.
- Never post anything.
- No em dashes in titles or captions you write.
