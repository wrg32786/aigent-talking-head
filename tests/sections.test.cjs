// kit/sections.cjs: hook, body and CTA tags on cut.json segments, and --transitions-when keeping named transitions
// only on the seams it names (spec 8.1 and 8.4). Run: node tests/sections.test.cjs
const assert = require('assert');
const SEC = require('../kit/sections.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
// six 2 s segments from two takes; words say a hook, two body lines and a call to action
const W = (t0, text) => text.split(' ').map((w, i) => ({ start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25, word: w }));
const words = [...W(0.1, 'Stop editing reels by hand.'), ...W(1.8, 'Drop your clip in right now.'), ...W(4.3, 'It cuts the pauses for you.'), ...W(6.5, 'Then it adds the words.'), ...W(8.4, 'And the music too.'), ...W(10.2, 'Follow for more.')];
const cut = () => ({ segs: [0, 1, 2, 3, 4, 5].map(i => ({ file: i < 3 ? 'a.mp4' : 'b.mp4', in: i * 2, out: i * 2 + 2, ...(i ? { transition: 'whip' } : {}) })), hits: [[2, 20], [4, 20], [6, 20], [8, 20], [10, 20]] });

t('the hook runs to the end of the first sentence after 3 s, the CTA from the line that asks', () => {
  const b = SEC.bounds(words, 12);
  assert.ok(b.hookEnd > 3 && b.hookEnd < 4.2, JSON.stringify(b)); assert.strictEqual(b.ctaStart, 10.2);
  const c = cut(); assert.deepStrictEqual(SEC.tag(c, words), ['hook', 'hook', 'body', 'body', 'body', 'cta']);
  assert.deepStrictEqual(SEC.windows(c, ['hook']), [[0, 4]]); assert.deepStrictEqual(SEC.windows(c, ['hook', 'cta']), [[0, 4], [10, 12]]);
});
t('no words: the first 3 s are the hook, nothing is a CTA', () => {
  const c = cut(); assert.deepStrictEqual(SEC.tag(c, []), ['hook', 'body', 'body', 'body', 'body', 'body']);
});
t('hook and CTA only: named transitions stay on hook and CTA seams, the rest are plain cuts without the shake', () => {
  const c = cut(); SEC.tag(c, words); c.transitionsWhen = 'hook-cta';
  assert.strictEqual(SEC.applyTransitionsWhen(c), 2);
  assert.deepStrictEqual(c.segs.map(s => s.transition || null), [null, 'whip', 'whip', 'cut', 'cut', 'whip']);
  assert.deepStrictEqual(c.hits.map(h => h[0]), [2, 4, 10]);
});
t('topic: transitions only where another recording or a new section starts (one clip file per segment, as clip.py writes)', () => {
  const c = cut(); c.segs.forEach((x, i) => { x.file = `clip-00${i}.mp4`; }); SEC.tag(c, words); c.transitionsWhen = 'topic';
  SEC.applyTransitionsWhen(c, { takeOf: x => (+x.file.slice(5, 8) < 3 ? 'take1.mp4' : 'take2.mp4') });
  assert.deepStrictEqual(c.segs.map(s => s.transition || null), [null, 'cut', 'whip', 'whip', 'cut', 'whip']);
});
t('every cut, or no timing, changes nothing; a tightened pause is left as it was', () => {
  const c = cut(); SEC.tag(c, words); const before = JSON.stringify(c);
  c.transitionsWhen = 'every-cut'; assert.strictEqual(SEC.applyTransitionsWhen(c), 0); delete c.transitionsWhen; assert.strictEqual(SEC.applyTransitionsWhen(c), 0);
  assert.strictEqual(JSON.stringify(c), before);
  const j = cut(); j.segs[3].jump = true; delete j.segs[3].transition; SEC.tag(j, words); j.transitionsWhen = 'hook-cta'; SEC.applyTransitionsWhen(j);
  assert.strictEqual(j.segs[3].transition, undefined);
});
t('a later timing brings back what an earlier one took away: transitions and shakes', () => {
  const c = cut(); c.segs[3].transition = 'film'; SEC.tag(c, words); const before = JSON.stringify(c);
  c.transitionsWhen = 'hook-cta'; SEC.applyTransitionsWhen(c); assert.strictEqual(c.segs[3].transition, 'cut'); assert.ok(!c.hits.some(h => h[0] === 6));
  c.transitionsWhen = 'topic'; SEC.applyTransitionsWhen(c, { takeOf: x => x.file });
  assert.deepStrictEqual(c.segs.map(s => s.transition || null), [null, 'cut', 'whip', 'film', 'cut', 'whip']);
  c.transitionsWhen = 'every-cut'; SEC.applyTransitionsWhen(c); delete c.transitionsWhen;
  assert.strictEqual(JSON.stringify(c), before, 'every cut is the draft again');
});
t('seams you set yourself, a tightened pause and a recreated seam keep their transition', () => {
  const c = cut(); c.edited = { transitions: [3] }; c.segs[4].recut = true; SEC.tag(c, words); c.transitionsWhen = 'hook-cta'; SEC.applyTransitionsWhen(c);
  assert.deepStrictEqual(c.segs.map(s => s.transition || null), [null, 'whip', 'whip', 'whip', 'whip', 'whip']);
});
t('a long segment: the CTA it holds is still found, and the hook does not swallow it', () => {
  const c = { segs: [{ file: 'a', in: 0, out: 4 }, { file: 'a', in: 4, out: 16 }] };
  const ws = [...W(0.1, 'Here is the thing.'), ...W(3.5, 'It works on any phone.'), ...W(13, 'Follow for part two.')];
  assert.deepStrictEqual(SEC.tag(c, ws), ['hook', 'cta']);
  const d = { segs: [{ file: 'a', in: 0, out: 2.9 }, { file: 'a', in: 2.9, out: 14 }, { file: 'a', in: 14, out: 16 }] };
  assert.deepStrictEqual(SEC.tag(d, ws), ['hook', 'body', 'cta']);
});
t('a call to action asks: "this will save you hours" is not one, "check out the link" and "follow" are', () => {
  assert.strictEqual(SEC.bounds([...W(0, 'Build it once.'), ...W(4, 'This will save you hours.'), ...W(6, 'That is it.')], 8).ctaStart, null);
  assert.strictEqual(SEC.bounds([...W(0, 'Build it once.'), ...W(4, 'Check out the link below.')], 8).ctaStart, 4);
  assert.strictEqual(SEC.bounds([...W(0, 'Build it once.'), ...W(4, 'If you want more, follow me.')], 8).ctaStart, 4);
});
t('filters on the hook only: the hook pieces get them, the rest none, the job-wide finish is set aside and comes back', () => {
  const c = cut(); c.finish = 'warm'; c.segs[4].finish = 'grain'; SEC.tag(c, words); const before = JSON.stringify(c);
  c.finishWhen = 'hook'; c.finishIds = ['mono'];
  assert.strictEqual(SEC.applyFinishWhen(c), 2);
  assert.strictEqual(c.finish, undefined, 'never the whole video through cut.finish');
  assert.deepStrictEqual(c.segs.map(s => s.finish || null), ['mono', 'mono', null, null, null, null]);
  c.finishWhen = 'hook-cta'; c.finishIds = ['mono', 'grain']; SEC.applyFinishWhen(c);
  assert.deepStrictEqual(c.segs.map(s => s.finish || null), ['mono', 'grain', null, null, null, 'mono']);
  delete c.finishWhen; delete c.finishIds; SEC.applyFinishWhen(c);
  assert.deepStrictEqual(c, JSON.parse(before), 'no timing is the draft again');
});
t('a seam you changed while it was held stays yours; a lock sees the real seams first', () => {
  const c = cut(); SEC.tag(c, words); c.transitionsWhen = 'hook-cta'; SEC.applyTransitionsWhen(c);
  c.segs[3].transition = 'film'; // changed by hand or by choices --apply while held
  c.transitionsWhen = 'every-cut'; SEC.applyTransitionsWhen(c);
  assert.strictEqual(c.segs[3].transition, 'film'); assert.strictEqual(c.segs[4].transition, 'whip'); assert.ok(!c.segs.some(x => 'heldTransition' in x));
  const d = cut(); SEC.tag(d, words); d.transitionsWhen = 'hook-cta'; SEC.applyTransitionsWhen(d); SEC.restore(d);
  assert.ok(d.segs.slice(1).every(x => x.transition === 'whip') && !d.heldHits, 'restore puts every seam and shake back before a lock');
});
t('"I want to share a story" and "that is the message" are not calls to action', () => {
  assert.strictEqual(SEC.bounds([...W(0, 'Build it once.'), ...W(4, 'I want to share a story.'), ...W(6, 'That is the message.')], 8).ctaStart, null);
});
t('a timed filter you changed by hand stays yours when the timing goes; the rest come back', () => {
  const c = cut(); c.finish = 'warm'; SEC.tag(c, words); c.finishWhen = 'hook'; c.finishIds = ['mono']; SEC.applyFinishWhen(c);
  c.segs[0].finish = 'grain'; // choices --apply while timed
  delete c.finishWhen; delete c.finishIds; SEC.applyFinishWhen(c);
  assert.strictEqual(c.segs[0].finish, 'grain'); assert.strictEqual(c.segs[1].finish, undefined); assert.strictEqual(c.finish, 'warm');
  assert.ok(!c.segs.some(x => 'heldFinish' in x || 'timedFinish' in x));
});
console.log(`\nsections: ${n} tests passed`);
