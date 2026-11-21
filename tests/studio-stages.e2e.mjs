// The stage status under a reference's progress bar (1.28.0), in a real Chrome with no keys and no network:
// - one live line names the stage (Downloading, Finding cuts, Reading graphics ...) and the bar follows real stages
// - a folded list shows every stage with a check as each finishes
// - a reload in the middle shows the same line (the server keeps it in the saved state)
// - a stage that stops shows one plain line with Try again, and Try again reads the reference again
// Needs Chrome. Run: node tests/studio-stages.e2e.mjs [--shots <dir>]
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import http from 'http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-stages-e2e-')), SDIR = join(STATE, 'studio'), HOLD = join(STATE, 'hold'), JOB = 'stages-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
mkdirSync(SDIR, { recursive: true }); mkdirSync(HOLD, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB }));
const CLIP = join(STATE, 'ref.mp4'); try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=24:duration=2', '-pix_fmt', 'yuv420p', CLIP]); } catch {}
if (!existsSync(CLIP)) { const b = Buffer.alloc(4096); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(CLIP, b); }
// the link is held back until the test lets it go, so the Downloading stage can be seen
let release; let gate = new Promise(r => { release = r; });
const media = http.createServer(async (q, res) => { if (q.url !== '/ref.mp4') { res.writeHead(404); return res.end(); } await gate; const b = readFileSync(CLIP); res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': b.length }); res.end(b); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '', STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs', FAKE_TEARDOWN_HOLD: HOLD };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(120); } };
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const go = st => writeFileSync(join(HOLD, 'go-' + st), '');
const item = async () => ((await api('/api/state')).state.reference.queue || []).slice(-1)[0];
const now = pg => pg.locator('#recreate-stages .stg-now');
const states = pg => pg.$$eval('#recreate-stages .stg-list li', els => els.map(e => e.dataset.state));
const shot = async (pg, name) => { if (!shots) return; await pg.waitForTimeout(350); await pg.screenshot({ path: join(shots, name) }); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await open(pg, '#step=start');

  await t('Start, Copy the look, a link: one line says Downloading and the list has every stage', async () => {
    await pg.click('#mode-look');
    await pg.fill('#recreate-link', `http://127.0.0.1:${media.address().port}/ref.mp4`);
    await pg.click('#recreate-add');
    await pg.waitForSelector('#recreate-stages');
    await until(async () => (await now(pg).textContent()) === 'Downloading');
    assert.strictEqual(await pg.locator('#recreate-stages .stg-now').count(), 1, 'one live line');
    assert.strictEqual(await pg.locator('#recreate-stages .stg-fold').evaluate(e => e.open), false, 'the list is folded');
    const labels = await pg.$$eval('#recreate-stages .stg-list li', els => els.map(e => e.children[1].textContent));
    assert.deepStrictEqual(labels, ['Downloading', 'Finding cuts', 'Reading captions', 'Reading camera moves', 'Transcribing', 'Reading music and sounds', 'Reading graphics', 'Reading framing', 'Reading colours', 'Building the recipe']);
    assert.strictEqual((await states(pg))[0], 'now');
    const it = await item(); assert.strictEqual(it.stages.stage, 'download'); assert.ok(it.stages.percent <= 10);
  });

  await t('the line and the bar follow the real stages, with a check as each finishes', async () => {
    release();
    await until(async () => (await now(pg).textContent()) === 'Finding cuts');
    const p1 = (await item()).stages.percent; assert.ok(p1 >= 10, 'the download counts: ' + p1);
    for (const st of ['cuts', 'captions', 'camera', 'transcribe', 'sound']) go(st);
    await until(async () => (await now(pg).textContent()) === 'Reading graphics');
    const it = await item(); assert.strictEqual(it.status, 'tearing'); assert.ok(it.stages.percent > p1 && it.stages.percent < 100, 'the bar moved: ' + it.stages.percent);
    await pg.click('#recreate-stages .stg-fold > summary');
    const st = await states(pg);
    assert.deepStrictEqual(st, ['done', 'done', 'done', 'done', 'done', 'done', 'now', 'todo', 'todo', 'todo']);
    assert.strictEqual(await pg.locator('#recreate-stages .stg-list li[data-state="done"] .stg-mark .ic').count(), 6, 'a check on each finished stage');
    assert.ok((await pg.locator('#recreate-stages .stg-fold > summary').textContent()).includes('6 of 10'));
    const bar = await pg.locator('#recreate-stages [role="progressbar"]').getAttribute('aria-valuenow'); assert.strictEqual(+bar, it.stages.percent);
    await shot(pg, 'ref-stages-dark.png');
  });

  await t('a reload in the middle shows the same stage', async () => {
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#recreate-stages');
    assert.strictEqual(await now(pg).textContent(), 'Reading graphics');
    assert.strictEqual((await states(pg)).filter(x => x === 'done').length, 6);
    if (shots) { await pg.evaluate(() => localStorage.setItem('studio.theme', 'light')); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#recreate-stages'); await pg.click('#recreate-stages .stg-fold > summary'); await shot(pg, 'ref-stages-light.png'); await pg.evaluate(() => localStorage.setItem('studio.theme', 'dark')); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#recreate-stages'); }
  });

  await t('the reference view of Picture shows the same line on the link', async () => {
    await open(pg, '#step=reference');
    const id = (await item()).id;
    await pg.waitForSelector(`#ref-stages-${id} .stg-now`);
    assert.strictEqual(await pg.locator(`#ref-stages-${id} .stg-now`).textContent(), 'Reading graphics');
    await open(pg, '#step=start'); await pg.waitForSelector('#recreate-stages');
  });

  await t('a stage that stops says so in plain words, with Try again', async () => {
    writeFileSync(join(HOLD, 'fail'), '');
    await pg.waitForSelector('#recreate-stages .stg-failed');
    const msg = await pg.locator('#recreate-stages .stg-failed').textContent();
    assert.ok(msg.includes('We stopped while reading graphics.'), msg); assert.ok(!/\u2014|Error|exit|node /.test(msg), msg);
    const it = await item(); assert.strictEqual(it.status, 'failed'); assert.strictEqual(it.stages.failed, 'graphics');
    await pg.click('#recreate-stages .stg-fold > summary');
    assert.strictEqual((await states(pg))[6], 'failed');
    await shot(pg, 'ref-stages-failed-dark.png');
    rmSync(join(HOLD, 'fail')); go('all');
    await pg.locator('#recreate-stages button', { hasText: 'Try again' }).click();
    await pg.waitForSelector('#recreate-ready');
    const done = await item(); assert.strictEqual(done.status, 'ready'); assert.strictEqual(done.stages.percent, 100); assert.ok(done.stages.list.every(x => x.state === 'done'));
    assert.strictEqual(await pg.locator('#recreate-stages').count(), 0, 'the stage line goes when the reference is ready');
  });

  assert.deepStrictEqual(errs, [], 'no page errors');
  console.log(`\n${n} checks passed`);
} finally {
  await browser.close(); srv.kill(); media.close();
  try { rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'teardown', `studio-${JOB}-r1`), { recursive: true, force: true }); rmSync(join(ROOT, 'teardown-in', 'studio', JOB), { recursive: true, force: true }); } catch {}
}
