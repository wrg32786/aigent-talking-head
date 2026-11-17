import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, existsSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolveFonts } from './fonts.mjs';
import { createRequire } from 'module';
import { dirname, join, isAbsolute } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { findChrome } from './chrome.mjs';
// Run from the job's build/ folder (holds captions.js):  node <kit>/render.mjs <durationSec> [t1,t2,... for stills only]
// Writes ovl/%04d.png (and ovlt/%04d.png when captions.js has kinetic titles), or stills/t<sec>.png.
// STILLS_LAYERS=1 with a stills-only run writes stills-front/ and stills-titles/ so a mask can put titles behind the person.
// If build/ has no theme.js yet, it is copied from the kit; overlay.html always is (see below). THEME=<name> picks kit/themes/<name>.js
// (default aigent); after that, edit build/theme.js or delete it to switch. Chrome: CHROME_PATH, else auto-detected. THEME=neutral is the unbranded offline look.
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = process.cwd(), FPS = +(process.env.FPS || 24), DUR = +(process.argv[2] || 36.8);
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
if (!existsSync(join(ROOT, 'captions.js'))) { console.error('No captions.js here. Run render.mjs from your build/ folder.'); process.exit(1); }
// overlay.html is refreshed from the kit on every run so a rebuild picks up kit fixes (a stale copy kept old
// layouts); KEEP_OVERLAY=1 keeps a hand-edited one
{ const o = join(ROOT, 'overlay.html'), k = join(KIT, 'overlay.html');
  if (!existsSync(o)) { copyFileSync(k, o); console.log('copied kit/overlay.html'); }
  else if (!process.env.KEEP_OVERLAY && readFileSync(o, 'utf8') !== readFileSync(k, 'utf8')) { copyFileSync(k, o); console.log('overlay.html <- kit (KEEP_OVERLAY=1 keeps your copy)'); } }
if (!existsSync(join(ROOT, 'theme.js'))) {
  const t = join(KIT, 'themes', (process.env.THEME || 'aigent') + '.js');
  if (existsSync(t)) { copyFileSync(t, join(ROOT, 'theme.js')); console.log('theme.js <-', t); }
  else console.warn(`no theme.js and no ${t}; using the built-in neutral look`);
}
// Font pairing -> fonts.js: FONTS=<name|path.json> wins, then "fonts" in captions.js, else the fonts.js already here
// (none = the theme's own fonts). Several names ("literata,bricolage,michroma") cycle: the first is the base and
// titles take them in turn (overlay.html). fxzones.js (from fx.cjs) tells the caption track where effects need the band.
{
  const CAP = createRequire(import.meta.url)('./rules.cjs').readCaptions(join(ROOT, 'captions.js'));
  const want = process.env.FONTS || CAP.fonts;
  if (want || !existsSync(join(ROOT, 'fonts.js'))) {
    const names = (Array.isArray(want) ? want : String(want || 'theme').split(',')).map(s => String(s).trim()).filter(Boolean);
    const sets = names.map(n => resolveFonts(n) || { name: 'theme' }), fp = resolveFonts(names[0]);
    writeFileSync(join(ROOT, 'fonts.js'), 'window.FONTS=' + JSON.stringify(fp) + ';\n' + (sets.length > 1 ? 'window.FONTSETS=' + JSON.stringify(sets) + ';\n' : ''));
    if (sets.length > 1) console.log('font cycle', sets.map(s => s.name).join(' > '));
    if (fp) console.log('fonts', fp.name, [fp.display, fp.secondary, fp.script].filter(Boolean).map(r => r.family).join(' + '));
  }
  // font lockup overrides from cut.json ("lockup" for the job, "hero" per flip start) -> lockover.js
  { let C = {}; try { C = JSON.parse(readFileSync(join(ROOT, 'cut.json'), 'utf8')); } catch {}
    writeFileSync(join(ROOT, 'lockover.js'), 'window.LOCKOVER=' + JSON.stringify({ lockup: C.lockup || null, hero: C.hero || null, titleLayer: C.titleLayer || null, inserts: (C.inserts || []).map(s => ({ at: +s.at, dur: +s.dur, y: s.y, tint: s.tint, line: s.line, arc: s.arc })) }) + ';\n'); }
  if (!existsSync(join(ROOT, 'fxzones.js'))) writeFileSync(join(ROOT, 'fxzones.js'), 'window.FXZONES=[];\n');
  // graphics (modes 10, 11, 19 and 26): icon and screen images as file URLs; a screen recording becomes a short frame list
  // (build/gfx/, 12 fps) so the card can play it frame-accurately. Fonts for the ordinal word, the label, the code
  // card, the split-flap and flash-card face (Anton) and the terminal (JetBrains Mono), and each graphic's default place and layer rule from kit/graphics.json.
  { const assets = {}, VID = /\.(mp4|mov|m4v|webm|mkv)$/i, url = f => pathToFileURL(f).href;
    for (const f of CAP.flips || []) {
      if (f.mode !== 10 && f.mode !== 11 && f.mode !== 19 && f.mode !== 26) continue;
      const key = f.mode + '@' + f.start, file = f.mode === 11 ? f.src : f.icon;
      if (!file) continue;
      const abs = isAbsolute(file) ? file : join(ROOT, file);
      if (!existsSync(abs)) { console.warn(`graphic at ${f.start}s: no file ${file}, drawing the placeholder`); continue; }
      if (f.mode === 11 && VID.test(abs)) {
        const dur = Math.max(0.1, (+f.end >= 90 ? DUR : +f.end) - +f.start), dir = join(ROOT, 'gfx', String(f.start).replace(/[^0-9]/g, '_'));
        const sig = JSON.stringify([abs, statSync(abs).mtimeMs, +f.in || 0, dur]);
        if (!existsSync(join(dir, 'sig.json')) || readFileSync(join(dir, 'sig.json'), 'utf8') !== sig) {
          rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(+f.in || 0), '-i', abs, '-t', String(dur), '-vf', 'fps=12,scale=720:-2', '-q:v', '4', join(dir, '%04d.jpg')]);
          writeFileSync(join(dir, 'sig.json'), sig);
        }
        assets[key] = { fps: 12, frames: readdirSync(dir).filter(x => x.endsWith('.jpg')).sort().map(x => url(join(dir, x))) };
      } else assets[key] = f.mode === 11 ? { src: url(abs) } : { icon: url(abs) };
    }
    const F = join(KIT, 'fonts');
    const GJ = JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8'));
    const defaults = Object.fromEntries(GJ.graphics.map(g => [g.mode, g.defaults || {}])), panelModes = GJ.graphics.filter(g => g.mode >= 11).map(g => g.mode);
    writeFileSync(join(ROOT, 'gfx.js'), 'window.GFX=' + JSON.stringify({ fonts: { serif: url(join(F, 'InstrumentSerif-Italic.ttf')), label: url(join(F, 'ArchivoBlack-Regular.ttf')), mono: url(join(F, 'RedHatMono-VF.ttf')), slam: url(join(F, 'Anton-Regular.ttf')), code: url(join(F, 'JetBrainsMono-VF.ttf')) }, defaults, autoBehindY: GJ.autoBehindY, panelModes, assets }) + ';\n');
    if (Object.keys(assets).length) console.log('graphics assets', Object.keys(assets).length);
  }
}
const b = await chromium.launch({ executablePath: findChrome() });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(join(ROOT, 'overlay.html')).href, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
if ((await p.evaluate(() => window.__logo)) === false) { console.error('logo failed to load (check "logo" in captions.js or theme.logo)'); await b.close(); process.exit(1); }
console.log('theme', await p.evaluate(() => window.__theme));
// layout pass (overlay.html): what moved clear of a graphic, what hid while one was up, what the export's safe area moved.
// layout.json is read by npm run verify. BOXES_AT=t1,t2 measures every element on screen at those times into boxes.json and stops.
{ const LAY = await p.evaluate(() => (window.__layout ? window.__layout() : null));
  if (LAY) {
    writeFileSync(join(ROOT, 'layout.json'), JSON.stringify(LAY, null, 1) + '\n');
    const n = a => LAY.elements.filter(e => e.action === a).length, sh = n('shift'), hd = n('hide'), sa = n('safe-area');
    if (sh || hd) console.log(`layout: ${sh} caption or title moved clear of a graphic, ${hd} hidden while a graphic is up (layout.json)`);
    if (LAY.export) console.log(`export ${LAY.export}: safe area ${JSON.stringify(LAY.safe)}, ${sa} element${sa === 1 ? '' : 's'} placed inside it`);
  }
  if (process.env.BOXES_AT) {
    const ts = process.env.BOXES_AT.split(',').map(Number).filter(x => !isNaN(x)), out = [];
    for (const t of ts) out.push({ t, boxes: await p.evaluate(t => window.__boxesAt(t), t) });
    writeFileSync(join(ROOT, 'boxes.json'), JSON.stringify(out, null, 1) + '\n');
    console.log('boxes', ts.length, 'moments -> boxes.json'); await b.close(); process.exit(0);
  }
}
// Behind-head titles (mode 7, layer behind) get their own layer, ovlt/, so assemble.cjs can draw them behind the person; ovl/ then
// holds front titles, partner words and captions. Stills always show every layer together.
const titles = await p.evaluate(() => window.__titles || []);
const layered = titles.length > 0 || !!(await p.evaluate(() => (window.__layered ? window.__layered() : false)));
const gfx = await p.evaluate(() => (window.__graphics ? window.__graphics() : []));
const GNAME = Object.fromEntries(JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics.map(g => [g.mode, g.id]));
if (gfx.length) { writeFileSync(join(ROOT, 'graphics.json'), JSON.stringify(gfx, null, 1) + '\n'); console.log('graphics', gfx.map(g => `${g.start}s ${GNAME[g.mode] || 'mode ' + g.mode}${g.layer === 'behind' ? ' behind' : ''} ${g.asset}${!['placeholder', 'drawn'].includes(g.asset) && !g.loaded ? ' (asset failed to load)' : ''}`).join(', ')); }
// one-word captions: every spoken word gets its own slot, back to back (words.json, checked by npm run smoke)
const capLayer = await p.evaluate(() => window.__captionLayer || 'front');
if (capLayer === 'behind') console.log('captions: behind the person (on the title layer, under the mask)');
const words = await p.evaluate(() => window.__words || []);
if (words.length) { writeFileSync(join(ROOT, 'words.json'), JSON.stringify(words) + '\n'); const short = Math.min(...words.map(w => w.end - w.start)); console.log(`one-word captions: ${words.length} words, each up ${short.toFixed(2)} s or more`); }
if (titles.length) console.log('titles', titles.map(t => `${t.start}s ${t.entrance}${t.flicker ? '+flicker' : ''}${t.layer && t.layer !== 'front' ? ' ' + t.layer : ''}`).join(', '));
// Font lockups (titles and kinetic lines, two faces per phrase): written out so they can be checked without pixels
const lockups = await p.evaluate(() => (window.__lockups ? window.__lockups() : []));
writeFileSync(join(ROOT, 'lockups.json'), JSON.stringify(lockups, null, 1) + '\n');
// one-word captions: what each word shows as (face, size, the line building under a hero, on a card or not)
const ow = await p.evaluate(() => (window.__oneword ? window.__oneword() : []));
if (ow.length) { writeFileSync(join(ROOT, 'oneword.json'), JSON.stringify(ow, null, 1) + '\n'); console.log('oneword', ow.length, 'words,', ow.filter(w => w.face === 'hero').length, 'heroes,', ow.filter(w => w.card).length, 'on cards'); }
// two pairings on screen at once (with "fonts": "a,b,c" cycling) is a defect; smoke checks for this line
const mix = await p.evaluate(() => (window.__pairMix ? window.__pairMix() : []));
if (mix.length) console.log('pairing mix at', mix.map(m => m.join('/')).join(', '));
if (lockups.length) console.log('lockups', lockups.filter(l => l.kind === 'title').length, 'titles +', lockups.filter(l => l.kind === 'kinetic').length, 'lines,', [...new Set(lockups.map(l => l.arrange))].join('/'));
const split = !!(only && process.env.STILLS_LAYERS);
// screen cards behind the head get a third layer, ovlp/ (assemble.cjs: picture, panels, then the head over them)
const panels = !!(await p.evaluate(() => (window.__panels ? window.__panels() : false)));
writeFileSync(join(ROOT, 'layers.json'), JSON.stringify({ captions: capLayer, panels: panels ? 'behind' : 'front' }) + '\n');
if (panels) console.log('screen cards: behind the top of the head (panel layer, under the crown mask)');
const passes = split
  ? (layered ? [['stills-front', 'front'], ['stills-titles', 'titles'], ...(panels ? [['stills-panels', 'panels']] : [])] : [['stills-front', 'all']])
  : only ? [['stills', 'all']] : layered ? [['ovl', 'front'], ['ovlt', 'titles'], ...(panels ? [['ovlp', 'panels']] : [])] : [['ovl', 'all']];
if (!only && !layered) rmSync(join(ROOT, 'ovlt'), { recursive: true, force: true });
if (!only && !panels) rmSync(join(ROOT, 'ovlp'), { recursive: true, force: true });
const list = only || [...Array(Math.round(DUR * FPS)).keys()].map(f => f / FPS);
let i = 0;
for (const [d, layer] of passes) {
  const dir = join(ROOT, d); if (!only) rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  i = 0; for (const t of list) { await p.evaluate(([t, l]) => window.seek(t, l), [t, layer]); await p.screenshot({ path: join(dir, `${only ? ('t' + t.toFixed(2)) : String(i).padStart(4, '0')}.png`), omitBackground: true }); i++ }
}
console.log('frames', i, passes.map(x => x[0]).join(' + ')); await b.close();
