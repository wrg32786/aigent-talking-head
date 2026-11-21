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
   - act on them: `studio_set_selections` (origin studio), `studio_add_reference_url` then `studio_get_reference_teardown`, `studio_run` (draft or render; `from: pieces | take`, `exports`), `get_edit` (what the user is making, from what), `explain` after a draft;
   - answer each with `studio_reply { replyTo: <id>, text }` (add `patch` to change the edit in the same call). Plain, short sentences. For a bigger change, or one the user should decide on, send it as `suggest: { patch, combo, step, label }` instead: the page shows an Apply button and nothing changes until they click it.
   - a message that starts "(On the Cut step)" (or another step) came from **Ask my agent** on that step. A note "from 0:04 to 0:09" is about that stretch of the reel or take; one "at 0:04" is one frame (its `attach` has `t`, `end`, the box and the frame image).
3. Call `studio_wait_for_message` again. If it timed out, call it again; the page shows you as listening while you wait.
4. When the user talks to you in the terminal, stop listening and answer there. While you work in the terminal, call `studio_get_pending` at the start of each turn so Studio messages are not missed. In Claude Code the Studio hook also tells you when Studio messages are waiting.
5. Stop the loop when the user says so in either channel.

You cannot be interrupted mid-step: a Studio message sent while you run a long command waits until your next check. The page shows it as queued, then seen, then answered.

## Reference links

`studio_add_reference_url { urls, mode }` downloads each link (YouTube, Shorts, TikTok, X, Vimeo through yt-dlp, a direct video file, or one public Instagram post fetched anonymously with instaloader) into the user's download folder, then tears it down. Read the result with `studio_get_reference_teardown`: cuts, pacing, BPM and beats, energy, caption style, detected effects, and suggestions as menu refs. "Use the transitions from this reference but calmer" means: allow the reference's transitions, then lower the energy and forbid the harsh ones. Only use videos the user has the rights to use as a reference. Never log in to Instagram.

## Scripts

The Scripts area holds what the user reads on camera, per job. `list_scripts`, `get_script` and `write_script` read and write it; the page updates at once. For "write a 30 s script on X", "rewrite this tighter" or a Studio message that starts "Write a script from this reference" (it carries the teardown): draft it, run your humanizer skill on it (if you have none, follow `skills/humanizer/SKILL.md` in this kit), save with `write_script` (with `id` to replace), then `studio_reply` with one line: title, words and length. Format: `[hook]`, `[body]`, `[cta]` alone on a line, `[pause]` where they breathe, about 150 words a minute. From a reference, match its hook length, number of beats, pacing and beat times. No em dashes.

## The Cut step

The user picks what to make from a take on the Cut step: format, length, full edit or clips or both, organic or ad. `set_output` changes it when they ask in words ("make five 30 second clips for an ad"). When a Studio message says "Pick the cuts for ...", read `get_cuts` (the transcript as numbered sentences with times, and the rules' candidates), pick the strongest parts for that goal (a hook in the first 1 to 2 s; for ads a clear call to action at the end; for organic shorts an ending that loops), and send them with `set_cuts`: time ranges in seconds, a 0 to 100 score and a short plain reason each. Sentence times are enough: Studio moves each edge to the quiet in the audio after the last word (or before the first), so no word is clipped and no breath is left hanging. The user trims and keeps them on the timeline; `render_cuts` renders the kept ones when they ask (`file: true` only saves plain clips); in the page they render on the Finish step, not the Cut step: Draft there makes one reel from the user's pieces (kept cuts in order, then bites), and Render can also make each piece its own reel (`studio_run` with `exports: { clips: true }`) or a plain clip (`plain: true`). Read `get_edit` first to see what the next draft uses. For a long recording, when they ask you to pick bites ("Pick bites from my take"), read `get_lines` (every line with its number, times, text, keep and a retake or fragment hint), mark retakes with `keep: { n: false }`, and send `set_bites` with named bites of line numbers in the order they should play: one complete thought each, a strong first line, the call to action last for an ad. Add `clean: true` for one clean take of every kept line. Your bites show in the page as yours, and `render_bites` renders them. A message that says "Adapt the script" asks you to rewrite it for their topic in the same structure, run the humanizer on it and save it with `write_script` as a new script.

## The Look step

A Look is a pack; the user changes it layer by layer in 9 layers (Text, Fonts, Graphics, Transitions, Color and finish, Motion, Music and SFX, B-roll, Layout), each option in exactly one. `studio_get_state` with `catalog: true` lists them by layer. A reference is used whole (recreate), in parts (influence) or off. `clear_reference` takes it and the picks it added off as one undo (`undo: true` puts them back); `save_look` saves the current Look, with the reference's look when one is in use.

## Pieces and the Combo

On the Cut step every transcript line is a piece with a category: hook, story, tip, proof, list, cta, aside or retake. Read them with `get_pieces`. When the user asks you to build the reel, `set_combo` with the ids in play order and one short reason each (no em dashes), or `choose_combo` for Studio's pick. The Combo drafts and renders ahead of the kept cuts. Pieces are whole lines with edges on the audio's quiet, so a Combo never cuts a word: tighten by dropping or reordering pieces, not by trimming one. `list_outputs` lists every rendered version with the look, length, pieces and files that made it; `reopen_reel` edits one again.

## The B-roll step

After a draft, the reel has spots (one per cut segment, a long one split every 6 to 10 s at a caption end; the API still says `beat`). B-roll picks itself after every draft, so read `list_broll` first: some spots are already filled (by Studio, with why) and some wait. `pick_broll` runs the same rules again (`fill: true` also places what is free, never a generate; `auto: false` turns it off). Suggest your own with `suggest_broll` (each idea: `beat`, one plain line in `idea`, `why`, and a library `clip`, a stock `query` or a `card`, plus `place`: `full`, `top` (split, the panel behind the top of the head), `pip` or `frame` (framed cards, the user smaller below with the head over the card edge), and `offset` on the word); they wait for the user to approve or dismiss. About one every 6 to 10 s, on a spot that names a number, a result, a product or a command; on the first spot start after 1.2 s so the hook shows the face. Cards fit numbers (`counter`, `chart`), quotes, code and commands (`code`, `terminal`). `add_spot` splits a spot at a time. `add_broll` makes or fetches a clip into the library (and onto a spot with `beat`); a file can say its `type` (testimonial, product-demo, screen-recording, lifestyle) and `raw: true` cuts it into pieces on whole words first. `add_testimonial` plays a testimonial piece in the reel with its own sound after one of the user's pieces (Draft again). `fill_slot` places, changes or clears one. Generating spends the user's money: `fill_slot` with `generate` only creates an ask with the estimated cost, and the user approves it on the page. `broll_providers` tells you which keys are set (never their values); if a key is missing, tell the user to add it in Settings, API keys and providers, never to paste it in chat.


## The Post step

After a render, `buffer_channels` lists the user's Buffer channels with each network's limits, and `buffer_post_reel` sends the reel there: one post per channel, saved as Buffer drafts by default. Queue and schedule are fine when the user asks for them. Post now publishes immediately, so use `mode: "now"` with `confirmNow: true` only when the user clearly said to publish now. Channels the reel is too long for (Facebook Reels 90 s, YouTube Shorts 3 min) are skipped with the reason; tell the user. The Buffer key and the video host (Cloudflare R2, Cloudinary or their own public link) are set up by the user in Studio, never pasted in chat.
## Recorded takes

When the user wants to start the next reel ("new video", "start fresh", "clear the board"), call `new_video` with the name they gave (`keepLook` stays true unless they want the default look back). It clears footage, cuts, reference, b-roll, the draft and the chat for the new job and deletes no files; the old video's session is saved, and `list_videos` and `open_video` bring it back. It is refused while a draft, render, download or take is running: ask the user whether to cancel it, then call it again.

The user can film takes in the Footage step (Record now). A saved take is already in the footage, and the Studio chat shows an action note such as "New take recorded: 42 s (take 3)" in `recentStudioChat`. `studio_takes` lists them (file, seconds, status, kept, and the script it was read from, which the next draft also hands to Whisper so captions spell its words) and keeps, unkeeps or discards one; discard deletes the files, so only do it when the user asks. You can't film for the user: the camera only runs in their browser.

## Wizards

`run_wizard` does what the Wizards dialog does: `{ wizard: reel, goal: grow | sell | teach | clean, look, choose: true }` (any of them, in one call or one at a time), `{ wizard: clips, clips, ads }` (finds them on whole words), `{ wizard: reference, url }` (Use all). When the user presses **Let my agent decide** in a wizard, you get a message asking you to make that choice: make it with `run_wizard` or suggest it with `studio_reply suggest`.

## Rules

- Only names from the Studio menu (`studio_get_state` with `catalog: true`); the tools refuse anything else.
- Do not render, post or share anything the user did not ask for.
