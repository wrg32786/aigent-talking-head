// New video and Open a past video: start fresh clears the board for a new job and never deletes a file; the old job's
// session is saved per job so opening it again restores it; a job Studio never saved opens with its footage and reels;
// switching is refused while something is running; the same over HTTP and over MCP (list_videos, new_video, open_video).
// Run: node tests/studio-videos.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-videos-'));
process.env.STUDIO_DIR = STATE;
const C = await import('../kit/studio/core.mjs');
const P = process.pid, A = `nv-a-${P}`, B = `nv-b-${P}`, OLD = `nv-old-${P}`, MCPJ = `nv-mcp-${P}`;
const made = [A, B, OLD, MCPJ, `${MCPJ}-2`].flatMap(j => [join(ROOT, 'jobs', j), join(ROOT, 'inbox', 'studio', j)]);
let n = 0, srv = null, client = null;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const touch = f => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, 'x'); };

// a session in the middle of an edit
function busyBoard(job) {
  const s = C.defaultState(); const cat = C.catalog();
  const tr = Object.values(cat.items).find(i => i.kind === 'transition' && i.mode === 'multi');
  Object.assign(s, { job, footage: [`inbox/studio/${job}/take.mp4`], clips: null, asIs: true, cut: { source: `inbox/studio/${job}/take.mp4`, candidates: [{ id: 'c1' }] },
    tx: { [`inbox/studio/${job}/take.mp4`]: { status: 'ready' } }, lines: { x: 1 }, broll: { [job]: { placements: [{ beat: 1 }] } }, cleanup: { on: true }, lockedAtDraft: '--x',
    output: { kind: 'one' }, outputs: [`jobs/${job}/reel-v1.mp4`], imports: [{ id: 1, status: 'ready' }], takes: [{ id: 1, status: 'ready' }],
    reference: { ...s.reference, status: 'ready', extracted: { look: 'x' }, queue: [{ id: 1, status: 'ready' }] },
    pack: cat.packs[0].name, music: { bed: 'none', energy: 'high', upload: null }, sound: { sfx: 'off', cap: 'on' }, pace: { tighten: 0.5, punch: 'off' }, export: cat.exports[0],
    brands: [{ word: 'Skool', logo: 'kit/example/skool-logo.svg' }], glossary: [{ say: 'AIgent', heard: ['agent'] }], chatSeq: 7, refSeq: 3, chat: [{ id: 7, role: 'user', text: 'hi' }] });
  C.applyPatch(s, { picks: { [tr.ref]: 'allow' } });
  return s;
}

try {
  await t('start fresh keeps the look: footage, cuts, reference, b-roll and review reset; look and your words stay, chat clears', () => {
    const s = busyBoard(A), look = Object.fromEntries(C.LOOK_KEYS.map(k => [k, JSON.stringify(s[k])]));
    C.freshSession(s, { job: B, keepLook: true });
    assert.strictEqual(s.job, B);
    for (const [k, v] of Object.entries({ footage: [], clips: null, cut: null, tx: {}, lines: {}, broll: {}, outputs: [], takes: [], output: null, task: null })) assert.deepStrictEqual(s[k], v, k);
    for (const k of ['asIs', 'cleanup', 'lockedAtDraft', 'imports']) assert.strictEqual(s[k], undefined, k);
    assert.deepStrictEqual(s.reference, C.defaultState().reference);
    for (const k of C.LOOK_KEYS) assert.strictEqual(JSON.stringify(s[k]), look[k], 'kept ' + k);
    assert.strictEqual(s.chatSeq, 7); assert.strictEqual(s.refSeq, 3); assert.strictEqual(s.chat.length, 0); assert.strictEqual(s.glossary.length, 1);
  });
  await t('start fresh without the look: the look goes back to the defaults too', () => {
    const s = busyBoard(A), d = C.defaultState();
    C.freshSession(s, { job: B, keepLook: false });
    for (const k of ['pack', 'picks', 'music', 'sound', 'pace', 'export']) assert.deepStrictEqual(s[k], d[k], k);
    assert.strictEqual(s.brands, undefined); assert.strictEqual(s.glossary.length, 1, 'your words are not the look');
  });
  await t('switch: names are sanitized, taken names refused, the old session is saved and opening it restores it', () => {
    touch(join(ROOT, 'inbox', 'studio', A, 'take.mp4')); touch(join(ROOT, 'jobs', A, 'reel-v1.mp4')); mkdirSync(join(ROOT, 'jobs', A, 'reel-v1.build'), { recursive: true });
    const s = busyBoard(A);
    assert.throws(() => C.switchVideo(s, { name: A }), e => e.code === 409);
    assert.throws(() => C.switchVideo(s, { name: '!!!' }), e => e.code === 400);
    assert.throws(() => C.switchVideo(s, { open: 'nope-' + P }), e => e.code === 404);
    const r = C.switchVideo(s, { name: ` NV B ${P} ` });
    assert.strictEqual(r.job, B); assert.strictEqual(s.job, B); assert.deepStrictEqual(s.footage, []);
    assert.ok(/Started a new video: nv-b-\d+, kept the look\. nv-a-\d+ is saved/.test(s.chat.at(-1).text), s.chat.at(-1).text); assert.strictEqual(s.chat.at(-1).kind, 'action');
    assert.ok(existsSync(join(STATE, 'videos', A + '.json')), 'the old session is saved per job');
    for (const f of ['inbox/studio/' + A + '/take.mp4', 'jobs/' + A + '/reel-v1.mp4', 'jobs/' + A + '/reel-v1.build']) assert.ok(existsSync(join(ROOT, f)), 'kept ' + f);
    s.footage = ['inbox/x.mp4']; s.pack = null;
    const o = C.switchVideo(s, { open: A });
    assert.strictEqual(o.restored, true); assert.strictEqual(s.job, A);
    assert.deepStrictEqual(s.footage, [`inbox/studio/${A}/take.mp4`]); assert.strictEqual(s.cut.candidates.length, 1); assert.strictEqual(s.reference.extracted.look, 'x');
    assert.strictEqual(s.broll[A].placements.length, 1); assert.ok(s.pack); assert.strictEqual(s.task, null); assert.strictEqual(s.savedAt, undefined);
    assert.ok(s.chatSeq > 7, 'the chat counter never goes back');
    C.switchVideo(s, { open: B }); assert.deepStrictEqual(s.footage, ['inbox/x.mp4'], 'B came back as it was left'); assert.strictEqual(s.pack, null);
    const r2 = C.switchVideo(s, { name: '' }); assert.ok(/^video-\d{4}-\d{2}-\d{2}(-\d+)?$/.test(r2.job), r2.job);
    rmSync(join(STATE, 'videos', r2.job + '.json'), { force: true });
  });
  await t('a job Studio never saved opens with its footage and reels; the list has dates and reel counts', () => {
    touch(join(ROOT, 'inbox', 'studio', OLD, 'one.mp4')); touch(join(ROOT, 'inbox', 'studio', OLD, 'words.json')); touch(join(ROOT, 'inbox', 'studio', OLD, 'takes', 'take-1.mp4'));
    touch(join(ROOT, 'jobs', OLD, 'reel-v1.mp4')); touch(join(ROOT, 'jobs', OLD, 'reel-v2.mp4'));
    const list = C.listVideos(B), old = list.find(v => v.job === OLD);
    assert.ok(old, 'listed'); assert.strictEqual(old.outputs, 2); assert.strictEqual(old.saved, false); assert.strictEqual(old.footage, 2); assert.ok(old.at);
    assert.strictEqual(list[0].job, B); assert.strictEqual(list[0].current, true);
    assert.ok(list.find(v => v.job === A).saved);
    const s = busyBoard(B); const o = C.switchVideo(s, { open: OLD });
    assert.strictEqual(o.restored, false); assert.deepStrictEqual(s.footage, [`inbox/studio/${OLD}/one.mp4`, `inbox/studio/${OLD}/takes/take-1.mp4`]);
    assert.strictEqual(C.outputsOf(s).length, 2); assert.ok(s.pack, 'the look stays when nothing was saved');
  });

  await t('busy: a running task refuses the switch; work cut off by a restart is settled so it never blocks forever', () => {
    const s = busyBoard(B); s.task = { id: 1, kind: 'draft', status: 'running' }; s.tx = { a: { status: 'running' } };
    assert.throws(() => C.switchVideo(s, { name: 'nv-x-' + P }), e => e.code === 409 && /draft is running/.test(e.message));
    assert.strictEqual(C.settleStale(s), 2); assert.strictEqual(s.task.status, 'cancelled'); assert.strictEqual(s.tx.a.status, 'failed');
    assert.strictEqual(C.videoBusy(s), null);
  });
  await t('busy: a reference link being read (its own lane, not the task) still refuses the switch; a waiting or finished one does not', () => {
    const s = busyBoard(B); s.task = null; s.reference.queue = [{ id: 1, status: 'ready' }, { id: 2, status: 'queued' }];
    assert.strictEqual(C.videoBusy(s), null);
    for (const st of ['downloading', 'tearing']) { s.reference.queue[1].status = st; assert.strictEqual(C.videoBusy(s), 'A reference link is still downloading');
      assert.throws(() => C.switchVideo(s, { name: 'nv-y-' + P }), e => e.code === 409 && /reference link is still downloading/.test(e.message)); }
    assert.strictEqual(C.settleStale(s), 1); assert.strictEqual(s.reference.queue[1].status, 'failed'); assert.match(s.reference.queue[1].error, /Studio stopped/); assert.strictEqual(C.videoBusy(s), null);
  });
  await t('a file teardown that was cut off or failed is not left "running" (it would refuse every Recreate draft): the file can be broken down again', () => {
    const s = busyBoard(B); s.task = null; s.reference = { ...s.reference, mode: 'recreate', status: 'running', file: 'teardown-in/studio/x.mp4', extracted: null, queue: [] };
    assert.strictEqual(C.settleStale(s), 1); assert.strictEqual(s.reference.status, 'uploaded');
    s.reference.status = 'running'; s.reference.file = null; assert.strictEqual(C.settleReference(s), true); assert.strictEqual(s.reference.status, 'none');
    s.reference.status = 'running'; s.reference.extracted = { name: 'x' }; C.settleReference(s); assert.strictEqual(s.reference.status, 'ready');
    assert.strictEqual(C.settleReference(s), false);
  });
  // over HTTP, with the real server
  const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
  const base = busyBoard(A); base.imports = [{ id: 9, status: 'downloading' }]; base.chat = []; C.save(base);
  const stale = () => C.load().imports[0].status;
  srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
  const req = async (p, b) => { const r = await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
  await t('server: a download cut off by a restart is settled; refused while a download runs; then New video and Open a past video', async () => {
    assert.strictEqual(stale(), 'failed', 'a download marked running when Studio started is settled');
    const d = C.load(); d.imports = [{ id: 9, status: 'downloading' }]; C.save(d);
    let r = await req('/api/videos'); assert.strictEqual(r.j.current, A); assert.ok(/downloading/.test(r.j.busy));
    r = await req('/api/videos/new', { name: B }); assert.strictEqual(r.status, 409); assert.ok(/still downloading/.test(r.j.error));
    const s = C.load(); s.imports = []; C.save(s);
    r = await req('/api/videos/new', { name: MCPJ, keepLook: false }); assert.strictEqual(r.status, 200, JSON.stringify(r.j));
    assert.strictEqual(r.j.state.job, MCPJ); assert.strictEqual(r.j.state.pack, null); assert.deepStrictEqual(r.j.state.footage, []); assert.deepStrictEqual(r.j.outputs, []);
    assert.strictEqual(r.j.video.job, MCPJ);
    r = await req('/api/videos/open', { job: A }); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.state.job, A); assert.strictEqual(r.j.outputs.length, 1); assert.ok(r.j.state.pack);
    r = await req('/api/videos/open', { job: '../etc' }); assert.strictEqual(r.status, 404);
  });
  await t('MCP: list_videos, new_video and open_video drive the running Studio', async () => {
    client = new Client({ name: 'videos-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: new URL(url).port }, stderr: 'ignore' }));
    const names = (await client.listTools()).tools.map(x => x.name);
    for (const k of ['list_videos', 'new_video', 'open_video']) assert.ok(names.includes(k), k);
    let r = (await client.callTool({ name: 'list_videos', arguments: {} })).structuredContent;
    assert.strictEqual(r.current, A); assert.ok(r.videos.some(v => v.job === MCPJ));
    r = (await client.callTool({ name: 'new_video', arguments: { name: MCPJ } }));
    assert.ok(r.isError, 'a taken name is refused');
    r = (await client.callTool({ name: 'new_video', arguments: { name: MCPJ + '-2' } })).structuredContent;
    assert.strictEqual(r.job, MCPJ + '-2'); assert.deepStrictEqual(r.footage, []); assert.strictEqual(C.load().job, MCPJ + '-2');
    r = (await client.callTool({ name: 'open_video', arguments: { job: A } })).structuredContent;
    assert.strictEqual(r.job, A); assert.strictEqual(r.restored, true); assert.strictEqual(r.outputs.length, 1);
  });
  console.log(`\n${n} studio video tests passed`);
} finally {
  if (client) await client.close().catch(() => {});
  if (srv) srv.kill();
  for (const d of made) rmSync(d, { recursive: true, force: true });
  rmSync(STATE, { recursive: true, force: true });
}
