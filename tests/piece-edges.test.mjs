// The two ends of a piece (Studio report 4, item 12: "end part starts with me looking down and ends on me saying
// like ... it ends on what are you waiting for like").
// - the last piece ends with the sentence that holds the closing line: words said after it are left out, the cut goes
//   in the quiet after the sentence, and no word is cut
// - a piece starts on the first frame the speaker looks at the lens, only inside the quiet before its first word
// - a cut where the take plays on is never moved, and --keep-ends leaves everything alone
// The head pose is read for real (kit/framing.py pose, YuNet) on the shipped demo reel.
// Run: node tests/piece-edges.test.mjs   (needs ffmpeg and Python with OpenCV; part of npm run check)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('skip the piece edge tests (needs ffmpeg)'); process.exit(0); }

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
const PE = require('../kit/piece-edges.cjs'), CP = require('../kit/cutpoints.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'piece-edges-test-'));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const ff = a => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'pipe'] });
// words from "text" with a start each: [start, end, word]
const W = (pairs, len = 0.25) => pairs.map(([s, w, d]) => [s, +(s + (d || len)).toFixed(3), w]);

try {
  // the report's ending: "so what are you waiting for? Like,"
  const CLOSE = W([[1.4, 'So'], [1.7, 'what'], [1.95, 'are'], [2.15, 'you'], [2.35, 'waiting', 0.3], [2.7, 'for?', 0.3], [3.6, 'Like,', 0.3]]);
  t('the words after the closing sentence are found', () => {
    const r = PE.runOn(CLOSE); assert.ok(r); assert.strictEqual(r.last[2], 'for?'); assert.deepStrictEqual(r.tail.map(w => w[2]), ['Like,']);
    assert.strictEqual(PE.runOn(CLOSE.slice(0, 6)), null, 'a piece that ends on its sentence is left alone');
    assert.strictEqual(PE.runOn(W([[0, 'no'], [0.3, 'full'], [0.6, 'stops'], [0.9, 'here']])), null, 'nothing punctuated: we cannot tell, so nothing is cut');
    assert.strictEqual(PE.runOn(W([[0, 'It'], [0.3, 'works.'], [1, 'And'], [1.3, 'then'], [1.6, 'we'], [1.9, 'ship'], [2.2, 'it'], [2.5, 'today']])), null, 'six words after it is a line of its own');
    assert.strictEqual(PE.runOn(W([[0, 'It'], [0.3, 'works.'], [1, 'And'], [4.2, 'so,']])), null, 'a long stretch after it is not a slip of the tongue');
    assert.strictEqual(PE.runOn(W([[0, 'Okay.'], [0.6, 'Like,']])), null, 'one word is not a closing sentence');
    assert.deepStrictEqual(PE.runOn(W([[0, 'Follow'], [0.3, 'for'], [0.6, 'more!'], [1.2, 'Um'], [1.5, 'yeah']])).tail.map(w => w[2]), ['Um', 'yeah']);
    assert.ok(PE.runOn(W([[0, 'He'], [0.3, 'said'], [0.6, '"go."'], [1.2, 'So,']])), 'a full stop inside a quote mark ends a sentence');
    // a word that trails off is not the end of a sentence: "follow for the repo. Uh..." ends on "repo."
    assert.deepStrictEqual(PE.runOn(W([[0, 'Follow'], [0.3, 'for'], [0.6, 'the'], [0.8, 'repo.'], [1.6, 'Uh...']])).tail.map(w => w[2]), ['Uh...']);
    assert.deepStrictEqual(PE.runOn(W([[0, 'That'], [0.3, 'is'], [0.6, 'it!'], [1.4, 'so\u2026']])).tail.length, 1);
    assert.strictEqual(PE.runOn(W([[0, 'Wait'], [0.3, 'for'], [0.6, 'it...']])), null, 'a take that only trails off has no sentence to end on');
  });

  // audio for those words: a tone while a word sounds, quiet between sentences
  const wav = join(TMP, 'close.wav'), DUR = 4.2;
  const tones = CLOSE.map(w => `between(t,${w[0]},${w[1]})`).join('+');
  ff(['-f', 'lavfi', '-i', `aevalsrc='0.0005*random(0)+0.4*sin(2*PI*220*t)*(${tones})':s=32000:d=${DUR}`, wav]);
  const env = CP.envelopeSync(wav);
  t('the last piece ends in the quiet after the sentence, clear of both words', () => {
    assert.ok(CP.isEnv(env), 'the audio was read');
    const seg = { in: 1.2, out: 4.1 }, r = PE.trimEnd(seg, CLOSE, env, DUR);
    assert.ok(r, 'trimmed'); assert.strictEqual(r.left, 'Like,'); assert.ok(/waiting for\?$/.test(r.after));
    assert.ok(r.out >= 3.0 + CP.ACCEPT.tail - 0.011, `at least 120 ms after "for?" stops sounding: ${r.out}`);
    assert.ok(r.out <= 3.6 - CP.ACCEPT.lead + 0.011, `ends before "Like," starts: ${r.out}`);
    assert.strictEqual(r.was, 4.1);
    assert.strictEqual(PE.trimEnd({ in: 1.2, out: 3.3 }, CLOSE, env, DUR), null, 'a piece that already ends there is not touched');
    // with no audio to read, the cut still lands between the two words
    const q = PE.trimEnd(seg, CLOSE, null, DUR); assert.ok(q.out >= 3.0 && q.out < 3.6, 'no envelope: ' + q.out);
    // only the words inside the piece count: a run-on that belongs to a later piece is not ours
    assert.strictEqual(PE.trimEnd({ in: 0, out: 3.2 }, CLOSE, env, DUR), null);
  });

  const base = { pitch: 0.5, yaw: 0.02, h: 0.15, pitchTol: 0.045, yawTol: 0.09 };
  const S = (rows, lo = 0, fps = 12) => rows.map((r, k) => (r === null ? [+(lo + k / fps).toFixed(3), null, null, null] : [+(lo + k / fps).toFixed(3), r, 0.02, 0.15]));
  t('a piece starts on the first frame at the lens, inside the quiet before its first word', () => {
    // 1.3 s of quiet: head down for 0.75 s (9 frames), then at the lens
    const samples = S([0.62, 0.61, 0.6, 0.6, 0.59, 0.6, 0.58, 0.57, 0.56, 0.52, 0.5, 0.5, 0.51, 0.5, 0.49, 0.5]);
    const r = PE.lensStart({ lo: 0, hi: 1.29, samples, base });
    assert.deepStrictEqual([r.in, r.why], [0.75, 'lens']);
    assert.strictEqual(PE.lensStart({ lo: 0, hi: 1.29, samples: S(Array(16).fill(0.5)), base }), null, 'at the lens from the first frame: nothing to do');
    const away = PE.lensStart({ lo: 0, hi: 1.29, samples: S(Array(16).fill(0.61)), base });
    assert.deepStrictEqual([away.in, away.why], [1.29, 'away'], 'never at the lens before the word: start just before the word');
    assert.deepStrictEqual(PE.lensStart({ lo: 0, hi: 1.29, samples: S(Array(16).fill(null)), base }).why, 'away', 'no face counts as looking away');
    assert.strictEqual(PE.lensStart({ lo: 0, hi: 0.15, samples: S([0.6, 0.6]), base }), null, 'too little quiet to move in');
    // a glance at the lens that does not hold to the first word is not the start
    const glance = PE.lensStart({ lo: 0, hi: 1.29, samples: S([0.6, 0.5, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), base });
    assert.strictEqual(glance.in, 0.833);
    assert.ok(!PE.atLens([0, 0.5, 0.3, 0.15], base) && !PE.atLens([0, 0.5, 0.02, 0.3], base) && PE.atLens([0, 0.52, 0.05, 0.16], base), 'turned away or far from the usual distance is not at the lens');
  });

  t('the start never passes the first word, a cut where the take plays on never moves', () => {
    const words = W([[1.4, 'So'], [1.7, 'what'], [2.6, 'now.'], [3.2, 'Then'], [3.5, 'this.']]);
    const mk = () => [{ file: 'a.mp4', in: 0, out: 2.95 }, { file: 'a.mp4', in: 2.95, out: 4 }, { file: 'b.mp4', in: 0.05, out: 4 }];
    const poseFn = (py, file, spans) => spans.map(([a, b, fps]) => { const k = Math.max(1, Math.round((b - a) * fps)); return Array.from({ length: k }, (_, i) => { const tt = a + i / fps; return [+tt.toFixed(3), a < 0.3 && fps === 12 && tt < 0.9 ? 0.62 : 0.5, 0.02, 0.15]; }); });
    const segs = mk(), asked = [];
    const r = PE.lensStarts({ segs, words: () => words, fileOf: i => segs[i].file, python: 'x', poseFn: (py, f, sp) => { asked.push([f, sp.filter(s => s[0] < 0.3).length]); return poseFn(py, f, sp); } });
    assert.deepStrictEqual(asked, [['a.mp4', 1], ['b.mp4', 1]], 'the second piece of a.mp4 plays on from the first: not looked at');
    assert.deepStrictEqual(r.moved.map(m => [m.seg, m.why]), [[0, 'lens'], [2, 'lens']]);
    for (const i of [0, 2]) { assert.ok(segs[i].in > 0.85 && segs[i].in <= 1.4 - PE.LENS.lead + 1e-6, `piece ${i + 1} starts at the lens and before its first word: ${segs[i].in}`); }
    assert.strictEqual(segs[1].in, 2.95); assert.ok(r.lines.every(l => !/\u2014/.test(l)) && /no word touched/.test(r.lines[0]));
    // the sound of the first word starts before the transcript says: the start stays ahead of the sound
    const s2 = mk(); PE.lensStarts({ segs: s2, words: () => words, fileOf: i => s2[i].file, python: 'x', poseFn: (py, f, sp) => sp.map(([a, b, fps]) => Array.from({ length: Math.round((b - a) * fps) }, (_, i) => [+(a + i / fps).toFixed(3), a < 0.3 ? 0.62 : 0.5, 0.02, 0.15])), firstSound: () => 1.2 });
    assert.strictEqual(s2[0].in, +(1.2 - PE.LENS.lead).toFixed(3));
    // a face that cannot be read leaves every start alone
    const s3 = mk(), r3 = PE.lensStarts({ segs: s3, words: () => words, fileOf: i => s3[i].file, python: 'x', poseFn: (py, f, sp) => sp.map(() => null) });
    assert.deepStrictEqual(s3, mk()); assert.strictEqual(r3.moved.length, 0);
  });

  t('for real: a take that opens on an empty frame starts when the face is there (YuNet on the demo reel)', () => {
    const demo = join(ROOT, 'kit', 'example', 'demo-reel', 'demo-reel.mp4'), take = join(TMP, 'take.mp4');
    // 1 s with nobody in the picture, then 5 s of the speaker; the first word at 1.7 s
    ff(['-f', 'lavfi', '-i', 'color=c=0x1d2b2a:s=720x1280:r=24:d=1', '-ss', '2', '-t', '5', '-i', demo, '-filter_complex', '[1:v]fps=24,scale=720:1280,setsar=1[b];[0:v]setsar=1[a];[a][b]concat=n=2:v=1[v]', '-map', '[v]', '-an', '-pix_fmt', 'yuv420p', take]);
    const words = W([[1.7, 'Every'], [2.0, 'effect'], [2.4, 'lands.'], [3.4, 'Watch'], [3.8, 'this.']]), segs = [{ file: take, in: 0, out: 5.8 }];
    const r = PE.lensStarts({ segs, words: () => words, fileOf: () => take, python: PY });
    assert.strictEqual(r.moved.length, 1, 'moved: ' + JSON.stringify(r));
    assert.ok(segs[0].in >= 0.95 && segs[0].in <= 1.7 - PE.LENS.lead + 1e-6, 'starts when the face is there, before the first word: ' + segs[0].in);
    assert.ok(segs[0].in <= 1.2, 'on the first frames with the face, not later: ' + segs[0].in);
    const steady = [{ file: take, in: 1.05, out: 5.8 }]; PE.lensStarts({ segs: steady, words: () => words, fileOf: () => take, python: PY });
    assert.strictEqual(steady[0].in, 1.05, 'a piece that opens on the face is not moved');
  });

  t('a draft does both: starts when the face is there, ends on "for?", and "Like," is in no caption; --keep-ends leaves it', () => {
    const demo = join(ROOT, 'kit', 'example', 'demo-reel', 'demo-reel.mp4'), clips = join(TMP, 'clips'); mkdirSync(clips);
    const words = W([[1.7, 'So'], [1.95, 'what'], [2.2, 'are'], [2.4, 'you'], [2.6, 'waiting', 0.3], [2.95, 'for?', 0.3], [3.9, 'Like,', 0.3]]);
    const sound = words.map(w => `between(t,${w[0]},${w[1]})`).join('+');
    ff(['-f', 'lavfi', '-i', 'color=c=0x1d2b2a:s=720x1280:r=24:d=1', '-ss', '2', '-t', '3.5', '-i', demo, '-f', 'lavfi', '-i', `aevalsrc='0.0005*random(0)+0.4*sin(2*PI*220*t)*(${sound})':s=48000:d=4.5`,
      '-filter_complex', '[1:v]fps=24,scale=720:1280,setsar=1[b];[0:v]setsar=1[a];[a][b]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a', '-t', '4.5', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(clips, 'clip-001.mp4')]);
    writeFileSync(join(clips, 'clips.json'), JSON.stringify({ src: 'synthetic', clips: [{ id: 'clip-001', file: 'clips/clip-001.mp4', dur: 4.5, status: 'keep', text: words.map(w => w[2]).join(' '), words }] }));
    const reel = (name, ...a) => { const out = execFileSync(process.execPath, [join(ROOT, 'kit', 'reel.cjs'), '--clips', clips, '--jobs', join(TMP, 'jobs'), '--name', name, '--no-mask', '--draft', '--force', '--no-titles', ...a], { cwd: TMP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHON: PY } });
      const build = join(TMP, 'jobs', name, 'build'); return { out, cut: JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')), caps: readFileSync(join(build, 'captions.js'), 'utf8') }; };
    const a = reel('ends'), sg = a.cut.segs[0];
    assert.ok(sg.in >= 0.95 && sg.in <= 1.7 - PE.LENS.lead + 0.02, 'starts when the face is there, before "So": ' + sg.in);
    assert.ok(sg.out >= 3.25 + 0.1 && sg.out <= 3.9 - 0.05, 'ends after "for?" and before "Like,": ' + sg.out);
    assert.ok(/ending: the last piece ends after ".*waiting for\?"/.test(a.out) && /start on the lens: piece 1 starts/.test(a.out), a.out.slice(0, 600));
    assert.ok(!/like/i.test(a.caps) && /waiting/i.test(a.caps) && /for/i.test(a.caps), 'no caption says Like; the closing words are all there');
    assert.strictEqual(a.cut.edges.end.left, 'Like,'); assert.strictEqual(a.cut.edges.starts[0].why, 'lens');
    const b = reel('kept', '--keep-ends');
    assert.deepStrictEqual([b.cut.segs[0].in, b.cut.segs[0].out], [0, 4.5]); assert.ok(!b.cut.edges && /like/i.test(b.caps));
  });

  console.log(`\npiece-edges: ${n} tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
