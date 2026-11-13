#!/usr/bin/env python3
# Crown mask from a person mask, for screen cards and b-roll panels that reach into the top of the presenter's head.
#   effects/.venv/bin/python kit/headmask.py mask.mkv maskhead.mkv [--crown 0.55] [--feather 0.012]
# Per frame: the top of the person (the first row the mask covers 2% of the frame width) and the head width (the mask's
# median width 3 to 8% of the frame height below that). Only the top of the head is kept: hair and crown down to
# --crown head widths below the top (0.55, above the eyes on a typical framing), fading out over a short band. A panel
# that reaches into the top of the head goes behind the hair; the face, chin, neck and body never cover a panel, so a
# card at chest or chin level stays fully in front. The cut line is smoothed over time so it does not jitter. Frames
# with no person stay empty. Writes the same size, fps and codec as the input (gray ffv1).
import sys, json, subprocess
import numpy as np

if len(sys.argv) < 3:
    raise SystemExit("usage: headmask.py mask.mkv maskhead.mkv [--crown 0.55] [--feather 0.012]")
src, out = sys.argv[1], sys.argv[2]
arg = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
CROWN, FEATHER = arg("--crown", 0.55), arg("--feather", 0.012)
pr = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", src]))["streams"][0]
W, H, fps = pr["width"], pr["height"], pr["r_frame_rate"]
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", fps, "-i", "-", "-c:v", "ffv1", "-pix_fmt", "gray", out], stdin=subprocess.PIPE)
rows = np.arange(H, dtype=np.float32)[:, None]
fe = max(2.0, FEATHER * H)
cut_s, n, heads = None, 0, 0
while True:
    buf = dec.stdout.read(W * H)
    if len(buf) < W * H:
        break
    m = np.frombuffer(buf, np.uint8).reshape(H, W)
    cov = (m > 127).sum(axis=1)
    on = np.where(cov >= 0.02 * W)[0]
    cut = None
    if len(on):
        top = on[0]
        band = cov[top + int(0.03 * H): top + int(0.08 * H)]
        if len(band) and np.median(band) > 0:
            # the crown: hair and the top of the head, above the eyes
            cut = top + CROWN * float(np.median(band))
    if cut is None:
        cut_s = None
        o = np.zeros_like(m)
    else:
        cut_s = cut if cut_s is None else 0.7 * cut_s + 0.3 * cut
        ramp = np.clip((cut_s + fe - rows) / (2 * fe), 0, 1)
        o = (m.astype(np.float32) * ramp).astype(np.uint8)
        heads += 1
    enc.stdin.write(o.tobytes())
    n += 1
enc.stdin.close(); enc.wait(); dec.wait()
print(f"crown mask: {heads} of {n} frames with a head -> {out}")
