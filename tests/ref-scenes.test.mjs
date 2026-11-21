// Scenes made from a reference (1.22.0), no Chrome, no ffmpeg:
// - kit/scenes.cjs keeps a scene safe (no scripts, handlers or outside URLs), names it ref-..., keeps one copy of the same scene
// - a teardown makes a scene of the reference's sticker image, its styled text labels and effects its description names;
//   they land in the recipe as type scene, beside it in scenes.json, and in the library for every job
// - the menu shows them as REF items; picking one sends --scenes; Recreate takes the reference's no music bed
// - a timer or number slot in the reference none of your titles took gets a title from your own matching words
// Run: node tests/ref-scenes.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
process.env.SCENES_DIR = mkdtempSync(join(tmpdir(), 'scenes-'));
process.env.STUDIO_DIR = mkdtempSync(join(tmpdir(), 'studio-scenes-'));
const SC = require('../kit/scenes.cjs'), V = require('../kit/videomd2reel.cjs'), RM = require('../kit/reelmd.cjs'), SPL = require('../kit/shotplan.cjs');
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

const ok = { id: 'ref-glow-abc123', name: 'Glow', kind: 'effect', seconds: 1, box: { x: 0, y: 0, w: 1, h: 1 }, html: '<div class="g"></div>', css: '.g{position:absolute;inset:0;background:radial-gradient(#fff8,#0000);animation:a 1s}@keyframes a{to{opacity:0}}' };
await t('a scene is checked: no scripts, handlers or outside URLs, a length and a box', () => {
  assert.deepStrictEqual(SC.check(ok), []);
  for (const bad of [{ html: '<script>x</script>' }, { html: '<img src=x onerror=alert(1)>' }, { css: '.a{background:url(https://e.com/a.png)}' }, { html: '<img src="http://e.com/a.png">' }, { css: '@import "x.css";' }, { html: '<iframe></iframe>' }, { seconds: 20 }, { box: { x: 0, y: 0, w: 0, h: 0 } }, { id: 'glow' }])
    assert.ok(SC.check({ ...ok, ...bad }).length, JSON.stringify(bad));
  assert.deepStrictEqual(SC.check({ ...ok, html: '<img src="data:image/png;base64,AAAA">' }), []);
});
await t('the page fills the text slot, escaped, on a clear ground', () => {
  const p = SC.page({ ...ok, html: '<b>{{text}}</b>', text: 'WORD' }, '<i>five</i>');
  assert.ok(p.includes('<b>&lt;i&gt;five&lt;/i&gt;</b>') && /background:transparent/.test(p));
  assert.ok(SC.page({ ...ok, html: '<b>{{ text }}</b>', text: 'WORD' }).includes('<b>WORD</b>'));
});
await t('saved once: the same scene again keeps the first; remove takes it out', () => {
  const { id, ...rest } = ok;
  const a = SC.save({ ...rest, name: 'Glow' }), b = SC.save({ ...rest, name: 'Glow again' });
  assert.ok(a.added && !b.added && a.scene.id === b.scene.id && /^ref-glow-[0-9a-f]{6}$/.test(a.scene.id));
  assert.strictEqual(SC.list().length, 1);
  assert.ok(SC.remove(a.scene.id) && !SC.get(a.scene.id) && SC.list().length === 0);
});

// a reference with a sticker image, two looks of styled labels and a light leak its description names
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const pkg = mkdtempSync(join(tmpdir(), 'td-')); mkdirSync(join(pkg, 'packaging')); writeFileSync(join(pkg, 'packaging', 'sticker_01.png'), PNG);
const cue = (text, t0, style) => ({ text, t0, t1: t0 + 1, kind: 'label', bbox: [0.2, 0.3, 0.6, 0.03], style });
const B = { _dir: pkg, source: { file: 'ref.mp4', duration: 12 }, summary: { duration: 12 },
  shots: [0, 3, 6, 9].map((a, i) => ({ start: a, end: a + 3, transition_in: i ? 'cut' : 'start', faces: 1, vlm: i === 1 ? 'a warm light leak washes over the cut' : '' })),
  packaging: { stickers: [{ t: 10, end: 11, what: 'a heart sticker' }], text_cues: [cue('WOW', 1, { fill: '#ffee00', stroke: '#000000', stroke_ratio: 0.08 }), cue('YES', 4.5, { fill: '#ffee00', stroke: '#000000', stroke_ratio: 0.08 }), cue('OK', 7.5, { fill: '#ffffff', box: true, box_color: '#ff3366' })] },
  speech: { words: [], lines: [] } };
let res;
await t('a teardown makes scenes: the sticker image, the label looks, the light leak', () => {
  res = V.convert(B, {}, { dir: pkg });
  const kinds = res.scenes.map(s => s.kind + ':' + s.name);
  assert.ok(res.scenes.some(s => s.kind === 'graphic' && /data:image\/png;base64/.test(s.html)), 'sticker image: ' + kinds);
  assert.strictEqual(res.scenes.filter(s => /^Label:/.test(s.name)).length, 2, 'two label looks: ' + kinds);
  assert.ok(res.scenes.some(s => s.kind === 'effect' && /leak/i.test(s.name)), 'the light leak: ' + kinds);
  for (const s of res.scenes) assert.deepStrictEqual(SC.check(s), [], s.name);
  writeFileSync(join(pkg, 'Reel.md'), res.md);
  const r = RM.load(join(pkg, 'Reel.md'));
  assert.deepStrictEqual(RM.validate(r).errs, []);
  const sg = RM.graphicFlips(r).filter(f => f.mode === RM.GRAPHICS.scene);
  assert.ok(sg.length >= 4 && sg.every(f => res.scenes.some(s => s.id === f.scene)), 'recipe graphics of type scene: ' + sg.length);
  assert.ok(/Made for the menu/.test(res.report || ''), 'the report lists them');
});
await t('a scene graphic needs a ref- id', () => {
  const md = res.md.replace(/scene ref-[a-z0-9-]+/, 'scene glow');
  writeFileSync(join(pkg, 'Bad.md'), md);
  assert.ok(RM.validate(RM.load(join(pkg, 'Bad.md'))).errs.some(e => /scene/.test(e)));
});
await t('saved beside the recipe and in the library; the menu shows REF items', () => {
  const added = V.saveScenes(res, pkg);
  assert.strictEqual(added.length, res.scenes.length);
  assert.strictEqual(JSON.parse(readFileSync(join(pkg, 'scenes.json'), 'utf8')).scenes.length, res.scenes.length);
  assert.deepStrictEqual(V.saveScenes(res, pkg), [], 'twice adds nothing');
  const cat = C.catalog({ fresh: true }), refs = Object.values(cat.items).filter(i => i.made);
  assert.strictEqual(refs.length, res.scenes.length);
  assert.ok(refs.every(i => i.ref.startsWith('graphic:ref-') && i.preview && /\/api\/scenes\/ref-/.test(i.preview.url)));
  assert.ok(cat.scenesSig && cat.categories.some(c => c.id === 'ref-made'));
  const g = cat.layers.find(l => l.id === 'graphics'), col = cat.layers.find(l => l.id === 'color');
  assert.ok(JSON.stringify(g).includes('Made from your references') && JSON.stringify(col).includes('Made from your references'));
  const ex = C.extract(join(pkg, 'Reel.md'));
  assert.ok(ex.scenes.length === res.scenes.length && ex.scenes.every(s => s.inMenu), 'the breakdown says what was made');
  assert.ok(ex.plan && ex.plan.shots === 4);
});
await t('picking a scene sends --scenes, never into the graphics lock', () => {
  const id = res.scenes[0].id, s = C.load();
  s.picks.graphic = { allow: [id, 'ref-not-there-000000'], deny: [] };
  const { args } = C.compose(s), i = args.indexOf('--scenes');
  assert.ok(i >= 0 && args[i + 1] === id, args.join(' '));
  assert.ok(!args.join(' ').includes('graphics=' + id));
});
await t('Recreate takes the reference with no music bed as no bed', () => {
  const cat = C.catalog(), ex = { name: 'r', shots: 4, transitions: {}, entrances: [], finishes: [], graphics: [], effects: [], music: { bed: null, noBed: true }, summary: { suggestions: [] } };
  assert.strictEqual((C.referenceLook(ex, 'recreate', cat).music || {}).bed, 'none');
  assert.notStrictEqual((C.referenceLook(ex, 'influence', cat).music || {}).bed, 'none');
});
await t('Recreate tells the truth: music with no bed match is not "no music", no invented Look or glitch, forbidden scenes stay out', () => {
  const withMusic = { ...B, audio: { music: { present: true } }, stems: { level_db: { mix: -14, vocals: -16, music: -24 } }, audio_plan: { sfx_merged: [{ t: 2, dur: 0.3, level_db: -20, type: 'cha_ching' }] } };
  const r = V.convert(withMusic, {}, { dir: pkg });
  assert.match(r.md, /- bed: auto/, 'music heard, no library bed matched: the kit picks one');
  assert.match(r.md, /- preset: auto/); assert.match(r.md, /- transition: none/);
  assert.match(r.md, /type cha-ching/);
  writeFileSync(join(pkg, 'Music.md'), r.md);
  const ex = C.extract(join(pkg, 'Music.md'));
  assert.ok(!ex.music.noBed && ex.music.bed === null, JSON.stringify(ex.music));
  assert.ok(!Object.keys(ex.transitions).includes('glitch'), 'no glitch from nowhere');
  const L = require('../kit/locks.cjs'), cut = { segs: [{ in: 0, out: 1 }, { in: 1, out: 2, recut: true }, { in: 2, out: 3 }] };
  L.applyCut({ transitions: ['whip'] }, cut);
  assert.deepStrictEqual(cut.segs.map(x => x.transition || null), [null, null, 'whip'], 'a re-cut seam stays a hard cut');
  const s = C.load(), id = res.scenes[1].id; s.picks.graphic = { allow: [], deny: [id] };
  const { args } = C.compose(s), i = args.indexOf('--scenes-off');
  assert.ok(i >= 0 && args[i + 1] === id, args.join(' '));
});
await t('a timer or number slot nobody took gets your own words, whole words, near its time', () => {
  const w = s => s.split(' ').map((x, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, word: x }));
  const W = w('so you only need five minutes a day to learn three easy tricks okay');
  const ref = [{ start: 2, end: 4, text: '5:00', entrance: 'pop' }, { start: 5, end: 6, text: '3 TIPS' }, { start: 0, end: 1, text: 'STOP' }];
  const got = SPL.fillSlots(ref, [ref[2]], W, { k: 1, len: 10 });
  assert.deepStrictEqual(got.map(f => [f.text, f.role]), [['five minutes', 'timer'], ['three easy tricks', 'number']]);
  assert.strictEqual(got[0].entrance, 'pop', 'in the reference style');
  assert.deepStrictEqual(SPL.fillSlots(ref, [], W, { taken: [{ start: 1.5, end: 3.6 }], len: 10 }).map(f => f.text), ['three easy tricks'], 'not over a title of yours');
  assert.deepStrictEqual(SPL.fillSlots(ref, [], w('nothing to count here at all'), {}), []);
});
console.log(`ref-scenes: ${n} passed`);
