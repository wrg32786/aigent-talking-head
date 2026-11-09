import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, existsSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { findChrome } from './chrome.mjs';
// Run from the job's build/ folder (holds captions.js):  node <kit>/render.mjs <durationSec> [t1,t2,... for stills only]
// If build/ has no overlay.html or theme.js yet, they are copied from the kit. THEME=<name> picks kit/themes/<name>.js
// (default neutral); after that, edit build/theme.js or delete it to switch. Chrome: CHROME_PATH, else auto-detected.
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = process.cwd(), FPS = +(process.env.FPS || 24), DUR = +(process.argv[2] || 36.8);
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
if (!existsSync(join(ROOT, 'captions.js'))) { console.error('No captions.js here. Run render.mjs from your build/ folder.'); process.exit(1); }
if (!existsSync(join(ROOT, 'overlay.html'))) { copyFileSync(join(KIT, 'overlay.html'), join(ROOT, 'overlay.html')); console.log('copied kit/overlay.html'); }
if (!existsSync(join(ROOT, 'theme.js'))) {
  const t = join(KIT, 'themes', (process.env.THEME || 'neutral') + '.js');
  if (existsSync(t)) { copyFileSync(t, join(ROOT, 'theme.js')); console.log('theme.js <-', t); }
  else console.warn(`no theme.js and no ${t}; using the built-in neutral look`);
}
const b = await chromium.launch({ executablePath: findChrome() });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(join(ROOT, 'overlay.html')).href, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
if ((await p.evaluate(() => window.__logo)) === false) { console.error('logo failed to load (check "logo" in captions.js or theme.logo)'); await b.close(); process.exit(1); }
console.log('theme', await p.evaluate(() => window.__theme));
const dir = join(ROOT, only ? 'stills' : 'ovl'); if (!only) rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const list = only || [...Array(Math.round(DUR * FPS)).keys()].map(f => f / FPS);
let i = 0; for (const t of list) { await p.evaluate(t => window.seek(t), t); await p.screenshot({ path: join(dir, `${only ? ('t' + t.toFixed(2)) : String(i).padStart(4, '0')}.png`), omitBackground: true }); i++ }
console.log('frames', i); await b.close();
