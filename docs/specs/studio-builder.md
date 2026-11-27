# Studio redesign: Library, Recording and the step-by-step builder

Status: being built on the `studio-wizard` branch, one phase per PR (section 11). Written 2026-11-25 against main `35cc9e8`.
Source: Will's notes t585u ("mom test") and t586u (Teardowns and Recording are their own sections).
The build is phased into small PRs (section 11).

---

## 1. The problem in one paragraph

Will tried Studio with his mom and her terminal agent was easier. Three reasons, all confirmed in the code:

1. **The steps are engine-shaped, not decision-shaped.** Today's bar is `Start, Cut, Picture, Text, B-roll, Music, Review, Render` (`kit/studio/web/src/steps.js`). Picture mixes a Look picker with four engine layers (color, motion, transitions, layout). Text mixes captions, title entrances, title effects, title exits, fonts and 30 graphics in tabs. About 300 options sit in 9 layers (`kit/studio/categories.json`), with allow/deny semantics that read like engine flags.
2. **Nothing says where a choice applies.** A tile says what it is, not whether it changes the captions, the big titles, the presenter, the seam between shots, the whole picture, or the sound, and not when (whole video, hook, CTA).
3. **Many demos do not show the effect.** Of the options Studio shows, only transitions (56), caption styles (7), caption entrances (10), title entrances (9) and title effects/exits (10) have animated previews (`docs/menu/*`). Everything else is one still frame of a still presenter (`showcase/media/*`, made by `kit/showcase.mjs` from `showcase/source/presenter.jpg`): all 51 effects, all 30 graphics, all 10 film finishes, the 3 title layers (including words behind the head), 20 font pairs, 5 looks. Motion effects such as `lean-in`, `slow-push`, `moody`, `swipe`, `tap`, `locked-on` look identical to a plain frame in `showcase/sheets/effects.jpg`. 16 editing principles, 6 packs and 5 exports have no preview at all.

## 2. The new shape

Three top-level sections, each its own feature, in a top tab bar:

| Tab | What it is | Old home |
|---|---|---|
| **New video** | Pick the source clip, then either a template from the Library or the custom builder. Ends in Review and Render. | Start, Cut, Picture, Text, B-roll, Music, Review, Render |
| **Teardowns** | Break down a reel (upload) or a link (URL). Save it as a named template. Browse and manage the **Template Library**. | Picture > "how the reference was made" view, the Wizards "Copy a reference" card, saved style looks |
| **Recording** | Teleprompter, record, takes, scripts. Every take lands in a Recordings list that New video can pull from in one click. | Start > Record now (Recorder, Prompter, Scripts) |

Secondary items stay where they are today, in the top bar's More menu: Outputs, Post (drafts only), Highlights, Publish kit, Vault, Keys, Settings, Connect agent, Chat.

Recording is **not** a step of the builder. It is its own place. New video simply lists recordings as a source.

### 2.1 New video, start screen (before any step)

One screen, three things, top to bottom:

1. **Your clip.** Three equal cards: `Use a recording` (opens the Recordings list from the Recording tab, newest first, with thumbnail, length, date), `Upload a video`, `Paste a link`. If a recording was just made, it is preselected with a "From Recording, 2 min ago" chip.
2. **How do you want to build it?** Two big cards:
   - `Use a template` opens the Template Library inline (same grid the Teardowns tab shows: animated preview, name, source, length, pace). Picking one skips every style step and goes straight to **Your notes** (section 2.3, step N), with the template's choices shown as a read-only summary you can open and change.
   - `Build my own` starts the step-by-step builder at step 1, Pacing.
3. **Name** (optional, defaults to the date).

### 2.2 The builder (custom template), one decision per screen

Every step screen has the same frame (section 6): a title in plain words, an **Applies to** chip plus a small 9:16 diagram that lights up the part of the frame it changes, the options as animated tiles, a short "What this does" line under the selected tile, and `Back` / `Next`. Sections end with a **Lock** screen that shows the section's preview and a `Lock and continue` button.

| # | Section | Step | Applies to | Select | Existing engine pieces |
|---|---|---|---|---|---|
| 1 | Pace | **Pacing** | Whole video: cut speed, pauses, energy | one of: Calm, Steady, Lively, High energy | `pace.tighten` (`pacing.mjs` PACING), `pace.punch`, shot length, transition density, `music.energy`, beat-sync. Pacing sets defaults; later steps can override |
| 2 | Words on screen | **Caption type** | Captions (the running words) | one of: Just captions, Kinetic words | `captionStyle`/`look`. Asked first because caption entrances move kinetic captions only (`kit/studio/conflicts.mjs`) |
| 3 | | **Caption look** (Just captions) or **How words come in** (Kinetic) | Captions | one | Just captions: classic, pill, hormozi (Bold), karaoke, one-word. Kinetic: the 10 `captionEntrance` values |
| 4 | | **Big titles** (Kinetic only, optional) | Big titles over you | none, or one entrance set + one effect + one exit | 9 `entrance`, 6 `titleEffect`, 4 `titleExit` |
| 5 | | **Where words sit** | Captions and titles | one caption band + title places | `captionY` band (chest, lower third), `place-left/right/above/chest`, `title-places`. Face is always protected: no option can put text on the face (rule). `place-face` is not offered here; its behind-the-head part lives in Presenter effects |
| 6 | | **Text colors** | Captions and titles | theme or brand, plus text, accent and outline color | `themes` (aigent, magazine, neutral), brand colors from Vault/Brands, `TH.colors` |
| 7 | | **Font pairing** | Captions and titles | one pair | 20 `font` pairs (`kit/fonts/pairings.json`); `fontLock` |
| 8 | | **Key words** (Kinetic only) | The strongest words | off, Subtle, Strong, Dramatic; color of key words; at most N per line | kinetic hero word, title `key` word, accent; `goalwords.cjs` picks which word |
| 9 | | **Preview and lock** | All of the above | none | Live preview (section 7) of a sample caption plus one title on the sample presenter, then `Lock and continue` |
| 10 | Between shots | **Transitions** | The seam between two shots | none, or several (multi-select); how often: every cut, topic changes only, hook and CTA only | 56 `transition` values grouped into 6 families (Clean, Quick, Glitch, Wipes, Shapes, Film) with the 12 most used shown first and "See all" |
| 11 | You on screen | **Presenter effects** | You (the presenter) | none or several, each with when: hook, key moments, whole video | Frame breakout (`split.cjs` frame layout + person mask), Words behind your head (`titleLayer` behind/auto, `headmask.py`), Zoom punch (`punch`), camera moves (51-effect catalog `camera: true`: slow-push, lean-in, orbit, over-the-shoulder-zoom), room effects (`spotlight`, `rabbit-hole`, `backdrop-word`, `red-collage`, `pastel-word`, `moody`) |
| 12 | Extras | **Graphics** (one screen, defaults on "Let the agent choose") | Small graphics over the frame | toggles: Name tag, Numbers and lists, Stickers and callouts, Call to action, Colour and chapter cards | `plan.cjs` proposes graphics from what you say; 30 `graphic` + data effects. Added by us, Will did not list it; it keeps today's graphics from disappearing |
| 13 | Look | **Filters** | The whole picture | none, or one or more | 10 `finish` values (grain, vignette, chroma, scan-lines, warm, cool, teal, crushed, mono = Black and white, bleach) |
| 14 | | **When filters show** | Time | Whole video, Hook only, CTA only, Hook and CTA | per-segment `finish` in `cut.json` (`assemble.cjs` line 132) + new section tags (section 8) |
| 15 | Content style | **Repo or tool feature** (checkbox) | Layout of the whole video | off / on; 0 to 3 GitHub URLs (a starter can wait for a link); layout: Split (about 45/10/45 with frame breakout), the repo never full screen (Will, 2026-11-27), pictures every 2-4 s, frame breakout on by default (turn off in step 11) | `repo-broll.mjs`, `split.cjs` top/frame, person mask. See section 9 |
| 16 | Sound | **Music** (last, as Will asked) | Sound | bed (or none / your own), energy, beat-sync, sound effects on/off | `music.bed`, `music.energy`, `beat-sync`, `sound.sfx`, `sound.cap` |
| 17 | Finish | **Your notes for the agent** | Anything | free text, plus 4 example chips ("Hook with big red words", "Keep it calm", "No sound effects", "Show the repo early") | New. Stored as `plan.notes`, given to the agent verbatim |
| 18 | | **Make it** | | `Save as a template` (optional name), `Make my video` | Agent build + frame check loop (section 10), then Review and Render as today |

Template path: start screen > pick template > step 17 (Your notes) > step 18. The summary on step 17 shows each section as a row ("Words on screen: Kinetic, pop in, chest, AIgent colors, Druk pair, Strong key words") with `Change`, which opens only that step and returns.

Review and Render keep today's screens (`Render.jsx`, `Review.jsx`, `Post.jsx`). Review gains a **Plan check** panel (section 10). Cut moves into Review as "Change which lines stay" (the agent picks lines first; words are never cut).

### 2.3 Teardowns tab

- Header: `Break down a reel` with two inputs side by side: drop or upload a file, or paste a link (`fetch.mjs`, `studio_add_reference_url`).
- Progress row while it runs (the existing teardown pipeline: `kit/teardown.mjs`, `reference.mjs`, `kit/teardown/*`).
- Result card: the breakdown we show today (`Reference.jsx`, `RefCard.jsx`, `RefTitles.jsx`), with the fidelity chips, then **Save as template** with a name field.
- **Template Library** grid under it: every saved template with animated preview, name, source (link or file), date, pace word, and a menu: Rename, Duplicate, Edit in builder, Delete (asks first), Use for a new video. Our six built-in Looks (packs aigent, cinematic, hormozi-bold, magazine, minimal-clean, neutral) appear as "Starter templates" in their own row so the Library is never empty.
- Templates saved from the builder (step 18) land in the same Library, tagged "Built by you".

### 2.4 Recording tab

- Today's Recorder, Prompter (speed bar, pop-out), Scripts, Takes, moved as they are.
- New: a **Recordings** list (all takes across videos) with a `Use in a new video` button that opens New video with that clip preselected.

---

## 3. Mapping every existing option

| Engine section (count) | New home | Notes |
|---|---|---|
| looks (5), presets (11), packs (6) | Template Library "Starter templates"; Advanced | Not builder steps. A pack is a template. |
| caption-styles (7) | Step 2 (kinetic vs captions) and step 3 (caption look) | |
| caption-entrances (10) | Step 3 (Kinetic) | |
| title-entrances (9), title-effects (6), title exits (4) | Step 4 | |
| editing place-* (5), title-places | Step 5 | `place-face` behind part moves to step 11 |
| themes (3) + brand colors | Step 6 | |
| fonts (20) | Step 7 | |
| title-layer (3) | Step 11 (Words behind your head) | |
| transitions (56) | Step 10 | |
| effects (51) | Step 11 (camera and person ones), step 12 (data, stickers, lower thirds), step 13 (noise, moody grade looks) | Exact per-id map in `kit/studio/wizard/steps.json` (Phase 1), `npm run check` fails on an unassigned id |
| graphics (30) | Step 12 | |
| finishes (10) | Steps 13 and 14 | |
| beds (11), beat-sync (3), sfx (37), music-energy, sfx-map, sfx-cap | Step 16 | |
| editing punch, tighten | Step 1 sets them; step 11 for punch override | |
| colour-card, chapter-card, cards-auto, magazine, accent-script | Step 12 (cards), Advanced (magazine, accent-script) | |
| exports (5), sizes | Render (as today) | |
| b-roll lane (`BRoll.jsx`, broll-*.mjs) | Review "B-roll spots" and repo mode (step 15) | The b-roll layer of layouts (splits, phone fan, carousel) moves to step 15 when repo mode is on, else Advanced |

**Advanced.** Every option stays reachable from a single `All options` fold on step 17, so nothing the engine can do is lost. It uses today's `Layers` component unchanged.

### 3.1 Code modules, where they move

| Today | Becomes |
|---|---|
| `App.jsx` stepper and `STEPS` | `App.jsx` holds the three tabs; `NewVideo/Builder.jsx` holds the builder; `steps.js` gains `BUILDER_STEPS` and keeps every old alias so `#step=` links still land |
| `Footage.jsx`, `Recorder.jsx`, `Prompter.jsx`, `Scripts.jsx` | `Recording/` tab; `Footage.jsx` source picker becomes `NewVideo/Source.jsx` |
| `Reference.jsx`, `RefCard.jsx`, `RefTitles.jsx`, `RecreateStart.jsx`, Wizards "Copy a reference" | `Teardowns/` tab |
| `stylelooks.mjs`, `kit/stylelook.cjs` (named style looks in `looks/local/<name>/look.json`) | the Template Library store (section 5). A saved look is a template; old looks show up automatically |
| `Style.jsx` (Picture, TextStep, Music, Layers) | Split into `NewVideo/steps/*.jsx`, one file per step. `Layers` lives on as `AllOptions.jsx` |
| `Agent.jsx` Wizards (grow, sell, teach, clean) | Retired from the main path. Their GOALS map feeds Pacing defaults and the notes chips |
| `Cut.jsx` | Inside Review |
| `pacing.mjs` | Extended: four builder paces map onto tighten, punch, transition density, energy |

---

## 4. One plan file: `video-plan.json`

The builder writes one JSON document. The page, the server, the MCP tools and the agent all read the same file. It lives in the session state as `state.videoPlan` and is written to `jobs/<job>/build/video-plan.json` on Make it. (Not `plan.json`: `build/plan.json` already exists for the recipe re-cut, see `kit/recreate.cjs`.)

```json
{
  "format": "aigent-video-plan",
  "version": 1,
  "source": { "kind": "recording | upload | link", "take": "takes/2026-11-25-0912.webm", "url": null },
  "template": null,
  "pace": "calm | steady | lively | high",
  "words": {
    "type": "captions | kinetic",
    "captionLook": "classic | pill | hormozi | karaoke | one-word | null",
    "entrance": "pop | unfurl | cascade | ... | null",
    "titles": { "on": true, "entrances": ["slam", "blur-rise"], "effect": "decode", "exit": "dip-black" },
    "place": { "captions": "chest | lower", "titles": ["left", "right", "above"] },
    "colors": { "theme": "aigent", "text": "#ffffff", "accent": "#5cf9e2", "outline": "#000000", "brand": null },
    "fonts": "druk",
    "keyWords": { "level": "off | subtle | strong | dramatic", "color": "accent", "maxPerLine": 1 },
    "locked": true
  },
  "transitions": { "ids": ["whip", "glitch"], "when": "every-cut | topic | hook-cta", "locked": true },
  "presenter": [
    { "id": "frame-breakout", "when": "key-moments" },
    { "id": "behind-head", "when": "hook" },
    { "id": "effect:slow-push", "when": "whole" }
  ],
  "graphics": { "agent": true, "nameTag": true, "numbers": true, "stickers": false, "cta": true, "cards": false },
  "filters": { "ids": ["mono"], "when": "whole | hook | cta | hook-cta" },
  "content": { "repoFeature": false, "repos": [], "layout": "split", "takeovers": "auto", "example": null, "bands": null, "takeoverSec": null, "swapSec": null, "frameBg": null, "headline": false },
  "music": { "bed": "auto | none | <id> | upload", "energy": "auto | low | mid | high", "beatSync": true, "sfx": true },
  "notes": "Hook with big red words.",
  "advanced": { "picks": {} }
}
```

Rules:
- `kit/studio/wizard/plan.mjs` exports `defaults(pace)`, `validate(plan)` (returns `{ ok, errs }`, errors in plain English), `fromTemplate(template)`, `toState(plan, CAT)` (the patch the existing pipeline already understands: `pack`, `picks`, `music`, `sound`, `pace`; filters go in as `picks["finish:<id>"]`, never `state.finish`, which already means what Render makes, see section 14), and `summary(plan)` (the rows for step 17). One module, no dependencies, plain JS so tests and MCP import it.
- `toState` is the only bridge to the engine. The engine is not rewritten. Where the engine cannot express a choice yet (filter timing, key-word level, takeovers), Phase 7, 9 and 10 add the engine flag first, then `toState` sets it.
- `advanced.picks` holds anything set in All options, merged last.
- Pacing defaults are applied when step 1 changes, but only to fields the user has not touched (track `touched: string[]`).

## 5. Template schema (from teardowns and from the builder)

A template is today's style look (`looks/local/<name>/look.json`, version 1, see the header of `kit/stylelook.cjs`) plus a builder plan and a preview. We extend, we do not replace:

```
looks/local/<name>/
  look.json        unchanged style-look fields (framing, grade, captions, titles, stickers, transitions, moves, pace, broll, music, sfx, loudness, brand)
  template.json    { "format": "aigent-template", "version": 1, "name", "label", "createdAt",
                     "from": { "kind": "teardown-url | teardown-file | builder | starter", "url", "file", "teardown": "jobs/<job>/teardown" },
                     "plan": <video-plan.json with source and notes empty>,
                     "summary": { "pace": "lively", "words": "Kinetic, pop in", ... },
                     "preview": "preview.webp" }
  preview.webp     a 3 to 4 s loop of the template applied to the sample presenter
```

- From a teardown: `plan` is derived from `look.json` (captions -> `words`, transitions mix -> `transitions.ids`, pace mean shot length -> `pace`, grade/finish -> `filters`, music -> `music`). The derivation lives in `kit/studio/wizard/from-look.mjs`, tested on the committed teardown fixtures.
- From the builder: `look.json` is not required; `template.json` alone is a valid template.
- A look folder with no `template.json` is listed as a template with a derived plan, so every look Will already saved shows up.
- The six packs are listed as starter templates (read only, Duplicate to edit).
- Storage stays local and out of git (`LOOKS_DIR`), as today.

## 6. The step frame: making "where it applies" obvious

One component, `StepFrame`, used by every step:

- **Title** in plain words ("How do your words come in?").
- **Applies to chip** (e.g. "Applies to: captions") and **a mini 9:16 map** (`ZoneMap`): a rounded phone outline with the presenter silhouette; the zone this step changes glows in the accent (caption band, title zone, presenter, the seam between two thumbnails, the whole frame, a speaker icon for sound, a timeline bar with hook and CTA marked for timing steps).
- **Tiles**: every tile is an animated preview of that exact option (section 7.2). A selected tile shows a check and a one-line "What this does" in plain English under the grid.
- **Footer**: `Back`, a step counter ("Words on screen, 3 of 8"), `Next` (or `Skip` when the step allows none).
- **Section bar** at the top shows sections, not steps: Pace, Words, Between shots, You, Extras, Look, Content, Sound, Finish. Locked sections show a check and can be reopened.
- The zone for each option kind comes from `kit/studio/wizard/steps.json` (`zone`: captions | titles | presenter | seam | frame | time | sound | layout).

Copy rules: plain English, short, no em dashes, no engine words (no "allow", "deny", "flag", "layer", "mode 7"). Each step's copy lives in `steps.json` so it is checked by the humanizer lint in `npm run check`.

## 7. Preview strategy

### 7.1 Live text preview (step 9, and small live tiles on steps 3 to 8)

The engine draws every caption and title on one 1080x1920 canvas in `kit/overlay.html`, driven by `window.seek(t)` and the globals `CAPTIONS`, `THEME`, `FONTS`, `LOCKOVER`. So the preview is the real renderer, not a mock:

- New route `GET /api/preview/overlay?plan=<id>` serves `overlay.html` with generated `captions.js`, `theme.js`, `fonts.js` for a fixed **sample script** (two caption lines and one title with a key word, e.g. "Build your first agent | THIS WEEKEND"), built through the same functions `kit/reel.cjs` and `kit/render.mjs` use. If those builders are not importable without a job, Phase 5 extracts them into `kit/preview-captions.cjs` first, unchanged in behavior.
- The page puts it in an `<iframe>` over the sample presenter and calls `seek(t)` from `requestAnimationFrame`, looping 6 s. Replay and Pause buttons. Respects reduced motion (shows the settled frame).
- Behind the head: a second iframe with `LAYER=titles` under a CSS `mask-image` of `showcase/source/presenter-mask.png`, the same split the render uses.
- Sample presenter: `showcase/source/presenter.jpg` (fictional, AI made for this project, already public) with a gentle 6 s push so motion reads. If the user already picked their own clip on the start screen, a toggle "Preview on my clip" uses a 6 s stretch of it, with the face box from `facezone.py` to prove text stays off the face.
- Open question for Will: a short fictional presenter video clip would make previews look real. No brand imagery is used without his OK.

### 7.2 Effect demos that show the effect (every tile)

- New script `kit/demos.mjs` renders a 2 to 3 s loop (webp, 270x480, about 40 to 80 KB) for every option that has no animated demo: effects, graphics, finishes, title layers, presenter effects, layouts, filters with timing. It reuses `kit/showcase.mjs` and `npm run fx` on a short moving plate made from the sample presenter.
- Output: committed for the options the builder shows (budget about 8 MB total, like `docs/menu`), the rest cached locally in `jobs/.studio/demos/`.
- Studio gets a `Make missing previews` button in Settings (runs the script on the server, no terminal).
- **A test that a demo shows something:** `tests/demos-visible.test.mjs` compares each demo's frames against the plain plate loop. If the mean pixel difference across frames is under a threshold, the demo fails as "shows nothing". This is the guard for "some effect demos don't show what they do".
- Rule: the builder only shows an option that has a passing animated demo. An option without one stays in All options until it gets one.
- Sound tiles (beds, sfx) get a play button with a waveform, not an image.

## 8. Engine additions the builder needs

Small, each behind a flag the CLI also gets, so the engine stays usable without Studio:

1. **Sections: hook, body, CTA.** `kit/sections.cjs` tags each segment of `cut.json` (`"section": "hook" | "body" | "cta"`): hook = from 0 to the look's hook length or the first line end after 3 s; CTA = the last line(s) matching `goalwords.cjs` / the CTA word list `plan.cjs` already uses (follow, subscribe, link, try, join). Used by filter timing, transition "hook and CTA only", presenter effect "when".
2. **Filter timing.** `--finish-when whole|hook|cta|hook-cta`: writes per-segment `finish` only on those sections (per-segment finish already works, `assemble.cjs` 132).
3. **Key-word level.** `--key-words off|subtle|strong|dramatic` sets the kinetic hero scale, weight and accent use, and how many per line. Never larger than the face-safe band allows; `overlay.html` layout pass still moves text off the face.
4. **Transition timing.** `--transitions-when every-cut|topic|hook-cta` limits named transitions to those seams; other seams are hard cuts.
5. **Presenter effect timing.** `when` per effect maps to `fx.json` windows on tagged sections.
6. **Repo mode layout** (section 9).

## 9. Repo or tool feature mode

Checkbox on step 15. When on:

**Inputs.** 1 to 3 public GitHub URLs (validated `https://github.com/<owner>/<repo>`). A slot "Example video (optional)" for Will's reference example: when he shares one, run it through Teardowns and set it as this mode's default template.

**B-roll pipeline** (`kit/repo-broll.mjs`, public pages only, same rules as `capture.mjs`: http(s), no private addresses, fresh profile, no login, nothing sent anywhere else):
1. Fetch the README (GitHub's public raw README for the default branch).
2. Collect visual assets in order of appearance: images, GIFs, linked videos (mp4/webm). Skip badges (shields.io, badge, under 40 px tall), logos under 200 px, and anything not image or video.
3. Download to `assets/web/<owner>-<repo>/` (gitignored), with `meta.json` (source URL, alt text, the README heading it sits under).
4. **The repo rule** (Will, 2026-11-27): the b-roll never cuts to full screen, plain text or README text. No README or page capture and no text card of the repo; README pictures show inside the repo card only. `repoRuleBreaks()` checks every repo insert, `apply` refuses a cut that breaks it, and `plan-check` has a `repo-rule` row.
5. **Animated cards** (`kit/repo-mockups.mjs`): `readmeScore()` scores the README's own visuals (video 3, big picture 2, small 1; 4 or more is good). Weak: proof (browser card, once), terminal (the README's real command and output lines, or `git clone` plus the real top-level files), features (wheel up to 6, grid up to 9, from the README's own list), flow (only when the description says X into Y), stats (10 or more stars). Good: proof and terminal join the README's pictures. README pictures are wrapped in a window card (when the cards can be made: Chrome, about 0.8 GB free, `ATH_REPO_MOCKS` not 0). Lane b-roll set to full screen goes into the card while repo mode is on. Nothing is invented: every word comes from GitHub's facts or the README.
6. Match assets to lines: the agent (or `broll-brief.cjs` without an agent) maps each asset's heading and alt text to the transcript lines that mention it. Unmatched assets go in order.

**Layout.**
- Default: **Split**, repo on top, you on the bottom (`split.cjs` `"top"`, with the person mask so your head sits over the panel edge).
- **Takeovers**: the repo is never full screen. `takeovers: auto` puts you full screen on the hook, the punch lines and the CTA; `off` keeps the repo card on every line in the middle (you full screen on the hook and CTA). A line that names a matched heading gets that picture. Pictures on a long line change every `swapSec` (default 2 to 4 seconds). `takeoverSec` is still accepted on old plans and changes nothing.
- **Layout**: `bands` (default `{ repo: 0.45, captions: 0.10, you: 0.45 }`) is the 9:16 split for framed repo cards in `kit/split.cjs` `frameFromBands`. Null uses that default when frame breakout is on. `frameBg` is an optional two-colour backdrop (default a soft grey, not a branded grid). `headline` is an optional short title with one highlighted word; when on, `pending()` lists it until it can be drawn.
- **Starter**: `kit/studio/starters/repo-feature-breakout/template.json`, labelled **Repo feature (breakout)** in the Template Library, is a shipped plan (repo mode on, empty `repos`, frame breakout, word-by-word captions). A plan may have `repoFeature: true` with no links; `needed()` asks for one, Make and the draft wait, and `repo-broll` waits.
- **Frame breakout** (`split.cjs` `"frame"`, head breaking out of the card) is on by default in repo mode (on the repo split shots). Turn it off in step 11 if you want the plain split instead.
- Captions move into the seam band (`capY` in `split.cjs`), never on the face, never on the repo's key text.

## 10. The agent: build, then check frame by frame

The agent takes `video-plan.json` (and the template's `look.json` when one is picked) and the notes, and works in rounds:

1. **Plan scenes.** Lines to keep (never cut words; `cutpoints.cjs` rules), sections tagged, where each choice lands (titles on which lines, which seams get which transition, presenter effects windows, takeovers in repo mode). Writes `build/scene-plan.json`.
2. **Draft render** with the existing pipeline (`draft`, `render` MCP tools).
3. **Checkpoints.** `kit/plan-check.mjs` lists the frames to check: each title mid-entrance and settled, each named transition mid-seam, each presenter effect window, each filter boundary, each takeover start, first caption, hook end, CTA. Frames are pulled with the existing capture path (`framecap.mjs`, `verify.mjs` stills).
4. **Check each frame against the plan,** two kinds:
   - Measured (no model): text boxes vs face box (`facezone.py`, `BOXES_AT`), caption style fields and fonts (`fidelity.cjs` captions/font parts), transitions used are only the picked ones, filters only in the picked sections, key words per line within the level, legibility contrast (`legibility.py`), picture faults (`picturecheck.cjs`), and against a template the `fidelity.cjs` parts (framing, grade, captions, font, stickers, sfx, pace).
   - Looked at (agent vision, when an agent is connected): "Does this frame show <selection> as the demo did?", and the user's notes.
5. **Fix and repeat.** Each failed check becomes a fix line (what, where, why), applied to the plan or cut, then only the affected segments re-render. Up to 3 rounds; then stop and show what is still off.
6. **Report.** `build/plan-check.json` `{ round, checks: [{ id, selection, frame, time, ok, measured, note }] }`. Review shows a **Plan check** panel: one row per selection with a check or a warning and the frame thumbnail, plus "Ask the agent to fix this".

No agent connected: steps 1 to 3 and the measured checks still run (the deterministic path that drafts today); only the looked-at checks are skipped, and the panel says so in plain words.

New MCP tools (`kit/mcp.mjs`): `get_video_plan`, `set_video_plan`, `list_templates`, `save_template`, `plan_checkpoints`, `check_frames` (runs the measured checks, returns failures), `report_plan_check`. The Studio chat loop instructions (`skills/aigent-studio`) get the round procedure.

## 11. Phased PR plan

Each PR is small, keeps every old `#step=` link landing, passes `npm run check`, `npm run contract`, smoke and `npm run studio:build`, and is reviewed by Fable 5.2 plus Ponytail before merge. No version bumps inside PRs; we bump at release (v1.30.0 is still held for the Fable pass, so this work ships as 1.31.0 or later).

| Phase | PR | Ships | Shippable alone because |
|---|---|---|---|
| 1 | Plan model, step map and persistence | `kit/studio/wizard/plan.mjs` (incl. `fromTemplate`, explicit off states), `steps.json` (every option has a step, zone, plain copy), `from-look.mjs`, `videoPlan` state lifecycle, Render rebuild reads the plan (section 14), tests, `get/set_video_plan` MCP tools. No UI change | Data, engine plumbing and tests; today's output unchanged |
| 2 | Three tabs | Top tabs New video, Teardowns, Recording. Recording tab holds Recorder, Prompter, Scripts, and a Recordings list indexed across videos (record without a video first). Teardowns tab holds today's breakdown. New video still shows today's steps | Moves screens only |
| 3 | Demos that show the effect | `kit/demos.mjs`, committed loops for builder options, visible-change test, Make missing previews button | Old Studio tiles get real motion at once |
| 4 | Builder frame and start screen | Source picker (Recordings, upload, link), Build my own (Use a template card arrives in Phase 8), `StepFrame`, `ZoneMap`, section bar, Pacing step | Builder with one step that writes a real plan; old steps reachable |
| 5 | Words on screen | Steps 2 to 9 and the live overlay preview | Text section complete |
| 6 | Between shots, You, Extras | Steps 10 to 12, transition and presenter timing flags, sections tagging (`kit/sections.cjs`) | |
| 7 | Look, Sound, Finish | Steps 13, 14, 16, 17 (notes and summary, All options fold), filter timing flag | Builder end to end on the old render path |
| 8 | Template Library | `template.json`, Library grid in Teardowns, Save as template (teardown and builder), template on start screen skips to Your notes | |
| 9 | Repo feature mode | Step 15, `kit/repo-broll.mjs`, split and takeover planner, example slot | |
| 10 | Plan check loop | `plan-check.mjs`, `scene-plan.json`, MCP tools, Review Plan check panel, re-render rounds | |
| 11 | Clean up and the mom test | Retire old step bar (aliases kept), docs and screenshots, a scripted first-run test: a new user makes a video from a recording with no terminal | |

## 12. Gaps found in today's Studio

1. **Demos.** 114 of the visual options show one still of a still presenter; all motion effects read as nothing (`lean-in`, `slow-push`, `moody`, `swipe`, `tap`, `locked-on`). 27 more have no preview. Words behind the head is a still too.
2. **Steps follow the engine, not decisions.** Picture and Text each hold several unrelated decisions in tabs; about 300 options with allow/deny semantics; no "applies to" anywhere.
3. **Recording and teardowns are buried.** Record now sits inside Start; the breakdown is a second view of Picture and a Wizards card; saved looks exist (`stylelooks.mjs`) but are not a library and cannot skip steps.
4. **Missing pieces Will asked for:** filter timing (hook/CTA), repo/tool feature mode (the parts exist: `capture.mjs`, `split.cjs` top and frame breakout, the person mask), key-word emphasis level, a combined live preview of text choices, a notes box tied to the plan, pacing as one first choice (today pacing only tightens pauses on Cut).
5. **No single plan to check against.** `fidelity.cjs` estimates against a reference, `verify` checks overlaps and safe areas, but nothing checks "did the video do what I picked".
6. **Order trap.** Caption entrances only move kinetic captions (`conflicts.mjs`), so "how words come in" before "kinetic or captions" would show choices that do nothing. We ask the caption type first.
7. **Library rule.** The page uses Astryx (`@astryxdesign/core`) in 33 files, documented in `docs/studio.md`. Our rule says React, StyleX, Headless UI and Open Props only. New builder code uses only those four; whether to migrate the old Astryx parts is Will's call.

## 13. Decisions for Will

1. OK to put Graphics as one light step (12), defaulting to "Let the agent choose"?
2. A fictional presenter video clip for previews, or keep the still presenter with a gentle push?
3. Migrate existing Astryx components to Headless UI + StyleX (one extra PR), or leave them?
4. Send the repo-feature example video so Phase 9 can copy its timing.

## 14. Corrections from the code review (binding for every phase)

A review against the code (2026-11-25) found these. They override anything above that disagrees.

1. **`state.finish` is taken.** It controls what Render makes (`core.mjs` 133, 309 to 320). Filters are `picks["finish:<id>"]`. Filter timing must leave the job-wide `cut.finish` unset, since `assemble.cjs` 70, 164, 167 apply it to the whole video, including finishes that recipes, presets and packs set (`reel.cjs` 461 to 465, `preset.cjs` 181 to 190).
2. **"None" and "off" must be expressible.** Today denying every transition gives an empty list and `compose` adds no lock, so the engine picks freely; Just captions or no Big titles does not turn titles off (titles come from the look or pack, `conflicts.mjs` `contextOf`, `reel.cjs` 254). Phase 1 adds explicit locks: transitions `none` (hard cuts only), titles `off`, and `toState` clears old picks before applying, then runs `CF.settle` and reports anything it refused.
3. **New options must survive Render.** `server.mjs` 312 to 319 rebuilds with only `--lock`, `--motion`, `--export`. Every new engine option (key words, filter timing, transition timing, presenter timing, repo layout, plan-check fixes) is written into `cut.json` or `captions.js` and honored on rebuild, wired through `compose`, `reel.cjs` and `contract.json`. Tests cover draft, then rebuild, then render.
4. **The catalog is Studio's, not the raw menu.** `validate`, `toState` and the "mapped exactly once" test use `core.mjs` `catalog()` (menu plus `categories.json`, packs, beds, local scenes, lines 82 to 122), excluding machine-local `ref-*` scenes so `npm run check` does not depend on the machine. Pacing has a fifth state, `look` (tighten `null`, the Look decides), so `fromState` round-trips.
5. **`videoPlan` lifecycle.** Add `videoPlan` to the fields `applyPatch` accepts (`core.mjs` 194 to 195). Rules: new video starts a fresh plan; `resetEdit` (footage added) keeps style fields but clears `source`; Undo and Keep my look include it in `LOOK_KEYS`. One writer rule: the plan is the source of truth for builder fields; an edit from a classic step, chat or MCP updates the plan through `fromState` for the fields it changed and never wipes plan-only fields (notes, timings, content).
6. **Recordings across videos.** Takes live per job (`state.takes`, older ones in `videos/<job>.json`), recording needs a job (`record.mjs` 21), and `applyPatch` only accepts files inside `inbox/studio/<current job>/` (`core.mjs` 296). Phase 2 adds a recordings index across jobs, lets the Recording tab record into a holding job (`inbox/studio/_recordings/`), and on Use in a new video moves (not copies) the take into the new job's inbox with its script (`server.mjs` 287).
7. **Presenter effects reality.** Catalog effects run only at Render through `fx.cjs` when `effects/.venv` exists, and `fxPlan` picks beat windows itself, skipping effects that need text (`server.mjs` 321 to 325). Phase 6 adds a `when` input to `fxPlan` and the plan check reads fx output after Render, not from the draft. When effects are not set up, the step shows those tiles as "Needs the effects add-on" with a Set up button (no terminal text).
8. **Frame breakout needs something in the top card.** It is a b-roll insert layout (`split.cjs` 6). In repo mode it is on by default and uses the framed cards on the repo split shots. Outside repo mode it is kept in the plan and does not show yet. Its demo uses a generated sample card, not real b-roll.
9. **Preview details.** The overlay layers are chosen with `seek(t, 'titles')` and `seek(t, 'front')` (`overlay.html` 1588), not a `LAYER` global. The page also loads `fxzones.js`, `lockover.js` and `gfx.js`. `fonts.mjs` 19 writes `file://` URLs, which the preview route rewrites to served `/fonts/...` paths. Sample captions carry the sample presenter's face data (`caps.faceTrack`, `reel.cjs` 941) so the face-safety test is real.
10. **Repo downloads need stricter network rules than `capture.mjs`.** Only its first and final URLs get DNS checks (`capture.mjs` 66). `repo-broll.mjs` DNS-checks every URL and every redirect hop, pins the connection to the checked address, and caps size (25 MB) and type (image or video only).
11. **Phase order.** Phase 1 includes items 2 to 5 (the bridge and persistence). Phase 4 ships Build my own only; the Use a template card appears in Phase 8 with the Library. Plans may hold `pending` choices that render nothing yet; the page labels them "Coming soon" instead of letting them silently do nothing. Retiring Wizards keeps the MCP `run_wizard` tool working (it maps onto a plan).
