// Synthetic media for the Studio tests and screenshots: no real footage. The presenter is showcase/source/presenter.jpg
// (an AI-generated fictional person made for this project, Apache-2.0 with the repo) with a slow push and a tone
// for a voice; the words are written in, as in the smoke test, so no speech recognition is needed.
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ff = (args, cwd) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { cwd, stdio: 'pipe' });
export const LINES = ['Stop editing reels by hand.', 'Record one take on your phone.', 'Drop the file in Studio.', 'Pick the look you like.', 'Then hit render.'];

// a presenter clip: the still with a slow push, mirrored on odd shots so cuts read
export function presenterClip(out, seconds = 2, mirror = false, freq = 320) {
  const img = join(ROOT, 'showcase', 'source', 'presenter.jpg');
  ff(['-loop', '1', '-i', img, '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`, '-t', String(seconds),
    '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920${mirror ? ',hflip' : ''},zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=24,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', out]);
}
// a clip.py-style folder: one clip per line with word timings
export function clipsFolder(dir, lines = LINES) {
  mkdirSync(dir, { recursive: true });
  const dur = 2;
  lines.forEach((_, i) => presenterClip(join(dir, `clip-00${i + 1}.mp4`), dur, i % 2 === 1, 260 + i * 60));
  const w = t => t.split(' ').map((x, i) => [+(0.12 + i * 0.3).toFixed(2), +(0.38 + i * 0.3).toFixed(2), x]);
  writeFileSync(join(dir, 'clips.json'), JSON.stringify({ src: 'synthetic', clips: lines.map((t, i) => ({ id: `clip-00${i + 1}`, file: `clips/clip-00${i + 1}.mp4`, dur, status: 'keep', text: t, words: w(t) })) }));
  return dir;
}
// a raw "take" for the footage tile: one longer presenter clip
export function rawTake(out) { presenterClip(out, 6, false, 300); return out; }
// a reference reel: three shots with big words and a mono middle shot, for the built-in teardown
export function referenceReel(out) {
  const d = dirname(out), font = join(ROOT, 'kit', 'fonts', 'ArchivoBlack-Regular.ttf').replace(/\\/g, '/').replace(/:/g, '\\:');
  const txt = w => `,drawtext=fontfile='${font}':text='${w}':fontsize=150:fontcolor=white:borderw=6:bordercolor=black:x=(w-tw)/2:y=h*0.3`;
  const shot = (n, src, extra) => ff(['-f', 'lavfi', '-i', src, '-vf', `scale=720:1280,setsar=1${extra}`, '-t', '2', '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', `ref-s${n}.mp4`], d);
  shot(1, 'testsrc2=size=720x1280:rate=24', txt('HELLO'));
  shot(2, 'smptebars=size=720x1280:rate=24', ',hue=s=0');
  shot(3, 'mandelbrot=size=720x1280:rate=24', txt('FOLLOW'));
  writeFileSync(join(d, 'ref-list.txt'), ['ref-s1.mp4', 'ref-s2.mp4', 'ref-s3.mp4'].map(f => `file '${f}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', 'ref-list.txt', '-c', 'copy', out], d);
  return out;
}
