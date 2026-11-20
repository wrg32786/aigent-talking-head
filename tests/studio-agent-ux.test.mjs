// Point-and-note review, waveform select, wizards, Ask my agent and Apply (1.17.0), with no Chrome, no keys and no
// network:
// - a drag on the waveform snaps to whole words: it never starts or ends mid-word, a gap snaps inward
// - a note on a stretch (t to end) says from and to, on the reel or on a take; a single frame still says at
// - Ask my agent sends the step along with the words
// - an agent answer can carry a suggested change (studio_reply suggest): nothing changes until Apply, a bad patch is
//   refused before the user sees it, Apply makes it once
// - the wizards: goals and clip counts from the server, bad input refused, footage needed first
// - MCP: run_wizard is listed with its inputs, studio_reply takes suggest
// Run: node tests/studio-agent-ux.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-agent-ux-test-')), JOB = 'agent-ux-test-' + process.pid, SDIR = join(STATE, 'studio');
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
const RV = await import('../kit/studio/review.mjs');
const WIZ = await import('../kit/studio/wizards.mjs');
const { snapToWords } = await import('../kit/studio/web/src/snap.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, pack: null }));

const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: 'agent', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome'), STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; };
const chat = async () => (await req('/api/state')).state.chat;

let client;
try {
  await t('waveform select snaps to whole words: never mid-word, a gap snaps inward', async () => {
    const W = [[1.0, 1.4, 'Nobody'], [1.5, 1.9, 'tells'], [2.4, 2.8, 'you'], [3.0, 3.6, 'this']];
    assert.deepStrictEqual(snapToWords(W, 1.2, 2.6), [1.0, 2.8], 'starts and ends inside words: out to their edges');
    assert.deepStrictEqual(snapToWords(W, 2.0, 3.2), [2.4, 3.6], 'starts in a gap: the next word');
    assert.deepStrictEqual(snapToWords(W, 3.3, 1.1), [1.0, 3.6], 'dragged right to left');
    assert.deepStrictEqual(snapToWords(W, 1.2, 2.2), [1.0, 1.9], 'ends in a gap: the word before');
    assert.strictEqual(snapToWords(W, 1.95, 2.3), null, 'only a gap: nothing to select');
    assert.deepStrictEqual(snapToWords([], 4, 2), [2, 4], 'no transcript yet: the drag as it is');
    for (let k = 0; k < 200; k++) { const a = Math.random() * 4, b = Math.random() * 4, r = snapToWords(W, a, b); if (!r) continue;
      assert.ok(W.some(w => w[0] === r[0]) && W.some(w => w[1] === r[1]), `edges on word edges: ${a} ${b} -> ${r}`); }
  });
  await t('a note on a stretch says from and to; a frame still says at', async () => {
    assert.match(RV.commentLine({ text: 'Tighten this', t: 12, end: 18.5, video: 'jobs/x/reel.mp4' }), /reel\.mp4 from 0:12\.0 to 0:18\.5 \(12\.00 to 18\.50 s\)/);
    assert.match(RV.commentLine({ text: 'Smaller', t: 3 }), /at 0:03\.0 \(3\.00 s\)/);
    assert.match(RV.commentLine({ text: 'Smaller', t: 3, end: 3.01 }), /at 0:03/, 'an end on the start is one frame');
    const r = await req('/api/comment', { text: 'Cut this ramble', t: 4, end: 9.25 }); assert.strictEqual(r.status, 200, JSON.stringify(r));
    const m = (await chat()).filter(x => x.role === 'user').pop(); assert.strictEqual(m.attach.end, 9.25); assert.strictEqual(m.attach.t, 4); assert.match(m.text, /from 0:04\.0 to 0:09\.3/);
    const one = await req('/api/comment', { text: 'Here', t: 4, end: 2 }); assert.strictEqual(one.status, 200); assert.strictEqual((await chat()).filter(x => x.role === 'user').pop().attach.end, undefined, 'an end before the start is dropped');
    await req('/api/comment', { text: 'Not mine', t: 1, end: 2, source: '../../etc/passwd' }); assert.doesNotMatch((await chat()).filter(x => x.role === 'user').pop().text, /passwd/, 'a take that is not in the footage is not named');
  });
  await t('Ask my agent sends the step with the words', async () => {
    const r = await req('/api/chat', { text: 'Pick the strongest hook', step: 'cut' }); assert.strictEqual(r.status, 200);
    assert.ok((await chat()).some(m => m.role === 'user' && m.text === '(On the Cut step) Pick the strongest hook'));
    await req('/api/chat', { text: 'plain', step: 'nowhere' }); assert.ok((await chat()).some(m => m.role === 'user' && m.text === 'plain'), 'an unknown step adds nothing');
  });
  await t('MCP: studio_reply suggest changes nothing until Apply; a bad patch is refused; Apply works once', async () => {
    client = new Client({ name: 'agent-ux-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: SDIR, STUDIO_PORT: url.split(':').pop() } }));
    const by = Object.fromEntries((await client.listTools()).tools.map(x => [x.name, x]));
    assert.ok(by.studio_reply.inputSchema.properties.suggest.properties.combo, 'studio_reply takes suggest');
    assert.deepStrictEqual(by.run_wizard.inputSchema.required, ['wizard']); assert.deepStrictEqual(by.run_wizard.inputSchema.properties.goal.enum, Object.keys(WIZ.GOALS));
    const bad = await client.callTool({ name: 'studio_reply', arguments: { text: 'Try this', suggest: { patch: { pack: 'no-such-look' } } } }); assert.ok(bad.isError, 'a bad suggested patch is refused');
    const ok = await client.callTool({ name: 'studio_reply', arguments: { text: 'Magazine fits the hook.', suggest: { patch: { pack: 'magazine' }, step: 'look', label: 'Use magazine' } } }); assert.ok(!ok.isError, JSON.stringify(ok.content));
    const st = (await req('/api/state')).state, m = st.chat.find(x => x.suggest); assert.strictEqual(st.pack, null, 'nothing changed yet');
    assert.deepStrictEqual(m.suggest, { patch: { pack: 'magazine' }, step: 'look', label: 'Use magazine' });
    assert.strictEqual((await req('/api/chat/apply', { id: 99999 })).status, 404);
    const ap = await req('/api/chat/apply', { id: m.id }); assert.strictEqual(ap.status, 200, JSON.stringify(ap)); assert.strictEqual(ap.state.pack, 'magazine');
    assert.ok(ap.state.chat.find(x => x.id === m.id).applied); assert.ok(ap.state.chat.some(x => x.kind === 'action' && /^Applied /.test(x.text)));
    assert.strictEqual((await req('/api/chat/apply', { id: m.id })).status, 400, 'once');
    const combo = await req('/api/state'); assert.ok(combo.state.chat.length);
  });
  await t('wizards: goals and clip counts from the server, bad input refused, footage first', async () => {
    const g = await req('/api/wizard'); assert.deepStrictEqual(Object.keys(g.wizards), ['reel', 'reference', 'clips']); assert.deepStrictEqual(Object.keys(g.goals), ['grow', 'sell', 'teach', 'clean']); assert.deepStrictEqual(g.clipCounts, [3, 5, 8]);
    assert.strictEqual(g.goals.sell.out.goal, 'ad'); assert.strictEqual(g.goals.sell.out.adCuts, true); assert.strictEqual(g.goals.clean.out.format, 'long');
    assert.match((await req('/api/wizard', { wizard: 'party' })).error, /wizard: reel, reference, clips/);
    assert.match((await req('/api/wizard', { wizard: 'reel', goal: 'fame' })).error, /goal:/);
    assert.match((await req('/api/wizard', { wizard: 'reel', look: 'no-such-look' })).error, /no Look named/);
    assert.match((await req('/api/wizard', { wizard: 'reel' })).error, /give a goal/);
    assert.match((await req('/api/wizard', { wizard: 'clips', clips: 40 })).error, /1 to 12/);
    assert.match((await req('/api/wizard', { wizard: 'reference', url: 'not a link' })).error, /url/);
    assert.match((await req('/api/wizard', { wizard: 'reel', goal: 'grow' })).error, /footage first/);
    const p = WIZ.plan({ wizard: 'clips' }); assert.strictEqual(p.clips, 5); assert.strictEqual(p.ads, false);
    assert.deepStrictEqual(WIZ.clipsOutput(3, true), { format: 'short', kind: 'clips', clips: 3, clipLength: 'short', goal: 'ad', adCuts: true });
  });
  console.log(`studio-agent-ux: ${n} passed`);
} finally {
  try { await client?.close(); } catch {}
  srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
