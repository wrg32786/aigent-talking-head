// The Studio review tools in a real Chrome, on synthetic media only (tests/fixtures/studio-media.mjs):
// - what to swap (Picture, the reference view): the reference's parts with times; a time button seeks the
//   reference, Use picks its look
// - clean-up pass (Review): a real draft from a clips folder with a filler word, a long pause and a retake, reviewed
//   and applied; the redraft's cut.json has the cuts as jump cuts and is shorter; the edit receipt (Review) lists
//   the clean-up
// - show original (Render, in the closed Compare fold): the reference beside and over your reel on one clock, the
//   opacity slider
// - comment on the preview (Render, same fold): drag a box on a frame, send it, and the chat line carries the frame
//   and the box
// The "reel" Studio compares against is the synthetic clips joined by ffmpeg, tagged as this draft (the test does not wait for a render).
// Needs Chrome and ffmpeg. Run: node tests/studio-review.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import http from 'http';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';
import { clipsFolder, referenceReel } from './fixtures/studio-media.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-review-e2e-')), JOB = 'review-e2e-' + process.pid, JOBDIR = join(ROOT, 'jobs', JOB);
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

// clips with a filler word, a long pause and a retake of the last line
const CL = join(JOBDIR, 'clips');
clipsFolder(CL, ['Stop editing reels by hand.', 'Record one take on your phone.', 'Drop the file in Studio.', 'Pick the look you like.', 'Then hit render.']);
copyFileSync(join(CL, 'clip-005.mp4'), join(CL, 'clip-006.mp4'));
const cj = JSON.parse(readFileSync(join(CL, 'clips.json'), 'utf8'));
cj.clips[0].words = [[0.1, 0.34, 'Stop'], [0.42, 0.62, 'um'], [0.7, 1.0, 'editing'], [1.05, 1.3, 'reels'], [1.35, 1.55, 'by'], [1.6, 1.85, 'hand.']]; cj.clips[0].text = 'Stop um editing reels by hand.';
cj.clips[2].words = [[0.1, 0.3, 'Drop'], [0.35, 0.55, 'the'], [1.5, 1.65, 'file'], [1.68, 1.78, 'in'], [1.8, 1.95, 'Studio.']];
cj.clips[4].status = 'retake (see clip-006)'; cj.clips.push({ ...cj.clips[4], id: 'clip-006', file: 'clips/clip-006.mp4', status: 'keep' });
writeFileSync(join(CL, 'clips.json'), JSON.stringify(cj));
const REF = referenceReel(join(STATE, 'ref.mp4'));
const media = http.createServer((req, res) => { if (req.url === '/ref.mp4') { const b = readFileSync(REF); res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': b.length }); return res.end(b); } res.writeHead(404); res.end(); });
await new Promise(r => media.listen(0, '127.0.0.1', r));

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const waitTask = async (ms = 10 * 60e3) => { const t0 = Date.now(); let v; do { await new Promise(r => setTimeout(r, 1000)); v = await api('/api/state'); } while ((!v.task || v.task.status === 'running') && Date.now() - t0 < ms); return v; };
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
// a fresh load of a link: via about:blank, because a new hash alone does not reload the page
const open = async (page, hash) => { await page.goto('about:blank'); await page.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#areas'); };
const c3 = c => c.segs.filter(s => /clip-003/.test(s.file));
// a screenshot of one panel, scrolled below the sticky header
const shot = async (page, sel, name) => {
  await page.evaluate(q => { const e = document.querySelector(q); e.scrollIntoView({ block: 'start' }); scrollBy(0, -(document.querySelector('header.top').offsetHeight + 12)); }, sel);
  await page.waitForTimeout(250);
  const b = await page.locator(sel).boundingBox(), vp = page.viewportSize(), top = Math.max(0, b.y);
  await page.screenshot({ path: join(shots, name), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, top - 8), width: Math.min(vp.width, b.width + 16), height: Math.min(vp.height - top, b.height + 16) } });
};
const segLen = c => c.segs.reduce((a, s) => a + s.out - s.in, 0);

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }));
try {
  await api('/api/state', { job: JOB, clips: `jobs/${JOB}/clips`, sound: { sfx: 'off' }, music: { bed: 'none' }, pack: 'cinematic' });
  await api('/api/reference/url', { url: `http://127.0.0.1:${media.address().port}/ref.mp4` });
  for (let i = 0; i < 200; i++) { const v = await api('/api/state'); if (v.swap && v.state.reference.status === 'ready' && v.task && v.task.status !== 'running') break; await new Promise(r => setTimeout(r, 300)); }
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await t('what to swap: parts with times; a time seeks the reference; Use picks the look', async () => {
    await open(pg, '#step=reference'); await pg.waitForSelector('#s-ref');
    assert.strictEqual(await pg.$eval('main', m => m.dataset.area), 'teardowns');
    await pg.waitForSelector('#ref-byhand > summary'); assert.strictEqual(await pg.$eval('#ref-byhand', e => e.open), false, 'Pick parts by hand starts closed'); await pg.click('#ref-byhand > summary');
    await pg.waitForSelector('#swap .sw-list li');
    const rows = await pg.$$eval('#swap .sw-list li .sw-k', x => x.map(e => e.textContent));
    assert.strictEqual(rows[0], 'Hook'); assert.ok(rows.includes('Cut') && rows.includes('Title') && rows.includes('CTA'), rows.join());
    await pg.click('#swap button[aria-label^="Watch Cut to shot 2"]');
    await pg.waitForFunction(() => { const v = document.querySelector('#swap video'); return v && Math.abs(v.currentTime - 5) < 0.6; }, null, { timeout: 8000 }).catch(async () => {
      // the synthetic reference is 6 s long, so a 5 s seek lands; anything else is a failure
      throw new Error('seek: ' + await pg.$eval('#swap video', v => v.currentTime)); });
    await pg.click('#swap button[aria-label^="Use the Cut to shot 2 look"]');
    await pg.waitForFunction(() => document.querySelector('#swap .sw-list li.sw-cut .chip.on'), null, { timeout: 5000 });
    const s = (await api('/api/state')).state; assert.ok(s.picks.transition && s.picks.transition.allow.includes('crossfade'), JSON.stringify(s.picks));
    if (shots) await shot(pg, '#swap', 'swap-desktop.png');
  });

  await t('clean-up pass: a real draft, the review list, apply and redraft: jump cuts, shorter, retake left out', async () => {
    const d = await api('/api/draft', {}); assert.ok(!d.error, 'draft refused: ' + d.error);
    const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 600));
    const before = JSON.parse(readFileSync(join(JOBDIR, 'build', 'cut.json'), 'utf8'));
    assert.ok(!before.segs.some(s => /clip-005/.test(s.file)), 'the retake is left out by default');
    // the reel Studio compares against: the clips joined (a stand-in for a render, which this test does not wait for)
    writeFileSync(join(STATE, 'list.txt'), ['001', '002', '003', '004', '006'].map(k => `file '${join(CL, `clip-${k}.mp4`)}'`).join('\n'));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(STATE, 'list.txt'), '-vf', 'scale=540:960', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', join(JOBDIR, 'reel-v1.mp4')]);
    await asCurrentDraft(JOB);
    await open(pg, '#step=review'); await pg.waitForSelector('#s-review:not([hidden])');
    await pg.waitForSelector('#cl-list li');
    const kinds = await pg.$$eval('#cl-list li', x => x.map(e => e.querySelector('.badge, [class*="badge"], span').textContent));
    const txt = await pg.textContent('#cl-list');
    assert.ok(/"um"/.test(txt) && /pause/.test(txt) && /Retake/.test(txt), txt + kinds);
    if (shots) await shot(pg, '#cleanup', 'cleanup-desktop.png');
    await pg.click('#cl-apply');
    await pg.waitForTimeout(500);
    const v2 = await waitTask(); assert.strictEqual(v2.task.status, 'done', JSON.stringify(v2.task).slice(0, 600));
    const after = JSON.parse(readFileSync(join(JOBDIR, 'build', 'cut.json'), 'utf8'));
    const covers = (c, x) => c.segs.some(s => /clip-001/.test(s.file) && s.in < x && s.out > x);
    assert.ok(covers(before, 0.52) && !covers(after, 0.52), 'the filler word is cut out');
    assert.ok(!c3(after).some(s => s.in < 1.0 && s.out > 1.0), 'the long pause is cut out');
    assert.ok(after.segs.filter(s => s.jump).length > before.segs.filter(s => s.jump).length, JSON.stringify(after.segs));
    assert.ok(segLen(before) - segLen(after) > 0.9, `${segLen(before)} -> ${segLen(after)}`);
    assert.ok(!after.segs.some(s => /clip-005/.test(s.file)));
    assert.ok(existsSync(join(JOBDIR, 'cleanup.json')));
    await asCurrentDraft(JOB);
  });

  await t('edit receipt: the draft in plain lines, with the clean-up', async () => {
    await open(pg, '#step=review'); await pg.waitForSelector('#s-review:not([hidden])');
    await pg.waitForSelector('#receipt .rc-sec');
    const r = await pg.textContent('#receipt');
    assert.ok(/Beat 1: opening shot/.test(r) && /Clean-up/.test(r) && /Why:|pack|locked|kit/.test(r), r.slice(0, 500));
    if (shots) await shot(pg, '#receipt', 'receipt-desktop.png');
  });

  await t('show original: side by side on one clock, overlay with opacity', async () => {
    await pg.click('#stepper button[data-step="render"]'); await pg.waitForSelector('#s-render:not([hidden])');
    await pg.waitForSelector('#compare-fold'); assert.strictEqual(await pg.$eval('#compare-fold', e => e.open), false, 'Compare starts closed'); await pg.click('#compare-fold > summary');
    await pg.waitForSelector('#compare .cmp-pane.ref video');
    await pg.waitForFunction(() => [...document.querySelectorAll('#compare video')].every(v => v.readyState >= 2), null, { timeout: 15000 });
    await pg.click('#cmp-play'); await pg.waitForTimeout(1500); await pg.click('#cmp-play');
    const [rt, bt] = await pg.$$eval('#compare video', v => v.map(x => x.currentTime));
    assert.ok(bt > 0.8 && Math.abs(rt - bt) < 0.3, `reference ${rt}, reel ${bt}`);
    await pg.fill('#cmp-offset', '1'); await pg.waitForTimeout(300);
    const [rt2, bt2] = await pg.$$eval('#compare video', v => v.map(x => x.currentTime));
    assert.ok(Math.abs(rt2 - bt2 - 1) < 0.3, `offset: reference ${rt2}, reel ${bt2}`);
    await pg.fill('#cmp-offset', '0');
    if (shots) await shot(pg, '#compare', 'compare-desktop.png');
    await pg.getByRole('radio', { name: 'Overlay' }).click().catch(() => pg.click('#compare >> text=Overlay'));
    await pg.waitForSelector('#cmp-opacity');
    await pg.focus('#cmp-opacity'); for (let i = 0; i < 15; i++) await pg.keyboard.press('ArrowLeft');
    const op = await pg.$eval('#compare .cmp-pane.ref', e => +e.style.opacity); assert.ok(Math.abs(op - 0.35) < 0.02, 'opacity ' + op);
    await pg.getByRole('radio', { name: 'Side by side' }).click().catch(() => pg.click('#compare >> text=Side by side'));
  });

  await t('comment on the preview: a box on a frame goes to the chat with the time, the box and the frame', async () => {
    await pg.click('#comment-start');
    await pg.evaluate(() => { document.querySelector('#compare .cmp-stage').scrollIntoView({ block: 'center' }); });
    const box = await pg.locator('#compare .cm-layer').boundingBox();
    await pg.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.25); await pg.mouse.down();
    await pg.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 6 }); await pg.mouse.up();
    await pg.fill('#comment-text', 'Move this title up a little');
    if (shots) await shot(pg, '#compare', 'comment-desktop.png');
    await pg.click('#comment-send');
    await pg.waitForFunction(() => !document.querySelector('#comment-text'), null, { timeout: 8000 });
    const m = (await api('/api/state')).state.chat.filter(x => x.role === 'user').pop();
    assert.strictEqual(m.attach.kind, 'comment'); assert.ok(m.attach.region.w > 0.5 && m.attach.region.h > 0.1, JSON.stringify(m.attach.region));
    assert.ok(existsSync(join(ROOT, m.attach.frame)) && readFileSync(join(ROOT, m.attach.frame)).length > 2000, 'frame saved');
    assert.ok(/^Comment on reel-v1\.mp4 at 0:0\d\.\d .*box from 20% to 80% across and 25% to 40% down: Move this title up a little Frame: /.test(m.text), m.text);
    await pg.click('#chat-open').catch(() => {});
    await pg.waitForSelector('#msgs li.comment img');
  });

  await t('phone layout: no sideways scroll in the reference view, Review and Render', async () => {
    const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
    ph.on('pageerror', e => errs.push(e.message));
    for (const step of ['reference', 'review', 'render']) {
      await open(ph, '#step=' + step); await ph.waitForSelector('main .step:not([hidden]) h2'); await ph.waitForTimeout(500);
      const over = await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 1, `${step} scrolls sideways by ${over}px`);
    }
    if (shots) { await ph.click('#compare-fold > summary'); await ph.locator('#compare').scrollIntoViewIfNeeded(); await ph.waitForTimeout(300); await ph.screenshot({ path: join(shots, 'review-phone.png') }); }
    await ph.close();
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); srv.kill(); media.close();
  rmSync(STATE, { recursive: true, force: true }); rmSync(JOBDIR, { recursive: true, force: true });
  rmSync(join(ROOT, 'teardown', `studio-${JOB}-r1`), { recursive: true, force: true }); rmSync(join(ROOT, 'teardown-in', 'studio', JOB), { recursive: true, force: true });
  rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`.slice(0, 48)), { recursive: true, force: true });
}
console.log(`${n} studio review browser tests passed`);
