# Install Talking Head Studio (for agents)

The user pasted one line asking you to install, set up and connect Talking Head Studio (aigent-talking-head) in this agent, then open Studio. You are a terminal agent that can run commands. Do every step you can yourself, in order. Tell the user only what you cannot do, in plain words, one line each. Do not render, post or upload anything.

Studio is a local web page (http://127.0.0.1:4757) that turns talking-head footage into finished reels. You, the agent, are connected to it over MCP and answer its chat.

## 1. Find out where you are

- The OS: run `uname -s` (macOS says `Darwin`, Linux says `Linux`). On Windows use PowerShell; `$env:OS` says `Windows_NT`.
- Your own name: Claude Code, Codex CLI, Cursor (editor or `cursor-agent`), Gemini CLI, OpenCode, Windsurf or another MCP client. You need it in step 4.
- An existing checkout: if the current folder, `~/aigent-talking-head` or `%USERPROFILE%\aigent-talking-head` has `kit/mcp.mjs` and a `package.json` whose name is `aigent-talking-head`, reuse it. Do not clone a second copy.

## 2. Get the kit

**Existing checkout.** In that folder: `git pull --ff-only` (if it fails because of local changes, leave them alone and say so), then `npm install`.

**No checkout.** Run the installer. It checks Git, Node.js 18 or newer, ffmpeg, Python 3.10 or newer and Chrome, clones to `~/aigent-talking-head`, runs `npm install`, makes the Python venv and adds a desktop launcher.

- macOS or Linux: `curl -fsSL https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.sh | bash -s -- --yes --no-open`
- Windows (PowerShell): `$env:AIGENT_YES='1'; irm https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.ps1 | iex`

`--yes` lets it install missing system tools with Homebrew, winget, apt, dnf or pacman. Ask the user first if they have not already said yes to installing things. If a system tool needs their password (sudo), the installer prints the one command to run: pass that line on to the user and carry on with the rest.

If you cannot run the installer, do it by hand: `git clone https://github.com/wrg32786/aigent-talking-head ~/aigent-talking-head`, then `npm install` in that folder.

## 3. Install everything up front

In the kit folder:

```
npm run setup:all -- --yes
```

It installs what is missing and skips what is there: Node packages, the Python venv and requirements, yt-dlp and instaloader (reference links), ffmpeg and ffprobe, Chrome, the Whisper model (small.en, about 470 MB), the effects pass and the person mask weights, the humanizer skill and the Studio page. It is safe to run again or stop halfway. It ends with a summary, a list of anything only the user can do, and a line to restart Studio if it is already running.

## 4. Connect yourself over MCP

Run the line for the agent you are, in the kit folder. Each one only adds what is missing. These match the **Connect agent** dialog in Studio, which shows the same steps with this install's real paths.

| You are | Run | What it does |
|---|---|---|
| Claude Code | `npm run studio:connect -- claude --user` | `claude mcp add` for `aigent-talking-head` (with `PYTHON` set to the kit's venv) and the Studio hook in `~/.claude/settings.json` |
| Codex CLI | `npm run studio:connect -- codex` | adds `[mcp_servers.aigent-talking-head]` to `~/.codex/config.toml` with `tool_timeout_sec = 300` |
| Cursor | `npm run studio:connect -- cursor --user` | adds the server to `~/.cursor/mcp.json` (the editor and `cursor-agent` read the same file) |
| Gemini CLI | `gemini mcp add --scope user -e PYTHON=<kit python> aigent-talking-head node <kit>/kit/mcp.mjs` | the user scope, so it works in every folder |
| OpenCode | `opencode mcp add aigent-talking-head --global --env PYTHON=<kit python> -- node <kit>/kit/mcp.mjs` | a global local server |
| Windsurf or another MCP app | `npm run studio:connect -- print` | prints the `mcpServers` JSON to add to the app's MCP config |

`<kit>` is the kit folder's full path. `<kit python>` is `<kit>/.venv/bin/python` (Windows: `<kit>\.venv\Scripts\python.exe`). Use `node` from the same install that ran step 3.

Check it: `claude mcp get aigent-talking-head`, `codex mcp list`, `agent mcp list`, `gemini mcp list` or `opencode mcp list`.

New MCP servers load when a session starts. If `setup_status` and `studio_start` are not in your tools yet, tell the user one line: restart this agent once (Claude Code: `/exit`, then `claude` again, or `/mcp` to reconnect; Codex, Cursor, Gemini CLI and OpenCode: a new session), then paste the same install line again. You pick up from here; every step above is safe to repeat.

## 5. Start Studio

Call the `studio_start` tool. Without the tool yet, run `npm run studio:agent` in the kit folder: it starts Studio in the background, opens the page in the user's browser and prints the URL as JSON.

## 6. Verify

Call `setup_status` (or run `npm run setup:all -- --check`). Every item should be ready. For each one that is not, fix it yourself if you can (run its fix line) and check again. What is left goes in the `forUser` list.

Optional, a few minutes: `npm run check` must print `CHECK PASS`.

## 7. Tell the user

Two or three short lines:

- Studio is installed, connected to you and open at the URL from step 5.
- Anything only they can do, one line each, from `forUser` and the steps above. For example: "Installing ffmpeg needs your password: run sudo apt-get install -y ffmpeg", "Restart me once so I can see Studio", "Allow camera access when the browser asks" (only when they record in Studio).
- How to start: drop a video on the Footage step, or tell you what reel to make.

Then run the Studio chat loop from `skills/aigent-studio/SKILL.md`: `studio_wait_for_message`, act, `studio_reply`, repeat. The page shows that you are connected and listening.

Never say it is installed while a step is failing. Never ask the user to do something you can do yourself.

---

The one-line "read this doc and follow it" install follows the idea of [OpenMotion](https://github.com/nexu-io/openmotion)'s agent quick start (Apache-2.0). The steps and wording here are written for this kit.
