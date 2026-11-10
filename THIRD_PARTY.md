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
| `kit/fonts/*.ttf` | [Google Fonts](https://github.com/google/fonts): Archivo Black, Allura, Pinyon Script, Unbounded, Hanken Grotesk, Marcellus, Instrument Serif, Crimson Pro, Libre Caslon Text. Unmodified. | SIL Open Font License 1.1, each with its `OFL-<name>.txt`. Marcellus has the Reserved Font Name "Marcellus". |
| `effects/vendor/claude-video-effects/` | Vibha Ramprakash, see `NOTICE` | MIT (models and fonts keep their own licences) |

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

## Linked, not included

- [rea-video](https://github.com/JuneYaooo/rea-video) (Apache-2.0) and [instaloader](https://github.com/instaloader/instaloader) (MIT): optional tools for the reference-teardown step in the talking-head-ad skill. Install them yourself if you want that step.
- Not used at all: ViralCutter (GPL), react-bits, GSAP.
- Commercial fonts the pairings stand in for (Druk, Helvetica, Optitimes, Sloop, Vanguard, Athelas) are not included. Put your own licensed copies in `kit/fonts/local/`, which is gitignored.
