// Highlight moments from a long talk: sentence-safe windows, local scores, agent rescores, keep and brief.
// Run: node tests/studio-highlights.test.mjs   (npm run check runs it). No ffmpeg and no Whisper needed.
import assert from 'assert';
import { readFileSync, writeFileSync, mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sentences } from '../kit/studio/cut.mjs';
import * as H from '../kit/highlights.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

// a 3 minute talk of complete sentences, with a hook, a number, filler and a weak mid-thought
function wordsOf() {
  const lines = [
    [0.0, 'What if most people are editing the wrong part of the talk?'],
    [6.2, 'Here is the one number that changed how I cut a podcast.'],
    [12.8, 'Um I think it was basically just luck though.'],
    [18.0, 'And then we went to lunch after that.'],
    [24.5, 'Ten thousand listeners heard the first hook and stayed.'],
    [31.0, 'If you want the same result, start with the question you actually asked.'],
    [38.4, 'Most people bury that line in the middle and wonder why nobody watches.'],
    [46.0, 'This is the secret: keep the strong open, drop the filler, and end on a loop.'],
    [54.2, 'Why does that work so well on short clips?'],
    [59.5, 'Because the last line points back to the first question you asked.'],
    [66.0, 'So anyway we also talked about the weather for a bit.'],
    [72.5, 'Nobody needs that stretch in the reel.'],
    [78.0, 'You can cut it and the story still holds.'],
    [84.0, 'Follow along and I will show the same cut on a longer take later.'],
  ];
  // repeat the strong block to make a talk longer than two minutes without mid-word cuts
  const more = [
    [90, 'What should you do with a one hour interview?'],
    [96, 'Pick the moments that stand on their own.'],
    [102, 'A complete thought, a number, a question: those are the ones people share.'],
    [110, 'The rest can wait for the full episode.'],
    [116, 'I spent five years learning that the hard way.'],
    [122, 'Here is how we find those moments on your computer, with no account.'],
    [130, 'We transcribe the talk, split it on sentence ends, and score each window.'],
    [138, 'Then you pick the clips that become the take for a reel.'],
    [146, 'Your agent can rescore them, or the local rules can stand in.'],
    [154, 'Nothing is posted for you, and your keys stay on this machine.'],
    [162, 'That is the whole idea, and it loops back to the first question.'],
    [170, 'What if most people are editing the wrong part of the talk?'],
    [176, 'Now you can try it on your own footage.'],
  ];
  const all = [...lines, ...more];
  const words = [];
  for (const [start, text] of all) {
    const toks = text.split(/\s+/);
    let t0 = start;
    for (const w of toks) {
      const d = Math.max(0.18, w.length * 0.07);
      words.push([+t0.toFixed(2), +(t0 + d).toFixed(2), w]);
      t0 += d + 0.04;
    }
  }
  return words;
}

t('LONG_MIN is 3 minutes, and options clamp n and the window', () => {
  assert.strictEqual(H.LONG_MIN, 180);
  assert.ok(H.isLong(180) && H.isLong(3600) && !H.isLong(179));
  const o = H.options({ n: 8, min: 20, max: 60 });
  assert.deepStrictEqual({ n: o.n, min: o.min, max: o.max, goal: o.goal, errs: o.errs }, { n: 8, min: 20, max: 60, goal: 'organic', errs: [] });
  assert.ok(H.options({ n: 0 }).errs.length);
  assert.ok(H.options({ min: 80, max: 20 }).errs.length);
});

t('snapToSentences never starts or ends mid-sentence', () => {
  const S = sentences(wordsOf());
  assert.ok(S.length >= 8);
  const mid = S[1].start + (S[1].end - S[1].start) / 2;
  const [a, b] = H.snapToSentences(mid, S[3].start + 0.1, S);
  assert.strictEqual(a, S[1].start);
  assert.ok(b >= S[3].end - 0.01, 'end expands to the sentence that contains it');
});
t('fromWords returns up to n complete highlights with reasons and start times', () => {
  const words = wordsOf(), found = H.fromWords(words, { n: 5, min: 15, max: 70, duration: words[words.length - 1][1] });
  assert.ok(found.candidates.length >= 1 && found.candidates.length <= 5);
  assert.strictEqual(found.scoredBy, 'rules');
  const S = found.sentences;
  for (const c of found.candidates) {
    assert.match(c.id, /^h\d+$/);
    assert.ok(c.start >= 0 && c.end > c.start);
    assert.ok(c.seconds >= 14 && c.seconds <= 77, c.seconds);
    assert.ok(c.score >= 0 && c.score <= 100);
    assert.ok(c.reason && !/\u2014/.test(c.reason));
    assert.ok(c.text);
    assert.strictEqual(c.keep, false);
    // start and end sit on sentence edges
    assert.ok(S.some(s => Math.abs(s.start - c.start) < 0.2), 'start is a sentence start ' + c.start);
    assert.ok(S.some(s => Math.abs(s.end - c.end) < 0.2), 'end is a sentence end ' + c.end);
  }
  // no overlap
  const ordered = found.candidates.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i].start >= ordered[i - 1].end - 0.05);
});

t('the hook and the number outrank the filler lunch', () => {
  const words = wordsOf(), found = H.fromWords(words, { n: 4, min: 12, max: 50, duration: words[words.length - 1][1] });
  const blob = found.candidates.map(c => (c.text + ' ' + c.reason).toLowerCase()).join(' | ');
  assert.ok(/what if|number|ten thousand|question|secret|hook/.test(blob), blob);
  assert.ok(!found.candidates.every(c => /lunch|weather/.test(c.text)), 'filler-only windows should not be the whole list');
});

t('applyScores snaps agent times to sentences, keeps 0-100, and marks scoredBy agent', () => {
  const words = wordsOf(), found = H.fromWords(words, { n: 3, min: 15, max: 50, duration: words[words.length - 1][1] });
  const S = found.sentences;
  const mid = S[0].start + 0.4;
  const next = H.applyScores(found, [
    { id: found.candidates[0].id, score: 91, reason: 'Strong open' },
    { start: mid, end: S[2].start + 0.2, score: 70, reason: 'A complete thought I want in' },
    { id: 'nope', score: 5, reason: 'ignore missing' },
  ], { words, duration: found.duration });
  assert.strictEqual(next.scoredBy, 'agent');
  const first = next.candidates.find(c => c.id === found.candidates[0].id);
  assert.strictEqual(first.score, 91);
  assert.strictEqual(first.reason, 'Strong open');
  const added = next.candidates.find(c => c.reason.startsWith('A complete thought'));
  assert.ok(added);
  assert.strictEqual(added.start, S[0].start);
  assert.ok(added.end >= S[2].end - 0.01);
  assert.ok(next.candidates[0].score >= next.candidates[next.candidates.length - 1].score);
});

t('setKeep and keptOf, and the brief names the tools with no em dash', () => {
  const words = wordsOf(), found = H.fromWords(words, { n: 3, min: 15, max: 50, duration: words[words.length - 1][1] });
  const id = found.candidates[0].id;
  const kept = H.setKeep(found, [id], true);
  assert.deepStrictEqual(H.keptOf(kept).map(c => c.id), [id]);
  const brief = H.briefOf(kept, { job: 'talk-one' });
  assert.ok(brief.includes('find_highlights') && brief.includes('score_highlights') && brief.includes('pick_highlights'));
  assert.ok(brief.includes(id) && brief.includes('talk-one'));
  assert.ok(!/\u2014/.test(brief));
  assert.ok(!/npm run/.test(brief), 'the brief is for the page, not a terminal command');
});

t('fromWords refuses a bad window', () => {
  assert.throws(() => H.fromWords([], { n: 99 }), /n: 1 to 20/);
});

t('snapToSentences returns null outside the talk, so a bad time is not the whole take', () => {
  const S = sentences(wordsOf()), last = S[S.length - 1].end;
  assert.strictEqual(H.snapToSentences(1000, 1200, S, last), null);
  assert.strictEqual(H.snapToSentences(-9, -1, S, last), null);
  assert.strictEqual(H.snapToSentences(2, 2, S, last), null);
});

t('applyScores skips out-of-range times and keeps a tick the agent left out', () => {
  const words = wordsOf(), found = H.fromWords(words, { n: 3, min: 15, max: 50, duration: words[words.length - 1][1] });
  const kept = H.setKeep(found, [found.candidates[0].id], true);
  const next = H.applyScores(kept, [
    { start: 1000, end: 1200, score: 99, reason: 'Way past the end' },
    { start: -9, end: -1, score: 80, reason: 'Before the start' },
    { start: kept.candidates[1].start, end: kept.candidates[1].end, score: 70, reason: 'A real moment' },
  ], { words, duration: found.duration });
  assert.ok(next.skipped >= 2);
  assert.ok(next.candidates.every(c => c.seconds < found.duration - 1), 'no talk-sized clip');
  assert.ok(next.candidates.some(c => c.id === found.candidates[0].id && c.keep), 'the ticked clip stays');
  assert.ok(next.candidates.some(c => c.reason === 'A real moment'));
});

t('cacheFile includes the file size and mtime, not only the name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hl-cache-'));
  const a = join(dir, 'take.mp4'), b = join(dir, 'take.mp4');
  writeFileSync(a, 'aaa');
  const one = H.cacheFile(a);
  writeFileSync(a, 'aaaaaa');
  const two = H.cacheFile(a);
  assert.ok(one !== two);
  assert.ok(one.includes('take-') && one.endsWith('.tx.json'));
  const st = statSync(a);
  assert.ok(two.includes(String(st.size)));
});

t('no em dashes in the module', () => {
  assert.ok(!/\u2014/.test(readFileSync(join(ROOT, 'kit', 'highlights.mjs'), 'utf8')));
});

console.log(`\n${n} checks passed`);
