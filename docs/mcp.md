# MCP server

`npm run mcp` (or `node kit/mcp.mjs`) is a local [Model Context Protocol](https://modelcontextprotocol.io) server on stdio. It gives an agent the kit's flow as tools, with input schemas generated from `contract.json`, so a tool can never take a flag the CLI does not have. It is built on the official TypeScript SDK (`@modelcontextprotocol/sdk`, MIT), installed by `npm install`. Nothing leaves your machine.

| Tool | Runs | Use it to |
|---|---|---|
| `menu` | `npm run menu` | show the user every option before drafting |
| `list_effects` | `npm run list -- <kind> --json` | get exact names, one-liners and preview paths for one kind (`transitions`, `titles`, `captions`, `graphics`, `effects`); point the user at `docs/effects.md` to see them animated |
| `list_packs` | `npm run pack -- list --json` | every style pack with its locks and preview path; show the user `docs/packs.md` |
| `get_pack` | `npm run pack -- show <pack> --json` | one pack resolved: merged style, locks, weights, previews |
| `draft` | `npm run reel -- ... --draft --json` | transcribe and cut a clip into `jobs/<name>/`; takes `pack` and `lock` |
| `explain` | `npm run choices -- <job> --json` | what was picked per beat and why; with `apply: true`, write the user's edits in `jobs/<job>/choices.json` back first |
| `set_locks` | `npm run choices -- <job> --lock "..." --json` | pin the user's choices on a drafted job (a string like `"transitions=whip,zoom; titles=typewriter"` or an object), then `render` with `rebuild` |
| `plan` | `npm run plan -- <job> --json` | propose graphics from what was said into `jobs/<job>/Reel.md` |
| `validate` | `npm run reelmd -- check <recipe>` or `npm run check -- <job>` | check a Reel.md, or lint a job's copy and plan |
| `render` | `npm run reel -- ... --json` | render the reel (and an `export`) |
| `verify` | `npm run verify -- <job> --json` | check the finished reel: size, loudness, overlap, safe area, copy |
| `studio_get_state` | reads the Studio session (`jobs/.studio/state.json`) | what the user picked in Studio (`npm run studio`), their reference, music, pace, the chat and the running task, and the reel arguments it adds up to; with `catalog: true`, every menu item as a `kind:id` ref by category |
| `studio_set_selections` | writes the Studio session | change picks (`{"transition:whip": "allow"}`, `deny` or `clear`), pack, music, sound, pace (with `keepPauses`), export or reference mode, footage order (`footage`), `asIs`, `clips`, `glossary` and `brands`, and answer the user in the Studio chat with `reply`; the page updates live, and unknown names are refused; a change that does nothing returns `noChange` |
| `studio_run` | POSTs to the running Studio | start a draft or the one render the user watches on the Finish step, then poll `studio_get_state`; `from: pieces \| take` drafts from the user's kept pieces or the whole take, `exports: { reel, clips, plain }` also renders each piece as its own reel or a plain clip in the same run |
| `get_edit` | reads the running Studio | Your edit, as the page shows it on every step: making, from (pieces or the whole take), look, b-roll, sound, whether the current pieces are drafted, the next action |
| `studio_start` | starts Studio in the background (as `npm run studio:agent`) | returns the URL and opens the page |
| `studio_wait_for_message` | long-polls the Studio chat (default 45 s) | the lines the user typed in the Studio page since you last read, marked seen, plus the session context; the page shows you as listening while it waits |
| `studio_get_pending` | checks the Studio chat without waiting | the same, for the start of each turn while you work in the terminal |
| `studio_reply` | writes to the Studio chat only | your answer to Studio message ids (`replyTo`), with an optional `patch`; those messages show as answered |
| `studio_add_reference_url` | POSTs to the running Studio | queues reference links to download and tear down |
| `studio_get_reference_teardown` | reads the session | the reference queue and each teardown summary (cuts, pace, BPM, beats, energy, captions, detected effects, menu suggestions) |
| `studio_settings` | reads or writes `jobs/.studio/settings.json` | download folder, renders folder, chat backend, action notes |
| `list_scripts` | reads `jobs/.studio/scripts/<job>/` | the user's scripts: title, words, seconds at its WPM, sections, who wrote it |
| `get_script` | reads one script | full text with `[hook]`, `[body]`, `[cta]` and `[pause]` marks |
| `write_script` | writes one script | creates or replaces a script; the page shows it at once. Run a humanizer skill on the draft first (`skills/humanizer`) |
| `set_output` | changes the Cut step's choice | what to make from the take: format (short, long, square), length (short, medium, long), kind (full, clips, both), split, clips, goal (organic, ad), adCuts, cta, and under More aspect, seconds, clipSeconds, max; returns the one-line summary |
| `get_cuts` | reads the Cut step | the take, its length, the choice and summary, the transcript as numbered sentences with times, and the candidates with ranges, score, reason and keep; `find: true` runs the rules first |
| `set_cuts` | replaces the candidates | your picks, `[{ kind, ranges: [[start, end]], score, reason, label }]`, labelled as scored by you |
| `render_cuts` | renders | every kept candidate (or `ids`) as its own video, one after another; `file: true` only saves each as a plain clip |
| `get_lines` | reads the Lines view | every line of the take with its number, times on the audio, length, text, keep and hint (retake or fragment, and why), the bites so far and the clean take |
| `set_bites` | replaces the bites | your picks, `[{ name, lines: [line numbers in play order], reason }]`, plus `keep` per line, `clean: true` for the clean take, `replace: false` to add; labelled as picked by you |
| `render_bites` | renders | every bite (or `ids`) as its own video; `file: true` only joins the lines into one plain file |
| `list_broll` | reads the B-roll step | every beat of the draft (number, times, caption words), what fills it and how it sits (full cutaway, split top panel, picture in picture), pending ideas and generate asks, the sources that are on, and the library (`q` searches it) |
| `add_broll` | adds to the library | one of: `card` (chart, counter, quote, code, terminal or an HTML scene, made on this computer), `url` (a scrolled capture of a public page), `stock` (top Pexels or Pixabay result, with the user's key) or `file`; `beat` and `place` also put it on a beat. `type` (testimonial, product-demo, screen-recording, lifestyle) says what a file is; `raw: true` with a file cuts it into pieces on whole words first. |
| `suggest_broll` | proposes | ideas per spot (`beat: n`; `clip`, `query` or `card`, `place`, `why` and `offset`) that wait on the B-roll step for the user to approve or dismiss |
| `fill_slot` | changes a slot | put a clip on a beat, change its place, offset, length or in point, or clear it. `generate` only asks: the user sees the estimate and approves on the page |
| `pick_broll` | proposes, may place | the rules Studio runs after every draft: about one idea every 6 to 10 s (`gap`, or `all`), numbers as counter cards, quotes as quote cards, else library or stock; `fill: true` places what is free (never a generate). `auto` turns "picks itself after each draft" on or off |
| `add_spot` | changes the spots | split a spot at `at` seconds, or `remove: true`; placed b-roll stays on its words |
| `add_testimonial` | changes the Combo | play a testimonial piece (from a raw upload, `add_broll` with `file`, `type: testimonial`, `raw: true`) in the reel with its own sound, `after` one of your pieces; `remove: true` takes it out. Draft again to hear it |
| `get_pieces` | reads | the take's pieces: every line with its category (hook, story, tip, proof, list, cta, aside, retake), times, score and topics, and the user's Combo (ids in play order, a reason each, who built it) |
| `set_combo` | changes the Combo | the piece ids in play order with an optional reason each (`reasons`), `cats` to move pieces to another category, `clear: true` to empty it. The Combo drafts and renders ahead of the kept cuts |
| `choose_combo` | changes the Combo | Let AI choose: the strongest hook, the best middle in the take's order up to the length, the CTA last, each with a reason |
| `list_outputs` | reads | every rendered version of this video with the settings that made it and whether it can re-open; `all: true` adds the other videos |
| `broll_providers` | reads | each provider key as set or not and where from (env or Studio settings), never the key; which sources are on; whether generating is allowed |
| `buffer_channels` | reads | the user's Buffer channels (id, name, service) with each network's video length and caption limits, and whether a Buffer key and a video host are set up; never a key |
| `buffer_post_reel` | sends to Buffer | a rendered reel to the picked channels (ids, or a service such as `instagram`), one post each, saved as Buffer drafts unless `mode` is `queue`, `schedule` (with `dueAt`) or `now` (needs `confirmNow: true`, only when the user asked to publish now). Uploads to the user's R2 or Cloudinary, or takes `url`, a public https link; re-encodes to H.264 when needed; skips channels the reel is too long for. See [posting.md](posting.md) |
| `reopen_reel` | restores `jobs/<job>/reel-vN.build/` into `build/` | brings back the build behind a finished reel (cut.json, captions.js, choices) after a later Draft replaced it; the build it replaces is kept as `draft-<time>.build/`. Then edit and run the reel with `--rebuild` |
| `list_videos` | reads | every past Studio video (job), newest first, with its last change, reel count, footage count and whether Studio saved its session; the open one is `current` |
| `new_video` | changes the session | clears the board for a new video, like **New video** in Studio: footage, clips, cuts, reference, b-roll, review, the draft and the chat reset for the new job. `keepLook` (default true) keeps the pack, picks, music, sound, pace, export and brand logos. `name` is cleaned like the job field (empty: `video-<date>`); a name already in use is refused. Never deletes a file; the old job's session is saved to `jobs/.studio/videos/<job>.json`. Refused while a draft, render, download, take, transcript or generation is running |
| `open_video` | changes the session | opens a past video from `list_videos`: its saved session comes back as it was left, or, for a job Studio never saved, its footage and reels load so Outputs and Edit this reel work. The current video is saved first |
| `cut_range` | writes `jobs/<job>/manual-cuts.json` | cut a stretch out of a clip (`job`, `clip`, `from`, `to` in clip seconds, or take seconds with `source: true`); it applies on the next draft as a jump with short audio fades |
| `find_noises` | reads the clips' audio | short non-speech sounds (0.08 to 0.3 s) inside pauses: clip, times, the words around them and a ready `cut_range` call |
| `setup_status` | reads what is installed | each dependency (Node packages, Python and requirements, ffmpeg, Chrome, the Whisper model, yt-dlp, instaloader, the effects pass and the person mask weights, the humanizer skill, the Studio page) as ready or missing with its one fix, plus `forUser`, the plain-words list of what only the user can do. Run `npm run setup:all` for the rest |
| `studio_takes` | reads or writes the session | takes filmed with Record now (file, thumbnail, seconds, status, kept); keep, unkeep or discard one |

The Studio tools work on the same session file as the page. The Studio chat is its own channel: answer page messages with `studio_reply`, keep the terminal conversation in the terminal, and set `origin: "terminal"` on `studio_set_selections` for edits asked in the terminal (Studio then shows only a one-line action note). Setup per agent and the chat loop: [AGENTS.md](../AGENTS.md#studio-set-it-up-and-be-the-agent-in-it), so the assistant and the page stay in step ([docs/studio.md](studio.md)). Each other call returns the command line, its exit code and the end of its log as text, and the command's JSON result (the last line it prints with `--json`) as structured content. A value the contract does not list (a `look` or `export` name that does not exist) is refused before anything runs.

Install the kit first ([INSTALL.md](../INSTALL.md)): `npm install`, the Python venv with `PYTHON` set, and Chrome. The server finds the repo from its own path, so any working directory works. Use the absolute path of your checkout below (`/path/to/aigent-talking-head`).

Rendering takes a few minutes on a CPU. Give the client a long tool timeout (10 minutes or more) for `render`, `draft` and `verify`.

## Claude Code

```
claude mcp add aigent-talking-head -e PYTHON=/path/to/aigent-talking-head/.venv/bin/python -- node /path/to/aigent-talking-head/kit/mcp.mjs
```

Add `-s user` to have it in every project. Set `MCP_TOOL_TIMEOUT=900000` in your environment for long renders. Check with `claude mcp list`.

## Cursor

`.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "aigent-talking-head": {
      "command": "node",
      "args": ["/path/to/aigent-talking-head/kit/mcp.mjs"],
      "env": { "PYTHON": "/path/to/aigent-talking-head/.venv/bin/python" }
    }
  }
}
```

Then enable it under Settings, MCP.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.aigent-talking-head]
command = "node"
args = ["/path/to/aigent-talking-head/kit/mcp.mjs"]
env = { PYTHON = "/path/to/aigent-talking-head/.venv/bin/python" }
tool_timeout_sec = 900
```

Or `codex mcp add aigent-talking-head --env PYTHON=/path/to/aigent-talking-head/.venv/bin/python -- node /path/to/aigent-talking-head/kit/mcp.mjs`, then add `tool_timeout_sec` to the entry it writes.

## The flow

1. `menu` (and `list_effects` for transitions, title entrances or caption entrances, `list_packs` for whole looks), and ask the user what they want (and which platform: `tiktok`, `reels`, `shorts`, `feed45`, `square`).
2. `draft` with `videos: ["inbox/take.mov"]` and `name` (plus `pack`, and `lock` for anything the user pinned). Then `explain` with `job` and show the user what was picked and why; change picks with `explain` and `apply: true`, or `set_locks`.
3. `plan` with `job`. Show the user the proposed lines in `jobs/<job>/Reel.md` and change them together. Misheard names go in its `## Aliases` section.
4. `validate` with `recipe: "jobs/<job>/Reel.md"`.
5. `render` with `recipe`, `clips: "jobs/<job>/clips"`, `name`, `force: true` and `export`.
6. `verify` with `job` and `export`. Hand over `structuredContent.file` only when `ok` is true, after you look at `structuredContent.contact`.

Without MCP, the same results come from the CLI: pass `--json` to `reel`, `plan`, `verify` or `export` and read the last line.
