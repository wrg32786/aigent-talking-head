// B-roll that picks itself (1.13.0), on the B-roll step (#step=broll), in a real Chrome, on synthetic media only (no keys, no network):
// - after a draft, b-roll picks itself: the first spot too (after the hook), a number said becomes a counter card
//   placed by Studio, the rest wait with why; the chat says what was placed
// - Use it with no Pexels key and nothing in the library: a card made from the spot's words goes on
// - Add a spot splits a spot and the placed b-roll stays on its words
// - Upload asks what it is; a raw testimonial is transcribed and cut into pieces on whole words, and a piece plays in
//   the reel with its own sound, between your pieces (Draft hands it to the reel already cut, --as-is)
// - MCP: pick_broll, add_spot and add_testimonial
// - screenshots, dark and light, phone
// Needs Chrome and ffmpeg. Run: node tests/studio-spots.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-spots-e2e-')), LIB = join(STATE, 'lib'), JOB = 'spots-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });

// tone bursts are the words, at the times the stand-in transcriber says
const clip = (f, secs, words, color) => ff(['-f', 'lavfi', '-i', `color=c=${color}:s=360x640:r=12:d=${secs}`, '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*200*t)*(${words.map(([a, b]) => `between(t,${a},${b})`).join('+')})+0.006*(random(1)-0.5)':s=48000:d=${secs}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', f]);
const TAKE = join(STATE, 'spots-take.mp4'), TW = [[1.0, 1.6, 'One'], [1.75, 2.4, 'two.'], [3.3, 4.0, 'Three'], [4.1, 4.8, 'four.'], [6.0, 6.7, 'Five'], [6.8, 7.5, 'six.']];
clip(TAKE, 9, TW, '0x303840');
// a testimonial: four sentences of about 3 s with pauses between, so it cuts into two pieces
const TESTI = join(STATE, 'testi-raw.mp4'), XW = [[0.5, 1.4, 'This'], [1.5, 2.4, 'changed'], [2.5, 3.4, 'everything.'], [4.0, 4.9, 'We'], [5.0, 5.9, 'tripled'], [6.0, 6.9, 'sales.'], [7.8, 8.7, 'I'], [8.8, 9.7, 'recommend'], [9.8, 10.7, 'it.'], [11.4, 12.3, 'Truly'], [12.4, 13.3, 'worth'], [13.4, 14.3, 'it.']];
clip(TESTI, 15, XW, '0x604030');
const DESK = join(STATE, 'desk.mp4'); ff(['-f', 'lavfi', '-i', 'testsrc2=s=540x960:d=4:r=24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', DESK]);
const TXW = join(STATE, 'words.json');
writeFileSync(TXW, JSON.stringify({ 'spots-take': { duration: 9, words: TW }, 'testi-raw': { duration: 15, words: XW } }));
const env = { ...process.env, FAKE_TX_WORDS: TXW, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: LIB, STUDIO_BROLL_AUTO: '', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '',
  STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '50', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const port = +url.split(':').pop();
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
// Studio keeps a live connection, so the page never goes network idle: wait for the stepper, and for the step a link names
const STEP_OF = { reference: 'picture', post: 'render' };
const ready = async (pg, hash = '') => { await pg.waitForSelector('#stepper'); const st = (hash.match(/step=([a-z]+)/) || [])[1]; if (st) await pg.waitForSelector(`#stepper [aria-current="step"][data-step="${STEP_OF[st] || st}"]`); };
const open = async (pg, hash) => { await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await ready(pg, hash); };
const reload = async pg => { await pg.reload({ waitUntil: 'domcontentloaded' }); await ready(pg); };
const upload = async (kind, f, name) => (await fetch(`${url}/api/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: readFileSync(f) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const waitTask = async (ms = 3 * 60e3) => { await wait(400); return until(async () => { const v = await api('/api/state'); return v.task && v.task.status !== 'running' ? v : null; }, ms); };
const log = job => { try { return readFileSync(join(ROOT, 'jobs', job, 'fake-reel.log'), 'utf8'); } catch { return ''; } };
const spot = async k => (await api('/api/broll')).beats[k - 1];
const cleanJobs = () => { rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await reload(pg); await pg.waitForSelector('#broll-lane'); };
const shot = async (pg, sel, name) => {
  if (!shots) return;
  await pg.evaluate(q => { const e = document.querySelector(q); e.scrollIntoView({ block: 'start' }); const h = document.querySelector('header.top'); scrollBy(0, -((h ? h.offsetHeight : 0) + 12)); }, sel);
  await pg.waitForTimeout(400);
  const b = await pg.locator(sel).first().boundingBox(), vp = pg.viewportSize(), top = Math.max(0, b.y);
  await pg.screenshot({ path: join(shots, name), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, top - 8), width: Math.min(vp.width - Math.max(0, b.x - 8), b.width + 16), height: Math.min(vp.height - top, b.height + 16) } });
};

// 1.28.0: the other sources sit behind "Choose something else" while a spot has an idea or a clip, and Add a spot is in More
const tab = async (pg, sel) => { if (!(await pg.$(sel))) await pg.click('#broll-more'); await pg.click(sel); };
const more = async pg => { if (!(await pg.$('#broll-more-fold[open]'))) await pg.click('#broll-more-fold > summary'); };
const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
let client;
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  const take = (await upload('footage', TAKE, 'spots take.mp4')).path; assert.ok(/spots-take/.test(take), take);
  await api('/api/cut/transcribe', { path: take }); await until(async () => { const c = await api('/api/cut'); return c.tx && c.tx.status === 'ready'; }, 30000);
  await api('/api/cut/set', { source: take, by: 'test', candidates: [{ kind: 'clip', label: 'First', ranges: [[0.95, 2.45]] }, { kind: 'clip', label: 'Last', ranges: [[5.9, 7.6]] }] });
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await t('after a draft b-roll picks itself: the first spot too, a counter card for "doubled", the rest wait with why', async () => {
    await open(pg, '#step=broll'); await pg.waitForSelector('#broll-empty');
    assert.ok(/picks itself/.test(await pg.textContent('#broll-empty')));
    const d = await api('/api/draft', {}); assert.ok(!d.error, d.error); assert.strictEqual((await waitTask()).task.status, 'done');
    await pg.waitForSelector('#broll-lane .spot[data-beat="3"]');
    const s3 = await until(async () => { const b = await spot(3); return b.slot ? b : null; }, 60000);
    assert.strictEqual(s3.slot.clip.source, 'agent'); assert.strictEqual(s3.slot.by, 'Studio'); assert.ok(/doubled/.test(s3.slot.why), s3.slot.why);
    const s1 = await spot(1); assert.ok(s1.idea && !s1.slot, 'the first spot waits: a search with no key and nothing in the library'); assert.ok(s1.idea.offset >= 1.2 && s1.idea.why);
    await until(async () => (await api('/api/state')).state.chat.some(m => /B-roll picked itself: 1 placed from what you said, 1 idea waits for you/.test(m.text || '')));
    await pg.waitForSelector('#broll-lane .spot[data-beat="3"].filled');
    assert.ok(/picked/.test(await pg.textContent('#broll-lane .spot[data-beat="3"] .sp-by')));
    await pg.click('#broll-lane .spot[data-beat="1"]'); await pg.waitForSelector('#beat-idea');
    assert.ok(/^Idea: /.test(await pg.textContent('#beat-idea')), 'a waiting idea reads as an idea'); { const tx = await pg.textContent('#beat-idea'); assert.ok(!/Stock:|\(full cutaway\)|You talk about/.test(tx) && /covers the whole screen|panel|top half|small box|card above/.test(tx), 'plain words, no search term as a title: ' + tx); }
    assert.strictEqual(await pg.$('#ye-next'), null, 'no second Next button on B-roll');
    assert.ok(/1 spot/.test(await pg.textContent('#your-edit [data-part="broll"]')));
  });
  await t('Use it with no key and nothing in the library: a card made from the spot words goes on', async () => {
    await pg.click('#idea-approve'); const s1 = await until(async () => { const b = await spot(1); return b.slot ? b : null; }, 60000);
    assert.strictEqual(s1.slot.clip.source, 'agent'); assert.ok(s1.slot.offset >= 1.2, 'on the words, after the hook');
    await pg.waitForSelector('#slot-why'); await pg.waitForSelector('#broll-lane .spot[data-beat="1"].filled');
  });
  await t('Add a spot: the spot splits and the placed b-roll stays on its words', async () => {
    await pg.click('#broll-lane .spot[data-beat="2"]'); await more(pg); await pg.click('#broll-add-spot'); await pg.waitForSelector('#add-spot');
    await pg.fill('#add-spot-at', '6'); await pg.click('#add-spot-go');
    await pg.waitForSelector('#broll-lane .spot[data-beat="4"]'); const b = (await api('/api/broll')).beats;
    assert.strictEqual(b.length, 4); assert.ok(b[3].slot && /doubled/.test(b[3].slot.why), 'the counter moved with its words to spot 4');
    await theme(pg, 'dark'); await pg.click('#broll-lane .spot[data-beat="1"]'); await shot(pg, '#s-broll', 'redesign-broll-spots-dark.png');
    await theme(pg, 'light'); await pg.click('#broll-lane .spot[data-beat="1"]'); await shot(pg, '#s-broll', 'redesign-broll-spots-light.png');
    await theme(pg, 'dark');
  });
  await t('Upload asks what it is: a screen recording keeps its kind', async () => {
    await pg.click('#broll-lane .spot[data-beat="2"]'); await tab(pg, '#btab-upload'); await pg.waitForSelector('#up-type');
    await pg.selectOption('#up-type', 'screen-recording'); await pg.setInputFiles('#broll-file', DESK);
    const s2 = await until(async () => { const b = await spot(2); return b.slot ? b : null; }); assert.strictEqual(s2.slot.clip.type, 'screen-recording');
  });
  let piece;
  await t('a raw testimonial is cut into pieces on whole words, then plays in the reel with its own sound', async () => {
    // the panel redraws once the upload above lands on its spot; wait for that, then open Upload again if it closed
    await pg.waitForTimeout(1500); if (!(await pg.$('#up-type'))) await tab(pg, '#btab-upload');
    await pg.waitForSelector('#up-type');
    await pg.selectOption('#up-type', 'testimonial'); assert.ok(await pg.isChecked('#up-raw'), 'a testimonial is raw by default');
    await pg.setInputFiles('#broll-file', TESTI);
    await pg.waitForSelector('#up-raws .raw.done', { timeout: 60000 });
    const lib = (await api('/api/broll/library?q=testimonial')).clips.filter(c => c.raw); assert.strictEqual(lib.length, 2, JSON.stringify(lib.map(c => c.raw)));
    const words = XW.map(w => w[2]).join(' '); for (const c of lib) assert.ok(words.includes(c.raw.text), 'whole sentences: ' + c.raw.text);
    assert.ok(lib.every(c => c.raw.seconds >= 5 && c.raw.seconds <= 12));
    piece = lib.find(c => /tripled/.test(c.raw.text)); assert.ok(piece, 'the piece with "tripled"');
    await pg.waitForSelector(`#broll-testimonials li[data-id="${piece.id}"] .ts-add`);
    await shot(pg, '#broll-testimonials', 'redesign-broll-testimonials-dark.png');
    await pg.click(`#broll-testimonials li[data-id="${piece.id}"] .ts-add`); await pg.waitForSelector(`#broll-testimonials li[data-id="${piece.id}"].on`);
    const e = await api('/api/edit'); assert.deepStrictEqual(e.combo.pieces.map(x => x.kind), ['cut', 'testimonial', 'cut'], 'before the last piece');
    assert.ok(e.edit.stale, 'the draft is out of date now'); assert.ok(/1 testimonial/.test(e.edit.broll.text));
    await pg.selectOption(`#broll-testimonials li[data-id="${piece.id}"] .ts-after`, e.combo.pieces[2].id);
    await until(async () => (await api('/api/edit')).combo.pieces.map(x => x.kind).join() === 'cut,cut,testimonial');
    const d = await api('/api/draft', {}); assert.ok(!d.error, d.error); assert.strictEqual((await waitTask()).task.status, 'done');
    const l = log(JOB); assert.ok(l.includes(`cuts/t-${piece.id}.mp4`) && l.includes('--as-is'), l.slice(-600));
    const cj = JSON.parse(readFileSync(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'clips.json'), 'utf8')).clips.find(c => c.file === `cuts/t-${piece.id}.mp4`);
    assert.ok(cj && cj.words.map(w => w[2]).join(' ').includes('tripled'), 'its own words go with it');
  });
  await t('MCP: pick_broll, add_spot and add_testimonial', async () => {
    client = new Client({ name: 'spots-e2e', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_PORT: String(port) } }));
    const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, name + ': ' + r.content[0].text); return JSON.parse(r.content[0].text); };
    const sp = await call('add_spot', { at: 2.5 }); assert.ok(sp.spots.length >= 2);
    const pk = await call('pick_broll', { all: true }); assert.ok(Array.isArray(pk.spots));
    assert.deepStrictEqual(await call('pick_broll', { auto: false }), { auto: false }); assert.strictEqual((await api('/api/broll')).auto, false); await call('pick_broll', { auto: true });
    const tm = await call('add_testimonial', { clip: piece.id, remove: true }); assert.ok(!tm.pieces.some(x => x.kind === 'testimonial'));
    const lb = await call('list_broll', {}); assert.strictEqual(lb.testimonials.length, 2); assert.ok(lb.raws.some(r => r.status === 'done'));
  });
  await t('the phone layout fits', async () => {
    await pg.setViewportSize({ width: 390, height: 844 }); await open(pg, '#step=broll'); await pg.waitForSelector('#broll-lane');
    const over = await pg.evaluate(() => [...document.querySelectorAll('#s-broll *')].filter(e => !e.closest('#broll-lane')).map(e => e.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), 0) - innerWidth); assert.ok(over <= 1, 'no sideways scroll: ' + over);
    await shot(pg, '#s-broll', 'redesign-broll-phone-dark.png');
    await theme(pg, 'light'); await shot(pg, '#s-broll', 'redesign-broll-phone-light.png'); await theme(pg, 'dark');
    assert.deepStrictEqual(errs, []);
  });
} finally {
  try { await client?.close(); } catch {}
  await browser.close(); srv.kill(); cleanJobs();
  rmSync(STATE, { recursive: true, force: true });
}
console.log(`\n${n} studio spots e2e tests passed`);
process.exit(0);
