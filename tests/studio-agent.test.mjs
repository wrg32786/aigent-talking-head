// Studio reference links and the terminal agent channel, end to end with no network and no real agent:
// - reference links: a direct .mp4 served by a local test server (a clip made at test time) is downloaded into the
//   download folder from settings, torn down (a stand-in teardown, STUDIO_TEARDOWN), shown with a summary, and used
//   by the keyword chat ("the transitions from the reference"); bad links and missing tools fail with a clear reason
// - settings: download folder validation, chat backends, a local OpenAI-compatible server and its model list
// - the agent channel: a scripted MCP client (the official SDK client over stdio, acting as the terminal agent) listens
//   with studio_wait_for_message, answers with studio_reply, and the page sees queued -> seen -> answered; terminal
//   edits show only an action note; the Claude Code hook reports waiting messages
// Run: node tests/studio-agent.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-agent-test-')), DL = join(STATE, 'downloads');
const JOB = 'agent-test-' + process.pid;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a small video made now (ffmpeg when present, otherwise an mp4 header the downloader accepts without ffprobe)
const CLIP = join(STATE, 'clip.mp4');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
if (hasFfmpeg) spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=24:duration=2', '-pix_fmt', 'yuv420p', CLIP]);
else { const b = Buffer.alloc(4096); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(CLIP, b); }
const media = http.createServer((req, res) => {
  if (req.url === '/clip.mp4') { const b = readFileSync(CLIP); res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': b.length }); return res.end(b); }
  if (req.url === '/page.mp4') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>not a video</html>'); }
  if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'llama3.2' }, { id: 'qwen2.5' }] })); }
  if (req.url === '/v1/chat/completions') { let b = ''; req.on('data', d => b += d); return req.on('end', () => { const j = JSON.parse(b);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: `local ${j.model} says calmer${/Reference teardown/.test(j.messages[0].content) ? ', teardown seen' : ''}`, patch: { music: { energy: 'low' } } }) } }] })); }); }
  res.writeHead(404); res.end();
});
await new Promise(r => media.listen(0, '127.0.0.1', r));
const MEDIA = `http://127.0.0.1:${media.address().port}`;

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', YTDLP: join(STATE, 'no-yt-dlp'), PATH: (process.env.PATH || '').split(':').filter(d => !existsSync(join(d, 'yt-dlp'))).join(':') };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const port = +url.split(':').pop();
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(150); } };

let client;
try {
  await t('settings: default backend is the terminal agent; a download folder is checked and saved', async () => {
    const s = await req('/api/state'); assert.strictEqual(s.j.env.backend, 'agent'); assert.strictEqual(s.j.env.agent.connected, false);
    assert.strictEqual((await req('/api/settings', { downloads: 'relative/path' })).status, 400);
    assert.strictEqual((await req('/api/settings', { downloads: CLIP })).status, 400);
    const ok = await req('/api/settings', { downloads: DL }); assert.strictEqual(ok.status, 200, JSON.stringify(ok.j)); assert.strictEqual(ok.j.settings.downloads, DL);
    assert.ok(existsSync(join(STATE, 'settings.json')));
  });
  await t('reference links: bad links and missing yt-dlp fail with the reason; a direct mp4 downloads, tears down and is used', async () => {
    await req('/api/state', { job: JOB });
    const r = await req('/api/reference/url', { urls: ['not a link', 'https://www.instagram.com/someone/', 'https://www.youtube.com/watch?v=abcdefghijk', `${MEDIA}/clip.mp4`] });
    assert.strictEqual(r.status, 202);
    const [a, b, c, d] = r.j.added;
    assert.strictEqual(a.status, 'failed'); assert.ok(/not a link/.test(a.error));
    assert.strictEqual(b.status, 'failed'); assert.ok(/one post/.test(b.error));
    assert.strictEqual(c.status, 'failed'); assert.ok(/yt-dlp/.test(c.error) && !/pip install|npm run/.test(c.error)); assert.strictEqual(c.fix, 'ytdlp');
    assert.strictEqual(d.status, 'queued'); assert.strictEqual(d.site, 'file');
    const done = await until(async () => { const s = (await req('/api/state')).j.state; const it = s.reference.queue.find(x => x.id === d.id); return it.status === 'ready' || it.status === 'failed' ? s : null; }, 120e3); // a download and a teardown: slow on a busy or Windows machine
    const it = done.reference.queue.find(x => x.id === d.id);
    assert.strictEqual(it.status, 'ready', it.error);
    assert.ok(it.file.startsWith(DL) && existsSync(it.file), 'saved in the download folder from settings');
    assert.strictEqual(done.reference.active, d.id); assert.strictEqual(done.reference.status, 'ready');
    const sm = done.reference.extracted.summary;
    assert.strictEqual(sm.shots, 5); assert.deepStrictEqual(sm.cuts, [5, 11, 18, 24]); assert.strictEqual(sm.pacing, 'slow');
    assert.ok(sm.suggestions.some(x => x.ref === 'transition:film') && sm.suggestions.some(x => x.ref === 'beatSync:beat-sync'));
  });
  await t('reference links: a page that is not a video fails clearly; retry and remove work', async () => {
    const r = await req('/api/reference/url', { url: `${MEDIA}/page.mp4` }), id = r.j.added[0].id;
    const it = await until(async () => { const x = (await req('/api/state')).j.state.reference.queue.find(q => q.id === id); return x.status === 'failed' ? x : null; }, 60e3);
    assert.ok(/not a video/.test(it.error), it.error);
    assert.strictEqual((await req('/api/reference/item', { id, action: 'remove' })).status, 200);
    assert.ok(!(await req('/api/state')).j.state.reference.queue.some(q => q.id === id));
  });
  await t('keyword chat uses the reference: "the transitions from the reference but calmer"', async () => {
    await req('/api/settings', { chat: { backend: 'keywords' } });
    const r = await req('/api/chat', { text: 'use the transitions from the reference but calmer' });
    assert.strictEqual(r.j.via, 'keywords');
    assert.deepStrictEqual(r.j.state.picks.transition.allow.sort(), ['crossfade', 'film']);
    assert.strictEqual(r.j.state.music.energy, 'low'); assert.ok(/from the reference/.test(r.j.reply));
  });
  await t('local model backend: model list, and the teardown is in the prompt', async () => {
    const m = await req('/api/llm/models?base=' + encodeURIComponent(MEDIA + '/v1')); assert.deepStrictEqual(m.j.models, ['llama3.2', 'qwen2.5']);
    await req('/api/settings', { chat: { backend: 'local', baseUrl: MEDIA + '/v1', model: 'qwen2.5' } });
    const r = await req('/api/chat', { text: 'calmer please' }); assert.strictEqual(r.j.via, 'local'); assert.ok(/local qwen2\.5/.test(r.j.reply) && /teardown seen/.test(r.j.reply), r.j.reply);
    assert.strictEqual((await req('/api/llm/models?base=' + encodeURIComponent('http://127.0.0.1:9/v1'))).status, 502);
    await req('/api/settings', { chat: { backend: 'agent' } });
  });
  await t('agent channel: a page message is queued, the hook reports it, nothing is marked seen', async () => {
    await req('/api/reset', {}); await req('/api/state', { job: JOB });
    const r = await req('/api/chat', { text: 'make the transitions whip only' });
    assert.strictEqual(r.j.via, 'agent'); const m = r.j.state.chat.at(-1); assert.strictEqual(m.status, 'queued'); assert.strictEqual(m.to, 'agent');
    const hook = spawnSync(process.execPath, [join(ROOT, 'kit', 'studio', 'hooks', 'studio-pending.mjs')], { input: JSON.stringify({ hook_event_name: 'PostToolUse' }), encoding: 'utf8', env: { ...env, STUDIO_PORT: String(port) } });
    const out = JSON.parse(hook.stdout); assert.ok(/1 message waiting/.test(out.hookSpecificOutput.additionalContext) && /whip only/.test(out.hookSpecificOutput.additionalContext));
    const stop = spawnSync(process.execPath, [join(ROOT, 'kit', 'studio', 'hooks', 'studio-pending.mjs')], { input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false }), encoding: 'utf8', env: { ...env, STUDIO_PORT: '9' } });
    assert.strictEqual(JSON.parse(stop.stdout).decision, 'block', 'falls back to the session file when Studio does not answer');
    assert.strictEqual(spawnSync(process.execPath, [join(ROOT, 'kit', 'studio', 'hooks', 'studio-pending.mjs')], { input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: true }), encoding: 'utf8', env }).stdout, '');
    assert.strictEqual((await req('/api/state')).j.state.chat.at(-1).status, 'queued');
  });
  await t('agent channel: a scripted MCP client listens, answers in Studio, and the page sees seen then answered', async () => {
    client = new Client({ name: 'claude-code', version: '0.0.0-test' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: String(port) }, stderr: 'ignore' }));
    const names = (await client.listTools()).tools.map(x => x.name);
    for (const x of ['studio_start', 'studio_wait_for_message', 'studio_get_pending', 'studio_reply', 'studio_add_reference_url', 'studio_get_reference_teardown', 'studio_settings']) assert.ok(names.includes(x), x);
    const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return r.structuredContent; };
    const st = await call('studio_start', { port, open: false }); assert.strictEqual(st.started, false); assert.strictEqual(st.url, url);
    const w = await call('studio_wait_for_message', { timeout_s: 5 });
    assert.strictEqual(w.messages.length, 1); assert.ok(/whip only/.test(w.messages[0].text)); assert.ok(w.context.reference);
    assert.strictEqual((await req('/api/state')).j.state.chat.at(-1).status, 'seen');
    const a = (await req('/api/state')).j.env.agent; assert.strictEqual(a.name, 'Claude Code'); assert.strictEqual(a.connected, true);
    await call('studio_reply', { replyTo: w.messages[0].id, text: 'Done: only whip transitions now.', patch: { picks: { 'transition:whip': 'allow' } } });
    const s = (await req('/api/state')).j.state;
    assert.deepStrictEqual(s.picks.transition.allow, ['whip']);
    assert.strictEqual(s.chat.find(x => x.id === w.messages[0].id).status, 'answered');
    const last = s.chat.at(-1); assert.strictEqual(last.role, 'assistant'); assert.strictEqual(last.replyTo, w.messages[0].id); assert.strictEqual(last.channel, 'studio');
    // listening: the page sees the agent waiting, and a new page line comes back within a second or two
    const waiting = call('studio_wait_for_message', { timeout_s: 20 });
    await until(async () => (await req('/api/state')).j.env.agent.listening);
    const t0 = Date.now(); await req('/api/chat', { text: 'add the film grain finish' });
    const w2 = await waiting; assert.ok(/film grain/.test(w2.messages[0].text)); assert.ok(Date.now() - t0 < 3000, 'answered within seconds');
    const none = await call('studio_wait_for_message', { timeout_s: 1 }); assert.strictEqual(none.timedOut, true);
    assert.deepStrictEqual((await call('studio_get_pending')).messages, []);
  });
  await t('channels: a terminal edit updates the page with an action note only; notes can be turned off', async () => {
    const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return r.structuredContent; };
    const before = (await req('/api/state')).j.state.chat.length;
    const r = await call('studio_set_selections', { origin: 'terminal', picks: { 'transition:zoom': 'allow' }, reply: 'terminal chatter that must not show', say: 'terminal line' });
    const s = (await req('/api/state')).j.state;
    assert.ok(s.picks.transition.allow.includes('zoom'));
    const added = s.chat.slice(before); assert.strictEqual(added.length, 1); assert.strictEqual(added[0].kind, 'action');
    assert.ok(/transition zoom/.test(added[0].text) && /from the terminal/.test(added[0].text)); assert.ok(!/chatter|terminal line/.test(JSON.stringify(s.chat)));
    assert.ok(r.actionNote);
    await call('studio_settings', { actionNotes: false });
    await call('studio_set_selections', { origin: 'terminal', picks: { 'transition:whip': 'clear' } });
    assert.strictEqual((await req('/api/state')).j.state.chat.length, before + 1);
    const td = await call('studio_get_reference_teardown'); assert.ok(Array.isArray(td.queue));
  });
  await t('AG-UI: observer stream, JSON Patch deltas, and a run answered by the terminal agent', async () => {
    const AG = await import('../kit/studio/agui.mjs');
    const a = { picks: { transition: { allow: ['whip'], deny: [] } }, music: { energy: 'auto' }, x: 1, 'a/b': 2 }, b = { picks: { transition: { allow: ['whip', 'zoom'], deny: [] } }, music: { energy: 'low' }, 'a/b': 3 };
    assert.deepStrictEqual(AG.applyPatch(a, AG.diff(a, b)), b);
    assert.strictEqual(AG.lastUserText({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }), 'hi');
    const events = [], ac = new AbortController();
    const sse = (text, out) => { for (const c of text.split('\n\n')) { const d = c.split('\n').find(l => l.startsWith('data: ')); if (d) out.push(JSON.parse(d.slice(6))); } };
    const obs = fetch(url + '/api/agui/events', { signal: ac.signal }).then(async r => { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const i = buf.lastIndexOf('\n\n'); if (i >= 0) { sse(buf.slice(0, i), events); buf = buf.slice(i + 2); } } }).catch(() => {});
    await until(() => events.length >= 2); // the first two events, not a fixed wait
    assert.deepStrictEqual(events.slice(0, 2).map(e => e.type), ['STATE_SNAPSHOT', 'MESSAGES_SNAPSHOT']);
    const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return r.structuredContent; };
    const waiting = call('studio_wait_for_message', { timeout_s: 20 });
    const run = fetch(url + '/api/agui', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ threadId: 't1', runId: 'r1', messages: [{ id: 'u1', role: 'user', content: 'make it punchy from AG-UI' }], tools: [], context: [], state: {}, forwardedProps: { timeout_s: 20 } }) }).then(r => r.text());
    const w = await waiting, mine = w.messages.at(-1); assert.strictEqual(mine.text, 'make it punchy from AG-UI');
    await call('studio_reply', { replyTo: mine.id, text: 'Punchier now.', patch: { music: { energy: 'high' } } });
    const evs = []; sse(await run, evs); const types = evs.map(e => e.type);
    assert.strictEqual(types[0], 'RUN_STARTED'); assert.strictEqual(types.at(-1), 'RUN_FINISHED'); assert.strictEqual(evs.at(-1).result.status, 'answered');
    assert.strictEqual(evs.find(e => e.type === 'TEXT_MESSAGE_CONTENT').delta, 'Punchier now.');
    assert.strictEqual(evs.find(e => e.type === 'STATE_SNAPSHOT').snapshot.music.energy, 'high');
    // wait for the observer to see the whole answer, then close it (a fixed 1.5 s was too short on a slow machine)
    await until(() => events.some(e => e.type === 'CUSTOM' && e.name === 'studio.message_status' && e.value.status === 'answered') && events.filter(e => e.type === 'STATE_DELTA').flatMap(e => e.delta).some(o => o.path === '/music/energy' && o.value === 'high')).catch(() => {});
    ac.abort(); await obs;
    const ot = events.map(e => e.type);
    assert.ok(ot.includes('STATE_DELTA') && ot.includes('TEXT_MESSAGE_START') && ot.includes('MESSAGES_SNAPSHOT'), ot.join(','));
    assert.ok(events.some(e => e.type === 'CUSTOM' && e.name === 'studio.message_status' && e.value.status === 'answered'), ot.join(','));
    assert.ok(events.filter(e => e.type === 'STATE_DELTA').flatMap(e => e.delta).some(o => o.path === '/music/energy' && o.value === 'high'));
    const bad = await fetch(url + '/api/agui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: 't', runId: 'r', messages: [], tools: [], context: [] }) }).then(r => r.text());
    assert.ok(/RUN_ERROR/.test(bad));
  });
} finally {
  try { await client?.close(); } catch {}
  srv.kill(); media.close();
  rmSync(STATE, { recursive: true, force: true });
  for (const d of [join(ROOT, 'teardown'), join(ROOT, 'teardown-in', 'studio')]) if (existsSync(d)) for (const f of readdirSync(d)) if (f.includes(JOB)) rmSync(join(d, f), { recursive: true, force: true });
  rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`.slice(0, 48)), { recursive: true, force: true });
}
console.log(`\n${n} studio agent tests passed`);
process.exit(0);
