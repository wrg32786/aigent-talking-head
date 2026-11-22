// The 4:5 (Instagram Feed) and 1:1 versions of a reel (1.28.0): kit/facewindow.cjs, kit/exports.cjs, kit/split.cjs and
// kit/export-frame.cjs.
// - the window stays inside the 1080x1920 picture and keeps the face inside itself, with headroom
// - it follows the face: a face higher or lower in the picture moves the window with it
// - it is smooth: a noisy track on a still shot does not move it at all, a slow walk is a glide, a cut is an eased move
//   (never a jump) unless a longer move would let the face touch the edge
// - no face: the window sits where the preset says; a shot with no face keeps the last place
// - the ffmpeg expression is the same formula as y(n) (checked frame by frame when ffmpeg is here)
// - file names and plain labels: reel-v1-feed-4x5.mp4 "For the Instagram Feed", reel-v1-square-1x1.mp4, old names read
// - the split and framed b-roll layouts fit the 4:5 or 1:1 frame, and are unchanged for the 9:16 reel
// - end to end (needs ffmpeg and Chrome): a short reel with a caption and a title becomes a 1080x1350 file, the same
//   length, with nothing on the face and every element inside the frame's safe area
// Run: node tests/facewindow.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const FW = require('../kit/facewindow.cjs'), X = require('../kit/exports.cjs'), SPL = require('../kit/split.cjs');
const ROOT = path.dirname(__dirname), KIT = path.join(ROOT, 'kit');
const hasFf = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let n = 0, skipped = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const skip = (name, why) => { skipped++; console.log(`skip ${name} (${why})`); };

// a face zone [x0, y0, x1, y1, crown] with its eyebrows at y, 360 tall
const face = (y, h = 360) => [340, y, 740, y + h, y - 150];
const rnd = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(7);
const mk = (secs, f, fps = 8) => ({ fps, zones: Array.from({ length: Math.round(secs * fps) }, (_, i) => f(i / fps)) });
const exact = (fz, f) => Object.assign(fz, { at: f }); // the face at a frame's own time, for a cut between two samples
const checkInside = (tr, fz, h) => {
  const fr = tr.frames();
  fr.forEach((y, k) => { assert.ok(y >= 0 && y + h <= 1920, `frame ${k}: window ${y} leaves the picture`); assert.strictEqual(y % 2, 0);
    const z = fz.at ? fz.at(k / 24) : fz.zones[Math.min(fz.zones.length - 1, Math.round(k / 24 * fz.fps))]; if (z) assert.ok(z[1] >= y - 2 && z[3] <= y + h + 2, `frame ${k}: face ${z[1]}..${z[3]} outside window ${y}..${y + h}`); });
  return fr;
};

for (const h of [1350, 1080]) {
  t(`${h}: a still shot with a noisy track does not move at all, and the face has headroom`, () => {
    const fz = mk(6, () => face(620 + (rnd() - 0.5) * 30)), tr = FW.track(fz, { h, len: 6 }), fr = checkInside(tr, fz, h);
    assert.strictEqual(new Set(fr).size, 1, 'the window moved on a still shot');
    assert.strictEqual(tr.stats.maxStep, 0);
    const y = fr[0], crown = 620 - 150;
    assert.ok(crown - y >= 0.05 * h, `headroom over the hair: ${crown - y}px`);
    assert.ok(Math.abs((620 + 180 - y) / h - FW.AIM) < 0.08, 'the face sits a little above the middle');
  });
  t(`${h}: it follows the face (higher face, higher window)`, () => {
    const a = FW.track(mk(4, () => face(420)), { h, len: 4 }).y(40), b = FW.track(mk(4, () => face(900)), { h, len: 4 }).y(40);
    assert.ok(b - a > 300, `window for a low face ${b} should sit well under the one for a high face ${a}`);
  });
  t(`${h}: a cut is an eased move, centred on the cut, never a jump`, () => {
    const fz = mk(8, s => face(s < 4 ? 480 : 760)), tr = FW.track(fz, { h, len: 8, cuts: [4] }), fr = checkInside(tr, fz, h);
    assert.strictEqual(tr.stats.shots, 2); assert.strictEqual(tr.moves.length, 1);
    const total = Math.abs(fr[191] - fr[0]); assert.ok(total > 200, 'the window should move with the new shot');
    assert.ok(tr.stats.maxStep < total * 0.25, `largest step ${tr.stats.maxStep}px of ${total}px: not eased`);
    assert.ok(tr.stats.movingFrames >= 8 && tr.stats.movingFrames <= 14, `the move takes about half a second (${tr.stats.movingFrames} frames)`);
    assert.strictEqual(fr[60], fr[0]); assert.strictEqual(fr[130], fr[191]);
    assert.ok(Math.abs(fr[96] - (fr[0] + fr[191]) / 2) <= 4, 'half way at the cut');
    // eased: the steps grow, then shrink
    const d = fr.slice(1).map((v, k) => Math.abs(v - fr[k])), peak = d.indexOf(Math.max(...d)); assert.ok(Math.abs(peak - 96) <= 2, 'fastest at the cut');
  });
  t(`${h}: a small difference between two shots is no move at all`, () => {
    const tr = FW.track(mk(8, s => face(s < 4 ? 600 : 612)), { h, len: 8, cuts: [4] });
    assert.strictEqual(tr.moves.length, 0); assert.strictEqual(tr.stats.maxStep, 0);
  });
  t(`${h}: a face that walks down inside one shot is followed with a glide`, () => {
    const fz = mk(10, s => face(380 + 50 * s + (rnd() - 0.5) * 16)), tr = FW.track(fz, { h, len: 10 }), fr = checkInside(tr, fz, h);
    assert.ok(fr[230] - fr[10] > 250, 'the window should follow the walk');
    assert.ok(tr.stats.maxStep <= 6, `a glide, not steps: ${tr.stats.maxStep}px in one frame`);
    for (let k = 1; k < fr.length; k++) assert.ok(fr[k] >= fr[k - 1] - 2, 'no going back and forth on a steady walk');
  });
  t(`${h}: a move that would let the face touch the edge is shortened to a switch on the cut`, () => {
    const fz = exact(mk(6, s => face(s < 3 ? 80 : 1500)), s => face(s < 3 ? 80 : 1500)), tr = FW.track(fz, { h, len: 6, cuts: [3] });
    checkInside(tr, fz, h); assert.ok(tr.moves[0].e < 6, 'the ease should have been cut short');
  });
  t(`${h}: no face at all stays where the preset says; a shot with no face keeps the last place`, () => {
    const p = X.get(h === 1350 ? 'feed45' : 'square'), tr = FW.track({ fps: 8, zones: [] }, { h, len: 3, fallback: p.y0 });
    assert.deepStrictEqual([...new Set(tr.frames())], [2 * Math.round(p.y0 / 2)]);
    const fz = mk(6, s => (s < 3 ? face(700) : null)), tr2 = FW.track(fz, { h, len: 6, cuts: [3] }), fr = tr2.frames();
    assert.strictEqual(fr[143], fr[0]);
  });
}
if (hasFf) t('the ffmpeg expression gives the same window as y(n), frame by frame', () => {
  const fz = mk(8, s => face(s < 2.5 ? 500 : s < 5 ? 820 + 30 * (s - 2.5) + 60 * Math.sin(s * 2) : 300)), tr = FW.track(fz, { h: 1350, len: 8, cuts: [2.5, 5] }), fr = tr.frames();
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', "color=c=black:s=64x1920:r=24:d=8,format=gray,geq=lum='Y/8'", '-vf', `crop=64:1350:0:'${tr.expr()}':exact=1,crop=1:1:0:0`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
  assert.ok(raw.length >= fr.length - 1);
  for (let k = 0; k < Math.min(raw.length, fr.length); k++) assert.strictEqual(raw[k], Math.floor(fr[k] / 8), `frame ${k}: ffmpeg cut at ${raw[k] * 8}, y(n) is ${fr[k]}`);
}); else skip('the ffmpeg expression', 'needs ffmpeg');

t('shiftZones: the face as the new frame sees it sits a little above its middle', () => {
  const fz = mk(4, () => face(900)), tr = FW.track(fz, { h: 1350, len: 4 }), z = FW.shiftZones(fz, tr, X.fixedY('feed45'))[5];
  const mid = (z[1] + z[3]) / 2 - X.fixedY('feed45'); assert.ok(Math.abs(mid / 1350 - FW.AIM) < 0.05, `face centre at ${mid} of 1350`);
  assert.strictEqual(z[0], 340); assert.strictEqual(z[2], 740);
});
t('a Feed or square version runs as long as a reel (180 s) and ends on a word, never inside one', () => {
  assert.strictEqual(X.get('feed45').maxSec, 180); assert.strictEqual(X.get('square').maxSec, 180);
  const words = X.wordsOf({ flips: [{ mode: 0, start: 170, end: 184, words: [[170, 175.2, 'so'], [175.4, 179.1, 'what'], [179.3, 180.6, 'next']] }, { mode: 7, start: 1, end: 2, words: [[1, 2, 'x']] }] });
  assert.deepStrictEqual(words, [[170, 175.2], [175.4, 179.1], [179.3, 180.6]], 'only spoken caption words count');
  assert.strictEqual(X.endOf('feed45', 120, words), 120, 'a reel under the limit is not cut');
  assert.strictEqual(X.endOf('feed45', 190, words), 179.25, 'a word across the limit: the version ends after the word before it, with a breath');
  assert.strictEqual(X.endOf('feed45', 200, [[178.9, 179.4], [179.4, 180.3]]), 179.4, 'words that touch: it ends where the next word starts, not 0.15 s into it');
  assert.strictEqual(X.endOf('square', 190, [[170, 178]]), 180, 'quiet at the limit: it ends at the limit');
  assert.strictEqual(X.endOf('feed45', 190, [[100, 160], [165, 185]]), 180, 'the last word before it ended long ago: it ends at the limit');
  const a = X.ffmpegArgs('feed45', 'in.mp4', 'out.mp4', 190, { words }); assert.strictEqual(a[a.indexOf('-t') + 1], '179.25');
});
t('file names and plain labels', () => {
  assert.strictEqual(path.basename(X.outName('/j/reel-v1.mp4', 'feed45')), 'reel-v1-feed-4x5.mp4');
  assert.strictEqual(path.basename(X.outName('/j/reel-v3.mp4', 'square')), 'reel-v3-square-1x1.mp4');
  assert.strictEqual(path.basename(X.outName('/j/reel-v1.mp4', 'reels')), 'reel-v1-reels.mp4');
  assert.deepStrictEqual([X.fileInfo('reel-v1.mp4').use, X.fileInfo('reel-v1.mp4').size], ['For Reels and Stories', '9:16']);
  assert.deepStrictEqual([X.fileInfo('jobs/a/reel-v2-feed-4x5.mp4').use, X.fileInfo('reel-v2-feed-4x5.mp4').size, X.fileInfo('reel-v2-feed-4x5.mp4').v], ['For the Instagram Feed', '4:5', 2]);
  assert.strictEqual(X.fileInfo('reel-v2-square-1x1.mp4').name, 'square');
  assert.strictEqual(X.fileInfo('reel-v2-feed45.mp4').name, 'feed45', 'the name from before 1.28.0 still reads');
  assert.strictEqual(X.fileInfo('reel-fx-v2.mp4').fx, true); assert.strictEqual(X.fileInfo('notes.mp4'), null);
  const L = X.parseList('reels, feed45,square,reels,nope');
  assert.deepStrictEqual([L.main, L.reframed, L.bad], ['reels', ['feed45', 'square'], ['nope']]);
  assert.deepStrictEqual(X.frameOf('feed45'), { name: 'feed45', w: 1080, h: 1350, y0: 285, safe: X.get('feed45').safe, reframed: true });
  assert.strictEqual(X.frameOf('square').y0, 420); assert.strictEqual(X.frameOf('reels').reframed, undefined);
  for (const p of Object.values(X.EX)) for (const v of [p.label, p.use || '']) assert.ok(!/\u2014/.test(v), 'no em dash in a label');
});
t('split and framed b-roll fit the 4:5 and 1:1 frame; the 9:16 layouts are unchanged', () => {
  const f = { crown: 500, cx: 540 }, top = SPL.layout({ place: 'top' }, f), fr = SPL.layout({ place: 'frame' }, f);
  assert.deepStrictEqual([top.panel, top.seam, top.dy, top.capY], [{ x: 0, y: 0, w: 1080, h: 960 }, 960, 388, 778]);
  assert.deepStrictEqual([fr.panel.y, fr.panel.h, fr.card.y, fr.card.h, fr.capY], [72, 760, 1110, 740, 912]);
  for (const [name, h] of [['feed45', 1350], ['square', 1080]]) {
    const y0 = X.fixedY(name), frame = { y0, h }, a = SPL.layout({ place: 'top' }, { crown: y0 + 0.1 * h, cx: 540 }, { frame });
    const half = 2 * Math.round(h / 4); assert.deepStrictEqual(a.panel, { x: 0, y: y0, w: 1080, h: half }); assert.strictEqual(a.seam, y0 + half);
    assert.ok(a.dy >= 0 && a.dy <= h / 2 && a.capY > y0 && a.capY < a.seam);
    const b = SPL.layout({ place: 'frame' }, { crown: y0 + 0.1 * h, cx: 540 }, { frame });
    for (const r of [b.panel, b.card]) assert.ok(r.y >= y0 && r.y + r.h <= y0 + h, `${name}: a card leaves the frame`);
    // your picture covers your card with rows from inside the window only
    assert.ok((b.card.y - b.dy) / b.s >= y0 - 1 && (b.card.y + b.card.h - b.dy) / b.s <= y0 + h + 1, `${name}: the card would show rows outside the window`);
  }
});

// end to end: a 3 s reel of two shots with a caption and a title, made into the 4:5 version
const chrome = (() => { try { return require('child_process').execFileSync(process.execPath, ['--input-type=module', '-e', `import { findChrome } from ${JSON.stringify(require('url').pathToFileURL(path.join(KIT, 'chrome.mjs')).href)}; console.log(findChrome() || '')`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })();
if (hasFf && chrome) {
  const job = fs.mkdtempSync(path.join(os.tmpdir(), 'feed45-')), build = path.join(job, 'build'); fs.mkdirSync(build);
  t('a short reel renders as a 1080x1350 file for the Instagram Feed: same length, laid out again, nothing on the face', () => {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=24:d=3', '-f', 'lavfi', '-i', 'sine=f=220:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(job, 'take.mp4')]);
    const cut = { segs: [{ file: '../take.mp4', in: 0, out: 1.5 }, { file: '../take.mp4', in: 1.5, out: 2.7 }], tail: 0.3, overlay: 'ovl/%04d.png' };
    fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut));
    // a caption low in the 9:16 frame and a title at its top (both outside the 4:5 one), and a sticker (drawn at
    // captionY) right where the face is
    const flips = [{ start: 0.2, end: 1.4, text: 'low in the reel', mode: 0 }, { start: 0.3, end: 1.3, text: 'ON FACE', mode: 2 }, { start: 1.6, end: 2.8, text: 'Feed ready', mode: 7 }];
    fs.writeFileSync(path.join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'pill', captionY: 800, fonts: 'theme', flips }) + ';\n');
    fs.copyFileSync(path.join(KIT, 'themes', 'neutral.js'), path.join(build, 'theme.js'));
    execFileSync(process.execPath, [path.join(KIT, 'assemble.cjs'), 'base.mp4'], { cwd: build, env: { ...process.env, BASEONLY: '1' }, stdio: 'pipe' });
    // the face track kit/facezone.py would write: a face high in shot 1, lower in shot 2
    fs.writeFileSync(path.join(build, 'facezone.json'), JSON.stringify(mk(3, s => face(s < 1.5 ? 520 : 760))));
    const reel = path.join(job, 'reel-v1.mp4'); fs.copyFileSync(path.join(build, 'base.mp4'), reel);
    const r = require('../kit/export-frame.cjs').make({ jobDir: job, src: build, name: 'feed45', reel, base: path.join(build, 'base.mp4'), masks: build, env: { FPS: '24' }, log: () => {} });
    assert.strictEqual(path.basename(r.file), 'reel-v1-feed-4x5.mp4');
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', r.file]).toString());
    const v = pr.streams.find(s => s.codec_type === 'video');
    assert.deepStrictEqual([v.width, v.height], [1080, 1350], 'the Feed file must be 1080x1350 (4:5)');
    assert.ok(pr.streams.some(s => s.codec_type === 'audio'), 'the sound comes along');
    assert.ok(Math.abs(+pr.format.duration - 3) < 0.15, `the timing is unchanged (${pr.format.duration} s)`);
    assert.strictEqual(r.window.shots, 2); assert.strictEqual(r.window.faceOutside, 0); assert.strictEqual(r.faceHits, 0, 'text on the face');
    const dir = path.join(job, 'build-feed45'), L = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8')), S = X.safeRect('feed45');
    assert.strictEqual(L.export, 'feed45'); assert.ok(L.elements.length >= 2);
    for (const e of L.elements) assert.ok(e.final.y0 >= S.y0 - 2 && e.final.y1 <= S.y1 + 2 && e.final.x0 >= S.x0 - 2 && e.final.x1 <= S.x1 + 2, `${e.kind} "${e.text}" is outside the 4:5 safe area: ${JSON.stringify(e.final)}`);
    assert.ok(L.elements.some(e => /face/.test(e.action)), 'the sticker on the face should have been moved: ' + JSON.stringify([L.elements.map(e => [e.text, e.action, e.box, e.final]), L.faceTrack, L.faceSafe]));
    const W = JSON.parse(fs.readFileSync(path.join(dir, 'window.json'), 'utf8')); assert.strictEqual(W.h, 1350); assert.ok(W.expr.length < 4000);
    // the picture really is the window: the 4:5 frame at 0.5 s is the 9:16 frame's rows from the window's top
    const y0 = FW.track(JSON.parse(fs.readFileSync(path.join(build, 'facezone.json'), 'utf8')), { h: 1350, len: 3, cuts: [1.5] }).y(12);
    const px = (f, vf) => execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', f, '-frames:v', '1', '-vf', vf + ',scale=54:68,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 22 });
    const a = px(path.join(build, 'base.mp4'), `crop=1080:1350:0:${y0}`), b = px(r.file, 'null');
    // (compare the left edge only: the caption sits over the middle)
    let d = 0, c = 0; for (let yy = 0; yy < 68; yy++) for (let xx = 0; xx < 2; xx++) { d += Math.abs(a[yy * 54 + xx] - b[yy * 54 + xx]); c++; }
    assert.ok(d / c < 14, `the 4:5 picture is not the face window of the 9:16 one (mean difference ${(d / c).toFixed(1)})`);
  });
  fs.rmSync(job, { recursive: true, force: true });
} else skip('a short reel renders as a 1080x1350 file', 'needs ffmpeg and Chrome');

console.log(`FEED 4:5 PASS (${n} tests${skipped ? ', ' + skipped + ' skipped' : ''})`);
