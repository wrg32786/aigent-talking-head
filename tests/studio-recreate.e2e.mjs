// Recreate and Influence on the reference card (1.21.0, on the eight steps of 1.28.0) in a real Chrome, with no keys and no network:
// - Picture: Influence shows one switch per part of the reference; turning one off takes its picks out of your
//   Look, turning it back on puts them back; Recreate and Off hide the switches
// - the Breakdown (the reference view of Picture) shows which parts of the reference were read, and a fix button (no
//   command) for each that was not; the same Recreate, Copy the look, Influence, Off control as the card; stats,
//   timeline and contact sheet behind Details
// - Recreate from the first screen: the "Recreate a video" choice on Start opens the reference box, takes a link, sets
//   Recreate and stays on Start
// - screenshots, dark and light
// Needs Chrome. Run: node tests/studio-recreate.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import http from 'http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-recreate-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'recreate-e2e-' + process.pid, TD = join(STATE, 'td');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
// a reference read by the full reader but with no extras or contact sheet: 6 shots, crossfades, a finish, a title
mkdirSync(join(TD, 'videomd'), { recursive: true });
const SH = [[0, 2, 'close-up'], [2, 3.5, 'close-up'], [3.5, 6, 'medium close-up'], [6, 8, 'medium shot'], [8, 10, 'extreme close-up'], [10, 12, 'close-up']];
const B = { source: { file: 'ref.mp4', duration: 12 }, summary: { duration: 12 }, audio: { music: { present: true, tempo_bpm: 120 } }, stems: { level_db: { music: -20, vocals: -18 } },
  shots: SH.map(([a, b, size], i) => ({ start: a, end: b, transition_in: i ? (i % 2 ? 'dissolve' : 'cut') : 'start', faces: i === 3 ? 0 : 1, aspects: { framing: { result: { shot_size: size } } } })),
  audio_plan: { sfx_merged: [{ t: 2, dur: 0.2, level_db: -20, type: 'pop' }] }, speech: { words: [], lines: [] } };
writeFileSync(join(TD, 'videomd', 'breakdown.json'), JSON.stringify(B));
execFileSync(process.execPath, [join(ROOT, 'kit', 'videomd2reel.cjs'), join(TD, 'videomd', 'breakdown.json'), '--out', join(TD, 'Reel.md'), '--report', join(TD, 'teardown.md')], { stdio: 'pipe' });
const EX = C.extract(join(TD, 'Reel.md'));
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, reference: { ...C.defaultState().reference, status: 'ready', mode: 'off', extracted: EX } }));
// a reference link served here and held back until the test lets it go; the stand-in teardown reads it
const CLIP = join(STATE, 'ref.mp4'); try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=24:duration=2', '-pix_fmt', 'yuv420p', CLIP]); } catch {}
if (!existsSync(CLIP)) { const b = Buffer.alloc(4096); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(CLIP, b); }
let release; const gate = new Promise(r => { release = r; });
const media = http.createServer(async (q, res) => { if (q.url !== '/ref.mp4') { res.writeHead(404); return res.end(); } await gate; const b = readFileSync(CLIP); res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': b.length }); res.end(b); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '', STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
// the page keeps a live connection, so wait for the stepper, not for a quiet network
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
// a reload lands on the step in the address; give a hash to land on a view (the Breakdown is #step=reference)
const theme = async (pg, th, hash) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); if (hash) return open(pg, hash); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const shot = async (pg, name, h = 1100) => { if (!shots) return; const vp = pg.viewportSize(); await pg.setViewportSize({ width: vp.width, height: h }); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name) }); await pg.setViewportSize(vp); };
const allowed = async kind => (((await api('/api/state')).state.picks[kind] || {}).allow || []);

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('studio.paused', '1'); } catch {} }); // about:blank has no storage

  await t('Influence shows a switch per part; Off and Recreate hide them', async () => {
    await open(pg, '#step=picture'); await pg.waitForSelector('#ref-card');
    assert.strictEqual(await pg.$('#ref-parts'), null, 'no switches when Off');
    await pg.click('#ref-card-mode [data-mode="influence"]'); await pg.waitForSelector('#ref-card #ref-parts');
    const labels = await pg.$$eval('#ref-card #ref-parts .chip', x => x.map(e => e.textContent.trim()));
    assert.deepStrictEqual(labels, ['Captions', 'Titles', 'Transitions', 'Grade', 'Effects', 'Graphics', 'Pace', 'Music and sound', 'Fonts and theme']);
    assert.strictEqual(await pg.getAttribute('#ref-card #ref-part-transitions', 'aria-pressed'), 'true');
    assert.strictEqual(await pg.getAttribute('#ref-card #ref-part-sound', 'aria-pressed'), 'false', 'sound stays yours by default');
    assert.match(await pg.textContent('#ref-card-mode-hint'), /Only the parts you switch on\. Everything else stays yours\./);
    assert.strictEqual(await pg.$('#ref-card-note'), null);
  });
  await t('a switch off takes that part out of your Look, and on puts it back', async () => {
    const before = await allowed('transition'); assert.ok(before.includes('crossfade'), 'the reference set its transition: ' + before);
    await pg.click('#ref-card #ref-part-transitions'); await pg.waitForSelector('#ref-card #ref-part-transitions[aria-pressed="false"]');
    await until(async () => !(await allowed('transition')).includes('crossfade'));
    for (const th of ['dark', 'light']) { await theme(pg, th); await pg.waitForSelector('#ref-card #ref-parts'); await shot(pg, `recreate-parts-${th}.png`); }
    await pg.click('#ref-card #ref-part-transitions'); await pg.waitForSelector('#ref-card #ref-part-transitions[aria-pressed="true"]');
    await until(async () => (await allowed('transition')).includes('crossfade'));
    const v = await api('/api/state'); assert.strictEqual(v.state.reference.parts.transitions, true);
  });
  await t('the Breakdown says what was read and offers a fix for the rest, never a command', async () => {
    await pg.click('#ref-more'); await pg.click('#ref-open'); await pg.waitForSelector('#ref-ran');
    assert.deepStrictEqual(await pg.evaluate(() => [document.querySelector('main').dataset.step, document.querySelector('main').dataset.view]), ['picture', 'reference'], 'the Breakdown is a view of Picture');
    const st = await pg.$$eval('#ref-ran .ran li', x => x.map(e => [e.dataset.part, e.className]));
    assert.deepStrictEqual(Object.fromEntries(st), { reader: 'ok', speech: 'miss', layers: 'miss', sheet: 'miss', sounds: 'ok', music: 'ok' });
    const txt = await pg.textContent('#ref-ran'); assert.match(txt, /did not run/);
    assert.ok(!/npm |pip |python3? |\$ /.test(txt), 'no terminal command: ' + txt);
    assert.ok(await pg.$('#ref-ran .ran-fix button'), 'a fix button');
    for (const th of ['dark', 'light']) { await theme(pg, th, '#step=reference'); await pg.waitForSelector('#ref-ran'); await pg.$eval('#ref-ran', e => e.scrollIntoView({ block: 'center' })); if (shots) { await pg.waitForTimeout(300); await (await pg.$('#ref-out')).screenshot({ path: join(shots, `recreate-ran-${th}.png`) }); } }
  });
  await t('the Breakdown is calm: the same mode control, parts switches in Influence, the rest behind Details', async () => {
    assert.deepStrictEqual(await pg.$$eval('#ref-mode [role="radio"]', x => x.map(e => e.textContent.trim())), ['Recreate', 'Copy the look', 'Influence', 'Off']);
    assert.strictEqual(await pg.getAttribute('#ref-mode [data-mode="influence"]', 'aria-checked'), 'true');
    assert.match(await pg.textContent('#ref-mode-hint'), /Only the parts you switch on/);
    assert.ok(await pg.isVisible('#ref-out #ref-parts'), 'the part switches stay in view');
    for (const id of ['#ref-mode-note', '#ref-out .sugg-h .lbl']) assert.strictEqual(await pg.$(id), null, id + ' is gone');
    assert.ok(!/Your agent sees this breakdown|Its picks|beat grid/.test(await pg.textContent('#ref-out')));
    assert.strictEqual(await pg.$eval('#ref-details', e => e.open), false, 'Details starts closed'); assert.ok(!(await pg.isVisible('#ref-details .stats')));
    await pg.click('#ref-details > summary'); await pg.waitForSelector('#ref-details .stats', { state: 'visible' }); assert.ok(await pg.isVisible('#ref-details .timeline'));
    await pg.click('#ref-details > summary');
  });
  await t('Recreate: no switches, the hint says same edit, your take, the card sits above a dimmed Looks row', async () => {
    await open(pg, '#step=picture'); await pg.waitForSelector('#ref-card');
    await pg.click('#ref-card-mode [data-mode="recreate"]'); await pg.waitForSelector('#ref-card-mode [data-mode="recreate"][aria-checked="true"]');
    assert.strictEqual(await pg.$('#ref-card #ref-parts'), null); assert.match(await pg.textContent('#ref-card-mode-hint'), /Same edit, your take: its cuts and timing, with its look, titles, sounds and music\./);
    await pg.waitForSelector('#looks.by-ref'); assert.strictEqual((await pg.textContent('#looks-by-ref')).trim(), 'Set by your reference');
    const pos = await pg.evaluate(() => [document.querySelector('#ref-card').getBoundingClientRect().bottom, document.querySelector('#looks').getBoundingClientRect().top, +getComputedStyle(document.querySelector('#looks')).opacity]);
    assert.ok(pos[0] <= pos[1], 'the card is above the Looks row: ' + pos); assert.ok(pos[2] < 1, 'the Looks row is dimmed');
    assert.ok(await pg.$eval('#ref-card #ref-plan', e => /shots/.test(e.textContent)), 'plan chips in Recreate');
    for (const th of ['dark', 'light']) { await theme(pg, th); await pg.waitForSelector('#ref-card'); await shot(pg, `recreate-useall-${th}.png`); }
    assert.deepStrictEqual(errs, []);
  });
  await t('Recreate from the first screen: the Recreate a video choice on Start takes a link, sets Recreate, and you stay on Start', async () => {
    await api('/api/settings', { downloads: join(STATE, 'dl') });
    await api('/api/reference/clear', {}); await api('/api/state', { reference: { mode: 'influence' } }); await theme(pg, 'dark');
    await open(pg, '#step=start'); await pg.waitForSelector('#start-mode #mode-recreate');
    assert.match(await pg.textContent('#mode-recreate'), /Recreate a video/); assert.strictEqual(await pg.$('#recreate-card'), null, 'one row until you ask');
    assert.deepStrictEqual(await pg.$$eval('#start-mode [role="radio"]', x => x.map(e => [e.dataset.mode, e.getAttribute('aria-checked')])), [['own', 'true'], ['recreate', 'false'], ['look', 'false']], 'three choices, Just my footage first');
    assert.ok(await pg.$eval('#mode-recreate', e => e.getBoundingClientRect().height < 80), 'a quiet row, not a third big tile');
    await shot(pg, 'recreate-first-dark.png');
    await pg.click('#mode-recreate'); await pg.waitForSelector('#recreate-card[data-state="empty"][data-mode="recreate"] #recreate-link');
    await pg.waitForSelector('#mode-recreate[aria-checked="true"]');
    // the mode is the choice above the box now: the box has no Recreate, Influence, Off control of its own and no Close button
    assert.strictEqual(await pg.$('#recreate-mode'), null); assert.strictEqual(await pg.$('#recreate-open'), null);
    await until(async () => (await api('/api/state')).state.reference.mode === 'recreate');
    assert.ok(await pg.isVisible('#recreate-upload'), 'a file works too');
    await pg.fill('#recreate-link', `http://127.0.0.1:${media.address().port}/ref.mp4`); await pg.click('#recreate-add');
    await pg.waitForSelector('#recreate-card[data-state="reading"] #recreate-reading'); assert.match(await pg.textContent('#recreate-reading'), /Record or add your footage while we read it\./);
    assert.ok(await pg.isVisible('#drop-footage') && await pg.isVisible('#record-now'), 'footage and the recorder are right there');
    for (const th of ['dark', 'light']) { await theme(pg, th); await pg.waitForSelector('#recreate-reading'); await shot(pg, `recreate-first-reading-${th}.png`); }
    await theme(pg, 'dark'); release();
    await pg.waitForSelector('#recreate-card[data-state="ready"] #recreate-ready', { timeout: 30000 });
    assert.strictEqual(await pg.evaluate(() => document.querySelector('main').dataset.step), 'start', 'still on the first screen');
    const st = (await api('/api/state')).state; assert.strictEqual(st.reference.mode, 'recreate'); assert.strictEqual(st.reference.status, 'ready'); assert.ok(st.reference.extracted);
    await shot(pg, 'recreate-first-ready-dark.png');
    assert.ok(!/\u2014/.test(await pg.textContent('#recreate-card')), 'no em dashes');
    assert.strictEqual(await pg.getAttribute('#mode-recreate', 'aria-checked'), 'true'); assert.strictEqual((await pg.textContent('#recreate-details')).trim(), 'See how it was made');
    await pg.click('#next'); await pg.click('#next'); await pg.waitForSelector('#ref-card[data-mode="recreate"]'); // Cut, then Picture: the reference is already set
    assert.strictEqual(await pg.getAttribute('main', 'data-step'), 'picture');
    await pg.setViewportSize({ width: 390, height: 844 }); await open(pg, '#step=start'); await pg.waitForSelector('#recreate-card');
    const over = await pg.evaluate(() => Math.max(...[...document.querySelectorAll('#s-footage *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().right)) - innerWidth); assert.ok(over <= 1, 'fits a phone: ' + over);
    assert.deepStrictEqual(errs, []);
  });
} finally {
  release(); media.closeAllConnections(); media.close();
  await browser.close(); srv.kill();
  rmSync(join(ROOT, 'teardown', `studio-${JOB}-r1`), { recursive: true, force: true }); rmSync(join(ROOT, 'teardown-in', 'studio', JOB), { recursive: true, force: true });
  rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio recreate e2e tests passed`);
process.exit(0);
