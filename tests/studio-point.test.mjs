// The Cut step's point of the video, topics and Pacing: the local rules, with no model and no server.
//   node tests/studio-point.test.mjs
import assert from 'assert';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { tokens, stem, contentStems, STOP } from '../kit/studio/words.mjs';
import { pointScorer, cleanPoint, pointLine, FITS, POINT_BOOST, POINT_MAX } from '../kit/studio/point.mjs';
import { themesOf, topicsPrompt, readTopics } from '../kit/studio/topics.mjs';
import * as PIECES from '../kit/studio/pieces.mjs';
import * as CUT from '../kit/studio/cut.mjs';
import * as PACING from '../kit/studio/pacing.mjs';
const require = createRequire(import.meta.url);
const CP = require('../kit/cutpoints.cjs');

let n = 0; const ok = (name, f) => { f(); n++; console.log('ok ' + name); };
const take = JSON.parse(readFileSync(new URL('./fixtures/topics-take.json', import.meta.url), 'utf8'));
// the fixture as Studio's lines: about 3 s each, a short pause between
const LINES = take.lines.map((text, i) => ({ id: 'l' + (i + 1), n: i + 1, text, start: i * 3.4, end: i * 3.4 + 3, seconds: 3 }));
const POINT = 'Show beginners they can build an app with AI in a weekend';

// ---------- words ----------
ok('stop words, fillers and contractions never count as subject words', () => {
  for (const w of ['help', 'youre', 'back', 'different', 'able', 'really', 'thing', 'people']) assert.ok(STOP.has(w), w);
  const T = tokens("You're able to build a working app, and that's what helped.");
  assert.deepStrictEqual(T.filter(t => !t.stop).map(t => t.w), ['build', 'working', 'app']);
  assert.ok(T.find(t => t.w === "you're").stop && T.find(t => t.w === 'that').stop);
});
ok('the stemmer makes build, builds, building and built meet', () => {
  assert.strictEqual(new Set(['build', 'builds', 'building', 'built'].map(stem)).size, 1);
  assert.strictEqual(stem('apps'), stem('app')); assert.strictEqual(stem('beginners'), stem('beginner'));
  assert.deepStrictEqual(contentStems('Building apps'), [stem('build'), stem('app')]);
});

// ---------- the point ----------
ok('the point is cleaned: one line, no em dash, capped', () => {
  assert.strictEqual(cleanPoint('  Show  beginners\n they can \u2014 build  '), 'Show beginners they can , build');
  assert.strictEqual(cleanPoint(null), ''); assert.strictEqual(cleanPoint('x'.repeat(500)).length, POINT_MAX);
  assert.strictEqual(pointLine(''), ''); assert.ok(pointLine(POINT).includes(POINT));
});
ok('no point, or a point of only small words, steers nothing', () => {
  assert.strictEqual(pointScorer(''), null); assert.strictEqual(pointScorer('just do it for me'), null);
});
ok('a line that shares the point\'s words fits, one that does not gets no boost', () => {
  const pt = pointScorer(POINT);
  const on = "You're able to build a working app in a weekend if you pick one small problem.", off = 'My friends thought I was wasting my time.';
  assert.ok(pt.fits(on)); assert.ok(!pt.fits(off));
  assert.ok(pt.fit(on) > pt.fit(off)); assert.strictEqual(pt.boost(off), 0);
  assert.ok(pt.boost(on) > 0 && pt.boost(on) <= POINT_BOOST);
  assert.ok(pt.fits('He is building apps every weekend'), 'stems meet: building and build, apps and app');
  assert.ok(!pt.fits('I went away for the weekend'), 'one shared word is not enough');
});
ok('pieces: lines that serve the point score higher, carry fits and say so when picked', () => {
  const plain = PIECES.build(LINES, {}), steered = PIECES.build(LINES, { point: POINT });
  const fit = steered.pieces.filter(p => p.fits);
  assert.ok(fit.length >= 3 && fit.length < LINES.length, `${fit.length} lines fit`);
  assert.ok(!plain.pieces.some(p => p.fits));
  for (const p of steered.pieces) { const q = plain.pieces.find(x => x.id === p.id); assert.ok(p.score >= q.score); if (p.fits) assert.ok(p.score > q.score, p.text); }
  const ch = PIECES.choose(steered.pieces, { min: 20, max: 45 });
  const said = ch.ids.filter(id => ch.reasons[id].includes(FITS));
  assert.ok(said.length >= 1, 'a chosen line says Fits your point');
  for (const id of said) assert.ok(steered.pieces.find(p => p.id === id).fits);
  assert.ok(!Object.values(PIECES.choose(plain.pieces, { min: 20, max: 45 }).reasons).some(r => r.includes(FITS)));
});
ok('cuts: the suggested clips lean to the point and the model prompt carries it', () => {
  const words = []; for (const l of LINES) { const W = l.text.split(/\s+/), d = (l.end - l.start) / W.length; W.forEach((w, k) => words.push([+(l.start + k * d).toFixed(2), +(l.start + (k + 1) * d - 0.04).toFixed(2), w])); }
  const o = CUT.normalize(CUT.defaultOutput(), { kind: 'both', length: 'short', clipLength: 'short', clips: 3 }).output, dur = LINES[LINES.length - 1].end;
  let plain, steered;
  try { plain = CUT.candidates(words, o, { duration: dur }); steered = CUT.candidates(words, o, { duration: dur, point: POINT }); } catch (e) { assert.fail('candidates threw: ' + e.message); }
  assert.ok(steered.length >= 1);
  assert.ok(steered.some(c => c.fits), 'a clip fits the point'); assert.ok(!plain.some(c => c.fits));
  assert.ok(CUT.scorePrompt(steered, o, POINT).includes(POINT)); assert.ok(!/point of this video/i.test(CUT.scorePrompt(plain, o, '')));
});

// ---------- topics ----------
ok('topics: 3 to 5 themes of two or more words, and none of the old weak chips', () => {
  const themes = themesOf(LINES), labels = themes.map(t => t.label);
  assert.ok(themes.length >= 3 && themes.length <= 5, labels.join(' | '));
  for (const l of labels) { assert.ok(l.split(' ').length >= 2 && l.split(' ').length <= 4, l); assert.ok(!/\u2014/.test(l)); }
  const BAD = ['help', 'youre', "you're", 'back', 'build', 'different', 'friends', 'able', 'business'];
  for (const l of labels) assert.ok(!BAD.includes(l.toLowerCase()), 'old chip: ' + l);
  for (const l of labels) for (const w of [l.split(' ')[0], l.split(' ').pop()]) assert.ok(!STOP.has(w.toLowerCase()), `${l} starts or ends on a weak word`);
  assert.ok(labels.some(l => /chatgpt/i.test(l)), labels.join(' | ')); assert.ok(labels.some(l => /\bAI\b/.test(l)), labels.join(' | '));
});
ok('topics: every theme is said in two or more lines, the lines are real and near doubles merge', () => {
  const themes = themesOf(LINES), ids = new Set(LINES.map(l => l.id));
  for (const t of themes) { assert.ok(t.lines.length >= 2, t.label); for (const id of t.lines) assert.ok(ids.has(id)); }
  const keys = themes.map(t => t.stems.slice().sort().join(' ')); assert.strictEqual(new Set(keys).size, keys.length);
  assert.strictEqual(new Set(themes.map(t => t.label.toLowerCase())).size, themes.length);
});
ok('topics: nothing good gives no row', () => {
  assert.deepStrictEqual(themesOf([]), []); assert.deepStrictEqual(themesOf(LINES.slice(0, 2)), []);
  const dull = ['Okay so yeah.', 'I think that was good.', 'Let me try that again.', 'So anyway, here we go.', 'That is really it.'].map((text, i) => ({ id: 'd' + i, n: i + 1, text }));
  assert.deepStrictEqual(themesOf(dull), []);
  assert.deepStrictEqual(PIECES.build(dull, {}).topics, []);
});
ok('topics: the pieces carry their themes, so a chip filters the lines', () => {
  const b = PIECES.build(LINES, {});
  assert.ok(b.topics.length >= 3);
  for (const t of b.topics) { const has = b.pieces.filter(p => p.topics.includes(t)); assert.ok(has.length >= 2 && has.length < LINES.length, t); }
});
ok('topics from a model or an agent are checked before we show them', () => {
  const good = readTopics('Here: {"topics":[{"label":"starting with ChatGPT","lines":[1,6,24]},{"label":"building with AI","lines":[4,17,22]},{"label":"help","lines":[1]},{"label":"made up","lines":[99]},{"label":"Starting with ChatGPT","lines":[1]}]}', LINES);
  assert.deepStrictEqual(good.map(t => t.label), ['starting with ChatGPT', 'building with AI']);
  assert.deepStrictEqual(good[0].lines, ['l1', 'l6', 'l24']);
  assert.strictEqual(readTopics('not json', LINES), null); assert.strictEqual(readTopics({ topics: [{ label: 'one theme only', lines: [1] }] }, LINES), null);
  const p = topicsPrompt(LINES, POINT); assert.ok(p.includes(POINT) && !/\u2014/.test(p));
});

// ---------- pacing ----------
ok('pacing: three choices, read back from the draft flags', () => {
  assert.deepStrictEqual(PACING.PACING.map(p => p.label), ['Natural', 'Tight', 'Very tight']);
  assert.strictEqual(PACING.pacingOf([]).id, 'natural'); assert.strictEqual(PACING.pacingOf(['--tighten', '0.45']).id, 'tight');
  assert.strictEqual(PACING.pacingOf(['--tighten', '0.25']).id, 'very'); assert.strictEqual(PACING.pacingOf(['--tighten', '0.25', '--no-tighten']).id, 'natural');
  assert.deepStrictEqual(PACING.pacePatch('tight'), { pace: { tighten: 0.45 } }); assert.strictEqual(PACING.pacePatch('nope'), null);
});
// a synthetic take: 16 kHz samples, voiced stretches as a tone, quiet between
function envOf(seconds, voiced) {
  const sr = CP.SR, x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = (voiced.some(([a, b]) => t >= a && t < b) ? 0.3 * Math.sin(2 * Math.PI * 180 * t) : 0) + 0.0005 * Math.sin(i * 12.9898); }
  return CP.envelopeFromSamples(x);
}
ok('pacing: tighter takes out quiet only, never a word, and every span starts and ends in the quiet', () => {
  const voiced = [[0.5, 1.4], [2.6, 3.5], [3.8, 4.6], [6.2, 7.0]], env = envOf(8, voiced);
  assert.ok(CP.isEnv(env));
  const words = voiced.map(([a, b], k) => [a, b, 'w' + k]), range = [[0.4, 7.1]];
  const nat = PACING.playSpans(range, words, env, null, 8), tight = PACING.playSpans(range, words, env, 0.45, 8), very = PACING.playSpans(range, words, env, 0.25, 8);
  assert.deepStrictEqual(nat.spans, range); assert.strictEqual(nat.saved, 0);
  assert.ok(tight.cuts >= 2 && tight.saved > 1, JSON.stringify(tight)); assert.ok(very.seconds <= tight.seconds && tight.seconds < nat.seconds);
  for (const r of [tight, very]) {
    for (const [a, b] of voiced) assert.ok(r.spans.some(([x, y]) => x <= a + 0.02 && y >= b - 0.02), `the word at ${a} to ${b} stays whole in ${JSON.stringify(r.spans)}`);
    for (const [x, y] of r.spans) for (const [a, b] of voiced) { assert.ok(!(x > a + 0.02 && x < b - 0.02), `a span starts inside a word at ${x}`); assert.ok(!(y > a + 0.02 && y < b - 0.02), `a span ends inside a word at ${y}`); }
    for (let i = 1; i < r.spans.length; i++) assert.ok(r.spans[i][0] > r.spans[i - 1][1], 'spans stay in order');
  }
});
ok('pacing: with no audio read we leave the take alone', () => {
  const r = PACING.playSpans([[0, 4], [6, 6]], [[0.5, 1, 'a']], null, 0.25, 8);
  assert.deepStrictEqual(r.spans, [[0, 4]]); assert.strictEqual(r.cuts, 0);
});

console.log(`\n${n} checks passed`);
