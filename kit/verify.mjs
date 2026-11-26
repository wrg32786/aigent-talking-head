// Verify a reel before delivery. Mandatory before you hand a reel over.
//   npm run verify -- <job>                 -> newest reel in jobs/<job>/ (reel-fx-vN.mp4 or reel-vN.mp4)
//   npm run verify -- <job> --file x.mp4    -> that file, against the job's cut.json and captions.js
//   options: --jobs <dir>, --fps 24 (expected frame rate; default cut.json "fps" or 24, this kit's format)
//   --export tiktok|reels|shorts|feed45|square  check that export (reel-vN-<name>.mp4): its size, length cap, and that every
//     title, caption and graphic sits inside the platform's safe area (the stills show the UI zones in red)
//   --json  print one JSON result line at the end ({ ok, file, fails, notes, stills, contact })
// Writes jobs/<job>/verify/: one still per check point and contact.png (all of them), plus report.md.
//   Check points: every kinetic title mid-entrance and settled, the payoff, both big-punch frames, the first caption, and
//   the middle of every graphic's window.
//   Overlap: every element on screen at those moments is measured from its own pixels (render.mjs BOXES_AT); a graphic,
//   caption or title that sits on another one fails (the layout pass in overlay.html moves or hides captions and titles).
//   ffprobe: 1080x1920, the frame rate, H.264 + AAC at 48 kHz, duration = the cut's length.
//   Loudness: integrated LUFS and true peak (target -14 LUFS, peak <= -1 dBTP).
//   Picture: more than three luminance or red flashes in any second fails, including across effects (WCAG 2.3.1).
//   Freeze and black outside planned holds and dips fail. Flicker, clipping, blur and cut count are notes. When the measurements and stills disagree
//   about motion, a freeze or black, the numbers win.
//   Joins (kit/joins.cjs): every cut as a pair of frames; a cut that hardly changes the picture or a colour jump the plan
//   does not declare is a note with both stills (verify/join-*.png, joins.json), never a FAIL.
//   Titles: every frame from two before a title's start to five after, and the same at its end, read from the drawn text
//   layer (build/ovl): no caption word in the bar while a title is up, none of its own words in the bar outside it.
//   Mask: measure alpha at each title. A patch that matches the room gets a note and a still for review.
//   Copy lint: the same check as `npm run check`.
// Exit 1 on any failure. Then READ every still: titles readable and behind the head only, pills legible, punch frames
// framed, end card clean. A probe proves the file is right; your eye on the stills proves it looks right.
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'fs';
import { join, resolve, dirname, basename, parse } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const R = createRequire(import.meta.url)('./rules.cjs');
const X = createRequire(import.meta.url)('./exports.cjs');
const PIC = createRequire(import.meta.url)('./picturecheck.cjs');
const JOINS = createRequire(import.meta.url)('./joins.cjs');
import { titleCheck } from './titlecheck.mjs';
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['file', 'jobs', 'fps', 'export']);
const JSON_OUT = argv.includes('--json');
const EXN = opt('export') ? String(opt('export')).toLowerCase() : null, EXP = EXN ? X.get(EXN) : null;
if (EXN && !EXP) { console.error('--export must be ' + X.NAMES.join(', ')); process.exit(1); }
const name = argv.find((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
if (!name) { console.error('Usage: npm run verify -- <job> [--file reel.mp4]'); process.exit(1); }
let job = resolve(opt('jobs', join(ROOT, 'jobs')), name);
if (!existsSync(job) && existsSync(resolve(name))) job = resolve(name);
// a 4:5 or 1:1 version is its own build (jobs/<job>/build-<name>/, kit/export-frame.cjs): its layout, face check and
// window are checked there, against its own file (reel-vN-feed-4x5.mp4, reel-vN-square-1x1.mp4)
const XBUILD = EXN && X.isReframed(EXN) && existsSync(join(job, 'build-' + EXN, 'cut.json'));
const build = XBUILD ? join(job, 'build-' + EXN) : join(job, 'build');
if (!existsSync(join(build, 'cut.json'))) { console.error('No ' + join(build, 'cut.json')); process.exit(1); }
const sh = (c, a) => execFileSync(c, a, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).toString();
const stderrOf = (c, a) => String(spawnSync(c, a, { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr || '');

let file = opt('file');
if (!file) {
  const reels = readdirSync(job).filter(f => (EXN ? new RegExp(`^reel(-fx)?-v\\d+-(${EXN}|${X.suffixOf(EXN)})\\.mp4$`) : /^reel(-fx)?-v\d+\.mp4$/).test(f)).map(f => join(job, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!reels.length) { console.error(EXN ? `No reel-vN-${X.suffixOf(EXN)}.mp4 in ${job} (npm run export -- ${name} --export ${EXN})` : 'No reel-vN.mp4 in ' + job); process.exit(1); }
  file = reels[0];
}
file = resolve(file);
const C = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')), TL = R.timeline(C);
const CAP = existsSync(join(build, 'captions.js')) ? R.readCaptions(join(build, 'captions.js')) : { flips: [] };
const FPS = +opt('fps', C.fps || 24);
const notes = [], lines = [];
const ok = (cond, msg) => { lines.push((cond ? 'ok    ' : 'FAIL  ') + msg); return !!cond; };

// 1. ffprobe
const j = JSON.parse(sh('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration', '-of', 'json', file]));
const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
const fr = v ? v.r_frame_rate.split('/').reduce((x, y) => x / y) : 0, dur = +j.format.duration;
const WANT = EXP ? [EXP.w, EXP.h] : [1080, 1920], TOTAL = EXP ? X.endOf(EXN, TL.total, X.wordsOf(CAP)) : TL.total;
ok(v && v.width === WANT[0] && v.height === WANT[1], `video ${v ? v.width + 'x' + v.height : 'missing'} (${WANT.join('x')}${EXP ? ', ' + EXP.label : ''})`);
ok(v && Math.abs(fr - FPS) < 0.01, `frame rate ${fr.toFixed(3)} (${FPS})`);
ok(v && v.codec_name === 'h264', `video codec ${v && v.codec_name} (h264)`);
ok(a && a.codec_name === 'aac', `audio codec ${a ? a.codec_name : 'missing'} (aac)`);
ok(a && +a.sample_rate === 48000, `audio ${a ? a.sample_rate : '-'} Hz (48000; some players refuse 96 kHz)`);
ok(Math.abs(dur - TOTAL) < 0.15, `duration ${dur.toFixed(2)} s (cut.json says ${TL.total.toFixed(2)} s${EXP && TL.total > EXP.maxSec ? ', capped at ' + EXP.maxSec + ' s' : ''})`);

// 2. loudness
const ebOut = stderrOf('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
const summ = (ebOut.split('Summary:')[1] || '');
const I = +(summ.match(/I:\s+(-?[0-9.]+) LUFS/) || [])[1], TP = +(summ.match(/Peak:\s+(-?[0-9.]+) dBFS/) || [])[1];
if (Number.isNaN(I)) notes.push('loudness: could not read ebur128 output');
else {
  ok(I > -15.5 && I < -12.5, `loudness ${I.toFixed(1)} LUFS integrated (target -14)`);
  ok(Number.isNaN(TP) || TP <= -0.5, `true peak ${Number.isNaN(TP) ? '?' : TP.toFixed(1)} dBTP (<= -1 target)`);
}

// 2b. Flash counts cover the whole reel. Freeze and black have planned exceptions.
{ const pj = PIC.judge(PIC.measure(file, dur), PIC.exempt(C, CAP), { fxPass: /^reel-fx-/.test(basename(file)) });
  pj.fails.forEach(m => ok(false, m)); pj.oks.forEach(m => ok(true, m)); pj.notes.forEach(m => notes.push(m)); }

// 3. check points -> stills + contact sheet
const pts = [];
const titles = R.resolveTitles(CAP);
for (const t of titles) {
  const end = Math.min(t.end, TL.total - 0.05);
  // mid-entrance: the first frame 0.12 s or more in that is not a flicker blackout (frames 2,4,5,9,11 of a flicker title)
  let fi = Math.ceil((t.start + 0.12) * FPS); while (t.flicker && [2, 4, 5, 9, 11].includes(Math.floor((fi / FPS - t.start) * 24 + 1e-6))) fi++;
  pts.push([fi / FPS, `${t.role} title mid ${t.entrance}`]);
  pts.push([Math.min(end - 0.04, t.start + R.TITLE_ENTER + 0.2), `${t.role} title settled`]);
}
const firstCap = (CAP.flips || []).filter(f => f.mode === 0).sort((x, y) => x.start - y.start)[0];
if (firstCap) pts.push([firstCap.start + Math.min(0.5, (firstCap.end - firstCap.start) / 2), `caption (${firstCap.style || CAP.captionStyle || 'classic'})`]);
if (!titles.length) {
  const last = (CAP.flips || []).slice().sort((x, y) => y.start - x.start)[0];
  pts.push([last ? Math.min(TL.total - 0.1, last.start + 0.6) : TL.total - 0.5, 'payoff']);
}
// the middle of every graphic's window: the moment it is fully up, where overlap would show
const GNAME = Object.fromEntries(JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics.map(g => [g.mode, g.id]));
const GRAPHIC = f => f.mode !== 0 && f.mode !== 7;
const gfxPts = (CAP.flips || []).filter(GRAPHIC).map(f => { const e = Math.min(f.end > 90 ? f.start + 4 : f.end, TL.total - 0.05); return [(f.start + e) / 2, `graphic ${GNAME[f.mode] || 'mode ' + f.mode} mid`]; }).filter(p => p[0] < TL.total);
pts.push(...gfxPts);
TL.segs.forEach(s => { if (s.s.bigPunch) pts.push([s.start + R.PUNCH.bigDur + 0.05, `big punch seg ${s.i}`]); }); // pushed in, past the glitch seam
if (!TL.segs.some(s => s.s.bigPunch) && TL.seams.length) pts.push([TL.seams[0] + 0.1, 'first cut']);
pts.sort((x, y) => x[0] - y[0]);
const inFile = t => t < dur - 0.02;
for (let k = pts.length - 1; k >= 0; k--) if (!inFile(pts[k][0])) { notes.push(`${pts[k][1]} at ${pts[k][0].toFixed(2)} s is past the end of this file (length cap)`); pts.splice(k, 1); }
// stills are 360 wide; an export's UI zones are shaded red on them
const SW = 360, SH = Math.round(360 * WANT[1] / WANT[0]) & ~1, k3 = SW / WANT[0];
const zones = EXP ? [[0, 0, WANT[0], EXP.safe.top], [0, WANT[1] - EXP.safe.bottom, WANT[0], EXP.safe.bottom], [0, 0, EXP.safe.left, WANT[1]], [WANT[0] - EXP.safe.right, 0, EXP.safe.right, WANT[1]]]
  .map(([x, y, w, h]) => `drawbox=x=${Math.round(x * k3)}:y=${Math.round(y * k3)}:w=${Math.round(w * k3)}:h=${Math.round(h * k3)}:color=red@0.18:t=fill`).join(',') : '';
const vdir = join(job, 'verify'); rmSync(vdir, { recursive: true, force: true }); mkdirSync(vdir, { recursive: true });
const stills = [];
pts.forEach(([t, label], k) => {
  t = Math.max(0, Math.min(dur - 3 / FPS, Math.round(t * FPS) / FPS)); // snap to a frame so -ss lands on it
  const p = join(vdir, `${String(k + 1).padStart(2, '0')}-${t.toFixed(2)}s-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
  const lab = `${t.toFixed(2)}s ${label}`.replace(/[:'\\]/g, ' ');
  try { sh('ffmpeg', ['-v', 'error', '-y', '-ss', Math.max(0, t - 0.005).toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${SW}:${SH}${zones ? ',' + zones : ''},drawtext=text='${lab}':x=10:y=10:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6`, p]); }
  catch { sh('ffmpeg', ['-v', 'error', '-y', '-ss', Math.max(0, t - 0.005).toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${SW}:${SH}`, p]); }
  if (existsSync(p)) stills.push({ t, label, file: p }); else notes.push(`no frame at ${t.toFixed(2)} s (${label})`);
});
if (stills.length) {
  const cols = Math.min(4, stills.length), rows = Math.ceil(stills.length / cols);
  const ins = stills.flatMap(s => ['-i', s.file]);
  const layout = stills.map((_, k) => `${(k % cols) * SW}_${Math.floor(k / cols) * SH}`).join('|');
  sh('ffmpeg', ['-v', 'error', '-y', ...ins, '-filter_complex', stills.length > 1 ? `xstack=inputs=${stills.length}:layout=${layout}:fill=black` : 'null', join(vdir, 'contact.png')]);
  lines.push(`ok    ${stills.length} stills + contact.png (${cols}x${rows}) in ${vdir}`);
}

// 3b. overlap and safe area, measured from pixels: every element on screen at each check point, drawn alone with the
// layout pass applied (render.mjs BOXES_AT). Graphic on graphic, caption or title on a graphic, caption on a title: FAIL.
// A full-frame takeover (a type card, a flash card) owns the frame, so a graphic under it is only a note.
{
  const FR = CAP.exportFrame || null;
  if (EXN && (!FR || FR.name !== EXN)) ok(false, `layout made for ${EXN} (captions.js exportFrame is ${FR ? FR.name : 'none'}; npm run reel -- --rebuild --name ${name} --export ${EXN})`);
  const SAFE = EXN ? X.safeRect(EXN) : (FR && FR.name ? X.safeRect(FR.name) : null);
  const times = [...new Set(pts.map(p => +p[0].toFixed(2)))];
  let BX = null;
  if (times.length) try {
    execFileSync(process.execPath, [join(KIT, 'render.mjs'), TL.total.toFixed(2)], { cwd: build, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BOXES_AT: times.join(',') } });
    BX = JSON.parse(readFileSync(join(build, 'boxes.json'), 'utf8'));
  } catch (e) { ok(false, 'measure element boxes (render.mjs BOXES_AT): ' + String(e.stderr || e.message).split('\n')[0]); }
  if (BX) {
    const ia = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const ar = b => (b.x1 - b.x0) * (b.y1 - b.y0), nm = e => e.kind === 'graphic' ? (GNAME[e.mode] || 'mode ' + e.mode) : `${e.kind} "${e.text}"`;
    const clash = [], seen = new Set(), outside = [];
    for (const { t, boxes } of BX) {
      for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) {
        const a = boxes[i], b = boxes[k];
        if (a.kind === 'caption' && b.kind === 'caption') continue;
        if (a.kind === 'title' && b.kind === 'title') continue;
        const x = ia(a.box, b.box); if (x <= Math.max(900, 0.03 * Math.min(ar(a.box), ar(b.box)))) continue;
        const key = [nm(a), a.start, nm(b), b.start].join('|'); if (seen.has(key)) continue; seen.add(key);
        if (a.takeover || b.takeover) { notes.push(`${t.toFixed(2)} s: ${nm(a)} and ${nm(b)} overlap under a full-frame graphic`); continue; }
        clash.push(`${t.toFixed(2)} s: ${nm(a)} overlaps ${nm(b)} (${Math.round(x)} px²)`);
      }
      // safe area: settled elements only (an entrance or exit may pass through a UI zone on its way in or out)
      if (SAFE) for (const e of boxes) { if (e.takeover || t - e.start < 0.6 || (e.end < 90 && e.end - t < 0.45)) continue; const b = e.box, d = 6;
        if (b.x0 < SAFE.x0 - d || b.x1 > SAFE.x1 + d || b.y0 < SAFE.y0 - d || b.y1 > SAFE.y1 + d) { const key = 'safe|' + nm(e) + e.start; if (!seen.has(key)) { seen.add(key); outside.push(`${t.toFixed(2)} s: ${nm(e)} reaches into the ${EXN || FR.name} UI zone (box ${b.x0},${b.y0} to ${b.x1},${b.y1}; safe ${SAFE.x0},${SAFE.y0} to ${SAFE.x1},${SAFE.y1})`); } } }
    }
    ok(!clash.length, `no overlap between graphics, captions and titles at ${BX.length} moments${clash.length ? ':' : ''}`);
    clash.forEach(c => lines.push('      ' + c));
    if (SAFE) { ok(!outside.length, `everything inside the ${EXN || FR.name} safe area${outside.length ? ':' : ''}`); outside.forEach(c => lines.push('      ' + c)); }
    try { const L = JSON.parse(readFileSync(join(build, 'layout.json'), 'utf8')).elements || []; const sh = L.filter(e => e.action === 'shift').length, hd = L.filter(e => e.action === 'hide').length; if (sh || hd) lines.push(`ok    layout pass: ${sh} moved clear of a graphic, ${hd} hidden while one is up`); } catch {}
  }
}

// 3c. face keep-out (render.mjs -> facecheck.json, from kit/facezone.py): no caption, title or kinetic word on the face
{ let fc = null; try { fc = JSON.parse(readFileSync(join(build, 'facecheck.json'), 'utf8')); } catch {}
  if (!fc) notes.push('no facecheck.json: the face check did not run (no face zone; rebuild with the current kit)');
  else {
    ok(!fc.overlapMoments, `no text on the face zone at ${fc.withFace} moments with a face${fc.overlapMoments ? `: ${fc.overlapMoments} moments` : ''}${fc.moved && fc.moved.length ? ` (layout moved ${fc.moved.length} off the face)` : ''}`);
    for (const e of fc.elements || []) lines.push(`      ${e.kind} "${e.text}" at ${e.start}s: ${e.moments} moment${e.moments === 1 ? '' : 's'}, up to ${e.maxPx} px on the face`);
  } }
// 3d. text clear of text (render.mjs -> textcheck.json): no two words on the same spot on any frame
{ let tc = null; try { tc = JSON.parse(readFileSync(join(build, 'textcheck.json'), 'utf8')); } catch {}
  if (!tc) notes.push('no textcheck.json: the text overlap check did not run (rebuild with the current kit)');
  else {
    const mv = (tc.moved || []).length;
    ok(!tc.clashFrames, `no two words on the same spot on ${tc.frames} frames${tc.clashFrames ? `: ${tc.clashFrames} frames` : ''}${mv ? ` (layout stacked or held back ${mv} to keep them apart)` : ''}`);
    for (const e of tc.pairs || []) lines.push(`      "${e.a}" and "${e.b}" overlap from ${e.from}s for ${e.frames} frame${e.frames === 1 ? '' : 's'}, up to ${e.maxPx} px`);
  } }
// 3e. round every title, on the drawn frames (kit/titlecheck.mjs): from two frames before a title's start to five after,
// and the same at its end, no caption word in the bar while the title is up and none of its own words in the bar outside it
if (!EXN || XBUILD || !X.isReframed(EXN)) { const tc = titleCheck(build, { dur: TL.total, fps: FPS });
  tc.notes.forEach(n => notes.push(n));
  if (tc.ran) { ok(!tc.fails.length, `no caption word under or beside a title on ${tc.frames} frames round ${tc.titles} title${tc.titles === 1 ? '' : 's'} (${tc.pixelFrames} read from the drawn text layer)${tc.fails.length ? ':' : ''}`); tc.fails.forEach(c => lines.push('      ' + c)); } }
// 4. mask, measured
const mask = R.maskSpec(C);
if (C.titles && mask.file) {
  const mf = join(build, mask.file);
  if (!existsSync(mf)) notes.push(`no mask file (${mask.file}): titles are in front of the speaker. npm run effects:setup, then rebuild.`);
  else {
    if (mask.model) lines.push(`ok    mask model ${mask.model}`);
    const { dir, name } = parse(mf), sidecar = join(dir, name + '.json');
    if (existsSync(sidecar)) {
      let windows = [];
      try { windows = JSON.parse(readFileSync(sidecar, 'utf8')).windows || []; }
      catch { notes.push('Could not read the room check from the mask report.'); }
      for (const [i, w] of windows.entries()) {
        const patch = w.room?.worst;
        if (!patch || patch.time >= dur) continue;
        const t = patch.time, label = 'possible room in the matte', png = join(vdir, `mask-room-${i + 1}.png`);
        const msg = `At ${t.toFixed(2)} s, box [${patch.box.map(x => x.toFixed(3)).join(', ')}] may be room kept as part of the person or clothing in shadow.`;
        const frame = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, t - 0.005)), '-i', file, '-frames:v', '1', '-vf', `scale=${SW}:${SH}`, png]);
        const saved = frame.status === 0 && existsSync(png);
        if (saved) stills.push({ t, label, file: png });
        notes.push(msg + (saved ? ` Look at the still ${basename(png)}.` : ' The still could not be saved. Check this frame in the reel.') + ' In cut.json, "maskClear" takes a box out.');
      }
    }
    for (const t of titles) {
    const tm = Math.min(t.start + R.TITLE_ENTER + 0.2, t.end - 0.05);
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', tm.toFixed(3), '-i', mf, '-frames:v', '1', '-vf', 'scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    let on = 0, sum = 0, band = 0, bn = 0; const y0 = Math.round(480 * 0.22), y1 = Math.round(480 * 0.36);
    for (let k = 0; k < buf.length; k++) { const x = buf[k]; sum += x; if (x > 127) on++; const y = Math.floor(k / 270); if (y >= y0 && y < y1) { band += x; bn++; } }
    const cov = on / buf.length, bandA = band / Math.max(1, bn) / 255;
    const good = cov > 0.02 && cov < 0.85;
    if (!good) notes.push(`mask at ${tm.toFixed(2)}s: coverage ${(cov * 100).toFixed(1)}%: no clear person, so the title shows in front there. Check the still.`);
    lines.push(`${good ? 'ok    ' : 'note  '}mask at title ${tm.toFixed(2)}s: alpha coverage ${(cov * 100).toFixed(1)}%, mean ${(sum / buf.length / 255).toFixed(3)}, title band ${bandA.toFixed(3)}`);
  }
  if (existsSync(mf)) {
    // the mask is also made for captions behind the person, stickers behind the head and screen cards behind its top
    // (kit/reel.cjs), so a moment inside one of those is not "outside"
    const alsoMasked = [...(R.captionLayer(CAP) === 'behind' ? (CAP.flips || []).filter(f => f.mode === 0).map(f => ({ start: f.start, end: f.end + 1.5 })) : []), ...(CAP.flips || []).filter(f => f.mode === 9 && f.layer === 'behind'), ...R.panelsBehind(CAP)];
    const off = TL.total > 0.5 ? [0.05].filter(x => !titles.some(t => x >= t.start - 0.1 && x <= t.end + 0.1) && !alsoMasked.some(t => x >= t.start - 0.15 && x <= t.end + 0.15)) : []; // a window opens 0.1 s early, and the probe lands on the next frame
    for (const tm of off) { const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(tm), '-i', mf, '-frames:v', '1', '-vf', 'scale=90:160', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']); ok(b.every(x => x <= 8), `mask is empty outside the title windows (t=${tm}s, max alpha ${Math.max(...b)})`); }
    }
  }
}

// 4b. joins: every cut as a pair, notes only (the 9:16 reel; a reframed version has the same cuts)
if (!EXN) try { const jn = JOINS.check(file, C, CAP, { fps: FPS, outDir: vdir });
  lines.push(`ok    ${jn.joins.length} cut${jn.joins.length === 1 ? '' : 's'} looked at as pairs: ${jn.findings.length ? jn.findings.length + ' to look at (notes below, never a fail)' : 'nothing to look at'} (joins.json, cut ${jn.hash})`);
  jn.findings.forEach(f => notes.push(`join, ${f.kind}: ${f.why}${f.stills ? ' (' + basename(f.stills) + ')' : ''}`));
  notes.push('joins not checked: ' + jn.notChecked.join('; '));
} catch (e) { notes.push('joins: not checked (' + String(e.message).split('\n')[0] + ')'); }

// 5. copy lint
try { const o = sh(process.execPath, [join(KIT, 'check.mjs'), build]); lines.push('ok    copy and plan check'); o.split('\n').filter(l => /note:/.test(l)).forEach(l => notes.push(l.trim().replace(/^note:\s*/, ''))); }
catch (e) { const o = String(e.stdout || ''); lines.push('FAIL  copy and plan check'); o.split('\n').filter(l => /error:/.test(l)).forEach(l => lines.push('      ' + l.trim())); }

const report = [`# verify ${basename(file)}`, '', ...lines.map(l => '    ' + l), '', ...(notes.length ? ['Notes:', ...notes.map(n => '- ' + n), ''] : []),
  'Stills (read every one: titles readable and behind the head only, pills legible, punch frames framed, end card clean):', ...stills.map(s => `- ${s.t.toFixed(2)} s ${s.label}: ${basename(s.file)}`), ''];
writeFileSync(join(vdir, 'report.md'), report.join('\n'));
console.log(report.join('\n'));
const nf = lines.filter(l => l.startsWith('FAIL')).length;
console.log(nf ? `VERIFY FAIL (${nf})` : `VERIFY PASS  ${join(vdir, 'contact.png')}`);
if (JSON_OUT) console.log(JSON.stringify({ ok: !nf, file, export: EXN, fails: lines.filter(l => l.startsWith('FAIL')).map(l => l.slice(6)), notes, stills: stills.map(s => ({ t: s.t, label: s.label, file: s.file })), contact: join(vdir, 'contact.png'), report: join(vdir, 'report.md') }));
process.exitCode = nf ? 1 : 0;
