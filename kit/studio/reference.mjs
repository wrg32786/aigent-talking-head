// Studio reference: what a reference teardown (its Reel.md) gives Studio. extract reads it (the Look, the shot plan, what
// was made for the menu, what the breakdown read), referenceLook turns it into picks for Recreate (all of it) or
// Influence (the parts switched on), and influencePack makes the soft pack Influence uses. Pure: no server, no network.
// kit/studio/core.mjs re-exports all of it, so callers keep importing from core.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join, basename } from 'path';
import { createRequire } from 'module';
import { catalog, applyPatch, ROOT } from './core.mjs';

const require = createRequire(import.meta.url);
const L = require('../locks.cjs');
const K = require('../packs.cjs');
const R = require('../rules.cjs');
const SCN = require('../scenes.cjs');
const all = kind => kind === 'transition' ? L.transitionNames() : kind === 'entrance' ? R.ENTRANCES.slice() : kind === 'graphic' ? L.graphics().map(g => g.id) : kind === 'finish' ? Object.values(catalog().items).filter(i => i.kind === 'finish').map(i => i.id) : [];

// ---------- reference: influence ----------
// What a teardown Reel.md says about the reference, as Studio suggestions. Influence mode turns them into a local
// pack (packs/local/ref-<job>/) with soft transition weights and no locks; the user's own picks become locks on top.
// the scenes a reference's teardown made (its scenes.json), each with whether it is in the menu now
function scenesOf(r, dir) {
  let sc = []; try { sc = JSON.parse(readFileSync(join(dir, 'scenes.json'), 'utf8')).scenes || []; } catch {}
  const used = new Set((r.graphics || []).filter(g => g.type === 'scene').map(g => g.scene));
  return sc.filter(x => x && x.id).map(x => ({ id: x.id, name: x.name, kind: x.kind, inMenu: !!SCN.get(x.id), used: used.has(x.id) }));
}
// what a Recreate draft takes from the recipe besides the Look: the shot plan, framing per shot, cutaways and sounds
function planOf(r) {
  const sh = r.shots || [], fr = [...new Set(sh.map(s => s.framing).filter(Boolean))];
  return { shots: sh.length, framing: fr, cutaways: sh.filter(s => s.cutaway === true || s.cutaway === 'on').length, sounds: (r.sfx || []).length, graphics: (r.graphics || []).length, noBed: !!(r.music && /^none$/i.test(String(r.music.bed || ''))) };
}
export function extract(recipePath) {
  const RM = require('../reelmd.cjs');
  const r = RM.parse(readFileSync(recipePath, 'utf8'));
  const st = r.style || {}, br = r.brand || {}, mu = r.music || {};
  const T = new Set(L.transitionNames());
  const tcount = {};
  const bump = t => { if (t && T.has(t)) tcount[t] = (tcount[t] || 0) + 1; };
  bump(st.transition); for (const sh of r.shots || []) bump(sh.transition);
  const entrances = [...new Set((r.titles || []).map(t => t.entrance).filter(e => R.ENTRANCES.includes(e)))];
  const finishes = [...new Set([st.finish, ...(r.shots || []).map(s => s.finish)].filter(Boolean).flatMap(f => String(f).split(',')).map(x => x.trim()).filter(x => x && x !== 'none'))];
  const graphics = [...new Set((r.graphics || []).map(g => (g.type === 'scene' && g.scene) || g.type || g.graphic || g.id).filter(x => x && x !== 'scene'))];
  const effects = st.effects ? String(st.effects).split(',').map(x => x.trim()).filter(Boolean) : [];
  const cat = catalog();
  const real = (kind, ids) => ids.filter(id => cat.items[`${kind}:${id}`]);
  return {
    summary: summarize(r, recipePath, { transitions: tcount, entrances: real('entrance', entrances), finishes: real('finish', finishes), graphics: real('graphic', graphics), effects: real('effect', effects) }, cat),
    name: (r.card && r.card.name) || basename(dirname(recipePath)), shots: (r.shots || []).length, titles: (r.titles || []).length,
    preset: br.preset && br.preset !== 'none' ? br.preset : null, look: st.look || null, captionStyle: st.captions || null,
    transitions: tcount, entrances: real('entrance', entrances), finishes: real('finish', finishes), graphics: real('graphic', graphics), effects: real('effect', effects),
    // the font read from the words on screen and matched to a pairing we ship (kit/fontmatch.py), or null
    // the breakdown ran with no vision model on the frames (Reel.md Style vision: off): the page says so in one line
    vision: st.vision === 'off' ? 'off' : null,
    // its captions are drawn bare (no outline, or no shadow): the legibility shadow then starts off (boostOf)
    captionPlain: st['caption-outline'] === 'none' || st['caption-shadow'] === 'none',
    font: st['font-match'] && br.fonts && !/^(none|theme)$/i.test(String(br.fonts)) ? { pairing: String(br.fonts).split(',')[0].trim(), kind: st.font || null, face: st['font-face'] || null, match: String(st['font-match']).toLowerCase() } : null,
    music: { bed: mu.bed && !/^(none|auto)$/i.test(mu.bed) ? mu.bed : null, ...(mu.bed === 'none' ? { noBed: true } : {}), energy: mu.energy || null, beatSync: mu['beat-sync'] || null }, punch: st.punch || null,
    ran: ranOf(dirname(recipePath), r),
    // what was made for the menu from it (kit/scenes.cjs), and what Recreate re-cuts and brings: its shot plan, framing, cutaways and sounds
    scenes: scenesOf(r, dirname(recipePath)),
    plan: planOf(r),
    // titles whose text the teardown is not sure it read right (the `check <reason>` field of a title line): every one,
    // for the page to show with a field to fix it before a draft (fixTitleText below)
    checks: (r.titles || []).filter(t => t.check).map(t => ({ n: t.n, at: +t.start || 0, text: t.text === true ? '' : String(t.text || ''), why: t.check === true ? 'the text may be misread' : String(t.check) })),
  };
}
// Fix the text of one title in a reference's Reel.md before a draft: its `text` is rewritten and its `check` field is
// taken off; every other byte of the file stays as it was (line endings too). Saving the same text says it was right.
export function cleanTitleText(text) { return String(text == null ? '' : text).replace(/\s*\|\s*/g, ' / ').replace(/\s+/g, ' ').trim().slice(0, 160); }
export function fixTitleText(recipePath, n, text) {
  const fail = (msg, code) => { throw Object.assign(new Error(msg), { code }); };
  const clean = cleanTitleText(text); if (!clean) fail('Type the text of the title first.', 400);
  const src = readFileSync(recipePath, 'utf8'), open = /^```reel-titles[ \t]*\r?\n/m.exec(src); if (!open) fail('This reference has no titles.', 404);
  const from = open.index + open[0].length, close = /^```/m.exec(src.slice(from)), to = close ? from + close.index : src.length;
  let at = from, done = null;
  while (at < to && !done) {
    const nl = src.indexOf('\n', at), end = nl < 0 || nl >= to ? to : nl, raw = src.slice(at, end), cr = raw.endsWith('\r') ? '\r' : '', line = cr ? raw.slice(0, -1) : raw;
    const m = /^\s*#(\d+)\s/.exec(line);
    if (m && +m[1] === +n) {
      const parts = line.split(/(\s+\|\s+)/), out = [parts[0]]; let had = false; // fields and the separators between them
      for (let i = 1; i < parts.length; i += 2) { const sep = parts[i], f = parts[i + 1] || '';
        if (/^check(\s|$)/.test(f)) continue;
        if (/^text(\s|$)/.test(f)) { out.push(sep, 'text ' + clean); had = true; } else out.push(sep, f); }
      if (!had) out.push(' | ', 'text ' + clean);
      done = { at, end, line: out.join('') + cr };
    }
    at = end + 1;
  }
  if (!done) fail(`This reference has no title ${n}.`, 404);
  const next = src.slice(0, done.at) + done.line + src.slice(done.end);
  if (next !== src) { const tmp = recipePath + '.tmp'; writeFileSync(tmp, next); renameSync(tmp, recipePath); }
  return { n: +n, text: clean, changed: next !== src };
}
// which parts of the breakdown ran, from what the teardown left beside its Reel.md, each with the fix when one did not:
// the full reader (rea-video), the speech, the layers and grade (extras.json, the person mask), the contact sheet, the
// sound effects and the music. The page shows them as one row with fix buttons, never a command.
// A fix is named only when installing it would help. extras.json and the contact sheet are written with or without
// the Effects pass, so when they are missing that step stopped (on 1.27.1, a Windows text encoding fault did it) and
// the answer is to read the reference again, not to install something that is already there. The Effects pass is
// the fix for one thing only: the breakdown ran with no person mask, so front or behind was not read.
const FX_PY = () => join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const effectsInstalled = () => existsSync(FX_PY());
export function ranOf(dir, r = {}, { effects = effectsInstalled() } = {}) {
  const has = f => existsSync(join(dir, f)), rea = has(join('videomd', 'breakdown.json'));
  let speech = (r.script || []).length > 0; if (!speech) { try { speech = !!JSON.parse(readFileSync(join(dir, 'speech.json'), 'utf8')).ok; } catch {} }
  const mu = r.music || {};
  let extras = null; try { extras = JSON.parse(readFileSync(join(dir, 'extras.json'), 'utf8')); } catch {}
  const STOPPED = 'this part stopped before it finished';
  const layers = !extras ? { ok: false, why: has('extras.json') ? 'what it wrote could not be read' : STOPPED, fix: null, again: true }
    : extras.mask === false && !effects ? { ok: false, why: 'front or behind was not read: there is no person mask yet', fix: 'effects' }
    : { ok: true, why: extras.mask === false ? 'vignette and grain; front or behind was not read' : 'front or behind, vignette, grain', fix: null };
  return [
    { id: 'reader', label: 'Full read', ok: rea, why: rea ? 'rea-video read it' : 'the built-in reader was used, it can miss shots and titles', fix: rea ? null : 'rea' },
    { id: 'speech', label: 'Speech', ok: speech, why: speech ? 'its words and timing' : 'no words were read', fix: speech ? null : 'model' },
    { id: 'layers', label: 'Layers and grade', ...layers },
    { id: 'sheet', label: 'Contact sheet', ok: has('contact.jpg'), why: has('contact.jpg') ? 'one frame per shot' : extras ? 'no frames to show' : STOPPED, fix: null, ...(has('contact.jpg') ? {} : { again: true }) },
    { id: 'sounds', label: 'Sound effects', ok: rea, why: (r.sfx || []).length ? `${r.sfx.length} found` : rea ? 'none in it' : 'needs the full read', fix: rea ? null : 'rea' },
    { id: 'music', label: 'Music', ok: !!(mu.bpm || mu.bed) || rea, why: mu.bpm ? `${mu.bpm} BPM` : mu.bed && mu.bed !== 'none' ? mu.bed : 'no music', fix: null },
  ];
}
// The fixes the page may offer for the parts that did not run: only things that are really missing here. A state
// saved by an older Studio can still name a fix for something that is installed; it is dropped. installed: { id: true }.
export function ranFixes(ran, installed = {}) {
  return [...new Set((ran || []).filter(x => !x.ok && x.fix && !installed[x.fix]).map(x => x.fix))];
}
// the teardown as facts a person or a model can act on: cuts and pacing, beats and music energy, caption style, what
// was detected, and suggestions mapped onto the Studio menu (kind:id refs that exist, each with the reason)
export function summarize(r, recipePath, found, cat = catalog()) {
  const shots = r.shots || [], st = r.style || {}, mu = r.music || {}, card = r.card || {};
  const seconds = +((card.source && card.source.duration) || (shots.length ? shots[shots.length - 1].end : 0)) || null;
  const lens = shots.map(x => +(x.end - x.start).toFixed(2)).filter(x => x > 0);
  const avg = lens.length ? +(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(2) : null;
  const pacing = avg == null ? null : avg < 1.5 ? 'very fast' : avg < 2.5 ? 'fast' : avg < 4.5 ? 'medium' : 'slow';
  const bpm = +mu.bpm || null;
  let beats = null; try { const fb = JSON.parse(readFileSync(join(dirname(recipePath), 'fallback.json'), 'utf8')); beats = ((fb.audio || {}).music || {}).beats?.length || null; } catch {}
  const energy = mu.energy || (bpm ? (bpm < 90 ? 'low' : bpm < 118 ? 'mid' : 'high') : null);
  const sugg = [], add = (ref, why) => { if (cat.items[ref] && cat.items[ref].mode !== 'info' && !sugg.some(x => x.ref === ref)) sugg.push({ ref, why }); };
  for (const [t, n] of Object.entries(found.transitions).sort((a, b) => b[1] - a[1])) add(`transition:${t}`, `seen ${n} time${n > 1 ? 's' : ''} between shots`);
  for (const e of found.entrances) add(`entrance:${e}`, 'title entrance in the reference');
  if (st.captions) add(`captionStyle:${st.captions}`, 'caption style of the reference');
  if (st.look) add(`look:${st.look}`, 'caption look of the reference');
  for (const f of found.finishes) add(`finish:${f}`, 'grade on some shots');
  for (const g of found.graphics) { const m = cat.items[`graphic:${g}`] && cat.items[`graphic:${g}`].made; add(`graphic:${g}`, m && m.kind === 'effect' ? 'effect in the reference, made as a scene' : m ? 'seen on screen, made as a scene' : 'graphic seen on screen'); }
  for (const e of found.effects) add(`effect:${e}`, 'effect in the reference');
  if (mu['beat-sync'] === 'on') add('beatSync:beat-sync', `cuts land on the beat${bpm ? ` (${bpm} BPM)` : ''}`);
  if (mu.bed && mu.bed !== 'none') add(`bed:${mu.bed}`, `closest library bed${bpm ? ' by tempo' : ''}`);
  if (avg != null && avg < 2.5) add('editing:tighten', `fast cutting: a shot every ${avg} s`);
  if (st.punch === 'on' || (avg != null && avg < 2)) add('editing:punch', 'zoom punch-ins keep the pace');
  const desc = card.description || '';
  return { seconds, shots: shots.length, cuts: shots.slice(1).map(x => +(+x.start).toFixed(2)), averageShot: avg, pacing,
    music: { bpm, beats, energy, bed: mu.bed && mu.bed !== 'none' ? mu.bed : null, beatSync: mu['beat-sync'] || null },
    captions: { style: st.captions || null, look: st.look || null, position: st['caption-position'] || null, color: st['caption-color'] || null },
    titles: (r.titles || []).map(t => ({ at: +t.start || 0, text: t.text || '', entrance: t.entrance || null })).slice(0, 12),
    detected: { transitions: found.transitions, entrances: found.entrances, finishes: found.finishes, graphics: found.graphics, effects: found.effects, punch: st.punch || null },
    suggestions: sugg, engine: /fallback/.test(desc) ? 'built-in fallback (rougher)' : /rea-video|VIDEO\.md/i.test(desc) ? 'rea-video' : null };
}
// the reference the session uses plus the rest of the queue, short enough for a model's context
export function refContext(s) {
  const r = s.reference || {}, q = r.queue || [];
  const one = x => x && { id: x.id, url: x.url, site: x.site, title: x.title, status: x.status, error: x.error || undefined, summary: x.extracted ? x.extracted.summary : undefined };
  const active = q.find(x => x.id === r.active);
  return { mode: r.mode, active: active ? one(active) : r.extracted ? { id: null, url: r.url, title: r.file, status: r.status, summary: r.extracted.summary } : null,
    others: q.filter(x => x.id !== r.active).map(x => ({ id: x.id, url: x.url, site: x.site, title: x.title, status: x.status })) };
}
// the picks a reference suggests, optionally only some kinds (transition, entrance, captionStyle, ...)
export function referencePicks(ex, kinds = null, cat = catalog()) {
  const picks = {};
  if (!ex) return picks;
  const want = k => !kinds || kinds.includes(k);
  if (want('transition')) for (const t of Object.keys(ex.transitions || {})) picks[`transition:${t}`] = 'allow';
  // never an entrance: the entrances a teardown read are a preference (the recipe's own titles, the reference pack's
  // style.entranceOrder), so a rebuild can still use every entrance. Only an entrance you pick yourself is a lock.
  if (want('finish')) for (const f of ex.finishes || []) picks[`finish:${f}`] = 'allow';
  if (want('graphic')) for (const g of ex.graphics || []) picks[`graphic:${g}`] = 'allow';
  if (want('effect')) for (const e of ex.effects || []) picks[`effect:${e}`] = 'allow';
  if (want('captionStyle') && ex.captionStyle && cat.items[`captionStyle:${ex.captionStyle}`]) picks[`captionStyle:${ex.captionStyle}`] = 'allow';
  if (want('bed') && ex.music && ex.music.bed && cat.items[`bed:${ex.music.bed}`]) picks[`bed:${ex.music.bed}`] = 'allow';
  if (want('beatSync') && ex.music && ex.music.beatSync === 'on' && cat.items['beatSync:beat-sync']) picks['beatSync:beat-sync'] = 'allow';
  return picks;
}

// ---------- the Look a reference sets ----------
// Choosing Recreate or Influence sets the Look for you, and Off (Back to my look) takes it back out.
//   recreate: every layer the reference read: its Look when it is a built-in one, captions, titles, transitions,
//             finishes, graphics, effects, the music bed, beat sync and pace.
//   influence: the same picks as soft defaults, but your Look, music and pace stay yours.
// the parts of a reference Influence can take, each switched on or off on the reference card (reference.parts).
// Recreate takes all of them, and its Look (the pack) too; Influence never sets the pack.
export const REF_PARTS = [
  { id: 'captions', label: 'Captions', kinds: ['captionStyle', 'captionEntrance', 'look'] },
  { id: 'titles', label: 'Titles', kinds: ['entrance', 'titleLayer'] },
  { id: 'transitions', label: 'Transitions', kinds: ['transition'] },
  { id: 'grade', label: 'Grade', kinds: ['finish'] },
  { id: 'effects', label: 'Effects', kinds: ['effect'] },
  { id: 'graphics', label: 'Graphics', kinds: ['graphic'] },
  { id: 'pace', label: 'Pace', kinds: ['editing'] },
  { id: 'sound', label: 'Music and sound', kinds: ['bed', 'beatSync', 'sfx'] },
  { id: 'fonts', label: 'Fonts and theme', kinds: ['font', 'theme'] },
];
export const INFLUENCE_PARTS = { captions: true, titles: true, transitions: true, grade: true, effects: true, graphics: true, pace: false, sound: false, fonts: true };
const partOfKind = k => (REF_PARTS.find(p => p.kinds.includes(k)) || {}).id || null;
// the part a catalog item belongs to: a scene made from a reference counts as an effect or a graphic by what it is
export const partOf = it => (it && it.made && it.made.kind === 'effect' ? 'effects' : it ? partOfKind(it.kind) : null);
export const refParts = r => ({ ...INFLUENCE_PARTS, ...((r && r.parts) || {}) });
export function referenceLook(ex, mode, cat = catalog(), parts = null) {
  if (!ex || !['recreate', 'influence'].includes(mode)) return null;
  const picks = referencePicks(ex, null, cat);
  for (const x of (ex.summary && ex.summary.suggestions) || []) { const it = cat.items[x.ref]; if (it && it.mode !== 'info' && it.kind !== 'entrance') picks[x.ref] = 'allow'; }
  if (mode === 'influence') { const on = { ...INFLUENCE_PARTS, ...(parts || {}) }; for (const r of Object.keys(picks)) { const part = partOf(cat.items[r]); if (part && on[part] === false) delete picks[r]; } }
  for (const r of Object.keys(picks)) if (!cat.items[r] || cat.items[r].mode === 'info') delete picks[r];
  const out = { picks };
  if (mode === 'recreate' && ex.preset && cat.packs.some(x => x.name === ex.preset)) out.pack = ex.preset;
  // a reference with no music bed (its music stem -37 dB or quieter): Recreate, or Influence with sound on, plays none
  if (ex.music && ex.music.noBed && (mode === 'recreate' || { ...INFLUENCE_PARTS, ...(parts || {}) }.sound)) out.music = { bed: 'none' };
  return out;
}
const allowedRefs = s => new Set([...Object.entries(s.picks || {}).flatMap(([k, v]) => ((v && v.allow) || []).map(id => `${k}:${id}`)), ...(s.music && s.music.bed ? [`bed:${s.music.bed}`] : [])]);
// takes out what the reference set (reference.added, reference.prev), keeping anything you changed since. Returns how many picks went.
export function undoReferenceLook(s) {
  const r = s.reference || {}, added = r.added || [], prev = r.prev || {}, auto = r.auto || null; let n = 0;
  for (const ref of added) { const i = ref.indexOf(':'), k = ref.slice(0, i), id = ref.slice(i + 1); if (k === 'bed') continue;
    const pk = s.picks[k]; if (pk && pk.allow.includes(id)) { pk.allow = pk.allow.filter(y => y !== id); n++; } }
  for (const [k, ids] of Object.entries(prev.one || {})) { const pk = s.picks[k] || (s.picks[k] = { allow: [], deny: [] }); if (!pk.allow.length) pk.allow = ids.filter(id => !pk.deny.includes(id)); }
  if ('pack' in prev && (!auto || s.pack === auto.pack)) s.pack = prev.pack;
  if ('bed' in prev && (!auto || s.music.bed === auto.bed)) s.music = { ...s.music, bed: prev.bed };
  r.added = []; r.prev = null; r.auto = null;
  return n;
}
// ---------- the font and a reference ----------
// Recreate and Copy the look copy the reference's style, and its font is part of that. A font you picked before the
// reference (in the video before this one, or earlier in this one) never goes over it: when a reference whose style we
// copy comes into use, the old font pick is cleared (kept aside for Back to my look) and nothing is locked. A font you
// pick after that is yours and holds (state.fontLock), until the next reference or the next video.
export const copiesStyle = r => !!r && ['recreate', 'look'].includes(r.mode) && !!(r.extracted || r.out);
const refKey = r => (r && (r.out || r.active || r.url || r.file)) || null;
// a reference you chose to copy that is still being read: what you pick while you wait is already yours
const pendingRef = r => !!r && ['recreate', 'look'].includes(r.mode) && !(r.extracted || r.out) && (r.status === 'running' || (r.queue || []).some(x => ['queued', 'downloading', 'tearing'].includes(x.status)));
export const styleKey = r => (copiesStyle(r) ? refKey(r) : pendingRef(r) ? 'pending' : null);
export function clearFontPick(s) { const had = ((s.picks && s.picks.font && s.picks.font.allow) || []).slice(); if (s.picks && s.picks.font) delete s.picks.font; s.fontLock = false; return had; }
export function syncRefFont(s) {
  const r = s.reference; if (!r) return;
  const key = styleKey(r);
  if (key && r.fontFor !== key) {
    if (r.fontFor === 'pending' && key !== 'pending') r.fontFor = key; // the reference you were waiting for is ready: nothing more to clear
    else { const had = clearFontPick(s); if (had.length && !r.prevFont) r.prevFont = had; r.fontFor = key; }
  }
  else if (!key && r.fontFor) { // back to your own look (Off, Influence, or the reference is gone): your earlier font comes back
    if (r.prevFont && !((s.picks.font && s.picks.font.allow) || []).length) s.picks.font = { allow: r.prevFont.slice(), deny: [] };
    r.prevFont = null; r.fontFor = null; s.fontLock = false;
  }
  syncRefLook(s);
}
// ---------- the rest of the look and a reference ----------
// The same rule as the font, for everything else a draft reads from the board: the Look (pack), every pick (caption
// style, look, theme, title entrances and layer, transitions, finishes, graphics, effects, editing), the music bed and
// energy, sounds and pace. When a reference whose style we copy comes into use, what was on the board before it (from
// the video before this one, or earlier in this one) is set aside (reference.prevLook, for Back to my look) and the
// board starts from the reference alone. What you pick after that is yours and holds. A new reference clears again.
const cloneOf = x => JSON.parse(JSON.stringify(x));
const LOOK_DEFAULT = () => ({ pack: null, music: { bed: 'auto', energy: 'auto' }, sound: { sfx: 'on', cap: 'on' }, pace: { tighten: null, punch: 'on' } });
const slotOn = v => !!v && (((v.allow || []).length + (v.deny || []).length) > 0);
const plainMusic = m => !m || ((m.bed || 'auto') === 'auto' && (m.energy || 'auto') === 'auto');
const plainSound = x => !x || ((x.sfx || 'on') === 'on' && (x.cap || 'on') === 'on');
const plainPace = x => !x || (x.tighten == null && (x.punch || 'on') === 'on');
// takes every look setting but the font off the board (the font has its own rule above). Returns what was there.
export function clearLookPicks(s) {
  const d = LOOK_DEFAULT(), font = s.picks && s.picks.font, picks = Object.fromEntries(Object.entries(s.picks || {}).filter(([k, v]) => k !== 'font' && slotOn(v)));
  const had = cloneOf({ pack: s.pack || null, picks, music: s.music || d.music, sound: s.sound || d.sound, pace: s.pace || d.pace, ...(s.boost ? { boost: s.boost } : {}) });
  delete s.boost; // the hard-to-read words switch is part of the look too
  s.pack = null; s.picks = font ? { font } : {}; s.entranceLock = false;
  s.music = { ...(s.music || {}), ...d.music }; // a music file you added stays in the list, it is just not the bed
  s.sound = d.sound;
  s.pace = { ...d.pace, ...(s.pace && s.pace.keepPauses ? { keepPauses: s.pace.keepPauses } : {}) };
  return had;
}
const hadLook = h => !!h && (!!h.pack || Object.keys(h.picks || {}).length > 0 || !plainMusic(h.music) || !plainSound(h.sound) || !plainPace(h.pace) || !!h.boost || !!(h.pace && h.pace.motion));
// B-roll ideas we made ourselves belong to the draft and the reference they were made for: a new draft or another
// reference drops the ones still waiting (their search words came from the older cut or the older reference). Ideas
// your agent or you added stay, and so does every clip already placed. Returns how many went.
export function dropAutoIdeas(s, { onlyRef = false } = {}) {
  const j = s.job && s.broll && s.broll[s.job]; if (!j || !j.ideas) return 0; let n = 0;
  for (const [k, x] of Object.entries(j.ideas)) { const auto = !x || !x.by || x.by === 'Studio' || x.by === 'the rules'; if (x && x.source === 'reference' ? true : !onlyRef && auto) { delete j.ideas[k]; n++; } }
  return n;
}
// what the reference set aside comes back where you have nothing now (Back to my look, and Keep my look on New video)
function restoreLook(s, h) {
  if (!h) return;
  s.picks = s.picks || {};
  if (!s.pack && h.pack) s.pack = h.pack;
  for (const [k, v] of Object.entries(h.picks || {})) if (!slotOn(s.picks[k])) s.picks[k] = cloneOf(v);
  s.entranceLock = slotOn(s.picks.entrance); // entrances that come back are your own picks: a lock
  if (plainMusic(s.music) && !plainMusic(h.music)) s.music = { ...s.music, bed: h.music.bed, energy: h.music.energy || 'auto' };
  if (plainSound(s.sound) && !plainSound(h.sound)) s.sound = { ...s.sound, ...h.sound };
  if (!s.boost && h.boost) s.boost = h.boost;
  if (plainPace(s.pace) && !plainPace(h.pace)) s.pace = { ...s.pace, tighten: h.pace.tighten == null ? null : h.pace.tighten, punch: h.pace.punch || 'on' };
  if (!(s.pace && s.pace.motion) && h.pace && h.pace.motion) s.pace = { ...s.pace, motion: h.pace.motion };
}
// Keep my look on New video (1.29.0): the look you take into the next video is yours, not the reference's. A copy of
// the board with what the reference set taken out (your changes since stay) and the look it set aside put back.
// The board itself is not changed.
export function ownLook(s) {
  const r = s.reference; if (!r || r.mode === 'off' && !r.prevLook) return s;
  const c = cloneOf(s);
  if (r.mode !== 'off') undoReferenceLook(c);
  restoreLook(c, c.reference.prevLook);
  return c;
}
export function syncRefLook(s) {
  const r = s.reference; if (!r) return;
  const key = styleKey(r);
  if (key && key !== 'pending') r.copyMode = r.mode;
  if (key && r.lookFor !== key) {
    if (r.lookFor === 'pending' && key !== 'pending') { r.lookFor = key; return; }
    const had = clearLookPicks(s); if (!r.prevLook && hadLook(had)) r.prevLook = had;
    r.lookFor = key; dropAutoIdeas(s, { onlyRef: true });
  } else if (!key && r.lookFor) { // back to your own look: what the reference set aside comes back where you have nothing now
    restoreLook(s, r.prevLook);
    r.prevLook = null; r.lookFor = null; dropAutoIdeas(s, { onlyRef: true });
  }
}
// ---------- whose look is in use, and the one switch ----------
// The reference wins by default (above), so the page has one line for the times it does not: "Your saved look is in
// use, not the reference's", with one button, Use the reference's look. An earlier look wins when the reference is Off
// (Back to my look, with a saved look, a Look or picks on the board) and in Influence (your Look and your own picks are
// the base, the reference goes on top). In Recreate and Copy the look nothing earlier is left, so the line never shows;
// what you picked after the reference is yours, listed in `yours` for the agent.
// null when no reference is broken down, else { inUse, by: [{ ref, kind, id, deny, label }], text, mode, name, yours }
export const SAVED_LOOK_TEXT = "Your saved look is in use, not the reference's";
// in Influence the reference does go on top, so the line says that instead of "not the reference's"
export const SAVED_LOOK_BASE_TEXT = "Your saved look is the base, with the reference on top";
const PART_KEYS = ['captions', 'titles', 'transitions', 'grade', 'effects', 'graphics', 'pace', 'sound', 'fonts', 'look'];
const KIND_WORD = { captionStyle: 'caption style', captionEntrance: 'caption entrance', look: 'caption look', theme: 'theme', titleLayer: 'title layer', entrance: 'title entrance', transition: 'transition', finish: 'finish', font: 'font', effect: 'effect', graphic: 'graphic', editing: 'editing' };
export function ownParts(s, cat = catalog()) {
  const r = s.reference || {}, added = new Set(r.added || []), out = new Set();
  for (const [k, v] of Object.entries(s.picks || {})) {
    if (k === 'font') continue;
    const mine = (v.deny || []).length > 0 || (v.allow || []).some(id => !added.has(`${k}:${id}`)); if (!mine) continue;
    const it = Object.values(cat.items).find(x => (x.kind === 'editing' ? 'editing' : x.kind) === k);
    out.add(k === 'editing' ? 'pace' : partOf(it) || 'look');
  }
  if (s.fontLock) out.add('fonts');
  if ((s.pack || null) !== ((r.auto && r.auto.pack) || null)) out.add('look');
  const m = s.music || {}; if ((m.bed || 'auto') !== ((r.auto && r.auto.bed) || 'auto') || (m.energy || 'auto') !== 'auto' || !plainSound(s.sound)) out.add('sound');
  if (!plainPace(s.pace)) out.add('pace');
  return PART_KEYS.filter(k => out.has(k));
}
// the earlier look on the board: the Look, a saved style look (only with the reference Off: a reference in use wins
// over it) and every pick the reference did not set
function earlierLook(s, cat) {
  const r = s.reference, off = r.mode === 'off', added = new Set(off ? [] : r.added || []), by = [];
  if (s.pack) by.push({ ref: `pack:${s.pack}`, kind: 'pack', id: s.pack, deny: false, label: `Look ${s.pack}` });
  if (off && s.styleLook) by.push({ ref: `styleLook:${s.styleLook}`, kind: 'styleLook', id: s.styleLook, deny: false, label: `saved look ${s.styleLook}` });
  for (const [kind, v] of Object.entries(s.picks || {})) for (const deny of [false, true]) for (const id of (deny ? v.deny : v.allow) || []) {
    const ref = `${kind}:${id}`; if ((!deny && added.has(ref)) || !cat.items[ref]) continue;
    by.push({ ref, kind, id, deny, label: `${deny ? 'no ' : ''}${KIND_WORD[kind] || kind} ${id}` }); }
  return by;
}
export function savedLookOf(s, cat = catalog()) {
  const r = s.reference; if (!r || !r.extracted) return null;
  const copies = copiesStyle(r), by = copies ? [] : earlierLook(s, cat);
  return { inUse: by.length > 0, by, text: by.length ? (r.mode === 'influence' ? SAVED_LOOK_BASE_TEXT : SAVED_LOOK_TEXT) : null, mode: r.mode, name: copies ? null : (r.mode === 'off' && s.styleLook) || s.pack || null, yours: copies ? ownParts(s, cat) : [] };
}
// the one button: the board is set from the reference alone. With the reference Off or on Influence it comes on in the
// mode you last copied it with (else Copy the look, so your own cut stays), and your earlier look is set aside; in
// Recreate or Copy the look your own picks since go. Returns reference.auto, or null when no reference is broken down.
export function useReferenceLook(s, cat = catalog()) {
  const r = s.reference; if (!r || !r.extracted) return null;
  if (!['recreate', 'look'].includes(r.mode)) r.mode = ['recreate', 'look'].includes(r.copyMode) ? r.copyMode : 'look';
  r.lookFor = null; r.fontFor = null; r.auto = null;
  return setReferenceLook(s, cat);
}
// what the page says on the Fonts layer: whose font the next draft uses when a reference's style is being copied
export function refFontOf(s, lookFont = null) {
  const r = s.reference, ref = copiesStyle(r), look = !ref && !!s.styleLook; if (!ref && !look) return null;
  const f = ref ? (r.extracted && r.extracted.font) || null : lookFont;
  return { from: ref ? 'reference' : 'look', locked: !!s.fontLock, font: f };
}

// ---------- entrances and a reference ----------
// A session saved before this rule holds the reference's entrances as allow picks (entrance:slam = allow, ...), and
// those became locks.titles, so a rebuild could use only the entrances the teardown happened to read. When the picks
// are exactly the reference's entrances and you have not picked an entrance yourself since (state.entranceLock), they
// are the reference's, not yours: never a lock, and load() takes them off the page.
export function refEntrancesOnly(s) {
  const r = s.reference, ex = r && r.mode !== 'off' ? r.extracted : null, p = s.picks && s.picks.entrance;
  if (!ex || !p || s.entranceLock || (p.deny || []).length) return false;
  const a = p.allow || [], b = ex.entrances || [];
  return a.length > 0 && a.length === b.length && a.every(x => b.includes(x));
}
export function dropRefEntrances(s) {
  if (!refEntrancesOnly(s)) return false;
  delete s.picks.entrance; if (s.reference.added) s.reference.added = s.reference.added.filter(x => !x.startsWith('entrance:'));
  return true;
}
// "Make hard-to-read words easier to read" (Text and graphics): the soft shadow the build puts behind a caption word
// that reads under 3:1. It changes the look, so it is a choice: yours when you set it (state.boost on or off), else on,
// unless the reference whose style we copy draws its captions with no outline or no shadow. Off sends --no-boost.
export function boostOf(s) {
  if (s.boost === 'on' || s.boost === 'off') return { on: s.boost === 'on', by: 'you' };
  const r = s.reference, plain = copiesStyle(r) && !!(r.extracted && r.extracted.captionPlain);
  return { on: !plain, by: plain ? 'reference' : 'default' };
}

// sets the Look from the reference for its mode, after taking out what an earlier mode or reference set.
// Returns { mode, n, pack, bed, at } (reference.auto, what the page's notice reads) or null when nothing was set.
export function setReferenceLook(s, cat = catalog()) {
  const r = s.reference; if (!r) return null;
  if ((r.added && r.added.length) || r.prev || r.auto) undoReferenceLook(s);
  syncRefFont(s); // the font and the rest of the look: what was on the board before this reference is set aside
  const p = referenceLook(r.extracted, r.mode, cat, r.parts); if (!p) return null;
  const had = allowedRefs(s), prev = { one: {} };
  for (const ref of Object.keys(p.picks)) { const it = cat.items[ref]; if (it.kind !== 'bed' && it.mode === 'one') { const k = it.kind === 'editing' ? 'editing' : it.kind; prev.one[k] = ((s.picks[k] && s.picks[k].allow) || []).slice(); } }
  if (p.pack !== undefined) prev.pack = s.pack || null;
  if (Object.keys(p.picks).some(x => x.startsWith('bed:')) || p.music) prev.bed = s.music.bed;
  applyPatch(s, p, cat, { nested: true });
  const now = allowedRefs(s);
  r.added = Object.keys(p.picks).filter(x => !had.has(x) && now.has(x));
  r.prev = prev; r.applied = true;
  r.auto = { mode: r.mode, n: r.added.length + (p.pack && p.pack !== prev.pack ? 1 : 0), pack: s.pack || null, bed: s.music.bed, sound: r.mode === 'recreate' || !!refParts(r).sound, at: Date.now() };
  return r.auto;
}

export function influencePack(ex, job, basePack, parts = null) {
  const base = basePack ? K.load(basePack) : null;
  const presets = require('../preset.cjs').list().map(x => x.name);
  const ext = base ? base.extends : ex.preset && presets.includes(ex.preset) ? ex.preset : 'aigent';
  const style = { ...(base ? base.style || {} : {}) }, bl = (base && base.locks) || {};
  const inLock = (key, v) => !bl[key] || bl[key].includes(v);
  if (ex.look) style.look = ex.look;
  if (ex.captionStyle) style.captionStyle = ex.captionStyle;
  // the entrances the teardown read, in its order: a preference, never a lock (Titles switched off leaves them out)
  const ents = parts && parts.titles === false ? [] : ex.entrances.filter(e => inLock('titles', e)); if (ents.length) style.entranceOrder = ents;
  const fins = ex.finishes.filter(f => inLock('finishes', f)); if (fins.length) style.finishPool = fins;
  const weights = { ...((base && base.weights && base.weights.transitions) || {}) };
  for (const [t, n] of Object.entries(ex.transitions)) if (inLock('transitions', t)) weights[t] = (weights[t] || 1) + n;
  const top = Object.entries(ex.transitions).filter(([t]) => inLock('transitions', t)).sort((a, b) => b[1] - a[1])[0];
  if (top) style.transition = top[0];
  if (ex.effects.length) style.effectsFavourites = ex.effects;
  if (bl.transitions && Object.keys(weights).length) for (const t of bl.transitions) if (!weights[t]) weights[t] = 1;
  return { format: 'aigent-style-pack', formatVersion: 1, name: `ref-${job}`.slice(0, 48), version: '0.1.0', label: `Influenced by ${ex.name}`,
    description: `Made by Studio from the reference teardown ${ex.name}: its look as soft defaults${base ? ' on top of the ' + base.name + ' pack (its locks kept)' : ', no locks'}.`, author: 'Studio', license: 'Apache-2.0', extends: ext,
    style, locks: base ? base.locks || {} : {}, ...(Object.keys(weights).length && bl.transitions ? { weights: { transitions: weights } } : {}) };
}

// Recreate drafts with the reference's own recipe instead of a pack: its Reel.md when the teardown left one
export const recreateRecipe = (s, root) => s.reference && s.reference.mode === 'recreate' && s.reference.out && existsSync(join(root, s.reference.out, 'Reel.md')) ? join(s.reference.out, 'Reel.md') : null;
// the reel arguments for it: no pack (the recipe names its own), the recipe, and --recut to its shot plan
export function recreateArgs(args, recipe) { const i = args.indexOf('--pack'); if (i >= 0) args.splice(i, 2); args.push('--recipe', recipe, '--recut'); return args; }
