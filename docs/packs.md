# Style packs

A style pack is a whole look in one folder: the base preset, any style keys on top, locks that pin your choices, transition weights, and a preview. The auto-picker only chooses inside the locks, so you get variety without losing control.

Use one: `npm run reel -- <clip> --pack <name>`. See every option first: [docs/effects.md](effects.md) (animated) or `npm run list -- <kind>`.

## Gallery

### aigent  (v1.0.0)

AIgent house style: kinetic type, cyan accent, glitch seams with a few whips and zooms (the default)

<img src="../packs/aigent/preview.webp" width="180" alt="aigent preview: stagger-rise title, kinetic captions, glitch transition">

- Use it: `npm run reel -- <clip> --pack aigent`
- Starts from preset: `aigent`; theme `aigent`, look `kinetic`, captions `kinetic`, fonts `theme`
- Locks: transitions glitch, whip, zoom; finishes grain, vignette
- Folder: [packs/aigent](../packs/aigent)

### cinematic  (v1.0.0)

Cinematic: teal and orange grade, film dissolves and dips, slow reveals

<img src="../packs/cinematic/preview.webp" width="180" alt="cinematic preview: blur-rise title, kinetic captions, film transition">

- Use it: `npm run reel -- <clip> --pack cinematic`
- Starts from preset: `cinematic`; theme `aigent`, look `kinetic`, captions `kinetic`, fonts `editorial`
- Locks: transitions film, dissolve, dip-black, fade-slow; titles blur-rise, drop, typewriter, stagger-rise; max 4 titles; finishes teal, grain, vignette, crushed
- Folder: [packs/cinematic](../packs/cinematic)

### hormozi-bold  (v1.0.0)

Bold: heavy caps, cyan on the spoken word, punchy glitch, whip and flash cuts

<img src="../packs/hormozi-bold/preview.webp" width="180" alt="hormozi-bold preview: slam title, hormozi captions, glitch transition">

- Use it: `npm run reel -- <clip> --pack hormozi-bold`
- Starts from preset: `hormozi-bold`; theme `aigent`, look `kinetic`, captions `hormozi`, fonts `druk`
- Locks: transitions glitch, whip, zoom, flash; titles slam, pop-zoom, elastic, drop; finishes grain, crushed
- Folder: [packs/hormozi-bold](../packs/hormozi-bold)

### magazine  (v1.0.0)

Magazine: serif and sans mixed, colour and chapter cards, soft crossfades, typewriter first

<img src="../packs/magazine/preview.webp" width="180" alt="magazine preview: typewriter title, kinetic captions, crossfade transition">

- Use it: `npm run reel -- <clip> --pack magazine`
- Starts from preset: `magazine`; theme `magazine`, look `kinetic`, captions `kinetic`, fonts `playfair`
- Locks: transitions crossfade, dissolve, fade-fast; titles typewriter, blur-rise, pop-zoom, stagger-rise, slide-left, drop; max 6 titles
- Folder: [packs/magazine](../packs/magazine)

### minimal-clean  (v1.0.0)

Minimal: quiet type, hard cuts only, no grade, no cards

<img src="../packs/minimal-clean/preview.webp" width="180" alt="minimal-clean preview: classic captions, cut transition">

- Use it: `npm run reel -- <clip> --pack minimal-clean`
- Starts from preset: `minimal-clean`; theme `neutral`, look `classic`, captions `classic`, fonts `theme`
- Locks: transitions cut; finishes none; no cards
- Folder: [packs/minimal-clean](../packs/minimal-clean)

### neutral  (v1.0.0)

Neutral: unbranded, system fonts, hard cuts with the odd crossfade

<img src="../packs/neutral/preview.webp" width="180" alt="neutral preview: stagger-rise title, kinetic captions, cut transition">

- Use it: `npm run reel -- <clip> --pack neutral`
- Starts from preset: `neutral`; theme `neutral`, look `kinetic`, captions `kinetic`, fonts `theme`
- Locks: transitions cut, crossfade; finishes none
- Folder: [packs/neutral](../packs/neutral)

## Take control

Three ways to pin what the kit picks, from lightest to most exact:

1. **Lock on the command line.** Locks win over the pack and the auto-picker:
   ```
   npm run reel -- inbox/take.mov --pack magazine --lock "transitions=whip,zoom; titles=typewriter; no-graphics=checklist"
   ```
   Keys: `transitions`, `titles` (title entrances), `max-titles`, `caption-entrance`, `graphics` (only these), `no-graphics`, `finishes` (`none` for no finish), `cards=off`, `sfx=off`, `punch` (`off` or 0.02 to 0.3).
2. **See what was picked, then change it.** Every draft writes `jobs/<job>/choices.json` and prints a table: each beat's transition, finish and punch, each title's entrance, place and layer, each graphic, the music and the sounds, with the reason for each pick (locked, from the pack, from the recipe, or the kit's default).
   ```
   npm run choices -- <job>              # print the table again
   # edit jobs/<job>/choices.json: change a transition or an entrance, set "keep": false on a graphic
   npm run choices -- <job> --apply      # write your edits into the job
   npm run reel -- --rebuild --name <job>
   ```
   Or pin a lock on an existing job: `npm run choices -- <job> --lock "titles=typewriter"`, then rebuild.
3. **Save it as a pack.** `npm run pack:new -- my-look --from <preset|pack|job>` writes `packs/local/my-look/` with `pack.json` and a README. Edit the style keys and locks, then `npm run pack:validate -- my-look` and `npm run pack:preview -- my-look`.

Agents get the same through the MCP server: `list_packs`, `get_pack`, `explain` (the choices table) and `set_locks`, and `render` takes `pack` and `lock`.

## Make your own pack

```
packs/local/my-look/
  pack.json      the pack (schema: packs/pack.schema.json)
  README.md      what it is for
  preview.webp   a looping preview (npm run pack:preview -- my-look)
  preview.png    a still strip of the same
```

`pack.json` fields:

| Field | What it does |
| --- | --- |
| `format`, `formatVersion` | `aigent-style-pack`, `1`. A breaking change to the format bumps the version, and the kit refuses versions it does not know. |
| `name`, `version`, `label` | The folder name, the pack's own semver, and a one-line label. |
| `extends` | A preset in `kit/presets` to start from. |
| `style` | Any preset key on top: theme, look, captionStyle, fonts, titles, finish, finishPool, transition, glitch, punch, tighten, cards, cardPalette, musicEnergy, bed, sfxMap, sfxCap, titlePlaces, entranceOrder, titleLayer, effectsFavourites, beatSync. |
| `locks` | Pinned choices: transitions, titles, maxTitles, captionEntrance, graphics `{ allow, deny }`, finishes, cards, sfx, punch. |
| `weights.transitions` | How often each allowed transition comes up, e.g. `{ "crossfade": 3, "dissolve": 1 }`. |
| `preview` | The preview files, `{ "webp": "preview.webp", "png": "preview.png" }`. |
| `assets` | Files the pack ships (a font, a bed, a logo), each with `path`, `license` and `source`. Only Apache-2.0, MIT, BSD, ISC, CC0 or OFL. |

Share a pack by sharing its folder. Someone drops it into `packs/local/` (or passes the path: `--pack ./my-look`) and runs `npm run pack:validate` first. Packs are data only: no code runs from a pack.

Got a pack worth showing? Open a "Show your reel" issue with the pack folder and a reel made with it.

Prefer clicking? [Studio](studio.md) shows the packs as a gallery, turns your picks from its effects menu into locks, and saves them as a new pack.
