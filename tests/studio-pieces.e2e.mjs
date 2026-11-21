// Best lines and Your clip (the server calls them pieces and the Combo), and the Outputs library, in a real Chrome, on
// synthetic media only (no keys, no network):
// - the Best lines layer of Cut: every line sorted by what it does, asides and retakes hidden until you ask
// - Use our best lines (hook first, CTA last, a reason each), then make it yours: drop, add, reorder
// - Your clip drafts on whole words: every word of every line, in your order, none clipped
// - Render (the Render step) writes reel-vN.settings.json; the Outputs library lists versions with their settings; Compare marks changes
// - MCP: get_pieces, choose_combo, set_combo and list_outputs
// - screenshots, dark and light, phone
// Needs Chrome and ffmpeg. Run: node tests/studio-pieces.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
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
const STATE = mkdtempSync(join(tmpdir(), 'studio-pieces-e2e-')), LIB = join(STATE, 'lib'), JOB = 'pieces-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });

// tone bursts are the words, at the times the stand-in transcriber says
const clip = (f, secs, words, color) => ff(['-f', 'lavfi', '-i', `color=c=${color}:s=360x640:r=12:d=${secs}`, '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*200*t)*(${words.map(([a, b]) => `between(t,${a},${b})`).join('+')})+0.006*(random(1)-0.5)':s=48000:d=${secs}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', f]);
// six sentences, each word 0.35 s with 0.1 s between, 0.9 s of quiet between sentences
const SENT = ['Nobody tells you this about agents.', 'My first client paid me before I had a product.', 'Sorry, my dog is barking.', 'Three months later we doubled our leads.', 'Open the dashboard and type your prompt.', 'Follow for part two.'];
const TW = []; { let at = 0.6; for (const s of SENT) { for (const w of s.split(' ')) { TW.push([+at.toFixed(2), +(at + 0.35).toFixed(2), w]); at += 0.45; } at += 0.9; } }
const SECS = Math.ceil(TW[TW.length - 1][1] + 1);
const TAKE = join(STATE, 'pieces-take.mp4'); clip(TAKE, SECS, TW, '0x303840');
const TXW = join(STATE, 'words.json'); writeFileSync(TXW, JSON.stringify({ 'pieces-take': { duration: SECS, words: TW } }));
const env = { ...process.env, FAKE_TX_WORDS: TXW, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: LIB, STUDIO_BROLL_AUTO: '', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '',
  STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '50', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const port = +url.split(':').pop();
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const upload = async (kind, f, name) => (await fetch(`${url}/api/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: readFileSync(f) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const waitTask = async (ms = 3 * 60e3) => { await wait(400); return until(async () => { const v = await api('/api/state'); return v.task && v.task.status !== 'running' ? v : null; }, ms); };
const log = job => { try { return readFileSync(join(ROOT, 'jobs', job, 'fake-reel.log'), 'utf8'); } catch { return ''; } };
const cleanJobs = () => { rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); };
// a fresh load of a link: via about:blank, because a new hash alone does not reload the page
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#main .step:not([hidden])'); };
const shot = async (pg, sel, name) => {
  if (!shots) return;
  await pg.evaluate(q => { const e = document.querySelector(q); e.scrollIntoView({ block: 'start' }); const h = document.querySelector('header.top'); scrollBy(0, -((h ? h.offsetHeight : 0) + 12)); }, sel);
  await pg.waitForTimeout(400);
  let b = await pg.locator(sel).first().boundingBox(), vp = pg.viewportSize(); const vp0 = vp;
  if (b.y + b.height > vp.height && vp.width > 600) { await pg.setViewportSize({ width: vp.width, height: Math.min(2400, Math.ceil(b.y + b.height + 80)) }); await pg.waitForTimeout(300); b = await pg.locator(sel).first().boundingBox(); vp = pg.viewportSize(); }
  const top = Math.max(0, b.y);
  await pg.screenshot({ path: join(shots, name), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, top - 8), width: Math.min(vp.width - Math.max(0, b.x - 8), b.width + 16), height: Math.min(vp.height - top, b.height + 16) } });
  if (vp !== vp0) await pg.setViewportSize(vp0);
};

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
let client;
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  const take = (await upload('footage', TAKE, 'pieces take.mp4')).path;
  await api('/api/cut/transcribe', { path: take }); await until(async () => { const c = await api('/api/cut'); return c.tx && c.tx.status === 'ready'; }, 30000);
  const P = await until(async () => { const j = await api('/api/pieces'); return j.pieces && j.pieces.length === SENT.length ? j : null; }, 30000);
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('studio.cutLayer')) localStorage.setItem('studio.cutLayer', 'lines'); } catch {} }); // this test is about Best lines; about:blank has no storage
  const ids = async () => (await api('/api/pieces')).combo.ids;

  await t('Best lines: every line sorted by what it does, the aside hidden until you ask', async () => {
    await open(pg, '#step=cut'); await pg.waitForSelector('#pieces-grid');
    assert.strictEqual(await pg.getAttribute('#cut-layer-lines', 'aria-selected'), 'true'); assert.strictEqual(await pg.getAttribute('#cut-body', 'data-layer'), 'lines');
    const cat = Object.fromEntries(P.pieces.map(p => [p.text, p.category]));
    assert.strictEqual(cat[SENT[0]], 'hook'); assert.strictEqual(cat[SENT[2]], 'aside'); assert.strictEqual(cat[SENT[3]], 'proof'); assert.strictEqual(cat[SENT[5]], 'cta');
    assert.strictEqual(await pg.$('#pieces-grid .pz-cat[data-cat="aside"]'), null, 'asides hidden by default');
    await pg.click('#pieces-retakes'); await pg.waitForSelector('#pieces-grid .pz-cat[data-cat="aside"] .pz'); await pg.click('#pieces-retakes');
    assert.strictEqual(await pg.textContent('#combo-h'), 'Your clip');
    assert.strictEqual(await pg.textContent('#combo-sum'), 'Click lines above to stitch your own clip, or use our best lines.');
    assert.strictEqual(await pg.$('#pieces-own'), null, 'Start over shows only when your clip has lines');
    // the lines we would pick carry a Best mark, and the button says how many
    assert.deepStrictEqual((await pg.$$eval('#pieces-grid .pz:has(.pz-best)', x => x.map(e => e.dataset.piece))).sort(), [...P.best.ids].sort());
    assert.strictEqual(await pg.textContent('#pieces-choose'), `Use our ${P.best.ids.length} best lines`);
  });
  await t('Use our best lines: hook first, CTA last, no aside, a reason each; Your edit says our pick', async () => {
    await pg.click('#pieces-choose'); await pg.waitForSelector('#combo-strip .cb');
    const c = await ids(), by = Object.fromEntries(P.pieces.map(p => [p.id, p]));
    assert.strictEqual(by[c[0]].category, 'hook'); assert.strictEqual(by[c[c.length - 1]].category, 'cta'); assert.ok(!c.some(id => by[id].category === 'aside'));
    assert.strictEqual(await pg.$$eval('#combo-strip .cb-why', x => x.filter(e => e.textContent.length > 5).length), c.length);
    assert.deepStrictEqual(c, P.best.ids, 'what the Best marks said');
    assert.ok(/Our pick/.test(await pg.textContent('#combo'))); await pg.waitForFunction(n => new RegExp(`${n} lines, \\d+ s, in your order, our pick`).test(document.querySelector('#your-edit [data-part="from"]').textContent), c.length, { timeout: 5000 }).catch(async () => assert.fail('Your edit: ' + await pg.textContent('#your-edit [data-part="from"]')));
    assert.ok(new RegExp(`^${c.length} lines, \\d+ s, stitched in this order\\.$`).test(await pg.textContent('#combo-sum')), await pg.textContent('#combo-sum'));
    assert.strictEqual(await pg.textContent('#pieces-own'), 'Start over');
    // the server's note says lines and your clip (choosing again picks the same)
    const again = await api('/api/pieces', { choose: true }); assert.ok(new RegExp(`^Picked ${c.length} lines, \\d+ s, for your clip\\.`).test(again.note), again.note); assert.deepStrictEqual(again.pieces.combo.ids, c);
    assert.strictEqual(await pg.$$eval('#pieces-grid .pz.in .pz-n', x => x.length), c.length, 'numbered in the grid');
    await theme(pg, 'dark'); await shot(pg, '#s-cut', 'redesign-cut-pieces-dark.png');
    await theme(pg, 'light'); await shot(pg, '#s-cut', 'redesign-cut-pieces-light.png'); await theme(pg, 'dark');
  });
  await t('make it yours: drop, add, move earlier; the order is yours and the reasons stay', async () => {
    const before = await ids(), last = before[before.length - 1];
    await pg.click(`#combo-strip .cb[data-combo="${before[1]}"] .cb-x`); await until(async () => (await ids()).length === before.length - 1);
    await pg.click(`#combo-strip .cb[data-combo="${last}"] .cb-up`); await until(async () => { const c = await ids(); return c[c.length - 2] === last; });
    const aside = P.pieces.find(p => p.category === 'aside'); await api('/api/pieces', { add: aside.id }); await until(async () => (await ids()).includes(aside.id));
    await pg.click(`#combo-strip .cb[data-combo="${aside.id}"] .cb-x`); await until(async () => !(await ids()).includes(aside.id));
    assert.ok(/changed by you/.test(await pg.textContent('#combo')));
    await pg.click(`#combo-strip .cb[data-combo="${last}"] .cb-down`); await until(async () => { const c = await ids(); return c[c.length - 1] === last; });
  });
  await t('Your clip drafts on whole words: each line cut on its own edges, in your order, with every word', async () => {
    const c = await ids(), by = Object.fromEntries(P.pieces.map(p => [p.id, p]));
    const d = await api('/api/draft', {}); assert.ok(!d.error, d.error); assert.strictEqual((await waitTask()).task.status, 'done');
    const cj = JSON.parse(readFileSync(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'clips.json'), 'utf8')), L = log(JOB);
    const said = cj.clips.flatMap(x => x.words.map(w => w[2])).join(' ');
    const want = c.map(id => by[id].text).join(' ');
    assert.strictEqual(said, want, 'every word of every line, in your order, none cut');
    for (const x of cj.clips) for (const w of x.words) assert.ok(w[1] - w[0] >= 0.34, 'no word clipped: ' + JSON.stringify(w));
    const files = cj.clips.map(x => x.file); let k = -1; for (const f of files) { const i = L.indexOf(f); assert.ok(i > k, 'in your order: ' + L); k = i; }
  });
  await t('Render writes the settings beside the reel; Outputs lists each version with them; Compare marks what changed', async () => {
    await pg.click('#stepper button[data-step="render"]'); await pg.waitForSelector('#s-render:not([hidden])'); await pg.waitForFunction(() => document.querySelector('#render') && document.querySelector('#render').getAttribute('aria-disabled') !== 'true');
    await pg.click('#render'); assert.strictEqual((await waitTask()).task.status, 'done');
    const st = JSON.parse(readFileSync(join(ROOT, 'jobs', JOB, 'reel-v1.settings.json'), 'utf8'));
    assert.strictEqual(st.version, 1); assert.ok(st.look && st.pieces.length >= 2 && st.files.includes(`jobs/${JOB}/reel-v1.mp4`), JSON.stringify(st));
    await api('/api/pieces', { remove: (await ids())[1] }); await api('/api/draft', {}); await waitTask(); await api('/api/render', {}); await waitTask();
    await pg.click('#outputs-open'); await pg.waitForSelector('#out-list .ov[data-version="2"]');
    assert.deepStrictEqual(await pg.$$eval('#out-list .ov', x => x.map(e => e.dataset.version)), ['2', '1']);
    assert.ok(/Latest/.test(await pg.textContent('#out-list .ov[data-version="2"]')));
    assert.ok(/piece/.test(await pg.textContent('#out-list .ov[data-version="1"] dl')));
    await pg.click('#out-list .ov[data-version="2"] .ov-compare'); await pg.waitForSelector('#out-cmp-hint');
    await pg.click('#out-list .ov[data-version="1"] .ov-compare'); await pg.waitForSelector('#out-compare');
    assert.ok(await pg.$$eval('#out-compare tr.diff', x => x.length) >= 1, 'length changed between the two');
    await theme(pg, 'dark'); await pg.click('#outputs-open'); await pg.waitForSelector('#out-list .ov'); if (shots) await pg.screenshot({ path: join(shots, 'redesign-outputs-dark.png') });
    await theme(pg, 'light'); await pg.click('#outputs-open'); await pg.waitForSelector('#out-list .ov'); if (shots) await pg.screenshot({ path: join(shots, 'redesign-outputs-light.png') });
    await pg.keyboard.press('Escape'); await theme(pg, 'dark');
  });
  await t('MCP: get_pieces, choose_combo, set_combo and list_outputs', async () => {
    client = new Client({ name: 'pieces-e2e', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_PORT: String(port) } }));
    const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, name + ': ' + r.content[0].text); return JSON.parse(r.content[0].text); };
    const gp = await call('get_pieces', {}); assert.strictEqual(gp.pieces.length, SENT.length); assert.ok(gp.categories.includes('proof'));
    const ch = await call('choose_combo', {}); assert.ok(ch.combo.length >= 2 && ch.combo[0].why);
    const mine = [gp.pieces[3].id, gp.pieces[0].id], sc = await call('set_combo', { ids: mine, reasons: { [mine[0]]: 'Lead with the number.' } });
    assert.deepStrictEqual(sc.combo.ids, mine); assert.strictEqual(sc.combo.by, 'Agent'); assert.strictEqual(sc.combo.reasons[mine[0]], 'Lead with the number.');
    await pg.click('#stepper button[data-step="cut"]'); await pg.waitForSelector(`#combo-strip .cb[data-combo="${mine[0]}"]`); assert.ok(/Set by/.test(await pg.textContent('#combo')));
    const lo = await call('list_outputs', {}); assert.deepStrictEqual(lo.versions.map(v => v.v), [2, 1]); assert.ok(lo.versions[1].settings.pieces.length);
  });
  await t('Clips is one click away and your clip leads it, and the phone layout fits', async () => {
    await pg.click('#stepper button[data-step="cut"]'); await pg.waitForSelector('#combo-to-clips'); await pg.click('#combo-to-clips'); await pg.waitForSelector('#cut-find');
    assert.strictEqual(await pg.getAttribute('#cut-layer-clips', 'aria-selected'), 'true');
    // your clip is the first row, kept; our suggested clips find themselves under it, and the page says which moves on
    const own = '#cut-candidates li.clip-row[data-id="own"]';
    await pg.waitForSelector(own + '[data-keep="1"]'); assert.strictEqual(await pg.$eval('#cut-candidates li.clip-row', e => e.dataset.id), 'own');
    assert.ok(/^2 lines stitched, /.test(await pg.textContent(own + ' .clip-m')), await pg.textContent(own + ' .clip-m'));
    await pg.waitForSelector('#cut-candidates li.clip-row:not([data-id="own"])', { timeout: 20000 });
    assert.strictEqual(await pg.textContent('#cut-own-wins'), 'Your own clip is what moves on. Untick it to use the clips below instead.');
    assert.ok(/^1 clip kept, \d+ s\. It moves on to the next steps as one reel\.$/.test(await pg.textContent('#cut-kept')), await pg.textContent('#cut-kept'));
    await pg.click('#cut-layer-lines'); await pg.waitForSelector('#pieces-grid');
    await pg.setViewportSize({ width: 390, height: 844 }); await open(pg, '#step=cut'); await pg.waitForSelector('#pieces-grid');
    const over = await pg.evaluate(() => [...document.querySelectorAll('#s-cut *')].map(e => e.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), 0) - innerWidth); assert.ok(over <= 1, 'no sideways scroll: ' + over);
    await shot(pg, '#pieces', 'redesign-cut-pieces-phone-dark.png');
    await theme(pg, 'light'); await shot(pg, '#pieces', 'redesign-cut-pieces-phone-light.png'); await theme(pg, 'dark');
    assert.deepStrictEqual(errs, []);
  });
} finally {
  try { await client?.close(); } catch {}
  await browser.close(); srv.kill(); cleanJobs();
  rmSync(STATE, { recursive: true, force: true });
}
console.log(`\n${n} studio pieces e2e tests passed`);
process.exit(0);
