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
    return { n: i + 1, start: r2(x.c.t0), end: r2(Math.max(x.c.t1, x.c.t0 + 0.8)), text: clean(x.c.text), entrance: ent, seenAs: kind || 'unknown', bbox: x.c.bbox, fill: x.c.style && x.c.style.fill, band: x.c.band };
  });
  out.dropped = dropped;
  return out;
}

module.exports = { ENTRANCE_MAP, pickTitles };
