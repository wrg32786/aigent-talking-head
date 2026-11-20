// Overlay render bench: times kit/render.mjs on a representative 1080x1920 reel with each frame capture, checks the
// frames match pixel for pixel, and (with --assemble) times assemble.cjs on synthetic footage with a person mask.
//   node kit/render-bench.mjs [--seconds 30] [--out <dir>] [--assemble] [--captures screenshot,auto] [--json <file>]
// The reel (the Awakening hero captions from kit/example, plus a behind-head title, a front title, a lower third, a stat
// callout, a screen card and a versus card behind the head, a logo plate, glitch, bursts and a face track) uses the
// front, title and panel layers. Each capture renders into its own folder under --out (default: the system temp folder).
// It also prints whether this Chrome can encode video with alpha through WebCodecs (it could not when this was written).
import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, copyFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import os from 'os';
import { chromium } from 'playwright-core';
import { findChrome } from './chrome.mjs';

const KIT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; }, flag = k => argv.includes('--' + k);
const SEC = +opt('seconds', 30), OUT = resolve(opt('out', join(os.tmpdir(), 'th-render-bench'))), CAPS = opt('captures', 'screenshot,auto').split(',');
const ms = t => Date.now() - t, s1 = n => (n / 1000).toFixed(1) + ' s';

// the representative reel
function fixture(dir) {
  mkdirSync(dir, { recursive: true });
  const g = {}; new Function('window', readFileSync(join(KIT, 'example', 'captions.awakening-hero.js'), 'utf8'))(g);
  const C = g.CAPTIONS, cap = x => Math.min(x, SEC);
  copyFileSync(join(KIT, 'example', 'skool-logo.svg'), join(dir, 'skool-logo.svg'));
  const flips = C.flips.filter(f => f.end <= SEC || f.end >= 90);
  const at = (a, b, f) => { if (b <= SEC) flips.push({ start: a, end: b, ...f }); };
  at(6.2, 8.4, { text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' });
  at(14, 16, { text: 'Ship it today', mode: 7, hero: [1], entrance: 'pop-zoom', flicker: false });
  at(9, 12, { mode: 12, text: 'Will Gwyn', sub: 'Founder, AIgent' });
  at(17, 19.5, { mode: 13, text: '10,000', style: 'odometer' });
  at(20, 23, { mode: 11, layer: 'behind' });
  at(24, 26, { mode: 18, left: 'Manual', right: 'Agent', layer: 'behind' });
  if (!flips.some(f => f.layer === 'behind')) flips.push({ start: 0.2, end: cap(1.6), text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' }, { start: 0.3, end: cap(1.8), mode: 11, layer: 'behind' });
  const zone = [300, 520, 780, 1060, 440];
  writeFileSync(join(dir, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ ...C, flips, faceTrack: { fps: 8, size: [1080, 1920], zones: Array(Math.ceil(SEC * 8)).fill(zone) } }, null, 1) + ';\n');
}
// one md5 per decoded RGBA frame of a numbered PNG folder
const md5s = dir => existsSync(dir) ? execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, '%04d.png'), '-pix_fmt', 'rgba', '-f', 'framemd5', '-'], { maxBuffer: 1 << 28 }).toString().split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').pop().trim()) : [];

async function webcodecsAlpha() {
  const b = await chromium.launch({ executablePath: findChrome() });
  try {
    const p = await b.newPage(), f = join(OUT, 'probe.html'); writeFileSync(f, '<!doctype html><title>probe</title>');
    await p.goto(pathToFileURL(f).href); // WebCodecs needs a secure context; a file page is one, about:blank is not
    const r = await p.evaluate(async () => { const out = {}; if (typeof VideoEncoder === 'undefined') return { webcodecs: false };
      for (const [k, codec] of [['vp8', 'vp8'], ['vp9', 'vp09.00.10.08'], ['av1', 'av01.0.08M.08'], ['h264', 'avc1.640033']]) { try { out[k] = (await VideoEncoder.isConfigSupported({ codec, width: 1080, height: 1920, alpha: 'keep', bitrate: 2e7, framerate: 24 })).supported } catch { out[k] = false } }
      try { out.vp9WithoutAlpha = (await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 1080, height: 1920, bitrate: 2e7, framerate: 24 })).supported } catch { out.vp9WithoutAlpha = false }
      return out; });
    return { chrome: b.version(), ...r };
  } finally { await b.close(); }
}

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const res = { seconds: SEC, size: '1080x1920', fps: 24, machine: { cpu: (os.cpus()[0] || {}).model, threads: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), platform: `${os.platform()} ${os.release()}` }, runs: {} };
res.webcodecsAlpha = await webcodecsAlpha();
console.log(`machine: ${res.machine.cpu}, ${res.machine.threads} threads, ${res.machine.ramGB} GB, ${res.machine.platform}`);
console.log('WebCodecs alpha encode (alpha: keep):', JSON.stringify(res.webcodecsAlpha));
if (flag('assemble')) {
  const L = SEC.toFixed(2);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=1080x1920:r=30:d=${L}`, '-f', 'lavfi', '-i', `sine=f=220:d=${L}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(OUT, 'src.mp4')]);
  for (const [n, box] of [['mask.mkv', '240:500:600:1420'], ['maskhead.mkv', '340:400:400:300']]) { const [x, y, w, h] = box.split(':'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=black:s=1080x1920:r=24:d=${L}`, '-vf', `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=white:t=fill`, '-c:v', 'ffv1', '-pix_fmt', 'gray', join(OUT, n)]); }
}
for (const c of CAPS) {
  const dir = join(OUT, c); fixture(dir);
  const t = Date.now(), r = spawnSync(process.execPath, [join(KIT, 'render.mjs'), SEC.toFixed(2)], { cwd: dir, env: { ...process.env, RENDER_CAPTURE: c, THEME: 'aigent' }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  const run = { renderMs: ms(t), capture: ((r.stdout + r.stderr).match(/^capture: .*$/m) || [''])[0], layers: ['ovl', 'ovlt', 'ovlp'].filter(d => existsSync(join(dir, d))) };
  run.frames = run.layers.reduce((n, d) => n + readdirSync(join(dir, d)).length, 0);
  run.captureMs = Math.round(1000 * +(run.capture.match(/in ([\d.]+) s/) || [0, 0])[1]);
  if (flag('assemble')) {
    writeFileSync(join(dir, 'cut.json'), JSON.stringify({ segs: [{ file: join(OUT, 'src.mp4'), in: 0, out: +(SEC - 0.3).toFixed(2) }], tail: 0.3, overlay: 'ovl/%04d.png', titles: 'ovlt/%04d.png', mask: join(OUT, 'mask.mkv'), panels: 'ovlp/%04d.png', headMask: join(OUT, 'maskhead.mkv') }));
    const ta = Date.now(); execFileSync(process.execPath, [join(KIT, 'assemble.cjs'), 'out.mp4'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] }); run.assembleMs = ms(ta);
  }
  res.runs[c] = run;
  console.log(`${c}: render ${s1(run.renderMs)} (frame capture ${s1(run.captureMs)}, ${run.frames} frames in ${run.layers.join(' + ')})${run.assembleMs ? `, assemble ${s1(run.assembleMs)}, reel ${s1(run.renderMs + run.assembleMs)}` : ''}`);
}
// the frames must match the first capture pixel for pixel
const [base, ...rest] = CAPS;
const ssim = (fa, fb) => { const r = spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'color=gray:s=1080x1920', '-i', fa, '-i', fb, '-filter_complex', '[0]split[g1][g2];[g1][1]overlay[A];[g2][2]overlay[B];[A][B]ssim', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' }); return +((r.stderr.match(/All:([\d.]+)/) || [0, 0])[1]); };
for (const c of rest) {
  let same = 0, n = 0, low = 1, near = 0;
  for (const d of res.runs[base].layers) {
    const a = md5s(join(OUT, base, d)), b = md5s(join(OUT, c, d)); n += a.length;
    if (a.length !== b.length) { console.log(`${d}: ${a.length} frames with ${base}, ${b.length} with ${c}`); low = 0; }
    a.forEach((h, k) => { if (h === b[k]) return same++; const f = String(k).padStart(4, '0') + '.png'; const s = ssim(join(OUT, base, d, f), join(OUT, c, d, f)); low = Math.min(low, s); near++; });
  }
  Object.assign(res.runs[c], { identical: `${same}/${n}`, minSsim: near ? low : 1 });
  const sp = res.runs[base].renderMs / res.runs[c].renderMs;
  console.log(`${c} vs ${base}: ${same} of ${n} frames identical${near ? `, ${near} not identical with SSIM ${low.toFixed(4)} or more (composited over grey)` : ''}; render ${sp.toFixed(1)}x faster${res.runs[c].assembleMs ? `, whole reel ${((res.runs[base].renderMs + res.runs[base].assembleMs) / (res.runs[c].renderMs + res.runs[c].assembleMs)).toFixed(1)}x` : ''}`);
  if (res.runs[c].assembleMs) { const o = spawnSync('ffmpeg', ['-i', join(OUT, base, 'out.mp4'), '-i', join(OUT, c, 'out.mp4'), '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' }); const m = o.stderr.match(/All:([\d.]+)/); if (m) { res.runs[c].reelSsim = +m[1]; console.log(`finished reels: SSIM ${m[1]} (the film grain is random per render, so the two reels are never bit identical)`); } }
  if (low < 0.995) process.exitCode = 1;
}
if (opt('json')) writeFileSync(resolve(opt('json')), JSON.stringify(res, null, 1) + '\n');
