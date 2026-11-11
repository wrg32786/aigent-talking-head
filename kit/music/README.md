# Music beds

Our own tracks, made by Will Gwyn with Suno. Use one by name:

```
npm run reel -- inbox/my-take.mov --bed vinyl-sunrise
```

or put the name in `cut.json` as `"bed": "vinyl-sunrise"`. A path to your own file still works (`--bed music.wav`).

| Name | Track | Length |
|---|---|---|
| `awaken-freedom` | Awaken Freedom | 0:51 |
| `chopped-and-screwed-east` | Chopped & Screwed East | 2:14 |
| `cinematic-build` | Cinematic Build | 2:38 |
| `distorted-silk-road` | Distorted Silk Road | 2:54 |
| `granular-stabs` | Granular Stabs | 2:30 |
| `houston-drumline` | Houston Drumline | 2:17 |
| `rise-with-the-bass` | Rise with the Bass | 2:36 |
| `rise-with-the-beat` | Rise with the Beat | 2:56 |
| `vinyl-sunrise` | Vinyl Sunrise | 1:35 |
| `vinyl-velocity` | Vinyl Velocity | 2:22 |
| `yeehaw` | YEEHAW | 2:30 |

`npm run music` prints the same list from `beds.json`.

## How they're stored

Every bed is loudness-matched to -13 LUFS integrated (two-pass ffmpeg loudnorm, linear gain, true peak under -1.5 dB) and saved as a 256 kbps 48 kHz stereo MP3. So the reel's default `bedVol` of 0.16 sits right under the voice for every track, and `assemble.cjs` ducks it further while anyone speaks. `beds.json` records each track's length, measured loudness and its Suno song id and creation time, read from the file's "made with suno" tag.

## Picking one

An agent can't hear. Offer the human two or three beds that fit the reel's energy, render a short audition of each under the same take, and let them pick by ear. Start the bed at a musical moment with `"bedStart"` (seconds into the track) if the opening is slow.

## Adding more

```
npm run music:add -- "C:/Users/you/Downloads/New Track.wav" ["Another.wav" ...]
```

Each file gets a name from its title (lowercase, `&` becomes `and`), is matched to -13 LUFS, checked after conversion (the script fails if the result is more than 1 LU off), and added to `beds.json`. A name that is already in the library is refused: rename the file, or pass `--replace` to overwrite that bed. Nothing in the library changes until a track has converted and passed its check. Commit the MP3 and `beds.json` together.

## Rights

These tracks are ours for The AIgent's own videos and ads. They're not covered by the repo's Apache-2.0 licence and aren't for reuse outside this project. Suno's terms tie commercial use to a paid plan at the time a song was made, so every track added here must come from a paid Suno account.
