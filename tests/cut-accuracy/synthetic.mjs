// The cut-accuracy acceptance on synthetic speech, end to end, in CI (no real footage in the repo): a 40 s take of
// words with s tails, breaths, 70 ms stops inside words, run-on lines and pauses (tests/fixtures/speech.cjs), with
// word times jittered like Whisper's. Every path that cuts (Cut candidates, Lines, the clean take, bites, tighten)
// runs through kit/cutpoints.cjs, then tests/cut-accuracy/measure.py (numpy and scipy, its own implementation)
// measures the edges. Run: node tests/cut-accuracy/synthetic.mjs   (npm run smoke runs it; needs ffmpeg and Python)
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import CP from '../../kit/cutpoints.cjs';
import SP from '../fixtures/speech.cjs';
import * as CUT from '../../kit/studio/cut.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), dir = mkdtempSync(join(tmpdir(), 'cut-acc-'));
const voiced = [], hiss = [], breath = [], words = []; let x = 0.8, seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (let s = 0; x < 38; s++) {
  if (s % 3 === 2) breath.push([x - 0.24, x - 0.1]); // a breath just before some lines
  const nw = 4 + Math.floor(rnd() * 5);
  for (let k = 0; k < nw; k++) {
    const d = 0.22 + 0.25 * rnd(); let end = x + d;
    if (k === 2 && s % 4 === 1) { voiced.push([x, x + d * 0.5], [x + d * 0.5 + 0.07, end + 0.07]); end += 0.07; } // a stop inside the word
    else voiced.push([x, end]);
    if ((k === nw - 1 && s % 2 === 0) || rnd() < 0.15) { hiss.push([end, end + 0.12 + 0.08 * rnd()]); end = hiss[hiss.length - 1][1]; }
    words.push([+(x + (rnd() - 0.5) * 0.1).toFixed(2), +(end + (rnd() - 0.6) * 0.2).toFixed(2), `w${s}.${k}${k === nw - 1 ? '.' : ''}`]);
    x = end + (rnd() < 0.25 ? 0.2 + 0.15 * rnd() : 0.03 + 0.07 * rnd()); // most words run together, some have a pause
  }
  x += s % 5 === 3 ? 0.12 : 0.45 + 0.8 * rnd(); // now and then a run-on line with no real pause
}
const secs = x + 1, samples = SP.speech(secs, { voiced, hiss, breath });
// a 16-bit wav of the take
const n = samples.length, buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SP.SR, 24); buf.writeUInt32LE(SP.SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
const wav = join(dir, 'take.wav'); writeFileSync(wav, buf);
const env = CP.envelopeSync(wav), dur = env.seconds, cuts = [], add = (path, label, R) => R.forEach(([a, b], k) => cuts.push({ path, label: `${label}#${k}`, a, b }));
for (const c of CUT.candidates(words, { ...CUT.defaultOutput(), kind: 'both', length: 'short' }, { duration: dur })) add('Cut step', c.id, CUT.snapCandidate(c, words, env, dur).ranges);
const L = CUT.lines(words, env, dur), keep = CUT.cleanTake(L, {});
add('Lines', 'line', L.map(l => [l.start, l.end])); add('Clean take', 'take', CUT.biteRanges(keep, L));
for (let k = 0; k + 1 < keep.length; k += 2) add('Bites', 'b' + k, CUT.renderRanges({ ranges: CUT.biteRanges([keep[k + 1], keep[k]], L) }));
for (const l of L) add('Tighten', l.id, CP.tightenSpans(words, env, 0.3, { range: [l.start, l.end], dur }).spans);
writeFileSync(join(dir, 'words.json'), JSON.stringify(words)); writeFileSync(join(dir, 'cuts.json'), JSON.stringify(cuts));
console.log(`${words.length} words, ${L.length} lines, ${cuts.length} ranges on ${secs.toFixed(1)} s of synthetic speech`);
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const r = spawnSync(PY, [join(HERE, 'measure.py'), wav, join(dir, 'words.json'), join(dir, 'cuts.json')], { stdio: 'inherit' });
if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true }); else console.log(dir);
process.exit(r.status == null ? 1 : r.status);
