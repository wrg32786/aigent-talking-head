# Studio

Studio is a local web page over the kit. Drop in your footage, add a reference reel if you have one, click the effects you want from a visual menu, set the music and pace, then draft, review and render. It runs on your computer, needs no account and no cloud, and drives the same engine as the CLI and the MCP server.

```
npm run studio
```

That starts Studio on http://127.0.0.1:4757 and opens your browser. `--port <n>` picks another port, `--no-open` skips the browser. Never used a terminal? Run the one-line installer in [Setup](#setup-without-a-terminal) and double-click the "Talking Head Studio" icon it puts on your desktop.

![Studio on a laptop in dark: the six step dots with Cut open, Your edit across the top, the Pieces sorted by what each line does, Ask my agent next to Look, and the chat with Claude Code](studio/desktop.png)

![The same Cut step in the light theme](studio/light.png)

Six steps across the top: Footage, Cut, Look, B-roll, Finish, Post. Each one is its own screen with Back and Next at the bottom, and a step shows a check when it is done. **Look** has two views, **Your look** (packs, effects, sound and pace) and **Reference**. Old links still land: `#step=style` and `#step=reference` open Look, `#step=render` opens Finish.

**Your edit.** One quiet line above every step says what you are making (one reel, clips, plain clips; the aspect), from what (your N pieces in your order, or the whole take), the look, the b-roll spots and the sound, and offers the next action (Draft it, Render). Click a part to open its step. When you change your pieces after a draft it says so. Agents read the same thing with `get_edit` (`GET /api/edit`). The chat sits on the right (behind the chat button on a phone). Dark is the default; switch to light with the sun button or in Settings.

![Studio in the light theme, the AIgent cream with deep teal: the Style step](studio/light.png)

## What you can do

1. **Footage.** Drag clips onto the page or pick files (mp4, mov, m4v, webm, mkv), or paste a public Dropbox or Google Drive share link or a plain video URL (see [Footage from a link](#footage-from-a-link)). They go to `inbox/studio/<job>/`. An assistant can also point the session at a clips folder (`clips` in `studio_set_selections`, refused when it has no clips.json), reorder or drop files (`footage`: the paths from the session in the order to use; an unknown or repeated file is refused), and mark the files as already cut (`asIs`: each file is one clip, in order, never re-cut). Several different files keep the order you gave them; best-take picking only runs when the files are takes of the same lines. Or film it now with **Record now** (see [Record now](#record-now)).
2. **Reference.** Paste one or more links (Enter adds them, Shift+Enter starts another line) or upload a file. Links can be YouTube (and Shorts), TikTok, X, Vimeo, a direct video file (.mp4, .mov, .m4v, .webm), or one public Instagram post. Studio downloads each into your download folder, breaks it down, and shows what it found: length, cut times and pace, music BPM, beats and energy, caption style, titles, transitions, finishes, graphics and effects, plus suggestions mapped to the effects menu that you can click to pick. The chat gets the same teardown. See [Reference links](#reference-links). Then choose:
   - **Influence:** the reference becomes soft defaults on top of the pack you picked (the pack's locks stay). Saved as a local pack, `ref-<job>`.
   - **Recreate:** the draft uses the reference's Reel.md as the recipe (`--recipe --recut`). Your kept pieces (or your one take) are re-cut to the reference's shot plan, scaled to your length, every cut on a word boundary in the quiet between words, and each shot gets the reference's framing as a punch in or out. Its sound effects play at its times (scaled), a quiet music stem means no bed, the boxes and stickers it drew become graphics slots, and your titles take the style of the reference title doing the same job (hook, number, timer, brand).
3. **Look.** One Look sets every layer; change any layer and a badge says where each choice came from. See [Look and its 9 layers](#look-and-its-9-layers).
   - **Looks.** One row: the built-in packs and the Looks you saved. **Save as a new Look** writes `packs/local/<name>/pack.json` (validated, gitignored) so you can reuse it with `--pack <name>`; with a reference in use, its look is saved too.
   - **The reference card**, when a reference is broken down: **Use all** (recreate), **Use parts** (influence, soft defaults), **Off**, **Save as a Look** and **Clear reference**.
   - **The reference sets your Look.** Pick **Use all** (Recreate) and we set every layer from the reference: its Look, captions, titles, transitions, grade, effects, music, beat sync and pace. **Use parts** (Influence) sets the same picks as soft defaults and keeps your Look and sound. A short line says so, each choice it set is badged **REF** (From reference) and its layers get an amber dot. Change anything you like; your change is yours. **Back to my look** (the same as Off) takes out only what the reference set and gives back your own caption style, Look and music. A reference that is still being read says so and sets the Look when it is ready.
   - **Influence takes the parts you switch on.** On **Use parts** the reference card shows one switch per part: captions, titles, transitions, grade, effects, graphics, pace, music and sound, fonts and theme. Pace and sound start off, so they stay yours. Turn one off and its picks come out of your Look; turn it on and they come back (`reference.parts`).
   - **What we read.** The Breakdown lists which parts of the reference were read (the full read, speech, layers and grade, the contact sheet, sound effects, music). For any that did not run it names what reads it, with Install and Copy for my agent buttons, then Read it again.
   - **B-roll at its cutaways.** A Recreate draft puts B-roll spots where the reference cuts away from the speaker, on your edit's own clock. Suggest tries your library first (the best match on a clip's name and tags), and on a tip about a tool or a screen it suggests a screen recording before stock.
   - **Layers.** Every effect the engine has, as looping previews, in 9 layers. Click a tile to pick it; press F, right-click it, or use its forbid button to forbid it. Hover or focus a tile for its description. Search looks across every layer. Music, sound effects and pace sit in the Music and SFX layer.
4. **B-roll.** One slot per beat of the draft: fill it from your library, an upload, stock, a card, a screen recording or a generate, and pick full cutaway, split top panel, picture in picture or framed cards. See [B-roll](#b-roll).
5. **Chat.** Type "calm and cinematic, no glitch, typewriter titles". See [Chat](#chat).
6. **Render.** Draft runs `npm run reel ... --draft` and shows the choices table: every transition, finish, title and graphic per beat, with why it was picked. Change any cell and apply; the change is pinned. Render builds the reel (and the export size you picked) with progress, then plays it with a download link.

![The Look step: the built-in Looks as previews of your face, Save as a new Look, and the Layers panel on Text with caption previews](studio/look-layers.png)

![The same Look step in the light theme](studio/look-layers-light.png)

## Look and its 9 layers

![The Look step: a row of Looks, the Hormozi hook reference card with Use all, Use parts and Off, and the Graphics layer with a REF badge on lower-third](studio/look-layers.png)

The Look step used to show 17 tabs where 58 options sat in two or three. It now shows 9 layers, and every option lives in exactly one (`layers` in `kit/studio/categories.json`, computed by `layersOf` in `kit/studio/core.mjs`):

| Layer | What is in it |
| --- | --- |
| Text | captions (styles, entrances, caption looks), titles and kinetic words (split-flap, keyword caption, LED sign, backdrop word...), the title layer behind your head |
| Fonts | the font pairs |
| Graphics | lower thirds and name tags, stickers and callouts, data and info cards, intros, chapters and CTAs |
| Transitions | all the seams, the glitch, blur, pixelate, warp, zoom blur and light leak ones too |
| Color and finish | grades and themes, grain, vignette, scan lines, noise, chroma and the glitches that are not seams |
| Motion | camera moves and zoom punch, speed and time, you and the room (spotlight, slow push, orbit) |
| Music and SFX | beds, energy, sound effects, the sound cap, beat sync and pace, with the music panel |
| B-roll | how b-roll sits: split, match cut, phone fan, carousel, screen card |
| Layout | frames, split screens and grids around you |

`layerOrder` says which layer claims an option first when two tabs share it, `owners` moves one to a named layer, and `hidden` drops a second name for the same thing (`oneword`, which is `one-word`). `tests/studio-look.test.mjs` (in `npm run check`) fails when an option lands in no layer or in two.

**Badges.** A tile says where its choice came from: **YOU** (your pick), **REF** (the reference suggests it, or Use parts added it) or **LOOK** (the Look sets it).

**Clear reference** takes the reference off and every pick Use parts added with it, and puts back the Look or bed it changed. Your own picks stay. It is one undo: **Undo** under the Looks row puts it all back (`POST /api/reference/clear`, `{ undo: true }`; `clear_reference` for your agent). Nothing on disk is deleted: the reference stays in the Reference list.

**Save as a Look** on the reference card saves the reference's look as a Look of its own, beside the built-in ones (`POST /api/pack/save { fromReference }`; `save_look`). Save as a new Look keeps the reference's look too when one is in use.

### Settings that rule out others (1.20.0)

Some picks only work with others. One file, `kit/studio/conflicts.mjs`, holds the rules for the page, the server, the render and your agent:

| You picked | What it rules out | One click switches to |
| --- | --- | --- |
| A caption style other than Kinetic (Single word, Oneword, Pill, Hormozi, Karaoke, Classic), yourself or through a Look, pack or reference | Caption entrances (they only move Kinetic captions) | Kinetic captions |
| The Classic look, or a Look with no titles (minimal-clean) | Title entrances and the title layer | Titles on, your captions kept |
| No music | Beat sync, and Energy | Auto music |
| Sound effects off | Sound map and Sparse sounds | Sound effects on |
| Keep pauses | Tighten pauses | Pace from the Look |
| Zoom punch off | Punch-in | Zoom punch on |
| A Look | Your earlier caption style (the Look brings its own) | |

A ruled out option is greyed with a short reason, and clicking it makes the switch. A pick that turns something off says so in one line with Undo. The draft never sends a ruled out pick to the reel. Effects, and titles behind your head, say "needs setup" until the effects pass is set up. For agents, `studio_set_selections` refuses a ruled out pick with the reason, and takes `switchFor` and `undoChange`.

<img src="studio/look-conflicts.jpg" width="560" alt="Single word captions turned off the Typewriter caption entrance, with Undo; the caption entrances greyed with Not with Single word captions">

## Words and brands

In Look (Your look), **Words and brands** has two lists:

- **Your words.** One per line, the way Whisper writes it, then `=`, then how you write it: `Agent Academy = AIgent Academy`, `chat GBT | chat GPT = ChatGPT`, `school = Skool after on, in` (only after those words). The draft fixes them in captions, titles and the clip list, and keeps their own capitals even in an all-caps caption style. AIgent Academy, Skool, claude.ai, ChatGPT and Claude Code are built in (`kit/glossary.json`, the aigent pack). The same text works as `npm run reel -- --glossary "..."`, a pack's `style.glossary`, or `glossary` in `studio_set_selections`.
- **Logos when you say a word.** Type the word, click **Add its logo** and pick an svg, png, webp or jpg. When the word is said, its logo shows on a small white plate for about a second, at most one every 4 s, never over a title or graphic. The marks are kept in `jobs/.studio/brands/`. **Use the kit's Skool mark** adds `kit/example/skool-logo.svg`. Studio never downloads a logo; use only marks you have the right to use. CLI: `--brands '[{"word":"Skool","logo":"path/to/mark.svg"}]'` or a JSON file.

A patch that changes nothing (the setting was already that way) returns `noChange` to the agent and shows "Studio: that change did nothing" in the chat, so an agent never reports a change that did not happen.

## Menu categories

The categories come from `kit/studio/categories.json`, which maps the engine's own catalogs (transitions, title and caption entrances, caption styles, graphics, effects, finishes, looks, themes, fonts, beds, sounds and editing options) into tabs. It only regroups; it never adds an effect the engine does not have, and `tests/studio.test.mjs` fails if it names one. An item can sit in more than one tab. Empty categories are hidden in the page.

| Category | Items | What is in it |
| --- | ---: | --- |
| Transitions | 56 | all 56 seams (50 stock, 6 drawn) |
| Kinetic text and title entrances | 42 | 9 title entrances, the font pairings, title placement (left, right, above, chest, face), text graphics and effects |
| Captions | 22 | caption entrances, 7 caption styles, 5 looks |
| Motion graphics | 30 | every graphic in `kit/graphics.json` |
| Lower thirds and name tags | 7 | lower third, news strap, logo bug, channel bug, ticker, app label, tape label |
| Stickers, emoji and callouts | 11 | sticker pop, ordinal sticker, highlight, icon badge, HUD callout, price tag, release pill, stamps and scribbles |
| Data and info graphics | 18 | 9 data graphics (chart, stat callout, checklist, step counter, split flap and more) and 9 data effects |
| Camera effects | 11 | the effects marked camera in `effects/catalog.json` (slow push, lean in, locked on, over-the-shoulder zoom and more) plus punch-ins |
| Speed and time | 3 | tighten, pause point, wave trim |
| Person and background | 16 | title layers (front, behind the head, auto) and effects that use the person mask |
| Color and looks | 16 | looks, film finishes, themes |
| Overlays and textures | 7 | grain, vignette, scan lines, glass widgets, shortcut rain, noise, light leak |
| Glitch and distortion | 10 | glitch seams and effects |
| Shapes, frames and split screens | 10 | reel frame, split headline, B-roll split, grid, versus, screen card, colour and chapter cards |
| B-roll and media | 10 | screen card, profile wall, phone fan, carousel spin, headline wall, match cut and more |
| Audio | 54 | 11 music beds, 37 sound effects, beat sync, sound map and cap |
| Intros, outros and CTAs | 8 | CTA card and button, number pop, chapter card, tap, countdown flip, comment box, cards |

269 unique items in all. Counts are from this release; `node -e "import('./kit/studio/core.mjs').then(C=>console.table(C.catalog().categories.map(c=>({c:c.label,n:c.count}))))"` prints the current ones.

![The Captions tab of the effects menu](studio/menu-captions.png)

### Candidates to build next

No category is empty today, so none is hidden. These are thin, or are things people ask for that the engine does not do yet (listed in `categories.json` under `candidates`):

- **Speed ramps and slow motion.** Speed and time has 3 items; the engine cuts and freezes but does not change playback speed.
- **Emoji.** Stickers cover hearts, stars and fire; there is no emoji picker.
- **Intro stings and logo reveals.** Only the end card and number pop exist.
- **Light and lens effects.** Light leak is a transition; there is no lens flare or bokeh overlay.
- **Sound design: ducking controls.** Ducking is automatic; there is no per-clip control.
- Thin today: Lower thirds and name tags (7) and Overlays and textures (7).

## Cut

The Cut step comes right after Footage. It asks what to make from the take, finds the best parts, and lets you trim them by hand. Code: `kit/studio/cut.mjs` (the choice and the candidates), `kit/studio/media.mjs` (preview copies, waveform, transcripts), `kit/studio/cut-run.mjs` (cutting and the 16:9 pass).

![The Cut step: the summary line, the Format, Length, Output and Goal cards, and Find cuts](studio/cut-desktop.png)

### Pieces and your combo (1.15.0)

![The Cut step on Pieces: the take's lines sorted into Hook, Story, Tip, Proof or quote, List and CTA, five numbered in Your combo, each with its reason](studio/cut-pieces.png)

Once the take has a transcript, the Cut step opens on **Pieces** (the switch at the top; **Cuts and lines** is the view below). Every line of the take is a piece, sorted by what it does (`kit/studio/pieces.mjs`):

| Category | What lands there |
|---|---|
| Hook | the open: a claim, a question or "you", near the start |
| Story | sets up the payoff: "my first client", "I remember", "last year" |
| Tip | one actionable line: "open", "type", "how to", "make sure" |
| Proof or quote | a number, "doubled", "percent", or someone else's words ("said", "told me") |
| List | a run of short points: "first", "three rules", "next" |
| CTA | the ask: follow, comment, join, link in bio |
| Aside | off topic, apologies, filler talk. Hidden until **Show asides and retakes** |
| Retake or fragment | said again later, or cut off. Hidden too |

Each piece shows its time, length and score; the play button plays just that line. The **...** on a piece moves it to another category (yours wins over the rules). **Topics** are the words that come back in two or more lines; click one to show only the pieces about it.

**Your combo** is the pieces in the order the reel plays them. **Let AI choose** fills it: the strongest hook, then the best middle pieces in the take's order up to the length you picked, then the CTA, never an aside or a retake, each with one reason ("Strongest open", "A number backs it"). **Build my own** empties it, and clicking a piece adds it at the end. Drag to reorder, or use the arrows; x drops one. Your edit says who built it (picked by AI, changed by you, or your agent).

A piece is a whole transcript line with its edges snapped to the quiet next to its words, so a combo never cuts a word or starts mid-word. Pieces next to each other in the take that sit next to each other in your combo play as one range, with no second cut. When there is a combo it is what drafts and renders, ahead of the kept cuts (the Cuts and lines view says so). The what-to-make cards fold behind **Change** on Pieces so the pieces fit on one screen.

**What to make.** Four rows of big cards, with smart defaults from the take's length (up to 2 min: one full short; up to 10 min: clips; longer: a long form edit plus 5 clips), so you can just hit Next. A line at the top sums it up, for example "Both: 1 full edit (~10 min) + 5 short clips, for organic", and **Smart pick** puts the defaults back.

| Row | Cards | Notes |
|---|---|---|
| Format | Short (Reels, Shorts, TikTok, 9:16), Long form (YouTube, 16:9), Square post (1:1) | A custom aspect (9:16, 16:9, 1:1, 4:5) is under More |
| Length | Short, Medium, Long | Relative to the format: 15-30 s, 30-60 s, 60-90 s for shorts; 3-5 min, 8-12 min, 15+ min for long form; 15-30 s, 30-60 s, 60-120 s for square. Exact seconds are under More |
| Output | Full edit, Clips, Both | Both is one best-version full edit plus N clips (the + and - buttons). "Split into parts of ~length" is a box under Full edit |
| Goal | Organic, Ad | Ad: a hook in the first 1 to 2 s, tighter cuts (`--tighten 0.25`), a CTA end card with your text, captions kept inside the platform safe area, no long intro, and an optional pair of 15 s and 30 s ad cuts. Organic: story pacing, and short clips that loop back to their first line score higher |

**Find cuts.** Transcribes the take (once, cached) and lists candidates: the full edit (the best version near your length, or its parts), clips, and ad cuts. Each shows the words, the times, the length, a score from 0 to 100 and why. Who scored them is shown under the buttons:

- **Your terminal agent**, when it is the chat backend and connected: it gets a Studio message ("Pick the cuts for ...") and answers with `get_cuts` and `set_cuts`. The rules' picks show until it does.
- **An API or local model** (Settings): it rescores the rules' picks and its name shows.
- **The rules**, when there is neither: hooks (a question, a number, "here is", "the secret"), a clean start and end on a sentence, few fillers and pauses, a call to action for ads, a loop for organic shorts.

![Cut candidates on the take's timeline: the full edit and clips as colored blocks, filler words and pauses marked on the waveform](studio/cut-timeline.png)

**The timeline.** Under the list, the take's waveform with filler words (red ticks) and long pauses (grey bands), and a lane per kind with each candidate as a colored block. Drag a block's edge to trim it; drag on an empty part of a lane, or select words in the transcript and press **Add as a clip**, to add your own. Click a block or its play button to preview just that part. In the list: **Keep** or **Dropped**, move up and down, and remove the ones you added.

**Cut points on the audio.** Transcript word times are often a little off, so every cut also looks at the audio. Studio reads the take's loudness every 10 ms (cached next to the waveform) and works out what quiet means for this take from its room tone and its speech. An end moves to the first quiet stretch of 70 ms or more after the last word, plus 40 ms; a start moves to the quiet just before the first word, minus 40 ms. If the transcript says the word ended but the audio is still loud, the audio wins (within 0.35 s, or up to 1 s when the word clearly runs on); if the audio went quiet before the transcript says, the cut moves back to it. A cut never goes into the next word, a short stop inside a word (a "t" or "p") does not count as the end, the breath after a line stays out, and with no clear dip it takes the quietest spot nearby. This applies to every cut: the rules', your agent's, a model's, and the ones you add or trim (an edit with `snap: false` keeps your exact times). Without ffmpeg the cuts stay on the transcript times.

![Show cut points: the transcript times as dashed ticks on each region and a table of every cut with the word, the transcript and audio times, the shift and why](studio/cut-points.png)

Tick **Show cut points** under the timeline to see them: a dashed tick where the transcript put each edge, and for the selected candidate a table with the edge, the word, the transcript time, the audio time, the cut (click to hear it), the shift and why, for example "audio: the word ran past the transcript".

**Nothing renders on the Cut step.** Cut is for choosing: keep, drop, trim and order. Under **Find cuts** it says how many you kept and that they render at the end, on the [Finish step](#finish), as one reel. The kept cuts (in your order) and your bites are **your pieces**: Draft on Finish makes the reel from them, already cut. Tick **N clips from your pieces** there to also render every piece as its own video in the same run, in `jobs/<job>-<id>/` (the cut itself is in `inbox/studio/<job>/cuts/`). Shorts and square posts go through the full reel edit with the session's style and the platform export; ads also get the end card. They show on Finish under "Clips from your pieces".

**Long form.** The engine renders 9:16, so a Long form output is a plain edit for now: the cut joined with short fades, centered over a blurred copy of itself at 1920x1080, loudness-normalized to -14 LUFS. No captions or graphics yet.

**Long takes.** Transcription runs 2 minutes at a time (`kit/studio/tx_chunks.py`, faster-whisper `small.en`, `TX_MODEL` picks another) with progress on the page, saves after each chunk and picks up where it stopped. Transcripts, waveforms and preview copies are cached by file (path, size and time) in `jobs/.studio/media/`. Uploaded, recorded and linked footage all work the same.

### Lines and bites

For a long recording, under the player. It opens by itself for takes over 3 minutes; click **Lines and bites** to open it for a shorter one.

![Lines and bites: every line with its number, play button, text, length and Keep switch, and bites on the right: the clean take and one picked by the agent, with their lines in order](studio/lines-bites.png)

- **Lines.** Every line of the take, one per sentence, with its number, a play button, the text, the length and a **Keep** or **Retake** switch. Times sit on the quiet in the audio, like the cuts. A line is marked a likely retake only when a later line within 2 minutes says most of it again (70% of its words, not counting openers like "so" or "we know how to") and is not much shorter. Lines under 0.6 s, or two words that stop mid-thought, are marked fragments. Both start as Retake, and one click brings them back. **Show** filters to kept lines or to retakes and fragments.
- **Bites.** Tick lines (from anywhere in the take, in the order you want them), name the bite and press **Make a bite**. In a bite, drag a line or use the arrows to reorder it, and the x takes it out. **Play** plays the lines back to back. Bites render on the Render step: **Render my N bites** sends each one through the reel edit as a short clip (in `jobs/<job>-<bite>/`), and under **More ways to save**, **Save each bite as one file** (or **Plain clip** on one bite) only joins the lines into `inbox/studio/<job>/cuts/<bite>.mp4`, with no edit.
- **One clean take.** Makes a bite of every kept line in the take's order: the whole thing without the retakes and fragments. It renders with the Output choice (a plain 16:9 edit for Long form), or its **Plain clip** on the Render step gives you the joined take as it is.
- **Your agent.** **Ask my agent to pick** sends it a Studio message. It reads the lines with `get_lines`, marks retakes with `keep`, and sends named bites with `set_bites` (line numbers in play order, plus `clean: true` for the clean take). Its bites show as **By** its name, and the chat says what it picked. You can still rename, reorder and play them, and render them on the Render step. `render_bites` renders from the agent.

API: `GET /api/lines?path=`, `POST /api/lines` (`keep`, or `action`: add, update, remove, move, clean, set), `POST /api/lines/render` (`ids`, `only: "file"`).

**Agents.** `set_output` sets the choice, `get_cuts` reads the take, the transcript as numbered sentences and the candidates (`find: true` runs the rules first), `set_cuts` sends your picks (time ranges, a score and a reason each), `render_cuts` renders them (`file: true` saves plain clips). API: `GET /api/cut`, `POST /api/cut/output`, `/api/cut/find`, `/api/cut/edit`, `/api/cut/set`, `/api/cut/render` (`ids`, `only: "file"`), `POST /api/cut/transcribe`, `GET /api/cut/transcript?path=`.

## Footage player

Click a clip in the Footage step to play it above the list. With more than one clip, each shows its place in the order: drag a clip onto another, or use its arrows, to move it, and the x removes one while the rest stay in order. The draft uses that order (`POST /api/footage/move`).

![The footage player: the take, the waveform with the playhead, and the transcript with the current word lit](studio/player-desktop.png)

- Click the picture or the play button, or press Space, to play and pause. J and L jump 5 s back and forward, K pauses, the arrow keys move 1 s.
- Click or drag on the waveform to scrub. Drag further than a quarter second and it selects that stretch instead, snapped to whole words: the start moves to the start of the word it lands in (or the next word, in a pause), the end to the end of its word (or the word before). A selection never starts or ends mid-word. **Play it** plays just that stretch, **Add as a clip** makes it a cut on the Cut step, and **Note for my agent** sends it to the chat with the take, the from and to times and your words (`POST /api/comment { t, end, source }`).

<img src="studio/wave-select.png" width="620" alt="The footage player with a stretch selected on the waveform, from 0:01 to 0:03 on whole words, and Play it, Add as a clip and a note for the agent">
- **Show transcript** transcribes the clip; the current word lights up as it plays and a click on a word jumps there. Select a few words to make a clip from them on the Cut step.
- Files over 300 MB, and ones a browser cannot play (.mkv, .avi, HEVC and other codecs), play from a 540p H.264 preview copy made once in the background. The page says when it is playing one.

API: `GET /api/footage/info?path=` (length, size, codec, preview copy status), `/api/footage/proxy?path=`, `/api/footage/peaks?path=`.

## Record now

Film takes in the Footage step with this computer's camera and mic. Click **Record now**, then **Turn on camera**; the browser asks once for the camera and mic.

<p>
<img src="studio/record-desktop.png" width="520" alt="Studio Record now: a 9:16 camera preview with head and caption guides, the record button and timer, camera and mic pickers with a level meter, the frame, mirror, guides, countdown and teleprompter switches, the script box, and a saved take marked In footage">
<img src="studio/record-phone.png" width="200" alt="Studio Record now on a phone: the 9:16 camera preview with framing guides, with the timer and record button below">
</p>

- **Camera and mic.** Pick either from the lists (they fill in after you allow access). The bar under them is a live mic level.
- **Frame.** 9:16 (default, for reels), 16:9 or 1:1. The preview shows the whole camera; the recording is cropped to the frame from the middle of the picture, at the camera's full resolution (up to 1920 px on the long side).
- **Mirror preview.** Flips only the preview, like a mirror. The take is saved the right way round.
- **Framing guides.** Rule-of-thirds lines, a head zone and the caption band. Keep your head in the zone: kinetic titles can then sit behind your head and captions sit below it, inside the reels safe area from `kit/exports.json`.
- **Countdown.** 3, 2, 1 before it records (a switch turns it off). Then pause, resume and stop, with a timer.
- **Teleprompter.** Pick a script from the Scripts area (or paste one). It sits in a band at the top of the preview, near the lens, so your eyes stay close to the camera, and it scrolls smoothly at your speed: each line takes as long as it takes to say at your words per minute, and a `[pause]` mark holds its line 1.5 s longer. It starts when recording starts, after the countdown, and stops when you pause. The current line is highlighted; set the text size and mirror the text for a beam-splitter rig. Voice-follow pacing is not used: Chrome's speech recognition sends the audio to a server, and Studio keeps everything on this computer.
- **Speed while it scrolls.** A speed bar sits right under the text: minus and plus (10 WPM a step), a slider, and the speed as WPM with a slow, normal or fast label (under 130 is slow, 130 to 175 normal, above that fast). The up and down arrow keys do the same. Changing it mid-take speeds up or slows down from where you are, with no jump. Studio remembers the speed in this browser.
- **Rehearse.** With the teleprompter on, **Rehearse** scrolls the script with nothing recorded, camera on or off. Pause, resume and stop it yourself (Space pauses it too). Starting a take ends a rehearsal.
- **Pop out.** The arrow button on the speed bar (or **Pop out the teleprompter** on the right) opens the teleprompter in its own small window that you can drag next to your camera and resize. In Chrome and Edge it is a Document Picture-in-Picture window, which stays on top of other apps; in other browsers it is a normal window (allow pop-ups for Studio if the browser blocks it). It is the same teleprompter, not a copy: the script, speed, current line, mirror and text size, rehearse, the countdown, recording, pause and stop are shared, and the controls in either window work. Close it, or click **Back to page**, and the teleprompter returns to the page.
- **Keys** while the recorder is on screen (in the pop-out too): Space records or stops (or pauses a rehearsal), P pauses or resumes, up and down change the speed, left and right move a line.

<p>
<img src="studio/teleprompter-speed.png" width="520" alt="Rehearsing in Record now: the teleprompter text scrolls at the top of the preview, with the speed bar under it showing minus, a slider, plus, 150 WPM and Normal, and the pop-out button; Rehearsing, not recording, next to the record button">
<img src="studio/teleprompter-popout.png" width="300" alt="The teleprompter pop-out window: Rehearsing, text size and Mirror at the top, the script in large type with the current line bright, and the speed bar with Stop at the bottom">
</p>

- **Takes remember their script.** A take filmed with the teleprompter on keeps a copy of the script text. `studio_takes` shows it, and the next draft passes it to Whisper as a hint (`TX_PROMPT`, read by `kit/tx.py` and `kit/clip.py`), so names and unusual words in your captions come out spelled the way the script has them.
- **Takes.** Each take is listed with a thumbnail and its length. A new take is kept and in the footage as soon as it is saved. The switch takes it out of the edit or puts it back, **Retake** throws away the last take and records again, and the bin deletes a take's files.

**How a take is saved.** The page records with MediaRecorder (webm in Chrome, Edge and Firefox, mp4 in Safari) and sends it to Studio in numbered pieces about once a second while you film, so a long take survives a slow request: a failed piece is retried, a repeated piece is ignored, and pieces arriving out of order are refused until the missing one comes. On stop, Studio converts the take with FFmpeg to an H.264 and AAC mp4 at 30 fps with a thumbnail, in `inbox/studio/<job>/takes/` (gitignored, next to uploaded footage), adds it to the footage and posts "New take recorded: 42 s (take 3)" in the Studio chat, which your agent reads with the session context. If you switch steps while filming the take keeps going and a red Recording badge in the top bar brings you back; when you are not recording, leaving the step turns the camera off.

**Agents.** `studio_takes` lists the takes (id, file, thumbnail, seconds, status, kept) and keeps, unkeeps or discards one. The page uses `POST /api/record/start`, `/api/record/chunk?id=&seq=`, `/api/record/finish`, `/api/record/abort`, `/api/record/take` and `GET /api/record/takes`.

**Where it works.** Browsers only allow the camera on a secure page, and `http://127.0.0.1` or `http://localhost` on the same computer count as secure. Studio listens on 127.0.0.1 only and never opens itself to your network, so to film on a phone, run Studio on the phone itself or put it behind your own https. If the camera is blocked, missing or busy in another app, the recorder says so in one line with a Try again button. Tested in Chrome with a fake camera and mic; see What is not tested in the changelog.

## Scripts

The Scripts area in the Footage step holds what you will say on camera, per reel (job). Scripts are files in `jobs/.studio/scripts/<job>/` (gitignored, next to the session).

<p>
<img src="studio/scripts-desktop.png" width="520" alt="Studio Scripts area: the script list, the editor with Hook, Body, CTA and Pause buttons and a WPM box, the stats line with section times, and Read it in Record">
<img src="studio/scripts-phone.png" width="200" alt="Studio Scripts area on a phone: the script list above the editor and its stats">
</p>
<p>
<img src="studio/teleprompter-desktop.png" width="520" alt="Studio Record now while recording: the teleprompter band at the top of the preview with the current line highlighted, and the script, pace, text size and mirror text controls">
<img src="studio/teleprompter-phone.png" width="200" alt="Studio teleprompter on a phone, the current line highlighted at the top of the preview">
</p>

- **Edit.** New, rename (the title box), duplicate and delete. The editor saves as you type and shows the word count and read time at the script's WPM (default 150).
- **Marks.** A line that is only `[hook]`, `[body]` or `[cta]` starts a section; the stats show when each starts. `[pause]` anywhere is a breath: it adds 1.5 s and the teleprompter holds there.
- **Ask for one.** Type a request under the editor ("write a 30 s script on cold showers", "rewrite this tighter") and it goes to whoever answers the chat. After a reference breakdown, **Write script from this reference** sends your agent a Studio message with the teardown, so the script follows the reference's hook, pacing and beat times.
- **Who writes.** Your terminal agent writes with `write_script` and runs a humanizer skill on every draft first: its own if it has one, otherwise the bundled `skills/humanizer` ([blader/humanizer](https://github.com/blader/humanizer), MIT, by Siqi Chen). With an API key or a local model, the Studio chat writes the script itself and follows a short form of the same rules (`HUMANIZER_RULES` in `kit/studio/scripts.mjs`); em dashes are removed either way. In keywords mode the page says in one line that writing scripts needs an agent, an API key or a local model.
- **From a reference.** **Pull script** in Look, Reference, puts a reference's own words in Scripts: `[hook]` for its opening seconds, `[body]`, `[cta]` when it ends by asking for something, and `[pause]` at gaps over 1.2 s. The words come from its teardown, or Studio transcribes it. **Adapt to my topic** rewrites it for your topic in the same structure, with about the same lines, pauses and pacing: your agent gets the ask and saves it with `write_script` after the humanizer, or the API or local model writes it with the humanizer rules. The original stays next to it.
- **Read it.** **Read it in Record** opens the recorder with that script in the teleprompter (see [Record now](#record-now)).

API: `GET /api/scripts`, `GET /api/scripts/get?id=`, `POST /api/scripts` (create, or replace with `id`), `POST /api/scripts/action` (`delete`, `duplicate`, `rename`), `POST /api/reference/script` (pull), `POST /api/scripts/adapt` (`{ id, topic }`), `POST /api/scripts/from-reference`. MCP: `list_scripts`, `get_script`, `write_script`.

## Footage from a link

![The Footage step: a link box under the drop zone, a Google Drive file downloaded into the footage, and a private link that says it needs a login](studio/footage-link.png)

Paste a link in the box under **Drop video here** and click **Add**. Studio downloads it into `inbox/studio/<job>/` and adds it to the footage, the same as an upload, with its size and a progress bar while it comes in. No account sign-in is involved.

- **Dropbox.** A shared file link (`dropbox.com/s/...` or `dropbox.com/scl/fi/...?rlkey=...`). Studio asks Dropbox for the file itself with `dl=1`.
- **Google Drive.** A shared file link (`drive.google.com/file/d/<id>/view`, `open?id=` or `uc?id=`). Studio uses Drive's `uc?export=download` link. A file too big for Drive's virus scan answers with a "can't scan this file" page first; Studio reads its confirm form and goes on to the file (its own code, no extra library).
- **Plain video URLs** that answer with a video file (mp4, mov, m4v, webm, mkv).
- **What fails, and the line it shows.** A private, expired or sign-in link: "This link needs a login. Make it public or download it and drop the file in." A folder link, a link that opens a web page, or a file that is not a video each say so. Folder links are not supported yet: share the file itself.
- **Limits.** 20 GB per file (`STUDIO_FOOTAGE_MAX_BYTES`). A download can be cancelled; a failed one can be dismissed. A file never overwrites another with the same name.

The page uses `POST /api/footage/url { url }` and `POST /api/footage/import { id, action: cancel | dismiss }`; progress is in the session's `imports` list. Code: `kit/studio/cloud.mjs`, tested against a local mock of Dropbox and Drive in `tests/studio-connect.test.mjs` (no real Dropbox or Drive in CI).

## Reference links

![The Reference step: a YouTube link downloaded and broken down into length, shots, BPM and pace, a shot timeline with a beat grid, what was found as tags, and suggested picks](studio/ref-url-desktop.png)

The breakdown is visual: four numbers (length, shots, BPM and energy, average shot), a timeline of the shots with a beat grid at the measured BPM, tags for what was found, and suggested picks you click to add (or Pick all). It also says which teardown engine ran; the built-in fallback is rougher, so treat its finds as guesses.

- **Queue.** Paste several links at once; they download and tear down one at a time, each with its status (waiting, downloading with a progress bar, breaking it down, ready, failed with the reason) and Stop, Try again, Remove and "Use this one" buttons. The newest ready one is used unless you pick another.
- **Downloaders.** YouTube, TikTok, X, Vimeo and most video pages go through [yt-dlp](https://github.com/yt-dlp/yt-dlp), an optional free program. The one-line installers add it to the kit's venv; without it, the Reference step shows **Install** and the agent buttons (or put its standalone program on your PATH, or set `YTDLP=/path/to/yt-dlp`). It runs as a separate program; none of its code is in the kit. A direct video link is downloaded by Studio itself. Instagram uses the kit's [instaloader](https://github.com/instaloader/instaloader) helper (MIT): one public post, anonymous, never a login. Without yt-dlp, the link fails with the reason in plain words and the fix buttons.
- **Where it goes.** By default `teardown-in/studio/<job>/` in the kit, which git ignores. Pick any folder in [Settings](#settings). Downloads never go into the repo's tracked files, and the teardown (`teardown/studio-<job>-r<id>/`: Reel.md, teardown.md, contact sheet) is gitignored too.
- **Long videos.** Studio keeps the first 90 seconds for the teardown (`STUDIO_REF_MAX_SECONDS` changes it); with ffmpeg present yt-dlp downloads only that part.
- **Teardown.** The same `npm run teardown` as the CLI (rea-video when installed, otherwise the built-in analyzer). `STUDIO_TEARDOWN_ARGS` adds flags, for example `--engine lite --no-asr` for speed.
- **Influence and Recreate** work the same for links and files: Influence makes `packs/local/ref-<job>/` from the teardown, Recreate drafts with its Reel.md. Influence borrows its picks (transitions, titles, pace). It does not copy the look; Recreate does.
- **Which engine read it.** When the built-in fallback read the reference, the step says so and offers **Install** for rea-video, plus Send or Copy for my agent (it is also an optional step in `npm run setup:all`). The fallback finds fewer shots and no titles. A finish is never taken from a black frame or a shot under 2 s.
- **Rights.** Only download videos you have the rights to use as a reference, and follow each site's terms. Studio uses a reference to learn its style and structure; your reel is made from your own footage.

## Settings

![Settings in a side sheet: who answers the chat, the terminal note switch, API keys and providers, and the folders with Browse](studio/settings.png)

The settings button (top right, the sliders) opens a side sheet and saves to `jobs/.studio/settings.json`, which git ignores. Environment variables win over it.

| Setting | Default | Environment |
|---|---|---|
| Who answers the Studio chat | your terminal agent | `STUDIO_CHAT` = `agent`, `local`, `anthropic`, `openai`, `auto` (a key if set, else keywords) or `keywords` |
| Local model server and model | Ollama at `http://127.0.0.1:11434/v1`, first model it lists | `STUDIO_LOCAL_URL`, `STUDIO_MODEL` |
| Reference downloads | `teardown-in/studio/<job>/` in the kit | `STUDIO_DOWNLOADS` |
| Also copy finished reels to | none (reels stay in `jobs/<job>/`) | `STUDIO_RENDERS` |
| Action notes from the terminal | on | |

### Picking a folder

![Settings folder fields with Browse, Folder list, Open folder and Reset to default](studio/folder-fields.png)

Each folder field (Reference downloads, Copy finished reels to, and the b-roll library folder under API keys and providers) takes a typed full path, or:

- **Browse** opens your computer's own folder dialog and fills in the full path: File Explorer's folder picker on Windows (PowerShell `FolderBrowserDialog`), Finder's "choose folder" on macOS (`osascript`), zenity or kdialog on Linux. A browser cannot hand a page a full path, so the local server opens the dialog.
- **Folder list** (and Browse when there is no dialog, for example Linux without zenity or kdialog, or a computer with no screen) opens Studio's own list: quick places (Home, Desktop, Downloads, Videos, Documents, the kit folder, drives and mounted volumes), a clickable path, Up, Home, **New folder** and **Use this folder**.
- **Open folder** shows the folder (or the default one) in Explorer, Finder or your file manager. **Reset to default** empties the field.

Click Save to keep a change.

![The folder list: quick places, the path, folders and Use this folder](studio/folder-browser.png)

What the folder list can see: folder names only, never files or what is in them, and only under your home folder, the kit, drives (Windows) and mounted volumes (`/Volumes`, `/media`, `/mnt`). Hidden folders (names starting with a dot), AppData, `~/Library` on macOS, the recycle bin and the Windows system folders are never listed or opened. The folder routes (`/api/folders`, `/api/folders/new`, `/api/folders/open`, `/api/folders/pick`) answer only on localhost and only to the Studio page itself (they need the `x-studio-page: 1` header and refuse cross-site requests). Your agent has no folder tools; it sets folders with `studio_settings`.

Theme (dark or light) and Glass panels (on, or solid panels for older computers) live under Look and are saved in the browser, not in the file.

### API keys and providers

![API keys and providers: Pexels saved on this computer and tested, other providers not set, with Get a key and Docs links](studio/broll-keys.png)

**API keys and providers** (in Settings, and on the B-roll step) has one row per provider: Pexels and Pixabay (free stock), Higgsfield, OpenAI, Google, Replicate and fal (generate, paid on your account) and Anthropic (text: b-roll ideas and the chat). Each row says whether a key is set and where from (the environment, or saved on this computer), never a character of it. Paste a key and **Save**, **Test key** (one documented, free call: Pexels and Pixabay search one result, Higgsfield asks a free estimate, OpenAI, Anthropic and Google list models, Replicate reads the account; fal documents no check, so it says so), **Remove**, or follow **Get a key** and **Docs**.

Keys are saved in `jobs/.studio/keys.json` (next to the session, `STUDIO_DIR` moves it), written owner-only (chmod 600), in a folder git ignores. A key in the environment wins: `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `HF_API_KEY_ID` and `HF_API_KEY_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `REPLICATE_API_TOKEN`, `FAL_KEY`. Keys are never logged, never sent to the page and never given to your agent: `broll_providers` says only set or not and where from. A saved OpenAI or Anthropic key also answers the Studio chat. The sheet also lists which b-roll sources are on, the **Allow generating** switch with a model per provider, and the b-roll library folder.

The Posting group holds your Buffer key and the keys for the video host (Cloudflare R2, Cloudinary) used by the [Post step](posting.md). Their environment names are `BUFFER_API_KEY`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, and `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.

Folders must be full paths; Studio makes them if needed and checks it can write there before saving. The `studio_settings` MCP tool reads and changes the same file.

## Chat

The Studio chat is answered by one of these, picked in Settings:

- **Your terminal agent (default).** Claude Code, Codex, Cursor or any MCP client, running in your terminal. See the next section.
- **A local model.** Any OpenAI-compatible server on your computer: [Ollama](https://ollama.com) (`http://127.0.0.1:11434/v1`), LM Studio (`http://127.0.0.1:1234/v1`) or the llama.cpp server (`http://127.0.0.1:8080/v1`). "Find models" lists what the server has. No key needed (`LOCAL_LLM_API_KEY` if yours asks for one).
- **Claude or OpenAI API.** Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` before starting Studio (`STUDIO_MODEL` picks the model; `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` point at compatible servers). Keys stay in your environment; nothing is saved.
- **Keywords only.** No model: vibe words (calm, calmer, cinematic, hype, fast, clean, magazine, techy, retro, silent and more, in `kit/studio/vibes.json`), pack and effect names, "no ..." to forbid, and "the transitions from the reference" (or titles, captions, grade, graphics, effects, music, beats, or everything).

Every backend gets the session and the reference teardown, so "use the transitions from this reference but calmer" works in each, and every change is checked against the engine's names before it is applied.

### Ask my agent and Apply (1.17.0)

**Ask my agent** sits in the bar at the bottom of every step, next to Next. It opens a few prompts for that step ("Pick the strongest hook" on Cut, "Make it calmer" on Look, "Check the draft for me" on Finish) and a box for your own words. The message goes to the Studio chat with the step in front ("(On the Cut step) Pick the strongest hook"), and the chat opens (`POST /api/chat { text, step }`).

When your agent answers with a change for you to decide on, the answer carries an **Apply** button (and **Show me**, which opens the step). Nothing changes until you click it; then it says Applied and the chat notes what changed. The agent sends it with `studio_reply { text, suggest: { patch, combo, step, label } }`: `patch` is any `studio_set_selections` change, `combo` a Combo of piece ids from `get_pieces`. A suggested patch with a bad name is refused before you see it. `POST /api/chat/apply { id }` applies one, once.

<img src="studio/apply.png" width="360" alt="The chat with an agent answer, The magazine Look fits this hook, and its Use magazine and Show me buttons">

## Your terminal agent in Studio

![Studio chat with Claude Code connected and listening: page messages marked answered, an action note for an edit made from the terminal](studio/chat-agent.png)

You tell your agent, in its terminal: **"Set up Studio from AGENTS.md and run the Studio chat loop."** It runs `npm run setup:all` (everything installs up front; it tells you only what it cannot do itself), registers the kit's MCP server in its own config (the [Connect agent](#connect-agent) sheet shows the same lines), asks you to restart it once so the tools load, starts Studio (`studio_start`), opens the page, and listens. The steps per agent are in [AGENTS.md](../AGENTS.md#studio-set-it-up-and-be-the-agent-in-it) and the loop is in [skills/aigent-studio/SKILL.md](../skills/aigent-studio/SKILL.md).

### Connect agent

<p>
<img src="studio/connect-desktop.png" width="520" alt="The Connect agent sheet: waiting for your agent, a grid of agents with Claude Code picked, and numbered steps with the claude mcp add command and the hook command filled in with this install's paths, each with a copy button">
<img src="studio/connect-phone.png" width="200" alt="Connect agent on a phone: the same agent grid and steps as a full-screen sheet">
</p>

**One line from scratch.** On a computer without the kit, paste this into any agent that runs commands. It follows [docs/install.md](install.md): finds the OS, reuses or clones the kit, runs the installer and `npm run setup:all`, connects itself with the steps below, starts Studio, checks `setup_status` and tells you only what it cannot do. The Connect agent sheet shows the same line at the top.

```
Read https://github.com/wrg32786/aigent-talking-head/blob/main/docs/install.md and follow it to install, set up and connect Talking Head Studio in this agent, then open Studio.
```

**Connect agent** in the top bar (also in the empty chat and in Settings) opens a sheet where you pick your agent: Claude Code, Codex CLI, Cursor (CLI and IDE), Gemini CLI, OpenCode, Windsurf or another MCP app, or Other / generic MCP. For the one you pick it shows exactly what to do, each with a copy button:

1. The one line that adds the Studio MCP server, or the config to paste, with the real absolute paths of this install filled in (Node, `kit/mcp.mjs` and the kit's Python). The server writes these itself, so they are right for your computer.
2. For Claude Code, the hook install (`node kit/studio/connect.mjs claude --user`).
3. Restart the agent once.
4. The one sentence to say to it: "Run the Studio chat loop".

**Let my agent set it up** gives one prompt to paste into any agent instead: it points the agent at AGENTS.md with the paths, and the agent registers itself and starts listening.

The sheet shows the connection live: "Waiting for your agent", then "Connected: Claude Code, busy in the terminal" or "Connected: Claude Code, listening" in green as soon as it connects. Studio remembers the agent you picked (`agent` in `jobs/.studio/settings.json`). The page reads `GET /api/connect`; the commands come from `kit/studio/agents.mjs`, which `npm run studio:connect` also uses.

<img src="studio/connect-connected.png" width="520" alt="Connect agent after the agent connected: a green check with Connected: Claude Code, listening, and the Let my agent set it up prompt">

**What each command is based on.** Checked against each agent's own docs on 2026-11-19:

| Agent | What Studio shows | Source | Checked |
|---|---|---|---|
| Claude Code | `claude mcp add --env PYTHON=... --transport stdio --scope user aigent-talking-head -- <node> <kit>/kit/mcp.mjs`, then the hook | [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) (`--env` before the name needs another option between, so `--transport stdio` sits there; `--` separates the server command), [hooks](https://code.claude.com/docs/en/hooks) | yes |
| Codex CLI | `codex mcp add aigent-talking-head --env PYTHON=... -- <node> <kit>/kit/mcp.mjs`, or `[mcp_servers.aigent-talking-head]` with `command`, `args`, `env`, `tool_timeout_sec = 300` in `~/.codex/config.toml` | [developers.openai.com/codex/mcp](https://developers.openai.com/codex/mcp) | yes |
| Cursor (CLI and IDE) | `mcpServers` JSON in `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project); the `agent` CLI reads the same file (`agent mcp list`) | [cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp), [cursor.com/docs/cli/mcp](https://cursor.com/docs/cli/mcp) | yes |
| Gemini CLI | `gemini mcp add --scope user -e PYTHON=... aigent-talking-head <node> <kit>/kit/mcp.mjs`, or `mcpServers` in `~/.gemini/settings.json` | [gemini-cli docs/tools/mcp-server.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) | yes |
| OpenCode | `opencode mcp add aigent-talking-head --global --env PYTHON=... -- <node> <kit>/kit/mcp.mjs`, or `mcp.servers` with `type: "local"`, `command` as an array and `environment` in `opencode.jsonc` | [opencode.ai/docs/mcp-servers](https://opencode.ai/docs/mcp-servers/) | yes |
| Windsurf or another MCP app | the common `mcpServers` JSON | [docs.windsurf.com/windsurf/cascade/mcp](https://docs.windsurf.com/windsurf/cascade/mcp) now opens the Devin Local docs, which name `~/.config/devin/mcp_config.json` but do not show its format | **not verified**: marked in the sheet |
| Other / generic MCP | the stdio command and the `mcpServers` JSON | [modelcontextprotocol.io: connect local servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) | yes |

By hand, from the kit folder, `npm run studio:connect -- claude` (or `codex`, `cursor`, `print`) still writes the config for you.

**Two channels, one agent.** The Studio chat shows only the Studio conversation: what you type in the page, the agent's answers to it, and short action notes. Your terminal conversation stays in the terminal and is never copied into Studio. Edits are shared: whatever the agent changes, from either conversation, updates the page live. When it changes the edit because you asked in the terminal, Studio shows a one-line note such as "Claude Code: picked transition whip (from the terminal)." Turn those notes off in Settings.

**How a Studio message reaches the agent.** A terminal agent cannot be interrupted in the middle of a step, so:

- **Idle and listening:** it waits on `studio_wait_for_message` and answers within a second or two. The page shows "Claude Code connected, listening".
- **Busy in the terminal:** the message queues. The agent checks `studio_get_pending` at the start of each turn. In Claude Code, the Studio hook (`kit/studio/hooks/studio-pending.mjs`, installed by `npm run studio:connect -- claude`) adds "N Studio messages waiting" to its context after each tool call, when you send it a prompt, and when it finishes a turn, so it picks them up at its next step. Codex and Cursor have no equivalent hook here; they rely on the per-turn check in AGENTS.md. A long command (a render) still finishes first.
- **On the page:** each message you send shows Queued, then Seen, then Answered with a check. The badge at the top of the chat shows "Claude Code, listening" (green), "busy" (amber, messages wait for its next step) or "No agent" (red), and an empty chat shows the one line to say to your agent with a copy button.

**MCP tools for the channel:** `studio_start`, `studio_wait_for_message`, `studio_get_pending`, `studio_reply` (Studio channel only; `replyTo` marks messages answered), `studio_set_selections` with `origin: "terminal"` for terminal edits, plus `studio_add_reference_url`, `studio_get_reference_teardown`, `studio_settings`, `studio_takes`, `list_scripts`, `get_script`, `write_script`, `studio_get_state` and `studio_run`. Presence is in `jobs/.studio/agent.json`; the hook reads `GET /api/agent/pending` (localhost only).

`npm run studio:agent` starts Studio in the background and prints its URL as JSON (`--no-open`, `--port`, `--stop`), so an agent's terminal is not held by the server. `tests/studio-agent.test.mjs` runs the whole loop with a scripted MCP client acting as the agent.

![Studio on a tablet: the Style step with the chat beside it](studio/tablet.png)

## AG-UI

Studio also speaks [AG-UI](https://github.com/ag-ui-protocol/ag-ui) (MIT), the open event protocol between agents and user interfaces, so an AG-UI client can watch Studio or talk to it. `kit/studio/agui.mjs` maps the session onto AG-UI event shapes; it has no dependencies and copies no AG-UI code.

- `GET /api/agui/events` is an observer stream: `STATE_SNAPSHOT` and `MESSAGES_SNAPSHOT` first, then `STATE_DELTA` (RFC 6902 JSON Patch on the edit: job, footage, pack, picks, music, sound, pace, export, reference), `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT` and `TEXT_MESSAGE_END` for each answer, `STEP_STARTED` and `STEP_FINISHED` for drafts, renders and reference downloads, and `CUSTOM` events `studio.message_status` (queued, seen, answered) and `studio.action_note`.
- `POST /api/agui` takes a `RunAgentInput` and streams a run: `RUN_STARTED`, the status of the message, the answer as text message events, a `STATE_SNAPSHOT`, then `RUN_FINISHED`. The last user message goes into the Studio chat, the same channel as the page, so whoever answers the Studio chat answers it (your terminal agent by default). `forwardedProps.timeout_s` (default 300) bounds the wait; if no answer comes in time the run finishes with `result.status` still queued or seen, and the message stays in the chat.

Like the rest of Studio, both endpoints answer on localhost only and refuse cross-site browser posts. Tool calls are not mapped: the agent's tools are its MCP tools, and AG-UI clients see their effect as state deltas.

## B-roll

![The B-roll step: four spots picked from what was said, a quote card on spot 1 as a full cutaway with How it sits, Timing and Why this, and a counter card picked by Studio on the last spot](studio/broll-spots.png)

The B-roll step sits between Look and Finish. Its **spots** come from the draft: every segment of `build/cut.json` is a spot, and a segment longer than 10 s splits at the end of a caption into spots of about 7 s (`spots` in `kit/studio/lane.mjs`), so a long take is no longer one beat holding every word. When the reference cuts to b-roll (its b-roll parts in What to swap), the spot at the same point of your reel splits there and says **REF**. **Add a spot** splits a spot at a time you type; the b-roll already placed stays on the words it was on. The voice keeps running under every insert; the insert's own sound is dropped.

**B-roll picks itself.** After every draft (when **Picks itself after each draft** is on, the default), Studio reads each spot's words and keeps about one idea every 6 to 10 s, the first spot too (never in its first 1.2 s, so the hook shows your face first):

- A number said ("312 percent", "$5,000", "doubled") becomes a **counter card**, a quote ("she told me...") a **quote card**, anything else a search on the spot's strongest nouns (not verbs like follow or make).
- Your library comes first: a clip whose name or tags match, else an upload of the kind the spot likes (testimonials and product demos on proof spots, screen recordings on tips, lifestyle on stories).
- Studio puts on what it can place for free: a library clip, Pexels or Pixabay when you set a key, a card when Chrome is here. A spot with only a search waits for you. Generating never runs on its own.
- Each idea starts on the word it is about and says **why** ("You say "doubled". Show it as a number."). Placed spots say **picked**; the chat says how many were placed.

**Clear all B-roll** (when any spot is filled) takes every clip off the timeline. It asks first, then **Undo** puts them back. Library clips are unchanged.

**Suggest b-roll again** runs the same rules on the empty spots. Click a spot to see **How it sits**, **Timing** and **Why this**, **Use it** or **Keep empty** for an idea, and **Remove** for what is there. **Use it** never needs a key: the idea's clip, its card, a library match, stock with a key, else a card made from the spot's words. With no Chrome it says so and shows the Chrome fix button.

**Options for this spot:**

| Option | What it does |
|---|---|
| Library | Your b-roll folder, reused by every job. Search names and tags (orientation, dark or bright, colour, still or moving, short or long, the source's own tags, the kind). |
| Your uploads | A video (mp4, mov, webm, m4v, mkv) or a picture (jpg, png, webp), copied into the library. **It is** asks what it is: Testimonial, Product demo, Screen recording or Lifestyle. **It is raw: cut it into pieces first** (on for testimonials) cuts it before it lands, below. |
| Stock | Pexels or Pixabay with your own free key. Words, orientation and longest length; hover to preview; **Use** downloads the file nearest 1080p into the library with its license and credit. |
| Made card | A chart, counter, quote, code card, terminal card or your own HTML and CSS scene, rendered here with headless Chrome (JavaScript off, no network). An idea's card opens filled in. |
| Screen | Your screen with `getDisplayMedia`, with an optional round webcam bubble, saved as a screen recording. |
| AI generate | A provider with your own key, off until you allow it (below). |

**Raw uploads are cut first.** A raw upload goes to `inbox/studio/<job>/raw/`, is transcribed, and is cut with the same cutter as your footage (`kit/studio/cut.mjs` lines: every edge in the quiet next to its words, never mid-word, retakes and fragments left out) into pieces of 3 to 12 s. Each piece lands in the library tagged with its words and its kind. A raw clip with no speech is split every 5 s.

**Testimonials keep their own sound.** Testimonial pieces show under **Testimonials**. **Play in my reel** puts one into your Combo between your pieces (before your last piece, or after the one you pick), so it plays with its own voice instead of over yours. Draft again to hear it; Your edit says "1 testimonial". Agents use `add_testimonial`.

**Placement:** **Full cutaway** covers the frame. **Split top panel** puts the clip in the top half and you in the bottom half, moved so the top of your head reaches a little into the panel: with the person mask your head draws over it, so the panel sits behind your head (without the mask your head stays just under the seam). **Picture in picture** puts a small framed 16:9 box at the top right. **Framed cards** puts the clip in a rounded card up top and you smaller in a second card below, your head breaking out over its top edge, with a thin blue border and a soft glow on a cream backdrop. On both the split and the framed cards your captions move to the line the layout leaves for them, off your face (dark on the cream backdrop). The preview next to the chips shows where the clip and you sit. **Starts** is seconds into the spot (a short lead in by default), **Length** is up to 3.5 s by default and never past the spot or the clip, **From** is the clip's in point.

![Split top panel with the top of the presenter's hair over the panel's lower edge, and Framed cards: the clip in a rounded card up top, the presenter smaller in a card below with the hair breaking out over its top edge, thin blue borders and a soft glow on a cream backdrop](studio/broll-split-framed.jpg)


**Ideas from your agent** (`suggest_broll`, with `why` and `offset`) wait on the spot the same way. The API still calls a spot a beat (`beat: n`), so agents that know `fill_slot` keep working.

**Render** puts the lane into `build/cut.json` as inserts (`kit/studio/broll-run.mjs apply`; inserts from a recipe or `--broll` stay) and writes `jobs/<job>/credits.txt`: each clip with its source, author, link and license, generated clips with the provider, model and prompt, and "Videos provided by Pexels" or "Videos from Pixabay" when used.

**Library:** `broll-library/` in the kit by default (git ignores it), or **B-roll library folder** in API keys and providers, or `STUDIO_BROLL_LIBRARY`. The index is `library.json` in that folder, so the library moves with it. Stock media is never committed.

### Generate

Off by default. Turn on **Allow generating** in API keys and providers and add a provider key. **Estimate cost** shows the price (from the provider when it says, else a stated rule), and the clip is only made after you click **Generate for $X**. It runs in the background and lands on the beat. Your agent can only ask: `fill_slot` with `generate` adds an ask to the step with the estimate, for you to approve or decline. Generated pictures become a short clip with a slow push in.

| Provider | Makes | Status |
|---|---|---|
| Higgsfield | video and images | Verified against [its API docs](https://docs.higgsfield.ai): `Authorization: Key <id>:<secret>`, the free `POST /estimate/<model>` for the price, a queued request polled on its `status_url` until completed (failed and nsfw are not charged; outputs keep 7 days). Default models: Kling 2.5 Turbo Pro text to video, Soul v2 for images. |
| Google (Gemini) | video | Gemini Omni Flash through `POST /v1beta/interactions`. Not verified: no live run; about $0.07 a second at 720p from Google's pricing page. |
| OpenAI | images | `gpt-image-2.5` images. Price not verified. The Sora video API closed on 2026-09-24. |
| Replicate | what the model makes | You name the model (owner/name). Cost per model. Not verified. |
| fal | what the model makes | You name the model. Cost per model. Not verified. |
| Runway, Veo, Kling, Sora | | Listed, not wired: Runway's API is documented but not in this version; Veo's preview ended 2026-10-22 (use Google); Kling runs through Higgsfield; Sora closed. |

## Finish

![The Finish step: Draft, Check and Render in order, the Make card with Your 2 pieces or The whole take, the reel, clips and plain clips chips and the export size, then Redraft and Render v4](studio/finish.png)

Finish is the one place that makes videos, in three steps shown across the top: **Draft**, **Check**, **Render**. The **Make** card says what the one Render makes:

- **From.** When you kept pieces on the Cut step: **Your N pieces** (the default) or **The whole take**. Your pieces are cut once, on their audio-checked edges, and handed to the reel as they are (`--as-is`, with a `clips.json` beside them carrying each one's words), so nothing is transcribed or cut a second time.
- **The reel**, **N clips from your pieces** (each piece as its own reel with the same look) and **Plain clips, no edit** (the words you kept, joined, no look, in seconds). Any mix; Render makes them all in one run. With only clips or plain clips ticked there is nothing to draft.
- **Export**, the platform size.

Render stays off until the reel is drafted, and when your pieces changed after the draft it says "Your pieces changed since the draft. Draft again first." (Your edit says so too.) Agents start the same runs with `studio_run` (`from: pieces | take` for a draft, `exports: { reel, clips, plain }` for a render) or set them with `finish` in `studio_set_selections`.

Draft first. "Picks and why" opens with each pick per beat and the reason. The log is folded below it, and **For your agent** copies this reel as an instruction for your agent. Render then builds the reel, applies your choices edits, and lists this draft's output (`reel-vN.mp4` and the export) with a player and a download link. Earlier reels stay in the [Outputs library](#outputs), not on this step. The effects pass (camera moves, person-mask effects) runs when the effects venv is set up; without it, Studio says the picked effects need it, with **Install** and the agent buttons, and the reel renders without them. When the draft tightened pauses, **Pauses cut** lists each one with **Keep this pause** (`pace.keepPauses`, `--keep-pauses clip@seconds`). A cancel that lands after the render wrote its video keeps the video; the task ends done.

Draft plans the reel; it makes no video. When it ends the step says "Plan ready, no video yet. Check it below, then Render." Finish shows only this draft: the plan, or a fast preview of its cuts, never a render from another draft or take. The Check tools (Show original, the edit receipt, the clean-up pass, Picks and why) show once there is a current draft. If this job already has earlier reels, a note points you to Outputs, and to New video if you want this take as its own job.

![Finish after a render: the reel and each piece as its own reel under Clips from your pieces](studio/finish-rendered.png)

Every export saves the build behind it beside the video (`reel-vN.build/`). A later Draft replaces `build/`, so a finished reel shows **Edit this reel**: it brings that reel's build back (the draft it replaces is kept as `draft-<time>.build/`), then edit and Render. Agents use `reopen_reel` or `npm run reopen -- <job> v3`.

When the reel puts titles or captions behind you, Render first checks free memory against the person mask (birefnet-portrait needs about 8.8 GB). If there is not enough, it says how much is free and offers **Titles in front** (no mask), **Lighter mask** (MediaPipe, about 0.5 GB, rougher edge) or **Try anyway**. Every caption and title is also kept off your face; the log shows `face check: N of M moments`. See docs/guide.md, Face keep-out and the person mask.

## Review your edit

Five tools in Look (the Reference view) and Finish help you see what changed and say what to change next. They read files the kit already writes (the teardown's `Reel.md`, the draft's `clips.json` and `choices.json`), so nothing goes online.

**What to swap** (Look, Reference, under the breakdown). The reference's parts in order with their times: the hook, every cut and how it moves, title moments, b-roll and cards, graphics and the call to action. Click a time to watch that moment in the reference. Each part lists the Studio picks that match it (transition, title entrance, finish, caption style, punch, graphic); click one chip to pick it, or **Use** to pick them all. Only items the menu has are offered.

<img src="studio/swap-desktop.png" width="620" alt="What to swap: the reference video next to a list of its parts, each with a time button, a kind such as Hook, Cut, Title or CTA, what happens there, chips for matching picks and a Use button">

**Show original** (Finish step). Your reel and the reference on one clock: side by side, or the reference laid over your reel with an opacity slider. It only plays a reel that was rendered from the current draft (matched on the build key saved in `reel-vN.settings.json` and `reel-vN.build/meta.json`). One play button and one scrubber drive both. If the reference starts earlier or later than your reel, set "Original starts at" in seconds. The reference plays muted unless you tick its sound.

<img src="studio/compare-desktop.png" width="620" alt="Show original: the reference and your reel side by side at the same moment, with one play button, one scrubber, a start offset and a sound checkbox">

**Comment on the preview.** Press **Comment on this frame**: the reel pauses and you click a spot or drag a box on it, then type what should change ("move this title up"). For a stretch rather than one frame, scrub or play on to where it should end and press **Mark the end here**: the note says "from 0:04 to 0:09" and the frame goes back to the start (**Just this frame** undoes it). It goes to the Studio chat as one message with the reel name, the time, the spot or box in percent of the frame, and a saved copy of the frame with your mark on it (`jobs/<job>/comments/comment-N.jpg`). Your terminal agent gets the frame path and the box in the message's `attach` field (`studio_wait_for_message`, `studio_get_pending`), so it can open the image and act on it. With a model or keywords answering the chat, the same line goes to them.

<img src="studio/comment-desktop.png" width="620" alt="Commenting: a red box drawn over the head in your reel, the time of the frame, and a text box with Move this title up a little">

**Clean-up pass.** After a draft, Studio lists what it could cut, from the Whisper word timings of your clips: pauses longer than 0.7 s (you can change that), filler words (um, uh, erm, ah, hmm) and the takes the take check flagged as retakes. Each row has a play button to hear it and Keep or Remove. Pauses and fillers start as Remove; retakes are already left out of the draft, and Keep brings one back. **Apply and redraft** writes `jobs/<job>/cleanup.json` and drafts again from the same clips (no new transcription) with `npm run reel -- --cleanup <file>`: each removed span becomes a jump cut, like `--tighten`, and the captions follow. Nothing is deleted, and **Turn off** goes back to the plain draft. When you change the footage, the clean-up stops applying until you review it again.

<img src="studio/cleanup-desktop.png" width="620" alt="Clean-up pass: filters for pauses, fillers and retakes, and rows for a filler um, a 0.9 s pause and a flagged retake, each with a play button and Keep or Remove">

**Edit receipt.** `choices.json` in plain sentences: the style and your locks, captions and music, then every beat, title, graphic and card with its time and the reason the engine gave. The clean-up shows here too. **Copy** puts it on the clipboard as text. "Picks and why" below it is still where you change a pick.

<img src="studio/receipt-desktop.png" width="620" alt="Edit receipt: the look, the clean-up, each beat with its time, transition, finish and reason, and each title with its entrance and reason">

API: `GET /api/reference/video` (the session's reference file, with range requests), `GET /api/cleanup?silence=`, `POST /api/cleanup` (`decisions`, `silence`, `redraft`, or `on: false`), `POST /api/comment` (`text`, `t`, `end` for a stretch, `region` as 0 to 1 fractions, `video` or `source` for a take, `image` as a data URL), and `GET /api/choices` now returns `receipt`. The state carries `swap` (the parts list) and `cleanupReady`. The logic lives in `kit/studio/review.mjs`.

On a phone the two videos stay side by side at half width and the lists stack: [screenshot](studio/review-phone.png).

## On a phone

<p>
<img src="studio/phone.png" width="260" alt="Studio at phone width: the Style step with packs and the effects grid">
<img src="studio/menu-phone.png" width="260" alt="The effects menu at phone width: a category drop-down and three tiles per row with forbid buttons">
<img src="studio/settings-phone.png" width="260" alt="Settings as a full-screen sheet on a phone">
</p>

Studio is meant for a laptop, and it works at phone width: numbered steps in the header, a drop-down for the effect tabs, three tiles per row with the forbid button always shown, the chat as a full-screen sheet behind the chat button (its dot shows the agent status), and no sideways scrolling.

## Setup check

Everything the kit can use is installed up front by `npm run setup:all` (the one-line installers run it too, and your agent runs it during setup): Node packages, the Python venv and `requirements.txt`, yt-dlp and instaloader, ffmpeg and ffprobe, Chrome, the Whisper model (small.en, about 470 MB), the effects pass (MediaPipe, OpenCV, rembg; `npm run effects:setup`), the humanizer skill and the Studio page. It is safe to stop and run again: each step checks first and only does what is missing, and it ends with a summary of what was installed, already there, skipped, failed or needs you. `--skip model,effects` leaves out the big downloads; `--yes` lets it install ffmpeg and Chrome with Homebrew, winget, or apt, dnf or pacman when that needs no password. When it would need your password it does not ask; it prints the line for you to run ("Installing ffmpeg and ffprobe needs your password: run sudo apt-get install -y ffmpeg").

**Setup check** in Settings (and the amber "missing" pill in the top bar, when something Studio needs is missing) lists each one as ready or missing, missing ones first. `npm run setup:all -- --check` prints the same list, and agents get it from the MCP tool `setup_status`, which also returns `forUser`: the plain-words lines for what only you can do. Features say what they need instead of failing later: Draft and Render refuse when ffmpeg, Python or Chrome is missing, Record now says when takes cannot be saved as mp4, reference links say when yt-dlp or instaloader is missing, and Cut says when transcribing cannot run.

### Fix buttons (1.10.2)

Studio never shows you a terminal command to install or fix something. Wherever something is missing (Setup check, the Render and Record notes, a reference link, a transcript, B-roll cards, an error message) it says in plain words what is missing and why, then offers buttons:

- **Install.** Studio installs it itself and shows the progress and the result. This covers the Python tools (faster-whisper and the rest of `requirements.txt`), the Whisper model, yt-dlp and instaloader, the effects pass, the person mask weights, rea-video, the Node packages and the Studio page. Behind the button Studio runs only the matching setup step (`kit/setup.mjs --only <step>`). When it cannot finish, the row says so and your agent can take over.
- **Send to my agent.** Shown when your terminal agent is connected. The steps go to it through the Studio chat, which shows your short ask ("Please install rea-video for Studio.") while the agent gets the full instruction. Its answer shows in the chat.
- **Copy for my agent.** Copies a plain instruction for any agent, for example: "In my aigent-talking-head folder (…), install rea-video for Studio by running … Then tell me when it is done." The command lives only inside that instruction.

Things only you can install (ffmpeg, Chrome, Node.js) also get a link to the official download page. The same holds for the reel itself: the Finish step's **For your agent** fold copies this reel as an instruction instead of showing the command.

<p>
<img src="studio/render-needfix.png" width="560" alt="The Render step saying drafting and rendering need ffmpeg and Chrome, with Get ffmpeg, Get Chrome, Send to my agent and Copy for my agent buttons">
<img src="studio/setup-fixes.png" width="300" alt="Setup check with missing items first: ffmpeg and Chrome with download links, yt-dlp, the effects pass and rea-video with Install, Send to my agent and Copy for my agent">
</p>

## Setup without a terminal

The one-line installers check for Git, Node.js, ffmpeg, Python and Chrome, offer to install what is missing, set everything up with `npm run setup:all` (add `--minimal` or `-Minimal` to skip the Whisper model and the effects pass), and put a "Talking Head Studio" launcher on your desktop. Running them again updates the kit. Details and what to tell your AI assistant: [docs/setup-with-ai.md](setup-with-ai.md).

macOS or Linux (Terminal):

```
curl -fsSL https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.sh | bash
```

Windows (PowerShell):

```
irm https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.ps1 | iex
```

A double-click app with no installer at all is planned: [docs/desktop-app-plan.md](desktop-app-plan.md).

## New video

<img src="studio/new-video.png" width="560" alt="The New video dialog: a name field showing it will be saved as next-reel, Keep my look switched on, and Open a past video, Cancel and Start fresh">

When a reel is done, **New video** clears the board for the next one. Open it with the **+** next to the reel name, or **More**, New video. Give the new reel a name (it is cleaned the same way as the name field: lowercase letters, numbers and dashes; leave it empty for `video-<date>`) and press **Start fresh**. You land on Footage with an empty board: no footage, cuts, reference, b-roll, review notes, draft or chat.

**Keep my look** is on by default and keeps the pack, style picks, music, sound, pace, export size and brand logos for the new reel. Turn it off to go back to the defaults too. Your words (the glossary), API keys, settings and your agent's connection never change.

**Uploading a new talking-head file** on a board that already has an edit also starts a fresh edit for this video: cuts, pieces, B-roll spots and the timeline, the reference, and the draft are cleared. The look resets too, unless you chose **Keep my look** when you started this video with New video. The first file you add to a clean board does not wipe a look you just picked. Files are never deleted. Earlier reels stay in Outputs, each with its player, date, source take and draft, **Edit this reel**, and **Download**. Use **New video** if you want the new take as its own job. **Open a past video** still opens your other jobs. A leftover draft on disk is ignored until you draft again, so the B-roll step no longer shows the last video's spots.

Nothing is deleted. The old reel's files stay where they were (`inbox/studio/<job>/`, `jobs/<job>/` with its renders and `reel-vN.build/` saves), and its whole session is saved to `jobs/.studio/videos/<job>.json`.

<img src="studio/new-video-open.png" width="560" alt="Open a past video: launch-teaser, Nov 20, 1 reel">

**More**, Open a past video (or the link at the bottom of New video) lists your past reels, newest first, with the date and how many reels each has. Pick one and Studio puts you back where you left it. A job Studio never saved (made before 1.11.0, or with `npm run reel`) opens with its footage and its reels, so Outputs and **Edit this reel** work. The reel you leave is saved first, so you can switch back and forth.

Studio will not switch while a draft, render, download, take, transcript or b-roll generate is running: cancel it or let it finish. Your agent does the same with `new_video`, `open_video` and `list_videos` (see [mcp.md](mcp.md)); when it switches, the page follows to Footage.

## Wizards

**Wizards** in the top bar (and in More) are three guided starts. Each step has **Let my agent decide**, which hands that choice to your agent in the chat.

- **Make a reel from a long take.** What it is for (Grow followers, Sell or sign up, Teach one thing, Full clean take, each setting the output), then a Look, then **Let AI choose** picks the pieces and opens Finish. If the take is not transcribed yet, it transcribes first and opens Cut.
- **Copy a reference.** Paste a reel link; Studio reads it with Use all on and opens Look, Reference.
- **Clips and ads from one take.** 3, 5 or 8 clips, with 15 s and 30 s ad cuts if you tick them; it finds them on whole words and opens Cut.

<img src="studio/wizards.png" width="560" alt="The Make a reel wizard, step 1 of 3: Grow followers, Sell or sign up, Teach one thing and Full clean take, and Let my agent decide">

API: `GET /api/wizard` (the wizards, goals and clip counts, from `kit/studio/wizards.mjs`), `POST /api/wizard { wizard: reel, goal, look, choose }`, `{ wizard: clips, clips, ads }`, `{ wizard: reference, url }`. MCP `run_wizard` takes the same.

## Outputs

<img src="studio/outputs.png" width="720" alt="The Outputs library: v2 and v1 of this video with when each was rendered, its look, length and pieces, b-roll and files, and Re-open, Compare and Files">

**Outputs** in the top bar (or **More**, Outputs) lists every finished render of this video, newest first, with the settings that made it: when, the source take and draft, the look, the length and how many pieces, and the b-roll. Every Render writes them beside the reel as `jobs/<job>/reel-vN.settings.json` (and the build key in `reel-vN.build/meta.json`), so a version can say how it was made after the session has moved on. When the footage changes, earlier reels stay here instead of on Finish.

- **Edit this reel** puts that version back in the editor exactly as it was (the same as Edit this reel on Finish and `reopen_reel`); Render then makes the next version.
- **Download** saves the reel. **Files** lists each export too.
- **Compare** two versions to play them side by side, with what changed between them marked.
- **All videos** adds your other videos with how many versions each has and its latest look; pick one to open it.

Nothing is deleted from here.

## Files and safety

- The session lives in `jobs/.studio/state.json` (`STUDIO_DIR` moves it); each past video's session in `jobs/.studio/videos/<job>.json`. Uploads go to `inbox/studio/<job>/` (recorded takes in its `takes/` folder) and `teardown-in/studio/<job>/`, drafts to `jobs/<job>/`, teardowns to `teardown/studio-<job>/`. All gitignored.
- The server listens on 127.0.0.1 only, refuses other Host headers (so a web page can't reach it by DNS rebinding) and cross-site posts, and serves files only from the kit's media folders.
- API keys stay in `jobs/.studio/keys.json` (owner-only) or the environment and never leave the server: the page and the agent see set or not. B-roll stock and generated media go to the b-roll library, never the repo. Agent-made cards render with JavaScript off and no network; web captures take public pages only.
- One task runs at a time; Cancel stops it.
- `STUDIO_REEL_ARGS` and `STUDIO_TEARDOWN_ARGS` add flags to every draft or teardown (for example `--engine lite --no-asr`). `STUDIO_TEARDOWN` and `STUDIO_SETUP` swap the teardown and setup scripts (the tests use stand-ins).

### The top bar

<img src="studio/more-menu.png" width="520" alt="The top bar with numbered steps, the setup pill, Connect agent, theme, Settings and the More menu open with Connect agent, Setup check, API keys and providers and the theme">
<img src="studio/top-phone.png" width="260" alt="The top bar on a phone: the reel name and buttons on the first row and the six steps on a second row">

**Wizards** opens the [wizards](#wizards). **Outputs** opens the [Outputs library](#outputs). The top bar always fits on one line: on a laptop only the current step shows its name (the others show their number, and hovering a step still names it), the setup pill shows just the count of what is missing, and Connect agent shrinks to its plug. **More** (the three dots) holds New video, Open a past video, Connect agent, Setup check, API keys and providers and the theme, and works with the keyboard: Enter or Space opens it, the arrow keys move, Enter picks, Escape closes. On a phone the steps get their own row under the reel name.

Longer explanations sit behind a small **i** next to the thing they explain (Footage from a link, Clean-up pass, Record screen in B-roll); click it to read, Escape or a click elsewhere closes it.

<img src="studio/hint.png" width="420" alt="A hint opened next to the footage link box: Public share links only. Private links need a login, so download those and drop the file in.">

## Design

The page is React 19 with [Astryx](https://github.com/meta/astryx) components (MIT, Meta): buttons, badges, switches, segmented controls, progress bars, status dots, the keyboard hint and the settings drawer. Its theme (`kit/studio/web/src/theme.js`) extends Astryx Neutral with the AIgent palette: warm ink and paper neutrals, one cyan accent, Anton for headings, Hanken Grotesk and JetBrains Mono from the kit's fonts. Effect tiles, the shot timeline and the chat are drawn for Studio.

**Prebuilt, so installs stay one step.** The source is in `kit/studio/web`; the built page is committed in `kit/studio/public`, so the installers and `npm run studio` never run a build or download React. `npm run check` fails if the committed build is older than the source. After editing the page, run `npm run studio:build` (it installs the page's own dependencies in `kit/studio/web` and rebuilds) and commit both folders. License notices for everything bundled are in `kit/studio/public/THIRD_PARTY_LICENSES.txt`.

**Glass.** The floating layers are frosted glass: the header, the step bar, the chat panel, the settings drawer, the hover card, the toast and the save popover. Each is a translucent surface with a 20 px backdrop blur and a one-pixel top highlight, floating with a soft shadow over one faint ambient light. Cards are translucent but not blurred, so a page has at most a few blurred layers and stays smooth on older laptops and phones. Fallbacks:

- **Settings, Look, Glass panels** turns every panel solid (saved in the browser).
- `prefers-reduced-transparency` gets solid panels automatically, and so do browsers without `backdrop-filter`.
- `prefers-reduced-motion` stops transitions and the preview loops (or pause them with the button above the grid), and turns off the step entrance, the menu and hint fades, the theme icon turn and the hover lift; the spinner slows down instead of stopping, so you can still see something is loading.

**Contrast with glass.** Glass opacity is set so text clears 4.5:1 even in the worst case, with pure white footage right behind a dark panel or pure black behind a light one: body text 11.2:1 and secondary text 4.7:1 in dark, 14.5:1 and 5.6:1 in light. Accent text on light glass uses a deeper teal (5.5:1 on a picked chip). Cards over the ambient light measure 12.9:1 and 5.3:1 in dark, 17.0:1 and 6.6:1 in light.

Rules it keeps: the cyan accent marks only the primary action, the current step and what is picked; one dark fade sits under tile names so they read on any preview frame. Keyboard: Tab through everything, arrow keys move between effect tabs, F forbids a tile, / jumps to search, Escape closes the chat sheet and the drawer, and focus stays on the same tile when the page updates. Controls are at least 44 px on touch screens and text at least 12 px.

**Liquid glass (1.8.0).** The look is direction A of the Studio style gallery (`kit/studio/web/src/liquid.css`, tokens carried over with the gallery's names): frosted panels with a 22 px blur and a one-pixel border, a quiet mint glow on the primary button, switches and the picked segment, pill toggles and segmented controls, a glow slider whose track fills to the value, inputs and drop-downs on a dark well (Chrome 135 and later draws the open drop-down list as glass too), clip cards with a round play button, a ring loader and chat bubbles. The light theme uses the same recipe in ink and deep teal.

**The AIgent brand (1.8.0).** On top of the glass, Studio follows the AIgent brand kit. The header carries the AIgent wordmark, the brand's own SVG marks (`kit/studio/web/src/brand/`: the for-dark file on the dark ground, the for-white file on cream; never one colour, never below 24 px cap height). Dark is the brand's Plinth ground (#0b0907, bone #f1e8dc text, cyan #5cf9e2); light is its Paper ground, the cream #f1e8dc with ink #0b0907 text and deep teal #0b8168, because the bright cyan is 1.1:1 on cream. Step headlines are set in the display face, Sofia Sans Extra Condensed (OFL, `kit/fonts/SofiaSansExtraCondensed-VF.ttf`), uppercase at weight 820 with a 40 px one-pixel accent rule above; panel headings use its eyebrow caps (weight 600, .08em tracking); Hanken Grotesk is the UI face. The wordmark face (Space Grotesk) is not bundled: the marks are outlined vectors and the brand keeps that face for the name only. Ember (#d98a3d) appears only as one warm radial light behind the page. Panels and menus use the brand's card and smoke shadows with a 22 px blur at 1.35 saturation; buttons, chips and one-line fields are pills; motion uses the brand's ease-out and carve curves, and nothing moves on hover (only light and colour change). Panels keep Liquid glass's rounded corners rather than the brand's square cards, since the glass look stays. The brand tokens live under Studio's own names: `studio.css` (colours), `liquid.css` (fonts, ember, shadows, curves, radii, `--primary-text` and `--focus`) and `theme.js` (the same colours for Astryx parts).

Contrast (measured with every step, Settings and the More menu open, in both themes): text on cream is 16.4:1, muted text 5.1:1, white on the teal button 4.8:1 or more. Teal used as small text on cream switches to the brand's accent-hi #086553 (5.8:1 on cream, 5.0:1 on a picked chip), and the light theme's success, error and warning are darkened to #276a17, #b02e23 and #7a5600 (5.3:1 or more on cream). Focus rings are the accent in each theme (3:1 or more against the ground).

**Motion and accessible pieces (1.8.0).** [Headless UI](https://github.com/tailwindlabs/headlessui) (MIT) gives the More menu, the hints, the B-roll tabs, the Already cut switch, the Log and Command folds and the Save as pack popover their keyboard and focus behavior; the look is Studio's own CSS (`kit/studio/web/src/polish.css`, no Tailwind). [Open Props](https://github.com/argyleink/open-props) (MIT) supplies the easing curves, shadows and the fade keyframes, so every step, menu and fold moves with the same timing. A few component styles (the theme icon swap, the switch proportions, the spinner, the layered hover shadow and the ring on Next) are adapted from [Uiverse.io](https://uiverse.io) snippets (MIT), each credited by author in [THIRD_PARTY.md](../THIRD_PARTY.md).

Credits: Astryx and React are bundled (both MIT). Headless UI and Open Props are bundled too (both MIT). The token names and component shapes first followed [shadcn/ui](https://github.com/shadcn-ui/ui) (MIT) and the dismissal and focus behavior [vercel-labs/ui](https://github.com/vercel-labs/ui) (Apache-2.0), with no code copied from either. Checked against [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) and [Anti-Slop](https://github.com/miqdadbadjuber/Anti-Slop) (both MIT), used as guidance only. See THIRD_PARTY.md.
