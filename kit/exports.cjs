// Export presets (kit/exports.json): the delivered frame, the platform's safe area, bitrate and length caps.
//   frameOf(name) -> the "exportFrame" captions.js carries (overlay.html keeps every element inside its safe rect)
//   ffmpegArgs(name, src, out, len) -> the ffmpeg arguments that crop, cap and encode the export
'use strict';
const fs = require('fs'), path = require('path');
const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'exports.json'), 'utf8')).presets;
const NAMES = Object.keys(EX);
const get = n => EX[String(n || '').toLowerCase()] || null;
function frameOf(n) { const p = get(n); if (!p) return null; return { name: String(n).toLowerCase(), w: p.w, h: p.h, y0: p.y0, safe: { ...p.safe } }; }
// the safe rect in reel (1080x1920) coordinates
function safeRect(n) { const p = get(n); if (!p) return null; return { x0: p.safe.left, x1: 1080 - p.safe.right, y0: p.y0 + p.safe.top, y1: p.y0 + p.h - p.safe.bottom }; }
function ffmpegArgs(n, src, out, len) {
  const p = get(n); if (!p) throw new Error('unknown export ' + n + ' (' + NAMES.join(', ') + ')');
  const vf = [p.h < 1920 ? `crop=1080:${p.h}:0:${p.y0}` : null, p.w !== 1080 ? `scale=${p.w}:-2` : null].filter(Boolean);
  const k = p.videoKbps;
  return ['-v', 'error', '-y', '-i', src, ...(len > p.maxSec ? ['-t', String(p.maxSec)] : []), ...(vf.length ? ['-vf', vf.join(',')] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', k + 'k', '-maxrate', Math.round(k * 1.25) + 'k', '-bufsize', k * 2 + 'k',
    '-c:a', 'aac', '-b:a', p.audioKbps + 'k', '-ar', '48000', '-movflags', '+faststart', out];
}
const outName = (reel, n) => reel.replace(/\.mp4$/i, '') + '-' + String(n).toLowerCase() + '.mp4';
module.exports = { EX, NAMES, get, frameOf, safeRect, ffmpegArgs, outName };
