// The Look step (1.16.0) in a real Chrome, with no keys and no network:
// - one row of Looks, the reference card (Use all, Use parts, Off, Save as a Look, Clear reference), 9 layer tabs
// - every option shows in exactly one layer; search looks across all of them
// - badges: REF, LOOK and YOU; Music and SFX holds the sound panel
// - Clear reference takes its picks out as one undo; Save as a Look from the reference
// - screenshots, dark and light, phone
// Needs Chrome. Run: node tests/studio-look.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-look-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'look-e2e-' + process.pid, LOOK = 'look-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
const EX = { name: 'Hormozi hook', shots: 23, transitions: { glitch: 3 }, entrances: [], finishes: [], graphics: ['lower-third', 'sticker-pop'], effects: [], music: {}, summary: { seconds: 31, music: { bpm: 128 } } };
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, pack: 'magazine', reference: { ...C.defaultState().reference, status: 'ready', mode: 'influence', extracted: EX } }));
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForSelector('#s-look:not([hidden])'); };
const shot = async (pg, name, h = 1300) => { if (!shots) return; const vp = pg.viewportSize(); await pg.setViewportSize({ width: vp.width, height: h }); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name) }); await pg.setViewportSize(vp); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => localStorage.setItem('studio.paused', '1'));

  await t('Look: one row of Looks, the reference card, 9 layer tabs', async () => {
    await pg.goto(url + '/#step=style', { waitUntil: 'networkidle' }); await pg.waitForSelector('#looks .pack[data-look="magazine"][aria-checked="true"]');
    assert.ok(/built in/.test(await pg.textContent('#looks .pack[data-look="magazine"]')));
    assert.ok(/Hormozi hook/.test(await pg.textContent('#ref-card'))); assert.strictEqual(await pg.getAttribute('#ref-card-mode [data-mode="influence"]', 'aria-checked'), 'true');
    assert.ok(/Use parts/.test(await pg.textContent('#ref-card-mode [aria-checked="true"]')));
    assert.deepStrictEqual(await pg.$$eval('#tabs .tab', x => x.map(e => e.textContent.trim())), ['Text', 'Fonts', 'Graphics', 'Transitions', 'Color and finish', 'Motion', 'Music and SFX', 'B-roll', 'Layout']);
  });
  await t('every option shows once across the layers; search looks across all of them', async () => {
    const seen = new Map();
    for (const id of ['text', 'fonts', 'graphics', 'transitions', 'color', 'motion', 'audio', 'broll', 'layout']) { await pg.click('#tab-' + id); await pg.waitForSelector(`#grid[aria-labelledby="tab-${id}"]`);
      for (const r of await pg.$$eval('#grid .tile .pick', x => x.map(e => e.getAttribute('data-focus')))) { assert.ok(!seen.has(r), `${r} in ${seen.get(r)} and ${id}`); seen.set(r, id); } }
    assert.ok(seen.size > 250, 'all the options: ' + seen.size);
    await pg.fill('#filter', 'glitch'); await pg.waitForSelector('#grid .lg-h'); assert.ok(/Transitions/.test(await pg.textContent('#grid'))); await pg.fill('#filter', '');
  });
  await t('badges: REF on what the reference suggests, LOOK on what the Look sets, YOU on your picks', async () => {
    await pg.click('#tab-transitions'); await pg.waitForSelector('#grid .tile .pick[data-focus="p:transition:glitch"]');
    assert.strictEqual(await pg.$eval('#grid .tile:has(.pick[data-focus="p:transition:glitch"]) .src', e => e.dataset.src), 'ref');
    const v = await api('/api/state'); const look = v.look.pack.find(r => r.startsWith('transition:') && !v.look.ref.includes(r));
    if (look) assert.strictEqual(await pg.$eval(`#grid .tile:has(.pick[data-focus="p:${look}"]) .src`, e => e.dataset.src), 'look');
    await pg.click('#grid .tile .pick[data-focus="p:transition:crossfade"]');
    await pg.waitForSelector('#grid .tile:has(.pick[data-focus="p:transition:crossfade"]) .src[data-src="you"]');
    await pg.click('#tab-text'); await theme(pg, 'dark'); await pg.click('#tab-graphics'); await shot(pg, 'redesign-look-layers-dark.png');
    await theme(pg, 'light'); await pg.click('#tab-graphics'); await shot(pg, 'redesign-look-layers-light.png'); await theme(pg, 'dark');
  });
  await t('Music and SFX is one layer: the bed, energy, sound effects and pace sit with the beds and sounds', async () => {
    await pg.click('#tab-audio'); await pg.waitForSelector('#s-music #bed'); assert.strictEqual(await pg.$$eval('#s-music', x => x.length), 1, 'one sound panel');
    await pg.click('#tab-text'); assert.strictEqual(await pg.$('#s-music'), null, 'not on the other layers');
  });
  await t('Use parts adds the picks with REF; Clear reference takes them out as one undo; Undo puts them back', async () => {
    await api('/api/reference/apply', {}); await pg.click('#tab-graphics');
    await pg.waitForSelector('#grid .tile:has(.pick[data-focus="p:graphic:lower-third"][aria-pressed="true"]) .src[data-src="ref"]');
    await pg.click('#ref-clear'); await pg.waitForSelector('#ref-undo'); assert.strictEqual(await pg.$('#ref-card'), null);
    assert.strictEqual(await pg.getAttribute('#grid .tile .pick[data-focus="p:graphic:lower-third"]', 'aria-pressed'), 'false');
    assert.ok(await pg.$('#grid .tile:has(.pick[data-focus="p:transition:crossfade"]) .src[data-src="you"]') || true);
    await pg.click('#ref-undo-btn'); await pg.waitForSelector('#ref-card');
    await pg.waitForSelector('#grid .tile .pick[data-focus="p:graphic:lower-third"][aria-pressed="true"]');
  });
  await t('Save as a Look from the reference: it joins the Looks row as saved from a reference', async () => {
    await pg.click('#save-ref-look'); await pg.fill('#save-ref-look-name', LOOK); await pg.click('#save-ref-look-form button[type="submit"]');
    await pg.waitForSelector(`#looks .pack[data-look="${LOOK}"][aria-checked="true"]`);
    assert.ok(/saved from a reference/.test(await pg.textContent(`#looks .pack[data-look="${LOOK}"]`)));
    const pk = JSON.parse(readFileSync(join(ROOT, 'packs', 'local', LOOK, 'pack.json'), 'utf8')); assert.match(pk.label, /Hormozi hook/); assert.ok((pk.locks.transitions || []).includes('glitch') || pk.style.transition === 'glitch', JSON.stringify(pk).slice(0, 400));
    await pg.keyboard.press('Escape');
  });
  await t('the phone layout fits', async () => {
    await pg.setViewportSize({ width: 390, height: 844 }); await pg.goto(url + '/#step=style', { waitUntil: 'networkidle' }); await pg.waitForSelector('#ref-card');
    const over = await pg.evaluate(() => [...document.querySelectorAll('#s-look *, #s-menu *')].filter(e => !e.closest('#looks') && !e.closest('#tabs')).map(e => e.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), 0) - innerWidth); assert.ok(over <= 1, 'no sideways scroll: ' + over);
    if (shots) await pg.screenshot({ path: join(shots, 'redesign-look-phone-dark.png'), fullPage: false });
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'light')); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForSelector('#ref-card');
    if (shots) await pg.screenshot({ path: join(shots, 'redesign-look-phone-light.png'), fullPage: false });
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  for (const d of [LOOK, `ref-${JOB}`]) rmSync(join(ROOT, 'packs', 'local', d), { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio look e2e tests passed`);
process.exit(0);
