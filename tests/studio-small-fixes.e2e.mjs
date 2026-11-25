// Three small page fixes from Studio report 4, in a real Chrome with no keys and no network:
// - item 20: the chat has a Close button at every width. On a wide screen it puts the chat away, the page takes the
//   room, the chat button in the top bar brings it back, and a reload keeps it away. On a phone it closes the sheet.
// - item 19: Text and graphics has one switch, "Make hard-to-read words easier to read". It starts off for a reference
//   whose captions have no outline, and your click wins; off sends --no-boost
// - item 16: a reference read without the vision pass says so in one plain line on the reference card
// Run: node tests/studio-small-fixes.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-small-e2e-')), SDIR = join(STATE, 'studio'), REF = join(STATE, 'ref'), JOB = 'small-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
mkdirSync(SDIR, { recursive: true }); mkdirSync(REF, { recursive: true });
// a reference as a teardown leaves it: bare captions, and no vision pass
writeFileSync(join(REF, 'Reel.md'), readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8').replace(/^- captions:.*$/m, m => [m, '- caption-outline: none', '- caption-shadow: none', '- vision: off'].join('\n')));
{ const s = { ...C.defaultState(), job: JOB };
  s.reference = { ...s.reference, status: 'ready', mode: 'off', out: REF, file: join(REF, 'ref.mp4'), extracted: C.extract(join(REF, 'Reel.md')) };
  assert.deepStrictEqual(C.applyPatch(s, { reference: { mode: 'recreate' } }, C.catalog()).errs, []);
  writeFileSync(join(SDIR, 'state.json'), JSON.stringify(s)); }
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async p => (await fetch(url + p)).json();
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#areas'); };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#main .step:not([hidden])'); };
const shot = async (pg, name, sel) => { if (!shots) return; await pg.waitForTimeout(400); if (sel) await pg.locator(sel).first().screenshot({ path: join(shots, name) }); else await pg.screenshot({ path: join(shots, name) }); };
const mainW = pg => pg.$eval('#main', e => Math.round(e.getBoundingClientRect().width));

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await open(pg, '#step=text');

  await t('wide screen: the chat has a Close button; it puts the chat away and the page takes the room', async () => {
    assert.ok(await pg.isVisible('#chat') && await pg.isVisible('#chat-close'), 'the chat and its Close button show at 1440 px');
    assert.ok(!(await pg.isVisible('#chat-open')), 'no chat button in the top bar while the chat is open');
    const before = await mainW(pg); await shot(pg, 'r4-chat-open-dark.png');
    await pg.click('#chat-close'); await pg.waitForSelector('#chat', { state: 'hidden' });
    assert.ok(await pg.isVisible('#chat-open'), 'the chat button shows in the top bar');
    assert.ok(await mainW(pg) > before + 200, 'the page is wider');
    await pg.waitForFunction(() => document.activeElement && document.activeElement.id === 'chat-open', null, { timeout: 3000 }).catch(() => assert.fail('the keyboard should land on the button that brings the chat back'));
    await shot(pg, 'r4-chat-closed-dark.png');
  });
  await t('a reload keeps the chat away; the chat button brings it back, and that is kept too', async () => {
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#main .step:not([hidden])');
    assert.ok(!(await pg.isVisible('#chat')) && await pg.isVisible('#chat-open'));
    await pg.click('#chat-open'); await pg.waitForSelector('#chat', { state: 'visible' });
    assert.ok(await pg.isVisible('#chat-close') && !(await pg.isVisible('#chat-open')));
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#main .step:not([hidden])'); assert.ok(await pg.isVisible('#chat'));
  });
  await t('Ask my agent opens a chat that was put away', async () => {
    await pg.click('#chat-close'); await pg.waitForSelector('#chat', { state: 'hidden' });
    await pg.evaluate(() => { location.hash = '#step=text'; });
    const ask = pg.locator('#ask-open, #ask-agent, .ask-agent button').first();
    if (await ask.count()) { await ask.click(); const send = pg.locator('.ask-pop button, #ask-list button').first(); if (await send.count()) { await send.click(); await pg.waitForSelector('#chat', { state: 'visible' }); } }
    if (!(await pg.isVisible('#chat'))) { await pg.click('#chat-open'); await pg.waitForSelector('#chat', { state: 'visible' }); }
  });
  await t('light theme: the same, calm', async () => {
    await theme(pg, 'light'); await pg.click('#chat-close'); await pg.waitForSelector('#chat', { state: 'hidden' }); await shot(pg, 'r4-chat-closed-light.png');
    await pg.click('#chat-open'); await pg.waitForSelector('#chat', { state: 'visible' }); await shot(pg, 'r4-chat-open-light.png'); await theme(pg, 'dark');
  });
  await t('Text and graphics: one switch for hard-to-read words; a reference with bare captions starts it off, your click wins', async () => {
    await open(pg, '#step=text'); await pg.waitForSelector('#text-extra #boost');
    assert.strictEqual((await pg.textContent('#text-extra')).trim(), 'Make hard-to-read words easier to read');
    const SW = '#boost input[role="switch"]', on = () => pg.$eval(SW, e => e.checked);
    assert.strictEqual(await on(), false, 'off: the reference draws its captions with no outline');
    let v = await api('/api/state'); assert.deepStrictEqual(v.boost, { on: false, by: 'reference' }); assert.ok(v.compose.args.includes('--no-boost'));
    await shot(pg, 'r4-boost-off-dark.png', '#s-menu');
    await pg.click(SW); await pg.waitForFunction(q => document.querySelector(q).checked, SW);
    v = await api('/api/state'); assert.strictEqual(v.state.boost, 'on'); assert.deepStrictEqual(v.boost, { on: true, by: 'you' }); assert.ok(!v.compose.args.includes('--no-boost'));
    await shot(pg, 'r4-boost-on-dark.png', '#s-menu');
    await theme(pg, 'light'); await pg.waitForSelector('#text-extra #boost'); await shot(pg, 'r4-boost-on-light.png', '#s-menu'); await theme(pg, 'dark');
    await pg.waitForSelector(SW); await pg.click(SW); await pg.waitForFunction(q => !document.querySelector(q).checked, SW);
    v = await api('/api/state'); assert.strictEqual(v.state.boost, 'off'); assert.ok(v.compose.args.includes('--no-boost'));
    for (const tab of ['fonts', 'graphics']) { await pg.click('#tab-' + tab); assert.strictEqual(await pg.locator('#boost').count(), 0, `the switch is on the Text layer only, not on ${tab}`); }
  });
  await t('the reference card says, in one plain line, that the vision pass was off', async () => {
    await open(pg, '#step=reference'); await pg.waitForSelector('#ref-out');
    assert.strictEqual((await pg.textContent('#ref-vision')).trim(), 'We read this reference without the vision pass, so titles may be misread.');
    assert.strictEqual(await pg.locator('#ref-vision').count(), 1);
    await shot(pg, 'r4-vision-off-dark.png', '#ref-out'); await theme(pg, 'light'); await pg.waitForSelector('#ref-out'); await shot(pg, 'r4-vision-off-light.png', '#ref-out'); await theme(pg, 'dark');
  });
  await t('phone: Close still closes the chat sheet, and nothing scrolls sideways', async () => {
    await pg.setViewportSize({ width: 390, height: 844 }); await open(pg, '#step=text');
    await pg.click('#chat-open'); await pg.waitForSelector('#chat.open'); assert.ok(await pg.isVisible('#chat-close'));
    await pg.click('#chat-close'); await pg.waitForFunction(() => !document.getElementById('chat').classList.contains('open'));
    assert.ok(await pg.isVisible('#chat-open'));
    assert.strictEqual(await pg.evaluate(() => localStorage.getItem('studio.chat')), 'open', 'closing the sheet on a phone does not put the chat away on a wide screen');
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 1, 'no sideways scroll: ' + over);
    await pg.setViewportSize({ width: 1440, height: 900 }); await pg.waitForSelector('#chat', { state: 'visible' });
  });
  await t('no em dash and no terminal command in the new words', async () => {
    const txt = await pg.evaluate(() => document.body.innerText); assert.ok(!/\u2014/.test(txt)); assert.ok(!/--no-boost/.test(txt));
  });
  assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join(' | '));
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  for (const d of [join('jobs', JOB), join('inbox', 'studio', JOB)]) rmSync(join(ROOT, d), { recursive: true, force: true });
}
console.log(`\n${n} studio small fixes e2e tests passed`);
process.exit(0);
