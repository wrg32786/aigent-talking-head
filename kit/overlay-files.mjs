// The small script files kit/overlay.html loads next to captions.js, built the same way for a render (kit/render.mjs
// writes them into build/) and for the Studio live preview (kit/studio/preview.mjs serves them). One place, so the
// preview draws what the render draws.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveFonts } from './fonts.mjs';

const KIT = dirname(fileURLToPath(import.meta.url));

// fonts.js: a font pairing name (or several, "a,b,c", which titles take in turn) -> window.FONTS (and FONTSETS)
export function fontsDoc(want) {
  const names = (Array.isArray(want) ? want : String(want || 'theme').split(',')).map(s => String(s).trim()).filter(Boolean);
  const sets = names.map(n => resolveFonts(n) || { name: 'theme' }), fp = resolveFonts(names[0]);
  return { fp, sets, text: 'window.FONTS=' + JSON.stringify(fp) + ';\n' + (sets.length > 1 ? 'window.FONTSETS=' + JSON.stringify(sets) + ';\n' : '') };
}

// gfx.js: the graphic fonts, each graphic's default place and layer rule (kit/graphics.json), and the assets
export function gfxDoc(assets = {}, url = f => pathToFileURL(f).href) {
  const F = join(KIT, 'fonts'), GJ = JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8'));
  const defaults = Object.fromEntries(GJ.graphics.map(g => [g.mode, g.defaults || {}])), panelModes = GJ.graphics.filter(g => g.mode >= 11).map(g => g.mode);
  return { fonts: { serif: url(join(F, 'InstrumentSerif-Italic.ttf')), label: url(join(F, 'ArchivoBlack-Regular.ttf')), mono: url(join(F, 'RedHatMono-VF.ttf')), slam: url(join(F, 'Anton-Regular.ttf')), code: url(join(F, 'JetBrainsMono-VF.ttf')) }, defaults, autoBehindY: GJ.autoBehindY, panelModes, assets };
}
