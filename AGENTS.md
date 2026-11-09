# For agents (Claude Code, Codex, others)

The usual job: a teammate recorded themselves on their phone, dropped the file in `inbox/`, and asks you to make the reel.

1. **Make the reel.** Read [skills/talking-head-ad/SKILL.md](skills/talking-head-ad/SKILL.md) and start at "Phone clip to reel". The one command is `npm run reel` (newest video in `inbox/`), or `npm run reel -- inbox/<file> --theme <name>`.
2. **Only want clips** from a long recording? Read [skills/clip-raw-footage/SKILL.md](skills/clip-raw-footage/SKILL.md).
3. **HeyGen takes** are optional. They're covered in the talking-head-ad skill under "Optional: HeyGen takes".

Setup check: `npm install`, `pip install -r requirements.txt`, then `npm run smoke` must print `SMOKE PASS`. If Chrome isn't found, set `CHROME_PATH`; if Python isn't `python3`, set `PYTHON`.

Use the scripts in `kit/` as they are. Put job data in `jobs/<name>/build/cut.json` and `captions.js`, and the look in `theme.js`, never in the scripts. The worked example is in `kit/example/` (the shipped Awakening ad).

Install Claude Code skills by copying the two folders under `skills/` into `.claude/skills/`. The SKILL.md files point back to `kit/` by relative path, so keep the repo next to them or fix the paths.

Hard rules:
- Verify every render: re-transcribe it with the music in, and read frame strips across every seam. A probe proves something exists; your eye on the frames proves it looks right.
- You can't hear. Never call a sound good. Build an audition and let the human pick by ear.
- Never fabricate copy the offer contradicts, such as "free" on a paid product.
- Number versions (`-v1`, `-v2`, ...) and keep the old ones for comparison. `npm run reel` does this for you.
- Ask which theme to use if the teammate hasn't said. Don't use the AIgent theme or the Skool mark for another brand.
