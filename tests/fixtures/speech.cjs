// Synthetic speech for cut-point tests, 32 kHz mono samples (kit/cutpoints.cjs envelopeFromSamples), no ffmpeg:
//   voiced [[a, b]]   a 180 Hz voice with harmonics (loud, the whole band)
//   hiss   [[a, b]]   a soft 6 kHz s or th: under the whole-band threshold, only the high band hears it
//   breath [[a, b]]   soft broadband noise
//   room tone everywhere (seeded noise, about -62 dBFS)
'use strict';
const SR = 32000;
function speech(secs, { voiced = [], hiss = [], breath = [] } = {}) {
  const n = Math.round(secs * SR), x = new Float32Array(n); let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const inAny = (spans, t) => spans.some(([a, b]) => t >= a && t < b);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let v = 0.0012 * rnd();
    if (inAny(voiced, t)) v += 0.25 * Math.sin(2 * Math.PI * 180 * t) + 0.12 * Math.sin(2 * Math.PI * 360 * t) + 0.05 * Math.sin(2 * Math.PI * 1100 * t);
    if (inAny(hiss, t)) v += 0.004 * Math.sin(2 * Math.PI * 6000 * t) + 0.002 * rnd();
    if (inAny(breath, t)) v += 0.01 * rnd();
    x[i] = v;
  }
  return x;
}
module.exports = { SR, speech };
