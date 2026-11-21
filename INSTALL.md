# Install aigent-talking-head (for agents)

You are installing aigent-talking-head for the user in this agent. It turns a phone clip into a styled 9:16 talking-head reel. Follow these steps in order, report each result honestly, and do not render anything or post anything until the user asks.

## 1. Check the machine

Report the OS and these versions. Install what is missing with the system's package manager, asking the user first if it needs admin rights.

- Git: `git --version`
- Node.js 18 or newer: `node -v`
- ffmpeg and ffprobe: `ffmpeg -version`, `ffprobe -version`. The build needs the `drawtext` filter (`ffmpeg -hide_banner -filters` lists it). Homebrew's plain `ffmpeg` does not have it: on a Mac use `brew install ffmpeg-full`, then `export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"` for every `npm run` command, and run `ffmpeg -version` afterwards to see that it still starts.
- Python 3.10 or newer: `python3 --version` (Windows: `py -3 --version`)
- Chrome or Chromium (any install the kit can find, or set `CHROME_PATH`)

## 2. Get the code

```
git clone https://github.com/wrg32786/aigent-talking-head
cd aigent-talking-head
npm install
```

If the cloned folder already exists, `git pull` instead, then run `npm install`.

## 3. Python packages in a venv

macOS and Linux:

```
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export PYTHON="$PWD/.venv/bin/python"
```

Windows (PowerShell):

```
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
```

Windows (Command Prompt): the same first two lines, then `set PYTHON=%CD%\.venv\Scripts\python.exe`.

A venv avoids "externally managed environment" errors (PEP 668). Keep `PYTHON` set for every `npm run` command, or tell the user to add it to their shell profile.

Optional, ask first:

- `npm run effects:setup` sets up the effects venv (51 effects, the person mask for titles behind the head). Several hundred MB.
- `npm run teardown -- <file> --install` installs rea-video for tearing down reference reels (docs/teardown.md). About 216 MB of models on first use. It needs Git on the machine (pip fetches rea-video from GitHub). Without Git, skip it: `npm run teardown -- <file>` uses the built-in analyzer, which the smoke test covers.

## 4. Verify

```
npm run chrome      # prints the Chrome it found
npm run check       # must print CHECK PASS
npm run smoke       # must print SMOKE PASS (several minutes, synthetic clips, no keys or network)
```

If something fails, fix it and run it again. Do not tell the user it is installed until `CHECK PASS` and `SMOKE PASS` both print. (`npm run verify -- <job>` is the check for a finished reel, once there is one.)

## 5. Install the skills (optional)

```
npx skills add wrg32786/aigent-talking-head
```

That puts the talking-head skills in Claude Code, Codex, Cursor and other agents that read `SKILL.md` folders.

If your agent can't run that, copy the folders under this kit's `skills/` into its skills folder by hand, keeping each folder's `SKILL.md` and supporting files together: `.claude/skills/` for Claude Code, `~/.codex/skills/` for Codex.

## 6. Finish

Tell the user in one or two lines that aigent-talking-head is installed and verified. Then offer the menu: run `npm run menu`, point them at `showcase/GALLERY.md`, and ask how they want to start:

- make a reel from a clip they drop in `inbox/`,
- use a saved preset or a recipe from `examples/recipes/`,
- or tear down a reel they like (`npm run teardown -- <file>`) and remake it with their clip.

Stop there and wait for their answer.
