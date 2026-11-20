// Puts Studio's b-roll lane into a drafted job before the rebuild:
//   node kit/studio/broll-run.mjs apply --name <job> --plan <broll.json>
// broll.json is { inserts: [{ file (absolute), at, dur, in, place, image, beat, clip, studio: true }], credits: "..." }.
// Inserts Studio wrote before (studio: true) are replaced; inserts from a recipe or --broll stay. Missing files are
// skipped with a note. credits.txt lands next to the reel, or goes when the lane is empty.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
if (a[0] !== 'apply' || !opt('name') || !opt('plan')) { console.error('usage: broll-run.mjs apply --name <job> --plan <broll.json>'); process.exit(2); }
const job = join(ROOT, 'jobs', opt('name')), build = join(job, 'build'), cutF = join(build, 'cut.json');
if (!existsSync(cutF)) { console.error('make a draft first: no build/cut.json'); process.exit(1); }
const planF = isAbsolute(opt('plan')) ? opt('plan') : resolve(ROOT, opt('plan'));
const plan = JSON.parse(readFileSync(planF, 'utf8')), cut = JSON.parse(readFileSync(cutF, 'utf8'));
const keep = (cut.inserts || []).filter(x => !x.studio), add = [];
for (const x of plan.inserts || []) {
  if (!x.file || !existsSync(x.file)) { console.log(`b-roll: beat ${x.beat}: no file ${x.file}, skipped`); continue; }
  add.push({ ...x, file: relative(build, x.file).split(sep).join('/'), studio: true });
}
cut.inserts = [...keep, ...add].sort((p, q) => p.at - q.at);
if (!cut.inserts.length) delete cut.inserts;
writeFileSync(cutF, JSON.stringify(cut, null, 1));
const cr = join(job, 'credits.txt');
if (add.length && plan.credits) writeFileSync(cr, plan.credits); else rmSync(cr, { force: true });
console.log(JSON.stringify({ ok: true, inserts: add.length, kept: keep.length, credits: add.length ? relative(ROOT, cr).split(sep).join('/') : null }));
