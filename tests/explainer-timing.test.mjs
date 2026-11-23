// The explainer's timing math (kit/explainer-timing.mjs) on a fixed word list: a phrase said twice, a cutaway in the
// pause after its phrase, words shifted past it, and the beats, hook and full-frame windows that follow.
// Run: node tests/explainer-timing.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { findPhrase, placeCuts, planBeats } from '../kit/explainer-timing.mjs';

const W = [
  [0.0, 0.4, 'This'], [0.45, 0.8, 'word'], [0.9, 1.3, 'matters.'],
  [2.0, 2.3, 'Watch'], [2.35, 2.7, 'this.'],
  [3.5, 3.8, 'Then'], [3.85, 4.2, 'the'], [4.25, 4.7, 'word'], [4.75, 5.2, 'again.'],
  [6.0, 6.3, 'Comment'], [6.35, 6.8, 'WORD.'],
];
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

t('a phrase is found from a time on, case and punctuation ignored', () => {
  assert.deepStrictEqual(findPhrase(W, 'word'), [1, 1]);
  assert.deepStrictEqual(findPhrase(W, 'WORD', 1.0), [7, 7]);
  assert.deepStrictEqual(findPhrase(W, 'watch this'), [3, 4]);
  assert.strictEqual(findPhrase(W, 'nowhere'), null);
});

t('two beats on the same word land on its two sayings, not the same one', () => {
  const { beats } = planBeats(W, { beats: [{ at: 'word', type: 'stat' }, { at: 'word', type: 'stat' }] }, 7);
  assert.strictEqual(beats[0].start, 0.35); assert.strictEqual(beats[1].start, 4.15);
  assert.ok(beats[0].end <= beats[1].start, 'the first beat ends before the second starts');
});

t('a cutaway goes in the pause after its phrase, and the words after it move by its length', () => {
  const { cuts, words } = placeCuts(W, [{ after: 'watch this', dur: 2, file: 'x.mp4' }]);
  const c = cuts[0];
  assert.ok(c.at > 2.7 && c.at < 3.5, 'in the pause between "this." (ends 2.7) and "Then" (3.5): ' + c.at);
  assert.strictEqual(c.start, c.at); assert.strictEqual(c.end, c.at + 2);
  assert.strictEqual(words[4][0], 2.35, 'a word before the cut keeps its time');
  assert.strictEqual(words[5][0], 5.5, 'a word after the cut moves by the cutaway length');
});

t('beats, the call to action, the hook and the full-frame windows on the shifted words', () => {
  const { cuts, words } = placeCuts(W, [{ after: 'watch this', dur: 2 }]);
  const T = 8.8;
  const p = planBeats(words, { beats: [{ at: 'this word', type: 'progress' }, { at: 'then', type: 'stat' }, { at: 'again', type: 'keyword' }], cta: { at: 'comment' } }, T, cuts);
  assert.strictEqual(p.cta.start, 7.6);
  assert.strictEqual(p.beats[1].start, 5.4);
  assert.ok(p.beats.every(b => b.end <= T));
  assert.strictEqual(p.hookEnd, cuts[0].start, 'the hook ends at the cutaway (a progress beat keeps it)');
  assert.deepStrictEqual(p.full.map(w => !!w.hard), [true, false, false], 'cutaway, keyword punch-in, call to action');
});

t('a phrase that is not said throws with the phrase in the message', () => {
  assert.throws(() => planBeats(W, { beats: [{ at: 'not said' }] }, 7), /not said/);
});

console.log(`\nexplainer-timing: ${n} passed`);
