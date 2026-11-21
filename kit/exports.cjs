// Export presets (kit/exports.json): the delivered frame, the platform's safe area, bitrate and length caps.
//   frameOf(name) -> the "exportFrame" captions.js carries (overlay.html keeps every element inside its safe rect)
//   ffmpegArgs(name, src, out, len) -> the ffmpeg arguments that crop, cap and encode the export
//   parseList('reels,feed45') -> the names of one render run: one 9:16 layout plus any reframed sizes (4:5, 1:1)
//   outName(reel, name) -> reel-v1-feed-4x5.mp4, reel-v1-square-1x1.mp4, reel-v1-<name>.mp4 for the 9:16 presets
//   fileInfo('reel-v1-feed-4x5.mp4') -> { v, name, size, use, fx } for any file a render writes (old names too)
'use strict';
const fs = require('fs'), path = require('path');
const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'exports.json'), 'utf8')).presets;
const NAMES = Object.keys(EX);
const get = n => EX[String(n || '').toLowerCase()] || null;
// the sizes that are their own version of the reel (the frame follows the face, the layout is made again)
const REFRAMED = NAMES.filter(n => EX[n].reframe);
const isReframed = n => !!(get(n) && get(n).reframe);
// where a reframed size's frame sits on the 1080x1920 canvas its layout is made on: the middle
const fixedY = n => { const p = get(n); return p ? Math.round((1920 - p.h) / 2) : 0; };
function frameOf(n, { reframed = isReframed(n) } = {}) { const p = get(n); if (!p) return null; return { name: String(n).toLowerCase(), w: p.w, h: p.h, y0: reframed ? fixedY(n) : p.y0, safe: { ...p.safe }, ...(reframed ? { reframed: true } : {}) }; }
// the safe rect in reel (1080x1920) coordinates
function safeRect(n) { const p = get(n); if (!p) return null; const y0 = isReframed(n) ? fixedY(n) : p.y0; return { x0: p.safe.left, x1: 1080 - p.safe.right, y0: y0 + p.safe.top, y1: y0 + p.h - p.safe.bottom }; }
// y0: where the frame is cut from the source picture (a reframed build passes its fixed y; a plain crop uses the preset's)
function ffmpegArgs(n, src, out, len, { y0 } = {}) {
  const p = get(n); if (!p) throw new Error('unknown export ' + n + ' (' + NAMES.join(', ') + ')');
  const vf = [p.h < 1920 ? `crop=1080:${p.h}:0:${y0 != null ? y0 : p.y0}` : null, p.w !== 1080 ? `scale=${p.w}:-2` : null].filter(Boolean);
  const k = p.videoKbps;
  return ['-v', 'error', '-y', '-i', src, ...(len > p.maxSec ? ['-t', String(p.maxSec)] : []), ...(vf.length ? ['-vf', vf.join(',')] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', k + 'k', '-maxrate', Math.round(k * 1.25) + 'k', '-bufsize', k * 2 + 'k',
    '-c:a', 'aac', '-b:a', p.audioKbps + 'k', '-ar', '48000', '-movflags', '+faststart', out];
}
const suffixOf = n => { const p = get(n); return (p && p.file) || String(n).toLowerCase(); };
const outName = (reel, n) => reel.replace(/\.mp4$/i, '') + '-' + suffixOf(n) + '.mp4';
// "reels,feed45" (or an array) -> { names, main, reframed, extra, bad }: main is the 9:16 preset the reel itself is laid
// out for (the first one named), reframed the 4:5 and 1:1 versions, extra any further 9:16 presets (capped copies)
function parseList(v) {
  const names = [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim().toLowerCase()).filter(Boolean))];
  const bad = names.filter(n => !get(n)), ok = names.filter(n => get(n));
  const nine = ok.filter(n => !isReframed(n));
  return { names: ok, main: nine[0] || null, extra: nine.slice(1), reframed: ok.filter(isReframed), bad };
}
// every file name a render writes for a reel, read back: which version, which size, and the plain label for it
const SIZE = p => p.h === 1920 ? '9:16' : p.w === p.h ? '1:1' : '4:5';
const FILE_RE = /^reel(-fx)?-v(\d+)(?:-([a-z0-9-]+))?\.mp4$/i;
function fileInfo(f) {
  const m = FILE_RE.exec(path.basename(String(f || ''))); if (!m) return null;
  const tail = (m[3] || '').toLowerCase(), name = tail ? NAMES.find(n => suffixOf(n) === tail || n === tail) || null : null, p = name ? EX[name] : null;
  if (tail && !p) return { v: +m[2], fx: !!m[1], name: null, size: null, w: null, h: null, use: 'Export ' + tail, main: false };
  return { v: +m[2], fx: !!m[1], name, size: p ? SIZE(p) : '9:16', w: p ? p.w : 1080, h: p ? p.h : 1920, main: !tail,
    use: !p || p.h === 1920 ? (tail ? `For ${p.label.replace(/ \(9:16\)$/, '')}, a smaller file` : 'For Reels and Stories') : p.use || p.label };
}
module.exports = { EX, NAMES, REFRAMED, FILE_RE, get, isReframed, fixedY, frameOf, safeRect, ffmpegArgs, suffixOf, outName, parseList, fileInfo };
