#!/usr/bin/env python3
"""Read the look of a reference's big titles (Studio report 4, items 6 to 9).
A teardown already finds each title (kit/teardown/titles.cjs: its text, box and time). Here we look at the frame:
  lines     one line, or two (a small partner line over or under one big key word), from the rows the letters sit on
  key       the big line: serif or sans, italic or upright (the slant of its strokes), case, colour
  partner   the small line: serif or sans, case, colour, where it sits (above or below) and how tall it is against the key
  glow      a halo in the key word's own colour round its letters (0 to 1; under 0.12 is none)
  dim       how much darker the picture is while the title is up than just before or after it, in the same shot (0 to 0.7)
summary() folds every title into one look for the recipe (Reel.md Style title-lockup, title-key, title-partner,
title-glow, title-dim). Nothing leaves the machine: OpenCV reads, Pillow draws the test frames.
  python kit/titlelook.py read --image frame.png --bbox x,y,w,h --text "IF WE MADE/$30K" [--before before.png]
  python kit/titlelook.py frame --out frame.png [--plain] [--no-glow] [--no-dim] [--one]     a test frame and its bbox
teardown.py calls read_video(video, titles, shots, frame_at) and writes the result to extras.json as "title_look".
"""
import argparse, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
GLOW_MIN, DIM_MIN = 0.12, 0.12


def _hex(bgr):
    return "#%02x%02x%02x" % (int(bgr[2]), int(bgr[1]), int(bgr[0]))


def _snap(bgr):
    """A colour as hex, plain white or black when it is close to them."""
    r, g, b = float(bgr[2]), float(bgr[1]), float(bgr[0])
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    mx = max(r, g, b)
    sat = (mx - min(r, g, b)) / mx if mx else 0
    return "#ffffff" if sat < 0.14 and lum > 0.8 else "#000000" if sat < 0.14 and lum < 0.15 else _hex(bgr)


def letter_mask(crop):
    """The letters in a crop: pixels far from what is behind them. The background is the crop with every thin stroke
    blurred away (a median over a window wider than a stroke), so two lines in two colours are both found."""
    import cv2, numpy as np
    h, w = crop.shape[:2]
    k = max(9, int(min(h, w) * 0.45) | 1)
    k = min(k, 99) | 1
    small = cv2.resize(crop, (max(8, w // 2), max(8, h // 2)), interpolation=cv2.INTER_AREA)
    back = cv2.resize(cv2.medianBlur(small, min(k, 255) | 1), (w, h), interpolation=cv2.INTER_LINEAR)
    d = np.sqrt(((crop.astype(np.float32) - back.astype(np.float32)) ** 2).sum(axis=2))
    thr = max(55.0, float(np.percentile(d, 99)) * 0.45)
    m = (d > thr).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= 12 and st[i, cv2.CC_STAT_HEIGHT] >= 5:
            keep[lab == i] = 1
    return keep


def row_bands(m):
    """The rows the letters sit on: [(y0, y1)], top to bottom. Rows a few pixels apart are one line."""
    import numpy as np
    h, w = m.shape
    rows = m.sum(axis=1) > max(2, 0.012 * w)
    bands, y = [], 0
    while y < h:
        if rows[y]:
            y0 = y
            while y < h and rows[y]:
                y += 1
            bands.append([y0, y])
        else:
            y += 1
    if not bands:
        return []
    tall = max(b[1] - b[0] for b in bands)
    out = [bands[0]]
    for b in bands[1:]:
        if b[0] - out[-1][1] < max(3, 0.1 * tall):
            out[-1][1] = b[1]
        else:
            out.append(b)
    return [(a, z) for a, z in out if z - a >= max(6, 0.12 * tall)]


def slant(m):
    """How far the strokes lean, as a shear (0 upright, about 0.2 for an italic): the shear that makes the columns
    of the letters stand straightest."""
    import cv2, numpy as np
    if m is None or m.shape[0] < 12 or m.sum() < 40:
        return 0.0
    h, w = m.shape
    H = 64
    mm = cv2.resize(m * 255, (max(8, int(w * H / h)), H), interpolation=cv2.INTER_AREA)
    pad = int(H * 0.5)
    mm = cv2.copyMakeBorder(mm, 0, 0, pad, pad, cv2.BORDER_CONSTANT, value=0).astype(np.float32)
    best, bs = 0.0, -1.0
    for k in range(-8, 21):
        s = k * 0.02
        M = np.float32([[1, s, -s * H / 2], [0, 1, 0]])
        col = cv2.warpAffine(mm, M, (mm.shape[1], H)).sum(axis=0)
        sc = float((col ** 2).sum())
        if sc > bs:
            bs, best = sc, s
    return round(best, 3)


def _case(text):
    letters = [w for w in ("".join(ch for ch in t if ch.isalpha()) for t in str(text).split()) if len(w) >= 2]
    if not letters:
        return "as-said"
    up, lo = sum(w == w.upper() for w in letters), sum(w == w.lower() for w in letters)
    return "upper" if up >= 0.6 * len(letters) else "lower" if lo >= 0.6 * len(letters) else "as-said"


def _kind(mask, text):
    """serif, sans, condensed or blackletter for one line, and the face of ours nearest to it: the line's letters set
    against the same words drawn in every hero face we ship (kit/fontmatch.py). None when the words were not read
    well enough to compare."""
    text = "".join(ch for ch in str(text or "") if ch.isalnum() or ch in " '&-$%.,!?")
    if mask is None or mask.shape[0] < 10 or sum(ch.isalnum() for ch in text) < 2:
        return None, None, 0.0
    try:
        sys.path.insert(0, HERE)
        import fontmatch
        best, bs = None, 0.0
        for face in fontmatch.library():
            try:
                r = fontmatch.render_mask(face, text)
            except Exception:
                r = None
            if r is None:
                continue
            sc = fontmatch.overlap(mask, r)[0]
            if sc > bs:
                best, bs = face, sc
        if best is None or bs < 0.3:
            return None, None, round(bs, 3)
        return best["category"], best["family"], round(bs, 3)
    except Exception:
        return None, None, 0.0


def core_mask(crop, m):
    """The solid letters inside a mask that may hold a glow as well: the pixels close to the letters' own colour (the
    colour of the mask's pixels that stand out most from what is behind them)."""
    import cv2, numpy as np
    f = crop.astype(np.float32)
    k = min(99, max(9, int(min(crop.shape[:2]) * 0.45) | 1)) | 1
    back = cv2.medianBlur(crop, k).astype(np.float32)
    d = np.sqrt(((f - back) ** 2).sum(axis=2))
    v = d[m > 0]
    if len(v) < 20:
        return m, np.array([255, 255, 255], np.float32)
    col = np.median(f[(m > 0) & (d >= np.percentile(v, 75))], axis=0)
    core = ((np.sqrt(((f - col) ** 2).sum(axis=2)) < 60) & (m > 0)).astype(np.uint8)
    return (core if core.sum() >= 20 else m), col


def glow_of(crop, mask, color_bgr):
    """A halo in the letters' colour round them: how far the ring just outside the letters is pulled from the picture
    farther out towards the letters' colour (0 none, 1 the letters' own colour)."""
    import cv2, numpy as np
    h = mask.shape[0]
    ys = np.where(mask.sum(axis=1) > 0)[0]
    lh = (ys.max() - ys.min() + 1) if len(ys) else h
    k = lambda f: np.ones((max(3, int(lh * f) | 1), max(3, int(lh * f) | 1)), np.uint8)
    near = (cv2.dilate(mask, k(0.14)) > 0) & ~(cv2.dilate(mask, k(0.04)) > 0)
    far = (cv2.dilate(mask, k(0.9)) > 0) & ~(cv2.dilate(mask, k(0.55)) > 0)
    if near.sum() < 30 or far.sum() < 30:
        return 0.0
    f = crop.astype(np.float32)
    a, b = np.median(f[near], axis=0), np.median(f[far], axis=0)
    c = np.array(color_bgr, np.float32)
    # by hue first (the picture behind is lighter in one place and darker in another, a glow's colour is not): each
    # colour as its share of red, green and blue. A white or grey key word has no hue to follow, so that one is read
    # by brightness.
    n = lambda v: v / max(1.0, float(v.sum()))
    an, bn, cn = n(a), n(b), n(c)
    den = float(((cn - bn) ** 2).sum())
    if den >= 0.004:
        return round(max(0.0, min(1.0, float(((an - bn) * (cn - bn)).sum()) / den)), 3)
    la, lb, lc = float(a.mean()), float(b.mean()), float(c.mean())
    if abs(lc - lb) < 40:
        return 0.0
    return round(max(0.0, min(1.0, (la - lb) / (lc - lb))), 3)


def read(img, bbox, text, before=None):
    """One title. img: the frame with the title up (BGR). bbox: [x, y, w, h] in fractions of the frame. text: the OCR
    text, lines joined with "/". before: a frame of the same shot with no title, for the dim. Returns a dict or None."""
    import cv2, numpy as np
    if img is None or not bbox:
        return None
    H, W = img.shape[:2]
    x, y, w, h = bbox
    px, py = 0.03, 0.02
    x0, y0, x1, y1 = int(max(0, (x - px) * W)), int(max(0, (y - py) * H)), int(min(W, (x + w + px) * W)), int(min(H, (y + h + py) * H))
    crop = img[y0:y1, x0:x1]
    if crop.size == 0 or crop.shape[0] < 16 or crop.shape[1] < 16:
        return None
    m = letter_mask(crop)
    bands = row_bands(m)
    if not bands:
        return None
    said = [s.strip() for s in str(text or "").split("/") if s.strip()]
    lines = []
    for a, z in bands:
        mm = m[a:z]
        xs = np.where(mm.sum(axis=0) > 0)[0]
        if not len(xs):
            continue
        cx0, cx1 = max(0, xs.min() - 2), min(mm.shape[1], xs.max() + 3)
        core, col = core_mask(crop[a:z], mm)
        ys2 = np.where(core.sum(axis=1) > 0)[0]
        ca, cz = (a + int(ys2.min()), a + int(ys2.max()) + 1) if len(ys2) else (a, z)
        lines.append({"y0": ca, "y1": cz, "h": cz - ca, "mask": core[ca - a:cz - a, cx0:cx1], "full": core, "row": a, "bgr": col, "color": _snap(col)})
    if not lines:
        return None
    # two lines when the letters sit on two rows of clearly different height (a caption-size line and a big word), or
    # when the OCR read two lines; more rows than that is a block of text, kept as its two tallest
    if len(lines) > 2:
        lines = sorted(sorted(lines, key=lambda l: -l["h"])[:2], key=lambda l: l["y0"])
    two = len(lines) == 2
    key = max(lines, key=lambda l: l["h"])
    out = {"lines": 2 if two else 1, "said_lines": len(said) or 1}
    ki = lines.index(key)
    ktext = said[ki] if len(said) == len(lines) else (max(said, key=len) if said and not two else (said[-1] if said else ""))
    kc, kface, ksc = _kind(key["mask"], ktext)
    sl = slant(key["mask"])
    out["key"] = {"category": kc, "face": kface, "score": ksc, "italic": sl >= 0.11, "slant": sl, "case": _case(ktext), "color": key["color"], "h": round(key["h"] / H, 4)}
    if two:
        p = lines[1 - ki]
        ptext = said[1 - ki] if len(said) == 2 else ""
        pc, pface, psc = _kind(p["mask"], ptext)
        out["partner"] = {"category": pc, "face": pface, "score": psc, "italic": slant(p["mask"]) >= 0.11, "case": _case(ptext) if ptext else None, "color": p["color"],
                          "place": "above" if p["y0"] < key["y0"] else "below", "scale": round(p["h"] / max(1, key["h"]), 3)}
    # the glow, read on the key line with room round it
    gy0, gy1 = max(0, key["y0"] - key["h"]), min(crop.shape[0], key["y1"] + key["h"])
    gm = np.zeros((gy1 - gy0, crop.shape[1]), np.uint8)
    gm[key["row"] - gy0:key["row"] - gy0 + key["full"].shape[0]] = key["full"]
    out["glow"] = glow_of(crop[gy0:gy1], gm, key["bgr"])
    if before is not None and before.shape == img.shape:
        g1, g0 = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), cv2.cvtColor(before, cv2.COLOR_BGR2GRAY).astype(np.float32)
        keep = np.ones((H, W), bool)
        keep[max(0, y0 - int(0.04 * H)):min(H, y1 + int(0.04 * H)), :] = False  # the title's own rows are left out
        a, b = float(np.median(g1[keep])), float(np.median(g0[keep]))
        if b > 12:
            out["dim"] = round(max(0.0, min(0.7, 1 - a / b)), 3)
    return out


def _most(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return max(set(vals), key=vals.count)


def summary(rows):
    """Every title's read folded into one look. The lockup is two-line when at least two titles, and a third of those
    read, are two lines."""
    import numpy as np
    rows = [r for r in rows if r]
    if not rows:
        return None
    two = [r for r in rows if r["lines"] == 2 and r.get("partner")]
    is_two = len(two) >= 2 and len(two) >= len(rows) / 3.0 or (len(rows) == 1 and len(two) == 1)
    src = two if is_two else rows
    key = {"category": _most([r["key"]["category"] for r in src]), "italic": sum(r["key"]["italic"] for r in src) > len(src) / 2.0,
           "case": _most([r["key"]["case"] for r in src]), "color": _most([r["key"]["color"] for r in src])}
    out = {"titles": len(rows), "two_line": len(two), "lockup": "two-line" if is_two else "one-line", "key": key}
    if is_two:
        out["partner"] = {"category": _most([r["partner"]["category"] for r in two]), "case": _most([r["partner"]["case"] for r in two]), "color": _most([r["partner"]["color"] for r in two]),
                          "place": _most([r["partner"]["place"] for r in two]), "scale": round(float(np.median([r["partner"]["scale"] for r in two])), 3)}
    gl = [r["glow"] for r in rows if r.get("glow") is not None]
    g = float(np.median(gl)) if gl else 0.0
    out["glow"] = round(g, 3) if g >= GLOW_MIN else 0
    dm = [r["dim"] for r in rows if r.get("dim") is not None]
    d = float(np.median(dm)) if dm else 0.0
    out["dim"] = round(d, 2) if d >= DIM_MIN else 0
    out["dim_read"] = len(dm)
    return out


def read_video(video, titles, shots, frame_at):
    """titles: the teardown's titles.json rows ({start, end, bbox, text}). shots: the breakdown's shots ({start, end}).
    frame_at(video, t, width) -> BGR. Returns {"rows": [per title or None], "look": summary or None}."""
    rows = []
    for t in titles or []:
        try:
            if not t.get("bbox"):
                rows.append(None); continue
            t0, t1 = float(t["start"]), float(t["end"])
            img = frame_at(video, min(t1 - 0.08, t0 + max(0.45, min(0.9, (t1 - t0) * 0.6))), 720)
            # a frame of the same shot with no title up: just before it, else just after
            sh = next((s for s in shots or [] if s["start"] <= t0 < s["end"]), None)
            before = None
            for tb in (t0 - 0.3, t1 + 0.3):
                if sh and sh["start"] + 0.05 <= tb <= sh["end"] - 0.05 and not any(o is not t and o["start"] - 0.1 <= tb <= o["end"] + 0.1 for o in titles):
                    before = frame_at(video, tb, 720); break
            rows.append(read(img, t["bbox"], t.get("text", ""), before))
        except Exception as e:  # one unreadable title never stops the teardown
            print(f"note: title look not read at {t.get('start')}s: {e}")
            rows.append(None)
    slim = [None if r is None else {k: v for k, v in r.items()} for r in rows]
    return {"rows": slim, "look": summary(rows)}


# ---- test frames ----
def test_frame(plain=False, glow=True, dim=True, one=False, w=720, h=1280, key_text="$30K", partner_text="IF WE MADE", seed=3):
    """A frame like the reference in the report: a small white sans line in caps over one big yellow word in an italic
    serif, glowing, on a darkened picture. plain: both lines in one upright sans, white. Returns (frame, before, bbox)."""
    import cv2, numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    base = 120 + 45 * np.sin(xx / 71.0) * np.cos(yy / 93.0) + 25 * (yy / h)
    back = np.stack([base + rng.normal(0, 6, base.shape) + k * 10 for k in range(3)], axis=2).clip(0, 235).astype(np.uint8)
    before = back.copy()
    pic = (back.astype(np.float32) * (0.6 if dim else 1.0)).astype(np.uint8)
    im = Image.fromarray(pic[:, :, ::-1].copy()).convert("RGBA")
    sans = os.path.join(FONTS, "InterTight-VF.ttf")
    serif = os.path.join(FONTS, "InstrumentSerif-Italic.ttf")
    kf = ImageFont.truetype(sans if plain else serif, int(w * 0.3))
    pf = ImageFont.truetype(sans, int(w * 0.062))
    for f in (pf, kf) if plain else (pf,):
        try:
            f.set_variation_by_axes([700 if a.get("name") in (b"Weight", "Weight") else a["default"] for a in f.get_variation_axes()])
        except Exception:
            pass
    kcol, pcol = ((255, 255, 255) if plain else (255, 212, 0)), (255, 255, 255)
    kw, pw = kf.getlength(key_text), pf.getlength(partner_text)
    py_, ky = int(h * 0.2), int(h * 0.2) + int(w * 0.075)
    if glow and not plain:
        g = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(g).text(((w - kw) / 2, ky), key_text, font=kf, fill=kcol + (255,))
        g = g.filter(ImageFilter.GaussianBlur(w * 0.022))
        for _ in range(4):
            im = Image.alpha_composite(im, g)
    d = ImageDraw.Draw(im)
    if not one:
        d.text(((w - pw) / 2, py_), partner_text, font=pf, fill=pcol + (255,))
    d.text(((w - kw) / 2, ky), key_text, font=kf, fill=kcol + (255,))
    kb = d.textbbox(((w - kw) / 2, ky), key_text, font=kf)
    pb = d.textbbox(((w - pw) / 2, py_), partner_text, font=pf)
    bx0, by0, bx1, by1 = (kb if one else (min(kb[0], pb[0]), min(kb[1], pb[1]), max(kb[2], pb[2]), max(kb[3], pb[3])))
    out = cv2.GaussianBlur(np.asarray(im.convert("RGB"))[:, :, ::-1].copy(), (0, 0), 0.7)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR), before, [round(bx0 / w, 4), round(by0 / h, 4), round((bx1 - bx0) / w, 4), round((by1 - by0) / h, 4)]


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("read"); r.add_argument("--image", required=True); r.add_argument("--bbox", required=True); r.add_argument("--text", default=""); r.add_argument("--before")
    f = sub.add_parser("frame"); f.add_argument("--out", required=True); f.add_argument("--plain", action="store_true"); f.add_argument("--no-glow", action="store_true")
    f.add_argument("--no-dim", action="store_true"); f.add_argument("--one", action="store_true"); f.add_argument("--key", default="$30K"); f.add_argument("--partner", default="IF WE MADE")
    s = sub.add_parser("summary"); s.add_argument("--json", required=True)
    a = ap.parse_args()
    import cv2
    if a.cmd == "frame":
        img, before, bb = test_frame(plain=a.plain, glow=not a.no_glow, dim=not a.no_dim, one=a.one, key_text=a.key, partner_text=a.partner)
        cv2.imwrite(a.out, img); cv2.imwrite(a.out.replace(".png", "-before.png"), before)
        print(json.dumps({"bbox": bb, "text": a.key if a.one else a.partner + "/" + a.key})); return
    if a.cmd == "summary":
        print(json.dumps(summary(json.load(open(a.json, encoding="utf-8"))))); return
    res = read(cv2.imread(a.image), [float(x) for x in a.bbox.split(",")], a.text, cv2.imread(a.before) if a.before else None)
    print(json.dumps(res))


if __name__ == "__main__":
    main()
