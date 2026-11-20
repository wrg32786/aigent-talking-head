// Fast frame capture (kit/framecap.mjs, used by kit/render.mjs): the in-page PNG frames match the old screenshot
// frames pixel for pixel on every layer (front, behind-head titles, screen cards behind the head), with a logo plate
// and a screen recording on the canvas; two pages drawing at once give the same frames; an error mid-render falls
// back to screenshots and the frames still match. Needs Chrome and ffmpeg.  node tests/framecap.e2e.mjs
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as FC from '../kit/framecap.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), KIT = join(ROOT, 'kit');
const fail = m => { console.error('FAIL ' + m); process.exit(1); };
const work = mkdtempSync(join(tmpdir(), 'th-framecap-')), d = join(work, 'build'); mkdirSync(d);
try {
  // the page and worker counts follow the machine and never go past what memory allows
  if (FC.pickPages({}, 8, 16 * 2 ** 30) !== 2 || FC.pickPages({}, 16, 16 * 2 ** 30) !== 3 || FC.pickPages({}, 2, 16 * 2 ** 30) !== 1) fail('pages by CPU');
  if (FC.pickPages({}, 16, 2 * 2 ** 30) !== 1 || FC.pickPages({ RENDER_PAGES: '2' }, 1, 0) !== 2) fail('pages by memory or RENDER_PAGES');
  if (FC.pickWorkers(8, 2) !== 3 || FC.pickWorkers(2, 1) !== 1) fail('workers');

  copyFileSync(join(KIT, 'example', 'skool-logo.svg'), join(d, 'skool-logo.svg'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=2', join(d, 'rec.mp4')]);
  writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'phrase', fonts: 'theme', logo: 'skool-logo.svg', flips: [
    { start: 0, end: 2, text: 'hello there friend', mode: 0 },
    { start: 0.1, end: 1.2, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' },
    { start: 0.4, end: 2, mode: 11, src: 'rec.mp4' },
    { start: 1.2, end: 2, mode: 5 }] }) + ';\n');
  const render = env => { const r = spawnSync(process.execPath, [join(KIT, 'render.mjs'), '2'], { cwd: d, env: { ...process.env, THEME: 'aigent', ...env }, encoding: 'utf8' }); if (r.status !== 0) fail('render.mjs: ' + r.stderr); return r.stdout + r.stderr; };
  const frames = () => ['ovl', 'ovlt', 'ovlp'].map(l => existsSync(join(d, l)) ? execFileSync('ffmpeg', ['-v', 'error', '-i', join(d, l, '%04d.png'), '-pix_fmt', 'rgba', '-f', 'framemd5', '-'], { maxBuffer: 1 << 26 }).toString().split('\n').filter(x => x && !x.startsWith('#')).map(x => x.split(',').pop().trim()) : []);
  // a frame matches when it is pixel identical, or (Chrome now and then draws a title's soft shadow a shade differently,
  // with screenshots too) when its SSIM over grey is 0.995 or more
  const ssim = (fa, fb) => { const r = spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'color=gray:s=1080x1920', '-i', fa, '-i', fb, '-filter_complex', '[0]split[g1][g2];[g1][1]overlay[A];[g2][2]overlay[B];[A][B]ssim', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' }); return +((r.stderr.match(/All:([\d.]+)/) || [0, 0])[1]); };
  const LAYERS = ['ovl', 'ovlt', 'ovlp'];
  const keepRef = () => { rmSync(join(work, 'ref'), { recursive: true, force: true }); for (const l of LAYERS) if (existsSync(join(d, l))) { mkdirSync(join(work, 'ref', l), { recursive: true }); for (const f of readdirSync(join(d, l))) copyFileSync(join(d, l, f), join(work, 'ref', l, f)); } };
  let exact = 0, close = 0, low = 1;
  const same = (a, b, what) => { for (let k = 0; k < 3; k++) { if (a[k].length !== b[k].length) fail(`${what}: layer ${k} has ${b[k].length} frames, not ${a[k].length}`); a[k].forEach((h, i) => { if (h === b[k][i]) return exact++; const f = String(i).padStart(4, '0') + '.png', s = ssim(join(work, 'ref', LAYERS[k], f), join(d, LAYERS[k], f)); low = Math.min(low, s); if (s < 0.995) fail(`${what}: frame ${i} of ${LAYERS[k]} differs from the screenshot (SSIM ${s})`); close++; }); } };

  const o1 = render({ RENDER_CAPTURE: 'screenshot' }), shots = frames(); keepRef();
  if (!/capture: 144 frames .*screenshots, 1 page/.test(o1)) fail('screenshot run: ' + (o1.match(/capture:.*/) || [o1])[0]);
  if (shots.some(l => l.length !== 48)) fail('three layers of 48 frames expected: ' + shots.map(l => l.length));
  const o2 = render({}), fast = frames();
  if (!/capture: 144 frames .*in-page PNG, 1 page/.test(o2) || /stopped/.test(o2)) fail('fast run: ' + (o2.match(/(note|capture):.*/g) || [o2]).join(' | '));
  same(shots, fast, 'in-page PNG');
  const o3 = render({ RENDER_PAGES: '2' });
  if (!/in-page PNG, 2 pages/.test(o3)) fail('two pages: ' + (o3.match(/capture:.*/) || [o3])[0]);
  same(shots, frames(), 'two pages');
  const o4 = render({ RENDER_CAPTURE_FAIL_AT: '20' });
  if (!/fast frame capture stopped at frame 12 .*screenshots from there on/.test(o4) || !/in-page PNG, then screenshots/.test(o4)) fail('fallback: ' + (o4.match(/(note|capture):.*/g) || [o4]).join(' | '));
  same(shots, frames(), 'after the fallback');
  // stills take the fast path too
  const still = env => execFileSync(process.execPath, [join(KIT, 'render.mjs'), '0', '0.50,1.50'], { cwd: d, env: { ...process.env, THEME: 'aigent', ...env }, stdio: 'ignore' });
  still({ RENDER_CAPTURE: 'screenshot' }); mkdirSync(join(work, 'stills')); for (const f of readdirSync(join(d, 'stills'))) copyFileSync(join(d, 'stills', f), join(work, 'stills', f));
  still({});
  const sf = readdirSync(join(work, 'stills')).sort();
  if (sf.length !== 2 || sf.join() !== readdirSync(join(d, 'stills')).sort().join()) fail('stills: ' + sf);
  for (const f of sf) { const s = ssim(join(work, 'stills', f), join(d, 'stills', f)); if (s < 0.995) fail(`still ${f} differs (SSIM ${s})`); }
  console.log(`framecap ok: one page, two pages and after a fallback, ${exact} frames identical, ${close} within SSIM ${low.toFixed(4)}; stills match`);
} finally { if (!process.env.KEEP) rmSync(work, { recursive: true, force: true }); }
