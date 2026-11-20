// Settings folder fields in a real Chrome, with a made-up home folder:
// - Browse with no folder dialog on this computer opens the page's own folder list: places, breadcrumb, up, home,
//   New folder, Use this folder; no hidden folders and no files; Escape closes it
// - typing a path still works; Reset to default; Open folder (dry run)
// - Browse with a folder dialog (a stand-in command) fills the full path in with no list
// - the list fits a 375 px phone
// Needs Chrome. Run: node tests/studio-folders.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = mkdtempSync(join(tmpdir(), 'studio-folders-e2e-')), HOME = join(TMP, 'home');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
for (const d of ['Desktop', 'Downloads', 'Videos/2025', 'Documents', 'Projects/reels', '.ssh', 'AppData/Local']) mkdirSync(join(HOME, d), { recursive: true });
writeFileSync(join(HOME, 'notes.txt'), 'never listed');
// the native dialog stand-in is a small node script, so it runs on Windows too
const PICKED = join(HOME, 'Projects', 'reels'), fake = join(TMP, 'dialog.mjs');
writeFileSync(fake, `process.stdout.write(${JSON.stringify(PICKED)} + '\\n');\n`);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(120); } };
const env = { ...process.env, CI: '1', STUDIO_DIR: join(TMP, 'studio'), STUDIO_HOME: HOME, STUDIO_FOLDERS_NO_OPEN: '1', STUDIO_CHAT: '', STUDIO_DOWNLOADS: '', STUDIO_RENDERS: '', DISPLAY: '', WAYLAND_DISPLAY: '' };
const start = extra => new Promise((ok, bad) => {
  const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env: { ...env, ...extra } });
  let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok({ srv, url: m[1] }); }); srv.stderr.on('data', d => { out += d; });
  srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out.slice(-400))));
});
const servers = [];
const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const a = await start({}); servers.push(a.srv);
  const settings = async () => (await (await fetch(a.url + '/api/state')).json()).env.settings;
  await fetch(a.url + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { backend: 'keywords' } }) });
  const errs = [], ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(a.url); await pg.click('#open-settings'); await pg.waitForSelector('#set-renders-browse');

  await t('Browse with no folder dialog here opens the folder list: places, folders only, no hidden ones', async () => {
    await pg.click('#set-renders-browse'); await pg.waitForSelector('#folder-browser[open] #fb-path');
    await until(async () => (await pg.textContent('#fb-path')) === join(ROOT, 'jobs')); // an empty field starts at its default folder
    await pg.click('.fb-places button[data-place="home"]'); await until(async () => (await pg.textContent('#fb-path')) === HOME);
    const names = await pg.$$eval('#fb-list button', b => b.map(x => x.dataset.name));
    assert.deepStrictEqual(names, ['Desktop', 'Documents', 'Downloads', 'Projects', 'Videos'], names.join());
    const places = await pg.$$eval('.fb-places button', b => b.map(x => x.textContent));
    for (const p of ['Home', 'Desktop', 'Downloads', 'Videos', 'Kit folder']) assert.ok(places.includes(p), places.join());
    assert.ok(!(await pg.textContent('#folder-browser')).includes('notes.txt'));
    assert.ok(await pg.isDisabled('#fb-up'), 'home is the top');
  });
  await t('into a folder and back: the breadcrumb, Up and Home', async () => {
    await pg.click('#fb-list button[data-name="Videos"]'); await until(async () => (await pg.textContent('#fb-path')) === join(HOME, 'Videos'));
    await pg.click('#fb-list button[data-name="2025"]'); await until(async () => (await pg.textContent('#fb-path')) === join(HOME, 'Videos', '2025'));
    assert.deepStrictEqual((await pg.$$eval('.fb-crumbs button', b => b.map(x => x.textContent))).slice(-3), ['home', 'Videos', '2025']);
    await pg.click('#fb-up'); await until(async () => (await pg.textContent('#fb-path')) === join(HOME, 'Videos'));
    await pg.click('#fb-home'); await until(async () => (await pg.textContent('#fb-path')) === HOME);
    await pg.click('.fb-places button[data-place="videos"]'); await until(async () => (await pg.textContent('#fb-path')) === join(HOME, 'Videos'));
  });
  await t('New folder, then Use this folder fills the field; Save keeps it', async () => {
    await pg.click('#fb-new'); await pg.fill('#fb-new-name', '../nope'); await pg.click('#fb-new-ok');
    await until(async () => /plain folder name/.test(await pg.textContent('.fb-err')));
    await pg.fill('#fb-new-name', 'Finished reels'); await pg.click('#fb-new-ok');
    await until(async () => (await pg.textContent('#fb-path')) === join(HOME, 'Videos', 'Finished reels'));
    assert.ok(existsSync(join(HOME, 'Videos', 'Finished reels')));
    if (shots) { await pg.click('#fb-up'); await until(async () => (await pg.$$('#fb-list button[data-name="Finished reels"]')).length > 0); await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, 'folder-browser.png') }); await pg.click('#fb-list button[data-name="Finished reels"]'); await until(async () => (await pg.textContent('#fb-path')).endsWith('Finished reels')); }
    await pg.click('#fb-use'); await until(async () => !(await pg.$('#folder-browser')));
    assert.strictEqual(await pg.inputValue('#set-renders'), join(HOME, 'Videos', 'Finished reels'));
    await pg.click('#save-settings'); await until(async () => (await settings()).renders === join(HOME, 'Videos', 'Finished reels'));
  });
  await t('typing a path still works; Open folder; Reset to default; Escape closes the list', async () => {
    await pg.click('#open-settings'); await pg.waitForSelector('#set-downloads');
    await pg.fill('#set-downloads', join(HOME, 'Downloads')); 
    if (shots) { const fs = pg.locator('fieldset:has(#set-downloads)'); await fs.scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); await fs.screenshot({ path: join(shots, 'folder-fields.png') }); }
    await pg.click('#set-downloads-open'); await pg.waitForSelector('text=Would open ' + join(HOME, 'Downloads'));
    await pg.click('#set-renders-list'); await pg.waitForSelector('#folder-browser[open]');
    await until(async () => (await pg.textContent('#fb-path')) === join(HOME, 'Videos', 'Finished reels')); // the list starts at the field's folder
    await pg.keyboard.press('Escape'); await until(async () => !(await pg.$('#folder-browser')));
    assert.ok(await pg.isVisible('#settings-form'), 'Escape closes only the list, not Settings');
    await pg.click('#set-renders-reset'); assert.strictEqual(await pg.inputValue('#set-renders'), '');
    await pg.click('#save-settings'); await until(async () => { const s = await settings(); return s.downloads === join(HOME, 'Downloads') && !s.renders; });
  });
  await t('the folder list fits a 375 px phone', async () => {
    const p2 = await (await browser.newContext({ viewport: { width: 375, height: 760 } })).newPage();
    await p2.goto(a.url); await p2.waitForSelector('#open-settings'); await p2.evaluate(() => document.querySelector('#open-settings').click()); await p2.waitForSelector('#set-renders-browse'); await p2.click('#set-renders-browse'); await p2.waitForSelector('#folder-browser[open] .fb-places button'); await p2.click('.fb-places button[data-place="home"]'); await p2.waitForSelector('#fb-list button[data-name="Videos"]');
    const o = await p2.evaluate(() => { const d = document.querySelector('#folder-browser').getBoundingClientRect(); return { l: d.left, r: d.right, w: innerWidth, vw: visualViewport.width, dw: document.documentElement.clientWidth, sw: document.querySelector('#folder-browser').scrollWidth, cw: document.querySelector('#folder-browser').clientWidth }; });
    assert.ok(o.l >= 0 && o.r <= o.vw + 1 && o.sw <= o.cw + 1, JSON.stringify(o));
    if (shots) await p2.screenshot({ path: join(shots, 'folder-browser-phone.png') });
    await p2.context().close();
  });
  await t('Connect agent shows the one-line install with a copy button', async () => {
    await pg.goto(a.url); await pg.click('#connect-open'); await pg.waitForSelector('#install-line');
    assert.ok(/docs\/install\.md/.test(await pg.textContent('#install-line')));
    if (shots) await pg.locator('#connect-install').screenshot({ path: join(shots, 'connect-install.png') });
  });
  const b = await start({ STUDIO_FOLDER_DIALOG: fake }); servers.push(b.srv);
  await t('Browse with a folder dialog fills in the full path it returns, no list', async () => {
    const p3 = await ctx.newPage(); await p3.goto(b.url); await p3.click('#open-settings'); await p3.click('#set-downloads-browse');
    await until(async () => (await p3.inputValue('#set-downloads')) === PICKED);
    assert.strictEqual(await p3.$('#folder-browser'), null);
    await p3.close();
  });
  assert.deepStrictEqual(errs, []);
} finally { await browser.close(); for (const s of servers) s.kill(); rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${n} studio folder browser tests passed`);
