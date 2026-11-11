// Add tracks to the music bed library, or list it.
//   npm run music:add -- "C:/path/Vinyl Sunrise.wav" ["other.wav" ...]   -> kit/music/<name>.mp3 + an entry in beds.json
//   npm run music                                                     -> list the library
// A name already in the library is refused; --replace overwrites that bed. Nothing is written until a track has
// converted and passed its loudness check.
// Every bed is loudness-matched to -13 LUFS integrated (two-pass ffmpeg loudnorm, linear gain, true peak under
// -1.5 dB) and stored as 256 kbps 48 kHz stereo MP3, so one bedVol (0.16) fits every track. Suno's "made with suno"
// tag is kept as the source record (song id and creation time).
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));
const CAT = join(DIR, 'beds.json');
const TARGET = -13, TP = -1.5;
const beds = existsSync(CAT) ? JSON.parse(readFileSync(CAT, 'utf8')) : {};
const REPLACE = process.argv.includes('--replace');
const files = process.argv.slice(2).filter(a => a !== '--replace');
const die = m => { console.error(m); process.exit(1); };

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

// Check every input before converting any, so a bad file later in the list can't leave a half-done import.
const jobs = files.map(src => {
  if (!existsSync(src)) die(`not found: ${src}`);
  const title = basename(src, extname(src)), name = slug(title);
  if (!name) die(`"${basename(src)}": no letters or digits to make a bed name from. Rename the file.`);
  return { src, title, name, out: join(DIR, `${name}.mp3`) };
});
jobs.forEach((j, i) => {
  if (jobs.findIndex(k => k.name === j.name) !== i) die(`two of these files make the same bed name "${j.name}". Rename one.`);
  if (!REPLACE && (Object.hasOwn(beds, j.name) || existsSync(j.out))) die(`"${j.name}" is already in the library. Rename the file, or pass --replace to overwrite that bed.`);
});

const save = () => writeFileSync(CAT, JSON.stringify(Object.fromEntries(Object.entries(beds).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
for (const { src, title, name, out } of jobs) {
  // Convert beside the library, check the result, then swap it in. The stored bed and beds.json change together,
  // one bed at a time; a failure leaves both as they were.
  const tmp = join(DIR, `.${name}.tmp.mp3`);
  try {
    const t = tags(src), m = measure(src);
    if (!Number.isFinite(+m.input_i)) throw new Error('no measurable loudness (is the file silent?)');
    const suno = /made with suno/i.test(t.comment);
    const id = (t.comment.match(/id=([0-9a-f-]{36})/i) || [])[1], made = (t.comment.match(/created=([0-9T:-]+Z)/) || [])[1];
    const ln = `loudnorm=I=${TARGET}:TP=${TP}:LRA=20:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    ff(['-y', '-i', src, '-map_metadata', '-1', '-af', `${ln},aresample=48000`, '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '256k',
      '-metadata', `title=${title}`, ...(t.comment ? ['-metadata', `comment=${t.comment}`] : []), tmp]);
    // self-check: the converted file really sits at the target, or the shared bedVol is wrong for it
    const got = measure(tmp);
    if (Math.abs(+got.input_i - TARGET) > 1) throw new Error(`${name}: measured ${got.input_i} LUFS after conversion, want ${TARGET} +/- 1`);
    renameSync(tmp, out);
    beds[name] = { title, file: `${name}.mp3`, seconds: t.seconds, lufs: +(+got.input_i).toFixed(1), source: suno ? 'Suno' : 'own', ...(id ? { suno_id: id } : {}), ...(made ? { made } : {}) };
    save();
    console.log(`${name}: ${t.seconds} s, ${m.input_i} -> ${got.input_i} LUFS`);
  } catch (e) { rmSync(tmp, { force: true }); die(`${name}: not added. ${e.message}`); }
}
console.log(`beds.json: ${Object.keys(beds).length} beds`);
