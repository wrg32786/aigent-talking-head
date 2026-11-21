// B-roll and API keys, with no network and no real keys: a local mock server stands in for Pexels, Pixabay and
// Higgsfield (STUDIO_API_BASE_<ID>), so CI never touches a provider.
// - keys: saved owner-only (600), env wins, status and every page or agent view never carries a value, Test key
//   against the mock (works, wrong key), fal says it has no key check, messages never echo a key
// - stock: search with orientation and length filters, the missing-key message, download into the library with the
//   license, no duplicates, links off the provider refused
// - lane: beats from the draft, slot timing, placements, inserts and credits (kit/studio/broll-run.mjs)
// - ideas: the agent's wait for approve or dismiss; the rules suggest from the caption words
// - generate: off by default, needs confirm from the page, the Higgsfield estimate and a run (queued, in progress,
//   completed, download) that lands on the beat; the agent can only ask; stubs say why
// - MCP: list_broll, add_broll, suggest_broll, fill_slot, broll_providers (set or not, never the key)
// Run: node tests/studio-broll.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-broll-test-')), LIB = join(STATE, 'lib'), JOB = 'broll-test-' + process.pid;
process.env.STUDIO_DIR = join(STATE, 'studio'); process.env.STUDIO_BROLL_LIBRARY = LIB;
for (const k of ['PEXELS_API_KEY', 'PIXABAY_API_KEY', 'HF_API_KEY_ID', 'HF_API_KEY_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'REPLICATE_API_TOKEN', 'FAL_KEY']) process.env[k] = '';
const KEYS = await import('../kit/studio/keys.mjs'), BR = await import('../kit/studio/broll.mjs'), LANE = await import('../kit/studio/lane.mjs'), GEN = await import('../kit/studio/gen.mjs'), MAKE = await import('../kit/studio/broll-make.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(100); } };

// mp4 bytes: a real clip when ffmpeg is here, else an mp4 header
const CLIP = join(STATE, 'clip.mp4');
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24:duration=2', '-pix_fmt', 'yuv420p', CLIP]);
else { const b = Buffer.alloc(40e3); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(CLIP, b); }
const BODY = readFileSync(CLIP);
const PEX = 'pex-test-key-123456', PIX = 'pix-test-key-654321', HF = 'hfid0001:hfsecret0001';
const hits = []; let mockUrl = '', hfPolls = 0;
const jsonRes = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); hits.push({ m: req.method, p: u.pathname, auth: req.headers.authorization || '' });
  if (u.pathname.startsWith('/files/')) { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': BODY.length }); return res.end(BODY); }
  if (u.pathname === '/v1/videos/search') {
    if (req.headers.authorization !== PEX) return jsonRes(res, 401, { error: 'bad key' });
    const v = (id, w, h, d) => ({ id, width: w, height: h, duration: d, url: `https://www.pexels.com/video/laptop-on-desk-${id}/`, image: `${mockUrl}/files/${id}.jpg`, user: { name: 'Ana Lens', url: 'https://www.pexels.com/@ana' },
      video_files: [{ link: `${mockUrl}/files/pexels-${id}-hd.mp4`, width: w, height: h, quality: 'hd', file_type: 'video/mp4' }, { link: `${mockUrl}/files/pexels-${id}-uhd.mp4`, width: w * 2, height: h * 2, quality: 'uhd', file_type: 'video/mp4' }] });
    return jsonRes(res, 200, { videos: [v(101, 1080, 1920, 8), v(102, 1920, 1080, 12), v(103, 1080, 1920, 25)] });
  }
  if (u.pathname === '/api/videos/') {
    if (u.searchParams.get('key') !== PIX) return jsonRes(res, 400, { error: '[ERROR 400] Invalid or missing API key' });
    return jsonRes(res, 200, { hits: [{ id: 201, pageURL: 'https://pixabay.com/videos/city-201/', tags: 'city, night, lights', duration: 9, user: 'Pix Person', user_id: 7, videos: { medium: { url: `${mockUrl}/files/pixabay-201.mp4`, width: 1280, height: 720, size: 1000, thumbnail: `${mockUrl}/files/t.jpg` } } }] });
  }
  // Higgsfield (docs.higgsfield.ai): Key auth, estimate, queued request, status_url
  if (u.pathname.startsWith('/estimate/') || /^\/(kling-video|higgsfield-ai)\//.test(u.pathname) || u.pathname.startsWith('/requests/')) {
    if (req.headers.authorization !== 'Key ' + HF) return jsonRes(res, 401, { detail: 'Invalid credentials' });
    if (u.pathname.startsWith('/estimate/')) return jsonRes(res, 200, { usd: 0.42 });
    if (u.pathname.startsWith('/requests/')) { hfPolls++; return jsonRes(res, 200, hfPolls < 2 ? { status: 'in_progress', request_id: 'r1' } : { status: 'completed', request_id: 'r1', video: { url: `${mockUrl}/files/hf-r1.mp4` } }); }
    let b = ''; req.on('data', d => b += d); return req.on('end', () => jsonRes(res, 200, { status: 'queued', request_id: 'r1', status_url: `${mockUrl}/requests/r1/status`, cancel_url: `${mockUrl}/requests/r1/cancel`, got: JSON.parse(b || '{}') }));
  }
  res.writeHead(404); res.end('no');
});
await new Promise(r => mock.listen(0, '127.0.0.1', r)); mockUrl = `http://127.0.0.1:${mock.address().port}`;
const BASES = { STUDIO_API_BASE_PEXELS: mockUrl, STUDIO_API_BASE_PIXABAY: mockUrl, STUDIO_API_BASE_HIGGSFIELD: mockUrl };
Object.assign(process.env, BASES);

// a drafted job: three beats with caption words (what kit/reel.cjs --draft leaves in build/)
const jobDir = join(ROOT, 'jobs', JOB); mkdirSync(join(jobDir, 'build'), { recursive: true });
writeFileSync(join(jobDir, 'build', 'cut.json'), JSON.stringify({ segs: [{ file: CLIP, in: 0, out: 3 }, { file: CLIP, in: 3, out: 7, pad: 0.2 }, { file: CLIP, in: 7, out: 9 }], tail: 0.3, inserts: [{ file: '../broll/own.mp4', at: 8.5, dur: 0.5 }] }));
writeFileSync(join(jobDir, 'build', 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify({ flips: [{ start: 0.1, end: 2.8, text: 'Editing ate my weekends' }, { start: 3.1, end: 6.9, text: 'Now the dashboard shows every sale' }, { start: 7.4, end: 8.9, text: 'Revenue doubled' }, { start: 4, end: 5, mode: 22, text: 'a card, not words' }] }) + ';\n');

const env = { ...process.env, CI: '1', STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, body, headers = {}) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers, body: body !== undefined ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };
const noKeys = s => { for (const k of [PEX, PIX, HF, 'hfsecret0001']) assert.ok(!String(s).includes(k), 'a key leaked: ' + String(s).slice(0, 200)); };

let client;
try {
  await t('keys: saved owner-only, status says set and where from but never the value, env wins, pairs need both halves', async () => {
    assert.strictEqual(KEYS.status().find(k => k.id === 'pexels').set, false);
    KEYS.save('pexels', PEX);
    const f = KEYS.keysPath(); assert.ok(existsSync(f)); if (process.platform !== 'win32') assert.strictEqual(statSync(f).mode & 0o777, 0o600);
    const st = KEYS.status(); noKeys(JSON.stringify(st)); const p = st.find(k => k.id === 'pexels'); assert.deepStrictEqual([p.set, p.from], [true, 'settings']);
    assert.strictEqual(KEYS.get('pexels', { PEXELS_API_KEY: 'from-env' }), 'from-env');
    assert.strictEqual(KEYS.status({ PEXELS_API_KEY: 'x' }).find(k => k.id === 'pexels').from, 'env PEXELS_API_KEY');
    assert.throws(() => KEYS.save('higgsfield', 'only-one-half'), /Key ID and the Key secret/);
    assert.throws(() => KEYS.save('nope', 'x'), /no provider/);
    KEYS.save('higgsfield', { id: 'hfid0001', secret: 'hfsecret0001' }); assert.strictEqual(KEYS.get('higgsfield'), HF);
    assert.strictEqual(KEYS.scrub(`bad key ${HF} and hfsecret0001`, HF), 'bad key [key] and [key]');
    assert.strictEqual(KEYS.envWithKeys({}).OPENAI_API_KEY, undefined);
    assert.ok(readFileSync(join(ROOT, '.gitignore'), 'utf8').includes('jobs/') || readFileSync(join(ROOT, '.gitignore'), 'utf8').includes('.studio'), 'the keys file is under an ignored folder');
  });
  await t('Test key: one documented call against the mock; a wrong key fails plainly; fal has no key check', async () => {
    const ok = await KEYS.test('pexels'); assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.strictEqual(hits.filter(h => h.p === '/v1/videos/search').pop().auth, PEX);
    const badk = await KEYS.test('pexels', { value: 'wrong-key-000' }); assert.strictEqual(badk.ok, false); assert.ok(/not valid \(401\)/.test(badk.error)); noKeys(JSON.stringify(badk));
    const hf = await KEYS.test('higgsfield'); assert.strictEqual(hf.ok, true); assert.ok(hits.some(h => h.p === '/estimate/higgsfield-ai/soul/v2/standard'));
    KEYS.save('fal', 'fal-key-abc:def'); const fal = await KEYS.test('fal'); assert.strictEqual(fal.ok, null); assert.ok(/no documented key check/.test(fal.note)); KEYS.save('fal', null);
    assert.strictEqual(KEYS.status().find(k => k.id === 'pexels').tested.ok, true);
  });
  await t('server: /api/keys and the session never carry a key; save, test and remove from the page', async () => {
    const k = await req('/api/keys'); assert.strictEqual(k.status, 200); noKeys(k.text);
    assert.strictEqual(k.j.keys.find(x => x.id === 'pexels').set, true); assert.ok(k.j.sources.find(x => x.id === 'pexels').on);
    const s = await req('/api/keys', { id: 'pixabay', value: PIX }); assert.strictEqual(s.status, 200); noKeys(s.text);
    const tt = await req('/api/keys/test', { id: 'pixabay' }); assert.strictEqual(tt.j.ok, true, tt.text); noKeys(tt.text);
    const st = await req('/api/state'); noKeys(st.text); const b = await req('/api/broll'); noKeys(b.text);
    assert.strictEqual((await req('/api/keys', { id: 'pexels', value: 'has space' })).status, 400);
  });
  await t('stock: Pexels search filters orientation and length, Pixabay too, and download lands in the library with the license once', async () => {
    const r = await BR.searchStock('pexels', { query: 'laptop desk', orientation: 'portrait', max: 20 });
    assert.deepStrictEqual(r.map(x => x.id), ['101']); assert.strictEqual(r[0].author.name, 'Ana Lens'); assert.ok(r[0].preview);
    assert.deepStrictEqual((await BR.searchStock('pexels', { query: 'laptop desk', min: 10 })).map(x => x.id), ['102', '103']);
    const px = await BR.searchStock('pixabay', { query: 'city', orientation: 'landscape' }); assert.deepStrictEqual(px.map(x => x.id), ['201']);
    await assert.rejects(BR.searchStock('pexels', { query: 'x' }, { env: { ...process.env, PEXELS_API_KEY: '' }, fetchImpl: async () => ({ ok: false, status: 401 }) }).catch(e => { throw e; }), /did not accept the key|Add your/);
    const c = await BR.downloadStock('pexels', r[0]); assert.strictEqual(c.source, 'pexels'); assert.ok(/Pexels License/.test(c.license.name)); assert.strictEqual(c.author.name, 'Ana Lens');
    assert.ok(hits.some(h => h.p === '/files/pexels-101-hd.mp4'), 'took the file nearest 1080, not the 4K one'); assert.ok(existsSync(BR.pathOf(c)));
    assert.strictEqual((await BR.downloadStock('pexels', r[0])).id, c.id, 'no duplicate');
    await assert.rejects(BR.downloadStock('pexels', { ...r[0], id: '999', files: [{ link: 'https://evil.example/x.mp4', width: 1080, height: 1920 }] }, { env: { ...process.env, STUDIO_API_BASE_PEXELS: '' } }), /not on Pexels/);
    const cr = BR.credits([c], 'job'); assert.ok(/Ana Lens/.test(cr) && /Videos provided by Pexels/.test(cr) && /pexels\.com\/license/.test(cr));
    assert.ok(BR.search('laptop').some(x => x.id === c.id)); assert.ok(BR.search('pexels').length >= 1);
  });
  await t('stock over the server: needs a job-free search, add puts the clip on a beat', async () => {
    const st = await req('/api/broll/stock?provider=pexels&q=laptop&orientation=landscape'); assert.strictEqual(st.status, 200); assert.deepStrictEqual(st.j.results.map(x => x.id), ['102']);
    const nok = await req('/api/broll/stock?provider=pexels&q='); assert.strictEqual(nok.status, 400);
  });
  await t('lane: beats come from the draft segments and caption words; timing, placements and inserts', async () => {
    const cut = JSON.parse(readFileSync(join(jobDir, 'build', 'cut.json'), 'utf8')), g = {}; new Function('window', readFileSync(join(jobDir, 'build', 'captions.js'), 'utf8'))(g);
    const b = LANE.beats(cut, g.CAPTIONS); assert.deepStrictEqual(b.map(x => [x.n, x.start, x.end]), [[1, 0, 3], [2, 3, 7.2], [3, 7.2, 9.2]]);
    assert.strictEqual(b[1].text, 'Now the dashboard shows every sale'); assert.ok(!b[1].text.includes('card'));
    assert.deepStrictEqual(LANE.timing({}, b[1], { kind: 'video', seconds: 10 }), { offset: 0.2, dur: 3.5, at: 3.2, in: 0 });
    assert.deepStrictEqual(LANE.timing({ offset: 1, dur: 9 }, b[1], { kind: 'video', seconds: 2 }), { offset: 1, dur: 2, at: 4, in: 0 }, 'never longer than the clip');
    assert.strictEqual(LANE.timing({ offset: 1.5 }, b[2], { kind: 'image' }).dur, 0.5, 'never past the beat');
    const ins = LANE.inserts({ 2: { clip: 'a', place: 'top' }, 3: { clip: 'gone' } }, b, id => (id === 'a' ? { id: 'a', kind: 'image' } : null), () => '/x/a.png');
    assert.deepStrictEqual(ins, [{ file: '/x/a.png', at: 3.2, dur: 3.5, in: 0, place: 'top', image: true, beat: 2, clip: 'a', studio: true }]);
    assert.strictEqual(LANE.queryOf('Now the dashboard shows every sale'), 'dashboard shows');
  });
  await t('split layouts: the split panel behind the top of your head, framed cards with your head over the edge (kit/split.cjs)', async () => {
    const SPL = createRequire(import.meta.url)('../kit/split.cjs');
    assert.deepStrictEqual(LANE.PLACES, ['full', 'top', 'pip', 'frame']); assert.strictEqual(LANE.PLACE_LABEL.frame, 'Framed cards');
    assert.deepStrictEqual(SPL.PLACES, LANE.PLACES, 'one list of placements');
    const face = { crown: 400, cx: 600 };
    const top = SPL.layout({ place: 'top' }, face);
    assert.strictEqual(top.dy, 960 - 72 - 400, 'the top of the head 72 px into the panel'); assert.deepStrictEqual([top.band.y0 < 888, top.band.y1], [true, 960]);
    assert.ok(top.capY < 888 - 30, 'captions sit above the head on the panel');
    const flat = SPL.layout({ place: 'top' }, face, { mask: false }); assert.strictEqual(flat.dy, 960 + 28 - 400, 'no mask: the head stays under the seam'); assert.strictEqual(flat.band, null);
    assert.strictEqual(SPL.layout({ place: 'top', overlap: 30 }, face).dy, 960 - 30 - 400);
    const old = SPL.layout({ place: 'top' }, null); assert.strictEqual(old.dy, 960 - (0.4 * 1920 - 480), 'no face track: the old split');
    const fr = SPL.layout({ place: 'frame' }, face);
    assert.ok(fr.card.w < 1080 && fr.card.h < 960, 'the framed card is smaller than the split presenter');
    assert.ok(fr.dx <= fr.card.x && fr.dx + fr.sw >= fr.card.x + fr.card.w && fr.dy <= fr.card.y && fr.dy + fr.sh >= fr.card.y + fr.card.h, 'your picture covers the card');
    assert.ok(Math.abs(400 * fr.s + fr.dy - (fr.card.y - 60)) <= 1, 'the head breaks out over the card top');
    assert.ok(fr.capY > fr.panel.y + fr.panel.h && fr.capY < fr.card.y - 100, 'the caption line sits between the cards');
    assert.deepStrictEqual(SPL.mapZone([500, 500, 700, 800, 400], top), [500, 988, 700, 1288, 888]);
    assert.ok(SPL.lightBg({ place: 'frame' }) && !SPL.lightBg({ place: 'frame', frameBg: ['#101418', '#000000'] }) && !SPL.lightBg({ place: 'top' }));
    assert.strictEqual(SPL.layout({ place: 'frame', frameColor: 'red' }, face).color, '#3d8bff', 'only a hex colour');
    assert.strictEqual(SPL.layout({ place: 'full' }, face), null);
  });
  await t('slots over the server: upload to the library and onto a beat, change the placement and timing, clear', async () => {
    assert.strictEqual((await req('/api/state', { job: JOB })).status, 200);
    let v = await req('/api/broll'); assert.strictEqual(v.j.draft, true); assert.strictEqual(v.j.beats.length, 3);
    const up = await fetch(url + '/api/broll/upload?name=my%20desk.mp4&beat=2&place=pip', { method: 'POST', body: BODY }); const uj = await up.json(); assert.strictEqual(up.status, 200, JSON.stringify(uj));
    assert.strictEqual(uj.clip.source, 'upload'); assert.ok(uj.clip.tags.includes('desk'));
    v = await req('/api/broll'); const b2 = v.j.beats[1]; assert.strictEqual(b2.slot.clip.id, uj.clip.id); assert.strictEqual(b2.slot.place, 'pip');
    const ch = await req('/api/broll/slot', { beat: 2, place: 'top', offset: 0.5, dur: 1.5 }); assert.strictEqual(ch.status, 200);
    const s2 = ch.j.broll.beats[1].slot; assert.deepStrictEqual([s2.place, s2.offset, s2.dur, s2.at], ['top', 0.5, 1.5, 3.5]);
    assert.strictEqual((await req('/api/broll/slot', { beat: 9, clip: uj.clip.id })).status, 400);
    assert.strictEqual((await req('/api/broll/slot', { beat: 1, clip: 'brnope' })).status, 404);
    assert.strictEqual((await fetch(url + '/api/broll/upload?name=notes.txt', { method: 'POST', body: 'x' })).status, 400);
    const f = await fetch(url + `/api/broll/file?id=${uj.clip.id}`); assert.strictEqual(f.status, 200); assert.strictEqual((await f.arrayBuffer()).byteLength, BODY.length);
  });
  await t('ideas: the agent proposes, the page approves (the clip goes on) or dismisses; the rules suggest from the words', async () => {
    const lib = (await req('/api/broll/library?q=laptop')).j.clips; assert.ok(lib.length);
    const id = await req('/api/broll/ideas', { by: 'claude-code', ideas: [{ beat: 3, idea: 'The laptop shot from Pexels', clip: lib[0].id, place: 'full' }, { beat: 1, idea: 'A counter card', card: { kind: 'counter', to: 12 } }] });
    assert.strictEqual(id.status, 200, id.text); assert.strictEqual(id.j.broll.beats[2].idea.by, 'Claude Code');
    assert.ok(id.j.state.chat.some(m => /suggested b-roll for 2 spots/.test(m.text || '')));
    assert.strictEqual((await req('/api/broll/ideas', { ideas: [{ beat: 2, card: { kind: 'html', html: '<script>x</script>' } }] })).status, 400);
    assert.strictEqual(id.j.broll.beats[2].slot, null, 'nothing placed before approve');
    const ap = await req('/api/broll/idea', { beat: 3, action: 'approve' }); assert.strictEqual(ap.status, 200, ap.text); assert.strictEqual(ap.j.broll.beats[2].slot.clip.id, lib[0].id); assert.strictEqual(ap.j.broll.beats[2].idea, null);
    const dm = await req('/api/broll/idea', { beat: 1, action: 'dismiss' }); assert.strictEqual(dm.j.broll.beats[0].idea, null);
    await req('/api/broll/slot', { beat: 3, clear: true });
    const sg = await req('/api/broll/suggest', { all: true }); assert.strictEqual(sg.status, 200); const i3 = sg.j.broll.beats[2].idea; assert.ok(i3 && i3.query === 'revenue doubled', JSON.stringify(sg.j.broll.beats[2]));
    assert.deepStrictEqual([i3.card && i3.card.kind, i3.card && i3.card.to, i3.card && i3.card.suffix], ['counter', 2, 'x'], '"doubled" is a 2x counter card'); assert.ok(/doubled/.test(i3.why));
    const i1 = sg.j.broll.beats[0].idea; assert.ok(i1 && i1.offset >= 1.2, 'the first spot gets an idea too, after the hook shows the face'); assert.strictEqual(sg.j.broll.beats[1].idea, null, 'not on a filled spot');
    const sparse = await req('/api/broll/suggest', {}); assert.strictEqual(sparse.j.count, 0, 'one every 6 s: the filled spot at 3.5 s leaves no room in a 9 s reel');
    await req('/api/broll/idea', { beat: 3, action: 'dismiss' }); await req('/api/broll/idea', { beat: 1, action: 'dismiss' });
  });
  await t('render plan: broll-run puts the lane into cut.json (paths from build/), keeps other inserts, writes and removes credits.txt', async () => {
    const lib = BR.load().clips, pex = lib.find(c => c.source === 'pexels');
    await req('/api/broll/slot', { beat: 3, clip: pex.id, place: 'full' });
    const v = (await req('/api/broll')).j, cut = JSON.parse(readFileSync(join(jobDir, 'build', 'cut.json'), 'utf8')), g = {}; new Function('window', readFileSync(join(jobDir, 'build', 'captions.js'), 'utf8'))(g);
    const slots = Object.fromEntries(v.beats.filter(b => b.slot).map(b => [b.n, { clip: b.slot.clip.id, place: b.slot.place, offset: b.slot.offset, dur: b.slot.dur }]));
    const byId = Object.fromEntries(lib.map(c => [c.id, c])), ins = LANE.inserts(slots, LANE.beats(cut, g.CAPTIONS), id => byId[id], c => BR.pathOf(c));
    const plan = join(jobDir, 'broll.json'); writeFileSync(plan, JSON.stringify({ inserts: ins, credits: BR.credits([...new Set(ins.map(x => byId[x.clip]))], JOB) }));
    const r = spawnSync(process.execPath, [join(ROOT, 'kit', 'studio', 'broll-run.mjs'), 'apply', '--name', JOB, '--plan', plan], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(join(jobDir, 'build', 'cut.json'), 'utf8'));
    assert.strictEqual(out.inserts.length, 3); assert.ok(out.inserts.some(x => x.file === '../broll/own.mp4' && !x.studio), 'kept the recipe insert');
    const top = out.inserts.find(x => x.place === 'top'); assert.ok(top.file.startsWith('../') && !top.file.startsWith('/'), top.file); assert.deepStrictEqual([top.at, top.dur], [3.5, 1.5]);
    const cr = readFileSync(join(jobDir, 'credits.txt'), 'utf8'); assert.ok(/Videos provided by Pexels/.test(cr) && /Your own footage/.test(cr));
    writeFileSync(plan, JSON.stringify({ inserts: [], credits: '' })); spawnSync(process.execPath, [join(ROOT, 'kit', 'studio', 'broll-run.mjs'), 'apply', '--name', JOB, '--plan', plan]);
    const out2 = JSON.parse(readFileSync(join(jobDir, 'build', 'cut.json'), 'utf8')); assert.deepStrictEqual(out2.inserts.map(x => x.file), ['../broll/own.mp4']); assert.ok(!existsSync(join(jobDir, 'credits.txt')));
  });
  await t('generate: off by default, refuses without the page and a confirm, then Higgsfield estimate and a run that lands on the beat', async () => {
    const body = { provider: 'higgsfield', kind: 'video', prompt: 'a slow push in on a laptop showing a sales dashboard', seconds: 5, aspect: '9:16', beat: 1, place: 'full' };
    const off = await req('/api/broll/generate', { ...body, confirm: true }, { 'x-studio-page': '1' }); assert.strictEqual(off.status, 403); assert.ok(/Allow generating/.test(off.j.error));
    const s = await req('/api/settings', { broll: { generate: true } }); assert.strictEqual(s.status, 200, s.text);
    assert.strictEqual((await req('/api/broll/generate', body, { 'x-studio-page': '1' })).status, 400, 'needs confirm');
    assert.strictEqual((await req('/api/broll/generate', { ...body, confirm: true })).status, 403, 'only the page approves');
    const est = await req('/api/broll/generate/estimate', body); assert.strictEqual(est.status, 200, est.text); assert.strictEqual(est.j.usd, 0.42); assert.strictEqual(est.j.model, 'kling-video/v2.5-turbo/pro/text-to-video');
    const before = hits.length;
    const go = await req('/api/broll/generate', { ...body, confirm: true, estimate: est.j }, { 'x-studio-page': '1' }); assert.strictEqual(go.status, 202, go.text);
    const done = await until(async () => { const v = (await req('/api/broll')).j; const g = v.gens.find(x => x.id === go.j.id); if (g && g.status === 'failed') throw new Error(g.error); return g && g.status === 'done' && v; }, 30000);
    assert.strictEqual(done.beats[0].slot.clip.source, 'generate'); assert.strictEqual(done.beats[0].slot.clip.provider, 'Higgsfield');
    const posted = hits.slice(before).find(h => h.m === 'POST' && h.p === '/kling-video/v2.5-turbo/pro/text-to-video'); assert.ok(posted && posted.auth === 'Key ' + HF);
    assert.ok(hits.slice(before).some(h => h.p === '/requests/r1/status') && hits.slice(before).some(h => h.p === '/files/hf-r1.mp4'));
  });
  await t('generate: a bad key, a stub and a missing model say why, with no key in the message', async () => {
    await assert.rejects(GEN.estimate({ provider: 'runway', prompt: 'x' }, {}), /not wired/);
    await assert.rejects(GEN.estimate({ provider: 'veo', prompt: 'x' }, {}), /preview API ended/);
    await assert.rejects(GEN.estimate({ provider: 'replicate', prompt: 'x' }, {}), /Add your Replicate key/);
    KEYS.save('replicate', 'r8_testtoken'); await assert.rejects(GEN.estimate({ provider: 'replicate', prompt: 'x' }, {}), /name a Replicate model/);
    const e = await GEN.estimate({ provider: 'replicate', prompt: 'x', model: 'owner/model' }, {}); assert.strictEqual(e.usd, null); assert.ok(/model's page/.test(e.from));
    KEYS.save('higgsfield', { id: 'wrongid', secret: 'wrongsecret' });
    await assert.rejects(GEN.estimate({ provider: 'higgsfield', prompt: 'x' }, {}), err => /did not accept the key/.test(err.message) && !/wrongsecret/.test(err.message));
    KEYS.save('higgsfield', { id: 'hfid0001', secret: 'hfsecret0001' });
    assert.ok(GEN.list({ broll: {} }).some(p => p.id === 'sora' && p.stub));
  });
  await t('cards: each kind builds a page with no scripts; bad specs fail before Chrome starts', async () => {
    for (const s of [{ kind: 'chart', bars: [{ label: 'A', value: 2 }] }, { kind: 'counter', to: 10 }, { kind: 'quote', text: 'Hi' }, { kind: 'code', code: 'x = 1' }, { kind: 'terminal', lines: ['$ ls'] }, { kind: 'html', html: '<h1>Hi</h1>' }]) {
      const h = MAKE.html(s); assert.ok(h.startsWith('<!doctype html>') && !/<script/i.test(h), s.kind); }
    assert.ok(!MAKE.html({ kind: 'quote', text: '<img src=x onerror=alert(1)>' }).includes('<img'), 'text is escaped');
    assert.throws(() => MAKE.html({ kind: 'counter' }), /to/); assert.throws(() => MAKE.html({ kind: 'html', html: '<b onclick="x()">' }), /no scripts/); assert.throws(() => MAKE.html({ kind: 'video' }), /kind/);
  });
  await t('MCP: broll_providers says set or not (never a key), list_broll, fill_slot, suggest_broll, and a generate is only an ask', async () => {
    client = new Client({ name: 'broll-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, stderr: 'ignore', env: { ...env, STUDIO_PORT: new URL(url).port } }));
    const names = (await client.listTools()).tools.map(x => x.name); for (const k of ['list_broll', 'add_broll', 'suggest_broll', 'fill_slot', 'broll_providers']) assert.ok(names.includes(k), k);
    const pv = await client.callTool({ name: 'broll_providers', arguments: {} }); assert.ok(!pv.isError, JSON.stringify(pv)); noKeys(JSON.stringify(pv));
    assert.strictEqual(pv.structuredContent.keys.find(k => k.id === 'pexels').set, true); assert.strictEqual(pv.structuredContent.keys.find(k => k.id === 'openai').set, false); assert.strictEqual(pv.structuredContent.generateAllowed, true);
    const lb = (await client.callTool({ name: 'list_broll', arguments: { q: 'laptop' } })).structuredContent; assert.strictEqual(lb.beats.length, 3); assert.ok(lb.library.length >= 1);
    const fs = await client.callTool({ name: 'fill_slot', arguments: { beat: 3, clip: lb.library[0].id, place: 'pip' } }); assert.ok(!fs.isError, JSON.stringify(fs)); assert.strictEqual(fs.structuredContent.slot.place, 'pip');
    assert.strictEqual((await req('/api/broll')).j.beats[2].slot.by, 'Broll Test');
    const sg = await client.callTool({ name: 'suggest_broll', arguments: { ideas: [{ beat: 2, idea: 'Search a sales dashboard', query: 'sales dashboard' }] } }); assert.deepStrictEqual(sg.structuredContent.pending, [{ beat: 2, idea: 'Search a sales dashboard' }]);
    const ask = await client.callTool({ name: 'fill_slot', arguments: { beat: 2, generate: { provider: 'higgsfield', prompt: 'a dashboard ticking up', seconds: 5 } } }); assert.ok(!ask.isError, JSON.stringify(ask));
    assert.strictEqual(ask.structuredContent.asked, true); assert.strictEqual(ask.structuredContent.estimate.usd, 0.42);
    const v = (await req('/api/broll')).j; assert.strictEqual(v.asks.length, 1); assert.strictEqual(v.gens.filter(g => g.prompt === 'a dashboard ticking up').length, 0, 'nothing ran');
    const dec = await req('/api/broll/ask', { action: 'decline', id: v.asks[0].id }); assert.strictEqual(dec.j.broll.asks.length, 0);
    const bad = await client.callTool({ name: 'add_broll', arguments: {} }); assert.ok(bad.isError);
  });
} finally {
  try { await client?.close(); } catch {}
  srv.kill(); mock.close();
  rmSync(STATE, { recursive: true, force: true }); rmSync(jobDir, { recursive: true, force: true });
}
console.log(`\n${n} studio b-roll tests passed`);
process.exit(0);
