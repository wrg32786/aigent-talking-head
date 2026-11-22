// Phrase titles from a reference's text tracks, and the same pattern on your own words (1.29.0, Studio report 4 item 16).
// The fixture (tests/fixtures/phrase-breakdown.cjs) is a small breakdown in the shape rea-video writes, modelled on the
// reference 5 table: designed phrase titles of one to three lines, one key word each, no running captions.
// - kit/teardown/phrases.cjs groups shots[].text.items into one title per phrase: lines, key word, band, start and end,
//   how it builds (word, letter, line), the effect it shows (count, swapped word, older lines fading, typing), how it
//   leaves, whether it starts on a cut and whether it stays across one. Small print, handles and lone words are left out.
// - the recipe carries them (Reel.md title lines and titles.json) and never says one-word captions; "running-captions:
//   off" when the reference has none. Titles the user's agent read (titles.agent.json) win over the OCR read and stay
//   across a re-run.
// - kit/phrase-titles.cjs maps the pattern onto your words: one title per phrase, never before the word is said, never
//   on the face, no one-word captions, exits only where you cut.
// No Chrome, no ffmpeg, no network. Run: node tests/phrase-titles.test.mjs   (part of npm run check)
import assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const PH = require('../kit/teardown/phrases.cjs'), PT = require('../kit/phrase-titles.cjs'), V = require('../kit/videomd2reel.cjs'), RM = require('../kit/reelmd.cjs'), R = require('../kit/rules.cjs'), SL = require('../kit/stylelook.cjs');
const { breakdown } = require('./fixtures/phrase-breakdown.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'phrase-titles-test-'));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const say = (t0, text) => text.split(' ').map((w, i) => ({ start: +(t0 + i * 0.3).toFixed(2), end: +(t0 + i * 0.3 + 0.25).toFixed(2), word: w }));
// what we say on our own take, and where we cut
const WORDS = [...say(0.5, 'This was the cheapest launch we ever ran.'), ...say(3.4, 'And it only worked because we asked buyers,'), ...say(6.3, 'the one question you need to answer.'), ...say(10.1, 'People never buy'), ...say(12, 'it kept us going for 365 days'), ...say(14.6, 'I had no idea how to sell.'), ...say(17.2, 'Why?'), ...say(18, 'So here is the plan')];
const CUTS = [2.9, 6, 9.2, 11, 14, 17];

try {
  const T = PH.phraseTitles(breakdown()), by = x => T.find(q => q.text.startsWith(x));
  t('one title per phrase, with its lines as designed', () => {
    assert.deepStrictEqual(T.map(x => x.text), ['WAS THE/LOWEST/WE EVER MADE', 'AND IT ONLY HAPPENED/BECAUSE WE/REALIZED', 'THE ONLY/Question/YOU NEED', "PEOPLE DON'T/Kng", "THAT'D KEEP ME GOING FOR/365 Days", "I DON'T KNOW/How to sell", 'I REALIZED/A PROBLEM']);
    assert.ok(T.every(x => x.lines.length >= 1 && x.lines.length <= 3 && x.end > x.start && x.source === 'ocr'));
    assert.ok(T.every((x, i) => !i || x.start >= T[i - 1].end), 'one at a time, in order');
  });
  t('small print, a handle and a lone sticker word are not titles', () => { const all = T.map(x => x.text).join(' '); assert.ok(!/auth\.ts|thechrisdo|FIRST/.test(all), all); });
  t('the key word: the line in a colour, or set clearly bigger', () => { assert.deepStrictEqual(T.map(x => x.key), ['LOWEST', 'REALIZED', 'Question', 'Kng', '365 Days', 'How to sell', 'A PROBLEM']); });
  t('band and position', () => { assert.strictEqual(by('WAS THE').band, 'top'); assert.strictEqual(by("I DON'T").band, 'bottom'); assert.ok(by('WAS THE').y > 0.2 && by('WAS THE').y < 0.3); });
  t('how it builds: by word, by line, by letter', () => { assert.strictEqual(by('WAS THE').build, 'word'); assert.strictEqual(by('AND IT').build, 'line'); assert.strictEqual(by('THE ONLY').build, 'letter'); assert.strictEqual(by('I REALIZED').build, null); });
  t('the effect it shows: typing, older lines fading, a count, a swapped word', () => {
    assert.strictEqual(by('THE ONLY').effect, 'type'); assert.strictEqual(by('AND IT').effect, 'stack-fade'); assert.strictEqual(by('WAS THE').effect, null);
    assert.strictEqual(by("THAT'D").effect, 'count-up'); assert.deepStrictEqual(by("THAT'D").count, { from: 12, to: 365, unit: 'Days' });
    assert.strictEqual(by("I DON'T").effect, 'slot-roll'); assert.deepStrictEqual(by("I DON'T").swap, ['pitch', 'market', 'sell']);
    assert.ok(T.every(x => x.effect == null || R.TITLE_EFFECTS.includes(x.effect)) && T.every(x => x.exit == null || R.TITLE_EXITS.includes(x.exit)));
  });
  t('at the cuts: starts on a cut, ends on a cut, stays across a cut, and how it leaves', () => {
    const buy = by("PEOPLE DON'T"); assert.ok(buy.onCut && buy.endsOnCut && !buy.acrossCut); assert.strictEqual(buy.start, 10); assert.strictEqual(buy.end, 11);
    assert.strictEqual(buy.exit, 'blow-up', 'the next shot comes in on a flash');
    assert.ok(by('THE ONLY').acrossCut && !by('THE ONLY').onCut); assert.ok(by('WAS THE').endsOnCut && by('WAS THE').end === 2.2 && by('WAS THE').exit === null);
  });

  const res = V.convert(breakdown(), {}, {}), style = res.md.split('## Style')[1].split('## Shots')[0];
  t('the recipe: a title line per phrase, no one-word captions, running captions off', () => {
    assert.ok(!/captions: one-word/.test(res.md) && /^- running-captions: off$/m.test(style) && /^- titles: on$/m.test(style), style);
    assert.ok(/^#03 6\.25-8\.75 \| layer front \| role \w+ \| lines 3 \| key Question \| build letter \| effect type \| band top \| across-cut on \| text THE ONLY\/Question\/YOU NEED$/m.test(res.md), res.md.split('## Titles')[1].slice(0, 900));
    assert.ok(/\| effect count-up \| count 12-365 Days \|/.test(res.md) && /\| effect slot-roll \| swap pitch, market, sell \|/.test(res.md) && /\| exit blow-up \|/.test(res.md));
    assert.strictEqual(res.titles.length, 7); assert.ok(res.phrases && res.runningCaptions === false);
    assert.ok(res.titles.every(x => Array.isArray(x.lines) && 'key' in x && 'build' in x && 'acrossCut' in x), 'titles.json carries the phrase fields');
    assert.ok(/#4 at 10s: "PEOPLE DON'T\/Kng"/.test(res.report) && /## Phrase titles/.test(res.report) && /draws none/.test(res.report), 'the report lists them and marks the misread one');
    assert.ok(!/[—–]/.test(res.md + res.report), 'no em or en dash');
  });
  t('read back: valid, phrase flips with lines, key, build, effect, exit, count and swap', () => {
    const r = RM.parse(res.md), v = RM.validate(r); assert.deepStrictEqual(v.errs, []);
    const f = RM.titleFlips(r); assert.ok(f.every(x => x.phrase && x.mode === 7));
    assert.strictEqual(f[2].text, 'THE ONLY|Question|YOU NEED'); assert.strictEqual(f[2].key, 'Question'); assert.strictEqual(f[2].effect, 'type'); assert.strictEqual(f[2].acrossCut, true);
    assert.deepStrictEqual(f[4].count, { from: 12, to: 365, unit: 'Days' }); assert.deepStrictEqual(f[5].swap, ['pitch', 'market', 'sell']); assert.strictEqual(f[3].exit, 'blow-up'); assert.strictEqual(f[3].onCut, true);
    assert.strictEqual(RM.toPreset(r).runningCaptions, false);
    assert.deepStrictEqual(PH.parseCount('1-365 Days > 1 Year'), { from: 1, to: 365, unit: 'Days', final: '1 Year' });
    const bad = RM.validate(RM.parse(res.md.replace('effect type', 'effect wobble').replace('exit blow-up', 'exit vanish').replace('count 12-365 Days', 'count lots').replace('key Question', 'key Answer')));
    assert.strictEqual(bad.errs.length, 4, bad.errs.join('; '));
  });
  t('a reel of one-word captions keeps its captions and its few big titles', () => {
    const ONE = 'you can make this work with only three tools and a free afternoon so here is what i would do first'.split(' ');
    const cu = ONE.map((w, i) => ({ t0: i * 0.5, t1: i * 0.5 + 0.5, text: w, conf: 0.9, bbox: [0.3, 0.2, 0.4, 0.07], line_h: 0.07, n_lines: 1, kind: 'label', band: 'top', style: { fill: '#ffffff' } }));
    const sh = [0, 1, 2, 3].map(k => ({ index: k + 1, start: k * 2.5, end: k * 2.5 + 2.5, transition_in: 'cut', text: { tracks: [], items: ONE.slice(k * 5, k * 5 + 5).map((w, j) => ({ t: (k * 5 + j) * 0.5, text: w, conf: 0.9, bbox: [0.3, 0.2, 0.4, 0.07], style: { fill: '#ffffff' } })) } }));
    const r1 = V.convert({ source: { file: 'one.mp4', duration: 10 }, shots: sh, packaging: { text_cues: cu }, speech: { ok: true, words: ONE.map((w, i) => [i * 0.5, i * 0.5 + 0.4, w]) } }, {}, {});
    assert.ok(/^- captions: one-word$/m.test(r1.md) && !/running-captions/.test(r1.md) && !r1.phrases);
  });

  t('titles the agent read win over OCR, are stored beside the teardown and stay across a re-run', () => {
    const d = join(TMP, 'ref'); mkdirSync(join(d, 'videomd'), { recursive: true }); writeFileSync(join(d, 'videomd', 'breakdown.json'), JSON.stringify(breakdown()));
    const run = () => execFileSync(process.execPath, [join(ROOT, 'kit', 'videomd2reel.cjs'), join(d, 'videomd'), '--out', join(d, 'Reel.md'), '--no-scenes'], { encoding: 'utf8' });
    run(); assert.ok(/Kng/.test(readFileSync(join(d, 'Reel.md'), 'utf8')));
    const bad = PH.writeAgentTitles(d, [{ start: 10, end: 11, lines: ['a', 'b', 'c', 'd'] }]); assert.ok(!bad.ok && !existsSync(join(d, PH.AGENT_FILE)), 'a bad list is not stored');
    const ok = PH.writeAgentTitles(d, [{ start: 10, end: 11, lines: ["PEOPLE DON'T", 'Buy'], key: 'Buy', font: 'italic serif', glow: true, exit: 'blow-up' }, { start: 11.75, end: 13.6, lines: ["THAT'D KEEP ME GOING FOR", '365 Days'], key: '365 Days', effect: 'count-up', count: { from: 1, to: 365, unit: 'Days', final: '1 Year' } }], 'agent');
    assert.ok(ok.ok); assert.strictEqual(PH.readAgentTitles(d).titles.length, 2);
    for (let i = 0; i < 2; i++) { run(); const md = readFileSync(join(d, 'Reel.md'), 'utf8');
      assert.ok(/text PEOPLE DON'T\/Buy$/m.test(md) && !/Kng/.test(md) && !/check /.test(md.split('## Titles')[1].split('```')[1]), 'run ' + i + ': the agent text, no check mark');
      assert.ok(/\| key Buy \| exit blow-up \| band top \| glow on \| on-cut on \|/.test(md) && /count 1-365 Days > 1 Year/.test(md), md.split('## Titles')[1].slice(0, 600));
      assert.ok(existsSync(join(d, PH.AGENT_FILE)), 'still there'); }
  });
  t('agent titles are checked: lines, times, key, effect, exit, font, swap, count', () => {
    const v = x => PH.validateAgentTitles([{ start: 1, end: 2, lines: ['IF WE MADE', '$30K'], ...x }]);
    assert.ok(v({}).ok && v({ key: '$30k', effect: 'slot-roll', exit: 'polaroid', build: 'word', font: 'italic serif', glow: true, swap: ['$10K', '$20K', '$30K'] }).ok);
    for (const x of [{ effect: 'wobble' }, { exit: 'vanish' }, { key: 'Buy' }, { end: 0.5 }, { lines: ['a', 'b', 'c', 'd'] }, { lines: [] }, { lines: ['a|b'] }, { font: 'comic' }, { build: 'page' }, { swap: ['one'] }, { count: { from: 'a', to: 3 } }, { start: -1 }]) { const r = v(x); assert.ok(!r.ok && r.errs.length === 1 && /^title 1: /.test(r.errs[0]) && !r.titles.length, JSON.stringify(x) + ' ' + JSON.stringify(r.errs)); }
    assert.ok(!PH.validateAgentTitles([]).ok && !PH.validateAgentTitles(null).ok && !PH.validateAgentTitles({ titles: 'x' }).ok);
    assert.deepStrictEqual(PH.validateAgentTitles({ titles: [{ start: 5, end: 6, text: 'B/c' }, { start: 1, end: 2, lines: [' A  b '] }] }).titles.map(x => x.lines.join('/')), ['A b', 'B/c'], 'in time order, tidied, "text" with / read as lines');
  });

  const refs = RM.parse(res.md).titles, M = PT.mapPhrases(refs, WORDS, { k: 1, len: 20, cuts: CUTS }), F = M.flips;
  t('your words in phrases: split at pauses and punctuation, a lone word never stands alone', () => {
    const ps = PT.ourPhrases(WORDS); assert.ok(ps.every(p => p.words.length >= 2 || /\d/.test(p.words[0].word)), JSON.stringify(ps.map(p => p.words.map(w => w.word).join(' '))));
    assert.ok(!ps.some(p => p.words.length === 1 && p.words[0].word === 'Why?'), '"Why?" alone is not a phrase title');
    assert.ok(ps.every(p => p.words.length <= 8));
  });
  t('one title per phrase at the matching moments, our words, never the reference\'s', () => {
    assert.strictEqual(F.length, 7, M.line);
    const ours = new Set(WORDS.map(w => w.word.replace(/[,.;:]+$/, '')));
    for (const f of F) for (const w of f.text.split(/[|\s]+/)) assert.ok(ours.has(w), `"${w}" is one of our words`);
    assert.ok(!/LOWEST|Question|Kng|REALIZED/.test(JSON.stringify(F)), 'none of the reference\'s text');
    F.forEach((f, i) => assert.ok(Math.abs(f.start - refs[i].start) <= 2, `title ${i + 1} at ${f.start}s is near the reference's ${refs[i].start}s`));
    assert.ok(F.every((f, i) => !i || f.start >= F[i - 1].end), 'one at a time');
    assert.ok(new Set(F.map(f => f.start)).size === F.length, 'a phrase is used once');
  });
  t('never before the word is said', () => {
    for (const f of F) { const first = WORDS.find(w => w.start >= f.start - 1e-6 && w.word.replace(/[,.;:]+$/, '') === f.words[0][2]);
      assert.ok(first && Math.abs(first.start - f.start) < 1e-6, `"${f.text}" starts on its first word (${f.start})`);
      assert.ok(f.words.every(w => w[0] >= f.start && WORDS.some(q => q.start === w[0] && q.end === w[1])), 'every word carries its own spoken time');
      assert.strictEqual(f.words.map(w => w[2]).join(' '), f.text.replace(/\|/g, ' '), 'the word times are the words shown, in order');
      assert.strictEqual(f.snap, false, 'beat sync may not move it'); assert.ok(f.end >= f.words[f.words.length - 1][0], 'it stays until its last word has started'); }
  });
  t('never on the face: above the head or across the chest', () => { assert.ok(F.every(f => f.place === 'above' || f.place === 'chest'), JSON.stringify(F.map(f => f.place))); assert.strictEqual(F[5].place, 'chest', 'a title low in the reference sits on the chest'); });
  t('no one-word captions: every title is a phrase', () => { assert.ok(F.every(f => f.phrase && f.mode === 7 && (f.text.split(/[|\s]+/).length >= 2 || /\d/.test(f.text))), JSON.stringify(F.map(f => f.text))); });
  t('the reference\'s lines, key word, build, effect and exit on our words', () => {
    assert.strictEqual(F[0].text, 'This was the|cheapest|launch we ever ran'); assert.strictEqual(F[0].key, 'cheapest'); assert.strictEqual(F[0].build, 'word');
    assert.strictEqual(F[2].effect, 'type'); assert.strictEqual(F[2].build, 'letter'); assert.strictEqual(F[1].effect, 'stack-fade');
    assert.strictEqual(F[4].effect, 'count-up'); assert.deepStrictEqual(F[4].count, { from: 1, to: 365, unit: 'days' }); assert.strictEqual(F[4].key, '365 days');
    assert.strictEqual(F[5].effect, undefined, 'no second word of ours to swap in: no slot-roll');
    assert.ok(F.every(f => f.key == null || f.text.replace(/\|/g, ' ').includes(f.key)));
  });
  t('an exit that is the transition lands on a cut of ours, else it is dropped', () => {
    assert.strictEqual(F[3].exit, 'blow-up'); assert.strictEqual(F[3].end, 11, 'it ends on our cut');
    const pol = refs.map(x => ({ ...x, exit: 'polaroid' }));
    const withCuts = PT.mapPhrases(pol, WORDS, { k: 1, len: 20, cuts: CUTS }).flips, none = PT.mapPhrases(pol, WORDS, { k: 1, len: 20, cuts: [] }).flips;
    assert.ok(withCuts.filter(f => f.exit).every(f => CUTS.includes(f.end)) && withCuts.some(f => f.exit === 'polaroid')); assert.ok(none.every(f => !f.exit), 'no cut, no polaroid');
    assert.ok(withCuts.every(f => f.end >= f.words[f.words.length - 1][0]), 'never cut off before its last word');
  });
  t('scaled to our length (Recreate) and from a saved look with no text in it (Copy the look)', () => {
    const half = PT.mapPhrases(refs, WORDS.filter(w => w.start < 10), { k: 0.5, len: 10, cuts: [] }).flips;
    assert.ok(half.length >= 2 && half.length <= 4 && half.every(f => f.end <= 10), JSON.stringify(half.map(f => [f.start, f.text])));
    const shapes = refs.map(PT.shapeOf), txt = JSON.stringify(shapes);
    assert.ok(!/LOWEST|Question|PEOPLE|Kng|pitch/i.test(txt), 'a shape holds no words of the reference'); assert.ok(shapes[2].keyAlone && shapes[2].keyLine === 1 && shapes[2].lines === 3 && shapes[2].acrossCut);
    const look = PT.mapPhrases(shapes, WORDS, { k: 1, len: 20, cuts: CUTS }).flips; assert.deepStrictEqual(look.map(f => f.text), F.map(f => f.text), 'the same titles from the shapes alone');
    const d = join(TMP, 'look'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'Reel.md'), res.md);
    const L = SL.fromTeardown ? SL.fromTeardown(d, { name: 'p' }) : null;
    if (L) { assert.strictEqual(L.titles.phrases.length, 7); assert.strictEqual(L.captions.running, false); assert.ok(!/LOWEST|Question|Kng/.test(JSON.stringify(L.titles))); }
  });
  t('nothing to map: no titles, and the log line says so', () => { const m = PT.mapPhrases(refs, [], { len: 20 }); assert.deepStrictEqual(m.flips, []); assert.ok(/0 from your words/.test(m.line)); });
  console.log(`\n${n} phrase title tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
