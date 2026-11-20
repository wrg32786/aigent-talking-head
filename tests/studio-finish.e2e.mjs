// The 1.13.0 Studio flow in a real Chrome, on synthetic media only (tests/fixtures): six steps (Footage, Cut, Look,
// B-roll, Finish, Post), the old step links still land (Style and Reference open Look, Render opens Finish), Your edit
// on every step, and the one render path on Finish:
// - Draft is made from your pieces (the kept cuts, in your order, already cut, --as-is) or the whole take
// - Render stays off until the current pieces are drafted, and says so when they changed since
// - one Render makes the reel and, in the same run, each piece as its own reel (clips) or a plain clip (plain)
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
const cleanJobs = () => { for (const d of [JOB, `${JOB}-c1`, `${JOB}-c2`]) rmSync(join(ROOT, 'jobs', d), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); };

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

  await t('six steps: Footage, Cut, Look, B-roll, Finish, Post; old links land in Look and Finish', async () => {
    await pg.goto(url + '/#step=footage', { waitUntil: 'networkidle' });
    assert.deepStrictEqual(await pg.$$eval('#stepper button', x => x.map(b => b.dataset.step)), ['footage', 'cut', 'look', 'broll', 'finish', 'post']);
    assert.deepStrictEqual(await pg.$$eval('#stepper .sl', x => x.map(b => b.textContent)), ['Footage', 'Cut', 'Look', 'B-roll', 'Finish', 'Post']);
    await pg.goto(url + '/#step=render', { waitUntil: 'networkidle' }); await pg.reload({ waitUntil: 'networkidle' });
    await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'finish'); assert.ok(await pg.isVisible('#s-render h2:has-text("Finish")'));
    await pg.goto(url + '/#step=style', { waitUntil: 'networkidle' }); await pg.reload({ waitUntil: 'networkidle' });
    await pg.waitForFunction(() => document.querySelector('main').dataset.step === 'look' && document.querySelector('main').dataset.look === 'style');
    assert.ok(await pg.isVisible('#s-menu')); assert.ok(!(await pg.$('#s-ref')), 'the reference view is not on screen');
    await pg.click('#look-sub-reference'); await pg.waitForSelector('#s-ref'); assert.ok(!(await pg.isVisible('#s-menu')));
    await pg.goto(url + '/#step=reference', { waitUntil: 'networkidle' }); await pg.reload({ waitUntil: 'networkidle' });
    await pg.waitForSelector('#s-ref'); assert.strictEqual(await pg.$eval('#look-sub-reference', b => b.getAttribute('aria-checked')), 'true');
    await pg.click('#look-sub-style'); await pg.waitForSelector('#s-menu', { state: 'visible' });
  });

  await t('Your edit: on every step, says what you make and from what, and follows your cuts', async () => {
    await api('/api/cut/set', { source: take, by: 'test', candidates: [{ kind: 'clip', label: 'First', ranges: [[0.95, 2.45]] }, { kind: 'clip', label: 'Last', ranges: [[5.9, 7.6]] }, { kind: 'clip', label: 'Middle', ranges: [[3.2, 4.9]], keep: false }] });
    for (const st of ['footage', 'cut', 'look', 'broll', 'finish']) {
      await pg.click(`#stepper button[data-step="${st}"]`); await pg.waitForFunction(x => document.querySelector('main').dataset.step === x, st);
      assert.ok(await pg.isVisible('#your-edit'), 'Your edit on ' + st);
    }
    await pg.waitForFunction(() => /2 pieces, \d+ s, in your order/.test(document.querySelector('#your-edit [data-part="from"]').textContent));
    const e = await api('/api/edit'); assert.strictEqual(e.combo.pieces.length, 2); assert.deepStrictEqual(e.combo.pieces.map(x => x.id), ['c1', 'c2']); assert.strictEqual(e.edit.from.mode, 'pieces');
    assert.ok(/^1 reel/.test(e.edit.making.text), e.edit.making.text); assert.strictEqual(e.edit.next.label, 'Draft it');
    if (shots) { await pg.click('#stepper button[data-step="cut"]'); await pg.waitForTimeout(500); await pg.screenshot({ path: join(shots, 'redesign-cut-your-edit-dark.png') }); }
  });

  await t('Finish: Draft from your pieces cuts once and hands them over as they are; Render waits for it', async () => {
    await pg.click('#stepper button[data-step="finish"]');
    await pg.waitForSelector('#fin-from button[data-from="pieces"][aria-checked="true"]');
    assert.ok(/^Your 2 pieces, \d+ s$/.test(await pg.textContent('#fin-from button[data-from="pieces"]')));
    assert.ok(await pg.isDisabled('#render'), 'no Render before a draft'); assert.strictEqual(await pg.textContent('#elapsed'), 'Draft first, then Render.');
    assert.strictEqual(await pg.$$eval('#s-render button', x => x.filter(b => /^Render/.test(b.textContent.trim())).length), 1, 'one Render button');
    assert.strictEqual(await pg.$('#kept-cuts'), null, 'no second render card');
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
    await pg.click('#exp-clips'); await pg.waitForSelector('#exp-clips[aria-pressed="true"]');
    await pg.click('#render'); const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800)); assert.strictEqual(v.task.kind, 'render');
    assert.ok(existsSync(join(ROOT, 'jobs', JOB, 'reel-v1.mp4')), 'the reel');
    for (const id of ['c1', 'c2']) { assert.ok(existsSync(join(ROOT, 'jobs', `${JOB}-${id}`, 'reel-v1.mp4')), id + ' as its own reel'); assert.ok(/--as-is/.test(log(`${JOB}-${id}`))); }
    assert.ok(!existsSync(join(ROOT, 'jobs', `${JOB}-c3`)), 'the dropped piece is not rendered');
    await pg.waitForSelector('#cut-outputs figure'); assert.strictEqual(await pg.$$eval('#cut-outputs figure', x => x.length), 2);
    assert.ok(/Clips from your pieces/.test(await pg.textContent('#h-cut-outs')));
    if (shots) { await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, 'redesign-finish-rendered-dark.png') }); }
  });

  await t('pieces changed since the draft: Your edit and Finish say so, and Render waits for a new draft', async () => {
    await api('/api/cut/edit', { id: 'c3', keep: true });
    await pg.waitForSelector('#ye-stale'); await pg.waitForFunction(() => document.querySelector('#render').getAttribute('aria-disabled') === 'true');
    assert.strictEqual(await pg.textContent('#elapsed'), 'Your pieces changed since the draft. Draft again first.');
    const r = await fetch(url + '/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.strictEqual(r.status, 202, 'the API still renders the last draft for an agent that asks');
    await waitTask();
    await api('/api/cut/edit', { id: 'c3', keep: false }); await pg.waitForSelector('#ye-stale', { state: 'detached' });
  });

  await t('the whole take instead, and plain clips with no reel need no draft', async () => {
    await pg.click('#fin-from button[data-from="take"]'); await pg.waitForSelector('#fin-from button[data-from="take"][aria-checked="true"]');
    assert.strictEqual((await api('/api/edit')).edit.from.mode, 'take');
    await pg.click('#fin-from button[data-from="pieces"]'); await pg.waitForSelector('#fin-from button[data-from="pieces"][aria-checked="true"]');
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
    await pg.goto(url + '/#step=finish', { waitUntil: 'networkidle' }); await pg.waitForTimeout(600);
    await pg.screenshot({ path: join(shots, 'redesign-finish-drafted-dark.png') });
    await pg.click('#stepper button[data-step="look"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-look-dark.png') });
    const theme = async m => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), m); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(700); };
    await theme('light'); await pg.screenshot({ path: join(shots, 'redesign-look-light.png') });
    await pg.click('#stepper button[data-step="finish"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-finish-light.png') });
    await pg.click('#stepper button[data-step="cut"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-cut-your-edit-light.png') });
    await pg.setViewportSize({ width: 390, height: 844 }); await pg.evaluate(() => { location.hash = '#step=finish'; }); await pg.waitForTimeout(600); await pg.screenshot({ path: join(shots, 'redesign-finish-phone-light.png'), fullPage: false });
    await theme('dark'); await pg.screenshot({ path: join(shots, 'redesign-finish-phone-dark.png') });
    await pg.setViewportSize({ width: 1440, height: 900 });
  });
  assert.deepStrictEqual(errs, [], 'no page errors');
  console.log(`\nStudio Finish e2e: ${n} passed`);
} finally {
  if (client) await client.close().catch(() => {});
  await browser.close(); srv.kill(); cleanJobs(); rmSync(STATE, { recursive: true, force: true });
}
