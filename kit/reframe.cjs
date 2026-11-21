// Reframe: put your face where the reference's face is, shot by shot (Recreate), or where a style look wants it
// (Copy the look). Both sides are measured by kit/framing.py (YuNet): the face height as a share of the frame height,
// the eye line (0 top .. 1 bottom) and the face centre x. From the two, cropFor() works out the segment's crop in
// kit/assemble.cjs terms: zoom, punchX and punchY (the zoom centre).
//   - the zoom is the reference's face height over yours, never under 1 (we cannot zoom out of your take) and never
//     over what your source holds without obvious blur (maxZoom)
//   - a little more zoom (up to EYE_EXTRA) is allowed when that is what it takes to reach the eye line
//   - the face box stays inside the frame with a margin
// The face keep-out zone (kit/facezone.py) is measured after the crop, so captions follow the new framing.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const MAX_UPSCALE = 3.92;   // the most the source picture is blown up in all: cover scale times zoom
const ZOOM_CAP = 3;         // whatever the source, never closer than this
const EYE_EXTRA = 1.15;     // extra zoom allowed to reach the eye line
const MARGIN = 0.03;        // the face box keeps this share of the frame from every edge
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
function cropFor(ours, target, opts = {}) {
  const zMax = opts.maxZoom || 2.2;
  if (!ours || !target || !(ours.faceH > 0) || !(target.faceH > 0)) return null;
  const want = target.faceH / ours.faceH;
  // the zoom the eye line alone would need (from the top or the bottom edge)
  const v = ours.eyeY, vt = target.eyeY;
  const zEye = vt < v ? (1 - vt) / Math.max(0.05, 1 - v) : vt / Math.max(0.05, v);
  let z = Math.max(1, want);
  if (zEye > z) z = Math.min(zEye, z * EYE_EXTRA);
  const clamped = z > zMax + 1e-6;
  z = clamp(z, 1, zMax);
  // the face box must fit the frame at this zoom
  const y0 = ours.y0 != null ? ours.y0 : ours.eyeY - ours.faceH * 0.42, y1 = ours.y1 != null ? ours.y1 : ours.eyeY + ours.faceH * 0.58;
  const x0 = ours.x0 != null ? ours.x0 : ours.cx - ours.faceH * 0.65, x1 = ours.x1 != null ? ours.x1 : ours.cx + ours.faceH * 0.65;
  const fit = Math.min((1 - 2 * MARGIN) / Math.max(0.01, y1 - y0), (1 - 2 * MARGIN) / Math.max(0.01, x1 - x0));
  if (z > fit) z = Math.max(1, fit);
  let py = centreFor(v, vt, z), px = centreFor(ours.cx, target.cx != null ? target.cx : 0.5, z);
  if (z > 1.0001) {
    if (move(y0, z, py) < MARGIN) py = clamp((y0 * z - MARGIN) / (z - 1), 0, 1);
    if (move(y1, z, py) > 1 - MARGIN) py = clamp((y1 * z - (1 - MARGIN)) / (z - 1), 0, 1);
    if (move(x0, z, px) < MARGIN) px = clamp((x0 * z - MARGIN) / (z - 1), 0, 1);
    if (move(x1, z, px) > 1 - MARGIN) px = clamp((x1 * z - (1 - MARGIN)) / (z - 1), 0, 1);
  }
  const got = { faceH: r3(ours.faceH * z), eyeY: r3(move(v, z, py)), cx: r3(move(ours.cx, z, px)) };
  return { zoom: r3(z), punchX: r3(px), punchY: r3(py), clamped, want: r3(want), got,
    diff: { faceH: r3(got.faceH - target.faceH), eyeY: r3(got.eyeY - target.eyeY), cx: r3(got.cx - (target.cx != null ? target.cx : 0.5)) } };
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
// match there (null: none known); faces[i] your face in segment i (null: no face found). fallback: the target for a
// shot with none of its own (the median of the others). Returns one entry per shot for plan.json and the log lines.
function applyToSegs({ segs, shotStart, targets, faces, maxZoom: zMax = 2.2, fallback = null }) {
  const out = [], lines = [];
  shotStart.forEach((k, j) => {
    const end = shotStart[j + 1] != null ? shotStart[j + 1] : segs.length;
    const target = targets[j] || fallback, own = !!targets[j];
    let first = null;
    for (let i = k; i < end; i++) {
      const c = target && faces[i] ? cropFor(faces[i], target, { maxZoom: zMax }) : null;
      if (!c) continue;
      Object.assign(segs[i], { zoom: c.zoom, punchX: c.punchX, punchY: c.punchY });
      segs[i].reframed = true;
      if (!first) first = c;
    }
    if (!first) { out.push(null); return; }
    out.push({ framing: { faceH: first.got.faceH, eyeY: first.got.eyeY, cx: first.got.cx }, target: { faceH: r3(target.faceH), eyeY: r3(target.eyeY), cx: r3(target.cx != null ? target.cx : 0.5) },
      crop: { zoom: first.zoom, punchX: first.punchX, punchY: first.punchY }, ...(first.clamped ? { clamped: true } : {}), ...(own ? {} : { borrowed: true }) });
    if (first.clamped) lines.push(`reframe: shot ${j + 1} wants ${first.want}x to match the face height, held at ${first.zoom}x (the most your source holds without blur)`);
  });
  return { shots: out, lines };
}

// the middle face of a list of targets (per value), for shots with none of their own
function medianFace(list) {
  const fs = list.filter(Boolean);
  if (!fs.length) return null;
  const med = k => { const a = fs.map(f => f[k] != null ? f[k] : 0.5).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  return { faceH: med('faceH'), eyeY: med('eyeY'), cx: med('cx') };
}

module.exports = { cropFor, measure, steady, applyToSegs, medianFace, maxZoom, parseFace, fmtFace, fromMeasure, classOf, CLASSES, CLASS_WORDS, MAX_UPSCALE, EYE_EXTRA, MARGIN };
