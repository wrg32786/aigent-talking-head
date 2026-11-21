// Uploading or selecting new footage starts a fresh edit: leftover B-roll from the last draft must
// not stay on the timeline, and there is a way to clear all B-roll (with undo). Files are never
// deleted. Finish must show only the current draft (never a render from another take), and earlier
// reels stay in the Outputs library. The same over HTTP and over MCP (clear_broll, fill_slot clear+all).
// Run: node tests/studio-reset.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-reset-'));
const LIB = join(STATE, 'lib');
process.env.STUDIO_DIR = join(STATE, 'studio');
process.env.STUDIO_BROLL_LIBRARY = LIB;
const C = await import('../kit/studio/core.mjs');
const P = process.pid, JOB = `reset-${P}`, JOB2 = `reset-b-${P}`;
const made = [JOB, JOB2].flatMap(j => [join(ROOT, 'jobs', j), join(ROOT, 'inbox', 'studio', j)]);
let n = 0, srv = null, client = null;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

const CLIP = join(STATE, 'clip.mp4');
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=12:duration=1', '-pix_fmt', 'yuv420p', CLIP]);
else { const b = Buffer.alloc(40e3); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(CLIP, b); }
const BODY = readFileSync(CLIP);

function writeDraft(job) {
  const build = join(ROOT, 'jobs', job, 'build');
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, 'cut.json'), JSON.stringify({ segs: [{ file: CLIP, in: 0, out: 3 }, { file: CLIP, in: 3, out: 7 }], tail: 0.2 }));
  writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify({ flips: [{ start: 0.1, end: 2.8, text: 'Hello from the first take' }, { start: 3.1, end: 6.5, text: 'This is the old video' }] }) + ';\n');
}

function editedBoard(job, { keepLook = false, clipId = null } = {}) {
  const s = C.defaultState(), cat = C.catalog();
  const tr = Object.values(cat.items).find(i => i.kind === 'transition' && i.mode === 'multi');
  const take = `inbox/studio/${job}/take.mp4`;
  Object.assign(s, {
    job, footage: [take], clips: null, asIs: true,
    cut: { source: take, candidates: [{ id: 'c1' }] },
    pieces: { [take]: { ids: ['p1'], reasons: {}, by: 'you' } },
    lines: { [take]: { keep: { 1: true }, bites: [], seq: 1 } },
    broll: { [job]: { slots: clipId ? { 1: { clip: clipId, place: 'full', offset: 0.4, dur: 2, in: 0 } } : { 1: { clip: 'gone', place: 'full' } }, ideas: {}, asks: [], gens: [], marks: [2.5], raws: [], cutins: [] } },
    drafted: { key: 'take:' + C.footageKey({ footage: [take], clips: null }), from: 'take', at: Date.now() },
    cleanup: { on: true }, lockedAtDraft: '--x', output: { kind: 'one' },
    reference: { ...s.reference, file: `teardown-in/studio/${job}/ref.mp4`, status: 'ready', extracted: { look: 'x' } },
    pack: cat.packs[0].name, music: { bed: 'none', energy: 'high', upload: null },
    sound: { sfx: 'off', cap: 'on' }, pace: { tighten: 0.5, punch: 'off' }, export: cat.exports[0],
    keepLook,
  });
  if (tr) C.applyPatch(s, { picks: { [tr.ref]: 'allow' } });
  return s;
}

try {
  await t('core: first footage on a clean board keeps the look; a leftover draft is ignored', () => {
    const s = C.defaultState(), cat = C.catalog();
    s.job = JOB; s.pack = cat.packs[0].name;
    assert.strictEqual(C.hasEdit(s), false);
    const r = C.addFootage(s, `inbox/studio/${JOB}/new.mp4`);
    assert.strictEqual(r.added, true); assert.strictEqual(r.reset, false);
    assert.strictEqual(s.pack, cat.packs[0].name, 'look stays on the first file of an empty board');
    assert.strictEqual(s.draftStale, true);
    assert.strictEqual(C.draftIsCurrent(s), false);
  });

  await t('core: adding footage to an edited board clears cuts, pieces, b-roll, reference, draft and the look', () => {
    const s = editedBoard(JOB), pack = s.pack, take = s.footage[0];
    const r = C.addFootage(s, `inbox/studio/${JOB}/two.mp4`);
    assert.strictEqual(r.reset, true); assert.ok(/fresh edit/.test(r.note));
    assert.deepStrictEqual(s.footage, [take, `inbox/studio/${JOB}/two.mp4`]);
    assert.strictEqual(s.cut, null); assert.strictEqual(s.pieces, undefined);
    assert.deepStrictEqual((s.broll[JOB] || {}).slots, {});
    assert.strictEqual(s.drafted, null); assert.strictEqual(s.draftStale, true);
    assert.deepStrictEqual(s.reference, C.defaultState().reference);
    assert.strictEqual(s.pack, null, 'look resets unless Keep my look was chosen');
    assert.notStrictEqual(s.pack, pack);
    assert.strictEqual(C.draftIsCurrent(s), false);
  });

  await t('core: Keep my look (from New video) keeps the pack and picks when new footage arrives', () => {
    const s = editedBoard(JOB, { keepLook: true }), pack = s.pack, picks = JSON.stringify(s.picks);
    C.addFootage(s, `inbox/studio/${JOB}/three.mp4`);
    assert.strictEqual(s.pack, pack);
    assert.strictEqual(JSON.stringify(s.picks), picks);
    assert.strictEqual(s.cut, null);
    assert.deepStrictEqual((s.broll[JOB] || {}).slots, {});
    assert.ok(/kept your look/.test(C.footageResetNote(s)));
  });

  await t('core: files are not the session; resetEdit never drops the job or footage list', () => {
    const s = editedBoard(JOB, { keepLook: true });
    const footage = [...s.footage];
    C.resetEdit(s, { keepLook: true });
    assert.strictEqual(s.job, JOB);
    assert.deepStrictEqual(s.footage, footage);
  });


  await t('core: adding footage stamps earlier reels with the previous draft key, and they no longer match', () => {
    const dir = join(ROOT, 'jobs', JOB);
    mkdirSync(dir, { recursive: true });
    copyFileSync(CLIP, join(dir, 'reel-v1.mp4'));
    writeFileSync(join(dir, 'reel-v1.settings.json'), JSON.stringify({ version: 1, at: '2026-11-20T10:00:00.000Z', look: 'Mint Kinetic', from: 'the whole take' }));
    mkdirSync(join(dir, 'reel-v1.build'), { recursive: true });
    writeFileSync(join(dir, 'reel-v1.build', 'meta.json'), JSON.stringify({ reel: 'reel-v1.mp4', saved: '2026-11-20T10:00:00.000Z', kit: '1.18.1', media: [] }) + '\n');
    const s = editedBoard(JOB, { keepLook: true });
    const prev = C.draftStamp(s);
    const r = C.addFootage(s, `inbox/studio/${JOB}/two.mp4`);
    assert.strictEqual(r.reset, true);
    const st = JSON.parse(readFileSync(join(dir, 'reel-v1.settings.json'), 'utf8'));
    assert.strictEqual(st.key, prev.key, JSON.stringify(st));
    assert.deepStrictEqual(st.takes, ['take.mp4']);
    const meta = JSON.parse(readFileSync(join(dir, 'reel-v1.build', 'meta.json'), 'utf8'));
    assert.strictEqual(meta.key, prev.key);
    const ident = C.outputIdentity(JOB, 1);
    assert.strictEqual(C.outputMatchesDraft(s, ident, 'take:' + C.footageKey(s)), false, 'stale after the new file');
    assert.strictEqual(C.draftIsCurrent(s), false);
  });

  // HTTP + MCP
  mkdirSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true });
  copyFileSync(CLIP, join(ROOT, 'inbox', 'studio', JOB, 'take.mp4'));
  writeDraft(JOB);
  writeFileSync(join(ROOT, 'jobs', JOB, 'choices.json'), JSON.stringify({ beats: [] }) + '\n');
  const BR = await import('../kit/studio/broll.mjs');
  const clip = BR.add(CLIP, { name: 'old-broll.mp4', source: 'upload', title: 'Old b-roll' });
  const board = editedBoard(JOB, { clipId: clip.id });
  board.chat = []; C.save(board);

  const env = { ...process.env, CI: '1', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
  srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  let srvOut = '';
  const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
  const req = async (path, body, { raw, headers } = {}) => {
    const opt = { method: body !== undefined || raw ? 'POST' : 'GET', headers: { ...headers } };
    if (raw) opt.body = raw;
    else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(url + path, opt); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text };
  };

  await t('the bug: a leftover draft plus slots still show on the timeline before the upload', async () => {
    const r = await req('/api/broll');
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.j.draft, true, 'the leftover build is what used to stay on screen');
    assert.ok(r.j.beats.some(b => b.slot && b.slot.clip && b.slot.clip.id === clip.id), JSON.stringify(r.j.beats.map(b => b.slot && b.slot.clip && b.slot.clip.name)));
  });

  await t('uploading new footage starts a fresh edit: the old B-roll leaves the timeline, the look resets, files stay', async () => {
    const r = await req(`/api/upload?kind=footage&name=${encodeURIComponent('new-take.mp4')}`, undefined, { raw: BODY });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.j.reset, true);
    assert.ok(/fresh edit/.test(r.j.note));
    assert.ok(/Outputs/.test(r.j.note) && /New video/.test(r.j.note), r.j.note);
    assert.ok(r.j.state.footage.some(f => f.endsWith('new-take.mp4')));
    assert.ok(r.j.state.footage.some(f => f.endsWith('take.mp4')), 'the first file stays in the list');
    assert.strictEqual(r.j.state.cut, null);
    assert.strictEqual(r.j.state.pack, null);
    assert.deepStrictEqual(r.j.state.reference.extracted, null);
    assert.strictEqual(r.j.broll.draft, false, 'the leftover build must not drive the timeline');
    assert.ok(!(r.j.broll.beats || []).some(b => b.slot), 'no old clip on the timeline');
    assert.ok(existsSync(join(ROOT, 'jobs', JOB, 'build', 'cut.json')), 'the old draft files stay on disk');
    assert.ok(existsSync(join(ROOT, 'inbox', 'studio', JOB, 'take.mp4')), 'the old take stays on disk');
    assert.ok(existsSync(join(LIB, clip.file)) || BR.get(clip.id), 'the library clip is not deleted');
    assert.ok((r.j.outputs || []).some(f => f.endsWith('reel-v1.mp4')), 'the old reel stays on disk and in the library list');
    assert.deepStrictEqual(r.j.currentOutputs || [], [], 'Finish must not play the earlier take');
    assert.strictEqual(r.j.draftPreview, null);
    const ch = await req('/api/choices');
    assert.strictEqual(ch.j.stale, true);
    assert.strictEqual(ch.j.choices, null);
    const lib = await req('/api/outputs');
    const v1 = (lib.j.versions || []).find(v => v.v === 1);
    assert.ok(v1, 'old reel is in Outputs');
    assert.strictEqual(v1.current, false);
    assert.ok(v1.take && /take\.mp4/.test(v1.take), JSON.stringify(v1));
    assert.ok(v1.reel && v1.files.some(f => f.path.endsWith('reel-v1.mp4')));
  });


  await t('Finish: after a new draft, only a render that matches the current build key is current', async () => {
    const s = C.load();
    s.draftStale = false;
    s.drafted = { key: 'take:' + C.footageKey(s), from: 'take', at: Date.now() };
    C.save(s);
    writeDraft(s.job);
    let r = await req('/api/state');
    assert.deepStrictEqual(r.j.currentOutputs || [], [], 'a new draft without a render must not show the old reel');
    assert.ok((r.j.outputs || []).some(f => f.endsWith('reel-v1.mp4')));
    const dir = join(ROOT, 'jobs', s.job);
    copyFileSync(CLIP, join(dir, 'reel-v2.mp4'));
    writeFileSync(join(dir, 'reel-v2.settings.json'), JSON.stringify({ version: 2, at: new Date().toISOString(), job: s.job, key: s.drafted.key, footage: C.footageKey(s), takes: C.takeNames(s), from: 'the whole take' }));
    r = await req('/api/state');
    assert.deepStrictEqual(r.j.currentOutputs, [`jobs/${s.job}/reel-v2.mp4`], JSON.stringify(r.j.currentOutputs));
    assert.ok(r.j.outputs.includes(`jobs/${s.job}/reel-v1.mp4`));
    const lib = await req('/api/outputs');
    const by = Object.fromEntries((lib.j.versions || []).map(v => [v.v, v]));
    assert.strictEqual(by[2].current, true);
    assert.strictEqual(by[1].current, false);
    assert.ok(by[2].take);
  });

  await t('Clear all B-roll: confirm path clears every slot, undo puts them back, the library is unchanged', async () => {
    // put b-roll back on a fresh draft: write drafted current and clear draftStale by restoring a matching draft key
    const s = C.load();
    s.draftStale = false;
    s.drafted = { key: 'take:' + C.footageKey(s), from: 'take', at: Date.now() };
    s.broll = s.broll || {}; s.broll[JOB] = s.broll[JOB] || { slots: {}, ideas: {}, asks: [], gens: [], marks: [], raws: [], cutins: [] };
    s.broll[JOB].slots = { 1: { clip: clip.id, place: 'pip', offset: 0.5, dur: 1.5, in: 0 } };
    C.save(s);
    let r = await req('/api/broll');
    assert.strictEqual(r.j.draft, true);
    assert.ok(r.j.beats.some(b => b.slot && b.slot.clip.id === clip.id));
    r = await req('/api/broll/clear', {});
    assert.strictEqual(r.status, 200, r.text);
    assert.ok(!(r.j.broll.beats || []).some(b => b.slot), 'all spots empty');
    assert.strictEqual(r.j.broll.undo, true);
    assert.ok(BR.get(clip.id), 'library unchanged');
    r = await req('/api/broll/clear', { undo: true });
    assert.strictEqual(r.status, 200, r.text);
    assert.ok(r.j.broll.beats.some(b => b.slot && b.slot.clip.id === clip.id && b.slot.place === 'pip'));
    r = await req('/api/broll/clear', { undo: true });
    assert.strictEqual(r.status, 400);
  });

  await t('New video with Keep my look, then a first upload, keeps the look and shows no leftover timeline', async () => {
    const s = C.load();
    s.pack = C.catalog().packs[0].name; s.imports = []; s.task = null; s.tx = {}; C.save(s);
    let r = await req('/api/videos/new', { name: JOB2, keepLook: true });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.j.state.job, JOB2);
    assert.ok(r.j.state.pack);
    assert.deepStrictEqual(r.j.state.footage, []);
    r = await req(`/api/upload?kind=footage&name=${encodeURIComponent('fresh.mp4')}`, undefined, { raw: BODY });
    assert.strictEqual(r.status, 200, r.text);
    assert.ok(!r.j.reset, 'the first file on a new video is not a reset of an old edit');
    assert.ok(r.j.state.pack, 'Keep my look carried to the first upload');
    assert.strictEqual(r.j.broll.draft, false);
    r = await req('/api/videos/open', { job: JOB });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.j.state.job, JOB);
    assert.ok(r.j.state.footage.some(f => f.endsWith('new-take.mp4')), 'the job as it was left after the reset is still openable');
    assert.ok(existsSync(join(ROOT, 'inbox', 'studio', JOB, 'take.mp4')));
  });

  await t('MCP: clear_broll and fill_slot clear+all match the page, and undo works', async () => {
    client = new Client({ name: 'reset-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: new URL(url).port }, stderr: 'ignore' }));
    const names = (await client.listTools()).tools.map(x => x.name);
    assert.ok(names.includes('clear_broll'));
    const s = C.load();
    s.draftStale = false;
    s.drafted = { key: 'take:' + C.footageKey(s), from: 'take', at: Date.now() };
    s.broll = s.broll || {}; const job = s.job;
    s.broll[job] = s.broll[job] || { slots: {}, ideas: {}, asks: [], gens: [], marks: [], raws: [], cutins: [] };
    s.broll[job].slots = { 1: { clip: clip.id, place: 'full', offset: 0.2, dur: 2, in: 0 }, 2: { clip: clip.id, place: 'top', offset: 0.3, dur: 2, in: 0 } };
    C.save(s);
    let r = (await client.callTool({ name: 'clear_broll', arguments: {} })).structuredContent;
    assert.strictEqual(r.filled, 0); assert.ok(/Cleared/.test(r.note));
    r = (await client.callTool({ name: 'clear_broll', arguments: { undo: true } })).structuredContent;
    assert.ok(r.filled >= 1, 'undo restored slots: ' + r.filled);
    r = (await client.callTool({ name: 'fill_slot', arguments: { clear: true, all: true } })).structuredContent;
    assert.strictEqual(r.cleared, true); assert.strictEqual(r.filled, 0);
    assert.ok(BR.get(clip.id));
  });

  console.log(`\n${n} studio reset tests passed`);
} finally {
  if (client) await client.close().catch(() => {});
  if (srv) srv.kill();
  for (const d of made) rmSync(d, { recursive: true, force: true });
  rmSync(STATE, { recursive: true, force: true });
}
