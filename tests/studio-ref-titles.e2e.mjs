// Read the titles with my agent (1.29.0), in a real Chrome with no keys and no network:
// - the breakdown of a reference has one small card: "Read the titles with my agent", with Copy for my agent only
//   while no agent is connected, and no model button without a model backend
// - Copy for my agent copies the ready instruction (the sheets by their full paths, the tool, no terminal command)
// - with an agent connected the card has Send to my agent; the chat shows one short line, the agent gets the rest
// - after the agent sends titles the card says "Titles read by your agent: 3" with the first few
// - dark and light: the card is there in both, nothing breaks
// Needs Chrome. Run: node tests/studio-ref-titles.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
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
const STATE = mkdtempSync(join(tmpdir(), 'studio-ref-titles-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'reftitles-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
process.env.STUDIO_DIR = SDIR; mkdirSync(SDIR, { recursive: true });
const C = await import('../kit/studio/core.mjs'), CH = await import('../kit/studio/channel.mjs');

// a reference that is broken down, with its title sheets beside the recipe (as kit/teardown.mjs leaves them)
const OUT = `teardown/${JOB}`, DIR = join(ROOT, OUT), SHEETS = join(DIR, 'title-sheets');
mkdirSync(SHEETS, { recursive: true });
writeFileSync(join(DIR, 'Reel.md'), readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8')); writeFileSync(join(DIR, 'ref.mp4'), 'not a real video');
for (const f of ['sheet-01.jpg', 'sheet-02.jpg']) writeFileSync(join(SHEETS, f), 'jpeg');
writeFileSync(join(SHEETS, 'sheets.json'), JSON.stringify({ sheets: [{ file: 'sheet-01.jpg', from: 0, to: 3.3, fps: 7 }, { file: 'sheet-02.jpg', from: 3.4, to: 6.7, fps: 7 }] }));
const s0 = C.defaultState(); s0.job = JOB;
s0.reference = { ...s0.reference, status: 'ready', mode: 'recreate', out: OUT, file: `${OUT}/ref.mp4`, extracted: C.extract(join(DIR, 'Reel.md')) };
writeFileSync(join(SDIR, 'state.json'), JSON.stringify(s0));

const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '', STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs', STUDIO_TEARDOWN_ARGS: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#ref-titles'); };
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#areas'); };
const shot = async (pg, name) => { if (!shots) return; await pg.$eval('#ref-titles', e => e.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name) }); };
const text = async (pg, sel) => (await pg.textContent(sel)).replace(/\s+/g, ' ').trim();
const buttons = pg => pg.$$eval('#ref-titles button', x => x.map(e => e.textContent.trim()));

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('studio.paused', '1'); } catch {} });
  await api('/api/settings', { chat: { backend: 'agent' } });

  await t('the breakdown has one small card, with Copy for my agent only while no agent is connected', async () => {
    await open(pg, '#step=reference'); await pg.waitForSelector('#ref-out #ref-titles');
    assert.strictEqual(await text(pg, '#ref-titles-h'), 'Read the titles with my agent');
    assert.strictEqual(await text(pg, '#ref-titles-state'), 'Your agent looks at pictures of the reference and reads each title as it was designed.');
    assert.deepStrictEqual(await buttons(pg), ['Copy for my agent'], 'no agent connected, no model backend');
    assert.strictEqual(await pg.$$eval('.ref-titles', x => x.length), 1); assert.ok(!/npm |node |\u2014|\u2013/.test(await text(pg, '#ref-titles')));
    await shot(pg, 'ref-titles-dark.png');
  });
  await t('Copy for my agent copies the ready instruction, with the sheets and the tool and no terminal command', async () => {
    await pg.click('#ref-titles-copy');
    const tx = await until(async () => { const c = await pg.evaluate(() => navigator.clipboard.readText().catch(() => '')); return /set_reference_titles/.test(c) ? c : null; });
    assert.ok(tx.includes(join(SHEETS, 'sheet-01.jpg')) && tx.includes(join(SHEETS, 'sheet-02.jpg')) && /slot-roll/.test(tx) && /glitch-slice/.test(tx), tx);
    assert.ok(!/npm |node |\u2014|\u2013/.test(tx));
  });
  await t('with an agent connected: Send to my agent; the chat shows one short line and the agent gets the rest', async () => {
    CH.touch({ name: 'claude-code' });
    await open(pg, '#step=reference'); await pg.waitForSelector('#ref-titles-send');
    assert.deepStrictEqual(await buttons(pg), ['Send to my agent', 'Copy for my agent']);
    await pg.click('#ref-titles-send');
    const m = await until(async () => { const c = (await api('/api/state')).state.chat.at(-1); return c && c.attach && c.attach.kind === 'ref-titles' ? c : null; });
    assert.strictEqual(m.to, 'agent'); assert.strictEqual(m.attach.sheets, 2); assert.ok(m.text.includes(join(SHEETS, 'ask.txt')) && /set_reference_titles/.test(m.text));
    assert.match(readFileSync(join(SHEETS, 'ask.txt'), 'utf8'), /set_reference_titles/);
    const said = await until(async () => { const all = await pg.$$eval('#msgs li.user', x => x.map(e => e.textContent)); return all.find(x => /Please read the titles of my reference\./.test(x)) ? all : null; });
    assert.ok(!said.some(x => /title-sheets|set_reference_titles/.test(x)), 'the page shows the short line only');
  });
  await t('after the agent sends the titles the card says how many it read, with the first few', async () => {
    const r = await api('/api/reference/titles', { by: 'claude-code', titles: [{ start: 0.8, end: 2.2, lines: ['WAS THE', 'LOWEST', 'WE EVER MADE'], key: 'LOWEST' }, { start: 5.9, end: 7.9, lines: ['THE ONLY', 'Question'], key: 'Question', font: 'italic serif', effect: 'type' },
      { start: 24, end: 27, lines: ['365 Days'], effect: 'count-up', count: { from: 0, to: 365, unit: 'Days', final: '1 Year' } }, { start: 30, end: 31, lines: ['Feel Safe'] }] });
    assert.strictEqual(r.stored, 4, r.error);
    await pg.waitForSelector('#ref-titles[data-read="4"]');
    assert.strictEqual(await text(pg, '#ref-titles-h'), 'Titles read by your agent: 4');
    assert.strictEqual(await text(pg, '#ref-titles-state'), 'WAS THE / LOWEST / WE EVER MADE, THE ONLY / Question, 365 Days and more');
    assert.deepStrictEqual(await buttons(pg), ['Read them again', 'Copy for my agent']);
    await shot(pg, 'ref-titles-read-dark.png');
  });
  await t('light theme: the card is there and nothing breaks', async () => {
    await theme(pg, 'light'); assert.strictEqual(await text(pg, '#ref-titles-h'), 'Titles read by your agent: 4');
    const box = await pg.$eval('#ref-titles', e => { const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return { w: r.width, h: r.height, inside: r.left >= p.left && r.right <= p.right + 1 }; });
    assert.ok(box.w > 300 && box.h > 30 && box.h < 140 && box.inside, JSON.stringify(box));
    await shot(pg, 'ref-titles-read-light.png'); await theme(pg, 'dark');
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true }); rmSync(DIR, { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`), { recursive: true, force: true });
}
console.log(`\n${n} studio reference titles e2e tests passed`);
process.exit(0);
