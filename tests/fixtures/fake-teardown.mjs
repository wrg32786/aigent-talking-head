// Stand-in for kit/teardown.mjs in tests (STUDIO_TEARDOWN): checks the downloaded file exists and writes a shipped
// example recipe as the teardown, so the reference-link flow runs without Python, models or a real reel.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const a = process.argv.slice(2), out = resolve(ROOT, a[a.indexOf('--out') + 1]), file = a[0];
if (!existsSync(file) || !statSync(file).size) { console.error('Not found: ' + file); process.exit(1); }
mkdirSync(out, { recursive: true });
copyFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), join(out, 'Reel.md'));
console.log('Teardown: ' + join(out, 'Reel.md'));
