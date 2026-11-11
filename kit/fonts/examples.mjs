// Rebuilds kit/fonts/examples/: one still per pairing in pairings.json on a flat background, plus a four-pairing
// cycle as a strip (cycle.jpg) and a short loop (cycle.gif). Run after changing a pairing:  npm run fonts:examples
// Needs Chrome and ffmpeg, like the rest of the kit. Local pairings (kit/fonts/local/) are never rendered here.
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const HERE = dirname(fileURLToPath(import.meta.url)), OUT = join(HERE, 'examples'), RENDER = join(HERE, '..', 'render.mjs');
const BG = '0x193829'; // deep forest green: the hue of Will's office wall, richer (his pick, Nov 10, 2026)
const CROP = 'crop=1080:1350:0:150'; // titles sit near y 560, captions near y 1320
const CYCLE = 'literata,bricolage,michroma,redhat';
const names = Object.keys(JSON.parse(readFileSync(join(HERE, 'pairings.json'), 'utf8')).pairings).filter(n => n !== 'theme');
const work = mkdtempSync(join(tmpdir(), 'font-examples-'));
const ff = (args, cwd) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { cwd, stdio: 'inherit' });
const render = (cwd, args, fonts) => execFileSync(process.execPath, [RENDER, ...args], { cwd, env: { ...process.env, FONTS: fonts }, encoding: 'utf8' });
const beat = (t0, title, hero, line, h2) => [
  { start: t0, end: t0 + 2.4, text: title, mode: 7, hero, flicker: false },
  { start: t0 + 0.1, end: t0 + 2.4, text: line, mode: 0, hero: h2, words: line.split(' ').map((w, k) => [+(t0 + 0.5 + k * 0.22).toFixed(2), +(t0 + 0.7 + k * 0.22).toFixed(2), w]) }];
const job = (dir, flips) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'kinetic', flips }) + ';\n'); return dir; };
mkdirSync(OUT, { recursive: true });

// one still per pairing: a title and a caption line, both settled
const one = job(join(work, 'one'), beat(0, 'Stop editing by hand', 'editing', 'Claude cuts the reel', 'reel'));
for (const n of names) {
  render(one, ['3', '2.0'], n);
  ff(['-f', 'lavfi', '-i', `color=c=${BG}:s=1080x1920`, '-i', 'stills/t2.00.png', '-filter_complex', `[0][1]overlay,${CROP},scale=540:-2`, '-frames:v', '1', '-q:v', '3', join(OUT, n + '.jpg')], one);
  console.log('ok', n);
}

// the cycle: four title beats, one pairing each, captions in their title's pair
const cyc = job(join(work, 'cycle'), [['Stop editing by hand', 'editing', 'Claude cuts the reel', 'reel'], ['One take is enough', 'take', 'Record it on your phone', 'phone'],
  ['Pick effects by name', 'effects', 'Ask for the look you want', 'look'], ['Post it before lunch', 'lunch', 'The reel is done', 'done']].flatMap((b, i) => beat(i * 2.5, ...b)));
render(cyc, ['10'], CYCLE);
const got = JSON.parse(readFileSync(join(cyc, 'lockups.json'), 'utf8')).filter(l => l.kind === 'title').map(l => l.fonts).join(',');
if (got !== CYCLE) throw new Error('cycle rendered as ' + got + ', want ' + CYCLE);
const comp = ['-f', 'lavfi', '-i', `color=c=${BG}:s=1080x1920:r=24`, '-framerate', '24', '-i', 'ovlt/%04d.png', '-framerate', '24', '-i', 'ovl/%04d.png'];
const base = `[0][1]overlay[a];[a][2]overlay=shortest=1,${CROP}`;
ff([...comp, '-filter_complex', `${base},select='eq(n,48)+eq(n,108)+eq(n,168)+eq(n,228)',scale=405:-2,tile=4x1`, '-frames:v', '1', '-q:v', '3', join(OUT, 'cycle.jpg')], cyc);
ff([...comp, '-filter_complex', `${base},fps=12,scale=360:-2:flags=lanczos,split[p][q];[p]palettegen=max_colors=48[pal];[q][pal]paletteuse=dither=none`, join(OUT, 'cycle.gif')], cyc);
console.log('ok cycle', CYCLE);
rmSync(work, { recursive: true, force: true });
console.log('wrote', names.length + 2, 'files to kit/fonts/examples/');
