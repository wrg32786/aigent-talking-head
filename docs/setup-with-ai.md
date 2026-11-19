# Set up with your AI assistant

You can install aigent-talking-head and open Studio without typing commands yourself. Ask your assistant (Claude Code, Codex, Cursor, or any agent that can run commands on your computer):

> Install aigent-talking-head and open Studio.

## For the assistant

Do these in order and tell the user what happened at each step.

1. **Run the installer for their OS.** It is safe to run again; it updates an existing install.
   - macOS or Linux: `curl -fsSL https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.sh | bash -s -- --yes`
   - Windows (PowerShell): `$env:AIGENT_YES='1'; irm https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.ps1 | iex`

   `--yes` (or `AIGENT_YES=1`) lets it install missing tools (Git, Node.js 18+, ffmpeg, Python 3.10+) with Homebrew, apt, dnf, pacman or winget. Ask the user before you pass it, because those need admin rights. Without it, the installer asks on the terminal, and in CI it never asks. Other options: `--dir <path>` (default `~/aigent-talking-head`), `--no-shortcut`, `--prefetch-model` (download the Whisper model now, about 470 MB, instead of on the first transcription).
2. **Check it.** The installer runs `npm run check` and prints `CHECK PASS`. For a full check, run `npm run smoke` in the install folder with `PYTHON` set to `.venv/bin/python` (Windows: `.venv\Scripts\python.exe`); it takes several minutes. See [INSTALL.md](../INSTALL.md) for anything that fails.
3. **Open Studio.** Run `~/aigent-talking-head/studio.sh` (Windows: `studio.bat` in the install folder), or tell the user to double-click "Talking Head Studio" on their desktop. It opens http://127.0.0.1:4757 in their browser. If it is already running, the launcher just opens the page.
4. **Connect yourself to Studio (optional).** Add the MCP server (`npm run mcp` in the install folder; setup per client in [docs/mcp.md](mcp.md)). Then `studio_get_state` shows you what the user picked and wrote in the Studio chat, `studio_set_selections` changes picks and answers in the chat, and `studio_run` starts a draft or render they can watch.
5. **Stop.** Tell the user Studio is open and what they can do first: drop a clip into Footage, or add a reel they like under Reference. Do not render or post anything until they ask.

## What the installer puts on the computer

- The kit, cloned to `~/aigent-talking-head` (or `--dir`).
- Node packages (`npm install`) and a Python venv in `.venv` with `requirements.txt`.
- A launcher: `studio.sh` (macOS and Linux) or `studio.bat` (Windows) in the kit folder, which sets `PYTHON` and runs Studio.
- A desktop shortcut called "Talking Head Studio": a `.command` file on macOS, a `.desktop` entry on Linux (app menu and desktop), a `.lnk` on Windows. `--no-shortcut` skips it.

To remove it, delete the kit folder and the shortcut. Nothing else is changed except the tools it installed with your package manager, which you keep.
