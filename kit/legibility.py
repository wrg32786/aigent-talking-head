"""Is every caption word readable against what's behind it? Measures the finished reel, not the plan.

    python kit/legibility.py <build dir> <reel.mp4> [--min 3.0] [--every 3]

For each sampled frame, the caption layer (build/ovl/NNNN.png) says where the letters are. The script compares the
letters' brightness in the finished reel with a ring of picture just outside them (WCAG contrast ratio, the measure for
text on a background). Under --min (3.0, the floor for large text) the moment is listed. Frames where the caption layer
is a type card or a glitch frame are skipped, since their ink is set against a flat colour. Exit code 1 when any moment is
under the floor, so npm run verify and the smoke test can use it.

Why: curved text over a busy painting washed out (Will, 2026-11-11). The glow and edge in overlay.html fix most of it;
this catches the rest.
"""
import json, os, re, subprocess, sys
import numpy as np
from PIL import Image

W, H = 1080, 1920


def lum(rgb):
    c = rgb.astype(np.float32) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def ratio(a, b):
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r: out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def check(alpha, frame):
    """alpha: HxW caption layer alpha (0..1), frame: HxWx3 finished frame. Contrast of the letters against the ring
    around them, or None when there's no text or the layer is a full-frame card. Measured at quarter size."""
    a = alpha[::4, ::4]; f = frame[::4, ::4]
    if a.mean() > 0.15: return None  # a type card (or a glitch frame's bars): not text on the picture
    core = a > 0.9
    if core.sum() < 30: return None
    ring = dilate(core, 4) & ~dilate(core, 1)
    if ring.sum() < 30: return None
    L = lum(f)
    return ratio(float(np.median(L[core])), float(np.median(L[ring])))


def selftest():
    a = np.zeros((H, W), np.float32); a[900:1000, 400:700] = 1  # a block of "text"
    f = np.full((H, W, 3), 230, np.uint8); f[900:1000, 400:700] = 255  # white text on a near-white wall: unreadable
    r = check(a, f); assert r is not None and r < 1.5, r
    f[880:1020, 380:720] = 20; f[900:1000, 400:700] = 255  # the same text with a dark glow round it: readable
    r = check(a, f); assert r > 7, r
    assert check(np.ones((H, W), np.float32), f) is None  # a card


def main():
    selftest()
    build, reel = sys.argv[1], sys.argv[2]
    lim = float(sys.argv[sys.argv.index('--min') + 1]) if '--min' in sys.argv else 3.0
    every = int(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 3
    ovl = os.path.join(build, 'ovl')
    n = len([x for x in os.listdir(ovl) if x.endswith('.png')])
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', reel, '-vf', f'fps=24:start_time=0,select=not(mod(n\\,{every})),scale={W}:{H}', '-vsync', 'vfr', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    # the glitch hits on a cut (cut.json "hits", captions.js "glitchAt") scramble the picture on purpose: skip them
    hits = []
    try: hits += [float(h[0]) for h in json.load(open(os.path.join(build, 'cut.json'), encoding='utf-8')).get('hits', [])]
    except (OSError, ValueError): pass
    try: hits += [float(h) for h in json.loads(re.search(r'=\s*(\{.*\})\s*;?\s*$', open(os.path.join(build, 'captions.js'), encoding='utf-8').read(), re.S).group(1)).get('glitchAt', [])]
    except (OSError, ValueError, AttributeError): pass
    bad, seen = [], 0
    for k, fr in enumerate(frames):
        i = k * every
        if i >= n: break
        if any(-0.08 <= i / 24 - h <= 0.3 for h in hits): continue
        # the caption layer can land a frame early or late on the picture at a cut: take the best of the three
        rs = [check(np.asarray(Image.open(os.path.join(ovl, f'{j:04d}.png')).convert('RGBA'))[..., 3].astype(np.float32) / 255, fr) for j in (i - 1, i, i + 1) if 0 <= j < n]
        if any(x is None for x in rs): continue  # a card or a glitch on one of them: not a fair read
        r = max(rs)
        seen += 1
        if r < lim: bad.append((i / 24, r))
    # group the bad moments into spans
    spans = []
    for t, r in bad:
        if spans and t - spans[-1][1] <= every / 24 + 0.01: spans[-1][1] = t; spans[-1][2] = min(spans[-1][2], r)
        else: spans.append([t, t, r])
    print(f'legibility: {seen} caption frames checked, {len(bad)} under {lim}:1')
    for a, b, r in spans: print(f'  {a:6.2f}-{b:6.2f} s  worst {r:.2f}:1')
    sys.exit(1 if spans else 0)


if __name__ == '__main__':
    main()
