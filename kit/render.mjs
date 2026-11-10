import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, existsSync, copyFileSync, writeFileSync } from 'fs';
import { resolveFonts } from './fonts.mjs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { findChrome } from './chrome.mjs';
// Run from the job's build/ folder (holds captions.js):  node <kit>/render.mjs <durationSec> [t1,t2,... for stills only]
// Writes ovl/%04d.png (and ovlt/%04d.png when captions.js has kinetic titles), or stills/t<sec>.png.
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
// Font pairing -> fonts.js: FONTS=<name|path.json> wins, then "fonts" in captions.js, else the fonts.js already here
// (none = the theme's own fonts). fxzones.js (from fx.cjs) tells the caption track where effects need the band.
{
  const CAP = createRequire(import.meta.url)('./rules.cjs').readCaptions(join(ROOT, 'captions.js'));
  const want = process.env.FONTS || CAP.fonts;
  if (want || !existsSync(join(ROOT, 'fonts.js'))) {
    const fp = resolveFonts(want || 'theme');
    writeFileSync(join(ROOT, 'fonts.js'), 'window.FONTS=' + JSON.stringify(fp) + ';\n');
    if (fp) console.log('fonts', fp.name, [fp.display, fp.secondary, fp.script].filter(Boolean).map(r => r.family).join(' + '));
  }
  if (!existsSync(join(ROOT, 'fxzones.js'))) writeFileSync(join(ROOT, 'fxzones.js'), 'window.FXZONES=[];\n');
}
const b = await chromium.launch({ executablePath: findChrome() });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(join(ROOT, 'overlay.html')).href, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
if ((await p.evaluate(() => window.__logo)) === false) { console.error('logo failed to load (check "logo" in captions.js or theme.logo)'); await b.close(); process.exit(1); }
console.log('theme', await p.evaluate(() => window.__theme));
// Kinetic titles (mode 7) get their own layer, ovlt/, so assemble.cjs can draw them behind the person; ovl/ then
// holds everything else. Stills always show every layer together.
const titles = await p.evaluate(() => window.__titles || []);
if (titles.length) console.log('titles', titles.map(t => `${t.start}s ${t.entrance}${t.flicker ? '+flicker' : ''}`).join(', '));
const passes = only ? [['stills', 'all']] : titles.length ? [['ovl', 'front'], ['ovlt', 'titles']] : [['ovl', 'all']];
if (!only && !titles.length) rmSync(join(ROOT, 'ovlt'), { recursive: true, force: true });
const list = only || [...Array(Math.round(DUR * FPS)).keys()].map(f => f / FPS);
let i = 0;
for (const [d, layer] of passes) {
  const dir = join(ROOT, d); if (!only) rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  i = 0; for (const t of list) { await p.evaluate(([t, l]) => window.seek(t, l), [t, layer]); await p.screenshot({ path: join(dir, `${only ? ('t' + t.toFixed(2)) : String(i).padStart(4, '0')}.png`), omitBackground: true }); i++ }
}
console.log('frames', i, passes.map(x => x[0]).join(' + ')); await b.close();
