// Connect agent, the teleprompter controls and pop-out, the setup check and footage from a link, in a real Chrome.
// The recorder is on the Recording tab (#tab=recording); the link box is on the Start step (#step=start).
// - Connect agent: opens from the header and the chat, shows each agent's commands with this install's paths, the
//   "Let my agent set it up" prompt, waits, then shows "Connected: Claude Code, listening" when a scripted MCP client
//   (the official SDK client over stdio, as Claude Code) starts listening; the picked agent is remembered
// - teleprompter: plus, minus and the arrow keys change the WPM while it scrolls, slow/normal/fast, remembered after a
//   reload; Rehearse scrolls with no take; the pop-out window (the plain popup; Picture-in-Picture is not driven here)
//   stays in sync both ways: speed, mirror, rehearse, record with the countdown, stop; closing it brings it back
// - footage from a link (Start): a Drive link through the confirm page lands in the footage; a private one shows the login line
// Needs Chrome and ffmpeg. Run: node tests/studio-connect.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-connect-e2e-')), JOB = 'connect-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

const CLIP = join(STATE, 'clip.mp4');
spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=24:duration=2', '-pix_fmt', 'yuv420p', CLIP]);
const BODY = readFileSync(CLIP);
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), id = u.searchParams.get('id');
  if (u.pathname === '/uc' && id === '1BigDriveTakeXYZ') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<form id="download-form" action="http://${req.headers.host}/download"><input type="hidden" name="id" value="${id}"><input type="hidden" name="confirm" value="t"></form>`); }
  if (u.pathname === '/download' && u.searchParams.get('confirm') === 't') {
    // slow enough to see progress
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': BODY.length, 'content-disposition': 'attachment; filename="long take.mp4"' });
    let i = 0; const step = Math.ceil(BODY.length / 6); const tick = () => { if (i >= BODY.length) return res.end(); res.write(BODY.subarray(i, i += step)); setTimeout(tick, 250); }; return tick();
  }
  if (u.pathname === '/uc') { res.writeHead(302, { location: `http://${req.headers.host}/ServiceLogin` }); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>Sign in</html>');
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_CLOUD_DRIVE: MOCK };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const port = url.split(':').pop();
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
// Studio keeps a live connection, so the page never goes network idle: wait for the stepper, and for the step a link names
const STEP_OF = { reference: 'picture', post: 'render' };
const ready = async (pg, hash = '') => { if (/tab=/.test(hash)) return pg.waitForSelector(`main[data-area="${hash.match(/tab=([a-z]+)/)[1]}"]`); await pg.waitForSelector('#stepper'); const st = (hash.match(/step=([a-z]+)/) || [])[1]; if (st) await pg.waitForSelector(`#stepper [aria-current="step"][data-step="${STEP_OF[st] || st}"]`); };
const open = async (pg, hash) => { await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await ready(pg, hash); };
const reload = async pg => { await pg.reload({ waitUntil: 'domcontentloaded' }); await ready(pg, new URL(pg.url()).hash); };
const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }));
const errsOf = pg => { const e = []; pg.on('pageerror', x => e.push(x.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) e.push(m.text()); }); return e; };
const SCRIPT = ['[hook]', 'Three things I wish I knew before my first reel.', 'One: film more than you need.', 'Two: the first second decides everything.', '[pause]', 'Three: say it like you talk.', '[cta]', 'Follow for the next one.'].join('\n');

let client;
try {
  await api('/api/state', { job: JOB });
  await t('Connect agent: header and chat open it, commands carry the real paths, the status turns to connected, the choice is remembered', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), pg = await ctx.newPage(), errs = errsOf(pg);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await open(pg, '#step=start');
    assert.match(await pg.textContent('#connect-open'), /Connect agent/);
    await pg.click('#chat-open').catch(() => {}); await pg.click('#chat-connect'); await pg.waitForSelector('#connect-steps');
    assert.match(await pg.textContent('#connect-status'), /Waiting for your agent/);
    await pg.click('.agent-card[data-agent="codex"]'); await pg.waitForSelector('#connect-steps >> text=config.toml');
    await pg.click('.agent-card[data-agent="claude"]');
    const code = await pg.textContent('#connect-steps');
    assert.ok(code.includes(join(ROOT, 'kit', 'mcp.mjs')), 'absolute MCP path'); assert.match(code, /claude mcp add/); assert.match(code, /connect\.mjs claude --user/); assert.match(code, /Run the Studio chat loop/);
    await pg.click('#connect-steps .copyblock .icon-btn');
    assert.match(await pg.evaluate(() => navigator.clipboard.readText()), /^claude mcp add /);
    await pg.waitForFunction(() => document.querySelector('#connect-status').textContent.includes('Waiting'));
    if (shots) await pg.screenshot({ path: join(shots, 'connect-desktop.png') });
    await pg.getByRole('radio', { name: 'Let my agent set it up' }).click().catch(async () => pg.click('#connect-mode >> text=Let my agent set it up'));
    assert.match(await pg.textContent('#setup-prompt'), /AGENTS\.md/);
    // a scripted MCP client connects as Claude Code and listens
    client = new Client({ name: 'claude-code', version: '0.0.0-test' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: port }, stderr: 'ignore' }));
    const listening = client.callTool({ name: 'studio_wait_for_message', arguments: { timeout_s: 12 } });
    await pg.waitForFunction(() => document.querySelector('#connect-status').classList.contains('on'), null, { timeout: 15000 });
    assert.match(await pg.textContent('#connect-status'), /Connected: Claude Code, listening/);
    if (shots) await pg.screenshot({ path: join(shots, 'connect-connected.png') });
    assert.match(await pg.textContent('#connect-open'), /Claude Code/);
    assert.strictEqual((await api('/api/settings')).settings.agent, 'claude');
    // the sheet closes by itself once the agent listens, so the chat beside it is free
    await pg.waitForFunction(() => { const d = document.querySelector('dialog#connect, #connect'); return !d || !(d.open || d.matches(':popover-open')); }, null, { timeout: 8000 });
    await pg.click('#connect-open'); await pg.waitForSelector('#connect-status');
    await pg.click('#connect .copyblock .icon-btn').catch(() => {});
    await pg.keyboard.press('Escape');
    await pg.waitForFunction(() => { const d = document.querySelector('dialog#connect, #connect'); return !d || !(d.open || d.matches(':popover-open')); }, null, { timeout: 4000 });
    await listening;
    // Settings has Connect agent and the Setup check
    await pg.click('#open-settings'); await pg.click('#settings-setup'); await pg.waitForSelector('#setup-list li[data-id="ffmpeg"]');
    assert.strictEqual(await pg.$$eval('#setup-list li[data-id]', l => l.length), 13);
    assert.deepStrictEqual(errs, []);
    await ctx.close();
    // phone: the remembered agent, no sideways scroll
    const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
    await open(ph, '#connect'); await ph.waitForSelector('#connect-steps');
    assert.strictEqual(await ph.getAttribute('.agent-card[data-agent="claude"]', 'aria-checked'), 'true');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    if (shots) await ph.screenshot({ path: join(shots, 'connect-phone.png') });
    await ph.close();
  });
  await t('teleprompter: plus, minus and arrows change the WPM as it scrolls, remembered; rehearse scrolls with no take', async () => {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } }), errs = errsOf(pg);
    await open(pg, '#tab=recording');
    await pg.evaluate(() => { localStorage.setItem('studio.rec.wpm', '150'); localStorage.setItem('studio.rp.pip', '0'); });
    await reload(pg);
    await pg.click('#record-now'); await pg.click('#rec-enable');
    await pg.waitForFunction(() => { const v = document.querySelector('#recorder video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    await pg.getByRole('switch', { name: 'Teleprompter' }).click(); await pg.fill('#rec-script', SCRIPT);
    await pg.waitForSelector('#rp-speed');
    const wpm = () => pg.$eval('#rp-speed .rp-wpm', e => +e.textContent);
    assert.strictEqual(await wpm(), 150); assert.match(await pg.textContent('#rp-speed .rp-pace'), /Normal/);
    await pg.click('#rp-speed .rp-faster'); assert.strictEqual(await wpm(), 160);
    await pg.click('#rec-rehearse');
    await pg.waitForFunction(() => document.querySelector('.rec-prompter p.now')?.dataset.line !== '0', null, { timeout: 8000 });
    await pg.locator('body').click({ position: { x: 5, y: 400 } });
    await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('ArrowUp'); assert.strictEqual(await wpm(), 180); assert.match(await pg.textContent('#rp-speed .rp-pace'), /Fast/);
    for (let i = 0; i < 7; i++) await pg.click('#rp-speed .rp-slower');
    assert.strictEqual(await wpm(), 110); assert.match(await pg.textContent('#rp-speed .rp-pace'), /Slow/);
    await pg.click('#rp-speed .rp-faster'); await pg.click('#rp-speed .rp-faster'); await pg.click('#rp-speed .rp-faster'); await pg.click('#rp-speed .rp-faster');
    assert.strictEqual(await pg.$eval('#rec-wpm', e => +e.value), 150);
    // the slider track fills to the value after button clicks too (Liquid glass --fill, set from the value attribute)
    assert.strictEqual(await pg.$eval('#rec-wpm', e => e.style.getPropertyValue('--fill')), ((150 - 60) / 200 * 100) + '%');
    if (shots) await pg.screenshot({ path: join(shots, 'teleprompter-speed.png') });
    await pg.click('#rec-rehearse-stop');
    assert.strictEqual((await api('/api/state')).state.takes.length, 0, 'rehearsal records nothing');
    await reload(pg);
    assert.strictEqual(await pg.evaluate(() => localStorage.getItem('studio.rec.wpm')), '150');
    assert.deepStrictEqual(errs, []);
    await pg.close();
  });
  await t('teleprompter pop-out: its own window, synced both ways (speed, mirror, rehearse, record, stop); closing it brings it back', async () => {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } }), errs = errsOf(pg);
    await open(pg, '#tab=recording');
    if (!(await pg.$('#recorder'))) await pg.click('#record-now');
    await pg.click('#rec-enable');
    await pg.waitForFunction(() => { const v = document.querySelector('#recorder video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    await pg.getByRole('switch', { name: 'Teleprompter' }).isChecked().then(on => on || pg.getByRole('switch', { name: 'Teleprompter' }).click());
    await pg.fill('#rec-script', SCRIPT);
    const [pop] = await Promise.all([pg.waitForEvent('popup'), pg.click('#rp-popout')]);
    await pop.waitForSelector('#rp-window .rec-prompter p[data-line="0"]');
    await pg.waitForSelector('.rp-away');
    assert.ok(!(await pg.$('#recorder .rec-prompter')), 'the page shows where the prompter went');
    const before = await pg.$eval('#rec-wpm', e => +e.value);
    await pop.click('#rp-speed-pop .rp-faster');
    await pg.waitForFunction(b => +document.querySelector('#rec-wpm').value === b + 10, before);
    await pg.locator('body').click({ position: { x: 5, y: 400 } }); await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown');
    await pop.waitForFunction(b => +document.querySelector('#rp-speed-pop .rp-wpm').textContent === b - 10, before);
    await pop.click('#rp-window >> text=Mirror');
    assert.strictEqual(await pg.getByRole('switch', { name: 'Mirror text (beam splitter)' }).isChecked(), true);
    assert.ok(await pop.$('#rp-window .rec-prompter.flip'));
    await pop.click('#rp-window >> text=Mirror');
    await pop.click('#rp-rehearse');
    await pg.waitForSelector('.rec-live.reh');
    await pop.waitForFunction(() => document.querySelector('#rp-window p.now')?.dataset.line !== '0', null, { timeout: 8000 });
    if (shots) { await pop.setViewportSize({ width: 560, height: 420 }); await pop.screenshot({ path: join(shots, 'teleprompter-popout.png') }); }
    await pop.click('#rp-rehearse-stop'); await pg.waitForFunction(() => !document.querySelector('.rec-live.reh'));
    // record from the pop-out: countdown, recording on both, stop from the page
    await pop.click('#rp-record');
    await pop.waitForSelector('.rp-count', { timeout: 3000 });
    await pop.waitForFunction(() => /Recording/.test(document.querySelector('#rp-state').textContent), null, { timeout: 6000 });
    await pg.waitForSelector('#rec-stop');
    await pg.waitForTimeout(2200);
    await pop.click('#rp-stop');
    await pg.waitForSelector('.take .tstate >> text=In footage', { timeout: 30000 });
    assert.strictEqual((await api('/api/state')).state.takes.filter(x => x.status === 'ready').length, 1);
    await pop.close();
    await pg.waitForSelector('#recorder .rec-prompter', { timeout: 3000 });
    assert.ok(!(await pg.$('.rp-away')));
    assert.deepStrictEqual(errs, []);
    await pg.close();
  });
  await t('footage from a link: a Drive link downloads with progress into the footage; a private one shows the login line', async () => {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } }), errs = errsOf(pg);
    await open(pg, '#step=start');
    await pg.evaluate(() => localStorage.setItem('studio.rec.open', '0')); await reload(pg);
    await pg.fill('#footage-link', 'https://drive.google.com/file/d/1PrivateTakeXYZ/view'); await pg.click('#footage-link-add');
    await pg.waitForSelector('.imp.failed >> text=This link needs a login');
    await pg.fill('#footage-link', 'https://drive.google.com/file/d/1BigDriveTakeXYZ/view?usp=sharing'); await pg.click('#footage-link-add');
    await pg.waitForSelector('.imp.downloading [role="progressbar"]', { timeout: 5000 });
    await pg.waitForSelector('.imp.ready >> text=in your footage', { timeout: 15000 });
    const s = (await api('/api/state')).state;
    assert.ok(s.footage.includes(`inbox/studio/${JOB}/long take.mp4`), JSON.stringify(s.footage));
    await pg.locator('#footage-link-box').scrollIntoViewIfNeeded();
    if (shots) { const b = await pg.locator('#footage-link-box').boundingBox(); await pg.screenshot({ path: join(shots, 'footage-link.png'), clip: { x: 0, y: Math.max(0, b.y - 330), width: 1280, height: Math.min(860, b.height + 520) } }); }
    assert.deepStrictEqual(errs, []);
    await pg.close();
  });
} finally {
  try { await client?.close(); } catch {}
  await browser.close(); srv.kill(); mock.close();
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio connect browser tests passed`);
process.exit(0);
