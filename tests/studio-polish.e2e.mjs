// The 1.8.0 polish in a real Chrome:
// - the top bar fits on one line at desktop, laptop and tablet widths, and on two rows on a phone; Settings stays on screen
// - the More menu (Headless UI Menu) opens with the keyboard, moves with arrow keys and runs Connect agent and the theme
// - hints (Headless UI Popover) open on click with the longer text and close with Escape
// - the theme button swaps its icons; reduced motion turns the step entrance off
// Needs Chrome. Run: node tests/studio-polish.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = mkdtempSync(join(tmpdir(), 'studio-polish-e2e-'));
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const env = { ...process.env, CI: '1', STUDIO_DIR: join(TMP, 'studio'), STUDIO_CHAT: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out.slice(-400)))); });
const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
const STEPS = ['footage', 'cut', 'look', 'broll', 'finish', 'post'];
try {
  await fetch(url + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { backend: 'keywords' } }) });
  const errs = [], ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(url, { waitUntil: 'networkidle' }); await pg.waitForSelector('#more-open');

  await t('the top bar fits at 1600, 1280, 1024, 820 and 375 px on every step; Settings and More stay on screen', async () => {
    for (const w of [1600, 1280, 1024, 820, 375]) {
      await pg.setViewportSize({ width: w, height: 820 });
      for (const st of STEPS) {
        await pg.goto(url + '/#step=' + st, { waitUntil: 'networkidle' }); await pg.waitForSelector('#more-open');
        const m = await pg.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, top: document.querySelector('.top').getBoundingClientRect(),
          set: document.querySelector('#open-settings').getBoundingClientRect().right, more: document.querySelector('#more-open').getBoundingClientRect().right,
          steps: [...document.querySelectorAll('.stepper button')].map(b => b.getBoundingClientRect()).map(r => [r.left, r.right]) }));
        assert.ok(m.over <= 0, `${w} ${st}: sideways scroll ${m.over}`);
        assert.ok(m.set <= w && m.more <= w, `${w} ${st}: buttons off screen ${m.set} ${m.more}`);
        assert.ok(m.steps.every(([l, r]) => l >= 0 && r <= w), `${w} ${st}: a step is off screen`);
      }
    }
    if (shots) { await pg.goto(url + '/#step=look', { waitUntil: 'networkidle' }); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'top-phone.png'), clip: { x: 0, y: 0, width: 375, height: 260 } }); }
    await pg.setViewportSize({ width: 1280, height: 860 });
    if (shots) { await pg.goto(url + '/#step=style', { waitUntil: 'networkidle' }); await pg.waitForTimeout(900); await pg.screenshot({ path: join(shots, 'liquid-glass.png') }); }
  });

  await t('More menu: keyboard opens it, arrows move, Enter runs Connect agent; the theme item flips the theme', async () => {
    // a hash change moves focus to the step heading on the next frame (App go(step, true)); let that land first, or it
    // can take focus off the More button between focus() and Enter on a slow runner
    await pg.goto(url + '/#step=footage', { waitUntil: 'networkidle' });
    await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'footage' && document.activeElement && document.activeElement.id === 'h-footage');
    await pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await pg.focus('#more-open'); assert.strictEqual(await pg.evaluate(() => document.activeElement.id), 'more-open');
    await pg.keyboard.press('Enter');
    await pg.waitForSelector('#more-connect'); if (shots) { await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, 'more-menu.png'), clip: { x: 560, y: 0, width: 720, height: 280 } }); }
    const items = await pg.$$eval('.menu-item span', x => x.map(e => e.textContent));
    assert.deepStrictEqual(items.slice(0, 6), ['New video', 'Open a past video', 'Outputs', 'Wizards', 'Connect agent', 'Setup check']);
    const active = () => pg.evaluate(() => document.querySelector('.menu-item[data-focus]')?.id); // the menu keeps focus and points at the item
    assert.strictEqual(await active(), 'more-new-video'); // Enter opens on the first item
    await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown'); assert.strictEqual(await active(), 'more-outputs'); await pg.keyboard.press('ArrowDown'); assert.strictEqual(await active(), 'more-wizards'); await pg.keyboard.press('ArrowDown'); assert.strictEqual(await active(), 'more-connect');
    await pg.keyboard.press('ArrowDown'); assert.strictEqual(await active(), 'more-setup');
    await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter');
    await pg.waitForSelector('#connect-install'); await pg.waitForFunction(() => !document.querySelector('#more-connect'));
    await pg.keyboard.press('Escape'); await pg.waitForFunction(() => !document.querySelector('dialog#connect[open]'));
    const before = await pg.evaluate(() => document.documentElement.dataset.theme || 'dark');
    await pg.click('#more-open'); await pg.click('#more-theme');
    assert.notStrictEqual(await pg.evaluate(() => document.documentElement.dataset.theme), before);
    await pg.click('#theme'); assert.strictEqual(await pg.evaluate(() => document.documentElement.dataset.theme), before);
    assert.strictEqual(await pg.getAttribute('#theme', 'data-mode'), before);
  });

  await t('hints open with the longer text and close with Escape', async () => {
    assert.ok(!(await pg.textContent('#s-footage')).includes('Private links need a login'));
    await pg.click('#footage-link-hint'); await pg.waitForSelector('.hint-panel');
    assert.ok(/Private links need a login/.test(await pg.textContent('.hint-panel')));
    if (shots) { await pg.waitForTimeout(300); const b = await pg.locator('#footage-link-box').boundingBox(); await pg.screenshot({ path: join(shots, 'hint.png'), clip: { x: b.x + b.width - 420, y: b.y - 10, width: 430, height: b.height + 130 } }); }
    await pg.keyboard.press('Escape'); await pg.waitForFunction(() => !document.querySelector('.hint-panel'));
  });

  await t('the step rises in, and not with reduced motion', async () => {
    const anim = () => pg.$eval('main', e => getComputedStyle(e).animationName);
    assert.strictEqual(await anim(), 'step-in-1');
    await pg.goto(url + '/#step=cut'); await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'cut');
    assert.strictEqual(await anim(), 'step-in-2'); // a new name per step is what replays it
    assert.strictEqual(await pg.$eval('#s-cut', e => getComputedStyle(e).animationName), 'none'); // the section itself never replays it
    await pg.goto(url + '/#step=footage'); await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'footage');
    await pg.emulateMedia({ reducedMotion: 'reduce' }); assert.strictEqual(await anim(), 'none');
    await pg.emulateMedia({ reducedMotion: null });
  });
  assert.deepStrictEqual(errs, []);
  console.log(`\n${n} studio polish browser tests passed`);
} finally { await browser.close(); srv.kill(); }
