// The fidelity read-out: after a Recreate or Copy the look draft, how close the plan is to what it copies, per part.
// Written to build/match.json. Everything here is worked out from the plan, without rendering, so it is an estimate:
// what we set, measured the cheap way, against what the reference (or the look) asked for.
//   { version: 1, mode: "recreate" | "look", against, overall, parts: { framing, grade, captions, stickers, sfx, pace } }
// Each part has score (0 to 100, or null when it could not be measured), a short note, and its numbers:
//   framing   per shot the face height and eye line we get against the target (shares of the frame), and the mean miss
//   grade     the mean Lab distance between your sampled frames and the target, before and after the LUT. The finish
//             and the kit's base polish go on after the LUT and are not in this number
//   captions  the style fields compared one by one (style, position, colour, outline, shadow, case, layer)
//   stickers  how many, and the shape
//   sfx       how many and how many per 10 s, as placed (the density cap in kit/assemble.cjs can thin them later)
//   pace      the mean shot length
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = 'match.json', VERSION = 1;
const r1 = x => +(+x).toFixed(1), r3 = x => +(+x).toFixed(3);
const ratio = (a, b) => (a === b ? 1 : !a || !b ? 0 : Math.min(a, b) / Math.max(a, b));

function framingPart(shots) {
  const rows = (shots || []).map((s, i) => (s && s.face && s.faceTarget ? { shot: i + 1, faceH: { ours: s.face.faceH, target: s.faceTarget.faceH, diff: r3(s.face.faceH - s.faceTarget.faceH) }, eyeY: { ours: s.face.eyeY, target: s.faceTarget.eyeY, diff: r3(s.face.eyeY - s.faceTarget.eyeY) }, ...(s.clamped ? { clamped: true } : {}) } : null)).filter(Boolean);
  if (!rows.length) return { score: null, note: 'not measured (no face found on one side)', shots: [] };
  const each = rows.map(r => (1 - Math.min(1, Math.abs(r.faceH.diff) / r.faceH.target)) * (1 - Math.min(1, Math.abs(r.eyeY.diff) / 0.25)));
  const mean = k => r3(rows.reduce((a, r) => a + Math.abs(r[k].diff), 0) / rows.length), held = rows.filter(r => r.clamped).length;
  return { score: Math.round(each.reduce((a, x) => a + x, 0) / each.length * 100), note: `${rows.length} shots; face height off by ${r1(mean('faceH') * 100)}% of the frame, eye line by ${r1(mean('eyeY') * 100)}%${held ? `; ${held} held at the zoom limit` : ''}`,
    faceHDiff: mean('faceH'), eyeYDiff: mean('eyeY'), shots: rows };
}

function gradePart(grade) {
  const rows = ((grade && grade.shots) || []).map((s, i) => (s ? { shot: i + 1, before: s.before, after: s.after, strength: s.strength } : null)).filter(Boolean);
  if (!grade || !grade.ok || !rows.length) return { score: null, note: 'not matched (off, or no colour to read)', shots: [] };
  const avg = k => r1(rows.reduce((a, r) => a + r[k], 0) / rows.length);
  return { score: Math.round((1 - Math.min(1, avg('after') / 25)) * 100), note: `mean Lab distance ${avg('before')} before, ${avg('after')} after the LUT (${grade.single ? 'one LUT' : grade.luts && grade.luts < rows.length ? grade.luts + ' LUTs' : 'per shot'}, skin kept at ${Math.round(grade.skin * 100)}%)`, before: avg('before'), after: avg('after'), single: !!grade.single, shots: rows };
}

const CAPTION_FIELDS = [['style', 'captionStyle', 'captions'], ['position', 'captionPosition', 'caption-position'], ['color', 'captionColor', 'caption-color'], ['outline', 'captionOutline', 'caption-outline'], ['shadow', 'captionShadow', 'caption-shadow'], ['case', 'captionCase', 'caption-case'], ['layer', 'captionLayer', 'caption-layer']];
// target: the Reel.md Style keys (a recipe's style, or a look's)
function captionsPart(caps, style) {
  const fields = {}; let n = 0, eq = 0;
  for (const [name, mine, theirs] of CAPTION_FIELDS) {
    const t = style && style[theirs] != null && String(style[theirs]).trim() !== '' ? String(style[theirs]).toLowerCase() : null; if (t == null) continue; // "none" is a value here (no outline)
    const o = caps && caps[mine] != null ? String(caps[mine]).toLowerCase() : null, same = o === t || (name === 'style' && String(o).replace('-', '') === t.replace('-', ''));
    fields[name] = { ours: o, target: t, equal: same }; n++; if (same) eq++;
  }
  return n ? { score: Math.round(eq / n * 100), note: `${eq} of ${n} style fields the same`, fields } : { score: null, note: 'no caption style to compare', fields };
}

function stickersPart(flips, target) {
  const mine = (flips || []).filter(f => f.mode === 9), shape = mine.length ? (mine.filter(f => f.shape === 'starburst').length * 2 >= mine.length ? 'starburst' : 'seal') : null;
  if (!target || (!target.count && !mine.length)) return { score: target ? 100 : null, note: target ? 'none on either side' : 'nothing to compare', count: { ours: mine.length, target: target ? target.count : null } };
  const sameShape = !mine.length || !target.shape || shape === target.shape;
  return { score: Math.round(ratio(mine.length, target.count) * (sameShape ? 1 : 0.5) * 100), note: `${mine.length} of ${target.count} wanted${target.spoken ? ' (a sticker shows only on a word you say)' : ''}; shape ${shape || 'none'}${target.shape ? ` against ${target.shape}` : ''}`,
    count: { ours: mine.length, target: target.count }, shape: { ours: shape, target: target.shape || null, equal: sameShape } };
}

function sfxPart(cut, len, target) {
  const mine = ((cut && cut.sfxHits) || []).length + Object.values((cut && cut.sfx) || {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0), per10 = len ? r1(mine / len * 10) : 0;
  if (!target) return { score: null, note: 'nothing to compare', count: { ours: mine, target: null } };
  if (!target.count && !mine) return { score: 100, note: 'none on either side', count: { ours: 0, target: 0 }, per10: { ours: 0, target: 0 } };
  return { score: Math.round(ratio(per10, target.per10) * 100), note: `${mine} placed (${per10} per 10 s) against ${target.per10} per 10 s; the density cap can still thin them`, count: { ours: mine, target: target.count }, per10: { ours: per10, target: target.per10 } };
}

function pacePart(shots, len, target) {
  const n = Math.max(1, (shots || []).length), mean = len ? +(len / n).toFixed(2) : null;
  if (!target || !target.shotMean || mean == null) return { score: null, note: 'nothing to compare', shotMean: { ours: mean, target: null } };
  return { score: Math.round(ratio(mean, target.shotMean) * 100), note: `a cut every ${mean} s against ${target.shotMean} s${target.skipped ? `; ${target.skipped} wanted cut${target.skipped === 1 ? '' : 's'} left out (no quiet between your words there)` : ''}`, shots: { ours: n, target: target.shots != null ? target.shots : null }, shotMean: { ours: mean, target: target.shotMean } };
}

// plan: build/plan.json; cut, caps: the job's cut.json and captions.js; grade: kit/grade-match.cjs match() result;
// target: { against, style, stickers: { count, shape, spoken }, sfx: { count, per10 }, pace: { shotMean, shots, skipped } }
function measure({ mode, plan, cut, caps, grade, target }) {
  const len = ((cut && cut.segs) || []).reduce((a, s) => a + s.out - s.in, 0);
  const parts = { framing: framingPart(plan && plan.shots), grade: gradePart(grade), captions: captionsPart(caps, target.style), stickers: stickersPart(caps && caps.flips, target.stickers), sfx: sfxPart(cut, len, target.sfx), pace: pacePart(plan && plan.shots, len, target.pace) };
  const scored = Object.values(parts).map(p => p.score).filter(x => x != null);
  return { version: VERSION, mode, against: target.against || null, overall: scored.length ? Math.round(scored.reduce((a, x) => a + x, 0) / scored.length) : null, estimate: true, parts };
}

// what a Recreate draft is held against: the recipe, with its counts scaled to your edit (k: your length over its length)
function targetOfRecipe(recipe, { k = 1, len = 0, skipped = 0 } = {}) {
  const v = (g, key) => (g[key] !== undefined ? g[key] : g[key + '~']), ord = (recipe.graphics || []).filter(g => v(g, 'type') === 'ordinal-sticker');
  const dur = +(recipe.card && recipe.card.source && recipe.card.source.duration) || (recipe.shots.length ? recipe.shots[recipe.shots.length - 1].end : 0) || 1, sfx = (recipe.sfx || []).filter(x => x.start * k < len - 0.1);
  return { against: (recipe.card && recipe.card.name) || null, style: recipe.style || {},
    stickers: { count: ord.length, shape: ord.length ? (ord.filter(g => v(g, 'shape') === 'starburst').length * 2 >= ord.length ? 'starburst' : 'seal') : null, spoken: true },
    sfx: { count: sfx.length, per10: len ? r1(sfx.length / len * 10) : 0 },
    pace: { shotMean: recipe.shots.length ? +(dur * k / recipe.shots.length).toFixed(2) : null, shots: recipe.shots.length, skipped } };
}
// what a Copy the look draft is held against: the look's own rules on your edit's length
function targetOfLook(look, { len = 0, skipped = 0, planned = null } = {}) {
  const st = (look.stickers || {}).ordinal;
  return { against: look.name, style: look.style || {},
    stickers: st ? { count: Math.max(1, Math.round((+st.per10 || 0.5) * len / 10)), shape: st.shape || 'seal' } : { count: 0, shape: null },
    sfx: { count: look.sfx.count ? Math.max(1, Math.round((+look.sfx.per10 || 1) * len / 10)) : 0, per10: look.sfx.per10 || 0 },
    pace: { shotMean: look.pace.shotMean, shots: planned, skipped } };
}

function write(build, m) { fs.writeFileSync(path.join(build, FILE), JSON.stringify(m, null, 1) + '\n'); return m; }
function read(build) { try { const m = JSON.parse(fs.readFileSync(path.join(build, FILE), 'utf8')); return m && m.version === VERSION ? m : null; } catch { return null; } }
function drop(build) { fs.rmSync(path.join(build, FILE), { force: true }); }
const line = m => `match: ${m.overall == null ? 'not measured' : m.overall + ' of 100 overall'} (${Object.entries(m.parts).map(([k, p]) => `${k} ${p.score == null ? 'n/a' : p.score}`).join(', ')}); an estimate from the plan, in build/${FILE}`;

module.exports = { measure, targetOfRecipe, targetOfLook, write, read, drop, line, framingPart, gradePart, captionsPart, stickersPart, sfxPart, pacePart, FILE, VERSION };
