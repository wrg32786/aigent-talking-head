# mask.py: person mask for the kinetic titles, so big text sits behind the speaker and in front of the background.
# Runs with the effects venv (npm run effects:setup), reusing the vendored claude-video-effects segmenter (MediaPipe
# Selfie Segmenter + guided filter + temporal smoothing). reel.cjs runs it for you when cut.json has "titles" + "mask".
#
#   effects/.venv/bin/python kit/mask.py base.mp4 mask.mkv [--windows 0.4-2.1,5.0-7.2] [--clear 0.0,0.0,0.2,0.3]
#
# - Segments at 360x640 and upscales only the alpha to 1080x1920 (the Muse rule: a full-size pass adds nothing but time).
# - Only frames inside the title windows are segmented; every other frame is alpha 0 (titles are empty there anyway).
#   Windows default to the mode-7 flips in captions.js in the current folder, plus 0.1 s either side.
# - --clear x0,y0,x1,y1 (0..1 of the frame, repeatable) zeroes alpha in a box: use it when the mask leaks onto a
#   background object (a painting, a lamp, a surfboard). cut.json "maskClear": [[x0,y0,x1,y1], ...] does the same.
# - Writes mask.json next to the mask: per window, frames, share of frames with a person, mean coverage, and the
#   mean alpha in the title band. Judge a mask by these numbers, never by eye: viewers show colour where alpha is 0.
import sys, os, json, re, subprocess, argparse
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("out")
ap.add_argument("--windows", default=None)
ap.add_argument("--clear", action="append", default=[])
ap.add_argument("--fps", type=float, default=24)
a = ap.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "effects"))
import fx_runner  # noqa: E402
Tracker = fx_runner.load()["Tracker"]

def windows():
    if a.windows:
        return [tuple(map(float, w.split("-"))) for w in a.windows.split(",") if w]
    src = open("captions.js", encoding="utf-8").read() if os.path.exists("captions.js") else ""
    m = re.search(r"window\.CAPTIONS\s*=\s*(\{.*\})\s*;?\s*$", src, re.S)
    flips = json.loads(m.group(1)).get("flips", []) if m else []
    return [(max(0, f["start"] - 0.1), f["end"] + 0.1) for f in flips if f.get("mode") == 7]

W = windows()
clear = [list(map(float, c.split(","))) for c in a.clear]
if os.path.exists("cut.json"):
    clear += json.load(open("cut.json")).get("maskClear", [])
SW, SH = 360, 640
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", a.src, "-vf", f"scale={SW}:{SH}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{SW}x{SH}", "-r", str(a.fps), "-i", "-",
                        "-vf", "scale=1080:1920:flags=bicubic", "-c:v", "ffv1", "-pix_fmt", "gray", a.out], stdin=subprocess.PIPE)
tr, cur_w, stats = None, None, [{"window": [round(x, 2), round(y, 2)], "frames": 0, "person": 0, "coverage": 0.0, "band": 0.0} for x, y in W]
zero = np.zeros((SH, SW), np.uint8)
k = -1
while True:
    k += 1
    buf = dec.stdout.read(SW * SH * 3)
    if len(buf) < SW * SH * 3:
        break
    t = k / a.fps
    wi = next((i for i, (x, y) in enumerate(W) if x <= t <= y), None)
    if wi is None:
        enc.stdin.write(zero.tobytes()); cur_w = None; continue
    if tr is None:
        tr = Tracker(SW, SH)  # one segmenter for the whole run (timestamps stay increasing)
    if wi != cur_w:
        tr.prev, cur_w = None, wi  # fresh temporal smoothing per window
    rgb = np.frombuffer(buf, np.uint8).reshape(SH, SW, 3)
    m, _ = tr(rgb, int(t * 1000))
    for x0, y0, x1, y1 in clear:
        m[int(y0 * SH):int(y1 * SH), int(x0 * SW):int(x1 * SW)] = 0
    s = stats[wi]; on = m > 127
    s["frames"] += 1; s["person"] += int(on.mean() > 0.02); s["coverage"] += float(on.mean())
    s["band"] += float(m[int(SH * 0.22):int(SH * 0.36)].mean() / 255)  # rows behind a title at y ~ 560 of 1920
    enc.stdin.write(np.ascontiguousarray(m).tobytes())
written = k
enc.stdin.close(); dec.stdout.close(); enc.wait(); dec.wait()
for s in stats:
    n = max(1, s["frames"]); s["person"] = round(s["person"] / n, 3); s["coverage"] = round(s["coverage"] / n, 3); s["band"] = round(s["band"] / n, 3)
json.dump({"src": a.src, "frames": written, "size": [1080, 1920], "analysis": [SW, SH], "windows": stats, "clear": clear},
          open(os.path.splitext(a.out)[0] + ".json", "w"), indent=1)
for s in stats:
    print(f"mask {s['window'][0]:.2f}-{s['window'][1]:.2f}s: person in {s['person'] * 100:.0f}% of frames, coverage {s['coverage'] * 100:.1f}%, title band alpha {s['band']:.2f}")
print("wrote", a.out)
