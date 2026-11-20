// Footage from a link: a public Dropbox or Google Drive share link, or a plain video URL, downloaded into the job's
// footage folder so it drafts like an upload. No account sign-in: a link that needs a login fails with LOGIN.
//   Dropbox  www.dropbox.com/s/... or /scl/fi/...?rlkey=...  -> the same link with dl=1 (Dropbox's direct download)
//   Drive    drive.google.com/file/d/<id>/view, open?id=, uc?id=  -> drive.google.com/uc?export=download&id=<id>; a file
//            too big for Drive's virus scan answers with a "can't scan" page, and we follow its confirm form (our own
//            code, no gdown)
//   direct   any http(s) link that answers with a video
import { createWriteStream, existsSync, renameSync, rmSync, statSync } from 'fs';
import { extname, join } from 'path';

export const LOGIN = 'This link needs a login. Make it public or download it and drop the file in.';
export const VIDEO = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'];
const TYPES = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'video/x-m4v': '.m4v' };
// where the real services live; tests point these at a local mock server
export const BASES = { drive: 'https://drive.google.com', dropbox: null };
const safe = n => String(n || '').replace(/[^\w.\- ]+/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 120);

export function parse(input, bases = BASES) {
  let u; try { u = new URL(String(input || '').trim()); } catch { return { ok: false, error: 'Paste a full link that starts with https://' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Only http and https links work here.' };
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  if (h === 'dropbox.com' || h === 'dl.dropboxusercontent.com' || h === 'dl.dropbox.com') {
    if (/^\/(scl\/fo|sh)\//.test(u.pathname) || /^\/home\b/.test(u.pathname)) return { ok: false, site: 'dropbox', error: 'That is a Dropbox folder. Share the video file itself, or download it and drop it in.' };
    if (!/^\/(s|scl\/fi)\//.test(u.pathname) && h === 'dropbox.com') return { ok: false, site: 'dropbox', error: 'That Dropbox link does not point to a shared file. Use Share, then Copy link, on the video.' };
    u.searchParams.delete('raw'); u.searchParams.set('dl', '1');
    if (bases.dropbox) { const b = new URL(bases.dropbox); u.protocol = b.protocol; u.host = b.host; }
    return { ok: true, site: 'dropbox', url: u.toString(), name: safe(decodeURIComponent(u.pathname.split('/').pop() || '')) || null };
  }
  if (h === 'drive.google.com' || h === 'docs.google.com' || h === 'drive.usercontent.google.com') {
    if (/\/folders\//.test(u.pathname)) return { ok: false, site: 'drive', error: 'That is a Drive folder. Share the video file itself (right click, Share, Copy link).' };
    const id = (u.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]{10,})/) || [])[1] || u.searchParams.get('id');
    if (!id || !/^[\w-]{10,}$/.test(id)) return { ok: false, site: 'drive', error: 'That Drive link has no file id. Use Share, then Copy link, on the video.' };
    return { ok: true, site: 'drive', id, url: `${bases.drive || BASES.drive}/uc?export=download&id=${id}`, name: null };
  }
  return { ok: true, site: 'direct', url: u.toString(), name: safe(decodeURIComponent(u.pathname.split('/').pop() || '')) || null };
}

// Drive's "can't scan this file for viruses" page: a form to drive.usercontent.google.com with hidden id, export,
// confirm and uuid fields (older pages: a link with confirm=<token>). Returns the URL that downloads the file, or null.
export function confirmUrl(html, base) {
  const form = html.match(/<form[^>]*id="download-form"[^>]*>([\s\S]*?)<\/form>/i) || html.match(/<form[^>]*action="[^"]*download[^"]*"[^>]*>([\s\S]*?)<\/form>/i);
  if (form) {
    const action = (form[0].match(/action="([^"]+)"/i) || [])[1]; if (!action) return null;
    const u = new URL(action.replace(/&amp;/g, '&'), base);
    for (const m of form[1].matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
      const n = (m[0].match(/name="([^"]+)"/) || [])[1], v = (m[0].match(/value="([^"]*)"/) || [])[1];
      if (n) u.searchParams.set(n, (v || '').replace(/&amp;/g, '&'));
    }
    return u.toString();
  }
  const href = html.replace(/&amp;/g, '&').match(/href="([^"]*[?&]confirm=[\w-]+[^"]*)"/i);
  return href ? new URL(href[1], base).toString() : null;
}

const fileName = (res, fallback) => {
  const cd = res.headers.get('content-disposition') || '';
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i), plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  let n = star ? decodeURIComponent(star[1].replace(/"/g, '')) : plain ? plain[1] : fallback;
  return safe(n);
};
const isHtml = res => /text\/html/i.test(res.headers.get('content-type') || '');

// download into dir; onProgress({ received, size }); returns { file, name, size, site }
export async function download(link, dir, { onProgress = () => {}, signal, maxBytes = 20e9, fetchImpl = fetch, exists = existsSync } = {}) {
  const p = typeof link === 'string' ? parse(link) : link;
  if (!p.ok) throw Object.assign(new Error(p.error), { code: 400 });
  const get = u => fetchImpl(u, { redirect: 'follow', signal, headers: { 'user-agent': 'aigent-studio' } });
  let res;
  try { res = await get(p.url); } catch (e) { if (e.name === 'AbortError') throw e; throw new Error(`Could not reach ${new URL(p.url).host}: ${e.cause && e.cause.code || e.message}`); }
  if ([401, 403, 404, 410].includes(res.status)) throw new Error(p.site === 'direct' && res.status === 404 ? 'Nothing at that link (404). Check it, or download the file and drop it in.' : LOGIN);
  if (!res.ok) throw new Error(`The link answered ${res.status}. Try again, or download the file and drop it in.`);
  if (/accounts\.google\.com|\/login\b|ServiceLogin/.test(res.url)) throw new Error(LOGIN);
  if (isHtml(res)) {
    const html = await res.text();
    const next = p.site === 'drive' ? confirmUrl(html, res.url) : null;
    if (!next) throw new Error(p.site === 'direct' ? 'That link opens a web page, not a video file. Use the link to the file itself, or download it and drop it in.' : LOGIN);
    res = await get(next);
    if ([401, 403, 404].includes(res.status) || isHtml(res) || !res.ok) throw new Error(LOGIN);
  }
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  let name = fileName(res, p.name || (p.site === 'drive' ? `drive-${p.id}` : 'video'));
  if (!VIDEO.includes(extname(name).toLowerCase())) {
    if (TYPES[type]) name += TYPES[type];
    else if (type.startsWith('video/') || type === 'application/octet-stream' || type === 'binary/octet-stream') name += '.mp4';
    else throw new Error(`That link is a ${type || 'file of unknown type'}, not a video (${VIDEO.join(', ')}).`);
  }
  const size = +res.headers.get('content-length') || null;
  if (size && size > maxBytes) throw new Error(`The file is ${(size / 1e9).toFixed(1)} GB, over the ${(maxBytes / 1e9).toFixed(0)} GB limit.`);
  let base = name.slice(0, -extname(name).length), ext = extname(name), k = 1;
  while (exists(join(dir, name))) name = `${base}-${++k}${ext}`;
  const dest = join(dir, name), part = dest + '.part';
  let received = 0, last = 0;
  const w = createWriteStream(part);
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (received > maxBytes) throw new Error(`The file is over the ${(maxBytes / 1e9).toFixed(0)} GB limit.`);
      if (!w.write(chunk)) await new Promise(r => w.once('drain', r));
      const now = Date.now(); if (now - last > 400) { last = now; onProgress({ received, size }); }
    }
    await new Promise((ok, bad) => { w.end(ok); w.on('error', bad); });
  } catch (e) { w.destroy(); rmSync(part, { force: true }); throw e; }
  if (!received) { rmSync(part, { force: true }); throw new Error('The link sent an empty file.'); }
  renameSync(part, dest); onProgress({ received, size: size || received });
  return { file: dest, name, size: statSync(dest).size, site: p.site };
}
