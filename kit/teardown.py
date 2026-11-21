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


def stage(name, words):
    # where the breakdown is, for Studio's status line (kit/studio/stages.mjs). Flushed so it shows up as it happens
    sys.stdout.flush()
    print(f"stage {name}: {words}", flush=True)


def cmd_analyze(a):
    src = probe(a.video)
    dur = src["duration"]
    stage("cuts", "finding cuts")
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
        stage("captions", "reading captions")
        cues = ocr_frames(a.video, dur)
        if cues is None:
            out["packaging"]["note"] = "OCR not installed (pip install rapidocr-onnxruntime); no on-screen text read"
        else:
            out["packaging"]["text_cues"] = cues
    if has_audio(a.video):
        if not a.no_asr:
            stage("transcribe", "transcribing")
            sp = speech_words(a.video, a.model)
            if sp:
                out["speech"] = sp
        stage("sound", "reading music and sounds")
        grid = beat_grid(a.video, dur)
        if grid:
            out["audio"]["music"] = {"present": True, "tempo_bpm": grid.get("tempo_bpm"), "beats": grid.get("beats", []), "drops": grid.get("drops", [])}
            out["audio"]["tempo_bpm"] = grid.get("tempo_bpm")
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


YUNET = os.path.join(ROOT, "effects", "vendor", "claude-video-effects", "models", "yunet.onnx")
_YN = {}


def _face_box(img):
    """The biggest face YuNet finds (x, y, w, h in pixels), or None. OpenCV only, no person mask needed."""
    import cv2
    h, w = img.shape[:2]
    try:
        if (w, h) not in _YN:
            _YN[(w, h)] = cv2.FaceDetectorYN.create(YUNET, "", (w, h), 0.6, 0.3, 20) if os.path.exists(YUNET) else None
        det = _YN[(w, h)]
        faces = det.detect(img)[1] if det is not None else None
    except Exception:
        return None
    if faces is None or not len(faces):
        return None
    f = max(faces, key=lambda r: r[2] * r[3])
    return [int(v) for v in f[:4]]


def _spikes(y, pts):
    """Shape and spike count of a yellow region that the person may cover in part. The outline's radius is read
    around the centre of the circle that encloses it: a starburst has clear peaks (its points), a seal is round.
    The count comes from the usual gap between neighbouring points, so a covered arc does not lower it."""
    import cv2, numpy as np
    (cx, cy), R = cv2.minEnclosingCircle(pts)
    if R < 8:
        return "seal", None
    ys, xs = np.nonzero(y)
    dx, dy = xs - cx, ys - cy
    rad = np.hypot(dx, dy)
    ok = rad <= R * 1.03  # other yellow things in the frame (a caption box, a shirt) are left out
    dx, dy, rad = dx[ok], dy[ok], rad[ok]
    N = 180  # 2 degree bins
    ang = (np.floor(np.degrees(np.arctan2(dy, dx)) / (360 / N)).astype(int)) % N
    prof = np.zeros(N)
    np.maximum.at(prof, ang, rad)
    seen = prof > 0.3 * R
    if seen.sum() < N // 6:
        return "seal", None
    sm = np.where(seen, (np.roll(prof, 1) + prof + np.roll(prof, -1)) / 3, 0)
    peaks = []
    for i in np.nonzero(seen)[0]:
        if sm[i] < 0.6 * R:
            continue
        near = [sm[(i + k) % N] for k in range(-3, 4)]
        if sm[i] < max(near) or (sm[i] == sm[(i - 1) % N] and seen[(i - 1) % N]):
            continue
        # a point dips on each side within 30 degrees, or runs into the part the person covers
        sides = []
        for sgn in (-1, 1):
            got = False
            for k in range(1, 16):
                j = (i + sgn * k) % N
                if not seen[j] or sm[i] - sm[j] > 0.1 * R:
                    got = True
                    break
            sides.append(got)
        if all(sides):
            peaks.append(i)
    if len(peaks) < 3:
        return "seal", None
    gaps = sorted(((b - a) % N) * (360 / N) for a, b in zip(peaks, peaks[1:] + peaks[:1]))[:len(peaks) - 1]
    med = float(np.median(gaps))
    gap = float(np.mean([g for g in gaps if 0.6 * med <= g <= 1.5 * med] or [med]))
    return "starburst", int(min(24, max(6, round(360 / max(gap, 1)))))


def _bursts(img, hsv, mask):
    """Spiky warm-yellow shapes (a starburst), split or whole. Returns bbox, colour, shape, spike count, layer hint."""
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
    # pieces of one burst sit side by side around the head: a yellow patch far above or below the biggest piece is not part of it
    _, by, _, bh0 = cv2.boundingRect(max(keep, key=cv2.contourArea))
    near = [c for c in keep if cv2.boundingRect(c)[1] < by + bh0 * 1.5 and cv2.boundingRect(c)[1] + cv2.boundingRect(c)[3] > by - bh0 * 0.5]
    if sum(cv2.contourArea(c) for c in near) >= 0.012 * h * w:
        keep = near
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
    else:
        # no person mask: a face found inside the burst's outline that is not yellow means the burst is behind the head
        fb = _face_box(img)
        if fb:
            fx, fy, fw, fh = fb
            mx, my = min(w - 1, max(0, fx + fw // 2)), min(h - 1, max(0, fy + fh // 2))
            face = y[max(0, fy):fy + fh, max(0, fx):fx + fw]
            if hull[my, mx] and face.size and float(face.mean()) < 0.15:
                layer = "behind"
    shape, spikes = _spikes(y, pts)
    return {"bbox": [round(x / w, 3), round(yy / h, 3), round(bw / w, 3), round(bh / h, 3)], "color": col, "layer": layer, "shape": shape, "spikes": spikes}


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


def head_width(mask, centre=False):
    """Width of the head as a share of the frame width, from a person mask: the mask's median width a little below
    the top of the head (3 to 8 percent of the frame height down). With centre, also the head's centre y as a share of
    the frame height (a head is about 1.3 widths tall). None without a person."""
    import numpy as np
    if mask is None:
        return None
    m = np.asarray(mask).astype(bool)
    H, W = m.shape[:2]
    cov = m.sum(axis=1)
    rows = np.where(cov >= 0.02 * W)[0]
    if not len(rows):
        return None
    top = rows[0]
    band = cov[top + int(0.03 * H): top + int(0.08 * H)]
    if not len(band):
        return None
    w = float(np.median(band))
    if not centre:
        return round(w / W, 3)
    # the head's centre x: the middle of the mask's columns over the same band (for text set beside the head)
    cols = np.where(m[top + int(0.03 * H): top + int(0.08 * H)].any(axis=0))[0]
    cx = float((cols[0] + cols[-1]) / 2) / W if len(cols) else 0.5
    return (round(w / W, 3), round((top + 0.65 * w) / H, 3), round(top / H, 3), round(cx, 3))


def cmd_headwidth(a):
    """Median head width (share of the frame width) over a few frames of a clip, for sizing a burst to the head, and
    the highest the top of the head goes (head_top, share of the frame height), for keeping behind captions readable."""
    import numpy as np
    seg = person_mask_fn()
    if not seg:
        print(json.dumps({"head_w": None, "note": "no person mask (npm run effects:setup)"})); return
    d = probe(a.video).get("duration") or 10
    ws = []
    for k in range(9):
        img = frame_at(a.video, d * (k + 0.5) / 9, 540)
        if img is not None:
            w = head_width(seg(img), True)
            if w:
                ws.append(w)
    print(json.dumps({"head_w": round(float(np.median([w[0] for w in ws])), 3) if ws else None,
                      "head_cy": round(float(np.median([w[1] for w in ws])), 3) if ws else None,
                      "head_top": round(float(min(w[2] for w in ws)), 3) if ws else None,
                      "head_cx": round(float(np.median([w[3] for w in ws])), 3) if ws else None, "frames": len(ws)}))


def caption_look(video, cues, n=60):
    """Outline and shadow of single big words on screen (the caption candidates): for each, the letters (pixels near
    the text fill), a thin ring just outside them and a far ring of plain background. An outline is a ring much darker
    than the background and than a soft shadow; a shadow is a milder darkening that fades with distance."""
    import cv2, numpy as np
    pick = [c for c in cues if c.get("bbox") and len(str(c.get("text", "")).split()) == 1 and (c.get("line_h") or c["bbox"][3]) >= 0.04 and (c.get("conf") or 1) >= 0.8]
    pick = pick[:: max(1, len(pick) // n)][:n]
    out = []
    for c in pick:
        img = frame_at(video, (c["t0"] + c.get("t1", c["t0"] + 0.3)) / 2, 720)
        if img is None:
            continue
        H, W = img.shape[:2]
        x, y, w, h = c["bbox"]
        px, py = int(max(0, (x - 0.04) * W)), int(max(0, (y - 0.03) * H))
        crop = img[py:int(min(H, (y + h + 0.03) * H)), px:int(min(W, (x + w + 0.04) * W))]
        if crop.size == 0:
            continue
        L = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
        hh = max(8, int(h * H))
        bright = L >= 215
        dark = L <= 40
        text = bright if bright.mean() > 0.04 else dark  # white words (or black ones)
        if text.mean() < 0.03:
            continue
        t8 = text.astype(np.uint8)
        k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        r1 = max(1, round(hh * 0.05)); r2 = max(r1 + 1, round(hh * 0.12)); r3 = max(r2 + 2, round(hh * 0.3)); r4 = r3 + max(2, round(hh * 0.15))
        d1, d2, d3, d4 = (cv2.dilate(t8, k(r)).astype(bool) for r in (r1, r2, r3, r4))
        near, mid, far = d1 & ~text, d2 & ~d1, d4 & ~d3
        if near.sum() < 20 or far.sum() < 20:
            continue
        ln, lm, lf = float(np.median(L[near])), float(np.median(L[mid])), float(np.median(L[far]))
        rec = {"t0": c["t0"], "text": c["text"], "near": round(ln, 1), "mid": round(lm, 1), "far": round(lf, 1), "h": hh}
        out.append(rec)
    # a hard dark band right at the letters, much darker than the background: an outline (thick when it carries on
    # into the mid ring); a milder darkening: a shadow; else none
    def verdict(m):
        if m["far"] < 70:
            return None  # the background is dark already: nothing to read
        if m["near"] < 0.45 * m["far"] and m["near"] < 90:
            return "thick" if m["mid"] < 0.55 * m["far"] else "thin"
        if m["near"] < 0.85 * m["far"] or m["mid"] < 0.9 * m["far"]:
            return "shadow"
        return "none"
    vs = [v for v in (verdict(m) for m in out) if v]
    res = {"samples": out, "n": len(vs)}
    if vs:
        outl = [v for v in vs if v in ("thin", "thick")]
        res["outline"] = (max(set(outl), key=outl.count) if len(outl) >= 0.5 * len(vs) else "none")
        res["shadow"] = "soft" if sum(v == "shadow" for v in vs) >= 0.4 * len(vs) else "none"
    return res


def caption_layer(video, cues, seg):
    """Front or behind the person, for big single words in the top 40% of the frame: where a word's box meets the
    person (the mask eroded a few pixels, so its soft edge does not count), are the letters still there? Letters drawn
    behind the head vanish over it: a word whose tail stops at the hairline. Returns one sample per word that meets the
    person: pixels of box over the person, text density there and beside it."""
    import cv2, numpy as np
    if seg is None:
        return []
    out = []
    for c in cues:
        bb = c.get("bbox")
        if not bb or len(str(c.get("text", "")).split()) != 1 or (c.get("line_h") or bb[3]) < 0.04 or bb[1] > 0.4 or (c.get("conf") or 1) < 0.6:
            continue
        img = frame_at(video, (c["t0"] + c.get("t1", c["t0"] + 0.3)) / 2, 720)
        if img is None:
            continue
        H, W = img.shape[:2]
        pm = cv2.erode(seg(img).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        x0, y0, x1, y1 = int(bb[0] * W), int(bb[1] * H), int((bb[0] + bb[2]) * W), int(min(1, bb[1] + bb[3] * 1.25) * H)  # a little below: tails
        mb = pm[y0:y1, x0:x1]
        if mb.sum() < 30:
            continue
        g = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        tb = g >= 215
        # letters beside the person, in the same rows as the overlap (a fair comparison)
        rows = mb.any(axis=1)
        off = (~mb) & rows[:, None]
        if off.sum() < 30:
            off = ~mb
        out.append({"t0": c["t0"], "text": c["text"], "on_n": int(mb.sum()), "text_on_person": round(float(tb[mb].mean()), 3), "text_off_person": round(float(tb[off].mean()), 3)})
    return out


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
            # the head beside it, so the burst's size can be carried relative to the head (it frames the head)
            hw = head_width(mask, True)
            if hw:
                b["face_w"], b["head_cy"] = hw[0], hw[1]
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
        # size from the fully grown burst (the widest third of the samples), and relative to the face width
        ws = sorted(d["bbox"][2] for d in e["d"])
        full_w = round(float(np.median(ws[-max(1, len(ws) // 3):])), 3)
        fw = [d["face_w"] for d in e["d"] if d.get("face_w")]
        face_w = round(float(np.median(fw)), 3) if fw else None
        hc = [d["head_cy"] for d in e["d"] if d.get("head_cy")]
        head_cy = round(float(np.median(hc)), 3) if hc else None
        # shape and spikes from the fully grown samples: the majority shape, the median spike count
        grown = [d for d in e["d"] if d["bbox"][2] >= 0.85 * full_w] or e["d"]
        shapes = [d.get("shape") for d in grown if d.get("shape")]
        shape = max(set(shapes), key=shapes.count) if shapes else "seal"
        sp = [d["spikes"] for d in grown if d.get("shape") == "starburst" and d.get("spikes")]
        spikes = int(round(float(np.median(sp)))) if shape == "starburst" and sp else None
        out.append({"type": "ordinal-sticker", "start": a, "end": round(z, 2), "text": words[0][0] if words else None, "cue": words[0][1]["text"] if words else None,
                    "shape": shape, "spikes": spikes,
                    "bbox": bb, "width": full_w, "face_w": face_w, "head_cy": head_cy, "head_ratio": round(full_w / face_w, 2) if face_w else None,
                    "color": e["d"][len(e["d"]) // 2]["color"], "layer": max(set(layers), key=layers.count) if layers else None, "samples": len(e["d"])})
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
        # what was shown: the text read inside the card, top lines first, and any web address in it
        inside = sorted([c for c in cues if at(c, a, z) and c.get("bbox") and _inside(c["bbox"], bb, 0.02)], key=lambda c: (c.get("t0", 0), c["bbox"][1]))
        shown, seen = [], set()
        for c in inside:
            txt = re.sub(r"\s+", " ", str(c["text"])).strip()
            if len(txt) >= 3 and txt.lower() not in seen:
                seen.add(txt.lower()); shown.append(txt)
        urls = []
        for c in inside:
            txt = str(c["text"])
            # a repo (github, gitlab, hugging face; raw.githubusercontent.com points at one), a full http(s) address,
            # or a plain site name (www.x.com, x.dev); file names and code are not addresses
            found = [f"github.com/{m.group(1)}/{m.group(2)}" for m in re.finditer(r"raw\.githubusercontent\.com/+([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", txt, re.I)]
            found += [m.group(0) for m in re.finditer(r"(?:github\.com|gitlab\.com|huggingface\.co)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", txt, re.I)]
            found += [m.group(0) for m in re.finditer(r"https?://[A-Za-z0-9.-]+\.[a-z]{2,}(?:/[^\s|,]*)?", txt, re.I) if "githubusercontent" not in m.group(0)]
            found += [m.group(0) for m in re.finditer(r"(?<![/\w.])(?:www\.)?[a-z][a-z0-9-]{2,}\.(?:com|io|dev|ai|so|org|net)(?![\w.])", txt, re.I) if m.group(0).lower() not in ("github.com", "gitlab.com")]
            for u in found:
                u = u.rstrip(".,)")
                # placeholders and private session links are not sources
                if re.search(r"example\.(com|org|net)|localhost|session|[A-Za-z0-9_]{20,}", u, re.I):
                    continue
                if u.lower() not in [x.lower() for x in urls]:
                    urls.append(u)
        out.append({"type": "screen-card", "start": a, "end": round(z, 2), "bbox": bb, "border": max(set(borders), key=borders.count) if borders else None, "ui_text": len(ui), "samples": len(e["d"]),
                    "shown": shown[:6], "urls": urls[:4]})
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


def shot_looks(video, shots, rows, graphics):
    """Per shot, for a remake to match: where the face sits (kit/framing.py: height, eye line, centre) when the
    speaker is on screen, and the shot's colour in Lab (kit/grade_match.py), its own graphics left out."""
    spans = [(float(s["start"]), float(s["end"])) for s in shots]
    stage("framing", "reading framing")
    try:
        import framing
        for row, f in zip(rows, framing.measure_spans(video, spans)):
            if f:
                row["face"] = f
        print(f"framing: a face in {sum(1 for r in rows if r.get('face'))} of {len(rows)} shots (height, eye line, centre)")
    except Exception as e:  # a bonus: the remake falls back to the framing words
        print(f"note: face framing not measured: {e}")
    stage("colours", "reading colours")
    try:
        import grade_match
        boxes = [{"t0": g["start"], "t1": g["end"], "box": g["bbox"]} for g in graphics or [] if g.get("bbox")]
        for row, st in zip(rows, grade_match.span_stats(video, spans, boxes=boxes)):
            if st:
                row["lab"] = st
        print(f"grade: colour read on {sum(1 for r in rows if r.get('lab'))} of {len(rows)} shots (black and short shots skipped)")
    except Exception as e:
        print(f"note: shot colour not measured: {e}")


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
    shot_looks(a.video, shots, out["shots"], gx)
    try:
        out["caption_look"] = caption_look(a.video, cues)
        out["caption_look"]["layer_samples"] = caption_layer(a.video, cues, seg)
    except Exception as e:
        print(f"note: caption outline check failed: {e}")
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
    p = sub.add_parser("headwidth"); p.add_argument("video")
    a = ap.parse_args()
    {"analyze": cmd_analyze, "extras": cmd_extras, "headwidth": cmd_headwidth}[a.cmd](a)
    sys.stdout.flush()
    os._exit(0)  # skip interpreter teardown: MediaPipe's dispatcher can raise there after the work is done


if __name__ == "__main__":
    main()
