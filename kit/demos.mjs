// Animated demos for every option that only had a still: presenter effects, graphics, film finishes and title layers.
// Each is a 3 s loop (270x480 webp) on the same plate: showcase/source/presenter.jpg (an AI-made fictional presenter for
// this project), held still. A slow push was tried and dropped: every frame then differs and one loop weighs 130 KB
// instead of 5 to 40, past the 8 MB budget for the committed demos. The motion comes from the effect itself. Nothing here
// draws on its own: effects run through effects/fx_runner.py (as kit/fx.cjs does at Render), graphics and titles through
// kit/render.mjs (kit/overlay.html), finishes through the same ffmpeg chain as the reel (kit/beats.cjs finishChain), shown
// as a left to right reveal so the change is visible. Words behind the head use the presenter's person mask.
//   node kit/demos.mjs                   every demo        --only effect,finish   some kinds   --ids moody,mono   some ids
//   node kit/demos.mjs --missing         only the ones not made yet (Studio's Make missing previews runs this)
//   node kit/demos.mjs --sounds          only the waveforms of the music beds and sounds (docs/menu/sounds.json)
//   node kit/demos.mjs --check           the visible-change check on every demo (tests/demos-visible.test.mjs runs it)
// Output: docs/menu/<effects|graphics|finishes|title-layers>/<id>.webp and docs/menu/demo-plate.webp (the plain plate).
// Effects need the effects add-on (npm run effects:setup); without it they are skipped with a note.
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadMenu } from './menu.mjs';

const require = createRequire(import.meta.url);
const B = require('./beats.cjs');
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
export const MENU = join(ROOT, 'docs', 'menu');
export const DIRS = { effect: 'effects', graphic: 'graphics', finish: 'finishes', titleLayer: 'title-layers' };
export const PLATE = join(MENU, 'demo-plate.webp');
const PRESENTER = join(ROOT, 'showcase', 'source', 'presenter.jpg'), MASK = join(ROOT, 'showcase', 'source', 'presenter-mask.png');
const FX_PY = join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), RUNNER = join(ROOT, 'effects', 'fx_runner.py');
const FW = 1080, FH = 1920, W = 270, H = 480, FPS = 15, DUR = 3;
export const demoPath = (kind, id) => join(MENU, DIRS[kind], id + '.webp');
export const fxReady = () => existsSync(FX_PY) && existsSync(RUNNER);

const sh = (cmd, args, opts = {}) => { try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...opts }); } catch (e) { throw new Error([e.message, e.stderr && e.stderr.toString().slice(-800)].filter(Boolean).join('\n')); } };
const ff = args => sh('ffmpeg', ['-v', 'error', '-y', ...args]);
const lossless = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-pix_fmt', 'yuv420p'];
// a finished clip to the small looping webp; q drops (never frames) if a file is too big. Fine noise is what lossy webp
// throws away first, so the grain demo starts higher or it would look like the plain plate
export const QUALITY = { 'finish:grain': 92 };
export function toWebp(src, dest, q = 60) {
  mkdirSync(dirname(dest), { recursive: true });
  for (let qq = q; ; qq -= 12) {
    ff(['-i', src, '-t', String(DUR), '-vf', `scale=${W}:${H}:flags=lanczos,fps=${FPS}`, '-an', '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(qq), '-compression_level', '6', '-loop', '0', dest]);
    if (statSync(dest).size <= 100e3 || qq <= 24) return statSync(dest).size;
  }
}

// ---- the plate: the presenter as a clip (effects draw on it) and as the plain demo the check compares to
function plate(work) {
  const mp4 = join(work, 'plate.mp4');
  if (!existsSync(mp4)) ff(['-loop', '1', '-framerate', String(FPS), '-i', PRESENTER, '-vf', `scale=${FW}:${FH},format=yuv420p`, '-frames:v', String(DUR * FPS), ...lossless, mp4]);
  return mp4;
}

// ---- finishes: the reel's own filter, revealed left to right over 1.2 s, then held. It runs at the tile's own size, so
// fine grain and scan lines show the way they look on a phone instead of vanishing in the shrink
function finish(work, id) {
  const vf = B.finishChain(id), out = join(work, `finish-${id}.mp4`);
  ff(['-i', plate(work), '-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=${FPS}:d=${DUR},format=gray,geq=lum='if(lte(X\\,W*min(1\\,T/1.2))\\,255\\,0)'`,
    '-filter_complex', `[0:v]scale=${W}:${H}:flags=lanczos,split[a][b];[b]${vf},format=rgba[f];[f][1:v]alphamerge[fm];[a][fm]overlay=0:0:format=auto,format=yuv420p[o]`, '-map', '[o]', '-t', String(DUR), ...lossless, out]);
  return out;
}

// ---- graphics and title layers: kit/render.mjs draws the overlay; titles go behind the person with the mask
function cutout(work) {
  const png = join(work, 'cutout.png');
  if (!existsSync(png)) ff(['-i', PRESENTER, '-i', MASK, '-filter_complex', `[0:v]scale=${FW}:${FH},format=rgba[p];[1:v]scale=${FW}:${FH},format=gray[m];[p][m]alphamerge`, '-frames:v', '1', png]);
  return png;
}
function overlay(work, name, doc, env = {}) {
  const build = join(work, name); mkdirSync(build, { recursive: true });
  writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
  sh(process.execPath, [join(KIT, 'render.mjs'), String(DUR)], { cwd: build, env: { ...process.env, THEME: 'aigent', FONTS: 'theme', FPS: String(FPS), ...env } });
  const ins = ['-loop', '1', '-framerate', String(FPS), '-i', PRESENTER], steps = [];
  const layer = d => existsSync(join(build, d)) && readdirSync(join(build, d)).length ? (ins.push('-framerate', String(FPS), '-i', join(build, d, '%04d.png')), `[${ins.filter(x => x === '-i').length - 1}:v]`) : null;
  const behind = [layer('ovlt'), layer('ovlp')].filter(Boolean);
  ins.push('-loop', '1', '-framerate', String(FPS), '-i', cutout(work)); const cut = `[${ins.filter(x => x === '-i').length - 1}:v]`;
  const front = layer('ovl');
  let last = '[0:v]'; const step = (src, k) => { steps.push(`${last}${src}overlay=0:0:format=auto[c${k}]`); last = `[c${k}]`; };
  let k = 0; steps.push(`[0:v]scale=${FW}:${FH},format=rgba[c${k}]`); last = `[c${k}]`;
  for (const b of behind) step(b, ++k);
  if (behind.length) step(cut, ++k);
  if (front) step(front, ++k);
  steps.push(`${last}format=yuv420p[o]`);
  const out = join(work, name + '.mp4');
  ff([...ins, '-filter_complex', steps.join(';'), '-map', '[o]', '-t', String(DUR), ...lossless, out]);
  return out;
}

// ---- presenter effects: the effects pass on the plate, the effect on for nearly the whole loop (MediaPipe mask, as fx.cjs without a model)
let SHOW = null;
async function effect(work, e) {
  SHOW = SHOW || await import('./showcase.mjs');
  const imgs = existsSync(join(work, 'broll')) ? join(work, 'broll') : SHOW.fxImages(join(work, 'broll'));
  const pf = join(work, `fx-${e.id}.json`), out = join(work, `fx-${e.id}.mp4`);
  writeFileSync(pf, JSON.stringify({ profile: SHOW.FX_PROFILE, effects: [SHOW.fxRow(e, imgs, 0.1, DUR - 0.05)] }, null, 1));
  sh(FX_PY, [RUNNER, '--plan', pf, plate(work), out], { cwd: work, env: { ...process.env, PYTHONUTF8: '1', FX_MATTE: '' } });
  return out;
}

// ---- what each graphic and title layer shows
async function graphic(work, it) {
  SHOW = SHOW || await import('./showcase.mjs');
  const flips = (SHOW.GFX_DEMO[it.id] || [{ ...(it.example || {}), start: 0, end: DUR }]).map(f => ({ ...f, start: 0.1, end: DUR }));
  return overlay(work, 'g-' + it.id, { captionStyle: 'kinetic', flips });
}
const LAYER_DEMO = {
  front: [{ start: 0.1, end: DUR, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'front' }],
  behind: [{ start: 0.1, end: DUR, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' }],
  // auto: only the strongest punch title goes behind the head; the one before it stays in front
  auto: [{ start: 0.1, end: 1.4, text: 'Record', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'front' },
    { start: 1.5, end: DUR, text: 'One take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' }],
};
const titleLayer = (work, it) => overlay(work, 'tl-' + it.id, { captionStyle: 'kinetic', layout: false, flips: LAYER_DEMO[it.id] });

// every option this script makes a demo for, by kind
export function items() {
  const menu = loadMenu(), sec = id => (menu.sections.find(s => s.id === id) || { items: [] }).items;
  return [...sec('effects').map(it => ({ kind: 'effect', it })), ...sec('graphics').map(it => ({ kind: 'graphic', it })),
    ...sec('finishes').map(it => ({ kind: 'finish', it })), ...['front', 'behind', 'auto'].map(id => ({ kind: 'titleLayer', it: { id } }))];
}

// ---- sounds: a small waveform (48 bars, 0..100) for every music bed and sound, so the sound tiles can show their shape
// without loading the audio. Written to docs/menu/sounds.json; the tiles play the file itself only when asked
export const SOUNDS = join(MENU, 'sounds.json');
export function peaks(file, n = 48) {
  const raw = sh('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-']), pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const step = Math.max(1, Math.floor(pcm.length / n)), out = [];
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(pcm.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(pcm[j])); out.push(m); }
  const top = Math.max(1, ...out); return out.map(v => Math.round(100 * v / top));
}
export function buildSounds() {
  const beds = JSON.parse(readFileSync(join(KIT, 'music', 'beds.json'), 'utf8')), sfx = JSON.parse(readFileSync(join(KIT, 'sfx', 'sfx.json'), 'utf8')).sounds;
  const out = { beds: {}, sfx: {} };
  for (const [id, b] of Object.entries(beds)) out.beds[id] = peaks(join(KIT, 'music', b.file));
  for (const x of sfx) out.sfx[x.id] = peaks(join(KIT, 'sfx', x.file));
  writeFileSync(SOUNDS, JSON.stringify(out) + '\n');
  return Object.keys(out.beds).length + Object.keys(out.sfx).length;
}

// ---- the visible-change check: each demo against the plain plate, frame by frame. ffmpeg cannot read animated webp, so
// Chrome decodes them (ImageDecoder). The score is the share of the picture (percent) where some colour moved by at least
// STEP levels, at the clearest frame. A grey finish keeps the brightness and grain keeps the average, so an average
// difference misses both; a share does not
export const STEP = 6, THRESHOLD = 10;
const toB64 = f => readFileSync(f).toString('base64');
export async function scores(files) {
  const { chromium } = await import('playwright-core'), { findChrome } = await import('./chrome.mjs');
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  try {
    // ImageDecoder needs a secure page: an https address answered locally, nothing leaves the machine
    const pg = await browser.newPage();
    await pg.route('https://demos.local/', r => r.fulfill({ body: '<!doctype html><title>demos</title>', contentType: 'text/html' }));
    await pg.goto('https://demos.local/');
    await pg.evaluate(async plate => {
      const frames = async b64 => {
        const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), dec = new ImageDecoder({ data, type: 'image/webp' });
        await dec.tracks.ready;
        const n = dec.tracks.selectedTrack.frameCount, cv = new OffscreenCanvas(270, 480), cx = cv.getContext('2d', { willReadFrequently: true }), out = [];
        for (let i = 0; i < n; i++) {
          const { image } = await dec.decode({ frameIndex: i }); cx.drawImage(image, 0, 0, 270, 480); image.close();
          const d = cx.getImageData(0, 0, 270, 480).data, g = new Uint8Array(270 * 480 * 3);
          for (let j = 0, k = 0; j < d.length; j += 4) { g[k++] = d[j]; g[k++] = d[j + 1]; g[k++] = d[j + 2]; }
          out.push(g);
        }
        return out;
      };
      window.decodeAll = frames; window.plate = await frames(plate);
    }, toB64(PLATE));
    const out = {};
    for (const f of files) out[f] = await pg.evaluate(async ([b64, STEP]) => {
      const a = await window.decodeAll(b64), p = window.plate; let best = 0;
      for (let i = 0; i < a.length; i++) {
        const x = a[i], y = p[i % p.length]; let n = 0;
        for (let j = 0; j < x.length; j += 3) if (Math.max(Math.abs(x[j] - y[j]), Math.abs(x[j + 1] - y[j + 1]), Math.abs(x[j + 2] - y[j + 2])) >= STEP) n++;
        best = Math.max(best, 300 * n / x.length);
      }
      return Math.round(best * 10) / 10;
    }, [toB64(f), STEP]);
    return out;
  } finally { await browser.close(); }
}
export async function check(list = items()) {
  const made = list.filter(({ kind, it }) => existsSync(demoPath(kind, it.id))), sc = await scores(made.map(({ kind, it }) => demoPath(kind, it.id)));
  return list.map(({ kind, it }) => { const f = demoPath(kind, it.id); return { kind, id: it.id, made: f in sc, score: sc[f] || 0 }; });
}

async function main() {
  const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
  const kinds = opt('only') ? opt('only').split(',') : Object.keys(DIRS), ids = opt('ids') ? new Set(opt('ids').split(',')) : null;
  let list = items().filter(x => kinds.includes(x.kind) && (!ids || ids.has(x.it.id)));
  if (argv.includes('--check')) {
    const rows = await check(list), bad = rows.filter(r => !r.made || r.score < THRESHOLD);
    for (const r of rows) console.log(`${r.kind} ${r.id}: ${r.made ? r.score : 'missing'}`);
    console.log(bad.length ? `These demos do not show a visible change yet: ${bad.map(r => r.id).join(', ')}` : `All ${rows.length} demos show a visible change.`);
    process.exit(bad.length ? 1 : 0);
  }
  if (argv.includes('--sounds') || !existsSync(SOUNDS)) { console.log(`Sound waveforms: ${buildSounds()} sounds.`); if (argv.includes('--sounds')) return; }
  if (argv.includes('--missing')) list = list.filter(x => !existsSync(demoPath(x.kind, x.it.id)));
  if (!fxReady() && list.some(x => x.kind === 'effect')) { console.log('Effects previews need the effects add-on; skipping them.'); list = list.filter(x => x.kind !== 'effect'); }
  const work = mkdtempSync(join(tmpdir(), 'demos-'));
  try {
    if (!existsSync(PLATE) || argv.includes('--plate')) toWebp(plate(work), PLATE);
    let n = 0, failed = [];
    for (const { kind, it } of list) {
      n++;
      try {
        const mp4 = kind === 'effect' ? await effect(work, it) : kind === 'graphic' ? await graphic(work, it) : kind === 'finish' ? finish(work, it.id) : titleLayer(work, it);
        const size = toWebp(mp4, demoPath(kind, it.id), QUALITY[`${kind}:${it.id}`]);
        console.log(`${n}/${list.length} ${kind} ${it.id} ${Math.round(size / 1024)} KB`);
      } catch (e) { failed.push(it.id); console.log(`${n}/${list.length} ${kind} ${it.id} failed: ${e.message.split('\n')[0]}`); }
    }
    console.log(failed.length ? `Done. These did not render: ${failed.join(', ')}` : `Done: ${list.length} demos.`);
    process.exitCode = failed.length ? 1 : 0;
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
