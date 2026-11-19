# Brand presets

Shipped JSON files for `npm run reel -- --preset <name>`. Each one is a mix of existing options (theme, look, caption style, fonts, finish pool, transition, effect favourites, optional bed, and the editing options: `cards`, `cardPalette`, `musicEnergy`, `sfxMap`, `sfxCap`, `punch` as a number, `tighten`, `glitch`, `titlePlaces`, `entranceOrder`). `magazine.json` turns on every editing principle (docs/guide.md "Editing principles built in").

User-saved presets go in `local/` (gitignored). A local file of the same name overrides the shipped one. Drafts from `npm run brand:import` land there too; confirm them before you ship a reel.

See the README in the repo root, and `npm run preset -- --list`.

To share a look with its locks (transitions, title entrances, graphics and more pinned) and a preview, make it a style pack: `npm run pack:new -- <name> --from <preset>`. See docs/packs.md.
