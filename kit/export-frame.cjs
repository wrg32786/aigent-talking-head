// A 4:5 (Instagram Feed) or 1:1 version of a reel that is its own edit, not a crop of the 9:16 one.
//
//   make({ jobDir, src, name, reel, out, base, masks, python, env }) -> { name, file, dir, size, label, window, layout, faceHits }
//
// What happens (the timing never changes, so no word is cut):
//   1. the window: kit/facewindow.cjs reads the face track of the picture (build/facezone.json, YuNet) and works out
//      where the 1080 x h frame sits at every frame: still inside a shot, an eased move at a cut, headroom kept
//   2. a build of its own, jobs/<job>/build-<name>/, beside build/ (so every "../clips/x.mp4" path still works): the
//      same cut.json and captions.js, plus cut.json "frame" (the window as a formula) and captions.js "exportFrame"
//      (the frame, fixed in the middle of the 1080x1920 canvas) and "faceTrack" (the face as that frame sees it)
//   3. kit/render.mjs draws the overlay again there: the layout pass puts every caption, title, sticker and card inside
//      the frame's safe area and off the face, and the face check counts what is left (facecheck.json)
//   4. kit/assemble.cjs (BASE = the picture) slides the picture and its masks under the fixed frame, fits full b-roll to
//      the frame, halves it for a split, and mixes the same sound
//   5. the frame is cut out and encoded with the preset's caps: reel-vN-feed-4x5.mp4 or reel-vN-square-1x1.mp4
// src is the build to copy: build/ right after a render (kit/reel.cjs), or the saved build beside a finished reel
// (reel-vN.build/, kit/export.mjs). Without a picture to reuse (base) it is assembled once here.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const KIT = __dirname, ROOT = path.dirname(KIT);
const X = require('./exports.cjs'), R = require('./rules.cjs'), FW = require('./facewindow.cjs'), SPL = require('./split.cjs');

const BIG = /\.(mp4|mov|m4v|mkv|webm|wav|mp3|m4a|aac|flac)$/i, GEN = /^(boxes|layout|facecheck|graphics|words|lockups|oneword|layers|legibility|window)\.json$|^(lockover|gfx)\.js$|^base\.sig$|^frame-chrome-.*\.png$|^overlay\.html$/i;
const lenOf = cut => (cut.segs || []).reduce((a, s) => a + (s.out - s.in) + (s.pad || 0), 0) + (cut.tail ?? 0.3);
const writeCaps = (f, caps) => fs.writeFileSync(f, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
// the picture of a cut, without the layers on it: two builds with the same key show the same base.mp4
const picKey = cut => JSON.stringify([(cut.segs || []).map(({ file, ...r }) => r), (cut.inserts || []).length, cut.finish || null, cut.punch || null, cut.tail ?? null]);

// every path in a cut.json or captions.js that points inside the source build (not "../somewhere") is pointed back at it
function repoint(o, src, dir, copied) {
  const fix = v => {
    if (typeof v !== 'string' || !v || v.length > 400 || /^([a-z]+:|\/|\.\.[\\/])/i.test(v) || path.isAbsolute(v) || !/\.[A-Za-z0-9]{2,5}$/.test(v) || /[\n%]/.test(v)) return v;
    if (copied.has(v)) return v;
    const abs = path.resolve(src, v); try { if (!fs.statSync(abs).isFile()) return v; } catch { return v; }
    return path.relative(dir, abs).split(path.sep).join('/');
  };
  const walk = x => { if (Array.isArray(x)) return x.map(walk); if (x && typeof x === 'object') { for (const k of Object.keys(x)) x[k] = walk(x[k]); return x; } return fix(x); };
  return walk(o);
}

// the face zones while a split or framed b-roll moves your picture (kit/split.cjs), on the frame's canvas
function splitZones(fz, cut, { mask, frame }) {
  const ins = (cut.inserts || []).filter(s => SPL.SPLIT.includes(s.place) && +s.dur > 0); if (!ins.length) return fz.zones;
  const zones = fz.zones.slice();
  for (const s of ins) {
    const g = SPL.layout(s, SPL.faceOver(fz, +s.at, +s.dur), { mask, frame });
    for (let i = Math.max(0, Math.floor(+s.at * fz.fps)); i < Math.min(zones.length, Math.ceil((+s.at + +s.dur) * fz.fps)); i++) zones[i] = SPL.mapZone(zones[i], g);
  }
  return zones;
}

function make({ jobDir, src, name, reel, out, base = null, masks = null, python = process.env.PYTHON || 'python3', env = {}, log = console.log, keep = false } = {}) {
  const P = X.get(name); if (!P || !X.isReframed(name)) throw new Error(`export-frame: ${name} is not a 4:5 or 1:1 size (${X.REFRAMED.join(', ')})`);
  src = path.resolve(src); const dir = path.join(path.resolve(jobDir), 'build-' + name);
  if (!fs.existsSync(path.join(src, 'cut.json'))) throw new Error('export-frame: no cut.json in ' + src);
  out = out || X.outName(reel, name);
  const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { cwd: dir, stdio: 'inherit', env: { ...process.env, ...env, ...extra } });
  // 2. the build of its own (kept between runs: the scene frames and a picture made here are reused)
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) { if (f === 'gfx' || f === 'base.mp4' || f === 'base.key' || f === 'facezone.json') continue; fs.rmSync(path.join(dir, f), { recursive: true, force: true }); }
  const copied = new Set();
  for (const f of fs.readdirSync(src)) { const p = path.join(src, f); if (!fs.statSync(p).isFile() || BIG.test(f) || GEN.test(f) || f === 'facezone.json' || f === 'cut.json' || f === 'captions.js') continue; fs.copyFileSync(p, path.join(dir, f)); copied.add(f); }
  const cut = repoint(JSON.parse(fs.readFileSync(path.join(src, 'cut.json'), 'utf8')), src, dir, copied);
  const LEN = lenOf(cut), fixedY = X.fixedY(name), frame = { y0: fixedY, h: P.h };
  delete cut.export;
  // the picture: the one a render just made, or one assembled here once (kept, keyed by the cut's picture)
  const key = crypto.createHash('sha1').update(picKey(cut)).digest('hex');
  let BASE = base && fs.existsSync(base) ? path.resolve(base) : null;
  if (!BASE) {
    const bf = path.join(dir, 'base.mp4'), kf = path.join(dir, 'base.key');
    if (!(fs.existsSync(bf) && fs.existsSync(kf) && fs.readFileSync(kf, 'utf8') === key)) {
      fs.writeFileSync(path.join(dir, 'cut.json'), JSON.stringify(cut, null, 1));
      run(process.execPath, [path.join(KIT, 'assemble.cjs'), 'base.mp4'], { BASEONLY: '1', BASE: '' }); fs.writeFileSync(kf, key);
    }
    BASE = bf;
  }
  // the person masks of the 9:16 render are reused (they slide with the picture); without them everything is in front
  const mdir = masks && fs.existsSync(masks) ? path.resolve(masks) : null, spec = R.maskSpec(cut);
  const maskAt = f => (f && mdir && fs.existsSync(path.join(mdir, path.basename(f))) ? path.relative(dir, path.join(mdir, path.basename(f))).split(path.sep).join('/') : null);
  const mk = maskAt(spec.file), pr = maskAt(spec.person), hm = maskAt(cut.headMask);
  if (mk) { cut.mask = mk; if (pr) cut.person = pr; else delete cut.person; } else { delete cut.mask; delete cut.person; delete cut.maskModel; }
  if (hm && mk) cut.headMask = hm; else delete cut.headMask;
  // 1. the window, from the face in the picture
  let fz = null;
  const fzSrc = path.join(path.dirname(BASE), 'facezone.json');
  try { if (fs.existsSync(fzSrc)) fz = JSON.parse(fs.readFileSync(fzSrc, 'utf8')); } catch {}
  if (!fz) {
    try {
      const fxPy = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      execFileSync(fs.existsSync(fxPy) ? fxPy : python, [path.join(KIT, 'facezone.py'), BASE, path.join(dir, 'facezone.json')], { cwd: dir, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
      fz = JSON.parse(fs.readFileSync(path.join(dir, 'facezone.json'), 'utf8'));
    } catch (e) { log(`note: no face track (${String(e.message).split('\n')[0]}); the ${P.w}x${P.h} frame stays in one place`); }
  }
  const tr = FW.track(fz || { fps: 8, zones: [] }, { h: P.h, len: LEN, cuts: R.timeline(cut).seams, fallback: P.y0 });
  cut.frame = { name, w: P.w, h: P.h, y0: fixedY, expr: tr.expr(), safe: { ...P.safe } };
  fs.writeFileSync(path.join(dir, 'cut.json'), JSON.stringify(cut, null, 1));
  const st = tr.stats;
  log(`${name}: the ${P.w}x${P.h} frame follows the face over ${st.shots} shot${st.shots === 1 ? '' : 's'} (${st.still} held still, ${st.moves} eased move${st.moves === 1 ? '' : 's'} at cuts, top edge ${st.min} to ${st.max} px, at most ${st.maxStep} px a frame)`);
  if (st.faceOutside) log(`note: the face reaches the frame edge in ${st.faceOutside} of ${st.faceFrames} frames`);
  // the face as this frame sees it, on the frame's canvas, for the layout pass and the face check
  const capF = path.join(dir, 'captions.js'), hasCaps = fs.existsSync(path.join(src, 'captions.js'));
  let shifted = null;
  if (fz) {
    shifted = { ...fz, zones: FW.shiftZones(fz, tr, fixedY), sig: null };
    fs.writeFileSync(path.join(dir, 'facezone.json'), JSON.stringify(shifted)); // kit/assemble.cjs reads it for the split layouts
  } else fs.rmSync(path.join(dir, 'facezone.json'), { force: true });
  fs.writeFileSync(path.join(dir, 'window.json'), JSON.stringify({ name, w: P.w, h: P.h, fixedY, fps: tr.fps, stats: st, shots: tr.shots, moves: tr.moves, ramps: tr.ramps, c0: tr.c0, expr: cut.frame.expr }, null, 1) + '\n');
  if (hasCaps) {
    const caps = repoint(R.readCaptions(path.join(src, 'captions.js')), src, dir, copied);
    caps.exportFrame = X.frameOf(name);
    if (shifted) caps.faceTrack = { fps: fz.fps, zones: splitZones(shifted, cut, { mask: !!mk, frame }) }; else delete caps.faceTrack;
    if (mk) delete caps.personMask; else caps.personMask = false;
    writeCaps(capF, caps);
    // 3. the overlay, laid out for this frame
    run(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)]);
    let lj = {}; try { lj = JSON.parse(fs.readFileSync(path.join(dir, 'layers.json'), 'utf8')); } catch {}
    const want = lj.panels === 'behind' ? 'ovlp/%04d.png' : undefined;
    if (cut.panels !== want) { if (want) cut.panels = want; else { delete cut.panels; delete cut.headMask; } fs.writeFileSync(path.join(dir, 'cut.json'), JSON.stringify(cut, null, 1)); }
  }
  // 4. picture, masks, b-roll and sound, then 5. the frame cut out of it
  const full = path.join(dir, 'full.mp4');
  run(process.execPath, [path.join(KIT, 'assemble.cjs'), full], { BASE, BASEONLY: '', ...(mk ? {} : { MASK_WARNED: '1' }) });
  if (LEN > P.maxSec) log(`note: the reel is ${LEN.toFixed(1)} s, longer than ${P.label} allows (${P.maxSec} s); this version is trimmed`);
  execFileSync('ffmpeg', X.ffmpegArgs(name, full, out, LEN, { y0: fixedY }), { stdio: 'inherit' });
  if (!keep) fs.rmSync(full, { force: true });
  let LAY = null, FC = null; try { LAY = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8')); } catch {} try { FC = JSON.parse(fs.readFileSync(path.join(dir, 'facecheck.json'), 'utf8')); } catch {}
  const n = a => (LAY ? LAY.elements.filter(e => String(e.action).includes(a)).length : 0);
  const layout = LAY ? { safeArea: n('safe-area'), moved: n('shift'), hidden: LAY.elements.filter(e => e.action === 'hide').length, face: n('face') } : null;
  log(`${name}: ${out}${layout ? ` (${layout.safeArea} placed inside the frame, ${layout.face} moved off the face${FC ? ', ' + FC.overlapMoments + ' moments with text on the face' : ''})` : ''}`);
  return { name, file: out, dir, size: `${P.w}x${P.h}`, label: P.use || P.label, seconds: +Math.min(LEN, P.maxSec).toFixed(2), window: st, layout, faceHits: FC ? FC.overlapMoments : null, masks: !!mk };
}

module.exports = { make, picKey, lenOf, splitZones };
