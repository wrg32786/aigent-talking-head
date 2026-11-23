// The B-roll step's slot cards (1.28.0) in a real Chrome, with no keys and no network:
// - a draft whose plan has B-roll slots shows one card per slot: "Needs B-roll: <what it should show>", with Upload,
//   Copy for my agent and Skip; no Use stock without a key, no Send to my agent with no agent connected
// - the step face is calm: no "API keys and providers", the keys and Add a spot sit in More, the source tabs sit
//   behind "Choose something else", no engine words ("Stock: ...", "(full cutaway)")
// - Copy for my agent copies a ready instruction; Skip keeps the slot and Put it back restores it; Upload on a card
//   fills that slot as a panel and its card goes
// - screenshots, dark and light
// Needs Chrome. Run: node tests/studio-broll-slots.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
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
const STATE = mkdtempSync(join(tmpdir(), 'studio-broll-slots-e2e-')), LIB = join(STATE, 'lib'), JOB = 'broll-slots-e2e-' + process.pid;
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
const CLIP = join(STATE, 'my-screen.mp4'); execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=6', '-pix_fmt', 'yuv420p', CLIP]);

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: LIB, STUDIO_BROLL_AUTO: '', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#broll-needs .need'); };
const shot = async (pg, name) => { if (!shots) return; await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, name) }); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await t('one card per slot says what it needs, with Upload, Copy for my agent and Skip', async () => {
    await open(pg, '#step=broll'); await pg.waitForSelector('#broll-needs .need');
    assert.strictEqual(await pg.locator('#broll-needs .need').count(), 3);
    const c1 = pg.locator('#broll-needs .need[data-slot="1"]');
    assert.strictEqual((await c1.locator('.need-h').textContent()).trim(), 'Show the dashboard on screen. It fits what you say here.'); // 1.29.0: the card leads with the brief (your words), the reference is only a hint
    const d = await c1.locator('.need-d').textContent(); assert.ok(/s · a framed panel under your face · slow push in, pops in/.test(d), d);
    assert.ok(/covers the whole frame/.test(await pg.locator('#broll-needs .need[data-slot="3"] .need-d').textContent()));
    assert.deepStrictEqual((await c1.locator('.need-acts').innerText()).split('\n').map(x => x.trim()).filter(Boolean), ['Upload', 'Copy for my agent', 'Skip']);
    assert.strictEqual(await pg.locator('.need-stock').count(), 0, 'no stock button without a key'); assert.strictEqual(await pg.locator('.need-send').count(), 0, 'no agent connected');
    assert.strictEqual((await pg.textContent('#broll-count')).trim(), '0 of 3 B-roll spots filled.', 'the step says how many slots the reference has and how many are filled'); assert.ok(/3 still need a clip from you/.test(await pg.textContent('#s-broll .sub')));
    assert.strictEqual(await pg.locator('#broll-lane .spot.needs').count(), 3, 'the lane marks them');
  });
  await t('the step face is calm: keys and Add a spot in More, sources behind Choose something else, no engine words', async () => {
    const face = await pg.locator('#s-broll').innerText();
    assert.ok(!/API keys and providers/.test(face) && !/Stock: /.test(face) && !/\(full cutaway\)/i.test(face) && !/\u2014/.test(face), face.slice(0, 400));
    assert.strictEqual(await pg.isVisible('#open-keys'), false); assert.strictEqual(await pg.isVisible('#broll-add-spot'), false);
    assert.strictEqual(await pg.locator('#btab-library').count(), 0, 'the source tabs are folded away');
    await pg.click('#broll-more'); await pg.waitForSelector('#btab-library');
    assert.deepStrictEqual(await pg.locator('.btabs .tab').allInnerTexts(), ['Library', 'Fast run', 'Upload', 'Stock', 'Make a card', 'Record my screen', 'Generate (paid)']);
    await pg.click('#broll-more-fold > summary'); assert.ok(await pg.isVisible('#open-keys')); assert.ok(await pg.isVisible('#broll-add-spot'));
    await pg.click('#broll-more-fold > summary');
    await shot(pg, 'broll-slots-dark.png');
  });
  await t('Copy for my agent copies a ready instruction to capture it, with no terminal command', async () => {
    await pg.click('#broll-needs .need[data-slot="1"] .need-copy');
    const tx = await until(async () => { const c = await pg.evaluate(() => navigator.clipboard.readText().catch(() => '')); return /slot 1/.test(c) ? c : null; });
    assert.ok(/Capture a screen recording/.test(tx) && /Open the dashboard/.test(tx) && /wide 16:9/.test(tx) && /The reference showed Dashboard/.test(tx), tx);
    assert.ok(!/npm |node |\u2014/.test(tx));
  });
  await t('Skip keeps the slot and says so; Put it back restores the card', async () => {
    await pg.click('#broll-needs .need[data-slot="3"] .need-skip');
    await pg.waitForSelector('#broll-needs .need.skipped[data-slot="3"]');
    assert.ok(/Skipped/.test(await pg.textContent('#broll-needs .need[data-slot="3"]')) && /You stay on screen here/.test(await pg.textContent('#broll-needs .need[data-slot="3"]')));
    assert.ok(/2 still need a clip/.test(await pg.textContent('#s-broll .sub')));
    assert.strictEqual((await api('/api/broll')).beats.filter(b => b.need).length, 3, 'the slot is still in the plan');
    await pg.click('#broll-needs .need[data-slot="3"] .need-undo'); await pg.waitForSelector('#broll-needs .need[data-slot="3"]:not(.skipped)');
  });
  await t('Upload on a card fills that slot as a panel, and its card goes', async () => {
    await pg.setInputFiles('#broll-needs .need[data-slot="1"] input[type=file]', CLIP);
    await until(async () => (await pg.locator('#broll-needs .need').count()) === 2, 30000);
    const b = (await api('/api/broll')).beats.find(x => x.slot); assert.ok(b && b.slot.place === 'card' && b.ref.slot.n === 1, JSON.stringify(b && b.slot));
    await pg.waitForSelector(`#broll-lane .spot[data-beat="${b.n}"].filled`);
    assert.ok(/Panel/.test(await pg.textContent(`#broll-lane .spot[data-beat="${b.n}"] .bslot`)));
  });
  await t('light theme, and no page errors', async () => {
    await api('/api/broll/slot', { beat: (await api('/api/broll')).beats.find(x => x.slot).n, clear: true });
    await theme(pg, 'light'); assert.strictEqual(await pg.locator('#broll-needs .need').count(), 3); await shot(pg, 'broll-slots-light.png');
    await theme(pg, 'dark');
    assert.deepStrictEqual(errs, []);
  });
  console.log(`\n${n} studio b-roll slots e2e tests passed`);
} finally { await browser.close().catch(() => {}); srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); }
