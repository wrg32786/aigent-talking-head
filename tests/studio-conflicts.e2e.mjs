// Settings that rule out others (1.20.0) in a real Chrome, with no keys and no network:
// - pick the Typewriter caption entrance, then Single word captions: the entrance turns off, its tile greys with
//   "Not with Single word captions", and one line says "Single word captions turned off the Typewriter caption
//   entrance." with Undo; Undo puts it back
// - one click on a greyed tile switches what it needs (Kinetic captions) and picks it; a hover card says why
// - the minimal-clean Look greys the title entrances ("Titles are off in ..."); No music greys Beat sync and Energy
// The captions and title entrances are on the Text and graphics step, the music on Music and sounds (1.28.0).
// - screenshots, dark and light, phone
// Needs Chrome. Run: node tests/studio-conflicts.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
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
const STATE = mkdtempSync(join(tmpdir(), 'studio-conflicts-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'conflicts-e2e-' + process.pid;
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
const tile = r => `.tile:has([data-focus="p:${r}"])`, pick = r => `[data-focus="p:${r}"]`;
// the page keeps a live connection, so wait for the page, not for a quiet network
const open = async (pg, path) => { await pg.goto('about:blank'); await pg.goto(url + path, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#s-menu:not([hidden])'); };
// the Layers block from the tabs down: the note and the first rows of the Captions group
// (on Music and sounds, the sound panel: its layer tiles are in a closed fold)
const clipShot = async (pg, name, sel = '#s-menu .block') => { if (!shots) return; await pg.evaluate(q => { const e = document.querySelector(q); scrollTo(0, e.getBoundingClientRect().top + scrollY - 16); }, sel); await pg.waitForTimeout(350);
  const bb = await pg.locator(sel).boundingBox(), vp = pg.viewportSize(); await pg.screenshot({ path: join(shots, name), clip: { x: bb.x, y: Math.max(0, bb.y), width: bb.width, height: Math.min(vp.height - Math.max(0, bb.y), bb.height) } }); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('studio.paused', '1'); } catch {} }); // about:blank has no storage

  await t('Single word captions turn off the Typewriter caption entrance, with one line and Undo', async () => {
    await open(pg, '/#step=text'); await pg.waitForSelector('#tab-text[aria-selected="true"]'); await pg.waitForSelector(pick('captionEntrance:typewriter'));
    await pg.click(pick('captionEntrance:typewriter')); await pg.waitForSelector(`${pick('captionEntrance:typewriter')}[aria-pressed="true"]`);
    await pg.click(pick('captionStyle:one-word')); await pg.waitForSelector('#change-note');
    assert.strictEqual((await pg.textContent('#change-note span')).trim(), 'Single word captions turned off the Typewriter caption entrance.');
    await pg.waitForSelector(`${tile('captionEntrance:typewriter')}.blocked`);
    assert.strictEqual((await pg.textContent(`${tile('captionEntrance:typewriter')} .ds.why`)).trim(), 'Not with Single word captions');
    assert.strictEqual(await pg.getAttribute(pick('captionEntrance:typewriter'), 'aria-pressed'), 'false');
    assert.strictEqual(await pg.$(`${tile('captionEntrance:typewriter')} .forbid`), null, 'no forbid on a greyed tile');
    assert.ok(!(await pg.$(`${tile('entrance:typewriter')}.blocked`)), 'title entrances still work');
    await pg.hover(tile('captionEntrance:cascade')); await pg.waitForSelector('#tip-why');
    assert.ok(/Not with Single word captions\. Caption entrances only move Kinetic captions\. Click to switch to Kinetic captions\./.test(await pg.textContent('#tip-why')));
    await clipShot(pg, 'conflicts-note-dark.png');
    await theme(pg, 'light'); await pg.waitForSelector('#change-note'); await clipShot(pg, 'conflicts-note-light.png'); await theme(pg, 'dark');
    await pg.click('#change-undo'); await pg.waitForSelector(`${pick('captionEntrance:typewriter')}[aria-pressed="true"]`);
    assert.strictEqual(await pg.$('#change-note'), null); assert.strictEqual(await pg.$(`${tile('captionEntrance:typewriter')}.blocked`), null);
    assert.strictEqual(await pg.getAttribute(pick('captionStyle:one-word'), 'aria-pressed'), 'false');
  });
  await t('one click on a greyed tile switches what it needs', async () => {
    await pg.click(pick('captionStyle:one-word')); await pg.waitForSelector(`${tile('captionEntrance:cascade')}.blocked`);
    await pg.click(pick('captionEntrance:cascade'));
    await pg.waitForSelector(`${pick('captionEntrance:cascade')}[aria-pressed="true"]`);
    assert.strictEqual(await pg.getAttribute(pick('captionStyle:kinetic'), 'aria-pressed'), 'true');
    assert.strictEqual((await pg.textContent('#change-note span')).trim(), 'Switched to Kinetic captions for the Cascade caption entrance.');
    assert.strictEqual(await pg.$('.tile.blocked[data-blocked="caption-entrance"]'), null);
  });
  await t('a Look with no titles greys the title entrances; No music greys Beat sync and Energy', async () => {
    await api('/api/state', { pack: 'minimal-clean', picks: { 'captionStyle:kinetic': 'clear', 'captionEntrance:cascade': 'clear' } }); await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForSelector(`${tile('entrance:slam')}.blocked`);
    assert.ok(/Titles are off in the minimal-clean Look/.test(await pg.textContent(`${tile('entrance:slam')} .ds.why`)));
    assert.ok(await pg.$(`${tile('captionEntrance:pop')}.blocked`), 'Classic captions from the Look: caption entrances greyed too');
    await pg.click(pick('entrance:slam')); await pg.waitForSelector(`${pick('entrance:slam')}[aria-pressed="true"]`);
    assert.strictEqual((await pg.textContent('#change-note span')).trim(), 'Turned titles on for the Slam title entrance.');
    await api('/api/state', { pack: null, picks: { 'look:kinetic': 'clear', 'captionStyle:classic': 'clear', 'entrance:slam': 'clear', 'beatSync:beat-sync': 'allow' } });
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.click('#stepper [data-step="music"]'); await pg.waitForSelector('#s-sound #bed');
    await pg.waitForFunction(() => document.querySelector('#beat-sync') && !document.querySelector('#change-note')); // the sound panel is in, with nothing left over from the last change
    await pg.selectOption('#bed', 'none'); await pg.waitForSelector('#s-sound #change-note');
    assert.strictEqual((await pg.textContent('#change-note span')).trim(), 'No music turned off Beat sync.');
    assert.ok(/Not with No music/.test(await pg.textContent('#energy-off')));
    await clipShot(pg, 'conflicts-music-dark.png', '#s-sound');
    await pg.click('#energy-off .linkish'); await pg.waitForFunction(() => !document.querySelector('#energy-off'));
    assert.strictEqual(await pg.inputValue('#bed'), 'auto');
  });
  await t('the phone layout fits, dark and light', async () => {
    await api('/api/state', { picks: { 'captionStyle:one-word': 'allow' } });
    await pg.setViewportSize({ width: 390, height: 844 }); await open(pg, '/?phone=1#step=text'); await pg.waitForSelector(`${tile('captionEntrance:typewriter')}.blocked`);
    const over = await pg.evaluate(() => [...document.querySelectorAll('#s-menu *')].filter(e => !e.closest('#tabs')).map(e => e.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), 0) - innerWidth); assert.ok(over <= 1, 'no sideways scroll: ' + over);
    if (shots) { await pg.locator(tile('captionEntrance:pop')).scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, 'conflicts-phone-dark.png') });
      await pg.evaluate(() => localStorage.setItem('studio.theme', 'light')); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector(`${tile('captionEntrance:typewriter')}.blocked`);
      await pg.locator(tile('captionEntrance:pop')).scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, 'conflicts-phone-light.png') }); }
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio conflicts e2e tests passed`);
process.exit(0);
