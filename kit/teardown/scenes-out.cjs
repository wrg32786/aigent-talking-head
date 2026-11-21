// Teardown converter (kit/videomd2reel.cjs): scenes made from the reference, and where they play.
'use strict';
const fs = require('fs');
const path = require('path');
const SC = require('../scenes.cjs');
const { r2, clean } = require('./util.cjs');
const { stickerImage } = require('./graphics.cjs');

// the scenes a teardown made: beside its Reel.md (scenes.json, so the recipe carries them) and in the scene library
// (scenes/local, the menu's REF items for every job). Returns the ids added to the library.
function saveScenes(res, outDir, { library = true } = {}) {
  const sc = (res && res.scenes) || [];
  const f = path.join(outDir, 'scenes.json');
  if (!sc.length) { fs.rmSync(f, { force: true }); return []; }
  fs.writeFileSync(f, JSON.stringify({ scenes: sc }, null, 1) + '\n');
  if (!library) return [];
  const added = []; for (const s of sc) { try { const r = SC.save(s); if (r.added) added.push(r.scene.id); } catch (e) { console.warn('note: scene ' + s.id + ': ' + e.message); } }
  return added;
}

// Graphics slots the detected graphics do not cover: boxes drawn over a shot, stickers, styled labels and effects.
// Returns { extraG (lines for the Reel.md graphics block), scenes (new scenes for scenes.json and the library) }.
function placeScenes({ b, opts = {}, src, shots, graphics, titles }) {
  // boxes the reference drew over a shot (rea-video overlay.boxes) and its stickers: graphics slots, placeholders until you fill them
  const busy = (a, z) => graphics.some(g => g.start < z && a < g.end);
  const extraG = [];
  shots.forEach(s => s.boxes.slice(0, 1).forEach(x => { if (busy(s.start, s.end)) return; const [bx, by, bw] = x.bbox; extraG.push({ start: s.start, end: r2(Math.min(s.end, s.start + 4)), type: 'screen-card', keys: { y: r2(Math.min(0.8, Math.max(0.3, by + x.bbox[3] / 2))), w: r2(Math.min(0.92, Math.max(0.4, bw + 0.04))), 'subject~': `a box the reference drew (${x.band || 'frame'})` } }); }));
  // what the menu has no item for becomes a scene (kit/scenes.cjs): the sticker's own image, a styled text label, an
  // effect the reference's description names. Each goes in the menu with a REF badge and is kept for later jobs.
  const scenes = [], busy2 = (a, z) => busy(a, z) || extraG.some(g => g.start < z && a < g.end);
  const addScene = (sc, start, end, keys = {}) => { const n = SC.normal({ ...sc, from: { ...(sc.from || {}), reference: src.file || null } }); if (SC.check(n).length) return null;
    if (!scenes.some(x => x.id === n.id)) scenes.push(n); extraG.push({ start: r2(start), end: r2(end), type: 'scene', keys: { scene: n.id, ...keys } }); return n; };
  const pkgDir = b._dir || opts.dir || null;
  ((b.packaging || {}).stickers || []).slice(0, 4).forEach((st, i) => {
    const t0 = +(st.t ?? st.start ?? (st.span && st.span[0])); if (!Number.isFinite(t0) || busy2(t0, t0 + 1)) return;
    const t1 = +(st.end ?? (st.span && st.span[1])) || t0 + 1.5, what = clean(String(st.what || st.text || st.kind || 'a sticker')).slice(0, 40) || 'a sticker';
    const img = stickerImage(st, i, pkgDir);
    if (img && addScene(SC.stickerScene(img, { t: t0, what, bbox: st.bbox }), t0, Math.max(t1, t0 + 1.2))) return;
    extraG.push({ start: r2(t0), end: r2(t1), type: 'sticker-pop', keys: { ...(st.glyph ? { glyph: st.glyph } : {}), 'subject~': what } });
  });
  { // styled labels: decorative text (huazi) and boxed labels that are not your captions or a title, by look, the two most used
    const said = new Set(titles.map(t => String(t.text || '').toLowerCase()));
    const cues = (((b.packaging || {}).text_cues) || []).filter(c => c && c.style && !c.part_of_picture && (c.kind === 'huazi' || (c.kind === 'label' && (c.style.box || c.style.stroke_ratio > 0.04))) && !said.has(String(c.text || '').toLowerCase()) && Number.isFinite(+c.t0));
    const bySig = new Map(); for (const c of cues) { const sc = SC.labelScene(c), k = sc.sig; if (!bySig.has(k)) bySig.set(k, { sc, cues: [] }); bySig.get(k).cues.push(c); }
    [...bySig.values()].sort((a, z) => z.cues.length - a.cues.length).slice(0, 2).forEach(({ sc, cues: cs }) => {
      const { sig, ...scene } = sc; let n = 0;
      for (const c of cs) { if (n >= 3) break; const a = +c.t0, z = Math.max(+c.t1 || a + 1, a + 0.9); if (busy2(a, z)) continue; if (addScene({ ...scene, from: { ...scene.from, t: r2(a) } }, a, Math.min(z, a + 2.5))) n++; }
    });
  }
  { // effect scenes: a transition the kit has no name for (spin), and effects the reference's descriptions name, on the
    // shot they were seen in (rea-video VLM text per shot), then the whole video's, three at most
    const fx = [], seen = new Set();
    for (const sh of shots) { if (sh.tx && sh.tx.scene) fx.push([sh.tx.scene, sh]); for (const k of SC.effectsIn(sh.vlmText)) if (!(sh.tx && sh.tx.name === k)) fx.push([k, sh]); }  // a flash already made as the cut's transition is not made twice
    for (const k of SC.effectsNamed(b)) if (!fx.some(([x]) => x === k)) fx.push([k, null]);
    for (const [k, sh0] of fx) { if (seen.size >= 3 || seen.has(k)) continue;
      const sh = sh0 || shots[1 + seen.size * 2] || shots[0], a = Math.max(0, (sh ? sh.start : 0) - 0.1), e = SC.effectScene(k, { t: a });
      if (e && addScene(e, a, a + e.seconds)) seen.add(k); }
  }
  return { extraG, scenes };
}

module.exports = { saveScenes, placeScenes };
