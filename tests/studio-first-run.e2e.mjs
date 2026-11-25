// The first run (the "mom test", docs/specs/studio-builder.md phase 11), in a real Chrome with no agent and no keys:
// a take already filmed waits in the Recording tab (a fixture clip, no camera); Use in a new video; Build my own; Next
// through every step with the choices as they come; Make my video (the call to action warning shows, since the take
// asks for nothing); Review shows the draft and its Plan check. No screen shows a command, terminal words or an em dash.
// Also: the Template Library on Teardowns lists a saved teardown template with its own picture, Delete asks in a
// dialog that Escape closes with focus back on the menu, and a library that fails to load offers Try again.
// Needs Chrome and ffmpeg. Run: node tests/studio-first-run.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-first-run-')), SDIR = join(STATE, 'studio'), LOOKS = join(STATE, 'looks');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
// a take filmed before any video was named: the holding folder the Recording tab lists (kit/studio/recordings.mjs)
const HOLD = join(ROOT, 'inbox', 'studio', '_recordings', 'takes'); mkdirSync(HOLD, { recursive: true });
const TAKE_N = 900 + (process.pid % 90), TAKE = join(HOLD, `take-${TAKE_N}.mp4`);
// never over a real take: stop before anything is written (or cleaned up) when the name is used
if (existsSync(TAKE) || existsSync(TAKE.replace(/\.mp4$/, '.json'))) { console.error(`${TAKE} already exists; not touching it`); process.exit(1); }
ff(['-f', 'lavfi', '-i', 'color=c=0x30384a:s=360x640:r=12:d=8', '-f', 'lavfi', '-i', 'sine=f=220:d=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', TAKE]);
writeFileSync(TAKE.replace(/\.mp4$/, '.json'), JSON.stringify({ seconds: 8, at: new Date().toISOString(), script: 'First run take' }));
// words with no call to action in them (fake-tx: matched by part of the file name)
const TXW = join(STATE, 'words.json');
writeFileSync(TXW, JSON.stringify({ ["takes/take-"]: { duration: 8, words: [[0.4, 0.9, 'This'], [0.95, 1.3, 'tool'], [1.35, 1.8, 'saves'], [1.85, 2.3, 'me'], [2.35, 3.1, 'hours.'], [3.6, 4.0, 'It'], [4.05, 4.5, 'reads'], [4.55, 5.0, 'my'], [5.05, 5.8, 'notes.'], [6.2, 6.7, 'Pretty'], [6.75, 7.5, 'neat.']] } }));
mkdirSync(SDIR, { recursive: true });
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, LOOKS_DIR: LOOKS, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_WORDS: TXW, FAKE_TX_DELAY: '50', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + '\n' + out))); setTimeout(() => bad(new Error('no server\n' + out)), 30000); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const BAD = /\bnpm\b|terminal|command line|\$ |\u2014/i;
const clean = async (pg, what) => { const txt = await pg.innerText('body'); const m = txt.match(BAD); assert.ok(!m, `${what} shows "${m && m[0]}": ${m && txt.slice(Math.max(0, m.index - 60), m.index + 60)}`); };
const shot = async (pg, name) => { if (!shots) return; await pg.waitForTimeout(300); await pg.screenshot({ path: join(shots, name), fullPage: true }); };
let job = null;

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));

  await t('a take waiting in Recording starts a new video with Use in a new video', async () => {
    await pg.goto(url + '/#tab=recording', { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#areas');
    const item = `.rec-item[data-file$="take-${TAKE_N}.mp4"]`; await pg.waitForSelector(item, { timeout: 20000 });
    await clean(pg, 'Recording'); await shot(pg, 'first-run-recording.png');
    await pg.click(`${item} .rec-new`);
    await pg.waitForFunction(async () => { const s = (await (await fetch('/api/state')).json()).state; return s.job && s.footage.length === 1; }, null, { timeout: 20000 });
    job = (await api('/api/state')).state.job; assert.ok(job);
  });

  await t('Build my own, then Next through every step with the choices as they come', async () => {
    await pg.goto('about:blank'); await pg.goto(url + '/#build=start', { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#build-own');
    await pg.click('#build-own'); await pg.waitForSelector('main[data-build="pace"]');
    await shot(pg, 'first-run-pacing.png');
    const seen = [];
    for (let k = 0; k < 40; k++) {
      const id = await pg.evaluate(() => document.querySelector('main').dataset.build);
      if (id === 'make') break;
      seen.push(id); await clean(pg, `the ${id} step`);
      if (id === 'pace') { await pg.click('#build-paces [data-pace="steady"]'); await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.pace === 'steady'); }
      if (id === 'captionType') { await pg.click('#build-type [data-opt="kinetic"]'); await pg.waitForSelector('#build-type [data-opt="kinetic"][aria-checked="true"]'); }
      await pg.waitForSelector('#build-next:not([disabled])', { timeout: 15000 }).catch(e => { throw new Error(`Next is not ready on the ${id} step (after ${seen.join(', ')}): ${e.message.split('\n')[0]}`); });
      await pg.click('#build-next'); await pg.waitForFunction(was => document.querySelector('main').dataset.build !== was, id, { timeout: 15000 });
    }
    assert.ok(seen.length >= 10, 'every step: ' + seen.join(', '));
    assert.ok(seen.includes('content') && seen.includes('notes'), seen.join(', '));
  });

  await t('Make my video: the missing call to action is said on the page, then Review shows the draft and its Plan check', async () => {
    await pg.waitForSelector('#build-make-go');
    // the words are heard once the take is transcribed (Cut or the draft does it); here we ask for it so the note can show before Make
    await pg.evaluate(async () => { const st = (await (await fetch('/api/state')).json()).state; await fetch('/api/cut/transcribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: st.footage[0] }) }); });
    await pg.waitForSelector('#build-make-cta', { timeout: 45000 }).catch(async e => { throw new Error('no call to action note; /api/plan/cta says ' + JSON.stringify(await pg.evaluate(async () => [await (await fetch('/api/plan/cta')).json(), await (await fetch('/api/state')).json()].map(x => x.state ? { footage: x.state.footage, tx: x.state.tx, job: x.state.job } : x))) + ': ' + e.message.split('\n')[0]); });
    assert.match(await pg.textContent('#build-make-cta'), /did not hear a call to action/);
    await clean(pg, 'Make it'); await shot(pg, 'first-run-make.png');
    await pg.click('#build-make-go');
    await pg.waitForFunction(async () => { const s = (await (await fetch('/api/state')).json()).state; return !!s.drafted; }, null, { timeout: 60000 });
    assert.ok(existsSync(join(ROOT, 'jobs', job, 'build', 'video-plan.json')), 'the plan sits beside the draft');
    await pg.waitForSelector('#plan-check', { timeout: 20000 });
    await pg.click('#plan-check-run'); await pg.waitForSelector('#plan-check-rows', { timeout: 20000 });
    // (the test reel has no word times of its own, so the Plan check may leave timing rows out; when it says anything about the call to action, it is that it is missing)
    assert.ok(await pg.$$eval('#plan-check-rows [data-check]', e => e.length) > 0, 'the plan check has rows');
    assert.ok(!(await pg.$('#plan-check-rows [data-check="cta"][data-ok="true"]')), 'the plan check never says a call to action was heard');
    assert.ok(await pg.isVisible('#plan-check-agent'), 'with no agent it says the looked-at checks need one');
    await clean(pg, 'Review'); await shot(pg, 'first-run-review.png');
  });

  await t('Teardowns: a saved teardown template has its own picture, Delete asks in a dialog, and a failed library load offers Try again', async () => {
    // a saved template with a picture, as Save as template writes after a breakdown (kit/studio/templates.mjs setThumb)
    process.env.LOOKS_DIR = LOOKS; const T = await import('../kit/studio/templates.mjs'), d = join(LOOKS, 'first-look');
    mkdirSync(d, { recursive: true });
    const plan = (await api('/api/video-plan')).plan; writeFileSync(join(d, 'template.json'), JSON.stringify({ format: 'aigent-template', version: 1, name: 'first-look', label: 'First look', createdAt: new Date().toISOString(), from: { kind: 'teardown-url', url: 'https://example.com/v' }, plan: { ...plan, notes: '' }, summary: {}, preview: null }));
    assert.ok(await T.setThumb('first-look', join(ROOT, (await api('/api/state')).state.footage[0])), 'a still from the video');
    await pg.goto('about:blank'); await pg.goto(url + '/#tab=teardowns', { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#template-library li[data-template="first-look"]');
    const src = await pg.getAttribute('#template-library li[data-template="first-look"] img', 'src'); assert.strictEqual(src, '/api/templates/preview/first-look');
    assert.ok(await pg.evaluate(async u => (await fetch(u)).headers.get('content-type'), src) === 'image/jpeg');
    await pg.click('#tpl-menu-first-look'); await pg.click('#tpl-del-first-look');
    await pg.waitForSelector('#tpl-del-dlg-first-look'); assert.ok(await pg.$('[role="alertdialog"]'), 'an alert dialog');
    await pg.keyboard.press('Escape'); await pg.waitForSelector('#tpl-del-dlg-first-look', { state: 'detached' });
    await pg.waitForFunction(() => document.activeElement && document.activeElement.id === 'tpl-menu-first-look', null, { timeout: 5000 });
    await pg.click('#tpl-menu-first-look'); await pg.click('#tpl-del-first-look'); await pg.click('#tpl-del-yes-first-look');
    await pg.waitForSelector('#template-library li[data-template="first-look"]', { state: 'detached' });
    assert.ok(!existsSync(d), 'the folder and its picture are gone');
    // the library fails once: Try again loads it
    let fails = 1; await pg.route('**/api/templates', r => { if (fails-- > 0) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down for a moment"}' }); return r.continue(); });
    await pg.goto('about:blank'); await pg.goto(url + '/#tab=teardowns', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#tlib-retry-manage'); await pg.click('#tlib-retry-manage'); await pg.waitForSelector('#tlib-start-h-manage');
    await pg.unroute('**/api/templates');
  });

  assert.deepStrictEqual(errs, [], 'no page errors');
  console.log(`\nstudio first run: ${n} tests passed`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  // CI: the four tests pass, then browser.close() can hang and smoke SIGKILLs the file after 360 s
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 8000))]);
  try { srv.kill(); } catch {}
  rmSync(STATE, { recursive: true, force: true }); rmSync(TAKE, { force: true }); rmSync(TAKE.replace(/\.mp4$/, '.json'), { force: true });
  if (job) { rmSync(join(ROOT, 'jobs', job), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', job), { recursive: true, force: true }); }
}
process.exit(process.exitCode || 0);
