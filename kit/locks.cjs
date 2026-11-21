// Locks: pin exact choices so the auto-picker can only choose inside them. A lock is a user decision; nothing in the
// kit overrides it. Locks come from a style pack ("locks" in pack.json), from --lock on npm run reel, from
// npm run choices -- <job> --lock, or from the MCP set_locks tool.
//
//   --lock "transitions=whip,zoom; titles=typewriter; no-graphics=checklist,versus; finishes=grain"
//
// Keys (each value is a comma list unless noted):
//   transitions      named cuts every seam may use (kit/transitions.json); a seam outside the list is re-picked from it,
//                    weighted by the pack's "weights.transitions". Without glitch in the list there is no glitch seam.
//   titles           title entrances (kit/rules.cjs ENTRANCES). With fewer entrances than titles they repeat in turn.
//   max-titles       at most n kinetic titles (0 = none); the hook and the payoff are kept first
//   title-words      one (each title is its key word) or phrase (the beat's last phrase). Default: one for the oneword
//                    look, phrase for the rest (since 1.7.0). Pin it so the same clips give the same reel.
//   caption-entrance one caption entrance for the job (pop, unfurl, cascade, ...)
//   graphics         only these graphics may appear (kit/graphics.json ids)
//   no-graphics      these graphics never appear
//   finishes         film finishes the scenes may use (none = no finish)
//   cards            off = no colour or chapter cards
//   sfx              off = no sounds on the cuts
//   punch            off, or a zoom from 0.02 to 0.3
// In pack.json the same keys are camelCase: transitions, titles, maxTitles, titleWords, captionEntrance, graphics: { allow, deny },
// finishes, cards, sfx, punch.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./rules.cjs');
const B = require('./beats.cjs');

const KIT = __dirname;
const TITLE_MODE = 7, CARD_MODE = 8;
function transitionNames() { return Object.keys(JSON.parse(fs.readFileSync(path.join(KIT, 'transitions.json'), 'utf8')).names || {}); }
function graphics() { return JSON.parse(fs.readFileSync(path.join(KIT, 'graphics.json'), 'utf8')).graphics; }
function captionEntrances() { return require('./reelmd.cjs').CAPTION_LOOK['caption-entrance'][1]; }
const KEYS = ['transitions', 'titles', 'maxTitles', 'titleWords', 'captionEntrance', 'graphics', 'finishes', 'cards', 'sfx', 'punch'];
const FLAG_KEY = { transitions: 'transitions', titles: 'titles', 'max-titles': 'maxTitles', 'title-words': 'titleWords', 'caption-entrance': 'captionEntrance', graphics: 'graphics.allow', 'no-graphics': 'graphics.deny', finishes: 'finishes', cards: 'cards', sfx: 'sfx', punch: 'punch' };
const list = v => String(v).split(',').map(s => s.trim()).filter(Boolean);
const offish = v => ['off', 'false', 'no', 'none', '0'].includes(String(v).trim().toLowerCase());

// "transitions=whip,zoom; titles=typewriter" -> { transitions: [...], titles: [...] }
function parse(str) {
  const out = {};
  for (const part of String(str || '').split(';')) {
    if (!part.trim()) continue;
    const m = /^\s*([a-z-]+)\s*[=:]\s*(.*)$/i.exec(part);
    if (!m) throw new Error(`lock "${part.trim()}": write key=value (keys: ${Object.keys(FLAG_KEY).join(', ')})`);
    const key = FLAG_KEY[m[1].toLowerCase()];
    if (!key) throw new Error(`unknown lock "${m[1]}" (keys: ${Object.keys(FLAG_KEY).join(', ')})`);
    const v = m[2].trim();
    if (key === 'maxTitles') out.maxTitles = +v;
    else if (key === 'captionEntrance') out.captionEntrance = v;
    else if (key === 'titleWords') out.titleWords = v.toLowerCase();
    else if (key === 'cards' || key === 'sfx') out[key] = !offish(v);
    else if (key === 'punch') out.punch = offish(v) ? false : +v;
    else if (key.startsWith('graphics.')) { out.graphics = out.graphics || {}; out.graphics[key.split('.')[1]] = list(v); }
    else out[key] = list(v);
  }
  return out;
}

// later locks win key by key; graphics allow and deny merge separately
function merge(...all) {
  const out = {};
  for (const l of all) {
    if (!l) continue;
    for (const [k, v] of Object.entries(l)) {
      if (k === 'graphics' && v && typeof v === 'object') { out.graphics = { ...(out.graphics || {}), ...v }; continue; }
      out[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return out;
}
const isEmpty = l => !l || !Object.keys(l).length;

function validate(l) {
  const errs = [];
  if (!l) return errs;
  if (typeof l !== 'object' || Array.isArray(l)) return ['locks must be an object'];
  for (const k of Object.keys(l)) if (!KEYS.includes(k)) errs.push(`unknown lock "${k}" (${KEYS.join(', ')})`);
  const T = transitionNames(), G = graphics().map(g => g.id), CE = captionEntrances();
  for (const t of l.transitions || []) if (!T.includes(t)) errs.push(`locks.transitions: unknown transition "${t}"`);
  if (l.transitions && !l.transitions.length) errs.push('locks.transitions is empty; leave it out to let the kit pick');
  for (const e of l.titles || []) if (!R.ENTRANCES.includes(e)) errs.push(`locks.titles: unknown title entrance "${e}" (${R.ENTRANCES.join(', ')})`);
  if (l.maxTitles != null && !(Number.isInteger(+l.maxTitles) && +l.maxTitles >= 0 && +l.maxTitles <= 12)) errs.push('locks.maxTitles must be a whole number from 0 to 12');
  if (l.titleWords != null && !['one', 'phrase'].includes(l.titleWords)) errs.push('locks.titleWords must be one or phrase');
  if (l.captionEntrance != null && !CE.includes(l.captionEntrance)) errs.push(`locks.captionEntrance: unknown caption entrance "${l.captionEntrance}" (${CE.join(', ')})`);
  if (l.graphics != null) {
    if (typeof l.graphics !== 'object' || Array.isArray(l.graphics)) errs.push('locks.graphics must be { "allow": [...], "deny": [...] }');
    else for (const side of ['allow', 'deny']) for (const g of l.graphics[side] || []) if (!G.includes(g)) errs.push(`locks.graphics.${side}: unknown graphic "${g}"`);
  }
  for (const f of l.finishes || []) { if (f === 'none') continue; try { B.parseFinish(f); } catch (e) { errs.push('locks.finishes: ' + e.message); } }
  for (const k of ['cards', 'sfx']) if (l[k] != null && typeof l[k] !== 'boolean') errs.push(`locks.${k} must be true or false`);
  if (l.punch != null && l.punch !== false && !(+l.punch >= 0.02 && +l.punch <= 0.3)) errs.push('locks.punch must be false or a zoom from 0.02 to 0.3');
  return errs;
}

// a weighted round robin: deterministic, so the same job gives the same picks
function cycle(allowed, weights) {
  const seq = [];
  for (const a of allowed) { const w = Math.max(1, Math.round(+((weights || {})[a]) || 1)); for (let k = 0; k < w; k++) seq.push(a); }
  // spread repeats out: a,a,a,b -> a,b,a,a
  const out = [], pools = allowed.map(a => seq.filter(x => x === a));
  while (out.length < seq.length) for (const p of pools) if (p.length) out.push(p.shift());
  return i => out[i % out.length];
}

// cut.json side: transitions, finishes, punch, sounds. Returns lines saying what each lock changed.
function applyCut(locks, cut, opts = {}) {
  const log = [];
  if (isEmpty(locks) || !cut) return log;
  const segs = Array.isArray(cut.segs) ? cut.segs : [];
  if (locks.transitions && locks.transitions.length) {
    const pick = cycle(locks.transitions, opts.weights && opts.weights.transitions);
    let k = 0, changed = 0;
    segs.forEach((s, i) => {
      if (!i || s.jump || s.recut) return; // a Recreate re-cut seam is a hard cut, as in the reference
      const cur = s.transition || 'glitch';
      // repick: a pack with transition weights re-picks the seams that only carry its default, for weighted variety
      const auto = opts.repick && (!s.transition || s.transition === opts.defaultTransition);
      if (!locks.transitions.includes(cur) || auto) { const was = s.transition; s.transition = pick(k); if (s.transition !== was) changed++; }
      else if (!s.transition) s.transition = cur;
      k++;
    });
    if (!locks.transitions.includes('glitch')) { cut.hits = []; cut.glitch = false; }
    log.push(`lock transitions (${locks.transitions.join(', ')}): ${changed} seam${changed === 1 ? '' : 's'} re-picked`);
  }
  if (locks.finishes && locks.finishes.length) {
    const none = locks.finishes.includes('none'), ok = locks.finishes.filter(f => f !== 'none');
    const fine = f => f == null || (typeof f === 'string' && ok.includes(f)) || (none && f === 'none');
    if (cut.finish != null && !fine(cut.finish)) { if (ok.length && !none) cut.finish = ok[0]; else delete cut.finish; }
    let n = 0;
    segs.forEach((s, i) => { if (s.finish != null && !fine(s.finish)) { if (ok.length && !none) s.finish = ok[i % ok.length]; else delete s.finish; n++; } });
    if (none && !ok.length) { delete cut.finish; segs.forEach(s => { delete s.finish; }); }
    log.push(`lock finishes (${locks.finishes.join(', ')}): ${n} scene finish${n === 1 ? '' : 'es'} changed`);
  }
  if (locks.punch !== undefined) {
    cut.punch = locks.punch === false ? false : +locks.punch;
    if (locks.punch === false) segs.forEach(s => { delete s.bigPunch; });
    log.push(`lock punch: ${locks.punch === false ? 'off' : locks.punch}`);
  }
  if (locks.sfx === false) { cut.sfx = {}; cut.sfxMap = false; log.push('lock sfx: off, no sounds on the cuts'); }
  cut.locks = merge(cut.locks, locks);
  return log;
}

function graphicId(f, byMode) { const g = byMode.get(f.mode); return g ? g.id : null; }

// captions.js side: title entrances and count, caption entrance, graphics, cards.
function applyCaptions(locks, caps) {
  const log = [];
  if (isEmpty(locks) || !caps) return log;
  let flips = caps.flips || [];
  if (locks.cards === false) {
    const n = flips.filter(f => f.mode === CARD_MODE).length;
    flips = flips.filter(f => f.mode !== CARD_MODE);
    if (n) log.push(`lock cards: off, ${n} card${n === 1 ? '' : 's'} removed`);
  }
  const byMode = new Map(graphics().map(g => [g.mode, g]));
  const gl = locks.graphics || {};
  if ((gl.allow && gl.allow.length) || (gl.deny && gl.deny.length)) {
    const out = [];
    for (const f of flips) {
      const id = graphicId(f, byMode);
      if (id && ((gl.deny || []).includes(id) || (gl.allow && gl.allow.length && !gl.allow.includes(id)))) { log.push(`lock graphics: ${id} at ${f.start}s removed`); continue; }
      out.push(f);
    }
    flips = out;
  }
  if (locks.maxTitles != null) {
    const t = flips.filter(f => f.mode === TITLE_MODE).sort((a, b) => a.start - b.start), n = +locks.maxTitles;
    if (t.length > n) {
      // keep the hook and the payoff first, then the earliest of the rest
      const keep = new Set(n >= 1 ? [t[0]] : []);
      if (n >= 2) keep.add(t[t.length - 1]);
      for (const f of t) if (keep.size < n) keep.add(f);
      const drop = t.filter(f => !keep.has(f));
      flips = flips.filter(f => !drop.includes(f));
      log.push(`lock max-titles ${n}: ${drop.length} title${drop.length === 1 ? '' : 's'} removed`);
    }
  }
  // title-words one: a phrase title becomes its key word (a rebuild with the lock; a draft makes them so from the start)
  if (locks.titleWords === 'one') {
    let n = 0;
    for (const f of flips) { if (f.mode !== TITLE_MODE || f.lockup === false) continue; const ws = String(f.text).split(/\s+/).filter(Boolean); if (ws.length < 2) continue;
      const h = Array.isArray(f.hero) && ws[f.hero[0]] ? f.hero[0] : ws.reduce((b, w, i) => (w.length > ws[b].length ? i : b), 0);
      f.text = ws[h].replace(/[^\w'$%-]+$/, ''); f.lockup = false; delete f.hero; n++; }
    if (n) log.push(`lock title-words one: ${n} title${n === 1 ? '' : 's'} set to the key word`);
  }
  if (locks.titles && locks.titles.length) {
    const t = flips.filter(f => f.mode === TITLE_MODE).sort((a, b) => a.start - b.start);
    const used = new Set(t.map(f => f.entrance).filter(e => locks.titles.includes(e)));
    let k = 0, changed = 0;
    for (const f of t) {
      if (f.entrance && locks.titles.includes(f.entrance)) continue;
      const free = locks.titles.find(e => !used.has(e));
      f.entrance = free || locks.titles[k++ % locks.titles.length];
      used.add(f.entrance); changed++;
    }
    // fewer entrances than titles: repeats are the user's call, so the plan check allows them
    if (t.length > locks.titles.length) caps.entranceRepeat = true;
    log.push(`lock titles (${locks.titles.join(', ')}): ${changed} title entrance${changed === 1 ? '' : 's'} set`);
  }
  if (locks.captionEntrance) { caps.captionEntrance = locks.captionEntrance; log.push(`lock caption-entrance: ${locks.captionEntrance}`); }
  caps.flips = flips;
  caps.locks = merge(caps.locks, locks);
  return log;
}

function describe(l) {
  if (isEmpty(l)) return 'none';
  const parts = [];
  if (l.transitions) parts.push(`transitions ${l.transitions.join(', ')}`);
  if (l.titles) parts.push(`titles ${l.titles.join(', ')}`);
  if (l.maxTitles != null) parts.push(`max ${l.maxTitles} titles`);
  if (l.captionEntrance) parts.push(`caption entrance ${l.captionEntrance}`);
  if (l.titleWords) parts.push(`titles as ${l.titleWords === 'one' ? 'one word' : 'a phrase'}`);
  if (l.graphics && l.graphics.allow) parts.push(`only graphics ${l.graphics.allow.join(', ')}`);
  if (l.graphics && l.graphics.deny) parts.push(`no ${l.graphics.deny.join(', ')}`);
  if (l.finishes) parts.push(`finishes ${l.finishes.join(', ')}`);
  if (l.cards === false) parts.push('no cards');
  if (l.sfx === false) parts.push('no sfx');
  if (l.punch !== undefined) parts.push(`punch ${l.punch === false ? 'off' : l.punch}`);
  return parts.join('; ');
}

// self-test for npm run check: returns a list of failures
function selfTest() {
  const errs = [];
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
  { // title-words: pins one word or the phrase, so the same clips give the same reel
    const l = parse('title-words=one'); eq(l, { titleWords: 'one' }, 'parse title-words'); eq(validate({ titleWords: 'words' }).length, 1, 'title-words one or phrase');
    const caps = { flips: [{ mode: 7, start: 1, end: 2, text: 'copy the source code', hero: [2] }] }; applyCaptions(l, caps); eq(caps.flips[0].text, 'source', 'title-words one keeps the key word'); }
  try {
    const l = parse('transitions=whip,zoom; titles=typewriter; no-graphics=checklist; max-titles=2; cards=off');
    eq(l, { transitions: ['whip', 'zoom'], titles: ['typewriter'], graphics: { deny: ['checklist'] }, maxTitles: 2, cards: false }, 'parse');
    eq(validate(l), [], 'validate a good lock');
    if (!validate({ transitions: ['nope'] }).length) errs.push('validate missed an unknown transition');
    if (!validate({ wat: 1 }).length) errs.push('validate missed an unknown key');
    const cut = { segs: [{ in: 0, out: 1 }, { in: 1, out: 2 }, { in: 2, out: 3, jump: true }, { in: 3, out: 4, transition: 'crossfade' }, { in: 4, out: 5, transition: 'zoom' }], hits: [[0.02, 14], [1, 24]] };
    applyCut(l, cut, { weights: { transitions: { whip: 1, zoom: 1 } } });
    eq(cut.segs.map(s => s.transition || null), [null, 'whip', null, 'zoom', 'zoom'], 'transitions re-picked inside the lock, jumps stay hard cuts');
    eq(cut.hits, [], 'no glitch seam without glitch in the lock');
    const c2 = { segs: [{}, { transition: 'crossfade' }, { transition: 'crossfade' }, { transition: 'crossfade' }, { transition: 'crossfade' }, { transition: 'whip' }] };
    applyCut({ transitions: ['crossfade', 'dissolve'] }, c2, { weights: { transitions: { crossfade: 3, dissolve: 1 } }, repick: true, defaultTransition: 'crossfade' });
    eq(c2.segs.map(s => s.transition || null), [null, 'crossfade', 'dissolve', 'crossfade', 'crossfade', 'crossfade'], 'weighted re-pick of the default seams');
    const g = graphics().find(x => x.id === 'checklist');
    const caps = { flips: [
      { start: 0.5, end: 2, mode: 7, text: 'hook', entrance: 'slam' }, { start: 3, end: 4, mode: 7, text: 'mid' },
      { start: 5, end: 6, mode: 7, text: 'mid two' }, { start: 7, end: 8, mode: 7, text: 'payoff' },
      { start: 2, end: 3, mode: g.mode, items: ['a'] }, { start: 4, end: 5, mode: 8, bg: 'olive' }, { start: 1, end: 2, mode: 0, text: 'words' }] };
    applyCaptions(l, caps);
    const t = caps.flips.filter(f => f.mode === 7);
    eq(t.map(f => f.text), ['hook', 'payoff'], 'max-titles keeps the hook and the payoff');
    eq(t.map(f => f.entrance), ['typewriter', 'typewriter'], 'title entrances inside the lock, repeating');
    eq(caps.entranceRepeat, true, 'repeat flag set');
    eq(caps.flips.some(f => f.mode === g.mode || f.mode === 8), false, 'denied graphic and cards removed');
    eq(caps.flips.some(f => f.mode === 0), true, 'captions untouched');
  } catch (e) { errs.push('locks self-test threw: ' + e.message); }
  return errs;
}

module.exports = { KEYS, FLAG_KEY, parse, merge, validate, applyCut, applyCaptions, describe, isEmpty, cycle, selfTest, transitionNames, graphics, captionEntrances };
