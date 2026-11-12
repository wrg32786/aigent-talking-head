---
name: talking-head-ad
description: "Turn a teammate's phone recording or takes (dropped in inbox/) into a vertical 9:16 talking-head reel: best take per sentence, zoom-punched cuts, every word animated, kinetic titles (in front by default, or behind the head), a few deep sounds on the key cuts, a ducked music bed, checked with npm run verify. HeyGen cinematic takes are an optional extra source. Use when someone says 'make a reel from my clip' or is making or fixing a presenter ad."
---

# Talking-head ad

The main path: a teammate records on their phone, drops the file in `inbox/`, and you turn it into a reel. It runs in four stages:

- **Clips.** Whisper transcribes the recording (or every take), splits it into sentences, flags flubbed retakes and keeps the best take of each sentence.
- **Cut.** The keep clips are joined with a glitch seam and a 10% zoom punch at each cut, and a bigger eased punch after the hook and into the payoff.
- **Overlay.** A canvas layer animates every spoken word, adds one kinetic title per beat behind the presenter's head, and any cards, styled by a theme and a font pairing.
- **Sound.** A few deep sounds on the key cuts only (locked set). On the effects pass, the 31-sound cinematic pack is auto-picked per effect hit and ducked under the voice; the music bed, if any, also ducks.

Every version gets checked with `npm run verify` and by re-transcribing it. All scripts live in `../../kit`. The rules below come from a working reel workflow; follow them unless the teammate asks otherwise.

## Optional: study a reference, then write the script

Skip this when the teammate already has a script.

1. **Teardown (optional, only if the tools are installed).** If the teammate points at a reel they want to match, you can download it with [instaloader](https://github.com/instaloader/instaloader) (MIT) and break it down with [rea-video](https://github.com/JuneYaooo/rea-video) (Apache-2.0): hook, beats, cut rhythm, title moments. Neither is bundled; install them yourself, and only for public posts the teammate may use. Never post anything.
2. **Script shape.** A hook, one reveal per beat, a payoff. 40 to 55 words, 15 to 20 s spoken. If a draft runs over 25 s, cut a middle sentence, never the hook or the payoff. `npm run check -- <job>` reports the word count and length.
3. **Copy standard (humanizer).** Write like a person talking:
   - No em or en dashes. Use a full stop or a comma.
   - No "not X, but Y" / "it's not X, it's Y" flips, no staged run-ups ("Here's the thing:", "The truth?"), no dramatic one-word closers, no rule-of-three lists for rhythm.
   - No hype or AI words: "game-changer", "unlock", "supercharge", "revolutionize", "seamless", "delve", "elevate", "next-level" and similar.
   - Plain verbs, short sentences, specific numbers the teammate gave you. Never invent a number.
   `npm run check` lints captions, titles and cards for these and fails on them.
4. **Takes.** Ask for 2 or 3 full takes. One take shot from an extreme angle (low, high, or very close) makes a strong hook: pass `--hook <that file>`.

## Offer the menu (mandatory)

Do this before you draft, and again before the final render. The menu of effects, graphics, finishes and looks is easy to miss; the user should see it and use the variety.

1. First ask how they want to pick the look: use a saved brand preset (`npm run preset -- --list`; `npm run reel -- --preset <name>`), customize from the menu, or let you choose (`--preset auto`, then tell them what you picked and why). If they have no preset, offer to import a brand guide they drop in `brand-guide/` or pass as a file: `npm run brand:import -- <pdf|image|markdown>`. That writes a draft under `kit/presets/local/` for them to confirm. Presets work without a guide. Any flag or `cut.json` field they set wins over the preset.
2. Run `npm run menu` (every option, grouped, with a one-line label) and point the user at [showcase/index.html](../../showcase/index.html). Rebuild the gallery with `npm run showcase` if it is missing.
3. Show short labels and suggest 2 or 3 options per category that fit this reel:
   - brand presets (`aigent`, `one-word`, `hormozi-bold`, `karaoke`, `minimal-clean`, `cinematic`, `editorial`, `muse-pill`, `retro-scan-lines`, `neutral`)
   - film finishes (grain, vignette, chroma, scan-lines, warm, cool, teal, crushed, mono, bleach), including per-scene variety on `cut.json` segments; do not use one finish on every shot
   - beat-sync (on by default when a bed is set; `--no-beat-sync` to leave times alone)
   - looks (`kinetic`, `oneword`, `muse`, `classic`, `one-word`) and caption styles (`kinetic`, `oneword`, `pill`, `hormozi`, `karaoke`, `classic`, `one-word`); `oneword` is the strongest caption look here (one word at a time, type cards; kit/looks/oneword.md), and `--broll <folder>` with shots of the work itself (hands typing, the screen) adds cutaways
   - font pairings (`theme`, `modern`, `druk`, `elegant`, `editorial`)
   - themes (`aigent` default, `neutral` unbranded)
   - title entrances (7, each used at most once)
   - title layer: front (default), behind the head, or auto (only the strongest 1 or 2 punch titles behind, never consecutive). Offer this per title. `"layer": "front"|"behind"|"auto"` on a title, or `"titleLayer"` for the job.
   - transitions (50 names in `kit/transitions.json`; glitch seam is the default)
   - the 51 effects, grouped by moment (see also [effects/CATALOG.md](../../effects/CATALOG.md))
   - the SFX pack (`kit/sfx/sfx.json`)
   - music beds (`npm run music`, or the beds section of the menu)
4. Vary looks across scenes rather than one finish, style or effect for everything. Ask before you reuse one look on the whole reel.

## Phone clip to reel (start here)

1. Find the clip: `npm run reel` with no path uses every video from the newest recording session in `inbox/` (files within 2 hours of the newest; `--newest` for one), or pass the files the teammate names. If the inbox is empty, ask them to drop it in.
2. The default theme is AIgent. Use it unless they ask for another look: `--theme neutral` (unbranded, offline) or their own `kit/themes/<name>.js`. Don't use the Skool mark for another brand. **Offer the menu** (section above) if you have not already: finishes with per-scene variety, beat-sync, looks and caption styles, font pairings, themes, title entrances and transitions, plus beds. Suggest two or three that fit the reel's energy and let the human pick by ear, or use their own file.
3. Draft it: `npm run reel -- inbox/<file> [inbox/<take2> ...] --theme <name> [--fonts druk] [--hook <take>] [--bed <library name>|music.wav] [--bed-start 0] [--cropx 0.4] --draft`
   - `--cropx` moves the 9:16 crop for a sideways clip (0 left, 0.5 centre, 1 right). Read `jobs/<name>/clips/clips-sheet.png` to check the face is in frame.
   - `--model medium.en` is faster than the default large-v3 for a first pass.
   - With a bed, beat-sync is on by default: punches, SFX and title entrances snap to the bed (speech cuts stay put). Pass `--no-beat-sync` to leave the times alone, or `--finish grain,vignette` for a film look on the picture.
4. Read `jobs/<name>/clips/clips.md`. `npm run reel` already dropped every `retake` row. Remove slates and asides ("Okay, take two...") from `build/cut.json`, and trim the `out` of clips that end mid-move.
5. Edit `build/captions.js`. It's a draft with every phrase in the caption style (`kinetic` by default, key words in `emph`), and one title per beat as a mode 7 flip. Fix misheard words against what the teammate said, rewrite titles that don't read as a headline, and add a count-up, card or CTA if wanted (see step 4 below).
6. Before the final render, **offer the menu again**. Confirm finishes (vary them across scenes), beat-sync, the look, fonts, theme, title entrances, title layer (front vs behind, per title) and transitions. Then build: `npm run reel -- --rebuild --name <name>` writes `jobs/<name>/reel-vN.mp4`, a new number each time.
7. **Verify (mandatory):** `npm run verify -- <name>` must print `VERIFY PASS`. Read `jobs/<name>/verify/contact.png` and every still it lists (each title mid-entrance and settled, the big punches, the payoff) before you hand over the reel path. Then offer the effects pass (next section) if they want more motion.

Leave out `--draft` to go straight to `reel-v1.mp4` in one command. The draft step is better when someone will watch it.

## Pick effects (optional second pass)

After the reel is cut and captioned, you can add effects from [`effects/CATALOG.md`](../../effects/CATALOG.md) (51 starter effects by Vibha Ramprakash; machine-readable in `effects/catalog.json`). Set up once with `npm run effects:setup`.

1. **Read the transcript** (`jobs/<name>/build/captions.js` or `clips/clips.md`) and mark the moments with output-clock times: hook (first 2 s), key claims, numbers or proof, lists or steps, reveals, objections ("but", "no", "stop"), and the CTA. Note the energy of each part (calm, medium, high) from the delivery and the words.
2. **Tell the user what's available**, briefly: the moments you found, and for each one 2 or 3 effect options from the catalog that fit the moment and its energy, with a one-line "what it does". Point them at [showcase/index.html](../../showcase/index.html) (or `npm run menu`) so they can see every labelled effect. Offer a menu preset if one fits (below). Ask them to pick, or to say "you choose".
3. **Build the plan**: 3 to 6 effects. A hook effect in the first 2 s, a CTA effect at the end, and no more than one `high` effect every 5 s. Use each effect's typical duration. Put real copy and numbers in every required option (ask for numbers; never invent them). The "Needs your copy" table in `effects/CATALOG.md` (and `required` / `requiredIf` / `fromProfile` in `catalog.json`) lists what each effect needs. Pull headlines, labels and stats from the transcript where you can. 31 effects ship with the upstream author's brand, handle or demo stats as defaults, and `npm run fx` refuses the plan until you replace them. `glass-widgets`, for example, needs `title`, `text` (the big number), `sub` and `chart` (`label::value::bar|values`); its calendar and "now editing" lines fill in with today's date and the job name. Put the teammate's name and handle in `"profile"`. The "Edited by Claude" pill on `glass-widgets` stays off unless the user asks for it: then add `"pill": true` (or their own text, `"pill": "Made by |Sam"`) to that entry, or pass `--pill`. Save it as `jobs/<name>/fx.json`:
   ```json
   {"profile": {"name": "Sam", "handle": "@sam.makes"},
    "effects": [{"fx": "lean-in", "start": 0.3, "end": 1.2},
                {"fx": "checklist", "start": 6.0, "end": 10.0, "text": "Record::on your phone|Drop::in inbox|Ask::for the reel", "title": "Your workflow"},
                {"fx": "countdown-flip", "start": 18.5, "end": 21.5}]}
   ```
4. **Captions.** Effects rated `off` hide the captions and the titles for their window automatically, `check` ones move the caption track to the top of the frame (and still need a look), and `safe` ones keep captions on. Only one effect in the caption band at a time, and none while a sticker, hero word or CTA caption is up.
4b. **Cut-out.** Add `--mask birefnet` for a clean edge round hair and hats (about 1 s a frame on a GPU, cached after the first pass), or `--mask birefnet-portrait` for the final render (best edge, twice as slow). The default MediaPipe cut-out is fast and fine for drafts. On a tight shot, give an effect `"face": 0.7` and read the check frame. A word behind the speaker has to be cut into by their head or hat, never floating clear above it: that overlap is the whole effect. Give it `"drop": 0.5` (face widths down; `crayon-write` needs about 0.5, `huge-strike` about 0.2 so the word still reads, `backdrop-word` none) and read the check frame until the head covers part of the word and it still reads.
5. **Check, then render.** `npm run fx -- --name <name> --plan jobs/<name>/fx.json --still <middle of each effect>`; read every PNG in `build/fx/` (face covered? text cut off? captions crowded?). Fix the plan, then run without `--still` to get `jobs/<name>/reel-fx-vN.mp4`. Pack sounds are auto-picked onto each effect hit (see Sound); pass `--sfx off` to keep the reel's audio unchanged.
6. Fix the notes the command prints (pacing, durations, missing copy) before you hand it over. `--allow-demo-copy` only fills neutral `[placeholders]` for a quick look; never ship that.

**Effects menu presets** (offer one when the user doesn't know what they want):
- **Calm explainer**: `dot-reveal` or `backdrop-word` on the hook, `todo` or `apple-toggles` on the list, `slow-push` on the key claim, `led-sign` on the CTA.
- **Punchy hook**: `lean-in` or `backdrop-word` on the hook, `reject-stamp` or `huge-strike` on the objection, `match-cut` on the reveal, `countdown-flip` or `comment-box` on the CTA.
- **Product demo**: `locked-on` on the hook, `checklist` or `the-bill` on the steps, `liquid-glass-graph` or `over-the-shoulder-zoom` on the numbers, `tap` on the CTA.
- **Social proof**: `cover-star` or `orbit` on the hook, `headline-wall`, `profile-wall` or `messages` on the proof, `pastel-word` or `tap` on the CTA.
- **Cinematic minimal**: `spotlight` on the hook, `slow-push` on the claim, `moody` or `timeline` between sections.

Effects need a face in frame for anything marked `face`. A grade (`moody`, `swipe`) or `dot-reveal` works without one. These are starter versions of the author's effects; say so if the user compares them to a reel they saw.

## Manual pipeline

Use this when mixing sources or when you need finer control. Work in a job folder:

```
<job>/
  seg1.mp4 seg2.mp4 ...   (or clips/ from the clip-raw-footage skill)
  build/                  (write captions.js and cut.json here; render.mjs copies in overlay.html and theme.js)
```

## 1. Get the takes

**Phone or camera footage (main path)**
- Run the `clip-raw-footage` skill on the raw file, then use its clips as segments.
- A raw file can also go straight into `cut.json`. Add `cropX` to place the face, and `"norm": true` for camera audio.

**Optional: HeyGen takes** (`create_video_from_cinematic_avatar`; needs a HeyGen account)
- Settings: `seedance_2`, 9:16, 1080p, 12 to 13 s per take. A take uses HeyGen credits.
- Prompt for a seated presenter with a slow dolly push-in and a gentle arc, at eye level, with no cuts.
- Write one gesture per line, for example: lean in on the question, open hands on the promise, count on the number, point at camera on the CTA and hold it.
- Put the exact dialogue in quotes, followed by "said once each, no repeated words".
- Save the prompt next to the take. Cinematic videos can't be listed back through the API, so a lost prompt is gone (see `kit/example/cinematic-retake-request.md`).

## 2. Hear every take before you cut

- `TX_MODEL=large-v3 python3 kit/tx.py seg1.mp4 seg2.mp4 seg3.mp4` (Windows: `py -3 kit/tx.py ...`) writes `words.json` and flags repeated words. A HeyGen take said "build, build", and only a large-model pass on the raw take caught it.
- Map speech blocks with `ffmpeg -i take.mp4 -af silencedetect=n=-35dB:d=0.25 -f null -`.
- Whisper word times on HeyGen cinematic takes run 0.3 to 0.6 s early, so time captions from the silence blocks (or pass `--shift 0.4` to `autocaption.mjs`).

## 3. Cut (`build/cut.json`, then `node ../../kit/assemble.cjs ad-v1.mp4` from `build/`)

- Start and end each segment inside its silences. Trim dead openings: one take opened on an empty room before the presenter walked in. Hide a whip-in under the seam glitch. Leave about 0.5 s of breath at each seam.
- **Removing a word:** find its edges with high-band (>4 kHz) against low-band (<1 kHz) energy in 10 ms windows, so the next word's "s" or "k" survives.
  - Example: "free school" became "school". "free" is the hiss of "f", then the voiced "ree". The "s" of "school" is the next high-band burst.
  - End the cut at that burst. A cut 0.12 s too long left only "ool".
  - Join the two halves with a 20 ms acrossfade, and put a card pop and an F hit on the jump cut.
- `node ../../kit/timeline.mjs` prints every segment and word on the output clock. Use `--cuts` to print just the seams.
- Schema and examples: `kit/assemble.cjs` header, `kit/example/cut.*.json`.
- **Zoom punch.** `"punch": 0.1` (the `npm run reel` default) scales every other segment 10% so each cut reads as a jump. `"bigPunch": true` on a segment eases in 12% more over 0.3 s: use it on the cut right after the hook and the cut into the payoff, no more than two. `"zoom"` and `"punchY"` per segment override it; `"punch": false` turns it off.
- **Transitions.** The glitch seam is the default and the right choice most of the time. `"transition": "<name>"` on a segment (or top level) swaps in an ffmpeg xfade; names are in `kit/transitions.json` (crossfade, dip, flash, whip, iris, zoom, pixelate, ...). The outgoing shot holds its last frame for the blend, so caption times don't move.

## 4. Captions (`build/captions.js`, then `node ../../kit/render.mjs <seconds>` from `build/`)

- Draft them: `node ../../kit/autocaption.mjs --out captions.js [--style kinetic|pill|hormozi|karaoke|classic] [--titles] [--fonts druk] [--hero] [--shift 0.4]` reads `words.json` (from `tx.py`) or the clips' `clips.json` and writes timed plain captions. Or copy `kit/example/captions.awakening-hero.js` and write them by hand. Either way, edit the `flips`. Each flip is `{start, end, text, mode}`.
- Modes:
  - 0 caption
  - 1 spray hero word
  - 2 sticker
  - 3 count-up
  - 4 takeover card
  - 5 logo plate
  - 6 CTA sticker
  - 7 kinetic title
- `end: 99` holds a flip to the end of the video.
- **Caption styles** (`"captionStyle"`): `kinetic` (default: each phrase is a two-font lockup; the `hero` word slams in big in the display face, the other words come in on their own word times in the partner face, beside, under or across it), `pill` (3 to 5 words in a lower-third pill), `hormozi` (bold caps, cyan active word), `karaoke` (colour wipe word by word), `classic` (the original). Every spoken word should be on screen in some style; don't ship plain captions unless asked.
- **Titles.** One per beat, at most 7: `{"start": 0.2, "end": 3.1, "text": "Stop editing by hand", "mode": 7, "hero": "editing"}` (a lockup: the hero word big, the rest in the partner face). Each gets a different entrance (`stagger-rise`, `slam`, `blur-rise`, `slide-left`, `elastic`, `flip`, `pop-zoom`), picked in order unless you set `"entrance"`. Only the hook and the payoff flicker. Titles sit at about Y=560, behind the presenter: `build/mask.mkv` (made by `kit/mask.py` from the effects venv) cuts the person out on top of them. For a final reel, use the BiRefNet backend (`npm run reel -- --mask birefnet`, or `"maskModel": "birefnet"` in `cut.json`) after `npm run effects:setup -- --birefnet`. It is slower on CPU (several seconds per title frame) but tighter on hair and hands than MediaPipe, which is the fast fallback and what smoke uses. Optional `"person": "person.mkv"` writes an edge-decontaminated BGRA layer that assemble will prefer. Without the effects venv, titles go in front. If the mask leaks onto the background, add `"maskClear": [[x0, y0, x1, y1]]` in `cut.json`. Judge quality on composited stills, by eye.
- **Fonts.** `"fonts": "druk"` (or `--fonts`) picks a pairing from `kit/fonts/` (16 of them; the table is in `kit/fonts/README.md`). For hooks and titles the clean ones are `literata`, `bricolage`, `michroma`, `redhat` and `pirata`; for Instagram Edits style reels use `jakarta` or `wabbit`. List several to cycle them, one pairing per title beat (captions follow their title's pair, so two combos never mix): `"fonts": "literata,bricolage,michroma"`. The two faces always appear together as a designed lockup (modern: heavy caps + a script tail tucked under it; druk: wide caps + a small tracked sans line; elegant: serif caps + script across it; editorial: serif italic + roman). Pick the hero word per phrase with `"hero": "editing"` (or word indices) on the title or caption, or `"hero": {"<start>": "words"}` in `cut.json`; `"lockup": false` sets one phrase in one font. See `kit/fonts/README.md`. Teammates' own licensed fonts go in `kit/fonts/local/`, never in git.
- Check a few frames first: `node ../../kit/render.mjs 0 "2.7,13.6,25.9"` writes `stills/`.
- **Theme.** `build/theme.js` sets colours, fonts and logo. `render.mjs` copies `kit/themes/aigent.js` there if it's missing (`THEME=neutral` picks the unbranded offline preset). Edit it per job, or add `"theme": {...}` overrides in `captions.js`. A logo plate (mode 5) needs `"logo": "file.svg"` in `captions.js` (file in `build/`) or `theme.logo`; without one, mode 5 draws nothing.
- AIgent theme rules (AIgent jobs only):
  - Captions are Hanken Grotesk 400 in `#f1e8dc`.
  - Hero words, stickers and cards are Sofia Sans Extra Condensed caps, weight 760 to 860, tracking -0.01em.
  - `#5cf9e2` is the only cyan. Never use orange, magenta or pure white.
  - Cards are square. Drips fall from the measured bottoms of the letters.
- Keep the caption band at about Y=1320, below the face. Measure the face per take; text never covers it.
- A lone floating word with nothing behind it fails QA.
- Never write copy the offer contradicts. The Skool group is paid, so the ad can't say "free school".
- The Skool mark (`kit/example/skool-logo.svg`) is only for The AIgent's own Skool group. Never use it for another brand.

## 5. Sound (in `cut.json` and `fx.json`)

- The locked cut-seam set: `whoosh` (the cinematic woosh), `swipe` (the quick woosh), `boom` (deep impact), `click`, `typing`. Mono 48 kHz WAV, all CC0. Use them as `"sfx": {"whoosh": [3.2], "boom": [[12.4, 0.55]]}` (a time, or `[time, gain]`). Each sound's measured peak lands on the time you give. The old keys `F` and `D` still work.
- **Cinematic pack** (`kit/sfx/sfx.json`, 31 sounds, all CC0, Will-approved: 01-03 and 05-32; 04 was rejected). Categories: hit, riser, release, whoosh, swipe, pop, ui, glitch, camera, paper, counter, sub, shimmer. `npm run fx` auto-picks one primary sound per effect from the mapped category, rotates so the same id does not repeat until the category is exhausted, aligns the sound's hit point to the effect, ends risers on the hit for build moments, and starts a release just after heavy hits. Pack and locked-set sounds both duck under the voice.
- Per-effect override in `fx.json`: `"sfx": "25-riser-pitch-sweep"` forces that id, `"sfx": false` skips the effect. Global off: `npm run fx -- --name <job> --plan fx.json --sfx off` (or `NOSFX=1`). Manual placements also go in `cut.json` as `"sfxHits": [{ "id": "11-pop-sticker", "t": 1.2 }]`.
- **Fewer and deeper.** Never a sound on every cut; the glitch seam already marks the cut. Put a whoosh on the big punches, a click or typing under a card or title that needs it, and the loudest sound (usually `boom`) on the payoff. `npm run check` flags a sound on every cut and more than about one sound every 3 s, and validates the pack manifest.
- The locked whoosh and swipe, and the whole 31-sound pack, are Will's picks by ear; boom, click and typing have not been auditioned yet.
- Don't invent new raw synthetic noise swooshes; they read as cheap static. Use the shipped pack (which includes Will-approved cinematic synths) or a CC0 file the human has already chosen.
- To choose new sounds, run `node kit/fs.mjs "<query>"` (CC0 only). Build an audition with one 3 s seam clip per candidate and let a human pick by ear. An agent can't hear.
- `bed` is the music: a library name from `kit/music/beds.json` (`"bed": "vinyl-sunrise"`) or a file path. Pass `--bed <name> --bed-start 0` on `npm run reel`, or set `bed` / `bedStart` in `cut.json`. A bed the human has timed starts at 0 with `bedNoFade`; otherwise pick a musical start with `bedStart`. It ducks under the voice automatically. Every library bed sits at -13 LUFS, so `bedVol` 0.16 fits all of them; for your own file, use about 0.16 near -13 LUFS or 0.22 near -16. Add new tracks with `npm run music:add -- <file>`, never by copying a file in by hand.
- **Beat-sync.** On by default when a bed is set (`"beatSync": true`, or `--beat-sync`). `kit/beats.py` writes `build/beat-grid.json` from the bed at `bedStart` for the reel length. Punches, locked-set and pack SFX, fx hit points and title entrances snap to the nearest beat or onset within 120 ms (`"beatWindow"`). Strong drops get a short camera shake, at most two per shot. Never move `segs[].in` / `out` (lip sync stays put). Turn it off with `--no-beat-sync` or `"beatSync": false` if the human has already timed the accents by hand. Needs librosa (`pip install -r requirements.txt`).
- **Film finish.** `"finish": "grain"` (or `["grain","vignette"]`, or `{ "grain": { "intensity": 0.4 } }`) on the cut or a segment. Looks: `grain`, `vignette`, `chroma`, `scan-lines`, `warm`, `cool`, `teal`, `crushed`, `mono`, `bleach`. Applied on the picture before titles, so captions stay sharp. `--finish grain,vignette` on `npm run reel`. No LUT or light-leak files.

## 6. Verify every version

- `npm run verify -- <name>` (mandatory before delivery) checks 1080x1920, 24 fps, H.264 + AAC 48 kHz, the duration against `cut.json`, loudness (-14 LUFS, true peak under -0.5 dB), that the person mask is there under every title and empty outside them, and the copy lint. It writes stills of each title mid-entrance and settled, the big punches and the payoff, plus `verify/contact.png` and `verify/report.md`. Read the contact sheet: a still proves the frame exists, your eye proves it looks right.
- Re-transcribe the whole render. It must match the script word for word with the bed in. Before ducking, hi-hats turned "school" into "pool".
- Read frame strips across every seam and every hidden cut, plus a still of every caption mode.
- Loudness should land at about -14.7 LUFS integrated (`-af ebur128`).
- Number the versions (`name-vN.mp4`) and keep the old ones.
