// The reference's shot plan, on your take (Recreate). A reference cuts every 1 to 3 s and changes the framing on each
// cut; your one take is one long shot. recut() re-cuts what you kept to the reference's rhythm:
//   - the reference's shot lengths are scaled to your edit's length (a 40 s reference on a 20 s take halves each shot)
//   - each new cut goes on a word boundary: a seam you already have (a clip or a pause cut) when one is near, else the
//     quiet between two words, read from the audio by kit/cutpoints.cjs. A cut never lands inside a word: the quiet must
//     hold the 30 ms fade in and 50 ms fade out every segment gets (at least 0.14 s, cut in its middle). No quiet near
//     the reference's cut: that cut is left out and the two shots play as one
//   - the audio runs on across a new cut (same file, out = in), so only the picture changes
//   - each shot gets the reference's framing as a punch (close-up 1.16, extreme close-up 1.3, medium close-up 1.06,
//     medium or wider 1), and two shots in a row never share one, or the cut would be invisible
// The rest of a shot's settings (finish, big punch, transition, cutaway) come from its line in the recipe.
// Also here: the reference's sound effects mapped to the kit's sounds, a title's role, and the music level.
'use strict';

const MIN_SHOT = 0.8, MIN_QUIET = 0.14, EDGE_BONUS = 0.15;
const FRAMING = [[/extreme close/, 1.3], [/medium close/, 1.06], [/close/, 1.16], [/medium|wide|long|full/, 1]];
const r3 = x => +(+x).toFixed(3);

function zoomFor(framing) {
  const f = String(framing || '').toLowerCase();
  for (const [re, z] of FRAMING) if (re.test(f)) return z;
  return null;
}

// framing for each shot: the reference's, and never the same twice in a row
function zooms(shots) {
  const out = []; let prev = null;
  shots.forEach((s, i) => {
    let z = zoomFor(s.framing);
    if (z == null) z = i % 2 ? 1.12 : 1;
    if (prev != null && Math.abs(z - prev) < 0.04) z = prev > 1.05 ? 1 : r3(prev + 0.12);
    out.push(z); prev = z;
  });
  return out;
}

// quiet(i, a, b): the middle of the longest quiet run between clip seconds a and b in segment i, or null.
// From an envelope (kit/cutpoints.cjs envelopeSync of the segment's file).
function quietFrom(CP, env) {
  if (!env) return null;
  const A = CP.activity(env);
  return (a, b) => {
    const i0 = A.i(a), i1 = A.i(b); let best = null;
    for (let i = i0; i <= i1;) {
      if (A.act[i]) { i++; continue; }
      let j = i; while (j + 1 <= i1 && !A.act[j + 1]) j++;
      if (!best || j - i > best[1] - best[0]) best = [i, j];
      i = j + 1;
    }
    if (!best) return null;
    const qa = A.t(best[0]) - env.win / 2, qb = A.t(best[1]) + env.win / 2;
    return qb - qa >= MIN_QUIET ? r3((qa + qb) / 2) : null;
  };
}

// segs: [{ file, in, out, ... }] in reel order; words(i): segment i's clip words [[start, end, text]] (clip seconds);
// shots: [{ dur, framing }] from the recipe; quiet(i, a, b) as above (null: the middle of the word gap, when the gap
// is at least MIN_QUIET). Returns { segs, shotStart (a segment index per shot), shotOf (recipe shot per shot),
// zoom (per shot), cuts, skipped, plan }.
function recut(segs, words, shots, quiet) {
  const T = segs.reduce((a, s) => a + s.out - s.in, 0), R = shots.reduce((a, s) => a + Math.max(0, +s.dur || 0), 0);
  if (shots.length < 2 || !(R > 0) || !(T > 0)) return { segs, shotStart: [0], shotOf: [0], zoom: zooms(shots.slice(0, 1)), cuts: [], skipped: [], plan: [] };
  const off = []; { let t = 0; segs.forEach(s => { off.push(t); t += s.out - s.in; }); }
  const cands = [];
  segs.forEach((s, i) => { if (i) cands.push({ t: off[i], seg: i, edge: true }); });
  segs.forEach((s, i) => {
    const W = (words(i) || []).filter(w => w[1] > w[0] && w[0] >= s.in - 0.01 && w[1] <= s.out + 0.01).sort((a, b) => a[0] - b[0]);
    for (let k = 0; k + 1 < W.length; k++) {
      const a = W[k][1], b = W[k + 1][0];
      if (b - a < MIN_QUIET - 0.06) continue;
      let p = quiet ? quiet(i, a, b) : null;
      if (p == null && quiet === null && b - a >= MIN_QUIET) p = r3((a + b) / 2);
      if (p == null || p < a || p > b || p - s.in < 0.3 || s.out - p < 0.3) continue;
      cands.push({ t: off[i] + p - s.in, seg: i, at: p });
    }
  });
  const scale = T / R, targets = []; { let c = 0; for (let k = 0; k + 1 < shots.length; k++) { c += Math.max(0, +shots[k].dur || 0); targets.push(c * scale); } }
  const chosen = [], skipped = []; let last = 0;
  targets.forEach((B, k) => {
    const tol = Math.max(0.6, 0.5 * Math.min(shots[k].dur, shots[k + 1].dur) * scale);
    let best = null, bc = Infinity;
    for (const c of cands) {
      if (c.t < last + MIN_SHOT || c.t > T - MIN_SHOT || chosen.includes(c)) continue;
      const d = Math.abs(c.t - B); if (d > tol) continue;
      const cost = d - (c.edge ? EDGE_BONUS : 0);
      if (cost < bc) { bc = cost; best = c; }
    }
    if (best) { chosen.push(best); best.k = k; last = best.t; } else skipped.push({ shot: k + 2, at: r3(B) });
  });
  // split the segments at the chosen quiet points
  const splits = new Map();
  for (const c of chosen) if (!c.edge) splits.set(c.seg, [...(splits.get(c.seg) || []), c.at].sort((a, b) => a - b));
  const out = [], startOf = new Map();
  segs.forEach((s, i) => {
    const pts = splits.get(i) || [];
    let a = s.in;
    if (!pts.length) { startOf.set(`e${i}`, out.length); out.push(s); return; }
    startOf.set(`e${i}`, out.length);
    [...pts, s.out].forEach((p, j) => {
      const piece = { ...s, in: r3(a), out: r3(p) };
      if (j) { delete piece.fadeIn; delete piece.jump; delete piece.bigPunch; delete piece.transition; piece.recut = true; startOf.set(`s${i}@${pts[j - 1]}`, out.length); }
      out.push(piece); a = p;
    });
  });
  const shotStart = [0, ...chosen.map(c => c.edge ? startOf.get(`e${c.seg}`) : startOf.get(`s${c.seg}@${c.at}`))];
  const shotOf = [0, ...chosen.map(c => c.k + 1)];
  const z = zooms(shotOf.map(k => shots[k]));
  shotStart.forEach((k, j) => { for (let i = k; i < (shotStart[j + 1] ?? out.length); i++) out[i].zoom = z[j]; });
  const plan = []; { let t = 0; const st = out.map(s => { const x = t; t += s.out - s.in; return x; }); shotStart.forEach((k, j) => plan.push({ start: r3(st[k]), end: r3(shotStart[j + 1] != null ? st[shotStart[j + 1]] : t), ref: shotOf[j] + 1, zoom: z[j], ...(shots[shotOf[j]].framing ? { framing: shots[shotOf[j]].framing } : {}), ...(shots[shotOf[j]].cutaway ? { cutaway: true } : {}) })); }
  return { segs: out, shotStart, shotOf, zoom: z, cuts: chosen.map(c => ({ t: r3(c.t), on: c.edge ? 'seam' : 'pause' })), skipped, plan };
}

// the reference's sound effects as the kit's sounds (kit/sfx/sfx.json ids)
const SFX = { pop: '11-pop-sticker', ding: '14-ui-notification', click: '33-ui-mouse-click', whoosh: '05-whoosh-fast', swoosh: '05-whoosh-fast', swipe: '08-swipe-up', boom: '01-cinematic-hit-a', hit: '01-cinematic-hit-a', impact: '01-cinematic-hit-a', riser: '03-riser-tension', typing: '35-ui-keyboard-typing', shutter: '17-camera-shutter', camera: '17-camera-shutter', cash: '20-cha-ching', 'cha-ching': '20-cha-ching', shimmer: '23-shimmer-sparkle-a', sparkle: '23-shimmer-sparkle-a', glitch: '15-glitch-digital-a', tick: '13-ui-tick', sub: '22-sub-drop', drop: '22-sub-drop' };
const sfxId = type => SFX[String(type || '').toLowerCase()] || '10-pop-bubble';

// a title's role: hook (the claim up front), number, timer, brand or line
function roleOf(text, start, i, brands = []) {
  const s = String(text || '').trim();
  if (/\b\d{1,2}:\d{2}\b|\b\d+\s*(s|sec|secs|seconds?|min|mins|minutes?|hours?|days?)\b/i.test(s)) return 'timer';
  if (/\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|first|second|third)\b/i.test(s) && s.split(/\s+/).length <= 4) return 'number';
  const b = brands.map(x => String(x).toLowerCase()).filter(Boolean);
  if (b.some(x => s.toLowerCase().includes(x)) || /^[A-Z]?[a-z]+[A-Z]\w*$/.test(s)) return 'brand';
  if (i === 0 || +start < 3) return 'hook';
  return 'line';
}

// match your titles to the recipe's by role; what is left over goes in order
function matchRoles(mine, ref) {
  const used = new Set(), out = new Map();
  mine.forEach((f, i) => { const r = roleOf(f.text, f.start, i); const k = ref.findIndex((x, j) => !used.has(j) && (x.role || roleOf(x.text, x.start, j)) === r); if (k >= 0) { used.add(k); out.set(f, ref[k]); } });
  mine.forEach(f => { if (out.has(f)) return; const k = ref.findIndex((x, j) => !used.has(j)); if (k >= 0) { used.add(k); out.set(f, ref[k]); } });
  return out;
}

// the reference's music level: under -37 dB (or under the voice by 25 dB) is no music bed; else a bed volume for the
// kit's beds (0.16 is the kit's usual level, for music about 8 dB under the voice)
function musicLevel(levels) {
  const m = levels && +levels.music, v = levels && +levels.vocals;
  if (!Number.isFinite(m)) return null;
  if (m <= -37 || (Number.isFinite(v) && v > -50 && m < v - 25)) return { bed: false, db: m };
  const rel = Number.isFinite(v) && v > -50 ? m - v : -8;
  return { bed: true, db: m, vol: r3(Math.min(0.3, Math.max(0.05, 0.16 * Math.pow(10, (rel + 8) / 20)))) };
}

// a reference shot that is a cutaway (B-roll, a screen, a graphic): talk_share under 0.35 when the breakdown has it,
// else no face on screen, else material that is not real camera footage with no face count
function isCutaway(s) {
  const ts = s.talk_share ?? (s.aspects && s.aspects.talk && s.aspects.talk.share);
  if (ts != null && Number.isFinite(+ts)) return +ts < 0.35;
  const f = Array.isArray(s.faces) ? s.faces.length : s.faces;
  if (f != null && Number.isFinite(+f)) return +f === 0;
  const o = s.material && s.material.origin;
  return !!o && o !== 'real' && o !== 'unknown' && s.material.has_real_material === false && f == null;
}

module.exports = { recut, zooms, zoomFor, quietFrom, sfxId, SFX, roleOf, matchRoles, musicLevel, isCutaway, MIN_SHOT, MIN_QUIET };
