#!/usr/bin/env python3
# What a reference does with its B-roll, measured from the picture (kit/teardown.mjs runs this; kit/broll-slots.cjs
# reads it). Local files only, opencv and numpy.
#
#   python3 kit/broll_fx.py measure <video> --slots slots.json --out broll.json
#     slots.json: [{ "n": 1, "start": 3.5, "end": 11.0, "box": [x, y, w, h] or null }]   (box in fractions of the frame;
#     null is a full-frame cutaway). Writes, per slot:
#       motion  push | pull | drift | still      zoom   the size gained over the slot (1.08 is a slow push in)
#       shake   true when the picture jitters    glitch true when single frames flash or tear and come back
#       colour  bw | muted | vivid | warm | cool | none (against the speaker's picture around it)
#       in, out cut | fade | pop | slide-up | slide-down | slide-left | slide-right | flash   (how it arrives and leaves)
#       at      [start, end] refined to the frame where it really arrives and leaves
#   python3 kit/broll_fx.py splits <video> --out splits.json
#     finds split-screen spans (a hard edge across the whole frame near the middle, there for part of the video):
#       [{ "start", "end", "seam": y, "box": [0, 0, 1, seam] }]
import argparse
import json
import re
import sys

import cv2
import numpy as np

W = 270  # working width: enough for motion and colour, fast on a CPU


def _open(path):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        sys.exit(f"cannot open {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    return cap, fps, n


def _frames(cap, fps, t0, t1, every=1):
    """frames between t0 and t1 (seconds) as [(t, bgr small)]"""
    i0, i1 = max(0, int(round(t0 * fps))), max(0, int(round(t1 * fps)))
    cap.set(cv2.CAP_PROP_POS_FRAMES, i0)
    out = []
    for i in range(i0, i1 + 1):
        ok, f = cap.read()
        if not ok:
            break
        if (i - i0) % every:
            continue
        h = int(round(f.shape[0] * W / f.shape[1]))
        out.append((i / fps, cv2.resize(f, (W, h), interpolation=cv2.INTER_AREA)))
    return out


def _crop(img, box, inset=0.0):
    h, w = img.shape[:2]
    if not box:
        return img
    x, y, bw, bh = box
    x0, y0 = int((x + bw * inset) * w), int((y + bh * inset) * h)
    x1, y1 = int((x + bw * (1 - inset)) * w), int((y + bh * (1 - inset)) * h)
    x0, y0 = max(0, min(w - 8, x0)), max(0, min(h - 8, y0))
    return img[y0:max(y0 + 8, y1), x0:max(x0 + 8, x1)]


def _gray(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)


def _step(a, b):
    """scale and shift from gray a to gray b (tracked corners, a rigid fit). None when nothing can be tracked."""
    a8, b8 = a.astype(np.uint8), b.astype(np.uint8)
    pts = cv2.goodFeaturesToTrack(a8, 120, 0.01, 5)
    if pts is None or len(pts) < 8:
        return None
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(a8, b8, pts, None, winSize=(15, 15), maxLevel=2)
    ok = st.ravel() == 1
    if ok.sum() < 8:
        return None
    m, inl = cv2.estimateAffinePartial2D(pts[ok], nxt[ok], method=cv2.RANSAC, ransacReprojThreshold=1.5)
    if m is None or inl is None or inl.sum() < 6:
        return None
    s = float(np.hypot(m[0, 0], m[0, 1]))
    # the shift of the region's centre, so a zoom about the centre reads as no shift
    cx, cy = a.shape[1] / 2, a.shape[0] / 2
    dx = float(m[0, 0] * cx + m[0, 1] * cy + m[0, 2] - cx)
    dy = float(m[1, 0] * cx + m[1, 1] * cy + m[1, 2] - cy)
    return s, dx, dy


def _motion(fr, box):
    """zoom, drift and shake over the settled frames of a slot"""
    g = [_gray(_crop(f, box, 0.08)) for _, f in fr]
    if len(g) < 4:
        return {"motion": "still", "zoom": 1.0, "shake": False}
    zoom, path, steps = 1.0, [(0.0, 0.0)], []
    for a, b in zip(g, g[1:]):
        st = _step(a, b)
        if st is None or abs(st[0] - 1) > 0.08 or max(abs(st[1]), abs(st[2])) > 0.2 * a.shape[1]:
            path.append(path[-1])  # a content change (a new page), not a camera move
            continue
        zoom *= st[0]
        steps.append((st[1], st[2]))
        path.append((path[-1][0] + st[1], path[-1][1] + st[2]))
    p = np.array(path, dtype=np.float32)
    w = float(g[0].shape[1])
    # a shake goes back and forth: steps that are big enough and keep changing direction (a scroll or a pan does not)
    shake = False
    if len(steps) >= 6:
        v = np.array(steps, dtype=np.float32)
        ax = int(np.argmax(np.abs(v).mean(axis=0)))
        big = np.abs(v[:, ax]) > 0.003 * w
        flips = np.mean(np.sign(v[1:, ax]) != np.sign(v[:-1, ax]))
        shake = bool(big.mean() > 0.4 and flips > 0.45)
    net = float(np.hypot(*(p[-1] - p[0]))) / w
    motion = "push" if zoom > 1.03 else "pull" if zoom < 0.97 else "drift" if net > 0.04 else "still"
    return {"motion": motion, "zoom": round(float(zoom), 3), "shake": shake}


def _glitch(fr, box):
    """single frames that jump away and come straight back (a flash, a tear, an RGB split)"""
    g = [_gray(_crop(f, box, 0.05)) for _, f in fr]
    if len(g) < 6:
        return False
    d = [float(np.mean(np.abs(b - a))) for a, b in zip(g, g[1:])]
    med = float(np.median(d))
    hits = 0
    for i in range(1, len(g) - 1):
        there, back = d[i - 1], float(np.mean(np.abs(g[i + 1] - g[i - 1])))
        if there > max(10.0, 6 * med) and back < 0.45 * there:
            hits += 1
    return hits >= 1


def _colour(fr, box, around):
    hs = [cv2.cvtColor(_crop(f, box, 0.08), cv2.COLOR_BGR2HSV) for _, f in fr[:: max(1, len(fr) // 6)]]
    if not hs:
        return "none"
    sat = float(np.mean([h[..., 1].mean() for h in hs])) / 255
    if box:
        return "none"  # a panel keeps the colours of what it shows (a dark terminal is not a treatment)
    if sat < 0.06:
        return "bw"
    if not around:
        return "none"
    lab = lambda fs: np.mean([cv2.cvtColor(f, cv2.COLOR_BGR2LAB).reshape(-1, 3).mean(0) for _, f in fs], axis=0)
    s0 = float(np.mean([cv2.cvtColor(f, cv2.COLOR_BGR2HSV)[..., 1].mean() for _, f in around])) / 255
    a, b = lab(fr[:: max(1, len(fr) // 6)]), lab(around)
    if s0 > 0.05 and sat / s0 < 0.55:
        return "muted"
    if s0 > 0.05 and sat / s0 > 1.6:
        return "vivid"
    if a[2] - b[2] > 10:
        return "warm"
    if b[2] - a[2] > 10:
        return "cool"
    return "none"


def _edge(fr, box, before, settled, leaving=False):
    """how a slot arrives (or leaves, with the frames given in reverse): returns (kind, the time it starts)"""
    if not fr or before is None or settled is None:
        return "cut", None
    grow = None
    if box:
        x, y, w, h = box
        grow = [max(0, x - w * 0.15), max(0, y - h * 0.3), min(1, w * 1.3), min(1, h * 1.6)]
    B, S = _gray(_crop(before, grow)), _gray(_crop(settled, grow))
    D = S - B
    den = float(np.sum(D * D)) + 1e-6
    if float(np.mean(np.abs(D))) < 2.0:
        return "cut", None
    al, res, boxes, lum = [], [], [], []
    for t, f in fr:
        G = _gray(_crop(f, grow))
        a = float(np.sum((G - B) * D)) / den
        al.append(a)
        res.append(float(np.mean(np.abs(G - (B + min(1.0, max(0.0, a)) * D)))) / (float(np.mean(np.abs(D))) + 1e-6))
        m = (np.abs(G - B) > 18).astype(np.uint8)
        ys, xs = np.where(cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0)
        boxes.append((xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) > 30 else None)
        lum.append(float(G.mean()))
    on = next((i for i, a in enumerate(al) if a > 0.08), None)
    done = next((i for i, a in enumerate(al) if a > 0.92 and res[i] < 0.35), None)
    if on is None:
        return "cut", None
    t_on = fr[on][0]
    if done is None:
        done = len(al) - 1
    ramp = done - on
    if ramp <= 1:
        return "cut", t_on
    mid = range(on, done)
    if max(lum[i] for i in mid) > max(B.mean(), S.mean()) + 45:
        return "flash", t_on
    if float(np.mean([res[i] for i in mid])) < 0.3:
        return "fade", t_on
    fin = boxes[done] or boxes[-1]
    early = next((boxes[i] for i in mid if boxes[i] is not None), None)
    if fin and early:
        fw, fh = fin[2] - fin[0] + 1, fin[3] - fin[1] + 1
        ew, eh = early[2] - early[0] + 1, early[3] - early[1] + 1
        dx = ((early[0] + early[2]) - (fin[0] + fin[2])) / 2 / max(1, fw)
        dy = ((early[1] + early[3]) - (fin[1] + fin[3])) / 2 / max(1, fh)
        if ew < 0.85 * fw and eh < 0.85 * fh and abs(dx) < 0.2 and abs(dy) < 0.2:
            return "pop", t_on
        # it starts low and travels up: slide-up. Leaving is the same motion read backwards.
        if abs(dy) >= 0.12 and abs(dy) >= abs(dx):
            return ("slide-up" if (dy > 0) != leaving else "slide-down"), t_on
        if abs(dx) >= 0.12:
            return ("slide-left" if (dx > 0) != leaving else "slide-right"), t_on
    return "pop", t_on


def _hex(h):
    h = str(h or "").lstrip("#")
    return np.array([int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)], dtype=np.float32) if re.fullmatch(r"[0-9a-fA-F]{6}", h) else None


def _has_border(img, box, bgr):
    """is the panel's coloured edge still there? (the share of the box's outline close to the border colour)"""
    h, w = img.shape[:2]
    x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), int((box[0] + box[2]) * w), int((box[1] + box[3]) * h)
    m = np.zeros((h, w), np.uint8)
    cv2.rectangle(m, (x0, y0), (x1, y1), 255, max(3, int(w * 0.022)))
    near = (np.linalg.norm(img.astype(np.float32) - bgr, axis=2) < 45) & (m > 0)
    # the colour has to run along all four sides (skin or a warm wall is on one side at most)
    my, mx = (y0 + y1) // 2, (x0 + x1) // 2
    sides = [near[:my, :].sum() / max(1, (m[:my, :] > 0).sum()), near[my:, :].sum() / max(1, (m[my:, :] > 0).sum()),
             near[:, :mx].sum() / max(1, (m[:, :mx] > 0).sum()), near[:, mx:].sum() / max(1, (m[:, mx:] > 0).sum())]
    return min(sides) > 0.12


def _extend(cap, fps, t, box, bgr, limit, back=False):
    """walk on from a slot's end (or back from its start) while its border is still on screen"""
    step, last = 0.25, t
    while (t - step > limit) if back else (t + step < limit):
        t = t - step if back else t + step
        fr = _frames(cap, fps, t, t)
        if not fr or not _has_border(fr[0][1], box, bgr):
            break
        last = t
    return last


def measure(video, slots):
    cap, fps, n = _open(video)
    dur = n / fps if n else 1e9
    out = []
    slots = sorted(slots, key=lambda x: float(x["start"]))
    for k, s in enumerate(slots):
        a, z, box = float(s["start"]), float(s["end"]), s.get("box") or None
        bgr = _hex(s.get("border")) if box else None
        if bgr is not None:
            # the panel detector loses a panel while it shows something bright: follow its border past the gap
            z = _extend(cap, fps, z, box, bgr, min(dur, float(slots[k + 1]["start"]) if k + 1 < len(slots) else dur))
        pad = 0.45
        fr = _frames(cap, fps, max(0, a - pad), min(dur, z + pad))
        if len(fr) < 6:
            out.append({"n": s.get("n"), "motion": "still", "zoom": 1.0, "shake": False, "glitch": False, "colour": "none", "in": "cut", "out": "cut", "at": [a, z]})
            continue
        lead = [x for x in fr if x[0] < a - 0.12]
        tail = [x for x in fr if x[0] > z + 0.12]
        mid = [x for x in fr if a + min(0.6, (z - a) * 0.3) <= x[0] <= z - min(0.45, (z - a) * 0.25)]
        if len(mid) < 4:
            mid = [x for x in fr if a <= x[0] <= z]
        before = lead[0][1] if lead else None
        after = tail[-1][1] if tail else None
        head = [x for x in fr if x[0] <= a + 0.7]
        foot = [x for x in fr if x[0] >= z - 0.7][::-1]
        kin, t_in = _edge(head, box, before, mid[0][1] if mid else None)
        kout, t_out = _edge(foot, box, after, mid[-1][1] if mid else None, leaving=True)
        mo = _motion(mid[:: max(1, int(round(fps / 12)))], box)
        r = {"n": s.get("n"), **mo, "glitch": _glitch([x for x in fr if a + 0.1 <= x[0] <= z - 0.1], box), "colour": _colour(mid, box, lead or tail),
             "in": kin, "out": kout, "at": [round(t_in if t_in is not None else a, 2), round(t_out if t_out is not None else z, 2)]}
        out.append(r)
    cap.release()
    return out


def splits(video, step=0.25, min_len=0.75):
    """split-screen spans: a hard edge across the whole frame near the middle that is there for only part of the video"""
    cap, fps, n = _open(video)
    dur = n / fps if n else 0
    every = max(1, int(round(step * fps)))
    rows = []
    for t, f in _frames(cap, fps, 0, dur, every=every):
        g = _gray(f)
        h = g.shape[0]
        y0, y1 = int(h * 0.3), int(h * 0.7)
        e = np.abs(g[y0 + 2:y1 + 2] - g[y0 - 2:y1 - 2])
        share = (e > 22).mean(axis=1)
        k = int(np.argmax(share))
        rows.append((t, (y0 + k) / h if share[k] > 0.8 else None, g))
    cap.release()
    spans, cur = [], None
    for t, y, g in rows:
        if y is not None and cur and abs(cur["seam"] - y) < 0.015:
            cur["end"], cur["last"] = t, g
        else:
            if cur and cur["end"] - cur["start"] >= min_len:
                spans.append(cur)
            cur = {"start": t, "end": t, "seam": y, "first": g, "last": g} if y is not None else None
    if cur and cur["end"] - cur["start"] >= min_len:
        spans.append(cur)
    total = sum(s["end"] - s["start"] for s in spans)
    out = []
    if dur and total / dur > 0.7:
        return out  # an edge that is nearly always there is the room (a shelf, a wall line), not a split
    free = [g for _, y, g in rows if y is None]
    for s in spans:
        top = int(s["seam"] * s["first"].shape[0])
        # the top part has to be a different picture from the plain shots
        if free and min(float(np.mean(np.abs(s["first"][:top] - g[:top]))) for g in free[:: max(1, len(free) // 8)]) < 10:
            continue
        out.append({"start": round(s["start"], 2), "end": round(s["end"] + step, 2), "seam": round(s["seam"], 3), "box": [0, 0, 1, round(s["seam"], 3)]})
    return out


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("measure"); p.add_argument("video"); p.add_argument("--slots", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("splits"); p.add_argument("video"); p.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "measure":
        res = measure(a.video, json.load(open(a.slots, encoding="utf-8")))
    else:
        res = splits(a.video)
    json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1)
    print(f"b-roll {a.cmd}: {len(res)} read")


if __name__ == "__main__":
    main()
