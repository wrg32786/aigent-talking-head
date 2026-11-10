# Changelog

## 1.2.0 (unreleased)

Edit rules from the Muse reel workflow, plus parts of a motion design pack, adapted to 1080x1920 at 24 fps.

- **Kinetic captions by default.** Every spoken word animates in; key words go big in the display font and accent colour; an optional script accent. `--look kinetic|muse|classic`, `--style kinetic|pill|hormozi|karaoke|classic`. `"captionStyle": "classic"` keeps the old look.
- **Kinetic titles behind the head.** One per beat, 7 entrances, no repeats, flicker on the hook and payoff only. The person is cut out with `kit/mask.py` (MediaPipe, from the effects venv). `--no-titles`, `--no-mask`.
- **Font pairings.** `--fonts modern|druk|elegant|editorial` (OFL Google Fonts, committed with their licences), or your own in the gitignored `kit/fonts/local/`.
- **Multi-take picking.** `clip.py` takes several files, matches sentences across takes and keeps the best one; `--hook <take>`. `npm run reel` uses every video from the newest session in `inbox/`.
- **Zoom punch.** 10% on every other cut, plus a 12% eased big punch after the hook and into the payoff. `"punch"`, `"bigPunch"`, `"zoom"`, `"punchY"`, `--no-punch`.
- **Named transitions.** 50 names mapped to ffmpeg xfade modes in `kit/transitions.json`. The glitch seam stays the default.
- **Sound rules.** Locked set `whoosh`, `swipe`, `boom`, `click`, `typing` (mono 48 kHz WAV, CC0). Fewer and deeper; `npm run check` flags a sound on every cut.
- **`npm run check`** lints copy (em dashes, "not X but Y", staged run-ups, hype words), titles, transitions, sounds and script shape.
- **`npm run verify -- <job>`**: ffprobe (1080x1920, 24 fps, H.264 + AAC 48 kHz, duration), loudness, title and punch stills, contact sheet, mask alpha, copy lint. Mandatory before delivery.
- Effects keep words and titles out of their way: `captions: off` hides them, `check` moves the caption track up.
- `effects/CATALOG.md` has an "Everything available" count.
- Fix: segments whose video ends a frame before their audio no longer leave gaps (and a variable frame rate) in the cut, and the tail and pad holds now actually add frames.
