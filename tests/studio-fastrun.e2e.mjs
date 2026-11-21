// The B-roll step's count line and Fast run (1.28.0, Studio report 4 item 11) in a real Chrome, no keys, no network:
// - the step says how many B-roll spots the reference has and how many are filled ("0 of 2 B-roll spots filled")
// - a slot where the reference cuts fast shows "Needs B-roll: a fast run of 5 clips or pictures" with one button,
//   Pick clips for the run, which opens the Fast run tab
// - on the tab you pick library clips in play order (each shows its number), choose half beat or beat, and Make the
//   run puts one clip on the spot: split on top for wide pictures, N cuts, shown whole
// - the count goes up; the run clip is made from the clips you picked and the render plan carries them
// - the route refuses a run of one, and a run inside a run
// - screenshots, dark and light
// Needs Chrome. Run: node tests/studio-fastrun.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
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
const STATE = mkdtempSync(join(tmpdir(), 'studio-fastrun-e2e-')), LIB = join(STATE, 'lib'), JOB = 'fastrun-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// a drafted job: 24 s of your words; the reference had one panel and, later, five cuts 0.21 s apart
const LINES = ['Editing ate my weekends.', 'I tried every app.', 'Then I found one prompt.', 'It plans the whole edit.', 'Here is how to set it up.', 'Open the dashboard.', 'Type your topic.', 'And press go.', 'We built thirty sites this way.', 'In three months.', 'Follow the repo for more.', 'Tell me how it went.'];
const WORDS = LINES.flatMap((l, k) => { const ws = l.split(' '), d = 1.6 / ws.length; return ws.map((w, i) => ({ start: +(k * 2 + 0.1 + i * d).toFixed(3), end: +(k * 2 + 0.1 + (i + 1) * d - 0.03).toFixed(3), word: w })); });
const flips = LINES.map((l, k) => ({ start: +(k * 2 + 0.1).toFixed(2), end: +(k * 2 + 1.8).toFixed(2), text: l }));
const ref = BS.detect([{ start: 20, end: 26, box: [0.19, 0.57, 0.62, 0.21], shows: 'Dashboard', shot: 'screen recording' }, ...[0, 1, 2, 3, 4].map(i => ({ start: +(32.4 + i * 0.21).toFixed(2), end: +(32.4 + (i + 1) * 0.21).toFixed(2), kind: 'full' }))], [{ in: 'pop', out: 'fade' }]);
assert.deepStrictEqual(ref.map(s => s.run || 0), [0, 5]);
const slots = BS.forRecreate(ref, { k: 0.5, len: 24, words: WORDS, refLen: 48 });
assert.strictEqual(slots.length, 2);
const CUT = { segs: [{ file: 'x.mp4', in: 0, out: 24 }] }, jobDir = join(ROOT, 'jobs', JOB), build = join(jobDir, 'build'); mkdirSync(build, { recursive: true });
writeFileSync(join(build, 'cut.json'), JSON.stringify(CUT));
writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify({ flips }) + ';\n');
RC.writePlan(build, RC.planOf({ recipe: { file: 'Reel.md' }, cut: CUT, broll: slots }));
// three "sites": wide pictures, neutral colours, no brand
const SITES = ['slate', 'teal', 'sand'].map((name, i) => { const f = join(STATE, `site-${name}.png`); execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${['0x2b3340', '0x1f6f6a', '0xd9c9a3'][i]}:s=1280x720`, '-vf', 'drawbox=x=80:y=70:w=1120:h=90:color=white@0.25:t=fill,drawbox=x=80:y=220:w=520:h=380:color=white@0.18:t=fill,drawbox=x=660:y=220:w=540:h=180:color=white@0.12:t=fill', '-frames:v', '1', f]); return f; });

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: LIB, STUDIO_BROLL_AUTO: '', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const raw = async (p, b) => { const r = await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const api = async (p, b) => (await raw(p, b)).body;
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#broll-lane'); };
const shot = async (pg, name) => { if (!shots) return; await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, name) }); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB });
  const ids = [];
  for (const f of SITES) { const r = await fetch(`${url}/api/broll/upload?name=${encodeURIComponent(f.split('/').pop())}&type=product-demo`, { method: 'POST', body: readFileSync(f) }); const j = await r.json(); assert.ok(r.ok, JSON.stringify(j)); ids.push(j.clip.id); }
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const runCard = '#broll-needs .need[data-slot="2"]';

  await t('the step says how many B-roll spots the reference has and how many are filled', async () => {
    await open(pg, '#step=broll'); await pg.waitForSelector('#broll-count');
    assert.strictEqual((await pg.textContent('#broll-count')).trim(), '0 of 2 B-roll spots filled.');
    assert.match(await pg.textContent('#s-broll .sub'), /Your reference has B-roll at each one; 2 still need a clip from you\./);
    const v = await api('/api/broll'); assert.deepStrictEqual([v.slots.total, v.slots.filled, v.slots.from], [2, 0, 'reference']);
  });
  await t('a slot where the reference cuts fast asks for a fast run, with one button that opens the tab', async () => {
    assert.strictEqual((await pg.locator(runCard + ' .need-h').textContent()).trim(), 'Needs B-roll: a fast run of 5 clips or pictures');
    assert.match(await pg.locator(runCard + ' .need-d').textContent(), /one every 0\.21 s, on the beat/);
    assert.deepStrictEqual((await pg.locator(runCard + ' .need-acts').innerText()).split('\n').map(x => x.trim()).filter(Boolean), ['Pick clips for the run', 'Copy for my agent', 'Skip']);
    assert.strictEqual(await pg.locator(runCard + ' input[type=file]').count(), 0, 'one clip is not what this slot wants');
    await pg.click(runCard + ' .need-run'); await pg.waitForSelector('#bp-run');
    assert.match(await pg.textContent('#run-hint'), /Pick 2 or more in the order they should play \(the reference cuts 5 here\)\. We cut them on the beat as one piece of B-roll\. Each one is shown whole/);
    assert.ok(await pg.isDisabled('#run-make'), 'nothing to make yet'); await until(async () => (await pg.locator('#run-grid .run-pick').count()) === 3);
    const tx = await pg.locator('#bp-run').innerText(); assert.ok(!/\u2014|npm |ffmpeg/.test(tx), tx);
  });
  await t('pick clips in play order, each shows its number; Make the run puts one clip on the spot', async () => {
    for (const id of [ids[2], ids[0], ids[1]]) await pg.click(`#run-grid .run-pick[data-id="${id}"]`);
    assert.deepStrictEqual(await pg.$$eval('#run-grid .run-pick.on', els => els.map(e => [e.dataset.id, e.querySelector('.run-n').textContent]).sort((a, b) => a[1] - b[1]).map(x => x[0])), [ids[2], ids[0], ids[1]], 'the numbers follow the order you clicked');
    await pg.click(`#run-grid .run-pick[data-id="${ids[0]}"]`); await pg.click(`#run-grid .run-pick[data-id="${ids[0]}"]`); // off, then on again: it goes last
    assert.strictEqual(await pg.textContent(`#run-grid .run-pick[data-id="${ids[0]}"] .run-n`), '3');
    assert.match(await pg.textContent('#run-pace'), /^3 cuts, about 0\.8 s/); assert.strictEqual((await pg.textContent('#run-make')).trim(), 'Make the run (3)');
    for (const th of ['dark', 'light']) { await pg.evaluate(x => { localStorage.setItem('studio.theme', x); document.documentElement.dataset.theme = x; document.documentElement.classList.toggle('dark', x === 'dark'); }, th); await pg.$eval('#bp-run', e => e.scrollIntoView({ block: 'center' })); await shot(pg, `fastrun-pick-${th}.png`); }
    await pg.click('#run-make');
    const b = await until(async () => (await api('/api/broll')).beats.find(x => x.slot && x.slot.clip.run), 60000);
    assert.deepStrictEqual([b.slot.clip.source, b.slot.clip.run.n, b.slot.place, b.ref.slot.n], ['run', 3, 'top', 2], JSON.stringify(b.slot));
    assert.ok(Math.abs(b.slot.dur - 0.75) < 0.05 && b.slot.in === 0, 'three cuts of a quarter second, from its start: ' + b.slot.dur);
    await pg.waitForSelector(`#broll-lane .spot[data-beat="${b.n}"].filled`);
    await until(async () => (await pg.locator('#broll-needs .need').count()) === 1);
    assert.strictEqual((await pg.textContent('#broll-count')).trim(), '1 of 2 B-roll spots filled.');
    await pg.click(`#broll-lane .spot[data-beat="${b.n}"]`); await pg.waitForSelector('#slot-set');
    assert.match(await pg.locator('#slot-set .col .fine').first().textContent(), /Fast run: 3 clips · 3 cuts, one every 0\.25 s, on the beat/);
    assert.match(await pg.textContent('#slot-why'), /3 clips, one every 0\.25 s/);
  });
  await t('the made clip is in the library as one clip of the clips you picked, and the render plan carries them', async () => {
    const lib = (await api('/api/broll/library?q=')).clips, rc = lib.find(c => c.run); assert.ok(rc && rc.name === 'Fast run: 3 clips' && rc.width === 1080 && rc.height === 960, JSON.stringify(rc));
    assert.ok(Math.abs(rc.seconds - 0.75) < 0.06);
    const idx = JSON.parse(readFileSync(join(LIB, 'library.json'), 'utf8')).clips.find(c => c.id === rc.id);
    assert.deepStrictEqual(idx.run.clips, [ids[2], ids[1], ids[0]]); assert.strictEqual(idx.run.beat, 'half');
    // a fast run is not offered as a thing to put inside another run
    await pg.click('#broll-more').catch(() => {}); await pg.click('#btab-run'); await pg.waitForSelector('#run-grid');
    await until(async () => (await pg.locator('#run-grid .run-pick').count()) === 3);
  });
  await t('the route refuses a run of one and a run inside a run, in plain words', async () => {
    const one = await raw('/api/broll/run', { clips: [ids[0]], beat: 1 }); assert.strictEqual(one.status, 400); assert.match(one.body.error, /needs 2 or more clips or pictures/);
    const rc = (await api('/api/broll/library?q=')).clips.find(c => c.run), nest = await raw('/api/broll/run', { clips: [rc.id, ids[0]] });
    assert.strictEqual(nest.status, 400); assert.match(nest.body.error, /cannot hold another fast run/);
    const gone = await raw('/api/broll/run', { clips: [ids[0], 'brnope'] }); assert.strictEqual(gone.status, 404);
    // with no spot given it only makes the clip: step beat, and upright pictures would cover the frame
    const free = await raw('/api/broll/run', { clips: [ids[0], ids[1]], step: 'beat' }); assert.strictEqual(free.status, 200); assert.ok(Math.abs(free.body.seconds - 1) < 0.05 && free.body.place === 'top', JSON.stringify(free.body).slice(0, 200));
  });
  await t('dark and light, and no page errors', async () => {
    for (const th of ['dark', 'light']) { await theme(pg, th); await pg.waitForSelector('#broll-count'); await pg.evaluate(() => scrollTo(0, 0)); await shot(pg, `fastrun-step-${th}.png`); }
    await theme(pg, 'dark');
    assert.deepStrictEqual(errs, []);
  });
  console.log(`\n${n} studio fast run e2e tests passed`);
} finally { await browser.close().catch(() => {}); srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); }
