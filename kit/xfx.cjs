// Drawn cut transitions: ffmpeg xfade "custom" expressions, so they need no gltransition build. kit/transitions.json maps a
// name to a stock xfade mode (a string) or to one of these ({ "custom": "<id>" }). Clean-room versions of the techniques in
// the MIT reel templates credited in THIRD_PARTY.md (staggered slats, a tile grid, a light leak, a zoom blur, a news
// ribbon); no code is copied. No st()/ld() registers: xfade runs an expression on several threads at once. In an xfade expression P runs from 1 to 0 over the blend, A and B are the outgoing and
// incoming pixel, X, Y, W and H are in the plane's own pixels and a0..a2, b0..b2 sample a plane at any point.
const fs = require('fs'), path = require('path');

// #rrggbb to 8-bit BT.709 limited-range Y, U, V (the pipeline is yuv420p)
function yuv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const n = m ? parseInt(m[1], 16) : 0xffffff;
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => v / 255);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b, u = (b - y) / 1.8556, v = (r - y) / 1.5748;
  return [Math.round(16 + 219 * y), Math.round(128 + 224 * u), Math.round(128 + 224 * v)];
}
const plane = ([y, u, v]) => `if(eq(PLANE,0),${y},if(eq(PLANE,1),${u},${v}))`;
const smooth = k => `(${k})*(${k})*(3-2*(${k}))`;
// sample the outgoing (a) or incoming (b) clip at (x, y) on this plane
const at = (s, x, y) => `if(eq(PLANE,0),${s}0(${x},${y}),if(eq(PLANE,1),${s}1(${x},${y}),${s}2(${x},${y})))`;

const CUSTOM = {
  // twelve vertical slats open one after another, left to right, each easing in and out
  slats: () => { const k = `clip((1-P-floor(X*12/W)*0.035)/0.6,0,1)`; return `if(lt(mod(X*12/W,1),${smooth(k)}),B,A)`; },
  // a 6 by 10 grid flips on a diagonal: each tile grows as a square of the accent, then opens on the new shot as the
  // accent fades out of it
  checkerboard: o => {
    const C = plane(yuv(o.color)), c = 'floor(X*6/W)', r = 'floor(Y*10/H)', fx = 'mod(X*6/W,1)', fy = 'mod(Y*10/H,1)';
    const k = `clip((1-P-(${c}+${r})/14*0.6)/0.4,0,1)`;
    return `if(lt(${k},0.5),if(lt(abs(${fx}-0.5),${k})*lt(abs(${fy}-0.5),${k}),${C},A),B*(${k}*2-1)+${C}*(2-${k}*2))`;
  },
  // a warm soft glow drifts across the frame and blooms while the shots cross-fade under it
  'light-leak': () => {
    const g = `exp(-(pow(X/W-(1.25-1.5*(1-P)),2)*5+pow(Y/H-0.38,2)*2.2))*sin(PI*(1-P))`, mx = `(A*P+B*(1-P))`;
    return `clip(${mx}+if(eq(PLANE,0),165,if(eq(PLANE,1),-44,50))*${g},0,255)`;
  },
  // zooms into the outgoing shot and out of the incoming one with a radial blur (five samples toward the centre)
  'zoom-blur': () => {
    const q = '(1-P)', z = `if(lt(${q},0.5),1+1.3*pow(${q}*2,2),1+1.3*pow(2-${q}*2,2))`, sp = `(0.05*sin(PI*${q}))`;
    const s = (src, j) => `${at(src, `W/2+(X-W/2)/((${z})*(1+${sp}*${j}))`, `H/2+(Y-H/2)/((${z})*(1+${sp}*${j}))`)}`;
    const avg = src => `(${[0, 1, 2, 3, 4].map(j => s(src, j)).join('+')})/5`;
    return `if(lt(${q},0.5),${avg('a')},${avg('b')})`;
  },
  // a diagonal broadcast ribbon (red and white stripes between a white and a dark edge) sweeps up across the frame and
  // leaves the new shot behind it; no text, no marks
  'news-ribbon': o => {
    const R = plane(yuv(o.ribbon || '#e10600')), Wt = plane(yuv('#ffffff')), D = plane(yuv('#111111'));
    const d = `((1-Y/H+(X/W)*0.32)/1.32-((1-P)*1.7-0.25))`, s = `mod((X/W)*9+(Y/H)*5,1)`;
    return `if(lt(${d},-0.3),B,if(lt(${d},-0.285),${Wt},if(lt(${d},-0.02),if(lt(${s},0.5),${R},${Wt}),if(lt(${d},0),${D},A))))`;
  },
  // Title exits (kit/rules.cjs TITLE_EXIT_MOVES; not in kit/transitions.json: a title's "exit" asks for them).
  // polaroid: the outgoing picture shrinks into a tilted print with a white border (deeper at the foot) and slides off
  // to the right, the new shot under it. The same numbers as polaroidAt() in kit/overlay.html, which moves the title.
  polaroid: () => {
    const q = '(1-P)', a = `min(1,${q}/0.55)`, e = smooth(a), b = `max(0,(${q}-0.45)/0.55)`, s = `(1-0.42*${e})`, th = `(-0.1*${e})`;
    const px = `(X-W/2-1.25*W*${b}*${b})`, py = `(Y-H/2+0.06*H*${b})`;
    const u = `((${px}*cos(${th})+${py}*sin(${th}))/${s}+W/2)`, v = `((${py}*cos(${th})-${px}*sin(${th}))/${s}+H/2)`, bw = '(0.035*W)';
    return `if(between(${u},0,W-1)*between(${v},0,H-1),${at('a', u, v)},if(between(${u},-${bw},W+${bw})*between(${v},-${bw},H+3*${bw}),${plane(yuv('#f7f5ee'))},B))`;
  },
  // glitch-slice: 14 horizontal bands of the outgoing picture tear out sideways, odd and even bands opposite ways, each
  // starting at its own moment, with the colour planes a little apart; the new shot is under them. The same bands and
  // shifts as sliceAt() in kit/overlay.html, which tears the title.
  'glitch-slice': () => {
    const q = '(1-P)', b = 'floor(Y*14/H)', r = `mod(abs(sin((${b}+1)*12.9898)*43758.5453),1)`, k = `clip((${q}-${r}*0.35)/0.65,0,1)`;
    const x = `(X-if(mod(${b},2),-1.1,1.1)*W*${k}*${k}+if(eq(PLANE,0),0,0.012*W*sin(PI*${q})))`;
    return `if(between(${x},0,W-1),${at('a', x, 'Y')},B)`;
  }
};

// the theme accent for drawn transitions: build/theme.js if there is one, else kit/themes/<THEME>.js (AIgent default)
function accent(dir) {
  for (const f of [path.join(dir || process.cwd(), 'theme.js'), path.join(__dirname, 'themes', (process.env.THEME || 'aigent') + '.js')]) {
    try { const m = /accent:\s*'(#[0-9a-f]{6})'/i.exec(fs.readFileSync(f, 'utf8')); if (m) return m[1]; } catch {}
  }
  return '#ffffff';
}
const isCustom = m => m && typeof m === 'object' && CUSTOM[m.custom];
// the xfade options for a mode from kit/transitions.json: "transition=<mode>" or "transition=custom:expr='...'"
function xfadeOpts(m, o = {}) {
  if (typeof m === 'string') return `transition=${m}`;
  if (!isCustom(m)) throw new Error('unknown drawn transition ' + JSON.stringify(m));
  return `transition=custom:expr='${CUSTOM[m.custom]({ color: o.color || m.color || accent(o.dir), ribbon: m.ribbon })}'`;
}
const label = m => typeof m === 'string' ? `ffmpeg xfade ${m}` : isCustom(m) ? `drawn ${m.custom} (xfade custom expression, kit/xfx.cjs)` : String(m);
module.exports = { CUSTOM, xfadeOpts, isCustom, label, yuv, accent };
