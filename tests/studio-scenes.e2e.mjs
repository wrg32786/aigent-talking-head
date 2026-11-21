// Scenes made from a reference (1.22.0, on the eight steps of 1.28.0), in a real Chrome, no keys, no network:
// - the reference card on Picture says what Recreate brings as chips (shots, framing, cutaways, sounds, no music) and
//   what was made for the menu; the made chip opens the layer that holds it (Graphics, on Text and graphics); the plan
//   chips show only in Recreate
// - the made scene is a Graphics tile on Text and graphics that says Made for you, with its own still (rendered like a
//   Make card); picking it sticks
// - one your agent adds shows up without a reload (an effect, under Color and finish on Picture); taking it out removes
//   the tile and the pick
// - screenshots, dark and light
// Needs Chrome. Run: node tests/studio-scenes.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-scenes-e2e-')), SDIR = join(STATE, 'studio'), SCN_DIR = join(STATE, 'scenes');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
process.env.STUDIO_DIR = SDIR; process.env.SCENES_DIR = SCN_DIR;
const JOB = 'scenes-e2e-' + process.pid;
const SC = createRequire(import.meta.url)('../kit/scenes.cjs');
const C = await import('../kit/studio/core.mjs');
const lab = SC.labelScene({ text: 'WOW', t0: 1, bbox: [0.2, 0.3, 0.6, 0.05], style: { fill: '#ffee00', stroke: '#000000', stroke_ratio: 0.08 } }); delete lab.sig;
const made = SC.save({ ...lab, from: { reference: 'ref.mp4' } }).scene;
const EX = { name: 'Boxed labels reel', shots: 8, transitions: {}, entrances: [], finishes: [], graphics: [made.id], effects: [], music: { noBed: true }, summary: { seconds: 20 },
  scenes: [{ id: made.id, name: made.name, kind: 'graphic', inMenu: true, used: 2 }], plan: { shots: 8, framing: ['close-up', 'medium shot'], cutaways: 2, sounds: 3, graphics: 2, noBed: true } };
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, reference: { ...C.defaultState().reference, status: 'ready', mode: 'recreate', extracted: EX } }));
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, SCENES_DIR: SCN_DIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + '\n' + out))); });
const api = async (p, b, method) => (await fetch(url + p, b === undefined && !method ? {} : { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })).json();
// the page keeps a live connection, so wait for the stepper, not for a quiet network. A reload lands on the step in the address
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const step = async (pg, st) => { await pg.click(`#stepper [data-step="${st}"]`); await pg.waitForSelector(`main[data-step="${st}"][data-view="main"]`); };
const shot = async (pg, name, top = true) => { if (!shots) return; if (top) await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, name), fullPage: false }); };
const tile = id => `#grid .tile:has(.pick[data-focus="p:graphic:${id}"])`;

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto(url + '/#step=picture', { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#ref-card');

  await t('the reference card says what Recreate brings and what was made for the menu', async () => {
    const chips = await pg.$$eval('#ref-card #ref-plan .rp-chip', x => x.map(e => e.textContent.trim()));
    assert.deepStrictEqual(chips, ['8 shots', 'close-up, medium shot', '2 cutaways', '3 sounds', 'No music', '1 made for you']);
    const mine = await pg.getAttribute('#ref-card #ref-made', 'title'); assert.strictEqual(mine, made.name, 'the made chip names what was made');
    assert.ok(!/\u2014/.test(chips.join(' ') + mine), 'no em dashes');
    assert.strictEqual(await pg.$('#ref-card-note'), null, 'no paragraph on the card');
  });
  await t('the made chip opens the layer that holds the scene', async () => {
    await pg.click('#tab-color'); await pg.waitForSelector('#tab-color[aria-selected="true"]');
    await pg.click('#ref-card #ref-made'); await pg.waitForSelector('#tab-graphics[aria-selected="true"]');
    assert.strictEqual(await pg.getAttribute('main', 'data-step'), 'text', 'Graphics is on Text and graphics');
    await pg.waitForSelector('#grid[aria-labelledby="tab-graphics"] [data-group="ref-made"]');
    await pg.waitForFunction(() => { const r = document.querySelector('#grid [data-group="ref-made"]').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }, null, { timeout: 8000 });
    await pg.evaluate(() => scrollTo(0, 0));
  });
  await t('the made scene is a Graphics tile that says Made for you, with its own still; picking it sticks', async () => {
    await pg.click('#tab-graphics'); await pg.waitForSelector(tile(made.id));
    assert.ok(/Made from your references/.test(await pg.textContent('#grid')));
    assert.strictEqual(await pg.$eval(tile(made.id) + ' .made', e => e.firstChild.textContent), 'Made for you');
    assert.strictEqual(await pg.$(tile(made.id) + ' .src[data-src="ref"]'), null, 'one label: a made scene never also says From reference');
    assert.ok(!/\bREF\b/.test(await pg.textContent('#grid')), 'no REF badge');
    await pg.$eval(tile(made.id), e => e.scrollIntoView());
    const w = await pg.waitForFunction(sel => { const i = document.querySelector(sel + ' img'); return i && i.complete && i.naturalWidth > 0 && i.naturalWidth; }, tile(made.id), { timeout: 60000 });
    assert.ok(await w.jsonValue() > 0);
    await pg.click(tile(made.id) + ' .pick');
    await pg.waitForSelector(tile(made.id) + ' .pick[aria-pressed="true"]');
    const s = (await api('/api/state')).state; assert.ok(s.picks.graphic.allow.includes(made.id), JSON.stringify(s.picks.graphic));
    // the Picks tray names it (never the ref-... id) and marks it Made for you
    await pg.click('#picks-open'); const chip = `#picks-panel .chip[data-pick="graphic:${made.id}"]`; await pg.waitForSelector(chip);
    assert.strictEqual((await pg.textContent(chip)).trim(), made.name); assert.strictEqual(await pg.getAttribute(chip, 'title'), 'Made for you');
    assert.ok(!(await pg.textContent('#picks-panel')).includes('ref-'), 'no ids in the tray'); await pg.keyboard.press('Escape'); await pg.waitForSelector('#picks-panel', { state: 'detached' });
    await theme(pg, 'dark'); await pg.click('#tab-graphics'); await pg.$eval(tile(made.id), e => e.scrollIntoView({ block: 'center' })); await shot(pg, 'scenes-look-dark.png', false);
    await theme(pg, 'light'); await pg.click('#tab-graphics'); await pg.$eval(tile(made.id), e => e.scrollIntoView({ block: 'center' })); await shot(pg, 'scenes-look-light.png', false);
    await theme(pg, 'dark'); await step(pg, 'picture'); await pg.waitForSelector('#ref-card'); await pg.evaluate(() => scrollTo(0, 0)); await shot(pg, 'scenes-ref-card.png');
  });
  let agent;
  await t('one your agent adds shows up without a reload; taking it out removes the tile and the pick', async () => {
    const r = await api('/api/scenes', { name: 'Flash on the cut', kind: 'effect', seconds: 0.6, box: { x: 0, y: 0, w: 1, h: 1 }, html: '<i></i>', css: 'i{position:absolute;inset:0;background:#fff;animation:f .6s forwards}@keyframes f{to{opacity:0}}' });
    agent = r.scene; assert.ok(r.added && /^ref-flash-on-the-cut-/.test(agent.id));
    const bad = await fetch(url + '/api/scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', kind: 'effect', seconds: 1, html: '<script>1</script>' }) });
    assert.ok(bad.status >= 400, 'a scene with a script is refused');
    await step(pg, 'picture'); await pg.click('#tab-color'); await pg.waitForSelector(tile(agent.id), { timeout: 15000 });
    assert.strictEqual(await pg.$eval(tile(agent.id) + ' .made', e => e.dataset.made), 'agent'); assert.strictEqual(await pg.$eval(tile(agent.id) + ' .made', e => e.firstChild.textContent), 'Made for you');
    await api('/api/scenes/' + made.id, undefined, 'DELETE');
    await step(pg, 'text'); await pg.click('#tab-graphics'); await pg.waitForSelector('#grid[aria-labelledby="tab-graphics"] .tile'); await pg.waitForFunction(sel => !document.querySelector(sel), tile(made.id), { timeout: 15000 });
    const s = (await api('/api/state')).state; assert.ok(!((s.picks.graphic || {}).allow || []).includes(made.id));
  });
  await t('plan chips only in Recreate, the made chip in any mode but Off', async () => {
    await step(pg, 'picture'); await pg.evaluate(() => scrollTo(0, 0));
    await pg.click('#ref-card-mode [data-mode="influence"]'); await pg.waitForSelector('#ref-card-mode [data-mode="influence"][aria-checked="true"]');
    assert.deepStrictEqual(await pg.$$eval('#ref-card #ref-plan .rp-chip', x => x.map(e => e.textContent.trim())), ['1 made for you']);
    await pg.click('#ref-card-mode [data-mode="off"]'); await pg.waitForSelector('#ref-card #ref-plan', { state: 'detached' });
    await pg.click('#ref-card-mode [data-mode="recreate"]'); await pg.waitForSelector('#ref-card #ref-plan [data-plan="shots"]');
  });
  assert.deepStrictEqual(errs, []);
} finally {
  await browser.close(); srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
console.log(`studio-scenes e2e: ${n} passed`);
process.exit(0);
