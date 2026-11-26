// Measured picture checks for npm run verify. Four ffmpeg reads cover freeze, black, flicker, clipping, blur, cuts
// and flashes. The flash count covers every frame, including effects. More than three luminance or red flashes
// in any second fails (WCAG 2.3.1). At 270 px a speaker sitting still reads as frozen. What we do on
// purpose is exempt, from cut.json and captions.js: the fade in, dips to black, cards and inserts (which may hold still
// or be dark), the tail hold, a padded segment, and the frames round every seam and hit.
// Freeze and black outside those windows also fail.
// When these numbers and a read of the stills disagree about motion, a freeze or black, the numbers win.
// idea and starting thresholds from mojomast/open-higgsfield-skills skills/shot-qc (MIT); cut-count rule from HyperKut-Studio export_qc (MIT)
'use strict';
const { spawnSync } = require('child_process');
const R = require('./rules.cjs');

// clipping is read from YLOW and YHIGH (the 10th and 90th percentile), not YMIN and YMAX as the pack does: our captions
// are white with a black outline, so every frame has a pure black and a pure white pixel
const T = { freezeN: 0.003, freezeD: 0.5, blackD: 0.1, blackPix: 0.10, flicker: 12, clipShare: 0.05, clipHi: 250, clipLo: 5, soft: 8, scene: 0.35,
  lumSwing: 0.1, darker: 0.80, redSwing: 20, saturated: 0.8, flashArea: 0.25, flashNote: 5, flashFail: 7 };

const ff = (file, vf) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'error', '-i', file, '-an', '-vf', vf, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 512 << 20 }); return { out: String(r.stdout || ''), err: String(r.stderr || ''), ok: r.status === 0 }; };
// metadata=print text -> [{ t, key: value, ... }], one per frame that carries a key
function frames(text) {
  const out = []; let cur = null;
  for (const l of String(text).split('\n')) {
    const m = /pts_time:([-0-9.]+)/.exec(l); if (m) { cur = { t: +m[1] }; out.push(cur); continue; }
    const k = /^lavfi\.([\w.]+)=(.*)$/.exec(l.trim()); if (k && cur) cur[k[1]] = +k[2];
  }
  return out;
}
// start and end marks -> [[from, to]]; a stretch still open at the end runs to dur
function spans(fr, a, z, dur) {
  const out = []; let from = null;
  for (const f of fr) { if (f[a] != null) from = f[a]; if (f[z] != null && from != null) { out.push([from, f[z]]); from = null; } }
  if (from != null) out.push([from, dur]);
  return out;
}

const linear = Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
function flashCells(rgb) {
  const y = new Float64Array(144), r = new Float64Array(144), s = new Float64Array(144);
  for (let cell = 0; cell < 144; cell++) {
    const start = (Math.floor(cell / 9) * 900 + cell % 9 * 10) * 3;
    let lum = 0, red = 0, sat = 0;
    for (let row = 0; row < 10; row++) {
      let p = start + row * 270;
      for (let col = 0; col < 10; col++, p += 3) {
        const rv = rgb[p], gv = rgb[p + 1], bv = rgb[p + 2];
        lum += 0.2126 * linear[rv] + 0.7152 * linear[gv] + 0.0722 * linear[bv];
        red += Math.max(0, rv - gv - bv);
        sat += rv / (rv + gv + bv || 1);
      }
    }
    y[cell] = lum / 100; r[cell] = red / 100 * (320 / 255); s[cell] = sat / 100;
  }
  return { y, r, s };
}

// Count cells at the threshold crossing. A slow fade has just one swing.
function flashChannel(series, times, channel) {
  const n = series.length, cells = series[0][channel].length;
  const up = new Uint16Array(n + 1), down = new Uint16Array(n + 1);
  const red = channel === 'r', threshold = red ? T.redSwing : T.lumSwing;
  const own = []; // each cell's own transitions: the frame, negative for a swing down
  for (let i = 0; i < cells; i++) {
    if (red && !series.some(f => f.s[i] >= T.saturated)) continue;
    let lo = series[0][channel][i], hi = lo, dir = 0;
    const mine = [];
    for (let t = 1; t < n; t++) {
      const v = series[t][channel][i];
      if (dir !== 1 && v - lo >= threshold) {
        if (red || lo < T.darker) { up[t]++; mine.push(t); }
        dir = 1; hi = v;
      } else if (dir !== -1 && hi - v >= threshold) {
        if (red || v < T.darker) { down[t]++; mine.push(-t); }
        dir = -1; lo = v;
      }
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    if (mine.length) own.push(mine);
  }
  // One transition a frame at most, in the direction more cells took, so a cut that brightens one part and darkens
  // another is one transition. A swing can take two frames: cells that swung on the frame before, and were too few
  // to count, are added once. A frame never borrows from the one after it. That pairing spent the down of a strobe
  // with its up, and fifteen flashes a second read as one transition.
  const hits = [], need = cells * T.flashArea;
  let carryUp = 0, carryDown = 0;
  for (let t = 1; t < n; t++) {
    const u = up[t] + carryUp, d = down[t] + carryDown;
    if (Math.max(u, d) < need) { carryUp = up[t]; carryDown = down[t]; continue; }
    hits.push({ t: times[t], dir: u >= d ? 1 : -1 });
    carryUp = carryDown = 0;
  }
  // Slide a half-open second over the hits. Keep one count per run of the same direction.
  let count = 0, best = 0, time = 0, left = 0;
  for (let i = 0; i < hits.length; i++) {
    if (i === left || hits[i].dir !== hits[i - 1].dir) count++;
    while (hits[i].t >= hits[left].t + 1000000) {
      if (hits[left].dir !== hits[left + 1].dir) count--;
      left++;
    }
    if (count > best) { best = count; time = hits[left].t / 1000000; }
  }
  // The same count for each cell alone, over the second that starts on each frame. A quarter of the cells flashing
  // through one second counts whichever way each cell goes: two halves that flip against each other have no one
  // direction as a picture, and every cell of them flashes.
  const per = own.map(mine => {
    const run = [0]; // goes up by one each time the cell's direction changes
    for (let k = 1; k < mine.length; k++) run.push(run[k - 1] + (mine[k] > 0 !== mine[k - 1] > 0 ? 1 : 0));
    return { at: mine.map(Math.abs), run, a: 0, z: 0 };
  });
  const kth = Math.ceil(need) - 1;
  if (per.length > kth) for (let f = 1; f < n; f++) {
    const inSecond = per.map(c => {
      while (c.a < c.at.length && c.at[c.a] < f) c.a++;
      while (c.z < c.at.length && times[c.at[c.z]] < times[f] + 1000000) c.z++;
      return c.z > c.a ? c.run[c.z - 1] - c.run[c.a] + 1 : 0;
    }).sort((x, y) => y - x);
    if (inSecond[kth] > best) { best = inSecond[kth]; time = times[f] / 1000000; }
  }
  return { count: best, time };
}

// Decoded frame times also handle clips with uneven spacing. Painted frames can supply a frame rate.
function flashCount(series, clock) {
  const times = series.map((_, i) => Math.round(1e6 * (typeof clock === 'number' ? i / clock : clock[i])));
  return { luminance: flashChannel(series, times, 'y'), red: flashChannel(series, times, 'r') };
}
function readFlashes(file, stats) {
  const bytes = 90 * 160 * 3;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', 'scale=90:160:flags=area', '-vsync', '0',
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 512 << 20 }); // 43,200 bytes a frame: about 6 minutes at 30 fps
  if (r.status !== 0 || r.error) return { error: r.error?.message || String(r.stderr).trim().split('\n')[0] || 'ffmpeg stopped' };
  if (!stats.length || r.stdout.length !== stats.length * bytes) return { error: 'RGB frames and frame times did not match' };
  const series = stats.map((_, i) => flashCells(r.stdout.subarray(i * bytes, (i + 1) * bytes)));
  return flashCount(series, stats.map(f => f.t));
}

// Read the finished picture and keep the start time of each channel's worst second.
function measure(file, dur) {
  const a = ff(file, `scale=540:-2,freezedetect=n=${T.freezeN}:d=${T.freezeD},blackdetect=d=${T.blackD}:pix_th=${T.blackPix},signalstats,metadata=print:file=-`);
  if (!a.ok) return { error: a.err.split('\n')[0] || 'ffmpeg did not run' };
  const fr = frames(a.out), st = fr.filter(f => f['signalstats.YAVG'] != null);
  const c = ff(file, `scale=270:-2,select='gt(scene,${T.scene})',metadata=print:file=-`);
  const b = ff(file, 'fps=2,scale=540:-2,blurdetect,metadata=print:file=-'); // no blurdetect in an older ffmpeg: skipped
  const bl = b.ok ? frames(b.out).map(f => f['blur']).filter(Number.isFinite).sort((x, y) => x - y) : [];
  return { dur, flash: readFlashes(file, st), freezes: spans(fr, 'freezedetect.freeze_start', 'freezedetect.freeze_end', dur), blacks: spans(fr, 'black_start', 'black_end', dur),
    stats: st.map(f => ({ t: f.t, yavg: f['signalstats.YAVG'], ylow: f['signalstats.YLOW'], yhigh: f['signalstats.YHIGH'] })),
    blur: bl.length ? bl[Math.floor(bl.length / 2)] : null, cuts: c.ok ? frames(c.out).map(f => f.t) : null };
}

// What the edit does on purpose. { still: [[a, z]] may hold still, dark: [[a, z]] may be black, noisy: [[a, z]] frames
// left out of the flicker read, cuts: how many hard cuts the plan has }
function exempt(C, CAP) {
  const TL = R.timeline(C || {}), still = [], dark = [[0, 0.3]], noisy = [], flips = (CAP && CAP.flips) || [];
  const tail = (C && C.tail) ?? 0.3; still.push([TL.total - tail - 0.1, Infinity]);
  const exits = CAP ? R.titleExitSeams(CAP, C) : {};
  for (const g of TL.segs) {
    if (g.s.pad) still.push([g.start - 0.05, g.end + 0.05]);
    if (g.s.fadeIn) dark.push([g.start, g.start + g.s.fadeIn + 0.1]);
    if (!g.i) continue;
    noisy.push([g.start - 0.25, g.start + 0.25]);
    const m = exits[g.i] ? exits[g.i].m : g.s.transition ? R.xfadeMode(g.s.transition) : null, d = exits[g.i] ? exits[g.i].d : +(g.s.transitionDur || 0.3);
    if (m) { noisy.push([g.start - d - 0.25, g.start + d + 0.25]); still.push([g.start - d - 0.1, g.start + d + 0.1]); } // a blend holds one side's last frame
    if (typeof m === 'string' && /^fade(black|white|grays)$/.test(m)) dark.push([g.start - d - 0.1, g.start + d + 0.1]);
  }
  for (const h of [...((C && C.hits) || []), ...((C && C.dropHits) || [])]) noisy.push([h - 0.25, h + 0.25]);
  // cards, screen cards and other graphics may hold still, and a card may be dark; a title or a caption never excuses a frozen picture
  for (const f of flips) if (f.mode !== 0 && f.mode !== 7) { const z = f.end > 90 ? Infinity : f.end + 0.1; still.push([f.start - 0.1, z]); if ([4, 5, 8].includes(f.mode)) dark.push([f.start - 0.1, z]); }
  for (const f of R.resolveTitles(CAP || {})) if (f.exit === 'dip-black' && f.end < 90) dark.push([f.end - 0.3, f.end + 0.3]);
  for (const x of (C && C.inserts) || []) { const a = +x.at || 0, z = a + (+x.dur || 0); still.push([a - 0.1, z + 0.1]); dark.push([a - 0.1, z + 0.1]); noisy.push([a - 0.25, a + 0.25], [z - 0.25, z + 0.25]); }
  return { still, dark, noisy, cuts: TL.seams.length + 2 * ((C && C.inserts) || []).length };
}
// how much of [a, z] no window covers, in seconds
function uncovered(a, z, wins) {
  let left = [[a, z]];
  for (const [p, q] of wins) left = left.flatMap(([x, y]) => (q <= x || p >= y ? [[x, y]] : [[x, Math.min(y, p)], [Math.max(x, q), y]].filter(s => s[1] > s[0])));
  return left.reduce((n, s) => n + s[1] - s[0], 0);
}
const inAny = (t, wins) => wins.some(([a, z]) => t >= a && t <= z);

// M from measure(), X from exempt() -> { fails: [text], oks: [text], notes: [text] }
// fxPass: the file is a reel-fx- reel. Its effects may hold the picture on purpose (pause-point, in fx.json, which
// exempt() does not read), so a freeze there is a note, never a FAIL.
function judge(M, X, { fxPass = false } = {}) {
  const fails = [], oks = [], notes = [], s2 = x => x.toFixed(2);
  if (M.error) return { fails, oks, notes: ['picture and flash checks did not run: ' + M.error] };
  if (!M.flash || M.flash.error) notes.push('Flash count unavailable. ' + (M.flash?.error || 'No frame read.'));
  else for (const [name, { count, time }] of Object.entries(M.flash)) {
    const line = `${name} flash count: ${count} alternating transitions in the second from ${s2(time)} s`;
    if (count >= T.flashFail) fails.push(line + '. Over the WCAG 2.3.1 limit of three flashes.');
    else if (count >= T.flashNote) notes.push(line + '. At the WCAG 2.3.1 limit of three flashes.');
    else oks.push(line);
  }
  const fz = M.freezes.filter(([a, z]) => uncovered(a, z, X.still) >= T.freezeD), bk = M.blacks.filter(([a, z]) => uncovered(a, z, X.dark) >= T.blackD);
  (!fz.length ? oks : fxPass ? notes : fails).push(fz.length ? `picture frozen for half a second or more: ${fz.map(([a, z]) => `${s2(a)} to ${s2(z)} s`).join(', ')}${fxPass ? ' (the effects pass may hold it on purpose)' : ''}` : `no frozen picture (${M.freezes.length} hold${M.freezes.length === 1 ? '' : 's'} on purpose)`);
  (bk.length ? fails : oks).push(bk.length ? `black frames outside a dip or a card: ${bk.map(([a, z]) => `${s2(a)} to ${s2(z)} s`).join(', ')}` : `no black frames outside a dip or a card (${M.blacks.length} on purpose)`);
  const st = M.stats, jumps = [];
  for (let i = 1; i < st.length; i++) if (!inAny(st[i].t, X.noisy)) jumps.push(Math.abs(st[i].yavg - st[i - 1].yavg));
  jumps.sort((a, b) => a - b); const p95 = jumps.length ? jumps[Math.floor(jumps.length * 0.95)] : 0;
  if (p95 > T.flicker) notes.push(`picture: brightness jumps frame to frame (95th percentile ${p95.toFixed(1)} of 255, over ${T.flicker}); look for flicker`);
  const cl = st.filter(f => f.yhigh >= T.clipHi || f.ylow <= T.clipLo).length / Math.max(1, st.length);
  if (cl >= T.clipShare) notes.push(`picture: ${Math.round(cl * 100)}% of frames have a tenth of the picture at pure white or pure black; check the grade for clipping`);
  if (M.blur != null && M.blur > T.soft) notes.push(`picture: soft (median blur ${M.blur.toFixed(1)}, over ${T.soft}); check the focus and the zoom`);
  // only more cuts than planned: a cut between two takes of the same framing is not a scene change, so fewer is normal for us
  if (M.cuts) { const n = M.cuts.length, off = n - X.cuts; if (off > Math.max(2, X.cuts / 2)) notes.push(`picture: ${n} hard cuts seen, the plan has ${X.cuts}`); }
  oks.push(`picture measured on ${st.length} frames: brightness jump ${p95.toFixed(1)}, clipped ${Math.round(cl * 100)}%${M.blur != null ? `, blur ${M.blur.toFixed(1)}` : ''}${M.cuts ? `, ${M.cuts.length} hard cuts seen (plan ${X.cuts})` : ''}`);
  return { fails, oks, notes };
}

module.exports = { T, frames, spans, flashCells, flashCount, measure, exempt, uncovered, judge };
