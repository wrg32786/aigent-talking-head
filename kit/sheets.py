#!/usr/bin/env python3
"""Build labelled contact-sheet montages from showcase stills."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
BG = (17, 16, 20)
INK = (243, 238, 230)
MUTED = (154, 146, 136)
ACCENT = (92, 249, 226)
BAR = (10, 9, 12)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def fit_text(draw: ImageDraw.ImageDraw, text: str, max_w: int, start: int, min_size: int = 14):
    size = start
    while size > min_size:
        f = font(size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 1
    # wrap to two lines if still too wide
    f = font(min_size)
    if draw.textlength(text, font=f) <= max_w:
        return f, text
    return f, text


def wrap(draw: ImageDraw.ImageDraw, text: str, f, max_w: int) -> list[str]:
    if draw.textlength(text, font=f) <= max_w:
        return [text]
    # Prefer a hyphen/word break in the middle.
    if "-" in text:
        parts = text.split("-")
        best = None
        for i in range(1, len(parts)):
            a, b = "-".join(parts[:i]) + "-", "-".join(parts[i:])
            if draw.textlength(a, font=f) <= max_w and draw.textlength(b, font=f) <= max_w:
                best = [a, b]
                break
        if best:
            return best
    # character wrap as a last resort
    for i in range(len(text) - 1, 0, -1):
        if draw.textlength(text[:i], font=f) <= max_w:
            return [text[:i], text[i:]]
    return [text]


def render_sheet(spec: dict, dest: Path) -> None:
    items = spec["items"]
    cols = int(spec.get("cols") or min(6, max(1, len(items))))
    rows = (len(items) + cols - 1) // cols
    tile_w = int(spec.get("tile_w") or 240)
    # 9:16 picture, then a label bar under it
    pic_h = int(round(tile_w * 16 / 9))
    label_h = int(spec.get("label_h") or 52)
    tile_h = pic_h + label_h
    gap = int(spec.get("gap") or 14)
    pad = int(spec.get("pad") or 28)
    header_h = 86 if spec.get("title") else pad
    width = pad * 2 + cols * tile_w + (cols - 1) * gap
    height = header_h + pad // 2 + rows * tile_h + (rows - 1) * gap + pad
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    if spec.get("title"):
        title_f = font(36)
        draw.text((pad, 24), spec["title"], font=title_f, fill=INK)
        if spec.get("subtitle"):
            sub_f = font(18)
            tw = draw.textlength(spec["title"], font=title_f)
            draw.text((pad + tw + 16, 38), spec["subtitle"], font=sub_f, fill=MUTED)
    for i, item in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (tile_w + gap)
        y = header_h + r * (tile_h + gap)
        src = Path(item["src"])
        if src.is_file():
            im = Image.open(src).convert("RGB")
            im = im.resize((tile_w, pic_h), Image.Resampling.LANCZOS)
            sheet.paste(im, (x, y))
        else:
            draw.rectangle((x, y, x + tile_w, y + pic_h), fill=(28, 26, 32))
        # label bar
        by = y + pic_h
        draw.rectangle((x, by, x + tile_w, by + label_h), fill=BAR)
        label = item.get("caption") or item.get("id") or ""
        f = font(22)
        max_w = tile_w - 12
        while f.size > 13 and draw.textlength(label, font=f) > max_w:
            f = font(f.size - 1)
        lines = wrap(draw, label, f, max_w)
        if len(lines) > 1 and f.size > 13:
            f = font(max(13, f.size - 1))
            lines = wrap(draw, label, f, max_w)
        total_h = len(lines) * (f.size + 2)
        ty = by + (label_h - total_h) // 2 - 1
        for ln in lines[:2]:
            lw = draw.textlength(ln, font=f)
            draw.text((x + (tile_w - lw) / 2, ty), ln, font=f, fill=INK)
            ty += f.size + 2
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, format="JPEG", quality=86, optimize=True, subsampling=0)
    print(f"wrote {dest} {sheet.size[0]}x{sheet.size[1]} {dest.stat().st_size / 1024:.0f} KB")


def render_pair(spec: dict, dest: Path) -> None:
    left = Image.open(spec["left"]["src"]).convert("RGB")
    right = Image.open(spec["right"]["src"]).convert("RGB")
    tile_w = int(spec.get("tile_w") or 360)
    pic_h = int(round(tile_w * 16 / 9))
    label_h = int(spec.get("label_h") or 56)
    gap = int(spec.get("gap") or 16)
    pad = int(spec.get("pad") or 28)
    header_h = 86 if spec.get("title") else pad
    left = left.resize((tile_w, pic_h), Image.Resampling.LANCZOS)
    right = right.resize((tile_w, pic_h), Image.Resampling.LANCZOS)
    width = pad * 2 + tile_w * 2 + gap
    height = header_h + pad // 2 + pic_h + label_h + pad
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    if spec.get("title"):
        draw.text((pad, 24), spec["title"], font=font(36), fill=INK)
        if spec.get("subtitle"):
            tw = draw.textlength(spec["title"], font=font(36))
            draw.text((pad + tw + 16, 38), spec["subtitle"], font=font(18), fill=MUTED)
    def paste(im, x, y, caption):
        sheet.paste(im, (x, y))
        by = y + pic_h
        draw.rectangle((x, by, x + tile_w, by + label_h), fill=BAR)
        f = font(24)
        lw = draw.textlength(caption, font=f)
        draw.text((x + (tile_w - lw) / 2, by + (label_h - f.size) // 2 - 1), caption, font=f, fill=INK)
    y = header_h
    paste(left, pad, y, spec["left"].get("label") or "In front")
    paste(right, pad + tile_w + gap, y, spec["right"].get("label") or "Behind head")
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, format="JPEG", quality=86, optimize=True, subsampling=0)
    print(f"wrote {dest} {sheet.size[0]}x{sheet.size[1]} {dest.stat().st_size / 1024:.0f} KB")


def title_sheets(plan: dict) -> int:
    """Sheets of the stretches where big text is on screen (kit/sheets.mjs titleStretches picks them), every tile
    labelled with its time in seconds, for an agent or a vision model to read the designed titles from.
    plan: { video, outDir, stretches: [{from, to}], fps, cols, rows, tile_w }. Writes sheet-NN.jpg and sheets.json."""
    import subprocess, tempfile
    out_dir = Path(plan["outDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    fps, cols, rows, tw = int(plan["fps"]), int(plan.get("cols") or 6), int(plan.get("rows") or 4), int(plan.get("tile_w") or 244)
    per, label_h, gap = cols * rows, 26, 6
    try:
        f = ImageFont.truetype(str(Path(__file__).parent / "fonts" / "InterTight-VF.ttf"), 18)
    except Exception:
        f = ImageFont.load_default()
    tiles = []  # (seconds, picture)
    with tempfile.TemporaryDirectory() as tmp:
        for i, st in enumerate(plan["stretches"]):
            a, b = float(st["from"]), float(st["to"])
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-t", f"{max(0.05, b - a):.3f}", "-i", plan["video"], "-vf", f"fps={fps},scale={tw}:-2",
                            "-q:v", "3", str(Path(tmp) / f"s{i:03d}-%05d.jpg")], check=True, stdin=subprocess.DEVNULL)
            for n, src in enumerate(sorted(Path(tmp).glob(f"s{i:03d}-*.jpg"))):
                with Image.open(src) as im:  # closed before the folder goes (Windows keeps open files)
                    tiles.append((round(a + n / fps, 2), im.convert("RGB")))
    sheets = []
    for k in range(0, len(tiles), per):
        part = tiles[k:k + per]
        th = max(im.size[1] for _, im in part)
        nrows = (len(part) + cols - 1) // cols
        sheet = Image.new("RGB", (gap + cols * (tw + gap), gap + nrows * (th + label_h + gap)), BG)
        draw = ImageDraw.Draw(sheet)
        for j, (t, im) in enumerate(part):
            r, c = divmod(j, cols)
            x, y = gap + c * (tw + gap), gap + r * (th + label_h + gap)
            sheet.paste(im, (x, y))
            draw.rectangle((x, y + th, x + tw, y + th + label_h), fill=BAR)
            draw.text((x + 8, y + th + 3), f"{t:.2f} s", font=f, fill=INK)
        name = f"sheet-{len(sheets) + 1:02d}.jpg"
        sheet.save(out_dir / name, format="JPEG", quality=88)
        sheets.append({"file": name, "from": part[0][0], "to": part[-1][0], "fps": fps})
    with open(out_dir / "sheets.json", "w", encoding="utf-8") as fh:
        json.dump({"sheets": sheets}, fh, indent=1)
    print(f"title sheets: {len(sheets)} in {out_dir} ({len(tiles)} frames at {fps} a second)")
    return 0


def main() -> int:
    if len(sys.argv) > 2 and sys.argv[1] == "titles":
        return title_sheets(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")))
    plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8") if len(sys.argv) > 1 else sys.stdin.read())
    out_dir = Path(plan["outDir"])
    for spec in plan["sheets"]:
        dest = out_dir / f"{spec['id']}.jpg"
        if spec.get("type") == "pair":
            render_pair(spec, dest)
        else:
            render_sheet(spec, dest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
