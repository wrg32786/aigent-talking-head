// kit/recreate.cjs: the Recreate steps kit/reel.cjs calls, and build/plan.json. No ffmpeg, no Chrome.
// - one scale for the edit against the reference; sounds, graphics and shakes placed with it
// - per-shot settings on re-cut shots and on clips
// - a recipe draft writes plan.json; Studio's reader takes its shots first and falls back to cut.json refShots
// Run: node tests/recreate-plan.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const RC = require('../kit/recreate.cjs'), RM = require('../kit/reelmd.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recreate-plan-'));
const rp = path.join(dir, 'ref.Reel.md');
fs.writeFileSync(rp, ['---', 'videomd: 1', 'name: ref4', 'description: a 4-shot reference', 'source:', '  file: ref.mp4', '  duration: 12', 'shots: 4', 'lang: en', 'x-reel: 1', '---', '', '# ref4', '',
  '## Brand kit', '- preset: auto', '- theme: neutral', '- colors: #101010, #FF5A1F, #f0f0f0', '- fonts: theme', '- logo: none', '',
  '## Shots', '', '```videomd-timeline', '#01 0-3 | framing close-up', '#02 3-6 | framing medium shot | punch big | transition flash | shake on', '#03 6-9 | framing close-up | finish grain | move push | cutaway on | broll a screen recording', '#04 9-12 | framing medium shot | move drift | shake on', '```', '',
  '## Sound effects', '', '```reel-sfx', '#01 3-3.2 | type pop | sound 11-pop-sticker', '#02 11.9-12 | type ding | sound 14-ui-notification', '#03 6-6.2 | type pop | sound no-such-sound', '```', ''].join('\n'));
const recipe = RM.load(rp);
const mkSegs = () => [{ file: 'a.mp4', in: 0, out: 2 }, { file: 'a.mp4', in: 2, out: 3, jump: true }, { file: 'b.mp4', in: 0, out: 1.5 }, { file: 'c.mp4', in: 0, out: 1.5 }];

t('scaleOf: the edit over the reference, from the source duration, else the last shot', () => {
  const s = RC.scaleOf(recipe, mkSegs());
  assert.deepStrictEqual(s, { len: 6, ref: 12, k: 0.5 });
  assert.strictEqual(RC.scaleOf({ card: {}, shots: [{ end: 8 }] }, mkSegs()).k, 0.75);
  assert.strictEqual(RC.scaleOf({ card: {}, shots: [] }, mkSegs()).k, 1);
});

t('applyShotPlan: on clips, a finish covers every segment of the clip, the rest goes on its first', () => {
  const segs = mkSegs(), { plan, shakeAt } = RC.applyShotPlan({ recipe, segs, clipStart: [0, 2, 3] });
  assert.strictEqual(plan.length, 4);
  assert.ok(!segs[0].transition && !segs[0].bigPunch);
  assert.ok(segs[2].bigPunch && segs[2].transition === 'flash');
  assert.ok(segs[3].finish === 'grain' && segs[3].push === 0.12 && segs[3].move === 'push');
  assert.deepStrictEqual(shakeAt, [2]);
  const quiet = mkSegs(); RC.applyShotPlan({ recipe, segs: quiet, clipStart: [0, 2, 3], wantPunch: false });
  assert.ok(!quiet[2].bigPunch);
});

t('applyShotPlan: on re-cut shots, by the recipe shot each one came from', () => {
  const segs = mkSegs(), rc = { shotStart: [0, 2, 3], shotOf: [0, 2, 3] };
  const { shakeAt } = RC.applyShotPlan({ recipe, segs, rc });
  assert.ok(segs[2].finish === 'grain' && segs[2].push === 0.12 && !segs[2].bigPunch);
  assert.ok(segs[3].push === 0.08 && segs[3].move === 'drift');
  assert.deepStrictEqual(shakeAt, [3]);
});

t('sounds, shakes and graphics use the one scale', () => {
  const segs = mkSegs(), scale = RC.scaleOf(recipe, segs);
  assert.deepStrictEqual(RC.refSounds(recipe, scale), [{ id: '11-pop-sticker', t: 1.5, ref: true }]); // one past the end, one unknown
  const shakes = RC.refShakes(segs, [2, 3]);
  assert.deepStrictEqual(shakes, [[3.08, 18], [4.58, 18]]);
  const cut = { hits: [[0.02, 14], [3, 24]] };
  assert.deepStrictEqual(RC.addShakes(cut, shakes), [4.58]); // 3.08 is within 0.2 s of the hit at 3
  assert.deepStrictEqual(cut.hits.map(h => h[0]), [0.02, 3, 4.58]);
  const gfx = [{ start: 4, end: 6 }];
  assert.strictEqual(RC.scaleGraphics(gfx, scale), true); assert.deepStrictEqual(gfx, [{ start: 2, end: 3.4 }]);
  assert.strictEqual(RC.scaleGraphics(gfx, { k: 1.005, len: 6 }), false);
});

t('accentFor: the first saturated colour that is not dark, lower case; none without colours', () => {
  assert.strictEqual(RC.accentFor(RM.toPreset(recipe)), '#ff5a1f');
  assert.strictEqual(RC.accentFor({ colors: ['#101010', '#eeeeee'] }), '#eeeeee');
  assert.strictEqual(RC.accentFor({ colors: ['#101010'] }), null);
  assert.strictEqual(RC.accentFor(null), null);
});

t('plan.json: written, read back, shots first and cut.json refShots as the fallback', () => {
  const build = path.join(dir, 'build'); fs.mkdirSync(build);
  const segs = mkSegs(); RC.applyShotPlan({ recipe, segs, clipStart: [0, 2, 3] });
  const shots = [{ start: 0, end: 3, ref: 1, zoom: 1.16 }, { start: 3, end: 6, ref: 3, zoom: 1, cutaway: true, broll: 'a screen recording' }];
  const old = [{ start: 1, end: 2, ref: 2, zoom: 1, cutaway: true }];
  assert.deepStrictEqual(RC.shotsOf(build, { refShots: old }), old); // no plan.json yet
  assert.deepStrictEqual(RC.shotsOf(build, {}), []);
  const plan = RC.writePlan(build, RC.planOf({ recipe, scale: { len: 6, ref: 12, k: 0.5 }, rc: { plan: shots }, cut: { segs }, shakes: [[3.08, 18]], sounds: [{ id: '11-pop-sticker', t: 1.5, ref: true }],
    flips: [{ mode: 0, start: 0, end: 1 }, { mode: 39, start: 2, end: 3, scene: 'ref-spin', sceneName: 'Spin' }], theme: 'neutral', accent: '#ff5a1f' }));
  assert.deepStrictEqual(Object.keys(plan), ['version', 'mode', 'recipe', 'scale', 'shots', 'transitions', 'moves', 'shakes', 'sounds', 'scenes', 'broll', 'theme', 'accent']);
  const back = RC.readPlan(build);
  assert.deepStrictEqual(back, plan);
  assert.ok(back.version === 1 && back.recipe === rp && back.scale === 0.5);
  assert.deepStrictEqual(back.transitions, [{ t: 3, name: 'flash' }]);
  assert.deepStrictEqual(back.moves, [{ t: 4.5, move: 'push', push: 0.12 }]);
  assert.deepStrictEqual(back.shakes, [{ t: 3.08, strength: 18 }]);
  assert.deepStrictEqual(back.sounds, [{ id: '11-pop-sticker', t: 1.5 }]);
  assert.deepStrictEqual(back.scenes, [{ start: 2, end: 3, scene: 'ref-spin', name: 'Spin' }]);
  assert.deepStrictEqual(RC.shotsOf(build, { refShots: old }), shots); // plan.json wins
  // a plan with no shots (a recipe draft without --recut), an unknown version or a broken file: cut.json refShots
  RC.writePlan(build, RC.planOf({ recipe, cut: { segs } }));
  assert.ok(RC.readPlan(build).scale === 1 && RC.readPlan(build).shots.length === 0);
  assert.deepStrictEqual(RC.shotsOf(build, { refShots: old }), old);
  fs.writeFileSync(path.join(build, 'plan.json'), JSON.stringify({ version: 99, shots }));
  assert.deepStrictEqual(RC.shotsOf(build, { refShots: old }), old);
  fs.writeFileSync(path.join(build, 'plan.json'), '{');
  assert.strictEqual(RC.readPlan(build), null);
  RC.dropPlan(build); assert.ok(!fs.existsSync(path.join(build, 'plan.json'))); RC.dropPlan(build);
});

t('reel.cjs: a draft from a recipe writes build/plan.json, a draft without one removes it', () => {
  const clips = path.join(dir, 'clips'); fs.mkdirSync(clips);
  const W = Array.from({ length: 12 }, (_, i) => [+(0.3 + i * 0.45).toFixed(2), +(0.6 + i * 0.45).toFixed(2), 'word' + i]);
  fs.writeFileSync(path.join(clips, 'clips.json'), JSON.stringify({ src: 'synthetic', clips: [0, 1, 2].map(i => ({ id: `clip-00${i + 1}`, file: `clips/clip-00${i + 1}.mp4`, dur: 2, status: 'keep', text: 'x', words: W.slice(i * 4, i * 4 + 4).map(w => [+(w[0] - i * 1.8).toFixed(2), +(w[1] - i * 1.8).toFixed(2), w[2]]) })) }));
  const reel = (...a) => execFileSync(process.execPath, [path.join(__dirname, '..', 'kit', 'reel.cjs'), '--clips', clips, '--jobs', path.join(dir, 'jobs'), '--name', 'p', '--no-mask', '--draft', '--force', ...a], { cwd: dir, stdio: 'pipe' });
  reel('--recipe', rp);
  const build = path.join(dir, 'jobs', 'p', 'build'), plan = RC.readPlan(build), cut = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8'));
  assert.ok(plan, 'plan.json written');
  assert.ok(plan.recipe === rp && plan.scale === 1 && plan.shots.length === 0 && !cut.refShots);
  assert.deepStrictEqual(plan.transitions, [{ t: 2, name: 'flash' }]);
  assert.ok(cut.segs[2].bigPunch && cut.segs[2].push == null); // the last clip keeps its big punch, so no move on it
  assert.deepStrictEqual(plan.moves, []);
  assert.deepStrictEqual(plan.shakes, [{ t: 2.08, strength: 18 }]);
  assert.ok(cut.hits.some(h => h[0] === 2) && !cut.hits.some(h => h[0] === 2.08)); // the seam's own hit covers it
  assert.ok(plan.theme === 'neutral' && plan.accent === '#ff5a1f');
  assert.match(fs.readFileSync(path.join(build, 'theme.js'), 'utf8'), /accent = '#ff5a1f'/);
  reel();
  assert.ok(!fs.existsSync(path.join(build, 'plan.json')), 'plan.json removed by a draft with no recipe');
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`RECREATE PLAN PASS (${n} tests)`);
