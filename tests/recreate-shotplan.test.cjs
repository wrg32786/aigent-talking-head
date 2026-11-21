// Recreate's shot plan (kit/shotplan.cjs, kit/videomd2reel.cjs, kit/cutpoints.cjs), no ffmpeg needed:
// - a multi-shot synthetic reference breakdown becomes a recipe with framing, cutaways, the reference's sound effects
//   as kit sounds, boxes and stickers as graphics slots, title roles, and no music bed when the music stem is quiet
// - one continuous take is re-cut to that shot plan, scaled to its length, every cut in the quiet between two words
//   (from the audio), the framing changing on every cut
// - a transcript running early is moved onto the sound, and an end set inside a clean pause never pulls in the next line
// Run: node tests/recreate-shotplan.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const SPL = require('../kit/shotplan.cjs'), CP = require('../kit/cutpoints.cjs'), RM = require('../kit/reelmd.cjs'), V = require('../kit/videomd2reel.cjs');
const { speech } = require('./fixtures/speech.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

// the reference: 6 shots over 12 s, close-ups and medium shots, a cutaway (no face) at 6 to 8 s, three sounds
const SHOTS = [[0, 2, 'close-up', 1], [2, 3.5, 'close-up', 1], [3.5, 6, 'medium close-up', 1], [6, 8, 'medium shot', 0], [8, 10, 'extreme close-up', 1], [10, 12, 'close-up', 1]];
const breakdown = {
  source: { file: 'ref.mp4', duration: 12 }, summary: { duration: 12 },
  shots: SHOTS.map(([a, b, size, faces], i) => ({ start: a, end: b, transition_in: i ? 'cut' : 'start', faces, material: { origin: faces ? 'real' : 'ai_generated', has_real_material: !!faces },
    aspects: { framing: { result: { shot_size: size } } }, overlay: { boxes: i === 2 ? [{ bbox: [0.1, 0.55, 0.8, 0.3], band: 'lower' }] : [] } })),
  audio: { music: { present: true, tempo_bpm: 120 } },
  stems: { level_db: { mix: -17, vocals: -18, music: -40, effects: -30 } },
  audio_plan: { sfx_merged: [{ t: 2.0, dur: 0.2, level_db: -22, type: 'pop' }, { t: 6.02, dur: 0.6, level_db: -20, type: 'ding', on: { type: 'cut' } }, { t: 9.1, dur: 0.05, level_db: -70, type: 'click' }] },
  packaging: { stickers: [{ t: 10.5, end: 11.5, what: 'a heart sticker', glyph: 'heart' }] },
  speech: { words: [], lines: [] },
};

let recipe;
t('the reference becomes a recipe: framing, cutaway, sounds, boxes, sticker, quiet music is no bed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotplan-')), f = path.join(dir, 'breakdown.json');
  fs.writeFileSync(f, JSON.stringify(breakdown));
  const out = V.convert ? V.convert(breakdown, {}, {}) : null;
  const md = out ? out.md : (require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'kit', 'videomd2reel.cjs'), f, '--out', path.join(dir, 'Reel.md'), '--report', path.join(dir, 'td.md')]), fs.readFileSync(path.join(dir, 'Reel.md'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'Reel.md'), md);
  recipe = RM.load(path.join(dir, 'Reel.md'));
  const v = RM.validate(recipe); assert.deepStrictEqual(v.errs, []);
  assert.strictEqual(recipe.shots.length, 6);
  assert.deepStrictEqual(recipe.shots.map(s => s.framing), ['close-up', 'close-up', 'medium close-up', 'medium shot', 'extreme close-up', 'close-up']);
  assert.deepStrictEqual(recipe.shots.map(s => !!s.cutaway), [false, false, false, true, false, false], 'the shot with no face is the cutaway');
  assert.deepStrictEqual(recipe.sfx.map(x => [x.start, x.type, x.sound]), [[2, 'pop', '11-pop-sticker'], [6.02, 'ding', '14-ui-notification']], 'the quiet click is left out');
  assert.strictEqual(recipe.music.bed, 'none', 'music at -40 dB is no bed');
  const g = recipe.graphics.map(x => x.type); assert.ok(g.includes('screen-card') && g.includes('sticker-pop'), 'a box and a sticker are graphics slots: ' + g);
  assert.ok(!/\u2014/.test(md), 'no em dash');
  const plan = RM.shotSettings(recipe); assert.deepStrictEqual(plan.map(p => p.dur), [2, 1.5, 2.5, 2, 2, 2]);
});

t('music level: -37 dB or lower is no bed; louder sets a bed volume', () => {
  assert.strictEqual(SPL.musicLevel({ music: -37.2, vocals: -18 }).bed, false);
  const l = SPL.musicLevel({ music: -21, vocals: -18 }); assert.ok(l.bed && l.vol > 0.16 && l.vol <= 0.3, JSON.stringify(l));
  assert.strictEqual(SPL.musicLevel({}), null);
});

t('cutaways: talk_share first, then no face, then not real footage', () => {
  assert.strictEqual(SPL.isCutaway({ talk_share: 0.2, faces: 1 }), true);
  assert.strictEqual(SPL.isCutaway({ talk_share: 0.9, faces: 0 }), false);
  assert.strictEqual(SPL.isCutaway({ faces: 0 }), true);
  assert.strictEqual(SPL.isCutaway({ faces: 1, material: { origin: 'ai_generated' } }), false);
});

// one continuous 10 s take: a word every 0.42 s, a 0.18 s gap between words, a longer pause after each sentence
const WORDS = []; { let x = 0.4; for (let k = 0; x < 9.4; k++) { WORDS.push([+x.toFixed(2), +(x + 0.24).toFixed(2), 'w' + k]); x += 0.42 + (k % 5 === 4 ? 0.3 : 0); } }
const ENV = CP.envelopeFromSamples(speech(10, { voiced: WORDS.map(w => [w[0], w[1]]) }));
const inWord = x => WORDS.some(w => x > w[0] - 0.06 && x < w[1] + 0.06);

t('a single take re-cut to the reference: scaled, cuts in the quiet between words, framing changes on every cut', () => {
  const segs = [{ file: 'take.mp4', in: 0, out: 10, fadeIn: 0.25 }];
  const r = SPL.recut(segs, () => WORDS, RM.shotSettings(recipe), (i, a, b) => SPL.quietFrom(CP, ENV)(a, b));
  assert.ok(r.plan.length >= 5, 'most of the 6 shots: ' + JSON.stringify(r.plan));
  // scaled: 12 s of reference on 10 s of take, so the reference's cut at 2 s lands near 1.67 s
  assert.ok(Math.abs(r.cuts[0].t - 2 * 10 / 12) < 0.6, 'first cut near 1.67 s: ' + r.cuts[0].t);
  for (const s of r.segs.slice(1)) assert.ok(!inWord(s.in), `a cut at ${s.in} is inside a word (or its 60 ms margin)`);
  // the audio runs on: pieces are back to back on the same file
  r.segs.forEach((s, i) => { if (i) assert.strictEqual(s.in, r.segs[i - 1].out); });
  assert.ok(Math.abs(r.segs.reduce((a, s) => a + s.out - s.in, 0) - 10) < 1e-6, 'nothing dropped');
  assert.ok(r.segs.slice(1).every(s => s.recut && !s.fadeIn), 'new cuts are marked recut');
  r.zoom.forEach((z, i) => { if (i) assert.ok(Math.abs(z - r.zoom[i - 1]) >= 0.04, 'framing changes on every cut: ' + r.zoom); });
  const cu = r.plan.find(p => p.framing === 'extreme close-up'); assert.ok(!cu || cu.zoom === 1.3);
  assert.ok(r.plan.some(p => p.cutaway), 'the cutaway shot is in the plan');
});

t('no quiet near a reference cut: that cut is left out, never forced into a word', () => {
  const solid = [[0, 10, 'one-long-word']], env = CP.envelopeFromSamples(speech(10, { voiced: [[0.2, 9.8]] }));
  const r = SPL.recut([{ file: 'x.mp4', in: 0, out: 10 }], () => solid, RM.shotSettings(recipe), (i, a, b) => SPL.quietFrom(CP, env)(a, b));
  assert.strictEqual(r.segs.length, 1); assert.strictEqual(r.skipped.length, 5);
});

t('an existing seam near a reference cut is used instead of a new one', () => {
  const segs = [{ file: 'a.mp4', in: 0, out: 1.7 }, { file: 'a.mp4', in: 2.2, out: 10 }];
  const r = SPL.recut(segs, () => WORDS, [{ dur: 2, framing: 'close-up' }, { dur: 10 }], null);
  assert.deepStrictEqual(r.cuts, [{ t: 1.7, on: 'seam' }]); assert.strictEqual(r.segs.length, 2);
});

t('a transcript running 0.27 s early is moved onto the sound', () => {
  const early = WORDS.map(w => [+(w[0] - 0.27).toFixed(2), +(w[1] - 0.27).toFixed(2), w[2]]);
  const o = CP.offsetOf(early, ENV); assert.ok(Math.abs(o.shift - 0.27) < 0.04, JSON.stringify(o));
  assert.ok(Math.abs(CP.align(early, ENV)[0][0] - WORDS[0][0]) < 0.04);
  assert.strictEqual(CP.offsetOf(WORDS, ENV).shift, 0, 'a transcript on time stays');
});

t('an end set inside a clean pause stays in it: the next line is not pulled back in', () => {
  // line one ends at 6.63 s, a pause to 7.20 s, the dropped line after; Whisper starts the next word early (6.70)
  const env = CP.envelopeFromSamples(speech(10, { voiced: [[5.2, 5.7], [5.9, 6.63], [7.2, 7.8], [7.95, 8.0]] }));
  const words = [[5.2, 5.7, 'line'], [5.9, 6.6, 'one.'], [6.7, 7.8, 'Dropped'], [7.85, 8.0, 'line']];
  const r = CP.snapRange([5.1, 6.75], words, env, 10);
  assert.ok(r.range[1] < 7.2 - 0.05 && r.range[1] >= 6.63 + 0.12, 'end kept in the pause: ' + JSON.stringify(r));
});

t('titles by role: hook, number, timer, brand, line', () => {
  assert.strictEqual(SPL.roleOf('Stop editing by hand', 0.5, 0), 'hook');
  assert.strictEqual(SPL.roleOf('10x faster', 5, 2), 'number');
  assert.strictEqual(SPL.roleOf('in 30 seconds', 5, 2), 'timer');
  assert.strictEqual(SPL.roleOf('ChatGPT', 6, 3), 'brand');
  assert.strictEqual(SPL.roleOf('Dropbox', 6, 3, ['dropbox']), 'brand');
  assert.strictEqual(SPL.roleOf('the whole setup', 8, 4), 'line');
  const mine = [{ text: 'Record once', start: 0.4 }, { text: 'in 10 minutes', start: 4 }, { text: '3 apps', start: 7 }];
  const ref = [{ text: 'STOP', start: 0.5, role: 'hook', entrance: 'slam' }, { text: '5 tools', start: 3, role: 'number', entrance: 'pop-zoom' }, { text: '60s', start: 6, role: 'timer', entrance: 'typewriter' }];
  const m = SPL.matchRoles(mine, ref);
  assert.deepStrictEqual(mine.map(f => m.get(f).entrance), ['slam', 'typewriter', 'pop-zoom']);
});

t('sound effects: the reference types map to kit sounds', () => {
  const SP = require('../kit/sfx-plan.cjs');
  for (const k of Object.keys(SPL.SFX)) assert.ok(SP.lookup(SPL.SFX[k]), k + ' -> ' + SPL.SFX[k]);
  assert.strictEqual(SPL.sfxId('unknown-thing'), '10-pop-bubble');
});

console.log(`recreate-shotplan: ${n} passed`);
