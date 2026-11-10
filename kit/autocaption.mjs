// Draft captions.js from Whisper word timings, so you start from timed captions instead of a blank file.
// Run from build/ after cut.json exists and word times are available:
//   words.json from kit/tx.py (keyed by file name), and/or clips.json from kit/clip.py next to the clip files.
//   node <kit>/autocaption.mjs                 -> writes captions.draft.js (never overwrites captions.js)
//   node <kit>/autocaption.mjs --out captions.js [--force] [--words 4] [--chars 22] [--shift 0.3] [--hero] [--logo logo.svg]
// Every phrase is a plain caption (mode 0). --hero makes the last phrase before each seam a spray hero word (mode 1).
// --titles makes it a kinetic title instead (mode 7, one per beat, up to 7, each with its own entrance; behind the
// person when a mask is made). --style kinetic (default: every word animates in, one emphasis word per phrase)|classic|pill|hormozi|karaoke sets
// captionStyle; pill groups 3 to 5 words. --fonts <pairing> writes "fonts" (kit/fonts/pairings.json).
// Every caption carries its word times ("words") so pills, hormozi and karaoke can follow the voice.
// Seams get glitchAt entries. --shift adds seconds to every word (Whisper often runs 0.3-0.6 s early on cinematic takes).
// Hand-tweak the result: change modes, merge or split flips, add a card/countUp/cta block, then render.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, dirname, join } from 'path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const STYLE = String(opt('style', 'kinetic')), PILLISH = STYLE !== 'classic';
if (!['kinetic', 'classic', 'pill', 'hormozi', 'karaoke'].includes(STYLE)) { console.error('--style must be kinetic, classic, pill, hormozi or karaoke'); process.exit(1); }
const OUT = opt('out', 'captions.draft.js'), MAXW = +opt('words', STYLE === 'pill' ? 5 : 4), MINW = STYLE === 'kinetic' ? 2 : PILLISH ? 3 : 1, MAXC = +opt('chars', 22), SHIFT = +opt('shift', 0), GAP = +opt('gap', 0.35);
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
// pills read best at 3 to 5 words: fold a short phrase into its neighbour in the same segment when it fits
if (MINW > 1) for (let i = 0; i < phrases.length; i++) {
  const p = phrases[i]; if (p.length >= MINW) continue;
  const prev = phrases[i - 1], next = phrases[i + 1];
  if (prev && prev[0].seg === p[0].seg && prev.length + p.length <= MAXW) { prev.push(...p); phrases.splice(i--, 1); }
  else if (next && next[0].seg === p[0].seg && next.length + p.length <= MAXW) { next.unshift(...p); phrases.splice(i--, 1); }
}
const STOP = new Set('a an the and or but of to in on at for with is are was it this that you your i we my our be as by so if do just'.split(' '));
const heroIdx = ws => { const lv = ws.map(w => { const x = String(w).toLowerCase().replace(/[^a-z0-9']/g, ''); return /\d/.test(x) ? 99 : STOP.has(x) ? x.length / 10 : x.length; }); return lv.indexOf(Math.max(...lv)); };
const clean = s => s.replace(/\s+/g, ' ').replace(/^[,;:\s]+|[,;:]+$/g, '').trim();
const flips = phrases.map((p, i) => {
  const next = phrases[i + 1];
  const end = next ? Math.min(next[0].s, Math.max(p[p.length - 1].e + 0.25, p[0].s + 0.5)) : Math.min(total, p[p.length - 1].e + 0.6);
  const last = !next || next[0].seg !== p[0].seg;
  const hero = opt('hero', false) && !opt('titles', false) && last;
  const text = clean(p.map(x => x.w).join(' '));
  const ws = p.map(x => [+x.s.toFixed(2), +x.e.toFixed(2), x.w.replace(/[,;:]+$/, '')]);
  // kinetic: the phrase is set as a font lockup; "hero" = the word(s) in the display face (the longest non-filler
  // word, or a number), the rest in the pairing's partner face (script or secondary). Edit "hero" to change it.
  const kin = {};
  if (STYLE === 'kinetic') kin.hero = [heroIdx(ws.map(w => w[2]))];
  return { start: +p[0].s.toFixed(2), end: +end.toFixed(2), text: hero ? text.replace(/[.?!]+$/, '').toUpperCase() : text, mode: hero ? 1 : 0, ...(last ? { _beatEnd: p[0].seg } : {}), ...(PILLISH ? { words: ws } : {}), ...kin };
});
// --titles: one kinetic title per beat (segment), from the beat's last phrase, held to the cut. Up to 7 (the first
// six beats plus the payoff), so no entrance repeats. That phrase leaves the caption track (the title says it).
if (opt('titles', false)) {
  const beats = flips.filter(f => f._beatEnd !== undefined);
  const pick = beats.length > 7 ? [...beats.slice(0, 6), beats[beats.length - 1]] : beats;
  const segEnd = i => { let t = 0; for (let k = 0; k <= i; k++) t += (C.segs[k].out - C.segs[k].in) + (C.segs[k].pad || 0); return t; };
  for (const f of pick) {
    // a title is a font lockup too: the hero word big in the display face, the rest of the phrase in the partner face
    const words = f.text.replace(/[.?!,]+$/, '').split(/\s+/);
    flips.push({ start: f.start, end: +Math.min(total, f._beatEnd === C.segs.length - 1 ? 99 : segEnd(f._beatEnd)).toFixed(2), text: words.join(' '), hero: [heroIdx(words)], mode: 7 });
    f._title = true; // the title says this phrase big behind the head, so the caption track skips it
  }
  for (let k = flips.length - 1; k >= 0; k--) if (flips[k]._title) flips.splice(k, 1);
  flips.sort((a, b) => a.start - b.start || a.mode - b.mode);
}
flips.forEach(f => delete f._beatEnd);
const caps = { note: `Auto-drafted by kit/autocaption.mjs from Whisper word times. Hand-tweak before shipping: modes 0 caption, 1 spray hero word, 2 sticker, 3 count-up, 4 takeover card, 5 logo plate, 6 CTA sticker, 7 kinetic title (entrance: stagger-rise|slam|blur-rise|slide-left|elastic|flip|pop-zoom, each once; flicker only on the first and last title). end 99 = hold to the end. captionStyle: kinetic|classic|pill|hormozi|karaoke; hero = word indices set big in the display face (titles and kinetic captions are two-font lockups; \"lockup\": false for one font).`, captionStyle: STYLE, ...(opt('fonts', null) && opt('fonts') !== true ? { fonts: opt('fonts') } : {}), flips, glitchAt: [0.02, ...seams], bursts: [], captionY: 1300 };
const logo = opt('logo', null); if (logo && logo !== true) caps.logo = logo;
writeFileSync(OUT, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
console.log(`${flips.length} captions from ${words.length} words -> ${OUT}  (seams ${JSON.stringify(seams)}, total ${total}s)`);
