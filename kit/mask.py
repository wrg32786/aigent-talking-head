# mask.py: person mask for the kinetic titles, so big text sits behind the speaker and in front of the background.
# Runs with the effects venv (npm run effects:setup). reel.cjs runs it when cut.json has "titles" + "mask".
#
#   effects/.venv/bin/python kit/mask.py base.mp4 mask.mkv [--windows 0.4-2.1,5.0-7.2] [--clear 0.0,0.0,0.2,0.3]
#       [--model birefnet|birefnet-portrait|birefnet-general|birefnet-lite|mediapipe] [--person person.mkv]
#       [--key-every 3] [--cache maskcache] [--download] [--no-download]
#
# Backends (all BiRefNet weights are MIT, ZhengPeng7/BiRefNet; rembg hosts the ONNX exports and is MIT):
#   birefnet-portrait  DEFAULT for anything behind the head ("birefnet" means this here). Swin-L at 1024x1024, trained on
#             people: the best hair edge in a side-by-side on real footage. ~928 MB of weights, downloaded once into
#             rembg's cache. About 12 s per BiRefNet frame on an 8-core CPU, about 2 s on a DirectX 12 / CUDA GPU.
#   birefnet-general   Same tier and speed as portrait, trained on everything; use it when the subject holds a product.
#   birefnet-lite      birefnet-general-lite: Swin-T, about 2.5x faster (4.6 s/frame on CPU), but it can keep a chair
#             back or a lamp as part of the person. ("birefnet-general-lite" also works.)
#   mediapipe Vendored MediaPipe Selfie Segmenter at 360x640: a fast PREVIEW only (blobby hair, no fine edge). Used when
#             the BiRefNet weights or rembg are missing, with a warning. --mask mediapipe on npm run reel picks it.
#   Not used: BiRefNet_HR (2048 input, the slowest and best tier, ~4x the compute), bria-rmbg (non-commercial licence),
#   Robust Video Matting (GPL).
#
# Speed, without giving up the edge:
# - Only frames inside the title windows are segmented; every other frame is alpha 0 (nothing sits behind the head there).
#   Windows default to the mode-7 flips in captions.js in the current folder, plus 0.1 s either side.
# - Keyframes: BiRefNet runs on every --key-every'th frame of the source (default 3, counted from the start of base.mp4 so
#   a rebuild hits the cache) and on the first and last frame of each window. The frames between are the two nearest
#   keyframe mattes warped onto them with optical flow and blended by distance; a frame that moved too much for the flow
#   to be trusted (mean warp error over the person above --max-err) gets its own BiRefNet pass. --key-every 1 runs
#   BiRefNet on every frame.
# BiRefNet crops to the person's padded box to keep fine hair visible. Each model frame passes its box to the next.
# A person who reaches a crop edge gets a fresh whole-frame check. Something that enters the frame outside the box,
# and never touches it, is first seen at the start of the next window.
#
# The room check sees only frames inside title windows. A spot covered for the whole window has no background plate.
# Dark clothing can match a dark room, so a match is a note for review.
# - Cache: every BiRefNet matte is saved under --cache (default build/maskcache/<model>/), keyed by a hash of the frame's
#   pixels and the model, so a rebuild with new captions, titles or windows reuses every frame it already did.
# Then kit/mask_refine.py: hole fill, speck removal, guided edge refine, flow-guided temporal smoothing plus an EMA on
# the solid interior (no flicker), hair-friendly erode + feather (strands stay soft). --person writes a BGRA layer
# with edge decontamination (no background halo).
#
# - --clear x0,y0,x1,y1 (0..1 of the frame, repeatable) zeroes alpha in a box. cut.json "maskClear": [[x0,y0,x1,y1], ...]
#   does the same.
# - cut.json "mask": "mask.mkv" or {"file":"mask.mkv","model":"birefnet","person":"person.mkv"}; "maskModel" also works.
#   CLI --model and MASK_MODEL override. --no-mask on npm run reel skips this step.
# - Writes mask.json next to the mask: per window, frames, share of frames with a person, mean coverage, and the
#   mean alpha in the title band, plus the backend, seconds per BiRefNet frame, keyframes, cache hits and wall time.
# - Memory: the portrait mask needs about 8.8 GB free on CPU and 25.8 GB on DirectML. With less, the
#   default falls back to the MediaPipe preview with a warning; an explicit --model exits with code 3 and says how to get
#   out (titles in front, or --mask mediapipe). MASK_FORCE=1 tries anyway.
#   Judge quality on composited stills, by eye.
import sys, os, json, re, subprocess, argparse, time, hashlib
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mask_refine as R  # noqa: E402

DEFAULT_MODEL = "birefnet-portrait"
MODELS = {"birefnet": "birefnet-portrait", "birefnet-portrait": "birefnet-portrait", "birefnet-general": "birefnet-general",
          "birefnet-lite": "birefnet-lite", "birefnet-general-lite": "birefnet-lite", "mediapipe": "mediapipe"}
OW, OH = 1080, 1920
SW, SH = 360, 640  # MediaPipe analysis size (a full-size MediaPipe pass adds time, not quality)
FW, FH = 540, 960  # optical-flow size

ap = argparse.ArgumentParser()
ap.add_argument("src", nargs="?")
ap.add_argument("out", nargs="?")
ap.add_argument("--windows", default=None)
ap.add_argument("--clear", action="append", default=[])
ap.add_argument("--fps", type=float, default=24)
ap.add_argument("--model", default=None, help="birefnet-portrait (default), birefnet-general, birefnet-lite or mediapipe (fast preview)")
ap.add_argument("--person", default=None, help="write a BGRA person layer (edge-decontaminated) to this path")
ap.add_argument("--key-every", type=int, default=int(os.environ.get("MASK_KEY_EVERY", 3)), help="BiRefNet on every Nth frame, flow between (1 = every frame)")
ap.add_argument("--max-err", type=float, default=6.0, help="mean warp error (0..255 grey) over the person above which an in-between frame gets its own BiRefNet pass")
ap.add_argument("--cache", default=os.environ.get("MASK_CACHE", "maskcache"), help="matte cache folder ('' turns it off)")
ap.add_argument("--download", action="store_true", help="download the default BiRefNet weights (or --model's) into rembg's cache and exit")
ap.add_argument("--no-download", action="store_true", help="do not fetch weights; fall back to mediapipe if they are missing")
a = ap.parse_args()

def cut_json():
    if not os.path.exists("cut.json"):
        return {}
    return json.load(open("cut.json", encoding="utf-8"))

def cut_mask(cut):
    m = cut.get("mask")
    if isinstance(m, dict):
        return m.get("file") or m.get("path") or "mask.mkv", m.get("model"), m.get("person")
    return m, cut.get("maskModel"), cut.get("person")

def windows():
    if a.windows:
        return [tuple(map(float, w.split("-"))) for w in a.windows.split(",") if w]
    src = open("captions.js", encoding="utf-8").read() if os.path.exists("captions.js") else ""
    m = re.search(r"window\.CAPTIONS\s*=\s*(\{.*\})\s*;?\s*$", src, re.S)
    flips = json.loads(m.group(1)).get("flips", []) if m else []
    return [(max(0, f["start"] - 0.1), f["end"] + 0.1) for f in flips if f.get("mode") == 7]

def have_rembg():
    try:
        import rembg, onnxruntime  # noqa: F401
        return True
    except ImportError:
        return False

def resolve_model(requested, allow_download):
    """(model, note). A BiRefNet model is used when rembg is importable and its weights are cached or may be fetched;
    otherwise the MediaPipe preview, with a note saying so."""
    key = (requested or "").lower()
    if requested and key not in MODELS:
        raise SystemExit(f"unknown --model {requested!r}; use birefnet-portrait, birefnet-general, birefnet-lite or mediapipe")
    want = MODELS.get(key) or DEFAULT_MODEL
    if want == "mediapipe":
        return "mediapipe", None
    if not have_rembg():
        if requested:
            raise SystemExit("rembg is not installed. Run: npm run effects:setup")
        return "mediapipe", "rembg is not installed (npm run effects:setup), so this mask is the MediaPipe preview: rough hair edges"
    if not R.cached_weights(want) and not allow_download:
        if requested:
            raise SystemExit(f"{want} weights are not cached and downloads are off (--no-download or MASK_NODL). Run: npm run effects:setup -- --birefnet")
        return "mediapipe", f"{want} weights are not cached and downloads are off, so this mask is the MediaPipe preview. Run: npm run effects:setup -- --birefnet"
    # memory (Will's Windows session, 2026-11-19: a BiRefNet mask was killed with 10 to 12 GB free): check before loading
    provider = R.matte_providers()[0]
    need, free = R.matte_need_gb(want, provider), R.avail_gb()
    if free is not None and free < need and os.environ.get("MASK_FORCE") not in ("1", "true"):
        where = "on DirectML (the graphics chip) " if provider == "DmlExecutionProvider" else ""
        msg = (f"not enough free memory for the {want} mask: {where}it needs about {need:.1f} GB and {free:.1f} GB is free. "
               "Close other apps, or put the titles in front (--no-mask, or Title layer: front), or use the lighter mask (--mask mediapipe). "
               "MASK_FORCE=1 tries anyway.")
        if requested:
            print("ERROR: " + msg, flush=True)
            sys.exit(3)
        return "mediapipe", msg + " Using the MediaPipe preview for this render."
    return want, None

if a.download:
    m = MODELS.get((a.model or "").lower()) or DEFAULT_MODEL
    if m == "mediapipe":
        sys.exit(0)
    print(f"downloading {R.MATTE_MODELS[m]} (~{R.MATTE_MB[R.MATTE_MODELS[m]]} MB) from {R.MATTE_URLS[R.MATTE_MODELS[m]]}", flush=True)
    p = R.matte_weights(m)
    print("cached", p, f"({os.path.getsize(p) / 1048576:.0f} MB)")
    sys.exit(0)

if not a.src or not a.out:
    raise SystemExit("usage: mask.py src.mp4 mask.mkv [--model birefnet-portrait|birefnet-general|birefnet-lite|mediapipe] [--windows ...] [--person person.mkv]")

cut = cut_json()
_, cut_model, cut_person = cut_mask(cut)
requested = a.model or os.environ.get("MASK_MODEL") or cut_model
allow_dl = not a.no_download and os.environ.get("MASK_NODL") not in ("1", "true")
model, note = resolve_model(requested, allow_dl)
if note:
    print("WARNING: " + note, flush=True)
person_path = a.person or cut_person
print(f"mask backend: {model}" + (" + person layer" if person_path else ""), flush=True)

W = windows()
clear = [list(map(float, c.split(","))) for c in a.clear]
clear += cut.get("maskClear", [])

def open_mediapipe():
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core.base_options import BaseOptions
    mpath = os.path.join(ROOT, "effects", "vendor", "claude-video-effects", "models", "selfie_segmenter.tflite")
    if not os.path.exists(mpath):
        raise SystemExit("MediaPipe selfie segmenter missing: " + mpath)
    return vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=mpath),
        running_mode=vision.RunningMode.VIDEO, output_confidence_masks=True, output_category_mask=False)), mp

seg = matter = mp = None
if model == "mediapipe":
    try:
        seg, mp = open_mediapipe()
    except (OSError, ImportError) as e:   # Windows Smart App Control blocks MediaPipe's unsigned DLL; ONNX Runtime still loads
        fb = next((m for m in ("birefnet-portrait", "birefnet-lite") if have_rembg() and R.cached_weights(m)), None)
        if not fb:
            raise SystemExit(f"MediaPipe could not load ({e}). Run: npm run effects:setup -- --birefnet")
        model, _ = resolve_model(fb, allow_dl)
        print(f"note: MediaPipe could not load ({e}); using {model} instead", flush=True)
if model != "mediapipe":
    t_load = time.time()
    matter = R.matte_session(model)
    print(f"{R.MATTE_MODELS[model]} ready in {time.time() - t_load:.1f}s on {matter.provider}", flush=True)

cache_dir = os.path.join(a.cache, R.MATTE_MODELS.get(model, model)) if (a.cache and model != "mediapipe") else None
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
KEY = max(1, a.key_every) if model != "mediapipe" else 1
perf = {"infer": 0, "extra_passes": 0, "infer_s": 0.0, "cache": 0, "flow": 0, "flow_fallback": 0}
next_box = None

def birefnet(rgb, buf):
    """Raw matte for one frame: from the cache, else BiRefNet (then cached)."""
    global next_box
    h = None
    if cache_dir:
        h = "boxed-v1-" + hashlib.sha1(buf).hexdigest()
        f = os.path.join(cache_dir, h + ".png")
        if os.path.exists(f):
            m = cv2.imread(f, cv2.IMREAD_UNCHANGED)
            if m is not None and m.shape == (OH, OW):
                perf["cache"] += 1
                raw = m.astype(np.float32) / (65535 if m.dtype == np.uint16 else 255)
                next_box = R.person_box(raw)
                return raw
    t = time.time(); passes = matter.passes
    raw, next_box = R.matte_raw_boxed(matter, rgb, next_box)
    perf["infer_s"] += time.time() - t; perf["infer"] += 1
    perf["extra_passes"] += matter.passes - passes - 1
    if cache_dir:
        tmp = os.path.join(cache_dir, h + ".tmp.png")
        cv2.imwrite(tmp, np.clip(raw * 65535 + 0.5, 0, 65535).astype(np.uint16)); os.replace(tmp, os.path.join(cache_dir, h + ".png"))
    return raw

def small_gray(rgb):
    return cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (FW, FH), interpolation=cv2.INTER_AREA)

GX, GY = np.meshgrid(np.arange(FW, dtype=np.float32), np.arange(FH, dtype=np.float32))

def warp_from(key, g):
    """Warp a keyframe's raw matte onto the frame with grey g. Returns (matte, mean error over the person)."""
    kg, ka = key["g"], key["a"]
    fl = cv2.calcOpticalFlowFarneback(g, kg, None, 0.5, 4, 21, 3, 5, 1.1, 0)  # for each pixel here, where it is in the key
    mx, my = GX + fl[..., 0], GY + fl[..., 1]
    wg = cv2.remap(kg, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    mxF = cv2.resize(mx * (OW / FW), (OW, OH)); myF = cv2.resize(my * (OH / FH), (OW, OH))
    wa = cv2.remap(ka, mxF, myF, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    person = cv2.resize(ka, (FW, FH), interpolation=cv2.INTER_AREA) > 0.3
    person = cv2.dilate(person.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))).astype(bool)
    err = float(np.abs(wg.astype(np.int16) - g.astype(np.int16))[person].mean()) if person.any() else 0.0
    return wa, err

dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", a.src, "-vf", f"scale={OW}:{OH}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{OW}x{OH}", "-r", str(a.fps), "-i", "-",
                        "-c:v", "ffv1", "-pix_fmt", "gray", a.out], stdin=subprocess.PIPE)
penc = None
if person_path:
    penc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{OW}x{OH}", "-r", str(a.fps), "-i", "-",
                             "-c:v", "ffv1", "-pix_fmt", "bgra", person_path], stdin=subprocess.PIPE)

zero = np.zeros((OH, OW), np.uint8)
zero_bgra = np.zeros((OH, OW, 4), np.uint8)
stats = [{"window": [round(x, 2), round(y, 2)], "frames": 0, "person": 0, "coverage": 0.0, "band": 0.0,
          "room": {"frames": 0, "worst": None}} for x, y in W]
room_frames, room_alphas = [], []
state = {"prev_a": None, "prev_g": None, "grid": None, "ema": None}
t0 = time.time()

def emit(raw, rgb, wi):
    """Clean up one raw matte and write it (and the person layer)."""
    alpha, _ = R.refine_frame(raw, rgb, state)
    for x0, y0, x1, y1 in clear:
        alpha[int(y0 * OH):int(y1 * OH), int(x0 * OW):int(x1 * OW)] = 0
    mu = np.ascontiguousarray(np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8))
    s = stats[wi]; on = mu > 127
    s["frames"] += 1; s["person"] += int(on.mean() > 0.02); s["coverage"] += float(on.mean())
    s["band"] += float(mu[int(OH * 0.22):int(OH * 0.36)].mean() / 255)
    enc.stdin.write(mu.tobytes())
    if (s["frames"] - 1) % room_step(wi) == 0:
        room_frames.append(cv2.resize(rgb, (270, 480), interpolation=cv2.INTER_AREA))
        room_alphas.append(cv2.resize(mu, (270, 480), interpolation=cv2.INTER_AREA))
    if penc:
        prgb, pa = R.decontaminate(rgb, alpha)
        penc.stdin.write(np.ascontiguousarray(np.dstack([prgb[..., 2], prgb[..., 1], prgb[..., 0], pa])).tobytes())

def room_step(wi):
    """Every how many frames the room check keeps one. A long window is thinned to about 240 frames: the model already
    holds most of the memory, and 240 small frames are about 125 MB."""
    return max(1, -(-int((W[wi][1] - W[wi][0]) * a.fps + 1) // 240))

def finish_room(wi, end_frame):
    room = stats[wi]["room"]
    first, step = end_frame - stats[wi]["frames"], room_step(wi)
    for hit in R.room_patches(room_frames, room_alphas):
        room["frames"] += 1
        patch = max(hit["patches"], key=lambda p: p["size"])
        if room["worst"] is None or patch["size"] > room["worst"]["size"]:
            room["worst"] = dict(patch, time=(first + hit["frame"] * step) / a.fps)
    room_frames.clear()
    room_alphas.clear()

def win_of(t):
    return next((i for i, (x, y) in enumerate(W) if x <= t <= y), None)

def flush(pending, key0, key1, wi):
    """Frames between two keyframes: flow-warp both keys onto each and blend by distance (or BiRefNet it if the warp
    error says the flow cannot be trusted)."""
    for (k, rgb, buf, g) in pending:
        if key0 is None and key1 is None:
            raw = birefnet(rgb, buf)
        else:
            parts = []
            for key in (key0, key1):
                if key is None:
                    continue
                wa, err = warp_from(key, g)
                parts.append((wa, err, abs(k - key["k"])))
            if min(p[1] for p in parts) > a.max_err:
                raw = birefnet(rgb, buf); perf["flow_fallback"] += 1
            else:
                wsum = sum(1.0 / (d + 1e-3) for _, e, d in parts if e <= a.max_err * 1.5) or 1.0
                raw = sum(wa * (1.0 / (d + 1e-3)) for wa, e, d in parts if e <= a.max_err * 1.5) / wsum
                if not isinstance(raw, np.ndarray):
                    raw = parts[0][0]
                perf["flow"] += 1
        emit(raw, rgb, wi)

k = -1
cur_w, key0, pending = None, None, []
while True:
    buf = dec.stdout.read(OW * OH * 3)
    k += 1
    end = len(buf) < OW * OH * 3
    t = k / a.fps
    wi = None if end else win_of(t)
    # leaving a window (or the file): finish the frames waiting for their next keyframe
    if cur_w is not None and wi != cur_w:
        if pending:
            last = pending.pop()  # the window's last frame is always a keyframe
            lk = {"k": last[0], "g": last[3], "a": birefnet(last[1], last[2]) if model != "mediapipe" else None}
            flush(pending, key0, lk, cur_w); emit(lk["a"], last[1], cur_w)
        finish_room(cur_w, k)
        pending, key0, next_box = [], None, None
    if end:
        break
    if wi is None:
        enc.stdin.write(zero.tobytes())
        if penc: penc.stdin.write(zero_bgra.tobytes())
        cur_w = None
        continue
    rgb = np.frombuffer(buf, np.uint8).reshape(OH, OW, 3)
    if wi != cur_w:
        state.update(prev_a=None, prev_g=None, ema=None)
        cur_w = wi
    if model == "mediapipe":
        sm = cv2.resize(rgb, (SW, SH), interpolation=cv2.INTER_AREA)
        tt = time.time()
        m = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(sm)), int(t * 1000))
        raw = cv2.resize(m.confidence_masks[-1].numpy_view().reshape(SH, SW).astype(np.float32), (OW, OH), interpolation=cv2.INTER_LINEAR)
        perf["infer_s"] += time.time() - tt; perf["infer"] += 1
        emit(raw, rgb, wi)
        continue
    g = small_gray(rgb)
    if key0 is None or k % KEY == 0:
        key = {"k": k, "g": g, "a": birefnet(rgb, buf)}
        flush(pending, key0, key, wi); pending = []
        emit(key["a"], rgb, wi)
        key0 = key
    else:
        pending.append((k, rgb.copy(), buf, g))
    done = perf["infer"] + perf["cache"] + perf["flow"]
    if done and done % 24 == 0:
        print(f"mask {model}: {done} frames ({perf['infer']} BiRefNet, {perf['cache']} cached, {perf['flow']} flow), {time.time() - t0:.0f}s", flush=True)

written = k
enc.stdin.close()
if penc: penc.stdin.close()
dec.stdout.close(); enc.wait(); dec.wait()
if penc: penc.wait()
for s in stats:
    n = max(1, s["frames"]); s["person"] = round(s["person"] / n, 3); s["coverage"] = round(s["coverage"] / n, 3); s["band"] = round(s["band"] / n, 3)
spf = round(perf["infer_s"] / perf["infer"], 3) if perf["infer"] else None
wall = round(time.time() - t0, 1)
masked = sum(s["frames"] for s in stats)
meta = {"src": a.src, "frames": written, "size": [OW, OH], "model": model,
        "session": R.MATTE_MODELS.get(model, "selfie_segmenter"), "key_every": KEY,
        "s_per_frame": spf, "masked_frames": masked, "birefnet_frames": perf["infer"], "cached_frames": perf["cache"],
        "extra_passes": perf["extra_passes"], "flow_frames": perf["flow"], "flow_fallback": perf["flow_fallback"], "wall_s": wall,
        "windows": stats, "clear": clear, "person": person_path, "note": note}
json.dump(meta, open(os.path.splitext(a.out)[0] + ".json", "w", encoding="utf-8"), indent=1)
for s in stats:
    print(f"mask {s['window'][0]:.2f}-{s['window'][1]:.2f}s: person in {s['person'] * 100:.0f}% of frames, coverage {s['coverage'] * 100:.1f}%, title band alpha {s['band']:.2f}")
    if s["room"]["frames"]:
        worst = s["room"]["worst"]
        print(f"Room match in {s['room']['frames']} frames. Largest at {worst['time']:.2f}s in box {[round(v, 3) for v in worst['box']]} ({worst['size']} analysis pixels). It may be room kept as part of the person.")
print(f"wrote {a.out} [{model}: {masked} frames masked, {perf['infer']} {'MediaPipe' if model == 'mediapipe' else 'BiRefNet'} at {spf if spf is not None else 'n/a'} s/frame, {perf['cache']} from the cache, {perf['flow']} by flow; {wall}s]")
if person_path:
    print("wrote", person_path)
