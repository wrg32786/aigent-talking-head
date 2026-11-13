#!/usr/bin/env python3
# Head mask from a person mask, for screen cards and b-roll panels that sit behind the presenter's head.
#   effects/.venv/bin/python kit/headmask.py mask.mkv maskhead.mkv
# Per frame: the top of the person (the first row the mask covers 2% of the frame width), the head width (the mask's
# median width 3 to 8% of the frame height below that), and the neck: the narrowest row of the mask between 0.8 and
# 2.4 head widths below the top (--chin). Above the neck the person mask is kept as is (its soft hair edge included,
# so chin and jaw are in, and --neck 0.08 head widths below the narrowest row, enough for the chin); below it fades out over a short band, so a panel over the chest or shoulders stays in front of the body
# while the head goes over it. The neck line is smoothed over time so it does not jitter. Frames with no person stay
# empty. Writes the same size, fps and codec as the input (gray ffv1).
import sys, json, subprocess
import numpy as np

if len(sys.argv) < 3:
    raise SystemExit("usage: headmask.py mask.mkv maskhead.mkv [--chin 2.4] [--feather 0.006] [--neck 0.08]")
src, out = sys.argv[1], sys.argv[2]
arg = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
CHIN, FEATHER, NECK = arg("--chin", 2.4), arg("--feather", 0.006), arg("--neck", 0.08)
pr = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", src]))["streams"][0]
W, H, fps = pr["width"], pr["height"], pr["r_frame_rate"]
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", fps, "-i", "-", "-c:v", "ffv1", "-pix_fmt", "gray", out], stdin=subprocess.PIPE)
rows = np.arange(H, dtype=np.float32)[:, None]
fe = max(2.0, FEATHER * H)
chin_s, n, heads = None, 0, 0
while True:
    buf = dec.stdout.read(W * H)
    if len(buf) < W * H:
        break
    m = np.frombuffer(buf, np.uint8).reshape(H, W)
    cov = (m > 127).sum(axis=1)
    on = np.where(cov >= 0.02 * W)[0]
    chin = None
    if len(on):
        top = on[0]
        band = cov[top + int(0.03 * H): top + int(0.08 * H)]
        if len(band) and np.median(band) > 0:
            w = float(np.median(band))
            # the neck: the narrowest row between most of a head below the top and well above the shoulders; the cut
            # sits there, so the chin and jaw are always inside the head
            lo, hi = int(top + 0.8 * w), int(min(H - 1, top + CHIN * w))
            seg = cov[lo:hi].astype(np.float32)
            chin = lo + 4 + int(np.argmin(np.convolve(seg, np.ones(9) / 9, "valid"))) + NECK * w if len(seg) > 9 else top + 1.5 * w
    if chin is None:
        chin_s = None
        o = np.zeros_like(m)
    else:
        chin_s = chin if chin_s is None else 0.7 * chin_s + 0.3 * chin
        ramp = np.clip((chin_s + fe - rows) / (2 * fe), 0, 1)
        o = (m.astype(np.float32) * ramp).astype(np.uint8)
        heads += 1
    enc.stdin.write(o.tobytes())
    n += 1
enc.stdin.close(); enc.wait(); dec.wait()
print(f"head mask: {heads} of {n} frames with a head -> {out}")
