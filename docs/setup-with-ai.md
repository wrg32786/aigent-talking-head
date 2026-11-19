# Set up with your AI assistant

You can install aigent-talking-head and open Studio without typing commands yourself. Ask your assistant (Claude Code, Codex, Cursor, or any agent that can run commands on your computer):

> Install aigent-talking-head, set up Studio and run the Studio chat loop.

Your agent installs the kit, registers itself in its own config, starts Studio, opens the page and then answers you in the Studio chat. You can keep talking to it in the terminal too; the two chats are separate channels, and edits from either one show up on the page.

## For the assistant

Do these in order and tell the user what happened at each step.

1. **Run the installer for their OS.** It is safe to run again; it updates an existing install.
   - macOS or Linux: `curl -fsSL https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.sh | bash -s -- --yes`
   - Windows (PowerShell): `$env:AIGENT_YES='1'; irm https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.ps1 | iex`

   `--yes` (or `AIGENT_YES=1`) lets it install missing tools (Git, Node.js 18+, ffmpeg, Python 3.10+) with Homebrew, apt, dnf, pacman or winget. Ask the user before you pass it, because those need admin rights. Without it, the installer asks on the terminal, and in CI it never asks. Other options: `--dir <path>` (default `~/aigent-talking-head`), `--no-shortcut`, `--prefetch-model` (download the Whisper model now, about 470 MB, instead of on the first transcription).
2. **Check it.** The installer runs `npm run check` and prints `CHECK PASS`. For a full check, run `npm run smoke` in the install folder with `PYTHON` set to `.venv/bin/python` (Windows: `.venv\Scripts\python.exe`); it takes several minutes. See [INSTALL.md](../INSTALL.md) for anything that fails.
3. **Register yourself in your own config.** In the install folder: `npm run studio:connect -- claude`, `-- codex` or `-- cursor` (or `-- print` for any other MCP client). Claude Code also gets the Studio hook. Exact steps per agent: [AGENTS.md](../AGENTS.md#studio-set-it-up-and-be-the-agent-in-it). Then ask the user to restart you once so the new tools load.
4. **Open Studio and listen.** Call `studio_start` (or `npm run studio:agent`); it starts Studio in the background and opens http://127.0.0.1:4757. Then run the Studio chat loop in [skills/aigent-studio/SKILL.md](../skills/aigent-studio/SKILL.md): `studio_wait_for_message`, act, `studio_reply`, repeat. Without an agent, the user can still double-click "Talking Head Studio" on their desktop (or run `studio.sh` / `studio.bat`) and pick a local model, an API key or keywords in Settings.
5. **Stop.** Tell the user Studio is open and what they can do first: drop a clip into Footage, or add a reel they like under Reference. Do not render or post anything until they ask.

## What the installer puts on the computer

- The kit, cloned to `~/aigent-talking-head` (or `--dir`).
- Node packages (`npm install`) and a Python venv in `.venv` with `requirements.txt`.
- A launcher: `studio.sh` (macOS and Linux) or `studio.bat` (Windows) in the kit folder, which sets `PYTHON` and runs Studio.
- A desktop shortcut called "Talking Head Studio": a `.command` file on macOS, a `.desktop` entry on Linux (app menu and desktop), a `.lnk` on Windows. `--no-shortcut` skips it.

To remove it, delete the kit folder and the shortcut. Nothing else is changed except the tools it installed with your package manager, which you keep.
