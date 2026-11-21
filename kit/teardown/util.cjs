// Teardown converter (kit/videomd2reel.cjs): small helpers the parts share.
'use strict';
const r2 = x => Math.round(x * 100) / 100;
const pad2 = n => String(n).padStart(2, '0');
const clean = t => String(t).replace(/\s+/g, ' ').replace(/[|]/g, '/').replace(/\u2014/g, ',').trim();
const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
// near-equal words: OCR and ASR each drop or swap a letter now and then (brainstom / brainstorm)
function lev(a, b) { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; }
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 1);
function hexOK(h) { return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h); }

module.exports = { r2, pad2, clean, norm, lev, sameWord, hexOK };
