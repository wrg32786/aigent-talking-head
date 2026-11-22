// The 1.8.0 polish in a real Chrome, on the eight steps of 1.28.0 (Start, Cut, Picture, Text and graphics, B-roll,
// Music and sounds, Review, Render, and the Post view of Render):
// - the top bar fits on one line at desktop, laptop and tablet widths, and on two rows on a phone; Settings stays on screen
// - the More menu (Headless UI Menu) opens with the keyboard, moves with arrow keys and runs Setup check; on a phone it
//   also carries Wizards, Outputs and the theme
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
const { STEPS } = await import('../kit/studio/web/src/steps.js');
// every step, and Post (the second view of Render): [link, step, view]
const PAGES = [...STEPS.map(st => [st, st, 'main']), ['post', 'render', 'post']];
// a link that only changes the hash does not reload the page, so wait for the step to show
const to = async (pg, hash, step, view) => { await pg.goto(url + '/#step=' + hash); await pg.waitForFunction(([st, v]) => { const m = document.querySelector('main'); return m && m.dataset.step === st && (!v || m.dataset.view === v); }, [step, view || null]); };
try {
  await fetch(url + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { backend: 'keywords' } }) });
  const errs = [], ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(url, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#more-open'); // Studio keeps a live connection, so the network is never idle

  await t('the top bar fits at 1600, 1280, 1024, 820 and 375 px on every step; Settings and More stay on screen', async () => {
    for (const w of [1600, 1280, 1024, 820, 375]) {
      await pg.setViewportSize({ width: w, height: 820 });
      for (const [st, step, view] of PAGES) {
        await to(pg, st, step, view); await pg.waitForSelector('#more-open');
        const m = await pg.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, top: document.querySelector('.top').getBoundingClientRect(),
          set: document.querySelector('#open-settings').getBoundingClientRect().right, more: document.querySelector('#more-open').getBoundingClientRect().right,
          steps: [...document.querySelectorAll('.stepper button')].map(b => b.getBoundingClientRect()).map(r => [r.left, r.right]) }));
        assert.strictEqual(m.steps.length, 8, `${w} ${st}: the 8 steps`);
        assert.ok(m.over <= 0, `${w} ${st}: sideways scroll ${m.over}`);
        assert.ok(m.set <= w && m.more <= w, `${w} ${st}: buttons off screen ${m.set} ${m.more}`);
        assert.ok(m.steps.every(([l, r]) => l >= 0 && r <= w), `${w} ${st}: a step is off screen`);
      }
    }
    if (shots) { await to(pg, 'picture', 'picture'); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'top-phone.png'), clip: { x: 0, y: 0, width: 375, height: 260 } }); }
    await pg.setViewportSize({ width: 1280, height: 860 });
    if (shots) { await to(pg, 'text', 'text'); await to(pg, 'picture', 'picture'); await pg.waitForTimeout(900); await pg.screenshot({ path: join(shots, 'liquid-glass.png') }); }
  });

  await t('More menu: only what is nowhere else on the page, short labels; keyboard opens it, arrows move, Enter runs Setup check', async () => {
    // a hash change moves focus to the step heading on the next frame (App go(step, true)); let that land first, or it
    // can take focus off the More button between focus() and Enter on a slow runner
    await pg.goto(url + '/#step=start');
    await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'start' && document.activeElement && document.activeElement.id === 'h-footage');
    await pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await pg.focus('#more-open'); assert.strictEqual(await pg.evaluate(() => document.activeElement.id), 'more-open');
    await pg.keyboard.press('Enter');
    await pg.waitForSelector('#more-setup'); if (shots) { await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, 'more-menu.png'), clip: { x: 560, y: 0, width: 720, height: 280 } }); }
    const items = await pg.$$eval('.menu-item span', x => x.map(e => e.textContent));
    assert.deepStrictEqual(items, ['Past videos', 'Setup check', 'API keys', 'Wizards', 'Outputs'], 'Wizards and Outputs are in More, with words; New video, Connect agent and the theme are in the top bar');
    for (const id of ['#new-video-open', '#connect-open', '#theme']) assert.ok(await pg.isVisible(id), id + ' is on the page');
    for (const id of ['#outputs-open', '#wizards-open']) assert.strictEqual(await pg.$(id), null, id + ' is not a bare icon in the top bar');
    const active = () => pg.evaluate(() => document.querySelector('.menu-item[data-focus]')?.id); // the menu keeps focus and points at the item
    assert.strictEqual(await active(), 'more-open-video'); // Enter opens on the first item
    await pg.keyboard.press('ArrowDown'); assert.strictEqual(await active(), 'more-setup'); await pg.keyboard.press('ArrowDown'); assert.strictEqual(await active(), 'more-keys');
    await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter');
    await pg.waitForSelector('#h-setup', { state: 'visible' }); await pg.waitForFunction(() => !document.querySelector('#more-setup'));
    await pg.keyboard.press('Escape'); await pg.waitForSelector('#h-setup', { state: 'hidden' });
    // on a phone the theme button leaves the top bar too, so More carries it there (and only there)
    const vp = pg.viewportSize(); await pg.setViewportSize({ width: 390, height: 844 });
    const before = await pg.evaluate(() => document.documentElement.dataset.theme || 'dark');
    await pg.click('#more-open'); await pg.waitForSelector('#more-theme');
    assert.deepStrictEqual(await pg.$$eval('.menu-item span', x => x.map(e => e.textContent)), ['Past videos', 'Setup check', 'API keys', 'Wizards', 'Outputs', before === 'dark' ? 'Light theme' : 'Dark theme']);
    for (const id of ['#more-wizards', '#more-outputs']) assert.ok(await pg.isVisible(id), id);
    for (const id of ['#theme']) assert.ok(!(await pg.isVisible(id)), id + ' is in More on a phone');
    await pg.click('#more-theme');
    assert.notStrictEqual(await pg.evaluate(() => document.documentElement.dataset.theme), before);
    await pg.setViewportSize(vp);
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
    await pg.goto(url + '/#step=start'); await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'start');
    await pg.emulateMedia({ reducedMotion: 'reduce' }); assert.strictEqual(await anim(), 'none');
    await pg.emulateMedia({ reducedMotion: null });
  });
  assert.deepStrictEqual(errs, []);
  console.log(`\n${n} studio polish browser tests passed`);
} finally { await browser.close(); srv.kill(); }
