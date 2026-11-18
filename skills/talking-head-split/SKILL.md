---
name: talking-head-split
description: Make a split-screen explainer reel from a phone clip with aigent-talking-head and HyperFrames - proof panels on top (screenshots, terminal, progress card, equation, big number), the presenter in a rounded frame below over grid paper, 1 to 3 word captions between, full-frame cutaways at a spoken phrase, a keyword punch-in and a full-face call to action. Use when someone wants to explain a tool, repo or result while showing it, says "split screen", "show the screen above me", or asks for the explainer layout.
---

# Split-screen explainer

Full guide: [docs/split.md](../../docs/split.md). Command list: [contract.json](../../contract.json) (`split`).

## Steps

1. Draft the clip as usual: `npm run reel -- inbox/<file> --name <job> --draft`. Mirror a selfie first if the person asks (`ffmpeg -i in.mov -vf hflip -c:a copy out.mov`).
2. Read `jobs/<job>/clips/clips.md` for what they said. Plan one beat every 2 to 4 seconds, each keyed to a phrase they say (`at`).
3. Get real screens for the panels. A website or repo: `npx hyperframes@0.9.68 capture <url>` and crop a screenshot. A command: a `terminal` beat with its real output. Never draw a fake page.
4. Write `jobs/<job>/Split.json` (start from `examples/split/Split.json`). Show the person the plan in plain words before you render: hook, each beat and when it lands, cutaways, call to action.
5. `npm run split -- <job> --no-render`, then look: `cd jobs/<job>/split && npx hyperframes@0.9.68 snapshot --at <a time inside each beat>`. Read every still. Check that no text covers the face, panels read at phone size, and the presenter frame shows the face (adjust `frame.top` and `frame.bottom` if not).
6. `npm run split -- <job>` renders `jobs/<job>/split-vN.mp4`. With a cutaway, re-transcribe a few seconds around it and confirm the order: their phrase, the cutaway, their next sentence.

## Rules

- Captions, panels and titles never cover the face.
- The words on a panel are words they say or a real screen.
- Cutaways use footage the person has the rights to. They go in the pause after the phrase.
- You can't hear: say what music is under it and let them judge the level.
- Number versions; never overwrite one they approved.
- Copy follows the kit's humanizer rules (no em dashes, no hype words).
