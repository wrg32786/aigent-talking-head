# B-roll sourcing: knowing what to show and how to get it

Status: design, not built. 1.28.0 ships the first half (the slots, the "Needs B-roll" card and the instruction for an agent). This is the plan for the second half: filling those slots well, with as little work from the user as we can manage.

## The problem

Will, after a live Recreate: "the harder part is knowing what b roll to use and how to capture it".

Since 1.28.0 we know where B-roll goes. A draft from a reference or a look keeps a list of slots in `build/plan.json` (`broll`): when each one starts and ends on our words, its shape (a framed panel, a full cutaway, a split, a small box), how it moves and how it arrives. What we do not have yet is a good answer to two questions for each slot:

1. What should it show?
2. Where does that picture come from?

Today the answer to both is "the user works it out". The card says what the reference showed and offers Upload. That is honest, but it leaves the real work to the person.

## What we want

For every slot, we offer one good suggestion that is ready to use, say where it came from, and let the user swap, upload, record or skip it. Nothing is placed that the user may not show. Nothing costs money without a yes. Nothing leaves the computer unless the user turned that source on.

## 1. The brief: what a slot should show

Every slot gets a brief. It is a small record, made once per draft and kept in `plan.json` next to the slot.

```
brief: {
  subject:  "the plugin's page on GitHub",       what to show, in one plain line
  why:      "you name it in this line",          the reason, shown to the user
  line:     "First is OmniRoute. It gives ...",  our words under the slot
  named:    ["OmniRoute"],                       tools, sites, apps, people and numbers in the line
  shot:     "screen recording",                  screen recording | product | hands | place | person | graphic
  motion:   "push",                              from the slot's effects
  seconds:  5.5,                                 the slot's length, plus one second of handle
  frame:    "wide 16:9",                         wide for a panel or a split, upright for a full cutaway
  reference: { showed: "OmniRoute", shot: "screen recording", source: "github.com/..." }   Recreate only
  avoid:    ["faces of other people", "logos we have not confirmed"]
}
```

How we make it:

- **The script line comes first.** The words under the slot say what the viewer is thinking about. We pull out the things named in it: tools and apps (from the user's glossary and brands, then a list of common ones), sites, numbers, and plain nouns. A line that names a tool ("then I open ChatGPT") gives a screen recording of that tool. A line with a number gives a counter or a chart. A line about a place or a feeling gives footage.
- **The reference cutaway is the second voice.** The teardown already reads what each cutaway showed (text read in it, a web address, the shot type, the motion, the length). In Recreate with the same topic this is often exactly right. With a different topic it tells us the kind of shot to look for, not the subject. So the brief keeps the two apart: `subject` is ours, `reference.showed` is a hint.
- **The point of the video** (the one line the user writes on Cut) breaks ties. A slot on a line that serves the point gets the stronger suggestion.
- **An agent can write it better.** With a connected agent, the brief is a draft the agent may rewrite (`set_broll_brief`). The rules above are the fallback with no agent and no key.

The brief is what every source below searches with, and what the card shows the user: "Show the plugin's page on GitHub. You name it in this line."

## 2. Sources, in order

We try sources in this order and stop at the first good match. The order goes from "yours and free" to "someone else's or paid".

### a. Your own library

A folder on the user's computer (the B-roll library we already have, plus any folders they add in Settings).

- **Index.** We walk the folders once and keep an index beside them: a few frames per clip, the length, the size, and tags. Today the tags come from the file name and simple colour and motion checks. We add tags from the picture itself with a small local vision model (CLIP, run on the CPU): each clip gets an embedding, and a search is the brief's subject turned into the same kind of vector. No file leaves the computer.
- **Fallback.** Where the model is not installed, the search uses names and tags as it does now. The Setup check offers the model as a one click install, about 350 MB.
- **What counts as a match.** A similarity score over a set bar, the right orientation for the slot's frame, and long enough for the slot. We prefer clips the user has not used in the last few reels.

### b. Screen captures the agent records

For a slot whose shot is a screen recording, the best B-roll is the real thing on screen. Three kinds:

- **A public web page.** We already capture a page to a scrolling video (`npm run capture`, Playwright with the user's Chrome). The brief gives the address when we are sure of it: a URL the user said or typed, one in their glossary, or one read in the reference that the user confirms. We never guess an address and record it without asking.
- **A tool the line names** (for example ChatGPT). Signed in tools cannot be recorded headless, and we should not try. The agent asks the user to record their own screen with the Record my screen button, with a short script of what to do ("open a new chat, type this prompt, wait for the answer"). The recording lands on the slot.
- **A flow the agent can drive.** For public pages with steps (a search, a pricing page, a docs page), the agent writes a short Playwright script: go here, scroll to this, click that. We run it in a fresh browser profile with no cookies, record the window, and show the result for a yes before it is used.

Every capture is trimmed to the slot's length plus a handle, and cropped to the slot's frame.

### c. Stock

Pexels and Pixabay through the provider path we already have, only when the user set a key. Keys stay on the computer. The search uses the brief's subject and shot type, the slot's orientation and a length range. We take the top few results, score them the same way as the library (the model looks at each preview frame), and offer the best one. Stock is weak for software topics, so for a slot whose shot is a screen recording we skip stock unless the user asks.

### d. AI generated clips (optional)

Off by default, as now. When it is on and a key is set, a slot may get a "Generate" offer with the cost shown first. We write the prompt from the brief. Nothing runs without a yes on the page, and an agent can only ask. We do not generate screens of real products or real people.

### e. A shot list to film on a phone

Some slots are best filled by the user: their desk, their hands on the keyboard, the product in their hand. For those the brief becomes a line in a shot list:

```
Shot list for "five plugins" (3 shots, about 4 minutes)
1. Your hands typing on the laptop, from the side. 6 s, upright. Goes on "It writes the tests".
2. The laptop screen with your editor open, over your shoulder. 8 s, wide.
3. You closing the laptop. 4 s, upright. Goes on the last line.
```

The list is on the B-roll step, can be sent to the phone as a link to a plain page on the local network, and each upload from it lands on its slot. Later drafts reuse those clips from the library.

## 3. Ranking and fallback

Each candidate gets one score from 0 to 100:

| Part | Weight | How |
| --- | --- | --- |
| Fits the brief | 50 | picture and text similarity to the subject and the things named |
| Fits the slot | 20 | orientation, long enough, the shot type asked for |
| Yours | 15 | your own clip beats a capture, a capture beats stock, stock beats generated |
| Fresh | 10 | not used in your last reels |
| Clean | 5 | no burned in captions, no watermark, steady enough for the slot's move |

Rules on top of the score:

- Under 55, we do not place it. The slot stays "Needs B-roll" with the best guess shown as a suggestion.
- One source never fills more than half the slots of a reel when another has a match, so a reel is not all stock.
- The same clip is never used twice in one reel.
- If nothing fits, the order of fallbacks is: the shot list (if the slot can be filmed), a made card from the words (a counter, a quote, a list), then skip. A skipped slot keeps the speaker on screen. We never fill a slot just to fill it.

## 4. Studio: what the user sees

The B-roll step stays one card per slot. With sourcing, the card changes from a need to a suggestion:

```
[thumbnail]  Slot 2 at 0:07, 2.9 s
             A capture of the plugin's page on GitHub
             You name it in this line. From a web page we recorded.
             [Use it]  [Swap]  [Upload]  [Record]  [Skip]
```

- **Use it** places the suggestion. Free and local suggestions with a high score are placed for you after a draft, as now, and say "picked".
- **Swap** shows the next three candidates across sources, each with where it came from.
- **Upload** and **Record** are the user's own file and the screen recorder.
- **Skip** leaves the speaker on screen.
- With no suggestion, the card reads "Needs B-roll: ..." as in 1.28.0, with **Copy for my agent** and **Send to my agent**.

Less is more: no source tabs, no scores and no file names on the card. "Choose something else" opens the full picker for people who want it. A capture or a generated clip always shows its first frame before it is used. Liquid glass on dark, cream on light, as the rest of Studio.

## 5. Agent and MCP hooks

The agent is the best B-roll finder we have: it can read the script, think about what a viewer wants to see and drive a browser. New tools, all on the existing Studio channel:

| Tool | What it does |
| --- | --- |
| `list_broll` | (exists) now returns each slot's `brief` and `candidates` |
| `set_broll_brief` | rewrite a slot's brief (subject, shot, why) |
| `find_broll` | run the search for one slot or all, return candidates with scores and sources |
| `capture_broll` | record a public page for a slot: an address the user confirmed, and optional steps (scroll, click, wait). Returns the clip for a yes |
| `request_recording` | ask the user to record their screen or film a shot, with the steps to follow. Shows on the slot card |
| `add_broll`, `fill_slot` | (exist) place a file or a library clip on a slot |

"Send to my agent" on a card sends the brief as a ready instruction, as in 1.28.0. With these tools the agent can answer by filling the slot itself and saying what it did, in plain words.

Rules for agents: confirm an address before recording it. Never record a signed in page. Never ask for a key in chat. A generate is only ever a request.

## 6. Privacy and licensing

- **Local first.** The library index, the vision model and the screen recordings stay on the computer. Stock search sends only the search words to the provider, with the user's own key. We add no new network calls beyond the providers the user turned on.
- **Screen recordings.** We record a fresh browser window with no cookies, never the user's own profile, and never a whole desktop without the browser's own share prompt. Before a capture is used we show it, so a stray notification or a private tab is caught.
- **What you may show.** A capture of a public page is marked "check that you may show it", as now. Brand marks and other people's faces are flagged on the card. We do not place unconfirmed brand imagery for the user.
- **Credits.** Every clip keeps its source, author and license in the library, and each render writes `credits.txt`. Generated clips carry the provider and the prompt.
- **The reference is a guide, not a source.** We never lift pictures from a reference into the user's reel. The teardown reads what a cutaway showed so we can describe it, nothing more.

## 7. Phased plan

| Phase | What ships | Depends on |
| --- | --- | --- |
| 0 (1.28.0, done) | Slots in the plan, effects from the reference, the "Needs B-roll" card, Upload, stock with a key, the instruction for an agent, Skip | |
| 1 | The brief per slot (rules, then an agent's rewrite). The card shows "Show X, because Y". `list_broll` returns it | |
| 2 | Library index with picture tags (local vision model, optional install), ranking, auto place over the bar, Swap | Phase 1 |
| 3 | Captures: confirmed public pages with steps, `capture_broll`, the recorder with a script (`request_recording`) | Phase 1 |
| 4 | The shot list and phone upload page | Phase 1 |
| 5 | Stock ranked with the same model; generated clips from the brief (still opt in and asked every time) | Phase 2 |

Each phase is useful on its own. Phase 1 is small and makes the 1.28.0 card much better. Phase 3 is the one that answers Will's question for software topics, where the right B-roll is nearly always a screen.

## Open questions

- Which local vision model: the size we can ask people to download, and how it runs on a Windows laptop with no GPU.
- How we tell that a named tool needs a sign in before we offer to capture it.
- Whether a capture script the agent writes should be saved with the reel, so a later draft can record it again when the page changes.
- How much of a reference's cutaway description we can trust without the optional descriptions pass (`--vlm`).
