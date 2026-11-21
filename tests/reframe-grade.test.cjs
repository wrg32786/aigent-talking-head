// kit/reframe.cjs and kit/grade-match.cjs (1.28.0): the per-shot reframe to a face target and the skin-protected
// grade match. The maths run with no tools; the parts that need Python with opencv (kit/framing.py,
// kit/grade_match.py) and ffmpeg skip with a note when those are missing.
// - cropFor: the zoom is the target face height over yours, the eye line and centre land on the target, the zoom is
//   held at the source's limit, a little extra zoom is allowed to reach the eye line, the face box stays inside
// - a take already as close as the target (or closer) keeps zoom 1; the crown and the chin stay in the frame at the
//   zoom limit (headroom), and the result says it was held
// - a landscape take (1920x1080 into 9:16) may zoom to 2.2, a 1080x1920 one to 3
// - steady: a locked-off take's small measure noise is taken out, a real move is kept
// - the Reel.md shot keys "face" and "lab" round trip, and reach the recipe's shot settings
// - end to end: a face measured by YuNet, cropped by ffmpeg with the crop cropFor gives, measures on the target
// - the grade: a cold take fitted to a warm target gets closer, skin moves less than the wall, nothing clips, one LUT
//   when the targets agree and one more for a shot that differs; assemble.cjs applies the LUT and the crop
// Run: node tests/reframe-grade.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const RF = require('../kit/reframe.cjs'), GM = require('../kit/grade-match.cjs'), RM = require('../kit/reelmd.cjs'), RC = require('../kit/recreate.cjs');
const ROOT = path.dirname(__dirname), KIT = path.join(ROOT, 'kit');
const PY = process.env.PYTHON || [path.join(ROOT, '.venv', 'Scripts', 'python.exe'), path.join(ROOT, '.venv', 'bin', 'python')].find(f => fs.existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
const hasPy = spawnSync(PY, ['-c', 'import cv2, numpy'], { stdio: 'ignore' }).status === 0;
const hasFf = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let n = 0, skipped = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const skip = name => { skipped++; console.log('skip ' + name + ' (needs Python with opencv and ffmpeg)'); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tolerance ${tol})`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-grade-'));

t('cropFor: a wide take is zoomed to the reference face height, eye line and centre', () => {
  const ours = { faceH: 0.082, eyeY: 0.58, cx: 0.55, y0: 0.55, y1: 0.63, x0: 0.5, x1: 0.6 }, target = { faceH: 0.164, eyeY: 0.32, cx: 0.48 };
  const c = RF.cropFor(ours, target, { maxZoom: 2.2 });
  near(c.zoom, 2, 0.001, 'zoom'); assert.ok(!c.clamped);
  near(c.got.faceH, 0.164, 0.001); near(c.got.eyeY, 0.32, 0.002); near(c.got.cx, 0.48, 0.002);
  assert.ok(c.punchX >= 0 && c.punchX <= 1 && c.punchY >= 0 && c.punchY <= 1);
  // the same maths kit/assemble.cjs does: a point p ends at p * z - (z - 1) * centre
  near(ours.eyeY * c.zoom - (c.zoom - 1) * c.punchY, 0.32, 0.002, 'eye line through the assembler crop');
});

t('cropFor: the zoom is held at the source limit and says so; never under 1', () => {
  const c = RF.cropFor({ faceH: 0.05, eyeY: 0.6, cx: 0.5 }, { faceH: 0.2, eyeY: 0.33, cx: 0.5 }, { maxZoom: 2.2 });
  assert.strictEqual(c.zoom, 2.2); assert.strictEqual(c.clamped, true); assert.strictEqual(c.want, 4);
  assert.ok(c.diff.faceH < 0, 'the face stays smaller than the target');
  const out = RF.cropFor({ faceH: 0.3, eyeY: 0.33, cx: 0.5 }, { faceH: 0.17, eyeY: 0.33, cx: 0.5 }, { maxZoom: 2.2 });
  assert.strictEqual(out.zoom, 1, 'we cannot zoom out of a take');
});

t('cropFor: a little extra zoom to reach the eye line, and the face box stays inside the frame', () => {
  const c = RF.cropFor({ faceH: 0.16, eyeY: 0.46, cx: 0.5, y0: 0.39, y1: 0.56, x0: 0.39, x1: 0.61 }, { faceH: 0.17, eyeY: 0.32, cx: 0.5 }, { maxZoom: 3 });
  assert.ok(c.zoom > 1.0625 && c.zoom <= 1.0625 * RF.EYE_EXTRA + 0.001, 'zoom ' + c.zoom);
  assert.ok(c.got.eyeY < 0.46, 'the eye line moved up: ' + c.got.eyeY);
  // a face already bigger than the target gets no more zoom for the eye line: that would only make it bigger still
  const close = RF.cropFor({ faceH: 0.24, eyeY: 0.46, cx: 0.55, y0: 0.37, y1: 0.61, x0: 0.4, x1: 0.7 }, { faceH: 0.17, eyeY: 0.32, cx: 0.5 }, { maxZoom: 3 });
  assert.strictEqual(close.zoom, 1); assert.strictEqual(close.got.faceH, 0.24); assert.strictEqual(close.got.eyeY, 0.46);
  const big = RF.cropFor({ faceH: 0.3, eyeY: 0.5, cx: 0.5, y0: 0.35, y1: 0.68, x0: 0.25, x1: 0.75 }, { faceH: 0.8, eyeY: 0.1, cx: 0.5 }, { maxZoom: 3 });
  const y0 = 0.35 * big.zoom - (big.zoom - 1) * big.punchY, y1 = 0.68 * big.zoom - (big.zoom - 1) * big.punchY, x0 = 0.25 * big.zoom - (big.zoom - 1) * big.punchX, x1 = 0.75 * big.zoom - (big.zoom - 1) * big.punchX;
  assert.ok(y0 >= RF.MARGIN - 0.002 && y1 <= 1 - RF.MARGIN + 0.002 && x0 >= RF.MARGIN - 0.002 && x1 <= 1 - RF.MARGIN + 0.002, `face box inside: ${[x0, y0, x1, y1].map(v => v.toFixed(3))}`);
});

t('cropFor: a take already as close as the target, or closer, is left as filmed (zoom 1, no shift)', () => {
  // the t7 case: a selfie close-up (face 0.216 of the frame) against a medium close-up look (0.162 to 0.182)
  for (const th of [0.162, 0.182, 0.216, 0.22]) {
    const c = RF.cropFor({ faceH: 0.216, eyeY: 0.455, cx: 0.577, y0: 0.36, y1: 0.576, x0: 0.42, x1: 0.73 }, { faceH: th, eyeY: 0.323, cx: 0.5 }, { maxZoom: 3 });
    assert.deepStrictEqual([c.zoom, c.punchX, c.punchY, c.clamped], [1, 0.5, 0.5, false], 'target ' + th);
    assert.strictEqual(c.got.faceH, 0.216); assert.strictEqual(c.got.eyeY, 0.455);
  }
  // a face only a little bigger than the target used to get up to 15% of zoom for the eye line: not any more
  const near1 = RF.cropFor({ faceH: 0.171, eyeY: 0.47, cx: 0.56 }, { faceH: 0.162, eyeY: 0.323, cx: 0.5 }, { maxZoom: 3 });
  assert.strictEqual(near1.zoom, 1, 'want ' + near1.want);
  // a clearly wider take is still zoomed
  assert.ok(RF.cropFor({ faceH: 0.12, eyeY: 0.4, cx: 0.5 }, { faceH: 0.162, eyeY: 0.323, cx: 0.5 }, { maxZoom: 3 }).zoom > 1.3);
  // through applyToSegs: every segment of a close take keeps zoom 1 and nothing is marked held
  const segs = [{ in: 0, out: 5 }, { in: 5, out: 9 }], face = { faceH: 0.216, eyeY: 0.455, cx: 0.577 };
  const r = RF.applyToSegs({ segs, shotStart: [0, 1], targets: [{ faceH: 0.162, eyeY: 0.323, cx: 0.5 }, { faceH: 0.182, eyeY: 0.323, cx: 0.5 }], faces: [face, face], maxZoom: 3 });
  assert.deepStrictEqual(segs.map(s => [s.zoom, s.punchX, s.punchY]), [[1, 0.5, 0.5], [1, 0.5, 0.5]]); assert.ok(r.shots.every(s => !s.clamped) && !r.lines.length);
});

t('cropFor: headroom is kept at the zoom limit: the crown and the chin stay in the frame, and the result says it was held', () => {
  // where the top of the head (the face box top less CROWN of its height) and the chin end up after the crop
  const ends = (o, c) => { const fh = o.y1 - o.y0, top = Math.max(0, o.y0 - fh * RF.CROWN), bot = Math.min(1, o.y1 + fh * RF.CHIN); return [top * c.zoom - (c.zoom - 1) * c.punchY, bot * c.zoom - (c.zoom - 1) * c.punchY]; };
  const inside = (o, c, msg) => { const [a, b] = ends(o, c); assert.ok(a >= RF.HEADROOM - 0.002 && b <= 1 - RF.HEADROOM + 0.002, `${msg}: crown ${a.toFixed(3)}, chin ${b.toFixed(3)}, zoom ${c.zoom}`); };
  // the target asks for a face that fills the frame: the zoom stops where the head still fits, well under the source limit
  const o1 = { faceH: 0.2, eyeY: 0.45, cx: 0.5, y0: 0.37, y1: 0.57, x0: 0.4, x1: 0.6 }, c1 = RF.cropFor(o1, { faceH: 0.9, eyeY: 0.3, cx: 0.5 }, { maxZoom: 5 });
  inside(o1, c1, 'head fits'); near(c1.zoom, (1 - 2 * RF.HEADROOM) / (0.2 * (1 + RF.CROWN + RF.CHIN)), 0.002); assert.ok(c1.zoom < 5 && c1.clamped && c1.held === 'headroom');
  // at the source limit with a high eye-line target: the zoom is the limit, the zoom centre gives way so the crown stays in
  const o2 = { faceH: 0.1, eyeY: 0.3, cx: 0.5, y0: 0.26, y1: 0.36, x0: 0.44, x1: 0.56 }, c2 = RF.cropFor(o2, { faceH: 0.4, eyeY: 0.1, cx: 0.5 }, { maxZoom: 2.2 });
  assert.strictEqual(c2.zoom, 2.2); assert.strictEqual(c2.clamped, true); inside(o2, c2, 'crown kept at the limit');
  assert.ok(c2.got.eyeY > 0.1, 'the eye line stops short of the target rather than cropping the head: ' + c2.got.eyeY);
  // a low eye-line target: the chin stays in
  const o3 = { faceH: 0.1, eyeY: 0.6, cx: 0.5, y0: 0.56, y1: 0.66, x0: 0.44, x1: 0.56 }, c3 = RF.cropFor(o3, { faceH: 0.3, eyeY: 0.95, cx: 0.5 }, { maxZoom: 3 });
  inside(o3, c3, 'chin kept'); assert.strictEqual(c3.held, 'headroom');
  // a head that already touches the top of your take keeps that edge: no zoom pushes it further out
  const o4 = { faceH: 0.2, eyeY: 0.14, cx: 0.5, y0: 0.06, y1: 0.26, x0: 0.4, x1: 0.6 }, c4 = RF.cropFor(o4, { faceH: 0.3, eyeY: 0.33, cx: 0.5 }, { maxZoom: 3 });
  assert.ok(c4.zoom > 1 && c4.punchY === 0, `anchored to the top: zoom ${c4.zoom}, punchY ${c4.punchY}`);
  // with room to spare nothing is held, and applyToSegs says why a shot was held
  assert.ok(!RF.cropFor({ faceH: 0.082, eyeY: 0.58, cx: 0.55 }, { faceH: 0.164, eyeY: 0.32, cx: 0.48 }, { maxZoom: 2.2 }).clamped);
  const r = RF.applyToSegs({ segs: [{ in: 0, out: 4 }], shotStart: [0], targets: [{ faceH: 0.9, eyeY: 0.3, cx: 0.5 }], faces: [o1], maxZoom: 5 });
  assert.strictEqual(r.shots[0].clamped, true); assert.strictEqual(r.shots[0].held, 'headroom'); assert.ok(/top of your head/.test(r.lines[0]), r.lines[0]);
});

t('maxZoom: a 1920x1080 take into 9:16 may zoom to about 2.2, a 1080x1920 take to 3, a 4K one no further', () => {
  near(RF.maxZoom(1920, 1080), 2.2, 0.02); assert.strictEqual(RF.maxZoom(1080, 1920), 3); assert.strictEqual(RF.maxZoom(2160, 3840), 3); assert.strictEqual(RF.maxZoom(0, 0), 2.2);
});

t('steady and applyToSegs: measure noise is taken out, a shot with no target borrows the middle one, a faceless segment keeps its zoom', () => {
  const f = (h, e) => ({ faceH: h, eyeY: e, cx: 0.5 });
  const st = RF.steady([f(0.08, 0.58), f(0.083, 0.581), f(0.079, 0.579), f(0.15, 0.4), null]);
  assert.strictEqual(st[0].faceH, st[1].faceH); assert.strictEqual(st[1].faceH, st[2].faceH); assert.strictEqual(st[3].faceH, 0.15); assert.strictEqual(st[4], null);
  const segs = [{ in: 0, out: 2 }, { in: 2, out: 4, zoom: 1.16 }, { in: 4, out: 6 }, { in: 6, out: 8, zoom: 1 }];
  const r = RF.applyToSegs({ segs, shotStart: [0, 1, 3], targets: [f(0.16, 0.32), null, f(0.2, 0.33)], faces: [st[0], st[1], st[2], null], maxZoom: 2.2, fallback: RF.medianFace([f(0.16, 0.32), f(0.2, 0.33)]) });
  near(segs[0].zoom, 0.16 / st[0].faceH, 0.01); assert.ok(segs[0].reframed && segs[1].reframed && segs[2].reframed);
  assert.strictEqual(r.shots[1].borrowed, true); assert.strictEqual(r.shots[2], null); assert.strictEqual(segs[3].zoom, 1, 'no face: the old zoom stays');
  assert.deepStrictEqual(Object.keys(r.shots[0]).slice(0, 3), ['framing', 'target', 'crop']);
});

t('Reel.md: the shot keys face and lab round trip into the shot settings; shot sizes by face height', () => {
  assert.deepStrictEqual(RF.parseFace('0.18@0.36'), { faceH: 0.18, eyeY: 0.36, cx: 0.5 });
  assert.deepStrictEqual(RF.parseFace(RF.fmtFace({ faceH: 0.159, eyeY: 0.323, cx: 0.46 })), { faceH: 0.159, eyeY: 0.323, cx: 0.46 });
  assert.strictEqual(RF.fmtFace({ faceH: 0.18, eyeY: 0.36, cx: 0.51 }), '0.18@0.36'); assert.strictEqual(RF.parseFace('close-up'), null);
  assert.deepStrictEqual(GM.parseLab(GM.fmtLab({ mean: [34.22, 2.16, 9.53], std: [22.37, 6.17, 8.17] })), { mean: [34.2, 2.2, 9.5], std: [22.4, 6.2, 8.2] });
  assert.strictEqual(GM.parseLab('warm'), null);
  const rp = path.join(dir, 'Reel.md');
  fs.writeFileSync(rp, ['---', 'videomd: 1', 'name: ref', 'description: d', 'source:', '  file: ref.mp4', '  duration: 6', 'shots: 2', 'lang: en', 'x-reel: 1', '---', '', '# ref', '', '## Shots', '', '```videomd-timeline',
    '#01 0-3 | framing medium close-up | face 0.16@0.32 | lab 42,2,10~22,5,7', '#02 3-6 | framing close-up | cutaway on | face 0.25@0.36@0.44', '```', ''].join('\n'));
  const rec = RM.load(rp); assert.deepStrictEqual(RM.validate(rec).errs, []);
  const sh = RM.shotSettings(rec);
  assert.deepStrictEqual(sh[0].face, { faceH: 0.16, eyeY: 0.32, cx: 0.5 }); assert.deepStrictEqual(sh[0].lab, { mean: [42, 2, 10], std: [22, 5, 7] });
  assert.deepStrictEqual(sh[1].face, { faceH: 0.25, eyeY: 0.36, cx: 0.44 }); assert.strictEqual(sh[1].lab, undefined);
  assert.deepStrictEqual(['0.4', '0.25', '0.17', '0.09', '0.03'].map(h => RF.classOf(+h)), ['ECU', 'CU', 'MCU', 'MS', 'WS']);
  assert.deepStrictEqual(GM.pool([{ mean: [40, 2, 10], std: [20, 5, 7] }, null, { mean: [50, 4, 12], std: [22, 5, 7] }], [1, 9, 3]), { mean: [47.5, 3.5, 11.5], std: [21.5, 5, 7] });
});

t('the assembler takes the crop and the LUT per segment', () => {
  const src = fs.readFileSync(path.join(KIT, 'assemble.cjs'), 'utf8');
  assert.ok(/px = s\.punchX \?\? 0\.5/.test(src) && src.includes('(iw-ow)*${px}') && src.includes("x='(iw-iw/zoom)*${px}'"), 'punchX in every zoom path');
  assert.ok(!src.includes("x='(iw-iw/zoom)/2'"), 'no zoom path left centred');
  assert.ok(/lut3d=file=/.test(src) && src.indexOf('${fit}${lut}${zf}${segFinish}') > 0, 'the LUT goes on after the fit and under the finish');
});

if (hasPy && hasFf) {
  // a wide take made from the showcase presenter still: the picture small and low in a 9:16 frame
  const still = path.join(ROOT, 'showcase', 'source', 'presenter.jpg'), take = path.join(dir, 'take.mp4'), ref = path.join(dir, 'ref.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-t', '2', '-i', still, '-vf', 'scale=594:1056,pad=1080:1920:243:700:color=0x1d4a4f,fps=24,format=yuv420p', '-c:v', 'libx264', '-crf', '14', take]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-t', '2', '-i', still, '-vf', 'scale=1080:1920,eq=saturation=1.15,colorbalance=rm=0.12:bm=-0.12,fps=24,format=yuv420p', '-c:v', 'libx264', '-crf', '14', ref]);

  t('framing.py and the crop, end to end: your face lands on the reference face (within 1.5% of the frame)', () => {
    const [target] = RF.measure(PY, ref, [[0, 2]]), [ours] = RF.measure(PY, take, [[0, 2]]);
    assert.ok(target && ours, 'YuNet found the face on both sides');
    assert.ok(ours.faceH < target.faceH * 0.7, 'the take is wider: ' + ours.faceH + ' vs ' + target.faceH);
    const c = RF.cropFor(ours, target, { maxZoom: 3 }), z = c.zoom, w = Math.round(1080 * z / 2) * 2, h = Math.round(1920 * z / 2) * 2, out = path.join(dir, 'cropped.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', take, '-vf', `scale=${w}:${h},crop=1080:1920:(iw-ow)*${c.punchX}:(ih-oh)*${c.punchY}`, '-c:v', 'libx264', '-crf', '14', out]);
    const [got] = RF.measure(PY, out, [[0, 2]]);
    near(got.faceH, target.faceH, 0.015, 'face height'); near(got.eyeY, target.eyeY, 0.015, 'eye line'); near(got.cx, target.cx, 0.015, 'centre');
    const [nothing] = RF.measure(PY, take, [[0, 0.01]].map(() => [50, 51]));
    assert.strictEqual(nothing, null, 'no frame, no face');
  });

  t('reframeShots: segments get zoom, punchX and punchY, the plan gets the framing and the crop; no target, no change', () => {
    const build = path.join(dir, 'build'); fs.mkdirSync(build, { recursive: true });
    const segs = [{ file: '../take.mp4', in: 0, out: 1 }, { file: '../take.mp4', in: 1, out: 2, recut: true }], lines = [];
    const [target] = RF.measure(PY, ref, [[0, 2]]);
    const fr = RC.reframeShots({ segs, shotStart: [0, 1], targets: [target, null], build, python: PY, log: l => lines.push(l) });
    assert.ok(fr && fr[0] && fr[1] && fr[1].borrowed, JSON.stringify(fr));
    assert.ok(segs[0].zoom > 1.3 && segs[0].punchX != null && segs[0].punchY != null && segs[1].zoom === segs[0].zoom, JSON.stringify(segs));
    assert.ok(lines.some(l => /^reframe: 2 of 2 shots/.test(l)), lines.join('\n'));
    const segs2 = [{ file: '../take.mp4', in: 0, out: 2 }];
    assert.strictEqual(RC.reframeShots({ segs: segs2, shotStart: [0], targets: [null], build, python: PY, log: l => lines.push(l) }), null);
    assert.strictEqual(segs2[0].zoom, undefined); assert.ok(lines.some(l => /no face measured/.test(l)));
  });

  t('grade match: closer to the target, skin kept, nothing clipped, one LUT when the targets agree, the LUT applies in ffmpeg', () => {
    const build = path.join(dir, 'build'), [target] = GM.stats(PY, ref, [[0, 2]]), [mine] = GM.stats(PY, take, [[0, 2]]);
    assert.ok(target && mine && Array.isArray(target.mean), 'colour read on both sides');
    assert.deepStrictEqual(GM.stats(PY, ref, [[0, 1]]), [null], 'a span under 2 s is not read');
    const segs = [{ file: '../take.mp4', in: 0, out: 1 }, { file: '../take.mp4', in: 1, out: 2 }];
    const res = GM.match({ python: PY, build, segs, shotStart: [0, 1], targets: [target, null] });
    assert.ok(res.ok && res.single, JSON.stringify(res));
    assert.strictEqual(segs[0].lut, 'grade.cube'); assert.strictEqual(segs[1].lut, 'grade.cube'); assert.ok(!fs.existsSync(path.join(build, 'grade')), 'the work folder is gone'); assert.ok(res.shots[1].borrowed);
    assert.ok(res.shots[0].after < res.shots[0].before, `distance ${res.shots[0].before} -> ${res.shots[0].after}`);
    assert.ok(res.shots[0].strength <= GM.STRENGTH && res.shots[0].strength >= 0.3);
    const cube = fs.readFileSync(path.join(build, 'grade.cube'), 'utf8').trim().split('\n');
    assert.ok(cube.includes('LUT_3D_SIZE 33')); const rows = cube.filter(l => /^[\d.]+ [\d.]+ [\d.]+$/.test(l)).map(l => l.split(' ').map(Number));
    assert.strictEqual(rows.length, 33 ** 3); assert.ok(rows.every(r => r.every(v => v >= 0 && v <= 1)), 'every LUT value inside 0..1');
    // skin (a light skin tone) moves less than the teal wall: red fastest in a .cube, so index = r + 33 g + 33*33 b
    const at = (r, g, b) => rows[Math.round(r * 32) + 33 * Math.round(g * 32) + 33 * 33 * Math.round(b * 32)], moved = (c) => Math.hypot(...at(...c).map((v, i) => v - Math.round(c[i] * 32) / 32));
    assert.ok(moved([0.82, 0.6, 0.5]) < moved([0.12, 0.3, 0.3]), `skin ${moved([0.82, 0.6, 0.5]).toFixed(3)} against the wall ${moved([0.12, 0.3, 0.3]).toFixed(3)}`);
    assert.ok(/^grade: matched the reference with one LUT/.test(GM.line(res)) && /skin kept/.test(GM.line(res)), GM.line(res));
    // a shot whose target is another grade gets its own LUT
    const res2 = GM.match({ python: PY, build, segs, shotStart: [0, 1], targets: [target, { mean: [target.mean[0], target.mean[1] - 12, target.mean[2] - 20], std: target.std }] });
    assert.ok(res2.ok && !res2.single && segs[0].lut !== segs[1].lut && segs.every(x => /^grade(-shot-\d+)?\.cube$/.test(x.lut) && fs.existsSync(path.join(build, x.lut))), JSON.stringify(segs));
    assert.ok(/per shot/.test(GM.line(res2)));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', take, '-frames:v', '1', '-vf', `lut3d=file='${path.join(build, segs[0].lut).replace(/\\/g, '/')}':interp=tetrahedral`, path.join(dir, 'graded.png')]);
    assert.ok(fs.statSync(path.join(dir, 'graded.png')).size > 1000);
    assert.strictEqual(GM.match({ python: PY, build, segs, shotStart: [0, 1], targets: [null, null] }).ok, false, 'no target, no match');
  });

  t('the assembler renders a reframed, graded segment', () => {
    const build = path.join(dir, 'build');
    fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify({ segs: [{ file: '../take.mp4', in: 0, out: 1, zoom: 1.6, punchX: 0.4, punchY: 0.7, lut: 'grade.cube' }, { file: '../take.mp4', in: 1, out: 2, zoom: 1.8, punchX: 0.5, punchY: 0.75, lut: 'grade.cube', push: 0.07 }], tail: 0, punch: false, hits: [] }));
    execFileSync(process.execPath, [path.join(KIT, 'assemble.cjs'), 'base.mp4'], { cwd: build, stdio: 'pipe', env: { ...process.env, BASEONLY: '1' } });
    const d = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(build, 'base.mp4')]).toString().trim();
    near(d, 2, 0.1, 'length');
  });
} else for (const x of ['framing.py and the crop, end to end', 'reframeShots on segments', 'grade match and the LUT', 'the assembler renders a reframed, graded segment']) skip(x);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`REFRAME AND GRADE PASS (${n} tests${skipped ? ', ' + skipped + ' skipped' : ''})`);
