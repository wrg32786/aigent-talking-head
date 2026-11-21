// Teardown converter (kit/videomd2reel.cjs): big on-screen text that is not a caption.
'use strict';
const { r2, clean, norm, sameWord } = require('./util.cjs');
const { oneWordStream } = require('./captions.cjs');

// rea-video's entrance kinds -> our title entrances
const ENTRANCE_MAP = { cut: 'slam', pop: 'pop-zoom', reveal: 'stagger-rise', typewriter: 'stagger-rise', fade: 'blur-rise', slide: 'slide-left', slide_in: 'slide-left', zoom: 'pop-zoom', scale: 'pop-zoom', bounce: 'elastic', flip: 'flip', rotate: 'flip', blur: 'blur-rise' };

// Big on-screen words that are not running captions, in time order. Up to ten here; convert() drops the ones a graphic
// owns (an ordinal word, an app label) and keeps seven, one per entrance.
// A word the speaker is saying at that moment is a caption word, not a title, unless it is styled apart from the
// captions: clearly bigger (1.35x the caption height), boxed, multicolour or a styled sticker (huazi). Those dropped
// are listed on the result's .dropped for the report.
function pickTitles(b, max = 10) {
  const ow = oneWordStream(b);
  const all = ((b.packaging || {}).text_cues || []).filter(c => c && c.text);
  const cues = all.filter(c => !(ow && ow.cues.has(c)));
  const hOf = c => c.line_h ?? (c.bbox ? c.bbox[3] : 0);
  const med = a => { const x = a.filter(v => v > 0).sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : 0; };
  const capRef = ow ? med([...ow.cues].map(hOf)) : med(all.filter(c => c.kind === 'subtitle' && hOf(c) >= 0.025).map(hOf));
  const spoken = ((b.speech || {}).words || []).map(w => ({ a: w[0], z: w[1], w: norm(w[2]) })).filter(w => w.w.length >= 2);
  const dropped = [];
  const sayingIt = c => {
    const ws = String(c.text).split(/[\s/|]+/).map(norm).filter(w => w.length >= 2);
    if (!ws.length || !spoken.length) return false;
    const near = spoken.filter(w => w.a <= c.t1 + 0.3 && w.z >= c.t0 - 0.8).map(w => w.w);
    const hit = ws.filter(w => near.some(n => sameWord(n, w))).length;
    return hit / ws.length >= 0.5;
  };
  const styledApart = c => (capRef && hOf(c) >= capRef * 1.35) || c.kind === 'huazi' || !!(c.style && (c.style.box || c.style.multicolor));
  const ok = c => {
    if (!c.t1 || c.t1 <= c.t0) return false;
    const txt = String(c.text).trim();
    if (c.kind === 'subtitle' || c.part_of_picture) return false;
    if ((c.conf ?? 1) < 0.6 || txt.replace(/[^A-Za-z0-9]/g, '').length < 3 || /^[@#]|\.(com|html|io)\b/i.test(txt)) return false;
    const h = hOf(c);
    if (!(h >= 0.04 && (c.t1 - c.t0) >= 0.3)) return false;
    if (capRef && sayingIt(c) && !styledApart(c)) { dropped.push({ t: r2(c.t0), text: clean(c.text), why: 'the word being said, styled like the captions' }); return false; }
    // with one-word captions, a single word in the caption band at caption size is one of them even when the
    // transcript heard it differently (Claude heard as "Clod")
    if (ow && !styledApart(c) && !/[\s/|]/.test(txt) && c.band === ow.band && h <= capRef * 1.35 && h >= capRef * 0.6 && (c.t1 - c.t0) <= 1.6) { dropped.push({ t: r2(c.t0), text: clean(c.text), why: 'one of the one-word captions (same place and size)' }); return false; }
    return true;
  };
  const cand = cues.filter(ok).map(c => ({ c, score: (c.line_h ?? c.bbox[3]) * Math.min(2, c.t1 - c.t0) * (c.conf ?? 1) * (c.bbox ? Math.min(1, c.bbox[2] * 2) : 1) }));
  cand.sort((a, b2) => b2.score - a.score);
  const picked = [];
  for (const x of cand) {
    if (picked.length >= max) break;
    if (picked.some(p => x.c.t0 < p.c.t1 + 0.4 && p.c.t0 < x.c.t1 + 0.4)) continue; // one title at a time
    picked.push(x);
  }
  picked.sort((a, b2) => a.c.t0 - b2.c.t0);
  const used = new Set();
  const out = picked.map((x, i) => {
    const kind = x.c.anim_in && x.c.anim_in.kind;
    let ent = kind ? ENTRANCE_MAP[kind] : undefined;
    if (ent && used.has(ent)) ent = undefined; // each entrance once per reel; the engine fills a free one
    if (ent) used.add(ent);
    return { n: i + 1, start: r2(x.c.t0), end: r2(Math.max(x.c.t1, x.c.t0 + 0.8)), text: clean(x.c.text), entrance: ent, seenAs: kind || 'unknown', conf: x.c.conf ?? null, lines: x.c.n_lines || (String(x.c.text).includes('/') ? 2 : 1), bbox: x.c.bbox, fill: x.c.style && x.c.style.fill, band: x.c.band };
  });
  out.dropped = dropped;
  return out;
}

// Is a title's text, as the teardown read it off the screen, safe to draw? (Studio report 4, item 13: "Kng",
// "Inthe age of At,/be the signal,", "360 Days" for 347 Days.) Returns a short reason when it is not, else null:
//   the read itself was unsure (OCR confidence under 0.85);
//   a word with no vowel in it, or letters and punctuation run together, which is how a misread looks;
//   the speaker says something else at that moment (under two thirds of the title's words are in the speech near it,
//   or a number in it is not the number said).
function textDoubt(t, speechWords) {
  const txt = String(t.text || ''), toks = txt.split(/[\s/|]+/).filter(Boolean);
  if (t.conf != null && t.conf < 0.85) return `read with low confidence (${Math.round(t.conf * 100)}%)`;
  for (const w of toks) {
    const a = w.replace(/[^A-Za-z]/g, '');
    if (a.length >= 3 && !/[aeiouy]/i.test(a) && !(a === a.toUpperCase() && a.length <= 5)) return `"${w}" does not read as a word`;
    if (/[a-z][A-Z][a-z]/.test(w) || /[A-Za-z][,.;:][A-Za-z]/.test(w.replace(/\.(com|io|ai|md|html)$/i, '')) || /^[A-Za-z]+[.,][0-9]/.test(w)) return `"${w}" looks misread (letters and marks run together)`;
  }
  if (/[,;:]\s*\/|,\s*$/.test(txt)) return 'stray punctuation in it';
  const ws = toks.map(norm).filter(w => w.length >= 2), near = (speechWords || []).filter(w => w[0] <= t.end + 0.6 && w[1] >= t.start - 1.2).map(w => norm(w[2])).filter(Boolean);
  // a number that is not the number said ("360 Days" for 347 days)
  { const num = w => (/\d/.test(w) ? w.replace(/[^0-9]/g, '') : null), mine = ws.map(num).filter(Boolean), theirs = near.map(num).filter(Boolean); if (mine.length && theirs.length && mine.some(m => !theirs.includes(m))) return 'not the number said at that moment'; }
  if (ws.length >= 2 && near.length >= 2) { const hit = ws.filter(w => near.some(n => sameWord(n, w))).length; if (hit / ws.length < 0.67) return 'not what is said at that moment'; }
  return null;
}

module.exports = { ENTRANCE_MAP, pickTitles, textDoubt };
