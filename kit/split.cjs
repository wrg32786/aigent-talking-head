// B-roll split layouts for cut.json inserts (kit/assemble.cjs, Studio's b-roll lane). Will, 2026-11-20: "the top split
// slightly behind my head, plus a framed box smaller than the presenter".
//   "top"   Split: the b-roll fills the top half and you fill the bottom half, moved so the top of your head reaches a
//           little into the panel's lower edge; with the person mask (kit/mask.py) your head draws over the panel, so
//           the panel sits behind it. Without the mask your head stays just under the seam (nothing is cut off).
//   "frame" Framed: two rounded cards on a soft backdrop. The b-roll in a wide card up top, you smaller in a card below,
//           with your head breaking out over its top edge (the person mask again). A thin accent border and a soft glow.
// Your face is found per moment by kit/facezone.py (build/facezone.json); "faceY" (0..1) is the fallback.
// A 4:5 or 1:1 version of the reel (kit/export-frame.cjs) passes its frame, { y0, h } on the 1080x1920 canvas: the
// split then halves that frame and the framed cards are fitted into it.
// Insert keys: "overlap" (px the head reaches into the split panel, default 72), "frameColor" (border and glow,
// default #3d8bff), "frameBg" ([top, bottom] backdrop colours, default cream to lavender).
const W = 1080, H = 1920;
const PLACES = ['full', 'top', 'pip', 'frame'];
const SPLIT = ['top', 'frame'];
const FRAME = { top: { x: 54, y: 72, w: 972, h: 760, r: 40 }, card: { x: 96, y: 1110, w: 888, h: 740, r: 40 }, scale: 0.9, breakout: 60, border: 4, capY: 912 };
const DEF_COLOR = '#3d8bff', DEF_BG = ['#f4ede3', '#e7e2f3'];
const even = n => Math.round(n / 2) * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const median = a => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

// the face over an insert's span: median crown (top of the head) and face centre x, from facezone.json
function faceOver(fz, at, dur) {
  if (!fz || !Array.isArray(fz.zones) || !fz.fps) return null;
  const i0 = Math.max(0, Math.floor(at * fz.fps)), i1 = Math.min(fz.zones.length - 1, Math.ceil((at + dur) * fz.fps));
  const zs = fz.zones.slice(i0, i1 + 1).filter(Boolean);
  if (!zs.length) return null;
  return { crown: median(zs.map(z => +z[4])), cx: median(zs.map(z => (+z[0] + +z[2]) / 2)), top: median(zs.map(z => +z[1])), bottom: median(zs.map(z => +z[3])) };
}

// geometry for one insert: where the b-roll goes, how your picture is scaled (s) and moved (dx, dy), the head band
// drawn over the panel or card edge (output rows y0..y1) and the caption line for the span
function layout(ins, face, { mask = true, frame = null } = {}) {
  const place = SPLIT.includes(ins && ins.place) ? ins.place : null;
  if (!place) return null;
  // the frame the layout fills: the whole reel, or the 4:5 or 1:1 window on it
  const fy = frame ? +frame.y0 || 0 : 0, fh = frame ? +frame.h || H : H, k = fh / H;
  const crown = face && face.crown != null ? face.crown : fy + (ins.faceY != null ? +ins.faceY : 0.4) * fh - 330 * k;
  if (place === 'top') {
    const over = mask ? clamp(ins.overlap != null ? +ins.overlap : 72, 0, 200) : -28, half = even(fh / 2), seam = fy + half;
    // the old split (face centred in the bottom half) when there is no face track and no faceY
    const dy = Math.round(clamp(face || ins.faceY != null ? seam - over - crown : half - ((ins.faceY != null ? +ins.faceY : 0.4) * fh - fh / 4), 0, half));
    return { place, panel: { x: 0, y: fy, w: W, h: half }, seam, s: 1, dx: 0, dy, band: mask && over > 0 ? { y0: Math.max(fy, seam - over - 150), y1: seam } : null, capY: Math.round(seam - Math.max(over, 0) - 110), mask };
  }
  const fit = r => (frame ? { ...r, y: Math.round(fy + r.y * k), h: even(r.h * k) } : r);
  const F = { ...FRAME, top: fit(FRAME.top), card: fit(FRAME.card), capY: Math.round(fy + FRAME.capY * k) }, s = F.scale, sw = even(W * s), sh = even(H * s), c = F.card;
  const cx = face && face.cx != null ? face.cx : W / 2;
  const dx = Math.round(clamp(W / 2 - cx * s, c.x + c.w - sw, c.x));
  const want = mask ? c.y - F.breakout : c.y + 36;
  // your picture has to cover the card: all of it on the reel, only the window's rows on a 4:5 or 1:1 version
  const dy = Math.round(clamp(want - crown * s, c.y + c.h - (fy + fh) * s, c.y - fy * s));
  return { place, panel: { ...F.top }, card: { ...c }, s, sw, sh, dx, dy, band: mask ? { y0: Math.max(fy, c.y - F.breakout - 190), y1: c.y + F.border + 2 } : null, capY: F.capY,
    color: /^#[0-9a-f]{6}$/i.test(ins.frameColor || '') ? ins.frameColor : DEF_COLOR,
    bg: Array.isArray(ins.frameBg) && ins.frameBg.every(x => /^#[0-9a-f]{6}$/i.test(x)) ? ins.frameBg.slice(0, 2) : DEF_BG, mask };
}

// a face zone [x0, y0, x1, y1, crownY] in your picture to where it sits in the layout
function mapZone(z, g) {
  if (!z || !g) return z;
  const m = (v, o) => Math.round(v * g.s + o);
  return [m(z[0], g.dx), m(z[1], g.dy), m(z[2], g.dx), m(z[3], g.dy), m(z[4], g.dy)];
}

// the static chrome for the framed layout as an ffmpeg geq: the backdrop everywhere outside the two cards, a thin
// border and a soft glow around each; the cards are holes (alpha 0) that the b-roll and your picture show through
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function chromeGeq(g) {
  const B = FRAME.border, A = rgb(g.color), T = rgb(g.bg[0]), Bt = rgb(g.bg[1] || g.bg[0]);
  const sd = r => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2, hw = r.w / 2 - r.r, hh = r.h / 2 - r.r;
    return `(hypot(max(abs(X-${cx})-${hw},0),max(abs(Y-${cy})-${hh},0))+min(max(abs(X-${cx})-${hw},abs(Y-${cy})-${hh}),0)-${r.r})`; };
  const d = `min(${sd(g.panel)},${sd(g.card)})`;
  // 0: distance, 1: border weight, 2: glow, 3: backdrop
  const pre = `st(0,${d});st(1,clip(0.5-ld(0),0,1));st(2,0.42*exp(-max(ld(0),0)/26))`;
  const ch = k => `${pre};st(3,${T[k]}+(${Bt[k] - T[k]})*Y/H);ld(1)*${A[k]}+(1-ld(1))*(ld(3)*(1-ld(2))+${A[k]}*ld(2))`;
  return `geq=r='${ch(0)}':g='${ch(1)}':b='${ch(2)}':a='255*clip(${d}+${B}+0.5,0,1)'`;
}
// is the framed backdrop light (captions then draw in dark ink, kit/overlay.html)?
function lightBg(ins) {
  if (!ins || ins.place !== 'frame') return false;
  const bg = Array.isArray(ins.frameBg) && ins.frameBg.every(x => /^#[0-9a-f]{6}$/i.test(x)) ? ins.frameBg : DEF_BG;
  const [r, g, b] = rgb(bg[0]); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}
// a soft shadow under the split panel's lower edge (1080x36 RGBA), drawn under your head
const shadowGeq = () => `geq=r=0:g=0:b=0:a='110*pow(1-Y/H,2)'`;

module.exports = { PLACES, SPLIT, FRAME, faceOver, layout, mapZone, chromeGeq, shadowGeq, lightBg };
