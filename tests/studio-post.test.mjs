// The Post step and the Buffer MCP tools, with no network and no real keys: one local mock stands in for Buffer's
// GraphQL API, Cloudflare R2 (S3 PUT with SigV4), Cloudinary (unsigned and signed upload, ping) and the public link check
// (STUDIO_API_BASE_BUFFER, _R2, _CLOUDINARY, _PUBLIC), so CI never touches a service.
// - links: Dropbox, Drive, signed, local and http links refused with the reason
// - rules: Facebook Reels 90 s, YouTube Shorts 3 min, caption limits, YouTube title, 9:16 warning
// - createPost input: drafts by default (saveToDraft), queue, schedule (dueAt), now; Instagram reel, Facebook reel, YouTube title and category
// - SigV4 matches AWS's published example
// - keys: Buffer, R2 and Cloudinary saved owner-only, never shown, Test key against the mock
// - server: /api/post never carries a key; host settings; channels; a send to R2 then Buffer (drafts), a 429 retried,
//   one channel skipped for length, per-channel MutationError; re-send reuses the upload; Cloudinary unsigned and signed;
//   post now refused without confirm; a pasted Dropbox link refused; an HEVC reel re-encoded to H.264
// - MCP: buffer_channels, buffer_post_reel (drafts by default, now needs confirmNow), setup_status posting
// Run: node tests/studio-post.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { createHash, createHmac } from 'crypto';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-post-test-')), JOB = 'post-test-' + process.pid;
process.env.STUDIO_DIR = join(STATE, 'studio');
for (const k of ['BUFFER_API_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) process.env[k] = '';
const KEYS = await import('../kit/studio/keys.mjs'), P = await import('../kit/studio/post.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const FF = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

// reels: a 5 s 9:16 H.264 render, and (with ffmpeg) a 100 s one for the length rules
const jobDir = join(ROOT, 'jobs', JOB); mkdirSync(jobDir, { recursive: true });
const mk = (out, secs, extra = []) => spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=360x640:rate=24:duration=${secs}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, ...extra, '-pix_fmt', 'yuv420p', '-shortest', out]);
if (FF) { mk(join(jobDir, 'reel-v1.mp4'), 100, ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac']); mk(join(jobDir, 'reel-v2.mp4'), 5, ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac']); }
else { const b = Buffer.alloc(40e3); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(join(jobDir, 'reel-v1.mp4'), b); writeFileSync(join(jobDir, 'reel-v2.mp4'), b); }

const BUF = 'buf-test-key-0123456789', R2AK = 'r2akid0001', R2SK = 'r2secretkey0001xyz', CLK = 'clkey0001', CLS = 'clsecret0001abc';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const hits = [], objects = new Map(), posts = []; let rateOnce = true, failChannel = null;
const CHANNELS = [{ id: 'ch-ig', name: 'aigent.ig', displayName: 'AIgent IG', service: 'instagram', avatar: null, isQueuePaused: false }, { id: 'ch-fb', name: 'aigent.fb', displayName: 'AIgent Page', service: 'facebook', isQueuePaused: false },
  { id: 'ch-yt', name: 'aigent.yt', displayName: 'AIgent YT', service: 'youtube', isQueuePaused: false }, { id: 'ch-li', name: 'will', displayName: 'Will LinkedIn', service: 'linkedin', isQueuePaused: true }];
const jsonRes = (res, code, o, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
const body = req => new Promise(ok => { const p = []; req.on('data', d => p.push(d)); req.on('end', () => ok(Buffer.concat(p))); });
const mock = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), b = await body(req); hits.push({ m: req.method, p: u.pathname, auth: req.headers.authorization || '', h: req.headers, len: b.length });
  if (u.pathname === '/gql') {
    if (req.headers.authorization !== 'Bearer ' + BUF) return jsonRes(res, 401, { errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] });
    const j = JSON.parse(b.toString());
    if (/StudioCreatePost/.test(j.query)) {
      if (rateOnce) { rateOnce = false; return jsonRes(res, 429, { errors: [{ message: 'RATE_LIMIT_EXCEEDED' }] }, { 'retry-after': '1' }); }
      const inp = j.variables.input; posts.push(inp);
      if (inp.channelId === failChannel) return jsonRes(res, 200, { data: { createPost: { __typename: 'MutationError', message: 'Channel is disconnected' } } });
      return jsonRes(res, 200, { data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'post-' + posts.length, status: inp.saveToDraft ? 'draft' : 'scheduled', dueAt: inp.dueAt || null } } } });
    }
    if (/StudioChannels/.test(j.query)) return jsonRes(res, 200, { data: { channels: CHANNELS } });
    if (/organizations/.test(j.query)) return jsonRes(res, 200, { data: { account: { organizations: [{ id: 'org1', name: 'AIgent' }] } } });
    return jsonRes(res, 400, { errors: [{ message: 'unknown query' }] });
  }
  if (u.pathname.startsWith('/r2/')) {
    const a = req.headers.authorization || '';
    if (!a.startsWith(`AWS4-HMAC-SHA256 Credential=${R2AK}/`) || !/SignedHeaders=[^,]*host[^,]*x-amz-content-sha256;x-amz-date/.test(a)) { res.writeHead(403); return res.end('<Error><Code>InvalidAccessKeyId</Code></Error>'); }
    const parts = u.pathname.split('/').slice(2); // bucket, key...
    if (parts[0] !== 'my-reels') { res.writeHead(404); return res.end('<Error><Code>NoSuchBucket</Code></Error>'); }
    if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
    if (req.method === 'PUT') {
      if (req.headers['x-amz-content-sha256'] !== createHash('sha256').update(b).digest('hex')) { res.writeHead(400); return res.end('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>'); }
      objects.set(parts.slice(1).join('/'), { type: req.headers['content-type'], len: b.length }); res.writeHead(200); return res.end();
    }
  }
  if (u.pathname.startsWith('/v1_1/')) {
    const [, , cloud, what] = u.pathname.split('/');
    if (cloud !== 'aigent-cloud') return jsonRes(res, 404, { error: { message: 'Invalid cloud_name' } });
    if (what === 'ping') return req.headers.authorization === 'Basic ' + Buffer.from(`${CLK}:${CLS}`).toString('base64') ? jsonRes(res, 200, { status: 'ok' }) : jsonRes(res, 401, { error: { message: 'Invalid api_key' } });
    // multipart: pull the text fields
    const txt = b.toString('latin1'), f = {}; for (const m of txt.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) f[m[1]] = m[2];
    if (f.upload_preset) { if (f.upload_preset !== 'reels_unsigned') return jsonRes(res, 400, { error: { message: 'Upload preset not found' } }); }
    else { const { signature, api_key, ...rest } = f; const want = createHash('sha1').update(Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&') + CLS).digest('hex'); if (api_key !== CLK || signature !== want) return jsonRes(res, 401, { error: { message: 'Invalid Signature' } }); }
    const id = `${f.folder}/${f.public_id}`; objects.set('cl:' + id, { len: b.length });
    return jsonRes(res, 200, { public_id: id, type: 'upload', resource_type: 'video', secure_url: `https://res.cloudinary.com/aigent-cloud/video/upload/v1/${id}.mp4` });
  }
  if (u.pathname.startsWith('/pub/')) { // the public link check: https://<host>/<path> arrives as /pub/<host>/<path>
    const host = decodeURIComponent(u.pathname.split('/')[2]), path = u.pathname.split('/').slice(3).join('/');
    const ok = host === 'pub-test.r2.dev' ? objects.has(decodeURIComponent(path)) : host === 'res.cloudinary.com' ? true : host === 'cdn.example.com';
    if (!ok) { res.writeHead(host === 'private.example.com' ? 403 : 404); return res.end(); }
    res.writeHead(200, { 'content-type': host === 'cdn.example.com' && /page/.test(path) ? 'text/html' : 'video/mp4', 'content-length': '1000' }); return res.end();
  }
  res.writeHead(404); res.end('no');
});
await new Promise(r => mock.listen(0, '127.0.0.1', r)); const M = `http://127.0.0.1:${mock.address().port}`;
const BASES = { STUDIO_API_BASE_BUFFER: M + '/gql', STUDIO_API_BASE_R2: M + '/r2', STUDIO_API_BASE_CLOUDINARY: M, STUDIO_API_BASE_PUBLIC: M + '/pub' };
Object.assign(process.env, BASES);
const noKeys = s => { for (const k of [BUF, R2SK, CLS]) assert.ok(!String(s).includes(k), 'a key leaked: ' + String(s).slice(0, 200)); };

const env = { ...process.env, CI: '1', STUDIO_CHAT: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, b) => { const r = await fetch(url + path, { method: b !== undefined ? 'POST' : 'GET', headers: b !== undefined ? { 'content-type': 'application/json' } : {}, body: b !== undefined ? JSON.stringify(b) : undefined }); const text = await r.text(); noKeys(text); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };
const sendAndWait = async b => { const r = await req('/api/post/send', b); if (r.status !== 202) return { status: r.status, j: { status: 'failed', refused: true, error: r.j.error } }; for (let i = 0; i < 1200; i++) { const j = (await req('/api/post/send?id=' + r.j.id)).j; if (j.status !== 'running') return { status: 200, j }; await new Promise(z => setTimeout(z, 100)); } throw new Error('send timed out'); };

let client;
try {
  await t('links: Dropbox, Drive, signed, local and http refused with the reason; a direct https mp4 passes', async () => {
    assert.match(P.checkUrl('https://www.dropbox.com/s/abc/reel.mp4?dl=1').error, /Dropbox/);
    assert.match(P.checkUrl('https://drive.google.com/file/d/x/view').error, /Google Drive/);
    assert.match(P.checkUrl('https://b.s3.amazonaws.com/r.mp4?X-Amz-Signature=abc&X-Amz-Expires=600').error, /expire/);
    assert.match(P.checkUrl('https://localhost/r.mp4').error, /this computer/);
    assert.match(P.checkUrl('https://192.168.1.4/r.mp4').error, /this computer/);
    assert.match(P.checkUrl('http://cdn.example.com/r.mp4').error, /https/);
    assert.match(P.checkUrl('nope').error, /not a link/);
    const ok = P.checkUrl('https://cdn.example.com/r.mp4'); assert.ok(ok.ok && !ok.warn);
    assert.ok(P.checkUrl('https://cdn.example.com/watch').warn);
  });
  await t('rules: Facebook Reels 90 s and YouTube Shorts 3 min skip; caption limits; YouTube title; 9:16 warning; paused queue', async () => {
    const tall = { seconds: 100, width: 1080, height: 1920 };
    assert.ok(!P.checkChannel({ service: 'facebook' }, tall).ok);
    assert.ok(P.checkChannel({ service: 'instagram' }, tall, { text: 'hi' }).ok);
    assert.ok(!P.checkChannel({ service: 'youtube' }, { ...tall, seconds: 200 }, { text: 'Title line' }).ok);
    assert.ok(P.checkChannel({ service: 'youtube' }, tall, { text: 'Title line' }).ok);
    assert.match(P.checkChannel({ service: 'youtube' }, tall, { text: '' }).block.join(), /title/);
    assert.match(P.checkChannel({ service: 'threads' }, tall, { text: 'x'.repeat(501) }).block.join(), /500/);
    const x = P.checkChannel({ service: 'twitter' }, { seconds: 150, width: 1080, height: 1920 }, { text: 'hi' }); assert.ok(x.ok && x.warn.length);
    assert.match(P.checkChannel({ service: 'instagram' }, { seconds: 20, width: 1920, height: 1080 }, { text: '' }).warn.join(), /9:16/);
    assert.match(P.checkChannel({ service: 'linkedin', isQueuePaused: true }, tall, {}).warn.join(), /paused/);
    assert.ok(!P.checkChannel({ service: 'instagram' }, { seconds: 2 }, {}).ok, 'under 3 s');
  });
  await t('createPost input: drafts by default; queue, schedule, now; Instagram and Facebook reels; YouTube title and category; source', async () => {
    const v = { url: 'https://cdn.example.com/r.mp4', text: 'Line one\nmore' };
    const d = P.postInput({ id: 'a', service: 'instagram' }, v);
    assert.deepStrictEqual([d.mode, d.saveToDraft, d.schedulingType, d.source], ['addToQueue', true, 'automatic', 'aigent-talking-head']);
    assert.deepStrictEqual(d.metadata, { instagram: { type: 'reel', shouldShareToFeed: true } });
    assert.deepStrictEqual(d.assets, [{ video: { url: v.url } }]);
    assert.strictEqual(P.postInput({ id: 'a', service: 'facebook' }, { ...v, mode: 'queue' }).saveToDraft, undefined);
    assert.deepStrictEqual(P.postInput({ id: 'a', service: 'facebook' }, v).metadata, { facebook: { type: 'reel' } });
    const s = P.postInput({ id: 'a', service: 'linkedin' }, { ...v, mode: 'schedule', dueAt: '2030-01-01T10:00:00.000Z' }); assert.deepStrictEqual([s.mode, s.dueAt, s.metadata], ['customScheduled', '2030-01-01T10:00:00.000Z', undefined]);
    assert.strictEqual(P.postInput({ id: 'a', service: 'tiktok' }, { ...v, mode: 'now' }).mode, 'shareNow');
    assert.deepStrictEqual(P.postInput({ id: 'a', service: 'youtube' }, v).metadata, { youtube: { title: 'Line one', categoryId: '22' } });
    assert.deepStrictEqual(P.postInput({ id: 'a', service: 'youtube' }, { ...v, title: 'My <Short>', categoryId: 27 }).metadata.youtube, { title: 'My Short', categoryId: '27' });
    assert.throws(() => P.postInput({ id: 'a', service: 'x' }, { ...v, mode: 'later' }));
  });
  await t('SigV4 matches AWS\'s published S3 example', async () => {
    const h = P.sigv4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', accessKey: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z') });
    assert.ok(h.authorization.endsWith('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'), h.authorization);
  });
  await t('keys: Buffer, R2 and Cloudinary saved owner-only, shown only as set, Test key against the mock', async () => {
    const before = await req('/api/post'); assert.strictEqual(before.j.buffer.set, false); assert.strictEqual(before.j.ready, false);
    assert.strictEqual((await req('/api/post/send', { channels: ['ch-ig'] })).status, 400);
    let r = await req('/api/keys', { id: 'buffer', value: 'wrong-key-123456' }); assert.strictEqual(r.status, 200);
    r = await req('/api/keys/test', { id: 'buffer' }); assert.strictEqual(r.j.ok, false); assert.match(r.j.error, /not valid/);
    await req('/api/keys', { id: 'buffer', value: BUF });
    r = await req('/api/keys/test', { id: 'buffer' }); assert.strictEqual(r.j.ok, true, JSON.stringify(r.j)); assert.match(r.j.note, /1 organization/);
    await req('/api/keys', { id: 'r2', value: { id: R2AK, secret: R2SK } }); await req('/api/keys', { id: 'cloudinary', value: { id: CLK, secret: CLS } });
    const ks = (await req('/api/keys')).j.keys; for (const id of ['buffer', 'r2', 'cloudinary']) { const k = ks.find(x => x.id === id); assert.ok(k && k.set && k.group === 'post', id); }
    const f = join(STATE, 'studio', 'keys.json'); assert.strictEqual(statSync(f).mode & 0o777, 0o600);
    assert.ok(readFileSync(f, 'utf8').includes(BUF));
  });
  await t('host settings: bad values refused; R2 saved; Check host (signed HEAD) works and says why when it does not', async () => {
    let r = await req('/api/post/host', { host: 'r2', r2: { bucket: 'My Bucket' } }); assert.strictEqual(r.status, 400); assert.match(r.j.error, /bucket/);
    r = await req('/api/post/host', { host: 'r2', r2: { publicBase: 'http://pub-test.r2.dev' } }); assert.strictEqual(r.status, 400);
    r = await req('/api/post/host', { host: 'r2', r2: { account: ACCOUNT, bucket: 'my-reels', publicBase: 'https://pub-test.r2.dev/' } }); assert.strictEqual(r.status, 200, r.text);
    assert.deepStrictEqual([r.j.host.pick, r.j.host.r2.ready, r.j.host.r2.publicBase], ['r2', true, 'https://pub-test.r2.dev']);
    r = await req('/api/post/host/test', { host: 'r2' }); assert.strictEqual(r.j.ok, true, JSON.stringify(r.j));
    r = await req('/api/keys/test', { id: 'r2' }); assert.strictEqual(r.j.ok, true);
    await req('/api/post/host', { r2: { bucket: 'other-bucket' } }); r = await req('/api/post/host/test', { host: 'r2' }); assert.match(r.j.error, /no bucket/);
    await req('/api/post/host', { r2: { bucket: 'my-reels' } });
    r = await req('/api/post/host/test', { host: 'cloudinary' }); assert.strictEqual(r.j.ok, false); assert.match(r.j.error, /cloud name/);
  });
  await t('channels: read from Buffer, with each network\'s limits', async () => {
    const r = await req('/api/post/channels'); assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.j.channels.map(c => c.service), ['instagram', 'facebook', 'youtube', 'linkedin']);
    assert.strictEqual(r.j.channels[1].rules.max, 90); assert.strictEqual(r.j.channels[0].name, 'AIgent IG');
  });
  await req('/api/state', { job: JOB });
  await t('send: R2 upload, the public link checked, one draft per channel (a 429 retried), Facebook skipped for length, a MutationError per channel', async () => {
    failChannel = 'ch-li';
    const st = (await req('/api/post')).j; assert.strictEqual(st.reels[0], `jobs/${JOB}/reel-v2.mp4`);
    const r = await sendAndWait({ reel: `jobs/${JOB}/reel-v1.mp4`, channels: ['ch-ig', 'ch-fb', 'ch-yt', 'ch-li'], caption: 'Editing ate my weekends\n#reels' });
    assert.strictEqual(r.j.status, 'done', JSON.stringify(r.j)); const x = r.j.result;
    assert.strictEqual(x.host, 'r2'); assert.ok(x.uploaded); assert.match(x.url, /^https:\/\/pub-test\.r2\.dev\/reels\/post-test-\d+-\d{14}-[0-9a-f]{8}\.mp4$/);
    assert.strictEqual(objects.size, 1); assert.strictEqual([...objects.values()][0].type, 'video/mp4');
    const by = Object.fromEntries(x.results.map(z => [z.channelId, z]));
    assert.ok(by['ch-ig'].ok && by['ch-ig'].status === 'draft');
    if (FF) { assert.ok(by['ch-fb'].skipped, 'a 100 s reel is too long for Facebook Reels'); assert.match(by['ch-fb'].error, /1 min 30 s/); }
    assert.ok(by['ch-yt'].ok); assert.strictEqual(by['ch-li'].ok, false); assert.match(by['ch-li'].error, /disconnected/);
    const ig = posts.find(p => p.channelId === 'ch-ig'); assert.deepStrictEqual([ig.saveToDraft, ig.mode, ig.assets[0].video.url, ig.metadata.instagram.type], [true, 'addToQueue', x.url, 'reel']);
    assert.deepStrictEqual(posts.find(p => p.channelId === 'ch-yt').metadata.youtube, { title: 'Editing ate my weekends', categoryId: '22' });
    assert.ok(!posts.some(p => p.channelId === 'ch-fb') || !FF);
    assert.ok(!rateOnce, 'the 429 was seen and retried');
    assert.ok(existsSync(join(jobDir, 'post', 'posts.json')));
    assert.deepStrictEqual((await req('/api/post')).j.channels, ['ch-ig', 'ch-fb', 'ch-yt', 'ch-li'], 'channels remembered');
    failChannel = null;
  });
  await t('send again: the same reel keeps its link (no second upload); queue mode; post now refused without the tick', async () => {
    const n0 = posts.length, r = await sendAndWait({ reel: `jobs/${JOB}/reel-v1.mp4`, channels: ['instagram'], caption: 'again', mode: 'queue' });
    assert.strictEqual(r.j.status, 'done'); assert.strictEqual(r.j.result.uploaded, false); assert.strictEqual(objects.size, 1);
    assert.strictEqual(posts.length, n0 + 1); assert.strictEqual(posts.at(-1).saveToDraft, undefined); assert.strictEqual(posts.at(-1).mode, 'addToQueue');
    const now = await req('/api/post/send', { channels: ['ch-ig'], mode: 'now' }); assert.strictEqual(now.status, 400); assert.match(now.j.error, /confirm/);
    const bad = await sendAndWait({ channels: ['ch-ig'], mode: 'schedule', dueAt: '2001-01-01T00:00:00Z' }); assert.strictEqual(bad.j.status, 'failed'); assert.match(bad.j.error, /minute from now/);
  });
  await t('your own link: Dropbox refused, a page refused, a direct link sent without any upload', async () => {
    await req('/api/post/host', { host: 'url' });
    let r = await sendAndWait({ channels: ['ch-ig'], url: 'https://www.dropbox.com/s/x/reel.mp4?dl=0' }); assert.strictEqual(r.j.status, 'failed'); assert.match(r.j.error, /Dropbox/);
    r = await sendAndWait({ channels: ['ch-ig'], url: 'https://cdn.example.com/page' }); assert.strictEqual(r.j.status, 'failed'); assert.match(r.j.error, /not a video/);
    r = await sendAndWait({ channels: ['ch-ig'], url: 'https://private.example.com/r.mp4' }); assert.strictEqual(r.j.status, 'failed'); assert.match(r.j.error, /sign-in/);
    r = await sendAndWait({ channels: ['ch-ig'], url: 'https://cdn.example.com/reel.mp4', caption: 'own link' }); assert.strictEqual(r.j.status, 'done', JSON.stringify(r.j));
    assert.strictEqual(posts.at(-1).assets[0].video.url, 'https://cdn.example.com/reel.mp4'); assert.strictEqual(objects.size, 1);
  });
  await t('Cloudinary: unsigned preset upload, then signed with the API key (SHA-1 signature), Check host pings', async () => {
    await req('/api/keys', { id: 'cloudinary', remove: true });
    let r = await req('/api/post/host', { host: 'cloudinary', cloudinary: { cloud: 'aigent-cloud', preset: 'reels_unsigned' } }); assert.strictEqual(r.j.host.cloudinary.ready, true);
    r = await req('/api/post/host/test', { host: 'cloudinary' }); assert.strictEqual(r.j.ok, null); assert.match(r.j.note, /Unsigned/);
    r = await sendAndWait({ reel: `jobs/${JOB}/reel-v2.mp4`, channels: ['ch-ig'], caption: 'cloudinary' }); assert.strictEqual(r.j.status, 'done', JSON.stringify(r.j));
    assert.match(r.j.result.url, /^https:\/\/res\.cloudinary\.com\/aigent-cloud\/video\/upload\/v1\/reels\//);
    await req('/api/post/host', { cloudinary: { preset: null } }); assert.strictEqual((await req('/api/post')).j.host.cloudinary.ready, false, 'no preset and no key');
    await req('/api/keys', { id: 'cloudinary', value: { id: CLK, secret: CLS } });
    r = await req('/api/post/host/test', { host: 'cloudinary' }); assert.strictEqual(r.j.ok, true, JSON.stringify(r.j));
    const before = [...objects.keys()].filter(k => k.startsWith('cl:')).length;
    r = await sendAndWait({ reel: `jobs/${JOB}/reel-v1.mp4`, channels: ['ch-ig'], caption: 'signed' }); assert.strictEqual(r.j.status, 'done', JSON.stringify(r.j));
    assert.strictEqual([...objects.keys()].filter(k => k.startsWith('cl:')).length, before + 1, 'signed upload accepted');
    await req('/api/post/host', { cloudinary: { cloud: 'nope-cloud' } }); r = await req('/api/post/host/test', { host: 'cloudinary' }); assert.match(r.j.error, /no cloud/);
    await req('/api/post/host', { host: 'r2', cloudinary: { cloud: 'aigent-cloud' } });
  });
  if (FF) await t('an HEVC reel is re-encoded to H.264 with AAC before the upload', async () => {
    const hevc = join(jobDir, 'reel-v3.mp4'); const m = mk(hevc, 4, ['-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-c:a', 'aac']);
    if (m.status !== 0) { console.log('  (no libx265 here; skipped)'); return; }
    const r = await sendAndWait({ reel: `jobs/${JOB}/reel-v3.mp4`, channels: ['ch-ig'], caption: 'hevc' }); assert.strictEqual(r.j.status, 'done', JSON.stringify(r.j));
    assert.ok(r.j.result.encoded && r.j.result.encoded.why.some(w => /hevc/.test(w)), JSON.stringify(r.j.result.encoded)); assert.strictEqual(P.probe(join(jobDir, 'post', 'reel-v3-h264.mp4')).vcodec, 'h264');
  });
  await t('MCP: buffer_channels, buffer_post_reel (drafts by default, now needs confirmNow), setup_status says posting', async () => {
    client = new Client({ name: 'post-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env }, stderr: 'ignore' }));
    const names = (await client.listTools()).tools.map(x => x.name); for (const x of ['buffer_channels', 'buffer_post_reel']) assert.ok(names.includes(x), x);
    let r = await client.callTool({ name: 'buffer_channels', arguments: {} }); assert.ok(!r.isError, JSON.stringify(r)); noKeys(JSON.stringify(r));
    assert.strictEqual(r.structuredContent.channels.length, 4); assert.strictEqual(r.structuredContent.buffer.set, true); assert.strictEqual(r.structuredContent.channels.find(c => c.service === 'facebook').maxSeconds, 90);
    const n0 = posts.length;
    r = await client.callTool({ name: 'buffer_post_reel', arguments: { channels: ['instagram'], caption: 'from the agent', reel: `jobs/${JOB}/reel-v2.mp4` } }); assert.ok(!r.isError, JSON.stringify(r)); noKeys(JSON.stringify(r));
    assert.strictEqual(r.structuredContent.mode, 'draft'); assert.strictEqual(posts.length, n0 + 1); assert.strictEqual(posts.at(-1).saveToDraft, true);
    r = await client.callTool({ name: 'buffer_post_reel', arguments: { channels: ['instagram'], mode: 'now', reel: `jobs/${JOB}/reel-v2.mp4` } }); assert.ok(r.isError); assert.match(r.content[0].text, /confirmNow/);
    r = await client.callTool({ name: 'setup_status', arguments: {} }); assert.deepStrictEqual([r.structuredContent.posting.tool, r.structuredContent.posting.buffer, r.structuredContent.posting.host], ['buffer_post_reel', true, 'r2']);
  });
  await t('no key ever reached the page, the agent or a log; every call went to the mock', async () => {
    noKeys(srvOut); noKeys(JSON.stringify((await req('/api/post')).j)); noKeys(JSON.stringify((await req('/api/state')).j));
    assert.ok(hits.length > 10);
  });
} finally {
  if (client) await client.close().catch(() => {});
  srv.kill(); mock.close(); rmSync(STATE, { recursive: true, force: true }); rmSync(jobDir, { recursive: true, force: true });
}
console.log(`\n${n} studio post tests passed`);
