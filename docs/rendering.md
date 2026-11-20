# Overlay rendering

`kit/render.mjs` draws the captions, titles and graphics (`kit/overlay.html`, one 1080x1920 canvas) into PNG frames, one folder per layer: `ovl/` (in front of the person), `ovlt/` (titles behind the head) and `ovlp/` (screen cards behind the head). `kit/assemble.cjs` lays them over the cut with the person mask.

## How frames are captured

Since 1.12.0 Chrome encodes each frame itself (`kit/framecap.mjs`):

1. The page draws a frame with `window.seek(t, layer)`.
2. It copies the canvas (`createImageBitmap`) and hands the copy to one of up to 3 encode workers, which turn it into a PNG (`OffscreenCanvas.convertToBlob`). The page draws the next frame meanwhile.
3. Up to 3 pages draw at once, each taking the next 12 frames when it is free. The count comes from the CPU threads (about one page per 3) and free memory (about 600 MB a page). `RENDER_PAGES=<n>` sets it.

The files are the same PNG frames as before, so nothing that reads them changed. Before any frame is kept, each page draws the reel once at 5 moments a second and waits for the fonts and images that started loading.

Before 1.12.0 every frame was a page screenshot, which reads the whole page back out of Chrome and encodes it on one thread. That path is kept:

- `RENDER_CAPTURE=screenshot` uses it for the whole render.
- If the fast path cannot start (no workers or OffscreenCanvas in that Chrome), render.mjs prints `note: fast frame capture is off (...)` and uses screenshots.
- If it fails part way (for example an image from a file on the canvas, which Chrome will not let a page read), render.mjs prints `note: fast frame capture stopped at frame N (...)`, and that page uses screenshots from there on. The frames already written stay.

Every run prints one line such as `capture: 2160 frames in 28.2 s (77 fps), in-page PNG, 2 pages`.

## Why not WebCodecs video

The idea comes from [motlab](https://github.com/staryone/motlab) (MIT), which draws on a canvas and encodes inside Chrome with WebCodecs instead of taking screenshots. The overlay layers need an alpha channel, and Chrome's `VideoEncoder` cannot keep one: `alpha: 'keep'` is reported unsupported for VP8, VP9, AV1 and H.264 (Chrome 156; `node kit/render-bench.mjs` prints what your Chrome says). Encoding colour and alpha as two lossy streams would change the edges of every letter and every tool that reads the frames. Encoding PNG inside Chrome keeps the frames lossless and gets most of the speed, because the slow part of a screenshot is reading the page back, not the PNG itself.

## Measured

`node kit/render-bench.mjs --assemble` on a 30 s reel at 1080x1920, 24 fps, with all three layers (the Awakening hero captions plus a title behind the head, a front title, a lower third, a stat callout, a screen card and a versus card behind the head, a logo plate, glitches and a face track: 2160 frames). Assembled on synthetic footage with a person mask and a head mask. Measured on the build box: a cloud Linux VM, Intel Xeon, 8 threads, 15.6 GB, **no GPU** (Chrome draws in software), Chrome 156.

| | Screenshots (before) | In-page PNG (1.12.0) |
|---|---|---|
| Frame capture | 160.8 s | 28.2 s (5.7x) |
| render.mjs in all | 163.1 s | 30.7 s (5.3x) |
| assemble.cjs | 43.0 s | 43.4 s |
| render plus assemble | 206.1 s | 74.1 s (2.8x) |

All 2160 frames were pixel identical to the screenshot frames, and the finished reels compare at SSIM 1.000000. The film grain is random per render, so two reels are never bit identical.

A full `npm run reel` also cuts, transcribes and masks, and those steps did not change, so the saving on a whole reel is the render time above. With a GPU, Chrome draws on the GPU; this has not been measured yet.

Chrome now and then draws a title's soft shadow a shade differently, with screenshots too. `tests/framecap.e2e.mjs` (in `npm run smoke`) accepts a frame that is pixel identical or has SSIM 0.995 or more over grey; such frames measured 0.998 or more.

## Disk

Chrome's PNG encoder compresses less than the screenshot encoder, so the frame folders are about twice the size (about 200 MB for the 30 s reel with three layers, against about 100 MB). They are working files in `build/`.

## Screen recordings

A screen recording on a screen card goes to the page as data URLs (up to 96 MB in all), like logos and images. A frame from a file taints the canvas: before 1.12.0 that also kept the layout pass from moving captions clear of the card, so a caption could sit on top of the recording. Past 96 MB the frames stay files, and the capture falls back to screenshots once the card shows.
