// Plan check: lints a job's captions.js and cut.json against the edit rules before you render.
//   npm run check                       -> the shipped examples plus a self-test of the copy lint
//   npm run check -- <job>              -> jobs/<job>/build (or pass a build/ folder path)
//   node kit/check.mjs <build> --warn-only   (reel.cjs runs this; prints, never fails)
// Errors (exit 1): copy that breaks the humanizer standard (em dashes, "not X but Y", staged run-ups, dramatic closers,
// hype words) in captions, titles or the script; a repeated or unknown title entrance; more than 7 titles; an unknown
// transition, sound or film-finish name. Warnings: flicker on a middle title, a sound on every cut, more than 2 big punches, a possible
// forced triad, the script shape (40-55 words, 15-20 s; over 25 s cut a middle sentence), and beat-sync on with no bed.
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { coverage, loadMenu, showcaseHas, sourceCatalogIds } from './menu.mjs';
import { checkContract } from './contract.mjs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const R = createRequire(import.meta.url)('./rules.cjs');
const SFXPLAN = createRequire(import.meta.url)('./sfx-plan.cjs');
const B = createRequire(import.meta.url)('./beats.cjs');
const SPLITL = createRequire(import.meta.url)('./split.cjs');
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
  if (raw.length > R.ENTRANCES.length && !CAP.entranceRepeat) errs.push(`${raw.length} titles; there are ${R.ENTRANCES.length} entrances and none repeats in one video`);
  const seen = {};
  for (const t of raw) if (t.entrance) {
    if (!R.ENTRANCES.includes(t.entrance)) errs.push(`title ${t.start}s: unknown entrance "${t.entrance}" (${R.ENTRANCES.join(', ')})`);
    // a repeat is allowed when you chose it (a titles lock with fewer entrances than titles, or npm run choices --apply)
    if (seen[t.entrance] && !CAP.entranceRepeat) errs.push(`title ${t.start}s: entrance "${t.entrance}" already used at ${seen[t.entrance]}s`);
    seen[t.entrance] = t.start;
  }
  const sorted = raw.slice().sort((a, b) => a.start - b.start);
  sorted.forEach((t, i) => { if (t.flicker && i > 0 && i < sorted.length - 1) warns.push(`title ${t.start}s: flicker is for the hook and payoff only; it is ignored on a middle title`); });
  const layerOk = (v, where) => {
    if (v == null || v === '') return;
    if (!R.TITLE_LAYERS.includes(String(v).toLowerCase())) errs.push(`${where}: unknown title layer "${v}" (front, behind, auto)`);
  };
  layerOk(CAP.titleLayer, 'titleLayer');
  if (CAP.panelLayer != null && !R.PANEL_LAYERS.includes(CAP.panelLayer)) errs.push(`panelLayer "${CAP.panelLayer}" (front, behind, auto)`);
  for (const t of raw) layerOk(t.layer, `title ${t.start}s`);
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
  if (CAP.captionPosition && !['top', 'middle', 'bottom'].includes(CAP.captionPosition)) errs.push(`captionPosition "${CAP.captionPosition}" (top, middle, bottom)`);
  for (const [k, vals] of [['captionOutline', ['none', 'thin', 'thick']], ['captionShadow', ['none', 'soft']], ['captionCase', ['upper', 'lower', 'as-said']], ['captionLayer', ['front', 'behind', 'auto']], ['captionEntrance', ['pop', 'unfurl', 'cascade', 'orbit', 'warp', 'crystallize', 'compute', 'levitate', 'undulate', 'typewriter']]]) if (CAP[k] && !vals.includes(CAP[k])) errs.push(`${k} "${CAP[k]}" (${vals.join(', ')})`);
  if (CAP.captionColor && !/^#[0-9a-f]{6}$/i.test(CAP.captionColor)) errs.push(`captionColor "${CAP.captionColor}" (a #rrggbb colour)`);
  // graphics (kit/graphics.json): an icon or screen file that is named must exist; leaving it out draws the placeholder
  for (const f of flips.filter(x => x.mode >= 9 && x.mode <= 38)) {
    const file = f.mode === 10 || f.mode === 19 ? f.icon : f.mode === 11 ? f.src : null;
    if (file && !existsSync(resolve(dirname(captionsFile), file))) errs.push(`graphic ${f.start}s: no file at ${file}`);
    if (f.mode === 9 && f.layer && !['front', 'behind'].includes(f.layer)) errs.push(`graphic ${f.start}s: layer "${f.layer}" (front, behind)`);
    if (f.mode === 9 && f.shape && !['seal', 'starburst'].includes(f.shape)) errs.push(`graphic ${f.start}s: shape "${f.shape}" (seal, starburst)`);
    if (f.mode === 11 && f.layer && !R.PANEL_LAYERS.includes(f.layer)) errs.push(`screen card ${f.start}s: layer "${f.layer}" (front, behind, auto)`);
    if (f.mode >= 12 && f.layer && !R.PANEL_LAYERS.includes(f.layer)) errs.push(`graphic ${f.start}s: layer "${f.layer}" (front, behind, auto)`);
    for (const [m, nm] of [[14, 'checklist'], [30, 'ticker'], [32, 'feature cards']]) if (f.mode === m && !(Array.isArray(f.items) ? f.items.length : String(f.items || '').trim())) errs.push(`${nm} ${f.start}s: no items`);
    if (f.mode === 24 && !String(f.values || '').trim()) errs.push(`data chart ${f.start}s: no values`);
    // the worded fields of graphics 12 to 38 follow the copy rules too (a code card and a terminal session are code, so they are left alone)
    if (f.mode >= 12 && f.mode !== 23 && f.mode !== 28) for (const v of [f.text, f.sub, f.left, f.right, f.keyword, ...(Array.isArray(f.items) ? f.items : []), ...(Array.isArray(f.details) ? f.details : [])]) if (typeof v === 'string' && v) R.lintCopy(v).errs.forEach(x => errs.push(`graphic ${f.start}s: ${x}`));
  }
  if (CAP.captionStyle && !['kinetic', 'oneword', 'classic', 'pill', 'hormozi', 'karaoke', 'one-word'].includes(CAP.captionStyle)) errs.push(`captionStyle "${CAP.captionStyle}" (kinetic, oneword, classic, pill, hormozi, karaoke, one-word)`);
  if (cutFile && existsSync(cutFile)) {
    const C = JSON.parse(readFileSync(cutFile, 'utf8')), TL = R.timeline(C);
    layerOk(C.titleLayer, 'cut.json titleLayer');
    if (C.lockup && C.lockup.arrange && !ARR.includes(C.lockup.arrange)) errs.push(`cut.json lockup arrange "${C.lockup.arrange}" (${ARR.join(', ')})`);
    for (const [k, h] of Object.entries(C.hero || {})) { const f = flips.find(x => Math.abs(x.start - +k) < 0.006 && (x.mode === 0 || x.mode === R.TITLE_MODE)); if (!f) errs.push(`cut.json hero "${k}": no caption or title starts at ${k}s`); else if (!heroOk(f, h)) errs.push(`cut.json hero "${k}": ${JSON.stringify(h)} is not in "${f.text}"`); }
    (C.segs || []).forEach((s, i) => { if (s.transition && R.xfadeMode(s.transition) === undefined) errs.push(`seg ${i}: unknown transition "${s.transition}" (kit/transitions.json)`); });
    for (const k of Object.keys(C.sfx || {})) if (!R.SFX[k] && !(C.sounds || {})[k]) errs.push(`sfx "${k}": use ${Object.keys(R.SFX).join(', ')}, or add it to "sounds" in cut.json`);
    for (const h of C.sfxHits || []) if (!SFXPLAN.lookup(h.id)) errs.push(`sfxHits "${h.id}" is not in kit/sfx/sfx.json`);
    for (const [k, s] of Object.entries(C.sounds || {})) if (!s.file || !existsSync(resolve(dirname(cutFile), s.file))) errs.push(`sounds.${k}: no file at ${s.file}`);
    for (const [k, s] of (C.inserts || []).entries()) { if (s.place != null && !SPLITL.PLACES.includes(s.place)) errs.push(`inserts[${k}]: place "${s.place}" (${SPLITL.PLACES.join(', ')})`); if (!s.file || !existsSync(resolve(dirname(cutFile), s.file))) errs.push(`inserts[${k}]: no file at ${s.file}`); if (!(+s.dur > 0) || +s.at < 0 || +s.at + +s.dur > TL.total + 0.01) errs.push(`inserts[${k}]: at ${s.at} + dur ${s.dur} is outside the ${TL.total} s cut`); }
    if (C.bed) { const lib = R.isBed(C.bed);
      if (!existsSync(lib ? R.bedFile(C.bed) : resolve(dirname(cutFile), String(C.bed)))) errs.push(lib ? `bed "${C.bed}": kit/music/${R.BEDS[C.bed].file} is missing (beds.json lists it)` : `bed "${C.bed}": not a library bed (npm run music) and no such file`); }
    const seams = TL.seams.map(x => x.toFixed(2));
    if (seams.length >= 3) for (const k of R.CUT_SOUNDS) { const on = R.sfxHits((C.sfx || {})[k]).map(h => h.t.toFixed(2)); if (seams.every(x => on.includes(x))) warns.push(`sfx.${k} is on every cut. Fewer and deeper: keep it for the big cuts.`); }
    const n = Object.values(C.sfx || {}).reduce((a, l) => a + R.sfxHits(l).length, 0) + (C.sfxHits || []).length;
    if (n > Math.max(3, TL.total / 3)) warns.push(`${n} sounds in ${TL.total.toFixed(1)} s; fewer and deeper reads better`);
    const bp = (C.segs || []).filter(s => s.bigPunch).length;
    if (bp > 2) warns.push(`${bp} big punches; use them on the cut after the hook and the cut into the payoff`);
    const finishes = [{ where: 'cut.json', raw: C.finish }, ...(C.segs || []).map((s, i) => ({ where: `seg ${i}`, raw: s.finish }))];
    for (const { where, raw } of finishes) {
      if (raw == null || raw === false || raw === '') continue;
      try { B.parseFinish(raw); } catch (e) { errs.push(`${where}: ${e.message}`); }
    }
    if (C.beatWindow != null && !(C.beatWindow >= 0 && C.beatWindow <= 0.5)) errs.push(`beatWindow ${C.beatWindow} should be between 0 and 0.5 seconds`);
    if (C.beatSync && !C.bed) warns.push('beatSync is on but there is no bed to analyse; punches and SFX will not snap');
    if (C.dropHits && C.dropHits.length) {
      const TL = R.timeline(C), cap = {};
      for (const h of C.dropHits) {
        const t = Array.isArray(h) ? h[0] : h;
        const seg = TL.segs.find(s => t >= s.start - 0.001 && t < s.end + 0.001);
        const i = seg ? seg.i : -1;
        cap[i] = (cap[i] || 0) + 1;
      }
      for (const [i, n] of Object.entries(cap)) if (n > B.MAX_SHAKES_PER_SEG) warns.push(`seg ${i}: ${n} drop shakes; cap is ${B.MAX_SHAKES_PER_SEG} per shot`);
    }
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

  // example Reel.md recipes: valid, and their title copy passes the lint
  {
    const RM = createRequire(import.meta.url)('./reelmd.cjs');
    const dir = join(ROOT, 'examples', 'recipes');
    const errs = [];
    for (const f of (existsSync(dir) ? readdirSync(dir) : []).filter(f => f.endsWith('.Reel.md'))) {
      try {
        const r = RM.load(join(dir, f)); const v = RM.validate(r);
        v.errs.forEach(e => errs.push(`${f}: ${e}`));
        r.titles.forEach(t => R.lintCopy(t.text || '').errs.forEach(e => errs.push(`${f} title #${t.n}: ${e}`)));
      } catch (e) { errs.push(`${f}: ${e.message}`); }
    }
    results.push({ label: 'example recipes (Reel.md)', errs, warns: [] });
  }

  // contract.json matches the real CLIs (kit/contract.mjs); the agent-facing files carry no em dashes
  results.push({ label: 'contract.json matches the CLIs', errs: checkContract(), warns: [] });
  {
    const errs = [];
    for (const f of ['skills/aigent-talking-head/SKILL.md', 'contract.json', 'CONTRIBUTING.md']) if (existsSync(join(ROOT, f)) && readFileSync(join(ROOT, f), 'utf8').includes('\u2014')) errs.push(`${f} has an em dash`);
    results.push({ label: 'SKILL.md and contract.json copy', errs, warns: [] });
  }
  // releases: the package.json version has a CHANGELOG section and plain-words notes in docs/releases (kit/release-notes.mjs)
  {
    const errs = [];
    const { section, draft } = await import('./release-notes.mjs');
    const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    const items = section(log, ver);
    if (!items || !items.length) errs.push(`CHANGELOG.md has no "## ${ver}" section with entries`);
    else if (!draft(log, ver, ['docs/x.png']).includes(`raw.githubusercontent.com/wrg32786/aigent-talking-head/v${ver}/docs/x.png`)) errs.push('release:notes draft does not link screenshots from the tag');
    const notes = join(ROOT, 'docs', 'releases', `v${ver}.md`);
    if (!existsSync(notes)) errs.push(`docs/releases/v${ver}.md is missing (npm run release:notes -- --write, then edit it)`);
    for (const f of existsSync(join(ROOT, 'docs', 'releases')) ? readdirSync(join(ROOT, 'docs', 'releases')) : []) if (readFileSync(join(ROOT, 'docs', 'releases', f), 'utf8').includes('\u2014')) errs.push(`docs/releases/${f} has an em dash`);
    results.push({ label: `release ${ver}: CHANGELOG section and docs/releases/v${ver}.md`, errs, warns: [] });
  }
  // style packs (packs/), locks and the choices table: shipped packs valid with previews, docs/packs.md lists each
  {
    const req = createRequire(import.meta.url);
    results.push({ label: 'locks self-test (kit/locks.cjs)', errs: req('./locks.cjs').selfTest(), warns: [] });
    results.push({ label: 'choices self-test (kit/choices.cjs)', errs: req('./choices.cjs').selfTest(), warns: [] });
    results.push({ label: 'glossary self-test (kit/glossary.cjs)', errs: req('./glossary.cjs').selfTest(), warns: [] });
    results.push({ label: 'keyword logos self-test (kit/brands.cjs)', errs: req('./brands.cjs').selfTest(), warns: [] });
    const K = req('./packs.cjs'), errs = K.selfTest(), doc = join(ROOT, 'docs', 'packs.md');
    if (!existsSync(doc)) errs.push('docs/packs.md is missing; run npm run pack:preview -- --docs-only');
    else { const md = readFileSync(doc, 'utf8'); for (const p of K.shipped()) { if (!md.includes(`### ${p.name} `)) errs.push(`docs/packs.md is missing pack ${p.name}`); if (md.includes('\u2014')) { errs.push('docs/packs.md has an em dash'); break; } } }
    results.push({ label: 'style packs (packs/)', errs, warns: [] });
    const tp = join(ROOT, 'tests', 'packs.test.cjs'), terrs = [];
    try { execFileSync(process.execPath, [tp], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { terrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 6).join(' | ')); }
    results.push({ label: 'pack tests (tests/packs.test.cjs)', errs: terrs, warns: [] });
    const perrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'cut-points.test.cjs')], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { perrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 6).join(' | ')); }
    results.push({ label: 'cut point tests (tests/cut-points.test.cjs: audio envelope, word ends, lead-ins, tighten, hidden pauses, noises)', errs: perrs, warns: [] });
    const shperrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'recreate-shotplan.test.cjs')], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { shperrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Recreate shot plan tests (tests/recreate-shotplan.test.cjs: a multi-shot reference to a recipe, one take re-cut on word boundaries with framing per shot, sounds, boxes, titles by role, transcript offset, an end in a pause)', errs: shperrs, warns: [] });
    const rperrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'recreate-plan.test.cjs')], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { rperrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Recreate module and plan.json tests (tests/recreate-plan.test.cjs: one scale, per-shot settings, sounds, shakes, graphics, accent, a recipe draft writes build/plan.json, read first with cut.json refShots as the fallback)', errs: rperrs, warns: [] });
    const rgerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'reframe-grade.test.cjs')], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { rgerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'reframe and grade match tests (tests/reframe-grade.test.cjs: the crop that puts your face on the reference face, the zoom limit of the source, the face box kept inside, the Reel.md face and lab keys, YuNet end to end, the skin-protected LUT, one LUT when the shots agree, the assembler applying both)', errs: rgerrs, warns: [] });
    const slerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'stylelook.test.cjs')], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { slerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Copy the look tests (tests/stylelook.test.cjs: a style look from a teardown with none of its words or times, save, load and list, cuts only in your own pauses, stickers on your own words, the look\'s titles and sounds, build/match.json, --style-look refused with --recipe)', errs: slerrs, warns: [] });
    const scerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'ref-scenes.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { scerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'scenes made from a reference (tests/ref-scenes.test.mjs: safe scenes kept once, a teardown makes its sticker, labels and effects as REF menu items, --scenes, no bed, timer and number title slots)', errs: scerrs, warns: [] });
    const snerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'snapshots.test.cjs')], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { snerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 6).join(' | ')); }
    results.push({ label: 'reel snapshot tests (tests/snapshots.test.cjs: the build behind each reel, reopen)', errs: snerrs, warns: [] });
    const mcerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'manual-cuts.test.cjs')], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) { mcerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 6).join(' | ')); }
    results.push({ label: 'cuts by hand (tests/manual-cuts.test.cjs: a stretch cut out of a clip, the noise finder)', errs: mcerrs, warns: [] });
    const serrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { serrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio tests (tests/studio.test.mjs: catalog, session, server, chat)', errs: serrs, warns: [] });
    const aerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-agent.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { aerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio agent tests (tests/studio-agent.test.mjs: reference links, settings, local model, agent channel over MCP, hook)', errs: aerrs, warns: [] });
    const fxerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-fixes.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { fxerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio fix tests (tests/studio-fixes.test.mjs: no terminal command on the page, Install, Send and Copy for my agent)', errs: fxerrs, warns: [] });
    const rerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-record.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { rerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio record tests (tests/studio-record.test.mjs: chunked take upload, mp4 conversion, takes over MCP)', errs: rerrs, warns: [] });
    const cerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-scripts.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { cerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio script tests (tests/studio-scripts.test.mjs: scripts API, MCP script tools, model-written scripts, takes with scripts)', errs: cerrs, warns: [] });
    const kerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-connect.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { kerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio connect tests (tests/studio-connect.test.mjs: Dropbox, Drive and direct footage links against a mock server, Connect agent commands, setup check)', errs: kerrs, warns: [] });
    const verrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-review.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { verrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio review tests (tests/studio-review.test.mjs: what to swap, clean-up pass, edit receipt, preview comments)', errs: verrs, warns: [] });
    const uerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-cut.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { uerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio cut tests (tests/studio-cut.test.mjs: output choice, candidates, chunked transcription, cut edits, MCP cut tools, model scoring, pull and adapt a script)', errs: uerrs, warns: [] });
    const fderrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-folders.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { fderrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio folder tests (tests/studio-folders.test.mjs: folder list API, folders only, no secrets or escapes, page header, New folder, Open folder, native dialog hook, the one-line install)', errs: fderrs, warns: [] });
    const berrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-broll.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { berrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio b-roll tests (tests/studio-broll.test.mjs: API keys never shown, Pexels, Pixabay and Higgsfield against a mock, library, lane and placements, credits, generate approval, MCP b-roll tools)', errs: berrs, warns: [] });
    const posterrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-post.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { posterrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio post tests (tests/studio-post.test.mjs: Buffer, R2 and Cloudinary against a mock, links refused, per-channel limits, drafts by default, post now needs a confirm, H.264, MCP Buffer tools)', errs: posterrs, warns: [] });
    const ses = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-session.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { ses.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio session tests (tests/studio-session.test.mjs: footage patch, no-op replies, one bed, your words, keyword logos, Instagram by yt-dlp, Install, late cancel)', errs: ses, warns: [] });
    const nverrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-videos.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { nverrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio video tests (tests/studio-videos.test.mjs: New video keeps or resets the look, nothing deleted, per-job sessions, open a past video, refused while busy, MCP list_videos, new_video, open_video)', errs: nverrs, warns: [] });
    const rterrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-reset.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { rterrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio reset tests (tests/studio-reset.test.mjs: uploading new footage starts a fresh edit, leftover B-roll leaves the timeline, files stay, Clear all B-roll with undo, MCP clear_broll and fill_slot clear+all, Keep my look)', errs: rterrs, warns: [] });
    const fierrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-finish.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { fierrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio finish tests (tests/studio-finish.test.mjs: what the one Render makes, eight steps and their old names, one render path, Your edit, MCP get_edit and studio_run from and exports)', errs: fierrs, warns: [] });
    const sterrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-steps.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { sterrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio step map tests (tests/studio-steps.test.mjs: the 8 steps, old step names land, one step per layer, menu links, match chips)', errs: sterrs, warns: [] });
    for (const [f, what] of [['studio-point.test.mjs', 'Studio Cut step tests (tests/studio-point.test.mjs: the point of the video steers lines and clips, topics are real themes, Pacing never cuts a word)'],
      ['studio-cut-server.test.mjs', 'Studio Cut server tests (tests/studio-cut-server.test.mjs: the Cut routes, the point, topics, Pacing and the stitched previews over HTTP)'],
      ['studio-stages.test.mjs', 'Studio stage status tests (tests/studio-stages.test.mjs: teardown log lines to the stage line, the list and the bar)']]) {
      const e2 = [];
      try { execFileSync(process.execPath, [join(ROOT, 'tests', f)], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
      catch (e) { e2.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
      results.push({ label: what, errs: e2, warns: [] });
    }
    const sperrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-spots.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { sperrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio b-roll spots tests (tests/studio-spots.test.mjs: spots of 6 to 10 s from the captions, Add a spot, reference spots, counters, quotes and noun searches from the words, the first spot too, upload kinds, Approve with no key, MCP pick_broll, add_spot, add_testimonial)', errs: sperrs, warns: [] });
    const rparts = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-recreate-parts.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { rparts.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio reference parts tests (tests/studio-recreate-parts.test.mjs: Influence takes the parts switched on, Recreate all, what the breakdown read with a fix for each part that did not)', errs: rparts, warns: [] });
    const lkerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-look.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { lkerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio Look tests (tests/studio-look.test.mjs: 9 layers with every option in exactly one, no duplicates, the badges, Clear reference as one undo, Save as a Look with the reference, MCP clear_reference and save_look)', errs: lkerrs, warns: [] });
    const cferrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-conflicts.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { cferrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio settings that rule out others (tests/studio-conflicts.test.mjs: the rules match the engine, a pick that rules something out turns it off with one line and Undo, a ruled out pick refused with the reason, the one click switch, compose drops ruled out picks, the page bundles the same rules, MCP studio_set_selections)', errs: cferrs, warns: [] });
    const rserrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-refstyle.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { rserrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio reference sets the Look (tests/studio-refstyle.test.mjs: Recreate sets every layer, Influence keeps your Look and sound, your changes stay, Back to my look gives your own picks back, a reference still being read sets it when ready, MCP studio_set_selections)', errs: rserrs, warns: [] });
    const slkerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-stylelook.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { slkerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio Copy the look (tests/studio-stylelook.test.mjs: reference mode look, a draft with --style-look and no recipe or re-cut, the look saved as look-<job>, a saved style look with no reference, Recreate wins, the list and save API, match passed through, MCP get_edit, studio_set_selections and save_look)', errs: slkerrs, warns: [] });
    const auerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-agent-ux.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { auerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio agent and review tests (tests/studio-agent-ux.test.mjs: waveform select on whole words, notes on a stretch, Ask my agent with the step, Apply on a suggested change, the wizards, MCP run_wizard and studio_reply suggest)', errs: auerrs, warns: [] });
    const pcerrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-pieces.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { pcerrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio pieces and outputs tests (tests/studio-pieces.test.mjs: a category for every line, your category wins, topics, Let AI choose hook first and CTA last with reasons, neighbours join into one range, the Outputs library with each version\'s settings, MCP get_pieces, set_combo, choose_combo, list_outputs)', errs: pcerrs, warns: [] });
    const pterrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'studio-point.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { pterrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'Studio Cut step tests (tests/studio-point.test.mjs: the point of the video steers lines, Let AI choose, clips and the model prompt; topics are 3 to 5 themes of two or more words, never the old single words; pacing only removes quiet, never part of a word; the stitched previews; your own clip; MCP fields)', errs: pterrs, warns: [] });
    const ferrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'face-matte.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { ferrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'face and mask tests (tests/face-matte.test.mjs: BiRefNet tiers, memory check, Studio 409 when memory is short)', errs: ferrs, warns: [] });
    const sberrs = [];
    try { execFileSync(process.execPath, [join(ROOT, 'tests', 'starburst.test.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } }); }
    catch (e) { sberrs.push(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 8).join(' | ')); }
    results.push({ label: 'starburst sticker tests (tests/starburst.test.mjs: a spiky star read as a starburst with its point count, a disc as a seal, shape and spikes through the teardown mapping, Reel.md and the flips, the overlay drawing path)', errs: sberrs, warns: [] });
  }
  {
    const star = createRequire(import.meta.url)('./star.cjs');
    results.push({ label: 'star reminder self-test', errs: star.selfTest(), warns: [] });
  }

  const menuCov = coverage();
  results.push({
    label: 'menu covers catalogs',
    errs: menuCov.missing.map(x => 'menu missing ' + x),
    warns: menuCov.extra.map(x => 'menu extra ' + x),
  });
  // docs/effects.md (npm run menu:render) must list every transition, title entrance, caption entrance and caption
  // style, each with its looping preview, and every graphic and effect by name
  {
    const errs = [], doc = join(ROOT, 'docs', 'effects.md');
    if (!existsSync(doc)) errs.push('docs/effects.md is missing; run npm run menu:render');
    else {
      const md = readFileSync(doc, 'utf8'), menu = loadMenu();
      const prev = { transitions: 'transitions', 'title-entrances': 'titles', 'caption-entrances': 'caption-entrances', 'caption-styles': 'caption-styles' };
      for (const s of menu.sections.filter(x => prev[x.id] || x.id === 'graphics' || x.id === 'effects')) {
        for (const it of s.items) {
          if (!md.includes('`' + it.id + '`')) errs.push(`docs/effects.md is missing ${s.id}:${it.id}`);
          if (prev[s.id]) {
            const rel = `menu/${prev[s.id]}/${it.id}.webp`;
            if (!md.includes(rel)) errs.push(`docs/effects.md has no preview for ${s.id}:${it.id}`);
            else if (!existsSync(join(ROOT, 'docs', rel))) errs.push(`preview missing: docs/${rel} (npm run menu:render)`);
          }
        }
      }
      if (md.includes('\u2014')) errs.push('docs/effects.md has an em dash');
    }
    results.push({ label: 'docs/effects.md covers transitions, entrances, caption styles, graphics and effects', errs, warns: [] });
  }
  const htmlPath = join(ROOT, 'showcase', 'index.html');
  if (!existsSync(htmlPath)) {
    results.push({ label: 'showcase/index.html covers catalogs', errs: ['showcase/index.html is missing; run npm run showcase'], warns: [] });
  } else {
    const html = readFileSync(htmlPath, 'utf8');
    const ids = sourceCatalogIds();
    const has = showcaseHas(html, ids);
    const errs = has.missing.map(x => 'showcase missing ' + x);
    // Visual kinds should also have a still under showcase/media so a new effect cannot hide.
    const visual = ['finish', 'effect', 'graphic', 'transition', 'font', 'theme', 'entrance', 'look', 'captionStyle', 'preset', 'titleLayer'];
    for (const kind of visual) {
      for (const id of ids[kind] || []) {
        const token = `data-id="${kind}:${id}"`;
        if (!html.includes(token)) continue;
        const base = join(ROOT, 'showcase', 'media');
        const dirs = {
          finish: 'finish', effect: 'effect', graphic: 'graphic', transition: 'transition', font: 'font',
          theme: 'theme', entrance: 'entrance', look: 'look', captionStyle: 'caption', preset: 'preset',
          titleLayer: 'titleLayer',
        };
        const img = join(base, dirs[kind], id + '.jpg');
        if (!existsSync(img) || !statSync(img).size) errs.push(`showcase still missing ${kind}:${id} (${img})`);
      }
    }
    results.push({ label: 'showcase/index.html covers catalogs', errs, warns: [] });
  }
}
if (!target) {
  // The Studio page is React + Astryx, built from kit/studio/web into kit/studio/public and committed, so installs never build it.
  const errs = [], pub = join(KIT, 'studio', 'public');
  try {
    const { webHash } = await import('./studio/web-hash.mjs');
    const stamp = JSON.parse(readFileSync(join(pub, 'build.json'), 'utf8'));
    if (stamp.source !== webHash()) errs.push('kit/studio/public is older than kit/studio/web; run npm run studio:build and commit kit/studio/public');
    const html = readFileSync(join(pub, 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)) if (!existsSync(join(pub, m[1]))) errs.push('kit/studio/public/index.html points at a missing ' + m[1]);
    if (!/assets\/app\.js/.test(html)) errs.push('kit/studio/public/index.html does not load assets/app.js');
  } catch (e) { errs.push('Studio page build missing: ' + e.message + ' (npm run studio:build)'); }
  results.push({ label: 'Studio page build in kit/studio/public matches kit/studio/web', errs, warns: [] });
}
let bad = 0;
for (const r of results) {
  console.log(`${r.errs.length ? 'FAIL' : 'ok  '} ${r.label}`);
  r.errs.forEach(e => console.log('  error: ' + e)); r.warns.forEach(w => console.log('  note:  ' + w));
  bad += r.errs.length;
}
if (bad && !warnOnly) { console.log(`\n${bad} error(s). Fix the copy or plan, then run again.`); process.exit(1); }
console.log(bad ? `\n${bad} error(s) (warn-only)` : '\nCHECK PASS');
