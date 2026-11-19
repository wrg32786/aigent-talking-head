// Resolve a font pairing name (kit/fonts/pairings.json, then kit/fonts/local/pairings.json) or a pairing .json path
// into what overlay.html loads: { name, display, secondary, script, lockup } with absolute file:// URLs. 'theme' -> null.
import { existsSync, readFileSync } from 'fs';
import { dirname, join, isAbsolute, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const FONTS = join(dirname(fileURLToPath(import.meta.url)), 'fonts');
export function listPairings() {
  const read = f => (existsSync(f) ? Object.entries(JSON.parse(readFileSync(f, 'utf8')).pairings || {}).map(([k, v]) => [k, v, dirname(f)]) : []);
  return Object.fromEntries([...read(join(FONTS, 'pairings.json')), ...read(join(FONTS, 'local', 'pairings.json'))].map(([k, v, d]) => [k, { ...(v || {}), _dir: d, _null: v === null }]));
}
export function resolveFonts(want) {
  if (!want || want === 'theme') return null;
  let p, dir;
  if (/\.json$/i.test(want)) { const f = resolve(want); if (!existsSync(f)) throw new Error('No font pairing file ' + f); p = JSON.parse(readFileSync(f, 'utf8')); dir = dirname(f); }
  else { const all = listPairings(); if (!all[want]) throw new Error(`Unknown font pairing "${want}". Have: ${Object.keys(all).join(', ')}`); if (all[want]._null) return null; p = all[want]; dir = p._dir; }
  const role = r => {
    if (!r) return null;
    const out = { family: r.family, weight: r.weight || 400, style: r.style || 'normal', tracking: r.tracking, upper: r.upper, scale: r.scale };
    if (r.file) { const f = isAbsolute(r.file) ? r.file : join(dir, r.file); if (!existsSync(f)) throw new Error(`Font file missing: ${f}`); out.url = pathToFileURL(f).href; out.vf = /-VF\.|\[wght\]|Variable/i.test(r.file); }
    return out;
  };
  return { name: want, display: role(p.display), secondary: role(p.secondary), script: role(p.script), lockup: p.lockup || null, contrast: p.contrast || null };
}
