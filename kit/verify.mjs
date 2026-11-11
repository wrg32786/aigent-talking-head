// Verify a reel before delivery. Mandatory before you hand a reel over.
//   npm run verify -- <job>                 -> newest reel in jobs/<job>/ (reel-fx-vN.mp4 or reel-vN.mp4)
//   npm run verify -- <job> --file x.mp4    -> that file, against the job's cut.json and captions.js
//   options: --jobs <dir>, --fps 24 (expected frame rate; default cut.json "fps" or 24, this kit's format)
// Writes jobs/<job>/verify/: one still per check point and contact.png (all of them), plus report.md.
//   Check points: every kinetic title mid-entrance and settled, the payoff, both big-punch frames, and the first caption.
//   ffprobe: 1080x1920, the frame rate, H.264 + AAC at 48 kHz, duration = the cut's length.
//   Loudness: integrated LUFS and true peak (target -14 LUFS, peak <= -1 dBTP).
//   Mask (when cut.json has one): alpha measured from the mask file at each title, never judged by eye.
//   Copy lint: the same check as `npm run check`.
// Exit 1 on any failure. Then READ every still: titles readable and behind the head only, pills legible, punch frames
// framed, end card clean. A probe proves the file is right; your eye on the stills proves it looks right.
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const R = createRequire(import.meta.url)('./rules.cjs');
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['file', 'jobs', 'fps']);
const name = argv.find((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
if (!name) { console.error('Usage: npm run verify -- <job> [--file reel.mp4]'); process.exit(1); }
let job = resolve(opt('jobs', join(ROOT, 'jobs')), name);
if (!existsSync(job) && existsSync(resolve(name))) job = resolve(name);
const build = join(job, 'build');
if (!existsSync(join(build, 'cut.json'))) { console.error('No ' + join(build, 'cut.json')); process.exit(1); }
const sh = (c, a) => execFileSync(c, a, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).toString();
const stderrOf = (c, a) => String(spawnSync(c, a, { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr || '');

let file = opt('file');
if (!file) {
  const reels = readdirSync(job).filter(f => /^reel(-fx)?-v\d+\.mp4$/.test(f)).map(f => join(job, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!reels.length) { console.error('No reel-vN.mp4 in ' + job); process.exit(1); }
  file = reels[0];
}
file = resolve(file);
const C = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')), TL = R.timeline(C);
const CAP = existsSync(join(build, 'captions.js')) ? R.readCaptions(join(build, 'captions.js')) : { flips: [] };
const FPS = +opt('fps', C.fps || 24);
const notes = [], lines = [];
const ok = (cond, msg) => { lines.push((cond ? 'ok    ' : 'FAIL  ') + msg); return !!cond; };

// 1. ffprobe
const j = JSON.parse(sh('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration', '-of', 'json', file]));
const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
const fr = v ? v.r_frame_rate.split('/').reduce((x, y) => x / y) : 0, dur = +j.format.duration;
ok(v && v.width === 1080 && v.height === 1920, `video ${v ? v.width + 'x' + v.height : 'missing'} (1080x1920)`);
ok(v && Math.abs(fr - FPS) < 0.01, `frame rate ${fr.toFixed(3)} (${FPS})`);
ok(v && v.codec_name === 'h264', `video codec ${v && v.codec_name} (h264)`);
ok(a && a.codec_name === 'aac', `audio codec ${a ? a.codec_name : 'missing'} (aac)`);
ok(a && +a.sample_rate === 48000, `audio ${a ? a.sample_rate : '-'} Hz (48000; some players refuse 96 kHz)`);
ok(Math.abs(dur - TL.total) < 0.15, `duration ${dur.toFixed(2)} s (cut.json says ${TL.total.toFixed(2)} s)`);

// 2. loudness
const ebOut = stderrOf('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
const summ = (ebOut.split('Summary:')[1] || '');
const I = +(summ.match(/I:\s+(-?[0-9.]+) LUFS/) || [])[1], TP = +(summ.match(/Peak:\s+(-?[0-9.]+) dBFS/) || [])[1];
if (Number.isNaN(I)) notes.push('loudness: could not read ebur128 output');
else {
  ok(I > -15.5 && I < -12.5, `loudness ${I.toFixed(1)} LUFS integrated (target -14)`);
  ok(Number.isNaN(TP) || TP <= -0.5, `true peak ${Number.isNaN(TP) ? '?' : TP.toFixed(1)} dBTP (<= -1 target)`);
}

// 3. check points -> stills + contact sheet
const pts = [];
const titles = R.resolveTitles(CAP);
for (const t of titles) {
  const end = Math.min(t.end, TL.total - 0.05);
  // mid-entrance: the first frame 0.12 s or more in that is not a flicker blackout (frames 2,4,5,9,11 of a flicker title)
  let fi = Math.ceil((t.start + 0.12) * FPS); while (t.flicker && [2, 4, 5, 9, 11].includes(Math.floor((fi / FPS - t.start) * 24 + 1e-6))) fi++;
  pts.push([fi / FPS, `${t.role} title mid ${t.entrance}`]);
  pts.push([Math.min(end - 0.04, t.start + R.TITLE_ENTER + 0.2), `${t.role} title settled`]);
}
const firstCap = (CAP.flips || []).filter(f => f.mode === 0).sort((x, y) => x.start - y.start)[0];
if (firstCap) pts.push([firstCap.start + Math.min(0.5, (firstCap.end - firstCap.start) / 2), `caption (${firstCap.style || CAP.captionStyle || 'classic'})`]);
if (!titles.length) {
  const last = (CAP.flips || []).slice().sort((x, y) => y.start - x.start)[0];
  pts.push([last ? Math.min(TL.total - 0.1, last.start + 0.6) : TL.total - 0.5, 'payoff']);
}
TL.segs.forEach(s => { if (s.s.bigPunch) pts.push([s.start + R.PUNCH.bigDur + 0.05, `big punch seg ${s.i}`]); }); // pushed in, past the glitch seam
if (!TL.segs.some(s => s.s.bigPunch) && TL.seams.length) pts.push([TL.seams[0] + 0.1, 'first cut']);
pts.sort((x, y) => x[0] - y[0]);
const vdir = join(job, 'verify'); rmSync(vdir, { recursive: true, force: true }); mkdirSync(vdir, { recursive: true });
const stills = [];
pts.forEach(([t, label], k) => {
  t = Math.max(0, Math.min(dur - 3 / FPS, Math.round(t * FPS) / FPS)); // snap to a frame so -ss lands on it
  const p = join(vdir, `${String(k + 1).padStart(2, '0')}-${t.toFixed(2)}s-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
  const lab = `${t.toFixed(2)}s ${label}`.replace(/[:'\\]/g, ' ');
  try { sh('ffmpeg', ['-v', 'error', '-y', '-ss', Math.max(0, t - 0.005).toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=360:640,drawtext=text='${lab}':x=10:y=10:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6`, p]); }
  catch { sh('ffmpeg', ['-v', 'error', '-y', '-ss', Math.max(0, t - 0.005).toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=360:640', p]); }
  if (existsSync(p)) stills.push({ t, label, file: p }); else notes.push(`no frame at ${t.toFixed(2)} s (${label})`);
});
if (stills.length) {
  const cols = Math.min(4, stills.length), rows = Math.ceil(stills.length / cols);
  const ins = stills.flatMap(s => ['-i', s.file]);
  const layout = stills.map((_, k) => `${(k % cols) * 360}_${Math.floor(k / cols) * 640}`).join('|');
  sh('ffmpeg', ['-v', 'error', '-y', ...ins, '-filter_complex', stills.length > 1 ? `xstack=inputs=${stills.length}:layout=${layout}:fill=black` : 'null', join(vdir, 'contact.png')]);
  lines.push(`ok    ${stills.length} stills + contact.png (${cols}x${rows}) in ${vdir}`);
}

// 4. mask, measured
const mask = R.maskSpec(C);
if (C.titles && mask.file) {
  const mf = join(build, mask.file);
  if (!existsSync(mf)) notes.push(`no mask file (${mask.file}): titles are in front of the speaker. npm run effects:setup, then rebuild.`);
  else {
    if (mask.model) lines.push(`ok    mask model ${mask.model}`);
    for (const t of titles) {
    const tm = Math.min(t.start + R.TITLE_ENTER + 0.2, t.end - 0.05);
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', tm.toFixed(3), '-i', mf, '-frames:v', '1', '-vf', 'scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    let on = 0, sum = 0, band = 0, bn = 0; const y0 = Math.round(480 * 0.22), y1 = Math.round(480 * 0.36);
    for (let k = 0; k < buf.length; k++) { const x = buf[k]; sum += x; if (x > 127) on++; const y = Math.floor(k / 270); if (y >= y0 && y < y1) { band += x; bn++; } }
    const cov = on / buf.length, bandA = band / Math.max(1, bn) / 255;
    const good = cov > 0.02 && cov < 0.85;
    if (!good) notes.push(`mask at ${tm.toFixed(2)}s: coverage ${(cov * 100).toFixed(1)}%: no clear person, so the title shows in front there. Check the still.`);
    lines.push(`${good ? 'ok    ' : 'note  '}mask at title ${tm.toFixed(2)}s: alpha coverage ${(cov * 100).toFixed(1)}%, mean ${(sum / buf.length / 255).toFixed(3)}, title band ${bandA.toFixed(3)}`);
  }
  if (existsSync(mf)) {
    const off = TL.total > 0.5 ? [0.05].filter(x => !titles.some(t => x >= t.start - 0.1 && x <= t.end + 0.1)) : [];
    for (const tm of off) { const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(tm), '-i', mf, '-frames:v', '1', '-vf', 'scale=90:160', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']); ok(b.every(x => x <= 8), `mask is empty outside the title windows (t=${tm}s, max alpha ${Math.max(...b)})`); }
    }
  }
}

// 5. copy lint
try { const o = sh(process.execPath, [join(KIT, 'check.mjs'), build]); lines.push('ok    copy and plan check'); o.split('\n').filter(l => /note:/.test(l)).forEach(l => notes.push(l.trim().replace(/^note:\s*/, ''))); }
catch (e) { const o = String(e.stdout || ''); lines.push('FAIL  copy and plan check'); o.split('\n').filter(l => /error:/.test(l)).forEach(l => lines.push('      ' + l.trim())); }

const report = [`# verify ${basename(file)}`, '', ...lines.map(l => '    ' + l), '', ...(notes.length ? ['Notes:', ...notes.map(n => '- ' + n), ''] : []),
  'Stills (read every one: titles readable and behind the head only, pills legible, punch frames framed, end card clean):', ...stills.map(s => `- ${s.t.toFixed(2)} s ${s.label}: ${basename(s.file)}`), ''];
writeFileSync(join(vdir, 'report.md'), report.join('\n'));
console.log(report.join('\n'));
const nf = lines.filter(l => l.startsWith('FAIL')).length;
console.log(nf ? `VERIFY FAIL (${nf})` : `VERIFY PASS  ${join(vdir, 'contact.png')}`);
process.exitCode = nf ? 1 : 0;
