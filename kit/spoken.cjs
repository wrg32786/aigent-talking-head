// What the presenter actually says, in reel time, and the rule that on-screen words come from it.
// A recipe (a teardown of someone else's reel) carries their words: titles, ordinal stickers ("FIRST"), app labels.
// On your clip those words are only kept when you say them: an ordinal sticker shows the ordinal you speak, at the
// moment you speak it; an app label stays only if you name the app; recipe title text (--recipe-titles) only if you
// say it in that window. Anything else is dropped, never shown.
'use strict';
const fs = require('fs'), path = require('path');

const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(Boolean);
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10 };
const ORD_WORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

// [{start, end, word}] in reel time from cut.segs (file relative to build/, in/out in clip time) and each clip's
// words in the clips.json next to it (or words.json in build/, keyed by file name).
function timeline(segs, build) {
  const cache = {}, W = (() => { try { return JSON.parse(fs.readFileSync(path.join(build, 'words.json'), 'utf8')); } catch { return {}; } })();
  const wordsFor = file => {
    const k = path.basename(file);
    if (W && !Array.isArray(W) && W[k]) return W[k];
    const cj = path.join(path.dirname(file), 'clips.json');
    if (!(cj in cache)) { try { cache[cj] = JSON.parse(fs.readFileSync(cj, 'utf8')).clips || []; } catch { cache[cj] = []; } }
    const c = cache[cj].find(c => path.basename(c.file) === k);
    return (c && Array.isArray(c.words)) ? c.words : [];
  };
  const out = []; let off = 0;
  for (const s of segs || []) {
    const f = path.resolve(build, s.file), a = +s.in || 0, b = +s.out;
    for (const [ws, we, w] of wordsFor(f)) if (we > a && ws < b) out.push({ start: +(Math.max(ws, a) - a + off).toFixed(3), end: +(Math.min(we, b) - a + off).toFixed(3), word: String(w) });
    off += (b - a) + (s.pad || 0);
  }
  return out;
}

// is every word of text said between start - pad and end + pad (in order not required)?
function said(text, words, start, end, pad = 1.5) {
  const want = tokens(text); if (!want.length) return true;
  const near = new Set(words.filter(w => w.end >= start - pad && w.start <= end + pad).flatMap(w => tokens(w.word)));
  return want.every(t => near.has(t));
}
// first time all of text is said (its first word's start), the one nearest `near`, or null
function whenSaid(text, words, near = 0) {
  const want = tokens(text); if (!want.length) return null;
  let best = null;
  words.forEach((w, i) => {
    if (!tokens(w.word).includes(want[0])) return;
    const win = words.slice(i, i + want.length + 3).flatMap(x => tokens(x.word));
    if (want.every(t => win.includes(t)) && (best === null || Math.abs(w.start - near) < Math.abs(best.start - near))) best = w;
  });
  return best;
}
const ordinalsSaid = words => words.map(w => ({ ...w, n: ORD[norm(w.word)] })).filter(w => w.n);
const caseLike = (ref, s) => ref && ref === ref.toUpperCase() ? s.toUpperCase() : ref && /^[A-Z]/.test(ref) ? s[0].toUpperCase() + s.slice(1) : s;

// Recipe graphics -> graphics for your clip. Ordinal stickers: one per ordinal you say, styled like the recipe's
// stickers in turn, text the ordinal you said, starting just before you say it. App labels: kept only if you name the
// app, moved to when you say it. Screen cards carry no recipe words (your file, a confirmed source, or a placeholder).
// Returns { gfx, dropped: [{ g, why }] }.
function fitGraphics(gfx, words, len, opts = {}) {
  const out = [], dropped = [];
  const stickers = gfx.filter(g => g.mode === 9), ords = ordinalsSaid(words);
  if (stickers.length) {
    ords.filter(w => w.start < len - 0.4).forEach((w, i) => {
      const st = stickers[Math.min(i, stickers.length - 1)], d = Math.max(0.9, (st.end - st.start) || 0.9), s = Math.max(0, +(w.start - 0.15).toFixed(3));
      out.push({ ...st, text: caseLike(st.text, ORD_WORD[w.n]), start: s, end: +Math.min(len, s + d).toFixed(3), spoken: w.word });
    });
    stickers.slice(ords.length).forEach(g => dropped.push({ g, why: `ordinal sticker "${g.text || ''}": no matching ordinal said` }));
  }
  for (const g of gfx.filter(g => g.mode === 10)) {
    const w = g.text ? whenSaid(g.text, words, g.start) : null;
    if (!w) { dropped.push({ g, why: `app label "${g.text || ''}": you do not say it` }); continue; }
    const d = Math.max(opts.labelMin || 1.2, g.end - g.start), s = Math.max(0, +(w.start - 0.1).toFixed(3));
    if (s >= len - 0.4) { dropped.push({ g, why: `app label "${g.text}": said too late` }); continue; }
    out.push({ ...g, start: s, end: +Math.min(len, s + d).toFixed(3), spoken: w.word });
  }
  for (const g of gfx.filter(g => g.mode !== 9 && g.mode !== 10)) out.push(g);
  return { gfx: out.sort((a, b) => a.start - b.start), dropped };
}

// Last check over a job's flips: titles (7), ordinal stickers (9) and app labels (10) whose text you do not say in
// their window are dropped. Returns { flips, dropped }.
function audit(flips, words, pad = 1.5) {
  const dropped = [];
  const keep = (flips || []).filter(f => {
    if (![7, 9, 10].includes(f.mode) || !f.text) return true;
    if (said(f.text, words, f.start, f.end, pad)) return true;
    dropped.push({ g: f, why: `"${f.text}" at ${f.start}s is not in what you say there` }); return false;
  });
  return { flips: keep, dropped };
}

module.exports = { norm, tokens, timeline, said, whenSaid, ordinalsSaid, fitGraphics, audit, ORD };
