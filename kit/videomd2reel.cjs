// VIDEO.md (a rea-video breakdown) -> Reel.md. Maps what a teardown measured onto the talking-head menu:
//   captions        -> caption style (one-word, pill, karaoke, hormozi, kinetic), look, caption position and colour
//   big on-screen text -> titles, with the nearest of the seven entrances and a front/behind hint (a word the speaker
//                      is saying, styled like the captions, is a caption word and is left out)
//   graphics        -> ordinal stickers, app labels, screen cards (kit/teardown.py extras finds them)
//   colour grade    -> nearest film finish per shot, only when the grade changes across shots or is strong
//   cuts and beats  -> shot list, punch, beat sync;  music BPM -> the closest library bed
//   palette and text colours -> brand kit colours
//
//   node kit/videomd2reel.cjs <rea-video out dir | breakdown.json | fallback.json> [--extras extras.json] [--out Reel.md] [--report teardown.md]
//
// Reads breakdown.json (rea-video's full data, or kit/teardown.py's fallback with the same field names). Everything
// it writes is a guess you should check: see "How sure is this" in docs/teardown.md.
'use strict';
const fs = require('fs');
const path = require('path');
const RM = require('./reelmd.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);
const r2 = x => Math.round(x * 100) / 100;
const pad2 = n => String(n).padStart(2, '0');

// rea-video's entrance kinds -> our seven title entrances
const ENTRANCE_MAP = { cut: 'slam', pop: 'pop-zoom', reveal: 'stagger-rise', typewriter: 'stagger-rise', fade: 'blur-rise', slide: 'slide-left', slide_in: 'slide-left', zoom: 'pop-zoom', scale: 'pop-zoom', bounce: 'elastic', flip: 'flip', rotate: 'flip', blur: 'blur-rise' };

function loadBreakdown(p) {
  let dir = p, file = p;
  if (fs.statSync(p).isDirectory()) file = path.join(p, 'breakdown.json'); else dir = path.dirname(p);
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b._dir = dir;
  return b;
}

// Big on-screen words that are not running captions, in time order. Up to ten here; convert() drops the ones a graphic
// owns (an ordinal word, an app label) and keeps seven, one per entrance.
// A word the speaker is saying at that moment is a caption word, not a title, unless it is styled apart from the
// captions: clearly bigger (1.35x the caption height), boxed, multicolour or a styled sticker (huazi). Those dropped
// are listed on the result's .dropped for the report.
function pickTitles(b, max = 10) {
  const ow = oneWordStream(b);
  const all = ((b.packaging || {}).text_cues || []).filter(c => c && c.text);
  const cues = all.filter(c => !(ow && ow.cues.has(c)));
  const hOf = c => c.line_h ?? (c.bbox ? c.bbox[3] : 0);
  const med = a => { const x = a.filter(v => v > 0).sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : 0; };
  const capRef = ow ? med([...ow.cues].map(hOf)) : med(all.filter(c => c.kind === 'subtitle' && hOf(c) >= 0.025).map(hOf));
  const spoken = ((b.speech || {}).words || []).map(w => ({ a: w[0], z: w[1], w: norm(w[2]) })).filter(w => w.w.length >= 2);
  const dropped = [];
  const sayingIt = c => {
    const ws = String(c.text).split(/[\s/|]+/).map(norm).filter(w => w.length >= 2);
    if (!ws.length || !spoken.length) return false;
    const near = spoken.filter(w => w.a <= c.t1 + 0.3 && w.z >= c.t0 - 0.8).map(w => w.w);
    const hit = ws.filter(w => near.some(n => sameWord(n, w))).length;
    return hit / ws.length >= 0.5;
  };
  const styledApart = c => (capRef && hOf(c) >= capRef * 1.35) || c.kind === 'huazi' || !!(c.style && (c.style.box || c.style.multicolor));
  const ok = c => {
    if (!c.t1 || c.t1 <= c.t0) return false;
    const txt = String(c.text).trim();
    if (c.kind === 'subtitle' || c.part_of_picture) return false;
    if ((c.conf ?? 1) < 0.6 || txt.replace(/[^A-Za-z0-9]/g, '').length < 3 || /^[@#]|\.(com|html|io)\b/i.test(txt)) return false;
    const h = hOf(c);
    if (!(h >= 0.04 && (c.t1 - c.t0) >= 0.3)) return false;
    if (capRef && sayingIt(c) && !styledApart(c)) { dropped.push({ t: r2(c.t0), text: clean(c.text), why: 'the word being said, styled like the captions' }); return false; }
    // with one-word captions, a single word in the caption band at caption size is one of them even when the
    // transcript heard it differently (Claude heard as "Clod")
    if (ow && !styledApart(c) && !/[\s/|]/.test(txt) && c.band === ow.band && h <= capRef * 1.35 && h >= capRef * 0.6 && (c.t1 - c.t0) <= 1.6) { dropped.push({ t: r2(c.t0), text: clean(c.text), why: 'one of the one-word captions (same place and size)' }); return false; }
    return true;
  };
  const cand = cues.filter(ok).map(c => ({ c, score: (c.line_h ?? c.bbox[3]) * Math.min(2, c.t1 - c.t0) * (c.conf ?? 1) * (c.bbox ? Math.min(1, c.bbox[2] * 2) : 1) }));
  cand.sort((a, b2) => b2.score - a.score);
  const picked = [];
  for (const x of cand) {
    if (picked.length >= max) break;
    if (picked.some(p => x.c.t0 < p.c.t1 + 0.4 && p.c.t0 < x.c.t1 + 0.4)) continue; // one title at a time
    picked.push(x);
  }
  picked.sort((a, b2) => a.c.t0 - b2.c.t0);
  const used = new Set();
  const out = picked.map((x, i) => {
    const kind = x.c.anim_in && x.c.anim_in.kind;
    let ent = kind ? ENTRANCE_MAP[kind] : undefined;
    if (ent && used.has(ent)) ent = undefined; // each entrance once per reel; the engine fills a free one
    if (ent) used.add(ent);
    return { n: i + 1, start: r2(x.c.t0), end: r2(Math.max(x.c.t1, x.c.t0 + 0.8)), text: clean(x.c.text), entrance: ent, seenAs: kind || 'unknown', bbox: x.c.bbox, fill: x.c.style && x.c.style.fill, band: x.c.band };
  });
  out.dropped = dropped;
  return out;
}
const clean = t => String(t).replace(/\s+/g, ' ').replace(/[|]/g, '/').replace(/\u2014/g, ',').trim();

const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
// near-equal words: OCR and ASR each drop or swap a letter now and then (brainstom / brainstorm)
function lev(a, b) { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; }
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 1);
// One big word at a time that matches the speech (the one-word caption look). rea-video files these as labels, so
// they are found by matching single big words on screen to the transcript's word times.
function oneWordStream(b) {
  const words = ((b.speech || {}).words || []).map(w => ({ t: w[0], w: norm(w[2]) })).filter(w => w.w.length >= 2);
  if (words.length < 8) return null;
  const cues = ((b.packaging || {}).text_cues || []).filter(c => c.text && String(c.text).trim().split(/\s+/).length === 1 && (c.line_h ?? (c.bbox ? c.bbox[3] : 0)) >= 0.04 && (c.t1 - c.t0) <= 1.6 && (c.conf ?? 1) >= 0.6);
  const hit = cues.filter(c => { const n = norm(c.text); return n.length >= 2 && words.some(w => Math.abs(w.t - c.t0) <= 0.8 && (w.w === n || (n.length >= 4 && (w.w.startsWith(n) || n.startsWith(w.w))))); });
  if (hit.length < 8) return null;
  const bands = {}; hit.forEach(c => { bands[c.band] = (bands[c.band] || 0) + 1; });
  const band = Object.entries(bands).sort((a, c) => c[1] - a[1])[0][0];
  return { cues: new Set(hit), band, n: hit.length, of: words.length };
}

// Running captions -> one of our caption styles.
function captionStyle(b) {
  const ow = oneWordStream(b);
  if (ow) return { style: 'one-word', why: `${ow.n} big single words on screen match the speech (${ow.of} words spoken), mostly in the ${ow.band} band`, band: ow.band, ...placeOf([...ow.cues]) };
  // tiny text (a screen recording, a UI) is not a caption
  const subs = ((b.packaging || {}).text_cues || []).filter(c => c.kind === 'subtitle' && (c.line_h ?? (c.bbox ? c.bbox[3] : 1)) >= 0.025);
  if (!subs.length) return { style: 'kinetic', why: 'no running captions found; kinetic is the house default' };
  const words = subs.map(c => String(c.text).trim().split(/\s+/).length);
  const avgW = words.reduce((a, x) => a + x, 0) / words.length;
  const avgChars = subs.reduce((a, c) => a + String(c.text).replace(/\s/g, '').length, 0) / subs.length;
  const share = f => subs.filter(f).length / subs.length;
  const boxed = share(c => c.style && c.style.box), multi = share(c => c.style && (c.style.multicolor || c.style.highlight_name));
  const caps = share(c => /[A-Z]/.test(c.text) && c.text === c.text.toUpperCase()), stroke = share(c => c.style && c.style.stroke_ratio > 0.015);
  const avgDur = subs.reduce((a, c) => a + (c.t1 - c.t0), 0) / subs.length;
  const facts = `${subs.length} caption cues, ${avgW.toFixed(1)} words and ${avgChars.toFixed(0)} letters each, ${avgDur.toFixed(2)} s on screen, boxed ${Math.round(boxed * 100)}%, highlighted ${Math.round(multi * 100)}%, upper case ${Math.round(caps * 100)}%`;
  const pl = placeOf(subs);
  if (avgW <= 1.3 && avgChars <= 9 && avgDur < 0.9) return { style: 'one-word', why: facts, ...pl };
  if (boxed >= 0.5) return { style: 'pill', why: facts, ...pl };
  if (multi >= 0.4) return { style: 'karaoke', why: facts, ...pl };
  if (caps >= 0.6 && stroke >= 0.4) return { style: 'hormozi', why: facts, ...pl };
  return { style: 'kinetic', why: facts, ...pl };
}
// Where the captions sit (top / middle / bottom from the median centre of their boxes) and their colour (the median
// fill, snapped to white or black when it is close, since OCR reads anti-aliased edges into the fill).
function placeOf(cs) {
  const ys = cs.filter(c => c.bbox).map(c => c.bbox[1] + c.bbox[3] / 2).sort((a, z) => a - z);
  const y = ys.length ? ys[Math.floor(ys.length / 2)] : null;
  const position = y == null ? null : y < 0.36 ? 'top' : y > 0.6 ? 'bottom' : 'middle';
  const fills = cs.map(c => c.style && c.style.fill).filter(hexOK).map(h => parseInt(h.slice(1), 16)).map(n => [n >> 16, (n >> 8) & 255, n & 255]);
  let color = null;
  if (fills.length) {
    const m = [0, 1, 2].map(k => { const v = fills.map(f => f[k]).sort((a, z) => a - z); return v[Math.floor(v.length / 2)]; });
    const lumi = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255, sat = Math.max(...m) ? (Math.max(...m) - Math.min(...m)) / Math.max(...m) : 0;
    color = sat < 0.12 && lumi > 0.82 ? '#ffffff' : sat < 0.12 && lumi < 0.15 ? '#000000' : '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // letter case of the words: all lower, all caps, or as said
  const ws = cs.map(c => String(c.text).replace(/[^A-Za-z]/g, '')).filter(w => w.length >= 2);
  const lo = ws.filter(w => w === w.toLowerCase()).length, up = ws.filter(w => w === w.toUpperCase()).length;
  const textCase = !ws.length ? null : lo >= 0.6 * ws.length ? 'lower' : up >= 0.6 * ws.length ? 'upper' : 'as-said';
  return { position, color, y: y == null ? null : r2(y), textCase };
}

// Outline and shadow of the caption words, from teardown.py's ring measures (caption_look samples) on the cues that
// are the running captions: a hard dark band right at the letters is an outline (thick when it carries on into the
// next ring), a milder darkening a soft shadow, else none. Samples on a dark background are skipped.
function captionLook(samples, cues) {
  const key = c => `${r2(c.t0)}|${c.text}`, want = cues ? new Set([...cues].map(key)) : null;
  const vs = (samples || []).filter(m => !want || want.has(key(m))).map(m => {
    if (m.far < 70) return null;
    if (m.near < 0.45 * m.far && m.near < 90) return m.mid < 0.55 * m.far ? 'thick' : 'thin';
    if (m.near < 0.85 * m.far || m.mid < 0.9 * m.far) return 'shadow';
    return 'none';
  }).filter(Boolean);
  if (vs.length < 3) return null;
  const outl = vs.filter(v => v === 'thin' || v === 'thick');
  return { outline: outl.length >= 0.5 * vs.length ? (outl.filter(v => v === 'thick').length >= outl.length / 2 ? 'thick' : 'thin') : 'none',
    shadow: vs.filter(v => v === 'shadow').length >= 0.4 * vs.length ? 'soft' : 'none', n: vs.length };
}

// One shot's grade -> a finish (or none). Calibrated on the shipped finishes applied to showcase/source/presenter.jpg,
// then made stricter so a dark room or warm light on real footage does not read as a finish. Subtle finishes (grain,
// chroma, a light warm or cool) are often missed; strong ones (mono, scan-lines, heavy vignette, teal) are caught.
function finishOf(m) {
  if (!m || m.sat == null) return { finish: null, why: 'no grade data' };
  const f = [], why = [];
  if (m.sat < 0.03) { f.push('mono'); why.push(`saturation ${m.sat}`); }
  else {
    const spread = (m.highlight_b ?? 0) - (m.shadow_b ?? 0);
    if ((m.shadow_b ?? 0) < -2 && spread > 15) { f.push('teal'); why.push(`teal shadows, warm highlights (b ${m.shadow_b} / ${m.highlight_b})`); }
    else if (m.contrast > 0.3 && m.sat < 0.2) { f.push('bleach'); why.push(`contrast ${m.contrast}, saturation ${m.sat}`); }
    else if ((m.dark_share ?? 0) > 0.38 && m.contrast > 0.3) { f.push('crushed'); why.push(`dark share ${m.dark_share}`); }
    else if ((m.shadow_b ?? 0) < -2.5) { f.push('cool'); why.push(`cool shadows (b ${m.shadow_b})`); }
    else if ((m.shadow_b ?? 0) > 6 || (m.mean_b ?? 0) > 14) { f.push('warm'); why.push(`warm cast (b ${m.mean_b})`); }
  }
  if ((m.scan ?? m.x_scan ?? 0) > 1.5) { f.push('scan-lines'); why.push(`line pattern ${m.scan ?? m.x_scan}`); }
  else if ((m.noise ?? 0) > 2.5) { f.push('grain'); why.push(`noise ${m.noise}`); }
  if (m.vignette != null && m.vignette < 0.12) { f.push('vignette'); why.push(`corners at ${Math.round(m.vignette * 100)}% of the ring inside them`); }
  return { finish: f.length ? f.join(',') : null, why: why.join('; ') || 'natural' };
}

// A finish is only assigned when the grade is a choice, not the room. Per finish: the measure it rests on, how far the
// shots that have it must sit from the shots that do not (the grade changes across shots), and what counts as strong
// enough to keep even when every shot has it. Warm lamp light on every shot is the room, so it is dropped.
const GRADE = {
  warm: { v: m => m.shadow_b ?? 0, gap: 3, strong: m => (m.shadow_b ?? 0) > 10 || (m.mean_b ?? 0) > 20 },
  cool: { v: m => -(m.shadow_b ?? 0), gap: 3, strong: m => (m.shadow_b ?? 0) < -6 },
  teal: { v: m => (m.highlight_b ?? 0) - (m.shadow_b ?? 0), gap: 8, strong: m => (m.highlight_b ?? 0) - (m.shadow_b ?? 0) > 28 },
  bleach: { v: m => -(m.sat ?? 0), gap: 0.1, strong: m => m.contrast > 0.4 && m.sat < 0.12 },
  crushed: { v: m => m.dark_share ?? 0, gap: 0.12, strong: m => (m.dark_share ?? 0) > 0.5 },
  mono: { v: m => -(m.sat ?? 0), gap: 0.1, strong: () => true },
  'scan-lines': { v: m => m.scan ?? m.x_scan ?? 0, gap: 0.8, strong: m => (m.scan ?? m.x_scan ?? 0) > 3 },
  grain: { v: m => m.noise ?? 0, gap: 1.2, strong: m => (m.noise ?? 0) > 5 },
  vignette: { v: m => -(m.vignette ?? 1), gap: 0.15, strong: m => m.vignette != null && m.vignette < 0.06 },
};
function gradeChoice(shots) {
  const notes = [];
  const all = new Set(shots.flatMap(s => (s.finish || '').split(',').filter(Boolean)));
  for (const f of all) {
    const G = GRADE[f]; if (!G) continue;
    const has = shots.filter(s => (s.finish || '').split(',').includes(f)), not = shots.filter(s => !has.includes(s));
    const avg = a => a.reduce((x, s) => x + G.v(s.m), 0) / a.length;
    const differs = not.length > 0 && avg(has) - avg(not) >= G.gap;
    for (const s of has) {
      if (differs || G.strong(s.m)) continue;
      s.finish = s.finish.split(',').filter(x => x !== f).join(',') || null;
      s.finishWhy = `${s.finishWhy}; ${f} dropped (same on every shot and mild: the light of the room, not a grade)`;
    }
    if (!differs && has.some(s => !G.strong(s.m))) notes.push(`${f} on ${has.length} of ${shots.length} shots, mild and even across them: read as the room's light, not a finish`);
  }
  return notes;
}

let _bpms = null;
function bedBpms() {
  if (_bpms) return _bpms;
  const cache = path.join(ROOT, 'teardown', '.bed-bpm.json');
  try { _bpms = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { _bpms = {}; }
  return _bpms;
}
// The library bed whose tempo is closest (half and double time count).
function suggestBed(bpm, opts = {}) {
  if (!bpm) return null;
  const R = require('./rules.cjs');
  const beds = Object.keys(R.BEDS || {});
  const known = { ...bedBpms(), ...(opts.bpms || {}) };
  let best = null;
  for (const name of beds) {
    const t = known[name];
    if (!t) continue;
    const d = Math.min(...[t, t * 2, t / 2].map(x => Math.abs(x - bpm)));
    if (!best || d < best.d) best = { name, bpm: t, d };
  }
  return best;
}

function hexOK(h) { return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h); }
function lum(h) { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
function satOf(h) { const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return mx ? (mx - mn) / mx : 0; }
function brandColours(b, titles) {
  const out = [];
  const add = h => { if (hexOK(h) && !out.some(x => dist(x, h) < 60)) out.push(h.toLowerCase()); };
  const dist = (a, c) => { const p = parseInt(a.slice(1), 16), q = parseInt(c.slice(1), 16); return Math.hypot((p >> 16) - (q >> 16), ((p >> 8) & 255) - ((q >> 8) & 255), (p & 255) - (q & 255)); };
  // accent first: saturated title and caption colours
  const texts = [...titles.map(t => t.fill), ...((b.packaging || {}).text_cues || []).filter(c => c.kind === 'subtitle').flatMap(c => [c.style && c.style.fill, c.style && c.style.box_color])];
  texts.filter(h => hexOK(h) && satOf(h) > 0.35).forEach(add);
  texts.filter(h => hexOK(h)).forEach(h => { if (out.length < 3) add(h); });
  (b.x_palette || []).map(p => p.hex).sort((a, c) => lum(a) - lum(c)).forEach(h => { if (out.length < 5) add(h); });
  return out.slice(0, 5);
}

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

function convert(b, extras = {}, opts = {}) {
  const src0 = b.source || {};
  const src = { ...src0, file: src0.file || src0.filename || (src0.path ? path.basename(src0.path) : undefined) };
  const dur = r2(src.duration || (b.summary && b.summary.duration) || (b.shots && b.shots.length ? b.shots[b.shots.length - 1].end : 0));
  const engine = b.x_engine || (b.tool ? `${b.tool.name || 'rea-video'} ${b.tool.version || ''}`.trim() : 'rea-video');
  const picked = pickTitles(b);
  (extras.titles || []).forEach((x, i) => { if (picked[i] && x && x.layer) { picked[i].layer = x.layer; picked[i].overlap = x.person_overlap; } });
  const graphics = mapGraphics(b, extras);
  // a title that is a graphic's own word (FIRST on a sticker, the label under an icon) belongs to that graphic
  const inBox = (bb, box) => bb && box && bb[0] + bb[2] / 2 >= box[0] && bb[0] + bb[2] / 2 <= box[0] + box[2] && bb[1] + bb[3] / 2 >= box[1] && bb[1] + bb[3] / 2 <= box[1] + box[3];
  const owned = t => graphics.find(g => t.start < g.end + 0.3 && g.start < t.end + 0.3 && (inBox(t.bbox, g.bbox) || [g.cue, g.text].filter(Boolean).some(x => { const a = norm(x), c = norm(t.text); return a && c && (sameWord(a, c) || (c.length >= 4 && a.includes(c))); })));
  const titles = picked.filter(t => !owned(t)).slice(0, 7);
  titles.forEach((t, i) => { t.n = i + 1; });
  const dropped = [...(picked.dropped || []), ...picked.filter(t => owned(t)).map(t => ({ t: t.start, text: t.text, why: `part of the ${owned(t).type} at ${owned(t).start}s` }))];
  const cs = captionStyle(b);
  const owc = oneWordStream(b);
  const cl2 = captionLook((extras.caption_look || {}).samples, owc ? owc.cues : null);
  if (cl2) Object.assign(cs, { outline: cl2.outline, shadow: cl2.shadow, lookN: cl2.n });
  const look = cs.style === 'one-word' ? 'one-word' : cs.style === 'pill' ? 'muse' : 'kinetic';
  const shots = (b.shots || []).map((s, i) => {
    const m = { ...((s.aspects && s.aspects.grade && s.aspects.grade.measured) || {}), ...(extras.shots && extras.shots[i] ? extras.shots[i] : {}) };
    if (s.x_scan != null && m.scan == null) m.scan = s.x_scan;
    const fin = finishOf(m);
    const cam = (s.aspects && s.aspects.camera && (s.aspects.camera.result || s.aspects.camera.measured)) || {};
    const move = cam.move || cam.motion;
    return { n: i + 1, m, start: r2(s.start), end: r2(s.end), finish: fin.finish, finishWhy: fin.why, transitionIn: s.transition_in, move: typeof move === 'string' ? move : null, shake: (s.aspects && s.aspects.camera && s.aspects.camera.measured && s.aspects.camera.measured.shake) };
  });
  const ambient = gradeChoice(shots);
  // the most common finish becomes the job default; shots that differ keep their own
  const counts = {};
  shots.forEach(s => { const k = s.finish || 'none'; counts[k] = (counts[k] || 0) + 1; });
  const top = Object.entries(counts).sort((a, c) => c[1] - a[1])[0];
  const jobFinish = top && top[0] !== 'none' && top[1] / shots.length >= 0.6 ? top[0] : null;
  const audio = b.audio || {}, music = audio.music || {};
  const bpm = music.tempo_bpm || audio.tempo_bpm || null;
  const hasMusic = !!(music.present || bpm);
  const bed = suggestBed(bpm, opts);
  const beatEdit = audio.beat_synced_edit === true || (audio.cuts_on_beat_ratio != null && audio.cuts_on_beat_chance != null && audio.cuts_on_beat_ratio > audio.cuts_on_beat_chance + 0.15);
  const zoomShots = shots.filter(s => s.move && /zoom|push|punch/i.test(s.move)).length;
  const jumpCuts = shots.filter(s => /jump/.test(s.transitionIn || '')).length;
  const avgShot = shots.length ? dur / shots.length : dur;
  const big = shots.length >= 3 ? [2, shots.length] : [];
  const colours = brandColours(b, titles);
  const speech = b.speech || {};
  const words = speech.words || [];
  const lines = speech.lines || [];
  const name = (opts.name || (src.file || 'reference').replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'reference';
  const layerDefault = titles.some(t => t.layer === 'behind') ? 'auto' : 'front';

  const card = {
    videomd: 1, name,
    description: `Recipe torn down from ${src.file || 'a reference reel'}: ${shots.length} shots in ${dur}s, ${titles.length} big titles, ${cs.style} captions${bpm ? `, music near ${Math.round(bpm)} BPM` : ''}. Measured by ${engine}; finishes, entrances and layers are best guesses.`,
    source: { file: src.file || 'reference.mp4', duration: dur }, shots: shots.length, lang: opts.lang || b.lang || 'en',
    generator: { name: 'aigent-talking-head teardown', version: require('../package.json').version }, 'x-reel': 1,
  };
  const L = ['---', RM.dumpYaml(card).trimEnd(), '---', '', `# Teardown: ${src.file || name}`, '',
    'Detected from the reference. Read the teardown report next to this file, change anything that looks wrong, then remake:',
    `\`npm run reel -- --recipe ${opts.recipePath || 'teardown/' + name + '/Reel.md'} --clip inbox/your-clip.mp4\``, '',
    '## Brand kit', '- preset: aigent', '- theme: aigent', `- colors: ${colours.join(', ') || 'none'}`, '- fonts: theme', '- logo: none', '',
    '## Music', `- bed: ${hasMusic && bed ? bed.name : 'none'}`, `- bpm: ${bpm ? Math.round(bpm) : ''}`, `- beat-sync: ${hasMusic ? 'on' : 'off'}`, '',
    '## Style', `- look: ${look}`, `- captions: ${cs.style}`, ...(cs.position ? [`- caption-position: ${cs.position}`] : []), ...(cs.color ? [`- caption-color: ${cs.color}`] : []), ...(cs.outline ? [`- caption-outline: ${cs.outline}`] : []), ...(cs.shadow ? [`- caption-shadow: ${cs.shadow}`] : []), ...(cs.textCase && cs.style === 'one-word' ? [`- caption-case: ${cs.textCase}`] : []), `- titles: ${titles.length ? 'on' : 'off'}`, `- title-layer: ${layerDefault}`,
    `- finish: ${jobFinish ? jobFinish.split(',').join(', ') : 'none'}`, `- transition: ${shots.some(s => /dissolve|fade|cross/.test(s.transitionIn || '')) ? 'crossfade' : 'glitch'}`,
    `- punch: ${zoomShots || jumpCuts || avgShot < 3 ? 'on' : 'off'}`, '- effects: none', '',
    '## Shots', '', '```videomd-timeline'];
  for (const s of shots) {
    const f = [`#${pad2(s.n)} ${s.start}-${s.end}`, `story ${s.n === 1 ? 'hook' : s.n === shots.length ? 'payoff' : 'beat'}`];
    if (s.finish && s.finish !== jobFinish) f.push(`finish ${s.finish}`);
    if (big.includes(s.n)) f.push('punch big');
    if (/dissolve|fade|cross/.test(s.transitionIn || '')) f.push('transition crossfade');
    if (s.move) f.push(`camera~ ${s.move}`);
    L.push(f.join(' | '));
  }
  L.push('```', '');
  if (titles.length) {
    L.push('## Titles', '', '```reel-titles');
    titles.forEach(t => {
      const f = [`#${pad2(t.n)} ${t.start}-${t.end}`];
      if (t.entrance) f.push(`entrance ${t.entrance}`);
      f.push(`layer ${t.layer || 'front'}`, `text ${t.text}`);
      L.push(f.join(' | '));
    });
    L.push('```', '');
  }
  if (graphics.length) {
    L.push('## Graphics', '', 'Detected graphics, drawn as neutral placeholders in the remake. Add `icon <file>` to an app label, and `source <url or file>` to a screen card: a public page (a repo, a site, a tool) is captured to a screenshot and a short scrolling recording with `npm run capture -- --recipe <this file>` once you confirm the URLs, or a file of your own (an image or a screen recording). `subject~` is what the reference showed in that card, `source~` a web address read in it. Paths are relative to this file.', '', '```reel-graphics');
    graphics.forEach((g, i) => {
      const f = [`#${pad2(i + 1)} ${g.start}-${g.end}`, `type ${g.type}`];
      if (g.text) f.push(`${g.guess ? 'text~' : 'text'} ${g.text}`);
      if (g.layer) f.push(`layer ${g.layer}`);
      for (const k of ['color', 'tile', 'border']) if (hexOK(g[k])) f.push(`${k} ${g[k].toLowerCase()}`);
      for (const k of ['x', 'y', 'w', 'size']) if (g[k] != null) f.push(`${k} ${g[k]}`);
      if (g.head != null) f.push(`head ${g.head}`, `head-y ${g.headY}`);
      if (g.subject) f.push(`subject~ ${g.subject}`);
      if (g.sourceGuess) f.push(`source~ ${g.sourceGuess}`);
      L.push(f.join(' | '));
    });
    L.push('```', '');
  }
  if (lines.length) {
    L.push('## Script', '', 'What the reference says, for timing and structure. Your remake uses your own words.', '', '```reel-script');
    lines.slice(0, 60).forEach((l, i) => L.push(`#${pad2(i + 1)} ${r2(l.start)}-${r2(l.end)} | say ${clean(l.text)}`));
    L.push('```', '');
  }
  const md = L.join('\n');

  // report: what was detected and how
  const R = [`# Teardown report: ${src.file || name}`, '', `Engine: ${engine}. ${b.x_engine ? 'rea-video was not available, so this is the lightweight built-in analyzer.' : 'rea-video did the breakdown; this report maps it onto the talking-head menu.'}`, '',
    'Every line below is a measurement or a guess from one. Check the contact sheet, fix the Reel.md, then remake.', '',
    `![contact sheet](contact.jpg)`, '',
    '| What | Detected | How |', '|---|---|---|',
    `| Length, shots | ${dur}s, ${shots.length} shots (avg ${avgShot.toFixed(1)}s) | scene cuts${jumpCuts ? `, ${jumpCuts} jump cuts` : ''} |`,
    `| Captions | ${cs.style} (look ${look}) | ${cs.why} |`,
    `| Caption place | ${cs.position || 'unknown'}${cs.color ? ', ' + cs.color : ''} | median centre of the caption boxes${cs.y != null ? ' (' + Math.round(cs.y * 100) + '% down)' : ''} and their median fill, snapped to white or black when close |`,
    `| Caption look | outline ${cs.outline || 'not measured'}, shadow ${cs.shadow || 'not measured'}${cs.textCase ? ', ' + cs.textCase + ' case' : ''} | ${cs.lookN ? `the ring of picture just outside the letters on ${cs.lookN} caption words: a hard dark band is an outline, a milder darkening a shadow` : 'not measured (extras did not run)'}; case from the words read |`,
    `| Titles | ${titles.length} | big on-screen text that is not a running caption or a graphic's word, one at a time, up to 7${dropped.length ? `; ${dropped.length} left out (listed below)` : ''} |`,
    `| Graphics | ${graphics.length ? ['ordinal-sticker', 'app-label', 'screen-card'].map(k => `${graphics.filter(g => g.type === k).length} ${k}`).join(', ') : 'none found'} | ${extras.graphics ? 'frames every 0.25 s: spiky yellow shape + ordinal word, square tile + label, dark rectangle + small UI text' : 'not measured (extras did not run)'} |`,
    `| Title layer | ${titles.length ? titles.map(t => t.layer || '?').join(', ') : 'n/a'} | ${extras.mask ? 'text colour over the person vs over the background (MediaPipe mask)' : 'not estimated (no person mask available); front is the default'} |`,
    `| Finish | ${jobFinish || 'none'} as default; ${shots.filter(s => s.finish && s.finish !== jobFinish).length} shots differ | grade stats per shot, nearest shipped finish; only kept when the grade changes across shots or is strong${ambient.length ? '. ' + ambient.join('; ') : ''} |`,
    `| Music | ${hasMusic ? `${bpm ? Math.round(bpm) + ' BPM' : 'present'}${bed ? `, closest bed ${bed.name} (${Math.round(bed.bpm)} BPM)` : ''}` : 'none found'} | ${beatEdit ? 'cuts land on the beat more than chance' : 'beat grid'} |`,
    `| Punch | ${zoomShots || jumpCuts || avgShot < 3 ? 'on' : 'off'} | ${zoomShots} zoom moves, ${jumpCuts} jump cuts, ${avgShot.toFixed(1)}s average shot |`,
    `| Brand colours | ${colours.join(' ') || 'none'} | saturated text colours first, then the frame palette |`,
    `| Script | ${lines.length ? lines.length + ' lines' : 'not transcribed'} | ${speech.engine || (speech.ok === false ? 'speech: ' + (speech.reason || 'off') : 'rea-video')} |`, ''];
  if (titles.length) {
    R.push('## Titles', '', '| # | Time | Text | Seen as | Entrance | Layer |', '|---|---|---|---|---|---|');
    titles.forEach(t => R.push(`| ${t.n} | ${t.start}-${t.end}s | ${t.text} | ${t.seenAs} | ${t.entrance || 'engine picks'} | ${t.layer || 'front'}${t.overlap != null ? ` (person under ${Math.round(t.overlap * 100)}% of it)` : ''} |`));
    R.push('');
  }
  if (dropped.length) {
    R.push('## Left out of the titles', '', '| Time | Text | Why |', '|---|---|---|');
    dropped.forEach(d => R.push(`| ${d.t}s | ${d.text} | ${d.why} |`));
    R.push('');
  }
  if (graphics.length) {
    R.push('## Graphics', '', '| # | Time | Type | Text | Detail |', '|---|---|---|---|---|');
    graphics.forEach((g, i) => R.push(`| ${i + 1} | ${g.start}-${g.end}s | ${g.type} | ${g.text ? g.text + (g.guess ? ' (guessed from its place in the list)' : '') : ''} | ${g.type === 'ordinal-sticker' ? `burst ${g.color || '?'}, ${g.layer}${g.head ? `, ${g.head} head widths wide` : g.size ? `, radius ${g.size} px` : ''}` : g.type === 'app-label' ? `tile ${g.tile || '?'}` : `border ${g.border || 'none found'}, ${g.uiText} UI text cues inside`} |`));
    R.push('', 'Icons and screenshots are not copied. The remake draws a generic glyph or placeholder window until you add your own `icon`, or a `source` for a card.', '');
    const cards = graphics.filter(g => g.type === 'screen-card');
    if (cards.length) {
      R.push('## Screen cards: what was shown', '', 'Propose a public page for each card (the repo or site of the tool named, or the address read in it), confirm the list with the user, then add `source <url>` and run `npm run capture -- --recipe <Reel.md>`. Only public pages are captured.', '',
        '| Time | Shown (read in the card) | Address read | Tool named before it |', '|---|---|---|---|');
      cards.forEach(c => R.push(`| ${c.start}-${c.end}s | ${(c.shown || []).slice(0, 2).map(x => x.slice(0, 50)).join(' / ') || 'nothing legible'} | ${c.sourceGuess || 'none'} | ${c.named || 'none'} |`));
      R.push('');
    }
  }
  R.push('## Shots', '', '| # | Time | Finish | Why |', '|---|---|---|---|');
  shots.forEach(s => R.push(`| ${s.n} | ${s.start}-${s.end}s | ${s.finish || 'none'} | ${s.finishWhy} |`));
  R.push('', '## How sure is this', '', '- Cuts, length, BPM and caption timing are measured and usually right.',
    '- Caption style, entrances and finishes are the nearest match from a short menu. A custom look maps to the closest shipped one.',
    '- Graphics are found from shape and colour plus OCR. A white tile on a white shirt, or an ordinal word OCR cannot read, is missed or guessed (marked ~).',
    '- A finish is only kept when the grade changes across shots or is strong. An even warm or cool cast on every shot is read as the room light.',
    '- Front or behind is a colour test against a person mask. It misses when the text colour matches the clothes or hair.',
    '- OCR misreads stylised or moving type. Check the title text before you remake; your remake should use your own words anyway.', '');
  return { md, report: R.join('\n'), titles, shots, captionStyle: cs.style, captionPosition: cs.position, captionColor: cs.color, graphics, dropped, jobFinish, bpm, bed };
}

module.exports = { convert, pickTitles, mapGraphics, captionLook, gradeChoice, placeOf, captionStyle, oneWordStream, finishOf, suggestBed, loadBreakdown, ENTRANCE_MAP };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const inp = argv.find((a, i) => !a.startsWith('--') && !(i && argv[i - 1].startsWith('--')));
  if (!inp) { console.error('usage: node kit/videomd2reel.cjs <rea-video out dir | breakdown.json> [--extras extras.json] [--out Reel.md] [--report teardown.md]'); process.exit(1); }
  const b = loadBreakdown(inp);
  const ex = opt('extras') && fs.existsSync(opt('extras')) ? JSON.parse(fs.readFileSync(opt('extras'), 'utf8')) : {};
  const out = opt('out', path.join(b._dir, 'Reel.md'));
  const res = convert(b, ex, { name: opt('name'), recipePath: path.relative(ROOT, out) });
  fs.writeFileSync(out, res.md);
  fs.writeFileSync(opt('report', path.join(path.dirname(out), 'teardown.md')), res.report);
  console.log('wrote ' + out);
}
