// Fast run: a handful of clips, pictures or captured sites cut one after another on the beat, as ONE piece of B-roll.
// The reference trick it stands for: a run of very fast cuts (five cuts 0.21 s apart) over one line of speech.
//
// Each item is shown whole: the picture fitted inside the frame, sharp, over a blurred, larger copy of itself, with a
// short push in. Nothing is cropped away, so a wide website reads as a website in an upright or split frame.
//
// Two ways in:
//   cut.json  "inserts": [{ "run": ["../broll/a.png", "../broll/b.mp4", ...], "at": 12.3, "step": "half", "place": "top" }]
//             kit/reel.cjs makes the clip on every build (resolve, below): the run starts on the bed's beat nearest
//             "at" and each item lasts one beat ("beat") or half a beat ("half", the default); a number is seconds.
//             With no bed it uses 0.25 s (half) or 0.5 s (beat). The insert then plays like any other, as one insert.
//   Studio    the B-roll step's Fast run picks N library clips and makes one library clip (kit/studio/broll-api.mjs).
//
//   node kit/fastrun.cjs <out.mp4> <file> <file> ... [--step 0.21] [--size 1080x960]
//
// wholeFit() is also what kit/assemble.cjs uses for "fit": "whole" on any insert (a wide clip in the split panel).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const FPS = 24, MIN_STEP = 0.125, MAX_ITEMS = 40;
const STEP_FALLBACK = { half: 0.25, beat: 0.5 };
const IMAGE = /\.(jpe?g|png|webp)$/i;
const even = x => Math.max(2, Math.round(x / 2) * 2);
const r3 = x => +(+x).toFixed(3);

// The filter steps that turn one stream into a W x H picture with the source whole and sharp over its own blur.
// inLabel / outLabel are filter labels without brackets; tag keeps the inner labels unique. inset: the share of the
// frame the sharp picture may fill (0.94 leaves room for a push in that never crops it).
function wholeFit(inLabel, outLabel, W, H, tag, { inset = 1, dim = 0.07 } = {}) {
  const iw = even(W * inset), ih = even(H * inset);
  return [
    `[${inLabel}]split[wfa${tag}][wfb${tag}]`,
    // the blurred copy is made small first: a soft blur costs little there and scales up clean
    `[wfa${tag}]scale=${even(W / 4)}:${even(H / 4)}:force_original_aspect_ratio=increase,crop=${even(W / 4)}:${even(H / 4)},boxblur=10:2,scale=${W}:${H},eq=brightness=-${dim}:saturation=0.9[wfg${tag}]`,
    `[wfb${tag}]scale=${iw}:${ih}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[wff${tag}]`,
    `[wfg${tag}][wff${tag}]overlay=(W-w)/2:(H-h)/2,setsar=1[${outLabel}]`,
  ];
}
// how much of a w x h source a W x H frame would crop away if it were made to fill it (0: the same shape)
function cropLoss(w, h, W, H) {
  if (!(w > 0 && h > 0 && W > 0 && H > 0)) return 0;
  const a = w / h, b = W / H;
  return +(1 - Math.min(a / b, b / a)).toFixed(3);
}
// "whole" or "fill" for an insert: what it asks for, else whole in a framed panel when filling it would crop more
// than a fifth of the picture away. The render asks this for every place but the split panel (place top), which
// kit/assemble.cjs draws by kit/split.cjs fitOf; the top rule here is kept for callers that have only this file.
const WHOLE_OVER = 0.2;
function fitFor(insert, src, W, H) {
  const f = String(insert.fit || '').toLowerCase();
  if (f === 'whole' || f === 'fill') return f;
  if (insert.run) return 'whole';
  if (!['top', 'frame'].includes(insert.place) || !src) return 'fill';
  return cropLoss(src.w, src.h, W, H) > WHOLE_OVER ? 'whole' : 'fill';
}
function sizeOf(file) {
  try { const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/[,\n]/).map(Number); return w > 0 && h > 0 ? { w, h } : null; } catch { return null; }
}
function secondsOf(file) {
  try { return +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 0; } catch { return 0; }
}

// ---------- when each item plays ----------
// the beat times a run can cut on: the bed's beats, and for "half" the middle of each pair too
function gridPoints(grid, step) {
  const b = ((grid && grid.beats) || []).map(Number).filter(Number.isFinite).sort((p, q) => p - q);
  if (b.length < 2) return [];
  if (step !== 'half') return b;
  const out = []; b.forEach((t, i) => { out.push(t); if (i + 1 < b.length) out.push((t + b[i + 1]) / 2); });
  return out;
}
// { at, durs, cuts, onBeat }: where the run starts and how long each of its n items plays.
// step: "half" | "beat" | seconds.  With a beat grid the start snaps to the nearest point and every cut is a point.
function schedule({ n, at, step = 'half', grid = null, max = null }) {
  const N = Math.max(1, Math.min(MAX_ITEMS, n | 0)), fixed = Number.isFinite(+step) && +step > 0 ? Math.max(MIN_STEP, +step) : null;
  const pts = fixed ? [] : gridPoints(grid, step === 'beat' ? 'beat' : 'half');
  let start = +at || 0, durs = null, onBeat = false;
  if (pts.length) {
    let k = 0; pts.forEach((t, i) => { if (Math.abs(t - start) < Math.abs(pts[k] - start)) k = i; });
    const own = pts.slice(k, k + N + 1), gap = pts.length > 1 ? (pts[pts.length - 1] - pts[0]) / (pts.length - 1) : STEP_FALLBACK.half;
    // past the last beat the music still runs: carry on at the same pace
    while (own.length < N + 1) own.push(own[own.length - 1] + gap);
    start = own[0]; durs = own.slice(1).map((t, i) => t - own[i]); onBeat = true;
  } else { const s = fixed || STEP_FALLBACK[step === 'beat' ? 'beat' : 'half']; durs = Array(N).fill(s); }
  // whole frames, and no step shorter than 3 frames. Each CUT is put on its nearest frame (not each length), so a
  // half beat of 7.25 frames does not drift off the beat over a long run: the steps come out 7, 7, 8, 7 frames.
  { let t = 0, f0 = 0; durs = durs.map(d => { t += d; const f1 = Math.max(f0 + Math.round(MIN_STEP * FPS), Math.round(t * FPS)), n = f1 - f0; f0 = f1; return n / FPS; }); }
  if (max != null) { let t = 0; durs = durs.filter(d => (t += d) <= +max + 1e-6); if (!durs.length) durs = [Math.max(MIN_STEP, Math.round(+max * FPS) / FPS)]; }
  let t = 0; const cuts = durs.map(d => { const c = r3(t); t += d; return c; });
  return { at: r3(start), durs: durs.map(d => +d.toFixed(4)), dur: r3(t), cuts, onBeat };
}

// ---------- making the clip ----------
// items: files (videos or pictures), durs: seconds each plays. One W x H mp4, no sound.
function make({ items, durs, out, size = [1080, 1920], push = 0.06 }) {
  const [W, H] = size.map(even);
  if (!items || !items.length) throw new Error('a fast run needs at least one clip or picture');
  for (const f of items) if (!fs.existsSync(f)) throw new Error(`fast run: no such file ${f}`);
  const args = ['-v', 'error', '-y'], f = [];
  items.forEach((file, k) => {
    const d = +durs[k % durs.length], n = Math.max(1, Math.round(d * FPS)), still = IMAGE.test(file);
    if (still) args.push('-loop', '1', '-framerate', String(FPS), '-t', (d + 0.2).toFixed(3), '-i', file);
    else {
      // a clip shorter than its step holds its last frame; a long one plays from a third in, where a screen recording has settled
      const len = secondsOf(file), ss = len > d * 3 ? Math.min(len - d - 0.1, len / 3) : 0;
      args.push('-ss', ss.toFixed(3), '-t', (d + 0.5).toFixed(3), '-i', file);
    }
    f.push(`[${k}:v]fps=${FPS},format=yuv420p,setsar=1${still ? '' : `,tpad=stop_mode=clone:stop_duration=${(d + 0.5).toFixed(3)}`},trim=0:${(d + 0.1).toFixed(3)},setpts=PTS-STARTPTS[fr${k}]`,
      ...wholeFit(`fr${k}`, `fw${k}`, W, H, `r${k}`, { inset: 1 / (1 + push) }),
      // a short push in: the sharp picture grows to fill its room over the item's span and is never cropped
      `[fw${k}]scale=${W * 2}:${H * 2},zoompan=z='1+${push}*min(on/${Math.max(1, n - 1)},1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},trim=end_frame=${n},setpts=PTS-STARTPTS,setsar=1[fi${k}]`);
  });
  f.push(`${items.map((_, k) => `[fi${k}]`).join('')}concat=n=${items.length}:v=1:a=0,format=yuv420p[v]`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  args.push('-filter_complex', f.join(';'), '-map', '[v]', '-an', '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return { file: out, seconds: r3(durs.slice(0, items.length).reduce((a, d) => a + Math.round(+d * FPS) / FPS, 0)), items: items.length, size: [W, H] };
}

// the size a run is made at for where it will play: the split panel is about half the frame, a small box is 16:9
const SIZE_FOR = { full: [1080, 1920], top: [1080, 960], frame: [960, 640], pip: [920, 518], card: [1280, 720] };

// cut.json inserts with "run": make each run's clip in build/runs/ and set file, at, dur and in on the insert, so
// kit/assemble.cjs plays it as one insert. grid: build/beat-grid.json or null. Returns the lines for the build log.
function resolve(cut, build, grid = null) {
  const lines = [];
  for (const ins of (cut && cut.inserts) || []) {
    if (!Array.isArray(ins.run) || !ins.run.length) continue;
    const items = ins.run.slice(0, MAX_ITEMS).map(x => path.resolve(build, String(x)));
    const miss = items.filter(x => !fs.existsSync(x));
    if (miss.length) { lines.push(`fast run at ${ins.at} s: ${miss.length} of its ${items.length} files are missing (${miss.map(x => path.basename(x)).join(', ')}), left out of this build`); ins.skip = true; continue; }
    delete ins.skip;
    const want = ins.runAt != null ? +ins.runAt : +ins.at;
    const sc = schedule({ n: items.length, at: want, step: ins.step == null ? 'half' : ins.step, grid, max: ins.max });
    const size = SIZE_FOR[ins.place] || SIZE_FOR.full, shown = items.slice(0, sc.durs.length);
    const key = crypto.createHash('sha1').update(JSON.stringify([shown.map(x => [x, fs.statSync(x).size, fs.statSync(x).mtimeMs]), sc.durs, size])).digest('hex').slice(0, 12);
    const rel = `runs/run-${key}.mp4`, out = path.join(build, rel);
    if (!fs.existsSync(out)) make({ items: shown, durs: sc.durs, out, size });
    // runAt keeps where you asked for it, so a new bed moves the run to its own beat and not further each build
    Object.assign(ins, { file: rel, runAt: r3(want), at: sc.at, dur: sc.dur, in: 0, cuts: sc.cuts, fit: ins.fit || 'whole' });
    delete ins.image;
    const each = sc.durs.length ? (sc.dur / sc.durs.length).toFixed(2) : '0';
    lines.push(`fast run: ${shown.length} cuts from ${sc.at} s, one every ${each} s ${sc.onBeat ? `on the bed's ${ins.step === 'beat' ? 'beats' : 'half beats'}` : '(no bed to follow)'}, ${sc.dur} s as one insert (${ins.place || 'full'})${shown.length < items.length ? `; ${items.length - shown.length} did not fit the length given` : ''}`);
  }
  return lines;
}

module.exports = { wholeFit, cropLoss, fitFor, sizeOf, schedule, gridPoints, make, resolve, SIZE_FOR, STEP_FALLBACK, WHOLE_OVER, MAX_ITEMS, FPS };

if (require.main === module) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i && a[i - 1].startsWith('--')));
  if (pos.length < 2) { console.error('usage: node kit/fastrun.cjs <out.mp4> <file> <file> ... [--step 0.21] [--size 1080x960]'); process.exit(2); }
  const size = (opt('size') || '1080x1920').split('x').map(Number), step = +opt('step') || STEP_FALLBACK.half;
  const sc = schedule({ n: pos.length - 1, at: 0, step });
  console.log(JSON.stringify(make({ items: pos.slice(1).map(x => path.resolve(x)), durs: sc.durs, out: path.resolve(pos[0]), size })));
}
