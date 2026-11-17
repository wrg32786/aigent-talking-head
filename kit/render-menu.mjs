// Animated previews for the effects menu (docs/effects.md): one looping GIF per transition, title entrance, caption
// entrance and caption style, each with its name burned in, plus an animated grid and a still contact sheet per section.
//   npm run menu:render                    everything (needs ffmpeg and Chrome)
//   npm run menu:render -- --only titles   one section: transitions, titles, caption-entrances, caption-styles
//   npm run menu:render -- --docs-only     rewrite docs/effects.md from the menu without rendering
// Everything comes from the kit itself: transitions run through the same xfade options as kit/assemble.cjs (kit/xfx.cjs
// for the drawn ones), and titles and captions are drawn by kit/overlay.html through kit/render.mjs. The picture is
// showcase/source/presenter.jpg (an AI-generated fictional presenter made for this project) and a plain gradient plate.
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadMenu } from './menu.mjs';
import { writeEffectsDoc } from './effects-doc.mjs';

const require = createRequire(import.meta.url);
const XFX = require('./xfx.cjs');
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const OUT = join(ROOT, 'docs', 'menu');
const PRESENTER = join(ROOT, 'showcase', 'source', 'presenter.jpg');
const MONO = join(KIT, 'fonts', 'JetBrainsMono-VF.ttf');
const ANTON = join(KIT, 'fonts', 'Anton-Regular.ttf');
const W = 240, H = 426, FPS = 15, ACCENT = '#5cf9e2';
const argv = process.argv.slice(2);
const opt = n => { const i = argv.lastIndexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const ONLY = opt('only');
const SECTIONS = ['transitions', 'titles', 'caption-entrances', 'caption-styles'];
if (ONLY && !SECTIONS.includes(ONLY)) { console.error(`--only takes one of ${SECTIONS.join(', ')}`); process.exit(1); }
const want = s => !ONLY || ONLY === s;

function sh(cmd, args, opts = {}) {
  try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }
  catch (e) { throw new Error([e.message, e.stderr && e.stderr.toString()].filter(Boolean).join('\n')); }
}
const ff = args => sh('ffmpeg', ['-v', 'error', '-y', ...args]);
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
// the name, small, on a dark bar along the bottom
const label = name => `drawbox=x=0:y=ih-30:w=iw:h=30:color=black@0.62:t=fill,drawtext=fontfile='${esc(MONO)}':text='${esc(name)}':fontsize=15:fontcolor=white:x=(w-tw)/2:y=h-22`;
const lossless = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
// animated WebP: a fraction of a GIF's size for photo frames, and GitHub plays it inline
function anim(src, dest, q = 62) {
  mkdirSync(dirname(dest), { recursive: true });
  ff(['-i', src, '-vf', `fps=${FPS}`, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(q), '-compression_level', '6', '-loop', '0', dest]);
}
// an animated labelled grid from same-length clips, and a still contact sheet taken at time t
function grid(clips, cols, tw, th, destAnim, destPng, t, q = 55) {
  const n = clips.length, rows = Math.ceil(n / cols), ins = [], f = [];
  clips.forEach((c, i) => { ins.push('-i', c); f.push(`[${i}:v]scale=${tw}:${th}:flags=lanczos,setsar=1[v${i}]`); });
  const pad = rows * cols - n;
  for (let k = 0; k < pad; k++) { ins.push('-f', 'lavfi', '-i', `color=c=0x111014:s=${tw}x${th}:r=${FPS}`); f.push(`[${n + k}:v]setsar=1[v${n + k}]`); }
  const layout = [...Array(rows * cols).keys()].map(i => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
  f.push(`${[...Array(rows * cols).keys()].map(i => `[v${i}]`).join('')}xstack=inputs=${rows * cols}:layout=${layout}:shortest=1[g]`);
  const mp4 = destAnim.replace(/\.webp$/, '.tmp.mp4');
  ff([...ins, '-filter_complex', f.join(';'), '-map', '[g]', ...lossless, mp4]);
  anim(mp4, destAnim, q);
  ff(['-ss', String(t), '-i', mp4, '-frames:v', '1', '-update', '1', destPng]);
  rmSync(mp4, { force: true });
}

const work = mkdtempSync(join(tmpdir(), 'ath-menu-'));
const menu = loadMenu();
const sec = id => menu.sections.find(s => s.id === id).items;
const made = {};

// ---- transitions: a gradient plate cuts to the presenter, 0.5 s in, a 0.6 s blend, then a 0.6 s hold
const T_A = 0.5, T_D = 0.6, T_B = 0.6, T_LEN = T_A + T_D + T_B;
function transitions() {
  const a = join(work, 'ta.mp4'), b = join(work, 'tb.mp4');
  ff(['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x0b0f14:c1=0x1d5c63:x0=0:y0=0:x1=${W}:y1=${H}:d=${T_A + T_D}:r=${FPS}`,
    '-vf', `drawtext=fontfile='${esc(ANTON)}':text='ONE':fontsize=96:fontcolor=0x5cf9e2:x=(w-tw)/2:y=(h-th)/2-20`, '-t', String(T_A + T_D), ...lossless, a]);
  ff(['-loop', '1', '-i', PRESENTER, '-vf', `scale=${W}:${H}:flags=lanczos,setsar=1`, '-t', String(T_D + T_B), ...lossless, b]);
  const trans = require('./transitions.json');
  const clips = [];
  for (const it of sec('transitions')) {
    const mode = trans.names[it.id], clip = join(work, 'tx-' + it.id + '.mp4');
    if (mode) {
      ff(['-i', a, '-i', b, '-filter_complex', `[0][1]xfade=${XFX.xfadeOpts(mode, { color: ACCENT })}:duration=${T_D}:offset=${T_A},format=yuv420p,${label(it.id)}`, ...lossless, clip]);
    } else {
      // a hard cut at the middle of the blend; glitch adds the seam shake from kit/assemble.cjs, scaled to this size
      const cutAt = T_A + T_D / 2, k = W / 1080;
      const env = hz => `${(24 * k).toFixed(2)}*gte(t,${cutAt})*exp(-8*(t-${cutAt}))*sin(2*PI*${hz}*(t-${cutAt}))`;
      const win = `between(t,${(cutAt - 0.04).toFixed(2)},${(cutAt + 0.17).toFixed(2)})`;
      const seam = it.id === 'glitch'
        ? `,split[sa][sb];[sa][sb]overlay=x='${env(17)}':y='${env(23)}':eval=frame,rgbashift=rh=-4:bh=4:rv=1:bv=-1:enable='${win}',noise=c0s=46:c0f=t+u:enable='${win}'`
        : '';
      ff(['-i', a, '-i', b, '-filter_complex', `[0]trim=0:${cutAt},setpts=PTS-STARTPTS[x];[1]trim=${T_D / 2}:${T_D + T_B},setpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=1[c];[c]format=yuv420p${seam},${label(it.id)}`, ...lossless, clip]);
    }
    anim(clip, join(OUT, 'transitions', it.id + '.webp'));
    clips.push(clip);
  }
  grid(clips, 8, 120, 214, join(OUT, 'sheets', 'transitions.webp'), join(OUT, 'sheets', 'transitions.png'), T_A + T_D * 0.5);
  made.transitions = clips.length;
}

// ---- kinetic text: one render.mjs job with one item per 2 s slot, composited over the presenter, cut per slot
const SLOT = 2.0, LEAD = 0.25;
function renderJob(name, doc, dur, env = {}) {
  const build = join(work, name);
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
  sh(process.execPath, [join(KIT, 'render.mjs'), String(dur)], { cwd: build, env: { ...process.env, THEME: 'aigent', FONTS: 'theme', FPS: String(FPS), ...env } });
  const mp4 = join(work, name + '.mp4'), ins = ['-loop', '1', '-framerate', String(FPS), '-i', PRESENTER];
  const layers = ['ovlt', 'ovlp', 'ovl'].filter(d => existsSync(join(build, d)) && readdirSync(join(build, d)).length);
  for (const d of layers) ins.push('-framerate', String(FPS), '-i', join(build, d, '%04d.png'));
  let f = '[0:v]format=rgba[b0]', last = 'b0';
  layers.forEach((_, i) => { f += `;[${last}][${i + 1}:v]overlay=0:0:format=auto[b${i + 1}]`; last = `b${i + 1}`; });
  f += `;[${last}]scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[o]`;
  ff([...ins, '-filter_complex', f, '-map', '[o]', '-t', String(dur), ...lossless, mp4]);
  return mp4;
}
function cut(src, i, name, dest) {
  ff(['-ss', String(i * SLOT), '-t', String(SLOT), '-i', src, '-vf', `setpts=PTS-STARTPTS,${label(name)}`, ...lossless, dest]);
  return dest;
}
const WORDS = ['Record', 'one', 'take', 'on', 'your', 'phone'];
const words = s => WORDS.map((w, k) => [+(s + 0.05 + k * 0.22).toFixed(2), +(s + 0.27 + k * 0.22).toFixed(2), w]);

function titles() {
  const items = sec('title-entrances');
  const flips = items.map((it, i) => ({ start: +(i * SLOT + LEAD).toFixed(2), end: +((i + 1) * SLOT - 0.1).toFixed(2), text: 'Record one take', mode: 7, hero: [0], entrance: it.id, flicker: false, layer: 'front' }));
  const src = renderJob('titles', { captionStyle: 'kinetic', layout: false, flips }, items.length * SLOT);
  const clips = items.map((it, i) => { const c = cut(src, i, it.id, join(work, 'ti-' + it.id + '.mp4')); anim(c, join(OUT, 'titles', it.id + '.webp')); return c; });
  grid(clips, 4, 180, 320, join(OUT, 'sheets', 'titles.webp'), join(OUT, 'sheets', 'titles.png'), LEAD + 0.22);
  made.titles = clips.length;
}

function captionEntrances() {
  const items = sec('caption-entrances');
  const flips = items.map((it, i) => ({ start: +(i * SLOT + LEAD).toFixed(2), end: +((i + 1) * SLOT - 0.1).toFixed(2), text: WORDS.join(' '), mode: 0, words: words(i * SLOT + LEAD), hero: 'record', entrance: it.id }));
  const src = renderJob('capent', { captionStyle: 'kinetic', layout: false, flips }, items.length * SLOT);
  const clips = items.map((it, i) => { const c = cut(src, i, it.id, join(work, 'ce-' + it.id + '.mp4')); anim(c, join(OUT, 'caption-entrances', it.id + '.webp')); return c; });
  grid(clips, 5, 180, 320, join(OUT, 'sheets', 'caption-entrances.webp'), join(OUT, 'sheets', 'caption-entrances.png'), LEAD + 0.2);
  made.captionEntrances = clips.length;
}

function captionStyles() {
  const items = sec('caption-styles');
  const clips = items.map(it => {
    const doc = { captionStyle: it.id, layout: false, flips: [{ start: LEAD, end: SLOT - 0.1, text: WORDS.join(' '), mode: 0, words: words(LEAD), hero: 'record' }] };
    const src = renderJob('style-' + it.id, doc, SLOT);
    const c = cut(src, 0, it.id, join(work, 'cs-' + it.id + '.mp4'));
    anim(c, join(OUT, 'caption-styles', it.id + '.webp'));
    return c;
  });
  grid(clips, 4, 180, 320, join(OUT, 'sheets', 'caption-styles.webp'), join(OUT, 'sheets', 'caption-styles.png'), LEAD + 0.9);
  made.captionStyles = clips.length;
}

function size(dir) {
  let n = 0;
  for (const f of readdirSync(dir)) { const p = join(dir, f), s = statSync(p); n += s.isDirectory() ? size(p) : s.size; }
  return n;
}

if (!argv.includes('--docs-only')) {
  if (!existsSync(PRESENTER)) throw new Error('missing ' + PRESENTER);
  mkdirSync(join(OUT, 'sheets'), { recursive: true });
  if (want('transitions')) { console.log('transitions'); transitions(); }
  if (want('titles')) { console.log('title entrances'); titles(); }
  if (want('caption-entrances')) { console.log('caption entrances'); captionEntrances(); }
  if (want('caption-styles')) { console.log('caption styles'); captionStyles(); }
  console.log('rendered', JSON.stringify(made), `docs/menu is ${(size(OUT) / 1048576).toFixed(1)} MB`);
}
writeEffectsDoc(menu);
console.log('wrote docs/effects.md');
rmSync(work, { recursive: true, force: true });
