---
name: talking-head-teardown
description: "Tear down a reference reel the user provides (a local video file, or a single Instagram post link) into a Reel.md recipe with rea-video, show the user what was detected (cuts, captions, titles and their entrances, front/behind, finishes, music tempo, colours), let them adjust it, then remake the style with their own clip and brand in aigent-talking-head. Use when someone says make it like this reel, copy this style, break down this video, or remake this with my clip."
---

# Teardown, then remake

Work inside an aigent-talking-head checkout; if there is none, read https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/INSTALL.md and follow it. Details: `docs/teardown.md`.

## 1. Get the reference

Use a local file the user gives you. If they send a single Instagram post or reel link, you may run `npm run teardown -- --url <link>`, which fetches that one post anonymously with instaloader if it is installed (`pip install instaloader`). Confirm they have the rights to the content. Never log in, never fetch profiles or in bulk, and if Instagram refuses, stop and ask them for the file. For any other site, ask them to save the video themselves where the platform and creator allow it.

## 2. Tear it down

```
npm run teardown -- <reference.mp4>
```

rea-video (Apache-2.0) does the breakdown. If it is not installed, the command says so and uses the rougher built-in fallback. Ask before installing it (about 216 MB of models on first run): `npm run teardown -- <reference.mp4> --install`, or rea-video's own line "Install https://github.com/JuneYaooo/rea-video".

## 3. Show what was detected (mandatory)

Before any render, show the user:

- the summary the command prints,
- `teardown/<name>/teardown.md` (caption style, place and colour, titles with entrance and layer, what was left out of the titles and why, graphics found, finish per shot with the reason, tempo and suggested bed, colours),
- `teardown/<name>/contact.jpg` (detected titles boxed and labelled).

Say plainly which parts are guesses: caption style and finishes are the nearest match on a short menu, subtle grades are often missed, front or behind is a colour test (for titles) or a check that the letters stop at the hairline (for captions, `caption-layer`), and OCR misreads stylised type. A finish is only assigned when the grade is strong or changes across shots; an even warm cast is read as room light. Graphics (ordinal stickers, app labels, screen cards) are drawn as generic placeholders until real assets are given.

Screen cards: read "Screen cards: what was shown" in the report. For each card, propose a public page for the tool or repo named (the address read in the card, or the repo or site of the tool named before it; search for it if needed). Show the list and ask the user to confirm or change it before capturing anything. Then write `source <url>` on those cards (a file of their own works too) and run `npm run capture -- --recipe teardown/<name>/Reel.md`. Capture only public pages; never log in or capture a page behind a login.

## 4. Let them adjust

Ask what to change, and edit `teardown/<name>/Reel.md`: their preset and colours under `## Brand kit`, their bed under `## Music`, finishes per shot, title entrances and layers (offer front or behind per title), caption style, place and colour (`caption-position`, `caption-color`), and the graphics (keep, drop, retime, or add their own `icon` and `src` files). Run `npm run reelmd -- check teardown/<name>/Reel.md` after every edit. Offer the menu for anything they want to swap (see the talking-head-reel skill).

## 5. Remake

```
npm run reel -- --recipe teardown/<name>/Reel.md --clip inbox/<their-clip>.mp4 --draft
```

Ask which of the two they want:

- **Recreate** (the same edit): add `--recut`. Their take is re-cut to the reference's shots on word boundaries, each shot cropped to the reference's face size and eye line and graded to its colour (skin kept), with its stickers and sounds at its times.
- **Copy the look** (the same style, their own script and subject): `npm run look -- save teardown/<name> --name <look>`, then `npm run reel -- --style-look <look> --clip inbox/<their-clip>.mp4 --draft`. The cuts land in their own pauses at the look's pace; nothing from the reference's script, text or times is used. The saved look works on any later take (`npm run look -- list`).

Both write `jobs/<job>/build/match.json`: tell the user, in plain words, how close each part is and why a part is low (for example a take that was too wide to zoom all the way).

Their own words stay; the recipe's title entrances and layers apply in order (`--recipe-titles` uses the reference's title text instead, only if the user wants that and the text is theirs to use; a title they do not say is dropped). Review, offer the menu again, `npm run reel -- --rebuild --name <job>`, then `npm run verify -- <job>` must print `VERIFY PASS`.

## Rules

- Copy the style, not the content. Do not reuse another creator's footage, voice, logo or exact script in the remake.
- Never post anything.
- No em dashes in titles or captions you write.
