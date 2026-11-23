// The Vault (1.29.0) in a real Chrome, with no keys and no network (STUDIO_VAULT_CAPTURE=0: a link is saved, not visited):
// - the Vault button in the top bar opens the panel from any step; an empty Vault says so, with one Add
// - Add, Upload files puts a video in the grid with its one line; the same file again says "You already have this."
// - Paste a link with a YouTube address that is not yours is saved as "Reference only"
// - the Kind and Source filters and the search narrow the grid; Delete, then Undo brings the item back
// - no terminal command and no long dashes in the panel; it renders in the light theme
// - on the B-roll step a plan slot card says what to show ("Show ..."); "Open the Vault" on it opens the panel for that
//   spot; a clip added there whose name fits the slot shows up on the card as "From your Vault: ..." with Use it and
//   Swap, and Use it fills the slot; Use in this reel fills a spot from the panel, and never with a reference
// - Settings: the Vault folder and the one switch, Let my agent see Vault pictures (off by default)
// Needs Chrome. Run: node tests/studio-vault.e2e.mjs [--shots <dir>]
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';
const require = createRequire(import.meta.url);
const BS = require('../kit/broll-slots.cjs'), RC = require('../kit/recreate.cjs');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-vault-e2e-')), LIB = join(STATE, 'lib'), JOB = 'vault-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// a drafted job: 24 s of your words, and a plan with three B-roll slots (two panels, one full cutaway), none filled
const LINES = ['Editing ate my weekends.', 'I tried every app.', 'Then I found one prompt.', 'It plans the whole edit.', 'Here is how to set it up.', 'Open the dashboard.', 'Type your topic.', 'And press go.', 'Leads went up 312 percent.', 'In three months.', 'Follow the repo for more.', 'Tell me how it went.'];
const WORDS = LINES.flatMap((l, k) => { const ws = l.split(' '), d = 1.6 / ws.length; return ws.map((w, i) => ({ start: +(k * 2 + 0.1 + i * d).toFixed(3), end: +(k * 2 + 0.1 + (i + 1) * d - 0.03).toFixed(3), word: w })); });
const flips = LINES.map((l, k) => ({ start: +(k * 2 + 0.1).toFixed(2), end: +(k * 2 + 1.8).toFixed(2), text: l }));
const ref = BS.detect([{ start: 20, end: 26, box: [0.19, 0.57, 0.62, 0.21], border: '#d87b5b', shows: 'Dashboard', shot: 'screen recording' }, { start: 33, end: 37, box: [0.19, 0.57, 0.62, 0.21], shows: 'Leads' }, { start: 41, end: 44.5, kind: 'full' }],
  [{ motion: 'push', zoom: 1.15, in: 'pop', out: 'fade' }, { in: 'pop', out: 'fade' }, { colour: 'bw', shake: true, in: 'cut', out: 'cut' }]);
const slots = BS.forRecreate(ref.map(s => ({ ...s, shows: s.shows || null })), { k: 0.5, len: 24, words: WORDS, refLen: 48 });
assert.strictEqual(slots.length, 3);
const CUT = { segs: [{ file: 'x.mp4', in: 0, out: 24 }] }, jobDir = join(ROOT, 'jobs', JOB), build = join(jobDir, 'build'); mkdirSync(build, { recursive: true });
writeFileSync(join(build, 'cut.json'), JSON.stringify(CUT));
writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify({ flips }) + ';\n');
RC.writePlan(build, RC.planOf({ recipe: { file: 'Reel.md' }, cut: CUT, broll: slots }));
const clip = (name, src) => { const f = join(STATE, name); execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${src}=size=640x360:rate=24:duration=6`, '-pix_fmt', 'yuv420p', f]); return f; };
const CLIP = clip('weekend-walk.mp4', 'testsrc2');

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: LIB, STUDIO_BROLL_AUTO: '', STUDIO_VAULT_CAPTURE: '0', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const shot = async (pg, name) => { if (!shots) return; await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, name) }); };
const items = pg => pg.locator('#vault-grid .vault-item');
const chip = (pg, k, v) => pg.click(`#vault [data-filter="${k}"][data-value="${v}"]`);

let failed = false;
const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await t('the Vault button opens the panel from the first step, and an empty Vault says so', async () => {
    await open(pg, '#step=start'); assert.ok(await pg.isVisible('#open-vault'));
    assert.strictEqual(await pg.locator('#vault').count(), 0);
    await pg.click('#open-vault'); await pg.waitForSelector('#vault #vault-empty');
    const tx = await pg.locator('#vault').innerText();
    assert.ok(/Vault\s+Everything you can show, in one place\./.test(tx), tx);
    assert.ok(tx.includes('Your Vault is empty. Add your site, your profiles and a few clips, and we will pull B-roll from them.'), tx);
    assert.strictEqual(await pg.getAttribute('#vault-search', 'placeholder'), 'Search your Vault');
    assert.strictEqual(await pg.locator('#vault-filters').count(), 0, 'no filters over an empty Vault');
    await shot(pg, 'vault-empty-dark.png');
  });
  await t('Add, Upload files puts a video in the grid with its line', async () => {
    await pg.click('#vault-empty-add'); await pg.waitForSelector('#vault-add-menu');
    assert.deepStrictEqual((await pg.locator('#vault-add-menu button').allInnerTexts()).map(x => x.trim()), ['Upload files', 'Paste a link']);
    await pg.setInputFiles('#vault-file', CLIP);
    await until(async () => (await items(pg).count()) === 1, 30000);
    assert.ok(/weekend/i.test(await items(pg).first().locator('.bt-n').textContent()));
    assert.ok(/^Video, 0:06/.test((await items(pg).first().locator('.vi-line').textContent()).trim()), await items(pg).first().locator('.vi-line').textContent());
    assert.strictEqual(await items(pg).first().locator('.vi-rights').count(), 0, 'your own upload has no rights mark');
  });
  await t('the same file again says You already have this, and the grid still has one', async () => {
    await pg.setInputFiles('#vault-file', CLIP);
    await until(async () => (await pg.locator('#vault-msg').count()) && /You already have this\./.test(await pg.textContent('#vault-msg')));
    assert.strictEqual(await items(pg).count(), 1); assert.strictEqual((await api('/api/vault')).total, 1);
  });
  await t('Paste a link that is not yours is saved as Reference only', async () => {
    await pg.click('#vault-add'); await pg.click('#vault-add-link');
    assert.strictEqual(await pg.getAttribute('#vault-link', 'placeholder'), 'Paste a link to your site, a profile, a product page or a video.');
    assert.ok(/This is mine/.test(await pg.textContent('#vault-link-form'))); assert.strictEqual(await pg.isChecked('#vault-mine'), false);
    await pg.fill('#vault-link', 'not a link'); await pg.click('#vault-link-save');
    await until(async () => (await pg.locator('#vault-msg').count()) && /does not look like a link/.test(await pg.textContent('#vault-msg')));
    await pg.fill('#vault-link', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); await pg.click('#vault-link-save');
    await until(async () => (await items(pg).count()) === 2);
    assert.deepStrictEqual((await pg.locator('#vault-grid .vi-rights').allInnerTexts()).map(x => x.trim()), ['Reference only']);
    assert.ok(/reference only/i.test(await pg.textContent('#vault-msg')), 'the panel says why');
    await shot(pg, 'vault-grid-dark.png');
  });
  await t('the Kind and Source filters and the search narrow the grid', async () => {
    await chip(pg, 'kind', 'video'); await until(async () => (await items(pg).count()) === 1);
    assert.strictEqual(await items(pg).first().getAttribute('data-kind'), 'video');
    await chip(pg, 'kind', 'all'); await until(async () => (await items(pg).count()) === 2);
    await chip(pg, 'source', 'links'); await until(async () => (await items(pg).count()) === 1);
    assert.strictEqual(await items(pg).first().locator('.vi-rights').count(), 1);
    await chip(pg, 'source', 'all'); await until(async () => (await items(pg).count()) === 2);
    await chip(pg, 'used', 'true'); await pg.waitForSelector('#vault-none');
    assert.strictEqual((await pg.textContent('#vault-none')).trim(), 'Nothing in your Vault fits yet.');
    await chip(pg, 'used', 'all'); await until(async () => (await items(pg).count()) === 2);
    await pg.fill('#vault-search', 'weekend'); await until(async () => (await items(pg).count()) === 1);
    assert.ok(/weekend/i.test(await items(pg).first().locator('.bt-n').textContent()));
    await pg.fill('#vault-search', ''); await until(async () => (await items(pg).count()) === 2);
  });
  await t('an item opens a sheet; Delete, then Undo brings it back', async () => {
    await pg.click('#vault-grid .vault-item[data-kind="video"]'); await pg.waitForSelector('#vault-sheet');
    const tx = await pg.locator('#vault-sheet').innerText();
    assert.ok(/Tags/.test(tx) && /Brand/.test(tx) && /Not used yet/.test(tx) && /Delete from Vault/.test(tx), tx);
    assert.deepStrictEqual((await pg.locator('#vault-rights option').allInnerTexts()).map(x => x.trim()), ['Mine', 'Licensed', 'Public page', 'Reference only']);
    assert.strictEqual(await pg.locator('#vault-use').count(), 0, 'Use in this reel only when opened from a slot');
    await pg.fill('#vault-tags .chip-in', 'walk'); await pg.press('#vault-tags .chip-in', 'Enter'); await pg.waitForSelector('#vault-tags .chip[data-value="walk"]');
    await pg.click('#vault-delete'); await pg.waitForSelector('#vault-gone');
    assert.ok((await pg.textContent('#vault-gone')).includes('Deleted from your Vault. You can undo for 7 days.'));
    await until(async () => (await items(pg).count()) === 1);
    await pg.click('#vault-undo'); await until(async () => (await items(pg).count()) === 2);
    assert.strictEqual(await pg.locator('#vault-gone').count(), 0);
  });
  await t('no terminal command and no long dash in the panel, and it renders in the light theme', async () => {
    const check = async () => { const tx = await pg.locator('#vault').innerText(); assert.ok(!/npm |npx |node |pip |\$ |[\u2013\u2014]/.test(tx), tx); assert.ok(!tx.includes(STATE) && !/[\\/]lib[\\/]|score/i.test(tx), 'no file paths or scores: ' + tx); };
    await check(); await pg.click('#vault-grid .vault-item[data-kind="video"]'); await pg.waitForSelector('#vault-sheet'); await check();
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'light')); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper');
    assert.strictEqual(await pg.evaluate(() => document.documentElement.dataset.theme), 'light');
    await pg.click('#open-vault'); await until(async () => (await items(pg).count()) === 2);
    const box = await pg.locator('#vault').boundingBox(); assert.ok(box.width > 600 && box.height > 400, JSON.stringify(box));
    const lum = await pg.evaluate(() => { const m = getComputedStyle(document.querySelector('#vault .vault-t h2')).color.match(/[\d.]+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; });
    assert.ok(lum < 110, 'dark words on the cream panel: ' + lum);
    await shot(pg, 'vault-grid-light.png');
    await pg.keyboard.press('Escape'); await until(async () => (await pg.locator('#vault').count()) === 0);
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'dark'));
  });

  let slotBeat, otherBeat;
  await t('a slot card says what to show, and Open the Vault opens the panel for that spot', async () => {
    await open(pg, '#step=broll'); await pg.waitForSelector('#broll-needs .need');
    const needs = (await api('/api/broll')).beats.filter(b => b.need); assert.strictEqual(needs.length, 3);
    for (const b of needs) { assert.ok(b.brief && /^Show /.test(b.need.show), JSON.stringify(b.need)); assert.strictEqual(b.need.suggest, null); assert.strictEqual(b.need.none, 'Nothing in your Vault fits yet.'); }
    slotBeat = needs[0]; otherBeat = needs[1];
    const card = pg.locator(`#broll-needs .need[data-beat="${slotBeat.n}"]`);
    assert.strictEqual((await card.locator('.need-h').textContent()).trim(), slotBeat.need.show);
    assert.ok(/Nothing in your Vault fits yet\./.test(await card.locator('.need-none').textContent()));
    assert.strictEqual(await card.locator('.need-use').count(), 0); assert.ok(await card.locator('.need-copy').isVisible(), 'Copy for my agent stays on a card with no suggestion');
    await card.locator('.need-vault').click(); await pg.waitForSelector('#vault');
    assert.strictEqual(await pg.getAttribute('#vault', 'data-pick'), String(slotBeat.n));
  });
  await t('a clip added to the Vault that fits the slot shows on its card with the reason, Use it and Swap; Use it fills the slot', async () => {
    // name the file after the words of the slot's brief, so the Vault has something that fits
    const word = String((slotBeat.brief.named && slotBeat.brief.named[0]) || slotBeat.brief.subject).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await pg.setInputFiles('#vault-file', [clip(word + '.mp4', 'smptebars'), clip(word + '-two.mp4', 'rgbtestsrc')]);
    await until(async () => (await items(pg).count()) === 4, 30000);
    await pg.keyboard.press('Escape'); await until(async () => (await pg.locator('#vault').count()) === 0);
    const card = pg.locator(`#broll-needs .need[data-beat="${slotBeat.n}"]`);
    await until(async () => (await card.locator('.need-why').count()) === 1);
    assert.ok(/^From your Vault: /.test((await card.locator('.need-why').textContent()).trim()), await card.locator('.need-why').textContent());
    assert.deepStrictEqual((await card.locator('.need-acts').first().innerText()).split('\n').map(x => x.trim()).filter(Boolean), ['Use it', 'Swap', 'Skip', 'More']);
    assert.strictEqual(await card.locator('.need-up').count(), 0, 'the other ways sit behind More');
    await card.locator('.need-more').click(); assert.ok(await card.locator('.need-up').isVisible() && await card.locator('.need-copy').isVisible() && await card.locator('.need-vault').isVisible());
    await card.locator('.need-swap').click(); await card.locator('.need-cands').waitFor();
    const sw = await card.locator('.need-cands').innerText(); assert.ok(/From your Vault: /.test(sw) || /Nothing else in your Vault fits yet\./.test(sw), sw);
    assert.ok(!/[\u2013\u2014]|npm |node /.test(await card.innerText()));
    await shot(pg, 'vault-slot-card-dark.png');
    await card.locator('.need-use').click();
    const b = await until(async () => (await api('/api/broll')).beats.find(x => x.n === slotBeat.n && x.slot));
    assert.ok(/^From your Vault: /.test(b.slot.why), JSON.stringify(b.slot));
    await until(async () => (await pg.locator(`#broll-needs .need[data-beat="${slotBeat.n}"]`).count()) === 0);
    await pg.waitForSelector(`#broll-lane .spot[data-beat="${slotBeat.n}"].filled`);
    // the filled spot keeps the reason, and a small Swap offers what else fits
    await pg.click(`#broll-lane .spot[data-beat="${slotBeat.n}"]`); await pg.waitForSelector('#slot-swap');
    assert.ok(/^From your Vault: /.test((await pg.textContent('#slot-why')).trim()));
    await pg.click('#slot-swap'); await pg.waitForSelector('#slot-set .need-cands');
    assert.ok(/From your Vault: |Nothing else in your Vault fits yet\./.test(await pg.locator('#slot-set .need-cands').innerText()));
  });
  await t('Settings: the Vault folder, and one switch for what your agent may see', async () => {
    await pg.click('#broll-more-fold > summary'); await pg.click('#open-keys'); await pg.waitForSelector('#vault-pictures');
    const tx = await pg.locator('#keys').innerText();
    assert.ok(/Vault folder/.test(tx) && !/B-roll library folder/.test(tx) && /Let my agent see Vault pictures/.test(tx) && /Off: your agent gets words about each item\. Pictures stay here unless you turn this on\./.test(tx), tx.slice(-600));
    assert.strictEqual((await api('/api/vault')).pictures, false, 'off by default');
    await pg.click('#vault-pictures'); await pg.click('#save-broll-settings');
    await until(async () => (await api('/api/vault')).pictures === true);
    await api('/api/settings', { broll: { vaultPictures: false } });
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  });
  await t('Use in this reel places an item on the spot the panel was opened for, and never a reference', async () => {
    const card = pg.locator(`#broll-needs .need[data-beat="${otherBeat.n}"]`);
    await card.locator('.need-vault').first().click().catch(async () => { await card.locator('.need-more').click(); await card.locator('.need-vault').first().click(); });
    await pg.waitForSelector('#vault-grid .vault-item');
    await pg.click('#vault-grid .vault-item:has(.vi-rights)'); await pg.waitForSelector('#vault-sheet');
    assert.strictEqual(await pg.locator('#vault-use').count(), 0);
    assert.strictEqual((await pg.textContent('#vault-ref-only')).trim(), 'Reference only. It is never placed in a reel.');
    await pg.click('#vault-back'); await pg.fill('#vault-search', 'weekend'); await until(async () => (await items(pg).count()) === 1);
    await items(pg).first().click(); await pg.waitForSelector('#vault-use');
    assert.strictEqual((await pg.textContent('#vault-use')).trim(), 'Use in this reel');
    await pg.click('#vault-use'); await until(async () => (await pg.locator('#vault').count()) === 0);
    await until(async () => (await api('/api/broll')).beats.find(x => x.n === otherBeat.n && x.slot));
    await pg.waitForSelector(`#broll-lane .spot[data-beat="${otherBeat.n}"].filled`);
    assert.deepStrictEqual(errs, []);
  });
  console.log(`\n${n} studio vault e2e tests passed\nPASS`);
} catch (e) { failed = true; console.error(e); } finally { await browser.close().catch(() => {}); srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); }
if (failed) process.exit(1);
