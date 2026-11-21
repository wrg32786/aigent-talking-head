// The face-tracked window for a 4:5 or 1:1 version of a reel (kit/export-frame.cjs). The reel is 1080x1920; the new
// frame is 1080 wide and h tall (1350 or 1080), so only its height moves: where its top edge sits, per frame.
//
//   track(faceTrack, { h, len, cuts }) -> { y(n), frames(), expr(), shots, moves, ramps, stats }
//
// faceTrack is build/facezone.json (kit/facezone.py: YuNet, 8 samples a second, already smoothed): per sample
// [x0, y0, x1, y1, crownY] or null. What the window does with it:
//   - aims the face a little above the middle of the new frame (AIM), with headroom over the top of the head (HEAD)
//     and the chin well inside (CHIN), and never leaves the 1080x1920 picture
//   - holds still for a whole shot when the face stays within a small band (DEAD): no jitter, however noisy the track
//   - follows a face that really moves inside a shot with a slow, lag-free glide (keys every half second)
//   - a shot whose window would land within a hair of the last one (SAME) does not move at all
//   - between two shots it moves with an eased slide centred on the cut (smoothstep over EASE seconds, shorter on a
//     short shot); a move is cut shorter, down to a plain switch on the cut, only when a longer one would let the face
//     touch the frame edge
// The result is a formula, not a table: a start value, a few linear ramps and one eased step per cut. y(n) here and
// the ffmpeg expression from expr() are the same formula, so the picture, the mask and the face zone all move alike.
'use strict';
const H = 1920, FPS = 24;
const AIM = 0.40, HEAD = 0.07, CHIN = 0.80, DEAD = 0.04, EASE = 0.5, EDGE = 0.015, KEY = 0.5, SAME = 0.015;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const median = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

// where the window's top wants to be for one face zone
function want(z, h) {
  const top = z[1], chin = z[3], crown = Math.min(z[4] != null ? z[4] : z[1], z[1]);
  let y = (top + chin) / 2 - AIM * h;
  y = Math.min(y, crown - HEAD * h);           // headroom over the hair
  y = Math.max(y, chin - CHIN * h);            // the chin stays well inside
  if (chin - crown > (CHIN - HEAD) * h) y = (crown + chin) / 2 - h / 2; // a very close shot: centre head to chin
  return clamp(y, 0, H - h);
}
// the range of window tops that keep the face zone itself inside the frame (with a small edge)
const insideRange = (z, h) => [Math.max(0, z[3] - h * (1 - EDGE)), Math.min(H - h, z[1] - h * EDGE)];

function track(fz, { h, len, cuts = [], fps = FPS, fallback = null } = {}) {
  if (!(h > 0 && h < H)) throw new Error('facewindow: h must be under 1920');
  const N = Math.max(1, Math.round(len * fps)), zf = (fz && +fz.fps) || 8, zones = (fz && Array.isArray(fz.zones) ? fz.zones : []);
  const fb = clamp(fallback != null ? +fallback : (H - h) / 2, 0, H - h);
  const zAt = n => { const z = zones[clamp(Math.round(n / fps * zf), 0, zones.length - 1)]; return z || null; };
  const W = zones.map(z => (z ? want(z, h) : null));
  // shots: the cuts you pass (the reel's seams), plus any jump in the face track itself (a cut inside a clip)
  const marks = new Set(cuts.map(t => Math.round(+t * fps)).filter(n => n > 0 && n < N));
  { let prev = null, pi = -1;
    W.forEach((w, i) => { if (w == null) return;
      if (prev != null && i - pi <= 2 && Math.abs(w - prev) > 0.12 * h) { const n = Math.round((i - 0.5) / zf * fps); if (![...marks].some(m => Math.abs(m - n) <= fps * 0.2) && n > 0 && n < N) marks.add(n); }
      prev = w; pi = i; }); }
  const edges = [0, ...[...marks].sort((a, b) => a - b), N];
  const shots = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const n0 = edges[k], n1 = edges[k + 1];
    // the face samples inside the shot (kept a sample clear of each end, where the track is still blending)
    const i0 = Math.ceil(n0 / fps * zf), i1 = Math.floor((n1 - 1) / fps * zf), S = [];
    for (let i = i0; i <= i1 && i < W.length; i++) if (W[i] != null) S.push([i, W[i]]);
    const sh = { n0, n1, faces: S.length, keys: null, hold: null };
    if (S.length) {
      const med = median(S.map(x => x[1])), dev = Math.max(...S.map(x => Math.abs(x[1] - med)));
      if (dev <= DEAD * h || S.length < 4) sh.hold = med;
      else {
        // a slow glide: forward and backward EMA (about 0.8 s, no lag), then one key every half second
        const a = 1 - Math.exp(-1 / (0.8 * zf)), v = S.map(x => x[1]), F = v.slice(), B = v.slice();
        for (let j = 1; j < v.length; j++) F[j] = a * v[j] + (1 - a) * F[j - 1];
        for (let j = v.length - 2; j >= 0; j--) B[j] = a * v[j] + (1 - a) * B[j + 1];
        const s = v.map((_, j) => (F[j] + B[j]) / 2), step = Math.max(1, Math.round(KEY * zf)), keys = [];
        for (let j = 0; j < s.length; j += step) keys.push([clamp(Math.round(S[j][0] / zf * fps), n0, n1), s[j]]);
        const last = [clamp(Math.round(S[S.length - 1][0] / zf * fps), n0, n1), s[s.length - 1]];
        if (last[0] - keys[keys.length - 1][0] >= step * fps / zf / 2) keys.push(last); else keys[keys.length - 1][1] = last[1];
        const ks = keys.filter((kq, j) => !j || kq[0] > keys[j - 1][0]);
        if (ks.length < 2) sh.hold = med; else sh.keys = ks;
      }
    }
    shots.push(sh);
  }
  // a shot with no face keeps the window where the shot before it left it (or where the next one starts)
  const startOf = s => (s.keys ? s.keys[0][1] : s.hold), endOf = s => (s.keys ? s.keys[s.keys.length - 1][1] : s.hold);
  for (let k = 0; k < shots.length; k++) if (shots[k].hold == null && !shots[k].keys) shots[k].hold = k ? endOf(shots[k - 1]) : null;
  for (let k = shots.length - 1; k >= 0; k--) if (shots[k].hold == null && !shots[k].keys) shots[k].hold = k + 1 < shots.length ? startOf(shots[k + 1]) : fb;
  // a still shot that would sit within a hair (SAME) of where the last one ended stays exactly there: no tiny moves
  for (let k = 1; k < shots.length; k++) if (!shots[k].keys && Math.abs(shots[k].hold - endOf(shots[k - 1])) < SAME * h) shots[k].hold = endOf(shots[k - 1]);
  const r1 = x => Math.round(x * 10) / 10;
  // the formula: c0, ramps { n, d, a } (a px per frame for d frames from n) and moves { n, e, d } (an eased step of
  // d px centred on frame n, e frames each side; e 0 is a switch on the cut)
  const c0 = r1(startOf(shots[0])), ramps = [], moves = [];
  shots.forEach((s, k) => {
    if (s.keys) for (let j = 0; j + 1 < s.keys.length; j++) { const d = s.keys[j + 1][0] - s.keys[j][0], dv = r1(s.keys[j + 1][1]) - r1(s.keys[j][1]); if (d > 0 && Math.abs(dv) >= 0.1) ramps.push({ n: s.keys[j][0], d, a: +(dv / d).toFixed(4) }); }
    if (k + 1 < shots.length) {
      const nx = shots[k + 1], d = r1(r1(startOf(nx)) - r1(endOf(s)));
      const e = Math.max(0, Math.min(Math.round(EASE * fps / 2), Math.floor((s.n1 - s.n0) * 0.45), Math.floor((nx.n1 - nx.n0) * 0.45)));
      if (Math.abs(d) >= 0.1) moves.push({ n: s.n1, e, d });
    }
  });
  const raw = n => { let y = c0; for (const r of ramps) y += r.a * clamp(n - r.n, 0, r.d);
    for (const m of moves) y += m.d * (m.e ? smooth((n - (m.n - m.e)) / (2 * m.e)) : (n >= m.n ? 1 : 0)); return y; };
  const y = n => 2 * Math.round(clamp(raw(n), 0, H - h) / 2);
  // the face stays inside: shorten any move that would let the face zone touch the frame edge near its cut
  for (const m of moves) {
    while (m.e > 0) {
      let bad = false;
      for (let n = Math.max(0, m.n - m.e); n < Math.min(N, m.n + m.e) && !bad; n++) { const z = zAt(n); if (!z) continue; const [lo, hi] = insideRange(z, h); if (lo <= hi && (y(n) < lo - 2 || y(n) > hi + 2)) bad = true; }
      if (!bad) break; m.e = Math.floor(m.e / 2);
    }
  }
  const frames = () => { const a = new Array(N); for (let n = 0; n < N; n++) a[n] = y(n); return a; };
  // the same formula for ffmpeg's crop filter (n is the frame number)
  const num = v => (Math.abs(v) < 1e-9 ? '0' : String(+(+v).toFixed(4)));
  const expr = () => {
    const parts = [num(c0)];
    for (const r of ramps) parts.push(`${num(r.a)}*clip(n-${r.n},0,${r.d})`);
    moves.forEach((m, i) => parts.push(m.e ? `${num(m.d)}*(st(${i % 10},clip((n-${m.n - m.e})/${2 * m.e},0,1))*ld(${i % 10})*(3-2*ld(${i % 10})))` : `${num(m.d)}*gte(n,${m.n})`));
    return `2*round(clip(${parts.join('+').replace(/\+-/g, '-')},0,${H - h})/2)`;
  };
  const fr = frames(); let maxStep = 0, moved = 0, lo = Infinity, hi = -Infinity, out = 0, faces = 0;
  for (let n = 0; n < N; n++) { if (n) { const d = Math.abs(fr[n] - fr[n - 1]); if (d > maxStep) maxStep = d; if (d) moved++; } lo = Math.min(lo, fr[n]); hi = Math.max(hi, fr[n]);
    const z = zAt(n); if (z) { faces++; if (z[1] < fr[n] || z[3] > fr[n] + h) out++; } }
  return { fps, h, n: N, c0, ramps, moves, shots: shots.map(s => ({ from: +(s.n0 / fps).toFixed(3), to: +(s.n1 / fps).toFixed(3), faces: s.faces, still: !s.keys, y: Math.round(startOf(s)) })), y, frames, expr,
    stats: { frames: N, shots: shots.length, still: shots.filter(s => !s.keys).length, moves: moves.length, switches: moves.filter(m => !m.e).length, min: lo, max: hi, maxStep, movingFrames: moved, faceFrames: faces, faceOutside: out } };
}

// the face track as the new frame sees it: every zone moved by where the window is at that moment, onto a canvas where
// the window sits at fixedY (kit/exports.cjs fixedY)
function shiftZones(fz, tr, fixedY) {
  const zf = +fz.fps || 8;
  return fz.zones.map((z, i) => { if (!z) return null; const d = tr.y(Math.min(tr.n - 1, Math.round(i / zf * tr.fps))) - fixedY; return [z[0], +(z[1] - d).toFixed(1), z[2], +(z[3] - d).toFixed(1), +((z[4] != null ? z[4] : z[1]) - d).toFixed(1)]; });
}

module.exports = { track, shiftZones, want, insideRange, smooth, AIM, HEAD, CHIN, DEAD, EASE };
