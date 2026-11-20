// Pieces and Combos, and the Outputs library (1.15.0), with no Chrome, no keys and no network:
// - every line of a take gets a category from what it does (hook, story, tip, proof, list, CTA, with asides and
//   retakes apart), your category wins over the rules, and topics are the words that come back across lines
// - Let AI choose: the strongest hook first, the best middle in the take's order up to the length, the CTA last,
//   never an aside or a retake, one reason each; neighbours in the take join into one range (no second cut)
// - the Outputs library lists every version with the settings that made it, and the other videos
// - MCP: get_pieces, set_combo, choose_combo and list_outputs are listed with their inputs
// Run: node tests/studio-pieces.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-pieces-test-')), JOB = 'pieces-test-' + process.pid, OTHER = 'pieces-other-' + process.pid;
const P = await import('../kit/studio/pieces.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

// a take's lines, as kit/studio/cut.mjs lines() makes them
const TEXT = ['Nobody tells you this about AI agents.', 'My first client paid me before I had a product.', 'Sorry, my dog is barking.',
  'Three months later, 312 percent more leads.', 'Open the dashboard and type your prompt.', 'First, own it. Second, ship it. Third, show it.',
  'I remember when editing ate my weekends with agents.', 'Nobody tells you, wait, let me redo that.', 'Follow for part two and join the agents list.'];
let at = 0; const LINES = TEXT.map((text, i) => { const secs = 2 + (text.length % 5) * 0.7, l = { id: 'l' + (i + 1), n: i + 1, start: +at.toFixed(2), end: +(at + secs).toFixed(2), seconds: +secs.toFixed(2), text, hint: i === 7 ? 'retake' : null }; at += secs + 0.4; return l; });

const env = { ...process.env, CI: '1', STUDIO_DIR: join(STATE, 'studio'), STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome'), STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; };

let client;
try {
  await t('pieces: each line gets what it does; asides and retakes sit apart; your category wins; topics come back across lines', async () => {
    const b = P.build(LINES), cat = Object.fromEntries(b.pieces.map(p => [p.id, p.category]));
    assert.deepStrictEqual([cat.l1, cat.l2, cat.l3, cat.l4, cat.l5, cat.l6, cat.l8, cat.l9], ['hook', 'story', 'aside', 'proof', 'tip', 'list', 'retake', 'cta'], JSON.stringify(cat));
    assert.ok(b.topics.includes('agents'), 'agents is said in three lines: ' + b.topics);
    assert.ok(b.pieces.every(p => typeof p.score === 'number' && p.start < p.end));
    const mine = P.build(LINES, { cats: { l7: 'proof' } }).pieces.find(p => p.id === 'l7'); assert.strictEqual(mine.category, 'proof'); assert.strictEqual(mine.rule, 'story');
    assert.strictEqual(P.CATS.length, 8); assert.deepStrictEqual(P.CAT_IDS.slice(-2), ['aside', 'retake']);
  });
  await t('Let AI choose: hook first, middle in take order up to the length, CTA last, never an aside or a retake, a reason each', async () => {
    const { pieces } = P.build(LINES), ch = P.choose(pieces, { min: 10, max: 20 }), by = Object.fromEntries(pieces.map(p => [p.id, p]));
    assert.strictEqual(by[ch.ids[0]].category, 'hook'); assert.strictEqual(by[ch.ids[ch.ids.length - 1]].category, 'cta');
    assert.ok(!ch.ids.some(id => ['aside', 'retake'].includes(by[id].category)), 'no aside, no retake: ' + ch.ids);
    const mid = ch.ids.slice(1, -1).map(id => by[id].start); assert.deepStrictEqual(mid, [...mid].sort((a, b) => a - b), 'the middle plays in the take order');
    assert.ok(ch.seconds <= 20 + 0.01 && ch.seconds >= 6, 'within the length: ' + ch.seconds);
    assert.ok(ch.ids.every(id => ch.reasons[id] && !/\u2014/.test(ch.reasons[id])), 'a reason each, no em dash');
  });
  await t('a Combo plays back to back neighbours as one range; out of order pieces stay apart; edges are the lines\' own', async () => {
    const { pieces } = P.build(LINES), r = P.comboRanges(['l1', 'l2', 'l5', 'l4'], pieces);
    assert.strictEqual(r.length, 3); assert.deepStrictEqual(r[0].ranges, [[LINES[0].start, LINES[1].end]]); assert.deepStrictEqual(r[0].ids, ['l1', 'l2']);
    assert.deepStrictEqual(r[2].ranges, [[LINES[3].start, LINES[3].end]], 'l4 after l5 is its own range');
  });
  await t('the server: pieces and Let AI choose need footage first', async () => {
    const g = await req('/api/pieces'); assert.strictEqual(g.status, 400); assert.match(g.error, /footage/);
    const p = await req('/api/pieces', { choose: true }); assert.strictEqual(p.status, 400);
  });
  await t('Outputs library: every version with the settings that made it, newest first; All videos lists the others', async () => {
    const v = await req('/api/videos/new', { name: JOB }); assert.strictEqual(v.state.job, JOB);
    for (const job of [JOB, OTHER]) mkdirSync(join(ROOT, 'jobs', job), { recursive: true });
    for (const f of ['reel-v1.mp4', 'reel-v2.mp4', 'reel-v2-tiktok.mp4']) writeFileSync(join(ROOT, 'jobs', JOB, f), '');
    writeFileSync(join(ROOT, 'jobs', OTHER, 'reel-v1.mp4'), '');
    writeFileSync(join(ROOT, 'jobs', JOB, 'reel-v2.settings.json'), JSON.stringify({ version: 2, at: '2026-11-20T10:00:00.000Z', look: 'Mint Kinetic', pieces: [{ id: 'pc-l1' }, { id: 'pc-l4' }], broll: '4 spots' }));
    const o = await req('/api/outputs');
    assert.deepStrictEqual(o.versions.map(x => x.v), [2, 1]);
    assert.strictEqual(o.versions[0].settings.look, 'Mint Kinetic'); assert.strictEqual(o.versions[1].settings, null, 'v1 was made before settings');
    assert.deepStrictEqual(o.versions[0].files.map(f => f.label), ['Reel', 'Export tiktok']);
    assert.strictEqual(o.versions[0].reopen, false, 'no snapshot, so it cannot re-open'); assert.ok(!o.jobs, 'This video only');
    const a = await req('/api/outputs?all=1'); const other = a.jobs.find(j => j.job === OTHER); assert.ok(other && other.versions === 1, JSON.stringify(a.jobs));
  });
  await t('MCP: get_pieces, set_combo, choose_combo and list_outputs are listed with their inputs', async () => {
    client = new Client({ name: 'pieces-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_PORT: url.split(':').pop() } }));
    const by = Object.fromEntries((await client.listTools()).tools.map(x => [x.name, x]));
    for (const k of ['get_pieces', 'set_combo', 'choose_combo', 'list_outputs']) assert.ok(by[k], k + ' is listed');
    assert.ok(by.set_combo.inputSchema.properties.ids && by.set_combo.inputSchema.properties.reasons && by.set_combo.inputSchema.properties.cats);
    assert.ok(by.list_outputs.inputSchema.properties.all);
    const lo = await client.callTool({ name: 'list_outputs', arguments: {} }); assert.ok(!lo.isError, JSON.stringify(lo).slice(0, 300));
    assert.deepStrictEqual(lo.structuredContent.versions.map(x => x.v), [2, 1]);
  });
  console.log(`studio-pieces: ${n} passed`);
} finally {
  try { await client?.close(); } catch {}
  srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  for (const job of [JOB, OTHER]) { rmSync(join(ROOT, 'jobs', job), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', job), { recursive: true, force: true }); }
}
