// Studio report 6: a word box entirely on the person must produce valid extras JSON, and a corrupt
// extras.json must not abort the teardown (kit/teardown/extras.cjs loadExtras).
// Run: node tests/teardown-extras.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { loadExtras } = require('../kit/teardown/extras.cjs');

const py = process.env.PYTHON || [
  join(ROOT, '.venv', 'Scripts', 'python.exe'),
  join(ROOT, '.venv', 'bin', 'python'),
].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

t('a valid extras.json is returned as an object', () => {
  const d = mkdtempSync(join(tmpdir(), 'extras-ok-'));
  const f = join(d, 'extras.json');
  writeFileSync(f, JSON.stringify({ shots: [], mask: true, caption_look: { layer_samples: [] } }));
  const got = loadExtras(f);
  assert.deepStrictEqual(got.shots, []);
  assert.strictEqual(got.mask, true);
  rmSync(d, { recursive: true, force: true });
});

t('a corrupt extras.json (including NaN) drops layer hints instead of throwing', () => {
  const d = mkdtempSync(join(tmpdir(), 'extras-bad-'));
  const bad = join(d, 'bad.json'), nan = join(d, 'nan.json'), missing = join(d, 'nope.json');
  writeFileSync(bad, '{ not json');
  writeFileSync(nan, '{"layer_samples":[{"text_off_person": NaN}]}');
  assert.strictEqual(loadExtras(bad), null);
  assert.strictEqual(loadExtras(nan), null);
  assert.strictEqual(loadExtras(missing), null);
  // the teardown path: a failed load becomes {} and the step continues
  const extras = loadExtras(bad) || {};
  assert.deepStrictEqual(extras, {});
  rmSync(d, { recursive: true, force: true });
});

t('kit/teardown.mjs reads extras through loadExtras, not a bare JSON.parse', () => {
  const src = require('fs').readFileSync(join(ROOT, 'kit', 'teardown.mjs'), 'utf8');
  assert.ok(/loadExtras\(join\(out, 'extras.json'\)\)/.test(src), 'teardown.mjs should call loadExtras');
  assert.ok(!/if \(!ex\.status\) extras = JSON\.parse\(readFileSync\(join\(out, 'extras\.json'\)/.test(src),
    'the old bare JSON.parse of extras.json is gone');
  assert.ok(/note: extras failed \(no layer hints, vignette or contact sheet\)/.test(src));
});

function runPy(script) {
  const r = spawnSync(py, [join(ROOT, 'tests', script)], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    const out = ((r.stderr || '') + (r.stdout || '')).trim() || r.error?.message || 'exit ' + r.status;
    throw new Error(script + ' failed:\n' + out);
  }
  return (r.stdout || '') + (r.stderr || '');
}

const cap = runPy('test_teardown_extras.py');
if (/skipped=\d+/.test(cap)) console.log('ok caption_layer python tests skipped (no OpenCV)');
else console.log('ok caption_layer python tests');
n++;

runPy('test_ig_fetch.py');
console.log('ok ig_fetch python tests');
n++;

console.log(n + ' teardown-extras tests ok');
