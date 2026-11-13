# Install aigent-talking-head (for agents)

You are installing aigent-talking-head for the user in this agent. It turns a phone clip into a styled 9:16 talking-head reel. Follow these steps in order, report each result honestly, and do not render anything or post anything until the user asks.

## 1. Check the machine

Report the OS and these versions. Install what is missing with the system's package manager, asking the user first if it needs admin rights.

- Node.js 18 or newer: `node -v`
- ffmpeg and ffprobe: `ffmpeg -version`, `ffprobe -version`
- Python 3.10 or newer: `python3 --version` (Windows: `py -3 --version`)
- Chrome or Chromium (any install the kit can find, or set `CHROME_PATH`)

## 2. Get the code

**From the members' download:** you are already inside the unzipped `aigent-talking-head-<version>` folder. Confirm that `package.json` says `"name": "aigent-talking-head"`, then run:

```
npm install
```

This path does not need Git or GitHub access. To update later, download the new zip and unzip it next to the old folder, which stays as your backup. Copy your own files across to the new folder: `inbox/`, `jobs/`, `teardown/` (your teardowns and their Reel.md recipes), saved presets in `kit/presets/local/`, your fonts and pairings in `kit/fonts/local/`, and any theme file you added to `kit/themes/` (copy only your own files; never replace the shipped ones). Then repeat the installation and verification steps there, and open one old job to check it still finds its files.

**From GitHub, for people with repo access:**

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

**From the members' zip:** copy the folders under this kit's `skills/` into your agent's skills folder by hand, keeping each folder's `SKILL.md` and supporting files together. For example, copy them into `.claude/skills/` for Claude Code or `~/.codex/skills/` for Codex. This uses only the files you downloaded.

**For people with GitHub repo access:** you can also use:

```
npx skills add wrg32786/aigent-talking-head
```

That puts the talking-head skills in Claude Code, Codex, Cursor and other agents that read `SKILL.md` folders.

## 6. Finish

Tell the user in one or two lines that aigent-talking-head is installed and verified. Then offer the menu: run `npm run menu`, point them at `showcase/GALLERY.md`, and ask how they want to start:

- make a reel from a clip they drop in `inbox/`,
- use a saved preset or a recipe from `examples/recipes/`,
- or tear down a reel they like (`npm run teardown -- <file>`) and remake it with their clip.

Stop there and wait for their answer.
