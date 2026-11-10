// Add tracks to the music bed library, or list it.
//   npm run music:add -- "C:/path/Vinyl Sunrise.wav" ["other.wav" ...]   -> kit/music/<name>.mp3 + an entry in beds.json
//   npm run music                                                     -> list the library
// Every bed is loudness-matched to -13 LUFS integrated (two-pass ffmpeg loudnorm, linear gain, true peak under
// -1.5 dB) and stored as 256 kbps 48 kHz stereo MP3, so one bedVol (0.16) fits every track. Suno's "made with suno"
// tag is kept as the source record (song id and creation time).
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));
const CAT = join(DIR, 'beds.json');
const TARGET = -13, TP = -1.5;
const beds = existsSync(CAT) ? JSON.parse(readFileSync(CAT, 'utf8')) : {};
const files = process.argv.slice(2);

// ffmpeg writes its log, and loudnorm its JSON measurement, to stderr
const ff = args => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr || `ffmpeg exited ${r.status}`);
  return r.stderr;
};
const measure = file => {
  const m = ff(['-i', file, '-af', `loudnorm=I=${TARGET}:TP=${TP}:LRA=20:print_format=json`, '-f', 'null', '-']).match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) throw new Error(`no loudnorm measurement for ${file}`);
  return JSON.parse(m[0]);
};
const tags = file => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', file], { encoding: 'utf8' });
  const f = JSON.parse(out).format; return { seconds: +(+f.duration).toFixed(1), comment: (f.tags || {}).comment || '' };
};
const slug = s => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!files.length) {
  const rows = Object.entries(beds);
  if (!rows.length) { console.log('No beds yet. Add one: npm run music:add -- <file.wav>'); process.exit(0); }
  for (const [k, b] of rows) console.log(`${k.padEnd(24)} ${String(b.seconds).padStart(6)} s  ${b.title}`);
  process.exit(0);
}

for (const src of files) {
  if (!existsSync(src)) { console.error(`not found: ${src}`); process.exit(1); }
  const title = basename(src, extname(src)), name = slug(title), out = join(DIR, `${name}.mp3`);
  const t = tags(src), m = measure(src);
  const suno = /made with suno/i.test(t.comment);
  const id = (t.comment.match(/id=([0-9a-f-]{36})/i) || [])[1], made = (t.comment.match(/created=([0-9T:-]+Z)/) || [])[1];
  const ln = `loudnorm=I=${TARGET}:TP=${TP}:LRA=20:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  ff(['-y', '-i', src, '-map_metadata', '-1', '-af', `${ln},aresample=48000`, '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '256k',
    '-metadata', `title=${title}`, ...(t.comment ? ['-metadata', `comment=${t.comment}`] : []), out]);
  // self-check: the stored file really sits at the target, or the shared bedVol is wrong for it
  const got = measure(out);
  if (Math.abs(+got.input_i - TARGET) > 1) { console.error(`${name}: measured ${got.input_i} LUFS after conversion, want ${TARGET} +/- 1`); process.exit(1); }
  beds[name] = { title, file: `${name}.mp3`, seconds: t.seconds, lufs: +(+got.input_i).toFixed(1), source: suno ? 'Suno' : 'own', ...(id ? { suno_id: id } : {}), ...(made ? { made } : {}) };
  console.log(`${name}: ${t.seconds} s, ${m.input_i} -> ${got.input_i} LUFS`);
}
writeFileSync(CAT, JSON.stringify(Object.fromEntries(Object.entries(beds).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
console.log(`beds.json: ${Object.keys(beds).length} beds`);
