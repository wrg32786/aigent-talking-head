// Stand-in for kit/teardown.mjs in tests (STUDIO_TEARDOWN): checks the downloaded file exists and writes a shipped
// example recipe as the teardown, so the reference-link flow runs without Python, models or a real reel.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const a = process.argv.slice(2), out = resolve(ROOT, a[a.indexOf('--out') + 1]), file = a[0];
if (!existsSync(file) || !statSync(file).size) { console.error('Not found: ' + file); process.exit(1); }
mkdirSync(out, { recursive: true });
// FAKE_TEARDOWN_HOLD=<folder>: print each stage the real teardown prints and wait at it until the test writes
// go-<stage> there (or go-all); a file named fail stops the run with an error, as a broken breakdown would
const hold = process.env.FAKE_TEARDOWN_HOLD;
if (hold) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const st of (process.env.FAKE_TEARDOWN_STAGES || 'cuts,captions,camera,transcribe,sound,graphics,framing,colours,recipe').split(',')) {
    console.log(`stage ${st}: working`);
    for (;;) {
      if (existsSync(join(hold, 'fail'))) { console.error('error: the breakdown stopped'); process.exit(1); }
      if (existsSync(join(hold, 'go-' + st)) || existsSync(join(hold, 'go-all'))) break;
      await wait(60);
    }
  }
}
copyFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), join(out, 'Reel.md'));
console.log('Teardown: ' + join(out, 'Reel.md'));
