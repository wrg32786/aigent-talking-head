// Repo or tool feature mode (docs/specs/studio-builder.md section 9): b-roll from a public GitHub repo's README.
//   node kit/repo-broll.mjs fetch <https://github.com/owner/repo> [...] [--json]   download the README's pictures
//   node kit/repo-broll.mjs apply --name <job> --plan <video-plan.json> [--jobs <dir>]  put them into the job's cut.json
//
// fetch: the README (GitHub's public API, default branch) and its pictures and videos in the order they appear, with
// the heading each sits under and its alt text. Badges, tiny logos, SVGs and anything that is not a picture or a video
// are left out; a GIF becomes a looping MP4 and an animated WebP is skipped. They land in assets/web/<owner>--<repo>/
// (gitignored) with meta.json. A failed fetch is not cached. The repo's name, stars and description are kept in
// meta.header. No capture of the page and no text card: README text is never a shot (the repo rule, below).
//
// Network rules for the fetches made here (spec 14.10): http(s) only, no logins in links; every URL and every redirect
// hop is checked (an IP address in the link, IPv6 included, or each DNS answer: only public addresses, no .local or
// localhost name) and the connection uses the address that was checked; no cookies are sent; at most 25 MB per file,
// 30 tries per repo and 60 s per file; pictures and videos only (and the README and repo facts as text).
//
// apply: the plan's layout for each line of what you say. The repo in its card on the body: Split (repo on top, you
// below, kit/split.cjs "top"), or the framed cards "frame" when Frame breakout is picked. Never the repo full screen.
// Takeovers auto: you full screen on the hook, the punch lines and the CTA; off: the repo card on every body line.
// Short gaps are held over so you don't flash back. Captions follow split.cjs's own placement.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { lookup as dnsLookup } from 'dns';
import { isIP } from 'net';
import http from 'http';
import https from 'https';
import { join, dirname, relative, sep, isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MAX_BYTES = 25 * 1024 * 1024;
const RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
export const parseRepo = u => { const m = String(u || '').trim().match(RE); return m && !['.', '..'].includes(m[1]) && !['.', '..'].includes(m[2]) ? { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` } : null; };
export const assetsRoot = () => process.env.ATH_ASSETS || join(ROOT, 'assets', 'web');
// owner--repo (GitHub names never hold two hyphens in a row at the owner's end, and meta.json is checked too)
export const dirFor = r => join(assetsRoot(), `${r.owner}--${r.repo}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-'));

// ---------- the network ----------
// private, loopback, link-local, carrier-grade NAT, multicast and other non-public addresses (as capture.mjs)
export function privateIp(ip) {
  if (isIP(ip) === 4) { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; }
  // IPv6: only global unicast (2000::/3), less 6to4 (2002::/16), Teredo (2001::/32) and documentation (2001:db8::/32);
  // an IPv4-mapped address is judged as IPv4. NAT64, site-local, unique-local and the rest count as private.
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase().replace(/^\[|\]$/g, ''), m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return privateIp(m[1]);
    const mh = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); if (mh) { const [p, q] = [parseInt(mh[1], 16), parseInt(mh[2], 16)]; return privateIp(`${p >> 8}.${p & 255}.${q >> 8}.${q & 255}`); }
    const h = x.split(':'), first = parseInt(h[0] || '0', 16), second = parseInt(h[1] || '0', 16);
    if (first < 0x2000 || first > 0x3fff) return true;
    return first === 0x2002 || (first === 0x2001 && (second === 0 || second === 0xdb8));
  }
  return true;
}
const bare = h => String(h || '').replace(/^\[|\]$/g, ''); // URL.hostname keeps an IPv6 address in brackets
const badName = h0 => { const h = bare(h0); return !h || /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(h) || (isIP(h) ? privateIp(h) : /^[\d.]+$/.test(h)); };
// a DNS lookup that refuses a private answer; handed to the request as its lookup, so the socket connects to exactly
// the address that was checked (no second lookup in between)
export function safeLookup(resolver = dnsLookup) {
  return (host, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (badName(host)) return cb(Object.assign(new Error(`${host} is not a public host`), { code: 'EPRIVATE' }));
    resolver(host, { all: true }, (err, as) => {
      if (err) return cb(err);
      const list = (as || []).map(a => (typeof a === 'string' ? { address: a, family: isIP(a) } : a));
      if (!list.length || list.some(a => privateIp(a.address))) return cb(Object.assign(new Error(`${host} resolves to a private address`), { code: 'EPRIVATE' }));
      if (opts && opts.all) return cb(null, list.slice(0, 1));
      cb(null, list[0].address, list[0].family);
    });
  };
}
const TEXT = /^(text\/|application\/(json|vnd\.github))/i, MEDIA = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime))/i;
// GET one public URL, every redirect hop checked the same way. kind: text (the README, the repo facts) or media.
// o.request (tests) replaces the network: (url, { lookup }) => Promise<{ status, headers, body: Buffer | AsyncIterable }>
export async function safeGet(url, { kind = 'media', max = MAX_BYTES, hops = 5, headers = {}, request = null, resolver, deadline = 60000 } = {}) {
  let u = String(url); const t0 = Date.now(); // the deadline covers the whole file, redirects included
  for (let hop = 0; hop <= hops; hop++) {
    const left = deadline - (Date.now() - t0); if (left <= 0) throw new Error(`took too long: ${url}`);
    let p; try { p = new URL(u); } catch { throw new Error(`not a link: ${u}`); }
    if (!/^https?:$/.test(p.protocol)) throw new Error(`only http and https: ${u}`);
    if (p.username || p.password) throw new Error(`no logins in links: ${p.host}`);
    if (badName(p.hostname)) throw new Error(`${bare(p.hostname)} is not a public host`);
    const lookup = safeLookup(resolver);
    const r = await (request ? request(u, { lookup }) : nodeGet(p, lookup, { 'user-agent': 'aigent-talking-head repo-broll', accept: kind === 'text' ? 'application/vnd.github.raw, text/plain, application/json' : 'image/*, video/*', ...headers }, left));
    try { return await readOne(r, u, kind, max); } catch (e) { if (r.abort) r.abort(); if (e.redirect) { u = new URL(e.redirect, u).href; continue; } throw e; }
  }
  throw new Error(`too many redirects: ${url}`);
}
// one answer: a redirect (thrown with where it goes), an error, or the body, read only while it stays under the cap
async function readOne(r, u, kind, max) {
  {
    if ([301, 302, 303, 307, 308].includes(r.status)) { const to = r.headers.location; if (!to) throw new Error(`a redirect with nowhere to go: ${u}`); throw Object.assign(new Error('redirect'), { redirect: to }); }
    if (r.status !== 200) throw new Error(`${r.status} for ${u}`);
    const type = String(r.headers['content-type'] || '').split(';')[0].trim();
    if (!(kind === 'text' ? TEXT : MEDIA).test(type)) throw new Error(`not ${kind === 'text' ? 'text' : 'a picture or a video'} (${type || 'no type'}): ${u}`);
    const len = +r.headers['content-length'] || 0; if (len > max) throw new Error(`over ${Math.round(max / 1048576)} MB: ${u}`);
    const chunks = []; let n = 0;
    for await (const c of (Buffer.isBuffer(r.body) ? [r.body] : r.body)) { n += c.length; if (n > max) { if (r.abort) r.abort(); throw new Error(`over ${Math.round(max / 1048576)} MB: ${u}`); } chunks.push(c); }
    if (r.abort) r.abort();
    return { url: u, type, body: Buffer.concat(chunks) };
  }
}
// the real request: our checked lookup on the socket, a fresh agent (no keep-alive, nothing shared), no cookies sent,
// 20 s with nothing arriving or the whole deadline (60 s) and the connection is closed
export function nodeGet(p, lookup, headers, deadline = 60000) {
  return new Promise((ok, bad) => {
    const req = (p.protocol === 'https:' ? https : http).get(p, { lookup, headers, agent: false, timeout: 20000 }, res => { ok({ status: res.statusCode, headers: res.headers, body: res, abort: () => { clearTimeout(all); req.destroy(); } }); });
    const all = setTimeout(() => req.destroy(new Error(`took too long: ${p.href}`)), deadline); all.unref && all.unref();
    req.on('timeout', () => req.destroy(new Error(`timed out: ${p.href}`))); req.on('error', e => { clearTimeout(all); bad(e); }); req.on('close', () => clearTimeout(all));
  });
}

// ---------- the README ----------
// pictures and videos in the order they appear: markdown images, <img>/<video>/<source> tags, linked .mp4/.webm and
// GitHub's uploaded attachments on their own line; each with its alt text and the heading above it
export function readmeAssets(md, base) {
  const out = [], seen = new Set(); let heading = '';
  const abs = s => { try { return new URL(String(s).trim().replace(/^<|>$/g, ''), base).href; } catch { return null; } };
  const num = v => (v == null ? null : parseInt(String(v), 10) || null);
  const push = (src, alt, kind, w = null, h = null) => { const url = abs(src); if (!url || seen.has(url)) return; seen.add(url); out.push({ url, alt: String(alt || '').trim(), heading, kind, width: w, height: h, order: out.length }); };
  let fence = false;
  for (const line of String(md || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const hm = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/) || line.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i); if (hm) heading = hm[1].replace(/<[^>]+>|[*_`]/g, '').trim();
    const items = [];
    for (const m of line.matchAll(/!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) items.push([m.index, () => push(m[2], m[1], /\.(mp4|webm|mov)(\?|$)/i.test(m[2]) ? 'video' : 'image')]);
    for (const m of line.matchAll(/<img\b([^>]*)>/gi)) { const a = m[1], g = k => (a.match(new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1]; if (g('src')) items.push([m.index, () => push(g('src'), g('alt'), 'image', num(g('width')), num(g('height')))]); }
    for (const m of line.matchAll(/<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) items.push([m.index, () => push(m[1], '', 'video')]);
    for (const m of line.matchAll(/(?<!!)\[([^\]]*)\]\(\s*([^)\s]+\.(?:mp4|webm|mov)(?:\?[^)\s]*)?)\s*\)/gi)) items.push([m.index, () => push(m[2], m[1], 'video')]);
    const att = line.trim().match(/^(https:\/\/github\.com\/user-attachments\/assets\/[\w-]+)$/); if (att) items.push([0, () => push(att[1], '', 'video')]);
    items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
  }
  return out;
}
// badges, build and coverage shields, tiny logos, SVGs and data URLs never become b-roll
const BADGE_HOST = /(^|\.)(shields\.io|badgen\.net|badge\.fury\.io|codecov\.io|coveralls\.io|travis-ci\.(org|com)|circleci\.com|app\.netlify\.com|deepwiki\.com|forthebadge\.com|img\.badgesize\.io|starchart\.cc|star-history\.com|api\.star-history\.com)$/i;
export function usable(a) {
  let u; try { u = new URL(a.url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (BADGE_HOST.test(u.hostname) || /badge|shield|\/workflows\/[^/]+\/badge/i.test(u.pathname) || /\bbadge\b/i.test(a.alt)) return false;
  if (/\.svg(\?|$)/i.test(u.pathname)) return false;
  if (a.height != null && a.height < 40) return false;
  const small = (a.width != null && a.width < 200) || (a.height != null && a.height < 200);
  if (small && /logo|icon|avatar/i.test(a.alt + ' ' + u.pathname)) return false;
  return true;
}
// a picture's size from its first bytes (png, gif, jpeg, webp), so a tiny logo with no width in the README still goes
export function sizeOf(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.slice(0, 3).toString() === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') { const f = buf.slice(12, 16).toString(); if (f === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }; if (f === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }; if (f === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; } }
    if (buf[0] === 0xff && buf[1] === 0xd8) { let i = 2; while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1], L = buf.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }; i += 2 + L; } }
  } catch {}
  return null;
}
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

// fetch one repo: { owner, repo, url, dir, header, assets: [{ file, kind, alt, heading, source, w, h }], skipped }
// what the file really is from its first bytes (never the server's label alone): a playlist or anything else FFmpeg
// could follow never reaches it
export function magicOk(type, b) {
  const at = (o, str) => b.length >= o + str.length && b.toString('latin1', o, o + str.length) === str;
  if (type === 'image/png') return b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
  if (type === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
  if (type === 'image/gif') return at(0, 'GIF87a') || at(0, 'GIF89a');
  if (type === 'image/webp') return at(0, 'RIFF') && at(8, 'WEBP');
  if (type === 'video/webm') return b.length > 4 && b.readUInt32BE(0) === 0x1a45dfa3;
  if (type === 'video/mp4' || type === 'video/quicktime') return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].some(x => at(4, x));
  return false;
}
// an animated WebP (VP8X with the animation bit): FFmpeg reads only stills, so it is left out
export const animatedWebp = b => b.length > 21 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 12, 16) === 'VP8X' && !!(b[20] & 2);
// a GIF becomes a looping 12 second MP4 (the render trims video, it never loops a GIF); a video's length is read so no
// insert runs past its end. Both use FFmpeg and can be swapped in tests.
export function gifToMp4(src, out) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-f', 'gif', '-stream_loop', '-1', '-i', src, '-t', '12', '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'ignore', timeout: 120000 });
}
export function videoSeconds(file) {
  const v = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', timeout: 30000 }));
  return Number.isFinite(v) && v > 0 ? v : null;
}

// fetch one repo's pictures into assets/web/<owner>--<repo>/ (01.png, 02.mp4 ... and meta.json). A good fetch is cached;
// a failed one (no README read, nothing usable) is never cached, so trying again online works, and an older good
// folder stays in place until a new one is complete.
export async function fetchRepo(link, { request = null, resolver, max = 12, tries = 30, force = false, log = () => {}, convert = gifToMp4, seconds = videoSeconds } = {}) {
  const r = parseRepo(link); if (!r) throw new Error(`not a GitHub repo link: ${link}`);
  const dir = dirFor(r), mf = join(dir, 'meta.json');
  if (!force && existsSync(mf)) {
    try {
      const m = JSON.parse(readFileSync(mf, 'utf8'));
      if (String(m.owner).toLowerCase() === r.owner.toLowerCase() && String(m.repo).toLowerCase() === r.repo.toLowerCase() && m.assets && m.assets.length && m.assets.every(a => existsSync(join(dir, a.file)))) return { ...m, dir, cached: true };
    } catch {}
  }
  const get = (u, kind) => safeGet(u, { kind, request, resolver });
  const api = `https://api.github.com/repos/${r.owner}/${r.repo}`;
  let facts = {}; try { facts = JSON.parse((await get(api, 'text')).body.toString('utf8')); } catch (e) { log(`repo facts: ${e.message}`); }
  const branch = facts.default_branch || 'HEAD';
  const header = { name: facts.full_name || `${r.owner}/${r.repo}`, stars: Number.isFinite(+facts.stargazers_count) ? +facts.stargazers_count : null, description: facts.description || '', url: r.url };
  let md = '', readOk = false; try { md = (await get(api + '/readme', 'text')).body.toString('utf8'); readOk = true; } catch (e) { log(`README: ${e.message}`); }
  const found = readmeAssets(md, `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${branch}/`);
  // only the README's own pictures and videos: no text card of the repo and no capture of the page (the repo rule)
  const cands = found;
  const tmp = `${dir}.part-${process.pid}`; rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const assets = [], skipped = []; let tried = 0;
  for (const a of cands) {
    if (assets.length >= max) break;
    if (!usable(a)) { skipped.push({ url: a.url, why: 'badge, logo or not a picture' }); continue; }
    if (++tried > tries) { skipped.push({ url: a.url, why: `stopped after ${tries} tries` }); continue; }
    try {
      const g = await get(a.url, 'media'); let kind = g.type.startsWith('video/') ? 'video' : 'image';
      const sz = kind === 'image' ? sizeOf(g.body) : null;
      if (sz && (sz.w < 200 || sz.h < 200)) { skipped.push({ url: a.url, why: `too small (${sz.w}x${sz.h})` }); continue; }
      if (!magicOk(g.type, g.body)) { skipped.push({ url: a.url, why: `not really ${g.type}` }); continue; }
      if (g.type === 'image/webp' && animatedWebp(g.body)) { skipped.push({ url: a.url, why: 'an animated WebP' }); continue; }
      const n = String(assets.length + 1).padStart(2, '0'); let file = `${n}.${EXT[g.type] || 'bin'}`;
      writeFileSync(join(tmp, file), g.body);
      if (g.type === 'image/gif') { const mp4 = `${n}.mp4`; convert(join(tmp, file), join(tmp, mp4)); rmSync(join(tmp, file), { force: true }); file = mp4; kind = 'video'; }
      const secs = kind === 'video' ? seconds(join(tmp, file)) : null;
      if (kind === 'video' && !secs) throw new Error('a video with no length');
      assets.push({ file, kind, alt: a.alt, heading: a.heading, source: g.url, ...(sz ? { w: sz.w, h: sz.h } : {}), ...(secs ? { seconds: +secs.toFixed(2) } : {}) });
    } catch (e) { rmSync(join(tmp, `${String(assets.length + 1).padStart(2, '0')}.gif`), { force: true }); skipped.push({ url: a.url, why: e.message }); }
  }
  const meta = { owner: r.owner, repo: r.repo, url: r.url, header, assets, skipped, fetchedAt: new Date().toISOString() };
  // a partial fetch (some files timed out or were refused for now) never replaces a fuller folder we already have
  let older = null; if (existsSync(mf)) { try { older = JSON.parse(readFileSync(mf, 'utf8')); } catch {} }
  const temporary = skipped.some(x => /timed out|took too long|^(429|5\d\d) |ECONN|ENOTFOUND|EAI_AGAIN/.test(x.why));
  const good = readOk && assets.length && !(older && temporary && (older.assets || []).length > assets.length);
  if (!good) {
    // not cached: an older good folder (which a cut may point at) stays as it is
    rmSync(tmp, { recursive: true, force: true });
    if (older) return { ...older, dir, cached: true, stale: true };
    return { ...meta, assets: [], dir, failed: true };
  }
  writeFileSync(join(tmp, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
  const old = `${dir}.old-${process.pid}`;
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(tmp, dir); rmSync(old, { recursive: true, force: true });
  return { ...meta, dir };
}

// ---------- the plan ----------
const toks = s => String(s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'your', 'this', 'that', 'how', 'what', 'are', 'from', 'into', 'about', 'use', 'using', 'can', 'all', 'our', 'get', 'out', 'now', 'just']);
// how well a line names an asset's heading or alt text (0 none, 1 or more: words in common)
export function score(line, a) { const lw = new Set(toks(line).filter(w => !STOP.has(w))); return [...new Set(toks(a.heading + ' ' + a.alt).filter(w => !STOP.has(w)))].filter(w => lw.has(w) || lw.has(w.replace(/s$/, ''))).length; }
// repo-mode layout and timing (plan.content, or these defaults). Template-able: a starter or a saved plan can set bands
// and swapSec. About 45/10/45, a new visual every 2-4 s. (plan.content.takeoverSec is still read by old templates;
// the repo is never full screen now, so it changes nothing.)
export const REPO_STYLE = { bands: { repo: 0.45, captions: 0.10, you: 0.45 }, swapSec: [2, 4], frameBg: ['#e8eaed', '#dfe3e8'] };
// Will, 2026-11-27: in repo mode the b-roll never cuts to full screen, plain text or README text. The repo stays in its
// card (Split or Frame breakout) with you on screen; a capture of the README page or GitHub's text card is never shown.
// What breaks that rule, per repo insert (empty when it holds). planRepo never makes one; apply and plan-check check.
export const onCard = a => !!a && !a.header && !a.capture;
export function repoRuleBreaks(inserts) {
  const out = [];
  for (const x of (inserts || []).filter(i => i && i.repo)) {
    if (!SPLIT_PLACES.includes(x.place)) out.push({ at: x.at, why: `the repo ${x.place === 'full' ? 'full screen' : 'as ' + x.place}` });
    if (x.text || x.page) out.push({ at: x.at, why: 'README or page text as a shot' });
  }
  return out;
}
const SPLIT_PLACES = ['top', 'frame'];
const pair = (v, fb) => (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && n > 0) && v[0] <= v[1] ? v : fb);
const chunks = (start, end, [lo, hi]) => {
  const dur = end - start; if (dur <= hi + 0.05) return [[start, end]];
  const n = Math.max(2, Math.ceil(dur / hi)), step = dur / n, out = [];
  if (step + 0.01 < lo) {
    // keep pieces at the long end; a short leftover stays on the last piece if it is under a second
    let a = start;
    while (end - a > hi + 0.05) { const b = +(a + hi).toFixed(2); out.push([a, b]); a = b; }
    if (out.length && end - a < 1) out[out.length - 1][1] = end; else out.push([a, end]);
    return out;
  }
  for (let i = 0; i < n; i++) out.push([+(start + i * step).toFixed(2), +(i === n - 1 ? end : start + (i + 1) * step).toFixed(2)]);
  return out;
};
// lines: [{ start, end, text, section: hook | body | cta }] on the reel timeline; assets with { path, kind, heading, alt }
// -> { inserts: [{ file, at, dur, place: top | frame, image, repo: true, line }], takeovers: [{ at, dur, who: you }] }
// takeovers auto: you full screen on the hook, the punch lines and the CTA (noted in takeovers); off: the repo card on
// every body line. There is never a repo shot on the hook or the CTA, and the repo is never full screen.
export function planRepo(lines, assets0, { takeovers = 'auto', breakout = false, minDur = 1.2, bands = null, swapSec = null, frameBg = null } = {}) {
  const inserts = [], who = [], assets = (assets0 || []).filter(onCard); if (!assets.length) return { inserts, takeovers: who };
  const split = breakout ? 'frame' : 'top', used = new Map(); let next = 0;
  const style = { bands: bands || (breakout ? REPO_STYLE.bands : null), swapSec: pair(swapSec, REPO_STYLE.swapSec), frameBg: Array.isArray(frameBg) ? frameBg : (breakout ? REPO_STYLE.frameBg : null) };
  const pick = (text, avoid = null) => {
    let best = null, bs = 0;
    for (const a of assets) {
      if (avoid && a.path === avoid) continue;
      const s = score(text, a) - (used.get(a.path) || 0) * 0.5; if (s > bs && score(text, a) >= 1) { best = a; bs = s; }
    }
    if (!best) { const pool = avoid && assets.length > 1 ? assets.filter(x => x.path !== avoid) : assets; best = pool[next % pool.length]; next++; }
    used.set(best.path, (used.get(best.path) || 0) + 1); return best;
  };
  for (const l of lines) {
    const dur = +(l.end - l.start).toFixed(2); if (dur < minDur) continue;
    const punch = l.section === 'body' && (/!\s*$/.test(l.text) || toks(l.text).length <= 4);
    if (l.section !== 'body' || (punch && takeovers === 'auto')) { if (takeovers === 'auto') who.push({ at: l.start, dur, who: 'you', why: l.section === 'body' ? 'punch line' : l.section }); continue; }
    // one still does not swap against itself; a second picture is needed to change the visual
    const parts = assets.length > 1 ? chunks(l.start, l.end, style.swapSec) : [[l.start, l.end]];
    for (const [at, end] of parts) {
      const a = pick(l.text, inserts.length ? inserts[inserts.length - 1].file : null);
      let d = +(end - at).toFixed(2); if (a.kind === 'video' && a.seconds) d = +Math.min(d, a.seconds).toFixed(2);
      const row = { file: a.path, at: +at.toFixed(2), dur: d, in: 0, place: split, image: a.kind === 'image', repo: true, line: l.text.slice(0, 80), fit: 'whole', ...(a.seconds ? { seconds: a.seconds } : {}) };
      if (split === 'frame') { if (style.bands) row.bands = style.bands; if (style.frameBg) row.frameBg = style.frameBg; }
      inserts.push(row);
    }
  }
  // no flashes back to you: a short gap (a pause, a short line) between two inserts is closed by holding the first one
  // longer, as far as a video's own length allows (never over a moment that is yours: a punch line, the hook or the CTA)
  for (let i = 0; i + 1 < inserts.length; i++) {
    const p = inserts[i], q = inserts[i + 1], gap = q.at - (p.at + p.dur), end = p.at + p.dur;
    const yours = who.some(w => w.at < q.at && w.at + w.dur > end);
    const d = +(q.at - p.at).toFixed(2);
    if (gap > 0 && gap < 1.5 && !yours && !(p.seconds && d > p.seconds) && d > p.dur) { p.own = p.own || p.dur; p.dur = d; }
  }
  inserts.forEach(x => delete x.seconds);
  return { inserts, takeovers: who };
}
// the reel's lines with their section, from a drafted job's cut.json and its words (kit/sections.cjs)
export function linesOf(cut, build) {
  const SEC = require('./sections.cjs'), SP = require('./spoken.cjs');
  const words = SP.timeline(cut.segs, build), tt = SEC.times(cut.segs), len = tt.length ? tt[tt.length - 1].end : 0, b = SEC.bounds(words, len);
  return SEC.sentences(words).map(s => ({ start: s.start, end: s.end, text: s.words.map(w => w.word).join(' ').replace(/\s+([,.!?])/g, '$1'),
    section: s.start < b.hookEnd - 0.05 ? 'hook' : b.ctaStart != null && s.start >= b.ctaStart - 0.05 ? 'cta' : 'body' }));
}

// ---------- the command ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
  const run = async () => {
    if (a[0] === 'fetch') {
      const out = []; for (const u of a.slice(1).filter(x => !x.startsWith('--'))) { const m = await fetchRepo(u, { force: a.includes('--force'), log: x => console.error(x) }); out.push({ repo: m.url, dir: relative(ROOT, m.dir), assets: m.assets.length, skipped: m.skipped.length }); }
      console.log(a.includes('--json') ? JSON.stringify(out) : out.map(x => `${x.repo}: ${x.assets} pictures and videos in ${x.dir}`).join('\n')); return;
    }
    if (a[0] !== 'apply' || !opt('name')) { console.error('usage: repo-broll.mjs fetch <repo url> [...] | apply --name <job> [--plan <video-plan.json>]'); process.exit(2); }
    const build = join(opt('jobs') ? resolve(opt('jobs')) : join(ROOT, 'jobs'), opt('name'), 'build'), cutF = join(build, 'cut.json');
    if (!existsSync(cutF)) { console.error('make a draft first: no build/cut.json'); process.exit(1); }
    // no plan file (the plan was cleared) counts as repo mode off: our own inserts are taken out again
    const planF = opt('plan') ? (isAbsolute(opt('plan')) ? opt('plan') : resolve(ROOT, opt('plan'))) : null;
    const plan = planF && existsSync(planF) ? JSON.parse(readFileSync(planF, 'utf8')) : {}, c = (plan && plan.content) || {}, cut = JSON.parse(readFileSync(cutF, 'utf8'));
    const others = (cut.inserts || []).filter(x => !x.repo);
    const clear = () => { cut.inserts = others; if (!others.length) delete cut.inserts; delete cut.repoTakeovers; writeFileSync(cutF, JSON.stringify(cut, null, 1)); };
    if (!c.repoFeature || !(c.repos || []).length) { if ((cut.inserts || []).some(x => x.repo) || cut.repoTakeovers) clear(); console.log(JSON.stringify({ ok: true, repo: false })); return; }
    const assets = [];
    for (const u of c.repos) { try { const m = await fetchRepo(u, { log: x => console.log(`repo: ${x}`) }); for (const x of m.assets.filter(onCard)) assets.push({ ...x, path: join(m.dir, x.file) }); } catch (e) { console.log(`repo: ${u}: ${e.message}`); } }
    if (!assets.length) { console.log('repo: we could not get any pictures from the repo, so you stay on screen (check the link, or try again online)'); clear(); console.log(JSON.stringify({ ok: true, repo: true, inserts: 0 })); return; }
    const breakout = (plan.presenter || []).some(x => x && x.id === 'frame-breakout');
    const { inserts, takeovers } = planRepo(linesOf(cut, build), assets, { takeovers: c.takeovers === 'off' ? 'off' : 'auto', breakout, bands: c.bands || null, swapSec: c.swapSec || null, frameBg: c.frameBg || null });
    // a spot the b-roll lane already uses keeps its clip
    // (an insert held over a gap is trimmed back to its own line first, rather than dropped)
    const hits = x => others.some(o => x.at < +o.at + +o.dur && +o.at < x.at + x.dur);
    const free = inserts.map(x => hits(x) && x.own && x.own < x.dur ? { ...x, dur: x.own } : x).filter(x => !hits(x)).map(({ own, ...x }) => ({ ...x, file: relative(build, x.file).split(sep).join('/') }));
    cut.inserts = [...others, ...free].sort((p, q) => p.at - q.at); if (!cut.inserts.length) delete cut.inserts;
    const breaks = repoRuleBreaks(free); if (breaks.length) throw new Error(`repo: the b-roll would break the repo rule: ${breaks.map(b => `${b.at} s ${b.why}`).join('; ')}`);
    cut.repoTakeovers = takeovers; // you full screen on the hook, punch lines and CTA
    writeFileSync(cutF, JSON.stringify(cut, null, 1));
    console.log(`repo: ${free.length} repo card shots, ${takeovers.length} you full screen`);
    console.log(JSON.stringify({ ok: true, repo: true, inserts: free.length }));
  };
  run().catch(e => { console.error(e.message); process.exit(1); });
}
