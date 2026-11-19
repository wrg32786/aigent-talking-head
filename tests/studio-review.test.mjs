// Studio review tools without a browser or a real draft: what to swap from a teardown, the clean-up pass from Whisper
// word times (and the cut rule reel.cjs uses), the edit receipt, comments on the preview with the frame, and the
// reference video route for show original. A stand-in teardown (STUDIO_TEARDOWN) writes a shipped example recipe.
// Run: node tests/studio-review.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as RV from '../kit/studio/review.mjs';
import * as C from '../kit/studio/core.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-review-test-')), JOB = 'review-test-' + process.pid, JOBDIR = join(ROOT, 'jobs', JOB);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = (a, txt) => txt.split(' ').map((x, i) => [+(a + i * 0.3).toFixed(2), +(a + i * 0.3 + 0.24).toFixed(2), x]);
const CLIPS = { src: 'test', clips: [
  { id: 'clip-001', file: 'clip-001.mp4', dur: 4, status: 'keep', text: 'So um this is the hook', words: [...W(0.1, 'So um this'), ...W(2.0, 'is the hook')] },
  { id: 'clip-002', file: 'clip-002.mp4', dur: 2, status: 'retake (see clip-003)', text: 'Here is the point', words: W(0.1, 'Here is the point') },
  { id: 'clip-003', file: 'clip-003.mp4', dur: 2, status: 'keep', text: 'Here is the point', words: W(0.1, 'Here is the point') },
] };

await t('what to swap: hook, cuts, titles and CTA with times, mapped to picks that exist', async () => {
  const sw = RV.swapList(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), C.catalog());
  assert.strictEqual(sw.seconds, 30);
  const k = sw.parts.map(p => p.kind);
  assert.strictEqual(k[0], 'hook'); assert.ok(k.includes('cta') && k.includes('title'));
  assert.deepStrictEqual(sw.parts.filter(p => p.kind === 'cut').map(p => p.at), [5, 11, 18, 24]);
  const hook = sw.parts[0]; assert.ok(/Ten years ago/.test(hook.detail)); assert.ok(hook.refs.some(r => r.ref === 'entrance:blur-rise'));
  assert.ok(sw.parts.find(p => p.at === 5).refs.some(r => r.ref === 'transition:crossfade'));
  const cat = C.catalog(); for (const p of sw.parts) for (const r of p.refs) assert.ok(cat.items[r.ref], r.ref);
});
await t('clean-up: long pauses, filler words and flagged retakes; decisions become cuts; the cut rule', async () => {
  const items = RV.cleanup(CLIPS);
  const f = items.find(x => x.type === 'filler'), s = items.find(x => x.type === 'silence'), k = items.find(x => x.type === 'take');
  assert.ok(f && f.text === 'um' && f.clip === 'clip-001' && f.from < 0.4 && f.to > 0.6, JSON.stringify(f));
  assert.ok(s && s.clip === 'clip-001' && s.from > 0.8 && s.to < 2.0, JSON.stringify(s));
  assert.ok(k && k.clip === 'clip-002' && k.remove === true);
  assert.strictEqual(items.length, 3, JSON.stringify(items));
  assert.strictEqual(RV.cleanup(CLIPS, { silence: 2 }).filter(x => x.type === 'silence').length, 0);
  const pl = RV.plan(items, { [s.id]: false, [k.id]: false }, CLIPS);
  assert.deepStrictEqual(pl.cuts, { 'clip-001': [[f.from, f.to]] }); assert.deepStrictEqual(pl.keep, ['clip-002']);
  assert.deepStrictEqual(RV.subtract([[0, 4]], [[1, 2]]), [[0, 1], [2, 4]]);
  assert.deepStrictEqual(RV.subtract([[0, 1], [1.5, 4]], [[0.5, 2]]), [[0, 0.5], [2, 4]]);
  assert.deepStrictEqual(RV.subtract([[0, 4]], [[0, 4]]), []);
  // reel.cjs carries the same rule
  const src = readFileSync(join(ROOT, 'kit', 'reel.cjs'), 'utf8');
  assert.ok(src.includes("opt('cleanup')") && src.includes('cutsOf(c)'));
});
await t('edit receipt: choices.json as plain lines with times and reasons', async () => {
  const r = RV.receipt({ job: 'x', style: { pack: 'cinematic' }, locksText: 'transitions whip', captions: { style: 'kinetic', entrance: null, entranceWhy: 'kit default' }, music: { bed: 'none' }, punch: 0.1,
    beats: [{ n: 1, start: 0, end: 2, finish: 'teal', finishWhy: 'pack pool' }, { n: 2, start: 2, end: 5, transition: 'whip', transitionWhy: 'locked' }], titles: [{ n: 1, start: 1.2, text: 'Hi', entrance: 'typewriter', entranceWhy: 'locked', place: 'left', layer: 'front' }], graphics: [] });
  assert.strictEqual(r.summary, '2 beats over 5 s, 1 title, 0 graphics.');
  assert.ok(/0:02\.0 Beat 2: whip transition\. Why: locked\./.test(r.text), r.text);
  assert.ok(/Title "Hi": typewriter, left, front/.test(r.text));
  assert.ok(!/\u2014/.test(r.text));
  assert.strictEqual(RV.receipt(null), null);
});
await t('comment line: time, box or spot, the note and the frame', async () => {
  assert.strictEqual(RV.commentLine({ text: 'smaller title', t: 12.34, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, video: 'jobs/a/reel-v2.mp4', frame: 'jobs/a/comments/comment-1.jpg' }),
    'Comment on reel-v2.mp4 at 0:12.3 (12.34 s), the box from 10% to 40% across and 20% to 30% down: smaller title Frame: jobs/a/comments/comment-1.jpg');
  assert.ok(/the point 50% across and 50% down/.test(RV.commentLine({ text: 'x', t: 0, region: { x: 0.5, y: 0.5, w: 0, h: 0 } })));
});

// ---------- through the server ----------
// a small video made now (ffmpeg when present, otherwise an mp4 header the downloader accepts without ffprobe)
const MP4 = (() => { const f = join(STATE, 'ref.mp4');
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) { spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=24:duration=2', '-pix_fmt', 'yuv420p', f]); return readFileSync(f); }
  const b = Buffer.alloc(4096); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); return b; })();
const media = http.createServer((req, res) => { if (req.url === '/ref.mp4') { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': MP4.length }); return res.end(MP4); } res.writeHead(404); res.end(); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_TEARDOWN: 'tests/fixtures/fake-teardown.mjs', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const req = async (p, body, headers = {}) => { const r = await fetch(url + p, { method: body !== undefined ? 'POST' : 'GET', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); return { status: r.status, j, r }; };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(150); } };
try {
  await req('/api/state', { job: JOB });
  await t('server: no reference video yet is a 404; a reference link gives the swap list and its Use picks', async () => {
    assert.strictEqual((await req('/api/reference/video')).status, 404);
    const a = await req('/api/reference/url', { url: `http://127.0.0.1:${media.address().port}/ref.mp4` }); assert.strictEqual(a.status, 202);
    const v = await until(async () => { const x = (await req('/api/state')).j; const q = x.state.reference.queue[0]; if (q && q.status === 'failed') throw new Error('reference failed: ' + q.error); return x.state.reference.status === 'ready' && x.swap ? x : null; });
    assert.ok(v.swap.parts.length >= 8 && v.swap.parts[0].kind === 'hook');
    const r = await fetch(url + '/api/reference/video', { headers: { range: 'bytes=0-99' } }); assert.strictEqual(r.status, 206); assert.strictEqual((await r.arrayBuffer()).byteLength, 100);
    const cut = v.swap.parts.find(p => p.at === 5);
    const u = await req('/api/reference/apply', { refs: cut.refs.map(x => x.ref) }); assert.strictEqual(u.status, 200);
    assert.ok(u.j.state.picks.transition.allow.includes('crossfade'));
  });
  await t('server: clean-up before a draft is refused; after it, the list, the plan file and the next draft args', async () => {
    assert.strictEqual((await req('/api/cleanup', { decisions: {} })).status, 400);
    mkdirSync(join(JOBDIR, 'clips'), { recursive: true }); writeFileSync(join(JOBDIR, 'clips', 'clips.json'), JSON.stringify(CLIPS));
    const g = await req('/api/cleanup'); assert.strictEqual(g.status, 200); assert.strictEqual(g.j.items.length, 3); assert.strictEqual(g.j.clips['clip-001'].file, `jobs/${JOB}/clips/clip-001.mp4`);
    assert.strictEqual((await req('/api/state')).j.cleanupReady, true);
    const s = g.j.items.find(x => x.type === 'silence');
    const p = await req('/api/cleanup', { decisions: { [s.id]: false }, redraft: false }); assert.strictEqual(p.status, 202, JSON.stringify(p.j));
    const plan = JSON.parse(readFileSync(join(JOBDIR, 'cleanup.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(plan.cuts), ['clip-001']); assert.strictEqual(plan.cuts['clip-001'].length, 1);
    assert.strictEqual(p.j.on, true); assert.strictEqual(p.j.items.find(x => x.id === s.id).remove, false, 'the decision is remembered');
    const st = (await req('/api/state')).j.state; assert.ok(st.chat.some(m => m.kind === 'action' && /^Clean-up: 0 pauses, 1 filler words/.test(m.text)), JSON.stringify(st.chat.slice(-2)));
    assert.strictEqual((await req('/api/cleanup', { silence: 9 })).status, 400);
    const off = await req('/api/cleanup', { on: false }); assert.strictEqual(off.j.on, false);
  });
  await t('server: choices come with the edit receipt', async () => {
    writeFileSync(join(JOBDIR, 'choices.json'), JSON.stringify({ job: JOB, style: { pack: 'cinematic' }, locksText: '', captions: { style: 'kinetic' }, music: { bed: 'none' }, beats: [{ n: 1, start: 0, end: 3 }], titles: [], graphics: [] }));
    const c = await req('/api/choices'); assert.ok(c.j.receipt && c.j.receipt.summary === '1 beat over 3 s, 0 titles, 0 graphics.', JSON.stringify(c.j.receipt));
  });
  await t('server: a comment on the preview saves the frame and queues one chat line for the agent', async () => {
    assert.strictEqual((await req('/api/comment', { text: '' })).status, 400);
    const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex').toString('base64');
    const c = await req('/api/comment', { text: 'Move this title up', t: 3.25, region: { x: 0.2, y: 0.6, w: 0.5, h: 0.15 }, video: `jobs/${JOB}/reel-v1.mp4`, image: png });
    assert.strictEqual(c.status, 200, JSON.stringify(c.j)); assert.strictEqual(c.j.via, 'agent');
    const m = c.j.state.chat.filter(x => x.role === 'user').pop();
    assert.strictEqual(m.status, 'queued'); assert.ok(/^Comment on reel-v1\.mp4 at 0:03\.3 \(3\.25 s\), the box from 20% to 70% across and 60% to 75% down: Move this title up Frame: jobs\//.test(m.text), m.text);
    assert.strictEqual(m.attach.kind, 'comment'); assert.ok(existsSync(join(ROOT, m.attach.frame)), m.attach.frame);
    const p = await req('/api/agent/pending'); assert.ok(p.j.messages.some(x => x.attach && x.attach.frame === m.attach.frame), 'the agent sees the frame');
    const bad = await req('/api/comment', { text: 'x', video: '../../etc/passwd' }); assert.strictEqual(bad.j.state.chat.filter(x => x.role === 'user').pop().attach.video, null);
  });
  await t('server: cross-site posts are refused', async () => {
    assert.strictEqual((await req('/api/comment', { text: 'x' }, { origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await req('/api/cleanup', { decisions: {} }, { origin: 'https://evil.example' })).status, 403);
  });
} finally { srv.kill(); media.close(); rmSync(STATE, { recursive: true, force: true }); rmSync(JOBDIR, { recursive: true, force: true }); for (const d of ['teardown']) for (const x of [`studio-${JOB}-r1`]) rmSync(join(ROOT, d, x), { recursive: true, force: true }); rmSync(join(ROOT, 'teardown-in', 'studio', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`.slice(0, 48)), { recursive: true, force: true }); }
console.log(`${n} studio review tests passed`);
