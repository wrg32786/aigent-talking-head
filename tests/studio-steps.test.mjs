// The Studio step map (1.28.0), with no Chrome and no server: the 8 steps in order, every old step name and saved
// place landing on the step that holds it now, each of the 9 layers owned by exactly one step, #menu= links, where the
// Your edit line's next action goes, and the match chips (Matched, Close, Off; never an empty row).
// Run: node tests/studio-steps.test.mjs   (npm run check runs it)
import assert from 'assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const S = await import('../kit/studio/web/src/steps.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

t('8 steps: the visual steps first, sound on its own, then Review and Render', () => {
  assert.deepStrictEqual(S.STEPS, ['start', 'cut', 'picture', 'text', 'broll', 'music', 'review', 'render']);
  assert.deepStrictEqual(S.STEPS.map(S.stepName), ['Start', 'Cut', 'Picture', 'Text and graphics', 'B-roll', 'Music and sounds', 'Review', 'Render']);
});

t('every old step name lands on a step that exists', () => {
  assert.deepStrictEqual(S.STEP_ALIAS, { footage: 'start', highlights: 'start', look: 'picture', style: 'picture', reference: 'picture', finish: 'review', post: 'render' });
  for (const [old, now] of Object.entries(S.STEP_ALIAS)) { assert.strictEqual(S.stepOf(old), now); assert.ok(S.STEPS.includes(now), old); assert.ok(!S.STEPS.includes(old), old + ' is only an old name'); }
  for (const st of S.STEPS) assert.strictEqual(S.stepOf(st), st);
  assert.strictEqual(S.stepOf('render'), 'render', 'render is its own step again, not Finish');
  assert.strictEqual(S.stepName('finish'), 'Review'); assert.strictEqual(S.stepName('footage'), 'Start');
});

t('the second views: Highlights inside Start, the reference inside Picture, Post inside Render', () => {
  assert.strictEqual(S.viewOf('highlights'), 'highlights'); assert.strictEqual(S.viewOf('reference'), 'reference'); assert.strictEqual(S.viewOf('post'), 'post');
  for (const st of ['style', 'look', 'picture', 'render', 'start', 'footage']) assert.strictEqual(S.viewOf(st), 'main', st);
  for (const st of ['cut', 'text', 'broll', 'music', 'review', 'finish']) assert.strictEqual(S.viewOf(st), null, st);
});

t('each of the 9 layers is shown by exactly one step', () => {
  const map = JSON.parse(readFileSync(join(ROOT, 'kit', 'studio', 'categories.json'), 'utf8'));
  const ids = map.layers.map(l => l.id), owned = Object.values(S.STEP_LAYERS).flat();
  assert.deepStrictEqual([...owned].sort(), [...ids].sort(), 'every layer has a step, and no step names a layer that is gone');
  assert.strictEqual(new Set(owned).size, owned.length, 'no layer on two steps');
  assert.deepStrictEqual(S.STEP_LAYERS.picture, ['color', 'motion', 'transitions', 'layout']);
  assert.deepStrictEqual(S.STEP_LAYERS.text, ['text', 'fonts', 'graphics']);
  assert.deepStrictEqual(S.STEP_LAYERS.broll, ['broll']); assert.deepStrictEqual(S.STEP_LAYERS.music, ['audio']);
  for (const st of Object.keys(S.STEP_LAYERS)) assert.ok(S.STEPS.includes(st), st);
});

t('#menu= links open the step that owns the layer', () => {
  const layers = [{ id: 'text', groups: [{ id: 'captions' }, { id: 'kinetic-text' }] }, { id: 'graphics', groups: [{ id: 'stickers' }] }, { id: 'audio', groups: [{ id: 'audio' }] }, { id: 'color', groups: [{ id: 'overlays' }] }];
  for (const [name, step] of [['music', 'music'], ['audio', 'music'], ['sfx', 'music'], ['transitions', 'picture'], ['color', 'picture'], ['motion', 'picture'], ['layout', 'picture'], ['text', 'text'], ['fonts', 'text'], ['graphics', 'text'], ['broll', 'broll']])
    assert.strictEqual(S.menuStep(name), step, name);
  // an old tab name is a group inside a layer
  assert.strictEqual(S.layerOf('captions', layers), 'text'); assert.strictEqual(S.menuStep('captions', layers), 'text');
  assert.strictEqual(S.menuStep('stickers', layers), 'text'); assert.strictEqual(S.menuStep('overlays', layers), 'picture');
  assert.strictEqual(S.layerOf('nope', layers), null); assert.strictEqual(S.menuStep('nope', layers), 'picture');
});

t('the next action: Draft it opens Review, Render opens Render', () => {
  assert.strictEqual(S.nextStep({ step: 'finish', label: 'Draft it' }), 'review');
  assert.strictEqual(S.nextStep({ step: 'finish', label: 'Render' }), 'render');
  assert.strictEqual(S.nextStep({ step: 'footage', label: 'Add footage' }), 'start');
  assert.strictEqual(S.nextStep({ step: 'review', label: 'Draft it' }), 'review');
  assert.strictEqual(S.nextStep({}), null); assert.strictEqual(S.nextStep(null), null);
});

t('match chips: Matched from 0.9, Close from 0.7, else Off, only for what was measured', () => {
  assert.deepStrictEqual(S.matchChips({ framing: 0.95, grade: 0.9, captions: 0.7, stickers: 0.69, sfx: null, pace: 0 }).map(c => [c.id, c.word]),
    [['framing', 'Matched'], ['grade', 'Matched'], ['captions', 'Close'], ['stickers', 'Off'], ['pace', 'Off']]);
  assert.deepStrictEqual(S.matchChips({ framing: null, grade: undefined }), []);
  assert.deepStrictEqual(S.matchChips(null), []); assert.deepStrictEqual(S.matchChips(undefined), []); assert.deepStrictEqual(S.matchChips({}), []);
  assert.deepStrictEqual(S.matchChips({ pace: 'fast', sfx: NaN }), [], 'only numbers count');
  // the engine's own shape (kit/fidelity.cjs build/match.json): scores out of 100 under parts, a part with no score left out
  assert.deepStrictEqual(S.matchChips({ overall: 85, parts: { framing: { score: 39, note: 'the take is closer' }, grade: { score: 83 }, captions: { score: 100 }, stickers: { score: null, note: 'n/a' }, sfx: { score: 93 }, pace: { score: 1 } } }).map(c => [c.id, c.word, c.note]),
    [['framing', 'Off', 'the take is closer'], ['grade', 'Close', null], ['captions', 'Matched', null], ['sfx', 'Matched', null], ['pace', 'Off', null]]);
});

t('no em dashes in the step map', () => { assert.ok(!/\u2014/.test(readFileSync(join(ROOT, 'kit', 'studio', 'web', 'src', 'steps.js'), 'utf8'))); });

console.log(`\n${n} checks passed`);
