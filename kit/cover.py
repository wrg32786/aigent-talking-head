"""How much of each title behind the head does the person cover? Measured from the person mask, not guessed.

    python kit/cover.py <build dir> <spans json>      spans: [[start, end], ...], one per title behind the head

For each title, three moments after its entrance settle (0.6 s in, the middle, 0.15 s before it ends): the title layer
(build/ovlt/NNNN.png, the part drawn behind the person) says where its letters are, and the person mask (cut.json
"mask", 255 = person) says which of those pixels the head hides. Prints one JSON list, the covered fraction of the
letters per title (the worst of the three moments), or null when the title layer has no letters there.
kit/reel.cjs uses it: a word whose covered fraction is over cut.json "behindMax" (default 0.22) moves in front.
Common short-form editing advice: a word tucked behind the head reads only while most of its letters show.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image

W, H, FPS = 1080, 1920, 24


def covered(alpha, mask):
    """alpha: HxW title layer alpha 0..255, mask: HxW person mask 0..255 -> covered fraction of the letters, or None"""
    ink = alpha > 128
    n = int(ink.sum())
    if n < 200: return None
    return float((ink & (mask > 128)).sum()) / n


def selftest():
    a = np.zeros((H, W), np.uint8); a[800:900, 200:880] = 255
    m = np.zeros((H, W), np.uint8); m[:, 400:700] = 255
    r = covered(a, m); assert abs(r - 300 / 680) < 1e-6, r
    assert covered(np.zeros((H, W), np.uint8), m) is None


def main():
    selftest()
    build, spans = sys.argv[1], json.loads(sys.argv[2])
    cut = json.load(open(os.path.join(build, 'cut.json'), encoding='utf-8'))
    mf = cut.get('mask') if isinstance(cut.get('mask'), str) else (cut.get('mask') or {}).get('file')
    mf = os.path.join(build, mf or 'mask.mkv')
    ovlt = os.path.join(build, 'ovlt')
    if not os.path.exists(mf) or not os.path.isdir(ovlt):
        print(json.dumps([None] * len(spans))); return
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', mf, '-vf', f'fps={FPS},scale={W}:{H},format=gray', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    masks = np.frombuffer(raw, np.uint8).reshape(-1, H, W)
    out = []
    for a, b in spans:
        ts = sorted({min(b - 0.15, a + 0.6), (a + b) / 2, b - 0.15})
        best = None
        for t in ts:
            i = int(round(max(a, t) * FPS)); f = os.path.join(ovlt, f'{i:04d}.png')
            if i >= len(masks) or not os.path.exists(f): continue
            r = covered(np.asarray(Image.open(f).convert('RGBA'))[..., 3], masks[i])
            if r is not None: best = r if best is None else max(best, r)
        out.append(None if best is None else round(best, 3))
    print(json.dumps(out))


if __name__ == '__main__':
    main()
