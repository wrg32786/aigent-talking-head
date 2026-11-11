# mask.py: person mask for the kinetic titles, so big text sits behind the speaker and in front of the background.
# Runs with the effects venv (npm run effects:setup). reel.cjs runs it when cut.json has "titles" + "mask".
#
#   effects/.venv/bin/python kit/mask.py base.mp4 mask.mkv [--windows 0.4-2.1,5.0-7.2] [--clear 0.0,0.0,0.2,0.3]
#       [--model birefnet|birefnet-portrait|mediapipe] [--person person.mkv] [--download] [--no-download]
#
# Backends:
#   birefnet  rembg + birefnet-general-lite (MIT weights, downloaded on first use into rembg's cache, ~214 MB).
#             Native input is 1024x1024. The quality option: tighter hair and hands than MediaPipe. Slow on CPU
#             (several seconds per frame); much faster with CUDA if onnxruntime-gpu is installed.
#   birefnet-portrait  rembg + birefnet-portrait: the best edge on a person (picked from a side-by-side), about half
#             the speed of lite. Both BiRefNet models use the GPU when ONNX Runtime has a provider for it.
#   mediapipe Vendored MediaPipe Selfie Segmenter at 360x640. Fast default. Use this for drafts and smoke. If it cannot
#             load (Windows Smart App Control blocks its DLL) and the birefnet weights are cached, birefnet is used.
# Both backends then run kit/mask_refine.py (hole fill, speck removal, guided edge refine, flow-guided temporal
# smoothing, light erode + feather). --person writes a BGRA layer with edge decontamination.
#
# - Only frames inside the title windows are segmented; every other frame is alpha 0 (titles are empty there anyway).
#   Windows default to the mode-7 flips in captions.js in the current folder, plus 0.1 s either side.
# - --clear x0,y0,x1,y1 (0..1 of the frame, repeatable) zeroes alpha in a box. cut.json "maskClear": [[x0,y0,x1,y1], ...]
#   does the same.
# - cut.json "mask": "mask.mkv" or {"file":"mask.mkv","model":"birefnet","person":"person.mkv"}; "maskModel" also works.
#   CLI --model and MASK_MODEL override. --no-mask on npm run reel skips this step.
# - Writes mask.json next to the mask: per window, frames, share of frames with a person, mean coverage, and the
#   mean alpha in the title band, plus the backend used and seconds per frame. Judge a raw mask.mkv by these numbers
#   (a colour viewer shows tint where alpha is 0); judge quality on composited stills, by eye.
import sys, os, json, re, subprocess, argparse, time
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mask_refine as R  # noqa: E402

MODELS = {"birefnet": "birefnet", "birefnet-general-lite": "birefnet", "birefnet-portrait": "birefnet-portrait", "mediapipe": "mediapipe"}
BIREFNET_SESSION = "birefnet-general-lite"
# rembg's official host of the BiRefNet-General-Lite ONNX (MIT, ZhengPeng). md5 is rembg's published checksum.
BIREFNET_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx"
BIREFNET_MD5 = "4fab47adc4ff364be1713e97b7e66334"
OW, OH = 1080, 1920
SW, SH = 360, 640  # MediaPipe analysis size (a full-size MediaPipe pass adds time, not quality)

ap = argparse.ArgumentParser()
ap.add_argument("src", nargs="?")
ap.add_argument("out", nargs="?")
ap.add_argument("--windows", default=None)
ap.add_argument("--clear", action="append", default=[])
ap.add_argument("--fps", type=float, default=24)
ap.add_argument("--model", default=None, help="birefnet (quality) or mediapipe (fast, default). birefnet is several seconds per frame on CPU")
ap.add_argument("--person", default=None, help="write a BGRA person layer (edge-decontaminated) to this path")
ap.add_argument("--download", action="store_true", help="download birefnet-general-lite into rembg's cache and exit")
ap.add_argument("--no-download", action="store_true", help="do not fetch weights; fall back to mediapipe if they are missing")
a = ap.parse_args()

def cut_json():
    if not os.path.exists("cut.json"):
        return {}
    return json.load(open("cut.json"))

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

def birefnet_model_path(model="birefnet"):
    try:
        if model == "birefnet-portrait":
            from rembg.sessions.birefnet_portrait import BiRefNetSessionPortrait as S
        else:
            from rembg.sessions.birefnet_general_lite import BiRefNetSessionGeneralLite as S
    except ImportError:
        return None
    return S.resolve_existing(f"{S.name()}.onnx")

def download_birefnet():
    from rembg import new_session
    from rembg.sessions.birefnet_general_lite import BiRefNetSessionGeneralLite
    print("downloading", BIREFNET_SESSION, "from", BIREFNET_URL, "md5", BIREFNET_MD5, flush=True)
    new_session(BIREFNET_SESSION, providers=["CPUExecutionProvider"])
    path = BiRefNetSessionGeneralLite.download_models()
    print("cached", path, f"({os.path.getsize(path) / 1048576:.1f} MB)")
    return path

def open_birefnet(model="birefnet"):
    return R.matte_session(model)  # GPU provider when ONNX Runtime has one (DirectML, CUDA, CoreML), else CPU

def open_mediapipe():
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core.base_options import BaseOptions
    model = os.path.join(ROOT, "effects", "vendor", "claude-video-effects", "models", "selfie_segmenter.tflite")
    if not os.path.exists(model):
        raise SystemExit("MediaPipe selfie segmenter missing: " + model)
    return vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.VIDEO, output_confidence_masks=True, output_category_mask=False)), mp

def resolve_model(requested, allow_download):
    want = MODELS.get((requested or "").lower())
    if requested and not want:
        raise SystemExit(f"unknown --model {requested!r}; use birefnet, birefnet-portrait or mediapipe")
    cached = birefnet_model_path()
    if want == "birefnet":
        try:
            import rembg  # noqa: F401
        except ImportError:
            raise SystemExit("rembg is not installed. Run: npm run effects:setup")
        if not cached:
            if not allow_download:
                raise SystemExit("birefnet-general-lite weights are not cached. Run: npm run effects:setup -- --birefnet")
            download_birefnet()
        return "birefnet"
    if want == "birefnet-portrait":   # best edge on a person, about half the speed of lite; rembg fetches its weights on first use
        try:
            import rembg  # noqa: F401
        except ImportError:
            raise SystemExit("rembg is not installed. Run: npm run effects:setup")
        if not allow_download and not birefnet_model_path(want):
            raise SystemExit("birefnet-portrait weights are not cached and downloads are off (--no-download or MASK_NODL). Run once without them.")
        return want
    if want == "mediapipe":
        return "mediapipe"
    return "mediapipe"  # fast default; pass --model birefnet for the quality path

if a.download:
    download_birefnet()
    sys.exit(0)

if not a.src or not a.out:
    raise SystemExit("usage: mask.py src.mp4 mask.mkv [--model birefnet|mediapipe] [--windows ...] [--person person.mkv]")

cut = cut_json()
_, cut_model, cut_person = cut_mask(cut)
requested = a.model or os.environ.get("MASK_MODEL") or cut_model
allow_dl = not a.no_download and os.environ.get("MASK_NODL") not in ("1", "true")
model = resolve_model(requested, allow_dl)
person_path = a.person or cut_person
print(f"mask backend: {model}" + (" + person layer" if person_path else ""), flush=True)

W = windows()
clear = [list(map(float, c.split(","))) for c in a.clear]
clear += cut.get("maskClear", [])

dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", a.src, "-vf", f"scale={OW}:{OH}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{OW}x{OH}", "-r", str(a.fps), "-i", "-",
                        "-c:v", "ffv1", "-pix_fmt", "gray", a.out], stdin=subprocess.PIPE)
penc = None
if person_path:
    penc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{OW}x{OH}", "-r", str(a.fps), "-i", "-",
                             "-c:v", "ffv1", "-pix_fmt", "bgra", person_path], stdin=subprocess.PIPE)

seg = session = mp = None
if model == "mediapipe":
    try:
        seg, mp = open_mediapipe()
    except (OSError, ImportError) as e:   # a blocked DLL can surface as either
        # Windows Smart App Control blocks MediaPipe's unsigned DLL (WinError 4551); ONNX Runtime still loads.
        if not birefnet_model_path():
            raise SystemExit(f"MediaPipe could not load ({e}). Run: npm run effects:setup -- --birefnet, then use --mask birefnet")
        print(f"note: MediaPipe could not load ({e}); using birefnet instead", flush=True)
        model = "birefnet"
if model != "mediapipe":
    t_load = time.time()
    session = open_birefnet(model)
    print(f"{model} session ready in {time.time() - t_load:.1f}s on {session.inner_session.get_providers()[0]}", flush=True)

from PIL import Image  # after the backend is chosen, so mediapipe-only runs do not need rembg

zero = np.zeros((OH, OW), np.uint8)
zero_bgra = np.zeros((OH, OW, 4), np.uint8)
stats = [{"window": [round(x, 2), round(y, 2)], "frames": 0, "person": 0, "coverage": 0.0, "band": 0.0} for x, y in W]
state, cur_w, infer_t, infer_n = {"prev_a": None, "prev_g": None, "grid": None}, None, 0.0, 0
k, t0 = -1, time.time()
while True:
    k += 1
    buf = dec.stdout.read(OW * OH * 3)
    if len(buf) < OW * OH * 3:
        break
    t = k / a.fps
    wi = next((i for i, (x, y) in enumerate(W) if x <= t <= y), None)
    if wi is None:
        enc.stdin.write(zero.tobytes())
        if penc: penc.stdin.write(zero_bgra.tobytes())
        cur_w = None
        continue
    rgb = np.frombuffer(buf, np.uint8).reshape(OH, OW, 3)
    if wi != cur_w:
        state["prev_a"] = state["prev_g"] = None
        cur_w = wi
    t_inf = time.time()
    if model != "mediapipe":
        raw = R.matte_raw(session, rgb)
    else:
        sm = cv2.resize(rgb, (SW, SH), interpolation=cv2.INTER_AREA)
        m = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(sm)), int(t * 1000))
        raw = cv2.resize(m.confidence_masks[-1].numpy_view().reshape(SH, SW).astype(np.float32), (OW, OH), interpolation=cv2.INTER_LINEAR)
    infer_t += time.time() - t_inf; infer_n += 1
    alpha, _ = R.refine_frame(raw, rgb, state)
    for x0, y0, x1, y1 in clear:
        alpha[int(y0 * OH):int(y1 * OH), int(x0 * OW):int(x1 * OW)] = 0
    mu = np.ascontiguousarray(np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8))
    s = stats[wi]; on = mu > 127
    s["frames"] += 1; s["person"] += int(on.mean() > 0.02); s["coverage"] += float(on.mean())
    s["band"] += float(mu[int(OH * 0.22):int(OH * 0.36)].mean() / 255)
    enc.stdin.write(mu.tobytes())
    if penc:
        prgb, pa = R.decontaminate(rgb, alpha)
        enc_bgra = np.dstack([prgb[..., 2], prgb[..., 1], prgb[..., 0], pa])  # BGRA
        penc.stdin.write(np.ascontiguousarray(enc_bgra).tobytes())
    if infer_n and infer_n % 24 == 0:
        print(f"mask {model} {infer_n} frames, {infer_t / infer_n:.2f} s/frame infer, {(time.time() - t0) / max(1, k + 1):.2f} s/frame wall", flush=True)

written = k
enc.stdin.close();
if penc: penc.stdin.close()
dec.stdout.close(); enc.wait(); dec.wait()
if penc: penc.wait()
for s in stats:
    n = max(1, s["frames"]); s["person"] = round(s["person"] / n, 3); s["coverage"] = round(s["coverage"] / n, 3); s["band"] = round(s["band"] / n, 3)
spf = round(infer_t / infer_n, 3) if infer_n else None
meta = {"src": a.src, "frames": written, "size": [OW, OH], "model": model,
        "session": R.MATTE_MODELS.get(model, "selfie_segmenter"),
        "s_per_frame": spf, "refined": infer_n, "windows": stats, "clear": clear,
        "person": person_path}
json.dump(meta, open(os.path.splitext(a.out)[0] + ".json", "w"), indent=1)
for s in stats:
    print(f"mask {s['window'][0]:.2f}-{s['window'][1]:.2f}s: person in {s['person'] * 100:.0f}% of frames, coverage {s['coverage'] * 100:.1f}%, title band alpha {s['band']:.2f}")
print("wrote", a.out, f"[{model}, {spf if spf is not None else 'n/a'} s/frame]")
if person_path:
    print("wrote", person_path)
