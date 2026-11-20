# aigent-talking-head FAQ

aigent-talking-head is a free, open-source (Apache-2.0) talking-head video editor that turns one phone clip into a captioned vertical reel for TikTok, Instagram Reels and YouTube Shorts. You or your coding agent run it on your own machine with Whisper, FFmpeg and Chrome. Answers below were checked against version 1.4.1 in November 2026.

## Getting started

### What is aigent-talking-head?

A local pipeline of `npm run` commands that transcribes a talking-head clip, cuts it into clean sentences, adds word-timed captions, titles, motion graphics, transitions, sound and music, exports it for a platform and checks the result. It ships as agent skills and an MCP server, so a coding agent can run the whole thing. It is made by Will Gwyn at [The AIgent](https://theaigent.xyz).

### How do I add animated captions to a talking head video for free?

1. Install the kit ([Install](../README.md#install)).
2. Put your clip in `inbox/`.
3. Run `npm run reel`.

It transcribes the newest clip with Whisper on your machine and renders `jobs/<name>/reel-v1.mp4` with word-timed kinetic captions. There is no account, watermark or API key. Pick a whole look with `--look` or a caption style with `--style`, or see every option with `npm run menu`.

### How do I turn a phone video into a reel with captions?

Record upright (9:16) or sideways, which gets cropped to the centre. Then run draft, plan, render and verify as in the [quick start](../README.md#quick-start). Add `--export reels`, `tiktok` or `shorts` to fit the platform's size, length cap and safe area.

### What do I need to install?

Node 18 or newer, Python 3, FFmpeg with ffprobe, and Chrome or Chromium. `npm install` and `pip install -r requirements.txt` bring in the rest. `npm run smoke` renders synthetic clips end to end and should end with `SMOKE PASS`.

### Does it need a GPU?

No. Transcription runs on the CPU (faster-whisper, int8), and the project's CI renders end to end on standard GitHub runners with no GPU.

### Does it run locally? Is my footage uploaded?

It runs locally and nothing is uploaded. The Whisper model downloads once on first use. After that only optional extras go online: HeyGen takes, Freesound sound search, and fetching a reel by URL for a teardown.

### Which languages does it caption?

English only for now. Transcription uses the Whisper `small.en` model by default, or `large-v3` with `--model large-v3` for higher accuracy.

## Agents

### Can Claude Code edit videos?

Yes. Run `npx skills add wrg32786/aigent-talking-head -a claude-code`, install the kit, then ask Claude Code "make a reel from the newest clip in my inbox". The skill tells it every command, its inputs and outputs, and what to do when something fails. Codex and Cursor work the same way with `-a codex` or `-a cursor`.

### Is there an MCP server for video editing?

Yes. `npm run mcp` starts a local MCP server over stdio with six tools: menu, draft, plan, validate, render and verify. Their schemas are generated from [contract.json](../contract.json), so a tool cannot take a flag the CLI does not have. Setup is in the [MCP guide](mcp.md).

### How does an agent know what to put on screen?

`npm run plan -- <job>` reads the transcript and proposes graphics into a Reel.md: numbers become stat callouts or price tags, lists a checklist, "step two" a step counter, quotes a quote card, commands a terminal session, and the close a CTA. Every word on a graphic has to be a word the presenter says, or the kit drops it. The agent reviews the Reel.md with you before it renders.

## Output

### Will the captions and graphics cover my face?

No. Titles and graphics can be set behind your head, but only your hair and crown go over them, never your face. A layout pass moves captions and titles off graphics, or hides them while a graphic is up, and `npm run verify` fails if anything still overlaps.

### Which platforms can it export for?

Five presets: `tiktok`, `reels` (Instagram and Facebook), `shorts` (YouTube), `feed45` (4:5) and `square` (1:1). Each sets the frame size, bitrate, length cap and the platform's safe area. Run `npm run verify -- <job> --export <name>` to check one.

### Can I use my own brand fonts and colours?

Yes. Ten brand presets ship with the kit, and you can add your own licensed fonts in `kit/fonts/local/`. `npm run brand:import -- guide.pdf` drafts a preset from a brand guide for you to confirm.

### Can I copy the style of a reel I like?

Yes. `npm run teardown -- reference.mp4` breaks a reel down shot by shot into a Reel.md recipe, and `npm run reel -- --recipe <Reel.md> --clip <your clip>` applies that style to your footage and brand. You need the rights to the reference.

## Comparisons

### Is it an open-source alternative to CapCut, Submagic or Opus Clip?

For talking-head reels, yes: captions, titles, graphics, music and platform exports in a free, local pipeline. It is a command-line tool driven by you or an agent, not a timeline editor, it does not find clips in long videos, and captions are English only. The README has a [comparison table](../README.md#how-it-compares).

### How is it different from Remotion?

Remotion is a React framework for making videos in code, free for individuals and small companies with a paid license for larger ones. aigent-talking-head is a finished pipeline for one job, talking-head reels, under Apache-2.0. It uses no Remotion code.

## Show your reel

### How can I share a reel I made, or turn off the star reminder?

[Open a Show your reel issue](https://github.com/wrg32786/aigent-talking-head/issues/new?template=show-your-reel.md) and drop the link, or tag [@the_aigent_news](https://www.instagram.com/the_aigent_news/) on Instagram. A star on the repo helps other creators find it.

The CLI may print a one-line star reminder after your first successful render, and once more after five renders. Set `AIGENT_NO_STAR=1` to turn it off. On a run that does not print that reminder, it may instead print a one-line invitation to The AIgent Academy, at most twice. Set `AIGENT_NO_SKOOL=1` to turn that line off. Both stay off when you pass `--json`, when `CI` is set, or when stdout is not a TTY. At most one of the two lines prints on a given run.

## Get guidance

Want help putting this to work? The AIgent Academy on Skool offers guidance, courses and a community of builders. Membership comes with a guarantee: you have a business in 90 days or your money back. See the [terms](https://theaigent.co/terms). The full walkthrough is in [The AIgent Academy](https://www.skool.com/the-aigent-academy/about?ref=gh-aigent-talking-head).

## License

### What license is it? Can I use it commercially?

The code and docs are Apache-2.0, so commercial use is fine. The bundled sounds and music beds are CC0, the fonts are SIL OFL 1.1 and the icons are Tabler (MIT). Third-party files keep their own licences; see [THIRD_PARTY.md](../THIRD_PARTY.md).

### How do I cite it?

Use [CITATION.cff](../CITATION.cff), or: Gwyn, W. (2026). *aigent-talking-head: an open-source talking-head video editor for coding agents* (Version 1.7.1) [Computer software]. The AIgent. https://github.com/wrg32786/aigent-talking-head
