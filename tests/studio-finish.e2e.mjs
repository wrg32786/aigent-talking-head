// The Studio flow in a real Chrome, on synthetic media only (tests/fixtures): eight steps (Start, Cut, Picture,
// Text and graphics, B-roll, Music and sounds, Review, Render), the old step links still land (Footage opens Start,
// Style and Reference open Picture, Finish opens Review, Render opens Render), Your edit on every step, and the one
// draft and render path on Review and Render:
// - Draft (Review) is made from your pieces (the kept cuts, in your order, already cut, --as-is) or the whole take
// - Render (Render) stays off until the current pieces are drafted, and says so when they changed since
// - one Render makes the reel and, in the same run, each piece as its own reel (clips) or a plain clip (plain);
//   those choices are in the What to make fold on Render
// - the MCP tools get_edit and studio_run (from, exports)
// Needs Chrome and ffmpeg. Run: node tests/studio-finish.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-finish-e2e-')), JOB = 'finish-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });

// a 9 s clip: tone bursts are the words, at the times the stand-in transcriber says
const SYN = join(STATE, 'syn.mp4'), REAL = [[1.0, 1.6], [1.75, 2.4], [3.3, 4.0], [4.1, 4.8], [6.0, 6.7], [6.8, 7.5]];
ff(['-f', 'lavfi', '-i', 'color=c=0x303840:s=360x640:r=12:d=9', '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*200*t)*(${REAL.map(([a, b]) => `between(t,${a},${b})`).join('+')})+0.006*(random(1)-0.5)':s=48000:d=9`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', SYN]);
const TXW = join(STATE, 'words.json');
writeFileSync(TXW, JSON.stringify({ 'finish-take': { duration: 9, words: [[1.0, 1.6, 'One'], [1.75, 2.4, 'two.'], [3.3, 4.0, 'Three'], [4.1, 4.8, 'four.'], [6.0, 6.7, 'Five'], [6.8, 7.5, 'six.']] } }));
const env = { ...process.env, FAKE_TX_WORDS: TXW, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '100', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const port = +url.split(':').pop();
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const upload = async (kind, f, name) => (await fetch(`${url}/api/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: readFileSync(f) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const waitTask = async (ms = 3 * 60e3) => { await wait(400); return until(async () => { const v = await api('/api/state'); return v.task && v.task.status !== 'running' ? v : null; }, ms); };
const log = job => { try { return readFileSync(join(ROOT, 'jobs', job, 'fake-reel.log'), 'utf8'); } catch { return ''; } };
// a fresh load of a link: via about:blank, because a new hash alone does not reload the page
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const onStep = (pg, st) => pg.waitForFunction(x => document.querySelector('main').dataset.step === x, st);
const toStep = async (pg, st) => { await pg.click(`#stepper button[data-step="${st}"]`); await onStep(pg, st); };
const openMake = async pg => { if (!(await pg.isVisible('#exp-reel'))) await pg.click('#make-fold > button'); await pg.waitForSelector('#exp-reel', { state: 'visible' }); };
const cleanJobs = () => { for (const d of [JOB, `${JOB}-c1`, `${JOB}-c2`, `${JOB}-c3`]) rmSync(join(ROOT, 'jobs', d), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
let client;
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  const take = (await upload('footage', SYN, 'finish take.mp4')).path; assert.ok(/finish-take/.test(take), take);
  await api('/api/cut/output', { format: 'short', kind: 'clips', clips: 2, seconds: null, length: 'short', goal: 'organic', cta: null });
  await api('/api/cut/find', { path: take, scorer: 'rules' });
  await until(async () => { const x = await api('/api/cut'); return x.source === take && x.candidates.length ? x : null; }, 30000);
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await t('eight steps: Start, Cut, Picture, Text and graphics, B-roll, Music and sounds, Review, Render; old links land on the step that holds them now', async () => {
    await open(pg, '#step=footage');
    assert.deepStrictEqual(await pg.$$eval('#stepper button', x => x.map(b => b.dataset.step)), ['start', 'cut', 'picture', 'text', 'broll', 'music', 'review', 'render']);
    assert.deepStrictEqual(await pg.$$eval('#stepper .sl', x => x.map(b => b.textContent)), ['Start', 'Cut', 'Picture', 'Text and graphics', 'B-roll', 'Music and sounds', 'Review', 'Render']);
    await onStep(pg, 'start'); assert.ok(await pg.isVisible('#s-footage h2:has-text("Start")'));
    await open(pg, '#step=render');
    await onStep(pg, 'render'); assert.ok(await pg.isVisible('#s-render h2:has-text("Render")'));
    await open(pg, '#step=finish');
    await onStep(pg, 'review'); assert.ok(await pg.isVisible('#s-review h2:has-text("Review")')); assert.ok(!(await pg.isVisible('#s-render')), 'Render is not on screen on Review');
    await open(pg, '#step=style');
    await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'picture' && document.querySelector('main').dataset.view === 'main');
    assert.ok(await pg.isVisible('#s-menu')); assert.ok(!(await pg.$('#s-ref')), 'the reference view is not on screen');
    assert.strictEqual(await pg.$('#look-switch'), null, 'no view switch on Picture without a reference');
    await open(pg, '#step=reference');
    await pg.waitForSelector('#s-ref'); assert.strictEqual(await pg.$eval('main', m => m.dataset.step + ' ' + m.dataset.view), 'picture reference');
    assert.strictEqual(await pg.$eval('#look-sub-reference', b => b.getAttribute('aria-checked')), 'true'); assert.ok(!(await pg.isVisible('#s-menu')));
    await pg.click('#look-sub-style'); await pg.waitForSelector('#s-menu', { state: 'visible' }); assert.ok(!(await pg.$('#s-ref')));
  });

  await t('Your edit: on every step, says what you make and from what, and follows your cuts', async () => {
    await api('/api/cut/set', { source: take, by: 'test', candidates: [{ kind: 'clip', label: 'First', ranges: [[0.95, 2.45]] }, { kind: 'clip', label: 'Last', ranges: [[5.9, 7.6]] }, { kind: 'clip', label: 'Middle', ranges: [[3.2, 4.9]], keep: false }] });
    for (const st of ['start', 'cut', 'picture', 'text', 'broll', 'music', 'review', 'render']) {
      await pg.click(`#stepper button[data-step="${st}"]`); await pg.waitForFunction(x => document.querySelector('main').dataset.step === x, st);
      assert.ok(await pg.isVisible('#your-edit'), 'Your edit on ' + st);
    }
    await pg.waitForFunction(() => /2 clips, \d+ s, in your order/.test(document.querySelector('#your-edit [data-part="from"]').textContent));
    const e = await api('/api/edit'); assert.strictEqual(e.combo.pieces.length, 2); assert.deepStrictEqual(e.combo.pieces.map(x => x.id), ['c1', 'c2']); assert.strictEqual(e.edit.from.mode, 'pieces');
    assert.ok(/^1 reel/.test(e.edit.making.text), e.edit.making.text); assert.strictEqual(e.edit.next.label, 'Draft it');
    if (shots) { await pg.click('#stepper button[data-step="cut"]'); await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, 'redesign-cut-your-edit-dark.png') }); }
  });

  await t('Review: Draft from your pieces cuts once and hands them over as they are; Render waits for it', async () => {
    // Render, before a draft: off, and it sends you to Review
    await toStep(pg, 'render');
    assert.ok(await pg.isDisabled('#render'), 'no Render before a draft'); assert.strictEqual(await pg.textContent('#render-status'), 'Draft it on Review first');
    assert.strictEqual(await pg.$$eval('#s-render button', x => x.filter(b => /^Render/.test(b.textContent.trim())).length), 1, 'one Render button');
    assert.strictEqual(await pg.$('#kept-cuts'), null, 'no second render card');
    if (shots) { await pg.screenshot({ path: join(shots, 'redesign-render-dark.png') }); }
    await pg.click('#render-to-review'); await onStep(pg, 'review'); await pg.waitForSelector('#s-review:not([hidden])');
    await pg.waitForSelector('#fin-from button[data-from="pieces"][aria-checked="true"]');
    assert.ok(/^Your 2 clips, \d+ s$/.test(await pg.textContent('#fin-from button[data-from="pieces"]')));
    assert.strictEqual(await pg.textContent('#elapsed'), 'A draft is a quick plan of the reel, with no video yet.');
    assert.strictEqual(await pg.$$eval('#s-review button', x => x.filter(b => /^Render/.test(b.textContent.trim())).length), 0, 'no Render button on Review');
    if (shots) { await pg.screenshot({ path: join(shots, 'redesign-finish-dark.png') }); }
    await pg.click('#draft'); const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800));
    const L = log(JOB); assert.ok(/--as-is/.test(L) && /--draft/.test(L), L);
    assert.ok(L.indexOf(`inbox/studio/${JOB}/cuts/c1.mp4`) >= 0 && L.indexOf(`cuts/c1.mp4`) < L.indexOf(`cuts/c2.mp4`) && !/cuts\/c3\.mp4/.test(L), 'your pieces in your order, the dropped one left out: ' + L);
    const cj = JSON.parse(readFileSync(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'clips.json'), 'utf8'));
    assert.ok(cj.precut && cj.clips.find(x => x.file === 'cuts/c1.mp4').words.length, 'clips.json carries the words');
    const st = await api('/api/state'); assert.strictEqual(st.state.drafted.from, 'pieces'); assert.strictEqual(st.edit.drafted, true);
    await pg.waitForFunction(() => document.querySelector('#render').getAttribute('aria-disabled') !== 'true');
    assert.ok(/^Render v1$/.test(await pg.textContent('#render')));
  });

  await t('one Render makes the reel and each piece as its own reel in the same run', async () => {
    await toStep(pg, 'render'); await pg.waitForSelector('#s-render:not([hidden])');
    assert.strictEqual(await pg.isVisible('#exp-clips'), false, 'What to make starts closed'); await openMake(pg);
    await pg.click('#exp-clips'); await pg.waitForSelector('#exp-clips[aria-pressed="true"]');
    // sizes: one small row; the 9:16 is always made, the Feed 4:5 is one tick and goes into the same run
    assert.deepStrictEqual(await pg.$$eval('#sizes label', x => x.map(l => [l.textContent.trim(), l.querySelector('input').checked, l.querySelector('input').disabled])),
      [['Reels and Stories 9:16', true, true], ['Instagram Feed 4:5 (1080x1350)', false, false], ['Square 1:1', false, false]]);
    await pg.click('#size-feed45'); await pg.waitForFunction(() => document.querySelector('#size-feed45').checked);
    assert.deepStrictEqual((await api('/api/state')).state.sizes, ['feed45']);
    if (shots) { await pg.locator('#sizes').scrollIntoViewIfNeeded(); await pg.screenshot({ path: join(shots, 'render-sizes-dark.png') }); }
    await pg.click('#render'); const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800)); assert.strictEqual(v.task.kind, 'render');
    assert.ok(/--rebuild.*--export reels,feed45/.test(log(JOB)), 'one run, both sizes: ' + log(JOB).split('\n').pop());
    await pg.waitForSelector('#outputs .out-use'); assert.strictEqual(await pg.textContent('#outputs .out-use'), 'For Reels and Stories');
    await pg.click('#size-feed45'); await pg.waitForFunction(() => !document.querySelector('#size-feed45').checked);
    assert.ok(existsSync(join(ROOT, 'jobs', JOB, 'reel-v1.mp4')), 'the reel');
    for (const id of ['c1', 'c2']) { assert.ok(existsSync(join(ROOT, 'jobs', `${JOB}-${id}`, 'reel-v1.mp4')), id + ' as its own reel'); assert.ok(/--as-is/.test(log(`${JOB}-${id}`))); }
    assert.ok(!existsSync(join(ROOT, 'jobs', `${JOB}-c3`)), 'the dropped piece is not rendered');
    await pg.waitForSelector('#cut-outputs figure'); assert.strictEqual(await pg.$$eval('#cut-outputs figure', x => x.length), 2);
    assert.ok(/^Your clips on their own$/.test(await pg.textContent('#h-cut-outs')));
    if (shots) { await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, 'redesign-finish-rendered-dark.png') }); }
  });

  await t('pieces changed since the draft: Your edit, Review and Render say so, and Render waits for a new draft', async () => {
    await api('/api/cut/edit', { id: 'c3', keep: true });
    await pg.waitForSelector('#ye-stale'); await pg.waitForFunction(() => document.querySelector('#render').getAttribute('aria-disabled') === 'true');
    assert.strictEqual(await pg.textContent('#elapsed'), 'Your clips changed since the draft. Draft again first.');
    assert.strictEqual(await pg.textContent('#render-status'), 'Your clips changed since the draft. Draft it on Review first');
    const r = await fetch(url + '/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.strictEqual(r.status, 202, 'the API still renders the last draft for an agent that asks');
    await waitTask();
    await api('/api/cut/edit', { id: 'c3', keep: false }); await pg.waitForSelector('#ye-stale', { state: 'detached' });
  });

  await t('the whole take instead, and plain clips with no reel need no draft', async () => {
    await toStep(pg, 'review');
    await pg.click('#fin-from button[data-from="take"]'); await pg.waitForSelector('#fin-from button[data-from="take"][aria-checked="true"]');
    assert.strictEqual((await api('/api/edit')).edit.from.mode, 'take');
    await pg.click('#fin-from button[data-from="pieces"]'); await pg.waitForSelector('#fin-from button[data-from="pieces"][aria-checked="true"]');
    await toStep(pg, 'render'); await openMake(pg);
    await pg.click('#exp-plain'); await pg.waitForSelector('#exp-plain[aria-pressed="true"]');
    await pg.click('#exp-clips'); await pg.waitForSelector('#exp-clips[aria-pressed="false"]');
    await pg.click('#exp-reel'); await pg.waitForSelector('#exp-reel[aria-pressed="false"]');
    assert.ok(await pg.isDisabled('#draft'), 'nothing to draft without the reel'); assert.ok(/^Render plain clips$/.test(await pg.textContent('#render')), await pg.textContent('#render'));
    const before = log(JOB); rmSync(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'c1.mp4'));
    await pg.click('#render'); const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800));
    assert.ok(existsSync(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'c1.mp4')), 'the plain clip'); assert.strictEqual(log(JOB), before, 'no reel edit');
    const none = await api('/api/state', { finish: { reel: false, clips: false, plain: false } }); assert.ok(none.errs && none.errs.length || none.error, 'at least one thing to make');
    await api('/api/state', { finish: { reel: true, clips: false, plain: false } });
  });

  await t('MCP: get_edit reads Your edit, studio_run drafts from the take or pieces and renders with exports', async () => {
    client = new Client({ name: 'finish-e2e', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: String(port) } }));
    const names = (await client.listTools()).tools.map(x => x.name); assert.ok(names.includes('get_edit') && names.includes('studio_run'));
    const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r).slice(0, 400)); return JSON.parse(r.content[0].text); };
    const e = await call('get_edit', {}); assert.strictEqual(e.combo.pieces.length, 2); assert.ok(e.edit.making.text);
    await call('studio_run', { action: 'draft', from: 'take' }); let v = await waitTask(); assert.strictEqual(v.task.status, 'done');
    assert.strictEqual(v.state.finish.from, 'take'); assert.strictEqual(v.state.drafted.from, 'take');
    const L = log(JOB).trim().split('\n').pop(); assert.ok(!/--as-is/.test(L) && /finish-take/.test(L), 'the whole take: ' + L);
    await call('studio_run', { action: 'draft', from: 'pieces' }); v = await waitTask(); assert.strictEqual(v.state.drafted.from, 'pieces');
    const r = await call('studio_run', { action: 'render', exports: { clips: true } }); assert.strictEqual(r.clips.length, 2);
    v = await waitTask(); assert.strictEqual(v.task.status, 'done'); assert.ok(existsSync(join(ROOT, 'jobs', JOB, 'reel-v3.mp4')) || existsSync(join(ROOT, 'jobs', JOB, 'reel-v2.mp4')));
  });

  if (shots) await t('screenshots: dark and light', async () => {
    await open(pg, '#step=review'); await pg.waitForTimeout(600);
    await pg.screenshot({ path: join(shots, 'redesign-finish-drafted-dark.png') });
    await pg.click('#stepper button[data-step="picture"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-look-dark.png') });
    const theme = async m => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), m); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); await pg.waitForTimeout(700); };
    await theme('light'); await pg.screenshot({ path: join(shots, 'redesign-look-light.png') });
    await pg.click('#stepper button[data-step="review"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-finish-light.png') });
    await pg.click('#stepper button[data-step="cut"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-cut-your-edit-light.png') });
    await pg.setViewportSize({ width: 390, height: 844 }); await pg.evaluate(() => { location.hash = '#step=review'; }); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-finish-phone-light.png'), fullPage: false });
    await theme('dark'); await pg.screenshot({ path: join(shots, 'redesign-finish-phone-dark.png') });
    await pg.setViewportSize({ width: 1440, height: 900 });
  });
  assert.deepStrictEqual(errs, [], 'no page errors');
  console.log(`\nStudio Review and Render e2e: ${n} passed`);
} finally {
  if (client) await client.close().catch(() => {});
  await browser.close(); srv.kill(); cleanJobs(); rmSync(STATE, { recursive: true, force: true });
}
