// Copy the look (1.28.0): kit/stylelook.cjs (the style look file), kit/lookplan.cjs (a look on your take) and
// kit/fidelity.cjs (build/match.json). No ffmpeg, no Chrome, no Python.
// - a look from a teardown carries the style (framing mix and targets, grade target, captions, titles, sticker,
//   transitions, moves, pace, B-roll, music, sounds, loudness) and none of the reference's words or times
// - save, load, list and remove under LOOKS_DIR; a bad name or a broken file is refused
// - the look as a recipe has no shots, titles, graphics, sounds or script
// - the plan: shot lengths from the look's pace that add up to your edit, the same every run; every cut in the quiet
//   between two of your words, none inside a word; framing from the look's mix, close and wide taking turns
// - stickers on your own words: ordinals first, then numbers, then the words of your goal (kit/goalwords.cjs), then
//   names and repeated words, in the look's style, clear of titles; generic words never, fewer stickers instead
// - titles keep the look's count, entrances and layer; sounds follow its density and what it put them on
// - match.json: each part scored against the look or the recipe, null where nothing could be measured
// - reel.cjs: --style-look with --recipe is refused, an unknown look is refused
// Run: node tests/stylelook.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stylelook-'));
process.env.LOOKS_DIR = path.join(dir, 'looks');
const SL = require('../kit/stylelook.cjs'), LK = require('../kit/lookplan.cjs'), FID = require('../kit/fidelity.cjs'), RM = require('../kit/reelmd.cjs');
const ROOT = path.dirname(__dirname);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

// a teardown folder: 8 shots (long ones at 0.16 face height, short punch-ins at 0.19), starburst stickers, sounds
const td = path.join(dir, 'teardown'); fs.mkdirSync(td, { recursive: true });
fs.writeFileSync(path.join(td, 'Reel.md'), ['---', 'videomd: 1', 'name: ref-list', 'description: a list reel', 'source:', '  file: ref.mp4', '  duration: 40', 'shots: 8', 'lang: en', 'x-reel: 1', '---', '', '# ref', '',
  '## Brand kit', '- preset: auto', '- theme: neutral', '- colors: #da4559, #000509, #f2e8a0', '- fonts: theme', '- logo: none', '',
  '## Music', '- bed: none', '- bpm: ', '- beat-sync: off', '',
  '## Style', '- look: one-word', '- captions: one-word', '- caption-position: top', '- caption-color: #ffffff', '- caption-outline: none', '- caption-shadow: none', '- caption-case: lower', '- titles: on', '- title-layer: front', '- finish: none', '- transition: none', '- glitch: off', '- punch: on', '- effects: none', '',
  '## Shots', '', '```videomd-timeline',
  '#01 0-3 | story hook | framing medium close-up | face 0.16@0.33 | lab 42,2,10~22,5,7',
  '#02 3-4.2 | transition dip-white | framing medium close-up | face 0.19@0.32',
  '#03 4.2-13 | framing medium close-up | face 0.16@0.32 | lab 44,2,10~21,5,7 | shake on',
  '#04 13-14.3 | transition dip-black | framing medium close-up | face 0.19@0.32 | move drift',
  '#05 14.3-24 | framing medium close-up | face 0.165@0.33 | lab 43,2,9~21,5,7',
  '#06 24-25.4 | transition dip-white | framing medium close-up | cutaway on | face 0.19@0.33',
  '#07 25.4-36 | framing medium close-up | face 0.16@0.32 | lab 43,2,10~21,5,7',
  '#08 36-40 | story payoff | framing medium close-up | cutaway on | lab 70,0,2~30,3,3', '```', '',
  '## Titles', '', '```reel-titles', '#01 0.5-2.3 | entrance slam | layer front | role number | text TOP 5 SECRET PLUGINS', '```', '',
  '## Graphics', '', '```reel-graphics',
  '#01 3.1-4.1 | type ordinal-sticker | text FIRST | layer behind | shape starburst | spikes 10 | color #f2e8a0 | x 0.49 | y 0.42 | size 386',
  '#02 3.3-4.2 | type app-label | text OmniRoute | tile #da4559 | x 0.12 | y 0.5 | size 286',
  '#03 4.5-12 | type screen-card | border #d87b5b | y 0.68 | w 0.66 | subject~ OmniRoute',
  '#04 13.1-14.1 | type ordinal-sticker | text SECOND | layer behind | shape starburst | spikes 10 | color #f2e8a0 | x 0.49 | y 0.42 | size 386',
  '#05 24.1-25.1 | type ordinal-sticker | text THIRD | layer behind | shape starburst | spikes 12 | color #f2e8a0 | x 0.49 | y 0.42 | size 390', '```', '',
  '## Sound effects', '', '```reel-sfx', '#01 0.4-0.5 | type click | sound 33-ui-mouse-click | on~ subtitle_in', '#02 3.1-3.3 | type pop | sound 11-pop-sticker', '#03 13.1-13.3 | type pop | sound 11-pop-sticker', '#04 24.2-24.4 | type pop | sound 11-pop-sticker | on~ label_in', '```', '',
  '## Script', '', '```reel-script', '#01 0-3 | say Top five secret plugins nobody installs.', '#02 3-13 | say First, OmniRoute sends every request to the cheapest model.', '```', ''].join('\n'));
fs.writeFileSync(path.join(td, 'speech.json'), JSON.stringify({ ok: true, words: Array.from({ length: 100 }, (_, i) => [i * 0.4, i * 0.4 + 0.3, 'w' + i]) }));

let look;
t('a look from a teardown: the style of every part, and none of the reference\'s words or times', () => {
  look = SL.fromTeardown(td, { name: 'List Reel!', created: '2026-11-21T00:00:00.000Z' });
  assert.deepStrictEqual(SL.validate(look), []);
  assert.strictEqual(look.name, 'list-reel'); assert.strictEqual(look.version, 1); assert.strictEqual(look.kind, 'style-look');
  assert.deepStrictEqual(look.framing.mix, { MCU: 1 });
  const c = look.framing.classes.MCU; assert.ok(c.faceH >= 0.16 && c.faceH <= 0.19 && c.lo === 0.16 && c.hi === 0.19 && Math.abs(c.eyeY - 0.32) < 0.011, JSON.stringify(c));
  assert.ok(look.framing.changeRate >= 0.8, 'the framing changes on most cuts: ' + look.framing.changeRate);
  assert.deepStrictEqual(look.grade.target, { mean: [43.2, 2, 9.7], std: [21.1, 5, 7] }, 'the cutaway end card is not in the grade');
  assert.strictEqual(look.grade.shots.length, 4);
  assert.deepStrictEqual([look.captions.style, look.captions.position, look.captions.color, look.captions.case, look.captions.wordsPerCue, look.captions.accent], ['one-word', 'top', '#ffffff', 'lower', 1, '#da4559']);
  assert.deepStrictEqual([look.titles.on, look.titles.entrances, look.titles.layer, look.titles.count], [true, ['slam'], 'front', 1]);
  assert.deepStrictEqual({ shape: look.stickers.ordinal.shape, spikes: look.stickers.ordinal.spikes, color: look.stickers.ordinal.color, layer: look.stickers.ordinal.layer, count: look.stickers.ordinal.count }, { shape: 'starburst', spikes: 10, color: '#f2e8a0', layer: 'behind', count: 3 });
  assert.strictEqual(look.stickers.appLabel.tiles[0], '#da4559'); assert.strictEqual(look.stickers.screenCard.border, '#d87b5b');
  assert.deepStrictEqual(look.transitions.mix, { cut: 0.57, 'dip-white': 0.29, 'dip-black': 0.14 });
  assert.deepStrictEqual([look.moves.drift, look.moves.shake, look.moves.push], [0.13, 0.13, 0]);
  assert.deepStrictEqual([look.pace.shots, look.pace.shotMean, look.pace.hook, look.pace.shotMin, look.pace.shotMax, look.pace.cutOnPauses], [8, 5, 3, 1.2, 10.6, true]);
  assert.ok(look.pace.wordsPerSecond > 2.4 && look.pace.wordsPerSecond < 2.6 && look.pace.quantiles.length === 5);
  assert.deepStrictEqual([look.broll.cutaways, look.broll.layout, look.broll.cutawayShare], [2, 'card', 0.14]);
  assert.deepStrictEqual([look.music.present, look.music.bed], [false, null]);
  assert.deepStrictEqual([look.sfx.count, look.sfx.per10, look.sfx.types, look.sfx.on.stickers, look.sfx.on.titles], [4, 1, { click: 1, pop: 3 }, 3, 1]);
  assert.strictEqual(look.loudness.voiceLufs, -16);
  const text = JSON.stringify(look);
  for (const w of ['OmniRoute', 'SECRET', 'PLUGINS', 'nobody', 'cheapest', 'FIRST', 'SECOND']) assert.ok(!text.includes(w), 'the look holds none of the reference\'s words: ' + w);
  assert.ok(!('script' in look) && !('shots' in look) && !text.includes('"start"'), 'no timeline in the look');
});

t('save, load, list and remove; a bad name or a broken file is refused', () => {
  const r = SL.save(look, 'list-reel'); assert.ok(r.file.startsWith(process.env.LOOKS_DIR) && fs.existsSync(r.file));
  const back = SL.load('list-reel'); assert.strictEqual(back.name, 'list-reel'); assert.deepStrictEqual(back.framing, look.framing);
  assert.strictEqual(SL.load(r.file).name, 'list-reel', 'by path'); assert.strictEqual(SL.load(path.dirname(r.file) + path.sep).name, 'list-reel', 'by folder');
  SL.save(look, 'Second Look'); assert.deepStrictEqual(SL.list().map(l => l.name), ['list-reel', 'second-look']);
  const one = SL.list()[0]; assert.strictEqual(one.from, 'ref.mp4'); assert.strictEqual(one.created, '2026-11-21T00:00:00.000Z');
  for (const k of ['framing', 'grade', 'captions', 'pace', 'music', 'sfx']) assert.ok(typeof one.summary[k] === 'string' && one.summary[k].length > 3, 'summary ' + k);
  assert.ok(/medium close-up 100%/.test(one.summary.framing) && /starburst, 10 points/.test(one.summary.stickers) && one.summary.music === 'no music', JSON.stringify(one.summary));
  assert.ok(!JSON.stringify(one.summary).includes(String.fromCharCode(8212)));
  assert.throws(() => SL.save(look, '!!!'), /name/); assert.throws(() => SL.save({ name: 'x' }, 'x'), /Not a style look/);
  assert.strictEqual(SL.load('nope'), null); assert.strictEqual(SL.load('../../etc/passwd'), null);
  fs.mkdirSync(path.join(process.env.LOOKS_DIR, 'broken')); fs.writeFileSync(path.join(process.env.LOOKS_DIR, 'broken', 'look.json'), '{');
  assert.strictEqual(SL.load('broken'), null); assert.deepStrictEqual(SL.list().map(l => l.name), ['list-reel', 'second-look']);
  assert.strictEqual(SL.remove('second-look'), true); assert.strictEqual(SL.exists('second-look'), false); assert.strictEqual(SL.remove('second-look'), false);
  assert.throws(() => SL.fromTeardown(path.join(dir, 'nowhere')), /No Reel\.md/);
});

t('the look as a recipe: style, brand and music lines only, no timeline', () => {
  const r = SL.toRecipe(SL.load('list-reel'));
  assert.deepStrictEqual([r.shots, r.titles, r.graphics, r.sfx, r.script, r.cards], [[], [], [], [], [], []]);
  const p = RM.toPreset(r);
  assert.deepStrictEqual([p.captionStyle, p.captionPosition, p.captionColor, p.captionCase, p.look, p.bed, p.glitch, p.theme], ['one-word', 'top', '#ffffff', 'lower', 'one-word', null, false, 'neutral']);
  assert.deepStrictEqual(p.colors, ['#da4559', '#000509', '#f2e8a0']);
  const withMusic = SL.toRecipe({ ...look, music: { present: true, energy: 'high', bed: null }, musicKeys: { bed: 'none' } });
  assert.deepStrictEqual([withMusic.music.bed, withMusic.music.energy], ['auto', 'high']);
});

// your take: 30 s, a word every 0.5 s, a 0.3 s pause after every fourth word
const words = []; { let t0 = 0.2; const said = 'first you open the settings panel second you paste 300 tokens into the playground third you watch the dashboard light up and finally everything renders without mistakes okay'.split(' ');
  for (let i = 0; t0 < 29.4; i++) { words.push([+t0.toFixed(2), +(t0 + 0.38).toFixed(2), said[i % said.length]]); t0 += i % 4 === 3 ? 0.78 : 0.42; } }
const mkSegs = () => [{ file: 'take.mp4', in: 0, out: 30, fadeIn: 0.25 }];

t('the plan: lengths from the look that add up to your edit, the same on every run, framing from the mix', () => {
  const a = LK.shots(look, 30, 'job'), b = LK.shots(look, 30, 'job'), c = LK.shots(look, 30, 'other');
  assert.deepStrictEqual(a, b, 'the same seed gives the same plan'); assert.notDeepStrictEqual(a.map(s => s.dur), c.map(s => s.dur));
  assert.ok(Math.abs(a.reduce((x, s) => x + s.dur, 0) - 30) < 0.01, 'the shots fill the edit');
  assert.strictEqual(a[0].dur, 3, 'the hook first'); assert.ok(a.every(s => s.dur >= LK.MIN_LEN && s.dur <= 10.6 + 3), JSON.stringify(a.map(s => s.dur)));
  assert.ok(a.every(s => s.cls === 'MCU' && s.framing === 'medium close-up' && [0.16, 0.19].includes(s.face.faceH) && s.face.eyeY === look.framing.classes.MCU.eyeY));
  assert.ok(!a[0].transition && !a[0].cutaway && !a[0].shake, 'nothing on the first shot');
  const long = LK.shots(look, 600, 'job'), tr = long.filter(s => s.transition).length / (long.length - 1), sizes = new Set(long.map(s => s.face.faceH));
  assert.ok(tr > 0.3 && tr < 0.55, 'about the look\'s share of transitions: ' + tr); assert.strictEqual(sizes.size, 2, 'close and wide both used');
  assert.ok(long.some(s => s.move === 'drift') && long.some(s => s.shake) && long.some(s => s.cutaway));
  for (const w of long.map(s => s.transition).filter(Boolean)) assert.ok(['dip-white', 'dip-black'].includes(w));
  assert.ok(LK.shots({ ...look, pace: { shotMean: 3, shotSpread: 1 } }, 3, 'x').length === 1, 'a take shorter than two shots is one shot');
});

t('the cut: every cut in a pause between two of your words, none inside a word, none starting mid-word', () => {
  const segs = mkSegs(), r = LK.cut({ look, segs, words: () => words, quiet: null, seed: 'job' });
  assert.ok(r.rc.cuts.length >= 2, 'cuts: ' + JSON.stringify(r.rc.cuts)); assert.ok(segs.length === r.rc.cuts.length + 1);
  for (const sg of segs.slice(1)) {
    assert.ok(!words.some(w => sg.in > w[0] + 0.001 && sg.in < w[1] - 0.001), 'a cut inside a word at ' + sg.in);
    const before = words.filter(w => w[1] <= sg.in + 0.001).pop(), after = words.find(w => w[0] >= sg.in - 0.001);
    assert.ok(before && after && after[0] - before[1] >= 0.14, `the cut at ${sg.in} sits in a real pause`);
    assert.strictEqual(sg.recut, true);
  }
  for (let i = 1; i < segs.length; i++) assert.strictEqual(segs[i].in, segs[i - 1].out, 'the voice runs on across the cut');
  assert.ok(Math.abs(segs.reduce((a, s) => a + s.out - s.in, 0) - 30) < 0.001, 'nothing lost');
  assert.ok(r.rc.plan.every(p => p.cls === 'MCU' && p.framing === 'medium close-up') && /^look: \d+ shots on your 30\.0 s/.test(r.lines[0]), r.lines[0]);
  // no pauses at all: no cut is made
  const tight = Array.from({ length: 60 }, (_, i) => [i * 0.5, i * 0.5 + 0.5, 'word']), s2 = mkSegs(), r2 = LK.cut({ look, segs: s2, words: () => tight, quiet: null, seed: 'job' });
  assert.strictEqual(s2.length, 1); assert.ok(r2.rc.skipped.length > 0 && /no quiet between your words/.test(r2.lines[0]));
});

const tl = words.map(w => ({ start: w[0], end: w[1], word: w[2] }));
t('stickers: on your own words, ordinals first, then numbers, then keywords; the look\'s shape and colour; clear of titles', () => {
  const keys = LK.keyWords(tl); assert.deepStrictEqual(keys.slice(0, 3).map(k => k.kind), ['ordinal', 'ordinal', 'ordinal']);
  assert.strictEqual(keys[0].text, 'FIRST'); assert.ok(keys.some(k => k.kind === 'number' && k.text === '300'));
  const st = LK.stickers(look, tl, 30); // 0.75 per 10 s on 30 s: 2
  assert.strictEqual(st.flips.length, 2); assert.deepStrictEqual(st.flips.map(f => f.text), ['SECOND', 'THIRD'], 'the ordinal in the first second is too early; the next two are used');
  for (const f of st.flips) { assert.deepStrictEqual([f.mode, f.shape, f.spikes, f.color, f.layer, f.x, f.y, f.size], [9, 'starburst', 10, '#f2e8a0', 'behind', 0.49, 0.42, 386]); assert.ok(tl.some(w => w.word === f.spoken && Math.abs(w.start - 0.15 - f.start) < 0.01), 'placed on the word'); }
  assert.ok(st.lines.some(l => /app labels: the look keeps their style/.test(l)) && st.lines.some(l => /screen cards/.test(l)));
  const busy = LK.stickers(look, tl, 30, { busy: [{ start: st.flips[0].start, end: st.flips[0].end }] });
  assert.ok(!busy.flips.some(f => f.start === st.flips[0].start), 'not on a title');
  const plain = LK.stickers(look, [{ start: 2, end: 2.4, word: 'so' }, { start: 5, end: 5.6, word: 'Kubernetes' }, { start: 9, end: 9.4, word: 'and' }], 12);
  assert.deepStrictEqual(plain.flips.map(f => f.text), ['KUBERNETES'], 'a strong keyword when there is no ordinal or number');
  assert.deepStrictEqual(LK.stickers({ ...look, stickers: {} }, tl, 30).flips, []);
  // a sticker follows your face where the reframe could not reach the target
  const fl = [{ mode: 9, start: 5, end: 6, x: 0.49, y: 0.42, size: 386 }], moved = LK.placeOnFace(fl, [{ start: 0, end: 10, face: { faceH: 0.24, eyeY: 0.4, cx: 0.55 }, faceTarget: { faceH: 0.16, eyeY: 0.32, cx: 0.5 } }]);
  assert.strictEqual(moved, 1); assert.deepStrictEqual(fl[0], { mode: 9, start: 5, end: 6, x: 0.535, y: 0.55, size: 579 });
  assert.strictEqual(LK.placeOnFace([{ mode: 9, start: 5, end: 6, x: 0.49, y: 0.42, size: 386 }], [{ start: 0, end: 10, face: { faceH: 0.16, eyeY: 0.32, cx: 0.5 }, faceTarget: { faceH: 0.16, eyeY: 0.32, cx: 0.5 } }]), 0);
});

t('sticker words: ordinals, then numbers, then the goal\'s words, then names; generic words never; the look\'s density is the most', () => {
  const GW = require('../kit/goalwords.cjs');
  // the shared helper: stemmed content words, stopwords out, and a 0..1 overlap
  assert.deepStrictEqual(GW.contentWords('Show beginners they can build an app with AI in a weekend'), ['beginner', 'build', 'app', 'ai', 'weekend']);
  assert.strictEqual(GW.stem('building'), GW.stem('builds')); assert.strictEqual(GW.stem('posts'), 'post'); assert.strictEqual(GW.stem('Editing,'), GW.stem('edits'));
  assert.strictEqual(GW.overlap('Show beginners they can build an app with AI in a weekend', 'building apps'), 1);
  assert.strictEqual(GW.overlap('Show beginners they can build an app with AI in a weekend', 'the weather is nice'), 0);
  assert.strictEqual(GW.overlap('Show beginners they can build an app with AI in a weekend', 'a weekend of football'), 0.5);
  assert.strictEqual(GW.overlap('', 'anything'), 0); assert.ok(GW.STOPWORDS.has('the') && GW.isGeneric('Headlines,') && GW.isGeneric('carousel') && !GW.isGeneric('Kubernetes'));
  let t0 = 1; const said = 'so the first carousel gets 50% more headlines when beginners build an app over one weekend with Supabase and the important dashboard gets amazing results honestly'.split(' ');
  const w = said.map(x => { const o = { start: t0, end: t0 + 0.3, word: x }; t0 += 3; return o; }), len = t0 + 2;
  const goal = 'Show beginners they can build an app with AI in a weekend';
  const keys = LK.keyWords(w, { goal });
  assert.deepStrictEqual(keys.map(k => [k.text, k.kind]), [['FIRST', 'ordinal'], ['50%', 'number'], ['BEGINNERS', 'goal'], ['BUILD', 'goal'], ['APP', 'goal'], ['WEEKEND', 'goal'], ['SUPABASE', 'keyword']]);
  assert.ok(keys.every((k, i) => !i || keys[i - 1].rank >= k.rank), 'best first');
  for (const g of ['CAROUSEL', 'HEADLINES', 'IMPORTANT', 'DASHBOARD', 'AMAZING', 'RESULTS', 'HONESTLY']) assert.ok(!keys.some(k => k.text === g), g + ' is generic, or a plain word said once: no sticker');
  // with no goal the goal's words are plain words again: only the ordinal, the number and the name are left
  assert.deepStrictEqual(LK.keyWords(w).map(k => k.text), ['FIRST', '50%', 'SUPABASE']);
  // a name from the glossary counts at the start of a sentence too; a word you say twice is a keyword
  assert.deepStrictEqual(LK.keyWords([{ start: 1, end: 1.3, word: 'done.' }, { start: 2, end: 2.3, word: 'Claude' }, { start: 3, end: 3.3, word: 'edits' }], { names: ['claude'] }).map(k => k.text), ['CLAUDE']);
  assert.deepStrictEqual(LK.keyWords([{ start: 1, end: 1.3, word: 'done.' }, { start: 2, end: 2.3, word: 'Claude' }]).map(k => k.text), []);
  assert.deepStrictEqual(LK.keyWords('our pipeline is slow and the pipeline breaks'.split(' ').map((x, i) => ({ start: i, end: i + 0.3, word: x }))).map(k => k.text), ['PIPELINE']);
  // "the second I say it" is a length of time, not the second point
  assert.deepStrictEqual(LK.keyWords('it lands the second, I say its name'.split(' ').map((x, i) => ({ start: i, end: i + 0.3, word: x }))).map(k => k.text), []);
  assert.deepStrictEqual(LK.keyWords('and second, you paste it'.split(' ').map((x, i) => ({ start: i, end: i + 0.3, word: x }))).map(k => k.text), ['SECOND']);
  // the density is an upper bound: 0.75 per 10 s on this take is 6, and the best 6 are placed in rank order
  const st = LK.stickers(look, w, len, { goal });
  assert.strictEqual(st.want, Math.round(0.75 * len / 10)); assert.ok(st.want >= 6);
  assert.deepStrictEqual(st.flips.map(f => f.text), ['FIRST', '50%', 'BEGINNERS', 'BUILD', 'APP', 'WEEKEND', 'SUPABASE'].slice(0, st.want).sort((a, b) => said.findIndex(x => x.toUpperCase() === a) - said.findIndex(x => x.toUpperCase() === b)));
  // room for only two: the ordinal and the number win over the goal words
  const two = LK.stickers({ ...look, stickers: { ordinal: { ...look.stickers.ordinal, per10: 2 * 10 / len } } }, w, len, { goal });
  assert.deepStrictEqual(two.flips.map(f => f.text), ['FIRST', '50%']); assert.deepStrictEqual(two.kinds, ['ordinal', 'number']);
  // not enough good words: fewer stickers than the look has, never a generic one, and the log says so
  const few = LK.stickers(look, w, len);
  assert.deepStrictEqual(few.flips.map(f => f.text), ['FIRST', '50%', 'SUPABASE']); assert.ok(few.flips.length < few.want);
  assert.ok(few.lines.some(l => /only 3 of your words are strong enough/.test(l) && /--goal/.test(l)), few.lines.join('|'));
  const none = LK.stickers(look, 'this carousel gets more headlines and important results'.split(' ').map((x, i) => ({ start: 2 + i * 3, end: 2.3 + i * 3, word: x })), 30);
  assert.deepStrictEqual(none.flips, []); assert.ok(/none of your words made a sticker/.test(none.lines[0]));
});

t('titles and sounds: the look\'s count, entrances and layer; sounds at its density on your stickers, titles and cuts', () => {
  const flips = [{ mode: 7, start: 0.4, end: 2, text: 'A', entrance: 'pop-zoom' }, { mode: 0, start: 0, end: 1, text: 'cap' }, { mode: 7, start: 9, end: 11, text: 'B' }, { mode: 7, start: 20, end: 22, text: 'C' }];
  const tt = LK.titles(look, flips, 30); // 1.5 a minute on 30 s: 1
  assert.deepStrictEqual(tt.flips.filter(f => f.mode === 7).map(f => [f.text, f.entrance]), [['A', 'slam']]); assert.strictEqual(tt.flips.length, 2); assert.ok(/1 of your 3 drafted titles/.test(tt.line));
  const behind = LK.titles({ ...look, titles: { ...look.titles, perMin: 6, layer: 'behind', entrances: ['slam', 'slam', 'pop-zoom'] } }, flips.map(f => ({ ...f })), 30).flips.filter(f => f.mode === 7);
  assert.deepStrictEqual(behind.map(f => [f.entrance, f.layer]), [['slam', 'behind'], [undefined, 'behind'], ['pop-zoom', 'behind']], 'no entrance twice');
  const sx = LK.sounds(look, { stickers: [6.1, 14.2], titles: [0.4], cuts: [3.1, 9.4, 15.2, 22], len: 30 }); // 1 per 10 s: 3
  assert.strictEqual(sx.hits.length, 3); assert.deepStrictEqual(sx.hits.filter(h => h.on === 'stickers').map(h => [h.id, h.t]), [['11-pop-sticker', 6.1], ['11-pop-sticker', 14.2]]);
  assert.ok(sx.hits.every((h, i) => !i || h.t - sx.hits[i - 1].t >= 0.35)); assert.ok(/^sounds: 3 at the look's density/.test(sx.line));
  assert.deepStrictEqual(LK.sounds({ ...look, sfx: { count: 0 } }, { stickers: [1], titles: [], cuts: [2], len: 30 }).hits, []);
});

t('match.json: each part scored, null where nothing could be measured, honest about being an estimate', () => {
  const plan = { mode: 'look', shots: [{ start: 0, end: 5, face: { faceH: 0.16, eyeY: 0.32, cx: 0.5 }, faceTarget: { faceH: 0.16, eyeY: 0.32, cx: 0.5 } }, { start: 5, end: 10, face: { faceH: 0.24, eyeY: 0.42, cx: 0.5 }, faceTarget: { faceH: 0.16, eyeY: 0.32, cx: 0.5 }, clamped: true }, { start: 10, end: 15 }] };
  const cut = { segs: [{ in: 0, out: 15 }], sfxHits: [{ id: 'a', t: 1 }], sfx: {} }, caps = { captionStyle: 'one-word', captionPosition: 'top', captionColor: '#ffffff', captionCase: 'upper', flips: [{ mode: 9, start: 3, end: 4, shape: 'starburst' }] };
  const grade = { ok: true, single: true, skin: 0.35, shots: [{ before: 14, after: 4, strength: 0.85 }, { before: 16, after: 6, strength: 0.85 }, null] };
  const m = FID.measure({ mode: 'look', plan, cut, caps, grade, target: FID.targetOfLook(look, { len: 15, skipped: 1, planned: 4 }) });
  assert.deepStrictEqual([m.version, m.mode, m.against, m.estimate], [1, 'look', 'list-reel', true]);
  assert.deepStrictEqual(Object.keys(m.parts), ['framing', 'grade', 'captions', 'stickers', 'sfx', 'pace', 'font']);
  assert.strictEqual(m.parts.framing.shots.length, 2); assert.ok(m.parts.framing.score > 50 && m.parts.framing.score < 80, 'framing ' + m.parts.framing.score); assert.ok(/1 held back so the head stays in frame/.test(m.parts.framing.note));
  assert.deepStrictEqual([m.parts.grade.before, m.parts.grade.after, m.parts.grade.score], [15, 5, 80]);
  assert.deepStrictEqual(m.parts.captions.fields.case, { ours: 'upper', target: 'lower', equal: false }); assert.strictEqual(m.parts.captions.score, 50); // 3 of the 6 fields the look sets (outline and shadow "none" count)
  assert.deepStrictEqual(m.parts.stickers.count, { ours: 1, target: 1 }); assert.strictEqual(m.parts.stickers.score, 100);
  assert.deepStrictEqual(m.parts.sfx.per10, { ours: 0.7, target: 1 }); assert.strictEqual(m.parts.sfx.score, 70);
  assert.deepStrictEqual(m.parts.pace.shotMean, { ours: 5, target: 5 }); assert.strictEqual(m.parts.pace.score, 100); assert.ok(/1 wanted cut left out/.test(m.parts.pace.note));
  assert.ok(m.overall >= 0 && m.overall <= 100 && /^match: \d+ of 100 overall/.test(FID.line(m)));
  const none = FID.measure({ mode: 'recreate', plan: { shots: [{ start: 0, end: 15 }] }, cut, caps: { flips: [] }, grade: null, target: FID.targetOfRecipe(RM.load(path.join(td, 'Reel.md')), { k: 15 / 40, len: 15 }) });
  assert.strictEqual(none.parts.framing.score, null); assert.strictEqual(none.parts.grade.score, null); assert.strictEqual(none.against, 'ref-list');
  assert.deepStrictEqual(none.parts.stickers.count, { ours: 0, target: 3 }); assert.strictEqual(none.parts.stickers.score, 0); assert.strictEqual(none.parts.pace.shotMean.target, 1.88);
  const b = path.join(dir, 'b'); fs.mkdirSync(b); FID.write(b, m); assert.deepStrictEqual(FID.read(b), m); FID.drop(b); assert.strictEqual(FID.read(b), null);
});

t('reel.cjs: --style-look with --recipe is refused, and so is a look that does not exist', () => {
  const run = a => spawnSync(process.execPath, [path.join(ROOT, 'kit', 'reel.cjs'), ...a, '--jobs', path.join(dir, 'jobs'), '--name', 'x', '--draft'], { encoding: 'utf8', env: { ...process.env } });
  const both = run(['--style-look', 'list-reel', '--recipe', path.join(td, 'Reel.md'), '--clip', 'nope.mp4']);
  assert.ok(both.status !== 0 && /--style-look or --recipe, not both/.test(both.stderr), both.stderr);
  const unknown = run(['--style-look', 'no-such-look', '--clip', 'nope.mp4']);
  assert.ok(unknown.status !== 0 && /No style look "no-such-look"/.test(unknown.stderr), unknown.stderr);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`STYLE LOOK PASS (${n} tests)`);
