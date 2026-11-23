// A publish kit for a finished reel: a cover still with the title off the face, post copy per platform, and a ZIP
// with the reel, the .srt, the cover and the copy. No auto-post, no outbound analytics, no new npm dependencies.
//   node kit/publish-kit.mjs <reel.mp4> [--title "..."] [--t 1.2] [--out dir]
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { python } from './setup.mjs';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
export const COVER_T = 1.2;
// intersection of the 9:16 platform safe areas in kit/exports.json, so the title clears TikTok, Reels and Shorts UI
export const SAFE = { x0: 60, y0: 220, x1: 940, y1: 1480, w: 1080, h: 1920 };

const STOP = new Set(('a an the and or but if to of in on for with from as at by is are was were be been being this that these those it its you your we our they their i me my not no so just very really about into over after before than then also can will would could should do does did have has hasn t s d ll ve re about today video reel talk podcast episode').split(/\s+/));

export const PLATFORMS = {
  instagram: { name: 'Instagram Reels', caption: 2200 },
  tiktok: { name: 'TikTok', caption: 2200 },
  youtube: { name: 'YouTube Shorts', caption: 5000, title: 100 },
  facebook: { name: 'Facebook Reels', caption: 5000 },
  linkedin: { name: 'LinkedIn', caption: 3000 },
  twitter: { name: 'X', caption: 280 },
  threads: { name: 'Threads', caption: 500 },
  bluesky: { name: 'Bluesky', caption: 300 }
};

export const units = s => [...String(s || '')].reduce((n, c) => n + (c.codePointAt(0) > 0xffff ? 2 : 1), 0);
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (units(t) <= n) return t;
  const words = t.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? out + ' ' + w : w;
    if (units(next) > n) break;
    out = next;
  }
  return out || [...t].slice(0, n).join('');
};

// wrap a title on word ends only, never mid-word, up to two lines
export function wrapTitle(text, { max = 32, lines = 2 } = {}) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && next.length > max) {
      if (out.length + 1 >= lines) { out.push(line); return out; }
      out.push(line); line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out.slice(0, lines);
}

// the largest band inside the safe area that does not cover the face keep-out zone
export function titleBox(zone, safe = SAFE) {
  const { x0, y0, x1, y1 } = safe, w = x1 - x0, minH = 160;
  if (!zone) return { x: x0, y: y0, w, h: Math.min(360, y1 - y0) };
  const z0 = zone[1], z1 = zone[3];
  const topH = Math.max(0, Math.min(z0, y1) - y0);
  const botH = Math.max(0, y1 - Math.max(z1, y0));
  if (topH >= botH && topH >= minH) return { x: x0, y: y0, w, h: Math.min(360, topH) };
  if (botH >= minH) return { x: x0, y: Math.max(z1, y0), w, h: Math.min(360, botH) };
  // almost no room: use the larger band anyway, still clipped to the safe area
  return topH >= botH ? { x: x0, y: y0, w, h: Math.max(80, topH) } : { x: x0, y: Math.max(z1, y0), w, h: Math.max(80, botH) };
}

export function overlapsFace(box, zone) {
  if (!box || !zone) return false;
  const [zx0, zy0, zx1, zy1] = zone;
  return box.x < zx1 && box.x + box.w > zx0 && box.y < zy1 && box.y + box.h > zy0;
}

export function tagsOf(...parts) {
  const words = String(parts.filter(Boolean).join(' ')).toLowerCase().replace(/[#]/g, ' ').match(/[a-z][a-z0-9]{3,20}/g) || [];
  const seen = new Set(), out = [];
  for (const w of words) {
    if (STOP.has(w) || seen.has(w)) continue;
    seen.add(w); out.push('#' + w);
    if (out.length >= 8) break;
  }
  return out;
}

export function copyOf({ title, description, hashtags, point, text } = {}) {
  const rawTitle = clip(title || point || 'New reel', 100) || 'New reel';
  const body = clip(description || text || point || '', 2000);
  const tags = Array.isArray(hashtags) ? hashtags.map(t => (String(t).startsWith('#') ? String(t) : '#' + String(t).replace(/^#+/, '')).replace(/\s+/g, '')).filter(t => t.length > 1) : tagsOf(rawTitle, body, point);
  const platforms = {};
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const t = p.title ? clip(rawTitle, p.title) : rawTitle;
    const tagStr = tags.join(' ');
    const room = p.caption - (tagStr ? units(tagStr) + 2 : 0);
    const desc = room > 20 ? clip(body, room) : '';
    const caption = [desc, tagStr].filter(Boolean).join('\n\n');
    platforms[id] = { name: p.name, title: t, description: desc, hashtags: tags.slice(), caption, limit: p.caption, over: units(caption) > p.caption };
  }
  return { title: rawTitle, description: body, hashtags: tags, platforms };
}

export function copyText(copy) {
  const lines = [`Title: ${copy.title}`, '', copy.description || '', '', (copy.hashtags || []).join(' ')];
  for (const [id, p] of Object.entries(copy.platforms || {})) {
    lines.push('', `--- ${p.name || id} ---`, p.title && p.title !== copy.title ? `Title: ${p.title}` : '', p.caption || '');
  }
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim() + '\n';
}

export function pathsOf(reel) {
  const abs = isAbsolute(reel) ? reel : resolve(ROOT, reel);
  const dir = dirname(abs), base = basename(abs, extname(abs));
  return {
    reel: abs,
    srt: join(dir, base + '.srt'),
    cover: join(dir, base + '-cover.jpg'),
    copyJson: join(dir, base + '-copy.json'),
    copyTxt: join(dir, base + '-copy.txt'),
    zip: join(dir, base + '-kit.zip')
  };
}

export function durationOf(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file], { encoding: 'utf8' }).trim();
  const n = parseFloat(out);
  if (!isFinite(n) || n <= 0) throw new Error('could not read the video length');
  return n;
}

export function extractFrame(file, t, out) {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-q:v', '2', out], { stdio: 'pipe' });
  if (!existsSync(out)) throw new Error('could not take a still from the reel');
  return out;
}

function py() {
  const bin = python();
  if (!bin) throw Object.assign(new Error('Python is missing, so we cannot make the cover yet'), { code: 400 });
  return bin;
}

export function drawCover({ frame, out, title, zone, box }) {
  const args = [join(KIT, 'publish-cover.py'), '--in', frame, '--out', out, '--title', title || ''];
  if (zone) args.push('--zone', zone.join(','));
  if (box) args.push('--box', [box.x, box.y, box.w, box.h].join(','));
  const r = execFileSync(py(), args, { encoding: 'utf8', cwd: ROOT });
  const line = r.trim().split('\n').pop();
  return JSON.parse(line);
}

export function makeCover(reel, { title, t, out } = {}) {
  const files = pathsOf(reel);
  const dest = out || files.cover;
  const len = durationOf(files.reel);
  const at = Math.min(Math.max(0, t == null ? COVER_T : +t), Math.max(0, len - 0.05));
  const frame = dest.replace(/(\.[^.]+)?$/, '-frame.jpg');
  extractFrame(files.reel, at, frame);
  const drawn = drawCover({ frame, out: dest, title: title || basename(files.reel, extname(files.reel)) });
  return { cover: dest, t: at, duration: len, ...drawn };
}

export function writeCopy(reel, copy) {
  const files = pathsOf(reel);
  writeFileSync(files.copyJson, JSON.stringify(copy, null, 2) + '\n');
  writeFileSync(files.copyTxt, copyText(copy));
  return files;
}

export function zipKit(reel) {
  const files = pathsOf(reel), bin = py();
  const parts = [files.reel, files.srt, files.cover, files.copyJson, files.copyTxt].filter(existsSync);
  if (!parts.includes(files.reel)) throw new Error('the reel is missing');
  execFileSync(bin, ['-m', 'zipfile', '-c', files.zip, ...parts.map(p => basename(p))], { cwd: dirname(files.zip), encoding: 'utf8' });
  if (!existsSync(files.zip)) throw new Error('could not write the ZIP');
  return { zip: files.zip, files: parts };
}

export function makeKit(reel, opts = {}) {
  const files = pathsOf(reel);
  if (!existsSync(files.reel)) throw Object.assign(new Error('no such reel'), { code: 400 });
  const cover = makeCover(files.reel, opts);
  const copy = opts.copy || copyOf({ title: opts.title, description: opts.description, hashtags: opts.hashtags, point: opts.point, text: opts.text });
  writeCopy(files.reel, copy);
  const z = zipKit(files.reel);
  return { ...files, ...cover, copy, zip: z.zip, packed: z.files.map(f => basename(f)) };
}

export function titleFromJob(dir) {
  const tryRead = p => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
  const cap = tryRead(join(dir, 'captions.js')) || tryRead(join(dir, 'build', 'captions.js'));
  const m = cap && cap.match(/titles["']?\s*[:=]\s*\[([\s\S]*?)\]/);
  if (m) {
    const first = m[1].match(/text["']?\s*:\s*["']([^"']+)["']/);
    if (first) return first[1].trim();
  }
  return '';
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const reel = argv.find((a, i) => !a.startsWith('-') && !(i && ['title', 't', 'out', 'point'].includes(String(argv[i - 1]).replace(/^--/, ''))));
  if (!reel) { console.error('usage: npm run publish-kit -- <reel.mp4> [--title "..."] [--t 1.2] [--out cover.jpg]'); process.exit(2); }
  const kit = makeKit(reel, { title: opt('title'), t: opt('t') ? +opt('t') : undefined, out: opt('out'), point: opt('point') });
  if (argv.includes('--json')) console.log(JSON.stringify({ cover: kit.cover, zip: kit.zip, t: kit.t, copy: kit.copy }, null, 2));
  else {
    console.log('cover: ' + kit.cover);
    if (kit.zip) console.log('zip: ' + kit.zip);
    console.log('title: ' + kit.copy.title);
  }
}
