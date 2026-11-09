// Draft captions.js from Whisper word timings, so you start from timed captions instead of a blank file.
// Run from build/ after cut.json exists and word times are available:
//   words.json from kit/tx.py (keyed by file name), and/or clips.json from kit/clip.py next to the clip files.
//   node <kit>/autocaption.mjs                 -> writes captions.draft.js (never overwrites captions.js)
//   node <kit>/autocaption.mjs --out captions.js [--force] [--words 4] [--chars 22] [--shift 0.3] [--hero] [--logo logo.svg]
// Every phrase is a plain caption (mode 0). --hero makes the last phrase before each seam a spray hero word (mode 1).
// Seams get glitchAt entries. --shift adds seconds to every word (Whisper often runs 0.3-0.6 s early on cinematic takes).
// Hand-tweak the result: change modes, merge or split flips, add a card/countUp/cta block, then render.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, dirname, join } from 'path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const OUT = opt('out', 'captions.draft.js'), MAXW = +opt('words', 4), MAXC = +opt('chars', 22), SHIFT = +opt('shift', 0), GAP = +opt('gap', 0.35);
if (existsSync(OUT) && OUT !== 'captions.draft.js' && !opt('force', false)) { console.error(`${OUT} exists; pass --force to overwrite`); process.exit(1); }
if (!existsSync('cut.json')) { console.error('No cut.json here. Run from your build/ folder.'); process.exit(1); }
const C = JSON.parse(readFileSync('cut.json', 'utf8'));
const W = existsSync('words.json') ? JSON.parse(readFileSync('words.json', 'utf8')) : {};
const clipsCache = {};
function wordsFor(file) {
  const k = basename(file);
  if (W[k]) return W[k];
  const cj = join(dirname(file), 'clips.json');
  if (!(cj in clipsCache)) clipsCache[cj] = existsSync(cj) ? JSON.parse(readFileSync(cj, 'utf8')).clips || [] : [];
  const c = clipsCache[cj].find(c => basename(c.file) === k);
  return c ? c.words : [];
}

// segment words on the output clock (same maths as timeline.mjs)
let t = 0; const seams = [], words = [];
C.segs.forEach((s, i) => {
  const start = t, speech = t + (s.pad || 0), end = speech + (s.out - s.in);
  if (i) seams.push(+start.toFixed(3));
  const ws = wordsFor(s.file);
  if (!ws.length) console.warn(`no word times for ${s.file} (run kit/tx.py on it, or use clip.py clips)`);
  for (const [a, b, w] of ws) if (a >= s.in - 0.05 && b <= s.out + 0.05 && w) words.push({ s: Math.max(start, speech + a - s.in + SHIFT), e: Math.min(end, speech + b - s.in + SHIFT), w, seg: i });
  t = end;
});
const total = +(t + (C.tail ?? 0.3)).toFixed(2);

// group into short phrases: break on sentence/clause punctuation, a pause, a seam, or the word/char limit
const phrases = []; let cur = [];
const flush = () => { if (cur.length) phrases.push(cur); cur = []; };
words.forEach((w, i) => {
  const prev = cur[cur.length - 1];
  if (prev && (w.seg !== prev.seg || w.s - prev.e > GAP || cur.length >= MAXW || (cur.map(x => x.w).join(' ') + ' ' + w.w).length > MAXC)) flush();
  cur.push(w);
  if (/[.?!,;:]$/.test(w.w)) flush();
});
flush();
const clean = s => s.replace(/\s+/g, ' ').replace(/^[,;:\s]+|[,;:]+$/g, '').trim();
const flips = phrases.map((p, i) => {
  const next = phrases[i + 1];
  const end = next ? Math.min(next[0].s, Math.max(p[p.length - 1].e + 0.25, p[0].s + 0.5)) : Math.min(total, p[p.length - 1].e + 0.6);
  const hero = opt('hero', false) && (!next || next[0].seg !== p[0].seg);
  const text = clean(p.map(x => x.w).join(' '));
  return { start: +p[0].s.toFixed(2), end: +end.toFixed(2), text: hero ? text.replace(/[.?!]+$/, '').toUpperCase() : text, mode: hero ? 1 : 0 };
});
const caps = { note: `Auto-drafted by kit/autocaption.mjs from Whisper word times. Hand-tweak before shipping: modes 0 caption, 1 spray hero word, 2 sticker, 3 count-up, 4 takeover card, 5 logo plate, 6 CTA sticker (end 99 = hold to the end).`, flips, glitchAt: [0.02, ...seams], bursts: [], captionY: 1300 };
const logo = opt('logo', null); if (logo && logo !== true) caps.logo = logo;
writeFileSync(OUT, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
console.log(`${flips.length} captions from ${words.length} words -> ${OUT}  (seams ${JSON.stringify(seams)}, total ${total}s)`);
