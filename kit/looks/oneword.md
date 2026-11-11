# The oneword look

One word on screen at a time, set in changing sizes and faces, with flat-colour type cards cutting in as text-only b-roll. This is the bar for kinetic captions in this kit: the words are the edit.

```
npm run reel -- inbox/take.mov --look oneword --broll inbox/broll
```

That sets `captionStyle: "oneword"`, three font pairings cycling every three phrases (`instrument`, `literata`, `bricolage`: an italic serif, then heavy caps, then a bold grotesk as the key word's face; a card or title takes the pairing of the phrase it comes up with, so one frame never mixes two), type cards, two words behind the head, and, with `--broll`, cutaways to your own clips. Any other pairing works with `--fonts`. The display face should be a contrasting italic or serif, and the partner face a clean grotesk.

## The rules

**One word at a time.** Each spoken word replaces the last on its own word time, centred at chest height (`kineticY`, 1320 px at 1080x1920). Every word has an entrance, even a small one: ordinary words rise in over about 0.1 s, the key word blurs in, the newest word on a line under the key word or along a curve fades up into place. Word starts snap to the sound (the nearest rise in the voice's loudness within 0.15 s of Whisper's time), and a word Whisper wrote twice for one sound (the copies overlap, or one is stretched past a second) is shown once; a real repeat like "that that" stays (`--no-dedupe` keeps every copy). While a behind-head word is up, the chest track never says the same word again. Pace runs at about 4 words a second, the speed people speak, so the eye reads one word per beat.

**Three sizes, two faces.** Every phrase has a hero word: the longest non-filler word, a number, or the `"hero"` you set.

| Word | Face | Size (1080 wide) |
|---|---|---|
| filler before the hero (`a`, `the`, `to`, `you`, ...) | partner face | small, about 47 px |
| other words before the hero | partner face | body, about 95 px |
| the hero | display face (italic serif) | big, about 175 px, up to the frame width |
| words after the hero | partner face, building one by one on a line under the hero | small, about 47 px |

The hero fades in over 0.16 s through a short blur, then holds while the rest of the phrase builds under it. Every fourth hero takes the theme's accent colour.

**Now and then, two more moves.** Every fifth key word goes big, near the full width of the frame. And every fourth phrase stacks the word before the key word on top of it, overlapping: the top word in the display face, the key word below in heavy sans, its descenders dipping in. The key word is cut away in a thin outline round the top word where they overlap, so the top word reads as the top layer.

**Type cards.** These are text-only b-roll: the frame cuts to flat colour for one phrase while the voice runs on, and the words take the card's ink. They don't sit dead centre: each word lands on its own spot around the middle (the set of spots shifts from card to card) and drifts slowly, so the card keeps moving. With `--look oneword` the second phrase and every third after it cut to a card for 0.9 to 1.6 s (never over a behind-head word), cycling through the palette below. When a phrase names a step ("Step 2", "tip three"), a giant faded numeral in the display face sits behind the words.

| `bg` | Background | Ink |
|---|---|---|
| `navy` | `#0e1a33` | `#efe6cf` |
| `paper` | `#f1f1ee` | `#16161a` |
| `blue` | `#2b2cf0` | `#ffffff` |
| `cream` | `#ebe3c3` | `#17161a` |
| `ink` | `#111214` | `#f1f1ee` |

A card in `captions.js`: `{"start": 4.2, "end": 6.0, "mode": 8, "bg": "navy", "number": "2"}`. A custom one: `{"bg": "#hex", "ink": "#hex"}`.

**Words behind the head, now and then.** Twice per reel, on the opening beat and the last one, the beat's key word goes big behind the speaker's head in the display face. The head cuts into it while the small words keep running at chest height. Use the last one for the comment keyword. These are kinetic titles (mode 7, `"lockup": false`), so the person mask applies (`--mask birefnet-portrait` for the final). Keep them low enough that the head covers part of the word.

**B-roll cutaways.** `--broll <folder>` cuts every third free phrase (one that isn't a card or under a behind-head word) to the next clip in the folder, for 0.8 to 2.2 s, while the voice runs on. Shoot or pick shots of the work itself: hands on the keyboard, the screen, pointing at the monitor, leaning back. On a cutaway the running word sits on a shape in the shot (see below). Pick b-roll with a clean edge against a plain wall when you can. In `cut.json`:

```json
"inserts": [{ "file": "../broll/typing.mov", "at": 12.3, "dur": 1.5, "in": 0, "bw": true, "tint": "#ff6b7a", "line": { "y": 616, "x0": 480, "x1": 712 } }]
```

`in` is where to start in the clip. `bw` makes the shot black and white, which works for a pattern change. `line` is the edge to set the word on (y is the edge, x0 to x1 its span); write your own when the finder misses one, or give `y` to centre the word there instead. `tint` colours the word to match the shot's light (a red-lit room gets a red word).

**Set words on shapes.** An editor lines type up with the frame: a word's baseline sits on the top of a monitor, a shelf, a picture frame, the top of the speaker's head or the line of a shoulder, centred over it and no wider than it. `kit/anchors.py` finds these (it cuts the person out with the rembg matte, so words never land on hair or hands, and it skips close-ups):

- **On a cutaway** the word goes on a hard line in the shot, else on the head, else on a shoulder, else at y 640.
- **On your own shot, as an accent, twice a reel.** About a third of the way in, one phrase traces your outline, curving up the side of your head, over the top and down to the shoulder, building word by word. About two thirds in, one key word sits on your head and holds while the small words keep running at chest height. More than that and it stops being an accent.
- **Lines that bend with a shape, not only straight ones.** The outline path (`"arc"`, points in frame pixels) follows the top of whatever stands out in the shot (the cut-out is the salient object, so a ball works as well as a head), lifted about 40 px off it and smoothed. Each letter sits on it at the path's angle there. Give a cutaway or phrase its own `"arc"` for anything the finder doesn't pick.

Write your own: `"line": {"y": 616, "x0": 480, "x1": 712}` on an insert, or `"anchor": {...}` on a caption phrase (y is the baseline, x0 to x1 the span).

## Where to take it further

These are the next moves the style uses. The kit doesn't make them on its own yet; each one is a card or an effect to place by hand:

- **Numbered steps as their own cards**, one background colour per step, with the step's words over the numeral.
- **A diagram card** for a list (labels joined by thin lines, upcoming items blurred until they're spoken). The `checklist` and `timeline` effects come close.
- **A highlight box** behind the head (a phrase in the display face on a block of colour) as the topic title.
- **Words behind objects** in b-roll (the monitor's light bar in front of the word). That needs a mask of the object, not the person.
- **More shapes**: a path around a picture frame or a monitor (text running along the top edge and turning down the side), the side of the silhouette (a word set flush against the body), a door frame or window edge (words stacked against a vertical). The shoulder line is weak when a chair back merges with the speaker's outline.

## Checking it

Every word on the picture gets a soft dark glow and a thin dark edge, so a light word holds on a busy or bright background (curved text over the painting washed out without them). After each reel, `kit/legibility.py` measures contrast between the letters and the ring of picture just around them in the finished frames, and lists any moment under 3:1, the floor for large text. Run it yourself with `python kit/legibility.py build reel-vN.mp4` (effects venv). When it lists a moment, move the word, change its colour or pick another shot.


`npm run verify` reads the stills as usual, and `build/oneword.json` lists every word with its face, size, the line under it and whether it sat on a card. Read a few cards and a few heroes before you ship.
