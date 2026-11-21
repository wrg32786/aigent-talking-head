// Teardown converter (kit/videomd2reel.cjs): brand colours, the nearest theme and the job transition.
'use strict';
const fs = require('fs');
const path = require('path');
const { hexOK } = require('./util.cjs');

const KIT = path.dirname(__dirname);

function lum(h) { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
function satOf(h) { const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return mx ? (mx - mn) / mx : 0; }
// the job's transition: the one the reference uses most between shots (none when it only cuts)
function jobTransition(shots) {
  const n = {}; for (const s of shots.slice(1)) if (s.tx && s.tx.name) n[s.tx.name] = (n[s.tx.name] || 0) + 1;
  const top = Object.entries(n).sort((a, z) => z[1] - a[1])[0];
  return top && top[1] * 3 >= Math.max(1, shots.length - 1) ? top[0] : 'none';
}
// the kit theme closest to the reference's colours (its accent against each theme's accent, its darkest against the
// theme's ink); the reference's accent then goes on top (reel.cjs). No colours read: neutral, the unbranded look.
function themeFor(colours) {
  if (!colours.length) return 'neutral';
  const rgb = h => { const p = parseInt(h.slice(1), 16); return [p >> 16, (p >> 8) & 255, p & 255]; }, d = (a, c) => Math.hypot(...rgb(a).map((v, i) => v - rgb(c)[i]));
  const dark = colours.slice().sort((a, c) => lum(a) - lum(c))[0];
  let best = 'neutral', bd = Infinity;
  for (const f of fs.readdirSync(path.join(KIT, 'themes')).filter(x => x.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(KIT, 'themes', f), 'utf8'), acc = (/accent:\s*'(#[0-9a-f]{6})'/i.exec(t) || [])[1], ink = (/ink:\s*'(#[0-9a-f]{6})'/i.exec(t) || [])[1];
    if (!acc || !ink) continue;
    const score = Math.min(...colours.map(c => d(c, acc))) + 0.5 * d(dark, ink) + (f === 'aigent.js' ? 60 : 0); // our brand only when it is clearly the match
    if (score < bd) { bd = score; best = f.replace(/\.js$/, ''); }
  }
  return best;
}
function brandColours(b, titles, graphics = []) {
  const out = [];
  const add = h => { if (hexOK(h) && !out.some(x => dist(x, h) < 60)) out.push(h.toLowerCase()); };
  const dist = (a, c) => { const p = parseInt(a.slice(1), 16), q = parseInt(c.slice(1), 16); return Math.hypot((p >> 16) - (q >> 16), ((p >> 8) & 255) - ((q >> 8) & 255), (p & 255) - (q & 255)); };
  // accent first: saturated title and caption colours
  // the graphics' own colours (sticker fill, app tile) count as text colours: they are the reference's accents
  const texts = [...titles.map(t => t.fill), ...graphics.flatMap(g => [g.keys && g.keys.color, g.keys && g.keys.tile, g.color, g.tile]), ...((b.packaging || {}).text_cues || []).filter(c => c.kind === 'subtitle').flatMap(c => [c.style && c.style.fill, c.style && c.style.box_color])];
  texts.filter(h => hexOK(h) && satOf(h) > 0.35).forEach(add);
  texts.filter(h => hexOK(h)).forEach(h => { if (out.length < 3) add(h); });
  (b.x_palette || []).map(p => p.hex).sort((a, c) => lum(a) - lum(c)).forEach(h => { if (out.length < 5) add(h); });
  return out.slice(0, 5);
}

module.exports = { brandColours, themeFor, jobTransition, lum, satOf, hexOK };
