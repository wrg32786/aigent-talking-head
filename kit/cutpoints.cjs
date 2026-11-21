// Cut points: where a piece of speech can start and end without clipping a word. One module for every path that
// cuts a take: clip.py (through the CLI below), Studio's Cut step, Lines, bites and the clean take (kit/studio/cut.mjs),
// renders of those (kit/studio/server.mjs) and tighten in kit/reel.cjs.
//
// The transcript says roughly where each word is; the audio says exactly. The audio is read at 5 ms steps (20 ms
// windows) twice: the whole band, and 3.5 to 12 kHz so the hiss of an s, f, sh or th counts as sound even when it is
// quiet. A frame is sounding when either level is 12 dB over its own room floor (the 10th percentile over 4 s).
// A cut only goes in a quiet run between sounds:
//   end:   at least 120 ms after the last sound (target 180 ms) and at least 60 ms before the next sound
//   start: at least 60 ms before the first sound (target 100 ms), never on the tail of the word before
// The search for an end starts at the last word's transcript end (never 0.25 s before it) and only takes a pause long
// enough to hold those margins, so the 70 ms closure in a p, t or k is never read as the end of the word. When the
// next pause is past the next word, the cut moves to it (up to 1 s, marked "extended": a word is never cut off).
// No pause at all within reach: the quietest junction between the two words, marked "unsure" for the UI.
//
//   node kit/cutpoints.cjs env <audio or video> <out.json>          the envelope, saved
//   node kit/cutpoints.cjs snap <audio or video> <in.json>          { words, ranges, dur?, opts? } -> { ranges, points }
//   node kit/cutpoints.cjs tighten <audio or video> <in.json>       { words, maxPause, range? } -> { spans, cuts }
'use strict';
const { spawn, spawnSync } = require('child_process');

const SR = 32000, HOP = 0.005, WIN = 0.02;
const SNAP = { tailMin: 0.13, tailTarget: 0.18, leadMin: 0.07, leadTarget: 0.11, startTailMin: 0.05, maxExt: 2.0, maxExtStart: 2.0, breathGap: 0.025, rise: 12, faint: 6, floorMin: -115 };
// the numbers the acceptance test holds every cut to (tests/cut-accuracy): the module keeps 10 ms over them
const ACCEPT = { lead: 0.06, tail: 0.12 };

// ---------- the envelope ----------
// the s, f and th band: a 4th order Butterworth band pass, 3.5 to 12 kHz at 32 kHz, as second order sections
// (the same coefficients as scipy.signal.butter(4, [3500, 12000], 'bandpass', fs=32000, output='sos'))
const SOS = [[0.11372140246727554, 0.22744280493455107, 0.11372140246727554, 0.6474612945937886, 0.185090748794383],
  [1, -2, 1, -0.7861296787941218, 0.22678372235660407], [1, 2, 1, 1.1483310368295834, 0.6550745746854378],
  [1, -2, 1, -1.2840887999347694, 0.6844915175305524]];
const bandChain = () => SOS.map(([b0, b1, b2, a1, a2]) => ({ b0, b1, b2, a1, a2, z1: 0, z2: 0 }));
// a streaming builder: push Float32Array chunks of mono samples, then finish()
class EnvBuilder {
  constructor(sr = SR) { if (sr !== SR) throw new Error(`cutpoints: samples must be ${SR} Hz mono`); this.sr = sr; this.hopN = Math.round(sr * HOP); this.winB = Math.round(WIN / HOP); this.chain = bandChain(sr); this.e = []; this.h = []; this.k = 0; this.se = 0; this.sh = 0; }
  push(x) {
    const ch = this.chain;
    for (let i = 0; i < x.length; i++) {
      const v = x[i]; let y = v;
      for (const s of ch) { const o = s.b0 * y + s.z1; s.z1 = s.b1 * y - s.a1 * o + s.z2; s.z2 = s.b2 * y - s.a2 * o; y = o; }
      this.se += v * v; this.sh += y * y;
      if (++this.k === this.hopN) { this.e.push(this.se); this.h.push(this.sh); this.k = 0; this.se = 0; this.sh = 0; }
    }
  }
  finish() {
    const nB = this.e.length, w = this.winB, n = Math.max(0, nB - w + 1), N = this.hopN * w;
    const e = new Float32Array(n), h = new Float32Array(n);
    let se = 0, sh = 0;
    for (let i = 0; i < nB; i++) {
      se += this.e[i]; sh += this.h[i];
      if (i >= w) { se -= this.e[i - w]; sh -= this.h[i - w]; }
      if (i >= w - 1) { const k = i - w + 1; e[k] = 10 * Math.log10(Math.max(se, 0) / N + 1e-12); h[k] = 10 * Math.log10(Math.max(sh, 0) / N + 1e-12); }
    }
    return { v: 2, sr: this.sr, hop: HOP, win: WIN, seconds: +(nB * HOP).toFixed(3), e, h };
  }
}
function envelopeFromSamples(x, sr = SR) { const b = new EnvBuilder(sr); b.push(x); return b.finish(); }
const ffArgs = file => ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
function f32(buf) { const n = Math.floor(buf.length / 4), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = buf.readFloatLE(i * 4); return a; }
// the envelope of a file (async, streamed, so a 20 minute take never sits in memory as samples)
function envelopeOf(file) {
  return new Promise(ok => {
    const b = new EnvBuilder(SR), p = spawn('ffmpeg', ffArgs(file)); let rest = Buffer.alloc(0);
    p.stdout.on('data', d => { const buf = rest.length ? Buffer.concat([rest, d]) : d, n = buf.length - (buf.length % 4); b.push(f32(buf.subarray(0, n))); rest = buf.subarray(n); });
    p.on('error', () => ok(null)); p.stderr.on('data', () => {});
    p.on('close', c => { const env = b.finish(); ok(c === 0 && env.e.length ? env : null); });
  });
}
function envelopeSync(file) {
  const r = spawnSync('ffmpeg', ffArgs(file), { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout || !r.stdout.length) return null;
  const env = envelopeFromSamples(f32(r.stdout), SR); return env.e.length ? env : null;
}
// to and from JSON (0.1 dB steps)
const toJSON = env => ({ v: 2, sr: env.sr, hop: env.hop, win: env.win, seconds: env.seconds, e: Array.from(env.e, x => Math.round(x * 10) / 10), h: Array.from(env.h, x => Math.round(x * 10) / 10) });
const fromJSON = j => (j && j.v === 2 && Array.isArray(j.e) && Array.isArray(j.h) ? { ...j, e: Float32Array.from(j.e), h: Float32Array.from(j.h) } : null);
const isEnv = env => !!(env && env.v === 2 && env.e && env.e.length);

// ---------- sound and quiet ----------
// the room floor: the 10th percentile over 4 s (801 frames) around each frame, edges mirrored (like
// scipy.ndimage.percentile_filter, mode reflect), kept in a sorted window that slides one frame at a time
function floorOf(v, o) {
  const n = v.length, half = 400, size = 2 * half + 1, rank = Math.floor(size * 0.1), f = new Float32Array(n);
  if (!n) return f;
  const at = i => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return v[i]; };
  const win = new Float64Array(size); for (let k = 0; k < size; k++) win[k] = at(k - half); win.sort();
  const find = x => { let lo = 0, hi = size - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < x) lo = m + 1; else hi = m; } return lo; };
  for (let i = 0; i < n; i++) {
    f[i] = Math.max(o.floorMin, win[rank]);
    if (i + 1 < n) {
      const out = Math.fround(at(i - half)), inn = Math.fround(at(i + half + 1));
      let p = find(out); win.copyWithin(p, p + 1); win[size - 1] = Infinity;
      p = find(inn); win.copyWithin(p + 1, p, size - 1); win[p] = inn;
    }
  }
  return f;
}
// sounding frames and the quiet runs between them, worked out once per envelope
function activity(env, o = SNAP) {
  if (env._act) return env._act;
  const n = env.e.length, fe = floorOf(env.e, o), fh = floorOf(env.h, o), act = new Uint8Array(n), faint = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    act[i] = env.e[i] > fe[i] + o.rise || env.h[i] > fh[i] + o.rise ? 1 : 0;
    // faint: 6 dB over the floor, the soft start of a breath into a word or the fading end of an s
    faint[i] = env.e[i] > fe[i] + o.faint || env.h[i] > fh[i] + o.faint ? 1 : 0;
  }
  const t = i => i * env.hop + env.win / 2, gaps = [];
  for (let i = 0; i < n;) {
    if (act[i]) { i++; continue; }
    let j = i; while (j + 1 < n && !act[j + 1]) j++;
    // pEnd: the last sounding frame before the run (-Infinity at the file start); nOn: the next one (Infinity at the end)
    gaps.push({ pEnd: i > 0 ? t(i - 1) : -Infinity, nOn: j < n - 1 ? t(j + 1) : Infinity });
    i = j + 1;
  }
  const a = { act, faint, gaps, t, i: x => Math.max(0, Math.min(n - 1, Math.round((x - env.win / 2) / env.hop))) };
  Object.defineProperty(env, '_act', { value: a, enumerable: false });
  return a;
}
const sounding = (env, x, r = 0.012) => { const A = activity(env); for (let i = A.i(x - r); i <= A.i(x + r); i++) if (A.act[i]) return true; return false; };

// words that cannot be right are re-timed from the audio first. Whisper often stretches a word across a pause: it
// starts the word while the word before is still sounding (or in the quiet after it) and the real sound comes 0.9 to
// 1.6 s later, or it runs a word's end on into the pause. So:
//   a word with a quiet run of HIDDEN (0.35 s) or more inside it keeps only the side with more sound (a late onset
//   starts the word at its sound, a stretched end ends it at its last sound)
//   a word over 1.5 s starts at its first sound and ends at its last
const HIDDEN = 0.35;
function quietRuns(A, i0, i1) { const out = []; for (let i = i0; i <= i1;) { if (A.act[i]) { i++; continue; } let j = i; while (j + 1 <= i1 && !A.act[j + 1]) j++; out.push([i, j]); i = j + 1; } return out; }
function retime(words, env) {
  if (!isEnv(env)) return words;
  const A = activity(env), hidN = Math.round(HIDDEN / env.hop);
  return words.map(w => {
    if (!(w[1] - w[0] >= HIDDEN + 0.05)) return w;
    let i0 = A.i(w[0]), i1 = A.i(w[1]);
    // the longest quiet run inside the word
    const runs = quietRuns(A, i0, i1).filter(([a, b]) => b - a + 1 >= hidN && a > i0 && b < i1);
    if (runs.length) {
      const [qa, qb] = runs.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
      let before = 0, after = 0; for (let i = i0; i < qa; i++) before += A.act[i]; for (let i = qb + 1; i <= i1; i++) after += A.act[i];
      if (after >= before) i0 = qb + 1; else i1 = qa - 1;
    } else if (!(w[1] - w[0] > 1.5)) return w;
    while (i0 < i1 && !A.act[i0]) i0++; while (i1 > i0 && !A.act[i1]) i1--;
    return i1 > i0 ? [+A.t(i0).toFixed(3), +(A.t(i1) + 0.01).toFixed(3), ...w.slice(2)] : w;
  });
}

const r3 = x => +(+x).toFixed(3);
// A transcript that runs early or late as a whole (the first word timed at 0.63 s when the sound starts at 0.90 s):
// the shift, within 0.5 s, where the words (0.1 to 1.5 s long) cover the most sound and the gaps between them the
// least. With 4 or more words, a shift over 40 ms that scores clearly better than none is used. Returns { shift, n }
// (shift 0 when unsure).
function offsetOf(words, env) {
  if (!isEnv(env) || !Array.isArray(words)) return { shift: 0, n: 0 };
  const A = activity(env), N = A.act.length, pre = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + A.act[i];
  const W = words.filter(w => w[1] - w[0] >= 0.1 && w[1] - w[0] < 1.5);
  if (W.length < 4) return { shift: 0, n: W.length };
  // how much of the words' time sounds, minus how much of the gaps between them does, with the words moved by s
  const frac = (a, b) => { const i0 = Math.max(0, Math.min(N, A.i(a))), i1 = Math.max(0, Math.min(N, A.i(b))); return i1 > i0 ? (pre[i1] - pre[i0]) / (i1 - i0) : 0; };
  const score = sh => { let x = 0; for (let k = 0; k < W.length; k++) { x += frac(W[k][0] + sh, W[k][1] + sh); const nx = W[k + 1]; if (nx && nx[0] - W[k][1] >= 0.1) x -= frac(W[k][1] + sh + 0.03, nx[0] + sh - 0.03); } return x / W.length; };
  let best = 0, bs = score(0); const s0 = bs;
  for (let k = -50; k <= 50; k++) { const sh = k / 100, v = score(sh); if (v > bs + 1e-9) { bs = v; best = sh; } }
  return Math.abs(best) > 0.04 && bs >= 0.5 && bs - s0 >= 0.1 ? { shift: r3(best), n: W.length } : { shift: 0, n: W.length };
}
function align(words, env) { const { shift } = offsetOf(words, env); return shift ? words.map(w => [r3(Math.max(0, w[0] + shift)), r3(Math.max(0, w[1] + shift)), ...w.slice(2)]) : words; }
// the end cut after word L (N is the word after it, or null)
function endEdge(L, N, env, D, o, W = []) {
  const { gaps } = activity(env, o), te = L[1], tol = Math.min(0.08, 0.25 * Math.max(0, L[1] - L[0])), from = te - tol;
  let best = null;
  for (const g of gaps) {
    if (g.nOn <= from + o.breathGap) continue;
    if (g.pEnd > te + o.maxExt) break;
    // the sound after the pause: a word keeps 60 ms clear of the cut when the pause has room; a breath or click no
    // word sits on, or a word after a pause too short for both, only 25 ms (the word is not in the piece either way)
    const word = W.some(w => w[1] > g.nOn - 0.05 && w[0] < g.nOn + 0.1);
    const lo = Math.max(g.pEnd + o.tailMin, from, 0);
    for (const lead of word ? [o.leadMin, o.breathGap] : [o.breathGap]) {
      const hi = Math.min(g.nOn - lead, D);
      if (lo > hi) continue;
      let cut = Math.min(Math.max(g.pEnd + o.tailTarget, lo), hi); const ext = !!(N && g.pEnd > N[0] + 0.05);
      // a fade still faintly sounding after the last loud frame: cut 60 ms after it too, when the pause has room
      if (Number.isFinite(g.pEnd)) { const A = activity(env, o); let j = A.i(g.pEnd); while (j + 1 < A.faint.length && A.faint[j + 1] && A.t(j + 1) < hi) j++; const fe = A.t(j) + 0.06; if (fe > cut && fe <= hi) cut = fe; else if (fe > hi) cut = hi; }
      const tight = word && lead < o.leadMin;
      return { cut, sound: g.pEnd, next: g.nOn, sure: true, extended: ext, tight, by: ext ? 'no pause after the word: extended to the next pause' : tight ? 'short pause before the next word: cut close to it' : g.pEnd > te + 0.03 ? 'audio: the word ran past the transcript' : g.pEnd < te - 0.05 ? 'audio: the word ended before the transcript' : 'pause after the word' };
    }
    // a pause too short to hold both margins: remember the roomiest one in case nothing fits
    const room = Math.min((Math.min(g.nOn, D) - Math.max(g.pEnd, from)), 9);
    if (g.pEnd <= (N ? N[0] + 0.05 : Infinity) && (!best || room > best.room)) best = { g, room };
  }
  if (best) { const g = best.g, a = Math.max(g.pEnd, from), b = Math.min(g.nOn, D), cut = Math.max(a, b - 0.015); return { cut, sound: g.pEnd, next: g.nOn, sure: false, by: 'unsure: only a short pause after the word' }; }
  const cut = N ? Math.max(te, (te + N[0]) / 2) : Math.min(D, te + o.tailTarget);
  return { cut, sound: te, next: N ? N[0] : D, sure: false, by: 'unsure: no pause after the word' };
}
// the start cut before word F (P is the word before it, or null)
function startEdge(F, P, env, D, o) {
  const { gaps } = activity(env, o), ts = F[0], tol = Math.min(0.15, 0.4 * Math.max(0, F[1] - F[0]));
  let best = null;
  for (let k = gaps.length - 1; k >= 0; k--) {
    const g = gaps[k];
    if (g.pEnd >= ts + tol) continue;
    if (g.nOn < ts - o.maxExtStart) break;
    const lo = Math.max(g.pEnd + o.startTailMin, 0), hi = Math.min(g.nOn - o.leadMin, D);
    if (lo <= hi) {
      let cut = Math.max(g.nOn - o.leadTarget, lo); const ext = !!(P && g.nOn < P[1] - 0.05);
      // a soft start (a breath or an h before the word): start 40 ms before that too, when the pause has room
      if (Number.isFinite(g.nOn)) { const A = activity(env, o); let j = A.i(g.nOn); while (j - 1 >= 0 && A.faint[j - 1] && A.t(j - 1) > lo) j--; const fs = A.t(j) - 0.04; if (fs < cut && fs >= lo) cut = fs; else if (fs < lo) cut = lo; }
      return { cut, sound: g.nOn, prev: g.pEnd, sure: true, extended: ext, by: ext ? 'no pause before the word: extended to the pause before' : g.nOn < ts - 0.03 ? 'audio: the word started before the transcript' : g.nOn > ts + 0.03 ? 'audio: the word started after the transcript' : 'pause before the word' };
    }
    const room = Math.min(g.nOn, D) - Math.max(g.pEnd, 0);
    if (g.nOn >= (P ? P[1] - 0.05 : -Infinity) && (!best || room > best.room)) best = { g, room };
  }
  if (best) { const g = best.g, a = Math.max(g.pEnd, 0), b = Math.min(g.nOn, D), cut = a + (b - a) * 0.4; return { cut, sound: g.nOn, prev: g.pEnd, sure: false, by: 'unsure: only a short pause before the word' }; }
  const cut = P ? Math.min(ts, (P[1] + ts) / 2) : Math.max(0, ts - o.leadTarget);
  return { cut, sound: ts, prev: P ? P[1] : 0, sure: false, by: 'unsure: no pause before the word' };
}

// snap one range [a, b] to the audio: { range, points: [{ edge, word, transcript, audio, cut, by, shift, sure }] }
function snapRange([a, b], words, env, dur, opts = {}) {
  const o = { ...SNAP, ...opts };
  if (!isEnv(env)) return { range: [a, b], points: [] };
  const D = dur || env.seconds || env.e.length * env.hop, W = retime(opts.aligned ? (words || []) : align(words || [], env), env);
  let idx = W.map((w, k) => k).filter(k => W[k][1] > a + 0.02 && W[k][0] < b - 0.02);
  // an end inside a clean pause stays in it: a word whose sound starts after that pause is the next line, left out
  // (and a start inside one leaves out the word that ends before it)
  // A clean pause has no whole word inside it (words inside mean the audio there is not a pause the transcript agrees with)
  const { gaps } = activity(env, o), clean = g => !W.some(w => w[0] >= g.pEnd - 0.02 && w[1] <= g.nOn + 0.02 && w[1] - w[0] >= 0.05);
  const inGap = x => gaps.find(g => g.pEnd <= x && x <= g.nOn && g.nOn - g.pEnd >= o.tailMin + o.leadMin && clean(g));
  const gb = inGap(b), ga = inGap(a);
  if (gb && idx.length > 1) idx = idx.filter((k, j) => j === 0 || W[k][0] < gb.pEnd);
  if (ga && idx.length > 1) idx = idx.filter((k, j) => j === idx.length - 1 || W[k][1] > ga.nOn);
  if (!idx.length) idx = W.map((w, k) => k).filter(k => W[k][0] >= a - 0.02 && W[k][1] <= b + 0.02); // a line of one 0 s word
  if (!idx.length) return { range: [r3(a), r3(b)], points: [] };
  const fi = idx[0], li = idx[idx.length - 1], F = W[fi], L = W[li];
  const s = startEdge(F, W[fi - 1] || null, env, D, o), e = endEdge(L, W[li + 1] || null, env, D, o, W);
  const pt = (edge, w, x) => ({ edge, word: String(w[2] || ''), transcript: r3(edge === 'start' ? w[0] : w[1]), audio: r3(Number.isFinite(x.sound) ? x.sound : (edge === 'start' ? w[0] : w[1])), cut: r3(x.cut), by: x.by, shift: r3(x.cut - (edge === 'start' ? w[0] : w[1])), sure: x.sure, ...(x.extended ? { extended: true } : {}), ...(x.tight ? { tight: true } : {}) });
  if (!(e.cut - s.cut >= 0.1)) return { range: [r3(a), r3(b)], points: [pt('start', F, { ...s, cut: a, by: 'kept as is (too short to snap)' }), pt('end', L, { ...e, cut: b, by: 'kept as is (too short to snap)' })] };
  return { range: [r3(s.cut), r3(e.cut)], points: [pt('start', F, s), pt('end', L, e)] };
}
// ranges that touch or overlap after snapping become one
function mergeRanges(R) { const out = []; for (const r of R) { const l = out[out.length - 1]; if (l && r[0] <= l[1] + 0.001 && r[0] >= l[0]) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); } return out; }
function snapRanges(ranges, words, env, dur, o) {
  if (!isEnv(env)) return { ranges, cuts: null };
  const out = ranges.map(r => snapRange(r, words, env, dur, o));
  return { ranges: mergeRanges(out.map(x => x.range)), cuts: out.flatMap((x, k) => x.points.map(p => ({ ...p, part: k }))) };
}

// pauses inside [a0, b0] from the AUDIO, not the word gaps: Whisper stretches words over pauses, so a pause can sit
// inside a "word". Each quiet run between two sounds is a pause. A short sound no word sits on (under 0.3 s, quiet of
// at least 0.3 s on both sides: a click, a lip smack, a chair) joins the two quiet runs into one pause and is listed in
// "noises", so tighten cuts it out with the silence. Returns [{ pEnd, nOn, noises: [[from, to]], L, N, i }].
const NOISE = { max: 0.3, quiet: 0.3, overlap: 0.4 };
function wordOn(W, x, y) { const d = y - x; return W.some(w => Math.min(w[1], y) - Math.max(w[0], x) > NOISE.overlap * d); }
function pausesIn(words, env, [a0, b0], o = SNAP, { noises = true } = {}) {
  const W = retime((words || []).filter(w => w[1] > w[0]), env), { gaps } = activity(env, o), out = [];
  for (const g of gaps) {
    if (!Number.isFinite(g.pEnd) || !Number.isFinite(g.nOn) || g.pEnd < a0 || g.nOn > b0) continue;
    const l = out[out.length - 1];
    if (noises && l && g.pEnd - l.nOn <= NOISE.max && l.nOn - l.lastQ >= NOISE.quiet && g.nOn - g.pEnd >= NOISE.quiet && !wordOn(W, l.nOn, g.pEnd)) {
      l.noises.push([r3(l.nOn), r3(g.pEnd)]); l.lastQ = g.pEnd; l.nOn = g.nOn; continue;
    }
    out.push({ pEnd: g.pEnd, nOn: g.nOn, lastQ: g.pEnd, noises: [] });
  }
  return out.map(({ lastQ, ...p }) => {
    let i = -1; for (let k = 0; k < W.length; k++) if (W[k][0] < p.pEnd + 0.01) i = k; else break;
    return { ...p, i, L: W[i] || [a0, a0, ''], N: W.slice(i + 1).find(w => w[1] > p.nOn - 0.01) || [b0, b0, ''] };
  });
}
// short sounds no word sits on (80 ms to 0.3 s), inside the pauses of [a0, b0] (for the agent: "a noise at 819.0")
function noisesIn(words, env, range, o = SNAP) {
  if (!isEnv(env)) return [];
  const D = env.seconds, [a0, b0] = range || [0, D];
  return pausesIn(words, env, [a0, b0], o).flatMap(p => p.noises.filter(([f, t]) => t - f >= 0.08).map(([from, to]) => ({ from, to, seconds: r3(to - from), after: String(p.L[2] || '').slice(0, 24), before: String(p.N[2] || '').slice(0, 24) })));
}

// tighten (no dead air): every pause inside [a, b] longer than maxPause becomes a jump. Pauses come from the audio
// (pausesIn: a pause Whisper hid inside a stretched word counts, a click inside a pause goes with it). The cut goes
// 180 ms after the last sound (at least 120 ms of breath, and 60 ms past a fading tail) and the piece resumes 110 ms
// before the next sound (40 ms before a soft start), both from the audio.
// keep(at, i, L, N) true leaves that pause. Returns { spans: [[x, y]], cuts: [{ at, resume, gap, after, i, noise? }] }.
function tightenSpans(words, env, maxPause, { range, keep, dur } = {}, opts = {}) {
  const o = { ...SNAP, ...opts }, D = dur || (isEnv(env) ? env.seconds : 0), [a0, b0] = range || [0, D];
  if (!maxPause || !isEnv(env)) return { spans: [[a0, b0]], cuts: [] };
  const A = activity(env, o), spans = [], cuts = [];
  let a = a0;
  for (const p of pausesIn((words || []).filter(w => w[1] > w[0] && w[0] >= a0 - 0.05 && w[1] <= b0 + 0.05), env, [a0, b0], o, { noises: opts.noises !== false })) {
    if (p.nOn - p.pEnd <= maxPause) continue;
    let at = p.pEnd + o.tailTarget, resume = p.nOn - o.leadTarget;
    // a fading tail after the last loud frame / a soft start before the next: keep them too, when the pause has room
    let j = A.i(p.pEnd); while (j + 1 < A.faint.length && A.faint[j + 1] && A.t(j + 1) < p.nOn) j++; if (A.t(j) + 0.06 > at && A.t(j) + 0.06 < resume - 0.2) at = A.t(j) + 0.06;
    j = A.i(p.nOn); while (j - 1 >= 0 && A.faint[j - 1] && A.t(j - 1) > at) j--; if (A.t(j) - 0.04 < resume && A.t(j) - 0.04 > at + 0.2) resume = A.t(j) - 0.04;
    if (resume - at < 0.2 || at - a < 0.35 || at > b0 || resume < a0) continue;
    if (keep && keep(r3(at), p.i, p.L, p.N)) continue;
    spans.push([r3(a), r3(at)]); a = resume;
    cuts.push({ at: r3(at), resume: r3(resume), gap: r3(p.nOn - p.pEnd), after: String(p.L[2] || '').slice(0, 24), i: p.i, ...(p.noises.length ? { noise: p.noises } : {}) });
  }
  spans.push([r3(a), r3(b0)]);
  return { spans: spans.filter(([x, y]) => y - x > 0.05), cuts };
}

// how a cut sits on the audio, for tests and the bench: inside a sounding word, and the quiet kept before / after
function edgeReport(env, words, c, edge) {
  const A = activity(env), i = A.i(c), w = (words || []).find(x => x[0] + 0.03 < c && c < x[1] - 0.03);
  let pad;
  if (edge === 'start') { if (A.act[i]) { let j = i; while (j > 0 && A.act[j - 1]) j--; pad = -(c - A.t(j)); } else { let j = i; while (j < A.act.length - 1 && !A.act[j]) j++; pad = A.t(j) - c; } }
  else { if (A.act[i]) { let j = i; while (j < A.act.length - 1 && A.act[j + 1]) j++; pad = -(A.t(j) - c); } else { let j = i; while (j > 0 && !A.act[j]) j--; pad = c - A.t(j); } }
  return { midWord: !!(w && sounding(env, c)), word: w ? w[2] : null, pad: r3(pad) };
}

module.exports = { offsetOf, align, SNAP, ACCEPT, SR, HOP, WIN, EnvBuilder, envelopeFromSamples, envelopeOf, envelopeSync, toJSON, fromJSON, isEnv, activity, sounding, retime, endEdge, startEdge, snapRange, snapRanges, mergeRanges, tightenSpans, pausesIn, noisesIn, edgeReport, HIDDEN, NOISE };

if (require.main === module) {
  const [cmd, file, inF] = process.argv.slice(2), fs = require('fs');
  const die = m => { console.error('error: ' + m); process.exit(1); };
  if (!cmd || !file) die('use: env <file> <out.json> | snap <file> <in.json> | tighten <file> <in.json>');
  const env = envelopeSync(file); if (!env) die('could not read the audio of ' + file);
  if (cmd === 'env') { fs.writeFileSync(inF, JSON.stringify(toJSON(env))); console.log(`envelope: ${env.e.length} frames, ${env.seconds} s -> ${inF}`); }
  else {
    const j = JSON.parse(fs.readFileSync(inF, 'utf8'));
    if (cmd === 'snap') process.stdout.write(JSON.stringify((j.ranges || []).map(r => snapRange(r, j.words || [], env, j.dur, j.opts || {}))));
    else if (cmd === 'tighten') process.stdout.write(JSON.stringify(tightenSpans(j.words || [], env, j.maxPause, { range: j.range, dur: j.dur }, j.opts || {})));
    else die('use env, snap or tighten');
  }
}
