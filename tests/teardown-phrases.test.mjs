// Phrases on screen are not one-word captions, and a breakdown read without the vision pass says so
// (Studio report 4 item 16, the cheap part). A fixture breakdown in the shape rea-video writes.
// - the recipe never says "captions: one-word" when shots[].text.items show phrases of two or more words on most
//   moments with big text, also when the phrases are built word by word and so match the speech one word at a time;
//   it says kinetic (a key word with the rest of its phrase) and teardown.md says why
// - a reel of one-word captions with a few titles between them stays one-word
// - analysis.vlm off or not_configured: "- vision: off" in the Reel.md Style, one plain line in teardown.md, and the
//   page shows that line with the reference (extract gives vision: "off")
// No Chrome, no ffmpeg, no network. Run: node tests/teardown-phrases.test.mjs   (part of npm run check)
import assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const TMP = mkdtempSync(join(tmpdir(), 'teardown-phrases-test-'));
process.env.STUDIO_DIR = join(TMP, 'studio'); mkdirSync(process.env.STUDIO_DIR, { recursive: true });
const CAP = require('../kit/teardown/captions.cjs'), V = require('../kit/videomd2reel.cjs'), RM = require('../kit/reelmd.cjs');
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

// ---- the fixture: a talking head whose every line is a designed phrase, built word by word (reference 5)
const PHRASES = [['WAS THE', 'LOWEST', 'WE EVER MADE'], ['THE ONLY', 'Question', 'YOU NEED'], ['PEOPLE DON\'T', 'Buy'], ['IF THEY DON\'T', 'Feel Safe'], ['IF WE MADE', '$30K'], ['I DON\'T KNOW', 'How to pitch'], ['I REALIZED', 'I HAD', 'A PROBLEM'], ['LOST ALL', 'OF THEM']];
const item = (tm, text, y, h = 0.05, conf = 0.9) => ({ t: tm, text, conf, bbox: [0.2, y, 0.6, h], angle: 0, style: { fill: '#ffffff' }, band: y < 0.36 ? 'top' : 'middle' });
const said = [], cues = [], shots = [];
PHRASES.forEach((lines, i) => {
  const t0 = i * 2.5, words = lines.join(' ').split(' '), items = [];
  words.forEach((w, k) => { const a = +(t0 + 0.2 + k * 0.25).toFixed(2); said.push([a, +(a + 0.2).toFixed(2), w]);
    // what a one-word reader sees: each new word as it lands, one big word at a time
    cues.push({ t0: a, t1: +(a + 0.25).toFixed(2), text: w, conf: 0.9, bbox: [0.3, 0.3, 0.4, 0.06], line_h: 0.06, n_lines: 1, kind: 'label', band: 'top', style: { fill: '#ffffff' } }); });
  // what was on screen every half second: the phrase growing, then whole, in stacked lines
  [0.5, 1, 1.5, 2].forEach((dt, s) => { const shown = s === 0 ? lines.slice(0, 1) : lines; shown.forEach((ln, li) => items.push(item(+(t0 + dt).toFixed(2), ln, 0.28 + li * 0.07))); });
  // a screen recording's small print never counts
  items.push(item(+(t0 + 1).toFixed(2), 'Read src/routes/auth.ts (75 lines)', 0.7, 0.013));
  shots.push({ index: i + 1, start: t0, end: t0 + 2.5, transition_in: 'cut', text: { tracks: [{ kind: 'title', band: 'top', texts: lines, changing: true }], items } });
});
const phraseReel = vlm => ({ source: { file: 'ref5.mp4', duration: PHRASES.length * 2.5 }, analysis: { vlm, ocr: true }, shots, packaging: { text_cues: cues }, speech: { ok: true, words: said } });

// ---- a true one-word reel: 30 single big words, and three two-word titles between them
const ONE = 'you can make this work with only three tools and a free afternoon so here is what i would do first open the page then type your prompt wait a moment and check it'.split(' ');
const oneReel = () => { const sh = [], sp = [], cu = [];
  ONE.forEach((w, i) => { const a = i * 0.5; sp.push([a, a + 0.4, w]); cu.push({ t0: a, t1: a + 0.5, text: w, conf: 0.9, bbox: [0.3, 0.2, 0.4, 0.07], line_h: 0.07, n_lines: 1, kind: 'label', band: 'top', style: { fill: '#ffffff' } }); });
  for (let k = 0; k < 6; k++) { const items = []; for (let j = 0; j < 5; j++) { const i = k * 5 + j; if (ONE[i]) items.push(item(i * 0.5, ONE[i], 0.2, 0.07)); }
    if (k % 2 === 0) items.push(item(k * 2.5, ['TOP 5', 'STEP TWO', 'LAST ONE'][k / 2], 0.6, 0.1));
    sh.push({ index: k + 1, start: k * 2.5, end: k * 2.5 + 2.5, transition_in: 'cut', text: { tracks: [], items } }); }
  return { source: { file: 'one.mp4', duration: 15 }, analysis: { vlm: { used: true, status: 'ok' } }, shots: sh, packaging: { text_cues: cu }, speech: { ok: true, words: sp } }; };

try {
  t('the fixture reads as one-word to the old rule (single big words that match the speech)', () => {
    const ow = CAP.oneWordStream(phraseReel('not_configured')); assert.ok(ow && ow.n >= 8, 'the one-word reader is fooled, as it was on reference 5'); });
  t('phrases on screen: counted from the text items, a growing phrase once, small print left out', () => {
    const ph = CAP.phrasesOnScreen(phraseReel('not_configured'));
    assert.ok(ph, 'phrases found'); assert.strictEqual(ph.n, PHRASES.length, 'one per phrase, not one per step of its build: ' + JSON.stringify(ph));
    assert.ok(ph.share >= 0.9 && ph.examples.length === 3 && ph.examples.every(x => / /.test(x)), JSON.stringify(ph));
    assert.ok(!ph.examples.some(x => /auth\.ts/.test(x)), 'small print is not a phrase');
  });
  t('the caption style is never one-word when the text is phrases; it is kinetic, with the reason', () => {
    const cs = CAP.captionStyle(phraseReel('not_configured'));
    assert.strictEqual(cs.style, 'kinetic'); assert.strictEqual(cs.was, 'one-word');
    assert.ok(/phrases, not one word at a time/.test(cs.why) && /designed titles/.test(cs.why) && /not one-word/.test(cs.why), cs.why);
    assert.ok(!/—/.test(cs.why), 'no em dash');
  });
  t('one-word captions with a few titles between them stay one-word', () => {
    const b = oneReel(); assert.strictEqual(CAP.phrasesOnScreen(b), null); const cs = CAP.captionStyle(b); assert.strictEqual(cs.style, 'one-word'); assert.strictEqual(cs.was, undefined); });
  t('the vision pass: off, not_configured and unused read as off; used reads as on; a breakdown that does not say is left alone', () => {
    for (const v of ['not_configured', 'off', { used: false, requested: false, status: 'off' }, { used: false, status: 'not_configured' }]) assert.strictEqual(CAP.visionPass({ analysis: { vlm: v } }), 'off', JSON.stringify(v));
    for (const v of ['ok', { used: true, status: 'ok' }, { used: true }]) assert.strictEqual(CAP.visionPass({ analysis: { vlm: v } }), 'on', JSON.stringify(v));
    assert.strictEqual(CAP.visionPass({}), null); assert.strictEqual(CAP.visionPass({ analysis: {} }), null);
  });
  t('the recipe: captions kinetic and vision off; teardown.md says both in plain words; Studio reads the line for the page', () => {
    const res = V.convert(phraseReel('not_configured'), {}, {});
    assert.ok(/^- captions: kinetic$/m.test(res.md) && !/captions: one-word/.test(res.md) && /^- look: kinetic$/m.test(res.md), 'the recipe does not say one-word');
    assert.ok(/^- vision: off$/m.test(res.md), 'the recipe carries vision: off');
    assert.strictEqual(RM.parse(res.md).style.vision, 'off');
    assert.ok(res.report.includes(CAP.VISION_OFF), 'teardown.md says the vision pass was off'); assert.ok(/The captions first read as one-word/.test(res.report) && /phrases, not one word at a time/.test(res.report), 'teardown.md says why the captions are not one-word');
    assert.ok(!/—/.test(res.report) && !/—/.test(res.md), 'no em dash');
    const d = join(TMP, 'ref'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'Reel.md'), res.md);
    const ex = C.extract(join(d, 'Reel.md')); assert.strictEqual(ex.vision, 'off'); assert.strictEqual(ex.captionStyle, 'kinetic');
    const on = V.convert(oneReel(), {}, {}); assert.ok(!/vision:/.test(on.md) && !on.report.includes(CAP.VISION_OFF) && /^- captions: one-word$/m.test(on.md), 'a breakdown with the vision pass says nothing, and stays one-word');
    writeFileSync(join(d, 'Reel.md'), on.md); assert.strictEqual(C.extract(join(d, 'Reel.md')).vision, null);
  });
  t('the page shows the one plain line with the reference', () => {
    const jsx = readFileSync(join(ROOT, 'kit', 'studio', 'web', 'src', 'Reference.jsx'), 'utf8');
    assert.ok(jsx.includes(`{ex.vision === 'off' && <p className="fine ref-vision" id="ref-vision" role="note">${CAP.VISION_OFF}.</p>}`), 'the same words as teardown.md');
  });
} finally { rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${n} phrase and vision pass tests passed`);
