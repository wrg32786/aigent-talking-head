#!/usr/bin/env python3
"""How far the camera moves inside a shot: the zoom gained from its first frame to its last, and the pan.

    python kit/camera_move.py measure <video> --spans 0-2.3,2.3-3.3 [--json out.json]

rea-video names a move (push in, pull out, pan) and does not say how big it is. A remake needs the size: a push of
3 percent on a talking head cannot be seen, one of 12 percent can. The teardown (kit/teardown.py extras) calls this
per shot and the recipe carries the number as "move-size".

How: the video is read once at 8 frames a second, small and grey. Inside a shot, corners are followed from one
sampled frame to the next (Lucas-Kanade) and the move between the two is the similarity transform most of them
agree on (RANSAC), so a speaker who moves or a caption that changes does not count as the camera. The steps
are multiplied over the shot.

Per span:
  scale  the zoom gained over the shot: 0.08 is a push in of 8 percent, -0.05 a pull out of 5 percent
  dx dy  the pan over the shot, shares of the frame (plus: the picture slides right / down)
  n      the frame pairs that agreed on a move, of "of"
A span with under two frames, or where under half the pairs could be read, has no numbers (null).
Needs only opencv and numpy.
"""
import argparse, json, math, os, subprocess, sys
import numpy as np

AW, AH, FPS = 270, 480, 8


def read_frames(video, fps=FPS):
    """Every sampled frame of the video as (seconds, grey image)."""
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', video, '-vf', f'fps={fps},scale={AW}:{AH}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], stdout=subprocess.PIPE)
    n = 0
    while True:
        raw = p.stdout.read(AW * AH)
        if len(raw) < AW * AH:
            break
        yield (n + 0.5) / fps, np.frombuffer(raw, np.uint8).reshape(AH, AW)
        n += 1
    p.stdout.close()
    p.wait()


def step(a, b):
    """The camera's move from frame a to frame b: (scale, dx, dy) with dx, dy in pixels, or None when it cannot be read."""
    import cv2
    pts = cv2.goodFeaturesToTrack(a, maxCorners=400, qualityLevel=0.01, minDistance=6)
    if pts is None or len(pts) < 24:
        return None
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(a, b, pts, None, winSize=(21, 21), maxLevel=3)
    good = st.reshape(-1) == 1
    if good.sum() < 24:
        return None
    M, inl = cv2.estimateAffinePartial2D(pts[good], nxt[good], method=cv2.RANSAC, ransacReprojThreshold=1.5)
    if M is None or inl is None or inl.sum() < max(16, 0.3 * good.sum()):
        return None
    s = math.hypot(M[0, 0], M[1, 0])
    if not 0.8 < s < 1.25:  # one sixth of a second cannot hold a real move this big: a cut or a flash
        return None
    # the move of the picture's centre, so a zoom about the centre is not read as a pan
    cx, cy = AW / 2, AH / 2
    return s, float(M[0, 0] * cx + M[0, 1] * cy + M[0, 2] - cx), float(M[1, 0] * cx + M[1, 1] * cy + M[1, 2] - cy)


def measure_frames(frames, stretch=1.0):
    """The move over a list of grey frames in play order. stretch: the shot's length over the time the frames
    cover, so the move is the whole shot's and not only the part between the first and last sampled frame."""
    if len(frames) < 2:
        return None
    ls, dx, dy, n = 0.0, 0.0, 0.0, 0
    for a, b in zip(frames, frames[1:]):
        m = step(a, b)
        if not m:
            continue
        ls += math.log(m[0]); dx += m[1]; dy += m[2]; n += 1
    of = len(frames) - 1
    if n * 2 < of:
        return None
    # the pairs that could not be read are assumed to move like the rest
    k = of / n * max(1.0, min(2.0, stretch))
    return {'scale': round(math.exp(ls * k) - 1, 4), 'dx': round(dx * k / AW, 4), 'dy': round(dy * k / AH, 4), 'n': n, 'of': of}


def measure_spans(video, spans, edge=0.09):
    """One result per span. edge: seconds left out at each end of a span, where a transition sits."""
    spans = [(float(a), float(b)) for a, b in spans]
    held = [[] for _ in spans]
    for t, img in read_frames(video):
        for i, (a, b) in enumerate(spans):
            pad = min(edge, (b - a) * 0.15)
            if a + pad <= t <= b - pad:
                held[i].append((t, img.copy()))
    return [measure_frames([x[1] for x in f], (b - a) / max(1e-6, f[-1][0] - f[0][0]) if len(f) > 1 else 1.0) for f, (a, b) in zip(held, spans)]


def parse_spans(s):
    out = []
    for part in str(s or '').split(','):
        part = part.strip()
        if part:
            a, b = part.split('-', 1)
            out.append((float(a), float(b)))
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('measure')
    p.add_argument('video'); p.add_argument('--spans', required=True); p.add_argument('--json')
    a = ap.parse_args()
    res = {'video': os.path.abspath(a.video), 'spans': measure_spans(a.video, parse_spans(a.spans))}
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(res, f)
    print(json.dumps(res))
