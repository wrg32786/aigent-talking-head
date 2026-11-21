// Recreate: a recipe's shot plan, sounds, shakes, graphics and accent carried onto your edit. kit/reel.cjs calls these
// when it drafts from a recipe (--recipe, and --recut for the re-cut). The cutting itself is kit/shotplan.cjs.
// Also here: build/plan.json, the plan a recipe draft leaves for other tools (Studio reads it for B-roll spots).
'use strict';
const fs = require('fs');
const path = require('path');
const RM = require('./reelmd.cjs');
const SPL = require('./shotplan.cjs');
const CP = require('./cutpoints.cjs');
const SFXPLAN = require('./sfx-plan.cjs');
const RF = require('./reframe.cjs');
const GM = require('./grade-match.cjs');

const PLAN_FILE = 'plan.json', PLAN_VERSION = 1;
const r3 = x => +(+x).toFixed(3);
const lengthOf = segs => segs.reduce((a, x) => a + x.out - x.in, 0);
const startOf = (segs, k) => lengthOf(segs.slice(0, k));

// The one place the scale is worked out: your edit's length (len), the reference's (ref) and the factor between
// them (k). The reference's length is its source duration, else the end of its last shot.
function scaleOf(recipe, segs) {
  const len = lengthOf(segs), shots = recipe.shots || [];
  const ref = +(recipe.card && recipe.card.source && recipe.card.source.duration) || (shots.length ? shots[shots.length - 1].end : 0) || len;
  return { len, ref, k: len / ref };
}

// quiet(i, a, b) for kit/shotplan.cjs recut(): the middle of the quiet between clip seconds a and b of segment i's
// clip, read from its audio (kit/cutpoints.cjs), or null when there is none long enough to cut in
function quietFn({ segClip, clipsDir }) {
  const envs = new Map();
  const envOf = i => { const f = path.join(clipsDir, path.basename(segClip[i].file)); if (!envs.has(f)) envs.set(f, CP.envelopeSync(f)); return envs.get(f); };
  return (i, a, b) => { const e = envOf(i); return e ? SPL.quietFrom(CP, e)(a, b) : null; };
}

// Re-cut segs (in place) to the recipe's shots, on word boundaries. segClip[i] is the clip behind segment i.
// manyClips: three or more clips, whose default big punches are cleared so the recipe's own can be set.
function recut({ recipe, segs, segClip, clipsDir, manyClips = false, log = console.log }) {
  const quiet = quietFn({ segClip, clipsDir });
  const plan0 = RM.shotSettings(recipe);
  if (manyClips) segs.forEach(x => { delete x.bigPunch; });
  const rc = SPL.recut(segs, i => segClip[i].words || [], plan0, quiet);
  segs.splice(0, segs.length, ...rc.segs);
  log(`recut: ${rc.plan.length} shots from the recipe's ${plan0.length} (scaled to ${lengthOf(segs).toFixed(1)} s), cuts at ${rc.cuts.map(c => c.t + ' s (' + c.on + ')').join(', ') || 'none'}${rc.skipped.length ? `; no quiet near ${rc.skipped.map(x => x.at + ' s').join(', ')}, those shots play as one` : ''}`);
  return rc;
}

// The recipe's per-shot settings (finish, big punch, transition, move, shake) on the segments: on the re-cut shots
// when rc is given, else on your clips in order (clipStart: the first segment of each clip). A finish goes on every
// segment of the shot, the rest on its first. Returns the plan and the segments that start with a shake.
function applyShotPlan({ recipe, segs, rc = null, clipStart = [], wantPunch = true }) {
  const plan = RM.shotSettings(recipe), shakeAt = [];
  const put = (p, k, next, notFirst) => {
    const sg = segs[k], subs = segs.slice(k, next ?? segs.length);
    if (p.finish) subs.forEach(x => { x.finish = p.finish; });
    if (p.bigPunch && wantPunch) sg.bigPunch = true;
    if (p.transition && notFirst) sg.transition = p.transition;
    if (p.move && !sg.bigPunch) sg.push = SPL.MOVES[p.move];
    if (p.shake && notFirst) shakeAt.push(k);
  };
  if (rc) rc.shotStart.forEach((k, j) => put(plan[rc.shotOf[j]] || {}, k, rc.shotStart[j + 1], j));
  else plan.forEach((p, i) => { const k = clipStart[i]; if (k != null) put(p, k, clipStart[i + 1], i); });
  return { plan, shakeAt };
}

// the size of the footage a segment's clip was cut from (clips.json "src"), else the clip's own: what the zoom limit rests on
function sourceSize(files) {
  const { execFileSync } = require('child_process');
  for (const f of files.filter(Boolean)) {
    try { const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(',').map(Number); if (w > 0 && h > 0) return { w, h }; } catch {}
  }
  return null;
}

// Reframe every shot to a face target (kit/reframe.cjs). shotStart[j]: the first segment of shot j; targets[j]: the
// face to match ({ faceH, eyeY, cx }) or null. A shot with no target of its own borrows the middle one. Your face is
// measured per segment (kit/framing.py). Sets zoom, punchX and punchY on the segments; returns per shot
// { framing (what you get), target, crop, clamped, held } or null where the old zoom stays, or null when nothing was matched.
function reframeShots({ segs, shotStart, targets, build, python, sources = [], log = console.log, what = 'the reference' }) {
  if (!targets.some(Boolean)) { log(`reframe: ${what} has no face measured (an older teardown, or the speaker is never on screen); framing by shot size as before`); return null; }
  const faces = segs.map(() => null), takes = segs.map(() => null), files = [...new Set(segs.map(s => s.file))];
  for (const file of files) {
    const idx = segs.map((s, i) => (s.file === file ? i : -1)).filter(i => i >= 0);
    const got = RF.measure(python, path.resolve(build, file), idx.map(i => [segs[i].in, segs[i].out]), { samples: 5 });
    const mid = RF.medianFace(got); // the take's own framing: a close take is not pushed in where no face was found or you lean back
    RF.steady(got).forEach((f, n) => { faces[idx[n]] = f; takes[idx[n]] = mid; });
  }
  if (!faces.some(Boolean)) { log('reframe: we found no face in your take (or Python with opencv is missing); framing by shot size as before'); return null; }
  const size = sourceSize([...sources, ...files.map(f => path.resolve(build, f))]), zMax = size ? RF.maxZoom(size.w, size.h) : 2.2;
  const res = RF.applyToSegs({ segs, shotStart, targets, faces, takes, maxZoom: zMax, fallback: RF.medianFace(targets) });
  const done = res.shots.filter(Boolean);
  if (!done.length) return null;
  const avg = k => done.reduce((a, x) => a + Math.abs(x.framing[k] - x.target[k]), 0) / done.length;
  log(`reframe: ${done.length} of ${shotStart.length} shots set to ${what}'s face size and eye line (zoom ${Math.min(...done.map(x => x.crop.zoom))} to ${Math.max(...done.map(x => x.crop.zoom))}, limit ${zMax}${size ? ` on your ${size.w}x${size.h} source` : ''}); off by ${(avg('faceH') * 100).toFixed(1)}% of the frame in face height and ${(avg('eyeY') * 100).toFixed(1)}% in eye line on average${done.some(x => x.borrowed) ? `; ${done.filter(x => x.borrowed).length} with no face in the reference use its middle framing` : ''}`);
  res.lines.forEach(l => log(l));
  return res.shots;
}

// Each re-cut shot reframed to a face target and graded to a colour target. Recreate: the targets are the reference
// shot's own (its Reel.md "face" and "lab"). Copy the look: pass faceTargets and labTargets (one per shot in rc) from
// the look. Adds face, faceTarget, crop and grade to the plan entries (rc.plan). Returns { framing, grade } for the
// read-out (kit/fidelity.cjs).
function matchShots({ recipe, segs, rc, build, python, sources = [], reframe = true, grade = true, log = console.log, faceTargets = null, labTargets = null, what = 'the reference' }) {
  const shots = recipe ? RM.shotSettings(recipe) : [], out = { framing: null, grade: null };
  if (reframe) {
    const fr = reframeShots({ segs, shotStart: rc.shotStart, targets: faceTargets || rc.shotOf.map(k => (shots[k] || {}).face || null), build, python, sources, log, what });
    if (fr) { out.framing = fr; fr.forEach((f, j) => { if (!f || !rc.plan[j]) return; rc.zoom[j] = f.crop.zoom; Object.assign(rc.plan[j], { zoom: f.crop.zoom, face: f.framing, faceTarget: f.target, crop: f.crop, ...(f.clamped ? { clamped: true, ...(f.held ? { held: f.held } : {}) } : {}) }); }); }
  } else log('reframe: off; framing by shot size');
  if (grade) {
    // a cutaway's colour is not the speaker's grade
    const g = GM.match({ python, build, segs, shotStart: rc.shotStart, targets: labTargets || rc.shotOf.map(k => (shots[k] && !shots[k].cutaway && shots[k].lab) || null) });
    log(GM.line(g, what));
    if (g.ok) { out.grade = g; g.shots.forEach((x, j) => { if (x && rc.plan[j]) rc.plan[j].grade = { lut: x.lut, strength: x.strength }; }); }
  } else log('grade: match off; your take keeps its own colour under the finish');
  return out;
}

// the reference's sound effects at its times scaled to your edit, as the kit's sounds
function refSounds(recipe, scale) {
  return (recipe.sfx || []).map(x => ({ id: x.sound || SPL.sfxId(x.type), t: r3(x.start * scale.k), ref: true })).filter(h => h.t < scale.len - 0.1 && SFXPLAN.lookup(h.id));
}

// the reference's handheld or shaking shots: a shake hit just after the cut into each segment in shakeAt
function refShakes(segs, shakeAt) {
  return shakeAt.map(k => [r3(startOf(segs, k) + 0.08), 18]);
}

// put the shakes in cut.hits, skipping any within 0.2 s of a hit already there. Returns the times added.
function addShakes(cut, shakes) {
  const added = [];
  if (!shakes.length) return added;
  const hits = cut.hits || (cut.hits = []);
  for (const h of shakes) if (!hits.some(([x]) => Math.abs(x - h[0]) < 0.2)) { hits.push(h); added.push(h[0]); }
  hits.sort((a, z) => a[0] - z[0]);
  return added;
}

// the recipe's graphics and scenes at its times scaled to your edit (in place). False when the lengths match.
function scaleGraphics(gfx, scale) {
  const k = scale.k;
  if (!(Math.abs(k - 1) > 0.01)) return false;
  for (const g of gfx) { const d = g.end - g.start; g.start = r3(g.start * k); g.end = r3(g.start + Math.max(0.6, Math.min(d, d * k + 0.4))); }
  return true;
}

// a timer or number slot in the reference that none of your titles took: a title from your matching words there
function titleSlots(refTitles, matched, words, scale, taken) {
  return SPL.fillSlots(refTitles, matched, words, { k: scale.k, len: scale.len, taken });
}

// the recipe's accent: the first of its colours that is saturated and not dark, else the first light one
function accentFor(preset) {
  const cols = preset && Array.isArray(preset.colors) ? preset.colors : [];
  const hex = cols.filter(c => /^#[0-9a-f]{6}$/i.test(c)), rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = h => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }, sat = h => { const c = rgb(h), mx = Math.max(...c); return mx ? (mx - Math.min(...c)) / mx : 0; };
  const accent = hex.find(h => sat(h) > 0.3 && lum(h) > 0.25) || hex.find(h => lum(h) > 0.5);
  return accent ? accent.toLowerCase() : null;
}
// write the accent onto the job's theme
function writeAccent(build, accent) {
  fs.appendFileSync(path.join(build, 'theme.js'), `\n// the reference's accent (Reel.md brand kit colors), set by kit/reel.cjs\nwindow.THEME.colors.accent = '${accent}';\n`);
}

// build/plan.json: what a recipe draft took from the recipe, on your edit's clock. shots is the re-cut plan (the same
// list as cut.json refShots; empty without --recut), scale is 1 when nothing was scaled.
function planOf({ recipe, scale = null, rc = null, cut, shakes = [], sounds = [], flips = [], theme = null, accent = null, mode = null, look = null, broll = [] }) {
  const segs = (cut && cut.segs) || [], moveName = v => Object.keys(SPL.MOVES).find(m => SPL.MOVES[m] === v) || null;
  const at = segs.map((s, i) => r3(startOf(segs, i)));
  return {
    version: PLAN_VERSION,
    mode: mode || (rc ? 'recreate' : 'recipe'), ...(look ? { look } : {}),
    recipe: recipe.file || null,
    scale: rc && scale ? scale.k : 1,
    shots: rc ? rc.plan : [],
    transitions: segs.map((s, i) => (s.transition ? { t: at[i], name: s.transition } : null)).filter(Boolean),
    moves: segs.map((s, i) => (s.push != null ? { t: at[i], move: moveName(s.push), push: s.push } : null)).filter(Boolean),
    shakes: shakes.map(h => ({ t: h[0], strength: h[1] })),
    sounds: sounds.map(h => ({ id: h.id, t: h.t })),
    scenes: flips.filter(f => f.mode === 39).map(f => ({ start: f.start, end: f.end, scene: f.scene, ...(f.sceneName ? { name: f.sceneName } : {}) })),
    // where B-roll goes, what each slot should show and how it is treated; a slot with no clip is "needs" (kit/broll-slots.cjs)
    broll,
    theme, accent,
  };
}
function writePlan(build, plan) { fs.writeFileSync(path.join(build, PLAN_FILE), JSON.stringify(plan, null, 1) + '\n'); return plan; }
// a draft with no recipe has no plan: an old one must not outlive it
function dropPlan(build) { fs.rmSync(path.join(build, PLAN_FILE), { force: true }); }
function readPlan(build) {
  try { const p = JSON.parse(fs.readFileSync(path.join(build, PLAN_FILE), 'utf8')); return p && p.version === PLAN_VERSION ? p : null; } catch { return null; }
}
// the re-cut shots of a drafted job: plan.json first, else cut.json refShots (drafts made before plan.json)
function shotsOf(build, cut) {
  const p = build ? readPlan(build) : null;
  if (p && Array.isArray(p.shots) && p.shots.length) return p.shots;
  return cut && Array.isArray(cut.refShots) ? cut.refShots : [];
}

module.exports = { quietFn, reframeShots, matchShots, sourceSize, scaleOf, lengthOf, recut, applyShotPlan, refSounds, refShakes, addShakes, scaleGraphics, titleSlots, accentFor, writeAccent, planOf, writePlan, dropPlan, readPlan, shotsOf, PLAN_FILE, PLAN_VERSION };
