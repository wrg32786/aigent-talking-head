// Post (the second view of the Render step) in a real Chrome, against a local mock of Buffer, R2 and the public link check (no network, no real keys):
// - Connect: Next stays off until the Buffer key is saved and a host is saved; R2 fields and the key pair; Check host
// - Channels: the reel, your Buffer channels, Facebook Reels marked "Can't post this one" for a 100 s reel, the caption count
// - Send: Drafts is the default and names the button; Post now needs the tick; a send lands as Buffer drafts and the
//   result lists each channel
// - light and dark themes; no sideways scroll on a 375 px phone; no page errors
// Needs Chrome and ffmpeg. Run: node tests/studio-post.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = mkdtempSync(join(tmpdir(), 'studio-post-e2e-')), JOB = 'post-e2e-' + process.pid, jobDir = join(ROOT, 'jobs', JOB);
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
mkdirSync(jobDir, { recursive: true });
spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24:duration=100', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=100', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', join(jobDir, 'reel-v1.mp4')]);

const BUF = 'buf-e2e-key-0123456789', posts = [], objects = new Set();
const CH = [{ id: 'ch-ig', name: 'aigent.ig', displayName: 'AIgent on Instagram', service: 'instagram', isQueuePaused: false }, { id: 'ch-fb', name: 'aigent.fb', displayName: 'AIgent Page', service: 'facebook', isQueuePaused: false },
  { id: 'ch-tt', name: 'aigent.tt', displayName: 'AIgent on TikTok', service: 'tiktok', isQueuePaused: false }, { id: 'ch-li', name: 'will', displayName: 'Will Gwyn', service: 'linkedin', isQueuePaused: false }];
const jsonRes = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const mock = http.createServer((req, res) => {
  const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), b = Buffer.concat(parts);
    if (u.pathname === '/gql') {
      if (req.headers.authorization !== 'Bearer ' + BUF) return jsonRes(res, 401, { errors: [{ message: 'Unauthorized' }] });
      const j = JSON.parse(b.toString());
      if (/StudioCreatePost/.test(j.query)) { posts.push(j.variables.input); return jsonRes(res, 200, { data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'p' + posts.length, status: j.variables.input.saveToDraft ? 'draft' : 'scheduled', dueAt: null } } } }); }
      if (/StudioChannels/.test(j.query)) return jsonRes(res, 200, { data: { channels: CH } });
      return jsonRes(res, 200, { data: { account: { organizations: [{ id: 'o1', name: 'AIgent' }] } } });
    }
    if (u.pathname.startsWith('/r2/')) { if (!/^AWS4-HMAC-SHA256 Credential=r2ak0001\//.test(req.headers.authorization || '')) { res.writeHead(403); return res.end(); } if (req.method === 'PUT') objects.add(u.pathname.split('/').slice(3).join('/')); res.writeHead(200); return res.end(); }
    if (u.pathname.startsWith('/pub/')) { res.writeHead(objects.has(u.pathname.split('/').slice(3).join('/')) ? 200 : 404, { 'content-type': 'video/mp4' }); return res.end(); }
    res.writeHead(404); res.end();
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r)); const M = `http://127.0.0.1:${mock.address().port}`;
// a stand-in for kit/export.mjs (the engine tests cover the real one): it writes a small 4:5 file beside the reel
const STUB = join(TMP, 'export-stub.mjs');
writeFileSync(STUB, `import { spawnSync } from 'child_process'; import { createRequire } from 'module';
const X = createRequire(import.meta.url)(${JSON.stringify(join(ROOT, 'kit', 'exports.cjs'))}), a = process.argv.slice(2), ex = a[a.indexOf('--export') + 1], file = a[a.indexOf('--file') + 1], out = X.outName(file, ex);
spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-t', '6', '-vf', 'crop=360:450:0:60', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p', out]); console.log(JSON.stringify({ ok: true, export: ex, file: out }));\n`);
const env = { ...process.env, CI: '1', STUDIO_EXPORT: relative(ROOT, STUB), STUDIO_DIR: join(TMP, 'studio'), STUDIO_CHAT: '', BUFFER_API_KEY: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
  STUDIO_API_BASE_BUFFER: M + '/gql', STUDIO_API_BASE_R2: M + '/r2', STUDIO_API_BASE_PUBLIC: M + '/pub' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out.slice(-400)))); });
const post = (p, b) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
await post('/api/settings', { chat: { backend: 'keywords' } }); await post('/api/state', { job: JOB });
// a fresh load of a link: via about:blank, because a new hash alone does not reload the page
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#stepper'); };
const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
const snap = async (pg, name, sel) => { if (!shots) return; await pg.waitForTimeout(500); if (sel) await pg.locator(sel).screenshot({ path: join(shots, name) }); else await pg.screenshot({ path: join(shots, name) }); };
try {
  const errs = [], ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } }), pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  await open(pg, '#step=post'); await pg.waitForSelector('#s-post');

  await t('Post is the second view of Render, the last step; Connect shows first; Next stays off until the key and a host are saved', async () => {
    assert.strictEqual(await pg.textContent('#stepper li:last-child button .sl'), 'Render');
    assert.strictEqual(await pg.getAttribute('#stepper li:last-child button', 'aria-current'), 'step');
    assert.strictEqual(await pg.$eval('main', m => m.dataset.step + ' ' + m.dataset.view), 'render post');
    assert.deepStrictEqual(await pg.$$eval('#render-switch [role="radio"]', x => x.map(b => [b.id, b.textContent, b.getAttribute('aria-checked')])), [['render-sub-main', 'Render', 'false'], ['render-sub-post', 'Post', 'true']]);
    assert.strictEqual(await pg.textContent('#s-post h2'), 'Post'); assert.ok(!(await pg.isVisible('#s-render')), 'the Render view is not on screen');
    assert.strictEqual(await pg.$('#your-edit'), null, 'the Your edit line is hidden on Post');
    await pg.waitForSelector('#post-buffer'); assert.ok(await pg.isDisabled('#post-next-channels'));
    assert.ok(await pg.isDisabled('#post-part-channels'));
    await snap(pg, 'post-connect-dark.png');
  });
  await t('Buffer key saved and tested; R2 picked, its fields and key pair saved; Check host; Next turns on', async () => {
    await pg.fill('#key-in-buffer', BUF); await pg.click('#key-save-buffer'); await pg.waitForSelector('#key-status-buffer >> text=Saved on this computer');
    await pg.click('#key-test-buffer'); await pg.waitForSelector('#key-res-buffer >> text=accepted');
    await pg.getByText('Cloudflare R2', { exact: true }).click(); await pg.waitForSelector('#post-fields-r2');
    await pg.fill('#post-r2-bucket', 'my-reels'); await pg.fill('#post-r2-publicBase', 'https://pub-test.r2.dev'); await pg.fill('#post-r2-account', '0123456789abcdef0123456789abcdef');
    await pg.fill('#key-in-r2', 'r2ak0001'); await pg.fill('#key-in2-r2', 'r2secret0001'); await pg.click('#key-save-r2'); await pg.waitForSelector('#key-status-r2 >> text=Saved on this computer');
    await pg.click('#post-host-save'); await pg.waitForSelector('#post-host-state >> text=Ready');
    await pg.click('#post-host-check'); await pg.waitForSelector('#post-host-res >> text=answered');
    await snap(pg, 'post-connect-filled-dark.png');
    assert.ok(!(await pg.isDisabled('#post-next-channels')));
    assert.ok(!(await pg.content()).includes('r2secret0001') && !(await pg.content()).includes(BUF), 'no key in the page');
  });
  await t('Channels: the reel, your Buffer channels, Facebook Reels marked as skipped for a 100 s reel, the caption count', async () => {
    await pg.click('#post-next-channels'); await pg.waitForSelector('.post-ch-list li[data-id="ch-ig"]');
    await pg.waitForFunction(() => /1 min 40 s/.test(document.querySelector('#post-reel-info').textContent));
    await pg.check('.post-ch-list li[data-id="ch-ig"] input'); await pg.check('.post-ch-list li[data-id="ch-fb"] input'); await pg.check('.post-ch-list li[data-id="ch-tt"] input');
    await pg.waitForSelector('.post-ch-list li[data-id="ch-fb"] >> text=Can\'t post this one');
    await pg.fill('#post-caption-in', 'Editing ate my weekends. Now it takes ten minutes. #aigent');
    await pg.waitForSelector('#post-caption-count >> text=/ 2200');
    await snap(pg, 'post-channels-dark.png');
  });
  await t('Send: Drafts is the default; Post now needs the tick; the send lands as Buffer drafts with a result per channel', async () => {
    await pg.click('#post-next-send'); await pg.waitForSelector('#post-send-go');
    assert.strictEqual((await pg.textContent('#post-send-go')).trim(), 'Send to Buffer as drafts');
    assert.match(await pg.textContent('#post-summary'), /2 channels \(1 skipped/);
    await pg.getByText('Post now', { exact: true }).click(); await pg.waitForSelector('#post-confirm-now');
    assert.ok(await pg.isDisabled('#post-send-go'), 'post now waits for the tick');
    await pg.getByText('Drafts', { exact: true }).click(); assert.ok(!(await pg.isDisabled('#post-send-go')));
    await pg.click('#post-send-go'); await pg.waitForSelector('#post-result', { timeout: 60000 });
    assert.match(await pg.textContent('#post-result h3'), /Sent to 2 channels as drafts/);
    assert.ok(posts.length === 2 && posts.every(p => p.saveToDraft === true && /^https:\/\/pub-test\.r2\.dev\//.test(p.assets[0].video.url)), JSON.stringify(posts));
    assert.ok(!posts.some(p => p.channelId === 'ch-fb'));
    assert.match(await pg.textContent('#post-result li[data-id="ch-fb"]'), /1 min 30 s/);
    await snap(pg, 'post-send-dark.png');
  });
  await t('Instagram Feed: the note says which file goes where; Feed asks for the 4:5, one button makes it, and the Feed draft gets that file', async () => {
    await pg.click('#post-back-channels'); await pg.waitForSelector('#post-where');
    assert.strictEqual((await pg.textContent('#post-where p')).trim(), 'Reels and Stories get the 9:16 file. The Instagram Feed gets the 4:5 file.');
    assert.strictEqual(await pg.$('#post-make-feed'), null, 'no button until a channel posts to the Feed');
    assert.deepStrictEqual(await pg.$$eval('#post-place-ch-ig [role="radio"]', x => x.map(b => [b.textContent, b.getAttribute('aria-checked')])), [['Reels', 'true'], ['Feed', 'false']]);
    assert.strictEqual(await pg.$('#post-place-ch-fb'), null, 'only Instagram has the choice');
    assert.match(await pg.textContent('.post-ch-list li[data-id="ch-ig"] .pc-file'), /Gets the 9:16 version/);
    await pg.click('#post-place-ch-ig [data-place="feed"]'); await pg.waitForSelector('#post-make-feed');
    assert.strictEqual((await pg.textContent('#post-make-feed')).trim(), 'Make it'); assert.strictEqual(await pg.getAttribute('#post-make-feed', 'aria-label'), 'Make the 4:5 version for the Feed');
    assert.ok(await pg.$('.post-ch-list li[data-id="ch-ig"] #post-make-feed'), 'the fix sits on the channel row'); assert.strictEqual(await pg.$('.post-ch-list li[data-id="ch-ig"] .pc-why'), null, 'the reason is said once');
    await pg.waitForSelector('.post-ch-list li[data-id="ch-ig"] >> text=Can\'t post yet'); assert.match(await pg.textContent('.post-ch-list li[data-id="ch-ig"] .pc-file'), /Needs the 4:5 version/);
    await pg.locator('#post-where').scrollIntoViewIfNeeded(); await snap(pg, 'post-feed-make-dark.png');
    await pg.click('#post-make-feed'); await pg.waitForSelector('.post-ch-list li[data-id="ch-ig"] .pc-file >> text=Gets the 4:5 version', { timeout: 60000 });
    assert.strictEqual(await pg.getAttribute('.post-ch-list li[data-id="ch-ig"] .pc-file', 'title'), 'reel-v1-feed-4x5.mp4', 'the file name is in the tooltip only'); assert.ok(existsSync(join(jobDir, 'reel-v1-feed-4x5.mp4')));
    await pg.waitForSelector('#post-make-feed', { state: 'detached' }); await pg.waitForSelector('.post-ch-list li[data-id="ch-ig"] >> text=Can\'t post yet', { state: 'detached' });
    assert.match(await pg.textContent('.post-ch-list li[data-id="ch-ig"] .pc-file'), /Gets the 4:5 version/);
    assert.strictEqual(await pg.inputValue('#post-reel-pick'), `jobs/${JOB}/reel-v1.mp4`, 'the reel stays picked; the 4:5 is listed with its label');
    assert.match(await pg.textContent('#post-reel-pick'), /Version 1 \(For the Instagram Feed\)/);
    await snap(pg, 'post-feed-note-dark.png');
    await pg.click('#post-next-send'); await pg.waitForSelector('#post-send-go');
    assert.match(await pg.textContent('#post-summary'), /reel-v1-feed-4x5\.mp4 to the Instagram Feed, reel-v1\.mp4 everywhere else/);
    assert.strictEqual((await pg.textContent('#post-send-go')).trim(), 'Send to Buffer as drafts');
    const n0 = posts.length; await pg.click('#post-send-go'); await pg.waitForFunction(n => document.querySelector('#post-result li[data-id="ch-ig"]') && /Feed, reel-v1-feed-4x5\.mp4/.test(document.querySelector('#post-result li[data-id="ch-ig"]').textContent), n0, { timeout: 60000 });
    const sent = posts.slice(n0), ig = sent.find(p => p.channelId === 'ch-ig'), tt = sent.find(p => p.channelId === 'ch-tt');
    assert.ok(sent.every(p => p.saveToDraft === true), 'drafts only'); assert.strictEqual(ig.metadata.instagram.type, 'post'); assert.notStrictEqual(ig.assets[0].video.url, tt.assets[0].video.url, 'the Feed got its own file');
  });
  await t('light theme: the view reads in brand cream', async () => {
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'light')); await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('.post-ch-list li[data-id="ch-ig"]');
    assert.strictEqual(await pg.evaluate(() => document.documentElement.dataset.theme), 'light');
    await pg.click('#post-place-ch-ig [data-place="feed"]'); await pg.waitForSelector('.post-ch-list li[data-id="ch-ig"] .pc-file >> text=Gets the 4:5 version'); await snap(pg, 'post-feed-note-light.png'); await pg.click('#post-place-ch-ig [data-place="reel"]');
    await snap(pg, 'post-channels-light.png');
    await pg.click('#post-part-connect'); await pg.waitForSelector('#post-buffer'); await snap(pg, 'post-connect-light.png');
    await pg.click('#post-part-send'); await pg.waitForSelector('#post-send-go'); await snap(pg, 'post-send-light.png');
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'dark'));
  });
  await t('no sideways scroll on a 375 px phone', async () => {
    const p2 = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage(); p2.on('pageerror', e => errs.push(e.message));
    await open(p2, '#step=post'); await p2.waitForSelector('.post-ch-list li');
    assert.ok(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sideways scroll on a phone');
    if (shots) await p2.screenshot({ path: join(shots, 'post-phone.png'), fullPage: true });
    await p2.context().close();
  });
  assert.deepStrictEqual(errs, []);
} finally { await browser.close(); srv.kill(); mock.close(); rmSync(TMP, { recursive: true, force: true }); rmSync(jobDir, { recursive: true, force: true }); }
console.log(`\n${n} studio post tests passed`);
