// Colour card interstitials and numbered chapter cards, proposed from what you say.
//
// A colour card (captions.js mode 8) cuts the frame to one flat colour for a beat while your voice runs on; the
// caption words you are saying carry it, set flat in the card's ink. Common short-form editing advice: a solid card on
// the line you want to land breaks the talking-head rhythm and makes that line read like a headline. A chapter card is
// the same with a big numeral ("chapter 2"), for list videos: one per item, when you say "first", "second", "number
// three", "tip four" and so on. A list video also gets a number-pop intro (kit/graphics.json number-pop): the numbers
// 1 to N pop in around your head while you say the hook, each with a pop sound.
//
// Used by kit/plan.cjs (writes a reel-cards block into the Reel.md for you to review) and by kit/reel.cjs when the
// preset or recipe says "cards": "auto" (the magazine preset does). Reel.md syntax: docs/reel-md.md "Cards".
'use strict';

// the palettes a card can name (kit/overlay.html CARDS), muted magazine pairs first
const PALETTES = ['olive', 'ivory', 'sage', 'clay', 'blush', 'forest', 'navy', 'cream', 'paper', 'blue', 'ink'];
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: 0, finally: 0 };
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const LEAD = new Set(['number', 'tip', 'step', 'rule', 'edit', 'lesson', 'idea', 'trick', 'way', 'reason', 'mistake', 'hack', 'thing', 'part', 'no', 'no.']);
// words that make a short line land hard (an emphasis card): a verdict, a contrast, a payoff
const PUNCHW = new Set(['never', 'always', 'only', 'stop', 'every', 'nothing', 'everything', 'secret', 'mistake', 'wrong', 'instantly', 'instant', 'free', 'why', 'boring', 'easy', 'simple', 'fast', 'one']);
const low = w => String(w).toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
const numOf = w => { const x = low(w); return /^\d{1,2}$/.test(x) ? +x : NUMW[x] != null ? NUMW[x] : null; };

// the list items you announce: [{ n, at (word start), i (word index) }] in order, when there are two or more
function chapters(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = low(words[i].word), nx = words[i + 1] ? words[i + 1].word : '';
    let n = null;
    if (w in ORD && ORD[w] > 0) n = ORD[w];
    else if (LEAD.has(w) && numOf(nx) != null && numOf(nx) <= 10) n = numOf(nx);
    if (n == null) continue;
    // a list counts up: keep the next number in order (1, 2, 3...), skip repeats and stray ordinals ("first time")
    const want = out.length ? out[out.length - 1].n + 1 : 1;
    if (n !== want) continue;
    out.push({ n, at: words[i].start, i });
  }
  return out.length >= 2 ? out : [];
}

// how many the hook promises ("5 easy edits", "three mistakes"): a number in the first sentence, else the chapters found
function promised(words, list) {
  const first = [];
  for (const w of words) { first.push(w); if (/[.!?]$/.test(w.word) || first.length > 14) break; }
  for (const w of first) { const n = numOf(w.word); if (n != null && n >= 2 && n <= 10) return { n, at: w.start }; }
  return list.length ? { n: list[list.length - 1].n, at: words.length ? words[0].start : 0 } : null;
}

function sentences(words) {
  const out = []; let cur = [];
  words.forEach((w, i) => { cur.push(w); const nx = words[i + 1]; if (/[.!?]["')]*$/.test(w.word) || !nx || nx.start - w.end > 0.6) { out.push(cur); cur = []; } });
  return out.map(ws => ({ ws, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map(w => w.word).join(' ') }));
}

// proposeCards(words, { len, palette, every }) -> { cards: [{start,end,bg,chapter?,why}], numberPop: {start,end,count,why}|null }
// words: [{ start, end, word }] in reel time (kit/spoken.cjs timeline). Cards never start in the first 1.2 s (the hook
// needs your face) or within the last second, never overlap, and leave at least `every` seconds (default 5) between
// emphasis cards. Chapter cards alternate the first two palette colours; emphasis cards take the next ones.
function proposeCards(words, opts = {}) {
  const len = opts.len || (words.length ? words[words.length - 1].end + 0.3 : 0);
  const pal = (opts.palette && opts.palette.length ? opts.palette : ['olive', 'ivory']).filter(p => PALETTES.includes(p) || /^#[0-9a-f]{6}$/i.test(p));
  const every = opts.every || 5, out = [];
  const free = (a, b) => a >= 1.2 && b <= len - 0.6 && !out.some(c => a < c.end + 0.25 && c.start < b + 0.25);
  const list = chapters(words);
  list.forEach((c, k) => {
    // the card lands on the ordinal and holds through the item's name (1.0 to 1.5 s)
    const nextW = words.slice(c.i).find((w, j) => j > 0 && (/[.!?,:]$/.test(words[c.i + j - 1].word) || w.start - words[c.i + j - 1].end > 0.45));
    const a = +Math.max(0, c.at - 0.05).toFixed(2), b = +Math.min(len - 0.6, Math.max(a + 1.0, Math.min(a + 1.5, nextW ? nextW.start : a + 1.3))).toFixed(2);
    if (free(Math.max(a, 1.2), b)) out.push({ start: Math.max(a, 1.2), end: b, bg: pal[k % Math.min(2, pal.length)] || 'olive', chapter: c.n, why: `you start item ${c.n} ("${words[c.i].word}${words[c.i + 1] ? ' ' + words[c.i + 1].word : ''}")` });
  });
  // emphasis cards: a short line (2 to 6 words) with a punch word, or one that ends with "!"; spaced out
  if (opts.emphasis !== false) {
    let k = 0, lastAt = -1e9;
    for (const s of sentences(words)) {
      const n = s.ws.length, punchy = s.ws.some(w => PUNCHW.has(low(w.word))) || /!$/.test(s.text.trim());
      if (n < 2 || n > 6 || !punchy || s.start - lastAt < every) continue;
      const a = +Math.max(0, s.start - 0.05).toFixed(2), b = +Math.min(len - 0.6, Math.max(a + 0.9, Math.min(a + 1.8, s.end + 0.15))).toFixed(2);
      if (!free(a, b)) continue;
      out.push({ start: a, end: b, bg: pal[(2 + k) % pal.length] || pal[k % pal.length], why: `a short line to land ("${s.text.slice(0, 40)}")` }); k++; lastAt = s.start;
    }
  }
  out.sort((x, y) => x.start - y.start);
  // the list intro: numbers 1 to N pop around your head while you say the hook (before the first card)
  let numberPop = null;
  if (list.length) {
    const p = promised(words, list), first = out.find(c => c.chapter != null);
    const a = +Math.max(0.15, (p ? p.at : 0) - 0.05).toFixed(2), b = +Math.min(a + 2.6, first ? first.start - 0.2 : a + 2.6, len - 0.6).toFixed(2);
    if (b - a >= 1.2) numberPop = { start: a, end: b, count: Math.max(2, Math.min(10, p ? p.n : list.length)), why: `a list of ${list.length} (you count them off)` };
  }
  return { cards: out, numberPop, chapters: list };
}

// a card as a reel-cards line, and a reel-cards line (parsed by reelmd.parseLine) as a captions.js flip
const cardLine = (c, n) => [`#${String(n).padStart(2, '0')} ${+(+c.start).toFixed(2)}-${+(+c.end).toFixed(2)}`, `bg ${c.bg}`, ...(c.chapter != null ? [`chapter ${c.chapter}`] : []), ...(c.ink ? [`ink ${c.ink}`] : []), ...(c.why ? [`why ${String(c.why).replace(/\|/g, '/')}`] : [])].join(' | ');
const cardFlip = c => ({ start: +c.start, end: +c.end, mode: 8, text: '', bg: c.bg || 'olive', ...(c.chapter != null && c.chapter !== '' ? { chapter: String(c.chapter) } : {}), ...(c.ink ? { ink: c.ink } : {}) });
function validateCard(c) {
  const errs = [];
  if (c.bg && !PALETTES.includes(c.bg) && !/^#[0-9a-f]{6}$/i.test(c.bg)) errs.push(`bg must be ${PALETTES.join(', ')} or a #rrggbb colour`);
  if (c.ink && !/^#[0-9a-f]{6}$/i.test(c.ink)) errs.push('ink must be a #rrggbb colour');
  if (c.chapter != null && c.chapter !== true && !/^\d{1,2}$/.test(String(c.chapter))) errs.push('chapter must be a number (1 to 99)');
  if (+c.end - +c.start > 4) errs.push('a card longer than 4 s hides you too long');
  return errs;
}

module.exports = { PALETTES, proposeCards, chapters, cardLine, cardFlip, validateCard };
