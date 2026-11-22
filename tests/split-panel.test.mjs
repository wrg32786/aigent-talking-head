// The split panel (report 4 items 18 and 21): kit/split.cjs and kit/assemble.cjs.
// - the head band runs past the seam by the shadow's height, in the 9:16 reel and in the 4:5 and 1:1 frames, so the
//   shadow under the panel never draws a line across the head
// - "fit" on a split insert: a wide clip is shown whole, flush on the seam, over a blurred copy of itself; "cover"
//   keeps the old crop; anything squarer than 16:10 covers by default
// - with ffmpeg: a render where the head has no shadow on it, the room behind still has, and a 16:9 clip is whole
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPL = createRequire(import.meta.url)('../kit/split.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok   ' + name); };
const hasFf = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

t('the head band covers the shadow under the seam (9:16, 4:5, 1:1)', () => {
  const top = SPL.layout({ place: 'top' }, { crown: 400, cx: 540 });
  assert.strictEqual(top.band.y1, 960 + SPL.SHADOW_H + 4);
  for (const frame of [{ y0: 285, h: 1350 }, { y0: 420, h: 1080 }]) {
    const g = SPL.layout({ place: 'top' }, { crown: frame.y0 + 0.1 * frame.h, cx: 540 }, { frame });
    assert.ok(g.band.y1 >= g.seam + SPL.SHADOW_H, 'the band ends under the shadow'); assert.ok(g.band.y1 <= frame.y0 + frame.h, 'and inside the frame');
    assert.ok(g.band.y0 < g.seam - 72, 'and still starts above the head');
  }
  assert.strictEqual(SPL.layout({ place: 'top' }, { crown: 400, cx: 540 }, { mask: false }).band, null, 'no mask, no band');
  const fr = SPL.layout({ place: 'frame' }, { crown: 400, cx: 540 }); assert.strictEqual(fr.band.y1, fr.card.y + SPL.FRAME.border + 2, 'the framed card has no shadow strip and keeps its band');
});

t('fit: a wide clip is whole by default, the insert can say cover or whole', () => {
  const wide = { w: 1920, h: 1080 }, std = { w: 1440, h: 1080 }, tall = { w: 1080, h: 1920 };
  assert.strictEqual(SPL.fitOf({}, wide), 'whole'); assert.strictEqual(SPL.fitOf({}, { w: 2560, h: 1080 }), 'whole');
  assert.strictEqual(SPL.fitOf({}, std), 'cover'); assert.strictEqual(SPL.fitOf({}, tall), 'cover');
  assert.strictEqual(SPL.fitOf({ fit: 'cover' }, wide), 'cover'); assert.strictEqual(SPL.fitOf({ fit: 'whole' }, tall), 'whole');
  assert.strictEqual(SPL.fitOf({}, null), 'cover'); assert.strictEqual(SPL.fitOf({ fit: 'whole' }, null), 'cover', 'a clip we cannot measure covers');
  assert.strictEqual(SPL.fitOf({ fit: 'stretch' }, wide), 'whole', 'an unknown word falls back to the default');
  assert.deepStrictEqual(SPL.wholeBox(1080, 960, wide), { x: 0, y: 352, w: 1080, h: 608 });
  for (const [pw, ph] of [[1080, 960], [1080, 676], [1080, 540]]) for (const d of [wide, std, tall]) {
    const b = SPL.wholeBox(pw, ph, d);
    assert.strictEqual(b.y + b.h, ph, 'flush on the seam'); assert.ok(b.x >= 0 && b.w <= pw && b.h <= ph && b.w % 2 === 0 && b.h % 2 === 0);
    assert.ok(Math.abs(b.w / b.h - d.w / d.h) < 0.02, 'the clip keeps its shape');
  }
});

if (hasFf) t('a render: no shadow on the head, the shadow stays on the room, a 16:9 clip is whole on its own blur', () => {
  const b = mkdtempSync(join(tmpdir(), 'split-panel-'));
  try {
    const ff = a => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'pipe' }), enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
    ff(['-f', 'lavfi', '-i', 'color=c=0x4060c0:s=1080x1920:r=24:d=4', '-f', 'lavfi', '-i', 'sine=f=300:d=4', '-shortest', ...enc, join(b, 'base.mp4')]);
    // the person: a column in the middle of the picture, top to bottom
    ff(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=24:d=4,drawbox=x=400:y=0:w=280:h=1920:c=white:t=fill,format=gray', '-c:v', 'ffv1', join(b, 'mask.mkv')]);
    // a wide clip: red with a white edge all round
    ff(['-f', 'lavfi', '-i', 'color=c=red:s=1280x720:r=24:d=3,drawbox=x=0:y=0:w=1280:h=720:c=white:t=40', ...enc, join(b, 'wide.mp4')]);
    writeFileSync(join(b, 'cut.json'), JSON.stringify({ segs: [{ file: 'base.mp4', in: 0, out: 4 }], tail: 0, mask: 'mask.mkv',
      inserts: [{ file: 'wide.mp4', at: 0.5, dur: 1, place: 'top', faceY: 0.4 }, { file: 'wide.mp4', at: 2.5, dur: 1, place: 'top', faceY: 0.4, fit: 'cover' }] }));
    execFileSync(process.execPath, [join(ROOT, 'kit', 'assemble.cjs'), 'out.mp4'], { cwd: b, env: { ...process.env, NOBED: '1', NOSFX: '1', MASK_WARNED: '1' }, stdio: 'pipe' });
    const px = (tm, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(tm), '-i', join(b, 'out.mp4'), '-frames:v', '1', '-vf', `format=rgb24,crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])].slice(0, 3);
    const lum = p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2], white = p => p.every(v => v > 200), red = p => p[0] > 170 && p[1] < 80 && p[2] < 80;
    // item 18: just under the seam the head is as bright as a little further down (past the shadow), the room beside it is darker
    const head = lum(px(1, 540, 964)), headLow = lum(px(1, 540, 1012)), room = lum(px(1, 100, 964)), roomLow = lum(px(1, 100, 1012));
    assert.ok(Math.abs(head - headLow) <= 3, `the shadow crosses the head (${head.toFixed(1)} against ${headLow.toFixed(1)})`);
    assert.ok(room < roomLow - 12, `the shadow is gone from the room (${room.toFixed(1)} against ${roomLow.toFixed(1)})`);
    // item 21: whole: the clip's own edges are in the panel, sharp, its lower edge on the seam, a blurred copy above
    assert.ok(white(px(1, 8, 660)) && white(px(1, 1068, 660)), 'whole: the left and right edges of the clip are on screen');
    assert.ok(white(px(1, 200, 362)) && red(px(1, 200, 600)) && white(px(1, 200, 950)), 'whole: the clip sits from row 352 down to the seam');
    const blur = px(1, 200, 150); assert.ok(!white(blur) && blur[0] > 90 && blur[0] > blur[1] + 40, 'whole: a blurred copy of the clip fills the rest of the panel: ' + blur);
    // cover (asked for): the sides are cropped away, as before
    assert.ok(red(px(3, 8, 660)) && red(px(3, 1068, 660)) && red(px(3, 200, 362)), 'cover: the clip fills the panel');
  } finally { rmSync(b, { recursive: true, force: true }); }
}); else console.log('skip a render of the split panel (needs ffmpeg)');
console.log(`\n${n} split panel tests passed`);
