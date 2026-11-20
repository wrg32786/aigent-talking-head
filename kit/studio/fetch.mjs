// Fetch one reference video from a link, for Studio's Reference step (and the MCP tool studio_add_reference_url).
//   node kit/studio/fetch.mjs <url> --out <file.mp4> [--max-seconds 90] [--json]
//   node kit/studio/fetch.mjs --tools        what is installed: yt-dlp, instaloader, ffmpeg
// Sites: YouTube (and Shorts), TikTok, X, Vimeo and most other video pages go through yt-dlp, an optional tool you
// install yourself (https://github.com/yt-dlp/yt-dlp, Unlicense; pip install yt-dlp, or the standalone binary). It is
// run as a separate program and none of its code is in this kit. A direct link to an .mp4, .mov, .m4v or .webm file is
// downloaded by Node itself. Instagram uses the kit's anonymous instaloader helper (kit/ig_fetch.py): one post, no
// login, ever. Only download videos you have the rights to use as a reference, and follow each site's terms.
// Prints "progress 42%" lines while it works and, with --json, a last line {"file","site","title","seconds","trimmed"}.
import { spawn, spawnSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join, resolve, delimiter, extname } from 'path';
import { fileURLToPath } from 'url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
// the kit's Python: PYTHON, else the kit's .venv (where the installer put yt-dlp and instaloader), else the system one.
// Studio started with npm run studio has no PYTHON set; looking only at the system Python said "not installed".
const ROOT = dirname(KIT);
const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
export const MAX_BYTES = 1024 ** 3;
export const DEFAULT_MAX_SECONDS = +(process.env.STUDIO_REF_MAX_SECONDS || 90);
const IG_POST = /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,})\/?(?:[?#].*)?$/;
const DIRECT = ['.mp4', '.mov', '.m4v', '.webm'];
// plain words for the page and the agent; Studio shows Install, Send to my agent and Copy for my agent next to these
// (kit/studio/fixes.mjs, the fix ids in FIX_OF), and the CLI adds the command (kit/setup.mjs --only ytdlp)
export const INSTALL = {
  ytdlp: 'yt-dlp is not installed, so Studio cannot download this link yet. It is free and optional. Install it, then add the link again.',
  instaloader: 'Instagram links need instaloader or yt-dlp, and neither is installed. Both are free and fetch one public post anonymously; nothing logs in. Install them, then add the link again.',
  ffmpeg: 'ffmpeg is needed to join video and audio and to trim long videos, and it is not installed.',
};
const FIX_OF = { ytdlp: 'ytdlp', instaloader: 'instaloader', ffmpeg: 'ffmpeg' };
// the fix id behind one of the messages above (an error line may carry a prefix such as "download failed: ")
export const fixOf = msg => { const k = Object.keys(INSTALL).find(k => String(msg || '').includes(INSTALL[k])); return k ? FIX_OF[k] : null; };

// what a link is, before anything is downloaded
export function classify(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, error: 'not a link (paste the full address, starting with https://)' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, error: 'only http and https links' };
  const h = u.hostname.replace(/^(www\.|m\.|mobile\.)/, ''), path = u.pathname, url = u.href;
  if (/(^|\.)instagram\.com$/.test(h)) {
    const m = IG_POST.exec(url);
    if (!m) return { ok: false, site: 'instagram', error: 'Instagram: one post or reel link only (instagram.com/reel/<code>/). Profiles, stories and hashtags are not supported.' };
    return { ok: true, site: 'instagram', via: 'instaloader', url, id: m[1] };
  }
  if (DIRECT.includes(extname(path).toLowerCase())) return { ok: true, site: 'file', via: 'direct', url };
  const site = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(h) ? (path.startsWith('/shorts/') ? 'youtube-shorts' : 'youtube')
    : /(^|\.)tiktok\.com$/.test(h) ? 'tiktok' : /(^|\.)(x\.com|twitter\.com)$/.test(h) ? 'x' : /(^|\.)vimeo\.com$/.test(h) ? 'vimeo' : 'other';
  if (site === 'youtube' && !(u.searchParams.get('v') || h === 'youtu.be' || /^\/(embed|live)\//.test(path))) return { ok: false, site, error: 'YouTube: link one video (a watch, youtu.be or shorts link), not a channel or playlist' };
  return { ok: true, site, via: 'yt-dlp', url };
}

const onPath = bin => { for (const d of (process.env.PATH || '').split(delimiter).filter(Boolean)) for (const b of process.platform === 'win32' ? [bin + '.exe', bin] : [bin]) { const f = join(d, b); if (existsSync(f)) return f; } return null; };
let toolCache = null;
// yt-dlp as a program (YTDLP, PATH) or a Python module; instaloader as a Python module; ffmpeg and ffprobe on PATH
export function tools({ fresh = false } = {}) {
  if (toolCache && !fresh) return toolCache;
  let ytdlp = null;
  const cand = [process.env.YTDLP, onPath('yt-dlp')].filter(Boolean);
  for (const c of cand) { const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 20e3 }); if (r.status === 0) { ytdlp = { cmd: [c], version: r.stdout.trim() }; break; } }
  if (!ytdlp) { const r = spawnSync(PY, ['-m', 'yt_dlp', '--version'], { encoding: 'utf8', timeout: 20e3 }); if (r.status === 0) ytdlp = { cmd: [PY, '-m', 'yt_dlp'], version: r.stdout.trim() }; }
  const instaloader = spawnSync(PY, ['-c', 'import instaloader'], { stdio: 'ignore', timeout: 20e3 }).status === 0;
  const ffmpeg = onPath('ffmpeg'), ffprobe = onPath('ffprobe');
  toolCache = { ytdlp: ytdlp ? { version: ytdlp.version, cmd: ytdlp.cmd } : null, instaloader, ffmpeg: !!ffmpeg, ffprobe: !!ffprobe };
  return toolCache;
}
export function missingFor(c, t = tools()) {
  if (c.via === 'yt-dlp' && !t.ytdlp) return INSTALL.ytdlp;
  if (c.via === 'instaloader' && !t.instaloader && !t.ytdlp) return INSTALL.instaloader;
  return null;
}

function probe(file) {
  if (!tools().ffprobe) {
    const fd = openSync(file, 'r'), b = Buffer.alloc(12); readSync(fd, b, 0, 12, 0); closeSync(fd);
    const ok = b.slice(4, 8).toString() === 'ftyp' || b.readUInt32BE(0) === 0x1a45dfa3;
    return ok ? { seconds: null } : { error: 'the download is not a video file' };
  }
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) return { error: 'the download is not a playable video' };
  const j = JSON.parse(r.stdout || '{}');
  if (!(j.streams || []).some(s => s.codec_type === 'video')) return { error: 'the download has no video track' };
  return { seconds: +(+j.format.duration || 0).toFixed(2) };
}
function trim(file, max) {
  const tmp = file.replace(/\.mp4$/, '') + '.trim.mp4';
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-t', String(max), '-c', 'copy', '-movflags', '+faststart', tmp], { stdio: 'ignore' });
  if (r.status === 0 && existsSync(tmp)) { renameSync(tmp, file); return true; }
  rmSync(tmp, { force: true }); return false;
}

async function direct(url, out, say) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60e3) });
  if (!r.ok) throw new Error(`the server said ${r.status} ${r.statusText}`);
  const type = r.headers.get('content-type') || '', len = +(r.headers.get('content-length') || 0);
  if (type && !/^(video\/|application\/octet-stream|binary\/)/.test(type)) throw new Error(`that link is a ${type.split(';')[0]} page, not a video file`);
  if (len > MAX_BYTES) throw new Error('that file is over 1 GB');
  const w = createWriteStream(out); let got = 0, last = -1;
  for await (const chunk of r.body) {
    got += chunk.length; if (got > MAX_BYTES) { w.destroy(); throw new Error('that file is over 1 GB'); }
    if (!w.write(chunk)) await new Promise(ok => w.once('drain', ok));
    const p = len ? Math.floor(got / len * 100) : null; if (p != null && p !== last && p % 2 === 0) { last = p; say(`progress ${p}%`); }
  }
  await new Promise((ok, bad) => { w.end(ok); w.on('error', bad); });
  return { title: decodeURIComponent(basename(new URL(url).pathname)) };
}
function ytdlp(url, out, max, say, sections = true, anon = false) {
  const t = tools(), base = out.replace(/\.mp4$/, '');
  // anon (Instagram): no config file, no cookies, no browser cookies, so it can never log in
  const args = [...(anon ? ['--ignore-config', '--no-cookies', '--no-cookies-from-browser'] : []), '--no-playlist', '--newline', '--progress', '--no-warnings', '--max-filesize', '1G', '--restrict-filenames',
    '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b', '-o', base + '.%(ext)s',
    '--print', 'before_dl:title %(title)s', '--print', 'after_move:file %(filepath)s',
    '--progress-template', 'download:progress %(progress._percent_str)s'];
  if (t.ffmpeg) { args.push('--merge-output-format', 'mp4', '--remux-video', 'mp4'); if (sections) args.push('--download-sections', `*0-${max}`); }
  // newer yt-dlp needs a JavaScript runtime for YouTube; Node is already here
  const help = spawnSync(t.ytdlp.cmd[0], [...t.ytdlp.cmd.slice(1), '--help'], { encoding: 'utf8' }).stdout || '';
  if (help.includes('--js-runtimes')) args.push('--js-runtimes', `node:${process.execPath}`);
  args.push(url);
  return new Promise((ok, bad) => {
    const p = spawn(t.ytdlp.cmd[0], [...t.ytdlp.cmd.slice(1), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let title = null, file = null, err = '', last = -1;
    const line = l => {
      if (l.startsWith('title ')) title = l.slice(6).trim();
      else if (l.startsWith('file ')) file = l.slice(5).trim();
      else { const m = /progress\s+([\d.]+)%/.exec(l); if (m) { const v = Math.floor(+m[1]); if (v !== last && v % 2 === 0) { last = v; say(`progress ${v}%`); } } else if (l.trim()) say(l.trim()); }
    };
    let buf = ''; p.stdout.on('data', d => { buf += d; const ls = buf.split(/\r?\n/); buf = ls.pop(); ls.forEach(line); });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => bad(e));
    p.on('close', code => {
      if (buf) line(buf);
      if (code !== 0) { const m = (err.split('\n').filter(x => /ERROR/.test(x)).pop() || err.trim().split('\n').pop() || `yt-dlp exited ${code}`).replace(/^ERROR:\s*/, ''); return bad(new Error(m)); }
      if (!file || !existsSync(file)) { const f = readdirSync(dirname(out)).find(x => x.startsWith(basename(base) + '.') && !x.endsWith('.part')); file = f ? join(dirname(out), f) : null; }
      if (!file) return bad(new Error('yt-dlp finished but saved no video'));
      if (resolve(file) !== resolve(out)) renameSync(file, out);
      ok({ title });
    });
  });
}
function instagram(c, out, say) {
  const dir = join(dirname(out), '.ig-' + c.id);
  say(`fetching Instagram post ${c.id} anonymously (instaloader, no login)`);
  const r = spawnSync(PY, [join(KIT, 'ig_fetch.py'), c.id, dir], { encoding: 'utf8' });
  const f = (r.stdout || '').trim().split(/\r?\n/).pop();
  if (r.status !== 0 || !f || !existsSync(f)) { rmSync(dir, { recursive: true, force: true }); throw new Error(((r.stderr || '').trim().split('\n').pop() || 'Instagram download failed') + ' Nothing was logged in to.'); }
  renameSync(f, out); rmSync(dir, { recursive: true, force: true });
  return { title: `Instagram ${c.id}` };
}

// Instagram: instaloader first; if it is missing or Instagram refuses it ("Fetching Post metadata failed"), yt-dlp,
// anonymously. Both errors are kept, so the row shows what really happened.
async function instagramAny(c, out, max, say) {
  const t = tools(); let first = null;
  if (t.instaloader) { try { return instagram(c, out, say); } catch (e) { first = e; } }
  if (!t.ytdlp) throw first || new Error(INSTALL.instaloader);
  say(first ? `instaloader failed (${first.message.replace(/ Nothing was logged in to\.$/, '')}); trying yt-dlp, anonymously` : 'instaloader is not installed; fetching with yt-dlp, anonymously');
  for (const f of readdirSync(dirname(out))) if (f.startsWith(basename(out, '.mp4') + '.')) rmSync(join(dirname(out), f), { force: true });
  try { const r = await ytdlp(c.url, out, max, say, false, true); return { title: r.title || `Instagram ${c.id}` }; }
  catch (e) { throw new Error(first ? `instaloader: ${first.message.replace(/ Nothing was logged in to\.$/, '')}; yt-dlp: ${e.message}. Nothing was logged in to.` : `yt-dlp: ${e.message}. Nothing was logged in to.`); }
}

// download one link to out (an .mp4 path); returns { file, site, title, seconds, trimmed }
export async function download(url, out, { maxSeconds = DEFAULT_MAX_SECONDS, say = () => {} } = {}) {
  const c = classify(url); if (!c.ok) throw new Error(c.error);
  const miss = missingFor(c); if (miss) throw new Error(miss);
  mkdirSync(dirname(out), { recursive: true }); rmSync(out, { force: true });
  say(`downloading from ${c.site} (${c.via})`); say('progress 0%');
  let info;
  try { info = c.via === 'direct' ? await direct(c.url, out, say) : c.via === 'instaloader' ? await instagramAny(c, out, maxSeconds, say)
      // a partial download (first N seconds) goes through ffmpeg, which some hosts refuse; then fetch it all and trim here
      : await ytdlp(c.url, out, maxSeconds, say).catch(e => { if (!tools().ffmpeg || !/ffmpeg|403|Forbidden/i.test(e.message)) throw e; say('partial download refused, fetching the whole video and trimming it here'); for (const f of readdirSync(dirname(out))) if (f.startsWith(basename(out, '.mp4') + '.')) rmSync(join(dirname(out), f), { force: true }); return ytdlp(c.url, out, maxSeconds, say, false); }); }
  catch (e) { rmSync(out, { force: true }); throw e; }
  say('progress 100%');
  let p = probe(out); if (p.error) { rmSync(out, { force: true }); throw new Error(p.error); }
  let trimmed = false;
  if (p.seconds && p.seconds > maxSeconds + 1 && tools().ffmpeg && trim(out, maxSeconds)) { trimmed = true; say(`kept the first ${maxSeconds} s of ${Math.round(p.seconds)} s (STUDIO_REF_MAX_SECONDS changes this)`); p = probe(out); }
  return { file: out, site: c.site, title: info.title || null, seconds: p.seconds, trimmed, bytes: statSync(out).size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  if (a.includes('--tools')) { console.log(JSON.stringify(tools(), null, 1)); process.exit(0); }
  const url = a.find(x => /^https?:/i.test(x)), out = opt('out');
  if (!url || !out) { console.error('usage: node kit/studio/fetch.mjs <url> --out <file.mp4> [--max-seconds 90] [--json]'); process.exit(2); }
  try {
    const r = await download(url, resolve(out), { maxSeconds: +(opt('max-seconds') || DEFAULT_MAX_SECONDS), say: l => console.log(l) });
    console.log(a.includes('--json') ? JSON.stringify(r) : `saved ${r.file}${r.seconds ? ` (${r.seconds} s)` : ''}`);
  } catch (e) { console.error('download failed: ' + e.message); if (fixOf(e.message) && fixOf(e.message) !== 'ffmpeg') console.error('fix: npm run setup:all -- --only ytdlp'); process.exit(1); }
}
