// The Studio Cut step in a real Chrome, on synthetic media only (the presenter still with a tone, tests/fixtures):
// - the footage player on Start: click a clip to play, J K L and the arrow keys, the transcript (a stand-in transcriber,
//   tests/fixtures/fake-tx.mjs) highlights along and a word click seeks; an .mkv plays from a 540p preview copy
// - the Cut step, on its Clips layer: smart defaults and the summary, the picker cards behind Change, the clips find
//   themselves, Find clips again, the timeline behind Trim on the timeline: trim by dragging an edge, untick one, add
//   one by dragging on a lane (tests/studio-cut-layers.e2e.mjs covers the three layers, the point and Pacing)
// - batch render on Render: kept cuts become their own videos (a stand-in for the engine, tests/fixtures/fake-reel.mjs, with the
//   real extract), a long form one through the real 16:9 pass (1920x1080), an ad one with the CTA end card
// - Picture, the reference view: Pull script puts the reference's words in Scripts with [hook], [body] and [cta]
// - cut points on the audio: a synthetic clip with tone "words" at known times, a breath and room tone, and a transcript
//   that is off on purpose; every cut lands in the real gap, and the timeline shows where and why
// - clips made from lines (the server still calls them bites): each one is a row on Clips, Play runs its lines in its
//   order, Render saves it as one file, the clean take leaves out a retake, the agent's ones are labelled;
//   footage order on Start by drag and arrows, remove in place
// Needs Chrome and ffmpeg. Run: node tests/studio-cut.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

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

// the synthetic speech clip: tone bursts are the words (real times below), a soft noise breath at 2.70-2.95, room tone
const SYN = join(STATE, 'syn.mp4'), REAL = [[1.0, 1.6], [1.75, 2.4], [3.3, 4.0], [4.1, 4.8], [6.0, 6.7], [6.8, 7.5]];
const burst = REAL.map(([a, b]) => `between(t,${a},${b})`).join('+');
ff(['-f', 'lavfi', '-i', 'color=c=0x303840:s=360x640:r=12:d=9', '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*200*t)*(${burst})+0.25*(random(0)-0.5)*between(t,2.7,2.95)+0.006*(random(1)-0.5)':s=48000:d=9`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', SYN]);
// what the "transcriber" says: "two" ends 0.15 s early, "four" ends 0.3 s late (in the silence), "five" starts 0.3 s late
const TXW = join(STATE, 'words.json');
writeFileSync(TXW, JSON.stringify({ 'synthetic-speech': { duration: 9, words: [[1.0, 1.6, 'One'], [1.75, 2.25, 'two.'], [3.3, 4.0, 'Three'], [4.1, 5.1, 'four.'], [6.3, 6.7, 'Five'], [6.8, 7.5, 'six.']] } }));
const env = { ...process.env, FAKE_TX_WORDS: TXW, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '300', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
// Studio keeps a live connection, so the page never goes network idle: wait for the stepper, and for the step a link names
const STEP_OF = { reference: 'picture', post: 'render' };
const ready = async (pg, hash = '') => { await pg.waitForSelector('#areas'); const st = (hash.match(/step=([a-z]+)/) || [])[1]; if (st === 'reference') return pg.waitForSelector('main[data-area="teardowns"]'); if (st) await pg.waitForSelector(`#stepper [aria-current="step"][data-step="${STEP_OF[st] || st}"]`); };
const openFold = async (pg, sel) => { if (await pg.getAttribute(sel + ' > button', 'aria-expanded') !== 'true') await pg.click(sel + ' > button'); };
const open = async (pg, hash) => { await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await ready(pg, hash); };
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

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }));
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  const take = (await upload('footage', TAKE, 'long take.mp4')).path, mkv = (await upload('footage', MKV, 'screen.mkv')).path;
  assert.ok(take && mkv, 'uploaded');
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.addInitScript(() => { if (!localStorage.getItem('studio.cutLayer')) localStorage.setItem('studio.cutLayer', 'clips'); }); // this test is about the Clips layer (tests/studio-pieces.e2e.mjs covers Best lines)
  // the timeline sits in a closed fold on Clips, and it closes again on every load
  const openTrim = async () => { await pg.waitForSelector('#cut-trim'); if (!(await pg.$eval('#cut-trim', d => d.open))) await pg.click('#cut-trim > summary'); await pg.waitForSelector('#cut-timeline'); };
  const row = id => `#cut-candidates li.clip-row[data-id="${id}"]`;
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await t('footage player: click a clip to play; J K L and arrows; the transcript follows and a word click seeks', async () => {
    await open(pg, '#step=start');
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
  await t('Cut step: smart defaults and the summary; the cards behind Change change it; the clips find themselves, Find clips again fills the list and the timeline', async () => {
    await open(pg, '#step=cut');
    await pg.waitForSelector('#cut-summary');
    assert.strictEqual(await pg.textContent('#cut-summary'), 'Full edit: 1 short video (~75 s), for organic');
    assert.strictEqual(await pg.getAttribute('#cut-layer-clips', 'aria-selected'), 'true', 'this test works on Clips');
    // the words are read (the test above), so Clips finds our suggestions by itself, by the rules
    await pg.waitForSelector(row('full'), { timeout: 20000 });
    assert.strictEqual((await api('/api/cut')).scoredBy, 'rules');
    assert.strictEqual(await pg.textContent('#cut-find'), 'Find clips again');
    assert.strictEqual(await pg.$('#fmt-short'), null, 'What to make is folded until you ask');
    await pg.click('#cut-change'); await pg.waitForSelector('#fmt-short');
    assert.strictEqual(await pg.$eval('#fmt-short', e => e.getAttribute('aria-checked')), 'true');
    await pg.click('#out-both'); await pg.waitForFunction(() => /^Both: 1 full edit \(~75 s\) \+ 5 short clips, for organic$/.test(document.querySelector('#cut-summary').textContent));
    await pg.click('#clip-count + button'); await pg.click('#len-short'); await pg.click('#len-medium');
    await pg.waitForFunction(() => /\+ 3 short clips/.test(document.querySelector('#cut-summary').textContent) || /\+ 6 short clips/.test(document.querySelector('#cut-summary').textContent));
    await api('/api/cut/output', { clips: 3, clipLength: 'short' });
    await pg.click('#cut-change'); await pg.waitForSelector('#fmt-short', { state: 'detached' });
    await pg.click('#cut-find');
    await pg.waitForSelector(row('c3'), { timeout: 20000 });
    const ids = await pg.$$eval('#cut-candidates li.clip-row', x => x.map(e => e.dataset.id)); assert.deepStrictEqual(ids.slice(0, 1), ['full']); assert.strictEqual(ids.length, 4, ids.join());
    // the rules found them: no "Picked by" line, that one is for a model or your agent
    assert.strictEqual((await api('/api/cut')).scoredBy, 'rules'); assert.strictEqual(await pg.$('#cut-scored'), null);
    assert.strictEqual(await pg.$('#cut-timeline'), null, 'the timeline stays folded until you open it');
    await openTrim();
    assert.strictEqual(await pg.$$eval('#cut-timeline .lane.k-clip .region', x => x.length), 3);
    assert.ok(await pg.$$eval('#cut-timeline .mk.filler', x => x.length) > 0, 'filler marks');
    if (shots) { await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, 'cut-desktop.png') }); }
  });
  await t('timeline: drag an edge to trim, untick one, drag on a lane to add your own, Play plays it', async () => {
    await openTrim();
    const before = (await api('/api/cut')).candidates.find(x => x.id === 'c1');
    await pg.evaluate(() => document.querySelector('#cut-timeline').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(300);
    const edge = await pg.locator('#cut-timeline .region[data-region="c1"] .edge.b').boundingBox();
    await pg.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await pg.mouse.down();
    await pg.mouse.move(edge.x - 30, edge.y + edge.height / 2, { steps: 6 }); await pg.mouse.up();
    const after = await until(async () => { const c = (await api('/api/cut')).candidates.find(x => x.id === 'c1'); return c.trimmed ? c : null; });
    assert.ok(after.ranges[0][1] < before.ranges[0][1] - 1, `${before.ranges[0][1]} -> ${after.ranges[0][1]}`);
    await pg.click('#keep-c3'); // the tick follows the server, so a plain click
    await until(async () => (await api('/api/cut')).candidates.find(x => x.id === 'c3').keep === false);
    await pg.waitForSelector(row('c3') + '[data-keep="0"]');
    await pg.evaluate(() => document.querySelector('#cut-timeline').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(300);
    // drag across an empty part of the clip lane (the last 15 s of the take)
    const lane = await pg.locator('#cut-timeline .lane.k-clip .lane-track').boundingBox(), cs = (await api('/api/cut')).candidates.filter(x => x.kind === 'clip');
    let from = 95, to = 108; for (const c of cs) if (c.ranges.some(([a, b]) => b > from && a < to)) { from = 2; to = 14; }
    const X = s => lane.x + (s / 112) * lane.width;
    await pg.mouse.move(X(from), lane.y + lane.height / 2); await pg.mouse.down(); await pg.mouse.move(X(to), lane.y + lane.height / 2, { steps: 8 }); await pg.mouse.up();
    const mine = await until(async () => (await api('/api/cut')).candidates.find(x => x.id === 'm1'));
    assert.ok(Math.abs(mine.ranges[0][0] - from) < 1.5 && Math.abs(mine.ranges[0][1] - to) < 1.5, JSON.stringify(mine.ranges));
    // only a clip you added has a trash; ours can only be unticked
    assert.strictEqual(await pg.$(row('c1') + ' button[aria-label^="Remove"]'), null);
    await pg.click(row('m1') + ' .cc-play');
    await pg.waitForFunction(([a, b]) => { const v = document.querySelector('#player-video'); return !v.paused && v.currentTime >= a - 0.2 && v.currentTime <= b + 0.2; }, mine.ranges[0], { timeout: 8000 });
    await pg.click(row('m1') + ' .cc-play'); await pg.waitForFunction(() => document.querySelector('#player-video').paused, null, { timeout: 8000 });
    await pg.click(row('m1') + ' button[aria-label^="Remove"]');
    await until(async () => !(await api('/api/cut')).candidates.some(x => x.id === 'm1'));
    if (shots) await shot(pg, '#cut-timeline', 'cut-timeline.png');
  });
  await t('one place renders: the Cut step has no Render; the Render step renders every kept cut as its own video in its one Render', async () => {
    assert.strictEqual(await pg.$('#s-cut #cut-render'), null, 'no Render button on the Cut step');
    assert.strictEqual(await pg.$$eval('#s-cut button', x => x.filter(b => /^(Render|Save as)/.test(b.textContent.trim())).length), 0, 'nothing on the Cut step renders or saves a file');
    // the page catches up with the untick above, then says what moves on: the 3 kept ones, as one reel
    await pg.waitForFunction(() => /^3 clips kept, [\d:]+( s)?\. They move on to the next steps as one reel\.$/.test((document.querySelector('#cut-kept') || {}).textContent || ''), null, { timeout: 10000 })
      .catch(async () => { throw new Error('the Cut step says what moves on: ' + await pg.textContent('#cut-hint')); });
    assert.strictEqual(await pg.getAttribute('#cut-hint', 'data-kept'), '3');
    await open(pg, '#step=render');
    await openFold(pg, '#make-fold'); // What to make is a closed fold on Render
    await pg.waitForSelector('#fin-exports #exp-clips');
    assert.strictEqual(await pg.$('#kept-cuts'), null, 'one render path: no second render card');
    assert.strictEqual(await pg.textContent('#exp-clips'), '3 clips on their own');
    // each kept cut as its own reel, and no reel of them all this time
    await pg.click('#exp-clips'); await pg.waitForSelector('#exp-clips[aria-pressed="true"]');
    await pg.click('#exp-reel'); await pg.waitForSelector('#exp-reel[aria-pressed="false"]');
    await pg.waitForFunction(() => document.querySelector('#render').getAttribute('aria-disabled') !== 'true');
    await pg.click('#render');
    const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 800));
    const c = (await api('/api/cut')).candidates, kept = c.filter(x => x.keep);
    assert.strictEqual(kept.length, 3); for (const k of kept) assert.ok(k.outputs.length === 1 && existsSync(join(ROOT, k.outputs[0])), k.id);
    const c1 = probe(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'c1.mp4')), want = c.find(x => x.id === 'c1').seconds;
    assert.ok(Math.abs(+c1.format.duration - want) < 0.6, `extract ${c1.format.duration} vs ${want}`);
    assert.ok(!existsSync(join(ROOT, 'jobs', `${JOB}-c3`)), 'the dropped one is not rendered');
    const log = readFileSync(join(ROOT, 'jobs', `${JOB}-c1`, 'fake-reel.log'), 'utf8'); assert.ok(/--export shorts/.test(log) && !/--draft/.test(log), log);
    // what you made in Cut reaches the reel as it is: --as-is, and a clips.json beside the files with each one's words
    assert.ok(/--as-is/.test(log), 'rendered as already cut: ' + log);
    const cj = JSON.parse(readFileSync(join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'clips.json'), 'utf8')), e1 = cj.clips.find(x => x.file === 'cuts/c1.mp4');
    assert.ok(cj.precut && e1 && Array.isArray(e1.words) && e1.words.length && Math.abs(e1.dur - want) < 0.05, JSON.stringify(e1).slice(0, 300));
    await pg.waitForSelector('#cut-outputs figure');
    assert.strictEqual(await pg.$$eval('#cut-outputs figure', x => x.length), 3);
    // plain clips: each kept cut joined as it is, no reel edit
    const plain = join(ROOT, 'inbox', 'studio', JOB, 'cuts', 'c1.mp4'), reelLog = join(ROOT, 'jobs', `${JOB}-c1`, 'fake-reel.log'), logBefore = readFileSync(reelLog, 'utf8');
    rmSync(plain);
    await pg.click('#exp-plain'); await pg.waitForSelector('#exp-plain[aria-pressed="true"]'); await pg.click('#exp-clips'); await pg.waitForSelector('#exp-clips[aria-pressed="false"]');
    await pg.click('#render');
    const pv = await waitTask(); assert.strictEqual(pv.task.status, 'done', JSON.stringify(pv.task).slice(0, 800));
    assert.ok(existsSync(plain) && Math.abs(+probe(plain).format.duration - want) < 0.6, 'the plain clip');
    assert.strictEqual(readFileSync(reelLog, 'utf8'), logBefore, 'a plain clip does not run the reel edit');
    if (shots) { await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(300); await shot(pg, '#s-render', 'finish-pieces.png'); }
    await api('/api/state', { finish: { reel: true, clips: false, plain: false } });
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
  await t('Picture, reference view: Pull script transcribes the reference and puts its words in Scripts', async () => {
    await upload('reference', REF, 'ref.mp4');
    await open(pg, '#step=reference');
    await pg.click('#pull-script-btn');
    await pg.waitForFunction(() => /In Scripts:/.test(document.querySelector('#pull-script').textContent), null, { timeout: 20000 });
    const sc = (await api('/api/state')).scripts.find(x => x.by === 'reference transcript');
    const text = (await api('/api/scripts/get?id=' + sc.id)).script.text; assert.ok(/^\[hook\]/.test(text) && /\[body\]/.test(text) && /\[cta\]/.test(text), text.slice(0, 300));
    assert.ok(await pg.$('#adapt-topic'), 'the adapt box shows');
    if (shots) { await pg.fill('#adapt-topic', 'meal prep for busy parents'); await shot(pg, '#pull-script', 'pull-script.png'); }
  });
  await t('cut points on the audio: the transcript is off, every cut lands in the real gap after the word, and the timeline shows why', async () => {
    const syn = (await upload('footage', SYN, 'synthetic speech.mp4')).path; assert.ok(/synthetic-speech/.test(syn), syn);
    await api('/api/cut/output', { format: 'short', kind: 'clips', clips: 1, seconds: null, length: 'short', goal: 'organic', cta: null });
    await api('/api/cut/find', { path: syn, scorer: 'rules' });
    await until(async () => { const x = await api('/api/cut'); return x.source === syn && x.candidates.length ? x : null; }, 30000);
    const x = await api('/api/cut/set', { source: syn, by: 'test', candidates: [
      { kind: 'clip', label: 'Early end', ranges: [[0.95, 2.25]] }, { kind: 'clip', label: 'Late end', ranges: [[3.25, 5.1]] }, { kind: 'clip', label: 'Late start', ranges: [[6.3, 7.55]] },
      { kind: 'part', label: 'Split', ranges: [[0.95, 2.25], [6.3, 7.55]] }] });
    const [a, b, c, d] = x.cut.candidates, end = k => k.cuts.find(p => p.edge === 'end'), start = k => k.cuts.find(p => p.edge === 'start');
    assert.ok(a.snapped && b.snapped && c.snapped && d.snapped, 'all snapped');
    // "two" really ends at 2.40: the cut is at least 120 ms after it, at least 60 ms before the breath at 2.70
    assert.ok(a.ranges[0][1] >= 2.52 && a.ranges[0][1] <= 2.64, 'early end ' + JSON.stringify(end(a))); assert.ok(/ran past/.test(end(a).by), end(a).by);
    // "four" really ends at 4.80, not 5.10 (cut 120 to 250 ms after it)
    assert.ok(b.ranges[0][1] >= 4.92 && b.ranges[0][1] <= 5.05, 'late end ' + JSON.stringify(end(b))); assert.ok(/ended before/.test(end(b).by), end(b).by);
    // "five" really starts at 6.00, not 6.30 (cut 60 to 150 ms before it)
    assert.ok(c.ranges[0][0] <= 5.94 && c.ranges[0][0] >= 5.85, 'late start ' + JSON.stringify(start(c))); assert.ok(/started before/.test(start(c).by), start(c).by);
    assert.ok(c.ranges[0][1] >= 7.62 && c.ranges[0][1] <= 7.75, 'end of the last word ' + c.ranges[0][1]);
    assert.strictEqual(d.cuts.length, 4, 'a split has a start and an end per part'); assert.deepStrictEqual(d.ranges, [a.ranges[0], c.ranges[0]]);
    // a trim snaps too, and snap: false keeps it exact
    const tr = await api('/api/cut/edit', { id: a.id, ranges: [[0.95, 1.5]] }); assert.ok(tr.cut.candidates[0].ranges[0][1] >= 1.6, 'a trim into "One" goes to its end: ' + tr.cut.candidates[0].ranges[0][1]);
    const ex = await api('/api/cut/edit', { id: a.id, ranges: [[0.95, 2.25]], snap: false }); assert.deepStrictEqual(ex.cut.candidates[0].ranges, [[0.95, 2.25]]); assert.ok(!ex.cut.candidates[0].cuts);
    await api('/api/cut/edit', { id: a.id, ranges: [[0.95, 2.25]] });
    // the timeline: Show cut points draws the transcript times and lists each cut with why
    await open(pg, '#step=cut');
    await openTrim(); await pg.waitForSelector('#cut-timeline .region');
    await pg.check('#cut-debug');
    await pg.waitForSelector('#cut-points tbody tr');
    assert.ok((await pg.$$('#cut-timeline .cp-tx')).length >= 8, 'transcript ticks on the lanes');
    const rows = await pg.$$eval('#cut-points tbody tr', r => r.map(x => x.textContent)); assert.ok(rows.length === 2 && /two\./.test(rows[1]) && /ran past/.test(rows[1]), rows.join(' | '));
    await pg.click(row(b.id) + ' .clip-m'); // a click on the row picks it (its name is the label of its tick)
    await pg.waitForFunction(() => /Late end/.test(document.querySelector('#cut-points').textContent));
    if (shots) await shot(pg, '#cut-timeline', 'cut-points.png');
  });
  await t('clips made from lines: a row each on Clips, Play runs the lines in their order, one file on Render, the clean take, the agent\'s labelled', async () => {
    // the page no longer has the Lines panel; an agent (or the API) still groups whole lines into a clip, in any order
    const L0 = await api('/api/lines'); assert.strictEqual(L0.lines.length, 3, 'three lines: "One two." "Three four." "Five six."');
    assert.strictEqual((await api('/api/lines', { keep: { l2: false } })).lines.lines[1].keep, false, 'line 2 is a retake');
    const made = await api('/api/lines', { action: 'add', name: 'Five then one', lines: [3, 1] }), bid = made.lines.bites[0].id;
    assert.deepStrictEqual(made.lines.bites[0].lines, ['l3', 'l1'], 'in the order you gave them');
    assert.deepStrictEqual((await api('/api/lines', { action: 'update', id: bid, lines: [1, 3] })).lines.bites[0].lines, ['l1', 'l3']);
    assert.deepStrictEqual((await api('/api/lines', { action: 'update', id: bid, lines: [3, 1] })).lines.bites[0].lines, ['l3', 'l1']);
    await pg.waitForSelector(row(bid));
    assert.ok(/Five then one/.test(await pg.textContent(row(bid) + ' .clip-h b'))); assert.ok(/^2 lines stitched, /.test(await pg.textContent(row(bid) + ' .clip-m')), await pg.textContent(row(bid) + ' .clip-m'));
    // play: the first line (five six), then the second (one two)
    await pg.click(row(bid) + ' .cc-play');
    await pg.waitForFunction(() => { const v = document.querySelector('#player-video'); return v.currentTime > 6.1 && v.currentTime < 7.6; }, null, { timeout: 8000 });
    await pg.waitForFunction(() => { const v = document.querySelector('#player-video'); return v.currentTime > 1.0 && v.currentTime < 2.5; }, null, { timeout: 8000 });
    if (await pg.textContent(row(bid) + ' .cc-play') === 'Stop') await pg.click(row(bid) + ' .cc-play');
    // nothing on the Cut step renders: it says what moves on
    assert.strictEqual(await pg.$$eval('#s-cut button', x => x.filter(b => /^(Render|Save as)/.test(b.textContent.trim())).length), 0, 'no Render or Save as on the Cut step');
    assert.ok(/move on to the next steps as one reel/.test(await pg.textContent('#cut-kept')), await pg.textContent('#cut-kept'));
    // on Render it is one of your clips: Plain clips saves it as one file, the two lines joined, nothing else
    await open(pg, '#step=render');
    await openFold(pg, '#make-fold');
    await until(async () => (await api('/api/edit')).combo.pieces.some(x => x.kind === 'bite' && x.id === bid));
    await pg.waitForSelector('#exp-plain:not([disabled])');
    await pg.click('#exp-plain'); await pg.waitForSelector('#exp-plain[aria-pressed="true"]'); await pg.click('#exp-reel'); await pg.waitForSelector('#exp-reel[aria-pressed="false"]');
    await pg.click('#render');
    const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 600));
    const L = (await api('/api/lines')).bites[0]; assert.ok(L.file, 'the joined file'); assert.ok(Math.abs(+probe(join(ROOT, L.file)).format.duration - L.seconds) < 0.25, `${L.seconds}`);
    assert.ok(!existsSync(join(ROOT, 'jobs', `${JOB}-${L.id}`, 'fake-reel.log')), 'one file is not a reel edit');
    await api('/api/state', { finish: { reel: true, clips: false, plain: false } });
    await open(pg, '#step=cut');
    await pg.waitForSelector(row(bid));
    // the clean take leaves out line 2 (marked a retake)
    const clean = (await api('/api/lines', { action: 'clean' })).lines.bites.find(x => x.id === 'take'); assert.deepStrictEqual(clean.lines, ['l1', 'l3']);
    await pg.waitForSelector(row('take')); assert.ok(/Clean take/.test(await pg.textContent(row('take') + ' .clip-h b'))); assert.ok(/^2 lines stitched, /.test(await pg.textContent(row('take') + ' .clip-m')));
    // the agent's picks show as its own
    await api('/api/lines', { action: 'set', by: 'claude-code', bites: [{ name: 'Middle', lines: [2, 3], reason: 'The how-to' }], replace: false });
    await pg.waitForSelector('#cut-candidates li.clip-row:has-text("Middle"):has-text("By Claude")');
    assert.ok(/The how-to/.test(await pg.textContent('#cut-candidates li.clip-row:has-text("Middle") .clip-why')));
    assert.ok(!/\bbites?\b/i.test(await pg.innerText('#s-cut')), 'the page says clips, never bites');
  });
  await t('footage order: drag a clip onto another or use the arrows; the draft follows that order', async () => {
    await open(pg, '#step=start');
    const names = () => pg.$$eval('#footage li[data-path]', x => x.map(e => e.dataset.path.split('/').pop()));
    const n0 = await names(); assert.deepStrictEqual(n0, ['long-take.mp4', 'screen.mkv', 'synthetic-speech.mp4']);
    await pg.dragAndDrop('#footage li[data-path$="synthetic-speech.mp4"]', '#footage li[data-path$="long-take.mp4"]');
    await pg.waitForFunction(() => document.querySelector('#footage li[data-path]').dataset.path.endsWith('synthetic-speech.mp4'));
    await pg.click('[aria-label="Move screen.mkv earlier"]');
    await until(async () => (await names()).join() === 'synthetic-speech.mp4,screen.mkv,long-take.mp4');
    assert.deepStrictEqual((await api('/api/state')).state.footage.map(f => f.split('/').pop()), ['synthetic-speech.mp4', 'screen.mkv', 'long-take.mp4']);
    await pg.click('[aria-label="Remove screen.mkv"]'); await until(async () => (await names()).join() === 'synthetic-speech.mp4,long-take.mp4');
    if (shots) {
      // a screenshot of Clips on the long take, with two clips picked by the agent
      await api('/api/cut/output', { source: take }); await api('/api/lines', { path: take, action: 'set', by: 'claude-code', clean: true, bites: [{ name: 'The morning setup', lines: [4, 5, 6, 7], reason: 'One clear how-to with a strong first line' }, { name: 'Hook: ten minutes', lines: [1, 9, 10, 11] }] });
      await open(pg, '#step=cut'); await pg.waitForSelector('#cut-candidates li.clip-row');
      await shot(pg, '#cut-clips', 'lines-bites.png');
    }
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
