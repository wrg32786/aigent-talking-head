# Demo reel

A 40-second reel made with this kit from one phone recording session: 20 effects, each landing as Will says its name. The whole edit is the plan files in this folder.

[![Four frames from the demo reel](poster.jpg)](demo-reel.mp4)

`demo-reel.mp4` is the finished reel scaled to 720x1280 for the repo. The master is 1080x1920. `before-after.gif` is a short loop of the same take: the phone clip on the left, the finished reel on the right.

## What's here

| File | What it is |
|---|---|
| `demo-reel.mp4` | The reel: 40.5 s, -14.3 LUFS, true peak -1.0 dBTP (`npm run verify`). |
| `before-after.gif` | A short loop: the phone clip beside the finished reel (spotlight, backdrop-word, orbit). `before-after.jpg` is a still from it. |
| `cut.json` | The edit: 20 segments from two takes of the same script, 26 effect sounds, and the `yeehaw` music bed ducked under the voice. |
| `fx.json` | The effects plan: one effect per segment, each starting on its cut. |
| `captions.js` | Kinetic captions for the lines where the effect has no text of its own. |
| `fonts-demo.json` | The font pairing: Unbounded caps over small tracked Inter. |

## How it was built

```
npm run fx -- --name demo-v2 --plan jobs/demo-v2/fx.json --mask birefnet
npm run verify -- demo-v2
```

`npm run fx` assembles the cut from `cut.json`, renders the captions, cuts the speaker out of each frame and runs the effects in `fx.json`.

The plan files are for reading. They won't re-run as they stand, because three things live in the job folder, which is not in git: the two source takes, the 12 cover images that `orbit`, `carousel-spin`, `fan-build` and `place-in-grid` use, and 22 CC0 effect sounds from [ANVEAI/motion-pack](https://github.com/ANVEAI/motion-pack).

## What to copy from it

- **Effects land on the word.** Every cut sits 0.1 s before the word, and the effect starts on the cut. Word onsets were measured from the audio, because Whisper's word times drifted on these takes.
- **Words sit behind the head.** The cap cuts into every behind-head word. `backdrop-word` does it on its own (tall type, letters rising in one by one); `huge-strike`, `spotlight` and `crayon-write` carry `"drop"`. Drop too far and the word stops reading: `huge-strike` sits at 0.2. A word floating clear above the head misses the point of the effect.
- **Captions step aside.** Only the lines whose effect has no text of its own get a caption.
- **Sounds are levelled against the mix.** Each effect sound was measured against the voice and music at its moment, and the buried ones were raised.

## Rights

The footage shows Will Gwyn, including the before/after loop, and is for The AIgent's own use; it is not covered by the repo's Apache-2.0 licence. The music bed (`kit/music/yeehaw.mp3`) is [CC0 1.0](../../music/LICENSE.md).
