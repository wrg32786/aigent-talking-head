// The Studio Cut step in a real Chrome, on synthetic media only (the presenter still with a tone, tests/fixtures):
// - the footage player: click a clip to play, J K L and the arrow keys, the transcript (a stand-in transcriber,
//   tests/fixtures/fake-tx.mjs) highlights along and a word click seeks; an .mkv plays from a 540p preview copy
// - the Cut step: smart defaults and the summary, the picker cards, Find cuts, candidates on the timeline, trim by
//   dragging an edge, drop one, add one by dragging on a lane
// - batch render: kept cuts become their own videos (a stand-in for the engine, tests/fixtures/fake-reel.mjs, with the
//   real extract), a long form one through the real 16:9 pass (1920x1080), an ad one with the CTA end card
// - Reference: Pull script puts the reference's words in Scripts with [hook], [body] and [cta]
// Needs Chrome and ffmpeg. Run: node tests/studio-cut.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-cut-e2e-')), JOB = 'cut-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', f], { encoding: 'utf8' }));

// a 112 s take: the presenter still, a tone that swells and dips like speech, 540x960 so it encodes fast
const IMG = join(ROOT, 'showcase', 'source', 'presenter.jpg'), TAKE = join(STATE, 'long-take.mp4'), MKV = join(STATE, 'screen.mkv'), REF = join(STATE, 'ref.mp4');
const tone = s => `aevalsrc='0.5*sin(2*PI*220*t)*(0.35+0.65*abs(sin(2*PI*0.37*t))*gt(sin(2*PI*0.09*t),-0.6))':s=48000:d=${s}`;
ff(['-loop', '1', '-framerate', '12', '-i', IMG, '-f', 'lavfi', '-i', tone(112), '-t', '112', '-vf', 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-c:a', 'aac', '-shortest', TAKE]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=4:r=24', '-f', 'lavfi', '-i', 'sine=d=4', '-c:v', 'mpeg4', '-c:a', 'aac', MKV]);
ff(['-loop', '1', '-framerate', '12', '-i', IMG, '-f', 'lavfi', '-i', tone(20), '-t', '20', '-vf', 'scale=360:640,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', REF]);

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '300', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const upload = async (kind, f, name) => (await fetch(`${url}/api/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: readFileSync(f) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const waitTask = async (ms = 5 * 60e3) => { await wait(400); return until(async () => { const v = await api('/api/state'); return v.task && v.task.status !== 'running' ? v : null; }, ms); };
const shot = async (page, sel, name) => {
  await page.evaluate(q => { const e = document.querySelector(q); e.scrollIntoView({ block: 'start' }); scrollBy(0, -(document.querySelector('header.top').offsetHeight + 12)); }, sel);
  await page.waitForTimeout(300);
  const b = await page.locator(sel).boundingBox(), vp = page.viewportSize(), top = Math.max(0, b.y);
  await page.screenshot({ path: join(shots, name), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, top - 8), width: Math.min(vp.width, b.width + 16), height: Math.min(vp.height - top - 64, b.height + 16) } });
};
const subs = () => readdirSync(join(ROOT, 'jobs')).filter(d => d.startsWith(JOB + '-'));

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  const take = (await upload('footage', TAKE, 'long take.mp4')).path, mkv = (await upload('footage', MKV, 'screen.mkv')).path;
  assert.ok(take && mkv, 'uploaded');
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await t('footage player: click a clip to play; J K L and arrows; the transcript follows and a word click seeks', async () => {
    await pg.goto(url + '/#step=footage', { waitUntil: 'networkidle' });
    await pg.click(`.clip-play[aria-label="Play long-take.mp4"]`);
    await pg.waitForSelector('#player #player-video');
    await pg.waitForFunction(() => document.querySelector('#player-time').textContent.endsWith('1:52'), null, { timeout: 10000 });
    await pg.click('#player-play');
    await pg.waitForFunction(() => document.querySelector('#player-video').currentTime > 0.6, null, { timeout: 8000 });
    await pg.click('#player-time'); await pg.keyboard.press('k');
    const t0 = await pg.$eval('#player-video', v => v.currentTime);
    await pg.keyboard.press('l'); await pg.waitForTimeout(150);
    const t1 = await pg.$eval('#player-video', v => v.currentTime); assert.ok(Math.abs(t1 - t0 - 5) < 0.4, `${t0} -> ${t1}`);
    await pg.keyboard.press('ArrowLeft'); await pg.waitForTimeout(150);
    assert.ok(Math.abs(await pg.$eval('#player-video', v => v.currentTime) - (t1 - 1)) < 0.4);
    // the waveform came from ffmpeg
    const pk = await api('/api/footage/peaks?path=' + encodeURIComponent(take)); assert.ok(pk.peaks.length === 1200 && Math.max(...pk.peaks) > 0.9 && Math.min(...pk.peaks) < 0.5, 'waveform ' + Math.min(...pk.peaks));
    await pg.click('#player-tx');
    await pg.waitForSelector('#player-transcript .tx-run', { timeout: 5000 });
    await pg.waitForSelector('#player-transcript .w', { timeout: 20000 });
    const w = await pg.$$('#player-transcript .w'); const target = w[60], at = +(await target.getAttribute('data-a'));
    await target.click(); await pg.waitForTimeout(200);
    assert.ok(Math.abs(await pg.$eval('#player-video', v => v.currentTime) - at) < 0.3, 'word click seeks');
    assert.ok(await pg.$eval('#player-transcript .w.now', e => e.dataset.a) === String(at), 'the word lights up');
    if (shots) await shot(pg, '#player', 'player-desktop.png');
  });
  await t('an .mkv plays from a 540p preview copy', async () => {
    const i = await until(async () => { const j = await api('/api/footage/info?path=' + encodeURIComponent(mkv)); return j.proxy && j.proxy.status === 'ready' ? j : null; }, 60000);
    const p = probe(join(STATE, 'media', readdirSync(join(STATE, 'media')).find(f => f.endsWith('.proxy.mp4')))); assert.strictEqual(p.streams.find(s => s.codec_type === 'video').height, 360, 'the short side, never upscaled');
    await pg.click(`.clip-play[aria-label="Play screen.mkv"]`);
    await pg.waitForFunction(u => document.querySelector('#player-video').currentSrc.includes(u), i.proxy.url, { timeout: 8000 });
    await pg.click(`.clip-play[aria-label="Play screen.mkv"]`); await pg.waitForFunction(() => !document.querySelector('#player'));
  });
  await t('Cut step: smart defaults and the summary; the cards change it; Find cuts fills the list and the timeline', async () => {
    await pg.goto(url + '/#step=cut', { waitUntil: 'networkidle' });
    await pg.waitForSelector('#cut-summary');
    assert.strictEqual(await pg.textContent('#cut-summary'), 'Full edit: 1 short video (~75 s), for organic');
    assert.strictEqual(await pg.$eval('#fmt-short', e => e.getAttribute('aria-checked')), 'true');
    await pg.click('#out-both'); await pg.waitForFunction(() => /^Both: 1 full edit \(~75 s\) \+ 5 short clips, for organic$/.test(document.querySelector('#cut-summary').textContent));
    await pg.click('#clip-count + button'); await pg.click('#len-short'); await pg.click('#len-medium');
    await pg.waitForFunction(() => /\+ 3 short clips/.test(document.querySelector('#cut-summary').textContent) || /\+ 6 short clips/.test(document.querySelector('#cut-summary').textContent));
    await api('/api/cut/output', { clips: 3, clipLength: 'short' });
    await pg.click('#cut-find');
    await pg.waitForSelector('#cut-candidates li', { timeout: 20000 });
    const ids = await pg.$$eval('#cut-candidates li', x => x.map(e => e.dataset.id)); assert.deepStrictEqual(ids.slice(0, 1), ['full']); assert.strictEqual(ids.length, 4, ids.join());
    assert.ok(/Scored by the rules/.test(await pg.textContent('#cut-scored')));
    assert.strictEqual(await pg.$$eval('#cut-timeline .lane.k-clip .region', x => x.length), 3);
    assert.ok(await pg.$$eval('#cut-timeline .mk.filler', x => x.length) > 0, 'filler marks');
    if (shots) { await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, 'cut-desktop.png') }); }
  });
  await t('timeline: drag an edge to trim, drop one, drag on a lane to add your own, preview plays the region', async () => {
    const before = (await api('/api/cut')).candidates.find(x => x.id === 'c1');
    await pg.evaluate(() => document.querySelector('#cut-timeline').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(300);
    const edge = await pg.locator('#cut-timeline .region[data-region="c1"] .edge.b').boundingBox();
    await pg.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await pg.mouse.down();
    await pg.mouse.move(edge.x - 30, edge.y + edge.height / 2, { steps: 6 }); await pg.mouse.up();
    const after = await until(async () => { const c = (await api('/api/cut')).candidates.find(x => x.id === 'c1'); return c.trimmed ? c : null; });
    assert.ok(after.ranges[0][1] < before.ranges[0][1] - 1, `${before.ranges[0][1]} -> ${after.ranges[0][1]}`);
    await pg.click('#cut-candidates li[data-id="c3"] .keep');
    await until(async () => (await api('/api/cut')).candidates.find(x => x.id === 'c3').keep === false);
    // drag across an empty part of the clip lane (the last 15 s of the take)
    const lane = await pg.locator('#cut-timeline .lane.k-clip .lane-track').boundingBox(), cs = (await api('/api/cut')).candidates.filter(x => x.kind === 'clip');
    let from = 95, to = 108; for (const c of cs) if (c.ranges.some(([a, b]) => b > from && a < to)) { from = 2; to = 14; }
    const X = s => lane.x + (s / 112) * lane.width;
    await pg.mouse.move(X(from), lane.y + lane.height / 2); await pg.mouse.down(); await pg.mouse.move(X(to), lane.y + lane.height / 2, { steps: 8 }); await pg.mouse.up();
    const mine = await until(async () => (await api('/api/cut')).candidates.find(x => x.id === 'm1'));
    assert.ok(Math.abs(mine.ranges[0][0] - from) < 1.5 && Math.abs(mine.ranges[0][1] - to) < 1.5, JSON.stringify(mine.ranges));
    await pg.click('#cut-candidates li[data-id="m1"] button[aria-label^="Preview"]');
    await pg.waitForFunction(f => { const v = document.querySelector('#player-video'); return !v.paused && v.currentTime >= f - 0.2; }, mine.ranges[0][0], { timeout: 8000 });
    await pg.click('#cut-candidates li[data-id="m1"] button[aria-label^="Remove"]');
    await until(async () => !(await api('/api/cut')).candidates.some(x => x.id === 'm1'));
    if (shots) await shot(pg, '#cut-timeline', 'cut-timeline.png');
  });
  await t('batch render: every kept cut becomes its own video; the Render step lists them', async () => {
    await pg.click('#cut-render');
    const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800));
    const c = (await api('/api/cut')).candidates, kept = c.filter(x => x.keep);
    assert.strictEqual(kept.length, 3); for (const k of kept) assert.ok(k.outputs.length === 1 && existsSync(join(ROOT, k.outputs[0])), k.id);
    const c1 = probe(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'c1.mp4')), want = c.find(x => x.id === 'c1').seconds;
    assert.ok(Math.abs(+c1.format.duration - want) < 0.6, `extract ${c1.format.duration} vs ${want}`);
    assert.ok(!existsSync(join(ROOT, 'jobs', `${JOB}-c3`)), 'the dropped one is not rendered');
    const log = readFileSync(join(ROOT, 'jobs', `${JOB}-c1`, 'fake-reel.log'), 'utf8'); assert.ok(/--export shorts/.test(log) && !/--draft/.test(log), log);
    await pg.goto(url + '/#step=render', { waitUntil: 'networkidle' });
    await pg.waitForSelector('#cut-outputs figure');
    assert.strictEqual(await pg.$$eval('#cut-outputs figure', x => x.length), 3);
  });
  await t('long form: a clip through the real 16:9 pass is 1920x1080; an ad gets the CTA end card and tighter cuts', async () => {
    await api('/api/cut/output', { format: 'long', kind: 'clips', clips: 1, seconds: 20, goal: 'organic' });
    await api('/api/cut/find', { path: take, scorer: 'rules' });
    const c = await until(async () => { const v = await api('/api/cut'); return v.candidates.length === 1 && v.candidates[0].kind === 'clip' ? v : null; });
    const r = await api('/api/cut/render', {}); assert.deepStrictEqual(r.plan.map(x => x.aspect), ['16:9']);
    let v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800));
    const out = (await api('/api/cut')).candidates[0].outputs[0], p = probe(join(ROOT, out)), vs = p.streams.find(s => s.codec_type === 'video');
    assert.deepStrictEqual([vs.width, vs.height], [1920, 1080]); assert.ok(Math.abs(+p.format.duration - c.candidates[0].seconds) < 0.8);
    await api('/api/cut/output', { format: 'short', kind: 'clips', clips: 1, seconds: null, length: 'short', goal: 'ad', cta: 'Get the free guide' });
    await api('/api/cut/find', { path: take, scorer: 'rules' });
    await until(async () => { const x = await api('/api/cut'); return x.candidates.length === 1 && x.output.goal === 'ad' ? x : null; });
    const ra = await api('/api/cut/render', {}); v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800));
    const sub = ra.plan[0].job, caps = readFileSync(join(ROOT, 'jobs', sub, 'build', 'captions.js'), 'utf8'), log = readFileSync(join(ROOT, 'jobs', sub, 'fake-reel.log'), 'utf8');
    const cj = {}; new Function('window', caps)(cj); assert.ok(cj.CAPTIONS.flips.some(f => f.mode === 22 && f.text === 'Get the free guide' && f.end - f.start > 2.5), caps); assert.ok(/--draft/.test(log) && /--tighten 0.25/.test(log) && /--rebuild/.test(log) && /--export shorts/.test(log), log);
  });
  await t('Reference: Pull script transcribes the reference and puts its words in Scripts', async () => {
    await upload('reference', REF, 'ref.mp4');
    await pg.goto(url + '/#step=reference', { waitUntil: 'networkidle' });
    await pg.click('#pull-script-btn');
    await pg.waitForFunction(() => /In Scripts:/.test(document.querySelector('#pull-script').textContent), null, { timeout: 20000 });
    const sc = (await api('/api/state')).scripts.find(x => x.by === 'reference transcript');
    const text = (await api('/api/scripts/get?id=' + sc.id)).script.text; assert.ok(/^\[hook\]/.test(text) && /\[body\]/.test(text) && /\[cta\]/.test(text), text.slice(0, 300));
    assert.ok(await pg.$('#adapt-topic'), 'the adapt box shows');
    if (shots) { await pg.fill('#adapt-topic', 'meal prep for busy parents'); await shot(pg, '#pull-script', 'pull-script.png'); }
  });
  assert.deepStrictEqual(errs.filter(e => !/favicon/.test(e)), []);
  await pg.close();
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  for (const d of [join('inbox', 'studio', JOB), join('teardown-in', 'studio', JOB), join('jobs', JOB)]) rmSync(join(ROOT, d), { recursive: true, force: true });
  try { for (const d of subs()) rmSync(join(ROOT, 'jobs', d), { recursive: true, force: true }); } catch {}
}
console.log(`\n${n} studio cut browser tests passed`);
process.exit(0);
