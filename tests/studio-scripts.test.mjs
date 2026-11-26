// Studio scripts: word count and read time with [hook] [body] [cta] sections and [pause] marks; create, edit, rename,
// duplicate and delete over the page API; the MCP tools list_scripts, get_script and write_script on the same files;
// a local model (a fake OpenAI-compatible server) writing a script from the chat with the humanizer rules in its
// prompt; keywords mode saying scripts need an agent or a model; a take remembering its script, and the draft
// handing the script to Whisper (TX_PROMPT). Run: node tests/studio-scripts.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-scripts-test-')), JOB = 'scripts-test-' + process.pid;
process.env.STUDIO_DIR = STATE;
const SC = await import('../kit/studio/scripts.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

let lastSystem = '';
const llm = http.createServer((req, res) => {
  if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'fake' }] })); }
  let b = ''; req.on('data', d => b += d); req.on('end', () => { const j = JSON.parse(b); lastSystem = j.messages[0].content;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'Here is a 30 second script.', patch: {}, script: { title: 'Morning light', text: '[hook]\nI film every reel before coffee \u2014 here is why. [pause]\n[body]\nThe light is soft and nobody calls.\n[cta]\nTry it tomorrow.' } }) } }] }));
  });
});
await new Promise(r => llm.listen(0, '127.0.0.1', r));
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

let client;
try {
  await t('stats: words, read time at the WPM, sections with start times, pauses add 1.5 s', async () => {
    const st = SC.stats('[hook]\nOne two three four five.\n[body]\nSix seven [pause] eight nine ten.\n[cta]\nFollow.', 150);
    assert.strictEqual(st.words, 11); assert.strictEqual(st.pauses, 1);
    assert.strictEqual(st.seconds, Math.round(11 / 150 * 60 + 1.5));
    assert.deepStrictEqual(st.sections.map(x => x.name), ['hook', 'body', 'cta']); assert.strictEqual(st.sections[1].at, 2);
    const c = SC.cue('[hook]\nA b c.\nD [pause] e.', 60); assert.strictEqual(c[0].section, 'hook'); assert.strictEqual(c[1].text, 'D e.'); assert.strictEqual(c[1].dur, 2 + 1.5);
  });
  await t('page API: needs a job; create, edit, rename, duplicate, delete; bad input refused', async () => {
    assert.strictEqual((await req('/api/scripts', { title: 'x', text: 'y' })).status, 400);
    await req('/api/state', { job: JOB });
    const c = await req('/api/scripts', { title: 'My hook test', text: '[hook]\nHello there.' }); assert.strictEqual(c.status, 200, JSON.stringify(c.j));
    const id = c.j.script.id; assert.strictEqual(id, 'my-hook-test'); assert.ok(c.j.scripts.some(x => x.id === id && x.words === 2 && x.by === 'you'));
    const e = await req('/api/scripts', { id, text: 'Hello there, friend. [pause] Bye.', wpm: 120 }); assert.strictEqual(e.j.script.words, 4); assert.strictEqual(e.j.script.title, 'My hook test');
    assert.strictEqual((await req('/api/scripts', { id, wpm: 9 })).status, 400);
    assert.strictEqual((await req('/api/scripts/get?id=../../etc')).status, 400);
    const r = await req('/api/scripts/action', { id, action: 'rename', title: 'Renamed' }); assert.strictEqual(r.j.script.title, 'Renamed');
    const d = await req('/api/scripts/action', { id, action: 'duplicate' }); assert.strictEqual(d.j.script.title, 'Renamed copy'); assert.strictEqual(d.j.scripts.length, 2);
    const x = await req('/api/scripts/action', { id: d.j.script.id, action: 'delete' }); assert.strictEqual(x.j.scripts.length, 1);
    assert.ok(existsSync(join(STATE, 'scripts', JOB, id + '.json')));
  });
  await t('MCP: write_script saves a new script and replaces one by id; list_scripts and get_script read them; em dashes go', async () => {
    client = new Client({ name: 'scripts-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env, stderr: 'ignore' }));
    const tools = (await client.listTools()).tools, w = tools.find(x => x.name === 'write_script');
    assert.ok(/humanizer/.test(w.description) && tools.some(x => x.name === 'list_scripts') && tools.some(x => x.name === 'get_script'));
    const made = (await client.callTool({ name: 'write_script', arguments: { title: 'Agent draft', text: '[hook]\nShort reels win \u2014 mostly.\n[cta]\nSave this.', from: 'topic: short reels' } })).structuredContent.script;
    assert.ok(!made.text.includes('\u2014') && made.from === 'topic: short reels');
    await client.callTool({ name: 'write_script', arguments: { id: made.id, text: 'Tighter now.' } });
    const got = (await client.callTool({ name: 'get_script', arguments: { id: made.id } })).structuredContent.script; assert.strictEqual(got.text, 'Tighter now.'); assert.strictEqual(got.title, 'Agent draft');
    const l = (await client.callTool({ name: 'list_scripts', arguments: {} })).structuredContent; assert.ok(l.scripts.some(x => x.id === made.id));
    assert.ok((await req('/api/state')).j.scripts.some(x => x.id === made.id), 'the page sees it');
  });
  await t('keywords mode: a script request gets the one-line note; from-reference needs a breakdown', async () => {
    await req('/api/settings', { chat: { backend: 'keywords' } });
    const c = await req('/api/chat', { text: 'write a 30 second script about coffee' });
    assert.ok(/needs your agent, an API key or a local model/.test(c.j.reply), c.j.reply);
    assert.strictEqual((await req('/api/scripts/from-reference', {})).status, 400);
  });
  await t('local model: writes a script from the chat with the humanizer rules in the prompt; it is saved without em dashes', async () => {
    await req('/api/settings', { chat: { backend: 'local', baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'fake' } });
    const c = await req('/api/chat', { text: 'write a 30 second script on filming in the morning' });
    assert.ok(/Saved as the script "Morning light"/.test(c.j.reply), c.j.reply);
    assert.ok(/staged contrasts/.test(lastSystem) && /\[pause\]/.test(lastSystem), 'humanizer rules and format in the prompt');
    const sc = c.j.scripts.find(x => x.title === 'Morning light'); assert.ok(sc && sc.by === 'fake');
    assert.ok(!(await req('/api/scripts/get?id=' + sc.id)).j.script.text.includes('\u2014'));
  });
  await t('a take keeps the script it was read from; studio_takes shows it', async () => {
    const st = await req('/api/record/start', { mime: 'video/webm', script: { id: 'morning-light', title: 'Morning light', text: 'I film every reel before coffee.' } });
    const take = st.j.state.takes.find(x => x.id === st.j.id); assert.strictEqual(take.script.title, 'Morning light');
    const l = (await client.callTool({ name: 'studio_takes', arguments: {} })).structuredContent; assert.ok(l.takes.some(x => x.script && x.script.text === 'I film every reel before coffee.'));
    await req('/api/record/abort', { id: st.j.id });
  });
} finally {
  try { await client?.close(); } catch {}
  srv.kill(); llm.close();
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio script tests passed`);
process.exit(0);
