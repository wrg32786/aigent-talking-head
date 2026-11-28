#!/usr/bin/env python3
"""Draw a cover still: the title sits in a safe band and never on the face.

    python kit/publish-cover.py --in frame.jpg --out cover.jpg --title "The title" [--zone x0,y0,x1,y1,crownY] [--box x,y,w,h]

If --zone is omitted, YuNet measures the face keep-out on this still (same zone as kit/facezone.py). If --box is
omitted, the title goes in the largest safe band that does not cover that zone. Prints one JSON object: the box,
whether a face was found, and the wrapped lines. Used by kit/publish-kit.mjs.
"""
import argparse, json, os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
YUNET = HERE.parent / "effects" / "vendor" / "claude-video-effects" / "models" / "yunet.onnx"
# intersection of the 9:16 safe areas in kit/exports.json (TikTok, Reels, Shorts)
SAFE = dict(x0=60, y0=220, x1=940, y1=1480)
OW, OH, AW, AH = 1080, 1920, 540, 960
FONTS = [HERE / "fonts" / f for f in ("HankenGrotesk-VF.ttf", "InterTight-VF.ttf", "NunitoSans-VF.ttf")]


def parse_nums(s, n):
    if not s:
        return None
    xs = [float(x) for x in s.split(",")]
    if len(xs) < n:
        raise SystemExit(f"need {n} numbers")
    return xs[:n] if n != 5 else xs[:5]


def wrap(text, max_len=32, lines=2):
    words = [w for w in str(text or "").split() if w]
    if not words:
        return []
    out, line = [], ""
    for w in words:
        nxt = (line + " " + w).strip()
        if line and len(nxt) > max_len:
            if len(out) + 1 >= lines:
                out.append(line[:-1] + "…" if line.endswith(".") else line + "…")
                return out
            out.append(line)
            line = w
        else:
            line = nxt
    if line:
        out.append(line)
    return out[:lines]


def title_box(zone, safe=SAFE):
    x0, y0, x1, y1 = safe["x0"], safe["y0"], safe["x1"], safe["y1"]
    w, min_h = x1 - x0, 160
    if not zone:
        return dict(x=x0, y=y0, w=w, h=min(360, y1 - y0))
    z0, z1 = zone[1], zone[3]
    top = max(0, min(z0, y1) - y0)
    bot = max(0, y1 - max(z1, y0))
    if top >= bot and top >= 40:
        return dict(x=x0, y=y0, w=w, h=min(360, top))
    if bot >= 40:
        return dict(x=x0, y=max(z1, y0), w=w, h=min(360, bot))
    if top >= bot:
        return dict(x=x0, y=y0, w=w, h=top)
    return dict(x=x0, y=max(z1, y0), w=w, h=bot)


def overlaps(box, zone):
    if not box or not zone:
        return False
    return box["x"] < zone[2] and box["x"] + box["w"] > zone[0] and box["y"] < zone[3] and box["y"] + box["h"] > zone[1]


def detect_zone(im):
    """Return (zone or None, "yunet" or "off"). Needs OpenCV and the YuNet weights."""
    try:
        from facezone import zone_of, pick
    except Exception:
        return None, "off"
    if not YUNET.is_file():
        return None, "off"
    try:
        import cv2
    except Exception:
        return None, "off"
    img = im.convert("RGB")
    arr = __import__("numpy").array(img)[:, :, ::-1].copy()  # RGB -> BGR
    h, w = arr.shape[:2]
    if (w, h) != (OW, OH):
        import cv2
        arr = cv2.resize(arr, (OW, OH))
    import cv2, numpy as np
    small = cv2.resize(arr, (AW, AH))
    det = cv2.FaceDetectorYN.create(str(YUNET), "", (AW, AH), 0.6, 0.3, 20)
    _, faces = det.detect(small)
    f = pick(faces, None)
    if f is None:
        return None, "yunet"
    return zone_of(f), "yunet"


def font(size):
    from PIL import ImageFont
    for p in FONTS:
        if p.is_file():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw(im, box, lines):
    from PIL import Image, ImageDraw, ImageFilter
    # scale to 1080x1920 if needed, draw, then back? Covers are 9:16; we always draw in that frame and fit the still.
    w, h = im.size
    if (w, h) != (OW, OH):
        from PIL import Image as I
        im = im.resize((OW, OH), I.Resampling.LANCZOS)
    draw = ImageDraw.Draw(im)
    # font size from the box height and line count
    n = max(1, len(lines))
    # font size from the box height (never above it, down to a 28 px floor that stays readable), then shrink to fit width
    size = max(28, min(140, int(box["h"] / (n * 1.25))))
    fnt = font(size)
    for _ in range(8):
        widths = [draw.textlength(line, font=fnt) for line in lines] or [0]
        if max(widths) <= box["w"] - 8:
            break
        size = max(28, int(size * 0.9))
        fnt = font(size)
    gap = int(size * 0.2)
    total = n * size + (n - 1) * gap
    y = box["y"] + max(0, (box["h"] - total) / 2)
    stroke = max(3, size // 18)
    # where the letters really land (a thin band can overflow at the floor size), so onFace is measured on the ink
    ink = dict(x=box["x"], y=int(y - stroke), w=box["w"], h=int(total + 2 * stroke))
    for line in lines:
        tw = draw.textlength(line, font=fnt)
        x = box["x"] + (box["w"] - tw) / 2
        # dark stroke so white letters stay readable on a light or dark still
        draw.text((x, y), line, font=fnt, fill=(255, 255, 255, 255), stroke_width=stroke, stroke_fill=(12, 18, 22, 255))
        y += size + gap
    return im, ink


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="")
    ap.add_argument("--zone")
    ap.add_argument("--box")
    a = ap.parse_args()
    from PIL import Image
    im = Image.open(a.src).convert("RGB")
    detector = "given"
    if a.zone:
        zone = parse_nums(a.zone, 5)
    else:
        zone, detector = detect_zone(im)
    box = None
    if a.box:
        x, y, w, h = parse_nums(a.box, 4)
        box = dict(x=x, y=y, w=w, h=h)
    else:
        box = title_box(zone)
    lines = wrap(a.title)
    ink = None
    if not lines:
        lines = []
        # still write the frame as the cover when there is no title
        im2 = im.resize((OW, OH)) if im.size != (OW, OH) else im
    else:
        im2, ink = draw(im, box, lines)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    im2.convert("RGB").save(a.out, "JPEG", quality=92, optimize=True)
    print(json.dumps({
        "cover": a.out,
        "box": box,
        "zone": zone,
        "lines": lines,
        "onFace": overlaps(ink or box, zone) if zone else False,
        "detector": detector,
    }))


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    main()
