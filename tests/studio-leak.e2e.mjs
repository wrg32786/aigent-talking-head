// Whose look is in use, in a real Chrome (report 4 item 7; tests/studio-leak.test.mjs has the rules), no keys, no network:
// - a board with the last video's Look and picks and a reference that is Off: the reference card says
//   "Your saved look is in use, not the reference's." with one button, Use the reference's look
// - the button switches to the reference: the old Look and picks are gone from the board and the line goes away
// - a pick made after that is yours: the line names the part, and the same button takes it back out
// - no terminal command, no em dash, dark and light, and it fits a phone
// Needs Chrome. Run: node tests/studio-leak.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-leak-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'leak-e2e-' + process.pid, TD = join(STATE, 'td');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
process.env.STUDIO_DIR = SDIR; mkdirSync(SDIR, { recursive: true }); mkdirSync(TD, { recursive: true });
const C = await import('../kit/studio/core.mjs');
writeFileSync(join(TD, 'Reel.md'), readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8'));
// the board as the last video left it, then a reference that was broken down and is Off
const s0 = { ...C.defaultState(), job: JOB };
assert.deepStrictEqual(C.applyPatch(s0, { pack: 'hormozi-bold', picks: { 'captionStyle:one-word': 'allow', 'entrance:pop-zoom': 'allow', 'entrance:slam': 'allow', 'transition:glitch': 'allow' }, music: { bed: 'houston-drumline' } }).errs, []);
s0.reference = { ...s0.reference, status: 'ready', mode: 'off', out: TD, extracted: C.extract(join(TD, 'Reel.md')) }; s0.chat = [];
writeFileSync(join(SDIR, 'state.json'), JSON.stringify(s0));
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const theme = async (pg, th, hash) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); return open(pg, hash); };
const shot = async (pg, name, h = 900) => { if (!shots) return; const vp = pg.viewportSize(); await pg.setViewportSize({ width: vp.width, height: h }); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name) }); await pg.setViewportSize(vp); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('studio.paused', '1'); } catch {} });

  await t('a saved look with the reference Off: the card says so, with one button', async () => {
    await open(pg, '#step=picture'); await pg.waitForSelector('#ref-card #ref-look');
    assert.strictEqual((await pg.textContent('#ref-look p')).trim(), 'Your saved look is in use, not the reference\'s.');
    assert.strictEqual(await pg.getAttribute('#ref-look', 'data-use'), 'saved');
    assert.strictEqual(await pg.$$eval('#ref-look button', x => x.length), 1); assert.strictEqual((await pg.textContent('#ref-look-use')).trim(), 'Use the reference\'s look');
    const txt = await pg.textContent('#ref-card'); assert.ok(!/\u2014/.test(txt) && !/npm |pip |python3? /.test(txt), 'plain words, no command');
    await shot(pg, 'r4-leak-saved-look-dark.png'); await theme(pg, 'light', '#step=picture'); await pg.waitForSelector('#ref-look'); await shot(pg, 'r4-leak-saved-look-light.png'); await theme(pg, 'dark', '#step=picture'); await pg.waitForSelector('#ref-look');
  });

  await t('the button switches to the reference: the old Look and picks leave the board and the line goes', async () => {
    await pg.click('#ref-look-use');
    const st = await until(async () => { const j = await api('/api/state'); return j.state.reference.mode !== 'off' && j; });
    assert.strictEqual(st.state.reference.mode, 'look', 'never copied before, so Copy the look: your own cut stays');
    assert.strictEqual(st.refLook, null); assert.notStrictEqual(st.state.pack, 'hormozi-bold'); assert.ok(!st.state.picks.captionStyle && !st.state.picks.entrance && !st.state.picks.transition, JSON.stringify(st.state.picks));
    assert.strictEqual(st.state.music.bed, 'auto'); assert.ok(!st.compose.args.join(' ').match(/hormozi-bold|one-word|pop-zoom|glitch|houston-drumline/), st.compose.args.join(' '));
    await pg.waitForSelector('#ref-card[data-mode="look"]'); await until(async () => !(await pg.$('#ref-look')));
  });

  await t('Recreate sets the board from the reference alone, and a pick after it is named as yours', async () => {
    await pg.click('#ref-card-mode [data-mode="recreate"]'); await pg.waitForSelector('#ref-card[data-mode="recreate"]');
    let st = await api('/api/state'); assert.deepStrictEqual(st.state.picks.entrance.allow, ['blur-rise', 'slide-left', 'stagger-rise']); assert.strictEqual(st.refLook, null);
    st = await api('/api/state', { picks: { 'captionStyle:pill': 'allow' } }); assert.strictEqual(st.refLook.use, 'picks');
    await pg.waitForSelector('#ref-look[data-use="picks"]');
    assert.strictEqual((await pg.textContent('#ref-look p')).trim(), 'Your picks are in use for captions. The rest is the reference\'s.');
    await shot(pg, 'r4-leak-your-picks-dark.png');
    await pg.click('#ref-look-use'); await until(async () => !(await pg.$('#ref-look')));
    st = await api('/api/state'); assert.deepStrictEqual(st.state.picks.captionStyle.allow, ['kinetic'], 'the reference\'s caption style is back');
  });

  await t('the Breakdown shows the same line, and it fits a phone', async () => {
    await api('/api/state', { reference: { mode: 'off' } });
    await open(pg, '#step=reference'); await pg.waitForSelector('#ref-look-td');
    assert.strictEqual((await pg.textContent('#ref-look-td p')).trim(), 'Your saved look is in use, not the reference\'s.');
    await pg.setViewportSize({ width: 390, height: 844 }); await open(pg, '#step=picture'); await pg.waitForSelector('#ref-look');
    const over = await pg.evaluate(() => Math.max(...[...document.querySelectorAll('#ref-card *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().right)) - innerWidth); assert.ok(over <= 1, 'fits a phone: ' + over);
    await shot(pg, 'r4-leak-saved-look-phone.png', 844);
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio leak e2e tests passed`);
process.exit(0);
