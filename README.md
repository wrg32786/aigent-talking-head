# aigent-talking-head

**aigent-talking-head is a free, open-source (Apache-2.0) talking-head video editor that turns one phone clip into a captioned vertical reel for TikTok, Instagram Reels and YouTube Shorts, run by you or your coding agent (Claude Code, Codex, Cursor or any MCP client) on your own machine with Whisper, FFmpeg and Chrome.**

Made by Will Gwyn at [The AIgent](https://theaigent.xyz).

[![GitHub stars](https://img.shields.io/github/stars/wrg32786/aigent-talking-head?style=social)](https://github.com/wrg32786/aigent-talking-head/stargazers)

If it saves you an edit, a ⭐ helps other creators find it.

[Quick start](#quick-start) · [Studio](#studio-edit-in-a-browser-with-your-agent-in-the-chat) · [Install](#install) · [Features](#features) · [How it compares](#how-it-compares) · [FAQ](#faq) · [Show your reel](#show-your-reel) · [Agent skill and MCP](#how-agents-use-it-skill-and-mcp) · [Guide](docs/guide.md) · [Full gallery](showcase/GALLERY.md) · [Get guidance](#get-guidance)

![Before and after: a plain phone clip on the left, the finished reel with kinetic captions and graphics on the right](kit/example/demo-reel/before-after.gif)

Phone clip on the left, finished reel on the right. [Watch the 40-second demo reel](kit/example/demo-reel/demo-reel.mp4) (20 effects) or read [the plan files behind it](kit/example/demo-reel/).

## What it does

- **Transcribes your clip locally** with Whisper and cuts it into clean sentences, keeping the best take of each.
- **Captions every word on time**, with kinetic hero words and titles that can sit behind your head.
- **Plans graphics from what you say**: a number becomes a stat callout, a list a checklist, the close a call-to-action card. The words on a graphic are words you said.
- **Keeps your face clear**: a title or graphic set behind you goes behind only your hair and crown, never your face, and a layout pass moves captions out of the way of graphics.
- **Exports for each platform** inside its safe area, then checks the finished file (loudness, overlaps, safe area) before you post.
- **Works from your agent**: a one-line skill install for Claude Code, Codex and Cursor, plus a local MCP server.

## Quick start

**With an agent.** Paste this into Claude Code, Codex, Cursor, Gemini CLI, OpenCode or any agent that runs commands and reads `SKILL.md` skills:

```
Read https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/INSTALL.md and follow it to install aigent-talking-head in this agent.
```

Then ask it: "Make a reel from the newest clip in my inbox."

**By hand.** Install once ([Install](#install)), then `npm run smoke` should end with `SMOKE PASS`. Record yourself upright on your phone, drop the file in `inbox/`, and:

```
npm run reel -- inbox/my-take.mov --name my-reel --draft     # 1. transcribe and cut (Whisper small.en)
npm run plan -- my-reel                                      # 2. graphics proposed from what you said -> jobs/my-reel/Reel.md
#                                                              3. review the Reel.md: keep, change or delete lines
npm run reel -- --recipe jobs/my-reel/Reel.md --clips jobs/my-reel/clips --name my-reel --force --export reels   # 4. render
npm run verify -- my-reel --export reels                     # 5. VERIFY PASS, then look at jobs/my-reel/verify/contact.png
```

You get `jobs/my-reel/reel-v1.mp4` and `reel-v1-reels.mp4` (inside Instagram's safe area). Exports: `tiktok`, `reels`, `shorts`, `feed45` (4:5), `square`.

- Just captions and titles, one command: `npm run reel` (newest video in `inbox/`).
- Change something: edit `jobs/<name>/build/captions.js` or `build/cut.json`, then `npm run reel -- --rebuild --name <name>`.
- Accuracy over speed: `--model large-v3` (about 3 GB, downloaded once, a notice prints first).
- Everything else (looks, edit rules, themes, manual steps, presets, the file map) is in the [user guide](docs/guide.md). Every command and flag is in [contract.json](contract.json).

Made a reel? [Star the repo](https://github.com/wrg32786/aigent-talking-head) and [share it](#show-your-reel).

## Studio: edit in a browser, with your agent in the chat

Studio is a local page for making a reel without memorising commands. Drop in your footage or film it right there, paste links to reels you like, click effects from a visual menu, pick a style pack, music and pace, then draft and render. The chat on the page is answered by your own terminal agent (Claude Code, Codex, Cursor or any MCP client), so it can change the edit for you while you watch. Everything runs on your computer. Full guide: [docs/studio.md](docs/studio.md).

**Set it up by telling your terminal agent:**

```
Install aigent-talking-head, set up Studio from AGENTS.md and run the Studio chat loop.
```

The agent clones and installs the kit, registers the MCP server in its own config (`npm run studio:connect -- claude`, `codex` or `cursor`), starts Studio with `npm run studio:agent`, opens the page and listens. Step by step for each agent: [docs/setup-with-ai.md](docs/setup-with-ai.md) and the Studio section of [AGENTS.md](AGENTS.md).

**No terminal?** One line installs everything and puts a "Talking Head Studio" icon on your desktop:

- macOS or Linux: `curl -fsSL https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.sh | bash`
- Windows (PowerShell): `irm https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.ps1 | iex`

Then run `npm run studio` (or click the icon). Without an agent the chat works on keywords, a local model or an API key.

<img src="docs/studio/desktop.png" width="720" alt="Studio in a browser: four steps across the top, the Style step with style packs and a grid of effect previews, the picks tray floating at the bottom, and the chat in a frosted glass panel on the right with Claude Code connected and listening">

**Reference links.** Paste one or more links (YouTube and Shorts, TikTok, X, Vimeo, a direct .mp4, or one public Instagram post) and Studio downloads each to a folder on your computer, shows the progress, and breaks it down: length, shots and cut times, pace, music BPM and energy, caption style, transitions, finishes and graphics. It then suggests matching items from the effects menu. The breakdown goes into the chat, so "use the transitions from the reference but calmer" works. Use it as an influence (soft defaults) or recreate its structure with your clip. Link downloads need [yt-dlp](https://github.com/yt-dlp/yt-dlp), which the installer adds; Instagram uses [instaloader](https://github.com/instaloader/instaloader) anonymously, with no login. Only use videos you have the rights to use as a reference.

<img src="docs/studio/ref-url-desktop.png" width="720" alt="Studio Reference step: a pasted YouTube link broken down into 90 seconds, 17 shots, 123 BPM and a 5.29 second average shot, a shot timeline with a beat grid, tags for what was found, suggested picks as chips, and a contact sheet">

**Record now.** No clip yet? Film it in the Footage step with your computer's camera and mic. Pick the camera and mic, choose 9:16 (the default), 16:9 or 1:1, and record with a 3, 2, 1 countdown, pause and a timer. Framing guides show where your head goes so titles can sit behind it and captions below, and an optional teleprompter scrolls your script near the lens. Every take is listed with a thumbnail: keep it, drop it from the edit, or retake. A kept take is converted to an mp4 and joins your footage right away, and your agent gets a one-line note ("New take recorded: 42 s"). The recording is sent to Studio in small pieces as you film, so a long take is not lost to one failed upload, and nothing leaves your computer. Browsers only allow the camera on a secure page, which `http://127.0.0.1` is. On a phone, open Studio on the phone itself or over https; Studio never opens itself to your network.

<p>
<img src="docs/studio/record-desktop.png" width="520" alt="Studio Record now: a 9:16 camera preview with framing guides for the head and the caption band, the record button and timer, camera and mic pickers with a mic level meter, frame, mirror, guides, countdown and teleprompter switches, the script box, and a saved take marked In footage">
<img src="docs/studio/record-phone.png" width="200" alt="Studio Record now on a phone: the 9:16 camera preview with framing guides fills the width, with the timer and record button below">
</p>

**Scripts and a teleprompter.** The Footage step has a Scripts area: write, rename, duplicate and delete scripts for the reel, with a word count and read time at your pace, and optional `[hook]`, `[body]`, `[cta]` and `[pause]` marks. Ask your agent for one ("write a 30 s script on cold showers", "rewrite this tighter"), or press **Write script from this reference** after a breakdown and it writes one that follows the reference's hook, pacing and beats. Agents run the bundled [humanizer](https://github.com/blader/humanizer) skill (MIT, by Siqi Chen) on every draft so it sounds like you; the API and local model chat follows its rules too. In Record now, pick a script and the teleprompter paces it at your words per minute from the moment the take starts, highlights the line you are on, holds on `[pause]`, stops when you pause, and can mirror the text for a beam-splitter rig. Space records and stops, P pauses, the arrows change the pace. A take remembers its script, and the next draft hands that script to Whisper so the captions spell your words. Pacing is a timer: voice-follow would need the browser's speech recognition, which in Chrome sends your audio to a server.

<p>
<img src="docs/studio/scripts-desktop.png" width="520" alt="Studio Scripts area: a list of scripts with word counts and read times, the editor with Hook, Body, CTA and Pause buttons, a WPM box, the stats line with section start times, and a Read it in Record button">
<img src="docs/studio/teleprompter-phone.png" width="200" alt="Studio teleprompter on a phone: the current line of the script highlighted near the top of the 9:16 camera preview, with section labels">
</p>

**Effects menu.** Every transition, title entrance, caption style, graphic, finish and sound in 17 categories, each a looping preview with just its name. Hover for the details, click to pick, use the forbid button for what you never want, and your picks collect in the tray at the bottom. Once you pick any transition, only picked transitions are used, and the same for each kind.

<img src="docs/studio/menu.png" width="720" alt="Studio effects menu on the Transitions tab: animated preview tiles with glitch forbidden and whip picked, a hover card describing dip-black, and the picks tray at the bottom">

**Style packs.** Pick a pack such as cinematic or magazine as a starting point; your own picks always win. A reference can become its own local pack.

**Two separate chats.** The Studio chat and your terminal conversation are separate channels. Studio shows only what you type on the page, your agent's replies to it and its Studio actions, never the terminal conversation. Each message shows whether it is queued, seen by your agent or answered. Edits from either place update the page live, and when the agent changes the edit from the terminal, Studio can show a one-line note such as "picked caption style kinetic (from the terminal)" (a setting, on by default). An agent can't be interrupted in the middle of a step: messages wait until its next step, and a Claude Code hook tells it how many Studio messages are waiting.

<p>
<img src="docs/studio/chat-agent.png" width="300" alt="Studio chat with a Claude Code, listening badge: page messages marked Answered, the agent's replies, and a one-line action note for an edit made from the terminal">
<img src="docs/studio/chat-phone.png" width="300" alt="Studio chat as a full-screen sheet on a phone: the agent status badge, messages marked Answered and the agent's replies">
</p>

**Settings.** Dark by default, with a light theme. The chat, step bar and settings are frosted glass panels; a switch turns them solid on older computers. Choose who answers the chat (your terminal agent by default, or a local model through Ollama, LM Studio or llama.cpp, the Claude or OpenAI API, or keywords only), where reference downloads go, and where finished reels are copied.

<img src="docs/studio/settings.png" width="720" alt="Studio settings in a side sheet: who answers the chat with a local model picked, the action note switch, the reference downloads and finished reels folders, and the theme">

On a phone each step stacks into one column and the chat opens as a sheet: [reference](docs/studio/ref-url-phone.png), [effects](docs/studio/menu-phone.png), [settings](docs/studio/settings-phone.png). Studio also speaks [AG-UI](docs/studio.md#ag-ui), so AG-UI clients can watch it or send it messages. The page is built with React and [Astryx](https://github.com/meta/astryx) and ships prebuilt, so nothing extra installs. Reference screenshots show Big Buck Bunny (c) Blender Foundation, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), blender.org.

## Install

| Need | Mac | Linux | Windows |
|---|---|---|---|
| Node 18+ | `brew install node` | your package manager or nodejs.org | nodejs.org installer |
| ffmpeg + ffprobe | `brew install ffmpeg` | `sudo apt install ffmpeg` | `winget install ffmpeg` |
| Python 3.9+ (3.11+ for the BiRefNet mask) | `brew install python` | usually installed | python.org installer (gives `py`) |
| Chrome or Chromium | google.com/chrome | `google-chrome` or `chromium` package | google.com/chrome |

Then, in the repo folder:

```
npm install
python3 -m pip install -r requirements.txt      # Windows: py -3 -m pip install -r requirements.txt
npm run chrome                                  # prints the Chrome it found
npm run smoke                                   # synthetic clips end to end, several minutes, no footage or keys needed
npm run check                                   # copy lint self-test over the examples
```

Skills for your agent: `npx skills add wrg32786/aigent-talking-head` (details in [How agents use it](#how-agents-use-it-skill-and-mcp)). Agents can do the whole install from [the agent install steps](INSTALL.md).

Optional teardown engine: `npm run teardown -- <file> --install` adds [rea-video](https://github.com/JuneYaooo/rea-video) (Apache-2.0) to the kit's Python.

Chrome is found automatically in the usual Mac, Linux and Windows install paths or on PATH. Set `CHROME_PATH` to use a different one. Set `PYTHON` if your Python isn't `python3` (or `py` on Windows). `npm run smoke:whisper` also runs a tiny Whisper model. Your footage, `jobs/` and `.env*` files are gitignored.

Optional: a HeyGen account with Cinematic Avatar if you generate takes, and `FREESOUND_API_KEY` if you search for new sounds.

## Features

| What | How many | Where to look |
|---|---|---|
| Overlay graphics (stat callout, checklist, lower third, CTA, code card, data chart, terminal, number pop and more) | 30 | [Graphics](#graphics), [kit/graphics.json](kit/graphics.json) |
| Transitions, six of them drawn by the kit | 56 | [Effects menu](docs/effects.md#transitions) (animated previews) |
| Effects, sorted by moment (hook, claim, list, proof, CTA) | 51 | [Effects catalog](effects/CATALOG.md), [effects menu](docs/effects.md#effects) |
| Caption styles, plus 9 letter-by-letter entrances for hero words | 7 | [Effects menu](docs/effects.md#caption-entrances) (animated previews) |
| Title entrances, in front of or behind your head | 9 | [Effects menu](docs/effects.md#title-entrances) (animated previews) |
| Film finishes | 10 | [Film finishes](#film-finishes) |
| Font pairings (SIL OFL) | 19 | [kit/fonts](kit/fonts/README.md) |
| Brand presets | 11 | [Presets](#presets) |
| Editing principles built in: mixed serif and sans, titles placed around the head, colour and chapter cards, music by energy, mapped and capped sounds, punch-ins, no dead air | 7, all in `--preset magazine` | [Guide](docs/guide.md#editing-principles-built-in), [effects menu](docs/effects.md#editing-principles) |
| Sound effects and CC0 music beds, beat-synced | 37 and 11 | [Music beds](kit/music/README.md) |
| Export presets: TikTok, Reels, Shorts, 4:5, 1:1 | 5 | [Quick start](#quick-start) |
| Studio: a local page for reference links and teardowns, the visual effects menu, a chat your agent answers, draft and render | 1 | [docs/studio.md](docs/studio.md) |
| Agent skills, installed with `npx skills add wrg32786/aigent-talking-head` | 8 | [Agent skill and MCP](#how-agents-use-it-skill-and-mcp) |
| MCP tools: menu, list_effects, list_packs, get_pack, draft, explain, set_locks, plan, validate, render, verify, and fourteen for Studio and scripts | 25 | [MCP setup](docs/mcp.md) |

Also: a `plan` step that proposes graphics from your transcript, a layout pass that stops overlaps, `verify` with a contact sheet, [Reel.md recipes](#reelmd-recipes) you can share, and [teardowns](#remake-a-reel-you-like) that turn a reel you like into a recipe. `npm run menu` prints every option.

### Effects menu

**[docs/effects.md](docs/effects.md)** is the menu of every transition, title entrance, caption entrance and caption style, each with a looping preview, its exact name and the line to paste. `npm run list -- transitions` (or `titles`, `captions`, `graphics`, `effects`, `editing`) prints the same list in a terminal, and `--json` gives it to agents.

<img src="docs/menu/sheets/transitions.webp" width="720" alt="Animated grid of all 56 transitions, each labelled with its name: glitch, cut, crossfade, dissolve, dip, flash, whip, push, swipe, cover, reveal, wipe, iris, doorway, barn door, zoom, pixelate, blur, radial, squeeze, slice, wind, warp, slats, checkerboard, light leak, zoom blur and news ribbon">

### See everything, take control, make your own pack

**See everything.** [docs/effects.md](docs/effects.md) shows every transition, title entrance, caption entrance and caption style animated. `npm run menu` prints every option, and `npm run list -- packs` lists the style packs.

**Pick a whole look.** A style pack bundles a preset with locks: `npm run reel -- inbox/take.mov --pack magazine`. Six ship in [packs/](packs/), each with a preview in the [pack gallery](docs/packs.md): aigent, magazine, cinematic, hormozi-bold, minimal-clean and neutral.

<img src="packs/magazine/preview.webp" width="160" alt="magazine pack preview: typewriter title, chapter card, crossfade"> <img src="packs/cinematic/preview.webp" width="160" alt="cinematic pack preview: blur-rise title, film dissolve"> <img src="packs/hormozi-bold/preview.webp" width="160" alt="hormozi-bold pack preview: slam title, bold caps captions, glitch cut">

**Take control.** The kit picks transitions, title entrances, finishes and graphics for you. Lock what you care about and it only picks inside your choices:

```
npm run reel -- inbox/take.mov --pack magazine --lock "transitions=whip,zoom; titles=typewriter; no-graphics=checklist" --draft
```

Every draft prints what it picked per beat and why (locked, from the pack, from the recipe, or the kit's default) and saves it to `jobs/<name>/choices.json`. Change any pick there, then `npm run choices -- <name> --apply` and `npm run reel -- --rebuild --name <name>`.

**Make your own pack.** `npm run pack:new -- my-look --from magazine` writes `packs/local/my-look/pack.json`. Edit its style and locks, then `npm run pack:validate -- my-look` and `npm run pack:preview -- my-look`. Share the folder and anyone can use it with `--pack ./my-look`. The format is in [docs/packs.md](docs/packs.md) and [packs/pack.schema.json](packs/pack.schema.json).

### Effects

![Contact sheet of all 51 video effects on the AI presenter](showcase/sheets/effects.jpg)

### Graphics

30 overlay graphics, each with its own entrance and exit, drawn in your theme's colours and fonts: ordinal sticker, app label, screen card (with an optional pointer that clicks and a camera that zooms and pans), lower third, stat callout (counts up, or rolls like an odometer), checklist, quote card, highlight (circle, arrow, underline or box), step counter, versus card, icon badge, sticker pop, price tag, CTA end card, code card, data chart (bars or a line), chapter card, logo bug, channel bug (LIVE and a clock), terminal session, news strap, ticker, split-flap board, feature cards, release pill, CTA button (a pointer clicks it), HUD callout, flash cards, keyword caption and number pop (the numbers 1 to N popping in around your head for a list intro). They share one card look (soft two-layer shadow, top-lit fill, fine grain, rim light), spring and emphasized easing with motion blur on fast moves, tabular digits and Tabler icons (MIT). Bring your icon or screen recording where a graphic takes one, or the kit draws a neutral placeholder.

![All 29 graphics in motion: ordinal sticker, app label, screen card, lower third, stat callout, checklist, quote card, highlight, step counter, versus, icon badge, sticker pop, price tag, CTA card, code card, data chart, chapter card, logo bug, channel bug, terminal session, news strap, ticker, split-flap board, feature cards, release pill, CTA button, HUD callout, flash cards, keyword caption](showcase/loops/graphics.gif)

![Contact sheet of all 30 overlay graphics on the AI presenter](showcase/sheets/graphics.jpg)

Add one as a line in a Reel.md (`#06 15-17 | type stat-callout | text 10,000+ | sub readers`) or a `captions.js` flip. The words on a graphic have to be words you say: on a recipe job the kit drops any you don't, and a checklist ticks each row as you say it. Add `cues` (words you say, or seconds) and a chart bar, a terminal command, a feature card or a flash card lands on the word. Set `layer behind` and only the top of your head (hair and crown) goes over the graphic, never your face. Every type, field and default is in the [Reel.md spec](docs/reel-md.md) and [kit/graphics.json](kit/graphics.json).

### Film finishes

![Contact sheet of the 10 film finishes: grain, vignette, chroma, scan lines, warm, cool, teal, crushed, mono and bleach](showcase/sheets/finishes.jpg)

### Title entrances

Titles sit in front by default. Set a title behind the head, or use auto for the strongest 1 or 2 punch titles.

![The same title placed in front of the presenter's head and behind it](showcase/sheets/title-layer.jpg)

<img src="docs/menu/sheets/titles.webp" width="720" alt="The 9 kinetic title entrances playing in a loop, each labelled: stagger-rise, slam, blur-rise, slide-left, elastic, flip, pop-zoom, drop and typewriter">

Each entrance plays in a loop above. Names, descriptions and the line to use are in the [effects menu](docs/effects.md#title-entrances).

### Captions and type

Top captions tuck behind your hair where they meet it (`--caption-layer front|behind|auto`, auto by default). Kinetic hero words can come in letter by letter (`--caption-entrance unfurl|cascade|orbit|warp|crystallize|compute|levitate|undulate|typewriter`, pop by default). Screen cards, b-roll panels and graphics placed high in the frame go behind only the top of your head, never your face (`--panel-layer`). Details in the [Reel.md spec](docs/reel-md.md).

<img src="docs/menu/sheets/caption-entrances.webp" width="720" alt="The 10 caption entrances playing in a loop, each labelled: pop, unfurl, cascade, orbit, warp, crystallize, compute, levitate, undulate and typewriter">

<img src="docs/menu/sheets/caption-styles.webp" width="720" alt="The 7 caption styles playing in a loop, each labelled: kinetic, oneword, pill, hormozi, karaoke, classic and one-word">

![Contact sheet of the font pairings](showcase/sheets/fonts.jpg)

### Presets

![Contact sheet of the 11 brand presets](showcase/sheets/presets.jpg)

`--preset magazine` (or `- preset: magazine` in a Reel.md) turns on the [editing principles built in](docs/guide.md#editing-principles-built-in): a serif numeral, an italic serif word and sans text in one phrase; titles beside your head, across your chest or big over your face and behind your head; olive and cream cards and numbered chapter cards with a number-pop intro; a bed picked by the energy of what you say; a whoosh on transitions, a pop on text and a click on key moves, capped so they stay sparse; 12% punch-ins, a typewriter entrance and soft crossfades; and no pauses over 0.3 s. Each one also works on its own.

### Remake a reel you like

```
npm run teardown -- reference.mp4                                       # what it is made of, as a Reel.md
npm run reel -- --recipe teardown/reference/Reel.md --clip inbox/me.mp4  # the same style, your clip and brand
```

[rea-video](https://github.com/JuneYaooo/rea-video) breaks the reference down shot by shot; the kit maps it onto the menu above and shows you what it found before anything renders. Local files, or one Instagram post with `--url` if you install the optional instaloader (you need the rights to it). See [how accurate teardowns are](docs/teardown.md).

### Reel.md recipes

A reel's whole style in one Markdown file you can read, edit and share. VIDEO.md compatible. Read the [Reel.md spec](docs/reel-md.md) or start from an [example recipe](examples/recipes/).

````markdown
## Style
- captions: one-word
- title-layer: front

## Shots
```videomd-timeline
#01 0-4 | story hook | finish warm
#02 4-12 | story proof | punch big
#03 12-20 | story payoff | finish teal,vignette
```

## Titles
```reel-titles
#01 0.3-1.8 | entrance slam | layer behind | text Stop scrolling
```
````

`npm run reel -- --recipe my.Reel.md --clip inbox/me.mp4` makes it. `npm run reelmd -- export <job>` turns any finished reel back into one.

Every option, labelled, is in the [full gallery](showcase/GALLERY.md). The [HTML gallery](showcase/index.html) needs a full clone or zip of the repo; if you download only that HTML file, the images will not load. `npm run menu` prints the same list. `npm run showcase` rebuilds the stills and these sheets. Stills use an AI-generated fictional presenter.

## How it compares

The tools people usually reach for, from their own sites and docs, checked November 19, 2026. Each is good at something different; this table is about how they work, not which is better.

| | aigent-talking-head | HyperFrames | CapCut auto captions | Submagic | Opus Clip | Descript | Remotion |
|---|---|---|---|---|---|---|---|
| What it is | Talking-head reel pipeline with a local Studio page | HTML video framework plus a Studio desktop app, from HeyGen | Video editor app | Caption and short-clip web app | Long video to short clips web app | Transcript-based video editor | React framework for making videos in code |
| Source | Open source, Apache-2.0 | Framework open source, Apache-2.0 | Closed | Closed | Closed | Closed | Source available; free for individuals and companies of up to 3 people, paid company license above that |
| Where your video is processed | Your machine | Renders on your machine or HeyGen's cloud; reference reads run through HeyGen | CapCut's apps | Submagic's servers | Opus Clip's servers | Descript's apps and cloud | Your machine or your cloud |
| Price | Free: no account, no credits, no watermark | Framework free; app free plan with credits, Pro $25 a month | Free tier and paid plans | Free trial, then paid plans | Free tier and paid plans | Free tier and paid plans | See Source |
| Agent access | Skills plus a local MCP server; your terminal agent also answers the Studio chat | Skills and plugins for Claude Code, Codex and others; the app works with your agent | No official MCP server | Hosted MCP server | Hosted MCP server (tool calls on paid plans) | Hosted MCP server | You or your agent write React code |
| Best at | One phone clip to a finished, captioned 9:16 reel with graphics | Motion graphics and edits written as HTML by an agent | Hands-on editing with a timeline | Fast styled captions | Finding clips in long videos | Editing video by editing text | Custom, data-driven video in code |

Recreating a reel you like from a link: in Studio it is free and runs on your computer. In the HyperFrames Studio app it is part of HyperFrames Pro and the app reads the video through HeyGen ([docs](https://hyperframes.heygen.com/studio-app/reference-video.md), [pricing](https://hyperframes.studio/pricing)); the app also asks you to sign in with a HeyGen account ([install](https://hyperframes.heygen.com/studio-app/index.md)). HyperFrames has many more motion templates and renders any kind of video, not only talking heads.

Other open-source tools in the same space: [OpenShorts](https://github.com/faris-sait/openshorts) (MIT) cuts long videos into vertical clips, and [kinocut](https://github.com/KyaniteLabs/kinocut) (Apache-2.0) is an MCP server that gives agents guarded FFmpeg and HyperFrames editing tools.

In short:

- Free and open source. Studio runs on your computer with no account, no credits and no watermark.
- Paste a link to a reel you like and Studio breaks it down on your machine, free.
- Your own terminal agent is the editor. Chat with it in Studio or your terminal, and edits update live.

Pick aigent-talking-head if you want a local, scriptable pipeline your agent can run end to end and you are fine installing Node, Python, FFmpeg and Chrome. Pick a hosted app if you want a web editor, team sharing or multi-language captions today: this kit transcribes English only.

## FAQ

More answers in the [full FAQ](docs/faq.md).

### How do I add animated captions to a talking head video for free?

Install aigent-talking-head, drop your clip in `inbox/` and run `npm run reel`. It transcribes the clip with Whisper on your machine and burns in word-timed kinetic captions. No account, watermark or API key.

### Can Claude Code edit videos?

Yes. Install the skills with `npx skills add wrg32786/aigent-talking-head -a claude-code` and ask "make a reel from the newest clip in my inbox". Claude Code runs the kit's commands: draft, plan, render and verify. Codex and Cursor work the same way.

### Is there an MCP server for video editing?

Yes. `npm run mcp` starts a local MCP server over stdio with six tools (menu, draft, plan, validate, render, verify). Setup for Claude Code, Cursor and Codex is in the [MCP setup guide](docs/mcp.md).

### Does it run locally?

Yes. Transcription, rendering and checks all run on your computer, and nothing is uploaded. It needs Node 18+, Python, FFmpeg and Chrome, and runs on a CPU. The Whisper model downloads once on first use; after that only optional extras (HeyGen takes, Freesound search, fetching a reel by URL for a teardown) go online.

### Is it an open-source alternative to CapCut, Submagic or Opus Clip?

For talking-head reels, yes: it covers captions, titles, graphics, music and platform exports in a free, local pipeline. It is a command-line tool rather than a timeline editor, it does not find clips in long videos, and captions are English only. See [How it compares](#how-it-compares).

### Will the captions and graphics cover my face?

No. Titles and graphics can sit behind your head, but only your hair and crown go over them. A layout pass moves captions off graphics, and `npm run verify` fails if anything still overlaps.

### What license is it? Can I use it commercially?

The code and docs are Apache-2.0, so commercial use is fine. The bundled sounds and music are CC0 and the fonts are SIL OFL. Third-party files keep their own licences; see [Credits and licences](#credits-and-licences).

## Use cases

- **Creators and founders** posting a daily talking-head reel to TikTok, Reels and Shorts from one phone take.
- **Product launches and changelogs**: release pill, feature cards, terminal session and a CTA button that gets clicked on screen.
- **Course and newsletter promos**: stat callouts, quote cards and a CTA end card in your brand preset.
- **Ads and offers**: price tags, versus cards and a checklist, turned around from a teammate's recording.
- **Agencies and teams**: a Reel.md recipe per client, so every reel keeps the same look.
- **Agent builders**: a tested video pipeline your agent can call through skills or MCP.

## How agents use it: skill and MCP

[skills/aigent-talking-head/SKILL.md](skills/aigent-talking-head/SKILL.md) gives your agent the workflow, every command, its inputs and outputs, and what to do when something fails. [contract.json](contract.json) lists each command's args, types, defaults and outputs for agent frameworks, and `npm run check` fails if it drifts from the CLI.

| Agent | Install the skills |
|---|---|
| Claude Code | `npx skills add wrg32786/aigent-talking-head -a claude-code` |
| Cursor | `npx skills add wrg32786/aigent-talking-head -a cursor` |
| Codex | `npx skills add wrg32786/aigent-talking-head -a codex` |

That installs nine skills: aigent-talking-head, aigent-studio, talking-head-reel, talking-head-recipe, talking-head-brand, talking-head-teardown, talking-head-ad, clip-raw-footage and humanizer (by Siqi Chen, MIT, for scripts). Add `-g` to install for every project. By hand: copy the folders under `skills/` into `.claude/skills/` (Claude Code) or `.agents/skills/` (Cursor, Codex). The skills drive a local checkout, so the agent still needs the kit installed ([agent install steps](INSTALL.md)).

**MCP.** `npm run mcp` serves the same flow as MCP tools (menu, list_effects, list_packs, get_pack, draft, explain, set_locks, plan, validate, render, verify) with schemas generated from contract.json, plus studio_ tools that let your agent listen and answer in the Studio chat, add reference links and read their teardowns. See the [MCP setup for Claude Code, Cursor and Codex](docs/mcp.md). For a summary written for language models, see [llms.txt](llms.txt).

## Show your reel

Posted a reel you made with this kit? [Open a Show your reel issue](https://github.com/wrg32786/aigent-talking-head/issues/new?template=show-your-reel.md) and drop the link, or tag [@the_aigent_news](https://www.instagram.com/the_aigent_news/) on Instagram. A star on the repo helps other creators find it.

The CLI may print a one-line star reminder after your first successful render, and once more after five renders. It is skipped when stdout is not a TTY, when `CI` is set, when you pass `--json`, or when `AIGENT_NO_STAR=1`. On a run that does not print the star reminder, it may instead print a one-line invitation to The AIgent Academy, at most twice, with the same spacing. Set `AIGENT_NO_SKOOL=1` to turn that line off. At most one of the two lines prints on a given run.

## Cite this

> Gwyn, W. (2026). *aigent-talking-head: an open-source talking-head video editor for coding agents* (Version 1.2.0) [Computer software]. The AIgent. https://github.com/wrg32786/aigent-talking-head

Machine-readable metadata is in [CITATION.cff](CITATION.cff), and GitHub shows it under "Cite this repository".

## Docs

- [Studio](docs/studio.md): the local page for footage, references, the visual effects menu, chat, draft and render. [One-line setup](docs/setup-with-ai.md), and the [desktop app plan](docs/desktop-app-plan.md).
- [Effects menu](docs/effects.md): every transition, title entrance, caption entrance and caption style, animated, with the exact name to use.
- [Style packs](docs/packs.md): the pack gallery, locks, the choices table, and how to make and share your own pack.
- [User guide](docs/guide.md): what you get, the effects pass, looks, caption styles and fonts, edit rules, themes, manual steps, the file map and brand presets.
- [Reel.md recipe spec](docs/reel-md.md) and [example recipes](examples/recipes/).
- [Teardown guide and accuracy notes](docs/teardown.md).
- [MCP server setup](docs/mcp.md).
- [Full FAQ](docs/faq.md).
- [Notes for agents working in this repo](AGENTS.md), how to [contribute or support the project](CONTRIBUTING.md), and the [changelog](CHANGELOG.md).

## Get guidance

Want help putting this to work? The AIgent Academy on Skool offers guidance, courses and a community of builders. Membership comes with a guarantee: you have a business in 90 days or your money back. See the [terms](https://theaigent.co/terms). The full walkthrough is in [The AIgent Academy](https://www.skool.com/the-aigent-academy/about?ref=gh-aigent-talking-head).

After a successful render, the CLI may print a one-line Academy invitation when it is not also printing the star reminder. Set `AIGENT_NO_SKOOL=1` to turn the Academy line off. It also stays off when stdout is not a TTY, when `CI` is set, or when you pass `--json`.

## Credits and licences

Code and docs: Apache-2.0, Copyright 2026 Will Gwyn (wrg32786). See [LICENSE](LICENSE). The files below keep their own licences and marks.

- `kit/sfx/F-cinematic-woosh-648729.mp3`: "Cinematic Woosh SFX-010" by AudioPapkin, Freesound 648729, CC0.
- `kit/sfx/D-quick-woosh-683101.mp3`: "quick woosh" by florianreichelt, Freesound 683101, CC0.
- `kit/sfx/whoosh.wav` and `kit/sfx/swipe.wav`: mono 48 kHz WAV conversions of the two Freesound files above, CC0.
- `kit/sfx/boom.wav`, `click.wav`, `typing.wav`: from [motion-pack](https://github.com/ANVEAI/motion-pack) by ANVEAI (sounds `snd.hit.deep_impact`, `snd.ui.click`, `snd.ui.typing_burst`), CC0 1.0 under its LICENSE-MEDIA.
- `kit/sfx/{hit,riser,release,whoosh,swipe,pop,ui,glitch,camera,paper,counter,sub,shimmer}/` and `kit/sfx/sfx.json`: 31-sound cinematic pack. DAEDAL Transition / UI packs, Kenney Interface Sounds, OpenGameArt / Freesound CC0 items, and original synths dedicated CC0. Full credits in [THIRD_PARTY.md](THIRD_PARTY.md).
- `kit/fonts/`: Google Fonts under the SIL Open Font License 1.1, each with its licence file. See [kit/fonts/README.md](kit/fonts/README.md).
- Teardown engine (installed on request, not vendored): [rea-video](https://github.com/JuneYaooo/rea-video) by JuneYaooo, Apache-2.0. Reel.md follows the [VIDEO.md](https://github.com/videomd/videomd) card and timeline syntax (Apache-2.0). The recipe idea, the one-line agent install and skills packaging were inspired by [OpenMotion](https://github.com/nexu-io/openmotion) (Apache-2.0). No text or code copied; see [THIRD_PARTY.md](THIRD_PARTY.md).
- Ideas adapted, no code copied: the transition name map from motion-pack (MIT), the Hormozi and karaoke caption looks from [Capite](https://github.com/muneebkhan08/Capite) (MIT), the title entrances from [motion-anything](https://github.com/nexu-io/motion-anything) (Apache-2.0, reference only). See [THIRD_PARTY.md](THIRD_PARTY.md).
- `kit/example/skool-logo.svg`: the Skool wordmark, a trademark of Skool. It's included only to mark The AIgent's own Skool group in the Awakening example; it isn't in any theme. Don't use it for other brands.
- `effects/vendor/claude-video-effects/`: [claude-video-effects](https://github.com/Vibha-Ramprakash/claude-video-effects) by Vibha Ramprakash, MIT. Its models (YuNet, MIT; MediaPipe Selfie Segmenter, Apache-2.0) and fonts (SIL OFL 1.1, Permanent Marker Apache-2.0) keep their own licences; see `NOTICE` and `effects/README.md`.
- Person-mask quality backend (installed by `npm run effects:setup`, not vendored): [rembg](https://github.com/danielgatis/rembg) by Daniel Gatis, MIT; [onnxruntime](https://github.com/microsoft/onnxruntime) by Microsoft, MIT; birefnet-general-lite weights from [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) by ZhengPeng, MIT, downloaded on first use into rembg's cache. See [THIRD_PARTY.md](THIRD_PARTY.md).
- `kit/music/*.mp3`: tracks made by Will Gwyn / The AIgent with Suno on a paid plan (song ids in `kit/music/beds.json`). Dedicated [CC0 1.0](kit/music/LICENSE.md); anyone may use them, including commercially. See [kit/music/README.md](kit/music/README.md).
- `showcase/source/presenter.jpg`: an AI-generated fictional person made for this project, to demo finishes, titles and effects. No third-party rights. Licensed Apache-2.0 with the repo. See [THIRD_PARTY.md](THIRD_PARTY.md).

