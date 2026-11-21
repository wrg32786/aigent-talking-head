// The three layers of the Cut step (1.28.0) in a real Chrome, on synthetic media only (no keys, no network):
// - Raw take, Best lines, Clips: three tabs in that order, one line of explanation each, and the choice survives a reload
// - the point of the video: typed once, saved on blur or Enter, kept over a reload; the lines that serve it say so
// - topics: themes of two words or more, never one weak word; a chip filters the lines
// - Clips: Play runs a clip stitched (the video jumps over the gap), a tick keeps a clip and changes what moves on,
//   your own clip leads when you picked lines, Pacing takes the quiet out of the previews and sets the draft's pace
// - the page says lines and clips on every layer (the server still says pieces, the Combo and bites)
// - new footage on a board with an edit is a new video: the point clears
// The take is tests/fixtures/topics-take.json read at a steady pace: a burst of voice per word (tests/fixtures/speech.cjs),
// half a second between lines and one 1.5 s silence, with the same word times given to the stand-in transcriber.
// Needs Chrome and ffmpeg. Run: node tests/studio-cut-layers.e2e.mjs [--shots <dir>]
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';
import SP from './fixtures/speech.cjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-layers-e2e-')), JOB = 'layers-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });

// the words: 0.26 s each with 0.05 s between, 0.5 s between lines, and a 1.5 s silence after line 4
const SENT = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'topics-take.json'), 'utf8')).lines, PAUSE_AFTER = 3;
const TW = [], LT = []; // word times, and each line's [start, end]
{ let at = 0.6; SENT.forEach((s, k) => { const a = at; for (const w of s.split(' ')) { TW.push([+at.toFixed(2), +(at + 0.26).toFixed(2), w]); at += 0.31; } LT.push([+a.toFixed(2), +(at - 0.05).toFixed(2)]); at += (k === PAUSE_AFTER ? 1.5 : 0.5) - 0.05; }); }
const SECS = Math.ceil(LT[LT.length - 1][1] + 1);
// the sound: a burst of voice on every word, room tone between them (made a line at a time, which is quick)
const wav = (f, x, sr) => { const b = Buffer.alloc(44 + x.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2); writeFileSync(f, b); };
const WAV = join(STATE, 'voice.wav'), TAKE = join(STATE, 'layers-take.mp4'), SECOND = join(STATE, 'second-take.mp4');
const SOUND = new Float32Array(SECS * SP.SR);
LT.forEach(([a, b], k) => { const from = k ? (LT[k - 1][1] + a) / 2 : 0, to = k + 1 < LT.length ? (b + LT[k + 1][0]) / 2 : SECS, at = Math.round(from * SP.SR);
  SOUND.set(SP.speech(to - from, { voiced: TW.filter(w => w[0] >= a - 0.01 && w[1] <= b + 0.01).map(w => [w[0] - at / SP.SR, w[1] - at / SP.SR]) }).subarray(0, SOUND.length - at), at); });
wav(WAV, SOUND, SP.SR);
ff(['-f', 'lavfi', '-i', `color=c=0x303840:s=360x640:r=12:d=${SECS}`, '-i', WAV, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', TAKE]);
ff(['-f', 'lavfi', '-i', 'color=c=0x403830:s=360x640:r=12:d=4', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', SECOND]);
const TXW = join(STATE, 'words.json'); writeFileSync(TXW, JSON.stringify({ 'layers-take': { duration: SECS, words: TW } }));
const env = { ...process.env, FAKE_TX_WORDS: TXW, CI: '1', STUDIO_DIR: STATE, STUDIO_BROLL_LIBRARY: join(STATE, 'lib'), STUDIO_BROLL_AUTO: '', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '',
  STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '50', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const upload = async (kind, f, name) => (await fetch(`${url}/api/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: readFileSync(f) })).json();
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
// a fresh load of a link: via about:blank, because a new hash alone does not reload the page
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const cleanJobs = () => { rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); };
const shot = async (pg, name) => { if (!shots) return; await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name) }); };

const LAYERS = [['raw', 'Raw take', /take in full/], ['lines', 'Best lines', /sorted by what it does/], ['clips', 'Clips', /stitched into clips/]];
const OLD = [/\bpieces?\b/i, /\bcombos?\b/i, /\bbites?\b/i, /cuts and lines/i];
const POINT = 'Show beginners they can build an app with AI in a weekend';
const HIDDEN = ['aside', 'retake'];
const row = id => `#cut-candidates li.clip-row[data-id="${id}"]`;
const inSpan = (x, [a, b], pad = 0) => x >= a - pad && x <= b + pad;

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }));
try {
  await api('/api/settings', { chat: { backend: 'keywords' } });
  await api('/api/state', { job: JOB, sound: { sfx: 'off' }, music: { bed: 'none' } });
  const take = (await upload('footage', TAKE, 'layers take.mp4')).path; assert.ok(/layers-take/.test(take), take);
  await api('/api/cut/transcribe', { path: take }); await until(async () => { const c = await api('/api/cut'); return c.tx && c.tx.status === 'ready'; }, 30000);
  const P0 = await until(async () => { const j = await api('/api/pieces'); return j.pieces && j.pieces.length === SENT.length ? j : null; }, 30000);
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const layer = async id => { await pg.click('#cut-layer-' + id); await pg.waitForSelector(`#cut-body[data-layer="${id}"]`); };
  const sel = () => pg.$$eval('#cut-layers [role="tab"]', x => x.filter(e => e.getAttribute('aria-selected') === 'true').map(e => e.id));
  // Show asides and retakes is only there when the take has some
  const showAll = async on => { const b = await pg.$('#pieces-retakes'); if (b && (await b.getAttribute('aria-pressed') === 'true') !== on) { await b.click(); await pg.waitForSelector(`#pieces-retakes[aria-pressed="${on}"]`); } };
  const noOldWords = async where => { const text = await pg.innerText('#s-cut'); for (const re of OLD) { const m = text.match(re); assert.ok(!m, `${where}: the page says "${m && m[0]}" near "${m ? text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ') : ''}"`); } };

  await t('three layers in order (Raw take, Best lines, Clips), one line each; the choice survives a reload', async () => {
    await open(pg, '#step=cut'); await pg.waitForSelector('#cut-layers');
    assert.deepStrictEqual(await pg.$$eval('#cut-layers [role="tab"]', x => x.map(e => e.id)), LAYERS.map(l => 'cut-layer-' + l[0]));
    assert.deepStrictEqual(await pg.$$eval('#cut-layers [role="tab"] .cl-t', x => x.map(e => e.textContent)), LAYERS.map(l => l[1]));
    assert.strictEqual(await pg.getAttribute('#cut-layers', 'role'), 'tablist');
    // a first visit opens on the raw take
    assert.strictEqual(await pg.evaluate(() => localStorage.getItem('studio.cutLayer')), null); assert.deepStrictEqual(await sel(), ['cut-layer-raw']);
    assert.strictEqual(await pg.getAttribute('#cut-body', 'data-layer'), 'raw');
    assert.strictEqual(await pg.$('#cut-mode'), null, 'the old two tabs are gone');
    const said = [];
    for (const [id, , re] of LAYERS) {
      await layer(id); assert.deepStrictEqual(await sel(), ['cut-layer-' + id], 'one tab is selected');
      const line = (await pg.textContent('#cut-explain')).trim(); said.push(line);
      assert.ok(re.test(line) && line.length < 170 && !/\n/.test(line), `${id}: one plain line: ${line}`);
      assert.strictEqual(await pg.getAttribute('#cut-body', 'aria-labelledby'), 'cut-layer-' + id);
      assert.strictEqual(await pg.evaluate(() => localStorage.getItem('studio.cutLayer')), id);
      // the take plays on every layer; its words show only on the raw take
      assert.ok(await pg.isVisible('#player #player-video'), id + ': the player'); await pg.waitForSelector('#player-transcript .w', { state: 'attached' });
      assert.strictEqual(await pg.isVisible('#player-transcript'), id === 'raw', id + ': the transcript');
      assert.strictEqual(await pg.isVisible('#cut-raw'), id === 'raw'); assert.strictEqual(await pg.isVisible('#pieces'), id === 'lines'); assert.strictEqual(await pg.isVisible('#cut-clips'), id === 'clips');
    }
    assert.strictEqual(new Set(said).size, 3, 'each layer has its own line');
    // the raw facts: how long, how many lines, the one long pause
    await layer('raw'); const facts = await pg.textContent('#cut-raw'); assert.ok(new RegExp(`${SENT.length} lines`).test(facts) && /1 long pause/.test(facts), facts);
    await pg.click('#cut-to-lines'); await pg.waitForSelector('#cut-body[data-layer="lines"]');
    for (const id of ['clips', 'lines']) {
      await layer(id); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector(`#cut-body[data-layer="${id}"]`);
      assert.deepStrictEqual(await sel(), ['cut-layer-' + id], id + ' after a reload');
    }
    // Clips, opened with the words read and nothing found yet, found our suggestions by itself, by the rules
    const c = await until(async () => { const v = await api('/api/cut'); return v.candidates.length ? v : null; }); assert.strictEqual(c.scoredBy, 'rules');
  });

  await t('the point of the video: saved on blur and on Enter, kept over a reload, and the lines that serve it say Fits your point', async () => {
    await layer('lines'); await pg.waitForSelector('#pieces-grid .pz');
    assert.strictEqual(await pg.inputValue('#point'), ''); assert.ok(await pg.isVisible('#point-hint'));
    assert.strictEqual(await pg.textContent('label[for="point"]'), "What's the point of this video?");
    assert.strictEqual(await pg.$$eval('#pieces-grid .pz-fits', x => x.length), 0, 'nothing fits a point you have not given');
    await showAll(true); // every line on screen
    const at0 = (await api('/api/cut')).candidates.length;
    await pg.fill('#point', POINT); await pg.locator('#point').blur();
    await until(async () => (await api('/api/state')).state.point === POINT);
    assert.strictEqual((await api('/api/edit')).point, POINT); assert.strictEqual((await api('/api/cut')).point, POINT);
    const P = await api('/api/pieces'), fit = P.pieces.filter(p => p.fits).map(p => p.id).sort();
    assert.ok(fit.length >= 2 && fit.length < P.pieces.length, 'some lines serve the point, not all: ' + fit.length);
    await pg.waitForSelector('#pieces-grid .pz-fits'); await pg.waitForSelector('#point-hint', { state: 'detached' });
    await until(async () => (await pg.$$eval('#pieces-grid .pz:has(.pz-fits)', x => x.map(e => e.dataset.piece))).sort().join() === fit.join());
    assert.deepStrictEqual([...new Set(await pg.$$eval('#pieces-grid .pz-fits', x => x.map(e => e.textContent)))], ['Fits your point']);
    // a line that serves the point scores higher than it did, and no other line moved
    const was = Object.fromEntries(P0.pieces.map(p => [p.id, p.score]));
    for (const p of P.pieces) { if (p.fits) assert.ok(p.score >= was[p.id], `${p.id}: ${was[p.id]} -> ${p.score}`); }
    assert.ok(P.pieces.some(p => p.fits && p.score > was[p.id]), 'a fitting line rose');
    assert.ok((await api('/api/cut')).candidates.length >= 1 && at0 >= 1, 'the suggested clips are still there, found again');
    await shot(pg, 'cut-layers-lines-point.png');
    // a reload keeps it
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#point');
    await pg.waitForFunction(v => document.querySelector('#point').value === v, POINT);
    await pg.waitForSelector('#pieces-grid .pz-fits'); assert.strictEqual(await pg.$('#point-hint'), null);
    // Enter saves too; an empty point takes the marks away
    await pg.fill('#point', ''); await pg.press('#point', 'Enter');
    await until(async () => (await api('/api/state')).state.point === '');
    await pg.waitForFunction(() => !document.querySelector('#pieces-grid .pz-fits'));
    await pg.fill('#point', '  ' + POINT + '  '); await pg.press('#point', 'Enter');
    await until(async () => (await api('/api/state')).state.point === POINT); await pg.waitForSelector('#pieces-grid .pz-fits');
  });

  await t('topics are themes of two words or more, never one weak word; a chip filters the lines', async () => {
    const P = await api('/api/pieces');
    assert.ok(P.topics.length >= 2 && P.topics.length <= 5, 'two to five themes: ' + P.topics.join(' | '));
    await pg.waitForSelector('#pieces-topics [data-topic]');
    const chips = await pg.$$eval('#pieces-topics [data-topic]', x => x.map(e => [e.dataset.topic, e.textContent.trim()]));
    assert.deepStrictEqual(chips.map(c => c[0]), P.topics);
    for (const [k, label] of chips) assert.ok(k === label && label.split(/\s+/).length >= 2, `a theme, not one word: "${label}"`);
    const cards = () => pg.$$eval('#pieces-grid .pz', x => x.map(e => e.dataset.piece).sort());
    await showAll(false); // asides and retakes hidden, as on a first visit
    const shown = P.pieces.filter(p => !HIDDEN.includes(p.category)), all = shown.map(p => p.id).sort();
    await until(async () => (await cards()).join() === all.join());
    for (const tp of P.topics.slice(0, 2)) {
      const want = shown.filter(p => p.topics.includes(tp)).map(p => p.id).sort(); assert.ok(want.length >= 1 && want.length < all.length, `${tp}: ${want.length} of ${all.length}`);
      await pg.click(`#pieces-topics [data-topic="${tp}"]`); await pg.waitForSelector(`#pieces-topics [data-topic="${tp}"][aria-pressed="true"]`);
      assert.deepStrictEqual(await cards(), want, 'only the lines of ' + tp);
      assert.strictEqual(await pg.$$eval('#pieces-topics [aria-pressed="true"]', x => x.length), 1, 'one topic at a time');
      // a group with no line of this topic leaves the screen
      assert.deepStrictEqual((await pg.$$eval('#pieces-grid .pz-cat', x => x.map(e => e.dataset.cat))).sort(), [...new Set(shown.filter(p => p.topics.includes(tp)).map(p => p.category))].sort());
      if (tp === P.topics[0]) await shot(pg, 'cut-layers-topic.png');
      await pg.click(`#pieces-topics [data-topic="${tp}"]`); await pg.waitForSelector(`#pieces-topics [data-topic="${tp}"][aria-pressed="false"]`);
      assert.deepStrictEqual(await cards(), all, 'every line is back');
    }
  });

  // three clips for the Clips checks: one line, the two lines around the 1.5 s silence, and two lines far apart
  let A, B, S;
  await t('Clips: Play runs a clip of two stretches stitched, the video jumps over what lies between', async () => {
    const pad = ([a, b]) => [+(a - 0.05).toFixed(2), +(b + 0.05).toFixed(2)];
    const x = await api('/api/cut/set', { source: take, by: 'test', candidates: [
      { kind: 'clip', label: 'One line', ranges: [pad(LT[0])] },
      { kind: 'clip', label: 'Across the silence', ranges: [[LT[PAUSE_AFTER][0] - 0.05, LT[PAUSE_AFTER + 1][1] + 0.05]] },
      { kind: 'part', label: 'Two far lines', ranges: [pad(LT[1]), pad(LT[11])] }] });
    [A, B, S] = x.cut.candidates; assert.strictEqual(S.ranges.length, 2, JSON.stringify(S.ranges));
    await api('/api/state', { pace: { tighten: 'off' } }); // Natural: a clip plays its stretches as they are
    await layer('clips'); await pg.waitForSelector(row(S.id)); await pg.waitForSelector('#pacing[data-pacing="natural"]');
    const spans = (await api('/api/cut/preview?path=' + encodeURIComponent(take))).clips[S.id].spans; assert.deepStrictEqual(spans, S.ranges, 'no quiet comes out on Natural');
    const [first, last] = spans, gap = [first[1] + 0.35, last[0] - 0.15]; assert.ok(gap[1] - gap[0] > 20, 'a long way between them');
    assert.ok(/^2 lines stitched, /.test(await pg.textContent(row(S.id) + ' .clip-m')), await pg.textContent(row(S.id) + ' .clip-m'));
    await pg.waitForFunction(() => document.querySelector('#player-video').readyState >= 1);
    // sample the take's own video element while it plays
    await pg.evaluate(() => { const v = document.querySelector('#player-video'); window.__seen = []; window.__tick = setInterval(() => window.__seen.push([v.currentTime, v.paused ? 0 : 1]), 20); });
    await pg.click(row(S.id) + ' .cc-play');
    await pg.waitForFunction(id => /Stop/.test(document.querySelector(`#cut-candidates li.clip-row[data-id="${id}"] .cc-play`).textContent), S.id);
    await pg.waitForFunction(a => document.querySelector('#player-video').currentTime >= a, last[0], { timeout: 30000 });
    assert.ok(/Stop/.test(await pg.textContent(row(S.id) + ' .cc-play')), 'still playing in the second stretch');
    await pg.waitForFunction(id => /Play/.test(document.querySelector(`#cut-candidates li.clip-row[data-id="${id}"] .cc-play`).textContent), S.id, { timeout: 30000 });
    await pg.waitForFunction(() => document.querySelector('#player-video').paused);
    const seen = await pg.evaluate(() => { clearInterval(window.__tick); return window.__seen; }), end = await pg.$eval('#player-video', v => v.currentTime);
    assert.ok(inSpan(end, [last[1] - 0.6, last[1]], 0.3), `it ends at the end of the last stretch (${last}): ${end}`);
    const played = seen.filter(x => x[1]).map(x => x[0]);
    assert.ok(played.filter(x => inSpan(x, first)).length > 20 && played.filter(x => inSpan(x, last)).length > 20, 'both stretches played');
    const inGap = seen.filter(x => x[0] > gap[0] && x[0] < gap[1]).length * 0.02;
    assert.ok(inGap < 0.3, `the video did not sit in the gap: ${inGap.toFixed(2)} s between ${gap}`);
    assert.ok(Math.max(...played) <= last[1] + 0.3 && Math.min(...played) >= first[0] - 0.3, 'nothing outside the clip played');
    // the first stretch played before the second
    assert.ok(played.findIndex(x => inSpan(x, last)) > played.findIndex(x => inSpan(x, first)));
  });

  await t('Clips: a tick keeps a clip; unticking changes what moves on, on the page and in Your edit', async () => {
    const kept = () => pg.textContent('#cut-kept'), cutIds = async () => (await api('/api/edit')).combo.pieces.filter(x => x.kind === 'cut').map(x => x.id);
    await pg.waitForFunction(() => /^3 clips kept, /.test(document.querySelector('#cut-kept').textContent));
    assert.ok(/^3 clips kept, [\d:]+( s)?\. They move on to the next steps as one reel\.$/.test(await kept()), await kept());
    assert.deepStrictEqual(await cutIds(), [A.id, B.id, S.id]);
    const before = await kept();
    await pg.click('#keep-' + B.id); await pg.waitForSelector(row(B.id) + '[data-keep="0"]');
    await pg.waitForFunction(() => /^2 clips kept, /.test(document.querySelector('#cut-kept').textContent)); assert.notStrictEqual(await kept(), before);
    assert.strictEqual(await pg.getAttribute('#cut-hint', 'data-kept'), '2'); assert.strictEqual(await pg.isChecked('#keep-' + B.id), false);
    assert.deepStrictEqual(await cutIds(), [A.id, S.id], 'the server leaves it out of the reel');
    let e = await api('/api/edit'); assert.ok(/^2 clips, \d+ s, in your order/.test(e.edit.from.text), e.edit.from.text);
    await pg.click('#keep-' + A.id); await pg.click('#keep-' + S.id); await pg.waitForSelector(row(S.id) + '[data-keep="0"]'); await pg.waitForSelector(row(A.id) + '[data-keep="0"]');
    await pg.waitForFunction(() => document.querySelector('#cut-kept').textContent === 'No clip is kept, so the whole take moves on.');
    e = await api('/api/edit'); assert.strictEqual(e.combo.pieces.length, 0); assert.strictEqual(e.edit.from.mode, 'take');
    for (const c of [A, B, S]) await pg.click('#keep-' + c.id);
    await pg.waitForFunction(() => /^3 clips kept, /.test(document.querySelector('#cut-kept').textContent)); assert.deepStrictEqual(await cutIds(), [A.id, B.id, S.id]);
    // ours have no trash, and nothing moves them up or down
    assert.strictEqual(await pg.$$eval('#cut-candidates li.clip-row button', x => x.filter(b => !b.classList.contains('cc-play')).length), 0);
  });

  await t('Clips: your own clip from the lines you picked leads; untick it and the suggested clips move on', async () => {
    const mine = [P0.pieces[4].id, P0.pieces[11].id, P0.pieces[24].id];
    await layer('lines'); await pg.waitForSelector('#pieces-grid .pz');
    for (const id of mine) { await pg.click(`#pieces-grid .pz[data-piece="${id}"] .pz-body`); await until(async () => (await api('/api/pieces')).combo.ids.includes(id)); }
    await pg.waitForFunction(() => document.querySelectorAll('#combo-strip .cb').length === 3);
    assert.deepStrictEqual(await pg.$$eval('#combo-strip .cb', x => x.map(e => e.dataset.combo)), mine);
    assert.ok(/^3 lines, \d+ s, stitched in this order\.$/.test(await pg.textContent('#combo-sum')), await pg.textContent('#combo-sum'));
    await noOldWords('Best lines with your clip');
    await pg.click('#combo-to-clips'); await pg.waitForSelector(row('own') + '[data-keep="1"]');
    assert.strictEqual(await pg.$eval('#cut-candidates li.clip-row', e => e.dataset.id), 'own', 'your clip is the first row');
    assert.ok(/^Your clip$/.test(await pg.textContent(row('own') + ' .clip-h b'))); assert.ok(/^3 lines stitched, /.test(await pg.textContent(row('own') + ' .clip-m')));
    assert.strictEqual(await pg.textContent('#cut-own-wins'), 'Your own clip is what moves on. Untick it to use the clips below instead.');
    await pg.waitForFunction(() => /^1 clip kept, \d+ s\. It moves on to the next steps as one reel\.$/.test(document.querySelector('#cut-kept').textContent));
    let e = await api('/api/edit'); assert.ok(e.combo.pieces.length && e.combo.pieces.every(x => x.kind === 'piece'), JSON.stringify(e.combo.pieces.map(x => x.kind)));
    assert.deepStrictEqual(e.combo.pieces.flatMap(x => x.lines), mine); assert.ok(/^3 lines, \d+ s, in your order, built by you/.test(e.edit.from.text), e.edit.from.text);
    await shot(pg, 'cut-layers-clips.png');
    await pg.click('#keep-own'); await pg.waitForSelector(row('own') + '[data-keep="0"]');
    await pg.waitForSelector('#cut-own-wins', { state: 'detached' }); await pg.waitForFunction(() => /^3 clips kept, /.test(document.querySelector('#cut-kept').textContent));
    e = await api('/api/edit'); assert.deepStrictEqual(e.combo.pieces.map(x => [x.kind, x.id]), [A, B, S].map(c => ['cut', c.id])); assert.ok(/^3 clips, /.test(e.edit.from.text), e.edit.from.text);
    assert.strictEqual((await api('/api/pieces')).combo.off, true); assert.deepStrictEqual((await api('/api/pieces')).combo.ids, mine, 'your lines stay picked');
    await pg.click('#keep-own'); await pg.waitForSelector(row('own') + '[data-keep="1"]'); await pg.waitForSelector('#cut-own-wins');
    assert.ok((await api('/api/edit')).combo.pieces.every(x => x.kind === 'piece'));
    // Start over empties your clip; the suggested clips move on again
    await layer('lines'); assert.strictEqual(await pg.textContent('#pieces-own'), 'Start over'); await pg.click('#pieces-own');
    await until(async () => (await api('/api/pieces')).combo.ids.length === 0); await pg.waitForSelector('#pieces-own', { state: 'detached' });
    await layer('clips'); await pg.waitForSelector(row(A.id)); assert.strictEqual(await pg.$(row('own')), null);
    assert.ok((await api('/api/edit')).combo.pieces.every(x => x.kind === 'cut'));
  });

  await t('Pacing: Very tight takes the long pause out of the stitched preview and sets the pace of the draft', async () => {
    const pv = async () => (await api('/api/cut/preview?path=' + encodeURIComponent(take)));
    const nat = await pv(); assert.strictEqual(nat.pacing, 'natural'); assert.ok(nat.audio, 'the audio was read');
    assert.deepStrictEqual(nat.clips[B.id].spans.length, 1); assert.strictEqual(nat.clips[B.id].saved, 0);
    assert.deepStrictEqual(await pg.$$eval('#pacing [role="radio"], #pacing button', x => [...new Set(x.map(e => e.textContent.trim()).filter(Boolean))]), ['Natural', 'Tight', 'Very tight']);
    assert.ok(/Your pauses stay/.test(await pg.textContent('#pacing-says')));
    assert.ok(!/quiet out/.test(await pg.textContent(row(B.id) + ' .clip-m')));
    await pg.locator('#pacing').getByText('Very tight', { exact: true }).click();
    await pg.waitForSelector('#pacing[data-pacing="very"]');
    assert.strictEqual((await api('/api/state')).state.pace.tighten, 0.25);
    const very = await pv(), b = very.clips[B.id]; assert.strictEqual(very.pacing, 'very'); assert.strictEqual(very.maxPause, 0.25);
    assert.ok(b.spans.length >= 2, 'the clip plays in more stretches: ' + JSON.stringify(b.spans)); assert.ok(b.saved > 1 && b.seconds < nat.clips[B.id].seconds - 1, `the 1.5 s silence is out: saved ${b.saved}`);
    // every cut sits in the quiet between two lines: no stretch starts or ends inside a line
    for (const [a, z] of b.spans) for (const x of [a, z]) assert.ok(!LT.some(([s, e2]) => x > s + 0.02 && x < e2 - 0.02) || x === b.spans[0][0] || x === b.spans[b.spans.length - 1][1], 'a cut inside a line at ' + x);
    assert.ok(/Almost no quiet/.test(await pg.textContent('#pacing-says')));
    await pg.waitForFunction(id => /\d s of quiet out/.test(document.querySelector(`#cut-candidates li.clip-row[data-id="${id}"] .clip-m`).textContent), B.id);
    await shot(pg, 'cut-layers-pacing.png');
    // Tight sits between the two; Natural puts every pause back
    await pg.locator('#pacing').getByText('Tight', { exact: true }).click(); await pg.waitForSelector('#pacing[data-pacing="tight"]');
    assert.strictEqual((await api('/api/state')).state.pace.tighten, 0.45);
    const tight = (await pv()).clips[B.id]; assert.ok(tight.saved > 0.8 && tight.saved <= b.saved, `tight ${tight.saved} vs very tight ${b.saved}`);
    await pg.locator('#pacing').getByText('Natural', { exact: true }).click(); await pg.waitForSelector('#pacing[data-pacing="natural"]');
    assert.strictEqual((await api('/api/state')).state.pace.tighten, 'off'); assert.strictEqual((await pv()).clips[B.id].saved, 0);
    await pg.waitForFunction(id => !/quiet out/.test(document.querySelector(`#cut-candidates li.clip-row[data-id="${id}"] .clip-m`).textContent), B.id);
  });

  await t('the page says lines and clips: no Pieces, Combo, bites or Cuts and lines on any layer', async () => {
    // fill every layer first: your own clip, our clips, a clip your agent made from lines, the picker and the timeline open
    await api('/api/pieces', { choose: true });
    await api('/api/lines', { action: 'set', by: 'claude-code', bites: [{ name: 'The weekend build', lines: [5, 12], reason: 'One clear how-to' }] });
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#cut-body[data-layer="clips"]');
    await pg.waitForSelector(row('own')); await pg.waitForSelector('#cut-candidates li.clip-row:has-text("The weekend build"):has-text("By Claude")');
    await pg.click('#cut-change'); await pg.waitForSelector('#fmt-short'); await pg.click('#cut-trim > summary'); await pg.waitForSelector('#cut-timeline'); await pg.check('#cut-debug');
    await noOldWords('Clips');
    assert.ok(/\bclips?\b/i.test(await pg.innerText('#cut-clips')) && /lines? stitched/.test(await pg.innerText('#cut-clips')));
    await layer('lines'); await pg.waitForSelector('#combo-strip .cb'); await showAll(true);
    await pg.click('#pieces-grid .pz .pz-more'); await pg.waitForSelector('#pieces-grid .pz-menu');
    await noOldWords('Best lines');
    assert.ok(/^Use our \d+ best lines$/.test(await pg.textContent('#pieces-choose'))); assert.strictEqual(await pg.textContent('#combo-h'), 'Your clip');
    await pg.click('#pieces-grid .pz .pz-more'); await showAll(false);
    await layer('raw'); await pg.waitForSelector('#cut-raw'); await noOldWords('Raw take');
    await pg.click('#cut-change'); await api('/api/pieces', { clear: true }); await api('/api/lines', { action: 'set', bites: [] });
  });

  await t('new footage on a board with an edit is a new video: the point clears', async () => {
    assert.strictEqual((await api('/api/state')).state.point, POINT); assert.strictEqual(await pg.inputValue('#point'), POINT);
    assert.ok((await api('/api/cut')).candidates.length, 'the board has an edit');
    const up = await upload('footage', SECOND, 'second take.mp4'); assert.ok(up.path, JSON.stringify(up).slice(0, 300));
    const v = await api('/api/state'); assert.strictEqual(v.state.point, '', 'the point belonged to the video that was on the board');
    assert.strictEqual((await api('/api/edit')).point, ''); assert.ok(v.state.footage.includes(take) && v.state.footage.includes(up.path), 'both takes stay');
    await pg.waitForFunction(() => document.querySelector('#point').value === ''); await pg.waitForSelector('#point-hint');
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#point'); await wait(500); assert.strictEqual(await pg.inputValue('#point'), '');
  });

  assert.deepStrictEqual(errs.filter(e => !/favicon/.test(e)), []);
  await pg.close();
} finally {
  await browser.close(); srv.kill(); cleanJobs();
  rmSync(STATE, { recursive: true, force: true });
}
console.log(`\n${n} studio cut layers e2e tests passed`);
process.exit(0);
