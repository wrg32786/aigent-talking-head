// Teardown converter (kit/videomd2reel.cjs): a shot's grade as a film finish.
'use strict';

// One shot's grade -> a finish (or none). Calibrated on the shipped finishes applied to showcase/source/presenter.jpg,
// then made stricter so a dark room or warm light on real footage does not read as a finish. Subtle finishes (grain,
// chroma, a light warm or cool) are often missed; strong ones (mono, scan-lines, heavy vignette, teal) are caught.
// Never from a black frame (a fade to black reads as zero saturation, so "mono") or a shot under 2 s (a flash frame or a
// transition, not a grade): session report 2, F, where 1.6 s of black at the end made every shot black and white.
const MIN_GRADE_SHOT = 2;
const isBlack = m => (m.mean_l != null && m.mean_l < 8) || (m.dark_share != null && m.dark_share > 0.9) || (m.bright_share != null && m.mean_l != null && m.mean_l < 12 && m.bright_share < 0.01);
function finishOf(m, secs) {
  if (!m || m.sat == null) return { finish: null, why: 'no grade data' };
  if (isBlack(m)) return { finish: null, why: 'a black frame: no grade to read', unread: true };
  if (secs != null && secs < MIN_GRADE_SHOT) return { finish: null, why: `shot under ${MIN_GRADE_SHOT} s: too short to read a grade`, unread: true };
  const f = [], why = [];
  if (m.sat < 0.03) { f.push('mono'); why.push(`saturation ${m.sat}`); }
  else {
    const spread = (m.highlight_b ?? 0) - (m.shadow_b ?? 0);
    if ((m.shadow_b ?? 0) < -2 && spread > 15) { f.push('teal'); why.push(`teal shadows, warm highlights (b ${m.shadow_b} / ${m.highlight_b})`); }
    else if (m.contrast > 0.3 && m.sat < 0.2) { f.push('bleach'); why.push(`contrast ${m.contrast}, saturation ${m.sat}`); }
    else if ((m.dark_share ?? 0) > 0.38 && m.contrast > 0.3) { f.push('crushed'); why.push(`dark share ${m.dark_share}`); }
    else if ((m.shadow_b ?? 0) < -2.5) { f.push('cool'); why.push(`cool shadows (b ${m.shadow_b})`); }
    else if ((m.shadow_b ?? 0) > 6 || (m.mean_b ?? 0) > 14) { f.push('warm'); why.push(`warm cast (b ${m.mean_b})`); }
  }
  if ((m.scan ?? m.x_scan ?? 0) > 1.5) { f.push('scan-lines'); why.push(`line pattern ${m.scan ?? m.x_scan}`); }
  else if ((m.noise ?? 0) > 2.5) { f.push('grain'); why.push(`noise ${m.noise}`); }
  if (m.vignette != null && m.vignette < 0.12) { f.push('vignette'); why.push(`corners at ${Math.round(m.vignette * 100)}% of the ring inside them`); }
  return { finish: f.length ? f.join(',') : null, why: why.join('; ') || 'natural' };
}

// A finish is only assigned when the grade is a choice, not the room. Per finish: the measure it rests on, how far the
// shots that have it must sit from the shots that do not (the grade changes across shots), and what counts as strong
// enough to keep even when every shot has it. Warm lamp light on every shot is the room, so it is dropped.
const GRADE = {
  warm: { v: m => m.shadow_b ?? 0, gap: 3, strong: m => (m.shadow_b ?? 0) > 10 || (m.mean_b ?? 0) > 20 },
  cool: { v: m => -(m.shadow_b ?? 0), gap: 3, strong: m => (m.shadow_b ?? 0) < -6 },
  teal: { v: m => (m.highlight_b ?? 0) - (m.shadow_b ?? 0), gap: 8, strong: m => (m.highlight_b ?? 0) - (m.shadow_b ?? 0) > 28 },
  bleach: { v: m => -(m.sat ?? 0), gap: 0.1, strong: m => m.contrast > 0.4 && m.sat < 0.12 },
  crushed: { v: m => m.dark_share ?? 0, gap: 0.12, strong: m => (m.dark_share ?? 0) > 0.5 },
  mono: { v: m => -(m.sat ?? 0), gap: 0.1, strong: () => true },
  'scan-lines': { v: m => m.scan ?? m.x_scan ?? 0, gap: 0.8, strong: m => (m.scan ?? m.x_scan ?? 0) > 3 },
  grain: { v: m => m.noise ?? 0, gap: 1.2, strong: m => (m.noise ?? 0) > 5 },
  vignette: { v: m => -(m.vignette ?? 1), gap: 0.15, strong: m => m.vignette != null && m.vignette < 0.06 },
};
function gradeChoice(shots) {
  const notes = [];
  const all = new Set(shots.flatMap(s => (s.finish || '').split(',').filter(Boolean)));
  for (const f of all) {
    const G = GRADE[f]; if (!G) continue;
    const has = shots.filter(s => (s.finish || '').split(',').includes(f)), not = shots.filter(s => !has.includes(s));
    const avg = a => a.reduce((x, s) => x + G.v(s.m), 0) / a.length;
    const differs = not.length > 0 && avg(has) - avg(not) >= G.gap;
    for (const s of has) {
      if (differs || G.strong(s.m)) continue;
      s.finish = s.finish.split(',').filter(x => x !== f).join(',') || null;
      s.finishWhy = `${s.finishWhy}; ${f} dropped (same on every shot and mild: the light of the room, not a grade)`;
    }
    if (!differs && has.some(s => !G.strong(s.m))) notes.push(`${f} on ${has.length} of ${shots.length} shots, mild and even across them: read as the room's light, not a finish`);
  }
  return notes;
}

module.exports = { finishOf, gradeChoice, isBlack, GRADE, MIN_GRADE_SHOT };
