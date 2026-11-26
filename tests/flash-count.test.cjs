// Painted cells and decoded frames for the flash check. Run with node tests/flash-count.test.cjs.
'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const cp = require('child_process'), pic = require('../kit/picturecheck.cjs');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (e) { process.exitCode = 1; console.error('FAIL ' + name + ': ' + e.name + ': ' + e.message); }
}
const empty = { freezes: [], blacks: [], stats: [] }, windows = { still: [], dark: [], noisy: [], cuts: 0 };
const result = count => ({ luminance: { count, time: 0.1 }, red: { count: 0, time: 0 } });
const hasFlash = lines => lines.some(s => /flash/i.test(s));
test('judge fails four flashes even across effects and dips', () => {
  const measured = { ...empty, flash: result(8) };
  assert.ok(hasFlash(pic.judge(measured, windows).fails), 'four flashes need a FAIL line');
  const all = { ...windows, noisy: [[0, 2]], dark: [[0, 2]] };
  assert.ok(hasFlash(pic.judge(measured, all, { fxPass: true }).fails));
});
test('three flashes give a note', () => {
  const j = pic.judge({ ...empty, flash: result(6) }, windows);
  assert.ok(hasFlash(j.notes), 'three flashes need a note');
  assert.equal(j.fails.length, 0);
});
test('a missing flash read gives a note', () => {
  const j = pic.judge({ ...empty, flash: { error: 'no RGB frames' } }, windows);
  assert.ok(j.notes.some(s => s.includes('no RGB frames')));
  assert.ok(!hasFlash(j.oks));
});
const lit = (t, n) => t < 30 && t % Math.floor(30 / n) === 3 && Math.floor(t / Math.floor(30 / n)) < n;
// Exercise measure even on hosts that cannot spawn ffmpeg. Supply its RGB and metadata output.
test('measure carries four decoded flashes through to judge', () => {
  const frameBytes = 90 * 160 * 3, raw = Buffer.alloc(60 * frameBytes);
  for (let t = 0; t < 60; t++) if (lit(t, 4)) raw.fill(255, t * frameBytes, (t + 1) * frameBytes);
  const meta = Array.from({ length: 60 }, (_, t) => 'frame:' + t + ' pts_time:' + (t / 30) + '\nlavfi.signalstats.YAVG=60').join('\n');
  const id = require.resolve('../kit/picturecheck.cjs'), cached = require.cache[id], spawn = cp.spawnSync;
  try {
    cp.spawnSync = (_, args) => ({ status: 0, stdout: args.includes('rawvideo') ? raw : meta });
    delete require.cache[id];
    const m = require(id).measure('painted', 2);
    assert.ok(hasFlash(pic.judge(m, windows).fails), 'measure needs a flash FAIL line');
    assert.ok(m.flash.luminance.count >= 7);
  } finally { require.cache[id] = cached; cp.spawnSync = spawn; }
});
function paint(value, cells = 144, red = false) {
  return Array.from({ length: 60 }, (_, t) => {
    const y = new Float64Array(144), r = new Float64Array(144), s = new Float64Array(144);
    y.fill(value(t) * (red ? 0.2126 : 1), 0, cells);
    if (red) { r.fill(value(t) * 320, 0, cells); s.fill(value(t), 0, cells); }
    return { y, r, s };
  });
}
for (const [name, series, channel, min, max] of [
  ['four white flashes', paint(t => +lit(t, 4)), 'luminance', 7, 8],
  ['three white flashes', paint(t => +lit(t, 3)), 'luminance', 5, 6],
  ['a seventh of the picture', paint(t => +lit(t, 4), 21), 'luminance', 0, 4],
  ['one cut', paint(t => +(t >= 20)), 'luminance', 0, 4],
  ['a slow fade', paint(t => Math.min(1, t / 30)), 'luminance', 0, 4],
  ['four red flashes', paint(t => +lit(t, 4), 144, true), 'red', 7, 8],
]) test(name, () => {
  const { count } = pic.flashCount(series, 30)[channel];
  assert.ok(count >= min && count <= max, String(count));
});
test('a second at 24 fps excludes the fourth flash', () => {
  const series = paint(t => +[3, 11, 19, 28].includes(t));
  assert.equal(pic.flashCount(series, 24).luminance.count, 6);
  assert.equal(pic.flashCount(series, 30).luminance.count, 8);
});
// On a strobe an up and a down sit on neighbouring frames. Each one is a transition of its own.
test('a strobe that flips every frame counts every flip', () => {
  const white = pic.flashCount(paint(t => t % 2), 30).luminance.count;
  assert.ok(white >= 29, String(white));
  const red = pic.flashCount(paint(t => t % 2, 144, true), 30).red.count;
  assert.ok(red >= 29, String(red));
});
// Two halves that swap on every frame: as many cells go up as go down, so the picture has no one direction,
// yet every cell flashes fifteen times a second.
test('two halves flipping against each other count as flashing', () => {
  const series = paint(() => 0);
  for (let t = 0; t < 60; t++) series[t].y.fill(1, t % 2 ? 0 : 72, t % 2 ? 72 : 144);
  const { count } = pic.flashCount(series, 30).luminance;
  assert.ok(count >= 29, String(count));
});
test('a fifth of the picture flashing on its own stays under the area', () => {
  const series = paint(() => 0);
  for (let t = 0; t < 60; t++) if (t % 2) series[t].y.fill(1, 0, 29);
  assert.ok(pic.flashCount(series, 30).luminance.count < 5);
});
test('a flip every second frame counts every flip', () => {
  const { count } = pic.flashCount(paint(t => +(t % 4 < 2)), 30).luminance;
  assert.ok(count >= 14 && count <= 16, String(count));
});
test('a swing spread over two frames is one transition', () => {
  // A fifth of the cells change on one frame and a fifth on the next. Either alone is under the quarter.
  const series = paint(() => 0);
  for (let t = 0; t < 60; t++) {
    if (t >= 10 && t < 40) series[t].y.fill(1, 0, 29);
    if (t >= 11 && t < 40) series[t].y.fill(1, 29, 58);
  }
  assert.equal(pic.flashCount(series, 30).luminance.count, 2);
});
test('bright swings and unsaturated red stay below the limit', () => {
  const series = paint(t => +lit(t, 4), 144, true);
  for (const frame of series) {
    frame.y.fill(frame.y[0] > 0 ? 1 : 0.8);
    frame.s.fill(0.79);
  }
  const counts = pic.flashCount(series, 30);
  assert.equal(counts.luminance.count, 0);
  assert.equal(counts.red.count, 0);
});
test('cell means use linear light and each pixel\'s red share', () => {
  const rgb = Buffer.alloc(90 * 160 * 3);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    rgb.set(x < 5 ? [255, 0, 0] : [0, 128, 0], (y * 90 + x) * 3);
  }
  const cells = pic.flashCells(rgb);
  assert.ok(Math.abs(cells.y[0] - (0.2126 + 0.7152 * 0.215861) / 2) < 1e-6);
  assert.equal(cells.r[0], 160);
  assert.equal(cells.s[0], 0.5);
  assert.equal(cells.y[1], 0);
});
const probe = cp.spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (probe.error && ['ENOENT', 'EACCES', 'EPERM'].includes(probe.error.code)) {
  console.log('SKIP real flash clips: ' + probe.error.message);
} else test('measure reads a flashing clip and a steady clip', () => {
  assert.equal(probe.status, 0, String(probe.error || probe.stderr));
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'flash-count-'));
  try {
    for (const flashing of [true, false]) {
      const file = path.join(dir, String(flashing) + '.mkv');
      const filter = flashing ? ",drawbox=color=white:t=fill:enable='lt(n,28)*eq(mod(n,7),3)'" : '';
      cp.execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=gray:s=90x160:r=30:d=2' + filter, '-c:v', 'ffv1', file]);
      const m = pic.measure(file, 2);
      if (flashing) assert.ok(hasFlash(pic.judge(m, windows).fails), 'four flashes in the file need a FAIL line');
      assert.ok(flashing ? m.flash.luminance.count >= 7 : m.flash.luminance.count === 0);
      assert.equal(m.flash.red.count, 0);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
console.log(passed + ' flash tests passed');
