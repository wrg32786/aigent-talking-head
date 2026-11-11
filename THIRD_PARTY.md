# Third-party material

What this repo ships from other projects, and what it only took ideas from. Licences were checked on Nov 10, 2026.

## Shipped files

| Path | From | Licence |
|---|---|---|
| `kit/sfx/F-cinematic-woosh-648729.mp3`, `kit/sfx/whoosh.wav` | "Cinematic Woosh SFX-010" by AudioPapkin, Freesound 648729 (WAV is a mono 48 kHz conversion) | CC0 1.0 |
| `kit/sfx/D-quick-woosh-683101.mp3`, `kit/sfx/swipe.wav` | "quick woosh" by florianreichelt, Freesound 683101 (WAV is a mono 48 kHz conversion) | CC0 1.0 |
| `kit/sfx/boom.wav` | [ANVEAI/motion-pack](https://github.com/ANVEAI/motion-pack) `snd.hit.deep_impact`, commit `33f36b3f1a3c69a12352cf2a55e29b446cfeb991`, trimmed to 2.4 s with a fade, mono 48 kHz | CC0 1.0 (motion-pack `LICENSE-MEDIA`, which covers its synthesized sound masters and previews) |
| `kit/sfx/click.wav` | motion-pack `snd.ui.click`, same commit, mono 48 kHz | CC0 1.0 |
| `kit/sfx/typing.wav` | motion-pack `snd.ui.typing_burst`, same commit, mono 48 kHz | CC0 1.0 |
| `kit/sfx/hit/01-cinematic-hit-a.mp3`, `hit/02-cinematic-hit-b.mp3`, `riser/03-riser-tension.mp3`, `whoosh/05-whoosh-fast.mp3`, `whoosh/06-whoosh-cinematic-deep.mp3`, `whoosh/07-whoosh-whip.mp3`, `swipe/08-swipe-up.mp3`, `swipe/09-swipe-down.mp3`, `pop/10-pop-bubble.mp3`, `pop/11-pop-sticker.mp3`, `glitch/15-glitch-digital-a.mp3`, `glitch/16-glitch-digital-b.mp3`, `sub/22-sub-drop.mp3` | [DAEDAL Transition SFX Pack](https://daedal.art/resources/transition-sfx-pack/) | CC0 1.0 |
| `kit/sfx/ui/14-ui-notification.mp3` | [DAEDAL UI Sounds](https://daedal.art/resources/ui-sounds/) | CC0 1.0 |
| `kit/sfx/ui/12-ui-click-glass.mp3`, `ui/13-ui-tick.mp3`, `shimmer/23-shimmer-sparkle-a.mp3` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) (also [OpenGameArt](https://opengameart.org/content/interface-sounds)); 13 is a 3-hit burst of `tick_002` | CC0 1.0 |
| `kit/sfx/camera/17-camera-shutter.mp3` | themightyglider, [OpenGameArt camera](https://opengameart.org/content/camera), rearranged from [CameraShutterSound](https://archive.org/details/CameraShutterSound) | CC0 1.0 |
| `kit/sfx/paper/19-paper-scribble.mp3` | `pencil_write` by NachtmahrTV, [Freesound 571800](https://freesound.org/s/571800/), via the [OpenGameArt pencil pack](https://opengameart.org/content/pencil-sounds) compiled by AntumDeluge | CC0 1.0 |
| `kit/sfx/counter/20-cha-ching.mp3` | artisticdude, [RPG Sound Pack](https://opengameart.org/content/rpg-sound-pack) `coin2.wav` | CC0 1.0 |
| `kit/sfx/camera/18-camera-flash.mp3`, `counter/21-counter-tickup.mp3`, `shimmer/24-shimmer-sparkle-b.mp3`, `riser/25-riser-pitch-sweep.mp3`, `riser/26-riser-supersaw-swell.mp3`, `riser/27-riser-pulse-accel.mp3`, `riser/28-riser-shepard.mp3`, `release/29-release-downlifter.mp3`, `release/30-release-pad-bloom.mp3`, `release/31-release-airy-exhale.mp3`, `release/32-release-resolve-chord.mp3` | Original cinematic synths written for this pack, dedicated CC0 1.0 | CC0 1.0 |
| `kit/fonts/*.ttf` | [Google Fonts](https://github.com/google/fonts): Archivo Black, Allura, Pinyon Script, Unbounded, Hanken Grotesk, Marcellus, Instrument Serif, Crimson Pro, Libre Caslon Text, Literata, Bricolage Grotesque, Gloock, Pirata One, Nunito Sans, Michroma, Cardo, Red Hat Display, Red Hat Mono, Plus Jakarta Sans, Ribeye, Caprasimo, League Spartan, Fraunces, Inter Tight, Chewy. Unmodified. | SIL Open Font License 1.1, each with its `OFL-<name>.txt`; Chewy is Apache-2.0 (`LICENSE-chewy.txt`). Marcellus has the Reserved Font Name "Marcellus". |
| `effects/vendor/claude-video-effects/` | Vibha Ramprakash, see `NOTICE` | MIT (models and fonts keep their own licences) |

## Adapted from Will's other work

- **Beat grid and film-finish looks** (`kit/beats.py`, `kit/beats.cjs`): the librosa analysis (tempo, beats, onsets, RMS energy, drop spikes plus an intensity filter) and the ffmpeg-builtin film looks (grain, vignette, chromatic aberration, scan lines, colour grades) are adapted from Will Gwyn's private `music-video` project (`pipeline/audio_analysis.py`, `pipeline/effects_planner.py`, `pipeline/scene_effects.py`). Relicensed Apache-2.0 by the author for this repo. No brand portraits, project files, LUT `.cube` files or light-leak overlays were copied.

## Ideas adapted (no code copied)

- **Transition names** (`kit/transitions.json`): the mapping of friendly names to stock ffmpeg `xfade` modes follows motion-pack's `transitions/lib/xfade.js`. motion-pack code is MIT; the map was rewritten as JSON here.
- **Hormozi and karaoke caption looks** (`kit/overlay.html`): the presets follow [Capite](https://github.com/muneebkhan08/Capite) (white bold caps with a cyan active word and a heavy outline; a colour wipe as each word is said). No Capite code is included. Capite is MIT:

  > MIT License
  >
  > Copyright (c) 2026 Capite Contributors
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

- **Title entrances** (`kit/overlay.html`): the seven entrance styles were written from scratch for canvas, with [nexu-io/motion-anything](https://github.com/nexu-io/motion-anything) (Apache-2.0) as a visual reference only.

## Installed at setup, not vendored

These are fetched by `npm run effects:setup` (and the BiRefNet weights on first `kit/mask.py --model birefnet`, or `npm run effects:setup -- --birefnet`). They are not in git. Licences were checked from the primary sources on Nov 10, 2026.

| What | From | Licence |
|---|---|---|
| rembg (Python package) | [danielgatis/rembg](https://github.com/danielgatis/rembg), [LICENSE.txt](https://github.com/danielgatis/rembg/blob/main/LICENSE.txt) | MIT, Copyright (c) 2020 Daniel Gatis. Covers rembg's code only, not third-party model weights. |
| onnxruntime (Python package) | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime), [LICENSE](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) | MIT, Copyright (c) Microsoft Corporation. |
| librosa (Python package) | [librosa/librosa](https://github.com/librosa/librosa), [LICENSE.md](https://github.com/librosa/librosa/blob/main/LICENSE.md) | ISC. Beat / onset / energy analysis in `kit/beats.py`. Pulled in by `pip install -r requirements.txt`, not in git. Runtime deps (numpy, scipy, soundfile, numba, and soxr for resampling) stay at install time; soxr is LGPL-2.1, same class of requirement as the ffmpeg binary already needed by the kit. |
| birefnet-general-lite weights (`BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`, md5 `4fab47adc4ff364be1713e97b7e66334`) | Hosted by rembg at [releases/v0.0.0](https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx). Upstream: [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet), [LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE). The author confirmed that the released checkpoints are also MIT ([issue 316](https://github.com/ZhengPeng7/BiRefNet/issues/316)); the [BiRefNet_lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite) model card is `license: mit`. | MIT, Copyright (c) 2024 ZhengPeng. Cached by rembg (typically `~/.rembg/models/birefnet-general-lite/`), about 214 MB. |

Do not use rembg's default `bria-rmbg` model with this kit: RMBG-2.0 has a separate BRIA licence that requires a paid agreement for commercial use.

## Linked, not included

- [rea-video](https://github.com/JuneYaooo/rea-video) (Apache-2.0) and [instaloader](https://github.com/instaloader/instaloader) (MIT): optional tools for the reference-teardown step in the talking-head-ad skill. Install them yourself if you want that step.
- Not used at all: ViralCutter (GPL), react-bits, GSAP, Robust Video Matting (RVM, GPL-3.0). RVM was tried for a one-off hero-reel mask and must stay out of the repo.
- Commercial fonts the pairings stand in for (Druk, Helvetica, Optitimes, Sloop, Vanguard, Athelas) are not included. Put your own licensed copies in `kit/fonts/local/`, which is gitignored.
