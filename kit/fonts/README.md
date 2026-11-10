# Font pairings

| Pairing | Display (hero words, titles) | Secondary (body words, pills) | Script accent | Stands in for |
|---|---|---|---|---|
| `theme` | the theme's own fonts | the theme's own fonts | none | (default) |
| `modern` | Archivo Black | Hanken Grotesk 700 | Allura | a heavy grotesk + signature script |
| `druk` | Unbounded 900 | Hanken Grotesk 600 | none | Druk Wide + Helvetica |
| `elegant` | Marcellus caps | Crimson Pro 500 | Pinyon Script | Optitimes + Sloop |
| `editorial` | Instrument Serif Italic | Libre Caslon Text 500 | none | Vanguard + Athelas |

Use: `npm run reel -- inbox/take.mov --fonts druk`, or `FONTS=elegant node kit/render.mjs ...`, or `"fonts": "editorial"` in `captions.js`.

All files here are SIL Open Font License 1.1 fonts from Google Fonts (github.com/google/fonts, checked Nov 10, 2026), committed unmodified, each with its `OFL-<name>.txt`. Marcellus has the Reserved Font Name "Marcellus": don't ship a modified copy under that name. Druk, Helvetica, Optitimes, Sloop, Vanguard and Athelas are commercial and are not included.

## Your own licensed fonts

Put the files in `kit/fonts/local/` (gitignored) and add `kit/fonts/local/pairings.json` in the same shape as `pairings.json`, for example:

```json
{ "pairings": { "druk-real": {
  "display":   { "family": "Druk Wide", "file": "DrukWide-Super.otf", "weight": 900, "upper": true },
  "secondary": { "family": "Helvetica Neue", "file": "HelveticaNeue-Medium.otf", "weight": 500 } } } }
```

`file` is relative to that pairings file, or an absolute path. Then `--fonts druk-real`. You can also pass a pairing file directly: `--fonts /path/to/my-pairing.json` (one pairing object at the top level). Never commit licensed font files.
