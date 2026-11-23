# Explainer

`npm run explainer -- <job>` turns a drafted job into a split-screen reel: a proof panel on top (a screenshot, a terminal, a progress card, an equation or a big number), the presenter in a rounded frame on the bottom half over grid paper, and short captions in the gap between them. Cutaways and the call to action go full frame. It suits explainers about a tool, a repo or a result you can show on screen.

It is built with [HyperFrames](https://hyperframes.heygen.com) (HTML rendered to video), so every reel is also an editable project in `jobs/<job>/explainer/`.

## Steps

```
npm run reel -- inbox/my-take.mov --name my-reel --draft     # 1. transcribe and cut, as usual
cp examples/explainer/Explainer.json jobs/my-reel/Explainer.json          # 2. edit the hook, beats and call to action
npm run explainer -- my-reel --no-render                          # 3. build and check the project
npm run explainer -- my-reel                                      # 4. render jobs/my-reel/explainer-v1.mp4
```

Look at it before you post: `cd jobs/my-reel/explainer && npx hyperframes@0.9.68 snapshot --at 1,5,10` writes stills, and `npm run dev` there opens the preview. Change a scene in `jobs/<job>/explainer/compositions/`, or change the Explainer.json and run split again (it rebuilds the project and renders the next version number).

Needs, on top of the kit's install: Node 18+ with `npx` (HyperFrames is fetched at a pinned version on first use) and network access for that first fetch.

## What goes over the network

Rendering happens on your computer. Two things are fetched from npm the first time and kept: HyperFrames (`npx hyperframes@0.9.68`) and GSAP (`gsap@3.15.0`, into `jobs/.explainer/gsap/`, then copied into each project so the page renders offline). HyperFrames runs with its telemetry off (`HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`), also when you run `npm run dev`, `check` or `render` inside the project (they go through its `hf.mjs`). Fonts and colours come from the kit (`kit/fonts`, `kit/themes/aigent.js`), so nothing loads from a font or script CDN.

## Explainer.json

```json
{
  "hook": ["How this reel was made,", "in one command"],
  "accent": ["repo", "free", "captions"],
  "aliases": { "Agent": "AIgent" },
  "frame": { "top": 560, "bottom": 1560 },
  "music": "vinyl-sunrise",
  "cutaways": [{ "after": "watch this", "file": "inbox/b-roll.mp4" }],
  "beats": [
    { "at": "this repo", "type": "browser", "url": "github.com/you/repo", "image": "shots/repo.png" },
    { "at": "one command", "type": "terminal", "lines": ["$ npm run explainer -- my-reel", "✓ 8 scenes, 23 captions"] },
    { "at": "free", "type": "keyword", "word": "free", "sub": "to use or build on" }
  ],
  "cta": { "at": "comment", "word": "SPLIT", "sub": "I'll send you the link" }
}
```

| Key | What it does |
|---|---|
| `hook` | Two lines at the top for the opening seconds: plain bold, then a blue italic highlight. Shown until the first panel, cutaway or keyword. |
| `accent` | Words that turn blue italic in the captions. |
| `aliases` | Spelling fixes for the captions, heard word to written word. |
| `frame` | Which band of the 1080x1920 clip shows in the presenter frame (`top`, `bottom` in source pixels). Raise `top` if your head sits low in the shot. Default 560 to 1560. |
| `music` | A bed from `npm run music`, or a file path. `musicVolume` sets the level (default 0.12). |
| `cutaways` | Full-frame inserts. `after` is a phrase you say; the clip goes in the pause after it, with its own sound, then your take carries on. Only use footage you have the rights to. |
| `beats` | Panels, each starting when you say its `at` phrase (searched in order, so repeated words resolve to the next one). A beat lasts until the next beat, cutaway or call to action. |
| `cta` | Full-face close-up from the `at` phrase to the end: "comment" plus the `word` in yellow, and an optional `sub` line. |

Beat types:

| type | fields | shows |
|---|---|---|
| `browser` | `image`, `url`, `pan` (`down` or zoom) | the image in a browser window with the URL bar |
| `image` | `image`, `pan` | the image in a rounded window, no browser bar |
| `terminal` | `lines` (`$` dims the prompt, `✓` is green) | the first line types out, the rest tick in |
| `progress` | `label`, `title` | a card with a bar filling to 100% |
| `equation` | `rows` (`[["repo", "skill"], ...]`) | `left = right` rows, the right side in blue italic |
| `stat` | `value`, `label` | one big number |
| `keyword` | `word`, `sub` | the presenter goes full frame and the word lands above the head |

Words on panels should be words you say or real screens: capture the actual page (`npx hyperframes@0.9.68 capture <url>`) rather than drawing a fake one.

## What it does for you

- Builds the talk track from the draft's segments and transcribes it locally (faster-whisper).
- Places each cutaway in the pause after its phrase, never on the transcript's word end, which clips the tail of the word.
- Keeps every caption and panel off the face: captions only while the presenter is framed, panels above the frame, keyword and call to action above the head on a soft scrim.
- Runs `hyperframes check` and stops on errors before it renders.
