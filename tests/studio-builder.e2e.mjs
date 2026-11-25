// The step by step builder (phase 4), in a real Chrome with no keys and no network:
// - the classic Start step links to it; #build=start opens the start screen with the three clip cards and Build my own
//   (Use a template is not shown yet)
// - Build my own opens Pacing: the zone map, the Applies to line, five pace cards with their moving strips
// - picking a pace saves the plan (GET /api/video-plan) and today's pace setting (state.pace.tighten), and says what it does
// - Continue in the classic steps lands on Picture; the old links still work
// - no terminal text, both themes, phone width
// Needs Chrome. Run: node tests/studio-builder.e2e.mjs [--shots <dir>]
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-builder-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'builder-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB }));
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#areas'); };
const shot = async (pg, name) => { if (!shots) return; await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name), fullPage: true }); };
const CMD = /\bnpm\b|\bnode kit\/|terminal|\$ /i;
const noCmd = async (pg, what) => { const txt = await pg.innerText('#main'); const m = txt.match(CMD); assert.ok(!m, `${what} shows a command: ${m && txt.slice(Math.max(0, m.index - 40), m.index + 40)}`); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));

  await t('the classic Start step links to the builder; #build=start shows the clip cards and Build my own only', async () => {
    await open(pg, '#step=start'); await pg.waitForSelector('#build-open');
    await pg.click('#build-open'); await pg.waitForSelector('main[data-build="start"] #build-start');
    for (const id of ['#build-src-recording', '#build-src-upload', '#build-src-link', '#build-own']) assert.ok(await pg.isVisible(id), id);
    assert.strictEqual(await pg.$('#build-template'), null, 'Use a template waits for the Template Library');
    assert.strictEqual(await pg.isVisible('#stepper'), false, 'the classic step bar steps aside');
    await pg.click('#build-src-link'); await pg.waitForSelector('#footage-url, input[type="url"]');
    await noCmd(pg, 'the start screen'); await shot(pg, 'builder-start-dark.png');
  });

  await t('Build my own opens Pacing with the zone map, the Applies to line and five pace cards', async () => {
    await pg.click('#build-own'); await pg.waitForSelector('main[data-build="pace"] #build-pace');
    assert.match(await pg.textContent('#build-pace .applies'), /^Applies to: The whole video/);
    assert.ok(await pg.$('#build-pace svg[role="img"]'), 'the zone map');
    assert.deepStrictEqual(await pg.$$eval('#build-paces [data-pace]', e => e.map(x => x.dataset.pace)), ['look', 'calm', 'steady', 'lively', 'high']);
    assert.match(await pg.textContent('#build-count'), /^Pace, 1 of 1$/);
    assert.ok(await pg.$('#build-sections [data-section="words"][disabled]'), 'sections not built yet say Coming soon');
    for (const id of ['calm', 'steady', 'lively', 'high']) assert.match(await pg.getAttribute(`#build-paces [data-pace="${id}"] img`, 'src'), new RegExp(`paces/${id}\\.webp$`));
  });

  await t('picking Lively saves the plan and today\'s pace, and says what it does', async () => {
    await pg.click('#build-paces [data-pace="lively"]');
    await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    assert.match(await pg.textContent('#build-does'), /Tight lines/);
    const v = await api('/api/video-plan'); assert.strictEqual(v.plan.pace, 'lively'); assert.ok(v.plan.touched.includes('pace'));
    const st = (await api('/api/state')).state; assert.strictEqual(st.pace.tighten, 0.45);
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    await noCmd(pg, 'Pacing'); await shot(pg, 'builder-pace-dark.png');
  });

  await t('Continue in the classic steps lands on Picture; Back returns to the start screen', async () => {
    await pg.click('#build-back'); await pg.waitForSelector('#build-start');
    await pg.click('#build-own'); await pg.waitForSelector('#build-pace');
    await pg.click('#build-next'); await pg.waitForSelector('main[data-step="picture"]:not([data-build])');
    assert.ok(await pg.isVisible('#stepper'));
    await open(pg, '#step=cut'); await pg.waitForSelector('main[data-step="cut"]:not([data-build])');
  });

  await t('cream theme and phone width', async () => {
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'light'));
    await open(pg, '#build=pace'); await pg.waitForSelector('#build-pace'); await shot(pg, 'builder-pace-light.png');
    await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(200);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 1, `the page is ${over}px wider than the phone`);
    await shot(pg, 'builder-pace-phone.png');
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'dark'));
  });

  assert.deepStrictEqual(errs, []);
  console.log(`\n${n} studio builder e2e tests passed`);
} finally { await browser.close(); srv.kill(); rmSync(STATE, { recursive: true, force: true }); }
