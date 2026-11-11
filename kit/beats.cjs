// Beat-sync helpers and optional film-finish filters. Used by reel.cjs, assemble.cjs,
// fx.cjs, check.mjs and smoke.mjs.
//
// Beat analysis itself is kit/beats.py (librosa). The snap rules live here so we never
// move speech cuts: only punches, SFX times, fx hit points, title entrances, and drop
// shakes jump to a nearby beat or onset (default window 120 ms). At most two drop
// shakes land in one segment (the music-video effects_planner cap).
//
// Adapted from Will Gwyn's music-video project, relicensed Apache-2.0 by the author.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('./rules.cjs');

const WINDOW = 0.12;
const DROP_INTENSITY_MIN = 0.85;
const MAX_SHAKES_PER_SEG = 2;
const SHAKE_STRENGTH = 18;

// Film-finish looks built from stock ffmpeg filters only. No LUT files, no light-leak
// overlays. Applied on the picture, before titles and captions, so type stays clean.
const FINISH = {
  grain: { does: 'film grain', vf: (p) => `noise=alls=${Math.round((p.intensity ?? 0.4) * 30)}:allf=t+u` },
  vignette: { does: 'darkened edges', vf: (p) => `vignette=PI*${(0.1 + (p.intensity ?? 0.5) * 0.9).toFixed(3)}:eval=init` },
  chroma: { does: 'RGB channel offset', vf: (p) => { const n = Math.max(1, Math.min(10, p.px ?? p.shift ?? 2)); return `rgbashift=rh=${n}:bh=-${n}`; } },
  'scan-lines': { does: 'CRT scan lines', vf: (p) => { const op = p.opacity ?? 0.3, d = Math.max(1, p.density ?? 4), k = (1 - op).toFixed(3); return `geq=lum='if(eq(mod(Y\\,${d})\\,0)\\,lum(X\\,Y)*${k}\\,lum(X\\,Y))':cb='cb(X\\,Y)':cr='cr(X\\,Y)'`; } },
  warm: { does: 'warm grade', vf: (p) => { const s = p.strength ?? 0.4; return `colorbalance=rs=${(0.2 * s).toFixed(3)}:gs=${(0.05 * s).toFixed(3)}:bs=${(-0.15 * s).toFixed(3)}`; } },
  cool: { does: 'cool grade', vf: (p) => { const s = p.strength ?? 0.4; return `colorbalance=rs=${(-0.12 * s).toFixed(3)}:bs=${(0.18 * s).toFixed(3)}`; } },
  teal: { does: 'teal shadows, warm skin', vf: (p) => { const k = (p.strength ?? 0.6) / 0.6; const n = (x) => (x * k).toFixed(3); return `colorbalance=rs=${n(-0.28)}:gs=${n(0.10)}:bs=${n(0.32)}:rm=${n(-0.06)}:gm=${n(0.06)}:bm=${n(0.10)}:rh=${n(0.16)}:gh=${n(0.03)}:bh=${n(-0.12)},eq=saturation=${(1 + 0.04 * k).toFixed(3)}`; } },
  crushed: { does: 'crushed blacks', vf: (p) => { const c = p.strength ?? 0.5; return `curves=all='0/0 ${(0.2 - c * 0.08).toFixed(3)}/0 0.5/${(0.5 - c * 0.06).toFixed(3)} 1/1'`; } },
  mono: { does: 'black and white', vf: () => 'hue=s=0' },
  bleach: { does: 'bleach-bypass grade', vf: (p) => { const s = p.strength ?? 0.7; return `hue=s=${(1 - s * 0.65).toFixed(3)},eq=contrast=${(1 + s * 0.4).toFixed(3)}:brightness=${(-s * 0.05).toFixed(3)}:gamma=1.05`; } },
};
// aliases
FINISH['chromatic'] = FINISH.chroma;
FINISH['chromatic-aberration'] = FINISH.chroma;
FINISH['chromatic_aberration'] = FINISH.chroma;
FINISH['scan_lines'] = FINISH['scan-lines'];
FINISH['scanlines'] = FINISH['scan-lines'];
FINISH['bw'] = FINISH.mono;
FINISH['teal-orange'] = FINISH.teal;
FINISH['teal_orange'] = FINISH.teal;
FINISH['crushed-blacks'] = FINISH.crushed;
FINISH['crushed_blacks'] = FINISH.crushed;
FINISH['bleach-bypass'] = FINISH.bleach;
FINISH['bleach_bypass'] = FINISH.bleach;

const CANON = ['grain', 'vignette', 'chroma', 'scan-lines', 'warm', 'cool', 'teal', 'crushed', 'mono', 'bleach'];

function finishName(n) {
  if (n == null || n === '' || n === false) return null;
  const k = String(n).toLowerCase();
  if (FINISH[k]) return k;
  return undefined;
}

// A finish value is a name, a list of names, or { name: true|{...params}, ... }.
function parseFinish(raw) {
  if (raw == null || raw === false || raw === '') return [];
  if (typeof raw === 'string') {
    return raw.split(/[,+\s]+/).filter(Boolean).map(n => {
      const k = finishName(n);
      if (k === undefined) throw new Error(`unknown finish "${n}" (use ${CANON.join(', ')})`);
      return { name: k, params: {} };
    });
  }
  if (Array.isArray(raw)) {
    return raw.flatMap(x => (typeof x === 'string' ? parseFinish(x) : parseFinish(x && x.type ? { [x.type]: x } : x)));
  }
  if (typeof raw === 'object') {
    return Object.entries(raw).map(([n, v]) => {
      const k = finishName(n);
      if (k === undefined) throw new Error(`unknown finish "${n}" (use ${CANON.join(', ')})`);
      const params = v && typeof v === 'object' ? v : {};
      return { name: k, params };
    });
  }
  throw new Error('finish must be a name, a list, or an object of names');
}

function finishChain(raw) {
  const parts = parseFinish(raw).map(({ name, params }) => FINISH[name].vf(params || {}));
  return parts.filter(Boolean).join(',');
}

function wantBeatSync(cut) {
  if (!cut) return false;
  if (cut.beatSync === false) return false;
  if (cut.beatSync === true) return true;
  return !!cut.bed;
}

function windowOf(cut) {
  const w = cut && cut.beatWindow;
  return w == null ? WINDOW : Math.max(0, Math.min(0.5, +w));
}

function anchors(grid) {
  if (!grid) return [];
  const s = new Set();
  for (const t of [...(grid.beats || []), ...(grid.onsets || [])]) if (t >= 0) s.add(+Number(t).toFixed(4));
  return [...s].sort((a, b) => a - b);
}

function snap(t, times, win = WINDOW) {
  if (t == null || !times || !times.length || !win) return { t: +t, snapped: false, from: +t };
  let best = +t, d = win + 1;
  for (const x of times) {
    const dd = Math.abs(x - t);
    if (dd < d) { d = dd; best = x; }
  }
  if (d <= win) return { t: +best.toFixed(4), snapped: d > 1e-6, from: +t, delta: +(best - t).toFixed(4) };
  return { t: +t, snapped: false, from: +t };
}

function strongDrops(grid, min = DROP_INTENSITY_MIN) {
  return (grid && grid.drops || []).filter(d => (d.intensity ?? 0) >= min && d.time >= 0);
}

// At most MAX_SHAKES_PER_SEG drop-shakes per segment; skip a drop already sitting on a seam hit.
function planDropShakes(cut, grid, opts = {}) {
  const TL = R.timeline(cut);
  const min = opts.minIntensity ?? cut.dropMin ?? DROP_INTENSITY_MIN;
  const drops = strongDrops(grid, min);
  const existing = new Set((cut.hits || []).map(h => (+h[0]).toFixed(3)));
  const bySeg = {};
  const out = [];
  for (const d of drops) {
    const seg = TL.segs.find(s => d.time >= s.start - 0.001 && d.time < s.end + 0.001);
    const i = seg ? seg.i : (d.time >= TL.total ? TL.segs.length - 1 : 0);
    bySeg[i] = bySeg[i] || 0;
    if (bySeg[i] >= MAX_SHAKES_PER_SEG) continue;
    if (existing.has((+d.time).toFixed(3))) continue;
    const strength = Math.round(SHAKE_STRENGTH + 12 * Math.min(1, d.intensity || 0));
    out.push({ t: +(+d.time).toFixed(3), strength, intensity: d.intensity, seg: i });
    bySeg[i] += 1;
    existing.add((+d.time).toFixed(3));
  }
  return out;
}

function snapSfxList(list, times, win) {
  return (list || []).map(h => {
    if (Array.isArray(h)) {
      const s = snap(+h[0], times, win);
      return h[1] == null ? s.t : [s.t, h[1]];
    }
    if (h && typeof h === 'object' && h.t != null) return { ...h, t: snap(+h.t, times, win).t };
    return snap(+h, times, win).t;
  });
}

// Snap visual and sound accents. Never edits segs[].in / out / pad (lip sync stays put).
function applySync(cut, captions, grid, opts = {}) {
  const win = opts.window ?? windowOf(cut);
  const times = anchors(grid);
  const next = { ...cut, segs: (cut.segs || []).map(s => ({ ...s })) };
  const TL = R.timeline(next);

  next.segs.forEach((s, i) => {
    if (i === 0 && !s.bigPunch && !(next.punch && i % 2 === 1) && s.zoom == null) return;
    const punched = s.bigPunch || s.zoom > 1 || (next.punch && i % 2 === 1);
    if (!punched) return;
    const s0 = snap(TL.segs[i].start, times, win);
    // Only delay the punch into the segment (never start it in the previous shot).
    const delay = Math.max(0, s0.t - TL.segs[i].start);
    if (delay > 0 && delay <= win) s.punchDelay = +delay.toFixed(3);
    else delete s.punchDelay;
  });

  if (next.sfx) {
    const sfx = { ...next.sfx };
    for (const k of Object.keys(sfx)) sfx[k] = snapSfxList(sfx[k], times, win);
    next.sfx = sfx;
  }
  if (Array.isArray(next.sfxHits)) {
    next.sfxHits = next.sfxHits.map(h => ({ ...h, t: snap(+h.t, times, win).t }));
  }
  if (Array.isArray(next.hits)) {
    next.hits = next.hits.map(([t, a]) => [snap(+t, times, win).t, a]);
  }

  const shakes = planDropShakes(next, grid, opts);
  next.dropHits = shakes.map(s => [s.t, s.strength]);

  let caps = captions;
  if (captions && Array.isArray(captions.flips)) {
    const flips = captions.flips.map(f => ({ ...f }));
    const titles = flips.filter(f => f.mode === R.TITLE_MODE).sort((a, b) => a.start - b.start);
    let last = -Infinity;
    for (const t of titles) {
      const dur = (t.end === 99 ? 99 : t.end) - t.start;
      const s = snap(t.start, times, win);
      let start = s.t;
      if (start <= last + 0.05) start = t.start; // keep order if a snap would collide
      const delta = start - t.start;
      t.start = +start.toFixed(2);
      if (t.end !== 99) t.end = +Math.max(t.start + 0.2, t.end + delta).toFixed(2);
      last = t.start;
    }
    caps = { ...captions, flips };
  }
  next.beatSync = true;
  return { cut: next, captions: caps, snaps: times.length };
}

function analyseBed(cut, buildDir, opts = {}) {
  if (!wantBeatSync(cut) || !cut.bed) return null;
  const bed = R.bedFile(cut.bed);
  const file = path.isAbsolute(String(bed)) ? bed : path.resolve(buildDir, String(bed));
  if (!fs.existsSync(file)) throw new Error(`beat-sync: bed not found (${file})`);
  const len = R.timeline(cut).total;
  const start = +(cut.bedStart || 0);
  const out = path.join(buildDir, 'beat-grid.json');
  const py = opts.python || process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  const args = [path.join(__dirname, 'beats.py'), file, '--start', String(start), '--duration', String(len), '--out', out];
  try {
    execFileSync(py, args, { stdio: opts.stdio || 'inherit' });
  } catch (e) {
    const msg = String((e.stderr || e.stdout || e.message || e));
    const missing = /librosa is not installed|No module named '?librosa'?/i.test(msg);
    if (opts.required) throw new Error(missing ? 'beat-sync needs librosa: pip install -r requirements.txt' : `beat analysis failed: ${msg}`);
    console.warn(missing ? 'note: librosa not installed (pip install -r requirements.txt); beat-sync skipped' : `note: beat analysis failed; beat-sync skipped\n${msg}`);
    return null;
  }
  if (!fs.existsSync(out)) return null;
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

function loadGrid(dir) {
  const f = path.join(dir, 'beat-grid.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

function writeCaptions(file, caps) {
  fs.writeFileSync(file, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
}

module.exports = {
  WINDOW, DROP_INTENSITY_MIN, MAX_SHAKES_PER_SEG, FINISH, CANON,
  finishName, parseFinish, finishChain,
  wantBeatSync, windowOf, anchors, snap, strongDrops, planDropShakes,
  snapSfxList, applySync, analyseBed, loadGrid, writeCaptions,
};
