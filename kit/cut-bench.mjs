// Cut accuracy bench: every path that cuts a take, run on one real take, measured on the audio.
//   node kit/cut-bench.mjs <video> --words <transcript.json> [--out <dir>] [--python <python>] [--no-clip]
// transcript.json: a Studio transcript (kit/studio/tx_chunks.py, { words }) or [[start, end, word]]. Make one with
//   python3 kit/studio/tx_chunks.py <video> <transcript.json>
// The paths: 1 clip.py (the draft's clips), 2 the Cut step's candidates, 3 Lines, 4 the clean take, 5 bites, 6 what a
// bite render extracts (no second cut), 7 the draft with tighten. Each writes its ranges to <out>/cuts.json, then
// tests/cut-accuracy/measure.py (numpy and scipy, independent of kit/cutpoints.cjs) reports per path: edges inside a
// sounding word, lead-ins under 60 ms, tails under 120 ms. Exit 1 when any path fails.
import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import CP from './cutpoints.cjs';
import * as CUT from './studio/cut.mjs';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; }, flag = k => argv.includes('--' + k);
const src = argv[0] && !argv[0].startsWith('--') ? resolve(argv[0]) : null;
if (!src || !opt('words')) { console.error('use: node kit/cut-bench.mjs <video> --words <transcript.json> [--out dir]'); process.exit(2); }
const out = resolve(opt('out', join(dirname(src), 'cut-bench'))); mkdirSync(out, { recursive: true });
const tx = JSON.parse(readFileSync(resolve(opt('words')), 'utf8')), words = Array.isArray(tx) ? tx : tx.words;
const PY = opt('python', process.env.PYTHON || (existsSync('/workspace/.venv-th/bin/python') ? '/workspace/.venv-th/bin/python' : 'python3'));
const env = CP.envelopeSync(src); if (!env) { console.error('could not read the audio of ' + src); process.exit(1); }
const dur = env.seconds, cuts = [], add = (path, label, ranges) => ranges.forEach(([a, b], k) => cuts.push({ path, label: `${label}#${k}`, a, b }));

// 1 clip.py: the draft's clips, planned only (no encode), from the same transcript
let clips = [];
if (!flag('no-clip')) {
  const wf = join(out, 'words.json'), cdir = join(out, 'clips');
  writeFileSync(wf, JSON.stringify({ [basename(src)]: words }));
  const r = spawnSync(PY, [join(KIT, 'clip.py'), src, '--words', wf, '--out', cdir, '--plan-only'], { encoding: 'utf8' });
  if (r.status) { console.error(r.stdout + r.stderr); process.exit(1); }
  clips = JSON.parse(readFileSync(join(cdir, 'clips.json'), 'utf8')).clips;
  add('1 clip.py (draft clips)', 'clips', clips.map(c => [c.src_in, c.src_out]));
}
// 2 the Cut step: candidates for this take's default output and for a full edit plus clips, snapped
for (const o of [CUT.defaultsFor(dur), { ...CUT.defaultOutput(), kind: 'both', format: 'short', length: 'long' }])
  for (const c of CUT.candidates(words, o, { duration: dur })) add('2 Cut step (snapped)', c.id, CUT.snapCandidate(c, words, env, dur).ranges);
// 3 Lines, 4 the clean take, 5 bites (runs of three kept lines, and pairs out of order), 6 the bite render's extract
const L = CUT.lines(words, env, dur), keep = CUT.cleanTake(L, {});
add('3 Lines', 'line', L.map(l => [l.start, l.end]));
add('4 One clean take', 'take', CUT.biteRanges(keep, L));
const bites = []; for (let k = 0; k + 2 < keep.length; k += 3) bites.push(keep.slice(k, k + 3));
for (let k = 0; k + 4 < keep.length; k += 5) bites.push([keep[k + 4], keep[k]]);
bites.forEach((b, k) => add('5 Bites (ranges)', 'b' + (k + 1), CUT.biteRanges(b, L)));
// a bite render extracts exactly the bite's ranges and hands the file to kit/reel.cjs as already cut (--as-is and a
// clips.json beside it), so there is no second cut: the extract ranges are the edges
bites.forEach((b, k) => add('6 Bite render (extract, no re-cut)', 'b' + (k + 1), CUT.renderRanges({ ranges: CUT.biteRanges(b, L) })));
// 7 the draft with tighten 0.3: each keep clip's spans after pauses become jumps (kit/reel.cjs, same function)
for (const c of clips.filter(c => !/^(retake|fragment)/.test(c.status))) add('7 Draft tighten (spans)', c.id, CP.tightenSpans(words, env, 0.3, { range: [c.src_in, c.src_out], dur }).spans);

writeFileSync(join(out, 'cuts.json'), JSON.stringify(cuts, null, 1));
console.log(`${cuts.length} ranges from ${new Set(cuts.map(c => c.path)).size} paths -> ${join(out, 'cuts.json')}`);
// edges the module marked: moved to the next pause so no word is cut (extended), or no pause in reach (unsure)
const pts = CUT.sentences(words).map(x => CP.snapRange([x.start, x.end], words, env, dur).points).flat();
console.log(`Lines edges: ${pts.filter(p => p.extended).length} extended to the next pause, ${pts.filter(p => p.tight).length} ends close to the next word (short pause), ${pts.filter(p => p.sure === false).length} unsure (no pause in reach)`);
const m = spawnSync(PY, [join(ROOT, 'tests', 'cut-accuracy', 'measure.py'), src, resolve(opt('words')), join(out, 'cuts.json'), join(out, 'report.json')], { stdio: 'inherit' });
process.exit(m.status == null ? 1 : m.status);
