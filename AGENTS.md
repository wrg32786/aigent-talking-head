# For agents (Claude Code, Codex, others)

You can rebuild an AIgent talking-head ad end to end from this repo.

1. Pick the skill:
   - Raw footage in hand? Read [skills/clip-raw-footage/SKILL.md](skills/clip-raw-footage/SKILL.md) first.
   - Takes in hand, or making HeyGen takes? Read [skills/talking-head-ad/SKILL.md](skills/talking-head-ad/SKILL.md).
2. Use the scripts in `kit/` as they are. Put job data in `cut.json` and `captions.js`, never in the scripts.
3. Start from the worked example in `kit/example/` (the shipped Awakening ad).

Install Claude Code skills by copying the two folders under `skills/` into `.claude/skills/`. The SKILL.md files point back to `kit/` by relative path, so keep the repo next to them or fix the paths.

Hard rules:
- Verify every render: re-transcribe it with the music in, and read frame strips across every seam. A probe proves something exists; your eye on the frames proves it looks right.
- You can't hear. Never call a sound good. Build an audition and let the human pick by ear.
- Never fabricate copy the offer contradicts, such as "free" on a paid product.
- Number versions (`-v1`, `-v2`, ...) and keep the old ones for comparison.
