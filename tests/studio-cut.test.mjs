// Studio Cut step: the Output choice (format, length, output, goal, smart defaults, the one-line summary), candidates
// from a transcript (best version, parts, clips, ad cuts) with times, scores and reasons, clean-up marks, a script
// pulled from a transcript; then over the page API with a stand-in transcriber (tests/fixtures/fake-tx.mjs): chunked
// transcription with progress, find, keep, drop, trim, add, reorder; the MCP tools set_output, get_cuts and set_cuts;
// a local model (a fake OpenAI-compatible server) scoring cuts and adapting a script; your agent getting the adapt ask.
// No ffmpeg or Python needed. Run: node tests/studio-cut.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as CUT from '../kit/studio/cut.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-cut-test-')), JOB = 'cut-test-' + process.pid;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// words for a take of about `secs` seconds: a sentence every ~3.5 s, a filler and a long pause now and then
function talk(secs) {
  const L = ['What if your next reel took ten minutes?', 'Um, most people overthink it.', 'Here is the setup I use.', 'One window and one phone.', 'Why does it work so well?', 'The second take sounds like me.', 'Follow for more tips.'];
  const w = []; let x = 0.3, k = 0;
  while (x < secs - 4) { for (const word of L[k % L.length].split(' ')) { w.push([+x.toFixed(2), +(x + 0.3).toFixed(2), word]); x += 0.38; } x += k % 5 === 4 ? 1.5 : 0.4; k++; }
  return w;
}

let lastUser = '';
const llm = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'fake-scorer' }] })); }
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b), user = j.messages[1].content; lastUser = user; let content;
    if (/Score each candidate/.test(user)) { const ids = [...user.matchAll(/"id":"([a-z0-9]+)"/g)].map(m => m[1]); content = JSON.stringify({ scores: ids.map((id, i) => ({ id, score: 90 - i, reason: `Model says ${id} \u2014 strong` })) }); }
    else content = JSON.stringify({ title: 'Meal prep in ten minutes', text: '[hook]\nWhat if dinner took ten minutes?\n[body]\nOne pan, one tray. [pause]\n[cta]\nFollow for more meal prep.' });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise(r => llm.listen(0, '127.0.0.1', r));
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '120', STUDIO_AGENT_CLIENT: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const req = async (path, body, raw) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined && !raw ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(100); } };

let client;
try {
  await t('defaults: a short take is one full short, a medium one is clips, a long one is a long edit plus clips', async () => {
    assert.deepStrictEqual([CUT.defaultsFor(70).format, CUT.defaultsFor(70).kind], ['short', 'full']);
    assert.deepStrictEqual([CUT.defaultsFor(400).format, CUT.defaultsFor(400).kind], ['short', 'clips']);
    const L = CUT.defaultsFor(1800); assert.deepStrictEqual([L.format, L.kind, L.clips], ['long', 'both', 5]); assert.ok(L.auto);
    assert.strictEqual(CUT.summary(L, 1800), 'Both: 1 full edit (~10 min) + 5 short clips, for organic');
  });
  await t('normalize: checks every field, a change turns the smart pick off, More sets exact seconds and aspect', async () => {
    const a = CUT.normalize(CUT.defaultOutput(), { format: 'long', kind: 'both', goal: 'ad', adCuts: true });
    assert.deepStrictEqual(a.errs, []); assert.strictEqual(a.output.auto, false); assert.ok(/for an ad/.test(CUT.summary(a.output, 900)) && /15 s and 30 s ad cuts/.test(CUT.summary(a.output, 900)), CUT.summary(a.output, 900));
    const b = CUT.normalize(CUT.defaultOutput(), { format: 'wide', length: 'huge', kind: 'x', goal: 'viral', clips: 99, aspect: '3:2' });
    assert.strictEqual(b.errs.length, 6, b.errs.join('; '));
    const c = CUT.normalize(CUT.defaultOutput(), { kind: 'full', seconds: 45, aspect: '4:5' }); assert.deepStrictEqual(c.errs, []);
    const rg = CUT.range(c.output, 'main'); assert.ok(rg[0] > 38 && rg[0] < 45 && rg[1] > 45 && rg[1] < 52, rg.join()); assert.strictEqual(CUT.exportOf(c.output), 'feed45');
    assert.ok(/~45 s/.test(CUT.summary(c.output)), CUT.summary(c.output));
    assert.ok(CUT.lengthLabel('long', 'medium') === '8-12 min' && CUT.lengthLabel('short', 'short') === '15-30 s' && CUT.lengthLabel('long', 'long') === '15+ min', CUT.lengthLabel('long', 'medium'));
  });
  await t('candidates: a best version near the length, N clips in range, parts, ad cuts within 15 s and 30 s, each with a score and reason', async () => {
    const w = talk(600);
    const both = CUT.candidates(w, { ...CUT.defaultOutput(), format: 'short', length: 'long', kind: 'both', clips: 4, clipLength: 'short' }, { duration: 600 });
    const full = both.find(c => c.id === 'full'); assert.ok(full && full.seconds >= 55 && full.seconds <= 95, 'full ' + (full && full.seconds));
    const clips = both.filter(c => c.kind === 'clip'); assert.strictEqual(clips.length, 4);
    for (const c of clips) { assert.ok(c.seconds >= 12 && c.seconds <= 34, c.id + ' ' + c.seconds); assert.ok(c.score >= 0 && c.score <= 100 && c.reason && c.text); }
    for (let i = 1; i < clips.length; i++) assert.ok(clips[i - 1].score >= clips[i].score, 'clips sorted by score');
    const parts = CUT.candidates(w, { ...CUT.defaultOutput(), kind: 'full', split: true, length: 'medium' }, { duration: 600 }).filter(c => c.kind === 'part');
    assert.ok(parts.length >= 5, 'parts ' + parts.length); for (const p of parts) assert.ok(p.seconds <= 70, p.seconds);
    const ad = CUT.candidates(w, { ...CUT.defaultOutput(), kind: 'clips', goal: 'ad', adCuts: true }, { duration: 600 });
    const a15 = ad.find(c => c.id === 'ad15'), a30 = ad.find(c => c.id === 'ad30');
    assert.ok(a15 && a15.seconds <= 15.5 && a15.seconds >= 8, 'ad15 ' + (a15 && a15.seconds)); assert.ok(a30 && a30.seconds <= 30.5 && a30.seconds >= 18, 'ad30 ' + (a30 && a30.seconds));
    for (const c of ad) assert.ok(!/\u2014/.test(c.reason));
  });
  await t('marks, ranges and scores: fillers and long pauses; ranges clamp and merge; a model reply re-scores by id', async () => {
    const w = talk(60), m = CUT.marks(w);
    assert.ok(m.some(x => x.type === 'filler' && /um/i.test(x.text)) && m.some(x => x.type === 'silence' && x.to - x.from >= 0.9));
    assert.deepStrictEqual(CUT.cleanRanges([[58, 99], [-1, 1.234]], 60), [[0, 1.23], [58, 60]]);
    assert.throws(() => CUT.cleanRanges([[5, 2]], 60), /at least 0.5 s/); assert.throws(() => CUT.cleanRanges([], 60));
    const cs = CUT.candidates(w, { ...CUT.defaultOutput(), kind: 'clips', clips: 2 }, { duration: 60 });
    const re = CUT.applyScores(cs, 'Sure: {"scores":[{"id":"' + cs[0].id + '","score":12,"reason":"flat \u2014 start"}]}');
    assert.strictEqual(re[0].score, 12); assert.ok(!/\u2014/.test(re[0].reason) && /flat/.test(re[0].reason), re[0].reason); assert.strictEqual(CUT.applyScores(cs, 'no json'), null);
  });
  await t('scriptFrom: the hook up to ~3 s, the body, the CTA when it asks, [pause] at long gaps', async () => {
    const w = talk(40), end = w.map(x => x[2]).lastIndexOf('tips.'), s = CUT.scriptFrom(w.slice(0, end + 1));
    assert.ok(/^\[hook\]\nWhat if your next reel took ten minutes\?/.test(s), s.slice(0, 80));
    assert.ok(/\n\[body\]\n/.test(s) && /\[pause\]/.test(s) && /\n\[cta\]\nFollow for more tips\.$/.test(s), s);
  });

  // ---------- over the page API ----------
  await req('/api/settings', { chat: { backend: 'keywords' } });
  await req('/api/state', { job: JOB });
  const up = await req('/api/upload?kind=footage&name=long take.mp4', 'not really a video', true); assert.strictEqual(up.status, 200, JSON.stringify(up.j));
  const SRC = up.j.path;
  await t('page API: the Cut view has the formats, the smart pick and its summary before any transcript', async () => {
    const c = (await req('/api/cut')).j; assert.strictEqual(c.source, SRC); assert.ok(c.formats.short && c.formats.long && c.formats.square);
    assert.strictEqual(c.formats.long.lengths.long, '15+ min'); assert.ok(c.output.auto && c.summary, JSON.stringify(c.output));
    assert.strictEqual((await req('/api/state')).j.cut.source, SRC, 'the page state has the cut view');
  });
  await t('page API: set the output (bad values refused), then the smart pick again', async () => {
    assert.strictEqual((await req('/api/cut/output', { format: 'cinema' })).status, 400);
    const r = await req('/api/cut/output', { format: 'short', kind: 'both', clips: 3, length: 'short', clipLength: 'short' }); assert.strictEqual(r.status, 200, JSON.stringify(r.j));
    assert.strictEqual(r.j.cut.output.auto, false); assert.strictEqual(r.j.cut.summary, 'Both: 1 full edit (~23 s) + 3 short clips, for organic');
    const back = await req('/api/cut/output', { reset: true }); assert.ok(back.j.cut.output.auto);
    await req('/api/cut/output', { format: 'short', kind: 'both', clips: 3, length: 'medium', clipLength: 'short' });
  });
  await t('find: transcribes a chunk at a time with progress, then the rules pick, labelled as rules', async () => {
    const f = await req('/api/cut/find', { path: SRC }); assert.strictEqual(f.status, 202, JSON.stringify(f.j));
    const mid = await until(async () => { const s = (await req('/api/state')).j.state; const x = (s.tx || {})[SRC]; return x && x.status === 'running' && x.total ? x : null; });
    assert.ok(mid.total >= 1);
    const c = await until(async () => { const v = (await req('/api/cut')).j; return v.candidates.length ? v : null; });
    assert.strictEqual(c.scoredBy, 'rules'); assert.strictEqual(c.pending, null); assert.strictEqual(c.tx.status, 'ready');
    assert.ok(c.candidates.some(x => x.id === 'full') && c.candidates.filter(x => x.kind === 'clip').length === 3, c.candidates.map(x => x.id).join());
    assert.ok(c.seconds > 100 && c.seconds < 120, 'length from the transcript without ffprobe: ' + c.seconds);
    const tr = (await req('/api/cut/transcript?path=' + encodeURIComponent(SRC))).j; assert.ok(tr.words.length > 100 && tr.sentences.length > 20 && tr.marks.some(m => m.type === 'filler'));
  });
  await t('edit: drop, trim, add your own, reorder, remove; bad ids refused', async () => {
    const c0 = (await req('/api/cut')).j, c1 = c0.candidates.find(x => x.kind === 'clip');
    let c = (await req('/api/cut/edit', { id: c1.id, keep: false })).j.cut; assert.strictEqual(c.candidates.find(x => x.id === c1.id).keep, false);
    c = (await req('/api/cut/edit', { id: c1.id, ranges: [[10, 22.5]] })).j.cut; const tr = c.candidates.find(x => x.id === c1.id);
    assert.deepStrictEqual(tr.ranges, [[10, 22.5]]); assert.strictEqual(tr.seconds, 12.5); assert.ok(tr.trimmed && tr.text.length > 10);
    c = (await req('/api/cut/edit', { add: { ranges: [[30, 41]], kind: 'clip' } })).j.cut; const mine = c.candidates.find(x => x.id === 'm1');
    assert.ok(mine && mine.by === 'you' && mine.keep && mine.text); assert.strictEqual(c.candidates[c.candidates.length - 1].id, 'm1');
    c = (await req('/api/cut/edit', { id: 'm1', move: -1 })).j.cut; assert.strictEqual(c.candidates[c.candidates.length - 2].id, 'm1');
    c = (await req('/api/cut/edit', { id: 'm1', remove: true })).j.cut; assert.ok(!c.candidates.some(x => x.id === 'm1'));
    assert.strictEqual((await req('/api/cut/edit', { id: 'nope', keep: true })).status, 404);
    assert.strictEqual((await req('/api/cut/render', { ids: [] })).status, 400, 'nothing to render');
  });
  const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, name + ': ' + JSON.stringify(r.content)); return r.structuredContent; };
  await t('MCP: set_output, get_cuts and set_cuts; the agent\'s picks are labelled with its name', async () => {
    client = new Client({ name: 'claude-code', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: new URL(url).port }, stderr: 'ignore' }));
    const names = (await client.listTools()).tools.map(x => x.name); for (const k of ['set_output', 'get_cuts', 'set_cuts', 'render_cuts']) assert.ok(names.includes(k), k);
    const so = await call('set_output', { format: 'short', kind: 'clips', clips: 2, goal: 'ad' });
    assert.ok(/^Clips: 2 short clips .*, for an ad$/.test(so.summary), so.summary);
    const g = await call('get_cuts', {}); assert.ok(g.candidates.length && g.sentences.length && !g.formats);
    const s = (await call('set_cuts', { candidates: [{ kind: 'clip', ranges: [[0.3, 14]], score: 88, reason: 'Opens with the question \u2014 strong hook' }, { kind: 'ad', ranges: [[20, 34]], score: 70, reason: 'Clear CTA' }] }));
    assert.deepStrictEqual(s.candidates.map(x => x.id), ['c1', 'ad1']); assert.ok(!/\u2014/.test(s.candidates[0].reason));
    const c = (await req('/api/cut')).j; assert.ok(/claude/i.test(c.scoredBy), c.scoredBy);
    assert.ok((await req('/api/state')).j.state.chat.some(m => m.kind === 'action' && /picked 2 cuts/.test(m.text)));
  });
  await t('model scoring: a local model re-scores the candidates and the label names it', async () => {
    await req('/api/settings', { chat: { backend: 'local', baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'fake-scorer' } });
    await req('/api/cut/output', { goal: 'organic', kind: 'clips', clips: 3 });
    assert.strictEqual((await req('/api/cut/find', { path: SRC })).status, 200, 'transcribed already, so it finds at once');
    const c = await until(async () => { const v = (await req('/api/cut')).j; return v.scoredBy === 'fake-scorer' && !v.pending ? v : null; });
    assert.ok(/Score each candidate/.test(lastUser) && /organic/.test(lastUser));
    assert.ok(c.candidates.every(x => /^Model says/.test(x.reason) && x.score > 90 - 10), JSON.stringify(c.candidates.map(x => [x.id, x.score])));
    assert.ok(c.candidates.every(x => !/\u2014/.test(x.reason)));
    const r = await req('/api/cut/find', { path: SRC, scorer: 'rules' }); assert.strictEqual(r.status, 200);
    await until(async () => (await req('/api/cut')).j.scoredBy === 'rules');
  });
  await t('pull script: a reference with speech goes into Scripts with [hook], [body] and [cta]; adapt rewrites it with a model', async () => {
    const ru = await req('/api/upload?kind=reference&name=ref.mp4', 'not a video either', true); assert.strictEqual(ru.status, 200, JSON.stringify(ru.j));
    const p = await req('/api/reference/script', {}); assert.strictEqual(p.status, 202, JSON.stringify(p.j)); assert.ok(p.j.transcribing);
    const sc = await until(async () => (await req('/api/state')).j.scripts.find(x => x.by === 'reference transcript'));
    const full = (await req('/api/scripts/get?id=' + sc.id)).j.script.text;
    assert.ok(/^\[hook\]\nWhat if your next reel took ten minutes to film\?/.test(full) && /\n\[body\]\n/.test(full) && /\n\[cta\]\nFollow for more/.test(full), full.slice(0, 200));
    const a = await req('/api/scripts/adapt', { id: sc.id, topic: 'meal prep' }); assert.strictEqual(a.status, 200, JSON.stringify(a.j));
    assert.ok(/New topic: meal prep/.test(lastUser) && /same structure/.test(lastUser));
    const made = a.j.scripts.find(x => x.from === 'adapted from ' + sc.id); assert.ok(made && made.title === 'Meal prep in ten minutes');
    assert.ok(a.j.scripts.some(x => x.id === sc.id), 'the original stays');
    assert.strictEqual((await req('/api/scripts/adapt', { id: sc.id, topic: '' })).status, 400);
  });
  await t('adapt with your agent: the ask goes to the agent with the humanizer and the same structure', async () => {
    await req('/api/settings', { chat: { backend: 'agent' } });
    const sc = (await req('/api/state')).j.scripts.find(x => x.by === 'reference transcript');
    const a = await req('/api/scripts/adapt', { id: sc.id, topic: 'dog training' }); assert.strictEqual(a.status, 200); assert.strictEqual(a.j.via, 'agent');
    const m = (await req('/api/state')).j.state.chat.filter(x => x.to === 'agent').pop(); assert.strictEqual(m.status, 'queued'); assert.deepStrictEqual(m.attach, { kind: 'adapt', script: sc.id, topic: 'dog training' }); assert.ok(m && /dog training/.test(m.text) && /humanizer/.test(m.text) && /write_script/.test(m.text), m && m.text);
  });
} finally {
  try { await client?.close(); } catch {}
  srv.kill(); llm.close();
  rmSync(STATE, { recursive: true, force: true });
  for (const d of [join('inbox', 'studio', JOB), join('teardown-in', 'studio', JOB)]) rmSync(join(ROOT, d), { recursive: true, force: true });
}
console.log(`\n${n} studio cut tests passed`);
process.exit(0);
