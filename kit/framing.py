#!/usr/bin/env python3
"""Where the face sits in a shot: its height, eye line and centre, with YuNet.

    python kit/framing.py measure <video> --spans 0-2.3,2.3-3.3 [--samples 3] [--json out.json]
    python kit/framing.py pose <video> --spans 0-1.4@12,1.4-20@2 [--json out.json]     where the head points, frame by frame

Both sides of a Recreate are measured here the same way: the reference's shots (kit/teardown.py extras) and your
take's segments (kit/reel.cjs, through kit/reframe.cjs). Every frame is first scaled to cover 9:16 and centre cropped,
as kit/assemble.cjs does, so the numbers are shares of the frame the viewer sees.

Per span, the median over the sampled frames that had a face:
  h      face height as a share of the frame height (the YuNet box, forehead to chin)
  eye_y  the eye line, 0 top .. 1 bottom
  cx     the face centre, 0 left .. 1 right
  y0 y1 x0 x1   the face box, shares of the frame
  n      samples with a face, of "of"
A span where under half the samples had a face has no numbers (null): the speaker is not on screen.
YuNet is the vendored model kit/facezone.py uses. Needs only opencv and numpy.
"""
import argparse, json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
YUNET = os.path.join(os.path.dirname(HERE), 'effects', 'vendor', 'claude-video-effects', 'models', 'yunet.onnx')
AW, AH = 540, 960


def cover_frame(video, t, cropx=0.5):
    """One frame at t seconds, scaled to cover 9:16 and cropped, at the analysis size (BGR)."""
    vf = f'scale={AW}:{AH}:force_original_aspect_ratio=increase,crop={AW}:{AH}:(iw-{AW})*{cropx}:(ih-{AH})*0.5'
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(0.0, t):.3f}', '-i', video, '-frames:v', '1', '-vf', vf,
                        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    if len(r.stdout) < AW * AH * 3:
        return None
    return np.frombuffer(r.stdout[:AW * AH * 3], np.uint8).reshape(AH, AW, 3)


def detector():
    import cv2
    return cv2.FaceDetectorYN.create(YUNET, '', (AW, AH), 0.6, 0.3, 20)


def face_of(det, img):
    """The presenter in one frame: the largest confident face, as shares of the frame. None with no face."""
    _, faces = det.detect(img)
    if faces is None or len(faces) == 0:
        return None
    f = max(faces, key=lambda r: r[2] * r[3] * float(r[14]))
    x, y, w, h = [float(v) for v in f[:4]]
    eye = (float(f[5]) + float(f[7])) / 2
    return {'h': h / AH, 'eye_y': eye / AH, 'cx': (x + w / 2) / AW, 'y0': y / AH, 'y1': (y + h) / AH, 'x0': x / AW, 'x1': (x + w) / AW}


def sample_times(a, b, n):
    """n times inside a span, away from its edges (a cut or a transition sits there)."""
    d = max(0.0, b - a)
    pad = min(0.25, d * 0.2)
    if n <= 1 or d < 0.2:
        return [a + d / 2]
    return [a + pad + (d - 2 * pad) * k / (n - 1) for k in range(n)]


def summarise(found, of):
    """Median of the samples with a face. None when under half of them had one."""
    if not found or len(found) * 2 < of:
        return None
    out = {k: round(float(np.median([f[k] for f in found])), 4) for k in ('h', 'eye_y', 'cx', 'y0', 'y1', 'x0', 'x1')}
    out['n'], out['of'] = len(found), of
    return out


def measure_spans(video, spans, samples=3, cropx=0.5, det=None):
    det = det or detector()
    out = []
    for a, b in spans:
        ts = sample_times(a, b, samples)
        found = []
        for t in ts:
            img = cover_frame(video, t, cropx)
            if img is None:
                continue
            f = face_of(det, img)
            if f:
                found.append(f)
        out.append(summarise(found, len(ts)))
    return out


def pose_of(det, img):
    """Where the head points in one frame, from YuNet's five points (eyes, nose tip, mouth corners). pitch: how far
    down the nose tip sits between the eye line and the mouth line (it grows when the head tips down); yaw: how far
    the nose tip sits to one side of the middle of the eyes, in eye distances. None with no face. The numbers mean
    something only against the same speaker's own middle values (kit/piece-edges.cjs)."""
    _, faces = det.detect(img)
    if faces is None or len(faces) == 0:
        return None
    f = max(faces, key=lambda r: r[2] * r[3] * float(r[14]))
    rx, ry, lx, ly, nx, ny, mrx, mry, mlx, mly = [float(v) for v in f[4:14]]
    ey, ex, my, ed = (ry + ly) / 2, (rx + lx) / 2, (mry + mly) / 2, abs(lx - rx)
    if my - ey < 2 or ed < 2:
        return None
    return {'pitch': round((ny - ey) / (my - ey), 4), 'yaw': round((nx - ex) / ed, 4), 'h': round(float(f[3]) / AH, 4)}


def cover_frames(video, a, b, fps, cropx=0.5):
    """Every frame from a to b seconds at fps, as (seconds, image), scaled and cropped like cover_frame."""
    vf = f'fps={fps},scale={AW}:{AH}:force_original_aspect_ratio=increase,crop={AW}:{AH}:(iw-{AW})*{cropx}:(ih-{AH})*0.5'
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', f'{max(0.0, a):.3f}', '-t', f'{max(0.05, b - a):.3f}', '-i', video, '-vf', vf,
                          '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    n = 0
    while True:
        raw = p.stdout.read(AW * AH * 3)
        if len(raw) < AW * AH * 3:
            break
        yield a + n / fps, np.frombuffer(raw, np.uint8).reshape(AH, AW, 3)
        n += 1
    p.stdout.close()
    p.wait()


def pose_spans(video, spans, cropx=0.5, det=None):
    """Per span (a, b, fps): a list of [seconds, pitch, yaw, face height], pitch None where no face was found."""
    det = det or detector()
    out = []
    for a, b, fps in spans:
        rows = []
        for t, img in cover_frames(video, a, b, fps, cropx):
            p = pose_of(det, img)
            rows.append([round(t, 3), p['pitch'], p['yaw'], p['h']] if p else [round(t, 3), None, None, None])
        out.append(rows)
    return out


def parse_spans(s):
    out = []
    for part in str(s or '').split(','):
        part = part.strip()
        if not part:
            continue
        a, b = part.split('-', 1)
        out.append((float(a), float(b)))
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('measure')
    p.add_argument('video'); p.add_argument('--spans', required=True)
    p.add_argument('--samples', type=int, default=3); p.add_argument('--cropx', type=float, default=0.5)
    p.add_argument('--json')
    q = sub.add_parser('pose')
    q.add_argument('video'); q.add_argument('--spans', required=True, help='a-b@fps,a-b@fps')
    q.add_argument('--cropx', type=float, default=0.5); q.add_argument('--json')
    a = ap.parse_args()
    if a.cmd == 'pose':
        sp = [(float(x.split('@')[0].split('-')[0]), float(x.split('@')[0].split('-')[1]), float(x.split('@')[1]) if '@' in x else 12.0) for x in a.spans.split(',') if x.strip()]
        res = {'video': os.path.abspath(a.video), 'spans': pose_spans(a.video, sp, a.cropx)}
    else:
        res = {'video': os.path.abspath(a.video), 'spans': measure_spans(a.video, parse_spans(a.spans), a.samples, a.cropx)}
    if a.json:
        json.dump(res, open(a.json, 'w', encoding="utf-8"))
    print(json.dumps(res))
