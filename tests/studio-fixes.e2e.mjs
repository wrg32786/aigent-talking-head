// Fix buttons in a real Chrome (v1.10.2): Studio never shows a terminal command for something missing.
// - Render: the "needs ffmpeg and Chrome" note has a link, Send to my agent and Copy for my agent; Copy puts a plain
//   instruction with the command on the clipboard; Review has its own note for Drafting; Draft (on Review) refused for a
//   missing tool shows the same buttons in the toast
// - Setup check: missing first, Install where Studio can do it (it runs setup --only <step> and says when it did not
//   finish), Send to my agent queues the ask in the Studio chat, which shows the short ask, not the command
// - the For your agent fold (under Review and Render) copies the reel as an instruction
// - no step (Start, Cut, Picture and its reference view, Text and graphics, B-roll, Music and sounds, Review, Render and
//   its Post view), drawer or toast shows a command as text
// Needs Chrome. Run: node tests/studio-fixes.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { CMD } from './studio-fixes.cmd.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-fixes-e2e-')), JOB = 'fixes-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_SETUP: 'tests/fixtures/fake-setup.mjs', STUDIO_SETUP_STATUS: join(ROOT, 'tests', 'fixtures', 'setup-missing.json'), STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
// a terminal agent that is connected and listening (what studio_wait_for_message writes)
const listen = () => writeFileSync(join(STATE, 'agent.json'), JSON.stringify({ name: 'claude-code', lastSeen: Date.now(), waiting: true }));
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
const errsOf = pg => { const e = []; pg.on('pageerror', x => e.push(x.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) e.push(m.text()); }); return e; };
const noCmd = async (pg, sel, what) => { const txt = await pg.evaluate(s => [...document.querySelectorAll(s)].map(e => e.innerText).join('\n'), sel); const m = txt.match(CMD); assert.ok(!m, `${what} shows a command: ...${m && txt.slice(Math.max(0, m.index - 60), m.index + 40)}...`); };
// Studio keeps a live connection, so wait for the page, not for a quiet network; about:blank first, so a link that only
// changes the hash still loads the page
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const shot = async (pg, name) => { if (shots) { await pg.waitForTimeout(800); await pg.screenshot({ path: join(shots, `noterm-${name}.png`) }); } };

try {
  await api('/api/state', { job: JOB });
  await fetch(`${url}/api/upload?kind=footage&name=take.mp4`, { method: 'POST', body: Buffer.alloc(64) });
  listen();
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }), pg = await ctx.newPage(), errs = errsOf(pg);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await pg.addInitScript(th => { try { localStorage.setItem('studio.theme', th); localStorage.setItem('studio.paused', '1'); } catch {} }, theme);
    const clip = () => pg.evaluate(() => navigator.clipboard.readText());
    await open(pg, '#step=render');
    await t(`${theme}: Render says what is missing with a link and the agent buttons; Copy gives the agent a plain instruction`, async () => {
      listen(); await pg.waitForSelector('#s-render .needfix [data-fix="ffmpeg"]');
      const row = pg.locator('#s-render .needfix').first();
      assert.match(await row.innerText(), /Rendering needs ffmpeg and Chrome, and they are not installed yet\./);
      assert.strictEqual(await row.locator('[data-fix="ffmpeg"] a.fix-link').getAttribute('href'), 'https://ffmpeg.org/download.html');
      await row.locator('[data-fix="ffmpeg"] button', { hasText: 'Send to my agent' }).waitFor();
      await row.locator('[data-fix="chrome"] button', { hasText: 'Copy for my agent' }).click();
      const c = await clip(); assert.ok(c.startsWith(`In my aigent-talking-head folder (${ROOT}), install Chrome for Studio by running `) && /restart Studio/.test(c), c);
      await pg.waitForSelector('#toast:not([hidden])'); assert.match(await pg.textContent('#toast'), /Paste it into your agent/);
      await noCmd(pg, '#s-render', 'Render');
      await shot(pg, `render-${theme}`);
    });
    await t(`${theme}: a refused Draft shows the fix buttons in the toast, not a command`, async () => {
      // Draft is on Review, with its own note: drafting needs ffmpeg, not Chrome
      await pg.click('#stepper [data-step="review"]'); await pg.waitForSelector('#s-review:not([hidden]) .needfix [data-fix="ffmpeg"]');
      assert.match(await pg.locator('#s-review .needfix').first().innerText(), /Drafting needs ffmpeg, and it is not installed yet\./);
      assert.strictEqual(await pg.$('#s-review .needfix [data-fix="chrome"]'), null);
      await noCmd(pg, '#s-review', 'Review');
      await pg.click('#draft');
      await pg.waitForSelector('#toast.has-fix [data-fix="ffmpeg"]');
      assert.match(await pg.textContent('#toast'), /ffmpeg is missing, so Studio cannot draft yet\./);
      await noCmd(pg, '#toast', 'the toast');
      await shot(pg, `toast-${theme}`);
    });
    await t(`${theme}: Setup check lists the missing first with Install, a link or the agent buttons; Install runs and reports back`, async () => {
      listen();
      await pg.click('#open-settings'); await pg.click('#settings-setup'); await pg.waitForSelector('#setup-list li[data-id="rea"] .fix');
      const ids = await pg.$$eval('#setup-list li[data-id]', l => l.map(x => x.dataset.id));
      assert.deepStrictEqual(ids.slice(0, 5), ['ffmpeg', 'chrome', 'ytdlp', 'effects', 'rea']); assert.strictEqual(ids.length, 13);
      for (const id of ['ytdlp', 'effects', 'rea']) await pg.locator(`#setup-list li[data-id="${id}"] button`, { hasText: /^(Install|Try again)$/ }).waitFor();
      for (const id of ['ffmpeg', 'chrome']) { assert.strictEqual(await pg.locator(`#setup-list li[data-id="${id}"] button`, { hasText: 'Install' }).count(), 0); await pg.locator(`#setup-list li[data-id="${id}"] a.fix-link`).waitFor(); }
      for (const id of ids.slice(0, 5)) await pg.locator(`#setup-list li[data-id="${id}"] button`, { hasText: 'Copy for my agent' }).waitFor();
      assert.strictEqual(await pg.locator('#setup-list li.ready .fix').count(), 0);
      await noCmd(pg, '#setup', 'Setup check');
      await shot(pg, `setup-${theme}`);
      if (theme === 'dark') {
        await pg.locator('#setup-list li[data-id="rea"] button', { hasText: 'Install' }).click();
        // the fixed status still says missing after the stand-in setup, so the row says so and offers the agent
        await pg.waitForSelector('#setup-list li[data-id="rea"] .fix-note');
        assert.match(await pg.textContent('#setup-list li[data-id="rea"]'), /Try again.*did not finish/s);
        const v = await api('/api/state'); assert.strictEqual(v.task.fix, 'rea'); assert.ok(v.task.lines.includes('fake setup --only rea'));
        await shot(pg, 'setup-install-result');
        listen(); await pg.locator('#setup-list li[data-id="rea"] button', { hasText: 'Send to my agent' }).click();
        await pg.waitForFunction(() => /Sent to your agent/.test(document.querySelector('#toast')?.textContent || ''));
        const last = (await api('/api/state')).state.chat.filter(m => m.role === 'user').pop();
        assert.match(last.text, /npm run setup:all -- --only rea/); assert.strictEqual(last.status, 'queued');
      }
      await pg.keyboard.press('Escape');
    });
    if (theme === 'dark') await t('dark: the chat shows the short ask, the agent gets the full instruction', async () => {
      await pg.click('#chat-open').catch(() => {});
      await pg.waitForSelector('#chat li.user >> text=Please install rea-video for Studio.');
      await noCmd(pg, '#chat', 'the chat');
      await shot(pg, 'chat-sent');
    });
    await t(`${theme}: For your agent copies this reel as an instruction; no step shows a command`, async () => {
      await open(pg, '#step=render'); await pg.waitForSelector('#s-render:not([hidden])');
      await pg.click('#cmd-fold .fold2-h'); await pg.click('#cmd-copy');
      assert.match(await clip(), /^In my aigent-talking-head folder, make this reel by running npm run reel -- /);
      await open(pg, '#step=review'); await pg.waitForSelector('#s-review:not([hidden])'); assert.ok(await pg.$('#run-foot #cmd-fold'), 'the same fold under Review');
      // every step and both second views (the reference view of Picture, the Post view of Render): [link, step, view]
      for (const [st, step, view] of [['start', 'start', 'main'], ['cut', 'cut', 'main'], ['picture', 'picture', 'main'], ['reference', 'picture', 'reference'], ['text', 'text', 'main'], ['broll', 'broll', 'main'], ['music', 'music', 'main'], ['review', 'review', 'main'], ['render', 'render', 'main'], ['post', 'render', 'post']]) {
        await open(pg, '#step=' + st); await pg.waitForSelector(`main[data-step="${step}"][data-view="${view}"] .step:not([hidden]) h2`); await noCmd(pg, 'body', 'step ' + st); }
      assert.deepStrictEqual(errs, []);
    });
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); }
console.log(`\n${n} studio fix e2e tests passed`);
