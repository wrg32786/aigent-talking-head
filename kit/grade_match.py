#!/usr/bin/env python3
"""Grade match: move your take's colour to a reference's, shot by shot, and keep skin natural.

    python kit/grade_match.py stats <video> --spans 0-2.3,2.3-9 [--boxes boxes.json] [--min 2]
    python kit/grade_match.py fit <video> --spans 0-4,4-9 --targets targets.json --out-dir grade [--strength 0.85] [--skin 0.35] [--size 33]

stats  per span, the colour of a few frames in Lab (L 0..100): mean and spread per channel. A black span and a span
       under --min seconds give null (a fade or a flash, not a grade, as kit/teardown/grade.cjs reads it). --boxes
       is a list of {"t0", "t1", "box": [x, y, w, h]} (shares of the frame) left out of the count: the reference's
       own graphics (a yellow burst, a screen card) are not its grade.
fit    your spans against the targets (one {"mean": [L, a, b], "std": [..]} or null per span; null borrows the mean
       of the others). The transfer is per channel in Lab: (x - your mean) * (their spread / your spread) + their
       mean, with the spread ratio held between 0.6 and 1.6. On skin (a soft YCrCb range) only --skin of the change is
       applied, so faces do not go orange or green. The strength drops until under 1 percent of your pixels would
       clip. The result is baked as a 3D LUT (.cube): one for the spans whose targets agree (the same grade, seen
       in different shots), and one more for each span that differs.

Frames are scaled to cover 9:16 and centre cropped first, like kit/framing.py. Needs only opencv and numpy.
"""
import argparse, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from framing import cover_frame, sample_times, parse_spans  # noqa: E402

GAIN = (0.6, 1.6)      # the spread ratio stays inside this
MAX_CLIP = 0.01        # share of your pixels allowed to clip
AGREE_L, AGREE_AB = 12.0, 4.0   # targets this close in lightness and in a, b are one grade and share one LUT


def to_lab(rgb01):
    """float RGB 0..1 (N, 3) -> Lab (L 0..100)."""
    import cv2
    return cv2.cvtColor(rgb01.reshape(-1, 1, 3).astype(np.float32), cv2.COLOR_RGB2Lab).reshape(-1, 3).astype(np.float64)


def to_rgb(lab):
    import cv2
    return cv2.cvtColor(lab.reshape(-1, 1, 3).astype(np.float32), cv2.COLOR_Lab2RGB).reshape(-1, 3).astype(np.float64)


def skin_weight(rgb01):
    """0..1 per pixel: how much it reads as skin. A soft box in YCrCb (Cr 135..175, Cb 80..130, not dark)."""
    r, g, b = rgb01[:, 0] * 255, rgb01[:, 1] * 255, rgb01[:, 2] * 255
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cr = (r - y) * 0.713 + 128
    cb = (b - y) * 0.564 + 128
    soft = lambda v, lo, hi, e: np.clip((v - (lo - e)) / e, 0, 1) * np.clip(((hi + e) - v) / e, 0, 1)
    return soft(cr, 135, 175, 8) * soft(cb, 80, 130, 8) * np.clip((y - 35) / 25, 0, 1)


def pixels(video, a, b, samples=3, boxes=None):
    """RGB 0..1 pixels (N, 3) from a few frames of a span, the boxes left out. None for no frames."""
    out = []
    for t in sample_times(a, b, samples):
        img = cover_frame(video, t)
        if img is None:
            continue
        small = img[::2, ::2]
        keep = np.ones(small.shape[:2], bool)
        H, W = keep.shape
        for bx in boxes or []:
            if bx.get('t0', 0) - 0.3 <= t <= bx.get('t1', 1e9) + 0.3 and bx.get('box'):
                x, y, w, h = bx['box']
                keep[max(0, int((y - 0.02) * H)):int((y + h + 0.02) * H) + 1, max(0, int((x - 0.02) * W)):int((x + w + 0.02) * W) + 1] = False
        px = small[keep][:, ::-1].astype(np.float64) / 255.0
        if len(px):
            out.append(px)
    return np.concatenate(out) if out else None


def stats_of(px):
    lab = to_lab(px)
    return {'mean': [round(float(v), 2) for v in lab.mean(axis=0)], 'std': [round(float(v), 2) for v in lab.std(axis=0)]}


def span_stats(video, spans, samples=3, boxes=None, min_s=2.0):
    out = []
    for a, b in spans:
        if b - a < min_s:
            out.append(None); continue
        px = pixels(video, a, b, samples, boxes)
        if px is None:
            out.append(None); continue
        st = stats_of(px)
        out.append(None if st['mean'][0] < 8 else st)
    return out


def params(ours, target):
    """Per channel gain and the two means: x -> (x - mo) * g + mt."""
    g = [float(np.clip(target['std'][k] / max(1e-3, ours['std'][k]), *GAIN)) for k in range(3)]
    return {'g': g, 'mo': list(ours['mean']), 'mt': list(target['mean'])}


def transfer(rgb01, p, strength, skin):
    """The graded RGB (not clipped) for RGB 0..1 pixels."""
    lab = to_lab(rgb01)
    t = (lab - np.array(p['mo'])) * np.array(p['g']) + np.array(p['mt'])
    w = strength * (1 - (1 - skin) * skin_weight(rgb01))
    return to_rgb(lab + (t - lab) * w[:, None])


def lab_transfer_mean(rgb01, p, strength, skin):
    out = np.clip(transfer(rgb01, p, strength, skin), 0, 1)
    return to_lab(out).mean(axis=0)


def cap_strength(px, p, strength, skin):
    """Lower the strength until under MAX_CLIP of the pixels leave 0..1 (pixels already at the ends do not count)."""
    sub = px[:: max(1, len(px) // 20000)]
    inside = (sub.min(axis=1) > 0.004) & (sub.max(axis=1) < 0.996)
    s = strength
    while s > 0.3:
        # the Lab maths are not clipped, so going out of range shows as under 0 or over 1 after the way back
        lab = to_lab(sub)
        t = (lab - np.array(p['mo'])) * np.array(p['g']) + np.array(p['mt'])
        w = s * (1 - (1 - skin) * skin_weight(sub))
        lab2 = lab + (t - lab) * w[:, None]
        over = (lab2[:, 0] > 100.5) | (lab2[:, 0] < -0.5)
        rgb = to_rgb(lab2)
        over |= (rgb.max(axis=1) > 1.01) | (rgb.min(axis=1) < -0.01)
        if float((over & inside).mean()) <= MAX_CLIP:
            break
        s = round(s * 0.88, 3)
    return round(max(s, 0.3), 3)


def write_cube(path, p, strength, skin, size=33):
    ax = np.linspace(0, 1, size)
    # .cube order: red changes fastest, then green, then blue
    b, g, r = np.meshgrid(ax, ax, ax, indexing='ij')
    rgb = np.stack([r.ravel(), g.ravel(), b.ravel()], axis=1)
    out = np.clip(transfer(rgb, p, strength, skin), 0, 1)
    with open(path, 'w', encoding="utf-8") as fh:
        fh.write(f'TITLE "grade match"\nLUT_3D_SIZE {size}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n')
        for row in out:
            fh.write(f'{row[0]:.6f} {row[1]:.6f} {row[2]:.6f}\n')


def dist(a, b):
    return round(float(np.linalg.norm(np.array(a) - np.array(b))), 2)


def fit(video, spans, targets, out_dir, strength=0.85, skin=0.35, size=33, samples=3, per_shot=False):
    os.makedirs(out_dir, exist_ok=True)
    have = [t for t in targets if t]
    if not have:
        return {'ok': False, 'why': 'no target colour to match'}
    pooled = {'mean': [float(np.mean([t['mean'][k] for t in have])) for k in range(3)], 'std': [float(np.mean([t['std'][k] for t in have])) for k in range(3)]}
    rows = []
    for (a, b), tg in zip(spans, targets):
        px = pixels(video, a, b, samples)
        if px is None or stats_of(px)['mean'][0] < 8:
            rows.append(None); continue
        rows.append({'px': px, 'ours': stats_of(px), 'target': tg or pooled, 'borrowed': not tg})
    live = [r for r in rows if r]
    if not live:
        return {'ok': False, 'why': 'no frames to read in your take'}
    for r in live:
        r['p'] = params(r['ours'], r['target'])
    # the targets that sit close to the middle one are one grade (the small differences are what is in the shot, not
    # the grade), and so are your spans that sit close to your middle: those share one LUT. The rest get their own.
    med = lambda vals: float(np.median(vals))
    tc = [med([r['target']['mean'][k] for r in live]) for k in range(3)]
    oc = [med([r['ours']['mean'][k] for r in live]) for k in range(3)]
    near = lambda m, c, dl: abs(m[0] - c[0]) <= dl and abs(m[1] - c[1]) <= AGREE_AB and abs(m[2] - c[2]) <= AGREE_AB
    for r in live:
        r['common'] = not per_shot and near(r['target']['mean'], tc, AGREE_L) and near(r['ours']['mean'], oc, AGREE_L * 0.7)
    luts = []
    common = [r for r in live if r['common']]
    if common:
        allpx = np.concatenate([r['px'][:: max(1, len(r['px']) // 30000)] for r in common])
        ours = stats_of(allpx)
        tg = {'mean': [float(np.mean([r['target']['mean'][k] for r in common])) for k in range(3)], 'std': [float(np.mean([r['target']['std'][k] for r in common])) for k in range(3)]}
        p = params(ours, tg)
        s = cap_strength(allpx, p, strength, skin)
        f = os.path.join(out_dir, 'grade.cube')
        write_cube(f, p, s, skin, size)
        luts.append(f)
        for r in common:
            r.update(p=p, s=s, lut=f, target=tg)
    for i, r in enumerate(rows):
        if not r or r['common']:
            continue
        r['s'] = cap_strength(r['px'], r['p'], strength, skin)
        r['lut'] = os.path.join(out_dir, f'shot-{i + 1:02d}.cube')
        write_cube(r['lut'], r['p'], r['s'], skin, size)
        luts.append(r['lut'])
    agree = len(common) == len(live)
    shots = []
    for r in rows:
        if not r:
            shots.append(None); continue
        sub = r['px'][:: max(1, len(r['px']) // 20000)]
        after = lab_transfer_mean(sub, r['p'], r['s'], skin)
        shots.append({'lut': r['lut'], 'strength': r['s'], 'ours': r['ours'], 'target': {'mean': [round(v, 2) for v in r['target']['mean']], 'std': [round(v, 2) for v in r['target']['std']]},
                      'before': dist(r['ours']['mean'], r['target']['mean']), 'after': dist(after, r['target']['mean']),
                      'skin_share': round(float((skin_weight(sub) > 0.5).mean()), 3), **({'borrowed': True} if r['borrowed'] else {})})
    return {'ok': True, 'single': agree, 'skin': skin, 'size': size, 'luts': luts, 'shots': shots}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('stats'); p.add_argument('video'); p.add_argument('--spans', required=True)
    p.add_argument('--boxes'); p.add_argument('--min', type=float, default=2.0); p.add_argument('--samples', type=int, default=3)
    p = sub.add_parser('fit'); p.add_argument('video'); p.add_argument('--spans', required=True); p.add_argument('--targets', required=True)
    p.add_argument('--out-dir', required=True); p.add_argument('--strength', type=float, default=0.85); p.add_argument('--skin', type=float, default=0.35)
    p.add_argument('--size', type=int, default=33); p.add_argument('--samples', type=int, default=3); p.add_argument('--per-shot', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'stats':
        boxes = json.load(open(a.boxes, encoding="utf-8")) if a.boxes else None
        print(json.dumps({'spans': span_stats(a.video, parse_spans(a.spans), a.samples, boxes, a.min)}))
    else:
        print(json.dumps(fit(a.video, parse_spans(a.spans), json.load(open(a.targets, encoding="utf-8")), a.out_dir, a.strength, a.skin, a.size, a.samples, a.per_shot)))
