// The join check for npm run verify (1.29.0): every cut looked at as a pair, the last frame before it against the first
// frame after, read from the finished reel. Findings are notes with the two stills beside them, never a gate: a score
// is information and does not block a reel. What the plan declares is not a finding (a transition, a change of finish
// or grade between the two shots, an insert). The result carries a hash of cut.json, so a reader can tell it is out of
// date after an edit, and it ends with what was not checked.
//   break  a hard cut that hardly changes the picture: it reads as a stutter, not a cut (punch in, or cut elsewhere)
//   drift  the colour jumps across a cut though both shots have the same finish and grade
// idea from mojomast/open-higgsfield-skills skills/continuity-check (MIT; method from fagemx/ZeroField, MIT)
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('./rules.cjs');

const W = 36, H = 64, N = W * H * 3;
// shortcut: a whole-frame difference stands in for "the face neither moved nor changed size"; use kit/framing.py per join if this proves too coarse
const T = { same: 4, drift: 14 };   // mean difference of 255 under which a cut is invisible; Lab distance over which colour jumps

function lab(r, g, b) {
  const f = v => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }, R1 = f(r), G1 = f(g), B1 = f(b);
  const g3 = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116), x = g3((0.4124 * R1 + 0.3576 * G1 + 0.1805 * B1) / 0.9505), y = g3(0.2126 * R1 + 0.7152 * G1 + 0.0722 * B1), z = g3((0.0193 * R1 + 0.1192 * G1 + 0.9505 * B1) / 1.089);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// two frames (rgb24, W by H) -> { diff: mean absolute difference, dE: Lab distance of their mean colours }
function compare(a, b) {
  let d = 0; const ma = [0, 0, 0], mb = [0, 0, 0];
  for (let i = 0; i < N; i++) { d += Math.abs(a[i] - b[i]); ma[i % 3] += a[i]; mb[i % 3] += b[i]; }
  const n = N / 3, la = lab(ma[0] / n, ma[1] / n, ma[2] / n), lb = lab(mb[0] / n, mb[1] / n, mb[2] / n);
  return { diff: d / N, dE: Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) };
}
// what the plan says about the join into segment i: null when nothing is declared, else why it is not a finding
function declared(C, CAP, i, TL) {
  const s = C.segs[i], p = C.segs[i - 1], t = TL.segs[i].start;
  if (s.transition && R.xfadeMode(s.transition)) return 'transition ' + s.transition;
  if (CAP && R.titleExitSeams(CAP, C)[i]) return 'a title exit';
  if ((s.finish || C.finish || '') !== (p.finish || C.finish || '') || (s.lut || '') !== (p.lut || '')) return 'a change of finish or grade';
  if ((C.inserts || []).some(x => Math.abs((+x.at || 0) - t) < 0.2 || Math.abs((+x.at || 0) + (+x.dur || 0) - t) < 0.2)) return 'an insert';
  if (((CAP && CAP.flips) || []).some(f => [4, 8].includes(f.mode) && t >= f.start - 0.1 && t <= f.end + 0.1)) return 'a card';
  return null;
}
function grab(file, t, fps) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', Math.max(0, t - 2 / fps).toFixed(4), '-i', file, '-frames:v', '4', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 16 << 20 });
  return buf.length >= 3 * N ? [buf.subarray(N, 2 * N), buf.subarray(2 * N, 3 * N)] : null;
}
// file: the finished reel; C: cut.json; CAP: captions; outDir: where the stills of a finding go (verify/).
// Returns { hash, joins: [{ i, t, diff, dE, kind, why, stills }], findings, notChecked }
function check(file, C, CAP, { fps = 24, outDir = null } = {}) {
  const TL = R.timeline(C), joins = [], hash = crypto.createHash('sha1').update(JSON.stringify(C)).digest('hex').slice(0, 12);
  const notChecked = ['a title that stays across a cut (the overlay draws it apart from the cuts, so its box cannot move)', 'the reference\'s own colour change at the matching cut (the plan\'s finish and grade are used as what is declared)', 'whether a face moved, in a shot that is mostly background'];
  for (const g of TL.segs) {
    if (!g.i) continue;
    const dec = declared(C, CAP, g.i, TL); let pair = null;
    try { pair = grab(file, g.start, fps); } catch {}
    if (!pair) { notChecked.push(`the cut at ${g.start.toFixed(2)} s (no frames read)`); continue; }
    const m = compare(pair[0], pair[1]), j = { i: g.i, t: +g.start.toFixed(3), diff: +m.diff.toFixed(2), dE: +m.dE.toFixed(1), declared: dec, kind: null };
    if (!dec && m.diff < T.same) { j.kind = 'break'; j.why = `the cut at ${j.t.toFixed(2)} s hardly changes the picture (difference ${j.diff} of 255): it may read as a stutter. Punch in on one side or cut somewhere else`; }
    else if (!dec && m.dE > T.drift) { j.kind = 'drift'; j.why = `the colour jumps across the cut at ${j.t.toFixed(2)} s (Lab distance ${j.dE}) though both shots have the same finish and grade`; }
    if (j.kind && outDir) try {
      const p = path.join(outDir, `join-${String(g.i).padStart(2, '0')}-${j.t.toFixed(2)}s.png`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', Math.max(0, j.t - 1 / fps - 0.005).toFixed(4), '-i', file, '-vf', 'scale=270:-2,tile=2x1', '-frames:v', '1', p]); j.stills = p;
    } catch {}
    joins.push(j);
  }
  const findings = joins.filter(j => j.kind).sort((a, b) => (a.kind === 'break' ? 0 : 1) - (b.kind === 'break' ? 0 : 1) || a.t - b.t); // breaks first
  const out = { hash, joins, findings, notChecked };
  if (outDir) try { fs.writeFileSync(path.join(outDir, 'joins.json'), JSON.stringify(out, null, 1)); } catch {}
  return out;
}
module.exports = { T, compare, declared, check };
