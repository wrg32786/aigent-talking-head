// Post: send a rendered reel to Buffer (the Studio Post step, the MCP tools buffer_channels and buffer_post_reel).
// Buffer's GraphQL API (https://developers.buffer.com) has no upload endpoint: it fetches the video from a public HTTPS
// link when the post goes out, which can be days later for a draft or a scheduled post. So a send is:
//   1. the reel as H.264 MP4 with AAC sound (re-encoded into jobs/<job>/post/ when it is not)
//   2. a public, lasting link: uploaded to your Cloudflare R2 bucket (public bucket URL) or your Cloudinary account, or a
//      link you paste. Dropbox, Google Drive, signed or expiring links and anything on this computer are refused.
//   3. one createPost per channel, saved as a Buffer draft unless you pick queue, a time, or post now (post now needs an
//      explicit confirm, from the page and from the agent alike)
// Keys (Buffer, R2, Cloudinary) are your own and live only in jobs/.studio/keys.json (kit/studio/keys.mjs). Calls happen
// here, in the local server or the MCP process, never in the page. Buffer's terms allow your own key for your own
// account; the kit never ships, collects or proxies a shared key.
// Tests point every service at a mock: STUDIO_API_BASE_BUFFER, STUDIO_API_BASE_R2, STUDIO_API_BASE_CLOUDINARY.
import { spawn, spawnSync } from 'child_process';
import { createHash, createHmac, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as KEYS from './keys.mjs';
import * as S from './settings.mjs';
import * as SZ from './sizes.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const bad = (m, code = 400, extra) => Object.assign(new Error(m), { code }, extra || {});
const wait = ms => new Promise(r => setTimeout(r, ms));
export const SOURCE = 'aigent-talking-head';
export const HOSTS = ['r2', 'cloudinary', 'url'];
export const MODES = ['draft', 'queue', 'schedule', 'now'];

// What Buffer documents per network for a video post (developers.buffer.com and support.buffer.com, Nov 2026).
// max/min: seconds. hard: Buffer or the network rejects a longer video (the channel is skipped with the reason);
// otherwise it is a warning. caption: characters (Buffer counts UTF-16 units). title: YouTube needs one.
export const RULES = {
  instagram: { name: 'Instagram Reels', min: 3, max: 900, hard: true, caption: 2200, tall: true },
  facebook: { name: 'Facebook Reels', min: 3, max: 90, hard: true, caption: 5000, tall: true },
  tiktok: { name: 'TikTok', min: 3, max: 600, hard: true, caption: 2200 },
  youtube: { name: 'YouTube Shorts', max: 180, hard: true, caption: 5000, title: 100, tall: true },
  linkedin: { name: 'LinkedIn', max: 600, caption: 3000 },
  twitter: { name: 'X', min: 0.5, max: 140, caption: 280, note: 'X plays videos up to 2 min 20 s natively; X Premium allows longer posts and up to 25,000 characters.' },
  threads: { name: 'Threads', max: 300, hard: true, caption: 500 },
  bluesky: { name: 'Bluesky', max: 180, caption: 300 },
  pinterest: { name: 'Pinterest', min: 4, max: 900, caption: 500 },
};
export const YT_CATEGORIES = { 1: 'Film & Animation', 2: 'Autos & Vehicles', 10: 'Music', 15: 'Pets & Animals', 17: 'Sports', 19: 'Travel & Events', 20: 'Gaming', 22: 'People & Blogs', 23: 'Comedy', 24: 'Entertainment', 25: 'News & Politics', 26: 'Howto & Style', 27: 'Education', 28: 'Science & Technology', 29: 'Nonprofits & Activism' };
const units = s => String(s || '').length; // UTF-16 units, the way Buffer counts

// ---------- links ----------
// a link Buffer can fetch later: https, a direct file, public, not expiring, not this computer
export function checkUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, error: 'That is not a link. Paste the full https:// address of the video file.' }; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:') return { ok: false, error: 'Buffer needs an https:// link.' };
  if (/(^|\.)dropbox(usercontent)?\.com$|(^|\.)db\.tt$/.test(h)) return { ok: false, error: 'Dropbox links do not work with Buffer (it says so in its API docs). Use R2, Cloudinary, or another public host.' };
  if (/(^|\.)(drive|docs)\.google\.com$|(^|\.)googleusercontent\.com$/.test(h)) return { ok: false, error: 'Google Drive links do not work with Buffer. Use R2, Cloudinary, or another public host.' };
  if (/(^|\.)(onedrive\.live\.com|1drv\.ms|sharepoint\.com|icloud\.com|we\.tl|wetransfer\.com)$/.test(h)) return { ok: false, error: 'Share pages do not work with Buffer: it needs a direct link to the video file on a public host.' };
  if (h === 'localhost' || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\.|^0\.|\.local$|^\[?::1\]?$/.test(h)) return { ok: false, error: 'Buffer fetches the video from its own servers later, so a link on this computer or your home network will not work.' };
  const q = [...u.searchParams.keys()].map(k => k.toLowerCase());
  if (q.some(k => ['x-amz-signature', 'x-amz-expires', 'signature', 'expires', 'se', 'sig', 'token', 'x-goog-signature'].includes(k))) return { ok: false, error: 'That link is signed and will expire, and Buffer may fetch it days from now. Use a public link that does not expire.' };
  const warn = /\.(mp4|mov|m4v)$/i.test(u.pathname) ? null : 'The link does not end in .mp4. Make sure it opens the video file itself, not a page.';
  return { ok: true, url: u.toString(), warn };
}

// ---------- the reel ----------
const has = b => { try { return spawnSync(b, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
export function probe(file) {
  const st = statSync(file), out = { size: st.size, seconds: null, width: null, height: null, vcodec: null, acodec: null, pix: null, format: null, bitrate: null };
  if (!has('ffprobe')) return out;
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name,bit_rate:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  try {
    const j = JSON.parse(r.stdout), v = (j.streams || []).find(s => s.codec_type === 'video'), a = (j.streams || []).find(s => s.codec_type === 'audio');
    Object.assign(out, { seconds: j.format && +j.format.duration || null, format: j.format && j.format.format_name || null, bitrate: j.format && +j.format.bit_rate || null,
      width: v ? v.width : null, height: v ? v.height : null, vcodec: v ? v.codec_name : null, pix: v ? v.pix_fmt : null, acodec: a ? a.codec_name : null });
  } catch {}
  return out;
}
// what Buffer's support pages ask for: H.264 MP4, AAC sound, yuv420p, under 25 Mbps
export function needsEncode(info) {
  const why = [];
  if (info.vcodec && info.vcodec !== 'h264') why.push(`video is ${info.vcodec}, not H.264`);
  if (info.acodec && info.acodec !== 'aac') why.push(`sound is ${info.acodec}, not AAC`);
  if (info.pix && info.pix !== 'yuv420p') why.push(`pixels are ${info.pix}`);
  if (info.format && !/mp4/.test(info.format)) why.push('not an MP4');
  if (info.bitrate && info.bitrate > 25e6) why.push(`bitrate ${Math.round(info.bitrate / 1e6)} Mbps is over 25`);
  return why;
}
export async function ensureH264(file, outDir) {
  const info = probe(file), why = needsEncode(info);
  if (!why.length) return { file, info, encoded: false };
  if (!has('ffmpeg')) throw bad(`The reel needs re-encoding for Buffer (${why.join(', ')}) and ffmpeg is not installed.`);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, basename(file).replace(/\.[^.]+$/, '') + '-h264.mp4');
  if (existsSync(out) && statSync(out).mtimeMs > statSync(file).mtimeMs) return { file: out, info: probe(out), encoded: true, why };
  await new Promise((ok, no) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', '-i', file, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '20M', '-bufsize', '40M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { err += d; }); p.on('close', c => c === 0 ? ok() : no(bad('ffmpeg could not re-encode the reel: ' + err.slice(-300), 500)));
  });
  return { file: out, info: probe(out), encoded: true, why };
}

// per channel: can this reel go there, and what to warn about
// placement 'feed' (Instagram only): a Feed post, which Instagram takes from 4:5 to 1.91:1 only. feed is what
// SZ.fileFor found: the 4:5 of the same version, or missing. A 9:16 file is never sent to the Feed in its place.
export const FEED_MIN = 4 / 5, FEED_MAX = 1.91;
export const placementOf = (ch, placements) => ch && ch.service === 'instagram' && placements && (placements[ch.id] || placements.instagram) === 'feed' ? 'feed' : 'reel';
export function checkChannel(ch, info, { text, title, placement, feed } = {}) {
  const isFeed = placement === 'feed' && ch.service === 'instagram';
  const r = isFeed ? { ...RULES.instagram, name: 'The Instagram Feed', tall: false } : RULES[ch.service] || { name: ch.service }, warn = [], block = [];
  if (isFeed) {
    if (!feed || feed.missing || !info) block.push(`${SZ.MAKE_FEED} first. A 9:16 video only goes to Reels and Stories.`);
    else if (info.width && info.height && (info.width / info.height < FEED_MIN - 0.01 || info.width / info.height > FEED_MAX + 0.01)) block.push(`The Instagram Feed takes 4:5 to 1.91:1; this file is ${info.width}x${info.height}.`);
  }
  const s = info && info.seconds;
  if (s != null && r.max && s > r.max) (r.hard ? block : warn).push(`${r.name} takes up to ${fmtLen(r.max)}; this reel is ${fmtLen(s)}.`);
  if (s != null && r.min && s < r.min) block.push(`${r.name} needs at least ${r.min} s; this reel is ${fmtLen(s)}.`);
  if (r.tall && info && info.width && info.height && Math.abs(info.width / info.height - 9 / 16) > 0.02) warn.push(`${r.name} wants a 9:16 video; this one is ${info.width}x${info.height}.`);
  if (r.caption && units(text) > r.caption) block.push(`The ${r.name} caption is ${units(text)} characters; the limit is ${r.caption}.`);
  if (ch.service === 'youtube') { const t = ytTitle(title, text); if (!t) block.push('YouTube needs a title.'); else if (units(t) > 100) block.push('The YouTube title is over 100 characters.'); if (/[<>]/.test(text || '')) block.push('YouTube does not allow < or > in the description.'); }
  if (ch.service === 'twitter' && r.note && s != null && s > r.max) warn.push(r.note);
  if (ch.isQueuePaused) warn.push('This channel\'s queue is paused in Buffer.');
  return { ok: !block.length, warn, block };
}
export const fmtLen = s => s < 60 ? `${Math.round(s * 10) / 10} s` : `${Math.floor(s / 60)} min${Math.round(s % 60) ? ' ' + Math.round(s % 60) + ' s' : ''}`;
const ytTitle = (title, text) => String(title || String(text || '').split(/\r?\n/).find(l => l.trim()) || '').replace(/[<>]/g, '').trim().slice(0, 100);

// ---------- Buffer ----------
const bufferBase = (env = process.env) => KEYS.baseOf(KEYS.byId('buffer'), env);
export async function gql(query, variables, { env = process.env, fetchImpl = fetch, key, tries = 3 } = {}) {
  key = key || KEYS.get('buffer', env); if (!key) throw bad('Add your Buffer API key first (Settings, API keys, Posting).', 400, { setup: 'buffer' });
  for (let i = 0; ; i++) {
    let res;
    try { res = await fetchImpl(bufferBase(env), { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000) }); }
    catch (e) { throw bad('Could not reach Buffer: ' + KEYS.scrub(e.name === 'TimeoutError' ? 'timed out' : e.message, key), 502); }
    // Buffer's rate limits: 429 with Retry-After (a 429 does not use quota); wait and try again, up to 60 s
    if (res.status === 429 && i < tries - 1) { const ra = Math.min(60, Math.max(1, +(res.headers.get('retry-after') || 0) || 2 ** i * 2)); await wait(ra * 1000); continue; }
    const text = await res.text(); let j = {}; try { j = JSON.parse(text); } catch {}
    if (res.status === 401 || res.status === 403) throw bad(`Buffer says the API key is not valid or cannot do this (${res.status}). Make a new key in Buffer, Settings, API.`, 401);
    if (res.status === 429) throw bad('Buffer says too many requests (429). Try again in a few minutes.', 429);
    if (!res.ok && !j.data) throw bad(`Buffer answered ${res.status}: ${KEYS.scrub(text, key)}`, 502);
    if (j.errors && j.errors.length && !j.data) { const m = j.errors.map(e => e.message).join('; '); throw bad(/auth|token|key|unauthor/i.test(m) ? `Buffer did not accept the key: ${KEYS.scrub(m, key)}` : `Buffer: ${KEYS.scrub(m, key)}`, /auth|unauthor/i.test(m) ? 401 : 502); }
    return j.data || {};
  }
}
const q = s => JSON.stringify(String(s)); // a GraphQL string literal
export async function channels(o = {}) {
  const d = await gql('query StudioOrgs { account { organizations { id name } } }', undefined, o);
  const orgs = (d.account && d.account.organizations) || [], out = [];
  for (const org of orgs) {
    const c = await gql(`query StudioChannels { channels(input: { organizationId: ${q(org.id)} }) { id name displayName service avatar isQueuePaused } }`, undefined, o);
    for (const ch of c.channels || []) out.push({ id: ch.id, name: ch.displayName || ch.name, handle: ch.name, service: ch.service, avatar: ch.avatar || null, isQueuePaused: !!ch.isQueuePaused, org: org.name || org.id, rules: RULES[ch.service] || null });
  }
  return { organizations: orgs.map(x => ({ id: x.id, name: x.name })), channels: out };
}
// Test key in Settings: one read (account and organizations), no posting
export async function testBuffer(key, { env, fetchImpl } = {}) {
  try { const d = await gql('query StudioKeyCheck { account { organizations { id } } }', undefined, { key, env, fetchImpl, tries: 1 }); const n = ((d.account || {}).organizations || []).length; return { ok: true, note: `Buffer accepted the key (${n} organization${n === 1 ? '' : 's'}). Posting works only if the key was made with posting allowed.` }; }
  catch (e) { return { ok: false, status: e.code, error: e.message }; }
}
const CREATE = `mutation StudioCreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id status dueAt } } ... on MutationError { message } } }`;
// the createPost input for one channel (exported for the tests)
export function postInput(ch, { url, text, mode = 'draft', dueAt, title, categoryId, shareToFeed = true, aiGenerated, firstFrameMs, placement } = {}) {
  const input = { channelId: ch.id, schedulingType: 'automatic', text: text || '', assets: [{ video: { url, ...(firstFrameMs != null && ['instagram', 'tiktok', 'pinterest'].includes(ch.service) ? { metadata: { thumbnailOffset: Math.max(0, Math.round(firstFrameMs)) } } : {}) } }], source: SOURCE };
  if (mode === 'draft') { input.mode = 'addToQueue'; input.saveToDraft = true; }
  else if (mode === 'queue') input.mode = 'addToQueue';
  else if (mode === 'schedule') { input.mode = 'customScheduled'; input.dueAt = dueAt; }
  else if (mode === 'now') input.mode = 'shareNow';
  else throw bad(`mode: ${MODES.join(', ')}`);
  const meta = {};
  if (ch.service === 'instagram') meta.instagram = placement === 'feed' ? { type: 'post', shouldShareToFeed: true, ...(aiGenerated ? { isAiGenerated: true } : {}) } : { type: 'reel', shouldShareToFeed: shareToFeed !== false, ...(aiGenerated ? { isAiGenerated: true } : {}) };
  if (ch.service === 'facebook') meta.facebook = { type: 'reel' };
  if (ch.service === 'youtube') meta.youtube = { title: ytTitle(title, text), categoryId: String(categoryId || '22'), ...(aiGenerated ? { isAiGenerated: true } : {}) };
  if (ch.service === 'tiktok' && aiGenerated) meta.tiktok = { isAiGenerated: true };
  if (ch.service === 'twitter' && aiGenerated) meta.twitter = { isAiGenerated: true };
  if (Object.keys(meta).length) input.metadata = meta;
  return input;
}

// ---------- hosts ----------
export function hostConfig(st = S.load()) { return st.post || S.POST_DEFAULTS; }
export function hostStatus(env = process.env, st = S.load()) {
  const c = hostConfig(st), r2 = c.r2 || {}, cl = c.cloudinary || {};
  const r2miss = [!r2.account && !env.STUDIO_API_BASE_R2 && 'account ID', !r2.bucket && 'bucket', !r2.publicBase && 'public bucket URL', !KEYS.isSet('r2', env) && 'access key'].filter(Boolean);
  const clmiss = [!cl.cloud && 'cloud name', !cl.preset && !KEYS.isSet('cloudinary', env) && 'upload preset or API key'].filter(Boolean);
  return {
    pick: c.host || null,
    r2: { ready: !r2miss.length, missing: r2miss, account: r2.account || null, bucket: r2.bucket || null, publicBase: r2.publicBase || null, prefix: r2.prefix || 'reels', keySet: KEYS.isSet('r2', env) },
    cloudinary: { ready: !clmiss.length, missing: clmiss, cloud: cl.cloud || null, preset: cl.preset || null, folder: cl.folder || 'reels', keySet: KEYS.isSet('cloudinary', env), signed: KEYS.isSet('cloudinary', env) && !cl.preset },
    url: { ready: true, missing: [] },
  };
}
const sha256 = b => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
// AWS Signature Version 4 for one S3 request (R2 is S3-compatible; region "auto")
export function sigv4({ method, url, headers = {}, payloadHash, accessKey, secret, region = 'auto', service = 's3', now = new Date() }) {
  const u = new URL(url), amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), day = amz.slice(0, 8);
  const h = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-date': amz, 'x-amz-content-sha256': payloadHash };
  const names = Object.keys(h).sort(), signed = names.join(';');
  const path = u.pathname.split('/').map(p => enc(decodeURIComponent(p))).join('/') || '/';
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('&');
  const creq = [method, path, query, names.map(n => `${n}:${h[n]}\n`).join(''), signed, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`, sts = ['AWS4-HMAC-SHA256', amz, scope, sha256(creq)].join('\n');
  const kS = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${createHmac('sha256', kS).update(sts).digest('hex')}` };
}
const r2Endpoint = (c, env) => (env.STUDIO_API_BASE_R2 || `https://${c.account}.r2.cloudflarestorage.com`).replace(/\/$/, '');
const pair = (id, env) => { const k = KEYS.get(id, env); if (!k) return null; const i = k.indexOf(':'); return [k.slice(0, i), k.slice(i + 1)]; };
const objectName = (file, job) => `${(job || 'reel').replace(/[^\w.-]+/g, '-')}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomBytes(4).toString('hex')}.mp4`;
async function uploadR2(file, { env, fetchImpl, job, st }) {
  const c = hostStatus(env, st).r2; if (!c.ready) throw bad(`R2 needs: ${c.missing.join(', ')} (Render, Post, Set up).`, 400, { setup: 'r2' });
  const [ak, sk] = pair('r2', env), body = readFileSync(file), key = `${c.prefix.replace(/^\/|\/$/g, '')}/${objectName(file, job)}`.replace(/^\//, '');
  const url = `${r2Endpoint(c, env)}/${enc(c.bucket)}/${key.split('/').map(enc).join('/')}`;
  const headers = sigv4({ method: 'PUT', url, headers: { 'content-type': 'video/mp4', 'cache-control': 'public, max-age=31536000' }, payloadHash: sha256(body), accessKey: ak, secret: sk });
  delete headers.host;
  let res; try { res = await fetchImpl(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(15 * 60e3) }); } catch (e) { throw bad('Could not reach R2: ' + KEYS.scrub(e.message, ak + ':' + sk), 502); }
  if (!res.ok) { const t = await res.text().catch(() => ''); const code = (t.match(/<Code>([^<]+)/) || [])[1]; throw bad(res.status === 403 ? `R2 refused the upload (403${code ? ' ' + code : ''}). Check the access key has Object Read and Write on bucket ${c.bucket}.` : res.status === 404 ? `R2 has no bucket ${c.bucket} (404). Check the account ID and bucket name.` : `R2 answered ${res.status}${code ? ' ' + code : ''}.`, 502); }
  return { url: `${c.publicBase.replace(/\/$/, '')}/${key.split('/').map(enc).join('/')}`, host: 'r2', key };
}
const cloudBase = env => (env.STUDIO_API_BASE_CLOUDINARY || 'https://api.cloudinary.com').replace(/\/$/, '');
const CHUNK = 20 * 1024 * 1024;
async function uploadCloudinary(file, { env, fetchImpl, job, st }) {
  const c = hostStatus(env, st).cloudinary; if (!c.ready) throw bad(`Cloudinary needs: ${c.missing.join(', ')} (Render, Post, Set up).`, 400, { setup: 'cloudinary' });
  const kp = c.preset ? null : pair('cloudinary', env), public_id = objectName(file, job).replace(/\.mp4$/, '');
  // unsigned: upload_preset (it must be an unsigned preset); signed: api_key, timestamp and a SHA-1 signature of the sorted params
  const params = { folder: c.folder, public_id, ...(c.preset ? { upload_preset: c.preset } : { timestamp: String(Math.floor(Date.now() / 1000)) }) };
  if (kp) params.signature = createHash('sha1').update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + kp[1]).digest('hex');
  if (kp) params.api_key = kp[0];
  const endpoint = `${cloudBase(env)}/v1_1/${encodeURIComponent(c.cloud)}/video/upload`, size = statSync(file).size, uid = randomBytes(8).toString('hex');
  const scrubKey = kp ? kp.join(':') : '';
  let last;
  // Cloudinary takes up to 100 MB in one request; bigger files go in 20 MB chunks with X-Unique-Upload-Id and Content-Range
  const fd = openSync(file, 'r');
  try {
    for (let start = 0; start < size || start === 0; start += CHUNK) {
      const end = Math.min(size, start + CHUNK) - 1, len = end - start + 1, buf = Buffer.alloc(Math.max(0, len)); if (len > 0) readSync(fd, buf, 0, len, start);
      const form = new FormData(); for (const [k, v] of Object.entries(params)) form.append(k, v);
      form.append('file', new Blob([buf], { type: 'video/mp4' }), basename(file));
      const headers = size > CHUNK ? { 'X-Unique-Upload-Id': uid, 'Content-Range': `bytes ${start}-${end}/${size}` } : {};
      let res; try { res = await fetchImpl(endpoint, { method: 'POST', body: form, headers, signal: AbortSignal.timeout(15 * 60e3) }); } catch (e) { throw bad('Could not reach Cloudinary: ' + KEYS.scrub(e.message, scrubKey), 502); }
      const t = await res.text(); let j = {}; try { j = JSON.parse(t); } catch {}
      if (!res.ok) { const m = (j.error && j.error.message) || t.slice(0, 200); throw bad(`Cloudinary answered ${res.status}: ${KEYS.scrub(m, scrubKey)}${/preset/i.test(m) ? ' (the preset must be an unsigned upload preset)' : ''}`, 502); }
      last = j; if (size <= CHUNK) break;
    }
  } finally { closeSync(fd); }
  if (!last || !last.secure_url) throw bad('Cloudinary did not return a link.', 502);
  if (last.type && last.type !== 'upload') throw bad(`Cloudinary stored it as "${last.type}", which needs a signed link that expires. Use a preset with delivery type upload (public).`, 400);
  return { url: last.secure_url, host: 'cloudinary', key: last.public_id };
}
// Check host in the Post step: R2 a signed HEAD on the bucket, Cloudinary the Admin API ping (signed) or nothing to check (unsigned)
export async function testHost(host, { env = process.env, fetchImpl = fetch, st = S.load() } = {}) {
  const hs = hostStatus(env, st);
  if (host === 'r2') {
    const c = hs.r2; if (!c.ready) return { ok: false, error: `R2 needs: ${c.missing.join(', ')}.` };
    const [ak, sk] = pair('r2', env), url = `${r2Endpoint(c, env)}/${enc(c.bucket)}`, headers = sigv4({ method: 'HEAD', url, payloadHash: sha256(''), accessKey: ak, secret: sk }); delete headers.host;
    try { const r = await fetchImpl(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(15000) }); if (r.ok) return { ok: true, note: `R2 bucket ${c.bucket} answered. Make sure public access is on (r2.dev or your own domain) so ${c.publicBase} serves the files.` };
      return { ok: false, status: r.status, error: r.status === 403 ? 'R2 refused the key (403). It needs Object Read and Write on this bucket.' : r.status === 404 ? `R2 has no bucket ${c.bucket} under that account (404).` : `R2 answered ${r.status}.` }; }
    catch (e) { return { ok: false, error: 'Could not reach R2: ' + KEYS.scrub(e.message, ak + ':' + sk) }; }
  }
  if (host === 'cloudinary') {
    const c = hs.cloudinary; if (!c.ready) return { ok: false, error: `Cloudinary needs: ${c.missing.join(', ')}.` };
    if (!c.keySet) return { ok: null, note: `Unsigned preset ${c.preset}: there is nothing to check without uploading. The first send shows any problem.` };
    const kp = pair('cloudinary', env);
    try { const r = await fetchImpl(`${cloudBase(env)}/v1_1/${encodeURIComponent(c.cloud)}/ping`, { headers: { authorization: 'Basic ' + Buffer.from(kp.join(':')).toString('base64') }, signal: AbortSignal.timeout(15000) });
      return r.ok ? { ok: true, note: `Cloudinary ${c.cloud} accepted the key.` } : { ok: false, status: r.status, error: r.status === 401 ? 'Cloudinary says the API key or secret is wrong (401).' : r.status === 404 ? `Cloudinary has no cloud named ${c.cloud}.` : `Cloudinary answered ${r.status}.` }; }
    catch (e) { return { ok: false, error: 'Could not reach Cloudinary: ' + KEYS.scrub(e.message, kp.join(':')) }; }
  }
  return { ok: null, note: 'Your own link: Studio checks it when you send.' };
}
// after an upload or for a pasted link: does the public link answer with a video? (Buffer fetches it later, the same way)
// (tests: STUDIO_API_BASE_PUBLIC sends the check to a mock instead of the link's own host; the link itself is unchanged)
export async function checkPublic(link, { fetchImpl = fetch, env = process.env } = {}) {
  const url = env.STUDIO_API_BASE_PUBLIC ? env.STUDIO_API_BASE_PUBLIC.replace(/\/$/, '') + '/' + encodeURIComponent(new URL(link).host) + new URL(link).pathname : link;
  try {
    let r = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (r.status === 405) r = await fetchImpl(url, { headers: { range: 'bytes=0-1' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { ok: false, error: `The public link answered ${r.status}. ${r.status === 401 || r.status === 403 ? 'It needs a sign-in, so Buffer cannot fetch it. Turn on public access for the bucket (r2.dev or your own domain) or use a public host.' : r.status === 404 ? 'Nothing is there yet. Check the public bucket URL in Set up.' : ''}`.trim() };
    const ct = r.headers.get('content-type') || '';
    if (ct && !/^video\/|octet-stream/.test(ct)) return { ok: false, error: `The link opens ${ct.split(';')[0]}, not a video file. Buffer needs a direct link to the file.` };
    return { ok: true, type: ct || null, bytes: +(r.headers.get('content-length') || 0) || null };
  } catch (e) { return { ok: false, error: 'Could not open the public link: ' + (e.name === 'TimeoutError' ? 'timed out' : e.message) }; }
}

// ---------- the reel list and history ----------
export function reelsOf(job) {
  if (!job) return [];
  const d = join(ROOT, 'jobs', job); if (!existsSync(d)) return [];
  let names = []; try { names = readdirSync(d); } catch {}
  return SZ.sortFiles(names.filter(SZ.isReel)).map(f => `jobs/${job}/${f}`);
}
const histPath = job => join(ROOT, 'jobs', job, 'post', 'posts.json');
export function history(job) { if (!job) return []; try { const j = JSON.parse(readFileSync(histPath(job), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function remember(job, entry) { if (!job) return; const h = history(job); h.unshift(entry); mkdirSync(dirname(histPath(job)), { recursive: true }); writeFileSync(histPath(job), JSON.stringify(h.slice(0, 50), null, 1) + '\n'); }
// the same file uploaded before (same size and time) keeps its link, so a second send does not upload again
const cachedUrl = (job, rel, host) => { try { const st = statSync(resolve(ROOT, rel)), sig = `${st.size}:${Math.round(st.mtimeMs)}`; for (const h of history(job)) { if (h.host !== host) continue; if (h.reel === rel && h.sig === sig && h.url) return { url: h.url, sig }; if (h.feed && h.feed.reel === rel && h.feed.sig === sig && h.feed.url) return { url: h.feed.url, sig }; } return { sig }; } catch { return {}; } };

// the Post step and the agent: what is set up
export function status({ job, env = process.env } = {}) {
  const st = S.load(), k = KEYS.status(env).find(x => x.id === 'buffer');
  return { buffer: { set: k.set, from: k.from, tested: k.tested }, host: hostStatus(env, st), channels: (st.post && st.post.channels) || [], youtubeCategory: (st.post && st.post.youtubeCategory) || '22', categories: YT_CATEGORIES, rules: RULES, modes: MODES,
    reels: reelsOf(job), files: Object.fromEntries(reelsOf(job).map(f => [f, { use: SZ.labelOf(f), size: (SZ.info(f) || {}).size || null, feed: (x => ({ file: x.file, missing: x.missing }))(SZ.fileFor(f, 'feed', ROOT)) }])), where: SZ.WHERE, makeFeed: SZ.MAKE_FEED,
    history: history(job).slice(0, 5), ready: !!(k.set) };
}

// one send: reel (a path under the kit or absolute) or url, channels (ids; services like "instagram" pick every channel of
// that network), caption (+ captions per channel id), mode draft|queue|schedule|now, dueAt for schedule, confirmNow
// the quick checks a send makes before any network call (the server answers 400 with them right away)
export function preflight(o, env = process.env, st = S.load()) {
  const mode = o.mode || 'draft';
  if (!MODES.includes(mode)) throw bad(`mode: ${MODES.join(', ')}`);
  if (mode === 'now' && o.confirmNow !== true) throw bad('Post now publishes right away. Pick it on purpose: send confirmNow: true, or save drafts instead.');
  let dueAt = null;
  if (mode === 'schedule') { const d = new Date(o.dueAt || ''); if (isNaN(d)) throw bad('Schedule needs a date and time.'); if (d.getTime() < Date.now() + 60e3) throw bad('Pick a time at least a minute from now.'); dueAt = d.toISOString(); }
  if (!KEYS.isSet('buffer', env)) throw bad('Add your Buffer API key first (Settings, API keys, Posting).', 400, { setup: 'buffer' });
  const want = [].concat(o.channels || []).map(String).filter(Boolean); if (!want.length) throw bad('Pick at least one channel.');
  const host = o.url ? 'url' : (o.host || hostConfig(st).host || null);
  if (!host || !HOSTS.includes(host)) throw bad('Pick where the video is hosted: R2, Cloudinary, or your own link.', 400, { setup: 'host' });
  if (host === 'url') { if (!o.url) throw bad('Paste the public link to the video.'); const u = checkUrl(o.url); if (!u.ok) throw bad(u.error); }
  return { mode, dueAt, want, host };
}
export async function send(o, { env = process.env, fetchImpl = fetch, onPhase = () => {} } = {}) {
  const st = S.load(), { mode, dueAt, want, host } = preflight(o, env, st);
  // the reel file
  let rel = null, abs = null, info = null;
  if (o.reel || host !== 'url') {
    rel = o.reel || reelsOf(o.job)[0]; if (!rel) throw bad('Render the reel first: there is nothing to post yet.');
    abs = isAbsolute(rel) ? rel : resolve(ROOT, rel);
    if (!isAbsolute(rel) && relative(ROOT, abs).startsWith('..')) throw bad('That reel is outside the kit.');
    if (!existsSync(abs) || !statSync(abs).isFile()) throw bad(`No reel at ${rel}.`, 404);
    info = probe(abs);
  }
  onPhase('channels');
  const all = (await channels({ env, fetchImpl })).channels;
  const picked = []; for (const w of want) for (const c of all) if ((c.id === w || c.service === w.toLowerCase()) && !picked.includes(c)) picked.push(c);
  const unknown = want.filter(w => !all.some(c => c.id === w || c.service === w.toLowerCase()));
  if (!picked.length) throw bad(`None of those channels are in your Buffer account${unknown.length ? ` (${unknown.join(', ')})` : ''}. Connect them in Buffer first.`, 404);
  const textOf = c => (o.captions && o.captions[c.id] != null ? o.captions[c.id] : o.caption) || '';
  // the Feed gets the 4:5 of the same version (kit/studio/sizes.mjs); with your own link, the link you paste for it
  const plOf = c => placementOf(c, o.placements);
  let feed = null;
  if (picked.some(c => plOf(c) === 'feed')) {
    const u = host === 'url' && o.feedUrl ? checkUrl(o.feedUrl) : null; if (u && !u.ok) throw bad(u.error);
    if (!rel) feed = { missing: !u, url: u ? u.url : null, info: u ? { width: 1080, height: 1350 } : null, file: null };
    else { const f = SZ.fileFor(rel, 'feed', ROOT); feed = { ...f, abs: f.file && !f.missing ? resolve(ROOT, f.file) : null, url: u ? u.url : null }; feed.info = feed.abs ? probe(feed.abs) : null;
      // your own link: the link you pasted for the Feed is what is sent, whether or not the 4:5 file is on this computer
      if (host === 'url') { feed.missing = !u; if (u && !feed.info) feed.info = { width: 1080, height: 1350 }; } }
  }
  const checks = picked.map(c => { const pl = plOf(c); return { c, pl, ...checkChannel(c, pl === 'feed' ? feed.info : info, { text: textOf(c), title: o.youtubeTitle, placement: pl, feed }) }; });
  const go = checks.filter(x => x.ok);
  const results = checks.filter(x => !x.ok).map(x => ({ channelId: x.c.id, service: x.c.service, name: x.c.name, ...(x.c.service === 'instagram' ? { placement: x.pl } : {}), ok: false, skipped: true, ...(x.pl === 'feed' && feed.missing ? { needs: 'feed45' } : {}), error: x.block.join(' '), warn: x.warn }));
  let url = o.url || null, encoded = null, uploaded = false, sig = null, feedOut = null;
  // one file to a public link: re-encode when needed, reuse the link of the same file, else upload
  const hostFile = async (fabs, frel) => {
    onPhase('encode');
    const e = await ensureH264(fabs, join(ROOT, 'jobs', o.job || '_post', 'post')), cache = cachedUrl(o.job, frel, host);
    if (cache.url && !e.encoded) return { url: cache.url, sig: cache.sig, encoded: null, uploaded: false, info: e.info };
    onPhase('upload');
    const up = host === 'r2' ? await uploadR2(e.file, { env, fetchImpl, job: o.job, st }) : await uploadCloudinary(e.file, { env, fetchImpl, job: o.job, st });
    return { url: up.url, sig: cache.sig, encoded: e.encoded ? { why: e.why, file: relative(ROOT, e.file) } : null, uploaded: true, info: e.info };
  };
  const pubOk = async link => { if (o.checkLink === false) return; onPhase('check'); const pub = await checkPublic(link, { fetchImpl, env }); if (!pub.ok) throw bad(pub.error, 400, { url: link }); };
  if (go.length) {
    const goMain = go.filter(x => x.pl !== 'feed'), goFeed = go.filter(x => x.pl === 'feed');
    if (goMain.length) {
      if (host === 'url') { const u = checkUrl(url); if (!u.ok) throw bad(u.error); url = u.url; }
      else { const h = await hostFile(abs, rel); url = h.url; sig = h.sig; encoded = h.encoded; uploaded = h.uploaded; info = h.info || info; }
      await pubOk(url);
    } else if (host !== 'url') url = null;
    if (goFeed.length) {
      if (host === 'url') feedOut = { reel: feed.file, url: feed.url, sig: null, uploaded: false };
      else { const h = await hostFile(feed.abs, feed.file); feedOut = { reel: feed.file, url: h.url, sig: h.sig, uploaded: h.uploaded, encoded: h.encoded }; }
      await pubOk(feedOut.url);
    }
    onPhase('buffer');
    for (const x of go) {
      const isFeed = x.pl === 'feed';
      const input = postInput(x.c, { url: isFeed ? feedOut.url : url, text: textOf(x.c), mode, dueAt, title: o.youtubeTitle, categoryId: o.youtubeCategory || (st.post && st.post.youtubeCategory), shareToFeed: o.shareToFeed, aiGenerated: o.aiGenerated, placement: x.pl });
      const base = { channelId: x.c.id, service: x.c.service, name: x.c.name, ...(x.c.service === 'instagram' ? { placement: x.pl } : {}), file: isFeed ? feedOut.reel : rel };
      try {
        const d = await gql(CREATE, { input }, { env, fetchImpl }), r = d.createPost || {};
        if (r.post) results.push({ ...base, ok: true, postId: r.post.id, status: r.post.status || (mode === 'draft' ? 'draft' : null), dueAt: r.post.dueAt || null, warn: x.warn });
        else results.push({ ...base, ok: false, error: r.message || 'Buffer did not create the post.', warn: x.warn });
      } catch (e) { results.push({ ...base, ok: false, error: e.message, warn: x.warn }); if (e.code === 401) break; }
    }
  }
  const out = { at: new Date().toISOString(), job: o.job || null, reel: rel, sig, host, url, uploaded: uploaded || !!(feedOut && feedOut.uploaded), encoded, ...(feedOut ? { feed: feedOut } : {}), mode, dueAt, seconds: info && info.seconds, results, unknown,
    sent: results.filter(r => r.ok).length, review: 'https://publish.buffer.com', keepLink: host !== 'url' ? 'Keep the file in your bucket until every post has gone out: Buffer fetches it when it publishes.' : 'Keep that link working until every post has gone out: Buffer fetches it when it publishes.' };
  remember(o.job, out);
  // remember the channels for next time
  try { S.update({ post: { channels: picked.map(c => c.id) } }); } catch {}
  return out;
}
