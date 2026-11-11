# For agents (Claude Code, Codex, others)

The usual job: a teammate recorded themselves on their phone, dropped the file in `inbox/`, and asks you to make the reel.

1. **Offer the menu (mandatory).** Before you draft, and again before the final render, show the user the options so the menu of effects, graphics, finishes and looks never stays hidden. First ask: use a saved brand preset (`npm run preset -- --list`, or `--preset <name>`), customize from the menu, or let you choose (`--preset auto`, then say what you picked). If no preset exists, offer to import a brand guide (`npm run brand:import -- <file>`, draft goes in `kit/presets/local/` for the human to confirm). Then run `npm run menu` and point them at [showcase/index.html](showcase/index.html). Cover film finishes (including per-scene variety), beat-sync, looks and caption styles (including one-word), font pairings, themes, title entrances, transitions, the 51 effects by moment, the SFX pack, music beds, and the shipped presets. Suggest 2 or 3 options per category that fit this reel. Vary looks across scenes rather than one finish for everything.
2. **Make the reel.** Read [skills/talking-head-ad/SKILL.md](skills/talking-head-ad/SKILL.md) and start at "Phone clip to reel". The one command is `npm run reel` (newest video in `inbox/`), or `npm run reel -- inbox/<file> --theme <name>`.
3. **Only want clips** from a long recording? Read [skills/clip-raw-footage/SKILL.md](skills/clip-raw-footage/SKILL.md).
4. **Effects** are an optional second pass: the "Pick effects" section of the talking-head-ad skill, with the menu in [effects/CATALOG.md](effects/CATALOG.md) and the same showcase. Use `npm run fx`, not the vendored upstream `SKILL.md`, so captions stay on top and the teammate's own name and handle are used.
5. **HeyGen takes** are optional. They're covered in the talking-head-ad skill under "Optional: HeyGen takes".

Setup check: `npm install`, `pip install -r requirements.txt`, then `npm run smoke` must print `SMOKE PASS` and `npm run check` must print `CHECK PASS`. If Chrome isn't found, set `CHROME_PATH`; if Python isn't `python3`, set `PYTHON`.

Use the scripts in `kit/` as they are. Put job data in `jobs/<name>/build/cut.json` and `captions.js`, and the look in `theme.js`, never in the scripts. The worked example is in `kit/example/` (the shipped Awakening ad).

Install Claude Code skills by copying the two folders under `skills/` into `.claude/skills/`. The SKILL.md files point back to `kit/` by relative path, so keep the repo next to them or fix the paths.

Hard rules:
- Offer the menu before drafting and again before the final render. First ask: saved brand preset, customize, or let you choose. `npm run menu` prints every option; [showcase/index.html](showcase/index.html) shows them labelled. Suggest 2 or 3 per category, and vary film finishes across scenes.
- For titles behind the head, prefer `npm run reel -- --mask birefnet` (or `"maskModel": "birefnet"` in `cut.json`) on the real footage: tighter hair and hands than MediaPipe, after `npm run effects:setup -- --birefnet`. It is slow on CPU (several seconds per title frame). MediaPipe is the fast fallback and what `npm run smoke` uses. Judge mask quality on composited stills, by eye; `mask.json` is for coverage numbers, not a colour preview of the matte.
- Run `npm run verify -- <job>` before you hand over any reel, and look at `jobs/<job>/verify/contact.png`. It must print `VERIFY PASS`. Fix what it flags, don't explain it away.
- Copy follows the humanizer rules in the talking-head-ad skill: no em dashes, no "not X, but Y", no hype words. `npm run check -- <job>` lints it.
- Verify every render: re-transcribe it with the music in, and read frame strips across every seam. A probe proves something exists; your eye on the frames proves it looks right.
- You can't hear. Never call a sound good. Build an audition and let the human pick by ear. Fewer, deeper sounds: never one on every cut. Prefer the shipped pack (`kit/sfx/sfx.json`, auto-picked on `npm run fx`) or a CC0 file the human has already chosen; don't invent new raw synthetic swooshes.
- Never fabricate copy the offer contradicts, such as "free" on a paid product.
- Number versions (`-v1`, `-v2`, ...) and keep the old ones for comparison. `npm run reel` does this for you.
- The default theme is AIgent; use it unless the teammate asks for another look. Don't use the Skool mark for another brand. For other brands, use `--theme neutral` or their own `kit/themes/<name>.js`.
