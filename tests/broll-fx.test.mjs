// What the teardown reads from a reference's B-roll (kit/broll_fx.py), on a fixture drawn here:
//   0 to 1.5 s    the speaker's shot (a still, textured picture)
//   1.5 to 4 s    a framed panel with a coral border pops in under the middle; the picture in it pushes in
//   4.5 to 6 s    a full-frame cutaway in black and white that shakes, cut in and out
//   6.5 to 8.5 s  a split screen: another picture in the top half
// It must find the panel's pop and push, the cutaway's black and white and shake, and the split span, and call
// nothing a glitch. Needs Python with opencv (PYTHON, or python3). Run: node tests/broll-fx.test.mjs   (npm run smoke runs it)
import assert from 'assert';
import { spawnSync, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), PY = process.env.PYTHON || 'python3';
if (spawnSync(PY, ['-c', 'import cv2, numpy']).status !== 0) { console.log('skip: no Python with opencv here (the B-roll effects reader needs it)'); process.exit(0); }
const T = mkdtempSync(join(tmpdir(), 'broll-fx-test-')), V = join(T, 'ref.mp4');
const GEN = `
import cv2, numpy as np, sys
W, H, FPS = 360, 640, 24
rng = np.random.default_rng(7)
def tex(seed, colour=True):
    r = np.random.default_rng(seed)
    small = r.integers(40, 215, (H // 16 + 2, W // 16 + 2, 3)).astype(np.uint8)
    img = cv2.resize(small, (W * 2, H * 2), interpolation=cv2.INTER_CUBIC)
    for _ in range(60):
        x, y = int(r.integers(0, W * 2)), int(r.integers(0, H * 2)); cv2.circle(img, (x, y), int(r.integers(6, 22)), [int(v) for v in r.integers(0, 255, 3)], -1)
    return img if colour else cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
def view(img, zoom=1.0, dx=0, dy=0, w=W, h=H):
    ih, iw = img.shape[:2]; cw, ch = iw / 2 / zoom, ih / 2 / zoom; cx, cy = iw / 2 + dx, ih / 2 + dy
    M = np.float32([[w / cw, 0, -(cx - cw / 2) * w / cw], [0, h / ch, -(cy - ch / 2) * h / ch]])
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
speaker, screen, street, other = tex(1), tex(2), tex(3, False), tex(4)
base = view(speaker)
vw = cv2.VideoWriter(sys.argv[1], cv2.VideoWriter_fourcc(*'mp4v'), FPS, (W, H))
BOX = (0.19, 0.57, 0.62, 0.21); CORAL = (91, 123, 216)
for i in range(int(8.5 * FPS)):
    t = i / FPS; f = base.copy()
    if 1.5 <= t < 4.0:
        k = min(1.0, 0.45 + 0.55 * (t - 1.5) / 0.25)             # pops in over 6 frames
        if t > 3.75: k = max(0.0, 1 - (t - 3.75) / 0.25)          # and fades by shrinking away
        bw, bh = int(BOX[2] * W * k), int(BOX[3] * H * k); cx, cy = int((BOX[0] + BOX[2] / 2) * W), int((BOX[1] + BOX[3] / 2) * H)
        if bw > 8 and bh > 8:
            z = 1 + 0.16 * (t - 1.5) / 2.5                         # the picture in it pushes in
            f[cy - bh // 2:cy - bh // 2 + bh, cx - bw // 2:cx - bw // 2 + bw] = view(screen, z, w=bw, h=bh)
            cv2.rectangle(f, (cx - bw // 2, cy - bh // 2), (cx - bw // 2 + bw, cy - bh // 2 + bh), CORAL, 3)
    elif 4.5 <= t < 6.0:
        f = view(street, 1.0, dx=(10 if i % 2 else -10), dy=(-8 if i % 2 else 8))   # a shake
    elif 6.5 <= t < 8.5:
        f[:H // 2] = view(other, w=W, h=H // 2); f[H // 2:] = base[H // 4:H // 4 + H // 2]
    vw.write(f)
vw.release()
`;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
try {
  const raw = join(T, 'raw.mp4'); writeFileSync(join(T, 'gen.py'), GEN);
  execFileSync(PY, [join(T, 'gen.py'), raw], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', V]);
  const slotsF = join(T, 'slots.json'), outF = join(T, 'out.json'), spF = join(T, 'splits.json');
  // the times a teardown would hand over: a quarter second off, as its detector steps
  writeFileSync(slotsF, JSON.stringify([{ n: 1, start: 1.75, end: 3.75, box: [0.19, 0.57, 0.62, 0.21], border: '#d87b5b' }, { n: 2, start: 4.5, end: 6.0, box: null }]));
  execFileSync(PY, [join(ROOT, 'kit', 'broll_fx.py'), 'measure', V, '--slots', slotsF, '--out', outF], { stdio: 'pipe' });
  const [panel, cut] = JSON.parse(readFileSync(outF, 'utf8'));
  t('a panel: it pops in, the picture in it pushes in, no shake, no glitch, its own colours', () => {
    assert.strictEqual(panel.in, 'pop', JSON.stringify(panel)); assert.strictEqual(panel.motion, 'push'); assert.ok(panel.zoom > 1.05 && panel.zoom < 1.3, 'zoom ' + panel.zoom);
    assert.strictEqual(panel.shake, false); assert.strictEqual(panel.glitch, false); assert.strictEqual(panel.colour, 'none');
    assert.ok(Math.abs(panel.at[0] - 1.5) < 0.2, 'the start is refined to where it really arrives: ' + panel.at);
  });
  t('a full cutaway: black and white, a shake, cut in and out', () => {
    assert.strictEqual(cut.colour, 'bw', JSON.stringify(cut)); assert.strictEqual(cut.shake, true); assert.strictEqual(cut.in, 'cut'); assert.strictEqual(cut.out, 'cut'); assert.strictEqual(cut.glitch, false);
  });
  t('a split screen is found by its seam, only where it is', () => {
    execFileSync(PY, [join(ROOT, 'kit', 'broll_fx.py'), 'splits', V, '--out', spF], { stdio: 'pipe' });
    const sp = JSON.parse(readFileSync(spF, 'utf8')); assert.strictEqual(sp.length, 1, JSON.stringify(sp));
    assert.ok(Math.abs(sp[0].start - 6.5) < 0.3 && Math.abs(sp[0].end - 8.5) < 0.35 && Math.abs(sp[0].seam - 0.5) < 0.02, JSON.stringify(sp[0]));
  });
  console.log(`\nB-ROLL FX PASS (${n} tests)`);
} finally { rmSync(T, { recursive: true, force: true }); }
