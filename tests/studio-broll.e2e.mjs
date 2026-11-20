// The B-roll step and API keys in a real Chrome, on synthetic media only, with mock Pexels and Higgsfield servers
// (no real keys, no network):
// - the lane: beats from a draft (tests/fixtures/fake-reel.mjs), upload onto a beat, full cutaway, split top panel and
//   picture in picture, timing, clear
// - API keys and providers: save a key (the page never shows it again), Test key, sources turn on, Allow generating
// - stock: search the mock Pexels, credit and link shown, Use puts it on the beat
// - Make: a counter card rendered with headless Chrome
// - ideas: the agent's idea waits for Approve
// - Generate: Estimate shows the cost, Generate runs against the mock and lands on the beat
// - Record screen: getDisplayMedia with the webcam bubble, when this Chrome allows it
// - render: the lane goes into cut.json with placements and credits.txt is written
// - kit/assemble.cjs places full, top and pip inserts (pixel colours on a synthetic clip)
// Needs Chrome and ffmpeg. Run: node tests/studio-broll.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import http from 'http';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-broll-e2e-')), LIB = join(STATE, 'lib'), JOB = 'broll-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });

const IMG = join(ROOT, 'showcase', 'source', 'presenter.jpg'), TAKE = join(STATE, 'take.mp4'), DESK = join(STATE, 'desk.mp4'), STOCK = join(STATE, 'stock.mp4'), THUMB = join(STATE, 'stock.jpg');
ff(['-loop', '1', '-framerate', '12', '-i', IMG, '-f', 'lavfi', '-i', 'sine=f=220:d=12', '-t', '12', '-vf', 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', TAKE]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=540x960:d=4:r=24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', DESK]);
ff(['-f', 'lavfi', '-i', 'smptebars=s=540x960:d=5:r=24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', STOCK]);
ff(['-f', 'lavfi', '-i', 'smptebars=s=270x480', '-frames:v', '1', THUMB]);
const PEX = 'pexels-e2e-key-0042', HFID = 'hf-e2e-id', HFSEC = 'hf-e2e-secret-77';
let mockUrl = '', polls = 0;
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), j = (c, o) => { res.writeHead(c, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/stock.mp4' || u.pathname === '/gen.mp4') { const b = readFileSync(STOCK); res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': b.length, 'access-control-allow-origin': '*' }); return res.end(b); }
  if (u.pathname === '/stock.jpg') { const b = readFileSync(THUMB); res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(b); }
  if (u.pathname === '/v1/videos/search') {
    if (req.headers.authorization !== PEX) return j(401, { error: 'bad key' });
    return j(200, { videos: [1, 2, 3].map(i => ({ id: 500 + i, width: 1080, height: 1920, duration: 5 + i, url: `https://www.pexels.com/video/sales-dashboard-${500 + i}/`, image: `${mockUrl}/stock.jpg`, user: { name: ['Ana Lens', 'Bo Frames', 'Cy Reel'][i - 1], url: 'https://www.pexels.com/@x' }, video_files: [{ link: `${mockUrl}/stock.mp4`, width: 1080, height: 1920, quality: 'hd', file_type: 'video/mp4' }] })) });
  }
  if (req.headers.authorization && req.headers.authorization.startsWith('Key ')) {
    if (req.headers.authorization !== `Key ${HFID}:${HFSEC}`) return j(401, { detail: 'Invalid credentials' });
    if (u.pathname.startsWith('/estimate/')) return j(200, { usd: 0.42 });
    if (u.pathname.startsWith('/requests/')) return j(200, ++polls < 2 ? { status: 'in_progress' } : { status: 'completed', video: { url: `${mockUrl}/gen.mp4` } });
    return j(200, { status: 'queued', request_id: 'e2e', status_url: `${mockUrl}/requests/e2e/status` });
  }
  res.writeHead(404); res.end();
});
await new Promise(r => mock.listen(0, '127.0.0.1', r)); mockUrl = `http://127.0.0.1:${mock.address().port}`;

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: LIB, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', HF_API_KEY_ID: '', HF_API_KEY_SECRET: '',
  STUDIO_REEL: 'tests/fixtures/fake-reel.mjs', STUDIO_API_BASE_PEXELS: mockUrl, STUDIO_API_BASE_HIGGSFIELD: mockUrl };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let out = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const upload = async (kind, f, name) => (await fetch(`${url}/api/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: readFileSync(f) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const waitTask = async (ms = 120e3) => { await wait(400); return until(async () => { const v = await api('/api/state'); return v.task && v.task.status !== 'running' ? v : null; }, ms); };
const shot = async (page, sel, name) => {
  if (!shots) return;
  await page.evaluate(q => { const e = document.querySelector(q); e.scrollIntoView({ block: 'start' }); const h = document.querySelector('header.top'); if (!e.closest('[role=dialog]')) scrollBy(0, -((h ? h.offsetHeight : 0) + 12)); }, sel);
  await page.waitForTimeout(350);
  const b = await page.locator(sel).first().boundingBox(), vp = page.viewportSize(), top = Math.max(0, b.y);
  await page.screenshot({ path: join(shots, name), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, top - 8), width: Math.min(vp.width - Math.max(0, b.x - 8), b.width + 16), height: Math.min(vp.height - top, b.height + 16) } });
};
const beatOf = async n => (await api('/api/broll')).beats[n - 1];

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing'] });
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  assert.ok((await upload('footage', TAKE, 'take.mp4')).path);
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera', 'microphone'] });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|getDisplayMedia|NotAllowed|NotSupported/.test(m.text())) errs.push(m.text()); });

  await t('before a draft the step says where the beats come from', async () => {
    await pg.goto(url + '/#step=broll', { waitUntil: 'networkidle' });
    await pg.waitForSelector('#broll-empty'); assert.ok(/from a draft/.test(await pg.textContent('#broll-empty')));
    assert.strictEqual(await pg.textContent('#stepper button[data-step="broll"] .sl'), 'B-roll');
  });
  await t('the lane: three beats after the draft; upload onto beat 2; placements and timing; clear', async () => {
    const d = await api('/api/draft', {}); assert.ok(!d.error, d.error); const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task));
    await pg.waitForSelector('#broll-lane .beat[data-beat="3"]');
    await pg.click('#broll-lane .beat[data-beat="2"]'); await pg.click('#btab-upload');
    await pg.setInputFiles('#broll-file', DESK);
    await pg.waitForSelector('#broll-lane .beat[data-beat="2"].filled', { timeout: 20000 });
    assert.strictEqual((await beatOf(2)).slot.place, 'full');
    await pg.click('#place-top'); await until(async () => (await beatOf(2)).slot.place === 'top');
    await pg.click('#place-pip'); await until(async () => (await beatOf(2)).slot.place === 'pip');
    await pg.fill('#slot-dur', '1.5'); await pg.press('#slot-dur', 'Tab'); await until(async () => (await beatOf(2)).slot.dur === 1.5);
    await pg.click('#place-top'); await until(async () => (await beatOf(2)).slot.place === 'top');
    await shot(pg, '#s-broll', 'broll-lane.png');
    await pg.click('#broll-lane .beat[data-beat="1"]'); await pg.click('#btab-library'); await pg.waitForSelector('#bp-library .bthumb');
    await pg.click('#bp-library .bthumb'); await until(async () => (await beatOf(1)).slot);
    await pg.click('#slot-clear'); await until(async () => !(await beatOf(1)).slot);
  });
  await t('API keys and providers: save a key (never shown again), Test key works, the Pexels source turns on', async () => {
    await pg.click('#broll-lane .beat[data-beat="3"]'); await pg.click('#btab-stock');
    await pg.waitForSelector('#stock-keys'); await pg.click('#stock-keys');
    await pg.waitForSelector('#keys .key-row[data-id="pexels"]');
    assert.ok(/Not set/.test(await pg.textContent('#key-status-pexels')));
    await pg.fill('#key-in-pexels', PEX); await pg.click('#key-save-pexels');
    await pg.waitForFunction(() => /Saved on this computer/.test(document.querySelector('#key-status-pexels').textContent));
    assert.strictEqual(await pg.inputValue('#key-in-pexels'), ''); assert.ok(!(await pg.content()).includes(PEX), 'the key is not in the page');
    await pg.click('#key-test-pexels'); await pg.waitForFunction(() => /Works/.test(document.querySelector('#key-status-pexels').textContent));
    assert.ok(/accepted the key/.test(await pg.textContent('#key-res-pexels')));
    assert.ok(await pg.$('#broll-sources li[data-id="pexels"].on'));
    await shot(pg, '#keys .sheet-b', 'broll-keys.png');
    const st = await (await fetch(url + '/api/state')).text(); assert.ok(!st.includes(PEX));
    await pg.keyboard.press('Escape'); await pg.waitForSelector('#keys', { state: 'hidden' }).catch(() => {});
  });
  await t('stock: search the mock Pexels, credit and link shown, Use puts it on beat 3', async () => {
    await pg.click('#btab-library'); await pg.click('#btab-stock');
    await pg.waitForSelector('#stock-q'); await pg.fill('#stock-q', 'sales dashboard'); await pg.click('#stock-go');
    await pg.waitForSelector('#bp-stock .bthumb.stock'); assert.strictEqual(await pg.$$eval('#bp-stock .bthumb.stock', x => x.length), 3);
    assert.ok(/Ana Lens/.test(await pg.textContent('#bp-stock'))); assert.strictEqual(await pg.getAttribute('#bp-stock .attrib a', 'href'), 'https://www.pexels.com');
    await shot(pg, '#beat-panel', 'broll-stock.png');
    await pg.click('#bp-stock .bthumb.stock >> nth=0 >> button');
    await until(async () => { const b = await beatOf(3); return b.slot && b.slot.clip.source === 'pexels'; });
  });
  await t('Make: a counter card rendered here lands on beat 1', async () => {
    await pg.click('#broll-lane .beat[data-beat="1"]'); await pg.click('#btab-make');
    await pg.click('#mk-kind-counter'); await pg.fill('#mk-to', '1200'); await pg.fill('#mk-prefix', '$'); await pg.fill('#mk-label', 'saved a month');
    await pg.click('#mk-go'); await until(async () => { const b = await beatOf(1); return b.slot && b.slot.clip.source === 'agent'; }, 60000);
  });
  await t('ideas: the agent suggests, the beat shows it, Approve places it', async () => {
    await api('/api/broll/slot', { beat: 1, clear: true });
    const lib = (await api('/api/broll/library?q=counter')).clips; assert.ok(lib.length);
    await api('/api/broll/ideas', { by: 'claude-code', ideas: [{ beat: 1, idea: 'The $1,200 counter card', clip: lib[0].id, place: 'full' }] });
    await pg.waitForSelector('#broll-lane .beat[data-beat="1"].has-idea:not(.filled)'); // the live update reached the page
    await pg.click('#broll-lane .beat[data-beat="1"]'); await pg.waitForSelector('#beat-idea');
    assert.ok(/Claude Code/.test(await pg.textContent('#beat-idea')));
    await shot(pg, '#beat-panel', 'broll-idea.png');
    await pg.click('#idea-approve'); await until(async () => (await beatOf(1)).slot);
  });
  await t('Generate: off until allowed; Estimate shows the cost; Generate runs against the mock Higgsfield and lands on the beat', async () => {
    await api('/api/broll/slot', { beat: 1, clear: true });
    await pg.click('#broll-lane .beat[data-beat="1"]'); await pg.click('#btab-generate'); await pg.waitForSelector('#gen-keys');
    await pg.click('#gen-keys'); await pg.waitForSelector('#keys .key-row[data-id="higgsfield"]');
    await pg.fill('#key-in-higgsfield', HFID); await pg.fill('#key-in2-higgsfield', HFSEC); await pg.click('#key-save-higgsfield');
    await pg.waitForFunction(() => /Saved on this computer/.test(document.querySelector('#key-status-higgsfield').textContent));
    await pg.click('#allow-generate'); await pg.click('#save-broll-settings'); await until(async () => (await api('/api/broll')).generate.on);
    assert.ok(!(await pg.content()).includes(HFSEC));
    await pg.keyboard.press('Escape'); await wait(300);
    await pg.click('#btab-library'); await pg.click('#btab-generate');
    await pg.waitForSelector('#gen-prompt'); await pg.fill('#gen-prompt', 'A slow push in on a laptop showing a sales dashboard');
    await pg.click('#gen-est'); await pg.waitForSelector('#gen-confirm'); assert.strictEqual(await pg.textContent('#gen-cost'), '$0.42');
    await shot(pg, '#beat-panel', 'broll-generate.png');
    await pg.click('#gen-go'); await until(async () => { const b = await beatOf(1); return b.slot && b.slot.clip.source === 'generate'; }, 30000);
  });
  await t('a late reply never puts an older lane back over a newer live update (the ideas race)', async () => {
    // hold the page's own answer until an agent's idea has landed by the live update, then let it through: the page must
    // keep the idea (it used to merge the older answer over it and the idea vanished until the next change)
    let release; const gate = new Promise(r => { release = r; });
    await pg.route('**/api/broll/slot', async r => { const res = await r.fetch(); const body = await res.body(); await gate; await r.fulfill({ response: res, body }); });
    await pg.click('#broll-lane .beat[data-beat="2"]'); await pg.waitForSelector('#place-full');
    const answered = pg.waitForResponse(r => r.url().endsWith('/api/broll/slot'));
    await pg.click('#place-full'); await until(async () => (await beatOf(2)).slot.place === 'full');
    const lib = (await api('/api/broll/library?q=counter')).clips;
    await api('/api/broll/ideas', { by: 'claude-code', ideas: [{ beat: 3, idea: 'A late reply check', clip: lib[0].id, place: 'pip' }] });
    await pg.waitForSelector('#broll-lane .beat[data-beat="3"].has-idea');
    release(); await answered; await pg.unroute('**/api/broll/slot');
    await pg.evaluate(() => new Promise(r => { let k = 0; const f = () => (++k < 4 ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }));
    await pg.waitForFunction(() => document.querySelector('#broll-lane .beat[data-beat="3"]').classList.contains('has-idea') && document.querySelector('#place-full').getAttribute('aria-checked') === 'true', null, { timeout: 5000 });
    await api('/api/broll/idea', { beat: 3, action: 'dismiss' }); await api('/api/broll/slot', { beat: 2, place: 'top' });
    await until(async () => !(await beatOf(3)).idea && (await beatOf(2)).slot.place === 'top');
  });
  await t('Record screen with the webcam bubble (when this Chrome can share a screen)', async () => {
    await pg.click('#broll-lane .beat[data-beat="2"]'); await pg.click('#btab-record'); await pg.waitForSelector('#rec-screen');
    const can = await pg.evaluate(async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); s.getTracks().forEach(t => t.stop()); return true; } catch (e) { return e.name; } });
    if (can !== true) { console.log(`  (skipped: this Chrome refused getDisplayMedia: ${can})`); return; }
    const before = (await beatOf(2)).slot.clip.id;
    await pg.click('#rec-screen'); await pg.waitForSelector('#rec-stop', { timeout: 10000 }); await wait(2200); await pg.click('#rec-stop');
    await until(async () => { const b = await beatOf(2); return b.slot && b.slot.clip.id !== before && b.slot.clip.source === 'screen'; }, 30000);
  });
  await t('render: the lane goes into cut.json with placements, and credits.txt is written next to the reel', async () => {
    const r = await api('/api/render', {}); assert.ok(!r.error, r.error); const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task && v.task.lines.slice(-5)));
    const cut = JSON.parse(readFileSync(join(ROOT, 'jobs', JOB, 'build', 'cut.json'), 'utf8'));
    const places = cut.inserts.map(x => x.place).sort(); assert.ok(places.includes('top') && places.includes('full'), JSON.stringify(cut.inserts));
    assert.ok(cut.inserts.every(x => existsSync(join(ROOT, 'jobs', JOB, 'build', x.file))), 'paths resolve from build/');
    const cr = readFileSync(join(ROOT, 'jobs', JOB, 'credits.txt'), 'utf8'); assert.ok(/Ana Lens/.test(cr) && /Videos provided by Pexels/.test(cr) && /generated with Higgsfield/.test(cr), cr);
  });
  await t('Settings links to API keys and providers; the phone layout fits', async () => {
    await pg.click('#open-settings'); await pg.waitForSelector('#settings-keys'); assert.ok(/Pexels/.test(await pg.textContent('#keys-summary')));
    await pg.keyboard.press('Escape'); await wait(300);
    await pg.setViewportSize({ width: 390, height: 844 }); await pg.goto(url + '/#step=broll', { waitUntil: 'networkidle' }); await pg.waitForSelector('#broll-lane');
    // the step itself fits (the top bar's own pills depend on what this computer has installed)
    const over = await pg.evaluate(() => [...document.querySelectorAll('#s-broll *')].filter(e => !e.closest('#broll-lane')).map(e => e.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), 0) - innerWidth); assert.ok(over <= 1, 'no sideways scroll: ' + over);
    await shot(pg, '#s-broll', 'broll-phone.png');
  });
  await t('assemble: full, top and pip inserts land where they should (synthetic colours)', async () => {
    const b = join(STATE, 'asm', 'build'); mkdirSync(b, { recursive: true });
    ff(['-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920:r=24:d=6', '-f', 'lavfi', '-i', 'sine=f=300:d=6', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(b, 'base.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=red:s=1280x720:r=24:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(b, 'red.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=green:s=1280x720:r=24:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(b, 'green.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=yellow:s=640x480', '-frames:v', '1', join(b, 'y.png')]);
    writeFileSync(join(b, 'cut.json'), JSON.stringify({ segs: [{ file: 'base.mp4', in: 0, out: 6 }], tail: 0, inserts: [{ file: 'red.mp4', at: 0.5, dur: 1 }, { file: 'green.mp4', at: 2, dur: 1, place: 'top' }, { file: 'y.png', at: 3.5, dur: 1, place: 'pip' }] }));
    execFileSync(process.execPath, [join(ROOT, 'kit', 'assemble.cjs'), 'out.mp4'], { cwd: b, env: { ...process.env, NOBED: '1', NOSFX: '1' }, stdio: 'pipe' });
    const px = (tm, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(tm), '-i', join(b, 'out.mp4'), '-frames:v', '1', '-vf', `format=rgb24,crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])].slice(0, 3);
    const is = (p, c) => ({ r: p[0] > 180 && p[1] < 80 && p[2] < 80, g: p[1] > 90 && p[0] < 80 && p[2] < 80, b: p[2] > 120 && p[0] < 60 && p[1] < 60, y: p[0] > 180 && p[1] > 180 && p[2] < 80 })[c];
    assert.ok(is(px(1, 540, 1500), 'r'), 'full cutaway covers the frame');
    assert.ok(is(px(2.5, 540, 300), 'g') && is(px(2.5, 540, 1500), 'b'), 'split: insert on top, speaker below');
    assert.ok(is(px(4, 820, 300), 'y') && is(px(4, 100, 100), 'b') && is(px(4, 540, 1500), 'b'), 'pip: a box top right');
    assert.ok(is(px(5.5, 540, 300), 'b'), 'gone after');
  });
  assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join(' | '));
} finally {
  await browser.close(); srv.kill(); mock.close();
  rmSync(STATE, { recursive: true, force: true });
  for (const d of [join('jobs', JOB), join('inbox', 'studio', JOB)]) rmSync(join(ROOT, d), { recursive: true, force: true });
}
console.log(`\n${n} studio b-roll e2e tests passed`);
process.exit(0);
