// Phrase titles on your own words (1.29.0, Studio report 4 item 16). A reference whose text is designed phrase titles
// (kit/teardown/phrases.cjs) gives the pattern: when a title comes, how many lines, where the key word sits, how it
// builds, its effect and its exit. This maps that pattern onto what you say: one title per phrase of your speech at
// the matching moments, your words, the reference's look and build. Nothing of the reference's text is used.
// Rules: a title never starts before its first word is said and carries its word times, so no word shows early; it
// never sits on the face (above the head or across the chest only); one title at a time; never a one-word caption.
'use strict';
const { TITLE_EFFECTS, TITLE_EXITS, TITLE_BUILDS, titleRow } = require('./rules.cjs');
const { group } = require('./phrase-group.cjs');
const r3 = x => Math.round(x * 1000) / 1000;
const STOP = new Set('a an the and or but of to in on at for with is are was were it its this that these those you your i im we my our be been as by so if do does did just not no dont have has had will would can could they them he she his her me us about into from then than there here what when how why who'.split(' '));
const bare = w => String(w).toLowerCase().replace(/[^\p{L}\p{N}$%']/gu, '');   // any script, not only Latin
const shown = w => String(w).replace(/^["“(]+|[,.;:"”)]+$/g, '');   // a title keeps ? and !, drops the comma and the full stop
const isNum = w => /\d/.test(w);

// The shape of one reference title, from a recipe title (Reel.md line or titles.json): no text, only the pattern.
function shapeOf(t) {
  const lines = Array.isArray(t.lines) ? t.lines : String(t.text || '').split(/\s+\/\s+|\|/).filter(Boolean);
  const n = Math.max(1, Math.min(3, Array.isArray(t.lines) ? t.lines.length : +t.lines || lines.length || 1));
  const key = typeof t.key === 'string' ? t.key.toLowerCase() : null, keyLine = key ? lines.findIndex(l => l.toLowerCase().includes(key)) : -1;
  const pick = (v, list) => (list.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null);
  return { start: +t.start, end: +t.end, lines: n, key: !!key, keyLine, keyAlone: keyLine >= 0 && lines[keyLine].toLowerCase().trim() === key, build: pick(t.build, TITLE_BUILDS), effect: pick(t.effect, TITLE_EFFECTS), exit: pick(t.exit, TITLE_EXITS),
    band: ['top', 'middle', 'bottom'].includes(t.band) ? t.band : 'top', acrossCut: t.acrossCut === true || t['across-cut'] === true || t['across-cut'] === 'on', glow: t.glow === true || t.glow === 'on' };
}

// Your speech in phrases: a new one after a pause, after . ? ! , ; : or at seven words. words: [{ start, end, word }].
function ourPhrases(words, { max = 7, gap = 0.4 } = {}) {
  // the split with the fewest phrases of two to eight words (seven, and one more sooner than leave a word alone) inside each stretch (kit/phrase-group.cjs), so the last
  // word of a long stretch is not left alone; a stretch nothing fits (one word, or said too fast to read) comes back
  // as it is and the rules below join or drop it
  const out = group((words || []).filter(w => bare(w.word)), { maxWords: max + 1, minWords: 2, maxChars: 60, minDur: 0.3, gap, breakOn: /[.?!,;:]["”)]?$/, alone: w => isNum(w.word) }).map(p => p.words);
  // a word left alone joins the phrase beside it when they run together; a lone word is never a title unless it is a number
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].length > 1) continue;
    const w = out[i][0], p = out[i - 1], n = out[i + 1];
    if (p && w.start - p[p.length - 1].end < gap && p.length < max + 1 && !/[.?!]["”)]?$/.test(String(p[p.length - 1].word))) { p.push(w); out.splice(i, 1); }
    else if (n && n[0].start - w.end < gap && n.length < max + 1) { n.unshift(w); out.splice(i, 1); }
    else if (!isNum(w.word)) out.splice(i, 1);
  }
  return out.map(ws => ({ start: ws[0].start, end: ws[ws.length - 1].end, words: ws }));
}

// the key word of a phrase of yours: a number first, else the longest word that carries meaning (the later one on a tie)
function keyIndex(ws) {
  let b = -1, bl = 0;
  ws.forEach((w, i) => { const x = bare(w.word), l = isNum(x) ? 99 : STOP.has(x.replace(/'/g, '')) ? 0 : x.length; if (l >= bl && l > 0) { bl = l; b = i; } });
  return bl >= 3 ? b : -1;
}
// your words in the reference's number of lines: the key word on its own line when the reference's is, else even lines
function breakLines(ws, shape, ki) {
  const txt = ws.map(w => shown(w.word)), n = Math.min(shape.lines, txt.length);
  if (ki >= 0 && shape.keyAlone && n >= 2) {
    // a number keeps its unit ("365 days")
    const z = isNum(txt[ki]) && txt[ki + 1] && !STOP.has(bare(txt[ki + 1])) && ki + 2 === txt.length ? ki + 2 : ki + 1;
    let parts = [txt.slice(0, ki), txt.slice(ki, z), txt.slice(z)].filter(p => p.length);
    if (parts.length > n) parts = [parts[0], parts.slice(1).flat()];
    if (parts.length >= 2) return { lines: parts.map(p => p.join(' ')), key: txt.slice(ki, z).join(' ') };
  }
  const total = txt.join(' ').length, lines = []; let cur = [];
  txt.forEach((w, i) => { cur.push(w); const left = txt.length - i - 1, need = n - lines.length - 1; if (need > 0 && left >= need && (cur.join(' ').length >= total / n - 2 || left === need)) { lines.push(cur.join(' ')); cur = []; } });
  if (cur.length) lines.push(cur.join(' '));
  return { lines, key: ki >= 0 ? txt[ki] : null };
}

// refs: the reference's titles (recipe titles or shapes); words: your words on the edit's clock [{ start, end, word }];
// k: reference seconds to yours (the edit's length over the reference's); len: the edit's length; cuts: your cut times.
// Returns mode 7 flips, in time order, and a line for the log.
function mapPhrases(refs, words, { k = 1, len = Infinity, cuts = [] } = {}) {
  const shapes = (refs || []).map(t => (t && typeof t.keyAlone === 'boolean' ? t : shapeOf(t))).filter(s => Number.isFinite(s.start) && s.start * k < len - 0.5).sort((a, b) => a.start - b.start);
  const mine = ourPhrases(words).filter(p => p.start < len - 0.3), tol = Math.max(2, len * 0.08), picks = [];
  let from = 0;
  for (const s of shapes) {
    const at = s.start * k; let best = -1;
    for (let i = from; i < mine.length; i++) { if (mine[i].start > at + tol) break; if (best < 0 || Math.abs(mine[i].start - at) < Math.abs(mine[best].start - at)) best = i; }
    if (best < 0 || Math.abs(mine[best].start - at) > tol) continue;
    picks.push({ s, p: mine[best] }); from = best + 1;
  }
  // a named effect is never swapped in silence: when your words cannot carry it, the line says what is drawn instead
  // and why (needs and fallbacks: kit/title-effects.json)
  const fallbacks = [], fell = (id, at, why) => { const r = titleRow(id) || {}; fallbacks.push(`title at ${at}s: ${id} not drawn (${why}); ${r.kind === 'exit' ? 'the title just ends' : 'it comes in by its plain build'}`); };
  const flips = picks.map(({ s, p }, i) => {
    const ws = p.words, ki = s.key ? keyIndex(ws) : -1, { lines, key } = breakLines(ws, s, ki), next = picks[i + 1], lastEnd = Math.min(p.end, len);
    let end = Math.max(lastEnd + 0.35, p.start + Math.max(0.9, (s.end - s.start) * k));
    // it leaves at a cut of yours unless the reference holds its title across the cut; never before its last word is said
    if (!s.acrossCut) { const c = cuts.find(c => c >= lastEnd - 0.05 && c < end); if (c != null) end = Math.max(c, lastEnd); }
    if (next) end = Math.min(end, next.p.start - 0.08);
    end = Math.min(end, len);
    const f = { start: r3(p.start), end: r3(Math.max(end, p.start + 0.3)), mode: 7, phrase: true, snap: false, text: lines.join('|'), words: ws.map(w => [r3(w.start), r3(w.end), shown(w.word)]), build: s.build || 'word', place: s.band === 'top' ? 'above' : 'chest' };
    if (key) f.key = key;
    if (s.glow) f.glow = true;
    // an effect only where your words can carry it
    let fx = s.effect;
    if (fx === 'count-up') { const n = ki >= 0 && /^\d[\d,]*$/.test(shown(ws[ki].word)) ? +shown(ws[ki].word).replace(/,/g, '') : null; if (n != null && n > 1) { const unit = ws[ki + 1] && !STOP.has(bare(ws[ki + 1].word)) ? shown(ws[ki + 1].word) : null; f.count = { from: n > 20 ? 1 : 0, to: n, ...(unit ? { unit } : {}) }; } else { fell(fx, f.start, 'it needs a number you say'); fx = null; } }
    if (fx === 'slot-roll' && !(ki >= 0 && isNum(ws[ki].word))) { fell(fx, f.start, 'it needs a number in the key word'); fx = null; }   // digits roll; your phrase has no second word to swap in
    if (fx === 'stack-fade' && lines.length < 2) { fell(fx, f.start, 'it needs two lines or more'); fx = null; }
    if (fx) f.effect = fx;
    // an exit that is the transition needs a cut of yours where the title ends (the blow-up plays on its own too)
    if (s.exit) { const c = cuts.find(c => c >= lastEnd - 0.05 && c <= lastEnd + 1.2 && (!next || c < next.p.start - 0.08)); if (c != null) { f.end = r3(Math.max(c, f.start + 0.3)); f.exit = s.exit; } else if (!(titleRow(s.exit).needs || []).includes('cut')) f.exit = s.exit; else fell(s.exit, f.start, 'it needs a cut of yours where the title ends'); }
    return f;
  });
  return { flips, fallbacks, line: `phrase titles: ${flips.length} from your words on the reference's ${shapes.length} (its timing, lines, build and effects)${flips.length ? ': ' + flips.slice(0, 4).map(f => `"${f.text.replace(/\|/g, ' / ')}" at ${f.start}s`).join(', ') + (flips.length > 4 ? ', ...' : '') : ''}` };
}

module.exports = { shapeOf, ourPhrases, keyIndex, breakLines, mapPhrases };
