// Connect agent, setup check and footage from links, with no network: a local mock server stands in for Dropbox,
// Google Drive (including its "can't scan this file for viruses" confirm page) and a plain video host.
// - link parsing: Dropbox share links get dl=1, Drive file links become uc?export=download, folders and junk fail clearly
// - downloads: progress and size, the Drive confirm form (new and old style), private, expired and login links fail with
//   the login message, a web page or a non-video fails with its reason; the file lands in the footage like an upload
// - Connect agent: every agent's commands carry this install's absolute paths, the choice is remembered in settings
// - setup: the status list and the plain-words list for the user (kit/setup.mjs), and the MCP setup_status tool
// Run: node tests/studio-connect.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as CL from '../kit/studio/cloud.mjs';
import * as AGT from '../kit/studio/agents.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-connect-test-')), JOB = 'connect-test-' + process.pid;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(150); } };

// a "video": real mp4 bytes when ffmpeg is here, else an mp4 header; big enough for several progress chunks
const CLIP = join(STATE, 'clip.mp4');
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=24:duration=2', '-pix_fmt', 'yuv420p', CLIP]);
else { const b = Buffer.alloc(200e3); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(CLIP, b); }
const BODY = readFileSync(CLIP);
const ID = '1BigDriveFileIdXYZ', SMALL = '1SmallDriveFileXYZ', OLD = '1OldStyleConfirmXY', PRIV = '1PrivateDriveFileX';
const hits = [];
const send = (res, type, body, extra = {}) => { res.writeHead(200, { 'content-type': type, 'content-length': body.length, ...extra }); res.end(body); };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); hits.push(u.pathname + u.search);
  // Dropbox: /scl/fi/<id>/<name>?rlkey=..&dl=1 sends the file; dl=0 would be the preview page
  if (u.pathname.startsWith('/scl/fi/good/')) return u.searchParams.get('dl') === '1' ? send(res, 'application/octet-stream', BODY, { 'content-disposition': 'attachment; filename="raw take.mp4"' }) : send(res, 'text/html', Buffer.from('<html>preview</html>'));
  if (u.pathname.startsWith('/scl/fi/gone/')) { res.writeHead(404); return res.end('gone'); }
  // Drive: uc?export=download&id=
  if (u.pathname === '/uc') {
    const id = u.searchParams.get('id');
    if (u.searchParams.get('confirm') === 'Xy12') return send(res, 'video/quicktime', BODY, { 'content-disposition': 'attachment; filename="old style"' });
    if (id === SMALL) return send(res, 'video/mp4', BODY, { 'content-disposition': `attachment; filename*=UTF-8''small%20clip.mp4` });
    if (id === ID) return send(res, 'text/html; charset=utf-8', Buffer.from(`<html><body>Google Drive can't scan this file for viruses.<form id="download-form" action="http://${req.headers.host}/download" method="get"><input type="submit" value="Download anyway"/><input type="hidden" name="id" value="${ID}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="abc-123"></form></body></html>`));
    if (id === OLD) return send(res, 'text/html', Buffer.from(`<a id="uc-download-link" href="/uc?export=download&amp;confirm=Xy12&amp;id=${OLD}&amp;go=1">Download anyway</a>`));
    if (id === PRIV) { res.writeHead(302, { location: `http://${req.headers.host}/ServiceLogin?continue=x` }); return res.end(); }
  }
  if (u.pathname === '/download' && u.searchParams.get('confirm') === 't' && u.searchParams.get('uuid') === 'abc-123') return send(res, 'video/mp4', BODY, { 'content-disposition': 'attachment; filename="big take.mp4"' });
  if (u.pathname === '/ServiceLogin') return send(res, 'text/html', Buffer.from('<html>Sign in</html>'));
  if (u.pathname === '/video.mp4') return send(res, 'video/mp4', BODY);
  if (u.pathname === '/page') return send(res, 'text/html', Buffer.from('<html>a page</html>'));
  if (u.pathname === '/doc.pdf') return send(res, 'application/pdf', Buffer.from('%PDF'));
  if (u.pathname === '/forbidden.mp4') { res.writeHead(403); return res.end(); }
  res.writeHead(404); res.end();
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;
const bases = { drive: MOCK, dropbox: MOCK };

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_CLOUD_DRIVE: MOCK, STUDIO_CLOUD_DROPBOX: MOCK };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };

let client;
try {
  await t('link parsing: Dropbox gets dl=1, Drive becomes uc?export=download, folders and junk fail with the reason', async () => {
    const d = CL.parse('https://www.dropbox.com/scl/fi/abc123/My%20Take.mp4?rlkey=k1&dl=0');
    assert.strictEqual(d.site, 'dropbox'); assert.strictEqual(new URL(d.url).searchParams.get('dl'), '1'); assert.strictEqual(new URL(d.url).searchParams.get('rlkey'), 'k1'); assert.strictEqual(d.name, 'My Take.mp4');
    assert.strictEqual(new URL(CL.parse('https://dropbox.com/s/xyz/a.mov?raw=1').url).searchParams.get('raw'), null);
    for (const u of ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing', 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp', 'https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOp&export=download', 'https://drive.google.com/file/u/0/d/1AbCdEfGhIjKlMnOp/view'])
      assert.strictEqual(CL.parse(u).url, 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp', u);
    assert.match(CL.parse('https://drive.google.com/drive/folders/1xyzxyzxyzxyz').error, /folder/);
    assert.match(CL.parse('https://www.dropbox.com/scl/fo/abc/def?rlkey=1').error, /folder/);
    assert.match(CL.parse('https://www.dropbox.com/home/Videos').error, /folder/);
    assert.match(CL.parse('not a link').error, /full link/);
    assert.match(CL.parse('ftp://example.com/a.mp4').error, /http/);
    assert.strictEqual(CL.parse('https://cdn.example.com/raw/take%201.mov').site, 'direct');
    assert.strictEqual(CL.parse('https://www.dropbox.com/scl/fi/abc/a.mp4?dl=0', bases).url.startsWith(MOCK), true);
  });
  await t('Drive confirm page: the new form and the old confirm link both give the download URL', async () => {
    const html = `<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="${ID}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u-1"></form>`;
    const a = new URL(CL.confirmUrl(html, 'https://drive.google.com/uc?id=' + ID));
    assert.strictEqual(a.host, 'drive.usercontent.google.com'); assert.strictEqual(a.searchParams.get('confirm'), 't'); assert.strictEqual(a.searchParams.get('uuid'), 'u-1'); assert.strictEqual(a.searchParams.get('id'), ID);
    const b = new URL(CL.confirmUrl('<a href="/uc?export=download&amp;confirm=AbC1&amp;id=X">x</a>', 'https://drive.google.com/uc'));
    assert.strictEqual(b.searchParams.get('confirm'), 'AbC1');
    assert.strictEqual(CL.confirmUrl('<html>Sign in</html>', 'https://drive.google.com/'), null);
  });
  await t('downloads: Dropbox, small Drive, big Drive through the confirm page, old-style confirm, direct; progress and size', async () => {
    const dir = mkdtempSync(join(STATE, 'dl-'));
    const prog = [];
    const a = await CL.download(CL.parse('https://www.dropbox.com/scl/fi/good/raw%20take.mp4?rlkey=r&dl=0', bases), dir, { onProgress: p => prog.push(p) });
    assert.strictEqual(a.name, 'raw take.mp4'); assert.strictEqual(a.size, BODY.length); assert.strictEqual(prog.at(-1).received, BODY.length); assert.strictEqual(prog.at(-1).size, BODY.length);
    assert.ok(hits.some(h => h.startsWith('/scl/fi/good/') && h.includes('dl=1')));
    const b = await CL.download(CL.parse(`https://drive.google.com/file/d/${SMALL}/view`, bases), dir); assert.strictEqual(b.name, 'small clip.mp4');
    const c = await CL.download(CL.parse(`https://drive.google.com/file/d/${ID}/view?usp=sharing`, bases), dir); assert.strictEqual(c.name, 'big take.mp4'); assert.strictEqual(statSync(c.file).size, BODY.length);
    const d = await CL.download(CL.parse(`https://drive.google.com/open?id=${OLD}`, bases), dir); assert.strictEqual(d.name, 'old style.mov');
    const e = await CL.download(MOCK + '/video.mp4', dir); assert.strictEqual(e.name, 'video.mp4');
    const e2 = await CL.download(MOCK + '/video.mp4', dir); assert.strictEqual(e2.name, 'video-2.mp4', 'never overwrites');
    assert.ok(!existsSync(join(dir, 'video.mp4.part')));
  });
  await t('downloads: private, expired and login links say they need a login; a web page or a PDF says why', async () => {
    const dir = mkdtempSync(join(STATE, 'bad-'));
    await assert.rejects(CL.download(CL.parse(`https://drive.google.com/file/d/${PRIV}/view`, bases), dir), { message: CL.LOGIN });
    await assert.rejects(CL.download(CL.parse('https://www.dropbox.com/scl/fi/gone/a.mp4?rlkey=x', bases), dir), { message: CL.LOGIN });
    await assert.rejects(CL.download(MOCK + '/forbidden.mp4', dir), { message: CL.LOGIN });
    await assert.rejects(CL.download(MOCK + '/page', dir), /web page, not a video/);
    await assert.rejects(CL.download(MOCK + '/doc.pdf', dir), /application\/pdf, not a video/);
    await assert.rejects(CL.download(MOCK + '/missing.mp4', dir), /404/);
    await assert.rejects(CL.download(MOCK + '/video.mp4', dir, { maxBytes: 10 }), /limit/);
  });
  await t('Studio: a pasted Drive link downloads into the footage folder and the footage list, a private one fails in the list', async () => {
    assert.strictEqual((await req('/api/footage/url', { url: 'https://drive.google.com/file/d/' + ID + '/view' })).status, 400, 'needs a job');
    await req('/api/state', { job: JOB });
    const r = await req('/api/footage/url', { url: `https://drive.google.com/file/d/${ID}/view?usp=sharing` }); assert.strictEqual(r.status, 202, JSON.stringify(r.j));
    const s = await until(async () => { const v = (await req('/api/state')).j.state; return v.imports.find(x => x.id === r.j.id && x.status !== 'downloading') && v; });
    const it = s.imports.find(x => x.id === r.j.id);
    assert.strictEqual(it.status, 'ready', JSON.stringify(it)); assert.strictEqual(it.size, BODY.length); assert.strictEqual(it.file, `inbox/studio/${JOB}/big take.mp4`);
    assert.ok(s.footage.includes(it.file)); assert.ok(existsSync(join(ROOT, it.file)));
    const p = await req('/api/footage/url', { url: `https://drive.google.com/file/d/${PRIV}/view` });
    const f = await until(async () => (await req('/api/state')).j.state.imports.find(x => x.id === p.j.id && x.status === 'failed'));
    assert.strictEqual(f.error, CL.LOGIN);
    assert.strictEqual((await req('/api/footage/url', { url: 'https://drive.google.com/drive/folders/1abcabcabcabc' })).status, 400);
    const d = await req('/api/footage/import', { id: p.j.id, action: 'dismiss' }); assert.ok(!d.j.state.imports.some(x => x.id === p.j.id));
  });
  await t('Connect agent: every agent has commands with this install\'s absolute paths; the choice is remembered', async () => {
    const c = (await req('/api/connect')).j;
    assert.deepStrictEqual(c.agents.map(a => a.id), AGT.IDS);
    for (const a of c.agents) {
      assert.ok(a.steps.length && a.say.startsWith('Run the Studio chat loop'), a.id);
      assert.ok(a.steps.some(s => s.code.includes(join(ROOT, 'kit', 'mcp.mjs')) || s.code.includes(JSON.stringify(join(ROOT, 'kit', 'mcp.mjs')))), a.id + ' has the MCP path');
      assert.ok(a.docs.every(d => d.startsWith('https://')), a.id);
      assert.ok(!/\u2014/.test(JSON.stringify(a)), 'no em dashes');
    }
    assert.match(c.agents.find(a => a.id === 'claude').steps[0].code, /^claude mcp add .*--transport stdio --scope user aigent-talking-head -- /);
    assert.match(c.agents.find(a => a.id === 'claude').steps[1].code, /connect\.mjs claude --user$/);
    assert.match(c.agents.find(a => a.id === 'codex').steps[1].code, /\[mcp_servers\.aigent-talking-head\]\ncommand = ".+"\nargs = \[".+mcp\.mjs"\]\ntool_timeout_sec = 300/);
    assert.ok(JSON.parse(c.agents.find(a => a.id === 'cursor').steps[0].code).mcpServers['aigent-talking-head'].args[0].endsWith('mcp.mjs'));
    assert.strictEqual(JSON.parse(c.agents.find(a => a.id === 'opencode').steps[1].code).mcp.servers['aigent-talking-head'].type, 'local');
    assert.strictEqual(c.agents.find(a => a.id === 'windsurf').verified, false);
    assert.ok(c.prompt.includes(join(ROOT, 'AGENTS.md')) && c.prompt.includes(url));
    assert.strictEqual(c.selected, null);
    assert.strictEqual((await req('/api/settings', { agent: 'nope' })).status, 400);
    assert.strictEqual((await req('/api/settings', { agent: 'gemini' })).j.settings.agent, 'gemini');
    assert.strictEqual((await req('/api/connect')).j.selected, 'gemini');
    assert.strictEqual(JSON.parse(readFileSync(join(STATE, 'settings.json'), 'utf8')).agent, 'gemini');
    // a path with a space is quoted for the shell
    const sp = AGT.setups({ node: '/Applications/My Node/node', mcp: '/Users/a b/kit/mcp.mjs', py: null });
    assert.match(sp[0].steps[0].code, /-- "\/Applications\/My Node\/node" "\/Users\/a b\/kit\/mcp\.mjs"$/);
    assert.ok(isAbsolute(AGT.MCP));
  });
  await t('setup: the status lists each dependency with its fix; the user list is plain words; setup_status over MCP; Studio serves it', async () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'kit', 'setup.mjs'), '--check', '--json'], { cwd: ROOT, encoding: 'utf8', env });
    const s = JSON.parse(r.stdout);
    assert.deepStrictEqual(s.items.map(x => x.id), ['node', 'npm', 'python', 'ffmpeg', 'chrome', 'model', 'ytdlp', 'instaloader', 'effects', 'mask', 'rea', 'humanizer', 'studio']);
    for (const x of s.items) { assert.ok(['ready', 'missing'].includes(x.status)); if (x.status === 'missing') assert.ok(x.fix, x.id + ' has a fix'); }
    assert.strictEqual(r.status, s.ready ? 0 : 1);
    const api = await until(async () => (await req('/api/setup')).j.items && (await req('/api/setup')).j);
    assert.strictEqual(api.items.length, s.items.length);
    // a missing ffmpeg: the user line says it needs their password when the fix is sudo
    const { tellUser } = await import('../kit/setup.mjs');
    assert.strictEqual(tellUser({ id: 'ffmpeg', label: 'ffmpeg and ffprobe', fix: 'sudo apt-get install -y ffmpeg' }), 'Installing ffmpeg and ffprobe needs your password: run sudo apt-get install -y ffmpeg');
    client = new Client({ name: 'claude-code', version: '0.0.0-test' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: url.split(':').pop() }, stderr: 'ignore' }));
    const st = (await client.callTool({ name: 'setup_status', arguments: {} })).structuredContent;
    assert.ok(Array.isArray(st.items) && Array.isArray(st.forUser) && typeof st.ready === 'boolean');
  });
} finally {
  try { await client?.close(); } catch {}
  srv.kill(); mock.close();
  rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
  rmSync(STATE, { recursive: true, force: true });
}
console.log(`${n} studio connect tests passed`);
