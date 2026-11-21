// Point-and-note review, waveform select, wizards, Ask my agent and Apply (1.17.0) in a real Chrome, with no keys and
// no network:
// - drag on the waveform: the stretch snaps to whole words, Play it, Note for my agent sends it with from and to
// - Ask my agent on a step: prompts for that step, sent to the chat with the step, the chat opens
// - an agent answer with a suggested change shows Apply; nothing changes until it is clicked, then it says Applied
// - a note on a stretch of the reel on Render (in the closed Compare fold): Mark the end here
// - the wizards: Make a reel (goal, Look, Let AI choose, then Review) and Clips and ads; on a phone they open from More
// - screenshots, dark and light, and the phone
// Needs Chrome and ffmpeg. Run: node tests/studio-agent-ux.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-agent-ux-e2e-')), LIB = join(STATE, 'lib'), JOB = 'agent-ux-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
const clip = (f, secs, words, color) => ff(['-f', 'lavfi', '-i', `color=c=${color}:s=360x640:r=12:d=${secs}`, '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*200*t)*(${words.map(([a, b]) => `between(t,${a},${b})`).join('+')})+0.006*(random(1)-0.5)':s=48000:d=${secs}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', f]);
const SENT = ['Nobody tells you this about agents.', 'My first client paid me before I had a product.', 'Sorry, my dog is barking.', 'Three months later we doubled our leads.', 'Open the dashboard and type your prompt.', 'Follow for part two.'];
const TW = []; { let at = 0.6; for (const s of SENT) { for (const w of s.split(' ')) { TW.push([+at.toFixed(2), +(at + 0.35).toFixed(2), w]); at += 0.45; } at += 0.9; } }
const SECS = Math.ceil(TW[TW.length - 1][1] + 1);
const TAKE = join(STATE, 'ux-take.mp4'); clip(TAKE, SECS, TW, '0x303840');
const TXW = join(STATE, 'words.json'); writeFileSync(TXW, JSON.stringify({ 'ux-take': { duration: SECS, words: TW } }));
const env = { ...process.env, FAKE_TX_WORDS: TXW, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: LIB, STUDIO_BROLL_AUTO: '', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '',
  STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '50', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const port = +url.split(':').pop();
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const upload = async (kind, f, name) => (await fetch(`${url}/api/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: readFileSync(f) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const cleanJobs = () => { rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); };
// a fresh load of a link: via about:blank, because a new hash alone does not reload the page
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#main .step:not([hidden])'); };
const shot = async (pg, sel, name) => {
  if (!shots) return; await pg.waitForTimeout(350);
  const b = await pg.locator(sel).first().boundingBox(), vp = pg.viewportSize();
  await pg.screenshot({ path: join(shots, name), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.min(vp.width - Math.max(0, b.x - 8), b.width + 16), height: Math.min(vp.height - Math.max(0, b.y - 8), b.height + 16) } });
};
const lastUser = async () => (await api('/api/state')).state.chat.filter(x => x.role === 'user').pop();

const asCurrentDraft = async (job, version = 1) => {
  const cur = await api('/api/state');
  const key = (cur.combo && cur.combo.from === 'pieces' && cur.combo.key)
    ? 'pieces:' + cur.combo.key
    : 'take:' + JSON.stringify([cur.state.footage || [], cur.state.clips || null]);
  writeFileSync(join(ROOT, 'jobs', job, `reel-v${version}.settings.json`), JSON.stringify({
    version, at: new Date().toISOString(), job, key,
    footage: JSON.stringify([cur.state.footage || [], cur.state.clips || null]),
    takes: (cur.state.footage || []).map(f => String(f).split('/').pop()),
    from: (cur.edit && cur.edit.from && cur.edit.from.text) || (cur.combo && cur.combo.from === 'pieces' ? 'your pieces' : 'the whole take'),
  }));
  if (!cur.edit || !cur.edit.drafted) {
    const st = JSON.parse(readFileSync(join(STATE, 'state.json'), 'utf8'));
    st.drafted = { key, from: (cur.combo && cur.combo.from) || 'take', at: Date.now() };
    delete st.draftStale;
    writeFileSync(join(STATE, 'state.json'), JSON.stringify(st, null, 2));
  }
};

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
let client;
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  const take = (await upload('footage', TAKE, 'ux take.mp4')).path;
  await api('/api/cut/transcribe', { path: take }); await until(async () => { const c = await api('/api/cut'); return c.tx && c.tx.status === 'ready'; }, 30000);
  await until(async () => { const j = await api('/api/pieces'); return j.pieces && j.pieces.length === SENT.length ? j : null; }, 30000);
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('studio.cutLayer', 'raw'); } catch {} }); // the waveform and the words are on Raw take; about:blank has no storage

  await t('waveform: a drag selects on whole words; Note for my agent sends from and to', async () => {
    await open(pg, '#step=cut'); await pg.waitForSelector('#player-scrub'); await pg.waitForSelector('#player-transcript .w');
    const dur = await until(() => pg.evaluate(() => { const v = document.getElementById('player-video'); return v && v.duration > 0 ? v.duration : 0; }));
    await pg.locator('#player-scrub').scrollIntoViewIfNeeded(); await pg.evaluate(() => scrollBy(0, 150));
    const b = await pg.locator('#player-scrub').boundingBox(), x = s => b.x + (s / dur) * b.width;
    // from inside "tells" (1.05 to 1.40) to the quiet after "agents." (2.85 to 3.20): out to the start of tells, back to the end of agents.
    await pg.mouse.move(x(1.2), b.y + b.height / 2); await pg.mouse.down(); await pg.mouse.move(x(2.4), b.y + b.height / 2, { steps: 5 }); await pg.mouse.move(x(3.45), b.y + b.height / 2, { steps: 5 }); await pg.mouse.up();
    await pg.waitForSelector('#pl-sel');
    const [a, e] = await pg.$eval('#scrub-sel', el => [+el.dataset.a, +el.dataset.b]);
    assert.ok(TW.some(w => Math.abs(w[0] - a) < 0.011) && TW.some(w => Math.abs(w[1] - e) < 0.011), `edges on word edges: ${a} ${e}`);
    assert.ok(Math.abs(a - 1.05) < 0.08 && Math.abs(e - 3.2) < 0.08, `snapped out to tells and agents.: ${a} ${e}`);
    assert.ok(/on whole words/.test(await pg.textContent('#pl-sel-at')));
    await pg.click('#note-selection'); await pg.fill('#sel-note', 'Tighten this part');
    await shot(pg, '#player', 'redesign-wave-select-dark.png');
    await pg.click('#sel-note-send'); await pg.waitForSelector('#pl-sel', { state: 'detached' });
    const m = await lastUser(); assert.ok(Math.abs(m.attach.end - e) < 0.02 && Math.abs(m.attach.t - a) < 0.02, JSON.stringify(m.attach)); assert.match(m.text, /ux-take\.mp4 from 0:01\.\d to 0:03\.\d/);
    // a short click still only seeks
    await pg.mouse.click(x(5), b.y + b.height / 2); await wait(200); assert.strictEqual(await pg.$('#pl-sel'), null, 'a click seeks, it does not select');
  });

  await t('Ask my agent: prompts for this step, sent with the step, the chat opens', async () => {
    await pg.click('#ask-agent'); await pg.waitForSelector('#ask-pop');
    const chips = await pg.$$eval('#ask-chips .chip', x => x.map(e => e.textContent)); assert.ok(chips.includes('Pick the strongest hook'), chips.join());
    await shot(pg, '#stepnav', 'redesign-ask-agent-dark.png');
    if (shots) { await pg.screenshot({ path: join(shots, 'redesign-ask-agent-page-dark.png') }); }
    await pg.click('#ask-chips .chip >> text=Pick the strongest hook'); await pg.waitForSelector('#chat.open');
    assert.strictEqual((await lastUser()).text, '(On the Cut step) Pick the strongest hook');
    await pg.keyboard.press('Escape');
  });

  await t('Apply: a suggested change waits for the click, then is made and says Applied', async () => {
    client = new Client({ name: 'agent-ux-e2e', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: STATE, STUDIO_PORT: String(port) } }));
    const r = await client.callTool({ name: 'studio_reply', arguments: { text: 'The magazine Look fits this hook. Want it?', suggest: { patch: { pack: 'magazine' }, step: 'look', label: 'Use magazine' } } }); assert.ok(!r.isError, JSON.stringify(r.content));
    if (await pg.isVisible('#chat-open')) await pg.click('#chat-open'); await pg.waitForSelector('#msgs .sg-apply');
    assert.notStrictEqual((await api('/api/state')).state.pack, 'magazine', 'nothing changed yet');
    await shot(pg, '#chat', 'redesign-apply-dark.png');
    await pg.click('#msgs .sg-apply'); await pg.waitForSelector('#msgs .sg-done');
    assert.strictEqual((await api('/api/state')).state.pack, 'magazine'); await pg.waitForSelector('#s-look:not([hidden])');
    assert.strictEqual(await pg.$eval('#stepper [aria-current="step"]', b => b.dataset.step), 'picture', 'a suggestion for the old Look step opens Picture');
    await pg.keyboard.press('Escape');
  });

  await t('a note on a stretch of the reel on Render: Mark the end here', async () => {
    mkdirSync(join(ROOT, 'jobs', JOB), { recursive: true }); copyFileSync(TAKE, join(ROOT, 'jobs', JOB, 'reel-v1.mp4'));
    await asCurrentDraft(JOB);
    await open(pg, '#step=render'); await pg.waitForSelector('#s-render:not([hidden])');
    await pg.click('#compare-fold > summary'); await pg.waitForSelector('#comment-start');
    await pg.click('#comment-start'); await pg.fill('#cmp-seek', '4'); await wait(300); await pg.click('#comment-end');
    assert.ok(/From 0:00\.0 to 0:04\.0/.test(await pg.textContent('#cm-hint')), await pg.textContent('#cm-hint'));
    await pg.fill('#comment-text', 'This stretch drags');
    await shot(pg, '#compare', 'redesign-note-range-dark.png');
    await pg.click('#comment-send'); await pg.waitForFunction(() => !document.querySelector('#comment-text'), null, { timeout: 8000 });
    const m = await lastUser(); assert.strictEqual(m.attach.t, 0); assert.ok(Math.abs(m.attach.end - 4) < 0.1, JSON.stringify(m.attach)); assert.match(m.text, /reel-v1\.mp4 from 0:00\.0 to 0:04\.0/);
  });

  await t('wizards: Make a reel (goal, Look, Let AI choose, Review) and Clips and ads', async () => {
    await open(pg, '#step=start'); await pg.waitForSelector('#s-footage:not([hidden])'); await pg.click('#wizards-open'); await pg.waitForSelector('#wz-list');
    assert.deepStrictEqual(await pg.$$eval('#wz-list .wz-pick b', x => x.map(e => e.textContent)), ['Make a reel from a long take', 'Copy a reference', 'Clips and ads from one take']);
    await shot(pg, '#wizards', 'redesign-wizards-dark.png');
    await pg.click('.wz-pick[data-wizard="reel"]'); await pg.waitForSelector('.wz-opt[data-goal="sell"]');
    await shot(pg, '#wizards', 'redesign-wizard-goal-dark.png');
    await pg.click('.wz-opt[data-goal="sell"]'); await pg.waitForSelector('.wz-look');
    const out = (await api('/api/cut')).output; assert.strictEqual(out.goal, 'ad'); assert.strictEqual(out.adCuts, true);
    await pg.click('.wz-look[data-look="magazine"]'); await pg.waitForSelector('#wz-choose');
    await pg.click('#wz-choose'); await pg.waitForSelector('#s-review:not([hidden])'); await pg.waitForSelector('#stepper [data-step="review"][aria-current="step"]');
    const P = await api('/api/pieces'); assert.ok(P.combo.ids.length >= 2, JSON.stringify(P.combo)); assert.strictEqual(P.combo.by, 'ai');
    await pg.click('#wizards-open'); await pg.click('.wz-pick[data-wizard="clips"]'); await pg.click('#wizards .seg [role="radio"] >> text=3'); await pg.check('#wz-ads');
    await pg.click('#wz-clips-go'); await pg.waitForSelector('[data-step="cut"][aria-current="step"]');
    const c = await until(async () => { const v = await api('/api/cut'); return v.candidates && v.candidates.length ? v : null; }); assert.strictEqual(c.output.kind, 'clips'); assert.strictEqual(c.output.clips, 3);
  });

  await t('light theme and the phone', async () => {
    await theme(pg, 'light');
    await pg.click('#wizards-open'); await pg.click('.wz-pick[data-wizard="reel"]'); await pg.waitForSelector('.wz-opt'); await shot(pg, '#wizards', 'redesign-wizard-goal-light.png');
    await pg.click('#wz-back'); await shot(pg, '#wizards', 'redesign-wizards-light.png'); await pg.keyboard.press('Escape');
    await pg.click('#ask-agent'); await pg.waitForSelector('#ask-pop'); await shot(pg, '#stepnav', 'redesign-ask-agent-light.png'); if (shots) await pg.screenshot({ path: join(shots, 'redesign-ask-agent-page-light.png') }); await pg.keyboard.press('Escape');
    if (await pg.isVisible('#chat-open')) await pg.click('#chat-open'); await pg.waitForSelector('#msgs .sg-done'); await shot(pg, '#chat', 'redesign-apply-light.png'); await pg.keyboard.press('Escape');
    await theme(pg, 'dark');
    const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
    ph.on('pageerror', e => errs.push(e.message));
    await ph.addInitScript(() => { try { localStorage.setItem('studio.cutLayer', 'raw'); } catch {} });
    await open(ph, '#step=cut'); await ph.waitForSelector('#ask-agent'); await ph.click('#ask-agent'); await ph.waitForSelector('#ask-pop');
    const over = await ph.evaluate(() => Math.max(...[...document.querySelectorAll('body *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().right)) - innerWidth); assert.ok(over <= 1, 'no sideways scroll: ' + over);
    if (shots) await ph.screenshot({ path: join(shots, 'redesign-ask-agent-phone-dark.png') });
    await ph.keyboard.press('Escape'); await open(ph, '#step=start'); await ph.waitForSelector('#s-footage:not([hidden])');
    // on a phone the Wizards button is in the More menu
    assert.strictEqual(await ph.isVisible('#wizards-open'), false, 'no Wizards button in the top bar on a phone');
    await ph.click('#more-open'); await ph.click('#more-wizards'); await ph.waitForSelector('#wz-list');
    const ow = await ph.evaluate(() => document.getElementById('wizards').getBoundingClientRect().right - innerWidth); assert.ok(ow <= 1, 'the wizard fits: ' + ow);
    if (shots) await ph.screenshot({ path: join(shots, 'redesign-wizards-phone-dark.png') });
    await ph.evaluate(() => localStorage.setItem('studio.theme', 'light')); await ph.reload({ waitUntil: 'domcontentloaded' }); await ph.waitForSelector('#s-footage:not([hidden])'); await ph.click('#more-open'); await ph.click('#more-wizards'); await ph.waitForSelector('#wz-list');
    if (shots) await ph.screenshot({ path: join(shots, 'redesign-wizards-phone-light.png') });
    await ph.close();
    assert.deepStrictEqual(errs, []);
  });
} finally {
  try { await client?.close(); } catch {}
  await browser.close(); srv.kill(); cleanJobs();
  rmSync(STATE, { recursive: true, force: true });
}
console.log(`\n${n} studio agent and review e2e tests passed`);
process.exit(0);
