// Measured picture checks for npm run verify (1.29.0): a frozen picture, black frames, flicker, clipping, a soft
// picture and the number of hard cuts, read from the finished reel with ffmpeg filters only (no model, three passes at
// 540 px wide or less, about 12 s for a 25 s reel; at 270 px a speaker sitting still reads as frozen). What we do on
// purpose is exempt, from cut.json and captions.js: the fade in, dips to black, cards and inserts (which may hold still
// or be dark), the tail hold, a padded segment, and the frames round every seam and hit.
// Freeze and black outside those are FAIL lines; the rest are notes until the numbers are tuned on our own reels.
// When these numbers and a read of the stills disagree about motion, a freeze or black, the numbers win.
// idea and starting thresholds from mojomast/open-higgsfield-skills skills/shot-qc (MIT); cut-count rule from HyperKut-Studio export_qc (MIT)
'use strict';
const { spawnSync } = require('child_process');
const R = require('./rules.cjs');

// clipping is read from YLOW and YHIGH (the 10th and 90th percentile), not YMIN and YMAX as the pack does: our captions
// are white with a black outline, so every frame has a pure black and a pure white pixel
const T = { freezeN: 0.003, freezeD: 0.5, blackD: 0.1, blackPix: 0.10, flicker: 12, clipShare: 0.05, clipHi: 250, clipLo: 5, soft: 8, scene: 0.35 };

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

// Read the file. { dur, freezes, blacks, yavg: [[t, v]], ylow, yhigh, blur (median or null), cuts: [t] }
function measure(file, dur) {
  const a = ff(file, `scale=540:-2,freezedetect=n=${T.freezeN}:d=${T.freezeD},blackdetect=d=${T.blackD}:pix_th=${T.blackPix},signalstats,metadata=print:file=-`);
  if (!a.ok) return { error: a.err.split('\n')[0] || 'ffmpeg did not run' };
  const fr = frames(a.out), st = fr.filter(f => f['signalstats.YAVG'] != null);
  const c = ff(file, `scale=270:-2,select='gt(scene,${T.scene})',metadata=print:file=-`);
  const b = ff(file, 'fps=2,scale=540:-2,blurdetect,metadata=print:file=-'); // no blurdetect in an older ffmpeg: skipped
  const bl = b.ok ? frames(b.out).map(f => f['blur']).filter(Number.isFinite).sort((x, y) => x - y) : [];
  return { dur, freezes: spans(fr, 'freezedetect.freeze_start', 'freezedetect.freeze_end', dur), blacks: spans(fr, 'black_start', 'black_end', dur),
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
  if (M.error) return { fails, oks, notes: ['picture checks did not run: ' + M.error] };
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

module.exports = { T, frames, spans, measure, exempt, uncovered, judge };
