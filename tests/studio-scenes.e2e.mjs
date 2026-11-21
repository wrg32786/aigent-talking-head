// Scenes made from a reference on the Look step (1.22.0), in a real Chrome, no keys, no network:
// - the reference card says what Recreate brings (shots, framing, cutaways, sounds, no bed) and what was made for the menu
// - the made scene is a Graphics tile with a REF badge and its own still (rendered like a Make card); picking it sticks
// - one your agent adds shows up without a reload; taking it out removes the tile and the pick
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
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForSelector('#s-look:not([hidden])'); };
const shot = async (pg, name, top = true) => { if (!shots) return; if (top) await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, name), fullPage: false }); };
const tile = id => `#grid .tile:has(.pick[data-focus="p:graphic:${id}"])`;

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto(url + '/#step=style', { waitUntil: 'networkidle' }); await pg.waitForSelector('#ref-card');

  await t('the reference card says what Recreate brings and what was made for the menu', async () => {
    const plan = await pg.textContent('#ref-plan'), mine = await pg.textContent('#ref-made');
    assert.ok(/8 shots/.test(plan) && /close-up/.test(plan) && /2 cutaway spots/.test(plan) && /3 sound effects/.test(plan) && /no music bed/.test(plan), plan);
    assert.ok(mine.includes(made.name) && /REF badge/.test(mine), mine);
    assert.ok(!/—/.test(plan + mine), 'no em dashes');
  });
  await t('the made scene is a Graphics tile with a REF badge and its own still; picking it sticks', async () => {
    await pg.click('#tab-graphics'); await pg.waitForSelector(tile(made.id));
    assert.ok(/Made from your references/.test(await pg.textContent('#grid')));
    assert.strictEqual(await pg.$eval(tile(made.id) + ' .made', e => e.textContent.trim().slice(0, 3)), 'REF');
    await pg.$eval(tile(made.id), e => e.scrollIntoView());
    const w = await pg.waitForFunction(sel => { const i = document.querySelector(sel + ' img'); return i && i.complete && i.naturalWidth > 0 && i.naturalWidth; }, tile(made.id), { timeout: 60000 });
    assert.ok(await w.jsonValue() > 0);
    await pg.click(tile(made.id) + ' .pick');
    await pg.waitForSelector(tile(made.id) + ' .pick[aria-pressed="true"]');
    const s = (await api('/api/state')).state; assert.ok(s.picks.graphic.allow.includes(made.id), JSON.stringify(s.picks.graphic));
    await theme(pg, 'dark'); await pg.click('#tab-graphics'); await pg.$eval(tile(made.id), e => e.scrollIntoView({ block: 'center' })); await shot(pg, 'scenes-look-dark.png', false);
    await theme(pg, 'light'); await pg.click('#tab-graphics'); await pg.$eval(tile(made.id), e => e.scrollIntoView({ block: 'center' })); await shot(pg, 'scenes-look-light.png', false);
    await theme(pg, 'dark'); await pg.evaluate(() => scrollTo(0, 0)); await shot(pg, 'scenes-ref-card.png');
  });
  let agent;
  await t('one your agent adds shows up without a reload; taking it out removes the tile and the pick', async () => {
    const r = await api('/api/scenes', { name: 'Flash on the cut', kind: 'effect', seconds: 0.6, box: { x: 0, y: 0, w: 1, h: 1 }, html: '<i></i>', css: 'i{position:absolute;inset:0;background:#fff;animation:f .6s forwards}@keyframes f{to{opacity:0}}' });
    agent = r.scene; assert.ok(r.added && /^ref-flash-on-the-cut-/.test(agent.id));
    const bad = await fetch(url + '/api/scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', kind: 'effect', seconds: 1, html: '<script>1</script>' }) });
    assert.ok(bad.status >= 400, 'a scene with a script is refused');
    await pg.click('#tab-color'); await pg.waitForSelector(tile(agent.id), { timeout: 15000 });
    assert.strictEqual(await pg.$eval(tile(agent.id) + ' .made', e => e.dataset.made), 'agent');
    await api('/api/scenes/' + made.id, undefined, 'DELETE');
    await pg.click('#tab-graphics'); await pg.waitForFunction(sel => !document.querySelector(sel), tile(made.id), { timeout: 15000 });
    const s = (await api('/api/state')).state; assert.ok(!((s.picks.graphic || {}).allow || []).includes(made.id));
  });
  assert.deepStrictEqual(errs, []);
} finally {
  await browser.close(); srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
console.log(`studio-scenes e2e: ${n} passed`);
process.exit(0);
