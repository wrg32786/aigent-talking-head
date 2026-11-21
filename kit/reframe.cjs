// Reframe: put your face where the reference's face is, shot by shot (Recreate), or where a style look wants it
// (Copy the look). Both sides are measured by kit/framing.py (YuNet): the face height as a share of the frame height,
// the eye line (0 top .. 1 bottom) and the face centre x. From the two, cropFor() works out the segment's crop in
// kit/assemble.cjs terms: zoom, punchX and punchY (the zoom centre).
//   - the zoom is the reference's face height over yours, never under 1 (we cannot zoom out of your take) and never
//     over what your source holds without obvious blur (maxZoom)
//   - a take whose face is already as big as the target, or bigger, is left as filmed: zoom 1, no shift
//   - a little more zoom (up to EYE_EXTRA past the face height target) is allowed when that is what it takes to reach
//     the eye line
//   - the head stays inside the frame: the crown (estimated from the face box) and the chin keep a margin from the top
//     and bottom edges, the face box from the sides. The zoom and the zoom centre are held back to make sure, and the
//     result says so (clamped, held)
//   - capMoves(): a camera move or a big punch layered on a reframed segment is held to the same headroom, and left
//     out on a segment that is already as close as its target (we never push in on a close-up)
// The face keep-out zone (kit/facezone.py) is measured after the crop, so captions follow the new framing.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const MAX_UPSCALE = 3.92;   // the most the source picture is blown up in all: cover scale times zoom
const ZOOM_CAP = 3;         // whatever the source, never closer than this
const EYE_EXTRA = 1.15;     // extra zoom allowed to reach the eye line
const MARGIN = 0.03;        // the face box keeps this share of the frame from the left and right edges
const HEADROOM = 0.03;      // the crown and the chin keep this share of the frame from the top and bottom edges
const CROWN = 0.45;         // the top of the head sits about this share of the face height above the face box
const CHIN = 0.05;          // and the chin this share below it
const SAME = 0.02;          // a face within this of the target size counts as already there
const r3 = x => +(+x).toFixed(3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// shot sizes by face height (share of the frame height), closest first
const CLASSES = [['ECU', 0.33], ['CU', 0.22], ['MCU', 0.13], ['MS', 0.07], ['WS', 0]];
const classOf = h => (CLASSES.find(([, min]) => +h >= min) || CLASSES[CLASSES.length - 1])[0];
const CLASS_WORDS = { ECU: 'extreme close-up', CU: 'close-up', MCU: 'medium close-up', MS: 'medium shot', WS: 'wide shot' };

// "0.18@0.36" or "0.18@0.36@0.48": face height @ eye line @ centre x (the Reel.md shot key "face")
function parseFace(v) {
  const m = /^\s*(0?\.\d+|[01](?:\.\d+)?)@(0?\.\d+|[01](?:\.\d+)?)(?:@(0?\.\d+|[01](?:\.\d+)?))?\s*$/.exec(String(v == null ? '' : v));
  if (!m) return null;
  const f = { faceH: +m[1], eyeY: +m[2], cx: m[3] != null ? +m[3] : 0.5 };
  return f.faceH > 0.01 && f.faceH < 0.95 ? f : null;
}
const r2 = x => +(+x).toFixed(2);
function fmtFace(f) {
  if (!f) return null;
  const cx = f.cx != null && Math.abs(f.cx - 0.5) >= 0.035 ? '@' + r2(f.cx) : '';
  return `${r3(f.faceH)}@${r3(f.eyeY)}${cx}`;
}
// a kit/framing.py span as { faceH, eyeY, cx, y0, y1, x0, x1 }
const fromMeasure = m => (m && m.h ? { faceH: m.h, eyeY: m.eye_y, cx: m.cx, y0: m.y0, y1: m.y1, x0: m.x0, x1: m.x1 } : null);

// the closest zoom a source allows: the cover scale (how much it is blown up to fill 1080x1920) times the zoom stays
// under MAX_UPSCALE. A 1920x1080 take covers at 1.78, so it can zoom to 2.2; a 1080x1920 take to 3.
function maxZoom(w, h) {
  if (!(w > 0 && h > 0)) return 2.2;
  const cover = Math.max(1080 / w, 1920 / h);
  return r2(clamp(MAX_UPSCALE / cover, 1, ZOOM_CAP));
}

// where a point at share p ends after a zoom z centred at c: p * z - (z - 1) * c
const move = (p, z, c) => p * z - (z - 1) * c;
// the centre that puts p on q at zoom z
const centreFor = (p, q, z) => (z > 1.0001 ? clamp((p * z - q) / (z - 1), 0, 1) : 0.5);

// ours, target: { faceH, eyeY, cx } (ours may carry the face box y0, y1, x0, x1). Returns the crop and what it gives.
// held says what stopped the zoom short of the target: 'source' (the blur limit) or 'headroom' (the head would leave
// the frame); clamped is true for either.
function cropFor(ours, target, opts = {}) {
  const zMax = opts.maxZoom || 2.2;
  if (!ours || !target || !(ours.faceH > 0) || !(target.faceH > 0)) return null;
  const want = target.faceH / ours.faceH;
  const v = ours.eyeY, vt = target.eyeY, cxT = target.cx != null ? target.cx : 0.5;
  const done = (z, px, py, held) => {
    const got = { faceH: r3(ours.faceH * z), eyeY: r3(move(v, z, py)), cx: r3(move(ours.cx, z, px)) };
    return { zoom: r3(z), punchX: r3(px), punchY: r3(py), clamped: !!held, ...(held ? { held } : {}), ...(closer ? { closer: true } : {}), want: r3(want), got, head: [r3(top), r3(bot)], headTop: r3(move(top, z, py)),
      diff: { faceH: r3(got.faceH - target.faceH), eyeY: r3(got.eyeY - target.eyeY), cx: r3(got.cx - cxT) } };
  };
  // the face box, and the head around it: the crown is above the face box (hair, a cap), the chin just under it
  const y0 = ours.y0 != null ? ours.y0 : ours.eyeY - ours.faceH * 0.42, y1 = ours.y1 != null ? ours.y1 : ours.eyeY + ours.faceH * 0.58;
  const x0 = ours.x0 != null ? ours.x0 : ours.cx - ours.faceH * 0.65, x1 = ours.x1 != null ? ours.x1 : ours.cx + ours.faceH * 0.65;
  const fh = Math.max(0.01, y1 - y0), top = Math.max(0, y0 - fh * CROWN), bot = Math.min(1, y1 + fh * CHIN);
  // Your face is already as big as the target, or bigger: the take stays as filmed. We cannot zoom out, and any zoom
  // to move the eye line would only make the face bigger still. With no zoom there is no room to shift the picture.
  // opts.take is the middle face of the whole file: a moment you lean back in a close take is not pushed in either.
  const closer = target.faceH / Math.max(ours.faceH, (opts.take && opts.take.faceH) || 0) <= 1 + SAME;
  if (closer) return done(1, 0.5, 0.5, null);
  // the zoom the eye line alone would need (from the top or the bottom edge); it may ask for a little more than the
  // face height does, up to EYE_EXTRA past the face height target
  const zEye = vt < v ? (1 - vt) / Math.max(0.05, 1 - v) : vt / Math.max(0.05, v);
  let z = want, held = null;
  if (zEye > z) z = Math.min(zEye, want * EYE_EXTRA);
  if (z > zMax + 1e-6) { z = zMax; held = 'source'; }
  // a head that already touches an edge of your take cannot get a margin there; it keeps the edge it has
  const mTop = Math.min(HEADROOM, top), mBot = Math.min(HEADROOM, 1 - bot);
  // the head (crown to chin) and the face box (side to side) must fit the frame at this zoom
  const fit = Math.max(1, Math.min((1 - mTop - mBot) / Math.max(0.01, bot - top), (1 - 2 * MARGIN) / Math.max(0.01, x1 - x0)));
  if (z > fit + 1e-6) { z = fit; held = 'headroom'; }
  if (!(z > 1.0001)) return done(1, 0.5, 0.5, held);
  let py = centreFor(v, vt, z), px = centreFor(ours.cx, cxT, z);
  // the zoom centre is moved, if it must be, so the crown and the chin stay in the frame
  const pyHi = clamp((top * z - mTop) / (z - 1), 0, 1), pyLo = clamp((bot * z - (1 - mBot)) / (z - 1), 0, 1);
  if (py > pyHi + 1e-6) { py = pyHi; held = held || 'headroom'; } else if (py < pyLo - 1e-6) { py = pyLo; held = held || 'headroom'; }
  if (move(x0, z, px) < MARGIN) px = clamp((x0 * z - MARGIN) / (z - 1), 0, 1);
  if (move(x1, z, px) > 1 - MARGIN) px = clamp((x1 * z - (1 - MARGIN)) / (z - 1), 0, 1);
  return done(z, px, py, held);
}

// measure spans [[a, b]] of a video with kit/framing.py. Returns one { faceH, eyeY, cx, ... } or null per span;
// null for all when Python or opencv is not there.
function measure(python, video, spans, { samples = 3 } = {}) {
  if (!spans.length) return [];
  try {
    const out = execFileSync(python, [path.join(__dirname, 'framing.py'), 'measure', video, '--spans', spans.map(([a, b]) => `${r3(a)}-${r3(b)}`).join(','), '--samples', String(samples)],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24, env: { ...process.env, PYTHONUTF8: '1' } }).toString().trim().split(/\r?\n/).pop();
    return (JSON.parse(out).spans || []).map(fromMeasure);
  } catch { return spans.map(() => null); }
}

// One file's measures made steady: on a locked-off take the face barely moves, and the small differences between
// samples are noise that would show as a jump on every cut. A measure within 15% of the file's middle face height and
// 4% of the frame of its eye line and centre takes the middle values; one further out (you moved) keeps its own.
function steady(faces) {
  const mid = medianFace(faces);
  if (!mid) return faces;
  return faces.map(f => (f && Math.abs(f.faceH - mid.faceH) / mid.faceH <= 0.15 && Math.abs(f.eyeY - mid.eyeY) <= 0.04 && Math.abs(f.cx - mid.cx) <= 0.04
    ? { ...f, faceH: mid.faceH, eyeY: mid.eyeY, cx: mid.cx, y0: f.y0 != null ? f.y0 + (mid.eyeY - f.eyeY) : f.y0, y1: f.y1 != null ? f.y1 + (mid.eyeY - f.eyeY) : f.y1 } : f));
}

// Set the crop on every segment of every shot. shotStart[j] is the first segment of shot j; targets[j] the face to
// match there (null: none known); faces[i] your face in segment i (null: no face found); takes[i] the middle face of
// segment i's file (optional). fallback: the target for a shot with none of its own (the median of the others).
// A segment with no face found, in a take that is already as close as the target, is held at zoom 1 like the segments
// beside it, so the punch by shot size does not jump in on it. Returns one entry per shot for plan.json and the log lines.
function applyToSegs({ segs, shotStart, targets, faces, takes = [], maxZoom: zMax = 2.2, fallback = null }) {
  const out = [], lines = [];
  shotStart.forEach((k, j) => {
    const end = shotStart[j + 1] != null ? shotStart[j + 1] : segs.length;
    const target = targets[j] || fallback, own = !!targets[j];
    let first = null;
    for (let i = k; i < end; i++) {
      const take = takes[i] || null;
      if (target && !faces[i] && take && target.faceH / take.faceH <= 1 + SAME) { Object.assign(segs[i], { zoom: 1, punchX: 0.5, punchY: 0.5, reframed: true, closer: true }); delete segs[i].head; continue; }
      const c = target && faces[i] ? cropFor(faces[i], target, { maxZoom: zMax, take }) : null;
      if (!c) continue;
      Object.assign(segs[i], { zoom: c.zoom, punchX: c.punchX, punchY: c.punchY, head: c.head });
      segs[i].reframed = true;
      if (c.closer) segs[i].closer = true; else delete segs[i].closer;
      if (!first) first = c;
    }
    if (!first) { out.push(null); return; }
    out.push({ framing: { faceH: first.got.faceH, eyeY: first.got.eyeY, cx: first.got.cx }, target: { faceH: r3(target.faceH), eyeY: r3(target.eyeY), cx: r3(target.cx != null ? target.cx : 0.5) },
      crop: { zoom: first.zoom, punchX: first.punchX, punchY: first.punchY }, headTop: first.headTop, ...(first.closer ? { closer: true } : {}), ...(first.clamped ? { clamped: true, held: first.held } : {}), ...(own ? {} : { borrowed: true }) });
    if (first.clamped) lines.push(first.held === 'headroom' ? `reframe: shot ${j + 1} is held at ${first.zoom}x${first.zoom < first.want ? ` (it wants ${first.want}x)` : ''} so the top of your head and your chin stay in the frame` : `reframe: shot ${j + 1} wants ${first.want}x to match the face height, held at ${first.zoom}x (the most your source holds without blur)`);
  });
  return { shots: out, lines };
}

// Camera moves and big punches layered on a reframed segment (call this last, in place, once the moves are set). A
// segment already as close as its target gets none: we do not push in on it. On the others a move is shortened, and a
// big punch left out, where its closest point would crop the top of the head or the chin.
// big: the big punch's extra zoom (kit/rules.cjs PUNCH.big). Returns log lines.
function capMoves(segs, { big = 0.12 } = {}) {
  let closer = 0, cut = 0;
  for (const s of segs) {
    if (!s.reframed || (!s.push && !s.bigPunch)) continue;
    if (s.closer) { delete s.push; delete s.bigPunch; closer++; continue; }
    if (!Array.isArray(s.head)) continue;
    const [top, bot] = s.head, z = +s.zoom || 1, py = s.punchY != null ? +s.punchY : 0.5;
    const mTop = Math.min(HEADROOM, top), mBot = Math.min(HEADROOM, 1 - bot);
    // the closest zoom this zoom centre holds the head at
    const zOk = Math.min(top < py - 1e-6 ? (py - mTop) / (py - top) : Infinity, bot > py + 1e-6 ? (1 - mBot - py) / (bot - py) : Infinity);
    let hit = false;
    if (s.bigPunch && z * (1 + big) > zOk + 1e-4) { delete s.bigPunch; hit = true; }
    if (s.push && z * (1 + Math.abs(s.push)) > zOk + 1e-4) {
      const p = Math.floor((zOk / z - 1) * 1000) / 1000;
      if (p >= 0.01) s.push = Math.sign(s.push) * p; else delete s.push;
      hit = true;
    }
    if (hit) cut++;
  }
  const lines = [];
  if (closer) lines.push(`reframe: camera moves left out on ${closer} segment${closer === 1 ? '' : 's'} already as close as the target`);
  if (cut) lines.push(`reframe: camera moves shortened or left out on ${cut} segment${cut === 1 ? '' : 's'} so the top of your head and your chin stay in the frame`);
  return lines;
}

// the middle face of a list of targets (per value), for shots with none of their own
function medianFace(list) {
  const fs = list.filter(Boolean);
  if (!fs.length) return null;
  const med = k => { const a = fs.map(f => f[k] != null ? f[k] : 0.5).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  return { faceH: med('faceH'), eyeY: med('eyeY'), cx: med('cx') };
}

module.exports = { cropFor, capMoves, measure, steady, applyToSegs, medianFace, maxZoom, parseFace, fmtFace, fromMeasure, classOf, CLASSES, CLASS_WORDS, MAX_UPSCALE, EYE_EXTRA, MARGIN, HEADROOM, CROWN, CHIN, SAME };
