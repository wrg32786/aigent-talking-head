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
| `studio_run` | POSTs to the running Studio | start a draft or render the user watches in the page, then poll `studio_get_state` |
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
