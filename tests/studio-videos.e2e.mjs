// New video in a real Chrome, on synthetic media (tests/fixtures/studio-media.mjs):
// - the + by the job name opens one small dialog: a name (cleaned like the job field), Keep my look on, Start fresh
// - Start fresh clears the footage for the new job, keeps the look, lands on Footage and deletes nothing
// - More, Open a past video lists the old job with its date and reel count; opening it brings its footage back
// - the dialog closes with Escape, and the page logs no errors. Dark and light screenshots with --shots <dir>.
// Needs Chrome and ffmpeg. Run: node tests/studio-videos.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { rawTake } from './fixtures/studio-media.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-videos-e2e-')), P = process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
// plain names for screenshots when nothing by that name exists (the test removes its jobs at the end), else unique ones
const free = j => !existsSync(join(ROOT, 'jobs', j)) && !existsSync(join(ROOT, 'inbox', 'studio', j));
const SFX = shots && free('launch-teaser') && free('next-reel') ? '' : '-' + P;
const OLD = 'launch-teaser' + SFX, NEW = 'next-reel' + SFX;
if (shots) mkdirSync(shots, { recursive: true });
const made = [OLD, NEW, NEW + '-agent'].flatMap(j => [join(ROOT, 'jobs', j), join(ROOT, 'inbox', 'studio', j)]);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

const INBOX = join(ROOT, 'inbox', 'studio', OLD), TAKE = `inbox/studio/${OLD}/take.mp4`;
mkdirSync(INBOX, { recursive: true }); rawTake(join(ROOT, TAKE));
mkdirSync(join(ROOT, 'jobs', OLD), { recursive: true }); copyFileSync(join(ROOT, TAKE), join(ROOT, 'jobs', OLD, 'reel-v1.mp4'));

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: OLD, pack: 'cinematic', music: { bed: 'none' } });
  await api('/api/state', { footage: [TAKE] });
  const errs = [], ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } }), pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const ready = async hash => { await pg.goto(url + '/' + (hash || '#step=style'), { waitUntil: 'networkidle' }); await pg.waitForSelector('#new-video-open', { timeout: 30e3 }); await pg.waitForFunction(j => document.querySelector('#job').value === j, OLD, { timeout: 30e3 }); };
  const openDialog = async () => { await pg.click('#new-video-open'); await pg.waitForSelector('dialog#new-video[open] #nv-name', { timeout: 15e3 }); await pg.waitForFunction(() => document.activeElement && document.activeElement.id === 'nv-name', null, { timeout: 15e3 }); };

  await t('the + by the job name opens New video: a cleaned name, Keep my look on, Start fresh; Escape closes it', async () => {
    await ready();
    if (shots) { await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, 'newvideo-header-dark.png'), clip: { x: 0, y: 0, width: 760, height: 72 } }); }
    await openDialog();
    assert.strictEqual(await pg.getAttribute('#nv-keep', 'aria-checked'), 'true');
    assert.ok((await pg.textContent('dialog#new-video')).includes(OLD + ' is saved'));
    await pg.keyboard.press('Escape'); await pg.waitForFunction(() => !document.querySelector('dialog#new-video[open]'), null, { timeout: 15e3 });
    await openDialog();
    await pg.fill('#nv-name', `Next Reel${SFX.replace('-', ' ')}`);
    await pg.waitForFunction(j => document.querySelector('#nv-name-hint').textContent.includes(j), NEW);
    if (shots) { await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, 'newvideo-dark.png') }); }
  });

  await t('Start fresh: a clean board for the new job on Footage, the look kept, nothing deleted', async () => {
    await pg.click('#nv-start');
    await pg.waitForFunction(j => document.querySelector('#job').value === j, NEW, { timeout: 15e3 });
    await pg.waitForFunction(() => !document.querySelector('dialog#new-video[open]') && document.querySelector('main').dataset.step === 'footage', null, { timeout: 15e3 });
    assert.deepStrictEqual(await pg.evaluate(() => [document.querySelectorAll('main').length, document.querySelectorAll('#chat').length]), [1, 1], 'one board, one chat');
    const v = await api('/api/state');
    assert.strictEqual(v.state.job, NEW); assert.deepStrictEqual(v.state.footage, []); assert.strictEqual(v.state.pack, 'cinematic'); assert.strictEqual(v.state.music.bed, 'none');
    assert.deepStrictEqual(v.outputs, []);
    for (const f of [TAKE, `jobs/${OLD}/reel-v1.mp4`]) assert.ok(existsSync(join(ROOT, f)), 'kept ' + f);
    assert.ok(existsSync(join(STATE, 'videos', OLD + '.json')));
  });

  await t('More, Open a past video: the old job with its date and reel count; opening it brings its footage back', async () => {
    await pg.click('#more-open'); await pg.waitForSelector('#more-open-video', { timeout: 15e3 }); await pg.click('#more-open-video');
    await pg.waitForSelector(`dialog#new-video[open] #nv-list button[data-job="${OLD}"]`, { timeout: 15e3 });
    const row = await pg.textContent(`#nv-list button[data-job="${OLD}"]`);
    assert.ok(/1 reel/.test(row), row);
    assert.ok(!(await pg.$(`#nv-list button[data-job="${NEW}"]`)), 'the open video is not in the list');
    if (shots) { await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, 'newvideo-open-dark.png') }); }
    await pg.click(`#nv-list button[data-job="${OLD}"]`);
    await pg.waitForFunction(j => document.querySelector('#job').value === j, OLD, { timeout: 15e3 });
    const v = await api('/api/state');
    assert.deepStrictEqual(v.state.footage, [TAKE]); assert.strictEqual(v.outputs.length, 1);
    await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'footage');
  });

  await t('light theme: the same dialog reads on a light ground', async () => {
    await pg.click('#theme');
    assert.strictEqual(await pg.evaluate(() => document.documentElement.dataset.theme), 'light');
    await openDialog();
    await pg.fill('#nv-name', 'Next Reel');
    if (shots) { await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, 'newvideo-light.png') }); }
    await pg.click('#nv-to-open'); await pg.waitForSelector(`#nv-list button[data-job="${NEW}"]`, { timeout: 15e3 });
    if (shots) { await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, 'newvideo-open-light.png') }); }
    await pg.click('#nv-cancel'); await pg.waitForFunction(() => !document.querySelector('dialog#new-video[open]'));
    assert.strictEqual((await api('/api/state')).state.job, OLD, 'Cancel changes nothing');
  });
  await t('a switch made by your agent (new_video) moves the page to Footage with the new name', async () => {
    await pg.click('#stepper button[data-step="style"]'); await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'style');
    const AG = NEW + '-agent';
    await api('/api/videos/new', { name: AG });
    await pg.waitForFunction(j => document.querySelector('#job').value === j && document.querySelector('main').dataset.step === 'footage', AG, { timeout: 15e3 });
  });
  assert.deepStrictEqual(errs, []);
  console.log(`\n${n} studio New video checks passed`);
} finally {
  await browser.close().catch(() => {});
  srv.kill();
  for (const d of made) rmSync(d, { recursive: true, force: true });
  rmSync(STATE, { recursive: true, force: true });
}
