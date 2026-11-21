// Influence per part and what the breakdown read (1.21.0), no Chrome, no ffmpeg:
// - Influence takes only the parts switched on (reference.parts): a part off takes its picks out, Recreate takes all
// - a bad parts patch is refused; the default leaves pace and sound yours
// - ranOf says which parts of the breakdown ran, each missing one with a fix id (never a command)
// Run: node tests/studio-recreate-parts.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
process.env.STUDIO_DIR = mkdtempSync(join(tmpdir(), 'studio-parts-'));
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const cat = C.catalog();
const EX = { name: 'ref', shots: 6, transitions: { crossfade: 3 }, entrances: ['slam'], finishes: ['teal'], graphics: [], effects: [], music: { bed: null }, captionStyle: 'kinetic',
  summary: { suggestions: [{ ref: 'transition:crossfade' }, { ref: 'entrance:slam' }, { ref: 'captionStyle:kinetic' }, { ref: 'finish:teal' }, { ref: 'beatSync:beat-sync' }, { ref: 'editing:punch' }].filter(x => cat.items[x.ref]) } };
const refs = p => Object.keys((p && p.picks) || {});

t('Influence by default: everything but pace and sound; Recreate: all of it', () => {
  const inf = refs(C.referenceLook(EX, 'influence', cat)), rec = refs(C.referenceLook(EX, 'recreate', cat));
  assert.ok(inf.includes('transition:crossfade') && inf.includes('captionStyle:kinetic'), inf);
  assert.ok(!inf.some(r => /^(editing|beatSync|bed):/.test(r)), 'pace and sound stay yours: ' + inf);
  for (const r of inf) assert.ok(rec.includes(r));
});
t('a part switched off takes its picks out; sound on brings beat sync in', () => {
  const off = refs(C.referenceLook(EX, 'influence', cat, { transitions: false, grade: false }));
  assert.ok(!off.includes('transition:crossfade') && !off.some(r => r.startsWith('finish:')), off);
  assert.ok(off.includes('captionStyle:kinetic'));
  if (cat.items['beatSync:beat-sync']) assert.ok(refs(C.referenceLook(EX, 'influence', cat, { sound: true })).includes('beatSync:beat-sync'));
});
t('the parts patch: switches stick, re-set the picks, and a bad one is refused', () => {
  const s = C.defaultState(); s.reference = { ...s.reference, status: 'ready', mode: 'influence', extracted: EX };
  C.applyPatch(s, { reference: { mode: 'influence' } }, cat);
  assert.ok((s.picks.transition || { allow: [] }).allow.includes('crossfade'));
  const r = C.applyPatch(s, { reference: { parts: { transitions: false } } }, cat);
  assert.ok(!(s.picks.transition || { allow: [] }).allow.includes('crossfade'), JSON.stringify(s.picks.transition));
  assert.strictEqual(s.reference.parts.transitions, false); assert.strictEqual(s.reference.parts.captions, true);
  C.applyPatch(s, { reference: { parts: { transitions: true } } }, cat);
  assert.ok(s.picks.transition.allow.includes('crossfade'));
  const bad = C.applyPatch(s, { reference: { parts: { colour: true } } }, cat);
  assert.ok((bad.errors || bad.errs || []).length || /reference\.parts/.test(JSON.stringify(bad)), JSON.stringify(bad).slice(0, 200));
  assert.deepStrictEqual(C.REF_PARTS.map(p => p.id), ['captions', 'titles', 'transitions', 'grade', 'effects', 'graphics', 'pace', 'sound', 'fonts']);
});
t('what the breakdown read: each part, and a fix id for the missing ones', () => {
  const d = mkdtempSync(join(tmpdir(), 'ran-')); mkdirSync(join(d, 'videomd')); writeFileSync(join(d, 'videomd', 'breakdown.json'), '{}'); writeFileSync(join(d, 'contact.jpg'), 'x');
  const ran = Object.fromEntries(C.ranOf(d, { script: [], sfx: [{}], music: { bpm: '120' } }).map(x => [x.id, x]));
  assert.ok(ran.reader.ok && ran.sheet.ok && ran.sounds.ok && ran.music.ok);
  assert.strictEqual(ran.speech.fix, 'model'); assert.strictEqual(ran.layers.fix, 'effects');
  const bare = Object.fromEntries(C.ranOf(mkdtempSync(join(tmpdir(), 'ran-')), {}).map(x => [x.id, x]));
  assert.strictEqual(bare.reader.fix, 'rea'); assert.strictEqual(bare.sounds.ok, false);
  for (const x of Object.values(bare)) assert.ok(!/npm |pip |python3? /.test(x.why), 'no command: ' + x.why);
});
console.log(`studio-recreate-parts: ${n} passed`);
