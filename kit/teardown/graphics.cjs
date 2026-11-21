// Teardown converter (kit/videomd2reel.cjs): stickers, app labels and screen cards.
'use strict';
const fs = require('fs');
const path = require('path');
const { r2, clean } = require('./util.cjs');

// teardown.py's graphics -> Reel.md graphics. An ordinal word OCR missed is guessed from its place in the list (text~);
// the label is whatever OCR read under or beside the tile. No icons or screenshots are carried
// over: the remake draws placeholders until you add your own files (icon / src).
const ORD = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH'];
function mapGraphics(b, extras) {
  const cl = (v, a, z) => Math.min(z, Math.max(a, v));
  let last = -1;
  const out = [];
  for (const g of extras.graphics || []) {
    const o = { type: g.type, start: r2(g.start), end: r2(g.end), samples: g.samples, bbox: g.type === 'ordinal-sticker' ? null : g.bbox };
    if (g.type === 'ordinal-sticker') {
      const k = g.text ? ORD.indexOf(g.text) : -1;
      const idx = k >= 0 ? k : last + 1;
      last = idx;
      // the burst is seen whole across (its width, when fully grown) but cut off below by the person, so its centre is
      // one radius down from its top edge; size is the radius in pixels on a 1080-wide frame. head and head-y carry it
      // relative to the head (width in head widths, centre below the head centre in head widths) so the remake can
      // frame your head the same way.
      const wid = g.width || (g.bbox && g.bbox[2]), cy = g.bbox && wid ? g.bbox[1] + wid * 1080 / 1920 / 2 : null;
      Object.assign(o, { text: g.text || ORD[idx] || 'NEXT', guess: !g.text || k < 0, cue: g.cue, layer: g.layer || 'front', color: g.color,
        x: g.bbox && g.bbox[2] > 0.5 ? r2(cl(g.bbox[0] + g.bbox[2] / 2, 0.2, 0.8)) : 0.5,
        y: cy != null ? r2(cl(cy, 0.18, 0.5)) : 0.3,
        ...(wid ? { size: Math.round(cl(wid * 1080 / 2, 180, 560)) } : {}),
        // a spiky starburst keeps its shape and point count; the round seal is the default and carries nothing
        ...(g.shape === 'starburst' ? { shape: 'starburst', spikes: Math.round(cl(+g.spikes || 12, 6, 24)) } : {}),
        ...(g.head_ratio && g.face_w && g.head_cy && cy != null ? { head: r2(g.head_ratio), headY: r2((cy - g.head_cy) * 1920 / (g.face_w * 1080)), faceW: g.face_w } : {}) });
    } else if (g.type === 'app-label') {
      Object.assign(o, { text: clean(g.text), cue: g.cue, tile: g.tile, x: g.bbox ? r2(cl(g.bbox[0], 0.02, 0.7)) : 0.08, y: g.bbox ? r2(cl(g.bbox[1], 0.05, 0.85)) : 0.5,
        ...(g.bbox ? { size: Math.round(cl(g.bbox[2] * 1080, 120, 320)) } : {}) });
    } else if (g.type === 'screen-card') {
      // what was shown (OCR inside the card) and any web address read in it: a suggested source to confirm
      const shown = (g.shown || []).map(clean).filter(Boolean);
      const url = (g.urls || [])[0];
      Object.assign(o, { border: g.border, uiText: g.ui_text, y: g.bbox ? r2(cl(g.bbox[1] + g.bbox[3] / 2, 0.3, 0.8)) : 0.68, w: g.bbox ? r2(cl(g.bbox[2] + 0.04, 0.4, 0.92)) : 0.66,
        shown, subject: shown[0] ? shown[0].slice(0, 60) : null, ...(url ? { sourceGuess: /^https?:/i.test(url) ? url : 'https://' + url } : {}) });
    } else continue;
    out.push(o);
  }
  // the tool named nearest before each screen card (an app label in the 12 s before it, or during it): what to look for
  for (const c of out.filter(x => x.type === 'screen-card')) {
    const near = out.filter(x => x.type === 'app-label' && x.start <= c.end && x.start >= c.start - 12).sort((a, z) => z.start - a.start)[0];
    if (near) c.named = near.text;
  }
  return out;
}

// a sticker's own image (rea-video packaging/sticker_NN.jpg, or the file it names), as a data: URL for a scene
function stickerImage(st, i, dir) {
  if (!dir) return null;
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  for (const f of [st.file, st.image, st.path, st.src, `packaging/sticker_${String(i + 1).padStart(2, '0')}.png`, `packaging/sticker_${String(i + 1).padStart(2, '0')}.jpg`].filter(Boolean)) {
    const abs = path.isAbsolute(String(f)) ? String(f) : path.join(dir, String(f)), m = MIME[(abs.split('.').pop() || '').toLowerCase()];
    try { if (m && fs.statSync(abs).size < 1.5 * 2 ** 20) return `data:${m};base64,${fs.readFileSync(abs).toString('base64')}`; } catch {}
  }
  return null;
}

module.exports = { mapGraphics, stickerImage, ORD };
