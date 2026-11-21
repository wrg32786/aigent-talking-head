// Puts Studio's b-roll lane into a drafted job before the rebuild:
//   node kit/studio/broll-run.mjs apply --name <job> --plan <broll.json>
// broll.json is { inserts: [{ file (absolute), at, dur, in, place, image, beat, clip, studio: true }], credits: "..." }.
// Inserts Studio wrote before (studio: true) are replaced; inserts from a recipe or --broll stay. Missing files are
// skipped with a note. credits.txt lands next to the reel, or goes when the lane is empty.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
if (a[0] !== 'apply' || !opt('name') || !opt('plan')) { console.error('usage: broll-run.mjs apply --name <job> --plan <broll.json>'); process.exit(2); }
const job = join(ROOT, 'jobs', opt('name')), build = join(job, 'build'), cutF = join(build, 'cut.json');
if (!existsSync(cutF)) { console.error('make a draft first: no build/cut.json'); process.exit(1); }
const planF = isAbsolute(opt('plan')) ? opt('plan') : resolve(ROOT, opt('plan'));
const plan = JSON.parse(readFileSync(planF, 'utf8')), cut = JSON.parse(readFileSync(cutF, 'utf8'));
// B-roll slots (kit/broll-slots.cjs): the plan's slots and any clip placed as a panel are drawn as screen cards in the
// overlay (captions.js), not as cut.json inserts. A slot with a clip plays it with the reference's treatment; a slot
// you skipped, or one still waiting for a clip, leaves you on screen (a final reel never ships a "B-roll here" card).
// plan.json "broll" keeps every slot with its state: filled, skipped or needs.
const require = createRequire(import.meta.url);
const BS = require('../broll-slots.cjs'), R = require('../rules.cjs');
const capF = join(build, 'captions.js'), planJ = join(build, 'plan.json');
let caps = null; try { caps = R.readCaptions(capF); } catch {}
let rplan = null; try { rplan = JSON.parse(readFileSync(planJ, 'utf8')); } catch {}
const slots = (rplan && Array.isArray(rplan.broll) ? rplan.broll : []), skipped = new Set((plan.skipped || []).map(Number)), cards = [], state = {};
const keep = (cut.inserts || []).filter(x => !x.studio && x.slot == null), add = [];
for (const x of plan.inserts || []) {
  if (!x.file || !existsSync(x.file)) { console.log(`b-roll: beat ${x.beat}: no file ${x.file}, skipped`); continue; }
  const sl = x.slot != null ? slots.find(q => q.n === +x.slot) : null;
  if (sl) state[sl.n] = { state: 'filled', file: x.file, clip: x.clip };
  if (x.place === 'card') {
    if (!caps) { console.log(`b-roll: beat ${x.beat}: no captions.js to draw the panel in, skipped`); continue; }
    const f = BS.flipOf({ ...(sl || { n: 100 + (+x.beat || 0), kind: 'panel', fx: BS.fxOf({ in: 'pop', out: 'fade' }) }), ...(x.border ? { border: x.border } : {}), start: +x.at, end: +(+x.at + +x.dur).toFixed(3), file: x.file, in: x.image ? 0 : +x.in || 0 });
    // behind the head needs the title layer and the person mask of the draft; without them the panel goes in front
    if (f.layer === 'behind' && !(cut.titles && cut.mask)) f.layer = 'front';
    cards.push(f); continue;
  }
  add.push({ ...x, file: relative(build, x.file).split(sep).join('/'), studio: true });
}
if (caps) {
  const before = (caps.flips || []).length;
  const own = new Set(slots.filter(x => x.by === 'recipe' && x.file && !state[x.n]).map(x => x.n)); // a slot the recipe filled keeps its card
  caps.flips = [...(caps.flips || []).filter(f => f.slot == null || own.has(f.slot)), ...cards].sort((p, q) => p.start - q.start);
  if (cards.length || before !== caps.flips.length) writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
}
if (rplan && slots.length) {
  for (const sl of slots) { const st = state[sl.n]; if (!st && sl.by === 'recipe' && sl.file) continue; delete sl.file; delete sl.clip; delete sl.by; Object.assign(sl, st || { state: skipped.has(sl.n) ? 'skipped' : 'needs' }); }
  writeFileSync(planJ, JSON.stringify(rplan, null, 1) + '\n');
  const needs = slots.filter(x => x.state === 'needs');
  if (needs.length) console.log(`b-roll: ${needs.length} slot${needs.length === 1 ? '' : 's'} still need${needs.length === 1 ? 's' : ''} a clip (${needs.map(x => '#' + x.n + ' ' + BS.brief(x).what).join('; ')}); you stay on screen there`);
}
cut.inserts = [...keep, ...add].sort((p, q) => p.at - q.at);
if (!cut.inserts.length) delete cut.inserts;
writeFileSync(cutF, JSON.stringify(cut, null, 1));
const cr = join(job, 'credits.txt');
if ((add.length || cards.length) && plan.credits) writeFileSync(cr, plan.credits); else rmSync(cr, { force: true });
console.log(JSON.stringify({ ok: true, inserts: add.length, panels: cards.length, kept: keep.length, credits: add.length ? relative(ROOT, cr).split(sep).join('/') : null }));
