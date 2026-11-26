// Record now, on the Recording tab, in a real Chrome with a fake camera and mic (--use-fake-device-for-media-stream gives a moving test
// pattern and a beep; --use-fake-ui-for-media-stream answers the permission prompt). Turns the camera on, films a
// take with the 3, 2, 1 countdown, stops, and checks the take was cropped to 9:16, converted to mp4 and added to the
// footage. Also checks the Scripts panel on Recording, the blocked-camera message, that the phone layout does not scroll
// sideways, Use a recording on Start, and a take filmed before any video is named going into a new video in one click.
// FAKE_VIDEO=<file.y4m> swaps the test pattern for a calmer clip (used for the docs screenshots).
// Needs Chrome and ffmpeg. Run: node tests/studio-record.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-record-e2e-')), JOB = 'record-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
// Studio keeps a live connection, so the page never goes network idle: wait for the stepper, and for the step a link names
const STEP_OF = { reference: 'picture', post: 'render' };
let newJob = null, held0 = null;
const ready = async (pg, hash = '') => { if (/tab=/.test(hash)) return pg.waitForSelector(`main[data-area="${hash.match(/tab=([a-z]+)/)[1]}"]`); await pg.waitForSelector('#stepper'); const st = (hash.match(/step=([a-z]+)/) || [])[1]; if (st) await pg.waitForSelector(`#stepper [aria-current="step"][data-step="${STEP_OF[st] || st}"]`); };
const open = async (pg, hash) => { await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await ready(pg, hash); };
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...(process.env.FAKE_VIDEO ? ['--use-file-for-fake-video-capture=' + process.env.FAKE_VIDEO] : [])] }));
try {
  await api('/api/state', { job: JOB });
  await t('record a take with the fake camera: countdown, 9:16 crop, mp4, in the footage', async () => {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } }), errs = [];
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await open(pg, '#step=start');
    // Start sends you to the Recording tab
    await pg.click('#use-recording'); await pg.waitForSelector('#s-recording:not([hidden])');
    assert.ok(/#tab=recording/.test(pg.url()), pg.url());
    await pg.click('#record-now');
    await pg.click('#rec-enable');
    await pg.waitForFunction(() => { const v = document.querySelector('#recorder video'); return v && v.videoWidth > 0 && !v.paused; }, null, { timeout: 15000 });
    assert.ok(await pg.$$eval('#rec-cam option', o => o.length) >= 1, 'camera list');
    assert.ok(await pg.$$eval('#rec-mic option', o => o.length) >= 1, 'mic list');
    await pg.waitForFunction(() => +document.querySelector('.rec-meter').getAttribute('aria-valuenow') > 0, null, { timeout: 8000 });
    await pg.getByRole('switch', { name: 'Teleprompter' }).click(); await pg.fill('#rec-script', 'Three things I wish I knew before my first reel.\nOne: film more than you need.');
    if (shots) await pg.screenshot({ path: join(shots, 'record-desktop.png') });
    await pg.click('#rec-start');
    await pg.waitForSelector('.rec-count', { timeout: 3000 });
    await pg.waitForSelector('#rec-stop', { timeout: 6000 });
    await pg.waitForFunction(() => !document.querySelector('.rec-count'), null, { timeout: 6000 });
    await pg.waitForTimeout(3200);
    await pg.click('#rec-pause'); await pg.waitForTimeout(800); await pg.click('#rec-pause');
    await pg.waitForTimeout(400);
    await pg.click('#rec-stop');
    await pg.waitForSelector('.take .tstate >> text=In footage', { timeout: 30000 });
    const s = (await api('/api/state')).state, take = s.takes[s.takes.length - 1];
    assert.strictEqual(take.status, 'ready', take.error);
    assert.ok(s.footage.includes(take.file), 'take in footage');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', join(ROOT, take.file)], { encoding: 'utf8' });
    const pj = JSON.parse(probe.stdout), v = pj.streams.find(x => x.codec_name === 'h264');
    assert.ok(v && pj.streams.some(x => x.codec_name === 'aac'), probe.stdout);
    assert.ok(Math.abs(v.width / v.height - 9 / 16) < 0.02, `${v.width}x${v.height}`);
    const dur = +pj.format.duration; assert.ok(dur > 2.5 && dur < 6, 'duration ' + dur);
    assert.ok(s.chat.some(m => m.kind === 'action' && /New take recorded/.test(m.text)));
    await pg.waitForTimeout(400);
    if (shots) { await pg.locator('#takes').scrollIntoViewIfNeeded(); await pg.evaluate(() => scrollBy(0, 120)); await pg.screenshot({ path: join(shots, 'record-takes.png') }); }
    // the take is in Your recordings, marked as in this video
    await pg.waitForSelector(`#recordings li[data-file="${take.file}"] .rec-in`);
    // switching tab while idle turns the camera off; the take is in the footage on Start
    await pg.click('#tab-new'); await pg.waitForSelector('#s-footage:not([hidden])');
    assert.ok(await pg.evaluate(() => !document.querySelector('#recorder video').srcObject), 'camera stopped off the tab');
    assert.ok(await pg.$('#footage video[aria-label="' + take.file + '"]'), 'footage list shows the take');
    await pg.click('#tab-recording'); await pg.waitForSelector('#s-recording:not([hidden])');
    assert.deepStrictEqual(errs.filter(e => !/favicon/.test(e)), []);
    await pg.close();
  });
  await t('scripts: write one, read it in Record; the teleprompter highlights lines on the take clock; the take keeps the script', async () => {
    await api('/api/scripts', { title: 'Morning reels', wpm: 160, text: '[hook]\nI film every reel before my first coffee.\n[body]\nThe light is soft, the house is quiet [pause] and nobody needs me yet.\nTwenty minutes gets me three takes.\n[cta]\nTry it tomorrow and tell me how it went.' });
    const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await open(pg, '#tab=recording');
    if (await pg.$('#recorder')) await pg.click('#recorder .rec-head .icon-btn');
    await pg.click('.sc-item:has-text("Morning reels")');
    await pg.waitForFunction(() => /\d+ words, about/.test(document.querySelector('#script-stats')?.textContent || ''));
    const stats = await pg.textContent('#script-stats'); assert.ok(/^36 words, about 15 s at 160 WPM, 1 pause$/.test(stats), stats);
    if (shots) { await pg.locator('#scripts').scrollIntoViewIfNeeded(); await pg.screenshot({ path: join(shots, 'scripts-desktop.png') }); }
    await pg.click('#script-read');
    await pg.click('#rec-enable');
    await pg.waitForFunction(() => { const v = document.querySelector('#recorder video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    await pg.waitForSelector('.rec-prompter p.now');
    assert.strictEqual(await pg.$eval('#rec-src', e => e.value), 'morning-reels');
    await pg.getByRole('switch', { name: '3, 2, 1 countdown' }).click();
    await pg.locator('#recorder').scrollIntoViewIfNeeded();
    await pg.evaluate(() => document.activeElement && document.activeElement.blur());
    await pg.keyboard.press('Space');
    await pg.waitForSelector('#rec-stop');
    await pg.waitForSelector('.rec-prompter p.now', { timeout: 8000 }); // the page re-renders as the take starts
    const first = await pg.$eval('.rec-prompter p.now', e => e.dataset.line);
    await pg.waitForFunction(f => document.querySelector('.rec-prompter p.now')?.dataset.line !== f, first, { timeout: 8000 });
    if (shots) await pg.screenshot({ path: join(shots, 'teleprompter-desktop.png') });
    await pg.keyboard.press('Space');
    let s, take; for (let i = 0; i < 200; i++) { s = (await api('/api/state')).state; take = s.takes[s.takes.length - 1]; if (take.status === 'ready' || take.status === 'failed') break; await pg.waitForTimeout(150); }
    assert.strictEqual(take.status, 'ready', JSON.stringify(take));
    assert.strictEqual(take.script && take.script.id, 'morning-reels'); assert.ok(/first coffee/.test(take.script.text));
    assert.deepStrictEqual(errs, []);
    await pg.close();
  });
  await t('a blocked camera shows one clear line and a retry', async () => {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await pg.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
    await open(pg, '#tab=recording');
    if (!(await pg.$('#recorder'))) await pg.click('#record-now');
    await pg.click('#rec-enable');
    await pg.waitForSelector('text=Camera or mic blocked');
    assert.strictEqual(await pg.textContent('#rec-enable'), 'Try again');
    await pg.close();
  });
  await t('phone layout: the recorder fits without sideways scroll', async () => {
    const pg = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await open(pg, '#tab=recording');
    if (!(await pg.$('#recorder'))) await pg.click('#record-now');
    await pg.click('#rec-enable');
    await pg.waitForFunction(() => { const v = document.querySelector('#recorder video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    await pg.waitForTimeout(500);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(over <= 1, 'scrolls sideways by ' + over);
    if (shots) await pg.screenshot({ path: join(shots, 'record-phone.png') });
    await pg.getByRole('switch', { name: 'Teleprompter' }).isChecked().then(on => on || pg.getByRole('switch', { name: 'Teleprompter' }).click());
    await pg.selectOption('#rec-src', 'morning-reels');
    await pg.waitForSelector('.rec-prompter p.now'); await pg.evaluate(() => scrollTo(0, 0));
    if (shots) await pg.screenshot({ path: join(shots, 'teleprompter-phone.png') });
    await pg.click('.sc-item:has-text("Morning reels")'); await pg.waitForSelector('#script-text');
    await pg.locator('#scripts').scrollIntoViewIfNeeded();
    if (shots) await pg.screenshot({ path: join(shots, 'scripts-phone.png') });
    await pg.close();
  });
  await t('a take filmed before any video is named waits, then Use in a new video starts one with it', async () => {
    await api('/api/videos/new', { name: JOB + '-a' }); await api('/api/state', { job: null });
    const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await open(pg, '#tab=recording');
    if (!(await pg.$('#recorder'))) await pg.click('#record-now');
    await pg.click('#rec-enable');
    await pg.waitForFunction(() => { const v = document.querySelector('#recorder video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    const cd = pg.getByRole('switch', { name: '3, 2, 1 countdown' }); if (await cd.isChecked()) await cd.click();
    await pg.click('#rec-start'); await pg.waitForSelector('#rec-stop'); await pg.waitForTimeout(2500); await pg.click('#rec-stop');
    await pg.waitForSelector('.take .tstate >> text=Not in a video yet', { timeout: 30000 });
    const held = (await api('/api/recordings')).recordings.find(x => x.job === null && /_recordings/.test(x.file));
    assert.ok(held, 'the take is in the holding folder'); held0 = held.file;
    assert.deepStrictEqual((await api('/api/state')).state.footage, [], 'no video, no footage');
    await pg.click(`#recordings li[data-file="${held.file}"] .rec-new`);
    await pg.waitForSelector('#s-footage:not([hidden])');
    const s = (await api('/api/state')).state; newJob = s.job;
    assert.ok(s.job && s.footage.length === 1 && s.footage[0].startsWith(`inbox/studio/${s.job}/takes/`), JSON.stringify(s.footage));
    assert.ok(!existsSync(join(ROOT, held.file)), 'the held take moved, not copied');
    assert.ok(existsSync(join(ROOT, s.footage[0])) && existsSync(join(ROOT, s.footage[0].replace(/\.mp4$/, '.json'))));
    assert.deepStrictEqual(errs, []);
    await pg.close();
  });
} finally {
  await browser.close(); srv.kill();
  for (const j of [JOB + '-a', newJob]) if (j) rmSync(join(ROOT, 'inbox', 'studio', j), { recursive: true, force: true });
  if (held0) for (const ext of ['.mp4', '.jpg', '.json']) rmSync(join(ROOT, held0.replace(/\.mp4$/, ext)), { force: true });
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio record browser tests passed`);
process.exit(0);
