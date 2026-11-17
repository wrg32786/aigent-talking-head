# Showcase

Labelled contact sheets of every effect, graphic, film finish, title entrance, caption style, font pairing and preset. The root README shows these too.

![Effects](sheets/effects.jpg)

![Graphics](sheets/graphics.jpg)

![Film finishes](sheets/finishes.jpg)

![In front versus behind the head](sheets/title-layer.jpg)

![Title entrances, animated and labelled](../docs/menu/sheets/titles.webp)

![Caption entrances, animated and labelled](../docs/menu/sheets/caption-entrances.webp)

![Caption styles, animated and labelled](../docs/menu/sheets/caption-styles.webp)

![Transitions, animated and labelled](../docs/menu/sheets/transitions.webp)

The animated grids come from the [effects menu](../docs/effects.md) (`npm run menu:render`), which lists each one with its exact name.

![Font pairings](sheets/fonts.jpg)

![Presets](sheets/presets.jpg)

Every option, one tile at a time, is in the [full gallery](GALLERY.md).

Open [index.html](index.html) from a full clone or zip of the repo, or serve this folder. If you download only that HTML file, the images will not load. Rebuild with `npm run showcase` from the repo root (needs ffmpeg, Chrome, Pillow, and `npm run effects:setup` for the 51 effect stills and the person mask). Stills use `source/presenter.jpg`, an AI-generated fictional person made for this project, licensed Apache-2.0 with the repo. No private footage and no third-party portraits.

This folder is GitHub Pages-ready (`.nojekyll`). Repo settings and workflows are not changed by the generator.
