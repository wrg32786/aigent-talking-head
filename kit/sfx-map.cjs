// SFX mapped to what moves on screen, and a density cap.
//
// Common short-form editing advice: a sound tells the eye where to look, so tie each sound to a kind of move and keep
// them sparse. The map: a whoosh on a named transition, a swipe when a colour card cuts in, a pop when a title, a
// graphic or a list number appears, typing under a typewriter entrance, and a click on a big punch-in.
// autoHits() turns a cut and its captions into pack sounds (cut.json sfxHits, each marked "auto": true, so a rebuild
// replaces them and keeps the ones you placed). It runs when cut.json has "sfxMap": true (the magazine preset).
//
// The cap (capHits) is on for every reel: at least minGap seconds between two sounds and at most per10 sounds in any
// 10 s. When two sounds compete the bigger move wins (boom > a card's swipe > whoosh > click > pop > the rest), and a sound
// you placed beats an auto one. cut.json "sfxCap": { "minGap": 0.25, "per10": 6 } (the default) or false to turn it off.
'use strict';
const R = require('./rules.cjs');
const SFXPLAN = require('./sfx-plan.cjs');

const MAP = { transition: '05-whoosh-fast', card: '08-swipe-up', text: '11-pop-sticker', number: '10-pop-bubble', type: '35-ui-keyboard-typing', key: '33-ui-mouse-click' };
const CAP = { minGap: 0.25, per10: 6 };
const PRIO = { boom: 6, hit: 6, sub: 5, swipe: 5, whoosh: 4, riser: 4, click: 3, ui: 3, typing: 2, pop: 2 };

// what kind of sound an id is: a locked-set key (whoosh, boom...) or a pack id (its category)
function kindOf(id) {
  if (R.SFX[id]) return { F: 'whoosh', D: 'swipe' }[id] || id;
  const s = SFXPLAN.lookup(id);
  if (!s) return 'other';
  if (/typing/.test(id)) return 'typing';
  return s.category === 'ui' ? 'click' : s.category;
}

// caps (the job's captions.js, for titleExit): a title exit that ends on a cut owns that seam, so its sound comes from
// its row in kit/title-effects.json, at the start of the move, and the transition it replaced makes none
function autoHits(cut, flips = [], caps = null) {
  const out = [], add = (key, t, why) => { if (t >= 0) out.push({ id: MAP[key], t: +(+t).toFixed(3), auto: true, why }); };
  const TL = R.timeline(cut), exits = R.titleExitSeams({ ...(caps || {}), flips }, cut);
  TL.segs.forEach(({ s, start }, i) => {
    if (!i) return;
    const x = exits[i];
    if (x) { if (x.sound) out.push({ id: x.sound, t: +Math.max(0, start - x.lead).toFixed(3), auto: true, why: `title exit ${x.exit}` }); }
    else if (s.transition && R.xfadeMode(s.transition)) add('transition', start, `transition ${s.transition}`);
    else if (s.bigPunch) add('key', start, 'big punch-in');
  });
  for (const f of flips) {
    if (f.mode === 8) add('card', f.start, f.chapter != null ? `chapter card ${f.chapter}` : 'colour card');
    else if (f.mode === 7) add(f.entrance === 'typewriter' ? 'type' : 'text', f.start, `title "${String(f.text || '').slice(0, 24)}"`);
    else if (f.mode === 38) {
      const n = Math.max(2, Math.min(10, Math.round(+f.count || 5))), d = f.end - f.start;
      for (let i = 0; i < n; i++) add('number', Array.isArray(f.at) && f.at[i] != null ? +f.at[i] : f.start + 0.08 + i * Math.min(0.42, d * 0.6 / n), `number ${i + 1}`);
    } else if (f.mode >= 9 && f.mode !== 11) add('text', f.start, `graphic mode ${f.mode}`);
  }
  return out.sort((a, b) => a.t - b.t);
}

// events: [{ t, kind, manual }] -> the same list with keep: true|false. Bigger moves first, then yours, then earlier.
function capHits(events, cap) {
  if (cap === false) return events.map(e => ({ ...e, keep: true }));
  const c = { ...CAP, ...(cap && typeof cap === 'object' ? cap : {}) }, kept = [];
  const order = events.map((e, i) => ({ e, i })).sort((a, b) => (PRIO[b.e.kind] || 1) - (PRIO[a.e.kind] || 1) || (b.e.manual ? 1 : 0) - (a.e.manual ? 1 : 0) || a.e.t - b.e.t);
  const keep = new Set();
  for (const { e, i } of order) {
    if (kept.some(k => Math.abs(k.t - e.t) < c.minGap)) continue;
    // any 10 s window holding e may carry at most per10 sounds
    const ts = kept.map(k => k.t).concat(e.t).sort((a, b) => a - b);
    let ok = true; for (let a = 0; a < ts.length && ok; a++) { let n = 0; for (let b = a; b < ts.length && ts[b] < ts[a] + 10; b++) n++; if (n > c.per10) ok = false; }
    if (!ok) continue;
    kept.push(e); keep.add(i);
  }
  return events.map((e, i) => ({ ...e, keep: keep.has(i) }));
}

module.exports = { MAP, CAP, PRIO, kindOf, autoHits, capHits };
