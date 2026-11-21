// The eight steps (1.28.0) in a real Chrome, with no keys and no network:
// - the stepper has 8 dots in order: Start, Cut, Picture, Text and graphics, B-roll, Music and sounds, Review, Render
// - Next walks through all 8, each with one heading
// - Start has the three choices; Copy the look opens the reference box and sets the reference to that mode
// - every old link lands: #step=footage, look, style, reference, finish, post, and #menu=music opens Music and sounds
// - each step shows only its own layers; search finds an option from another step and jumps there
// - screenshots of every step, desktop and phone, dark and light
// Needs Chrome. Run: node tests/studio-steps.e2e.mjs [--shots <dir>]
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-steps-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'steps-e2e-' + process.pid, TD = join(STATE, 'td');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
const { STEPS, STEP_LABEL } = await import('../kit/studio/web/src/steps.js');
// a reference that was already read: 6 shots, a sound, music
mkdirSync(join(TD, 'videomd'), { recursive: true });
const SH = [[0, 2, 'close-up'], [2, 3.5, 'close-up'], [3.5, 6, 'medium close-up'], [6, 8, 'medium shot'], [8, 10, 'extreme close-up'], [10, 12, 'close-up']];
const B = { source: { file: 'ref.mp4', duration: 12 }, summary: { duration: 12 }, audio: { music: { present: true, tempo_bpm: 120 } }, stems: { level_db: { music: -20, vocals: -18 } },
  shots: SH.map(([a, b, size], i) => ({ start: a, end: b, transition_in: i ? (i % 2 ? 'dissolve' : 'cut') : 'start', faces: 1, aspects: { framing: { result: { shot_size: size } } } })),
  audio_plan: { sfx_merged: [{ t: 2, dur: 0.2, level_db: -20, type: 'pop' }] }, speech: { words: [], lines: [] } };
writeFileSync(join(TD, 'videomd', 'breakdown.json'), JSON.stringify(B));
execFileSync(process.execPath, [join(ROOT, 'kit', 'videomd2reel.cjs'), join(TD, 'videomd', 'breakdown.json'), '--out', join(TD, 'Reel.md'), '--report', join(TD, 'teardown.md')], { stdio: 'pipe' });
const EX = C.extract(join(TD, 'Reel.md'));
mkdirSync(SDIR, { recursive: true });
const seed = ref => writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, ...(ref ? { reference: { ...C.defaultState().reference, status: 'ready', mode: 'recreate', extracted: EX } } : {}) }));
seed(false);
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '', STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs' };
const start = () => new Promise((ok, bad) => { const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok({ srv, url: m[1] }); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + '\n' + out))); });
let { srv, url } = await start();
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const cur = pg => pg.$eval('#stepper [aria-current="step"]', b => b.dataset.step);
const h2 = pg => pg.$eval('main .step:not([hidden]) h2', h => h.textContent.trim());

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('studio.paused', '1'); } catch {} });
  await open(pg, '');

  await t('the stepper has the 8 steps in order', async () => {
    const got = await pg.$$eval('#stepper button', bs => bs.map(b => [b.dataset.step, b.title]));
    assert.deepStrictEqual(got.map(x => x[0]), STEPS);
    assert.deepStrictEqual(got.map(x => x[1]), ['Start', 'Cut', 'Picture', 'Text and graphics', 'B-roll', 'Music and sounds', 'Review', 'Render']);
    assert.strictEqual(await cur(pg), 'start');
  });

  await t('Next walks through all 8 steps, one heading each', async () => {
    const seen = [await h2(pg)];
    for (let i = 1; i < STEPS.length; i++) { await pg.click('#next'); await pg.waitForFunction(st => document.querySelector('#stepper [aria-current="step"]').dataset.step === st, STEPS[i]); seen.push(await h2(pg)); }
    assert.deepStrictEqual(seen, STEPS.map(s => STEP_LABEL[s]));
    assert.strictEqual(await pg.$('#next'), null, 'Render is the last step');
    assert.ok(await pg.$('#render-sub-post'), 'Post is a view of Render');
  });

  await t('Start: three choices, Just my footage by default', async () => {
    await pg.click('#stepper [data-step="start"]');
    const modes = await pg.$$eval('#start-mode [role="radio"]', bs => bs.map(b => [b.dataset.mode, b.getAttribute('aria-checked'), b.textContent]));
    assert.deepStrictEqual(modes.map(m => m[0]), ['own', 'recreate', 'look']);
    assert.deepStrictEqual(modes.map(m => m[1]), ['true', 'false', 'false']);
    assert.match(modes[1][2], /Same edit, your take/); assert.match(modes[2][2], /Same style, your script/);
    assert.strictEqual(await pg.$('#recreate-card'), null, 'no reference box until you ask for one');
    assert.strictEqual(await pg.$('#saved-looks'), null, 'no empty list of saved looks');
  });

  await t('Copy the look opens the reference box', async () => {
    await pg.click('#mode-look');
    await pg.waitForSelector('#recreate-card[data-mode="look"] #recreate-link');
    assert.strictEqual(await pg.$eval('#mode-look', b => b.getAttribute('aria-checked')), 'true');
    assert.match(await pg.$eval('#recreate-h', e => e.textContent), /look you want/);
    // the server takes the mode when it knows it (1.28.0 engine); an older one keeps its own and the page stays calm
    const mode = (await api('/api/state')).state.reference.mode;
    assert.ok(['look', 'influence'].includes(mode), 'mode ' + mode);
    assert.strictEqual(await pg.$('#toast:not([hidden])'), null, 'no error shown');
    await pg.click('#mode-recreate');
    await pg.waitForSelector('#recreate-card[data-mode="recreate"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.reference.mode === 'recreate');
    await pg.click('#mode-own'); await pg.waitForSelector('#recreate-card', { state: 'detached' });
  });

  await t('old links land on the step that holds them now', async () => {
    for (const [hash, step, sel] of [['#step=footage', 'start', '#s-footage'], ['#step=look', 'picture', '#s-look'], ['#step=style', 'picture', '#s-look'], ['#step=reference', 'picture', '#s-ref'],
      ['#step=finish', 'review', '#s-review:not([hidden])'], ['#step=render', 'render', '#s-render:not([hidden])'], ['#step=post', 'render', '#s-post'], ['#step=music', 'music', '#s-sound'],
      ['#menu=music', 'music', '#s-sound'], ['#menu=transitions', 'picture', '#tab-transitions[aria-selected="true"]'], ['#menu=captions', 'text', '#tab-text[aria-selected="true"]'], ['#menu=graphics', 'text', '#tab-graphics[aria-selected="true"]']]) {
      await open(pg, hash); await pg.waitForSelector(sel);
      assert.strictEqual(await cur(pg), step, hash);
    }
  });

  await t('a second view stays after a reload: Post inside Render', async () => {
    await open(pg, '#step=render'); await pg.click('#render-sub-post'); await pg.waitForSelector('#s-post');
    assert.match(await pg.evaluate(() => location.hash), /step=post/);
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#s-post');
    await pg.click('#render-sub-main'); await pg.waitForSelector('#s-render:not([hidden])');
    assert.match(await pg.evaluate(() => location.hash), /step=render/);
  });

  await t('#step=music: sound on its own step', async () => {
    await open(pg, '#step=music');
    assert.strictEqual(await h2(pg), 'Music and sounds');
    for (const id of ['#bed', '#energy', '#beat-sync', '#sfx', '#cap', '#pacing-line']) assert.ok(await pg.$(id), id);
    assert.strictEqual(await pg.$('#punch'), null, 'zoom punch is a picture control');
    assert.strictEqual(await pg.$('#music-ref'), null, 'no reference line without a reference');
    assert.ok(!/\bBPM\b/.test(await pg.$eval('#s-sound', e => e.innerText)));
  });

  await t('each step shows its own layers, and search jumps across steps', async () => {
    await open(pg, '#step=picture');
    assert.deepStrictEqual(await pg.$$eval('#tabs .tab', bs => bs.map(b => b.id)), ['tab-color', 'tab-motion', 'tab-transitions', 'tab-layout']);
    await pg.click('#tab-motion'); await pg.waitForSelector('#punch');
    await pg.click('#stepper [data-step="text"]'); await pg.waitForSelector('#tab-text');
    assert.deepStrictEqual(await pg.$$eval('#tabs .tab', bs => bs.map(b => b.id)), ['tab-text', 'tab-fonts', 'tab-graphics']);
    await pg.fill('#filter', 'crossfade');
    await pg.waitForSelector('[data-jump="transitions"]');
    await pg.click('[data-jump="transitions"]');
    await pg.waitForSelector('#tab-transitions[aria-selected="true"]');
    assert.strictEqual(await cur(pg), 'picture');
  });

  await t('with a reference in: the card leads Picture, Music says what it brought, Your edit says the mode', async () => {
    srv.kill(); await new Promise(r => srv.on('close', r)); seed(true); ({ srv, url } = await start());
    await open(pg, '#step=picture');
    await pg.waitForSelector('#ref-card');
    assert.deepStrictEqual(await pg.$$eval('#ref-card-mode [role="radio"]', bs => bs.map(b => b.textContent)), ['Recreate', 'Copy the look', 'Influence', 'Off']);
    assert.match(await pg.$eval('#your-edit [data-part="look"]', e => e.textContent), /Recreating /);
    await open(pg, '#step=start');
    assert.strictEqual(await pg.$eval('#mode-recreate', b => b.getAttribute('aria-checked')), 'true');
    await pg.waitForSelector('#recreate-ready');
    await open(pg, '#step=music');
    assert.match(await pg.$eval('#music-ref', e => e.textContent), /From your reference: .*1 sound.*fast tempo/);
    // the Fonts layer says whose font the next draft uses, and a font picked here is yours from then on
    await open(pg, '#step=text&menu=fonts');
    await pg.waitForSelector('#tab-fonts[aria-selected="true"]');
    assert.match(await pg.$eval('#font-ref', e => e.textContent), /^From your reference: .*Pick one here to use yours instead\.$/);
    assert.strictEqual(await pg.$eval('#font-ref', e => e.dataset.locked), 'false');
    const st = await (await fetch(url + '/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ picks: { 'font:literata': 'allow' } }) })).json();
    assert.strictEqual(st.state.fontLock, true); assert.deepStrictEqual(st.refFont.locked, true);
    await pg.waitForFunction(() => /^Your font is used/.test((document.querySelector('#font-ref') || {}).textContent || ''), null, { timeout: 8000 });
  });

  assert.deepStrictEqual(errs, [], 'no page errors');

  if (shots) {
    const VIEWS = [['', { width: 1440, height: 900 }], ['-phone', { width: 390, height: 844 }]];
    const PAGES = [['start', '#step=start'], ['cut', '#step=cut'], ['picture', '#step=picture'], ['text', '#step=text'], ['broll', '#step=broll'], ['music', '#step=music'], ['review', '#step=review'], ['render', '#step=render'], ['render-post', '#step=post'], ['picture-reference', '#step=reference']];
    for (const th of ['dark', 'light']) for (const [suffix, vp] of VIEWS) {
      const p2 = await browser.newPage({ viewport: vp });
      await p2.addInitScript(x => { try { localStorage.setItem('studio.paused', '1'); localStorage.setItem('studio.theme', x); } catch {} }, th);
      for (const [name, hash] of PAGES) { await open(p2, hash); await p2.waitForTimeout(700); await p2.screenshot({ path: join(shots, `${name}${suffix}-${th}.png`) }); }
      await p2.close();
    }
  }
  console.log(`\n${n} checks passed`);
} finally { await browser.close(); srv.kill(); rmSync(STATE, { recursive: true, force: true }); }
