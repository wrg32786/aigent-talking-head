// The wizards and Studio stopping while the page is open (1.27.2), in a real Chrome, with no keys and no network:
// - Copy a reference opens its own link screen (it used to show the clips screen), and Let my agent decide works there
// - Studio stops: the Studio stopped bar shows with Copy for my agent, and the wizards say Studio is not running with
//   Try again, not the browser's bare "Failed to fetch"
// - Studio starts again on the same port: the bar goes by itself and the wizards load
// Needs Chrome. Run: node tests/studio-offline.e2e.mjs   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-offline-e2e-')), JOB = 'offline-e2e-' + process.pid;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_BROLL_AUTO: '' };
const start = port => {
  const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', String(port), '--no-open'], { cwd: ROOT, env });
  const url = new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
  return { srv, url };
};
const stop = srv => new Promise(r => { if (srv.exitCode != null) return r(); srv.once('close', r); srv.kill(); });

let { srv, url } = start(0); url = await url;
const port = +url.split(':').pop();
await fetch(url + '/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: JOB }) });
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const errs = [];
try {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(url + '/#step=footage', { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#wizards-open');

  await t('wizards: Copy a reference opens the link screen, Let my agent decide works', async () => {
    await pg.click('#wizards-open'); await pg.waitForSelector('#wz-list');
    await pg.click('.wz-pick[data-wizard="reference"]');
    await pg.waitForSelector('#wz-url-in');
    assert.strictEqual(await pg.$('#wz-clips-go'), null, 'Copy a reference shows the clips screen');
    await pg.click('#wizards .wz-agent'); await pg.waitForFunction(() => !document.getElementById('wizards').open);
    assert.deepStrictEqual(errs, []);
  });

  await t('Studio stops: the bar with Copy for my agent, the wizards say Studio is not running with Try again', async () => {
    await stop(srv);
    await pg.waitForSelector('#studio-offline', { timeout: 15000 });
    assert.match(await pg.textContent('#studio-offline'), /Studio stopped/);
    assert.ok(await pg.$('#studio-offline button'), 'Copy for my agent');
    await pg.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  });

  await t('Studio starts again: the bar goes by itself and the wizards load', async () => {
    const back = start(port); srv = back.srv; await back.url;
    await pg.goto(url + '/#step=footage', { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#wizards-open');
    await stop(srv);
    await pg.click('#wizards-open'); await pg.waitForSelector('#wz-retry', { timeout: 10000 });
    const said = await pg.textContent('#wz-err');
    assert.match(said, /Studio is not running/); assert.doesNotMatch(said, /Failed to fetch/);
    const again = start(port); srv = again.srv; await again.url;
    await pg.waitForSelector('#wz-list', { timeout: 15000 });
    await pg.keyboard.press('Escape');
    await pg.waitForSelector('#studio-offline', { state: 'detached', timeout: 15000 });
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); await stop(srv);
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
  rmSync(STATE, { recursive: true, force: true });
}
console.log(`\n${n} studio offline e2e tests passed`);
process.exit(0);
