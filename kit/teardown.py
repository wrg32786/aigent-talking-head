#!/usr/bin/env python3
# Lightweight teardown helpers for kit/teardown.mjs. rea-video is the main teardown engine; this file is the offline
# fallback and the talking-head extras rea-video does not measure.
#
#   python kit/teardown.py analyze ref.mp4 --out lite.json [--no-ocr] [--no-asr] [--model tiny.en]
#       Fallback analyzer: hard cuts (frame-to-frame colour change), grade stats per shot, on-screen text (rapidocr, if installed),
#       speech words (faster-whisper, if installed), music beat grid (kit/beats.py, if librosa is installed).
#       Writes a breakdown in the same subset of fields kit/videomd2reel.cjs reads from rea-video's breakdown.json.
#   python kit/teardown.py extras ref.mp4 --breakdown breakdown.json --out extras.json [--sheet contact.jpg]
#       Per-shot vignette and noise, front/behind hints for big text (MediaPipe person mask, if it loads), and a
#       labelled contact sheet of sampled frames, and graphics (ordinal stickers, app labels, screen cards; kit/graphics.json)
#       from frames every 0.25 s plus the OCR cues for their words.
#
# Every number here is a heuristic from pixel statistics. It gets the shape of a reel right more often than the
# details; the teardown report says what was measured and what was guessed.
import argparse, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate:format=duration", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    st = j["streams"][0]
    num, den = (st.get("r_frame_rate") or "24/1").split("/")
    return {"file": os.path.basename(path), "duration": round(float(j["format"]["duration"]), 3),
            "width": int(st["width"]), "height": int(st["height"]), "fps": round(float(num) / float(den or 1), 3)}


def has_audio(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout
    return bool(out.strip())


def scene_cuts(path, threshold=0.2):
    """Hard cuts from small decoded frames: colour histogram distance plus mean pixel change, each frame vs the last."""
    import numpy as np, cv2
    w, h = 64, 112
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    fps = probe(path)["fps"] or 24
    prev, cuts, i, scores = None, [], 0, []
    while True:
        buf = p.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            break
        f = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256])
        hist = cv2.normalize(hist, hist).flatten()
        if prev is not None:
            hd = cv2.compareHist(prev[0], hist, cv2.HISTCMP_BHATTACHARYYA)
            md = float(np.abs(f.astype(np.int16) - prev[1].astype(np.int16)).mean()) / 255
            scores.append((i / fps, 0.6 * hd + 1.6 * md))
        prev = (hist, f)
        i += 1
    p.wait()
    if not scores:
        return []
    base = float(np.median([x[1] for x in scores]))
    for t, sc in scores:
        if sc > max(threshold, base * 4) and (not cuts or t - cuts[-1] > 0.25) and t > 0.25:
            cuts.append(round(t, 3))
    return cuts


def frame_at(path, t, w=360):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, t):.3f}", "-i", path, "-frames:v", "1", "-vf", f"scale={w}:-2",
                          "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True).stdout
    if not raw:
        return None
    import cv2
    return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)


def grade_stats(img):
    import cv2, numpy as np
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0] * 100 / 255
    b = lab[..., 2] - 128
    a = lab[..., 1] - 128
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat = float(hsv[..., 1].mean() / 255)
    sh, hi = L < 30, L > 70
    h, w = L.shape
    cy, cx = np.ogrid[:h, :w]
    rr = ((cy - h / 2) / (h / 2)) ** 2 + ((cx - w / 2) / (w / 2)) ** 2
    # corners against the ring just inside them: a vignette darkens the corners far more than the edges
    ring, corner = L[(rr > 0.5) & (rr < 0.9)].mean(), L[rr > 1.3].mean() if (rr > 1.3).any() else L.mean()
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    noise = float(np.median(np.abs(gray - cv2.GaussianBlur(gray, (3, 3), 0))))
    return {"sat": round(sat, 3), "contrast": round(float(L.std() / 100), 3), "mean_l": round(float(L.mean()), 2),
            "mean_b": round(float(b.mean()), 2), "mean_a": round(float(a.mean()), 2),
            "shadow_b": round(float(b[sh].mean()) if sh.any() else 0.0, 2), "highlight_b": round(float(b[hi].mean()) if hi.any() else 0.0, 2),
            "dark_share": round(float((L < 20).mean()), 3), "bright_share": round(float((L > 85).mean()), 3),
            "vignette": round(float(corner / max(ring, 1e-3)), 3), "noise": round(noise, 3)}


def scanline_score(img):
    import numpy as np
    g = img.mean(axis=2)
    rows = g.mean(axis=1)
    d = np.abs(np.diff(rows))
    alt = np.abs(rows[2:] - 2 * rows[1:-1] + rows[:-2])
    return round(float(alt.mean() / (d.mean() + 1e-3)), 3)


def dominant_colours(imgs, k=5):
    import cv2, numpy as np
    px = np.concatenate([cv2.resize(i, (64, 114)).reshape(-1, 3) for i in imgs]).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, lab, cen = cv2.kmeans(px, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(lab.ravel(), minlength=k)
    order = counts.argsort()[::-1]
    return [{"hex": "#%02x%02x%02x" % tuple(int(c) for c in cen[i][::-1]), "share": round(float(counts[i] / counts.sum()), 3)} for i in order]


def ocr_frames(path, dur, step=0.5):
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        try:
            from rapidocr import RapidOCR  # rapidocr 3 on Python 3.13+
        except ImportError:
            return None
    eng = RapidOCR()
    cues, t = [], 0.0
    while t < dur:
        img = frame_at(path, t, 540)
        if img is not None:
            h, w = img.shape[:2]
            res = eng(img)
            res = res[0] if isinstance(res, tuple) else getattr(res, "boxes", None) and list(zip(res.boxes, res.txts, res.scores))
            for box, txt, conf in res or []:
                xs, ys = [p[0] for p in box], [p[1] for p in box]
                bb = [min(xs) / w, min(ys) / h, (max(xs) - min(xs)) / w, (max(ys) - min(ys)) / h]
                fill = text_fill(img, bb)
                cues.append({"t": round(t, 2), "text": txt, "conf": round(float(conf), 3), "bbox": [round(v, 4) for v in bb], "fill": fill})
        t += step
    # merge the same text in consecutive samples into one cue
    merged = []
    for c in cues:
        m = next((x for x in merged if x["text"].lower() == c["text"].lower() and c["t"] - x["t1"] <= step + 0.01), None)
        if m:
            m["t1"] = round(c["t"] + step, 2); m["conf"] = max(m["conf"], c["conf"])
        else:
            merged.append({"t0": c["t"], "t1": round(c["t"] + step, 2), "text": c["text"], "conf": c["conf"], "bbox": c["bbox"],
                           "line_h": c["bbox"][3], "style": {"fill": c["fill"]}, "anim_in": None,
                           "band": "top" if c["bbox"][1] < 0.33 else "bottom" if c["bbox"][1] > 0.66 else "middle"})
    for m in merged:
        m["kind"] = "subtitle" if m["band"] == "bottom" and m["line_h"] < 0.06 else "scene" if m["line_h"] >= 0.05 else "label"
    return merged


def text_fill(img, bb):
    import numpy as np
    h, w = img.shape[:2]
    x0, y0, x1, y1 = int(bb[0] * w), int(bb[1] * h), int((bb[0] + bb[2]) * w), int((bb[1] + bb[3]) * h)
    roi = img[max(0, y0):max(y0 + 1, y1), max(0, x0):max(x0 + 1, x1)].reshape(-1, 3).astype(np.float32)
    if not len(roi):
        return None
    lum = roi.mean(axis=1)
    med = np.median(lum)
    # the text is the minority, far from the median brightness
    far = roi[np.abs(lum - med) > 40]
    pick = far if len(far) > 10 else roi
    c = np.median(pick, axis=0)
    return "#%02x%02x%02x" % (int(c[2]), int(c[1]), int(c[0]))


def speech_words(path, model):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    m = WhisperModel(model, device="cpu", compute_type="int8")
    segs, _ = m.transcribe(path, word_timestamps=True, vad_filter=True)
    words, lines = [], []
    for g in segs:
        ws = [[round(w.start, 2), round(w.end, 2), w.word.strip()] for w in (g.words or [])]
        words += ws
        if ws:
            lines.append({"start": ws[0][0], "end": ws[-1][1], "text": " ".join(w[2] for w in ws)})
    return {"ok": True, "engine": f"faster-whisper {model}", "lines": lines, "words": words}


def beat_grid(path, dur):
    try:
        import librosa  # noqa: F401
    except ImportError:
        return None
    with tempfile.TemporaryDirectory() as d:
        wav, out = os.path.join(d, "a.wav"), os.path.join(d, "grid.json")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "22050", wav], check=True)
        r = subprocess.run([sys.executable, os.path.join(HERE, "beats.py"), wav, "--duration", str(dur), "--out", out], capture_output=True, text=True)
        if r.returncode or not os.path.exists(out):
            return None
        return json.load(open(out))


def cmd_analyze(a):
    src = probe(a.video)
    dur = src["duration"]
    cuts = scene_cuts(a.video)
    bounds = [0.0] + cuts + [dur]
    shots = []
    for i in range(len(bounds) - 1):
        s, e = bounds[i], bounds[i + 1]
        img = frame_at(a.video, (s + e) / 2)
        st = grade_stats(img) if img is not None else {}
        shots.append({"index": i + 1, "start": round(s, 3), "end": round(e, 3), "transition_in": "start" if i == 0 else "cut",
                      "aspects": {"grade": {"measured": st}}, "x_scan": scanline_score(img) if img is not None else 0})
    out = {"x_engine": "talking-head fallback (frame-difference cuts + pixel stats)", "source": src, "shots": shots,
           "packaging": {"text_cues": []}, "audio": {}, "speech": {"ok": False, "reason": "skipped"}}
    if not a.no_ocr:
        cues = ocr_frames(a.video, dur)
        if cues is None:
            out["packaging"]["note"] = "OCR not installed (pip install rapidocr-onnxruntime); no on-screen text read"
        else:
            out["packaging"]["text_cues"] = cues
    if has_audio(a.video):
        grid = beat_grid(a.video, dur)
        if grid:
            out["audio"]["music"] = {"present": True, "tempo_bpm": grid.get("tempo_bpm"), "beats": grid.get("beats", []), "drops": grid.get("drops", [])}
            out["audio"]["tempo_bpm"] = grid.get("tempo_bpm")
        if not a.no_asr:
            sp = speech_words(a.video, a.model)
            if sp:
                out["speech"] = sp
    imgs = [x for x in (frame_at(a.video, (s["start"] + s["end"]) / 2, 160) for s in shots[:12]) if x is not None]
    if imgs:
        out["x_palette"] = dominant_colours(imgs)
    json.dump(out, open(a.out, "w"), indent=1)
    print(f"fallback teardown: {len(shots)} shots, {len(out['packaging']['text_cues'])} text cues, speech {'yes' if out['speech'].get('ok') else 'no'}, "
          f"bpm {out['audio'].get('tempo_bpm')}")


def person_mask_fn():
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import vision
        from mediapipe.tasks.python.core.base_options import BaseOptions
    except Exception:
        return None
    model = os.path.join(ROOT, "effects", "vendor", "claude-video-effects", "models", "selfie_segmenter.tflite")
    if not os.path.exists(model):
        return None
    try:
        seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.IMAGE,
            output_confidence_masks=True, output_category_mask=False))
    except Exception:
        return None
    import cv2, numpy as np

    def run(img):
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
        m = np.squeeze(r.confidence_masks[0].numpy_view().copy()).astype(np.float32)
        if m.shape[:2] != img.shape[:2]:
            m = cv2.resize(m, (img.shape[1], img.shape[0]))
        return m > 0.5
    return run


def hex2bgr(h):
    h = h.lstrip("#")
    return [int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)]


def layer_hint(img, mask, bb, fill):
    """front / behind / None from where the text colour shows up: over the person or only over the background."""
    import numpy as np
    if mask is None or not fill:
        return None, 0.0
    h, w = img.shape[:2]
    x0, y0 = int(bb[0] * w), int(bb[1] * h)
    x1, y1 = max(x0 + 1, int((bb[0] + bb[2]) * w)), max(y0 + 1, int((bb[1] + bb[3]) * h))
    roi, m = img[y0:y1, x0:x1].astype(np.float32), mask[y0:y1, x0:x1]
    if roi.size == 0:
        return None, 0.0
    over = float(m.mean())
    if over < 0.25:
        return "front", round(over, 3)  # the text does not cross the person; front is the safe call
    match = np.linalg.norm(roi - np.array(hex2bgr(fill), np.float32), axis=2) < 60
    on_p = float(match[m].mean()) if m.any() else 0.0
    on_bg = float(match[~m].mean()) if (~m).any() else 0.0
    if on_bg > 0.04 and on_p < 0.25 * on_bg:
        return "behind", round(over, 3)
    return "front", round(over, 3)


# ---------- graphics: ordinal stickers, app labels, screen cards (kit/graphics.json) ----------
ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "next", "last", "finally"]


def ordinal_word(txt):
    """FIRST, SECO (typed in part), 3RD, #2 ... -> the full word, or None."""
    t = re.sub(r"[^a-z0-9#]", "", str(txt).lower())
    if not t or len(t) > 9:
        return None
    m = re.fullmatch(r"#?(\d{1,2})(st|nd|rd|th)?", t)
    if m:
        n = int(m.group(1))
        return ORDINALS[n - 1].upper() if 1 <= n <= 10 and (m.group(2) or t.startswith("#")) else None
    for w in ORDINALS:
        if w == t or (len(t) >= 4 and w.startswith(t)):
            return w.upper()
    return None


def _hex(bgr):
    return "#%02x%02x%02x" % (int(bgr[2]), int(bgr[1]), int(bgr[0]))


def _bursts(img, hsv, mask):
    """Spiky warm-yellow shapes (a starburst), split or whole. Returns bbox, colour, layer hint."""
    import cv2, numpy as np
    h, w = hsv.shape[:2]
    y = ((hsv[..., 0] >= 15) & (hsv[..., 0] <= 38) & (hsv[..., 1] >= 60) & (hsv[..., 2] >= 185)).astype(np.uint8)
    y = cv2.morphologyEx(y, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cs, _ = cv2.findContours(y, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    keep, area = [], 0.0
    for c in cs:
        a = cv2.contourArea(c)
        if a < 0.003 * h * w:
            continue
        sol = a / max(1.0, cv2.contourArea(cv2.convexHull(c)))
        if sol < 0.8:  # spikes: much less than its hull (a sticker or a lamp is near 1)
            keep.append(c); area += a
    if area < 0.012 * h * w:
        return None
    pts = np.concatenate(keep)
    x, yy, bw, bh = cv2.boundingRect(pts)
    hull = np.zeros((h, w), np.uint8); cv2.fillPoly(hull, [cv2.convexHull(pts)], 1); hull = hull.astype(bool)
    col = _hex(np.median(img[y.astype(bool)], axis=0))
    layer = None
    if mask is not None:
        over = float(mask[hull].mean())
        yb = y.astype(bool)
        on_p = float(yb[hull & mask].mean()) if (hull & mask).any() else 0.0
        on_bg = float(yb[hull & ~mask].mean()) if (hull & ~mask).any() else 0.0
        layer = "behind" if over > 0.12 and on_bg > 0.2 and on_p < 0.25 * on_bg else "front"
    return {"bbox": [round(x / w, 3), round(yy / h, 3), round(bw / w, 3), round(bh / h, 3)], "color": col, "layer": layer}


def _rects(g):
    import cv2, numpy as np
    e = cv2.dilate(cv2.Canny(g, 40, 120), np.ones((3, 3), np.uint8))
    cs, _ = cv2.findContours(e, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in cs:
        x, y, bw, bh = cv2.boundingRect(c)
        if bw * bh and cv2.contourArea(c) / (bw * bh) >= 0.78:
            yield x, y, bw, bh


def _cards(img, hsv, g):
    """Wide rectangles with a dark inside (a screenshot or terminal card). The colour just outside is the border."""
    import numpy as np
    h, w = g.shape
    out = []
    for x, y, bw, bh in _rects(g):
        if bw < 0.3 * w or bh < 0.08 * h or bw * bh > 0.6 * w * h:
            continue
        inner = hsv[y + bh // 8:y + bh - bh // 8, x + bw // 8:x + bw - bw // 8]
        if inner.size == 0 or inner[..., 2].mean() > 90:
            continue
        m = max(3, int(0.03 * w))
        x0, y0, x1, y1 = max(0, x - m), max(0, y - m), min(w, x + bw + m), min(h, y + bh + m)
        band = np.ones((y1 - y0, x1 - x0), bool); band[y - y0 + 2:y - y0 + bh - 2, x - x0 + 2:x - x0 + bw - 2] = False
        ring = img[y0:y1, x0:x1][band]; rh = hsv[y0:y1, x0:x1][band]
        sat = ring[(rh[:, 1] > 70) & (rh[:, 2] > 110)]
        border = _hex(np.median(sat, axis=0)) if len(sat) > 0.05 * len(ring) else None
        out.append({"bbox": [round(x / w, 3), round(y / h, 3), round(bw / w, 3), round(bh / h, 3)], "border": border})
    out.sort(key=lambda c: -c["bbox"][2] * c["bbox"][3])
    return out[:1]


def _tiles(img, g):
    """Small squares that stand out from what is around them (an app icon)."""
    import cv2, numpy as np
    h, w = g.shape
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    out = []
    for x, y, bw, bh in _rects(g):
        if not (0.07 * w <= bw <= 0.3 * w and 0.75 <= bw / max(1, bh) <= 1.33):
            continue
        inner = lab[y + bh // 6:y + bh - bh // 6, x + bw // 6:x + bw - bw // 6].reshape(-1, 3)
        m = max(4, bw // 6)
        x0, y0, x1, y1 = max(0, x - m), max(0, y - m), min(w, x + bw + m), min(h, y + bh + m)
        ring = np.concatenate([lab[y0:y, x0:x1].reshape(-1, 3), lab[y + bh:y1, x0:x1].reshape(-1, 3), lab[y:y + bh, x0:x].reshape(-1, 3), lab[y:y + bh, x + bw:x1].reshape(-1, 3)])
        if not len(inner) or not len(ring) or float(np.linalg.norm(inner.mean(0) - ring.mean(0))) < 30:
            continue
        col = _hex(np.median(img[y + bh // 6:y + bh - bh // 6, x + bw // 6:x + bw - bw // 6].reshape(-1, 3), axis=0))
        out.append({"bbox": [round(x / w, 3), round(y / h, 3), round(bw / w, 3), round(bh / h, 3)], "tile": col})
    # one per spot: the outer square
    out.sort(key=lambda t: -t["bbox"][2])
    res = []
    for t in out:
        if not any(abs(t["bbox"][0] - r["bbox"][0]) < 0.08 and abs(t["bbox"][1] - r["bbox"][1]) < 0.08 for r in res):
            res.append(t)
    return res[:2]


def _inside(bb, box, pad=0.0):
    cx, cy = bb[0] + bb[2] / 2, bb[1] + bb[3] / 2
    return box[0] - pad <= cx <= box[0] + box[2] + pad and box[1] - pad <= cy <= box[1] + box[3] + pad


def _group(hits, step, near):
    """Consecutive samples of one graphic -> events (start, end, the samples)."""
    ev = []
    for t, d in hits:
        e = next((e for e in reversed(ev) if t - e["t1"] <= step * 1.6 and near(e["d"][-1], d)), None)
        if e:
            e["t1"] = t; e["d"].append(d)
        else:
            ev.append({"t0": t, "t1": t, "d": [d]})
    return ev


def detect_graphics(video, cues, seg=None, step=0.25):
    """Ordinal stickers, app labels and screen cards, from frames every `step` s plus the OCR cues for their words."""
    import cv2, numpy as np
    info = probe(video)
    W, H = 540, 960
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={1 / step},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    bursts, cards, tiles, i = [], [], [], 0
    while True:
        buf = p.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            break
        img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()
        t = round(i * step, 2); i += 1
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        mask = seg(img) if seg else None
        b = _bursts(img, hsv, mask)
        if b:
            bursts.append((t, b))
        cs = _cards(img, hsv, g)
        for c in cs:
            cards.append((t, c))
        for tl in _tiles(img, g):
            if not any(_inside(tl["bbox"], c["bbox"]) for c in cs):
                tiles.append((t, tl))
    p.wait()
    at = lambda c, a, z: c.get("t0", 0) <= z + 0.3 and c.get("t1", 0) >= a - 0.3
    close = lambda a, b, k: abs(a["bbox"][0] - b["bbox"][0]) < k and abs(a["bbox"][1] - b["bbox"][1]) < k
    out = []
    # ordinal stickers: a burst for 1 s or more; the word is an ordinal read on screen at the same time
    for n, e in enumerate([e for e in _group(bursts, step, lambda a, b: True) if e["t1"] - e["t0"] >= step]):
        a, z = e["t0"], e["t1"] + step
        words = [(ordinal_word(c["text"]), c) for c in cues if at(c, a, z) and (c.get("conf") or 1) >= 0.5]
        words = [x for x in words if x[0]]
        bb = [round(float(np.median([d["bbox"][k] for d in e["d"]])), 3) for k in range(4)]
        layers = [d["layer"] for d in e["d"] if d["layer"]]
        out.append({"type": "ordinal-sticker", "start": a, "end": round(z, 2), "text": words[0][0] if words else None, "cue": words[0][1]["text"] if words else None,
                    "bbox": bb, "color": e["d"][len(e["d"]) // 2]["color"], "layer": max(set(layers), key=layers.count) if layers else None, "samples": len(e["d"])})
    # screen cards: a dark rectangle for 1 s or more with small UI text read inside it
    for e in _group(cards, step, lambda a, b: close(a, b, 0.12)):
        if e["t1"] - e["t0"] < step:
            continue
        a, z = e["t0"], e["t1"] + step
        bb = [round(float(np.median([d["bbox"][k] for d in e["d"]])), 3) for k in range(4)]
        ui = [c for c in cues if at(c, a, z) and c.get("bbox") and (c.get("line_h") or c["bbox"][3]) < 0.03 and _inside(c["bbox"], bb, 0.04)]
        if len(ui) < 2:
            continue
        borders = [d["border"] for d in e["d"] if d["border"]]
        out.append({"type": "screen-card", "start": a, "end": round(z, 2), "bbox": bb, "border": max(set(borders), key=borders.count) if borders else None, "ui_text": len(ui), "samples": len(e["d"])})
    # app labels: a square tile with a short label read just under or beside it
    for e in _group(tiles, step, lambda a, b: close(a, b, 0.1)):
        a, z = e["t0"], e["t1"] + step
        bb = [round(float(np.median([d["bbox"][k] for d in e["d"]])), 3) for k in range(4)]
        def label_ok(c):
            cb = c.get("bbox")
            if not cb or (c.get("conf") or 1) < 0.6 or not at(c, a, z):
                return False
            txt = str(c["text"]).strip()
            if not (2 <= len(re.sub(r"[^A-Za-z0-9]", "", txt)) <= 24) or len(txt.split()) > 4 or (c.get("line_h") or cb[3]) < 0.025:
                return False
            below = bb[1] + bb[3] * 0.5 <= cb[1] <= bb[1] + bb[3] + 0.1 and cb[0] <= bb[0] + bb[2] and cb[0] + cb[2] >= bb[0]
            beside = abs((cb[1] + cb[3] / 2) - (bb[1] + bb[3] / 2)) < bb[3] * 0.6 and bb[0] + bb[2] - 0.02 <= cb[0] <= bb[0] + bb[2] + 0.12
            return below or beside
        labels = sorted([c for c in cues if label_ok(c)], key=lambda c: -(c.get("conf") or 1))
        if not labels:
            continue
        tl = e["d"][len(e["d"]) // 2]["tile"]
        out.append({"type": "app-label", "start": a, "end": round(max(z, labels[0].get("t1", z)), 2), "text": re.sub(r"\s+", " ", str(labels[0]["text"])).strip(), "cue": labels[0]["text"],
                    "bbox": bb, "tile": tl, "samples": len(e["d"])})
    out.sort(key=lambda x: x["start"])
    return out


def cmd_extras(a):
    import cv2, numpy as np
    b = json.load(open(a.breakdown))
    shots = b.get("shots", [])
    seg = person_mask_fn()
    out = {"shots": [], "titles": [], "mask": bool(seg)}
    for s in shots:
        img = frame_at(a.video, (s["start"] + s["end"]) / 2)
        if img is None:
            out["shots"].append({}); continue
        st = grade_stats(img)
        out["shots"].append({"index": s.get("index"), **st, "scan": scanline_score(img)})
    titles = json.load(open(a.titles)) if a.titles and os.path.exists(a.titles) else []
    sheet = []
    for t in titles:
        tm = (t["start"] + min(t["end"], t["start"] + 1.2)) / 2 + 0.25
        img = frame_at(a.video, min(tm, t["end"] - 0.05), 540)
        if img is None:
            out["titles"].append({}); continue
        mask = seg(img) if seg else None
        layer, over = layer_hint(img, mask, t["bbox"], t.get("fill")) if t.get("bbox") else (None, 0.0)
        out["titles"].append({"layer": layer, "person_overlap": over})
        sheet.append((img, f"title {t.get('n', '?')} @ {t['start']:.1f}s: {t.get('text', '')[:28]}", f"{t.get('entrance') or 'entrance ?'} / {layer or 'layer ?'}", t.get("bbox")))
    for s, x in zip(shots, out["shots"]):
        if len(sheet) >= 16:
            break
        img = frame_at(a.video, (s["start"] + s["end"]) / 2, 540)
        if img is not None:
            sheet.append((img, f"shot {s.get('index')} {s['start']:.1f}-{s['end']:.1f}s", s.get("x_finish", "") or "", None))
    if a.sheet and sheet:
        contact_sheet(sheet, a.sheet)
        out["sheet"] = a.sheet
    cues = ((b.get("packaging") or {}).get("text_cues")) or []
    try:
        out["graphics"] = detect_graphics(a.video, cues, seg)
    except Exception as e:  # graphics are a bonus; the rest of the teardown stands without them
        print(f"note: graphics detection failed: {e}")
        out["graphics"] = []
    gx = out["graphics"]
    json.dump(out, open(a.out, "w"), indent=1)
    sys.stdout.flush()
    print(f"graphics: {sum(g['type'] == 'ordinal-sticker' for g in gx)} ordinal stickers, {sum(g['type'] == 'app-label' for g in gx)} app labels, {sum(g['type'] == 'screen-card' for g in gx)} screen cards")
    print(f"extras: {len(out['shots'])} shots measured, {len(out['titles'])} title layers ({'MediaPipe mask' if seg else 'no person mask; layers not estimated'})")


def contact_sheet(items, path):
    from PIL import Image, ImageDraw, ImageFont
    import cv2
    tw, th, cols = 270, 480, 4
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 52)), (14, 16, 20))
    cands = [os.path.join(HERE, "fonts", f) for f in ("InterTight-VF.ttf", "HankenGrotesk-VF.ttf", "NunitoSans-VF.ttf")]
    font = None
    for c in cands:
        try:
            font = ImageFont.truetype(c, 15); break
        except Exception:
            continue
    font = font or ImageFont.load_default()
    d = ImageDraw.Draw(sheet)
    for i, (img, l1, l2, bb) in enumerate(items):
        im = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).resize((tw, th))
        if bb:
            dd = ImageDraw.Draw(im)
            dd.rectangle([bb[0] * tw, bb[1] * th, (bb[0] + bb[2]) * tw, (bb[1] + bb[3]) * th], outline=(34, 211, 238), width=2)
        x, y = (i % cols) * tw, (i // cols) * (th + 52)
        sheet.paste(im, (x, y))
        d.text((x + 6, y + th + 6), l1, fill=(240, 240, 240), font=font)
        d.text((x + 6, y + th + 27), l2, fill=(34, 211, 238), font=font)
    sheet.save(path, quality=88)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("analyze"); p.add_argument("video"); p.add_argument("--out", required=True)
    p.add_argument("--no-ocr", action="store_true"); p.add_argument("--no-asr", action="store_true"); p.add_argument("--model", default="base.en")
    p = sub.add_parser("extras"); p.add_argument("video"); p.add_argument("--breakdown", required=True); p.add_argument("--titles")
    p.add_argument("--out", required=True); p.add_argument("--sheet")
    a = ap.parse_args()
    {"analyze": cmd_analyze, "extras": cmd_extras}[a.cmd](a)
    sys.stdout.flush()
    os._exit(0)  # skip interpreter teardown: MediaPipe's dispatcher can raise there after the work is done


if __name__ == "__main__":
    main()
