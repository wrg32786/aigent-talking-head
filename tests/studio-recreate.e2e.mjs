// Recreate and Influence on the reference card (1.21.0) in a real Chrome, with no keys and no network:
// - Influence (Use parts) shows one switch per part of the reference; turning one off takes its picks out of your
//   Look, turning it back on puts them back; Recreate and Off hide the switches
// - the Breakdown shows which parts of the reference were read, and a fix button (no command) for each that was not
// - screenshots, dark and light
// Needs Chrome. Run: node tests/studio-recreate.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
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
  shots: SH.map(([a, b, size], i) => ({ start: a, end: b, transition_in: i ? (i % 2 ? 'fade' : 'cut') : 'start', faces: i === 3 ? 0 : 1, aspects: { framing: { result: { shot_size: size } } } })),
  audio_plan: { sfx_merged: [{ t: 2, dur: 0.2, level_db: -20, type: 'pop' }] }, speech: { words: [], lines: [] } };
writeFileSync(join(TD, 'videomd', 'breakdown.json'), JSON.stringify(B));
execFileSync(process.execPath, [join(ROOT, 'kit', 'videomd2reel.cjs'), join(TD, 'videomd', 'breakdown.json'), '--out', join(TD, 'Reel.md'), '--report', join(TD, 'teardown.md')], { stdio: 'pipe' });
const EX = C.extract(join(TD, 'Reel.md'));
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, reference: { ...C.defaultState().reference, status: 'ready', mode: 'off', extracted: EX } }));
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'networkidle' }); };
const shot = async (pg, name, h = 1100) => { if (!shots) return; const vp = pg.viewportSize(); await pg.setViewportSize({ width: vp.width, height: h }); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name) }); await pg.setViewportSize(vp); };
const allowed = async kind => (((await api('/api/state')).state.picks[kind] || {}).allow || []);

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => localStorage.setItem('studio.paused', '1'));

  await t('Use parts shows a switch per part; Off and Use all hide them', async () => {
    await pg.goto(url + '/#step=style', { waitUntil: 'networkidle' }); await pg.waitForSelector('#ref-card');
    assert.strictEqual(await pg.$('#ref-parts'), null, 'no switches when Off');
    await pg.click('#ref-card-mode [data-mode="influence"]'); await pg.waitForSelector('#ref-card #ref-parts');
    const labels = await pg.$$eval('#ref-card #ref-parts .chip', x => x.map(e => e.textContent.trim()));
    assert.deepStrictEqual(labels, ['Captions', 'Titles', 'Transitions', 'Grade', 'Effects', 'Graphics', 'Pace', 'Music and sound', 'Fonts and theme']);
    assert.strictEqual(await pg.getAttribute('#ref-card #ref-part-transitions', 'aria-pressed'), 'true');
    assert.strictEqual(await pg.getAttribute('#ref-card #ref-part-sound', 'aria-pressed'), 'false', 'sound stays yours by default');
    assert.match(await pg.textContent('#ref-card-note'), /parts you switch on/);
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
    await pg.click('#ref-open'); await pg.waitForSelector('#ref-ran');
    const st = await pg.$$eval('#ref-ran .ran li', x => x.map(e => [e.dataset.part, e.className]));
    assert.deepStrictEqual(Object.fromEntries(st), { reader: 'ok', speech: 'miss', layers: 'miss', sheet: 'miss', sounds: 'ok', music: 'ok' });
    const txt = await pg.textContent('#ref-ran'); assert.match(txt, /did not run/);
    assert.ok(!/npm |pip |python3? |\$ /.test(txt), 'no terminal command: ' + txt);
    assert.ok(await pg.$('#ref-ran .ran-fix button'), 'a fix button');
    for (const th of ['dark', 'light']) { await theme(pg, th); await pg.click('#ref-open').catch(() => {}); await pg.waitForSelector('#ref-ran'); await pg.$eval('#ref-ran', e => e.scrollIntoView({ block: 'center' })); if (shots) { await pg.waitForTimeout(300); await (await pg.$('#ref-out')).screenshot({ path: join(shots, `recreate-ran-${th}.png`) }); } }
  });
  await t('Use all: no switches, the note says it re-cuts to its shots', async () => {
    await pg.goto(url + '/#step=style', { waitUntil: 'networkidle' }); await pg.waitForSelector('#ref-card');
    await pg.click('#ref-card-mode [data-mode="recreate"]'); await pg.waitForSelector('#ref-card-mode [data-mode="recreate"][aria-checked="true"]');
    assert.strictEqual(await pg.$('#ref-card #ref-parts'), null); assert.match(await pg.textContent('#ref-card-note'), /re-cut to its shots/);
    for (const th of ['dark', 'light']) { await theme(pg, th); await pg.waitForSelector('#ref-card'); await shot(pg, `recreate-useall-${th}.png`); }
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio recreate e2e tests passed`);
process.exit(0);
