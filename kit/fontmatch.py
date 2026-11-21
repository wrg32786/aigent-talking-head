#!/usr/bin/env python3
"""Match the type in a reference video to our own font library (kit/fonts/pairings.json).

A teardown already finds the words on screen (OCR cues: the text, its box, its fill colour). For each of a few big
words we cut the word out of the frame, turn it into a letter mask, and draw the same word in the hero face of every
pairing we ship. The face whose letters cover the crop best wins. From that:
  category    sans, serif, condensed or blackletter (the winning face's "category" in pairings.json)
  weight      regular, bold or black, from the stroke width against the letter height
  case        lower, upper or as-said
  color       the median fill, snapped to white or black when it is close
  pairing     the pairing to draw with (its hero face is the match; caps-only pairings only for caps text)
  match       matched (the letters sit on ours), close (same kind of face) or guess (nothing near; we name the nearest)
Nothing leaves the machine: Pillow draws, OpenCV compares. Every face is SIL OFL, from Google Fonts (kit/fonts/).

  python kit/fontmatch.py classify --json items.json     items: [{"image": "crop.png", "text": "word", "fill": "#ffffff"}]
  python kit/fontmatch.py crop --pairing pirata --text Terms --out crop.png [--size 90] [--bg 3]   a test crop
teardown.py calls match_video(video, cues, frame_at) and writes the result to extras.json as "font".
"""
import argparse, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
MATCHED, CLOSE = 0.8, 0.62  # how alike the letters are (0 to 1) for "matched" and "close"; under that it is a guess
_lib = None


def library():
    """The hero face of every pairing: one entry per face, with the pairings that use it."""
    global _lib
    if _lib is not None:
        return _lib
    faces = {}
    for f in (os.path.join(FONTS, "pairings.json"), os.path.join(FONTS, "local", "pairings.json")):
        if not os.path.exists(f):
            continue
        for name, p in (json.load(open(f, encoding="utf8")).get("pairings") or {}).items():
            d = (p or {}).get("display") or {}
            if not d.get("file"):
                continue
            path = d["file"] if os.path.isabs(d["file"]) else os.path.join(os.path.dirname(f), d["file"])
            if not os.path.exists(path):
                continue
            key = (d["family"], int(d.get("weight") or 400), d.get("style") or "normal")
            e = faces.setdefault(key, {"family": d["family"], "weight": key[1], "style": key[2], "file": path, "category": p.get("category") or "sans", "pairings": []})
            lk = p.get("lockup") or {}
            e["pairings"].append({"name": name, "upper": bool(d.get("upper")), "plain": not p.get("script") and lk.get("arrange") == "stack"})
    for e in faces.values():  # a plain stacked pairing first: a script tail or an inline rule is a look of its own
        e["pairings"].sort(key=lambda q: not q["plain"])
    _lib = list(faces.values())
    return _lib


def _font(face, size):
    from PIL import ImageFont
    f = ImageFont.truetype(face["file"], size)
    try:  # a variable font: set its weight, leave the other axes at their defaults
        axes = f.get_variation_axes()
        vals = []
        for a in axes:
            nm = a.get("name")
            nm = nm.decode() if isinstance(nm, bytes) else str(nm)
            vals.append(max(a["minimum"], min(a["maximum"], face["weight"])) if "eight" in nm else a["default"])
        f.set_variation_by_axes(vals)
    except Exception:
        pass
    return f


def render_mask(face, text, size=120):
    """The word in this face as a tight letter mask (uint8, 0 or 1)."""
    import numpy as np
    from PIL import Image, ImageDraw
    f = _font(face, size)
    w = int(f.getlength(text) + size * 2)
    im = Image.new("L", (max(8, w), size * 3), 0)
    ImageDraw.Draw(im).text((size, size), text, font=f, fill=255)
    return _tight((np.asarray(im) > 110).astype("uint8"))


def _tight(m):
    import numpy as np
    ys, xs = np.where(m > 0)
    if not len(ys):
        return None
    return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def crop_mask(img, fill=None):
    """Letters of a word cut out of a frame (BGR): the pixels near the fill colour, small specks dropped."""
    import cv2, numpy as np
    if img is None or img.size == 0:
        return None
    h, w = img.shape[:2]
    if h < 60:  # work at a size where strokes are a few pixels wide
        k = 60.0 / h
        img = cv2.resize(img, (max(2, int(w * k)), 60), interpolation=cv2.INTER_CUBIC)
        h, w = img.shape[:2]
    f = img.astype(np.float32)
    lum = f.mean(axis=2)
    if fill:
        c = np.array([int(fill[5:7], 16), int(fill[3:5], 16), int(fill[1:3], 16)], np.float32)
    else:  # no fill read: the letters are the minority, far from the median brightness
        med = np.median(lum)
        far = f[np.abs(lum - med) > 60]
        c = np.median(far, axis=0) if len(far) > 20 else np.array([255, 255, 255], np.float32)
    d = np.sqrt(((f - c) ** 2).sum(axis=2))
    # letters against the rest: the split that best parts the two (Otsu on the distance to the fill), kept in a sane range
    # so a soft thin stroke still counts and a pale wall does not
    thr, _ = cv2.threshold(np.clip(d, 0, 255).astype(np.uint8), 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    m = (d < min(120.0, max(45.0, float(thr)))).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        return None
    tall = max(st[i, cv2.CC_STAT_HEIGHT] for i in range(1, n))
    keep = np.zeros_like(m)
    for i in range(1, n):
        x, y, cw, ch, a = st[i]
        # a letter, or the dot of an i: not a speck, not a streak along the edge of the crop
        if ch >= 0.22 * tall and a >= 6 and not (cw > 0.9 * w and ch < 0.2 * h):
            keep[lab == i] = 1
    return _tight(keep)


def overlap(a, b, H=48):
    """Two letter masks set to the same box. Returns (exact, near, width ratio): exact is the strict overlap, which tells
    kinds of face apart; near counts a stroke one pixel off as the same stroke, which says how alike two faces look. Both
    fall off when one word is much wider than the other."""
    import cv2, numpy as np
    ar_a, ar_b = a.shape[1] / a.shape[0], b.shape[1] / b.shape[0]
    W = int(max(8, min(640, round(H * ar_a))))
    A = cv2.resize(a * 255, (W, H), interpolation=cv2.INTER_AREA) > 100
    B = cv2.resize(b * 255, (W, H), interpolation=cv2.INTER_AREA) > 100
    union = (A | B).sum()
    iou = float((A & B).sum()) / union if union else 0.0
    k = np.ones((3, 3), np.uint8)
    Ad, Bd = cv2.dilate(A.astype(np.uint8), k) > 0, cv2.dilate(B.astype(np.uint8), k) > 0
    pa, pb = float((A & Bd).sum()) / max(1, A.sum()), float((B & Ad).sum()) / max(1, B.sum())
    near = 2 * pa * pb / (pa + pb) if pa + pb else 0.0
    wide = math.exp(-1.1 * abs(math.log(max(1e-3, ar_a / ar_b))))
    return iou * wide, near * wide, ar_a / ar_b


def stroke_ratio(m):
    """Stroke width over letter height, from the distance to the edge inside the letters."""
    import cv2, numpy as np
    if m is None or m.shape[0] < 8:
        return None
    dt = cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 3)
    v = dt[m > 0]
    if not len(v):
        return None
    return float(2 * np.percentile(v, 75) / 0.75) / m.shape[0]


def _hex(c):
    return "#%02x%02x%02x" % (int(c[0]), int(c[1]), int(c[2]))


def classify(items):
    """items: [{"img": BGR array, "text": str, "fill": "#rrggbb" or None}]. Returns the match, or None with too little to read."""
    import numpy as np
    lib = library()
    rows, nears, widths, strokes, fills, texts = [], [], [], [], [], []
    for it in items:
        text = "".join(ch for ch in str(it.get("text") or "") if ch.isalnum() or ch in " '&-")
        if sum(ch.isalpha() for ch in text) < 2:
            continue
        m = crop_mask(it.get("img"), it.get("fill"))
        if m is None or m.shape[0] < 10 or m.shape[1] < 10:
            continue
        sc, nr, ar = {}, {}, {}
        for i, face in enumerate(lib):
            try:
                r = render_mask(face, text)
            except Exception:
                r = None
            sc[i], nr[i], ar[i] = overlap(m, r) if r is not None else (0.0, 0.0, 1.0)
        rows.append(sc); nears.append(nr); widths.append(ar); texts.append(text)
        s = stroke_ratio(m)
        if s:
            strokes.append(s)
        if it.get("fill"):
            fills.append([int(it["fill"][k:k + 2], 16) for k in (1, 3, 5)])
    if not rows:
        return None
    mean = {i: float(np.mean([r[i] for r in rows])) for i in range(len(lib))}  # exact overlap: which face, which kind
    like = {i: float(np.mean([r[i] for r in nears])) for i in range(len(lib))}  # how alike it looks: the word we report
    order = sorted(mean, key=lambda i: -mean[i])
    best = order[0]
    face = lib[best]
    letters = [w for w in ("".join(ch for ch in t if ch.isalpha()) for t in texts) if len(w) >= 2]
    lo, up = sum(w == w.lower() for w in letters), sum(w == w.upper() for w in letters)
    case = "lower" if letters and lo >= 0.6 * len(letters) else "upper" if letters and up >= 0.6 * len(letters) else "as-said"
    # a caps-only pairing sets its titles in capitals, so it is only right for a reference that is in capitals too
    def pairing_of(f):
        ok = [p for p in f["pairings"] if case == "upper" or not p["upper"]]
        return (ok or [None])[0]
    pick, pick_face, pick_score = pairing_of(face), face, like[best]
    if not pick:
        for i in order[1:]:
            if lib[i]["category"] == face["category"] and pairing_of(lib[i]):
                pick, pick_face, pick_score = pairing_of(lib[i]), lib[i], like[i]
                break
    if not pick:
        pick, pick_face = face["pairings"][0], face
    by_cat = {}
    for i in order:
        by_cat.setdefault(lib[i]["category"], mean[i])
    category = face["category"]
    # narrow letters: when the word is a good deal narrower than the nearest face draws it, and nearer the width of our
    # condensed face, it is a condensed face (ours is heavy, so a lighter narrow one would not win on overlap alone)
    cond = next((i for i in order if lib[i]["category"] == "condensed"), None)
    if cond is not None and category != "condensed":
        wb, wc = float(np.median([w[best] for w in widths])), float(np.median([w[cond] for w in widths]))
        if wb < 0.8 and abs(math.log(wc)) < abs(math.log(wb)) and pairing_of(lib[cond]):
            category, pick, pick_face, pick_score = "condensed", pairing_of(lib[cond]), lib[cond], min(like[cond], MATCHED - 0.01)
    sr = float(np.median(strokes)) if strokes else None
    weight = None if sr is None else "regular" if sr < 0.115 else "bold" if sr < 0.215 else "black"
    color = None
    if fills:
        m3 = [int(np.median([f[k] for f in fills])) for k in range(3)]
        lum = (0.2126 * m3[0] + 0.7152 * m3[1] + 0.0722 * m3[2]) / 255
        sat = (max(m3) - min(m3)) / max(m3) if max(m3) else 0
        color = "#ffffff" if sat < 0.12 and lum > 0.82 else "#000000" if sat < 0.12 and lum < 0.15 else _hex(m3)
    # the pairing we draw with may be a second choice (the best face was caps only): judge the match by what we draw
    shown = pick_score
    match = "matched" if shown >= MATCHED else "close" if shown >= CLOSE else "guess"
    return {"category": category, "weight": weight, "case": case, "color": color, "face": pick_face["family"], "pairing": pick["name"], "match": match,
            "score": round(shown, 3), "samples": len(rows), "stroke": None if sr is None else round(sr, 3),
            "nearest": [{"face": lib[i]["family"], "weight": lib[i]["weight"], "category": lib[i]["category"], "score": round(like[i], 3), "exact": round(mean[i], 3)} for i in order[:4]],
            "categories": {k: round(v, 3) for k, v in by_cat.items()}}


def match_video(video, cues, frame_at, n=18):
    """The font of the big words on screen in a video. cues: the teardown's OCR cues; frame_at(video, t, width) -> BGR."""
    pick = [c for c in cues or [] if c.get("bbox") and (c.get("line_h") or c["bbox"][3]) >= 0.035 and (c.get("conf") or 1) >= 0.8
            and 1 <= len(str(c.get("text", "")).split()) <= 3 and sum(ch.isalpha() for ch in str(c.get("text", ""))) >= 3]
    pick.sort(key=lambda c: -(c.get("line_h") or c["bbox"][3]))
    pick = pick[: n * 3]
    pick = pick[:: max(1, len(pick) // n)][:n]
    items = []
    for c in pick:
        t0, t1 = c.get("t0", c.get("t", 0)), c.get("t1")
        img = frame_at(video, (t0 + (t1 if t1 is not None else t0 + 0.3)) / 2, 1080)
        if img is None:
            continue
        H, W = img.shape[:2]
        x, y, w, h = c["bbox"]
        crop = img[int(max(0, (y - 0.012) * H)):int(min(H, (y + h + 0.012) * H)), int(max(0, (x - 0.015) * W)):int(min(W, (x + w + 0.015) * W))]
        fill = (c.get("style") or {}).get("fill") or c.get("fill")
        items.append({"img": crop, "text": c["text"], "fill": fill if isinstance(fill, str) and len(fill) == 7 else None})
    return classify(items)


def test_crop(pairing, text, size=90, bg=3, upper=None):
    """A word drawn the way a phone video shows it, for the classifier test: on a busy background, soft, JPEG'd."""
    import cv2, numpy as np
    from PIL import Image, ImageDraw
    face = next((f for f in library() if any(p["name"] == pairing for p in f["pairings"])), None)
    if face is None:
        raise SystemExit("no pairing " + pairing)
    return file_crop(face, text, size, bg)


def file_crop(face, text, size=90, bg=3):
    import cv2, numpy as np
    from PIL import Image, ImageDraw
    rng = np.random.default_rng(bg * 7919 + len(text))
    f = _font(face, size)
    W, Hh = int(f.getlength(text) + size * 1.2), int(size * 2.1)
    # a soft mid-tone background with a gradient and blobs, like a wall behind a speaker
    yy, xx = np.mgrid[0:Hh, 0:W].astype(np.float32)
    base = 70 + 50 * np.sin(xx / (40 + 9 * bg)) * np.cos(yy / (31 + 5 * bg)) + 30 * (xx / W)
    back = np.stack([base + rng.normal(0, 9, base.shape) + k * 12 for k in range(3)], axis=2).clip(0, 200).astype(np.uint8)
    im = Image.fromarray(back[:, :, ::-1].copy())
    d = ImageDraw.Draw(im)
    d.text((int(size * .6) + 3, int(size * .45) + 4), text, font=f, fill=(20, 20, 20))  # a little shadow
    d.text((int(size * .6), int(size * .45)), text, font=f, fill=(255, 255, 255))
    out = cv2.GaussianBlur(np.asarray(im)[:, :, ::-1].copy(), (0, 0), 0.9)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 62])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("classify"); c.add_argument("--json", required=True)
    r = sub.add_parser("crop"); r.add_argument("--pairing"); r.add_argument("--file"); r.add_argument("--weight", type=int, default=400)
    r.add_argument("--text", required=True); r.add_argument("--out", required=True); r.add_argument("--size", type=int, default=90); r.add_argument("--bg", type=int, default=3)
    sub.add_parser("library")
    a = ap.parse_args()
    import cv2
    if a.cmd == "library":
        print(json.dumps([{k: v for k, v in f.items() if k != "file"} for f in library()], indent=1)); return
    if a.cmd == "crop":
        img = file_crop({"file": a.file, "weight": a.weight}, a.text, a.size, a.bg) if a.file else test_crop(a.pairing, a.text, a.size, a.bg)
        cv2.imwrite(a.out, img); return
    items = json.load(open(a.json, encoding="utf8"))
    for it in items:
        it["img"] = cv2.imread(it["image"])
    print(json.dumps(classify(items)))


if __name__ == "__main__":
    main()
