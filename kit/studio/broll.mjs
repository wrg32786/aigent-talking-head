// Studio b-roll: the library (a local folder you pick, reused across jobs) and stock search (Pexels, Pixabay) with
// your own key. Every clip keeps where it came from and its license, and a render writes credits.txt from them.
//
// The library is <kit>/broll-library/ by default (git ignores it; stock media is never committed), or Settings
// "B-roll library", or STUDIO_BROLL_LIBRARY. Its index is library.json in that folder, so it moves with the folder:
//   { clips: [{ id, file, name, source, license: { name, url }, author: { name, url }, sourceUrl, tags, seconds,
//     width, height, thumb, addedAt, prompt, provider, model, usedIn }] }
// Tags come from the file name, the source's own tags or title, and the frames (orientation, light, colour, motion).
import { spawnSync } from 'child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as KEYS from './keys.mjs';
import * as S from './settings.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const SOURCES = ['upload', 'library', 'pexels', 'pixabay', 'agent', 'screen', 'capture', 'generate'];
export const LICENSES = {
  pexels: { name: 'Pexels License (free to use, no attribution required; credit appreciated)', url: 'https://www.pexels.com/license/' },
  pixabay: { name: 'Pixabay Content License (free to use, no attribution required)', url: 'https://pixabay.com/service/license-summary/' },
  own: { name: 'Your own footage', url: null },
  agent: { name: 'Made in Studio from your words (yours to use)', url: null },
  capture: { name: 'Capture of a public web page: check that you may show it', url: null },
};
// what an upload is (the B-roll step's Upload asks): Suggest puts testimonials and product demos on proof spots and
// screen recordings on tips, and testimonial pieces from a raw upload can play with their own sound in the Combo
export const TYPES = ['testimonial', 'product-demo', 'screen-recording', 'lifestyle'];
export const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i, IMAGE = /\.(jpe?g|png|webp)$/i;

export function libDir(env = process.env) {
  const st = S.loadFile(), p = env.STUDIO_BROLL_LIBRARY || (st.broll && st.broll.library) || join(ROOT, 'broll-library');
  mkdirSync(p, { recursive: true }); return resolve(p);
}
const idxPath = () => join(libDir(), 'library.json');
export function load() { try { const j = JSON.parse(readFileSync(idxPath(), 'utf8')); return { clips: Array.isArray(j.clips) ? j.clips : [] }; } catch { return { clips: [] }; } }
function save(lib) { const f = idxPath(), tmp = f + '.tmp'; writeFileSync(tmp, JSON.stringify(lib, null, 1) + '\n'); renameSync(tmp, f); }
export const pathOf = c => join(libDir(), c.file);
export const get = id => load().clips.find(c => c.id === id) || null;

const has = bin => { const r = spawnSync(bin, ['-version'], { stdio: 'ignore' }); return !r.error && r.status === 0; };
let FF = null; const ffOk = () => (FF == null ? (FF = has('ffmpeg') && has('ffprobe')) : FF);
function probe(f) {
  if (!ffOk()) return {};
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type:stream_side_data=rotation', '-of', 'json', f], { encoding: 'utf8' });
  try { const j = JSON.parse(r.stdout), v = (j.streams || []).find(s => s.codec_type === 'video') || {}; let w = v.width, h = v.height;
    const rot = Math.abs(+(((v.side_data_list || [])[0] || {}).rotation || 0)); if (rot === 90 || rot === 270) [w, h] = [h, w];
    return { seconds: j.format && j.format.duration ? +(+j.format.duration).toFixed(2) : null, width: w || null, height: h || null }; } catch { return {}; }
}
const STOP = new Set('a an the and or of to in on at for with by from is are this that video clip stock free hd 4k 1080p 720p mp4 mov webm final copy new img vid pexels pixabay'.split(' '));
export const words = s => String(s || '').toLowerCase().replace(/https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
// tags a person would search for, from a few tiny frames: orientation, light, colour, still or moving, length
export function frameTags(f, meta = {}) {
  const t = [], { width: w, height: h, seconds } = meta;
  if (w && h) t.push(h > w * 1.1 ? 'portrait' : w > h * 1.1 ? 'landscape' : 'square');
  if (seconds != null) t.push(seconds < 4 ? 'short' : seconds > 15 ? 'long' : 'medium');
  if (!ffOk() || !existsSync(f)) return t;
  const step = Math.max(0.5, (seconds || 3) / 3);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', `fps=1/${step.toFixed(2)},scale=8:8`, '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  const b = r.stdout; if (!b || b.length < 192) return t;
  const frames = []; for (let i = 0; i + 192 <= b.length; i += 192) frames.push(b.subarray(i, i + 192));
  let R = 0, G = 0, B = 0, n = 0; for (const fr of frames) for (let i = 0; i < 192; i += 3) { R += fr[i]; G += fr[i + 1]; B += fr[i + 2]; n++; }
  R /= n; G /= n; B /= n; const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B, mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx ? (mx - mn) / mx : 0;
  t.push(lum < 70 ? 'dark' : lum > 175 ? 'bright' : 'mid-light');
  if (sat < 0.15) t.push('muted'); else { const hue = mx === R ? ((G - B) / (mx - mn)) * 60 : mx === G ? (2 + (B - R) / (mx - mn)) * 60 : (4 + (R - G) / (mx - mn)) * 60, hh = (hue + 360) % 360;
    t.push(hh < 45 || hh >= 330 ? 'warm' : hh < 75 ? 'yellow' : hh < 170 ? 'green' : hh < 260 ? 'blue' : 'purple'); }
  if (frames.length > 1) { let d = 0; for (let i = 0; i < 192; i++) d += Math.abs(frames[0][i] - frames[frames.length - 1][i]); t.push(d / 192 > 18 ? 'moving' : 'still'); }
  return t;
}
function thumb(f, id) {
  if (!ffOk()) return null;
  const dir = join(libDir(), '.thumbs'); mkdirSync(dir, { recursive: true }); const out = join(dir, id + '.jpg');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...(IMAGE.test(f) ? [] : ['-ss', '0.5']), '-i', f, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out], { stdio: 'ignore' });
  return r.status === 0 && existsSync(out) ? relative(libDir(), out).split('\\').join('/') : null;
}
const safe = n => basename(String(n || 'clip')).replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 80) || 'clip';
// put a file into the library (copied, or moved with move: true) with where it came from and its license
export function add(src, m = {}) {
  if (!existsSync(src)) throw Object.assign(new Error('no such file'), { code: 400 });
  const name = safe(m.name || basename(src)); if (!VIDEO.test(name) && !IMAGE.test(name)) throw Object.assign(new Error('b-roll is a video (mp4, mov, webm, m4v, mkv) or a picture (jpg, png, webp)'), { code: 400 });
  const source = SOURCES.includes(m.source) ? m.source : 'upload', id = 'br' + randomBytes(4).toString('hex');
  const dir = join(libDir(), source); mkdirSync(dir, { recursive: true });
  let file = join(dir, name); if (existsSync(file)) file = join(dir, `${basename(name, extname(name))}-${id.slice(2, 6)}${extname(name)}`);
  if (m.move) { try { renameSync(src, file); } catch { copyFileSync(src, file); rmSync(src, { force: true }); } } else copyFileSync(src, file);
  const meta = probe(file), tags = [...new Set([...(m.tags || []).map(x => String(x).toLowerCase().trim()).filter(Boolean), ...words(basename(name, extname(name))), ...words(m.title), ...frameTags(file, meta), source])].slice(0, 30);
  const c = { id, file: relative(libDir(), file).split('\\').join('/'), name: m.title ? String(m.title).slice(0, 80) : name, source, kind: IMAGE.test(name) ? 'image' : 'video',
    license: m.license || (source === 'upload' || source === 'screen' ? LICENSES.own : source === 'agent' ? LICENSES.agent : source === 'capture' ? LICENSES.capture : { name: 'unknown', url: null }),
    author: m.author || null, sourceUrl: m.sourceUrl || null, tags, ...meta, bytes: statSync(file).size, thumb: thumb(file, id), addedAt: new Date().toISOString(),
    ...(m.prompt ? { prompt: String(m.prompt).slice(0, 500) } : {}), ...(m.provider ? { provider: m.provider, model: m.model || null } : {}), ...(m.extId ? { extId: String(m.extId) } : {}), ...(m.type && TYPES.includes(m.type) ? { type: m.type } : {}), ...(m.raw ? { raw: m.raw } : {}), usedIn: [] };
  const lib = load(); lib.clips.unshift(c); save(lib); return c;
}
export function update(id, p) {
  const lib = load(), c = lib.clips.find(x => x.id === id); if (!c) throw Object.assign(new Error(`no b-roll ${id}`), { code: 404 });
  if (p.name != null) c.name = String(p.name).slice(0, 80);
  if (Array.isArray(p.tags)) c.tags = [...new Set(p.tags.map(x => String(x).toLowerCase().trim()).filter(Boolean))].slice(0, 30);
  if (p.type !== undefined) { if (p.type !== null && !TYPES.includes(p.type)) throw Object.assign(new Error(`type: ${TYPES.join(', ')} or null`), { code: 400 }); if (p.type) { c.type = p.type; c.tags = [...new Set([p.type, ...(c.tags || []).filter(t => !TYPES.includes(t))])].slice(0, 30); } else delete c.type; }
  if (p.usedIn) c.usedIn = [...new Set([...(c.usedIn || []), p.usedIn])].slice(-50);
  save(lib); return c;
}
export function remove(id) {
  const lib = load(), k = lib.clips.findIndex(x => x.id === id); if (k < 0) throw Object.assign(new Error(`no b-roll ${id}`), { code: 404 });
  const [c] = lib.clips.splice(k, 1); for (const f of [c.file, c.thumb]) if (f) rmSync(join(libDir(), f), { force: true }); save(lib); return c;
}
// search the library: every word must match the name, a tag, the source or the author
export function search(q, { source, kind, orientation } = {}) {
  const qs = words(q).concat(String(q || '').toLowerCase().split(/\s+/).filter(w => ['portrait', 'landscape', 'square', 'dark', 'bright'].includes(w)));
  return load().clips.filter(c => (!source || c.source === source) && (!kind || c.kind === kind) && (!orientation || (c.tags || []).includes(orientation))
    && qs.every(w => [c.name, c.source, c.author && c.author.name, ...(c.tags || [])].some(v => String(v || '').toLowerCase().includes(w))));
}
// credits.txt for a render: every clip used, with its source, author and license
export function credits(clips, job) {
  const L = [`B-roll in ${job}`, ''];
  for (const c of clips) {
    L.push(`${c.name} (${c.source})`);
    if (c.author && c.author.name) L.push(`  by ${c.author.name}${c.author.url ? ' ' + c.author.url : ''}`);
    if (c.sourceUrl) L.push(`  ${c.sourceUrl}`);
    L.push(`  ${c.license ? c.license.name : 'license unknown'}${c.license && c.license.url ? ' ' + c.license.url : ''}`);
    if (c.provider) L.push(`  generated with ${c.provider}${c.model ? ' (' + c.model + ')' : ''}${c.prompt ? ': "' + c.prompt + '"' : ''}`);
  }
  if (clips.some(c => c.source === 'pexels')) L.push('', 'Videos provided by Pexels: https://www.pexels.com');
  if (clips.some(c => c.source === 'pixabay')) L.push('', 'Videos from Pixabay: https://pixabay.com');
  return L.join('\n') + '\n';
}

// ---------- stock: Pexels and Pixabay with your own key ----------
const CACHE = new Map(), DAY = 24 * 3600e3; // Pixabay asks for 24 h caching; Pexels results are cached the same
export async function searchStock(provider, { query, orientation, min, max, page = 1, perPage = 24 } = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const p = KEYS.byId(provider); if (!p || p.group !== 'stock') throw Object.assign(new Error('provider: pexels or pixabay'), { code: 400 });
  const key = KEYS.get(provider, env); if (!key) throw Object.assign(new Error(`Add your ${p.name} key in Settings, API keys and providers (free at ${p.get}).`), { code: 400, needKey: provider });
  const q = String(query || '').trim().slice(0, 100); if (!q) throw Object.assign(new Error('say what to search for'), { code: 400 });
  const o = ['portrait', 'landscape', 'square'].includes(orientation) ? orientation : null;
  const ck = JSON.stringify([provider, q, o, page, perPage]); const hit = CACHE.get(ck);
  let items;
  if (hit && Date.now() - hit.at < DAY) items = hit.items;
  else {
    const base = KEYS.baseOf(p, env);
    const url = provider === 'pexels' ? `${base}/v1/videos/search?query=${encodeURIComponent(q)}&per_page=${Math.min(80, perPage)}&page=${page}${o ? '&orientation=' + o : ''}&size=medium`
      : `${base}/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=${Math.max(3, Math.min(200, perPage))}&page=${page}&safesearch=true`;
    const r = await fetchImpl(url, { headers: provider === 'pexels' ? { Authorization: key } : {} });
    if (!r.ok) throw Object.assign(new Error(r.status === 429 ? `${p.name} rate limit reached. Try again later.` : r.status === 401 || r.status === 403 ? `${p.name} did not accept the key (${r.status}). Check it in Settings.` : `${p.name} answered ${r.status}`), { code: 502 });
    const j = await r.json();
    items = provider === 'pexels' ? (j.videos || []).map(v => ({ provider, id: String(v.id), url: v.url, thumb: v.image, duration: v.duration, width: v.width, height: v.height,
      author: v.user ? { name: v.user.name, url: v.user.url } : null, title: words(v.url).filter(w => w !== 'video').join(' '),
      files: (v.video_files || []).filter(f => /mp4/.test(f.file_type || 'mp4')).map(f => ({ link: f.link, width: f.width, height: f.height, quality: f.quality })) }))
      : (j.hits || []).map(v => { const vs = v.videos || {}; const files = ['large', 'medium', 'small', 'tiny'].map(k => vs[k] && vs[k].url ? { link: vs[k].url, width: vs[k].width, height: vs[k].height, quality: k, size: vs[k].size } : null).filter(Boolean);
        const f0 = files[0] || {}; return { provider, id: String(v.id), url: v.pageURL, thumb: (vs.tiny && vs.tiny.thumbnail) || (vs.small && vs.small.thumbnail) || null, duration: v.duration, width: f0.width, height: f0.height,
          author: v.user ? { name: v.user, url: v.user_id ? `https://pixabay.com/users/${encodeURIComponent(v.user)}-${v.user_id}/` : null } : null, title: String(v.tags || ''), tags: String(v.tags || '').split(',').map(x => x.trim()).filter(Boolean), files }; });
    CACHE.set(ck, { at: Date.now(), items });
  }
  // orientation for Pixabay and the duration range for both are filtered here (neither API filters by length)
  const ori = x => (x.width && x.height ? (x.height > x.width * 1.1 ? 'portrait' : x.width > x.height * 1.1 ? 'landscape' : 'square') : null);
  return items.filter(x => (!o || ori(x) === o) && (min == null || x.duration >= +min) && (max == null || x.duration <= +max))
    .map(x => ({ ...x, preview: pickFile(x.files, 640) && pickFile(x.files, 640).link, inLibrary: !!load().clips.find(c => c.source === provider && c.extId === x.id) }));
}
// the file closest to 1080 on its short side, never a 4K one when a smaller exists
export function pickFile(files, target = 1080) {
  const fs = (files || []).filter(f => f.link); if (!fs.length) return null;
  const short = f => Math.min(f.width || 0, f.height || 0) || 0;
  return fs.slice().sort((a, b) => Math.abs(short(a) - target) - Math.abs(short(b) - target) || short(a) - short(b))[0];
}
// download one result into the library with its license; refuses links that are not the provider's
export async function downloadStock(provider, item, { env = process.env, fetchImpl = fetch } = {}) {
  const p = KEYS.byId(provider); if (!p || p.group !== 'stock') throw Object.assign(new Error('provider: pexels or pixabay'), { code: 400 });
  if (!item || !item.id) throw Object.assign(new Error('pick a result first'), { code: 400 });
  const have = load().clips.find(c => c.source === provider && c.extId === String(item.id)); if (have) return have;
  const f = pickFile(item.files); if (!f) throw Object.assign(new Error('no video file in that result'), { code: 400 });
  const host = new URL(f.link).hostname, ok = env['STUDIO_API_BASE_' + provider.toUpperCase()] ? true : provider === 'pexels' ? /(^|\.)pexels\.com$/.test(host) : /(^|\.)pixabay\.com$/.test(host);
  if (!ok) throw Object.assign(new Error(`that file is not on ${p.name}`), { code: 400 });
  const r = await fetchImpl(f.link); if (!r.ok || !r.body) throw Object.assign(new Error(`${p.name} download failed (${r.status})`), { code: 502 });
  const tmp = join(libDir(), `.dl-${randomBytes(4).toString('hex')}.mp4`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
  return add(tmp, { move: true, name: `${provider}-${item.id}.mp4`, title: item.title ? item.title.slice(0, 60) : `${p.name} ${item.id}`, source: provider, license: LICENSES[provider], author: item.author, sourceUrl: item.url, tags: item.tags || words(item.title), extId: item.id });
}
