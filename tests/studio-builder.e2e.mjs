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
    assert.strictEqual(await pg.$('#build-name'), null, 'a named video asks for no name');
    await pg.click('#build-src-link'); await pg.waitForSelector('#build-start #footage-link');
    await noCmd(pg, 'the start screen'); await shot(pg, 'builder-start-dark.png');
  });

  await t('Build my own opens Pacing with the zone map, the Applies to line and five pace cards', async () => {
    await pg.click('#build-own'); await pg.waitForSelector('main[data-build="pace"] #build-pace');
    await pg.waitForFunction(() => document.activeElement && document.activeElement.id === 'build-h-pace');
    assert.match(await pg.textContent('#build-pace .applies'), /^Applies to: The whole video/);
    assert.ok(await pg.$('#build-pace svg[role="img"]'), 'the zone map');
    assert.deepStrictEqual(await pg.$$eval('#build-paces [data-pace]', e => e.map(x => x.dataset.pace)), ['look', 'calm', 'steady', 'lively', 'high']);
    assert.match(await pg.textContent('#build-count'), /^Pace, 1 of 1$/);
    assert.ok(await pg.$('#build-sections [data-section="shots"][disabled]'), 'sections not built yet say Coming soon');
    assert.match(await pg.innerText('#build-sections [data-section="shots"]'), /Soon/, 'and say so where you can see it');
    for (const id of ['calm', 'steady', 'lively', 'high']) assert.match(await pg.getAttribute(`#build-paces [data-pace="${id}"] img`, 'src'), new RegExp(`paces/${id}\\.webp$`));
  });

  await t('picking Lively saves the plan and today\'s pace, and says what it does', async () => {
    await pg.click('#build-paces [data-pace="lively"]');
    await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    assert.match(await pg.textContent('#build-does'), /Tight lines/);
    const v = await api('/api/video-plan'); assert.strictEqual(v.plan.pace, 'lively'); assert.ok(v.plan.touched.includes('pace'));
    const st = (await api('/api/state')).state; assert.strictEqual(st.pace.tighten, 0.45);
    // arrow keys move the choice, as in any radio group
    await pg.focus('#build-paces [data-pace="lively"]'); await pg.keyboard.press('ArrowRight');
    await pg.waitForSelector('#build-paces [data-pace="high"][aria-checked="true"]'); await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.pace === 'high');
    await pg.keyboard.press('ArrowLeft'); await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.pace === 'lively');
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    await noCmd(pg, 'Pacing'); await shot(pg, 'builder-pace-dark.png');
  });

  await t('Next goes on to Words; Back returns to the start screen', async () => {
    await pg.click('#build-back'); await pg.waitForSelector('#build-start');
    await pg.click('#build-own'); await pg.waitForSelector('#build-pace');
    await pg.click('#build-next'); await pg.waitForSelector('main[data-build="captionType"] #build-captionType');
    await pg.click('#build-back'); await pg.waitForSelector('#build-pace');
    await open(pg, '#step=cut'); await pg.waitForSelector('main[data-step="cut"]:not([data-build])');
  });

  await t('Words on screen: type, look, how words come in, titles, place, colors, fonts, key words, then preview and lock', async () => {
    await open(pg, '#build=captionType'); await pg.waitForSelector('#build-type');
    await pg.click('#build-type [data-opt="kinetic"]'); await pg.waitForSelector('#build-type [data-opt="kinetic"][aria-checked="true"]');
    assert.match(await pg.textContent('#build-count'), /^Words, 1 of 9$/, 'kinetic words show all nine steps');
    await pg.click('#build-next'); await pg.waitForSelector('#build-look');
    assert.deepStrictEqual((await pg.$$eval('#build-look [data-opt]', e => e.map(x => x.dataset.opt))).sort(), ['kinetic', 'oneword']);
    await pg.click('#build-look-all'); await pg.waitForSelector('#build-look [data-opt="one-word"]');
    // the live preview is the real overlay, and it follows the tile you point at
    await pg.waitForSelector('#build-live[data-ready]', { timeout: 15000 });
    const k0 = await pg.getAttribute('#build-live', 'data-key');
    await pg.hover('#build-look [data-opt="oneword"]'); await pg.waitForFunction(k => document.querySelector('#build-live').dataset.key !== k, k0);
    const t0 = Date.now(); await pg.waitForSelector('#build-live[data-ready]', { timeout: 15000 }); console.log(`  (live preview ready ${Date.now() - t0} ms after the change)`);
    assert.ok(await pg.$eval('#build-live iframe', f => !!f.contentWindow.__ready && typeof f.contentWindow.seek === 'function'));
    await pg.click('#build-next'); await pg.waitForSelector('#build-in');
    await pg.click('#build-in [data-opt="cascade"]'); await pg.waitForFunction(async () => ((await (await fetch('/api/state')).json()).state.picks.captionEntrance || {}).allow?.[0] === 'cascade');
    await pg.click('#build-next'); await pg.waitForSelector('#build-titles-on');
    await pg.click('#build-te [data-opt="type"]'); await pg.waitForSelector('#build-te [data-opt="type"][aria-checked="true"]');
    await pg.click('#build-next'); await pg.waitForSelector('#build-pc');
    assert.ok(await pg.$('#build-place svg rect[stroke-dasharray], #build-place svg title'), 'the zone map marks the face');
    await pg.click('#build-pc [data-opt="lower"]'); await pg.waitForSelector('#build-pc [data-opt="lower"][aria-checked="true"]');
    assert.ok(await pg.isVisible('#build-step-soon'), 'a choice the render does not draw yet says so');
    await pg.click('#build-next'); await pg.waitForSelector('#build-theme');
    await pg.click('#build-color-outline'); await pg.fill('#build-color-outline-in', '#eeeeee'); await pg.click('text=Use this color');
    await pg.waitForFunction(() => /hard to read/.test(document.querySelector('#build-contrast').textContent));
    await pg.click('#build-next'); await pg.waitForSelector('#build-fonts');
    await pg.click('#build-next'); await pg.waitForSelector('#build-kw');
    await pg.click('#build-kw [data-opt="strong"]'); await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.keyWords === 'strong');
    assert.match(await pg.textContent('#build-does'), /clearly bigger/);
    await pg.click('#build-next'); await pg.waitForSelector('#build-final[data-ready]', { timeout: 15000 });
    assert.match(await pg.textContent('#build-words-sum'), /Kinetic words/);
    await noCmd(pg, 'Words'); await shot(pg, 'builder-words-preview.png');
    assert.strictEqual(await pg.textContent('#build-next'), 'Lock and continue');
    await pg.click('#build-next'); await pg.waitForSelector('main[data-step="picture"]:not([data-build])');
    const v = await api('/api/video-plan'); assert.ok(v.plan.touched.includes('words')); assert.strictEqual(v.plan.words.place.captions, 'lower');
  });

  await t('Just captions skip the kinetic-only steps and take key words away', async () => {
    await open(pg, '#build=captionType'); await pg.waitForSelector('#build-type');
    await pg.click('#build-type [data-opt="captions"]'); await pg.waitForSelector('#build-type [data-opt="captions"][aria-checked="true"]');
    assert.match(await pg.textContent('#build-count'), /^Words, 1 of 6$/);
    assert.strictEqual((await api('/api/state')).state.keyWords, 'off');
    await open(pg, '#build=keyWords'); await pg.waitForSelector('#build-wordsPreview, #build-place, #build-colors', { timeout: 10000 });
    assert.notStrictEqual(new URL(pg.url()).hash, '#build=keyWords', 'a hidden step moves on');
  });

  await t('the address follows the builder: another tab and back, a step not built yet, a classic edit', async () => {
    await open(pg, '#build=pace'); await pg.waitForSelector('#build-pace');
    await pg.click('#areas [role="tab"] >> nth=1'); await pg.waitForSelector('main[data-area="teardowns"]');
    await pg.click('#areas [role="tab"] >> nth=0'); await pg.waitForSelector('#build-pace');
    assert.strictEqual(new URL(pg.url()).hash, '#build=pace', 'coming back keeps the builder in the address');
    await open(pg, '#build=words'); await pg.waitForSelector('#build-start');
    assert.strictEqual(new URL(pg.url()).hash, '#build=start', 'a step with no screen yet starts at the beginning');
    // music energy set on a classic step stays when you pick another pace
    await api('/api/state', { music: { energy: 'low' } });
    await open(pg, '#build=pace'); await pg.waitForSelector('#build-pace');
    await pg.click('#build-paces [data-pace="high"]'); await pg.waitForSelector('#build-paces [data-pace="high"][aria-checked="true"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.pace.tighten === 0.25);
    assert.strictEqual((await api('/api/state')).state.music.energy, 'low');
  });

  await t('a video with no name yet: the start screen offers one, filled with the date, and a clip card uses it', async () => {
    await api('/api/state', { job: null });
    await open(pg, '#build=start'); await pg.waitForSelector('#build-name');
    assert.match(await pg.inputValue('#build-name'), /^video-[a-z]+-\d+$/);
    await pg.fill('#build-name', 'My Builder Reel'); await pg.click('#build-src-link');
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.job === 'my-builder-reel');
    await pg.waitForSelector('#build-start #footage-link');
    await api('/api/state', { job: JOB });
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
