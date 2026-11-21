#!/usr/bin/env python3
"""The face keep-out zone, per moment: where no caption, title or kinetic word may sit.

    python kit/facezone.py base.mp4 facezone.json [--fps 8] [--margin 0.18]

Each sampled frame (8 a second by default) runs YuNet (OpenCV Zoo, MIT, vendored in effects/.../models/yunet.onnx; needs
only opencv and numpy, so it works without the effects venv). From the face box and its five landmarks:
  zone   eyebrows (above the eye line by 0.45 of the eye distance) down to the chin (the lower of the box bottom and the
         mouth plus 0.6 of the eye-to-mouth drop), across the face box, plus --margin of the face height on every side
  crown  from the top of the head (0.55 face heights above the eye line) down to the top of the zone: hair and cap.
         Text may cover the crown (in front or behind the head); it may never cover the zone.
The track is smoothed over time so it does not jitter: a missed detection is held for up to 1 s, a median of 5 samples
takes out single bad boxes, then a forward and backward EMA (no lag). A jump of more than 0.6 face widths is a cut: the
smoothing restarts there. Frames with no face for longer than 1 s have no zone.

Writes {"fps", "size": [1080, 1920], "zones": [[x0, y0, x1, y1, crownY] | null, ...], "faces": n, "samples": n, "sig"}
(pixels in the 1080x1920 frame). reel.cjs copies it into captions.js as "faceTrack" for the layout pass in
kit/overlay.html, and render.mjs measures every frame against it (facecheck.json). The result is cached: the same
input file (path, size, mtime) and options return at once.
"""
import json, os, subprocess, sys, argparse
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
YUNET = os.path.join(os.path.dirname(HERE), 'effects', 'vendor', 'claude-video-effects', 'models', 'yunet.onnx')
OW, OH = 1080, 1920
AW, AH = 540, 960  # detection size: YuNet finds a 20 px face here, about a tenth of the frame width at 1080


def zone_of(face, s=OW / AW, margin=0.18):
    """face: one YuNet row [x, y, w, h, reX, reY, leX, leY, nX, nY, mrX, mrY, mlX, mlY, score] at analysis size.
    Returns [x0, y0, x1, y1, crownY] in 1080x1920 pixels."""
    f = np.asarray(face[:14], np.float64) * s
    x, y, w, h = f[:4]
    eye_y = (f[5] + f[7]) / 2
    eye_d = max(1.0, abs(f[6] - f[4]))
    mouth_y = (f[11] + f[13]) / 2
    top = eye_y - 0.45 * eye_d
    chin = max(y + h, mouth_y + 0.6 * max(1.0, mouth_y - eye_y))
    fh = chin - top
    m = margin * max(fh, h)
    crown = eye_y - 0.55 * max(h, fh * 1.25)
    return [max(0.0, x - m), max(0.0, top - m), min(OW, x + w + m), min(OH, chin + m), max(0.0, crown)]


def smooth(raw, fps, hold_s=1.0, alpha=0.35, cut_w=0.6):
    """raw: list of zone lists or None. Hold gaps, median of 5, zero-phase EMA, restart at cuts."""
    n = len(raw)
    hold = int(round(hold_s * fps))
    z = [None] * n
    last, gap = None, 0
    for i, r in enumerate(raw):
        if r is not None:
            z[i], last, gap = list(r), r, 0
        else:
            gap += 1
            z[i] = list(last) if (last is not None and gap <= hold) else None
    # segments of consecutive zones without a cut
    segs, cur = [], []
    for i, r in enumerate(z):
        if r is None:
            if cur: segs.append(cur); cur = []
            continue
        if cur:
            p = z[cur[-1]]
            pw = max(1.0, p[2] - p[0])
            if abs((r[0] + r[2]) / 2 - (p[0] + p[2]) / 2) > cut_w * pw or abs((r[1] + r[3]) / 2 - (p[1] + p[3]) / 2) > cut_w * pw:
                segs.append(cur); cur = []
        cur.append(i)
    if cur: segs.append(cur)
    out = [None] * n
    for sg in segs:
        A = np.array([z[i] for i in sg], np.float64)
        A0 = A.copy()
        if len(A) >= 3:
            M = A.copy()
            for k in range(len(A)):
                M[k] = np.median(A[max(0, k - 2):k + 3], axis=0)
            A = M
        F = A.copy()
        for k in range(1, len(A)): F[k] = alpha * A[k] + (1 - alpha) * F[k - 1]
        B = A.copy()
        for k in range(len(A) - 2, -1, -1): B[k] = alpha * A[k] + (1 - alpha) * B[k + 1]
        S = (F + B) / 2
        # never smaller than the raw box (smoothing must not let text creep onto the face)
        S[:, 0] = np.minimum(S[:, 0], A0[:, 0]); S[:, 1] = np.minimum(S[:, 1], A0[:, 1])
        S[:, 2] = np.maximum(S[:, 2], A0[:, 2]); S[:, 3] = np.maximum(S[:, 3], A0[:, 3])
        for k, i in enumerate(sg):
            out[i] = [round(float(v), 1) for v in S[k]]
    return out


def pick(faces, prev):
    """The presenter: the largest confident face, preferring one near the last zone."""
    if faces is None or len(faces) == 0:
        return None
    best, bs = None, -1e9
    for f in faces:
        area = f[2] * f[3]
        sc = area * float(f[14])
        if prev is not None:
            cx, cy = (f[0] + f[2] / 2) * OW / AW, (f[1] + f[3] / 2) * OW / AW
            d = np.hypot(cx - (prev[0] + prev[2]) / 2, cy - (prev[1] + prev[3]) / 2)
            sc /= 1 + d / 400
        if sc > bs:
            best, bs = f, sc
    return best


def run(src, out, fps=8.0, margin=0.18):
    import cv2
    st = os.stat(src)
    sig = json.dumps([os.path.abspath(src), st.st_size, int(st.st_mtime), fps, margin, 2])
    if os.path.exists(out):
        try:
            old = json.load(open(out, encoding="utf-8"))
            if old.get('sig') == sig:
                print(f"face zone: cached ({old.get('faces')} of {old.get('samples')} samples with a face) -> {out}")
                return old
        except Exception:
            pass
    det = cv2.FaceDetectorYN.create(YUNET, '', (AW, AH), 0.6, 0.3, 20)
    vf = f'fps={fps},scale={OW}:{OH}:force_original_aspect_ratio=increase,crop={OW}:{OH},scale={AW}:{AH}'
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', src, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    raw, prev, found = [], None, 0
    while True:
        b = dec.stdout.read(AW * AH * 3)
        if len(b) < AW * AH * 3:
            break
        img = np.frombuffer(b, np.uint8).reshape(AH, AW, 3)
        _, faces = det.detect(img)
        f = pick(faces, prev)
        if f is None:
            raw.append(None)
        else:
            z = zone_of(f, margin=margin); raw.append(z); prev = z; found += 1
    dec.wait()
    zones = smooth(raw, fps)
    res = {'fps': fps, 'size': [OW, OH], 'zones': zones, 'faces': found, 'samples': len(raw), 'margin': margin, 'sig': sig}
    with open(out, 'w', encoding="utf-8") as fh:
        json.dump(res, fh)
    print(f"face zone: a face in {found} of {len(raw)} samples ({fps:g} a second) -> {out}")
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--fps', type=float, default=8.0)
    ap.add_argument('--margin', type=float, default=0.18)
    a = ap.parse_args()
    run(a.src, a.out, a.fps, a.margin)
