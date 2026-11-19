# Studio

Studio is a local web page over the kit. Drop in your footage, add a reference reel if you have one, click the effects you want from a visual menu, set the music and pace, then draft, review and render. It runs on your computer, needs no account and no cloud, and drives the same engine as the CLI and the MCP server.

```
npm run studio
```

That starts Studio on http://127.0.0.1:4757 and opens your browser. `--port <n>` picks another port, `--no-open` skips the browser. Never used a terminal? Run the one-line installer in [Setup](#setup-without-a-terminal) and double-click the "Talking Head Studio" icon it puts on your desktop.

![Studio on a laptop: footage, reference and the look](studio/desktop.png)

## What you can do

1. **Footage.** Drag clips onto the page or pick files (mp4, mov, m4v, webm, mkv). They go to `inbox/studio/<job>/`. An assistant can also point the session at a clips folder (`clips` in `studio_set_selections`).
2. **Reference.** Upload a reel you like, or paste a single public Instagram post URL (uses instaloader, no login, one post; you need the rights). Studio runs the teardown and shows what it found: shots, titles and their entrances, transitions, finishes, graphics, effects, caption style and music. Then choose:
   - **Influence:** the reference becomes soft defaults on top of the pack you picked (the pack's locks stay). Saved as a local pack, `ref-<job>`.
   - **Recreate:** the draft uses the reference's Reel.md as the recipe (`--recipe`), so its shots, titles and look are copied as closely as the engine can.
3. **Look.** Pick a style pack from the gallery. Your picks below add to it.
4. **Effects menu.** Every effect the engine has, as a grid of previews, in tabs by type (table below). Click a tile to pick it; press F on a tile, right-click it, or use its "Forbid" button to forbid it. Picking any of a kind means only your picks of that kind are used; forbidding one leaves the rest. Some kinds take one choice (caption style, look, theme). Animated previews loop; "Pause previews" switches to stills and is on by default when your system asks for reduced motion. Tiles marked "Still" have no animated preview yet (`npm run menu:render` rebuilds the animated ones). "Needs your words" marks graphics that only appear when you say the matching words.
5. **Save as a pack.** "Save my selections as a pack" writes `packs/local/<name>/pack.json` (validated, gitignored) so you can reuse the look with `--pack <name>`.
6. **Music and sound.** A bed by energy (auto, low, mid, high), a named bed, no music, or your own upload. Sound effects on or off, the sound density cap, tighten pauses, and punch-ins.
7. **Vibe box and chat.** Type "calm and cinematic, no glitch, typewriter titles". See [Chat](#chat).
8. **Draft, review, render.** Draft runs `npm run reel ... --draft` and shows the choices table: every transition, finish, title and graphic per beat, with why it was picked. Change any cell and apply; the change is pinned. Render builds the reel (and the export size you picked) with progress, then plays it with a download link.

![The effects menu, transitions tab](studio/menu.png)

## Menu categories

The categories come from `kit/studio/categories.json`, which maps the engine's own catalogs (transitions, title and caption entrances, caption styles, graphics, effects, finishes, looks, themes, fonts, beds, sounds and editing options) into tabs. It only regroups; it never adds an effect the engine does not have, and `tests/studio.test.mjs` fails if it names one. An item can sit in more than one tab. Empty categories are hidden in the page.

| Category | Items | What is in it |
| --- | ---: | --- |
| Transitions | 56 | all 56 seams (50 stock, 6 drawn) |
| Kinetic text and title entrances | 42 | 9 title entrances, the font pairings, title placement (left, right, above, chest, face), text graphics and effects |
| Captions | 22 | caption entrances, 7 caption styles, 5 looks |
| Motion graphics | 30 | every graphic in `kit/graphics.json` |
| Lower thirds and name tags | 7 | lower third, news strap, logo bug, channel bug, ticker, app label, tape label |
| Stickers, emoji and callouts | 11 | sticker pop, ordinal sticker, highlight, icon badge, HUD callout, price tag, release pill, stamps and scribbles |
| Data and info graphics | 18 | 9 data graphics (chart, stat callout, checklist, step counter, split flap and more) and 9 data effects |
| Camera effects | 11 | the effects marked camera in `effects/catalog.json` (slow push, lean in, locked on, over-the-shoulder zoom and more) plus punch-ins |
| Speed and time | 3 | tighten, pause point, wave trim |
| Person and background | 16 | title layers (front, behind the head, auto) and effects that use the person mask |
| Color and looks | 16 | looks, film finishes, themes |
| Overlays and textures | 7 | grain, vignette, scan lines, glass widgets, shortcut rain, noise, light leak |
| Glitch and distortion | 10 | glitch seams and effects |
| Shapes, frames and split screens | 10 | reel frame, split headline, B-roll split, grid, versus, screen card, colour and chapter cards |
| B-roll and media | 10 | screen card, profile wall, phone fan, carousel spin, headline wall, match cut and more |
| Audio | 54 | 11 music beds, 37 sound effects, beat sync, sound map and cap |
| Intros, outros and CTAs | 8 | CTA card and button, number pop, chapter card, tap, countdown flip, comment box, cards |

269 unique items in all. Counts are from this release; `node -e "import('./kit/studio/core.mjs').then(C=>console.table(C.catalog().categories.map(c=>({c:c.label,n:c.count}))))"` prints the current ones.

![Captions tab](studio/menu-captions.png)

### Candidates to build next

No category is empty today, so none is hidden. These are thin, or are things people ask for that the engine does not do yet (listed in `categories.json` under `candidates`):

- **Speed ramps and slow motion.** Speed and time has 3 items; the engine cuts and freezes but does not change playback speed.
- **Emoji.** Stickers cover hearts, stars and fire; there is no emoji picker.
- **Intro stings and logo reveals.** Only the end card and number pop exist.
- **Light and lens effects.** Light leak is a transition; there is no lens flare or bokeh overlay.
- **Sound design: ducking controls.** Ducking is automatic; there is no per-clip control.
- Thin today: Lower thirds and name tags (7) and Overlays and textures (7).

## Chat

The chat box takes plain words. Two ways to give it a real conversation:

- **Use your own assistant (recommended).** Connect Claude Code, Cursor, Codex or another MCP client to `npm run mcp` ([docs/mcp.md](mcp.md)). It sees the same session as the page through three tools: `studio_get_state` (your picks, the reference, the chat, the running task), `studio_set_selections` (change picks, answer in the page chat) and `studio_run` (start a draft or render with progress in the page). The page updates live when the assistant changes something, and the assistant sees what you click.
- **Direct API.** Set `ANTHROPIC_API_KEY` (model `STUDIO_MODEL`, default `claude-sonnet-4-5`) or `OPENAI_API_KEY` (default `gpt-4o-mini`) before `npm run studio`. Studio sends the menu names and your session, and applies only names the engine has. Keys stay in your environment; nothing is saved to the repo or the session file. `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` point at compatible servers.

With neither, the chat still understands vibe words (calm, cinematic, hype, fast, clean, magazine, techy, retro, silent and more, in `kit/studio/vibes.json`), pack names, effect names, and "no ..." to forbid.

![Chat on a tablet](studio/tablet.png)

## Render

![Draft, choices and the finished reel](studio/render.png)

Draft first. The choices table shows each pick and why. Render then builds the reel, applies your choices edits, and lists every output (`reel-vN.mp4` and the export) with a player and a download link. The effects pass (camera moves, person-mask effects) runs when the effects venv is set up (`npm run effects:setup`); without it, Studio says which picked effects were skipped.

## On a phone

![Studio at phone width](studio/phone.png)

Studio is meant for a laptop, and it works at phone width: a step menu, a drop-down for the effect tabs, two tiles per row, and no sideways scrolling.

## Setup without a terminal

The one-line installers check for Git, Node.js, ffmpeg, Python and Chrome, offer to install what is missing, set everything up, and put a "Talking Head Studio" launcher on your desktop. Running them again updates the kit. Details and what to tell your AI assistant: [docs/setup-with-ai.md](setup-with-ai.md).

macOS or Linux (Terminal):

```
curl -fsSL https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.sh | bash
```

Windows (PowerShell):

```
irm https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.ps1 | iex
```

A double-click app with no installer at all is planned: [docs/desktop-app-plan.md](desktop-app-plan.md).

## Files and safety

- The session lives in `jobs/.studio/state.json` (`STUDIO_DIR` moves it). Uploads go to `inbox/studio/<job>/` and `teardown-in/studio/<job>/`, drafts to `jobs/<job>/`, teardowns to `teardown/studio-<job>/`. All gitignored.
- The server listens on 127.0.0.1 only, refuses other Host headers (so a web page can't reach it by DNS rebinding) and cross-site posts, and serves files only from the kit's media folders.
- One task runs at a time; Cancel stops it.
- `STUDIO_REEL_ARGS` and `STUDIO_TEARDOWN_ARGS` add flags to every draft or teardown (for example `--engine lite --no-asr`).

## Design

Plain HTML, CSS and JavaScript, no framework or build step, in the AIgent theme (Anton, Hanken Grotesk and JetBrains Mono from the kit's fonts). Keyboard: Tab through everything, arrow keys move between effect tabs, F forbids a tile, and focus stays put when the page updates. Controls are at least 44 px on touch screens and narrow windows (36 px with a mouse on a wide screen), text at least 12 px on a 16 px base, contrast at least 4.5:1, focus is always visible, and looping motion can be paused. Uppercase Anton is kept for headings only, because it is the AIgent brand face; the cyan accent marks only what is selected, the primary action and the running task; no gradients, glows, glass or rounded corners. The layout was checked against the checklists in [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) and [Anti-Slop](https://github.com/miqdadbadjuber/Anti-Slop) (both MIT), used as guidance only; no code or text from them is included.
