// The Studio builder step map (kit/studio/wizard/steps.json): one decision per screen, every option in the catalog
// owned by exactly one step (or All options), the featured options real, the part of the frame each step changes
// named, and the copy plain (the humanizer lint, no em dash). Run: node tests/wizard-steps.test.mjs   (npm run check runs it)
import assert from 'assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const R = createRequire(import.meta.url)('../kit/rules.cjs');
const C = await import('../kit/studio/core.mjs');
const VP = await import('../kit/studio/wizard/plan.mjs');
const M = JSON.parse(readFileSync(join(ROOT, 'kit', 'studio', 'wizard', 'steps.json'), 'utf8'));
const cat = C.catalog();
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const ZONES = ['captions', 'titles', 'presenter', 'seam', 'frame', 'time', 'sound', 'layout'];
const stepIds = M.steps.map(s => s.id);

t('the steps run in the order of the spec, pace first and music, notes and make last', () => {
  assert.deepStrictEqual(stepIds, ['pace', 'captionType', 'captionLook', 'wordsIn', 'titles', 'place', 'colors', 'fonts', 'keyWords', 'wordsPreview', 'transitions', 'presenter', 'graphics', 'filters', 'filterTiming', 'content', 'music', 'notes', 'make']);
  assert.strictEqual(new Set(stepIds).size, stepIds.length);
  const sec = M.sections.map(s => s.id);
  for (const s of M.steps) { assert.ok(sec.includes(s.section), s.id); assert.ok(ZONES.includes(s.zone), s.id + ' zone'); assert.ok(s.appliesTo && s.title && s.question, s.id + ' copy'); }
  // sections appear in one run each, in the bar's order
  const seen = M.steps.map(s => s.section).filter((x, i, a) => a[i - 1] !== x); assert.deepStrictEqual(seen, sec);
});

t('every catalog option has exactly one home (a step or All options), and nothing else is listed', () => {
  const want = Object.keys(cat.items).filter(r => !/^graphic:ref-/.test(r)).sort(), have = Object.keys(M.options).sort();
  assert.deepStrictEqual(have.filter(r => !want.includes(r)), [], 'listed but not in the catalog');
  assert.deepStrictEqual(want.filter(r => !have.includes(r)), [], 'in the catalog but not in steps.json: add it to options');
  for (const [r, o] of Object.entries(M.options)) {
    assert.ok(o.step === 'advanced' || stepIds.includes(o.step), r);
    if (o.step !== 'advanced') { assert.strictEqual(o.zone, M.steps.find(s => s.id === o.step).zone, r + ' zone matches its step'); const kinds = M.steps.find(s => s.id === o.step).kinds;
      if (kinds && cat.items[r].kind !== 'editing') assert.ok(kinds.includes(cat.items[r].kind), `${r} is a ${cat.items[r].kind}, not offered on ${o.step}`); }
  }
});

t('featured options exist and sit on the step that shows them', () => {
  for (const s of M.steps.filter(x => x.featured)) for (const id of s.featured) {
    const refs = (s.kinds || []).map(k => `${k}:${id}`).filter(r => cat.items[r]);
    assert.ok(refs.length, `${s.id}: ${id} is not in the catalog`);
    assert.ok(refs.some(r => M.options[r] && M.options[r].step === s.id), `${s.id}: ${id} belongs to another step`);
  }
});

t('the presenter effects in plan.mjs are the ones the Presenter step offers', () => {
  const fromMap = Object.entries(M.options).filter(([r, o]) => r.startsWith('effect:') && o.step === 'presenter').map(([r]) => r.slice(7)).sort();
  assert.deepStrictEqual([...VP.PRESENTER_EFFECTS].sort(), fromMap);
  for (const ids of Object.values(VP.GRAPHIC_GROUPS)) for (const id of ids) assert.strictEqual((M.options['graphic:' + id] || {}).step, 'graphics', id);
});

t('the copy is plain: the humanizer lint passes and there is no em dash or engine word', () => {
  const copy = [...M.sections.map(s => s.label), ...M.steps.flatMap(s => [s.title, s.question, s.appliesTo]), ...Object.values(VP.PACES).flatMap(p => [p.label, p.says])];
  for (const c of copy) { assert.deepStrictEqual(R.lintCopy(c).errs, [], c); assert.ok(!/\u2014/.test(c), c); assert.ok(!/\b(allow|deny|flag|layer|captionStyle)\b/i.test(c), c); }
});
console.log(`\nwizard steps: ${n} tests passed`);
