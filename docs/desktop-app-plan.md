# Plan: a double-click desktop app

Status: plan only, not built. Today the one-line installers in [docs/setup-with-ai.md](setup-with-ai.md) are the no-terminal path.

## Goal

Download one file from GitHub Releases, double-click it, and Studio opens. No Git, Node, Python or ffmpeg to install first.

## Approach

1. **Bundle the runtimes.** Ship a Node.js runtime (MIT), a static ffmpeg build (LGPL builds only, shipped as a separate binary and not linked, with its licence and source offer), and a relocatable Python (python-build-standalone, PSF and MIT) with the requirements preinstalled. Chrome is not bundled: use the user's Chrome or Edge, or download Chromium for Testing on first run.
2. **Wrapper.** A small launcher that starts `kit/studio/server.mjs` and opens the default browser (the same as `studio.sh`), with a tray or menu-bar item to quit. No Electron, so the download stays small and Studio stays a web page.
3. **Models on first run.** The Whisper model (about 470 MB) and the optional effects venv download on first use with a progress line, as now.
4. **Formats.** macOS: a signed, notarized `.app` in a `.dmg` (Apple Developer ID, about USD 99 a year). Windows: a signed `.msi` or `.exe` (a code-signing certificate; unsigned builds trigger SmartScreen). Linux: an AppImage.
5. **Build.** A release workflow that builds each format on its own runner when a version tag is pushed, signs it with secrets the owner adds, and attaches it to the GitHub Release. Updates: the app checks the latest release and offers a download; no auto-install.
6. **Data.** Jobs and the Studio session go in the user's documents folder rather than inside the app, so updates never touch their work.

## Open questions

- Which ffmpeg build and licence route to ship (LGPL-only build vs asking the user to install ffmpeg).
- Who holds the signing certificates.
- Size budget: Node, Python with faster-whisper and ffmpeg come to roughly 250 to 400 MB before models.
