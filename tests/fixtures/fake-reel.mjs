// A stand-in for kit/reel.cjs in the Studio Cut tests (STUDIO_REEL), so a batch render does not wait for the engine:
//   <clip.mp4> --name <job> [--draft] [--export <preset>] ...   copies the clip as jobs/<job>/reel-v1.mp4 (a draft
//       writes build/cut.json and build/captions.js instead, like the real draft)
//   --rebuild --name <job>   writes jobs/<job>/reel-vN.mp4 from the drafted clip
// Every call is logged to jobs/<job>/fake-reel.log so the test can check the arguments.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
const name = opt('name'), dir = join(ROOT, 'jobs', name), build = join(dir, 'build');
mkdirSync(build, { recursive: true }); appendFileSync(join(dir, 'fake-reel.log'), a.join(' ') + '\n');
const next = () => 'reel-v' + (1 + readdirSync(dir).filter(f => /^reel-v\d+\.mp4$/.test(f)).length) + '.mp4';
if (a.includes('--rebuild')) {
  const src = readFileSync(join(build, 'src.txt'), 'utf8'); copyFileSync(src, join(dir, next()));
} else {
  const src = resolve(ROOT, a[0]); if (!existsSync(src)) { console.error('no such clip ' + a[0]); process.exit(1); }
  if (a.includes('--draft')) {
    writeFileSync(join(build, 'src.txt'), src);
    // three beats with caption words, so the b-roll lane has slots (tests/studio-broll.e2e.mjs)
    writeFileSync(join(build, 'cut.json'), JSON.stringify({ segs: [{ file: src, in: 0, out: 4 }, { file: src, in: 4, out: 8 }, { file: src, in: 8, out: 12 }], tail: 0.4 }));
    const flips = [{ start: 0.2, end: 3.6, text: 'Editing used to eat my whole weekend' }, { start: 4.2, end: 7.6, text: 'Now the dashboard shows every sale' }, { start: 8.2, end: 11.6, text: 'Revenue doubled in three months' }];
    writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify({ flips, graphics: [] }) + ';\n');
  } else copyFileSync(src, join(dir, next()));
}
console.log(JSON.stringify({ ok: true, job: name }));
