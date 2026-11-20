// The Cut step's render helpers, run as steps of Studio's "cuts" task (kit/studio/server.mjs):
//   node kit/studio/cut-run.mjs extract --src <video> --ranges 1.2-5.3,7-9.5 --out <file.mp4>
//       the kept time ranges of a take joined into one file (re-encoded, the source frame size). The ranges are cut
//       points from kit/cutpoints.cjs, in quiet, so the 10 ms fades only touch silence
//   node kit/studio/cut-run.mjs long --src <file.mp4> --name <job>
//       a long form (16:9) video: 1920x1080 with the take fitted over a blurred fill, loudness -14 LUFS,
//       written to jobs/<job>/reel-vN.mp4
//   node kit/studio/cut-run.mjs cta --name <job> --text "Learn more" [--sub @handle]
//       a call-to-action end card (graphic cta-card) over the last 3 s of a drafted job's captions.js
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const argv = process.argv.slice(2), cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const die = m => { console.error('error: ' + m); process.exit(1); };
const ff = args => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] }); if (r.error) die('ffmpeg is missing. Fix: npm run setup:all'); if (r.status) die('ffmpeg failed'); };
const hasAudio = f => /audio/.test(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout || '');

if (cmd === 'extract') {
  const src = resolve(ROOT, opt('src', '')), out = resolve(ROOT, opt('out', ''));
  if (!existsSync(src)) die('no such file: ' + opt('src'));
  const ranges = String(opt('ranges', '')).split(',').map(x => x.split('-').map(Number)).filter(([a, b]) => b > a);
  if (!ranges.length) die('--ranges: start-end pairs in seconds, comma separated');
  mkdirSync(dirname(out), { recursive: true });
  const audio = hasAudio(src), parts = [], labels = [];
  ranges.forEach(([a, b], k) => {
    parts.push(`[0:v]trim=${a}:${b},setpts=PTS-STARTPTS[v${k}]`); labels.push(`[v${k}]`);
    if (audio) { parts.push(`[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, b - a - 0.01)}:d=0.01[a${k}]`); labels.push(`[a${k}]`); }
  });
  const graph = parts.join(';') + `;${labels.join('')}concat=n=${ranges.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? '[a]' : ''}`;
  ff(['-i', src, '-filter_complex', graph, '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  console.log(`cut: ${ranges.length} range${ranges.length > 1 ? 's' : ''}, ${ranges.reduce((s, [a, b]) => s + b - a, 0).toFixed(1)} s -> ${opt('out')}`);
} else if (cmd === 'long') {
  const src = resolve(ROOT, opt('src', '')), name = opt('name');
  if (!existsSync(src)) die('no such file: ' + opt('src')); if (!name) die('--name <job>');
  const dir = join(ROOT, 'jobs', name); mkdirSync(dir, { recursive: true });
  const n = 1 + Math.max(0, ...readdirSync(dir).map(f => +(f.match(/^reel-v(\d+)\.mp4$/) || [0, 0])[1]));
  const out = join(dir, `reel-v${n}.mp4`), audio = hasAudio(src);
  const vf = '[0:v]split[a][b];[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=24:2,eq=brightness=-0.08[bg];[b]scale=1920:1080:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]';
  ff(['-i', src, '-filter_complex', vf, '-map', '[v]', ...(audio ? ['-map', '0:a', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30', '-movflags', '+faststart', out]);
  console.log(`long form: jobs/${name}/reel-v${n}.mp4 (1920x1080)`);
} else if (cmd === 'cta') {
  const name = opt('name'), text = String(opt('text', 'Follow for more')).slice(0, 60), sub = opt('sub');
  const build = join(ROOT, 'jobs', String(name), 'build'), capF = join(build, 'captions.js'), cutF = join(build, 'cut.json');
  if (!existsSync(capF) || !existsSync(cutF)) die(`draft jobs/${name} first`);
  const g = {}; new Function('window', readFileSync(capF, 'utf8'))(g); const caps = g.CAPTIONS || { flips: [] };
  const cut = JSON.parse(readFileSync(cutF, 'utf8')), len = (cut.segs || []).reduce((s, x) => s + (x.out - x.in), 0) + (cut.tail || 0);
  // graphics are flips with a mode (kit/graphics.json: cta-card is 22), like the recipe graphics kit/reel.cjs adds
  caps.flips = (caps.flips || []).filter(x => !(x && x.mode === 22 && x.studioCta === true));
  caps.flips.push({ start: +Math.max(0, len - 3.2).toFixed(2), end: +Math.max(0.5, len - 0.15).toFixed(2), mode: 22, text, ...(sub ? { sub } : {}), studioCta: true });
  writeFileSync(capF, 'window.CAPTIONS = ' + JSON.stringify(caps, null, 1) + ';\n');
  console.log(`cta-card: "${text}" at ${(len - 3.2).toFixed(1)} s`);
} else die('use extract, long or cta');
