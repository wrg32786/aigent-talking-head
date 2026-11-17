// Export a finished reel for one platform: crop (4:5, 1:1), length cap, bitrate cap, faststart (kit/exports.json).
//   npm run export -- <job> --export tiktok|reels|shorts|feed45|square [--file reel-v2.mp4] [--jobs dir] [--json]
// Writes jobs/<job>/reel-vN-<name>.mp4 next to the reel. The layout is only made for an export when the reel was rendered
// with it (npm run reel -- ... --export <name>, or --rebuild --name <job> --export <name>): that keeps every title,
// caption and graphic inside the platform's safe area. Then check it: npm run verify -- <job> --export <name>
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
const cap = (() => { try { return R.readCaptions(join(job, 'build', 'captions.js')); } catch { return {}; } })();
const laid = cap.exportFrame && cap.exportFrame.name === ex;
if (!laid) console.warn(`note: this reel was not laid out for ${ex}, so nothing was moved into its safe area. For that: npm run reel -- --rebuild --name ${basename(job)} --export ${ex}`);
const len = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
const p = X.get(ex), out = X.outName(file, ex);
if (len > p.maxSec) console.warn(`note: ${len.toFixed(1)} s is longer than ${p.label} allows (${p.maxSec} s); the export is trimmed to ${p.maxSec} s`);
execFileSync('ffmpeg', X.ffmpegArgs(ex, file, out, len), { stdio: 'inherit' });
const res = { ok: true, export: ex, label: p.label, file: out, size: `${p.w}x${p.h}`, seconds: +Math.min(len, p.maxSec).toFixed(2), laidOut: laid, verify: `npm run verify -- ${basename(job)} --export ${ex}` };
if (JSON_OUT) console.log(JSON.stringify(res)); else console.log(`export ${ex} (${p.label}): ${out}\nCheck it: ${res.verify}`);
