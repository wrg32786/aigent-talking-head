// What the presenter actually says, in reel time, and the rule that on-screen words come from it.
// A recipe (a teardown of someone else's reel) carries their words: titles, ordinal stickers ("FIRST"), app labels.
// On your clip those words are only kept when you say them: an ordinal sticker shows the ordinal you speak, at the
// moment you speak it; an app label stays only if you name the app; recipe title text (--recipe-titles) only if you
// say it in that window. Anything else is dropped, never shown. The other text graphics (kit/graphics.json, modes 12 to
// 23) list their worded fields under "spoken": each must be said in the graphic's window; a checklist keeps only the
// rows you say and ticks each one as you say it.
// Cues: any graphic can carry "cues" (words or seconds, separated by ;). Each word cue becomes the time you say it in
// the graphic's window, a number is seconds into the graphic; the times land in "at", which the graphic uses for its
// beats (a checklist tick, a chart bar, a terminal line, a feature card, a cursor click). Narration drives the motion.
'use strict';
const fs = require('fs'), path = require('path');

// digits keep their thousands commas and decimal points together (10,000 is one token, 49.99 is one token); 10k is 10000
const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/(\d)\.(?=\d)/g, '$1p')
  .replace(/\b(\d+)k\b/g, (_, n) => String(+n * 1000)).replace(/\b(\d+)m\b/g, (_, n) => String(+n * 1000000)).replace(/[^a-z0-9]+/g, ' ').trim();
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

// spoken numbers as digits: "ten thousand" -> 10000, "forty nine" -> 49 (Whisper writes most numbers as digits already)
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };
function numberTokens(toks) {
  const out = []; let cur = null, tot = 0;
  const flush = () => { if (cur !== null) out.push(String(tot + cur)); cur = null; tot = 0; };
  for (const t of toks) {
    if (t in NUM) cur = (cur || 0) + NUM[t];
    else if (t in SCALE && (cur !== null || tot)) { if (SCALE[t] === 100) cur = (cur || 1) * 100; else { tot += (cur || 1) * SCALE[t]; cur = 0; } }
    else if (t === 'and' && cur !== null) continue;
    else flush();
  }
  flush();
  return out;
}
// the words said between start - pad and end + pad, as a token set: each word, spoken numbers as digits, and runs of two
// or three words joined ("the aigent" also counts as theaigent, for a handle)
function heard(words, start, end, pad) {
  const toks = words.filter(w => w.end >= start - pad && w.start <= end + pad).flatMap(w => tokens(w.word));
  const set = new Set(toks);
  numberTokens(toks).forEach(n => set.add(n));
  for (let i = 0; i < toks.length; i++) { if (toks[i + 1]) set.add(toks[i] + toks[i + 1]); if (toks[i + 2]) set.add(toks[i] + toks[i + 1] + toks[i + 2]); }
  return set;
}
// is every word of text said between start - pad and end + pad (in order not required)?
function said(text, words, start, end, pad = 1.5) {
  const want = tokens(text); if (!want.length) return true;
  const near = heard(words, start, end, pad);
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

// the worded fields of each graphic (kit/graphics.json "spoken"), by mode
const SPOKEN = (() => { try { return Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'graphics.json'), 'utf8')).graphics.filter(g => g.mode >= 12).map(g => [g.mode, g.spoken || []])); } catch { return {}; } })();
const KIND = (() => { try { return Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'graphics.json'), 'utf8')).graphics.map(g => [g.mode, g.id])); } catch { return {}; } })();
const itemsOf = f => (Array.isArray(f.items) ? f.items : String(f.items || '').split(';')).map(s => String(s).trim()).filter(Boolean);
// versus: left and right, or "A vs B" in text
const sides = f => { if (f.left || f.right) return [f.left, f.right]; const sp = String(f.text || '').split(/\s+(?:vs\.?|versus)\s+/i); return sp.length > 1 ? sp : [f.text]; };

// Last check over a job's flips: titles (7), ordinal stickers (9), app labels (10) and the worded fields of graphics 12
// to 23 whose words you do not say in their window are dropped. A checklist keeps the rows you say, ticking each as
// you say it ("at"), and is dropped when you say none. Returns { flips, dropped }.
function audit(flips, words, pad = 1.5) {
  const dropped = [], out = [];
  for (const f of flips || []) {
    if ([7, 9, 10].includes(f.mode)) {
      if (!f.text || said(f.text, words, f.start, f.end, pad)) out.push(f);
      else dropped.push({ g: f, why: `"${f.text}" at ${f.start}s is not in what you say there` });
      continue;
    }
    const keys = SPOKEN[f.mode];
    if (!keys || !keys.length) { out.push(f); continue; }
    let g = f, bad = null;
    const what = KIND[f.mode] || 'graphic';
    if (keys.includes('items')) {
      const its = itemsOf(f), win = words.filter(w => w.end >= f.start - pad && w.start <= f.end + pad), kept = [], at = [], det = [];
      const dets = listOf(f.details);
      its.forEach((it, i) => {
        if (!said(it, words, f.start, f.end, pad)) { dropped.push({ g: f, why: `${what} row "${it}" at ${f.start}s is not in what you say there` }); return; }
        const w = whenSaid(it, win, f.start);
        kept.push(it); det.push(dets[i] || ''); at.push(w ? +Math.min(Math.max(w.start, f.start + 0.3), f.end - 0.2).toFixed(3) : null);
      });
      if (!kept.length) bad = `${what} at ${f.start}s: you say none of its rows`;
      else {
        g = { ...f, items: kept, ...(!f.cues && at.every(a => a != null) ? { at } : {}) };
        if (dets.length) g.details = det;
      }
    }
    // a list of sub lines (feature card details): each one you do not say is left blank
    if (!bad && keys.includes('details') && g.details) {
      const ds = listOf(g.details).map(d => d && !said(d, words, f.start, f.end, pad) ? (dropped.push({ g: f, why: `${what} line "${d}" at ${f.start}s is not in what you say there` }), '') : d);
      g = { ...g, details: ds };
    }
    for (const k of keys.filter(k => k !== 'items' && k !== 'details')) {
      if (bad) break;
      const vals = k === 'left' || k === 'right' ? (k === 'left' ? [sides(f)[0]] : [sides(f)[1]]) : [f[k]];
      for (const v of vals) if (v && !said(v, words, f.start, f.end, pad)) { bad = `"${v}" at ${f.start}s is not in what you say there`; break; }
    }
    if (bad) dropped.push({ g: f, why: bad }); else out.push(g);
  }
  return { flips: cueFlips(out, words, pad).flips, dropped };
}

// a ; list or an array, trimmed (empty entries kept in place so a list stays aligned with its items)
const listOf = v => v == null ? [] : (Array.isArray(v) ? v : String(v).split(';')).map(s => String(s).trim());
// Cue times: "cues" (words or seconds, ;) to "at" in reel time. A word cue is the time you say it nearest the graphic's
// start (inside its window, padded); a number is seconds into the graphic. A cue you never say, or one outside the
// window, is spread between its neighbours. Returns { flips, resolved: [{ start, cue, at, said }] }.
function cueTimes(f, words, pad = 1.5) {
  const cs = listOf(f.cues).filter(Boolean), end = f.end > 90 ? f.start + 6 : f.end, lo = f.start + 0.15, hi = Math.max(lo, end - 0.25);
  if (!cs.length) return null;
  const win = words.filter(w => w.end >= f.start - pad && w.start <= end + pad), log = [];
  let prev = f.start;
  const at = cs.map(c => {
    if (/^\d+(\.\d+)?s?$/.test(c)) { const t = f.start + parseFloat(c); log.push({ cue: c, said: false }); return t >= f.start && t <= end ? t : null; }
    // the next time you say it after the previous cue (repeated words land in order)
    const w = whenSaid(c, win.filter(x => x.start >= prev), prev) || whenSaid(c, win, prev); log.push({ cue: c, said: !!w });
    const t = w && w.start >= f.start - 0.2 && w.start <= end ? Math.max(lo, w.start) : null; if (t != null) prev = t + 0.05; return t;
  });
  // fill gaps: unsaid cues sit evenly between the known times either side
  for (let i = 0; i < at.length; i++) if (at[i] == null) {
    let j = i; while (j < at.length && at[j] == null) j++;
    const a = i ? at[i - 1] : lo, b = j < at.length ? at[j] : hi;
    for (let k = i; k < j; k++) at[k] = a + (b - a) * (k - i + 1) / (j - i + 1);
    i = j - 1;
  }
  const out = at.map(t => +Math.min(hi, Math.max(lo, t)).toFixed(3));
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  return { at: out, log: log.map((l, i) => ({ ...l, at: out[i] })) };
}
function cueFlips(flips, words, pad = 1.5) {
  const resolved = [];
  const out = (flips || []).map(f => {
    if (!f.cues) return f;
    const r = cueTimes(f, words, pad); if (!r) return f;
    for (const l of r.log) resolved.push({ start: f.start, mode: f.mode, ...l });
    return { ...f, at: r.at };
  });
  return { flips: out, resolved };
}

module.exports = { cueTimes, cueFlips, listOf, norm, tokens, timeline, said, heard, numberTokens, whenSaid, ordinalsSaid, fitGraphics, audit, ORD, SPOKEN };
