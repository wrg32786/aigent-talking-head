// The Asset Vault: one local place for everything you own or may show (files, pictures and saved links), reused by
// every reel. It replaces the B-roll library of 1.28.0: the first time it opens, broll-library/ moves in (same clips,
// same ids, same credits). docs/specs/broll-sourcing.md, section 2.
//
// It is <kit>/vault/ by default (git ignores it), or the folder in Settings, or STUDIO_VAULT (STUDIO_BROLL_LIBRARY
// still works). If the old broll-library/ is a junction or symlink to another drive (for example
// D:\AIgent Studio\broll-library), the default Vault is created next to that real folder so the clips stay
// on the same drive, unless <kit>/vault already has an index (a previous move), in which case that vault is kept. A scratch session with STUDIO_DIR set (not the install's jobs/.studio) keeps its vault
// under that session folder and does not move the install's library. Layout:
//   vault.json                 the index: { version, items: [...], trash: [...] }
//   items/<id>/item.json       the same record beside its files
//   items/<id>/<its name>      an uploaded file (it keeps its own name)   items/<id>/thumb.jpg, frames/000.jpg ... (up to 12)
//   items/<id>/capture/        a saved link: og.<ext>, top.png, full.png, scroll.mp4
//   .trash/<id>/               deleted items, kept 7 days (Undo)
// An item is the old library clip plus: rights (mine | licensed | public-page | reference), from ({ type: file | link,
// url, site, what }), hash (sha256 of the file: the same file is added once), brand, text (what a capture read on the
// page), status ("getting" while a link is captured) and note (one plain line when something needs you).
// Reference only items (links to other people's videos and posts) are never placed in a reel.
// shortcut: tags are one flat list and search is by words, until the local picture model lands (phase 3 of the spec).
import { spawnSync } from 'child_process';
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes } from 'crypto';
import * as S from './settings.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const SOURCES = ['upload', 'library', 'pexels', 'pixabay', 'agent', 'screen', 'capture', 'generate', 'run'];
export const LICENSES = {
  pexels: { name: 'Pexels License (free to use, no attribution required; credit appreciated)', url: 'https://www.pexels.com/license/' },
  pixabay: { name: 'Pixabay Content License (free to use, no attribution required)', url: 'https://pixabay.com/service/license-summary/' },
  own: { name: 'Your own footage', url: null },
  agent: { name: 'Made in Studio from your words (yours to use)', url: null },
  capture: { name: 'Capture of a public web page: check that you may show it', url: null },
  mine: { name: 'Your own page', url: null },
  reference: { name: 'Reference only: someone else\'s content, never placed in a reel', url: null },
  run: { name: 'A fast run made from your library clips (each clip keeps its own license)', url: null },
};
export const TYPES = ['testimonial', 'product-demo', 'screen-recording', 'lifestyle'];
export const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i, IMAGE = /\.(jpe?g|png|webp)$/i;
export const RIGHTS = ['mine', 'licensed', 'public-page', 'reference'];
export const RIGHTS_LABEL = { mine: 'Mine', licensed: 'Licensed', 'public-page': 'Public page', reference: 'Reference only' };
// the four filters of the Vault view
export const KINDS = ['video', 'image', 'page', 'screen'], FROM = ['uploaded', 'links', 'stock', 'made'];
// spec question 9 defaults: 2 GB a file, 20 GB a Vault (Settings broll.vaultGb), a link is stale after 30 days, Undo for 7
export const LIMITS = { fileBytes: 2e9, vaultBytes: 20e9, near: 0.8, staleDays: 30, trashDays: 7 };
const DAY = 24 * 3600e3;
const bad = (m, code = 400, extra) => Object.assign(new Error(m), { code }, extra || {});

// ---------- where it lives, and the old library moving in ----------
const MOVED = new Set();
const realOr = p => { try { return existsSync(p) ? realpathSync(p) : resolve(p); } catch { return resolve(p); } };
const DEFAULT_STATE = root => join(root, 'jobs', '.studio');
// Where the Vault should live, and which old-library folders to move in. `root` is the kit (tests pass a temp one).
export function resolveDir(env = process.env, root = ROOT, settings) {
  const st = settings || S.loadFile();
  const own = env.STUDIO_VAULT || env.STUDIO_BROLL_LIBRARY || (st.broll && st.broll.library) || null;
  if (own) { const p = resolve(own); return { dir: p, from: [p] }; }
  // a scratch session (STUDIO_DIR pointed away from the install state) must not touch the install library
  if (env.STUDIO_DIR && resolve(env.STUDIO_DIR) !== resolve(DEFAULT_STATE(root))) {
    const p = resolve(join(env.STUDIO_DIR, 'vault')); return { dir: p, from: [p] };
  }
  const lib = join(root, 'broll-library'), fallback = resolve(join(root, 'vault'));
  if (!existsSync(lib)) return { dir: fallback, from: [fallback] };
  const realLib = realOr(lib), elsewhere = dirname(realLib) !== realOr(dirname(resolve(lib)));
  // if the kit vault already has an index (a previous move landed there), keep it; do not hide those clips
  const p = elsewhere && !existsSync(join(fallback, 'vault.json')) ? resolve(join(dirname(realLib), 'vault')) : fallback;
  return { dir: p, from: [p, realLib] };
}
export function dir(env = process.env) {
  const { dir: p, from } = resolveDir(env);
  mkdirSync(p, { recursive: true });
  if (!MOVED.has(p)) { MOVED.add(p); for (const src of from) { try { migrate(src, p); } catch (e) { console.error('vault: the old library did not move in: ' + e.message); } } }
  return p;
}
const idxPath = d => join(d || dir(), 'vault.json');
export function load(d) {
  try { const j = JSON.parse(readFileSync(idxPath(d), 'utf8')); return { version: 1, items: Array.isArray(j.items) ? j.items : [], trash: Array.isArray(j.trash) ? j.trash : [] }; }
  catch { return { version: 1, items: [], trash: [] }; }
}
function save(v, d) { const f = idxPath(d), tmp = f + '.tmp'; writeFileSync(tmp, JSON.stringify(v, null, 1) + '\n'); renameSync(tmp, f); }
// the record beside its files, so the index can be rebuilt from the folder
function keep(it, d = dir()) { try { mkdirSync(join(d, 'items', it.id), { recursive: true }); writeFileSync(join(d, 'items', it.id, 'item.json'), JSON.stringify(it, null, 1) + '\n'); } catch {} return it; }
// a file or a folder. When a rename is refused (another drive, or Windows with a file of the folder still open in a
// player) it is copied, and the old one is cleared as far as it lets us.
const move = (a, b) => { mkdirSync(dirname(b), { recursive: true }); try { renameSync(a, b); } catch { cpSync(a, b, { recursive: true }); try { rmSync(a, { recursive: true, force: true, maxRetries: 3 }); } catch {} } };
export const rightsOf = source => (source === 'pexels' || source === 'pixabay' ? 'licensed' : source === 'capture' ? 'public-page' : 'mine');
const siteOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
export function sha(f) {
  const h = createHash('sha256'), fd = openSync(f, 'r'), buf = Buffer.allocUnsafe(1 << 20);
  try { for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { closeSync(fd); }
  return 'sha256:' + h.digest('hex');
}
// broll-library/library.json (1.28.0 and before) into the Vault: every clip keeps its id, name, tags, license, author,
// source link and where it was used, so old reels and credits.txt still read the same. The old index is kept beside
// it as library.migrated.json. Returns how many moved. The index is saved after every clip and a clip whose file already
// moved is picked up again, so stopping Studio half way loses nothing: the next start carries on.
export function migrate(from, to) {
  const f = join(from, 'library.json'); if (!existsSync(f)) return 0;
  let clips = []; try { clips = JSON.parse(readFileSync(f, 'utf8')).clips || []; } catch { return 0; }
  const v = load(to), have = new Set(v.items.map(x => x.id)); let n = 0;
  for (const c of clips) {
    if (!c || !c.id || have.has(c.id) || !c.file) continue;
    const src = join(from, c.file), rel = `items/${c.id}/${basename(c.file)}`;
    if (existsSync(src)) move(src, join(to, rel)); else if (!existsSync(join(to, rel))) continue;
    let thumb = `items/${c.id}/thumb.jpg`; if (c.thumb && existsSync(join(from, c.thumb))) move(join(from, c.thumb), join(to, thumb)); else if (!existsSync(join(to, thumb))) thumb = null;
    const it = { ...c, file: rel, thumb, rights: rightsOf(c.source), from: c.source === 'capture' && c.sourceUrl ? { type: 'link', url: c.sourceUrl, site: siteOf(c.sourceUrl), what: 'page' } : { type: 'file' }, hash: sha(join(to, rel)), brand: [] };
    v.items.push(keep(it, to)); save(v, to); n++;
  }
  save(v, to); renameSync(f, join(from, 'library.migrated.json'));
  for (const d of ['.thumbs', ...SOURCES]) { try { rmdirSync(join(from, d)); } catch {} } // only the folders the move left empty
  if (n) console.error(`vault: ${n} clip${n === 1 ? '' : 's'} moved in from your B-roll library, credits kept, now in ${realOr(to)}`);
  return n;
}

// ---------- reading ----------
export const pathOf = it => (it && it.file ? join(dir(), it.file) : null);
export const get = id => load().items.find(x => x.id === id) || null;
// may this go in a reel: never a reference only item, never one with no picture yet
export const placeable = it => !!it && it.rights !== 'reference' && !!it.file && it.status !== 'getting';
export const kindOf = it => (it.from && it.from.type === 'link' ? 'page' : it.source === 'screen' || it.type === 'screen-recording' ? 'screen' : it.kind === 'image' ? 'image' : 'video');
export const fromOf = it => (it.from && it.from.type === 'link' || it.source === 'capture' ? 'links' : it.source === 'pexels' || it.source === 'pixabay' ? 'stock' : ['agent', 'generate', 'run'].includes(it.source) ? 'made' : 'uploaded');
const STOP = new Set('a an the and or of to in on at for with by from is are this that video clip stock free hd 4k 1080p 720p mp4 mov webm final copy new img vid pexels pixabay www com https http'.split(' '));
export const words = s => String(s || '').toLowerCase().replace(/https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
export const stem = w => w.replace(/(ings?|ed|es|s)$/, '').replace(/(.)\1$/, '$1');
// everything a search by words reads: names, tags, brand, the page's title, site and the text the capture found
export const hayOf = it => [it.name, it.title, it.source, it.author && it.author.name, it.from && it.from.site, it.describe, ...(it.tags || []), ...(it.brand || []), it.text].map(v => String(v || '').toLowerCase()).join(' ');
export const stale = (it, now = Date.now()) => !!(it.captured && now - Date.parse(it.captured) > LIMITS.staleDays * DAY);
// search by names, tags and page text: every word must be there. Filters: kind (video, image, page, screen), source
// (uploaded, links, stock, made), tag (a tag or a brand), used (true: used in a reel, false: not yet), rights
export function search(q, { kind, source, tag, used, rights } = {}) {
  const qs = [...new Set(words(q))], t = tag ? String(tag).toLowerCase() : null;
  return load().items.filter(it => (!kind || kindOf(it) === kind) && (!source || fromOf(it) === source) && (!rights || it.rights === rights)
    && (!t || (it.tags || []).includes(t) || (it.brand || []).some(b => b.toLowerCase() === t))
    && (used == null || ((it.usedIn || []).length > 0) === !!used)
    && (!qs.length || (() => { const hay = hayOf(it), toks = new Set(words(hay).map(stem)); return qs.every(w => hay.includes(w) || toks.has(stem(w))); })()));
}
export function usage() {
  const st = S.loadFile(), limit = (+(st.broll && st.broll.vaultGb) > 0 ? +st.broll.vaultGb * 1e9 : LIMITS.vaultBytes), bytes = load().items.reduce((a, x) => a + (+x.bytes || 0), 0);
  return { bytes, limit, near: bytes >= limit * LIMITS.near, full: bytes >= limit };
}

// ---------- pictures: probe, tags from the frames, thumbnail, frames ----------
const has = bin => { const r = spawnSync(bin, ['-version'], { stdio: 'ignore' }); return !r.error && r.status === 0; };
let FF = null; const ffOk = () => (FF == null ? (FF = has('ffmpeg') && has('ffprobe')) : FF);
export function probe(f) {
  if (!ffOk()) return {};
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type:stream_side_data=rotation', '-of', 'json', f], { encoding: 'utf8' });
  try { const j = JSON.parse(r.stdout), v = (j.streams || []).find(s => s.codec_type === 'video') || {}; let w = v.width, h = v.height;
    const rot = Math.abs(+(((v.side_data_list || [])[0] || {}).rotation || 0)); if (rot === 90 || rot === 270) [w, h] = [h, w];
    return { seconds: j.format && j.format.duration ? +(+j.format.duration).toFixed(2) : null, width: w || null, height: h || null, sound: (j.streams || []).some(s => s.codec_type === 'audio') }; } catch { return {}; }
}
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
function thumbOf(f, id) {
  if (!ffOk()) return null;
  const rel = `items/${id}/thumb.jpg`, out = join(dir(), rel); mkdirSync(dirname(out), { recursive: true });
  const shot = ss => spawnSync('ffmpeg', ['-v', 'error', '-y', ...ss, '-i', f, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out], { stdio: 'ignore' }).status === 0 && existsSync(out);
  return (IMAGE.test(f) ? shot([]) : shot(['-ss', '0.5']) || shot([])) ? rel : null;
}
// a video keeps one small frame every 2 seconds, up to 12 (what a later picture model, or your agent, looks at)
function framesOf(f, id) {
  if (!ffOk() || !VIDEO.test(f)) return 0;
  const d = join(dir(), 'items', id, 'frames'); mkdirSync(d, { recursive: true });
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', 'fps=1/2,scale=320:-2', '-frames:v', '12', '-start_number', '0', '-q:v', '6', join(d, '%03d.jpg')], { stdio: 'ignore' });
  try { return readdirSync(d).filter(x => /\.jpg$/.test(x)).length; } catch { return 0; }
}
const safe = n => basename(String(n || 'clip')).replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 80) || 'clip';
const tagList = a => [...new Set((a || []).map(x => String(x).toLowerCase().trim()).filter(Boolean))].slice(0, 30);
const brandList = a => [...new Map([].concat(a || []).map(x => String(x).trim().slice(0, 40)).filter(Boolean).map(x => [x.toLowerCase(), x])).values()].slice(0, 8);

// ---------- adding a file ----------
// Copied in (or moved with move: true) with where it came from, its license and its rights mark. The same file twice
// is added once: you get the item you already have, with duplicate: true (uploads and screen recordings; stock is
// checked by its own id, and pieces cut from a raw upload, made cards and fast runs are always their own items).
// a file given to us to move (an upload's temp file) is cleared when it is refused, so a full Vault does not fill the disk
export function add(src, m = {}) { try { return addFile(src, m); } catch (e) { if (m.move) rmSync(src, { force: true }); throw e; } }
function addFile(src, m) {
  if (!existsSync(src)) throw bad('no such file');
  const name = safe(m.name || basename(src)); if (!VIDEO.test(name) && !IMAGE.test(name)) throw bad('b-roll is a video (mp4, mov, webm, m4v, mkv) or a picture (jpg, png, webp)');
  const bytes = statSync(src).size, u = usage();
  if (bytes > LIMITS.fileBytes) throw bad('That file is over 2 GB. Trim it or export it smaller, then add it again.', 413);
  if (u.bytes + bytes > u.limit) throw bad(`Your Vault is full (${Math.round(u.limit / 1e9)} GB). Delete something you do not use, then add this again.`, 413);
  const source = SOURCES.includes(m.source) ? m.source : 'upload';
  // only what you add yourself is checked: stock has its own id check, and made clips are always their own items
  const hash = sha(src), v = load(), dup = (source === 'upload' || source === 'screen') && !m.raw && !m.run ? v.items.find(x => x.hash === hash) : null;
  if (dup) { if (m.move) rmSync(src, { force: true }); return { ...dup, duplicate: true }; }
  const id = 'br' + randomBytes(4).toString('hex'), rel = `items/${id}/${name}`, file = join(dir(), rel);
  mkdirSync(dirname(file), { recursive: true });
  if (m.move) move(src, file); else copyFileSync(src, file);
  const meta = probe(file), tags = tagList([...(m.tags || []), ...words(basename(name, extname(name))), ...words(m.title), ...frameTags(file, meta), source]);
  const rights = RIGHTS.includes(m.rights) ? m.rights : m.mine ? 'mine' : rightsOf(source);
  const it = { id, file: rel, name: m.title ? String(m.title).slice(0, 80) : name, source, kind: IMAGE.test(name) ? 'image' : 'video', rights,
    license: m.license || (source === 'upload' || source === 'screen' ? LICENSES.own : source === 'agent' ? LICENSES.agent : source === 'capture' ? LICENSES.capture : source === 'run' ? LICENSES.run : { name: 'unknown', url: null }),
    author: m.author || null, sourceUrl: m.sourceUrl || null, from: m.sourceUrl && source === 'capture' ? { type: 'link', url: m.sourceUrl, site: siteOf(m.sourceUrl), what: 'page' } : { type: 'file' },
    tags, brand: brandList(m.brand), ...(m.describe ? { describe: String(m.describe).slice(0, 300) } : {}), ...meta, bytes, hash, thumb: thumbOf(file, id), frames: framesOf(file, id), addedAt: new Date().toISOString(),
    ...(source === 'capture' ? { captured: new Date().toISOString() } : {}),
    ...(m.prompt ? { prompt: String(m.prompt).slice(0, 500) } : {}), ...(m.provider ? { provider: m.provider, model: m.model || null } : {}), ...(m.extId ? { extId: String(m.extId) } : {}), ...(m.type && TYPES.includes(m.type) ? { type: m.type } : {}), ...(m.raw ? { raw: m.raw } : {}),
    // a fast run (kit/fastrun.cjs): the clips it was cut from, in order, and the seconds each one plays
    ...(m.run ? { run: m.run } : {}), usedIn: [] };
  const v2 = load(); v2.items.unshift(keep(it)); save(v2); return it;
}
export function update(id, p) {
  const v = load(), it = v.items.find(x => x.id === id); if (!it) throw bad(`no b-roll ${id}`, 404);
  if (p.name != null && String(p.name).trim()) it.name = String(p.name).trim().slice(0, 80);
  if (Array.isArray(p.tags)) it.tags = tagList(p.tags);
  if (p.brand !== undefined) it.brand = brandList(p.brand);
  if (p.describe != null) it.describe = String(p.describe).slice(0, 300);
  if (p.rights != null) { if (!RIGHTS.includes(p.rights)) throw bad(`rights: ${RIGHTS.join(', ')}`); it.rights = p.rights; }
  if (p.type !== undefined) { if (p.type !== null && !TYPES.includes(p.type)) throw bad(`type: ${TYPES.join(', ')} or null`); if (p.type) { it.type = p.type; it.tags = tagList([p.type, ...(it.tags || []).filter(t => !TYPES.includes(t))]); } else delete it.type; }
  if (p.usedIn) it.usedIn = [...new Set([...(it.usedIn || []), p.usedIn])].slice(-50);
  if (p.patch) Object.assign(it, p.patch); // the capture's own result (file, text, status), never from a request
  keep(it); save(v); return it;
}
// Delete: the item leaves the Vault and waits in .trash for 7 days. restore() is the Undo.
export function remove(id) {
  const v = load(), k = v.items.findIndex(x => x.id === id); if (k < 0) throw bad(`no b-roll ${id}`, 404);
  const [it] = v.items.splice(k, 1), d = dir(), a = join(d, 'items', id);
  if (existsSync(a)) { rmSync(join(d, '.trash', id), { recursive: true, force: true }); move(a, join(d, '.trash', id)); }
  v.trash = [{ ...it, deletedAt: new Date().toISOString() }, ...v.trash.filter(x => x.id !== id)]; save(v); return it;
}
export function restore(id) {
  const v = load(), k = v.trash.findIndex(x => !id || x.id === id); if (k < 0) throw bad('nothing to undo', 404);
  const [{ deletedAt, ...it }] = v.trash.splice(k, 1), d = dir(), a = join(d, '.trash', it.id);
  if (existsSync(a)) { rmSync(join(d, 'items', it.id), { recursive: true, force: true }); move(a, join(d, 'items', it.id)); }
  v.items.unshift(it); save(v); return it;
}
// deleted more than 7 days ago: gone for good
export function purge(now = Date.now()) {
  const v = load(), old = v.trash.filter(x => now - Date.parse(x.deletedAt) > LIMITS.trashDays * DAY); if (!old.length) return 0;
  for (const x of old) rmSync(join(dir(), '.trash', x.id), { recursive: true, force: true });
  v.trash = v.trash.filter(x => !old.includes(x)); save(v); return old.length;
}

// ---------- adding a link ----------
const TRACK = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|msclkid|igshid|igsh|mc_cid|mc_eid|ref|ref_src|ref_url|si|feature|share_id|_hsenc|_hsmi|spm)$/i;
// tidy an address: https when none is given, no tracking parts, no fragment, no trailing slash
export function tidyUrl(u) {
  const s = String(u || '').trim(); if (!s) throw bad('Paste a link first.');
  let url; try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch { throw bad('That does not look like a link.'); }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) throw bad('Only public web links (http or https).');
  for (const k of [...url.searchParams.keys()]) if (TRACK.test(k)) url.searchParams.delete(k);
  url.hash = ''; url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, '').replace(/\/\?/, '?');
}
// what a link is: a post (someone's video or post: reference only unless it is yours), a profile, or a page
export function linkKind(u) {
  const url = new URL(u), h = url.hostname.replace(/^(www|m|mobile)\./, ''), p = url.pathname;
  const social = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|vimeo\.com|linkedin\.com|threads\.net|threads\.com|twitch\.tv|reddit\.com|pinterest\.com|snapchat\.com)$/.test(h);
  if (!social) return 'page';
  if (/youtu\.be$|fb\.watch$/.test(h) && p.length > 1) return 'post';
  if (/\/(watch|shorts|live|embed|video|videos|reel|reels|p|tv|status|posts|post|clip|pin|comments|spotlight)(\/|$)/.test(p) || url.searchParams.has('v') || (/vimeo\.com$/.test(h) && /^\/\d+/.test(p)) || /^\/@[^/]+\/(video|photo)\//.test(p)) return 'post';
  return p.replace(/\/$/, '').split('/').filter(Boolean).length === 1 ? 'profile' : 'page';
}
const linkName = u => { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).slice(0, 80); };
// Save a link. The item is in the Vault at once (status "getting" while a capture runs); `ready` resolves with the
// finished item. capture is kit/capture.mjs capture (null: keep the link with no picture). The same link twice gives
// the item you have. Someone else's video or post is saved as reference only and never placed; tick mine for your own.
export function addLink(url, o = {}, { capture = null } = {}) {
  const key = x => String(x).replace(/^https?:\/\/(www\.)?/, ''); // the same page with or without www, http or https
  const u = tidyUrl(url), v = load(), dup = v.items.find(x => x.from && x.from.type === 'link' && key(x.from.url) === key(u));
  // the link you have. One with no picture (the page did not open, or Studio stopped half way) is tried again.
  if (dup) { const busy = dup.status === 'getting' && Date.now() - Date.parse(dup.addedAt) < 5 * 60e3, again = capture && !dup.file && !busy ? update(dup.id, { patch: { status: 'getting', note: null } }) : null;
    return { item: { ...(again || dup), duplicate: true }, duplicate: true, ready: again ? grab(again, capture) : Promise.resolve(dup) }; }
  const what = linkKind(u), mine = o.mine === true, rights = mine ? 'mine' : what === 'post' ? 'reference' : 'public-page', id = 'br' + randomBytes(4).toString('hex');
  const it = { id, file: null, name: o.title ? String(o.title).slice(0, 80) : linkName(u), source: 'capture', kind: 'link', rights, license: rights === 'mine' ? LICENSES.mine : rights === 'reference' ? LICENSES.reference : LICENSES.capture,
    author: null, sourceUrl: u, from: { type: 'link', url: u, site: siteOf(u), what }, tags: tagList([...(o.tags || []), ...words(linkName(u).replace(/[./]/g, ' ')), what]), brand: brandList(o.brand), ...(o.describe ? { describe: String(o.describe).slice(0, 300) } : {}),
    bytes: 0, thumb: null, addedAt: new Date().toISOString(), usedIn: [], ...(capture ? { status: 'getting' } : {}),
    ...(what === 'post' ? { note: 'We saved a picture of this video. Add the file itself to use the footage.' } : {}), ...(!capture ? { note: 'Saved as a link. We could not take a picture of it on this computer.' } : {}) };
  v.items.unshift(keep(it)); save(v);
  const ready = capture ? grab(it, capture) : Promise.resolve(it);
  return { item: it, duplicate: false, ready };
}
// capture a saved link: the share image and title, the top of the page, the full page, a short scrolling recording
// (a still only for a video or a post) and the text on the page. A sign in wall keeps the link and says so.
async function grab(it, capture) {
  const post = it.from.what === 'post';
  try {
    const r = await capture(it.from.url, { scroll: post ? 0 : 10, width: 780, imageOnly: post, force: true, extras: true });
    if (!get(it.id)) return null; // deleted while we worked: write nothing, so Undo finds its folder free
    const d = join(dir(), 'items', it.id, 'capture'); mkdirSync(d, { recursive: true });
    const put = (name, as) => { const f = join(r.dir, name); if (!existsSync(f)) return null; copyFileSync(f, join(d, as)); return `items/${it.id}/capture/${as}`; };
    const top = put('shot.png', 'top.png'), full = put('full.png', 'full.png'), scroll = post ? null : put('scroll.mp4', 'scroll.mp4'), og = r.og ? put(r.og, 'og' + extname(r.og)) : null;
    if (r.signin || !top) return update(it.id, { patch: { status: null, note: 'This page needs you signed in. We kept the link.' } });
    const file = scroll || top, abs = join(dir(), file), meta = probe(abs), bytes = [top, full, scroll, og].filter(Boolean).reduce((a, f) => a + statSync(join(dir(), f)).size, 0);
    const cur = get(it.id);
    const title = String(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return update(it.id, { tags: [...(cur.tags || []), ...words(title), ...frameTags(abs, meta)], patch: { status: null, file, kind: scroll ? 'video' : 'image', ...meta, bytes, capture: { og, top, full, scroll }, hash: sha(abs), frames: scroll ? framesOf(abs, it.id) : 0,
      thumb: thumbOf(join(dir(), og || top), it.id) || thumbOf(join(dir(), top), it.id), ...(title ? { title, ...(cur.name === linkName(it.from.url) ? { name: title } : {}) } : {}), text: String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, 4000), captured: new Date().toISOString(), ...(r.final ? { final: r.final } : {}) } });
  } catch (e) { try { return update(it.id, { patch: { status: null, note: 'We could not open this page, so we kept the link only.' } }); } catch { return null; } }
}

// ---------- what the page and an agent read ----------
const ago = (iso, now = Date.now()) => { const d = Math.floor((now - Date.parse(iso)) / DAY); return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`; };
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
// a file's name without its ending, for the grid ("weekend-walk", not "weekend-walk.mp4")
const shown = n => String(n || '').replace(/\.(mp4|mov|m4v|webm|mkv|jpe?g|png|webp)$/i, '') || String(n || '');
const KIND_WORD = { video: 'Video', image: 'Image', page: 'Page', screen: 'Screen' };
// one item for the grid: no file paths, no scores, no model names
export function brief(it, now = Date.now()) {
  const kind = kindOf(it), used = (it.usedIn || []).length;
  const line = [KIND_WORD[kind], kind === 'page' ? it.from.site : it.seconds && it.kind === 'video' ? clock(it.seconds) : null, used ? `used ${used === 1 ? 'once' : used === 2 ? 'twice' : used + ' times'}` : null].filter(Boolean).join(', ');
  return { id: it.id, name: shown(it.name), kind, source: fromOf(it), media: it.kind, rights: it.rights, rightsLabel: RIGHTS_LABEL[it.rights] || it.rights, placeable: placeable(it), line, tags: it.tags || [], brand: it.brand || [], type: it.type || null,
    seconds: it.seconds || null, width: it.width || null, height: it.height || null, used, usedIn: it.usedIn || [], link: it.from && it.from.type === 'link' ? it.from.url : it.sourceUrl || null, site: (it.from && it.from.site) || null,
    author: it.author || null, license: it.license ? it.license.name : null, describe: it.describe || null, added: it.addedAt, ...(it.status === 'getting' && now - Date.parse(it.addedAt) < 5 * 60e3 ? { status: 'getting' } : {}), ...(it.note ? { note: it.note } : {}),
    ...(it.captured ? { captured: ago(it.captured, now), stale: stale(it, now) } : {}), ...(it.rights === 'public-page' ? { check: 'Check that you may show it.' } : {}),
    thumb: it.thumb ? `/api/vault/file?id=${it.id}&thumb=1` : null, url: it.file ? `/api/vault/file?id=${it.id}` : null };
}
// words only for an AI by default (spec question 4): no picture and no path unless you turned pictures on in Settings
export function forAgent(it, { pictures = false } = {}) {
  return { id: it.id, title: it.name, kind: kindOf(it), source: fromOf(it), rights: it.rights, placeable: placeable(it), tags: (it.tags || []).slice(0, 16), brand: it.brand || [], description: it.describe || null, seconds: it.seconds || null,
    width: it.width || null, height: it.height || null, link: it.from && it.from.type === 'link' ? it.from.url : null, text: it.text ? it.text.slice(0, 300) : null, used: (it.usedIn || []).length, ...(it.status === 'getting' ? { status: 'getting' } : {}), ...(it.note ? { note: it.note } : {}),
    ...(pictures && it.thumb ? { thumbnail: join(dir(), it.thumb) } : {}) };
}
// the tags worth a chip: the most used ones, brands first
export function topTags(items, n = 12) {
  const c = new Map(), skip = new Set([...SOURCES, 'portrait', 'landscape', 'square', 'short', 'medium', 'long', 'dark', 'bright', 'mid-light', 'muted', 'still', 'moving', 'page', 'post', 'profile']);
  for (const it of items) for (const t of it.tags || []) if (!skip.has(t)) c.set(t, (c.get(t) || 0) + 1);
  const brands = [...new Set(items.flatMap(it => it.brand || []))];
  return [...brands, ...[...c.entries()].filter(([t, k]) => k > 1 && !brands.some(b => b.toLowerCase() === t)).sort((a, b) => b[1] - a[1]).map(([t]) => t)].slice(0, n);
}
