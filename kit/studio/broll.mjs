// Studio b-roll: the clips a reel can use and stock search (Pexels, Pixabay) with your own key. Every clip keeps where
// it came from and its license, and a render writes credits.txt from them.
//
// Since 1.29.0 the library is the Asset Vault (kit/studio/vault.mjs: <kit>/vault/, or Settings "Vault folder", or
// STUDIO_VAULT / STUDIO_BROLL_LIBRARY). This file is the reel's view of it: a clip here is a Vault item that may be
// placed (never a reference only item, never a link with no picture yet), with the same fields as before:
//   { id, file, name, source, license: { name, url }, author: { name, url }, sourceUrl, tags, seconds, width, height,
//     thumb, addedAt, prompt, provider, model, usedIn, rights }
// Tags come from the file name, the source's own tags or title, and the frames (orientation, light, colour, motion).
import { createWriteStream } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as KEYS from './keys.mjs';
import * as V from './vault.mjs';

export const { SOURCES, LICENSES, TYPES, VIDEO, IMAGE, words, frameTags, pathOf, add, update, remove } = V;
export const libDir = V.dir;
export const load = () => ({ clips: V.load().items.filter(V.placeable) });
export const get = id => { const c = V.get(id); return V.placeable(c) ? c : null; };
// search the library: every word must match the name, a tag, the source or the author
export function search(q, { source, kind, orientation } = {}) {
  const qs = words(q).concat(String(q || '').toLowerCase().split(/\s+/).filter(w => ['portrait', 'landscape', 'square', 'dark', 'bright'].includes(w)));
  return load().clips.filter(c => (!source || c.source === source) && (!kind || c.kind === kind) && (!orientation || (c.tags || []).includes(orientation))
    && qs.every(w => [c.name, c.source, c.author && c.author.name, ...(c.tags || [])].some(v => String(v || '').toLowerCase().includes(w))));
}
// the best library clips for some words, most matches first: a word matches a name or tag that holds it, or its stem
// (clips, clip; editing, edit), so "phone setups" finds a clip tagged "phone" or "setup". At least one word must match;
// a clip matching every word ranks above one that matches some.
const stem = V.stem;
export function rank(q, { exclude = new Set() } = {}) {
  const qs = [...new Set(words(q))]; if (!qs.length) return [];
  const out = [];
  for (const c of load().clips) {
    if (exclude.has(c.id)) continue;
    const hay = [c.name, c.title, ...(c.tags || [])].map(v => String(v || '').toLowerCase()).join(' '), toks = new Set(words(hay).map(stem));
    const n = qs.filter(w => hay.includes(w) || toks.has(stem(w))).length;
    if (n) out.push({ c, n });
  }
  return out.sort((a, b) => b.n - a.n).map(x => ({ ...x.c, matched: x.n, of: qs.length }));
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
