# Effects catalog

51 starter effects from [claude-video-effects](https://github.com/Vibha-Ramprakash/claude-video-effects) by Vibha Ramprakash (MIT), applied as an optional second pass over a finished reel. Generated from `catalog.json` by `npm run effects:catalog`; edit the JSON, not this file.

**How to read it**

- **Moments**: where in the script it fits. `hook` First 2 s. Stop the scroll. `claim` The key promise or bold statement. `list` Steps, features, a numbered list. `reveal` The turn: "here is the thing", the answer. `proof` A number, a result, social proof. `objection` "But..."/"No...", myth-busting, what not to do. `cta` The ask at the end: comment, follow, link. `transition` Between sections or at a seam.
- **Energy**: `calm` (grades, slow moves, quiet panels), `medium` (pops, cards, words), `high` (punch-ins, stamps, glitches, busy card storms).
- **Needs**: `face` = placed relative to the face (needs a face in frame), `segmentation` = hides behind you, `word-cue` = should land on a spoken word, `text` / `numbers` / `images` = you supply copy, real numbers or a folder of pictures.
- **Captions**: `safe` = keep captions on; `check` = read a check frame (`--still`); `off` = captions are hidden for that window automatically (add `"captions": "on"` to the plan entry to keep them).
- **Required** options must be in the plan; the defaults are the upstream author's demo copy. `name`/`handle` come from the plan's `profile`.

**Pacing rules**: 3 to 6 effects per reel, a hook effect in the first 2 s, a CTA effect at the end, and no more than one `high` effect every 5 s. Camera effects (marked 🎥) go first in the plan when windows overlap.

## By moment

- **hook** (First 2 s. Stop the scroll.) calm: - · medium: `locked-on`, `backdrop-word`, `spotlight`, `countdown-flip`, `cover-star`, `scribble`, `glass-widgets`, `split-headline`, `pastel-word`, `headline-box`, `phone-fan`, `dot-reveal`, `led-sign`, `crayon-write` · high: `noise`, `orbit`, `red-collage`, `carousel-spin`
- **claim** (The key promise or bold statement.) calm: `slow-push` · medium: `locked-on`, `backdrop-word`, `split-headline`, `headline-box`, `tier-list`, `tape-label`, `crayon-write` · high: `lean-in`, `red-collage`, `match-cut`
- **list** (Steps, features, a numbered list.) calm: `todo`, `checklist`, `apple-toggles` · medium: `lineup`, `the-bill`, `shortcut-rain`, `check-pills` · high: -
- **reveal** (The turn: "here is the thing", the answer.) calm: - · medium: `backdrop-word`, `spotlight`, `swipe`, `pause-point`, `countdown-flip`, `scribble`, `dot-reveal`, `led-sign`, `select-resize` · high: `lean-in`, `reject-stamp`, `rabbit-hole`, `match-cut`, `huge-strike`
- **proof** (A number, a result, social proof.) calm: `timeline`, `checklist`, `wave-trim` · medium: `the-bill`, `swipe`, `reel-frame`, `shortcut-rain`, `cover-star`, `glass-widgets`, `check-pills`, `profile-wall`, `tier-list`, `broll-split`, `phone-fan`, `liquid-glass-graph`, `messages`, `select-resize`, `fan-build` · high: `noise`, `orbit`, `headline-wall`, `carousel-spin`, `match-cut`, `over-the-shoulder-zoom`, `place-in-grid`
- **objection** ("But..."/"No...", myth-busting, what not to do.) calm: `moody`, `slow-push` · medium: `pause-point`, `messages` · high: `lean-in`, `uninstall`, `reject-stamp`, `huge-strike`
- **cta** (The ask at the end: comment, follow, link.) calm: `apple-toggles`, `slow-push` · medium: `spotlight`, `comment-box`, `tap`, `countdown-flip`, `pastel-word`, `led-sign`, `messages`, `tape-label` · high: `place-in-grid`
- **transition** (Between sections or at a seam.) calm: `moody`, `timeline`, `slow-push`, `wave-trim` · medium: `reel-frame`, `broll-split`, `dot-reveal` · high: `uninstall`, `rabbit-hole`

## Effects menu presets

- **Calm explainer** (teaching, walkthroughs, measured tone; 3-4 effects, all calm or medium): hook → `dot-reveal` or `backdrop-word`, list → `todo` or `apple-toggles`, claim → `slow-push`, cta → `led-sign`
- **Punchy hook** (hot takes, myth-busting, fast talkers; 4-6 effects, high energy spaced 5 s apart): hook → `lean-in` or `backdrop-word`, objection → `reject-stamp` or `huge-strike`, reveal → `match-cut`, cta → `countdown-flip` or `comment-box`
- **Product demo** (showing a tool, a result or numbers; 3-5 effects, proof-heavy): hook → `locked-on`, list → `checklist` or `the-bill`, proof → `liquid-glass-graph` or `over-the-shoulder-zoom`, cta → `tap`
- **Social proof** (results, testimonials, creator stats; 3-4 effects): hook → `cover-star` or `orbit`, proof → `headline-wall` or `profile-wall` or `messages`, cta → `pastel-word` or `tap`
- **Cinematic minimal** (serious or emotional pieces; 3 effects, no high energy): hook → `spotlight`, claim → `slow-push`, transition → `moody` or `timeline`

## All effects

| # | Effect | What it does | Moments | Energy | Needs | Duration | Captions | Pairs well with | Avoid with |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `noise` | Your reels (or frames from this clip) pile up behind your head, one every quarter second. | hook, proof | high | segmentation, images | 2-4 s | **check**: Cards land anywhere behind you, including behind the caption band; read a check frame for legibility. | backdrop-word, lean-in | other card effects (orbit, carousel-spin, fan-build) |
| 2 | `lineup` | Numbered tiles fan out in an arc above your head. | list | medium | face, segmentation, text | 2.5-4 s | **safe**: Sits above the head. | todo, countdown-flip | the-bill (same zone) |
| 3 | `locked-on` 🎥 | Corner brackets snap onto your face and the camera follows you, with a tag pill under the face. | hook, claim | medium | face, segmentation | 1.5-3.5 s | **safe**: Camera move; captions are added after, so they never zoom. | backdrop-word, scribble | other camera effects in the same window |
| 4 | `orbit` | Your reels circle your head: in front at the bottom, behind you at the top. | proof, hook | high | face, segmentation, images | 2.5-4 s | **check**: The front of the ring passes around chest height; check frames against the caption band. | spotlight, slow-push | carousel-spin, fan-build, noise |
| 5 | `lean-in` 🎥 | A fast punch-in on one word. | claim, reveal, objection | high | face, word-cue | 0.6-1.5 s | **safe**: Camera move only. | reject-stamp, huge-strike, backdrop-word | slow-push or other camera effects in the same window |
| 6 | `backdrop-word` | A giant word drops in behind you. | hook, claim, reveal | medium | face, segmentation, text | 1.5-3 s | **safe**: Behind the head, above the caption band. | lean-in, locked-on | other behind-head words (huge-strike, crayon-write, match-cut, led-sign) |
| 7 | `spotlight` 🎥 | Kills the lights and keeps you lit, with an optional glowing word behind you. look=sparkle (alias glitter-spotlight) adds golden rays and sparkles. | reveal, hook, cta | medium | face, segmentation | 2-4 s | **safe**: Darkens the room; captions stay bright on top. | backdrop-word, orbit | moody, timeline or other grades in the same window |
| 8 | `the-bill` | Prints your instructions like a receipt into the wall above your head. | list, proof | medium | face, segmentation, text | 2.5-4.5 s | **safe**: Top of frame. | checklist (later), lean-in | lineup, todo (same zone) |
| 9 | `moody` | A colour grade: darker, softer, teal shadows. grade= moody, bw, warm, cool or pop. | transition, objection | calm | nothing (no face needed) | 2-10 s | **safe**: Grade only. Works with no face in frame. | slow-push, huge-strike | other grades (spotlight, timeline, red-collage) |
| 10 | `swipe` | A before-and-after slider sweeps across you, with a pill label near the bottom. | reveal, proof | medium | nothing (no face needed) | 1.5-3 s | **check**: Pill sits at 88% height, below captions; check it doesn't crowd a two-line caption. | moody (before) | other grades |
| 11 | `todo` | A checklist card beside your head that ticks off as you talk. | list | calm | face, segmentation, text, word-cue | 3-6 s | **safe**: Sits beside and above the head. | lineup, slow-push | checklist, apple-toggles (same job) |
| 12 | `comment-box` | An Instagram comments sheet above your head types your word, posts it, gets a heart and your reply. look=bar for the old bottom bar. | cta | medium | face, segmentation, text | 2.5-4 s | **check**: The default sheet is above the head and safe; look=bar sits at 80% height and needs captions off. | tap | messages (same idea) |
| 13 | `tap` | A Follow button pops up and flips to Following. | cta | medium | face | 1.5-2.5 s | **check**: Default spot is just under the face, near the top of the caption band; set y=0.45 or turn captions off. | comment-box | another CTA sticker in the same window |
| 14 | `pause-point` 🎥 | Freezes the frame and points at you with a hand-drawn arrow and label. | reveal, objection | medium | face, segmentation, text | 1.5-3 s | **check**: The picture freezes while captions keep moving; keep the window to one short phrase. | scribble | camera effects in the same window |
| 15 | `uninstall` | A glitchy uninstall bar breaks the frame apart. | objection, transition | high | text | 1.5-3 s | **safe**: Bar at 16% height; works with no face. | reject-stamp, huge-strike | other glitchy effects within 5 s |
| 16 | `reel-frame` | Your video shrinks into an Instagram reel card. | proof, transition | medium | face, segmentation, text | 2-3.5 s | **off**: Captions would float over the card edge; hide them for this window. | place-in-grid (instead) | camera effects |
| 17 | `shortcut-rain` | Keyboard keys rain down behind you. | list, proof | medium | segmentation, text | 2-4 s | **safe**: Behind you; captions stay on top. | backdrop-word | noise (two busy backgrounds) |
| 18 | `reject-stamp` | A big red stamp slams onto the screen. | objection, reveal | high | face, text, word-cue | 1-2 s | **off**: Lands over the chest by default, on top of the caption band; hide captions or set y=0.3. | lean-in, uninstall | huge-strike in the same moment |
| 19 | `countdown-flip` | A 3, 2, 1 flip clock above your head. | hook, cta, reveal | medium | face, segmentation | 2.5-3.5 s | **safe**: Above the head. | lean-in (on 1) | lineup, the-bill (same zone) |
| 20 | `rabbit-hole` | The room tunnels into itself, spinning, while you stay in front. | transition, reveal | high | face, segmentation | 1.5-3 s | **safe**: Background only. | slow-push | another high-energy effect within 5 s |
| 21 | `cover-star` | You become a magazine cover, with the title behind your head and cover lines down the side. look=editorial for a classic warm cover. | hook, proof | medium | segmentation, text | 2.5-4.5 s | **off**: Cover lines start at 50% height and run through the caption band. | slow-push | red-collage, split-headline (other layouts) |
| 22 | `scribble` | Marker doodles draw themselves around you, with a label and arrow. | hook, reveal | medium | face, text | 2-3.5 s | **safe**: Doodles stay near the head. | locked-on, pause-point | crayon-write (same hand-drawn look) |
| 23 | `glass-widgets` | Frosted glass widgets and mini artifacts (stats, profile, calendar, render bar) float around your head, with an "Edited by" pill near the bottom. look=simple for 3 widgets. | proof, hook | medium | face, segmentation, text | 3-5 s | **check**: The pill sits at 87% height below captions; widgets can reach chest height. Read a check frame. | slow-push | liquid-glass-graph, apple-toggles (more glass) |
| 24 | `red-collage` | Black-and-white you, a giant red word behind, three lines slam in beside you. | hook, claim | high | face, segmentation, text | 2-3.5 s | **off**: The kinetic lines run through the caption band. | lean-in | other grades and layouts |
| 25 | `split-headline` | A headline card slides down and pushes you into the bottom of the frame. | hook, claim | medium | face, segmentation, text | 2.5-4 s | **check**: You move down, so the caption band ends up over your face; set captionY lower or hide captions. | lean-in (after) | broll-split, cover-star |
| 26 | `pastel-word` | A soft lavender room, a giant word behind you and a profile card that gets followed. | cta, hook | medium | face, segmentation, text | 2.5-4 s | **check**: The profile card sits below the caption band; check a two-line caption. | tap | other room swaps |
| 27 | `check-pills` | Grid-paper room, reel boards pinned behind you and blue pills that a cursor clicks. | list, proof | medium | face, segmentation, text, images | 3-5 s | **check**: Pills land between 30% and 90% height; check frames. | slow-push | other room swaps |
| 28 | `timeline` | A dark red cinematic grade with an editing timeline, a REC timecode and a glowing playhead. | transition, proof | calm | segmentation, text | 3-6 s | **check**: Read a check frame: the timeline panel can sit near the caption band. | slow-push | other grades |
| 29 | `headline-box` 🎥 | A punch-in with a two-line headline above your head, the second line in a white box. | hook, claim | medium | face, segmentation, text | 2-4 s | **safe**: Headline sits above the head; captions stay put. | backdrop-word (later) | phone-fan (same headline style) |
| 30 | `profile-wall` | Your reels grid fills the wall behind you while a view counter ticks up below your face. | proof | medium | face, segmentation, images, numbers | 2.5-4 s | **off**: The counter card lands at chest height, in the caption band. | slow-push | headline-wall (same proof job) |
| 31 | `tier-list` | A tier list drops in front of you and an item flies into S tier. | proof, claim | medium | face, segmentation, text | 3-4.5 s | **off**: The board covers mid-frame and the caption band. | lean-in (after) | other boards |
| 32 | `broll-split` | Split screen: b-roll on top with a price-tag sticker, you on the bottom. | proof, transition | medium | face, segmentation, images, text | 2-4 s | **check**: You move to the bottom, so the caption band may sit on your face; hide captions or check frames. | tap | split-headline |
| 33 | `phone-fan` | Your reels fan out like a hand of phones under a two-line headline. | proof, hook | medium | face, text, images | 2.5-4 s | **off**: The phones fill the bottom of the frame, over the caption band. | slow-push | headline-box (same headline) |
| 34 | `dot-reveal` | Your shot builds itself out of glowing dots, then snaps into the full picture. | hook, transition, reveal | medium | nothing (no face needed) | 1-2.5 s | **safe**: Works with no face. Best as the very first effect. | locked-on (after) | camera effects in the same window |
| 35 | `headline-wall` | Your own headlines pile up behind your head, then a total pops in front. | proof | high | face, segmentation, text, numbers | 3-5 s | **check**: The total pill lands at 60% or lower; read a check frame. | lean-in (on the total) | profile-wall |
| 36 | `checklist` | A task list builds under your chin: each step spins, then ticks green. | list, proof | calm | face, text | 3-6 s | **off**: The card sits under the chin, on the caption band. | slow-push | todo, apple-toggles |
| 37 | `liquid-glass-graph` | A liquid glass card floats under your chin while a graph climbs and the number counts up. look=bento moves it to a smoked glass screen behind your head with tiles in front. | proof | medium | face, segmentation, text, numbers | 2.5-4 s | **off**: The card sits under the chin, on the caption band. | lean-in (on the number) | over-the-shoulder-zoom (same graph) |
| 38 | `carousel-spin` | Your reels spin around you in a 3D carousel, then slow to a stop. | proof, hook | high | face, segmentation, images | 3-5 s | **check**: Front cards pass through chest height; check frames. | spotlight | orbit, fan-build, noise |
| 39 | `match-cut` 🎥 | News pages cut on one word, locked in a red box behind your head. | claim, proof, reveal | high | face, segmentation, text, word-cue | 2-3.5 s | **safe**: Behind the head. | lean-in | other behind-head words |
| 40 | `apple-toggles` 🎥 | An iPhone settings card flips its switches on, one line at a time. Default sits above you tucked behind your head with a gentle zoom; pos=below puts it under the chin. | list, cta | calm | face, segmentation, text, word-cue | 3-5 s | **safe**: Default above-head card is safe. With pos=below, hide captions. | slow-push | todo, checklist |
| 41 | `led-sign` 🎥 | The lights drop and a glowing LED sign types itself out behind you. | hook, cta, reveal | medium | face, segmentation, text | 2.5-4 s | **safe**: Behind the head; darkens the room. | spotlight (instead, not with) | other behind-head words, grades |
| 42 | `slow-push` 🎥 | A slow cinematic push-in to your face while the room melts out of focus. | claim, objection, cta, transition | calm | face, segmentation | 3-8 s | **safe**: Camera move; captions stay sharp on top. | todo, checklist, moody | other camera effects in the same window |
| 43 | `over-the-shoulder-zoom` 🎥 | The camera pushes into one top corner and a liquid glass graph pops beside your head, pulls back, then the other corner with a second graph. | proof | high | face, segmentation, text, numbers | 4-6 s | **safe**: Graphs sit at 25% height. | slow-push (before) | liquid-glass-graph |
| 44 | `messages` | iMessage notifications pop in one after another, stacking up just above 61% height. | proof, objection, cta | medium | text | 2.5-4 s | **check**: The stack ends just above the caption band; with long captions set y=0.55 or hide captions. | tap | comment-box |
| 45 | `place-in-grid` | You shrink into the centre tile of your 3x3 profile grid, then 8 reels pop in around you with view counts. | proof, cta | high | images, numbers | 2-3.5 s | **off**: Captions would float over the grid. | tap (after) | reel-frame |
| 46 | `tape-label` | A level strip of yellow tape with your line lands on your chest. | claim, cta | medium | face, text | 1.5-3 s | **off**: It is a caption-style label on the caption band; hide captions for this window. | lean-in | stickers or hero captions at the same time |
| 47 | `select-resize` | A blue selection box grabs your number above your head and a cursor drags it bigger. | proof, reveal | medium | face, segmentation, text, numbers | 2-3.5 s | **safe**: Above the head. | lean-in | other above-head words |
| 48 | `wave-trim` | A dark panel above your head shows your voice; the silent ends collapse until only your words are left. | proof, transition | calm | face, segmentation | 2.5-4 s | **safe**: Above the head. Works on any speech. | slow-push | other above-head panels |
| 49 | `huge-strike` | One huge serif word wipes in behind your head, then a red line crosses it out. | objection, reveal | high | face, segmentation, text, word-cue | 1.5-3 s | **safe**: Behind the head. | lean-in, moody | other behind-head words |
| 50 | `crayon-write` | A red crayon writes your word behind your head, then underlines it and flies off. | claim, hook | medium | face, segmentation, text | 1.5-3 s | **safe**: Behind the head. | slow-push | scribble, other behind-head words |
| 51 | `fan-build` | Your reel covers deal into a fan behind your head, one card at a time. | proof | medium | face, segmentation, images | 2.5-4 s | **safe**: Behind and above the head. | slow-push | orbit, carousel-spin, noise |

## Options

Pass options as keys on the plan entry (`{"fx": "backdrop-word", "start": 3.2, "end": 5, "text": "FREE"}`). Required ones are in bold.

- `noise`: images (folder of screenshots or clips (defaults to 10 frames from this video)), size (card size, default 0.34)
- `lineup`: **text** (tile names joined with |)
- `locked-on`: text (tag, default LOCKED ON), zoom (default 1.35)
- `orbit`: images (folder of covers (defaults to frames from this clip)), count (default 6), speed (default 1.9), size (default 0.2)
- `lean-in`: zoom (default 1.45, max 2), speed (default 0.18 s)
- `backdrop-word`: **text** (the word), color (hex), font (bold or serif)
- `spotlight`: text (glowing word behind you (optional)), color (hex), push (slow push, default 1.1), look (sparkle for glitter-spotlight)
- `the-bill`: **text** (lines joined with |)
- `moody`: grade (moody, bw, warm, cool, pop)
- `swipe`: grade (the "after" look)
- `todo`: **text** (items joined with |), ticks (video seconds of each tick, joined with |), title (default TO DO)
- `comment-box`: **text** (the comment word), **handle** (your handle (injected from the plan profile)), reply (reply line), chip (reply link chip), look (bar for the bottom comment bar)
- `tap`: at (video second of the flip), x (0-1), y (0-1), color (hex)
- `pause-point`: text (label, default "look here"), color (hex), label_x (0-1)
- `uninstall`: **text** (bar label, default Uninstalling...)
- `reel-frame`: **text** (handle shown on the card)
- `shortcut-rain`: text (keys joined with |), count (default 26)
- `reject-stamp`: **text** (stamp word, default REJECTED), color (hex), angle (default 12), y (0-1)
- `countdown-flip`: from (default 3)
- `rabbit-hole`: ratio (default 0.62), speed (default 0.8), spin (default 10)
- `cover-star`: **text** (masthead), **lines** (cover lines joined with |), issue (issue line), color (hex), accent (hex), look (editorial)
- `scribble`: text (label, default "me!"), color (hex)
- `glass-widgets`: text (big number), **name** (profile name (injected from the plan profile)), **handle** (handle (injected)), pill ("Edited by |Claude" by default (text|bold part)), look (simple), grade (warm (default) or none)
- `red-collage`: **text** (red word), **lines** (three lines joined with |), tag (small REC tag), color (hex)
- `split-headline`: **text** (lines joined with |), hl (highlighted word), pill (pill text), height (card height, default 0.36)
- `pastel-word`: **text** (the word), **name** (profile name (injected)), **handle** (handle (injected)), role (card subtitle)
- `check-pills`: **text** (pills joined with |), **handle** (board handle (injected)), board (board label), images (folder of covers)
- `timeline`: text (title), sub (subtitle (default "timeline by Claude")), tc (timecode)
- `headline-box`: **text** (two lines joined with |), zoom (default 1.2)
- `profile-wall`: images (folder of covers), count (the number, e.g. 197000), label (default views), **name** (profile name (injected)), sub (sub line)
- `tier-list`: **title** (question title), **item** (item that lands in S tier (default Claude)), others (other items joined with |)
- `broll-split`: **images** (folder with the b-roll image or clip), text (price tag), pick (which file, default 0)
- `phone-fan`: images (folder of covers), **text** (two lines joined with |)
- `dot-reveal`: color (hex), cell (dot size, default 0.017), bg (hex)
- `headline-wall`: **text** (headline::meta joined with |), **total** (the total, e.g. 672K), label (label under the total), **handle** (handle on each card (injected))
- `checklist`: **text** (step::meta joined with |), **title** (card title (default "Claude is editing your clip"))
- `liquid-glass-graph`: **text** (label), from (start number), **to** (end number, e.g. 197K or 59%), color (hex), look (bento), donut (29%::label), kpi (672K::label), bars (197|140|124::label)
- `carousel-spin`: images (folder of covers), count (6-12), size (default 0.3), turns (default 1.1)
- `match-cut`: **text** (the word (default Claude)), color (hex)
- `apple-toggles`: **text** (rows joined with |), ticks (seconds of each flip, joined with |), color (hex), pos (above (default) or below), zoom (default 1.12)
- `led-sign`: **text** (lines joined with |), color (hex), push (default 1.08)
- `slow-push`: zoom (default 1.6), blur (default 0.006)
- `over-the-shoulder-zoom`: **text** (two labels joined with |), **to** (two numbers joined with |, e.g. 197K|672K), zoom (default 2.0)
- `messages`: **text** (messages joined with |), title (default Messages), y (bottom of the stack, default 0.61)
- `place-in-grid`: images (folder of covers), **views** (9 counts joined with |, the 9th is yours)
- `tape-label`: **text** (the line)
- `select-resize`: **text** (the number, default 2X)
- `wave-trim`: no options
- `huge-strike`: **text** (the word), at (seconds into the effect when the strike lands, default 0.6)
- `crayon-write`: **text** (the word)
- `fan-build`: images (folder of covers), count (default 13)
