# Agent B-roll generation: a brief in, a clip back

Status: design, not built. Spec only, for v1.30, after the Asset Vault in v1.29. This sits beside [`broll-sourcing.md`](broll-sourcing.md).

The short version: Studio never calls ComfyUI, Comfy Cloud or Higgsfield. For an empty B-roll slot the user can choose **Generate B-roll**. Studio writes a shot brief (JSON and plain text) and offers **Copy** or **Send to my agent**. The user's own agent (Claude Code, Codex, Cursor, or another) renders the clip with one of three skill packs and drops the finished file plus a small sidecar into a watched inbox in the Vault. Studio matches it to the slot. Keys stay in the user's tools. Nothing is vendored.

## Why this shape

Will asked whether we should hook Studio up to Comfy, then pointed at three skill packs that already teach an agent how to render: [Comfy Cloud](https://github.com/Comfy-Org/comfy-skills), [open-higgsfield-skills](https://github.com/mojomast/open-higgsfield-skills) for local ComfyUI, and the official [Higgsfield skills](https://github.com/higgsfield-ai/skills).

Wiring any of them into Studio would mean we hold keys, chase three moving APIs, and put setup commands in the UI. We already have a better door: the **Copy** / **Send to my agent** buttons on a Needs B-roll card. One brief format and one inbox cover all three backends. The user clicks or copies. Their agent does the rest.

This does not replace the Settings-key Generate path we already ship (Higgsfield, Google, OpenAI, Replicate, fal, with **Generate for $X**). That path stays. This is the agent path, for people whose agent already has a skill pack, including Comfy Cloud (ComfyUI with no local GPU) and a local ComfyUI box.

## What we want

- Optional. Nothing generates until the user asks.
- One brief and one inbox, for every backend.
- The user never types a terminal command in Studio. They get click or copy buttons to hand to their agent.
- Captions stay off the face. We never cut words, and we never start mid-word. A generated clip must not burn in captions, titles or watermarks; Studio lays those out itself.
- We do not generate screens of real products, real logos or real people. For those the answer is the Vault or a capture, as in the sourcing spec.
- Nothing costs money without a yes. The click to generate is the yes to start. On a paid backend the agent also confirms spend with the user before it submits a job, because Studio cannot see the price.
- A generated clip shows its first frame and waits for **Use** before it is placed.
- Keys, OAuth sessions and CLI logins stay in the user's own tools. Studio stores none of them.

## 1. The path, start to finish

1. An empty slot on the B-roll step (or a Needs B-roll card) offers **Generate B-roll**, next to Upload, stock (when a key is set), **Copy for my agent** and Skip.
2. Studio writes two files for that slot into the Vault inbox: a JSON brief the agent can parse, and a plain-text brief the user can copy. The prompt comes from the slot's transcript beat, the same brief fields as in `broll-sourcing.md` section 1, plus duration, aspect, motion, style from the current look, and a seed.
3. The user clicks **Copy** or **Send to my agent**. Send uses the agent channel we already have. Copy puts the plain-text brief on the clipboard, including the path to the JSON file and the inbox.
4. The card switches to **Waiting for a clip**. Studio watches the inbox. There is no spinner that pretends we are calling a model. We are waiting for a file.
5. The agent runs a preflight (section 5), picks a ready backend, renders, and writes the media file plus a sidecar JSON into the inbox out folder.
6. Studio matches the sidecar to the slot (section 3), shows the first frame, and offers **Use** or **Try again**. On Use, the clip is placed on the slot and added to the Vault marked "Made", with the backend, model, prompt and seed kept for `credits.txt`.

One slot at a time on the card. A single extra control on the B-roll step, not on each card, can **Copy briefs for all empty slots** as one text, for a user who wants the agent to fill several in one sitting.

## 2. The brief

The brief is written once when the user asks to generate, and is not rewritten unless they click Try again (new seed, same subject, unless they edit the prompt).

### JSON, `aigent.broll.brief/v1`

Studio writes this to `vault/inbox/in/<jobId>-slot-<slotId>.json`.

```
{
  "schema": "aigent.broll.brief/v1",
  "briefId": "b7c1e4",
  "jobId": "five-plugins",
  "slotId": "2",
  "written": "2026-11-22T14:10:00-08:00",
  "inboxOut": "C:\\Users\\Will\\...\\vault\\inbox\\out",
  "subject": "a quiet desk from above, a closed laptop, morning light",
  "prompt": "A quiet desk from above, a closed laptop, a notebook and a coffee cup, soft morning light through a window, shallow depth of field, photoreal, no people, no text, no logos.",
  "why": "you are talking about a calm start to the day",
  "line": "I start the morning at a clear desk.",
  "named": [],
  "shot": "place",
  "motion": "push",
  "motionStrength": "low",
  "seconds": 5.5,
  "aspect": "9:16",
  "sizeHint": { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080] },
  "style": {
    "look": "the current look's name, if any",
    "colours": ["#0d1117", "#e8e4d9", "#c4a574"],
    "mood": "calm, warm, slightly filmic",
    "grain": "light",
    "notes": "Match this mood and these colours. Do not burn in type, captions, titles or watermarks."
  },
  "seed": 41722,
  "stillOk": true,
  "preferVideo": false,
  "backend": "any",
  "avoid": ["faces of other people", "logos we have not confirmed", "burned-in text"],
  "doNotGenerate": ["screens of real products", "real logos", "real people"],
  "fpsHint": 24
}
```

Field notes:

- **`subject` and `prompt`.** `subject` is the one plain line we show the user, the same idea as the sourcing brief. `prompt` is the longer line the agent should send to the model: subject, setting, light, style, and the avoid list spelled out. Studio writes it from the transcript beat, the slot brief, and the current look. The user can edit it before Copy or Send (one box, not a form).
- **`seconds`.** The slot's length plus one second of handle, as in the sourcing brief. The agent should render at least this long. If a backend has a higher minimum (Seedance 2.5 starts at 4 seconds), render the minimum and say so in the sidecar. Studio will trim to the slot. Trimming B-roll does not cut the user's words.
- **`aspect`.** One of `9:16`, `4:5` or `1:1`, taken from the size this draft is being made for (Reels and Stories, the Instagram Feed, or square). If the reel will be exported in more than one size, use the size of the slot's frame for the current draft, usually `9:16`. If a backend cannot do `4:5`, the agent renders the closest it can (`9:16` or `3:4`), records that in the sidecar, and may reframe rather than crop the subject off.
- **`motion` and `motionStrength`.** From the slot's effects (`push`, `pan`, `orbit`, `static`, and so on). `motionStrength` is `low`, `medium` or `high`. A still with a slow push is enough when `stillOk` is true and `preferVideo` is false. Video only when the motion needs it (a real camera move, a changing scene).
- **`style`.** Colours, mood and grain from the current look (and from the reference, on Recreate). Not fonts. Type is Studio's job.
- **`seed`.** An integer Studio picks and stores on the slot. The agent must pass it when the backend accepts a seed, and must write the seed it actually used in the sidecar. Try again may keep the seed (same picture, different backend) or roll a new one (a new variation). The button does the new seed. A smaller "Same seed" is in a fold, not on the card.
- **`backend`.** `any` by default, or `comfy-cloud`, `open-higgsfield` or `higgsfield` if the user pinned one. When it is `any`, the agent picks the first ready backend in the order in section 4, after preflight, and confirms spend with the user before a paid job.
- **`inboxOut`.** An absolute path, written for the user's OS (Windows 11 in our case). The agent must drop files here, not in a folder of its own choosing.
- **`doNotGenerate`.** Hard rules. If the subject is a real product screen, a real logo or a real person, Studio should not offer Generate as the first action. The card prefers Capture, Record my screen, or the Vault. If the user still asks, the brief keeps these rules and the agent must refuse and say why in the sidecar (`status: "blocked"`).

### Plain text, what Copy puts on the clipboard

The text brief is the same facts in sentences, plus short instructions the agent can follow. It names the JSON path, the inbox, the preflight, the three backends and the sidecar rules. It does not tell the *user* to run terminal commands. It is a note for their agent.

A sketch of the tone (not every field):

```
Make one B-roll clip for AIgent Talking Head Studio and drop it in the inbox.

Job: five-plugins
Slot: 2
Brief file: C:\Users\Will\...\vault\inbox\in\five-plugins-slot-2.json
Drop the clip and the sidecar in: C:\Users\Will\...\vault\inbox\out
Name them: five-plugins-slot-2.mp4 (or .png if you only make a still)
           five-plugins-slot-2.json

What to show: a quiet desk from above, a closed laptop, morning light
Duration: at least 5.5 seconds
Aspect: 9:16 (1080x1920 if you can)
Motion: a slow push in
Seed: 41722
Style: calm, warm, slightly filmic, colours #0d1117, #e8e4d9, #c4a574
Do not burn in captions, titles, type or watermarks.
Do not generate real people, real logos, or screens of real products.

First run a preflight and use the first backend that is ready, in this order:
1. Comfy Cloud (official comfy-cloud plugin, hosted, needs a signed-in Comfy Cloud account)
2. Local ComfyUI through open-higgsfield-skills (free, needs a GPU, early)
3. Official Higgsfield skills (hosted, paid, auth is in the Higgsfield CLI)

If the backend is paid, confirm spend with me before you submit.
If none is ready, write a sidecar with status "needs-setup" and a short report, and stop.
Write the sidecar schema aigent.broll.clip/v1, including the jobId, slotId, briefId, backend, model, prompt, seed, aspect, duration, and any licence notes.
```

**Send to my agent** sends this same text, and a pointer to the JSON file, on the existing Studio agent channel.

## 3. The inbox and the sidecar

A new pair of folders inside the Vault (the Vault folder from `broll-sourcing.md`, `vault/` in the kit by default, or the folder the user picked):

```
vault/
  inbox/
    in/     briefs Studio writes (json + txt)
    out/    clips and sidecars the agent writes
    seen/   sidecars Studio has taken, moved after a successful pickup
```

Studio creates the folders the first time someone clicks Generate B-roll. It does not watch `in/`. It watches `out/`.

### Sidecar, `aigent.broll.clip/v1`

The agent writes `vault/inbox/out/<jobId>-slot-<slotId>.json` next to the media file. The media name is in `file`.

```
{
  "schema": "aigent.broll.clip/v1",
  "briefId": "b7c1e4",
  "jobId": "five-plugins",
  "slotId": "2",
  "status": "ok",
  "backend": "comfy-cloud",
  "skill": "generate-video",
  "model": "the live template or partner slug, as returned",
  "prompt": "the prompt actually sent",
  "seed": 41722,
  "aspect": "9:16",
  "width": 1080,
  "height": 1920,
  "duration_s": 5.5,
  "fps": 24,
  "kind": "video",
  "file": "five-plugins-slot-2.mp4",
  "licenseNotes": "",
  "cost": { "note": "Comfy Cloud credits. Price not reported by the connector." },
  "warnings": [],
  "error": null
}
```

`status` is one of:

| Status | Meaning | What Studio does |
| --- | --- | --- |
| `ok` | A usable clip or still is in `file` | Preview and offer Use |
| `failed` | The run started and did not finish | Show `error` in one line, offer Try again |
| `needs-setup` | Preflight found no ready backend | Show the report, offer **Copy the setup note** |
| `blocked` | The brief asked for something we will not generate | Show why, do not offer Try again with the same prompt |

### Slot matching

Studio picks up a result only when all of these are true:

1. A sidecar with `schema` `aigent.broll.clip/v1` has appeared in `out/`.
2. If `status` is `ok`, the media file named in `file` sits in the same folder, is a known type (`.mp4`, `.webm`, `.mov`, `.m4v`, or `.png` / `.jpg` / `.webp` for a still), and its size has been stable for a couple of seconds (so we do not grab a half-written file).
3. `jobId` matches the open job, and `slotId` matches a slot in that job's `plan.json`. Prefer `briefId` when it is present and still on that slot.

Fallbacks, in order: exact `jobId` + `slotId`; then the filename pattern `<jobId>-slot-<slotId>.*` when the sidecar is missing those fields. No match means we still add a good file to the Vault as "Made, unmatched", and we say "This clip arrived but we could not tell which slot it was for." We never place it on a slot by guessing.

A sidecar for a different job is left in `out/` until that job is open, or the user opens the Vault and keeps it. It is not deleted.

After a successful pickup, Studio moves the sidecar (and only the sidecar) to `inbox/seen/`, and copies the media into the Vault item folder. It does not delete the agent's media file until the Vault copy is good. A setting can "Leave inbox files alone"; the default is to tidy `out/` after a successful copy.

### Failure, timeout and cancel

- **Waiting.** The card says "Waiting for a clip" and the time since we started watching. Default watch is 20 minutes. Video is slow, especially on a local GPU or a queued hosted job.
- **Still waiting.** At 20 minutes we stop the clock and ask **Keep waiting** (another 20 minutes) or **Cancel**. We do not fail the slot on our own.
- **Cancel.** We stop watching. A late file still goes into the Vault when we next see it (the Vault can notice `out/` whenever it is open), but it is not auto-offered on the slot. The card goes back to Needs B-roll.
- **Failed or blocked.** One line from `error`, then Try again or, for `needs-setup`, Copy the setup note.
- **Bad sidecar.** Missing schema, or `ok` without a file: one line, "Your agent left a note we could not read," and we leave the files in `out/`.

## 4. The three backends

Studio does not install these, call them, or vendor them. The brief tells the agent what they are and how to ask for one shot. Versions and star counts below are as of 22 November 2026 and will move.

The agent uses the same brief and the same inbox for all three. After preflight it should say, in one line, which backend it picked and why.

### 1. Comfy Cloud (easiest, official, hosted)

[Comfy-Org/comfy-skills](https://github.com/Comfy-Org/comfy-skills), MIT, 265 stars, last pushed 22 November 2026. Plugin `comfy-cloud` v0.2.1. This is the "ComfyUI with no local GPU" route.

**Install**, which the user's agent does, not Studio (Claude Code today):

- `/plugin marketplace add Comfy-Org/comfy-skills`
- `/plugin install comfy-cloud@comfy-skills`
- `/mcp` to sign in (OAuth)

That registers the hosted MCP server at `https://cloud.comfy.org/mcp`. Docs: [docs.comfy.org/cloud/mcp](https://docs.comfy.org/cloud/mcp). There is no API key to put in chat, and no local ComfyUI to start. A generation needs an active Comfy Cloud subscription. If a run is refused, the agent checks `get_billing_status` and reports it.

**Skills that matter for a B-roll slot:** `generate-image`, `generate-video`, `consistent-characters`, `upscale-image`, `remove-background`, `search-templates`. (The pack also has audio, 3D, model and node search, and help.) Invoke as `/comfy-cloud:generate-video` or in plain language.

**How to request a shot**, from `generate-video` and `generate-image`:

1. If the brief allowed a still (`stillOk`, and not `preferVideo`), try `generate-image` first with the prompt, aspect or size, and seed. A still that we push slowly is often enough.
2. For video, or to animate that still: if there is a start frame, `upload_file` it and use the returned name. Do not inline media bytes.
3. Prefer a template: `search_templates` for text-to-video or image-to-video, `get_template_schema`, `run_template`. Pass duration, aspect, seed and the prompt in the template's live parameters. Discover model and template names at run time. Do not hard-code them.
4. If the user or the brief pinned a model family, the skill also allows a partner route via `partner_generate` (`type: "video"`, prompt, optional `aspect_ratio`, `seed`, `duration`, `medias[]`). A wrong slug is rejected before the job is queued. Partner and open-source routes can both spend Comfy Cloud credits (the open-source route has no partner fee, but still uses compute credits). The agent must say which it is using, and must confirm spend.
5. Wait with `wait_for_job`, then `get_output`. If the result includes a download command and the session has a shell, run that command unchanged and save into `inboxOut`. Leave signed URL query strings as returned.
6. To adjust seed, prompt, duration or resolution of this result, use `submit_workflow` with `from_prompt_id` and `input_overrides`, not a rebuilt graph. If the result came from `partner_generate`, call it again with the changed fields.

**Caveats to state in the brief and in our UI copy, plainly:**

- Official support today is Claude Code, Cowork and Claude chat. Cursor and Codex folders are described as later work in the repo. A user on those agents may need to wait, or copy the skill files by hand.
- Catalog names move. The agent must discover templates and models live.
- This is paid compute, even on an open-source template.

### 2. Local ComfyUI, through open-higgsfield-skills (free, needs a GPU, early)

[mojomast/open-higgsfield-skills](https://github.com/mojomast/open-higgsfield-skills), MIT for the pack's own text and scripts (Copyright 2026 Kyle Durepos). 37 Agent Skills. Created 30 October 2026, 58 stars. Agent-agnostic (Claude Code, Codex, Cursor, OpenCode and others).

This pack talks to the user's own ComfyUI over HTTP (`COMFY_URL`, default `http://127.0.0.1:8188`), or to a Google Colab tunnel, and runs open weights.

**For one B-roll slot, do not run `video-director`.** That skill is an end-to-end short-film pipeline (story bible, many shots, voice, music, captions, final cut). A Studio slot needs one shot. The agent should:

1. `comfyui-preflight` on the graphs it will use. This reads `/object_info` and submits nothing.
2. `comfyui-connect` (`comfy_client.py`) to upload inputs, run the graph, wait and fetch into `inboxOut`.
3. `flux3-klein-stills` for the keyframe, at the target aspect, with the brief's seed. Prompt for subject, setting, lens, light and style. Hand the still to `still-qa` when that skill is usable; otherwise the agent checks it by eye.
4. `ltx25-image-to-video` to animate the still. Prompt for motion and camera, not appearance. `length` must be `8n+1` frames (97, 121, ...). Width and height must be multiples of 32. At 24 fps, 121 frames is about 5 seconds. Pick the length that meets `seconds`. Optional last frame only when chaining slots, which we do not ask for in v1.30.
5. `camera-control` only when the brief needs a named, exact move (orbit, dolly, crane) rather than a prompted push.
6. `reframe-aspect` if the result is not the requested aspect and a crop would cut off the subject. That skill already names 9:16, 1:1 and 4:5.

**Caveats we must state:**

- Early. The workflows were checked statically (graph structure, nodes, weights, dry runs). The project itself has **not** run most of them end to end on a GPU. VRAM figures are estimates.
- Needs about 16 GB VRAM for the draft tier, 24 GB for standard, 40 GB for max, or a Google Colab L4 / A100. The Google Colab runner is itself untested on a real Colab GPU.
- LTX-2.5 (and other LTX) weights are under the Lightricks LTX-2 Community License, which is **not** an OSI-approved open-source licence. It is open weights with use conditions. The agent must tell the user before commercial use.
- FLUX.2 Klein 9B is believed to be non-commercial (unverified). The FLUX 3 Klein licence is unverified. Check the model card before commercial use.
- Custom nodes and weight files are not in Studio. They live on the user's ComfyUI. Preflight will say what is missing.
- Third-party workflows in the pack keep their own MIT, Apache-2.0 or 0BSD licences. Model weights are not included.

### 3. Official Higgsfield skills (hosted, paid)

[higgsfield-ai/skills](https://github.com/higgsfield-ai/skills), official, MIT, about 2,047 stars, plugin v0.14.0. Works with Claude Code, Cursor, Codex and other agents that load Markdown skills.

**Install** (the agent or the user, never Studio): `npx skills add higgsfield-ai/skills`, or in Claude Code `/plugin marketplace add higgsfield-ai/skills` then `/plugin install higgsfield@higgsfield`. Auth lives in the user's Higgsfield CLI: `higgsfield auth login`, checked with `higgsfield account status`. Studio never sees that session.

**Skill for a B-roll slot:** `higgsfield-generate`. Defaults in v0.14.0: Seedance 2.5 for video (`seedance_2_5`, 4 to 30 seconds, up to 1080p), GPT Image 2.6 or Nano Banana Flash for stills. Other models in the same skill include Veo 3.1, Kling 3.0 (Turbo when the user wants cheaper or faster), Flux, Cinema Studio, and Grok Video. Discover live ids with `higgsfield model list` rather than pinning a name in our brief.

**How to request a shot:**

```
higgsfield generate create seedance_2_5 --prompt "..." --aspect_ratio 9:16 --duration 6 --wait
```

Image then video, when `stillOk` is true: make the still, then `seedance_2_5` with `--mode omni_reference --start-image <path>`. Pass `--wait` (default wait timeout 10 minutes; bump to 20 minutes for a long clip). Download the result URL into `inboxOut`. Pass the brief's seed when the model's schema accepts one; if the CLI rejects it, omit it and record that in the sidecar.

`--aspect_ratio` values commonly documented in the pack include `16:9`, `9:16`, `1:1`, `3:4` and others. `4:5` may not be listed. If the server rejects `4:5`, use the closest (often `3:4` or `9:16`), record the actual aspect, and do not crop the subject off.

The skill's own habit is not to pre-estimate cost unless the user asks, and to prefer the quality default. Our rule is stricter: the agent must confirm spend with the user before it submits, and should look up an estimate when the CLI offers one.

**Caveats:** paid, account-level billing, model list moves, minimum durations on some models (Seedance 2.5 at 4 seconds). Marketing Studio, Soul IDs, brand kits and faceless-video pipelines are out of scope for a B-roll slot.

## 5. Preflight, which the agent runs

Studio does not probe Comfy, Comfy Cloud or Higgsfield. The brief asks the agent to check, in this order, and to stop at the first ready backend when `backend` is `any`.

**Comfy Cloud is ready when** the `comfy-cloud` plugin (or the same hosted MCP at `https://cloud.comfy.org/mcp`) is installed, the user is signed in, and billing will allow a generation (`get_billing_status` if that tool is there).

**Local open-higgsfield is ready when** ComfyUI answers at `COMFY_URL` or `http://127.0.0.1:8188`, and `comfyui-preflight` reports the stills graph and the image-to-video graph as ready (nodes and weight files present). If the server is up but weights are missing, it is not ready. Mention the missing files in the sidecar and move on, unless this backend was pinned.

**Official Higgsfield is ready when** `higgsfield` is on `PATH` and `higgsfield account status` shows a signed-in account.

If none is ready, the agent writes a `needs-setup` sidecar and a short report: what it looked for, what was missing, and which pack to install. Studio shows that report and offers **Copy the setup note**, a second plain-text brief that tells the agent how to install one pack (the three install routes above) and to come back to the shot brief after. Again, the user copies or sends; they do not run commands in Studio.

If more than one is ready, follow the order in section 4, unless the user pinned a backend. Always confirm spend on a paid backend before submitting.

## 6. What it looks like

Keep the card quiet. Liquid glass on dark and cream on light, AIgent branding, one accent on the primary action, nothing else shouting. No model names, file paths, seeds or JSON on the card. Those live in the copied brief and in a small fold, **Brief details**, for people who want them.

```
Needs B-roll
Show a quiet desk from above. You are talking about a calm start to the day.

[ Upload ]  [ Generate B-roll ]  [ Skip ]
Copy for my agent · Send to my agent
```

After Generate, while we watch:

```
Waiting for a clip
Your agent is making this one. We will show it here when it lands.
2 minutes in                     [ Cancel ]
```

When a clip arrives:

```
Made for this slot. Check it before you use it.

[ first frame / hover to play ]

[ Use ]  [ Try again ]
```

### The words we use

| Where | Copy |
| --- | --- |
| Button | Generate B-roll |
| Under the button, once | Your agent makes the clip. We watch a folder for it. |
| Copy | Copy the brief |
| Send | Send to my agent |
| Waiting | Waiting for a clip |
| Timeout | Still waiting for a clip. Keep waiting, or cancel. |
| Ready | Made for this slot. Check it before you use it. |
| Failed | Your agent could not make this clip. |
| Needs setup | Your agent needs a generation pack set up first. |
| Blocked | We will not generate this. Use a capture, a recording or something from your Vault. |
| Setup button | Copy the setup note |
| On a placed clip | Made for this slot. |
| In the Vault | Made |
| All empty slots | Copy briefs for all empty slots |

A first-time user who clicks Generate and has never set up a pack should still get a brief that includes the preflight and the setup path. We do not add a settings page of API keys for these three backends. We do not put terminal commands on the card.

## 7. Rules that do not change

- **Captions stay off the face.** Generated media is footage only. Studio places captions and phrase titles itself, and keeps them off the face, including on 4:5 and 1:1.
- **Never cut words, and never start mid-word.** Slot timing stays on the transcript. A clip that is longer than the slot is trimmed or held. A clip that is shorter may loop or hold its last frame. We do not move the edit to fit the generated clip.
- **Keys stay local to the user's tools.** Studio stores no Comfy Cloud token, no Higgsfield CLI session, and no ComfyUI API key. The existing Settings keys for the built-in Generate path are unchanged and are not used by this path.
- **Nothing is vendored.** We do not copy skill packs, workflows or weights into this repo. We link to them and describe the handoff.
- **Licences are noted**, on the brief, in this spec, and in `credits.txt` when a made clip is used: pack licence (all three packs are MIT for their own code), plus weight or partner-model conditions the sidecar reported (in particular the Lightricks LTX-2 Community License, and any FLUX card the agent flagged).
- **Libraries and look.** When we build this in v1.30, the UI stays React, StyleX, Headless UI and Open Props, in the Liquid glass look with AIgent branding, dark and cream.

## 8. How this sits next to the Vault and the current Generate path

The sourcing spec already has generation as the third, optional source, after the Vault and free stock, and already lets a connected agent add a made clip with `add_to_vault`. This spec fills that in:

- The inbox pickup is the path that works with **Copy**, even when no MCP session is live.
- A connected agent may also call `add_to_vault` and `fill_slot`, but it must still write the sidecar so we have provenance and credits. `fill_slot` with `generate` on the *Settings-key* path stays an ask with a price, as today. It is not how this agent path places a clip.
- A made clip always lands in the Vault, whether or not the user clicks Use on the slot, so the next reel can find it.
- We still do not generate as a first choice when the Vault has a real capture of the named thing.

## 9. Out of scope for the v1.30 first cut

- Studio calling ComfyUI, Comfy Cloud or the Higgsfield API itself.
- A settings panel of keys or OAuth for these three backends.
- Running `video-director` to make a whole reel, or generating the talking-head performance.
- Chaining the last frame of slot N into slot N+1.
- Training a Soul ID, a LoRA, or a consistent character library, beyond what a user already has and mentions in the prompt.
- Vendoring or pinning skill-pack commits. The brief should tell the agent to read the live `SKILL.md`.

## 10. Open questions

1. **Auto-pick order, when more than one backend is ready.** We suggest the order in section 4 (Comfy Cloud, then local, then official Higgsfield), with a spend yes on paid runs. The other fair default is to prefer local when it is actually ready, so we do not spend credits the user did not expect. Which do you want?
2. **The Settings-key Generate path.** We suggest we keep it, and treat this agent path as a second door. Or should v1.30 start to steer people with an agent toward this brief, and leave the key path for people with no agent?
3. **Comfy Cloud on Cursor and Codex.** The official plugin is Claude-first today. Is it enough to say that plainly in the setup note, or do you want us to also document a manual skill-file copy for those agents?
4. **Batch generation.** Is "Copy briefs for all empty slots" enough, or do you want a single Generate for every empty slot that the agent may do in one run?
5. **4:5 on Higgsfield, and short slots under a model's minimum duration.** We plan to accept the closest aspect and the model's minimum length, record both, and trim or letterbox in Studio. Sound right?
