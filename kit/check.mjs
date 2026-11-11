// Plan check: lints a job's captions.js and cut.json against the edit rules before you render.
//   npm run check                       -> the shipped examples plus a self-test of the copy lint
//   npm run check -- <job>              -> jobs/<job>/build (or pass a build/ folder path)
//   node kit/check.mjs <build> --warn-only   (reel.cjs runs this; prints, never fails)
// Errors (exit 1): copy that breaks the humanizer standard (em dashes, "not X but Y", staged run-ups, dramatic closers,
// hype words) in captions, titles or the script; a repeated or unknown title entrance; more than 7 titles; an unknown
// transition or sound. Warnings: flicker on a middle title, a sound on every cut, more than 2 big punches, a possible
// forced triad, and the script shape (40-55 words, 15-20 s; over 25 s cut a middle sentence).
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const R = createRequire(import.meta.url)('./rules.cjs');
const SFXPLAN = createRequire(import.meta.url)('./sfx-plan.cjs');
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const argv = process.argv.slice(2), warnOnly = argv.includes('--warn-only');
const target = argv.find(a => !a.startsWith('--'));

function checkJob(captionsFile, cutFile, label) {
  const errs = [], warns = [];
  const CAP = captionsFile && existsSync(captionsFile) ? R.readCaptions(captionsFile) : { flips: [] };
  const flips = CAP.flips || [];
  for (const f of flips) {
    const { errs: e, warns: w } = R.lintCopy(f.text);
    e.forEach(x => errs.push(`caption ${f.start}s "${f.text}": ${x}`)); w.forEach(x => warns.push(`caption ${f.start}s: ${x}`));
  }
  for (const k of ['card', 'cta']) if (CAP[k]) for (const v of Object.values(CAP[k])) if (typeof v === 'string') R.lintCopy(v).errs.forEach(x => errs.push(`${k}: ${x}`));
  const raw = flips.filter(f => f.mode === R.TITLE_MODE);
  if (raw.length > R.ENTRANCES.length) errs.push(`${raw.length} titles; there are ${R.ENTRANCES.length} entrances and none repeats in one video`);
  const seen = {};
  for (const t of raw) if (t.entrance) {
    if (!R.ENTRANCES.includes(t.entrance)) errs.push(`title ${t.start}s: unknown entrance "${t.entrance}" (${R.ENTRANCES.join(', ')})`);
    if (seen[t.entrance]) errs.push(`title ${t.start}s: entrance "${t.entrance}" already used at ${seen[t.entrance]}s`);
    seen[t.entrance] = t.start;
  }
  const sorted = raw.slice().sort((a, b) => a.start - b.start);
  sorted.forEach((t, i) => { if (t.flicker && i > 0 && i < sorted.length - 1) warns.push(`title ${t.start}s: flicker is for the hook and payoff only; it is ignored on a middle title`); });
  // font lockups: "hero" must name words that are in the phrase; "lockup" must use a known arrangement
  const ARR = ['stack', 'overlap', 'inline'];
  const words = t => String(t).replace(/\|/g, ' ').split(/\s+/).filter(Boolean).map(w => w.toLowerCase().replace(/[^a-z0-9']/g, ''));
  const heroOk = (f, h) => { const ws = f.words && f.words.length && f.mode !== R.TITLE_MODE ? f.words.map(w => String(w[2]).toLowerCase().replace(/[^a-z0-9']/g, '')) : words(f.text);
    if (typeof h === 'string') { const want = words(h); return want.length && ws.some((_, i) => want.every((w, k) => ws[i + k] === w)); }
    return Array.isArray(h) && h.length && h.every(i => Number.isInteger(i) && i >= 0 && i < ws.length); };
  for (const f of flips) {
    if (f.hero !== undefined && !heroOk(f, f.hero)) errs.push(`flip ${f.start}s: hero ${JSON.stringify(f.hero)} is not in "${f.text}" (word indices from 0, or the words themselves)`);
    if (f.lockup && typeof f.lockup === 'object' && f.lockup.arrange && !ARR.includes(f.lockup.arrange)) errs.push(`flip ${f.start}s: lockup arrange "${f.lockup.arrange}" (${ARR.join(', ')})`);
  }
  if (CAP.lockup && CAP.lockup.arrange && !ARR.includes(CAP.lockup.arrange)) errs.push(`lockup arrange "${CAP.lockup.arrange}" (${ARR.join(', ')})`);
  if (CAP.captionStyle && !['kinetic', 'classic', 'pill', 'hormozi', 'karaoke'].includes(CAP.captionStyle)) errs.push(`captionStyle "${CAP.captionStyle}" (kinetic, classic, pill, hormozi, karaoke)`);
  if (cutFile && existsSync(cutFile)) {
    const C = JSON.parse(readFileSync(cutFile, 'utf8')), TL = R.timeline(C);
    if (C.lockup && C.lockup.arrange && !ARR.includes(C.lockup.arrange)) errs.push(`cut.json lockup arrange "${C.lockup.arrange}" (${ARR.join(', ')})`);
    for (const [k, h] of Object.entries(C.hero || {})) { const f = flips.find(x => Math.abs(x.start - +k) < 0.006 && (x.mode === 0 || x.mode === R.TITLE_MODE)); if (!f) errs.push(`cut.json hero "${k}": no caption or title starts at ${k}s`); else if (!heroOk(f, h)) errs.push(`cut.json hero "${k}": ${JSON.stringify(h)} is not in "${f.text}"`); }
    (C.segs || []).forEach((s, i) => { if (s.transition && R.xfadeMode(s.transition) === undefined) errs.push(`seg ${i}: unknown transition "${s.transition}" (kit/transitions.json)`); });
    for (const k of Object.keys(C.sfx || {})) if (!R.SFX[k]) errs.push(`sfx "${k}": use ${Object.keys(R.SFX).join(', ')}`);
    for (const h of C.sfxHits || []) if (!SFXPLAN.lookup(h.id)) errs.push(`sfxHits "${h.id}" is not in kit/sfx/sfx.json`);
    if (C.bed) { const lib = R.isBed(C.bed);
      if (!existsSync(lib ? R.bedFile(C.bed) : resolve(dirname(cutFile), String(C.bed)))) errs.push(lib ? `bed "${C.bed}": kit/music/${R.BEDS[C.bed].file} is missing (beds.json lists it)` : `bed "${C.bed}": not a library bed (npm run music) and no such file`); }
    const seams = TL.seams.map(x => x.toFixed(2));
    if (seams.length >= 3) for (const k of R.CUT_SOUNDS) { const on = R.sfxHits((C.sfx || {})[k]).map(h => h.t.toFixed(2)); if (seams.every(x => on.includes(x))) warns.push(`sfx.${k} is on every cut. Fewer and deeper: keep it for the big cuts.`); }
    const n = Object.values(C.sfx || {}).reduce((a, l) => a + R.sfxHits(l).length, 0) + (C.sfxHits || []).length;
    if (n > Math.max(3, TL.total / 3)) warns.push(`${n} sounds in ${TL.total.toFixed(1)} s; fewer and deeper reads better`);
    const bp = (C.segs || []).filter(s => s.bigPunch).length;
    if (bp > 2) warns.push(`${bp} big punches; use them on the cut after the hook and the cut into the payoff`);
    // script shape from the spoken captions (pills/captions only)
    const spoken = flips.filter(f => f.mode === 0 || f.mode === 1).map(f => f.text).join(' ').split(/\s+/).filter(Boolean).length;
    if (spoken) R.scriptShape(spoken, TL.total - (C.tail ?? 0.3)).forEach(x => warns.push(x));
  }
  return { label, errs, warns };
}

const results = [];
{
  const v = SFXPLAN.validateManifest();
  results.push({ label: 'kit/sfx/sfx.json', errs: v.errs, warns: v.warns });
}
if (target) {
  let b = resolve(target);
  if (!existsSync(join(b, 'cut.json')) && existsSync(join(ROOT, 'jobs', target, 'build'))) b = join(ROOT, 'jobs', target, 'build');
  if (!existsSync(b) || !statSync(b).isDirectory()) { console.error('No build folder at ' + b); process.exit(1); }
  results.push(checkJob(join(b, 'captions.js'), join(b, 'cut.json'), b));
} else {
  const ex = join(KIT, 'example');
  results.push(checkJob(join(ex, 'captions.awakening-hero.js'), join(ex, 'cut.awakening-hero.json'), 'kit/example (awakening)'));
  results.push(checkJob(null, join(ex, 'cut.real-footage.json'), 'kit/example (real footage)'));
  // self-test: the lint must catch these and pass the clean line
  const bad = ['It is not a tool but a team', 'Here\u2019s the thing: it works', 'Here\'s the thing', 'This changes everything \u2014 fast', 'We delve into the landscape', 'Let that sink in.'];
  const miss = bad.filter(x => !R.lintCopy(x).errs.length);
  const self = { label: 'copy lint self-test', errs: miss.map(x => `lint missed: "${x}"`), warns: [] };
  if (R.lintCopy('Drop your clip in the inbox and ask for the reel.').errs.length) self.errs.push('lint flagged a clean line');
  results.push(self);
}
let bad = 0;
for (const r of results) {
  console.log(`${r.errs.length ? 'FAIL' : 'ok  '} ${r.label}`);
  r.errs.forEach(e => console.log('  error: ' + e)); r.warns.forEach(w => console.log('  note:  ' + w));
  bad += r.errs.length;
}
if (bad && !warnOnly) { console.log(`\n${bad} error(s). Fix the copy or plan, then run again.`); process.exit(1); }
console.log(bad ? `\n${bad} error(s) (warn-only)` : '\nCHECK PASS');
