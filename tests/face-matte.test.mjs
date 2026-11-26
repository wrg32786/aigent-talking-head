// Face keep-out and the person mask, without a browser or a model: the BiRefNet tier names, the memory check (item 16 of
// the 2026-11-19 session report) and Studio's answer when memory is short. The pixel checks (the layout pass moving text
// off the face, facecheck.json, the face zone track) run in npm run smoke, which has Chrome and the Python packages.
// Run: node tests/face-matte.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const R = require('../kit/rules.cjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const withFree = (gb, fn) => { const o = process.env.MEMCHECK_FREE_GB; process.env.MEMCHECK_FREE_GB = String(gb); try { return fn(); } finally { if (o == null) delete process.env.MEMCHECK_FREE_GB; else process.env.MEMCHECK_FREE_GB = o; } };
const MC = require('../kit/memcheck.cjs');

await t('mask models: birefnet means the second tier (birefnet-portrait); lite and mediapipe stay; no bria or RVM', async () => {
  assert.strictEqual(R.MASK_MODELS.birefnet, 'birefnet-portrait');
  assert.strictEqual(R.MASK_MODELS['birefnet-general'], 'birefnet-general');
  assert.strictEqual(R.MASK_MODELS['birefnet-general-lite'], 'birefnet-lite');
  assert.strictEqual(R.maskSpec({ mask: 'mask.mkv', maskModel: 'birefnet' }).model, 'birefnet-portrait');
  assert.throws(() => R.maskSpec({ mask: 'mask.mkv', maskModel: 'bria-rmbg' }), /unknown mask model/);
  assert.throws(() => R.maskSpec({ mask: 'mask.mkv', maskModel: 'rvm' }), /unknown mask model/);
});
const previousProvider = process.env.MASK_PROVIDER;
await t('memory check on CPU: portrait and lite, short or enough, and the choices', async () => {
  process.env.MASK_PROVIDER = 'cpu';
  const portrait = MC.needGB('birefnet-portrait', 'cpu');
  assert.ok(portrait >= 8 && portrait < 9);
  assert.ok(MC.needGB('birefnet-lite', 'cpu') < portrait);
  const short = withFree(6, () => MC.check('birefnet'));
  assert.strictEqual(short.ok, false); assert.strictEqual(short.model, 'birefnet-portrait');
  assert.deepStrictEqual(short.options.map(o => o.id), ['front', 'light', 'anyway']);
  assert.match(short.message, /needs about 8\.\d GB and 6 GB is free/);
  assert.strictEqual(withFree(12, () => MC.check('birefnet')).ok, true);
  const mp = withFree(1, () => MC.check('mediapipe')); assert.strictEqual(mp.ok, true); assert.strictEqual(mp.needed, false);
});
await t('memory check on DirectML: refuse 24.6 GB free and allow 26 GB', async () => {
  process.env.MASK_PROVIDER = 'dml';
  const short = withFree(24.6, () => MC.check('birefnet'));
  assert.strictEqual(short.ok, false, '24.6 GB free must be refused on DirectML');
  assert.strictEqual(MC.needGB('birefnet-portrait', 'dml'), 25.8);
  assert.strictEqual(short.provider, 'dml');
  assert.match(short.message, /on DirectML/);
  assert.match(short.message, /needs about 25\.8 GB and 24\.6 GB is free/);
  assert.strictEqual(withFree(26, () => MC.check('birefnet')).ok, true);
});
await t('memory check with no MASK_PROVIDER: Windows is taken as DirectML, other systems as CPU', async () => {
  delete process.env.MASK_PROVIDER;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const on = os => { Object.defineProperty(process, 'platform', { ...platform, value: os }); return withFree(12, () => MC.check('birefnet')); };
  try {
    const win = on('win32'), linux = on('linux');
    assert.strictEqual(win.provider, 'dml'); assert.strictEqual(win.ok, false);
    assert.strictEqual(linux.provider, 'cpu'); assert.strictEqual(linux.ok, true);
  } finally { Object.defineProperty(process, 'platform', platform); }
});
if (previousProvider === undefined) delete process.env.MASK_PROVIDER;
else process.env.MASK_PROVIDER = previousProvider;

const venvPython = join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.PYTHON || (existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3');
if (spawnSync(python, ['--version']).status !== 0) console.log('skipped matte peak table comparison because Python is unavailable');
else await t('memory check: Python and JavaScript have identical peak tables', async () => {
  // Read the literal so this comparison also works without the optional mask packages.
  const readTable = [
    'import ast, json, pathlib; body = ast.parse(pathlib.Path("mask_refine.py").read_bytes()).body',
    'print(json.dumps(next(ast.literal_eval(n.value) for n in body if isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == "MATTE_PEAK_GB")))',
  ].join('\n');
  const peaks = spawnSync(python, ['-c', readTable], { cwd: join(ROOT, 'kit'), encoding: 'utf8' });
  assert.ifError(peaks.error);
  assert.strictEqual(peaks.status, 0, peaks.stderr);
  assert.deepStrictEqual(MC.PEAK_GB, JSON.parse(peaks.stdout));
});
await t('memory check on a job: only when something sits behind the head', async () => {
  const d = mkdtempSync(join(tmpdir(), 'memcheck-'));
  try {
    writeFileSync(join(d, 'cut.json'), JSON.stringify({ segs: [], overlay: 'ovl/%04d.png' }));
    assert.strictEqual(withFree(1, () => MC.renderCheck(d)).needed, false);
    writeFileSync(join(d, 'cut.json'), JSON.stringify({ segs: [], titles: 'ovlt/%04d.png', mask: 'mask.mkv' }));
    const r = withFree(3, () => MC.renderCheck(d)); assert.strictEqual(r.needed, true); assert.strictEqual(r.ok, false);
    writeFileSync(join(d, 'cut.json'), JSON.stringify({ segs: [], titles: 'ovlt/%04d.png', mask: 'mask.mkv', maskModel: 'mediapipe' }));
    assert.strictEqual(withFree(1, () => MC.renderCheck(d)).ok, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---------- through the server: Render with too little memory answers 409 with the numbers and the options ----------
const STATE = mkdtempSync(join(tmpdir(), 'face-matte-test-')), JOB = 'face-matte-test-' + process.pid, JOBDIR = join(ROOT, 'jobs', JOB);
mkdirSync(join(JOBDIR, 'build'), { recursive: true });
writeFileSync(join(JOBDIR, 'build', 'cut.json'), JSON.stringify({ segs: [{ file: 'x.mp4', in: 0, out: 1 }], titles: 'ovlt/%04d.png', mask: 'mask.mkv' }));
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', MEMCHECK_FREE_GB: '4' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const req = async (p, body) => { const r = await fetch(url + p, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => null) }; };
try {
  await req('/api/state', { job: JOB });
  await t('server: Render with 4 GB free and a mask to make is a 409 with the need, the free memory and the options', async () => {
    const r = await req('/api/render', {});
    assert.strictEqual(r.status, 409, JSON.stringify(r.j));
    assert.strictEqual(r.j.memory.model, 'birefnet-portrait'); assert.strictEqual(r.j.memory.freeGB, 4);
    assert.strictEqual(r.j.memory.provider, env.MASK_PROVIDER || (process.platform === 'win32' ? 'dml' : 'cpu'));
    assert.deepStrictEqual(r.j.memory.options.map(o => o.id), ['front', 'light', 'anyway']);
    assert.match(r.j.error, /Not enough free memory/);
  });
} finally { srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(JOBDIR, { recursive: true, force: true }); }
console.log(`${n} face and mask tests passed`);
