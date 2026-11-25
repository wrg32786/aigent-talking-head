// Every animated preview in the menu shows its change: each effect, graphic, finish and title layer has a looping webp
// in docs/menu, it is small, and played against the plain presenter plate some colour visibly moves (kit/demos.mjs
// --check: Chrome decodes the frames, ffmpeg cannot read animated webp). The sound tiles have a waveform for every bed
// and sound. Without Chrome the decode is skipped with a note; the files, sizes and waveforms are still checked.
// Run: node tests/demos-visible.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as D from '../kit/demos.mjs';
import { findChrome } from '../kit/chrome.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const say = (k, ids) => `${k}: ${ids.join(', ')}`;
const all = D.items(), missing = all.filter(({ kind, it }) => !existsSync(D.demoPath(kind, it.id)));
assert.ok(!missing.length, say('These options have no moving preview yet (make them with Make missing previews in Settings)', missing.map(x => x.it.id)));
console.log(`ok every one of the ${all.length} effects, graphics, finishes and title layers has a moving preview`);

const big = all.filter(({ kind, it }) => statSync(D.demoPath(kind, it.id)).size > 128e3), total = all.reduce((n, { kind, it }) => n + statSync(D.demoPath(kind, it.id)).size, 0) + statSync(D.PLATE).size;
assert.ok(!big.length, say('These previews are over 128 KB', big.map(x => x.it.id)));
assert.ok(total < 8e6, `the previews add up to ${(total / 1e6).toFixed(1)} MB; keep them under 8 MB`);
console.log(`ok each preview is under 128 KB, ${(total / 1e6).toFixed(1)} MB in all`);

const snd = JSON.parse(readFileSync(D.SOUNDS, 'utf8')), beds = Object.keys(JSON.parse(readFileSync(join(ROOT, 'kit', 'music', 'beds.json'), 'utf8'))), sfx = JSON.parse(readFileSync(join(ROOT, 'kit', 'sfx', 'sfx.json'), 'utf8')).sounds.map(x => x.id);
const noWave = [...beds.filter(id => !(snd.beds[id] || []).length), ...sfx.filter(id => !(snd.sfx[id] || []).length)];
assert.ok(!noWave.length, say('These sounds have no waveform (node kit/demos.mjs --sounds)', noWave));
console.log(`ok every music bed and sound has a waveform`);

let chrome = null; try { chrome = findChrome(); } catch {}
if (!chrome) console.log('skip the visible-change decode: Chrome is not on this computer');
else {
  const rows = await D.check(all), flat = rows.filter(r => r.score < D.THRESHOLD);
  assert.ok(!flat.length, say('These previews do not show a visible change against the plain picture', flat.map(r => `${r.id} (${r.score}%)`)));
  console.log(`ok all ${rows.length} previews visibly change the picture (at least ${D.THRESHOLD}% of it)`);
}
console.log('\ndemos visible tests passed');
