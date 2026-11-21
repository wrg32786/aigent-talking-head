// Settings folder fields: the folder list API and the native folder dialog hook, with a made-up home folder.
// - list: folder names only (never files), sorted, with the way up, the breadcrumb and the quick places; hidden and
//   secret folders (dot folders, AppData) are neither listed nor opened; nothing outside home, the kit, drives and
//   mounted volumes; a symlink out of home is not followed; ../ does not escape
// - the routes need the page header, refuse cross-site requests and other hosts
// - New folder (plain names only), Open folder (dry run), the native dialog (picked, cancelled, none here)
// Run: node tests/studio-folders.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = mkdtempSync(join(tmpdir(), 'studio-folders-test-')), HOME = join(TMP, 'home'), OUT = join(TMP, 'outside');
const VID = process.platform === 'darwin' ? 'Movies' : 'Videos'; // the home video folder is Movies on a Mac (kit/studio/folders.mjs places())
for (const d of ['Desktop', 'Downloads', VID, 'Documents', 'Projects/reels/2026', '.ssh', 'AppData/Roaming', 'node_modules/x']) mkdirSync(join(HOME, d), { recursive: true });
mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'private.txt'), 'outside'); mkdirSync(join(OUT, 'inner'));
writeFileSync(join(HOME, 'notes.txt'), 'a file, never listed'); writeFileSync(join(HOME, '.ssh', 'id_test'), 'secret');
try { symlinkSync(OUT, join(HOME, 'link-out'), 'dir'); } catch {}
process.env.STUDIO_HOME = HOME; process.env.STUDIO_FOLDERS_NO_OPEN = '1';
const F = await import('../kit/studio/folders.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

const env = { ...process.env, CI: '1', STUDIO_DIR: join(TMP, 'studio'), STUDIO_HOME: HOME, STUDIO_FOLDERS_NO_OPEN: '1', STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', DISPLAY: '', WAYLAND_DISPLAY: '', STUDIO_FOLDER_DIALOG: 'none' };
// the native dialog stand-ins are small node scripts, so they run on Windows as well as macOS and Linux
const PICKED = join(HOME, 'Projects', 'reels'), fake = join(TMP, 'fake-dialog.mjs'), cancel = join(TMP, 'cancel-dialog.mjs');
writeFileSync(fake, `import { writeFileSync } from 'fs';\nwriteFileSync(${JSON.stringify(join(TMP, 'dialog-args'))}, process.env.STUDIO_PICK_START + '|' + process.env.STUDIO_PICK_TITLE);\nprocess.stdout.write(${JSON.stringify(PICKED)} + '\\n');\n`);
writeFileSync(cancel, 'process.exit(1);\n');
const start = extra => new Promise((ok, bad) => {
  const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env: { ...env, ...extra } });
  let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok({ srv, url: m[1] }); }); srv.stderr.on('data', d => { out += d; });
  srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out.slice(-400))));
});
const call = async (url, path, body, headers = { 'x-studio-page': '1' }) => {
  const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

const servers = [];
try {
  await t('list: folder names only, sorted, hidden and secret folders left out, quick places, the way up', async () => {
    const v = F.list(HOME, ROOT);
    assert.deepStrictEqual(v.folders.map(f => f.name), ['Desktop', 'Documents', 'Downloads', 'Projects', VID].sort(), JSON.stringify(v.folders));
    assert.ok(!JSON.stringify(v).includes('notes.txt') && !JSON.stringify(v).includes('id_test'), 'files are never listed');
    assert.strictEqual(v.parent, null, 'home is the top of what Studio shows here');
    assert.deepStrictEqual(v.places.map(p => p.id).slice(0, 5), ['home', 'desktop', 'downloads', 'videos', 'documents']);
    assert.ok(v.places.some(p => p.id === 'kit'));
    const deep = F.list(join(HOME, 'Projects', 'reels', '2026'), ROOT);
    assert.strictEqual(deep.parent, join(HOME, 'Projects', 'reels'));
    assert.deepStrictEqual(deep.crumbs.map(c => c.name).slice(-3), ['Projects', 'reels', '2026']);
    assert.ok(deep.crumbs[0].path === HOME, 'the breadcrumb starts at home');
  });
  await t('list: no secrets, nothing outside home, the kit, drives and volumes; symlinks out and ../ do not escape', async () => {
    for (const p of [join(HOME, '.ssh'), join(HOME, 'AppData', 'Roaming'), OUT, join(HOME, 'Projects', '..', '..', 'outside'), '/etc', join(HOME, 'link-out')])
      assert.throws(() => F.list(p, ROOT), e => e.status === 403 || e.status === 404, p);
    assert.ok(!F.list(HOME, ROOT).folders.some(f => f.name === 'link-out'), 'a link out of home is not listed');
    assert.ok(F.allowed(join(ROOT, 'jobs'), ROOT) || !existsSync(join(ROOT, 'jobs')), 'the kit folder is allowed');
    assert.ok(F.blocked('.config') && F.blocked('AppData') && F.blocked('$RECYCLE.BIN') && !F.blocked(VID));
    assert.ok(F.blocked('Windows', true) && !F.blocked('Windows', false), 'Windows and ProgramData are blocked only at a drive root');
  });
  await t('New folder: plain names only, inside what Studio shows', async () => {
    const made = F.makeFolder(join(HOME, VID), 'Finished reels', ROOT); assert.ok(existsSync(made));
    for (const bad of ['', '../x', 'a/b', '.hidden', 'con:', 'x'.repeat(130), 'trailing.']) assert.throws(() => F.makeFolder(join(HOME, VID), bad, ROOT), e => e.status === 400, bad);
    assert.throws(() => F.makeFolder(join(HOME, VID), 'Finished reels', ROOT), e => e.status === 409);
    assert.throws(() => F.makeFolder(OUT, 'nope', ROOT), e => e.status === 403);
  });

  const a = await start({}); servers.push(a.srv);
  await t('routes: the page header is required, cross-site and other hosts are refused', async () => {
    assert.strictEqual((await call(a.url, '/api/folders', undefined, {})).status, 403, 'no header');
    assert.strictEqual((await call(a.url, '/api/folders', undefined, { 'x-studio-page': '1', 'sec-fetch-site': 'cross-site' })).status, 403, 'cross-site');
    assert.strictEqual((await call(a.url, '/api/folders/new', { path: HOME, name: 'x' }, { 'x-studio-page': '1', origin: 'https://evil.example' })).status, 403, 'other origin');
    const port = new URL(a.url).port;
    const r = await new Promise(ok => { import('http').then(({ request }) => { const q = request({ host: '127.0.0.1', port, path: '/api/folders', headers: { host: 'evil.example', 'x-studio-page': '1' } }, res => ok(res.statusCode)); q.end(); }); });
    assert.strictEqual(r, 403, 'DNS rebinding host');
  });
  await t('routes: list, outside refused, New folder, Open folder (dry run), settings show the default paths', async () => {
    const r = await call(a.url, '/api/folders'); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.path, HOME); assert.strictEqual(r.j.sep, sep);
    assert.ok(r.j.folders.some(f => f.name === VID) && !r.j.folders.some(f => f.name.startsWith('.')));
    assert.strictEqual((await call(a.url, '/api/folders?path=' + encodeURIComponent('/etc'))).status, 403);
    assert.strictEqual((await call(a.url, '/api/folders?path=' + encodeURIComponent(join(HOME, '.ssh')))).status, 403);
    const mk = await call(a.url, '/api/folders/new', { path: join(HOME, 'Desktop'), name: 'Reels out' }); assert.strictEqual(mk.status, 200); assert.strictEqual(mk.j.path, join(HOME, 'Desktop', 'Reels out'));
    const op = await call(a.url, '/api/folders/open', { path: join(HOME, 'Desktop') }); assert.strictEqual(op.status, 200); assert.ok(op.j.dry);
    assert.strictEqual((await call(a.url, '/api/folders/open', { path: OUT })).status, 403, 'Open folder only opens your folders');
    const st = (await call(a.url, '/api/state')).j.env.settings;
    assert.strictEqual(st.defaultDownloadsPath, join(ROOT, 'teardown-in', 'studio')); assert.strictEqual(st.defaultRendersPath, join(ROOT, 'jobs'));
    const typed = await call(a.url, '/api/settings', { renders: join(HOME, 'Projects', 'reels') }); assert.strictEqual(typed.status, 200, 'typing a path still works');
    assert.strictEqual((await call(a.url, '/api/folders/open', { path: join(HOME, 'Projects', 'reels') })).status, 200);
    await call(a.url, '/api/settings', { renders: null });
  });
  await t('native dialog: none on a computer without one, so the page uses its folder list', async () => {
    const r = await call(a.url, '/api/folders/pick', { start: HOME, title: 'Reference downloads' }); assert.strictEqual(r.status, 200); assert.ok(r.j.unavailable, JSON.stringify(r.j));
  });
  await t('one-line install: the Connect dialog, the README Quick start and docs/install.md agree', async () => {
    const { readFileSync } = await import('fs');
    const line = (await call(a.url, '/api/connect')).j.install; assert.ok(/docs\/install\.md and follow it to install, set up and connect Talking Head Studio in this agent, then open Studio\.$/.test(line), line);
    assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes(line), 'the README Quick start has the same line');
    const doc = readFileSync(join(ROOT, 'docs', 'install.md'), 'utf8');
    for (const w of ['setup:all', 'studio:connect -- claude', 'studio:connect -- codex', 'studio:connect -- cursor', 'gemini mcp add', 'opencode mcp add', 'studio:connect -- print', 'studio_start', 'setup_status', 'forUser']) assert.ok(doc.includes(w), 'docs/install.md covers ' + w);
    assert.ok(!/\u2014/.test(doc), 'no em dashes');
  });
  const b = await start({ STUDIO_FOLDER_DIALOG: fake }); servers.push(b.srv);
  await t('native dialog: returns the full path picked; the start folder and title go in by environment, not the script', async () => {
    const r = await call(b.url, '/api/folders/pick', { start: join(HOME, VID), title: 'Copy finished reels to' }); assert.strictEqual(r.j.path, PICKED);
    const { readFileSync } = await import('fs'); assert.strictEqual(readFileSync(join(TMP, 'dialog-args'), 'utf8'), join(HOME, VID) + '|Copy finished reels to');
    assert.strictEqual((await call(b.url, '/api/folders/pick', { start: HOME }, {})).status, 403, 'the agent or another site cannot open a dialog');
  });
  const c = await start({ STUDIO_FOLDER_DIALOG: cancel }); servers.push(c.srv);
  await t('native dialog: cancel changes nothing', async () => { const r = await call(c.url, '/api/folders/pick', {}); assert.ok(r.j.cancelled); });
  await t('dialog commands per system: PowerShell STA on Windows, osascript on macOS', async () => {
    delete process.env.STUDIO_FOLDER_DIALOG;
    process.env.STUDIO_FOLDERS_PLATFORM = 'win32'; let d = F.dialogCommand(); assert.strictEqual(d[0], 'powershell.exe'); assert.ok(d[1].includes('-STA') && /FolderBrowserDialog/.test(d[1].at(-1)) && !d[1].at(-1).includes(HOME));
    process.env.STUDIO_FOLDERS_PLATFORM = 'darwin'; d = F.dialogCommand(); assert.strictEqual(d[0], 'osascript'); assert.ok(/choose folder/.test(d[1][1]) && /system attribute "STUDIO_PICK_START"/.test(d[1][1]));
    process.env.STUDIO_FOLDERS_PLATFORM = 'linux'; const D = process.env.DISPLAY; process.env.DISPLAY = ''; process.env.WAYLAND_DISPLAY = ''; assert.strictEqual(F.dialogCommand(), null, 'no display, no dialog');
    if (D !== undefined) process.env.DISPLAY = D; delete process.env.STUDIO_FOLDERS_PLATFORM;
  });
} finally { for (const s of servers) s.kill(); rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${n} studio folder tests passed`);
