// Mix looks, the Look library, and sample plans (no Chrome, no network).
// Run: node tests/studio-mix-looks.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-mix-looks-'));
const LOOKS = join(STATE, 'looks');
process.env.STUDIO_DIR = STATE;
process.env.LOOKS_DIR = LOOKS;

const MIX = await import('../kit/studio/lookmix.mjs');
const SAMP = await import('../kit/studio/look-sample.mjs');
const SLK = await import('../kit/studio/stylelooks.mjs');
const { createRequire } = await import('module');
const SL = createRequire(import.meta.url)('../kit/stylelook.cjs');

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

function reel(dir, { name, captions, finish, transition, titles, theme, fonts }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Reel.md'), ['---', 'videomd: 1', `name: ${name}`, 'description: a 4-shot reference', 'source:', '  file: ref.mp4', '  duration: 12', 'shots: 4', 'lang: en', 'x-reel: 1', '---', '', `# ${name}`, '',
    '## Brand kit', '- preset: auto', `- theme: ${theme || 'neutral'}`, '- colors: #101010, #FF5A1F, #f0f0f0', `- fonts: ${fonts || 'theme'}`, '- logo: none', '',
    '## Style', `- captions: ${captions}`, '- look: kinetic', '- caption-position: bottom', '- caption-color: #f0f0f0', `- titles: ${titles || 'on'}`, `- finish: ${finish}`, `- transition: ${transition}`, '- punch: on', '',
    '## Shots', '', '```videomd-timeline',
    `#01 0-3 | framing close-up | face 0.17@0.33 | lab 42,2,10~22,5,7 | finish ${finish}`,
    `#02 3-6 | framing medium shot | transition ${transition} | face 0.17@0.33 | lab 42,2,10~22,5,7 | finish ${finish}`,
    `#03 6-9 | framing close-up | face 0.17@0.33 | lab 42,2,10~22,5,7 | finish ${finish}`,
    `#04 9-12 | framing medium shot | face 0.17@0.33 | lab 42,2,10~22,5,7 | finish ${finish}`,
    '```', '',
    '## Sound effects', '', '```reel-sfx', '#01 3-3.2 | type pop | sound 11-pop-sticker', '```', ''].join('\n'));
  return dir;
}

const A = reel(join(STATE, 'td-a'), { name: 'refA', captions: 'one-word', finish: 'teal', transition: 'flash', titles: 'on', theme: 'magazine', fonts: 'theme' });
const B = reel(join(STATE, 'td-b'), { name: 'refB', captions: 'pill', finish: 'warm', transition: 'crossfade', titles: 'off', theme: 'neutral', fonts: 'theme' });
const lookA = SL.fromTeardown(A, { name: 'look-a' });
const lookB = SL.fromTeardown(B, { name: 'look-b' });
SL.save(lookA, 'look-a');
SL.save(lookB, 'look-b');

await t('mix: captions from A, grade from B, no script or title words', () => {
  const mixed = MIX.mixLooks({
    name: 'mixed-ab',
    parts: { captions: { look: lookA, title: 'Ref A', kind: 'look', name: 'look-a' }, grade: { look: lookB, title: 'Ref B', kind: 'look', name: 'look-b' } },
    base: { look: lookA, title: 'Ref A', kind: 'look', name: 'look-a' },
  });
  assert.strictEqual(mixed.kind, 'style-look');
  assert.strictEqual(mixed.captions.style, lookA.captions.style);
  assert.strictEqual(mixed.grade.finish, lookB.grade.finish);
  assert.ok(!JSON.stringify(mixed).includes('Build your first')); // sample script is not stored on the look
  assert.ok(!mixed.script);
  assert.ok(MIX.mixSummary(mixed));
  assert.match(MIX.mixSummary(mixed), /Ref A/);
  assert.match(MIX.mixSummary(mixed), /Ref B/);
  SL.save(mixed, 'mixed-ab');
});

await t('mixAndSave from saved looks, and a bad part is refused', () => {
  const r = MIX.mixAndSave({ name: 'mixed-2', parts: { captions: { kind: 'look', name: 'look-a' }, grade: { kind: 'look', name: 'look-b' }, transitions: { kind: 'look', name: 'look-b' } } }, { queue: [], root: ROOT });
  assert.strictEqual(r.name, 'mixed-2');
  const got = SL.load('mixed-2');
  assert.strictEqual(got.captions.style, lookA.captions.style);
  assert.strictEqual(got.grade.finish, lookB.grade.finish);
  assert.strictEqual(got.transitions.default, lookB.transitions.default);
  let threw = false;
  try { MIX.mixAndSave({ name: 'x', parts: { colour: { kind: 'look', name: 'look-a' } } }); } catch (e) { threw = true; assert.match(e.message, /Unknown part|colour/i); }
  assert.ok(threw);
});

await t('rename, duplicate and delete a look', () => {
  const ren = SLK.rename('look-a', 'Look from A');
  assert.strictEqual(ren.label, 'Look from A');
  assert.strictEqual(SL.load('look-a').label, 'Look from A');
  const dup = SLK.duplicate('look-a');
  assert.ok(dup.name.endsWith('-copy'));
  assert.match(dup.label, /copy/i);
  assert.ok(SL.exists(dup.name));
  assert.ok(SLK.removeLook(dup.name));
  assert.ok(!SL.exists(dup.name));
  assert.ok(SL.exists('look-a'));
});

await t('sample plan covers the look parts; the sig changes when the grade changes', () => {
  const p = SAMP.samplePlan(lookA);
  assert.strictEqual(p.captionStyle, lookA.captions.style);
  assert.ok(p.titleOn);
  assert.strictEqual(p.finish, lookA.grade.finish);
  assert.ok(p.transition);
  assert.ok(p.punch);
  assert.ok(p.sfx);
  const a = SAMP.sigOf(lookA), b = SAMP.sigOf(lookB);
  assert.notStrictEqual(a, b);
  const same = SAMP.sigOf({ ...lookA, created: '2099-01-01', label: 'other' });
  assert.strictEqual(same, a);
});

await t('listView includes a mix line and a sample status', () => {
  const rows = SLK.listView();
  const mixed = rows.find(x => x.name === 'mixed-ab');
  assert.ok(mixed, JSON.stringify(rows.map(x => x.name)));
  assert.ok(mixed.mix);
  assert.ok(['missing', 'stale', 'ready'].includes(mixed.sample.status));
});

if (SAMP.modeOf().ffmpeg) {
  await t('build a cached sample and reuse it', () => {
    const first = SAMP.build('look-b');
    assert.strictEqual(first.status, 'ready');
    assert.ok(existsSync(first.file));
    assert.ok(statSize(first.file) > 1000);
    const again = SAMP.build('look-b');
    assert.strictEqual(again.mode, 'cached');
    const staleLook = { ...SL.load('look-b'), grade: { ...lookB.grade, finish: 'crushed' } };
    SL.save({ ...staleLook, name: 'look-b' }, 'look-b');
    const st = SAMP.statusOf('look-b', SL.load('look-b'));
    assert.strictEqual(st.status, 'stale');
    const rebuilt = SAMP.build('look-b');
    assert.strictEqual(rebuilt.status, 'ready');
    assert.notStrictEqual(rebuilt.sig, first.sig);
  });
} else {
  console.log('skip sample render (no ffmpeg)');
}

function statSize(f) { return readFileSync(f).length; }

console.log(`studio-mix-looks: ${n} passed`);
