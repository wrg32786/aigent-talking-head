// Record now, server side: a synthetic webm (VP8 + Opus, made with ffmpeg at test time, like a browser's
// MediaRecorder output) is sent to /api/record in numbered chunks, with a retried chunk and an out-of-order chunk;
// finish converts it to an H.264/AAC mp4 with a thumbnail, the take joins the footage, Studio posts the
// "New take recorded" note, and keep, unkeep and discard work. The MCP side (studio_takes) reads the same list.
// With no video open a take still starts and is held for the Recording tab. Without ffmpeg only the chunk checks run. Run: node tests/studio-record.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-record-test-'));
const JOB = 'record-test-' + process.pid;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const WEBM = join(STATE, 'take.webm');
if (ffmpeg) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=270x480:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', '-shortest', WEBM]);
  assert.strictEqual(r.status, 0, String(r.stderr));
}

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const chunk = async (id, seq, buf) => { const r = await fetch(`${url}/api/record/chunk?id=${id}&seq=${seq}`, { method: 'POST', body: buf }); return { status: r.status, j: await r.json() }; };
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(150); } };

let client;
try {
  await t('with no video open a take still starts (it is held for the Recording tab), and aborting it leaves nothing', async () => {
    const st = await req('/api/record/start', { mime: 'video/webm' }); assert.strictEqual(st.status, 200);
    const tk = st.j.state.takes.find(x => x.id === st.j.id); assert.ok(tk && tk.held, JSON.stringify(tk));
    assert.ok(!(await req('/api/record/abort', { id: st.j.id })).j.state.takes.some(x => x.id === st.j.id));
    await req('/api/state', { job: JOB });
  });
  await t('chunks: in order, a retried chunk is ignored, a gap is refused with the next seq, an unknown take is 404', async () => {
    const st = await req('/api/record/start', { mime: 'video/webm;codecs=vp8,opus' }); assert.strictEqual(st.status, 200);
    const id = st.j.id; assert.strictEqual(st.j.state.takes.find(x => x.id === id).status, 'recording');
    assert.deepStrictEqual((await chunk(id, 0, Buffer.from('abc'))).j.next, 1);
    assert.strictEqual((await chunk(id, 0, Buffer.from('abc'))).j.duplicate, true);
    const gap = await chunk(id, 5, Buffer.from('x')); assert.strictEqual(gap.status, 409); assert.strictEqual(gap.j.next, 1);
    assert.strictEqual((await chunk(id, 1, Buffer.from('defg'))).j.bytes, 7);
    assert.strictEqual((await chunk(999, 0, Buffer.from('x'))).status, 404);
    const ab = await req('/api/record/abort', { id }); assert.ok(!ab.j.state.takes.some(x => x.id === id));
    assert.strictEqual((await chunk(id, 2, Buffer.from('x'))).status, 404);
  });
  await t('cross-site chunk posts are refused', async () => {
    const r = await fetch(`${url}/api/record/chunk?id=1&seq=0`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: 'x' });
    assert.strictEqual(r.status, 403);
  });
  if (ffmpeg) {
    let take;
    await t('a synthetic webm sent in 64 KB chunks converts to an mp4 take in the footage, with a thumbnail and a chat note', async () => {
      const buf = readFileSync(WEBM), id = (await req('/api/record/start', { mime: 'video/webm;codecs=vp8,opus' })).j.id;
      for (let i = 0, seq = 0; i < buf.length; i += 65536, seq++) { const r = await chunk(id, seq, buf.subarray(i, i + 65536)); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); }
      const f = await req('/api/record/finish', { id, seconds: 3 }); assert.strictEqual(f.status, 202, JSON.stringify(f.j));
      const s = await until(async () => { const v = (await req('/api/state')).j.state; const x = v.takes.find(y => y.id === id); return x && x.status !== 'converting' && v; });
      take = s.takes.find(y => y.id === id);
      assert.strictEqual(take.status, 'ready', take.error);
      assert.ok(take.file.startsWith(`inbox/studio/${JOB}/takes/`) && take.file.endsWith('.mp4'), take.file);
      assert.ok(s.footage.includes(take.file), 'take is in the footage');
      assert.ok(Math.abs(take.seconds - 3) < 0.5, 'seconds ' + take.seconds);
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', join(ROOT, take.file)], { encoding: 'utf8' }).stdout;
      assert.ok(/h264,270,480/.test(probe) && /aac/.test(probe), probe);
      assert.ok(existsSync(join(ROOT, take.thumb)) && statSync(join(ROOT, take.thumb)).size > 500);
      assert.ok(!existsSync(join(ROOT, `inbox/studio/${JOB}/takes/take-${id}.part.webm`)), 'raw chunks removed');
      assert.ok(s.chat.some(m => m.kind === 'action' && /^New take recorded: 3 s/.test(m.text)), JSON.stringify(s.chat.slice(-2)));
      const r = await fetch(url + '/files/' + take.file, { headers: { range: 'bytes=0-99' } }); assert.strictEqual(r.status, 206);
    });
    await t('MCP studio_takes lists the take, unkeep takes it out of the footage, keep puts it back', async () => {
      client = new Client({ name: 'record-test', version: '1.0.0' });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env, stderr: 'ignore' }));
      const l = (await client.callTool({ name: 'studio_takes', arguments: {} })).structuredContent;
      assert.ok(l.takes.some(x => x.id === take.id && x.inFootage && x.seconds > 2), JSON.stringify(l));
      const u = await req('/api/record/take', { id: take.id, action: 'unkeep' }); assert.ok(!u.j.state.footage.includes(take.file));
      const k = (await client.callTool({ name: 'studio_takes', arguments: { id: take.id, action: 'keep' } })).structuredContent;
      assert.ok(k.takes.find(x => x.id === take.id).inFootage);
    });
    await t('a broken recording fails with the reason; discard deletes the files', async () => {
      const id = (await req('/api/record/start', { mime: 'video/webm' })).j.id;
      await chunk(id, 0, Buffer.from('not a video at all'));
      await req('/api/record/finish', { id });
      const bad = await until(async () => { const x = (await req('/api/state')).j.state.takes.find(y => y.id === id); return x && x.status === 'failed' && x; });
      assert.ok(/ffmpeg failed/.test(bad.error), bad.error);
      const d = await req('/api/record/take', { id: take.id, action: 'discard' });
      assert.ok(!d.j.state.footage.includes(take.file) && !d.j.state.takes.some(x => x.id === take.id));
      assert.ok(!existsSync(join(ROOT, take.file)) && !existsSync(join(ROOT, take.thumb)));
    });
  } else console.log('skip conversion checks: no ffmpeg on PATH');
  await t('an empty take is refused and dropped', async () => {
    const id = (await req('/api/record/start', { mime: 'video/webm' })).j.id;
    const f = await req('/api/record/finish', { id }); assert.strictEqual(f.status, 400);
    assert.ok(!(await req('/api/state')).j.state.takes.some(x => x.id === id));
  });
} finally {
  try { await client?.close(); } catch {}
  srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio record tests passed`);
process.exit(0);
