// A reference sets your Look (1.17.1), with no Chrome, no keys and no network (a local link and a stand-in teardown):
// - Recreate sets every layer the reference read: its Look, captions, titles, transitions, finishes, effects, music,
//   beat sync and pace, and says so (reference.auto)
// - Influence sets the same picks as soft defaults and keeps your Look and sound
// - you can change any of it; Off (Back to my look) takes out only what the reference set and gives back your own
//   caption style, Look and music
// - a reference that is still being read sets the Look when it is ready
// - MCP: studio_set_selections with reference.mode does the same
// Run: node tests/studio-refstyle.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-refstyle-test-')), SDIR = join(STATE, 'studio'), DL = join(STATE, 'downloads'), JOB = 'refstyle-test-' + process.pid;
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const cat = C.catalog();
// what the stand-in teardown reads: the shipped cinematic recipe
const EX = C.extract(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'));
const MINE_CAP = Object.values(cat.items).find(i => i.kind === 'captionStyle' && i.id !== EX.captionStyle && i.mode !== 'info').id;
mkdirSync(SDIR, { recursive: true }); mkdirSync(DL, { recursive: true });
const base = C.defaultState();
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...base, job: JOB, pack: 'magazine', music: { ...base.music, bed: 'none' },
  picks: { captionStyle: { allow: [MINE_CAP], deny: [] } }, reference: { ...base.reference, status: 'ready', mode: 'off', extracted: EX } }));

// a small video for the link, held back until the test lets it go (so "still being read" can be seen)
const CLIP = join(STATE, 'clip.mp4');
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=24:duration=2', '-pix_fmt', 'yuv420p', CLIP]);
else { const b = Buffer.alloc(4096); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(CLIP, b); }
let release; const gate = new Promise(r => { release = r; });
const media = http.createServer(async (req, res) => { if (req.url !== '/ref.mp4') { res.writeHead(404); return res.end(); } await gate; const b = readFileSync(CLIP); res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': b.length }); res.end(b); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const MEDIA = `http://127.0.0.1:${media.address().port}`;

const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs', STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', CHROME_PATH: join(STATE, 'no-chrome'), STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const j = await r.json(); j.status = r.status; return j; };
const allow = (s, k) => (s.picks[k] && s.picks[k].allow) || [];
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 150)); } };

let client;
try {
  await t('Recreate sets every layer from the reference and says so', async () => {
    const v = await req('/api/state', { reference: { mode: 'recreate' } }); assert.strictEqual(v.status, 200, JSON.stringify(v).slice(0, 300));
    const s = v.state;
    assert.strictEqual(s.pack, 'cinematic', 'its Look');
    for (const tr of Object.keys(EX.transitions)) assert.ok(allow(s, 'transition').includes(tr), 'transition ' + tr);
    // its title entrances are a preference, never a pick or a lock (report 4 item 9): a rebuild can use any entrance
    assert.ok(EX.entrances.length > 0, 'the fixture reads entrances'); assert.deepStrictEqual(allow(s, 'entrance'), [], 'no entrance pick from the reference');
    assert.ok(!/titles=/.test(v.compose.lockString || ''), 'and no titles lock: ' + v.compose.lockString);
    for (const f of EX.finishes) assert.ok(allow(s, 'finish').includes(f), 'grade ' + f);
    assert.deepStrictEqual(allow(s, 'captionStyle'), [EX.captionStyle], 'its caption style, one per reel');
    assert.strictEqual(s.music.bed, EX.music.bed, 'its music'); assert.ok(allow(s, 'beatSync').includes('beat-sync'), 'beat sync'); assert.ok(allow(s, 'editing').includes('punch'), 'pace: punch-ins');
    assert.strictEqual(s.reference.auto.mode, 'recreate'); assert.ok(s.reference.auto.n >= 10, 'n ' + s.reference.auto.n);
    assert.ok(v.look.added.includes(`captionStyle:${EX.captionStyle}`) && v.look.added.includes(`transition:${Object.keys(EX.transitions)[0]}`), 'badged From reference');
    assert.ok(v.log.some(l => /set the look from the reference/.test(l)), v.log.join('; '));
  });
  await t('Influence sets its picks as soft defaults and keeps your Look and sound', async () => {
    const s = (await req('/api/state', { reference: { mode: 'influence' } })).state;
    assert.strictEqual(s.pack, 'magazine', 'your Look is back'); assert.strictEqual(s.music.bed, 'none', 'your music is back');
    assert.ok(!allow(s, 'beatSync').length && !allow(s, 'editing').includes('punch'), 'pace and beat sync stay yours');
    for (const tr of Object.keys(EX.transitions)) assert.ok(allow(s, 'transition').includes(tr));
    assert.deepStrictEqual(allow(s, 'captionStyle'), [EX.captionStyle]);
    assert.strictEqual(s.reference.auto.mode, 'influence');
  });
  await t('you can change any layer; Back to my look (Off) takes out only what the reference set', async () => {
    const [tr1, tr2] = Object.keys(EX.transitions), myFin = Object.values(cat.items).find(i => i.kind === 'finish' && !EX.finishes.includes(i.id)).id;
    let v = await req('/api/state', { picks: { [`transition:${tr1}`]: 'deny', [`finish:${myFin}`]: 'allow' } });
    assert.ok(!v.look.added.includes(`transition:${tr1}`), 'your change is yours now');
    v = await req('/api/state', { reference: { mode: 'off' } }); const s = v.state;
    assert.ok(s.picks.transition.deny.includes(tr1), 'what you forbade stays forbidden'); assert.ok(!allow(s, 'transition').includes(tr2), 'its transition is out');
    assert.ok(allow(s, 'finish').includes(myFin) && !EX.finishes.some(f => allow(s, 'finish').includes(f)), 'your finish stays, its grade goes');
    assert.deepStrictEqual(allow(s, 'captionStyle'), [MINE_CAP], 'your own caption style is back');
    assert.strictEqual(s.pack, 'magazine'); assert.strictEqual(s.reference.auto, null); assert.deepStrictEqual(v.look.added, []);
    assert.ok(v.log.includes('back to your own look'), v.log.join('; '));
  });
  await t('a Look you pick after Recreate is kept when you switch', async () => {
    await req('/api/state', { reference: { mode: 'recreate' } });
    await req('/api/state', { pack: 'neutral' });
    const s = (await req('/api/state', { reference: { mode: 'off' } })).state;
    assert.strictEqual(s.pack, 'neutral', 'you changed the Look, so it stays');
    await req('/api/state', { pack: 'magazine' });
  });
  await t('a reference still being read sets the Look when it is ready', async () => {
    await req('/api/settings', { downloads: DL });
    const cl = await req('/api/reference/clear', {}); assert.strictEqual(cl.status, 200);
    await req('/api/state', { reference: { mode: 'recreate' } });
    const a = await req('/api/reference/url', { urls: [`${MEDIA}/ref.mp4`] }); assert.ok([200, 202].includes(a.status), JSON.stringify(a).slice(0, 300));
    const mid = (await req('/api/state')).state;
    assert.ok(!mid.reference.extracted && ['queued', 'downloading'].includes(mid.reference.queue[0].status), 'still being read: ' + mid.reference.queue[0].status);
    assert.strictEqual(mid.pack, null, 'the Look from before is set aside as soon as you choose to copy the reference, so what you pick while it is read is yours'); assert.strictEqual(mid.reference.auto || null, null, 'nothing set from the reference yet');
    release();
    const s = await until(async () => { const x = (await req('/api/state')).state; return x.reference.extracted && x.reference.auto ? x : null; });
    assert.strictEqual(s.pack, 'cinematic'); assert.deepStrictEqual(allow(s, 'captionStyle'), [EX.captionStyle]); assert.strictEqual(s.reference.auto.mode, 'recreate');
  });
  await t('MCP: studio_set_selections with reference.mode sets the Look, and off takes it back out', async () => {
    client = new Client({ name: 'refstyle-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: SDIR, STUDIO_PORT: url.split(':').pop() } }));
    const tool = (await client.listTools()).tools.find(x => x.name === 'studio_set_selections'); assert.match(tool.description, /recreate sets the Look from it/);
    const call = async args => { const r = await client.callTool({ name: 'studio_set_selections', arguments: args }); assert.ok(!r.isError, JSON.stringify(r.content).slice(0, 300)); };
    await call({ reference: { mode: 'off' } }); let s = (await req('/api/state')).state; assert.strictEqual(s.pack, 'magazine'); assert.deepStrictEqual(allow(s, 'captionStyle'), [MINE_CAP]);
    await call({ reference: { mode: 'influence' } }); s = (await req('/api/state')).state; assert.strictEqual(s.pack, 'magazine'); assert.deepStrictEqual(allow(s, 'captionStyle'), [EX.captionStyle]);
  });
  console.log(`studio-refstyle: ${n} passed`);
} finally {
  try { await client?.close(); } catch {}
  srv.kill(); media.close();
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'teardown-in', 'studio', JOB), { recursive: true, force: true });
  rmSync(join(ROOT, 'teardowns', 'studio', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`), { recursive: true, force: true });
}
