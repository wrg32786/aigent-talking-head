// kit/cutpoints.cjs: the one cut-point module, on synthetic speech (tests/fixtures/speech.cjs), no ffmpeg needed.
// Every cut: never inside a sounding word, at least 60 ms of quiet before the first sound, at least 120 ms after the
// last sound (an s tail counts as sound), never snapped early, never on a 70 ms stop inside a word; tighten keeps the
// same margins. Run: node tests/cut-points.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert');
const CP = require('../kit/cutpoints.cjs');
const { speech } = require('./fixtures/speech.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const envOf = (secs, parts) => CP.envelopeFromSamples(speech(secs, parts));
// every edge of a range checked the way tests/cut-accuracy/measure.py does
function clean(env, words, [a, b], why) {
  const s = CP.edgeReport(env, words, a, 'start'), e = CP.edgeReport(env, words, b, 'end');
  assert.ok(!s.midWord && !e.midWord, `${why}: mid-word ${JSON.stringify({ a, b, s, e })}`);
  assert.ok(s.pad >= CP.ACCEPT.lead, `${why}: lead-in ${s.pad} s at ${a}`);
  assert.ok(e.pad >= CP.ACCEPT.tail, `${why}: tail ${e.pad} s at ${b}`);
}

t('envelope: 5 ms frames, a quiet s tail is sound in the high band only', () => {
  const env = envOf(3, { voiced: [[0.5, 1.0]], hiss: [[1.0, 1.3]] }), A = CP.activity(env);
  assert.ok(Math.abs(env.hop - 0.005) < 1e-9 && env.e.length > 580);
  assert.ok(A.act[A.i(0.75)] && A.act[A.i(1.15)], 'voice and hiss both sound');
  assert.ok(!A.act[A.i(2.0)], 'room tone is quiet');
  const i = A.i(1.15); assert.ok(env.h[i] - env.h[A.i(2.0)] > 12, 'the hiss is loud in the high band');
  const j = CP.fromJSON(JSON.parse(JSON.stringify(CP.toJSON(env)))); assert.ok(CP.isEnv(j) && j.e.length === env.e.length);
});

t('end: a fricative tail is kept (at least 120 ms after the s), the transcript ending early does not cut it', () => {
  // "this" said 1.0-1.5 (voiced 1.0-1.38, then a soft s to 1.62); Whisper says it ends at 1.40
  const env = envOf(4, { voiced: [[1.0, 1.38], [2.6, 3.0]], hiss: [[1.38, 1.62]] });
  const words = [[1.0, 1.40, 'this'], [2.6, 3.0, 'next']];
  const r = CP.snapRange([0.9, 1.4], words, env, 4);
  assert.ok(r.range[1] >= 1.62 + 0.12, 'kept the s: ' + r.range[1]);
  assert.ok(r.range[1] <= 2.6 - 0.06, 'not into the next word');
  clean(env, words, r.range, 'fricative');
});

t('end: a 70 ms stop inside a word is not the end, and the search never starts 0.25 s early', () => {
  // "stopping" 1.0-1.8 with a 70 ms closure at 1.40-1.47 (Whisper ends it at 1.45, inside the closure)
  const env = envOf(4, { voiced: [[1.0, 1.4], [1.47, 1.8], [3.0, 3.4]] });
  const words = [[1.0, 1.45, 'stop'], [1.45, 1.8, 'ping'], [3.0, 3.4, 'next']];
  const r = CP.snapRange([0.9, 1.45], words, env, 4);
  assert.ok(r.range[1] >= 1.8 + 0.12, 'ran to the real end of the word: ' + r.range[1]);
  clean(env, words, r.range, 'closure');
  // Whisper ends a word 0.3 s late, after the voice stopped: the cut follows the audio but stays at the word's end
  const env2 = envOf(4, { voiced: [[1.0, 1.5], [3.0, 3.4]] });
  const r2 = CP.snapRange([0.9, 1.8], [[1.0, 1.8, 'late'], [3.0, 3.4, 'next']], env2, 4);
  assert.ok(r2.range[1] >= 1.8 - 0.08 && r2.range[1] <= 1.8 + 0.2, 'not 0.25 s early, not far past: ' + r2.range[1]);
});

t('start: at least 60 ms of quiet before the first sound, also when the transcript starts late or early', () => {
  const env = envOf(4, { voiced: [[0.5, 0.9], [1.6, 2.2]], breath: [[1.25, 1.45]] });
  const late = CP.snapRange([1.7, 2.2], [[0.5, 0.9, 'one'], [1.75, 2.2, 'late']], env, 4);   // voice starts 1.60
  assert.ok(late.range[0] <= 1.6 - 0.06 && late.range[0] >= 1.45, 'started before the voice, after the breath: ' + late.range[0]);
  const early = CP.snapRange([1.3, 2.2], [[0.5, 0.9, 'one'], [1.35, 2.2, 'early']], env, 4); // Whisper put it on the breath
  clean(env, [[0.5, 0.9, 'one'], [1.35, 2.2, 'early']], early.range, 'early start');
  clean(env, [[0.5, 0.9, 'one'], [1.75, 2.2, 'late']], late.range, 'late start');
});

t('no pause to cut in: the cut moves to the next pause (extended), never mid-word', () => {
  // three words with 40 ms between them, then a real pause
  const env = envOf(4, { voiced: [[0.5, 0.9], [0.94, 1.3], [1.34, 1.7], [2.4, 2.8]] });
  const words = [[0.5, 0.9, 'run'], [0.94, 1.3, 'on'], [1.34, 1.7, 'words'], [2.4, 2.8, 'pause']];
  const r = CP.snapRange([0.45, 0.92], words, env, 4), e = r.points.find(p => p.edge === 'end');
  assert.ok(e.extended && r.range[1] >= 1.7 + 0.12 && r.range[1] <= 2.4 - 0.06, JSON.stringify(e));
  clean(env, words, r.range, 'extended');
  const s = CP.snapRange([1.34, 1.7], words, env, 4);
  assert.ok(s.points[0].extended && s.range[0] <= 0.5 - 0.06, 'a start with no pause before moves back: ' + JSON.stringify(s.points[0]));
});

t('tighten: a long pause becomes a jump with 120 ms of breath kept, a short one stays', () => {
  const env = envOf(6, { voiced: [[0.5, 1.0], [2.5, 3.0], [3.35, 3.8]], hiss: [[1.0, 1.15]] });
  const words = [[0.5, 1.0, 'yes'], [2.5, 3.0, 'and'], [3.35, 3.8, 'then']];
  const r = CP.tightenSpans(words, env, 0.3, { range: [0.38, 3.98], dur: 6 });
  assert.strictEqual(r.cuts.length, 1, JSON.stringify(r));
  const [x] = r.cuts; assert.ok(x.at >= 1.15 + 0.12 && x.resume <= 2.5 - 0.06 && x.resume - x.at >= 0.2, JSON.stringify(x));
  assert.deepStrictEqual(r.spans.map(s => s.length), [2, 2]);
  for (const s of r.spans) clean(env, words, s, 'tighten span');
  assert.strictEqual(CP.tightenSpans(words, env, 0.3, { range: [0.38, 3.98], keep: () => true }).cuts.length, 0, 'keep leaves it');
});

t('ranges: touching ranges join; a transcript with no envelope is left alone', () => {
  assert.deepStrictEqual(CP.mergeRanges([[1, 2], [2, 3], [4, 5]]), [[1, 3], [4, 5]]);
  assert.deepStrictEqual(CP.snapRanges([[1, 2]], [[1, 2, 'x']], null, 5), { ranges: [[1, 2]], cuts: null });
  assert.deepStrictEqual(CP.snapRange([1, 2], [[1, 2, 'x']], { hop: 0.01, rms: [] }, 5).range, [1, 2], 'an old envelope is ignored');
});

t('a long take: every cut of every sentence passes the acceptance margins', () => {
  // 40 words in 8 sentences, words 0.25 to 0.45 s, 60 ms between words, 0.25 to 0.9 s between sentences, s tails on
  // some, breaths before some; Whisper times jittered by up to 80 ms
  const voiced = [], hiss = [], breath = [], words = []; let x = 0.6, seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let s = 0; s < 8; s++) {
    if (s % 3 === 1) { breath.push([x - 0.25, x - 0.1]); }
    for (let k = 0; k < 5; k++) {
      const d = 0.25 + 0.2 * rnd(); voiced.push([x, x + d]); let end = x + d;
      if (k === 4 && s % 2 === 0) { hiss.push([end, end + 0.15]); end += 0.15; }
      words.push([+(x + (rnd() - 0.5) * 0.08).toFixed(3), +(end + (rnd() - 0.5) * 0.16).toFixed(3), `w${s}.${k}${k === 4 ? '.' : ''}`]);
      x = end + 0.06;
    }
    x += 0.25 + 0.65 * rnd();
  }
  const env = envOf(x + 1, { voiced, hiss, breath });
  for (let s = 0; s < 8; s++) {
    const W = words.slice(s * 5, s * 5 + 5), r = CP.snapRange([W[0][0], W[4][1]], words, env, x + 1);
    clean(env, words, r.range, 'sentence ' + s);
  }
});

// session report 2 (Will's from-the-heart take): Whisper stretched a word across each long pause, so a pause cutter
// that trusts word gaps saw none. These rebuild the three spots and the clipped "AI." from the measured times.
const spansClean = (env, words, r, why) => r.spans.forEach((s, k) => clean(env, words, s, `${why} span ${k}`));
t('report 2 B: "30" starts while "From" still sounds, real sound 1.58 s later; tighten finds the pause on the audio', () => {
  // "From" sounds 0.5-1.16, Whisper puts "30" at 1.0-3.14, its sound starts 2.74 (26.28-28.42 / 28.02 in the take)
  const env = envOf(6, { voiced: [[0.5, 1.16], [2.74, 3.14], [3.2, 3.9]] });
  const words = [[0.5, 1.0, 'From'], [1.0, 3.14, '30'], [3.2, 3.9, 'websites']];
  const r = CP.tightenSpans(words, env, 0.2, { range: [0.4, 4.1], dur: 6 });
  assert.strictEqual(r.cuts.length, 1, JSON.stringify(r));
  const kept = r.spans.reduce((x, [a, b]) => x + b - a, 0); assert.ok(4.1 - 0.4 - kept > 1.2, 'over 1.2 s of the 1.58 s pause is gone: ' + JSON.stringify(r));
  spansClean(env, [[0.5, 1.16, 'From'], [2.74, 3.14, '30'], [3.2, 3.9, 'websites']], r, '"30"');
  assert.deepStrictEqual(CP.retime([words[1]], env)[0].slice(0, 1).map(x => Math.round(x * 10) / 10), [2.7], '"30" retimed to its sound');
});
t('report 2 B: "show" stretched over 1.59 s of silence, and a 1.3 s word with a late onset (under the old 1.5 s rule)', () => {
  let env = envOf(6, { voiced: [[0.5, 1.2], [2.79, 3.1], [3.15, 3.8]] });
  let r = CP.tightenSpans([[0.5, 1.2, 'helping'], [1.22, 3.02, 'show'], [3.05, 3.8, 'them']], env, 0.2, { range: [0.4, 4.0], dur: 6 });
  assert.strictEqual(r.cuts.length, 1); assert.ok(r.cuts[0].resume - r.cuts[0].at > 1.2, JSON.stringify(r));
  spansClean(env, [[0.5, 1.2, 'helping'], [2.79, 3.1, 'show'], [3.15, 3.8, 'them']], r, '"show"');
  env = envOf(6, { voiced: [[0.5, 1.1], [2.0, 2.4], [2.45, 2.9]] });
  r = CP.tightenSpans([[0.5, 1.1, 'you.'], [1.12, 2.42, 'So'], [2.45, 2.9, 'join']], env, 0.2, { range: [0.4, 3.1], dur: 6 });
  assert.strictEqual(r.cuts.length, 1); assert.ok(r.cuts[0].resume - r.cuts[0].at >= 0.55, JSON.stringify(r));
  spansClean(env, [[0.5, 1.1, 'you.'], [2.0, 2.4, 'So'], [2.45, 2.9, 'join']], r, 'late onset');
});
t('report 2 B + D: "help you." [noise] "So join": the pause and the 0.25 s noise inside it go together', () => {
  // quiet 1.1-1.48, a 0.25 s noise 1.48-1.73 (818.98-819.23), quiet to 2.5 (820.11), Whisper "So" 1.72-3.1
  const env = envOf(6, { voiced: [[0.5, 1.1], [2.5, 2.9], [2.95, 3.4]], breath: [[1.48, 1.73]] });
  const words = [[0.5, 1.1, 'you.'], [1.72, 3.1, 'So'], [3.1, 3.4, 'join']];
  const r = CP.tightenSpans(words, env, 0.2, { range: [0.4, 3.6], dur: 6 });
  assert.strictEqual(r.cuts.length, 1, JSON.stringify(r));
  const [c] = r.cuts; assert.ok(c.at < 1.45 && c.resume > 1.75 && c.noise && c.noise.length === 1, 'the noise is inside the cut: ' + JSON.stringify(c));
  spansClean(env, [[0.5, 1.1, 'you.'], [2.5, 2.9, 'So'], [2.95, 3.4, 'join']], r, 'noise');
  const nz = CP.noisesIn(words, env, [0.4, 3.6]); assert.strictEqual(nz.length, 1); assert.ok(Math.abs(nz[0].from - 1.48) < 0.04 && Math.abs(nz[0].to - 1.73) < 0.04, JSON.stringify(nz));
  assert.ok(!CP.tightenSpans(words, env, 0.2, { range: [0.4, 3.6], dur: 6 }, { noises: false }).cuts.some(x => x.noise), 'noises: false leaves it');
});
t('report 2: a short word alone in a pause ("a") is a word, not a noise', () => {
  const env = envOf(6, { voiced: [[0.5, 1.1], [1.5, 1.7], [2.2, 2.8]] });
  const words = [[0.5, 1.1, 'and'], [1.48, 1.72, 'a'], [2.2, 2.8, 'thing']];
  assert.strictEqual(CP.noisesIn(words, env, [0.4, 3]).length, 0);
  const r = CP.tightenSpans(words, env, 0.2, { range: [0.4, 3], dur: 6 }); spansClean(env, words, r, '"a"');
  assert.ok(r.spans.some(([a, b]) => a < 1.5 && b > 1.7), 'the word stays: ' + JSON.stringify(r));
});
t('report 2 C: "AI." runs 0.39 s past Whisper, the next line starts 0.76 s after Whisper says; the end waits for the sound', () => {
  // Whisper: "AI." ends 1.58 (148.58), next line 1.80 (148.80); sound runs to 1.97 (148.97), next sound 2.56 (149.56)
  const env = envOf(5, { voiced: [[1.0, 1.97], [2.56, 3.2]] });
  const words = [[1.0, 1.58, 'AI.'], [1.80, 3.2, 'So']];
  const r = CP.snapRange([0.9, 1.58], words, env, 5), e = r.points.find(p => p.edge === 'end');
  assert.ok(r.range[1] >= 1.97 + 0.12 && r.range[1] <= 2.56 - 0.06, 'whole word plus a tail, not capped at 1.80: ' + JSON.stringify(r));
  assert.ok(!e.extended && e.sure, 'a sure audio end, not an extension: ' + JSON.stringify(e));
  clean(env, [[1.0, 1.97, 'AI.'], [2.56, 3.2, 'So']], r.range, '"AI."');
  // the start of the next line follows its sound too, not Whisper's early 1.80
  const n = CP.snapRange([1.8, 3.2], words, env, 5); assert.ok(n.range[0] >= 1.97 + 0.05 && n.range[0] <= 2.56 - 0.06, JSON.stringify(n));
});

console.log(`\ncut points: ${n} tests passed`);
