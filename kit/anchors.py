"""Find shapes in a shot that a word can line up with, the way an editor sets type against the room and the speaker:
a hard horizontal line (a monitor's top edge, a light bar, a shelf, a picture frame), the top of the speaker's head,
and the line of each shoulder. Each comes back as a baseline to set a word on and the span it may fill. The outline
over the head and shoulders also comes back as a path ("arc") for text that follows its curve.

    python kit/anchors.py <clip> <seconds> [<clip> <seconds> ...]
    -> one JSON line per shot: {"line": {"y", "x0", "x1"} | null, "head": {...} | null, "shoulders": [{...}, ...],
                                "arc": [[x, y], ...] | null}
       (1080x1920 pixels; y is the baseline, the word sits on it between x0 and x1)

reel.cjs uses it for the oneword look: b-roll cutaways set the word on a line (else a shoulder, else the head), and on
the speaker's own shot some key words sit on a shoulder or on the head while the small words run on at chest height.
The person is cut out with the same rembg matte the titles use (kit/mask_refine.py), so a word never lands on hair,
hands or a shirt. Needs npm run effects:setup.
"""
import json, os, subprocess, sys
import numpy as np

W, H, S = 270, 480, 4  # analysed at a quarter of 1080x1920
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def grab(f, t, w, h, fmt, ch):
    vf = f'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale={w}:{h}'
    b = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t), '-i', f, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', fmt, '-'], capture_output=True, check=True).stdout
    return np.frombuffer(b, np.uint8).reshape(h, w, ch) if ch > 1 else np.frombuffer(b, np.uint8).reshape(h, w)


def line_in(g, fg=None):
    """g: HxW gray, fg: HxW bool (True = person/foreground) or None. The line with the most clean space above it."""
    if fg is not None and fg.mean() > 0.5: return None  # a close-up (hands, a face): no room to set a word on
    g = g.astype(np.float32)
    best = None
    for y in range(90, 313):  # lines at 360 to 1250 in the full frame: room for a word above, clear of the caption band
        # strong vertical change, averaged over 3 columns and 4 rows so camera noise doesn't break the run
        d = np.abs(g[y + 2] + g[y + 1] - g[y - 1] - g[y - 2])
        d = (d[:-2] + d[1:-1] + d[2:]) / 6
        s, gap, bs, be = -1, 0, 0, 0
        for x, on in enumerate(d > 14, 1):
            if on:
                if s < 0: s = x
                gap = 0
                if x + 1 - s > be - bs: bs, be = s, x + 1
            elif s >= 0:
                gap += 1
                if gap > 6: s, gap = -1, 0
        if be - bs < W * 0.2: continue
        above = g[y - 40:y - 4, bs:be]  # a word's height (about 150 px) over the line
        tex = float(np.abs(np.diff(above, axis=0)).mean() + np.abs(np.diff(above, axis=1)).mean())
        if tex >= 9: continue
        if fg is not None and fg[y - 40:y, bs:be].mean() > 0.03: continue  # the space above is the person, not the room
        score = (be - bs) / (1 + tex)
        if best is None or score > best['score']: best = {'y': y * S, 'x0': bs * S, 'x1': be * S, 'score': round(score, 1)}
    return best and {k: best[k] for k in ('y', 'x0', 'x1')}


def silhouette(fg):
    """The top of the head and the line of each shoulder, from the person's outline. fg: HxW bool."""
    out = {'head': None, 'shoulders': [], 'arc': None}
    if fg is None or fg.mean() < 0.04 or fg.mean() > 0.6: return out  # no one in shot, or a close-up
    cols = fg.any(axis=0)
    top = np.where(cols, fg.argmax(axis=0), H)  # first person row per column
    xs = np.where(cols)[0]
    if len(xs) < W * 0.15: return out
    ht = int(top.min())
    if ht < 30: return out  # the head runs off the top of the frame
    hx = np.where(top <= ht + 18)[0]  # the head: columns within ~70 px of its top
    hx0, hx1 = int(hx.min()), int(hx.max()) + 1
    if 8 <= hx1 - hx0 <= W * 0.6:
        out['head'] = {'y': ht * S - 14, 'x0': max(0, hx0 * S - (hx1 - hx0) * S // 3), 'x1': min(1080, hx1 * S + (hx1 - hx0) * S // 3)}
    # the outline itself, for text that follows it: from beside the head, over it, to the other side, smoothed and
    # lifted about 40 px off the person along its normal, as points in full-frame pixels
    hw = hx1 - hx0
    a0, a1 = max(0, hx0 - int(hw * 0.9)), min(W, hx1 + int(hw * 0.9))
    cx, ty = np.arange(a0, a1), top[a0:a1].astype(float)
    ok = ty < H
    if hw >= 8 and ok.sum() > (a1 - a0) * 0.8:
        ty = np.interp(cx, cx[ok], ty[ok])
        ty = np.convolve(np.pad(ty, 7, mode='edge'), np.ones(15) / 15, mode='valid')
        dy = np.gradient(ty); n = np.hypot(dy, 1.0)
        px, py = cx + dy / n * 10, ty - 1.0 / n * 10  # the normal pointing away from the person
        pts, last = [], -1e9
        for x, y in zip(px, py):  # keep it running left to right: on a steep side the offset can fold back on itself
            if x > last + 2 and y > 4: pts.append([int(round(x * S)), int(round(y * S))]); last = x
        out['arc'] = pts if len(pts) > 10 else None
    # each shoulder: the flattest stretch of outline beside the head, at least a fifth of the frame wide, with room above
    for side, rng in (('left', range(hx0 - 1, -1, -1)), ('right', range(hx1, W))):
        seg = [x for x in rng if top[x] < H and top[x] > ht + 30]
        if len(seg) < W * 0.2: continue
        ys = top[seg].astype(float)
        best = None
        for a in range(0, len(seg) - int(W * 0.2) + 1, 3):
            b = a + int(W * 0.2)
            run = ys[a:b]
            if np.abs(np.diff(run)).max() > 6: continue  # a sharp step in the outline (an arm, the chair): not a shoulder line
            slope = abs(run[-1] - run[0]) / (b - a)
            if slope > 0.6: continue
            if best is None or slope < best[0]: best = (slope, a, b)
        if best:
            _, a, b = best
            x0, x1 = sorted((seg[a], seg[b - 1]))
            y = int(np.percentile(ys[a:b], 15))  # the word's baseline sits on the higher part of the slope
            if y > 90: out['shoulders'].append({'side': side, 'y': y * S - 10, 'x0': x0 * S, 'x1': (x1 + 1) * S})
    return out


def selftest():
    g = np.full((H, W), 208, np.uint8); g[200:210, 50:220] = 32  # a dark bar on a light wall
    r = line_in(g); assert r and abs(r['y'] - 800) <= 12 and abs(r['x0'] - 200) <= 12 and abs(r['x1'] - 880) <= 12, r
    fg = np.zeros((H, W), bool); fg[150:205, 40:230] = True  # a person standing over the bar: no line
    assert line_in(g, fg) is None
    # a head (rows 120-, cols 110-160) on shoulders (rows 230-, cols 40-230)
    fg = np.zeros((H, W), bool); fg[120:, 110:160] = True; fg[230:, 40:230] = True
    s = silhouette(fg)
    assert s['head'] and abs(s['head']['y'] - (120 * S - 14)) <= 4, s
    assert s['arc'] and min(y for _, y in s['arc']) < 120 * S - 20 and len(s['arc']) > 10, s['arc']  # the path rides over the head
    assert {x['side'] for x in s['shoulders']} == {'left', 'right'} and all(abs(x['y'] - (230 * S - 10)) <= 8 for x in s['shoulders']), s


if __name__ == '__main__':
    selftest()
    args, sess = sys.argv[1:], None
    try:
        import mask_refine as MR
        sess = MR.matte_session('birefnet')
    except Exception as e:  # no rembg: lines are still found, without the person check or the silhouette
        print(f'note: no person matte ({e}); lines may land on the person, and there is no head or shoulder line', file=sys.stderr)
    for f, t in zip(args[0::2], args[1::2]):
        fg = None
        if sess is not None:
            a = MR.matte_raw(sess, grab(f, t, 1080, 1920, 'rgb24', 3))
            fg = a.reshape(H, S, W, S).mean(axis=(1, 3)) > 0.3
        print(json.dumps({'line': line_in(grab(f, t, W, H, 'gray', 1), fg), **silhouette(fg)}), flush=True)
