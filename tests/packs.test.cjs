// Tests for style packs, locks and the choices table (kit/packs.cjs, kit/locks.cjs, kit/choices.cjs).
// Run: node tests/packs.test.cjs   (npm run check runs the same self-tests)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test: t } = require('node:test');
const K = require('../kit/packs.cjs');
const L = require('../kit/locks.cjs');
const CH = require('../kit/choices.cjs');
const ROOT = path.dirname(__dirname);

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
const outlinePack = { format: K.FORMAT, formatVersion: K.FORMAT_VERSION, name: 'plain', version: '1.0.0', label: 'Plain captions', style: { captionOutline: 'none' } };
t('validate accepts each caption outline', () => {
  for (const captionOutline of ['none', 'thin', 'thick']) assert.deepStrictEqual(K.validate({ ...outlinePack, style: { captionOutline } }), []);
});
t('validate lists the allowed outlines for an invalid value', () => {
  for (const captionOutline of ['dotted', '', null]) {
    assert.match(K.validate({ ...outlinePack, style: { captionOutline } }).join('\n'), /captionOutline.*none, thin, thick/);
  }
});
t('the pack schema lists the same outlines as the reel flag', () => {
  const style = require('../packs/pack.schema.json').properties.style.properties;
  assert.deepStrictEqual(style.captionOutline?.enum, require('../kit/reelmd.cjs').CAPTION_LOOK['caption-outline'][1]);
});
for (const [name, flags, expected] of [
  ['the pack sets the outline in captions.js', [], 'none'],
  ['the caption outline flag overrides the pack in captions.js', ['--caption-outline', 'thin'], 'thin'],
]) t(name, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-outline-'));
  try {
    const pack = path.join(dir, outlinePack.name);
    fs.mkdirSync(pack);
    fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify(outlinePack));
    fs.writeFileSync(path.join(dir, 'clips.json'), JSON.stringify({ clips: [{ id: 'clip-001', file: 'clip.mp4', dur: 2, words: [] }] }));
    execFileSync(process.execPath, [path.join(ROOT, 'kit', 'reel.cjs'), '--draft', '--keep-ends', '--no-titles', '--clips', dir, '--jobs', dir, '--name', 'draft', '--pack', pack, ...flags]);
    const captions = require('../kit/rules.cjs').readCaptions(path.join(dir, 'draft', 'build', 'captions.js'));
    assert.strictEqual(captions.captionOutline, expected);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
t('the generated gallery matches docs/packs.md byte for byte', async () => {
  const { packsDoc } = await import('../kit/pack-preview.mjs');
  assert.ok(Buffer.from(packsDoc()).equals(fs.readFileSync(path.join(ROOT, 'docs', 'packs.md'))), 'generated gallery differs from docs/packs.md');
});
t('local-only previews skip the gallery, shipped previews and docs-only write it', async () => {
  const { shouldWritePacksDoc } = await import('../kit/pack-preview.mjs');
  const local = { origin: 'packs/local/plain' }, shipped = K.load(path.join(K.SHIPPED, 'neutral'));
  assert.strictEqual(shouldWritePacksDoc([local], false), false);
  assert.strictEqual(shouldWritePacksDoc([shipped], false), true);
  assert.strictEqual(shouldWritePacksDoc([local, shipped], false), true);
  assert.strictEqual(shouldWritePacksDoc([local], true), true);
});

for (const splitPlace of ['top', 'frame', 'pip', 'middle']) t(`pack:validate splitPlace ${splitPlace}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-split-'));
  try {
    const pack = { ...outlinePack, name: 'split', style: { splitPlace } };
    const folder = path.join(dir, pack.name);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'pack.json'), JSON.stringify(pack));
    const result = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'kit', 'packs.cjs'), 'validate', folder], { encoding: 'utf8' });
    const output = result.stdout + result.stderr;
    if (['top', 'frame'].includes(splitPlace)) assert.strictEqual(result.status, 0, output);
    else { assert.strictEqual(result.status, 1, output); assert.match(output, /style\.splitPlace.*top, frame/); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
t('the schema lists both split places and the top default', () => {
  const key = require('../packs/pack.schema.json').properties.style.properties.splitPlace;
  assert.deepStrictEqual(key?.enum, ['top', 'frame']);
  assert.strictEqual(key.default, 'top');
});
for (const splitPlace of ['top', 'frame']) t(`a ${splitPlace} pack fills split slots and preserves explicit places`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-split-'));
  try {
    const folder = path.join(dir, 'split');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'pack.json'), JSON.stringify({ ...outlinePack, name: 'split', style: { splitPlace } }));
    fs.writeFileSync(path.join(dir, 'clips.json'), JSON.stringify({ clips: [{ id: 'clip-001', file: 'clip.mp4', dur: 12, words: [] }] }));
    fs.writeFileSync(path.join(dir, 'insert.mp4'), '');
    const recipe = path.join(dir, 'Reel.md');
    fs.writeFileSync(recipe, ['---', 'videomd: 1', 'name: split', 'description: Split layouts', 'lang: en', 'shots: 1', 'source:', '  file: clip.mp4', '  duration: 12', 'x-reel: 1', '---', '# Split', '## Shots', '```videomd-timeline', '#01 0-12 | framing close-up', '```',
      '## B-roll', '```reel-broll', '#01 1-3 | kind split | src insert.mp4', '#02 4-6 | kind split | place top | src insert.mp4',
      '#03 7-9 | kind split | place frame | src insert.mp4', '#04 10-12 | kind split', '```'].join('\n'));
    execFileSync(process.execPath, [path.join(ROOT, 'kit', 'reel.cjs'), '--draft', '--keep-ends', '--no-titles', '--clips', dir, '--jobs', dir, '--name', 'draft', '--pack', folder, '--recipe', recipe]);
    const read = file => JSON.parse(fs.readFileSync(path.join(dir, 'draft', 'build', file), 'utf8'));
    assert.deepStrictEqual(read('cut.json').inserts.map(i => i.place), [splitPlace, 'top', 'frame']);
    assert.deepStrictEqual(read('plan.json').broll.map(s => s.place), [splitPlace, 'top', 'frame', splitPlace]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
