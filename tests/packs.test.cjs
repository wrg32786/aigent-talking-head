// Tests for style packs, locks and the choices table (kit/packs.cjs, kit/locks.cjs, kit/choices.cjs).
// Run: node tests/packs.test.cjs   (npm run check runs the same self-tests)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const K = require('../kit/packs.cjs');
const L = require('../kit/locks.cjs');
const CH = require('../kit/choices.cjs');
const ROOT = path.dirname(__dirname);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('locks self-test', () => assert.deepStrictEqual(L.selfTest(), []));
t('choices self-test', () => assert.deepStrictEqual(CH.selfTest(), []));
t('packs self-test (every shipped pack valid, with previews)', () => assert.deepStrictEqual(K.selfTest(), []));
t('shipped packs: the six looks, each a valid preset with its locks', () => {
  const names = K.shipped().map(p => p.name);
  for (const want of ['aigent', 'magazine', 'cinematic', 'hormozi-bold', 'minimal-clean', 'neutral']) assert.ok(names.includes(want), want);
  const m = K.toPreset(K.load('magazine'));
  assert.strictEqual(m.theme, 'magazine');
  assert.strictEqual(m.pack, 'magazine');
});
t('lock string parse and merge: later locks win key by key', () => {
  const a = L.parse('transitions=whip,zoom; no-graphics=checklist');
  const b = L.parse('titles=typewriter; graphics=versus');
  const m = L.merge(a, b, { transitions: ['cut'] });
  assert.deepStrictEqual(m, { transitions: ['cut'], graphics: { deny: ['checklist'], allow: ['versus'] }, titles: ['typewriter'] });
  assert.throws(() => L.parse('colour=red'), /unknown lock/);
});
t('pack:new scaffolds from a preset and from a pack, and the result validates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-pack-'));
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'kit', 'packs.cjs'), 'new', 'my-look', '--from', 'cinematic', '--dir', dir, '--lock', 'titles=typewriter', '--json'], { cwd: ROOT }).toString();
    assert.ok(JSON.parse(out).ok !== false);
    const p = K.load(path.join(dir, 'my-look'));
    assert.strictEqual(p.extends, 'cinematic');
    assert.deepStrictEqual(p.locks.titles, ['typewriter']);
    assert.ok(fs.existsSync(path.join(dir, 'my-look', 'README.md')));
    K.scaffold('from-pack', { from: 'magazine', dir });
    const q = K.load(path.join(dir, 'from-pack'));
    assert.deepStrictEqual(q.locks.transitions, ['crossfade', 'dissolve', 'fade-fast']);
    assert.deepStrictEqual(K.validate({ ...q, preview: undefined }), []);
    assert.throws(() => K.scaffold('my-look', { from: 'aigent', dir }), /exists/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
t('validate refuses an unknown format version, a GPL asset and a contradiction', () => {
  const base = { format: 'aigent-style-pack', formatVersion: 1, name: 'x', version: '1.0.0', label: 'x', extends: 'aigent' };
  assert.ok(K.validate({ ...base, formatVersion: 2 }).some(e => /formatVersion/.test(e)));
  assert.ok(K.validate({ ...base, assets: [{ path: 'a.ttf', license: 'GPL-3.0', source: 'x' }] }).some(e => /license/.test(e)));
  assert.ok(K.validate({ ...base, locks: { transitions: ['whip'] } }).some(e => /outside locks.transitions/.test(e)));
});
t('pack.schema.json lists every transition and title entrance the kit has', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'pack.schema.json'), 'utf8'));
  assert.deepStrictEqual(s.properties.locks.properties.transitions.items.enum, L.transitionNames());
  assert.deepStrictEqual(s.properties.locks.properties.titles.items.enum, require('../kit/rules.cjs').ENTRANCES);
});
console.log(`\n${n} pack tests passed`);
