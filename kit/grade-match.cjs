// Grade match: your take's colour moved to the reference's, shot by shot, skin kept (kit/grade_match.py does the
// colour maths and bakes the 3D LUTs; this is the Node side kit/reel.cjs calls).
//   - a target is a shot's colour in Lab: { mean: [L, a, b], std: [L, a, b] }. A teardown writes it per shot as the
//     Reel.md shot key "lab" (34.2,2.2,9.5~22.4,6.2,8.2: mean~spread); a style look keeps one pooled target
//   - match() fits each shot of your edit to its target and writes build/grade*.cube; every segment of the shot gets
//     "lut" in cut.json, which kit/assemble.cjs applies with ffmpeg lut3d before any finish
//   - the LUT is the base grade. The finish choice (grain, vignette, teal and the rest) is untouched and stacks on top
// Off with the Reel.md Style line "grade-match: off" or --no-grade-match.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STRENGTH = 0.85, SKIN = 0.35, SIZE = 33;
const r1 = x => +(+x).toFixed(1), r3 = x => +(+x).toFixed(3);

function parseLab(v) {
  const m = /^\s*(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)~([\d.]+),([\d.]+),([\d.]+)\s*$/.exec(String(v == null ? '' : v));
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return n.every(Number.isFinite) ? { mean: n.slice(0, 3), std: n.slice(3) } : null;
}
const fmtLab = t => (t && Array.isArray(t.mean) && Array.isArray(t.std) ? `${t.mean.map(r1).join(',')}~${t.std.map(r1).join(',')}` : null);

// the mean of a list of targets (shots weighted by w when given): the one target a style look carries
function pool(targets, weights) {
  const have = targets.map((t, i) => [t, weights ? +weights[i] || 0 : 1]).filter(([t, w]) => t && w > 0);
  if (!have.length) return null;
  const W = have.reduce((a, [, w]) => a + w, 0), avg = k => [0, 1, 2].map(c => r1(have.reduce((a, [t, w]) => a + t[k][c] * w, 0) / W));
  return { mean: avg('mean'), std: avg('std') };
}

const py = (python, args) => JSON.parse(execFileSync(python, [path.join(__dirname, 'grade_match.py'), ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, env: { ...process.env, PYTHONUTF8: '1' } }).toString().trim().split(/\r?\n/).pop());

// the colour of each span of a video (null: black or too short)
function stats(python, video, spans, { min = 2 } = {}) {
  try { return py(python, ['stats', video, '--spans', spans.map(([a, b]) => `${r3(a)}-${r3(b)}`).join(','), '--min', String(min)]).spans; } catch { return spans.map(() => null); }
}

// Fit and bake. segs: the cut's segments (file relative to build, in, out); shotStart[j]: the first segment of shot j;
// targets[j]: that shot's target or null (it borrows the mean of the others). Sets seg.lut and returns
// { ok, single, shots: [{ lut, strength, before, after } | null], why }.
function match({ python, build, segs, shotStart, targets, strength = STRENGTH, skin = SKIN, size = SIZE, dir = 'grade' }) {
  if (!targets.some(Boolean)) return { ok: false, why: 'the reference has no colour to match (no shot long enough to read)' };
  // the LUTs end up beside cut.json (grade.cube, grade-shot-03.cube), where a reel's snapshot keeps them; the folder is
  // only where they are made
  const outDir = path.join(build, dir);
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const f of fs.readdirSync(build)) if (/^grade(-[\w-]+)?\.cube$/.test(f)) fs.rmSync(path.join(build, f), { force: true });
  const flat = f => { const rel = path.relative(outDir, f).split(path.sep).join('-').replace(/\.cube$/, ''), name = (rel === 'grade' ? 'grade' : 'grade-' + rel.replace(/-grade$/, '')) + '.cube';
    if (fs.existsSync(f)) fs.renameSync(f, path.join(build, name)); return name; };
  // one group per shot and file: a shot is its segments' span in that file
  const groups = [];
  shotStart.forEach((k, j) => {
    const end = shotStart[j + 1] != null ? shotStart[j + 1] : segs.length;
    for (let i = k; i < end; i++) {
      const g = groups.find(x => x.shot === j && x.file === segs[i].file);
      if (g) { g.a = Math.min(g.a, segs[i].in); g.b = Math.max(g.b, segs[i].out); g.segs.push(i); } else groups.push({ shot: j, file: segs[i].file, a: segs[i].in, b: segs[i].out, segs: [i] });
    }
  });
  const files = [...new Set(groups.map(g => g.file))], shots = shotStart.map(() => null);
  let single = files.length === 1, any = false, why = null;
  files.forEach((file, fi) => {
    const gs = groups.filter(g => g.file === file), sub = files.length > 1 ? path.join(outDir, 'f' + (fi + 1)) : outDir;
    fs.mkdirSync(sub, { recursive: true });
    const tf = path.join(sub, 'targets.json');
    fs.writeFileSync(tf, JSON.stringify(gs.map(g => targets[g.shot] || null)));
    let res;
    try { res = py(python, ['fit', path.resolve(build, file), '--spans', gs.map(g => `${r3(g.a)}-${r3(g.b)}`).join(','), '--targets', tf, '--out-dir', sub, '--strength', String(strength), '--skin', String(skin), '--size', String(size)]); }
    catch (e) { why = String(e.message).split('\n')[0]; single = false; return; }
    if (!res.ok) { why = res.why; single = false; return; }
    if (!res.single) single = false;
    gs.forEach((g, n) => {
      const s = res.shots[n]; if (!s) return;
      const lut = flat(s.lut);
      for (const i of g.segs) segs[i].lut = lut;
      if (!shots[g.shot]) shots[g.shot] = { lut, strength: s.strength, before: s.before, after: s.after, skinShare: s.skin_share, ...(s.borrowed ? { borrowed: true } : {}) };
      any = true;
    });
  });
  fs.rmSync(outDir, { recursive: true, force: true });
  const luts = new Set(shots.filter(Boolean).map(x => x.lut)).size;
  return any ? { ok: true, single: single || luts === 1, luts, skin, shots } : { ok: false, why: why || 'no frames to read in your take' };
}

// the honest one line for the log
function line(res, what = 'the reference') {
  if (!res || !res.ok) return `grade: not matched (${(res && res.why) || 'off'}); your take keeps its own colour`;
  const s = res.shots.filter(Boolean), avg = k => (s.reduce((a, x) => a + x[k], 0) / s.length).toFixed(1), low = s.filter(x => x.strength < STRENGTH - 0.01).length;
  return `grade: matched ${what} ${res.single ? 'with one LUT for the job (the shots agree)' : res.luts && res.luts < s.length ? `with ${res.luts} LUTs (shots that agree share one)` : 'per shot'}, skin kept at ${Math.round(res.skin * 100)}% of the change; colour distance ${avg('before')} -> ${avg('after')} (Lab)${low ? `; strength lowered on ${low} shot${low === 1 ? '' : 's'} so nothing clips` : ''}`;
}

module.exports = { match, stats, pool, parseLab, fmtLab, line, STRENGTH, SKIN, SIZE };
