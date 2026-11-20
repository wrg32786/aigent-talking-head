---
name: aigent-studio
description: "Set up AIgent Studio (the local reel editor page of aigent-talking-head) and be the agent inside it: install the kit, register its MCP server in your own config, start Studio, open the page, then run the Studio chat loop (listen with studio_wait_for_message, answer with studio_reply, check studio_get_pending each turn). Use when the user says install and run Studio, open Studio, run the Studio chat loop, or answer me in Studio."
---

# Be the agent in AIgent Studio

Studio is a page on the user's computer (http://127.0.0.1:4757) where they drop footage and reference links, click effects and chat. You are the agent in that chat. Full setup per agent: [AGENTS.md](../../AGENTS.md#studio-set-it-up-and-be-the-agent-in-it). Install everything yourself with `npm run setup:all`, check with `setup_status`, and tell the user only its `forUser` lines (what needs their password or their click), in plain words.

## Two channels, one agent

- **Studio chat**: what the user types in the page. Read it with `studio_wait_for_message` or `studio_get_pending`; answer with `studio_reply` (it shows only in Studio). A comment on the preview comes with `attach` (`t`, `region`, `video`, `frame`): open the frame image first; the region is fractions of the frame.
- **Terminal**: your normal conversation with the user. Answer it here, as usual.
- Keep them separate. Never paste terminal discussion into Studio, and never answer a Studio message only in the terminal, unless the user asks.
- Edits are shared: whatever you change (picks, pack, music, references, drafts) updates the page live, whichever channel asked. When the terminal asked for it, call `studio_set_selections` with `origin: "terminal"`; Studio then shows a one-line action note (if the user keeps action notes on), never the conversation.

## The loop

1. `studio_start` (or `npm run studio:agent`) and tell the user the URL.
2. `studio_wait_for_message` (default 45 s). When it returns messages:
   - act on them: `studio_set_selections` (origin studio), `studio_add_reference_url` then `studio_get_reference_teardown`, `studio_run` (draft or render), `explain` after a draft;
   - answer each with `studio_reply { replyTo: <id>, text }` (add `patch` to change the edit in the same call). Plain, short sentences.
3. Call `studio_wait_for_message` again. If it timed out, call it again; the page shows you as listening while you wait.
4. When the user talks to you in the terminal, stop listening and answer there. While you work in the terminal, call `studio_get_pending` at the start of each turn so Studio messages are not missed. In Claude Code the Studio hook also tells you when Studio messages are waiting.
5. Stop the loop when the user says so in either channel.

You cannot be interrupted mid-step: a Studio message sent while you run a long command waits until your next check. The page shows it as queued, then seen, then answered.

## Reference links

`studio_add_reference_url { urls, mode }` downloads each link (YouTube, Shorts, TikTok, X, Vimeo through yt-dlp, a direct video file, or one public Instagram post fetched anonymously with instaloader) into the user's download folder, then tears it down. Read the result with `studio_get_reference_teardown`: cuts, pacing, BPM and beats, energy, caption style, detected effects, and suggestions as menu refs. "Use the transitions from this reference but calmer" means: allow the reference's transitions, then lower the energy and forbid the harsh ones. Only use videos the user has the rights to use as a reference. Never log in to Instagram.

## Scripts

The Scripts area holds what the user reads on camera, per job. `list_scripts`, `get_script` and `write_script` read and write it; the page updates at once. For "write a 30 s script on X", "rewrite this tighter" or a Studio message that starts "Write a script from this reference" (it carries the teardown): draft it, run your humanizer skill on it (if you have none, follow `skills/humanizer/SKILL.md` in this kit), save with `write_script` (with `id` to replace), then `studio_reply` with one line: title, words and length. Format: `[hook]`, `[body]`, `[cta]` alone on a line, `[pause]` where they breathe, about 150 words a minute. From a reference, match its hook length, number of beats, pacing and beat times. No em dashes.

## The Cut step

The user picks what to make from a take on the Cut step: format, length, full edit or clips or both, organic or ad. `set_output` changes it when they ask in words ("make five 30 second clips for an ad"). When a Studio message says "Pick the cuts for ...", read `get_cuts` (the transcript as numbered sentences with times, and the rules' candidates), pick the strongest parts for that goal (a hook in the first 1 to 2 s; for ads a clear call to action at the end; for organic shorts an ending that loops), and send them with `set_cuts`: time ranges in seconds, a 0 to 100 score and a short plain reason each. The user trims and keeps them on the timeline; `render_cuts` renders the kept ones when they ask. A message that says "Adapt the script" asks you to rewrite it for their topic in the same structure, run the humanizer on it and save it with `write_script` as a new script.

## Recorded takes

The user can film takes in the Footage step (Record now). A saved take is already in the footage, and the Studio chat shows an action note such as "New take recorded: 42 s (take 3)" in `recentStudioChat`. `studio_takes` lists them (file, seconds, status, kept, and the script it was read from, which the next draft also hands to Whisper so captions spell its words) and keeps, unkeeps or discards one; discard deletes the files, so only do it when the user asks. You can't film for the user: the camera only runs in their browser.

## Rules

- Only names from the Studio menu (`studio_get_state` with `catalog: true`); the tools refuse anything else.
- Do not render, post or share anything the user did not ask for.
