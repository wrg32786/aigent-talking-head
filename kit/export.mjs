// Export a finished reel for one platform (kit/exports.json).
//   npm run export -- <job> --export tiktok|reels|shorts|feed45|square [--file reel-v2.mp4] [--jobs dir] [--json] [--crop]
// tiktok, reels, shorts: a copy with the platform's length and bitrate caps, reel-vN-<name>.mp4. The layout is only made
// for the platform's safe area when the reel was rendered with it (npm run reel -- ... --export <name>).
// feed45 (4:5, 1080x1350, the Instagram Feed) and square (1:1): a version of its own, reel-vN-feed-4x5.mp4 or
// reel-vN-square-1x1.mp4. The frame follows your face and the captions, titles, graphics and b-roll are laid out again
// inside it (kit/export-frame.cjs), from the build saved beside the reel. --crop makes the old plain crop instead.
// Then check it: npm run verify -- <job> --export <name>
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const req = createRequire(import.meta.url), X = req('./exports.cjs'), R = req('./rules.cjs');
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['export', 'file', 'jobs']);
const JSON_OUT = flag('json');
const die = m => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: m })); else console.error(m); process.exit(1); };
const name = argv.find((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const ex = String(opt('export') || '').toLowerCase();
if (!name || !ex) die('Usage: npm run export -- <job> --export ' + X.NAMES.join('|'));
if (!X.get(ex)) die(`--export must be ${X.NAMES.join(', ')}`);
let job = resolve(opt('jobs', join(ROOT, 'jobs')), name);
if (!existsSync(job) && existsSync(resolve(name))) job = resolve(name);
let file = opt('file');
if (!file) {
  const reels = existsSync(job) ? readdirSync(job).filter(f => /^reel(-fx)?-v\d+\.mp4$/.test(f)).map(f => join(job, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : [];
  if (!reels.length) die('No reel-vN.mp4 in ' + job);
  file = reels[0];
}
file = resolve(file);
const len = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
const p = X.get(ex), out = X.outName(file, ex);
// 4:5 and 1:1 are their own version of the reel: the frame follows your face and everything is laid out again inside
// it (kit/export-frame.cjs). It is made from the build saved beside the reel (reel-vN.build/), else from build/.
const snap = file.replace(/\.mp4$/i, '.build'), build = join(job, 'build');
const srcDir = existsSync(join(snap, 'cut.json')) ? snap : existsSync(join(build, 'cut.json')) ? build : null;
if (X.isReframed(ex) && srcDir && !flag('crop')) {
  const XF = req('./export-frame.cjs');
  // the picture and the person masks still in build/ are reused when build/ is still this reel's edit
  const same = (() => { try { return srcDir === build || XF.picKey(JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8'))) === XF.picKey(JSON.parse(readFileSync(join(snap, 'cut.json'), 'utf8'))); } catch { return false; } })();
  const base = same && existsSync(join(build, 'base.mp4')) && existsSync(join(build, 'facezone.json')) ? join(build, 'base.mp4') : null;
  const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
  let r; try { r = XF.make({ jobDir: job, src: srcDir, name: ex, reel: file, out, base, masks: same ? build : null, python: PY, log: m => (JSON_OUT ? console.error(m) : console.log(m)) }); } catch (e) { die(`Could not make the ${p.label} version: ${String(e.message || e).split('\n')[0]}`); }
  const res = { ok: true, export: ex, label: p.label, use: r.label, file: out, size: r.size, seconds: r.seconds, laidOut: true, reframed: true, window: r.window, layout: r.layout, faceHits: r.faceHits, verify: `npm run verify -- ${basename(job)} --export ${ex}` };
  if (JSON_OUT) console.log(JSON.stringify(res)); else console.log(`export ${ex} (${p.label}): ${out}\nCheck it: ${res.verify}`);
  process.exit(0);
}
const cap = (() => { try { return R.readCaptions(join(job, 'build', 'captions.js')); } catch { return {}; } })();
const laid = !X.isReframed(ex) && cap.exportFrame && cap.exportFrame.name === ex;
if (X.isReframed(ex)) console.warn(`note: no build for this reel, so this is a plain crop from the middle: the frame does not follow the face and nothing is laid out again. Render it with: npm run reel -- --rebuild --name ${basename(job)} --export ${ex}`);
else if (!laid) console.warn(`note: this reel was not laid out for ${ex}, so nothing was moved into its safe area. For that: npm run reel -- --rebuild --name ${basename(job)} --export ${ex}`);
const words = X.wordsOf(cap), end = X.endOf(ex, len, words);
if (len > p.maxSec) console.warn(`note: ${len.toFixed(1)} s is longer than ${p.label} allows (${p.maxSec} s); the export ends at ${end.toFixed(2)} s${end < p.maxSec ? ', after the last word before the limit' : ''}`);
execFileSync('ffmpeg', X.ffmpegArgs(ex, file, out, len, { words }), { stdio: 'inherit' });
const res = { ok: true, export: ex, label: p.label, file: out, size: `${p.w}x${p.h}`, seconds: +end.toFixed(2), laidOut: !!laid, verify: `npm run verify -- ${basename(job)} --export ${ex}` };
if (JSON_OUT) console.log(JSON.stringify(res)); else console.log(`export ${ex} (${p.label}): ${out}\nCheck it: ${res.verify}`);
