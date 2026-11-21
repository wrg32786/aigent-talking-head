import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, existsSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { resolveFonts } from './fonts.mjs';
import { createRequire } from 'module';
import { dirname, join, isAbsolute } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { findChrome } from './chrome.mjs';
import * as FC from './framecap.mjs';
const SPL = createRequire(import.meta.url)('./split.cjs');
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
    // Pairing rule (Will, 2026-11-18): a pair is bold with thin, the contrast is the pair. "contrast": "low" marks thin-with-thin pairs.
    for (const s of sets) if (s && s.contrast === 'low') console.warn(`note: font pairing "${s.name}" is thin with thin (low contrast); pair a bold face with a thin one, and set a script on top of a big bold word`);
    if (sets.length > 1) console.log('font cycle', sets.map(s => s.name).join(' > '));
    if (fp) console.log('fonts', fp.name, [fp.display, fp.secondary, fp.script].filter(Boolean).map(r => r.family).join(' + '));
  }
  // font lockup overrides from cut.json ("lockup" for the job, "hero" per flip start) -> lockover.js
  { let C = {}; try { C = JSON.parse(readFileSync(join(ROOT, 'cut.json'), 'utf8')); } catch {}
    writeFileSync(join(ROOT, 'lockover.js'), 'window.LOCKOVER=' + JSON.stringify({ lockup: C.lockup || null, hero: C.hero || null, titleLayer: C.titleLayer || null, inserts: [...(C.inserts || []).filter(s => !s.place || s.place === 'full').map(s => ({ at: +s.at, dur: +s.dur, y: s.y, tint: s.tint, line: s.line, arc: s.arc })),
      // split and framed b-roll (kit/split.cjs): the captions sit on the line the layout leaves for them, off your face
      ...(C.inserts || []).filter(s => SPL.SPLIT.includes(s.place)).map(s => ({ at: +s.at, dur: +s.dur, y: s.y || SPL.layout(s, null, { mask: !!C.mask, frame: C.frame || null }).capY, tint: s.tint, split: s.place, light: SPL.lightBg(s) }))] }) + ';\n'); }
  if (!existsSync(join(ROOT, 'fxzones.js'))) writeFileSync(join(ROOT, 'fxzones.js'), 'window.FXZONES=[];\n');
  // graphics (modes 10, 11, 19 and 26): icon and screen images as file URLs; a screen recording becomes a short frame list
  // (build/gfx/, 12 fps) so the card can play it frame-accurately. Fonts for the ordinal word, the label, the code
  // card, the split-flap and flash-card face (Anton) and the terminal (JetBrains Mono), and each graphic's default place and layer rule from kit/graphics.json.
  { const assets = {}, VID = /\.(mp4|mov|m4v|webm|mkv)$/i, url = f => pathToFileURL(f).href;
    // scenes (mode 39, kit/scenes.cjs): drawn once to clear PNG frames at their box's size with the Make card renderer
    // (kit/broll-make.mjs), cached by what they draw in build/gfx/scene-<hash>/, then played frame by frame
    { const SC = createRequire(import.meta.url)('./scenes.cjs'), jobs = [], keys = [];
      for (const f of CAP.flips || []) {
        if (f.mode !== 39 || !f.html) continue;
        // a full-frame scene on a 4:5 or 1:1 version (captions.js exportFrame, reframed) is drawn at that frame's size, so
        // its HTML lays itself out again instead of being cropped (kit/overlay.html places it on the frame)
        const XF = CAP.exportFrame && CAP.exportFrame.reframed ? CAP.exportFrame : null, fullScene = (+f.w || 1) >= 0.98 && (+f.h || 1) >= 0.98;
        const page = SC.page(f, f.text), w = Math.round((+f.w || 1) * 1080), h = XF && fullScene ? Math.round(+XF.h) : Math.round((+f.h || 1) * 1920), secs = +f.seconds || 2;
        const dir = join(ROOT, 'gfx', 'scene-' + createHash('sha1').update(JSON.stringify([page, w, h, secs])).digest('hex').slice(0, 16));
        const done = existsSync(join(dir, 'done')) ? readdirSync(dir).filter(x => x.endsWith('.png')).sort().map(x => join(dir, x)) : null;
        keys.push([f.mode + '@' + f.start, dir, done]); if (!done) jobs.push({ page, w, h, seconds: secs, dir });
      }
      if (jobs.length) {
        const t0 = Date.now(); for (const j of jobs) rmSync(j.dir, { recursive: true, force: true });
        await (await import('./studio/broll-make.mjs')).sceneFrames(jobs);
        for (const j of jobs) writeFileSync(join(j.dir, 'done'), '');
        console.log(`scenes: ${jobs.length} drawn in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
      for (const [key, dir] of keys) assets[key] = { fps: 24, scene: true, frames: readdirSync(dir).filter(x => x.endsWith('.png')).sort().map(x => url(join(dir, x))) };
    }
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
    // logos (captions.js "logo", a brand plate's "logo", theme.logo.src) go to the page as data URLs, not file URLs: an
    // image from a file taints the canvas, and the face check (getImageData) then throws and stops the render
    const MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    const dataUrl = abs => { const m = MIME[(abs.split('.').pop() || '').toLowerCase()]; return m ? `data:${m};base64,${readFileSync(abs).toString('base64')}` : null; };
    let TH = {}; try { const g = {}; new Function('window', readFileSync(join(ROOT, 'theme.js'), 'utf8'))(g); TH = g.THEME || {}; } catch {}
    const DATAURLS = {};
    for (const ref of [CAP.logo, CAP.theme && CAP.theme.logo && CAP.theme.logo.src, TH.logo && TH.logo.src, ...(CAP.flips || []).map(f => f && f.logo)]) {
      if (typeof ref !== 'string' || !ref || /^(data|https?|file):/i.test(ref) || DATAURLS[ref]) continue;
      const abs = isAbsolute(ref) ? ref : join(ROOT, ref);
      if (!existsSync(abs)) { console.warn(`logo ${ref}: no such file`); continue; }
      const u = dataUrl(abs); if (u) DATAURLS[ref] = u; else console.warn(`logo ${ref}: not an .svg, .png, .webp or .jpg`);
    }
    // graphic images (icons, screens) the same way. A screen recording's frames go in as data URLs too, up to 96 MB in
    // all: a frame from a file taints the canvas, which kept the layout pass from moving captions clear of the card
    // (they were drawn over the recording) and stops the fast frame capture (kit/framecap.mjs). Past the budget they
    // stay files and the capture falls back to screenshots once a card shows.
    for (const a of Object.values(assets)) for (const k of ['icon', 'src']) if (a[k] && a[k].startsWith('file:')) { const u = dataUrl(fileURLToPath(a[k])); if (u) a[k] = u; }
    { let budget = 96 * 2 ** 20;
      for (const a of Object.values(assets)) if (a.frames) {
        const size = a.frames.reduce((n, u) => n + (u.startsWith('file:') ? statSync(fileURLToPath(u)).size : 0), 0) * 4 / 3;
        if (size > budget) continue;
        budget -= size; a.frames = a.frames.map(u => u.startsWith('file:') ? dataUrl(fileURLToPath(u)) || u : u);
      } }
    const F = join(KIT, 'fonts');
    const GJ = JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8'));
    const defaults = Object.fromEntries(GJ.graphics.map(g => [g.mode, g.defaults || {}])), panelModes = GJ.graphics.filter(g => g.mode >= 11).map(g => g.mode);
    writeFileSync(join(ROOT, 'gfx.js'), 'window.GFX=' + JSON.stringify({ fonts: { serif: url(join(F, 'InstrumentSerif-Italic.ttf')), label: url(join(F, 'ArchivoBlack-Regular.ttf')), mono: url(join(F, 'RedHatMono-VF.ttf')), slam: url(join(F, 'Anton-Regular.ttf')), code: url(join(F, 'JetBrainsMono-VF.ttf')) }, defaults, autoBehindY: GJ.autoBehindY, panelModes, assets }) + ';\nwindow.DATAURLS=' + JSON.stringify(DATAURLS) + ';\n');
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
  if (await p.evaluate(() => window.CAPTIONS && window.CAPTIONS.layout === false)) console.log('layout: off ("layout": false in captions.js): captions and titles are not moved off graphics, and verify will flag every overlap');
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
// text check (overlay.html __textCheck): on every frame, every text element on screen (a caption's current word, a title,
// a sticker word) is measured alone where it is drawn, and any two that share area are listed. textcheck.json; npm run
// verify fails on any clash, reel.cjs prints the count. TEXTCHECK=0 skips it; TEXTCHECK=only writes it and stops.
if ((!only || process.env.TEXTCHECK === 'only') && process.env.TEXTCHECK !== '0' && (await p.evaluate(() => !!window.__textCheck))) {
  const r = await p.evaluate(([d, f]) => window.__textCheck(d, f), [DUR, FPS]), pairs = new Map();
  for (const c of r.clashes) { const k = c.a + '|' + c.b, e = pairs.get(k) || { a: c.a, b: c.b, kinds: c.kinds, from: c.t, frames: 0, maxPx: 0 }; e.frames++; e.to = c.t; e.maxPx = Math.max(e.maxPx, c.px); pairs.set(k, e); }
  const lay = await p.evaluate(() => (window.__layout ? window.__layout() : { elements: [] }));
  const moved = lay.elements.filter(e => e.texts).flatMap(e => e.texts.map(x => ({ kind: e.kind, text: x.word || e.text, ...x })));
  const tc = { frames: r.frames, together: r.together, clashFrames: new Set(r.clashes.map(c => c.t)).size, pairs: [...pairs.values()], moved, clashes: r.clashes.slice(0, 200) };
  writeFileSync(join(ROOT, 'textcheck.json'), JSON.stringify(tc, null, 1) + '\n');
  console.log(`text check: ${tc.clashFrames} of ${r.frames} frames with two words on the same spot; layout stacked ${moved.filter(m => m.move).length} and held back ${moved.filter(m => m.hide).length} to keep words apart (textcheck.json)`);
  for (const e of tc.pairs) console.warn(`WARNING: "${e.a}" and "${e.b}" overlap from ${e.from}s for ${e.frames} frame${e.frames === 1 ? '' : 's'} (up to ${e.maxPx} px)`);
  if (process.env.TEXTCHECK === 'only') { writeFileSync(join(ROOT, 'words.json'), JSON.stringify(await p.evaluate(() => window.__words || [])) + '\n'); await b.close(); process.exit(0); }
}
// face check (kit/facezone.py -> captions.js faceTrack): at 8 moments a second, every caption, title and kinetic word is
// drawn alone with its layout and the letter pixels inside the face zone are counted. facecheck.json; npm run verify fails
// on any hit, reel.cjs prints the count. FACECHECK=0 skips it.
if (!only && process.env.FACECHECK !== '0' && (await p.evaluate(() => !!(window.CAPTIONS && window.CAPTIONS.faceTrack && window.__faceInk)))) {
  const step = 1 / 8, hits = [], els = new Map(); let n = 0, withFace = 0;
  for (let t = 0; t < DUR; t += step) {
    const r = await p.evaluate(t => window.__faceInk(t), +t.toFixed(3)); n++;
    if (!r) continue; withFace++;
    for (const h of r.hits) { if (h.px < 200) continue; hits.push({ t: +t.toFixed(2), ...h }); const k = h.mode + '@' + h.start; els.set(k, { kind: h.kind, mode: h.mode, start: h.start, text: h.text, moments: ((els.get(k) || {}).moments || 0) + 1, maxPx: Math.max(h.px, (els.get(k) || {}).maxPx || 0) }); }
  }
  const lay = await p.evaluate(() => (window.__layout ? window.__layout() : { elements: [] }));
  const moved = lay.elements.filter(e => /face/.test(e.action)).map(e => ({ kind: e.kind, start: e.start, text: e.text, action: e.action, move: e.move || null }));
  const tainted = await p.evaluate(() => !!window.__faceTainted);
  if (tainted) console.warn('WARNING: an image from a file is drawn with the text, so the face check could not read every moment. Pass images as data URLs.');
  const fc = { samples: n, withFace, ...(tainted ? { tainted: true } : {}), faceSafe: !!lay.faceSafe, overlapMoments: new Set(hits.map(h => h.t)).size, elements: [...els.values()], moved, hits: hits.slice(0, 200) };
  writeFileSync(join(ROOT, 'facecheck.json'), JSON.stringify(fc, null, 1) + '\n');
  console.log(`face check: ${fc.overlapMoments} of ${withFace} moments with text on the face zone (${fc.elements.length} element${fc.elements.length === 1 ? '' : 's'}); layout moved ${moved.filter(m => !/hide/.test(m.action)).length} and hid ${moved.filter(m => /hide/.test(m.action)).length} for the face (facecheck.json)`);
  for (const e of fc.elements) console.warn(`WARNING: ${e.kind} "${e.text}" at ${e.start}s covers the face zone at ${e.moments} moment${e.moments === 1 ? '' : 's'} (up to ${e.maxPx} px)`);
}
// Behind-head titles (mode 7, layer behind) get their own layer, ovlt/, so assemble.cjs can draw them behind the person; ovl/ then
// holds front titles, partner words and captions. Stills always show every layer together.
const titles = await p.evaluate(() => window.__titles || []);
const layered = titles.length > 0 || !!(await p.evaluate(() => (window.__layered ? window.__layered() : false)));
const gfx = await p.evaluate(() => (window.__graphics ? window.__graphics() : []));
const GNAME = Object.fromEntries(JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics.map(g => [g.mode, g.id]).concat([[39, 'scene']]));
if (gfx.length) { writeFileSync(join(ROOT, 'graphics.json'), JSON.stringify(gfx, null, 1) + '\n'); console.log('graphics', gfx.map(g => `${g.start}s ${GNAME[g.mode] || 'mode ' + g.mode}${g.layer === 'behind' ? ' behind' : ''} ${g.asset}${!['placeholder', 'drawn', 'html'].includes(g.asset) && !g.loaded ? ' (asset failed to load)' : ''}`).join(', ')); }
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
const name = (k) => `${only ? ('t' + list[k].toFixed(2)) : String(k).padStart(4, '0')}.png`;
// Frames: Chrome encodes the canvas to PNG on worker threads while the page draws the next frame (kit/framecap.mjs),
// with up to 3 pages drawing at once; same pixels as a screenshot, several times faster. RENDER_CAPTURE=screenshot
// uses page screenshots; any error on the fast path falls back to screenshots from that frame on.
const MODE = String(process.env.RENDER_CAPTURE || 'auto').toLowerCase(), FAIL_AT = +(process.env.RENDER_CAPTURE_FAIL_AT || -1);
const t0 = Date.now(), frames = list.length * passes.length;
const pages = [{ p, fast: false }];
if (MODE !== 'screenshot') {
  const want = only ? 1 : process.env.RENDER_PAGES ? FC.pickPages() : Math.min(FC.pickPages(), Math.max(1, Math.floor(list.length / 48)));
  for (let k = 1; k < want; k++) {
    try {
      const q = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
      await q.goto(pathToFileURL(join(ROOT, 'overlay.html')).href, { waitUntil: 'networkidle' });
      await q.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
      pages.push({ p: q, fast: false });
    } catch (e) { console.warn('note: could not open another drawing page (' + String(e.message || e).split('\n')[0] + '), going on with ' + pages.length); break; }
  }
  const W = FC.pickWorkers(undefined, pages.length);
  const why = await Promise.all(pages.map(x => FC.install(x.p, W)));
  why.forEach((w, k) => { pages[k].fast = !w; if (w) console.warn('note: fast frame capture is off (' + w + '); using screenshots'); });
}
await Promise.all(pages.map(x => FC.warm(x.p, only ? list : FC.warmTimes(DUR))));
const startedFast = pages.some(x => x.fast), fellBack = new Set();
const shot = async (pg, dir, ts, ks, layer) => { for (let j = 0; j < ts.length; j++) { await pg.p.evaluate(([t, l]) => window.seek(t, l), [ts[j], layer]); await pg.p.screenshot({ path: join(dir, name(ks[j])), omitBackground: true }); } };
let i = 0;
for (const [d, layer] of passes) {
  const dir = join(ROOT, d); if (!only) rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  // a queue of short runs of frames; each page takes the next run when it is free
  const runs = []; for (let k = 0; k < list.length; k += FC.BATCH) runs.push([...Array(Math.min(FC.BATCH, list.length - k)).keys()].map(j => k + j));
  let nextRun = 0;
  await Promise.all(pages.map(async pg => {
    while (nextRun < runs.length) {
      const ks = runs[nextRun++], ts = ks.map(k => list[k]);
      if (pg.fast) {
        try {
          if (FAIL_AT >= 0 && ks.some(k => k >= FAIL_AT)) throw new Error('RENDER_CAPTURE_FAIL_AT test');
          const bufs = await FC.batch(pg.p, ts, layer);
          bufs.forEach((buf, j) => writeFileSync(join(dir, name(ks[j])), buf));
          continue;
        } catch (e) {
          pg.fast = false;
          const raw = String(e.message || e), m = /origin-clean|taint|SecurityError/i.test(raw) ? 'an image from a file is on the canvas' : (raw.split('\n').find(l => /error|test|fail/i.test(l)) || raw.split('\n')[0]).replace(/^page\.evaluate:\s*/, '').trim();
          if (!fellBack.size) console.warn(`note: fast frame capture stopped at frame ${ks[0]} (${m}); screenshots from there on`);
          fellBack.add(ks[0]);
        }
      }
      await shot(pg, dir, ts, ks, layer);
    }
  }));
  i = list.length;
}
const secs = (Date.now() - t0) / 1000;
console.log(`capture: ${frames} frames in ${secs.toFixed(1)} s (${(frames / Math.max(secs, 0.001)).toFixed(0)} fps), ${startedFast ? (fellBack.size ? 'in-page PNG, then screenshots' : 'in-page PNG') : 'screenshots'}, ${pages.length} page${pages.length === 1 ? '' : 's'}`);
// Chrome saves a fully opaque frame (a colour card) as an RGB PNG inside an otherwise RGBA sequence, and ffmpeg can drop
// those frames when the pixel format changes mid-sequence (the card vanished from some renders). Rewrite them as RGBA.
if (!only) {
  let fixed = 0;
  for (const [d] of passes) for (const fn of readdirSync(join(ROOT, d))) {
    const fp = join(ROOT, d, fn);
    if (!fn.endsWith('.png') || readFileSync(fp).subarray(25, 26)[0] !== 2) continue; // PNG colour type 2 = RGB, no alpha
    try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fp, '-pix_fmt', 'rgba', fp + '.rgba.png'], { stdio: 'ignore' }); renameSync(fp + '.rgba.png', fp); fixed++; }
    catch { console.warn('note: could not rewrite opaque frame ' + fn + ' as RGBA (ffmpeg missing?)'); break; }
  }
  if (fixed) console.log(`opaque frames: ${fixed} rewritten as RGBA so the frame sequence keeps one pixel format`);
}
console.log('frames', i, passes.map(x => x[0]).join(' + ')); await b.close();
