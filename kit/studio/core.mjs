// Studio core: the catalog Studio shows, the session state it shares with the MCP tools, and how a session becomes the
// same npm run reel arguments you could type yourself. No network, no keys; the server (kit/studio/server.mjs) and the
// MCP server (kit/mcp.mjs) both use this file, so the UI and an assistant always see and edit the same thing.
//   state file: jobs/.studio/state.json (or STUDIO_DIR); the server watches it and pushes changes to the page.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadMenu } from '../menu.mjs';
import * as CF from './conflicts.mjs';
import * as SLK from './stylelooks.mjs';
import { cleanPoint } from './point.mjs';
import { failView } from './stages.mjs';

const require = createRequire(import.meta.url);
export const STUDIO = dirname(fileURLToPath(import.meta.url));
export const KIT = dirname(STUDIO), ROOT = dirname(KIT);
const L = require('../locks.cjs');
const K = require('../packs.cjs');
const R = require('../rules.cjs');
const SCN = require('../scenes.cjs');

// ---------- catalog ----------
// how a click on a tile of each engine kind is used. multi: allow or forbid many. one: pick one. toggle: on or off.
// info: shown with its flag so you can see it, set elsewhere (the Music and pace panel, the choices table).
export const KIND_MODE = {
  transition: 'multi', entrance: 'multi', graphic: 'multi', finish: 'multi', effect: 'multi', font: 'multi',
  captionEntrance: 'one', captionStyle: 'one', look: 'one', theme: 'one', titleLayer: 'one', bed: 'one', beatSync: 'one',
};
const EDIT_TOGGLES = ['punch', 'tighten', 'cards-auto', 'colour-card', 'chapter-card', 'sfx-cap', 'sfx-map'];
const ANIMATED = { transition: 'transitions', entrance: 'titles', captionEntrance: 'caption-entrances', captionStyle: 'caption-styles' };
const STILL = { transition: 'transition', effect: 'effect', graphic: 'graphic', finish: 'finish', entrance: 'entrance', captionStyle: 'caption', look: 'look', titleLayer: 'titleLayer', theme: 'theme', beatSync: 'beatSync', bed: 'bed', sfx: 'sfx', font: 'font', preset: 'preset' };
const rel = p => relative(ROOT, p).split('\\').join('/');

export function modeOf(it) {
  if (it.kind === 'editing') return EDIT_TOGGLES.includes(it.id) ? 'toggle' : 'info';
  if (it.kind === 'beatSync') return it.id === 'beatWindow' ? 'info' : 'one';
  return KIND_MODE[it.kind] || 'info';
}
function previewOf(it) {
  const a = ANIMATED[it.kind] && join(ROOT, 'docs', 'menu', ANIMATED[it.kind], it.id + '.webp');
  const st = STILL[it.kind] && join(ROOT, 'showcase', 'media', STILL[it.kind], it.id + '.jpg');
  const still = st && existsSync(st) ? rel(st) : null;
  if (a && existsSync(a)) return { src: rel(a), animated: true, still };
  if (still) return { src: still, animated: false, still };
  return null;
}
// The 9 layers of the Look step (categories.json layers): the tabs regrouped so every option lives in exactly one
// layer. A layer is a list of groups (a tab, optionally only some kinds); layerOrder says which layer claims an option
// first, owners moves one to a named layer, hidden drops a duplicate name. An option that lands nowhere is an error.
export function layersOf(map, categories, items, errs = []) {
  const L = map.layers || [], byCat = Object.fromEntries(categories.map(c => [c.id, c])), hidden = new Set(map.hidden || []), owners = map.owners || {};
  const ids = new Set(L.map(l => l.id)), order = (map.layerOrder || L.map(l => l.id)).filter(id => ids.has(id)).concat(L.map(l => l.id).filter(id => !(map.layerOrder || []).includes(id)));
  for (const [r, l] of Object.entries(owners)) { if (!items[r]) errs.push(`owners: no option ${r}`); if (!ids.has(l)) errs.push(`owners: ${r} names no layer ${l}`); }
  for (const r of hidden) if (!items[r]) errs.push(`hidden: no option ${r}`);
  const at = {}, out = Object.fromEntries(L.map(l => [l.id, { id: l.id, label: l.label, hint: l.hint || '', groups: (l.groups || []).map(g => ({ id: g.cat, label: g.label || (byCat[g.cat] || {}).label || g.cat, items: [] })) }]));
  for (const lid of order) { const l = L.find(x => x.id === lid);
    (l.groups || []).forEach((g, gi) => { const c = byCat[g.cat]; if (!c) { errs.push(`layer ${lid}: no tab ${g.cat}`); return; }
      for (const r of c.items) { const it = items[r]; if (at[r] || hidden.has(r)) continue; if (g.kinds && !g.kinds.includes(it.kind)) continue; if (g.notKinds && g.notKinds.includes(it.kind)) continue;
        if (owners[r] && owners[r] !== lid) continue; at[r] = lid; out[lid].groups[gi].items.push(r); } }); }
  if (L.length) for (const c of categories) for (const r of c.items) if (!at[r] && !hidden.has(r)) errs.push(`${r} (tab ${c.id}) is in no layer`);
  return L.map(l => { const x = out[l.id]; x.groups = x.groups.filter(g => g.items.length); x.items = x.groups.flatMap(g => g.items); x.count = x.items.length; return x; });
}
let cached = null, cachedScenes = null;
// the scenes made from references or by your agent (kit/scenes.cjs): REF items in the Graphics and Colour layers
const sceneSig = () => { try { return readdirSync(SCN.dir()).filter(f => f.endsWith('.json')).sort().join(',') + '|' + statSync(SCN.dir()).mtimeMs; } catch { return ''; } };
export const sceneStillUrl = id => `/api/scenes/${encodeURIComponent(id)}/still.png`;
function addScenes(c) {
  const sc = SCN.list(); if (!sc.length) return { ...c, scenesSig: '' };
  const items = { ...c.items }, refs = { graphic: [], effect: [] };
  for (const x of sc) { const ref = `graphic:${x.id}`;
    items[ref] = { ref, kind: 'graphic', id: x.id, section: 'scenes', label: `${x.name}. Made ${x.by === 'agent' ? 'by your agent' : 'from ' + (x.from && x.from.reference ? x.from.reference : 'a reference')} as HTML and CSS, kept for every job.`, flag: null, mode: 'multi',
      preview: { url: sceneStillUrl(x.id), src: null, animated: false }, made: { by: x.by || 'reference', from: (x.from && x.from.reference) || null, kind: x.kind, name: x.name } };
    refs[x.kind === 'effect' ? 'effect' : 'graphic'].push(ref); }
  const group = (lid, list) => ({ id: 'ref-made', label: 'Made from your references', items: list });
  const layers = c.layers.map(l => { const add = l.id === 'graphics' ? refs.graphic : l.id === 'color' ? refs.effect : []; if (!add.length) return l; const groups = [group(l.id, add), ...l.groups]; return { ...l, groups, items: groups.flatMap(g => g.items), count: groups.reduce((a, g) => a + g.items.length, 0) }; });
  const categories = [...c.categories, { id: 'ref-made', label: 'Made from your references', hint: 'Effects and graphics a reference had that the menu did not, made as scenes', items: [...refs.graphic, ...refs.effect], count: sc.length }];
  return { ...c, items, layers, categories, scenesSig: sc.map(x => x.id).join(',') };
}
export function catalog({ fresh = false } = {}) {
  const sig = sceneSig();
  if (cached && !fresh) { if (cachedScenes && cachedScenes.sig === sig) return cachedScenes.c; cachedScenes = { sig, c: addScenes(cached) }; return cachedScenes.c; }
  const menu = loadMenu(), fxcat = JSON.parse(readFileSync(join(ROOT, 'effects', 'catalog.json'), 'utf8'));
  const fxBy = Object.fromEntries(fxcat.effects.map(e => [e.name, e]));
  const map = JSON.parse(readFileSync(join(STUDIO, 'categories.json'), 'utf8'));
  const bySection = {};
  for (const it of menu.items) (bySection[it.section] = bySection[it.section] || []).push(it);
  const items = {}, errs = [];
  const add = it => {
    const ref = `${it.kind}:${it.id}`;
    if (!items[ref]) {
      const fx = it.kind === 'effect' ? fxBy[it.id] : null;
      items[ref] = { ref, kind: it.kind, id: it.id, section: it.section, label: it.label, flag: it.flag, mode: modeOf(it), preview: previewOf(it),
        ...(fx ? { camera: !!fx.camera, energy: fx.energy, moments: fx.moments, needsCopy: !!(fx.required && fx.required.length) || !!fx.needsCustomText } : {}),
        ...(it.energy && !fx ? { energy: it.energy } : {}) };
    }
    return ref;
  };
  const categories = map.categories.map(c => {
    const refs = [];
    for (const inc of c.include) {
      const pool = bySection[inc.section];
      if (!pool) { errs.push(`${c.id}: no menu section "${inc.section}"`); continue; }
      let pick = pool;
      if (inc.ids) { pick = []; for (const id of inc.ids) { const f = pool.find(x => x.id === id); if (f) pick.push(f); else errs.push(`${c.id}: section ${inc.section} has no "${id}"`); } }
      if (inc.where) pick = pick.filter(x => Object.entries(inc.where).every(([k, v]) => x.kind === 'effect' && fxBy[x.id] && fxBy[x.id][k] === v));
      for (const it of pick) { const r = add(it); if (!refs.includes(r)) refs.push(r); }
    }
    return { id: c.id, label: c.label, hint: c.hint, items: refs, count: refs.length };
  });
  const layers = layersOf(map, categories, items, errs);
  // sets: what the pack's base preset decides that other options depend on (kit/studio/conflicts.mjs)
  const setsOf = p => { try { const st = K.toPreset(p); return Object.fromEntries(['look', 'captionStyle', 'titles'].filter(k => st[k] !== undefined).map(k => [k, st[k]])); } catch { return {}; } };
  const packs = K.list().map(p => ({ name: p.name, label: p.label, description: p.description, version: p.version, shipped: !!p.shipped, locks: L.describe(p.locks || {}), sets: setsOf(p),
    preview: p.dir && existsSync(join(p.dir, 'preview.webp')) ? rel(join(p.dir, 'preview.webp')) : null }));
  const beds = JSON.parse(readFileSync(join(KIT, 'music', 'beds.json'), 'utf8'));
  cached = { categories, layers, items, packs, candidates: map.candidates || [], beds: Object.entries(beds).map(([id, b]) => ({ id, title: b.title, seconds: b.seconds, energy: b.energy, file: rel(join(KIT, 'music', b.file)) })),
    exports: menu.items.filter(i => i.section === 'exports').map(i => i.id), errs };
  cachedScenes = { sig, c: addScenes(cached) };
  return cachedScenes.c;
}

// ---------- state ----------
export const stateDir = () => resolve(process.env.STUDIO_DIR || join(ROOT, 'jobs', '.studio'));
export const statePath = () => join(stateDir(), 'state.json');
export function defaultState() {
  return { format: 'aigent-studio', version: 1, rev: 0, job: null, footage: [], clips: null,
    reference: { file: null, url: null, mode: 'influence', status: 'none', out: null, extracted: null, applied: false, queue: [], active: null },
    pack: null, picks: {}, music: { bed: 'auto', energy: 'auto', upload: null }, sound: { sfx: 'on', cap: 'on' }, pace: { tighten: null, punch: 'on' },
    export: 'reels', chat: [], task: null, outputs: [], takes: [], output: null, cut: null, tx: {}, lines: {}, broll: {},
    finish: { from: 'auto', reel: true, clips: false, plain: false }, drafted: null, styleLook: null, point: '' };
}
export function load() {
  try { const s = JSON.parse(readFileSync(statePath(), 'utf8')); return oneBed({ ...defaultState(), ...s, reference: { ...defaultState().reference, ...(s.reference || {}) } }); }
  catch { return defaultState(); }
}
// one place decides the music bed: music.bed. An older session kept a bed pick in picks.bed as well (a reference's bed),
// which the draft used while the music panel showed music.bed; the pick (what the draft used) moves into music.bed.
function oneBed(s) {
  const pb = s.picks && s.picks.bed;
  if (pb) { if (pb.allow && pb.allow[0]) s.music = { ...s.music, bed: pb.allow[0] }; delete s.picks.bed; }
  return s;
}
export function save(s) {
  mkdirSync(stateDir(), { recursive: true });
  s.rev = (s.rev || 0) + 1; s.updated = new Date().toISOString();
  if (s.chat.length > 200) s.chat = s.chat.slice(-200);
  const tmp = statePath() + '.tmp'; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, statePath());
  return s;
}

const JOB_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const ENERGY = ['auto', 'low', 'mid', 'high'];
// a change from the page, the chat or an assistant. Refuses names the engine does not have.
//   { job, pack, picks: { "transition:whip": "allow" | "deny" | "clear" }, clearPicks: true, music: { bed, energy },
//     styleLook: "<a saved style look>" | null (Copy the look, kit/studio/stylelooks.mjs),
//     point: "what the video is for, one line" | "" (kit/studio/point.mjs),
//     sound: { sfx: on|off, cap: on|off }, pace: { tighten: null|number, punch: on|off }, export, reference: { mode },
//     say: "user chat line", reply: "assistant chat line", from: "ui" | "assistant" | "chat",
//     footage: [paths from state.footage, in the order to use; leave one out to drop it], clips: "<clip.py folder>" | null,
//     asIs: true | false (the footage is already cut: one clip per file), glossary: [{ say, heard, after? }] | "heard = say; ...",
//     brands: [{ word, logo }] (logo: a file added in Studio or the kit's kit/example/skool-logo.svg) }
// Returns { errs, log, noop }: noop is true when the patch asked for a change and nothing changed, so a caller can say so
// instead of reporting success.
const CHAT_KEYS = ['say', 'reply', 'from', 'toAgent', 'replyTo', 'kind', 'attach'];
const slash = x => String(x).replace(/\\/g, '/').replace(/^\.\//, '');
export const brandsDir = () => join(stateDir(), 'brands');
export const KIT_BRANDS = ['kit/example/skool-logo.svg'];
// Settings that rule out others (kit/studio/conflicts.mjs): after the change, a pick it ruled out is turned off and
// s.lastChange says so ("Single word captions turned off the Typewriter caption entrance.") with { undoChange: true }
// to put it back; a ruled out pick the same patch asked for is refused with the reason. switchFor: "kind:id" picks it
// and makes the one change it needs (the page's one click switch on a greyed option).
const SETTLE_KEYS = ['pack', 'picks', 'clearPicks', 'music', 'sound', 'pace', 'reference', 'switchFor'];
const lookSnap = s => JSON.parse(JSON.stringify({ pack: s.pack || null, picks: s.picks || {}, music: s.music, sound: s.sound, pace: s.pace,
  reference: s.reference ? { mode: s.reference.mode, added: s.reference.added, prev: s.reference.prev, auto: s.reference.auto, applied: s.reference.applied } : null }));
export const effectsReady = () => existsSync(join(ROOT, 'effects', '.venv'));
export function applyPatch(s, p, cat = catalog(), { nested = false } = {}) {
  const errs = [], log = [];
  if (!p || typeof p !== 'object') return { errs: ['patch must be an object'], log, noop: false };
  const known = ['job', 'pack', 'picks', 'clearPicks', 'music', 'sound', 'pace', 'export', 'reference', 'say', 'reply', 'from', 'footage', 'clips', 'toAgent', 'replyTo', 'kind', 'attach', 'asIs', 'glossary', 'brands', 'finish', 'switchFor', 'undoChange', 'styleLook', 'point'];
  for (const k of Object.keys(p)) if (!known.includes(k)) errs.push(`unknown field "${k}" (${known.join(', ')})`);
  if (p.undoChange) {
    const u = s.lastChange && s.lastChange.undo; if (!u) { errs.push('undoChange: nothing to undo'); return { errs, log, noop: false }; }
    Object.assign(s, { pack: u.pack, picks: u.picks, music: u.music, sound: u.sound, pace: u.pace }); if (u.reference && s.reference) Object.assign(s.reference, u.reference);
    delete s.lastChange; log.push('undid the last change'); return { errs, log, noop: false };
  }
  const touches = !nested && SETTLE_KEYS.some(k => p[k] !== undefined), before = touches ? lookSnap(s) : null;
  let switched = '';
  if (p.switchFor !== undefined) {
    const it = cat.items[p.switchFor];
    if (!it || it.mode === 'info') errs.push(`switchFor: no option "${p.switchFor}" to pick`);
    else { const ctx = CF.contextOf(s, cat), sp = CF.switchPatch(it, ctx) || { picks: { [it.ref]: 'allow' } }; switched = CF.switchText(it, ctx);
      p = { ...p, ...sp, picks: { ...(p.picks || {}), ...sp.picks }, ...(sp.music ? { music: { ...(p.music || {}), ...sp.music } } : {}), ...(sp.sound ? { sound: { ...(p.sound || {}), ...sp.sound } } : {}), ...(sp.pace ? { pace: { ...(p.pace || {}), ...sp.pace } } : {}) };
      if (switched) log.push(switched); }
  }
  if (p.job !== undefined) { if (p.job && !JOB_RE.test(p.job)) errs.push('job: lowercase letters, numbers and dashes'); else { s.job = p.job || null; log.push(`job ${s.job}`); } }
  if (p.pack !== undefined) {
    if (p.pack && !cat.packs.some(x => x.name === p.pack)) errs.push(`pack: no pack named "${p.pack}" (${cat.packs.map(x => x.name).join(', ')})`);
    else { s.pack = p.pack || null; log.push(s.pack ? `pack ${s.pack}` : 'no pack'); }
  }
  if (p.clearPicks) { s.picks = {}; log.push('cleared every pick'); }
  for (const [ref, how] of Object.entries(p.picks || {})) {
    const it = cat.items[ref];
    if (!it) { errs.push(`no such effect "${ref}" (use kind:id from the catalog, e.g. transition:whip)`); continue; }
    // a bed pick is the music panel's bed (one source of truth: music.bed)
    if (it.kind === 'bed') {
      if (!['allow', 'deny', 'clear'].includes(how)) { errs.push(`${ref}: use allow, deny or clear`); continue; }
      const was = s.music.bed;
      if (how === 'allow') s.music.bed = it.id; else if (s.music.bed === it.id) s.music.bed = 'auto';
      if (s.picks.bed) delete s.picks.bed;
      if (s.music.bed !== was) log.push(`bed ${s.music.bed}`);
      continue;
    }
    if (it.mode === 'info') { errs.push(`${ref} is shown for reference; set it ${it.kind === 'sfx' ? 'with the sound settings' : 'in the Music and pace panel or the choices table'}`); continue; }
    if (!['allow', 'deny', 'clear'].includes(how)) { errs.push(`${ref}: use allow, deny or clear`); continue; }
    const key = it.kind === 'editing' ? 'editing' : it.kind;
    const slot = s.picks[key] || (s.picks[key] = { allow: [], deny: [] });
    slot.allow = slot.allow.filter(x => x !== it.id); slot.deny = slot.deny.filter(x => x !== it.id);
    if (how === 'allow') { if (it.mode === 'one') slot.allow = []; slot.allow.push(it.id); }
    if (how === 'deny') { if (it.mode === 'one') { errs.push(`${ref}: pick another one instead of forbidding this`); continue; } slot.deny.push(it.id); }
    log.push(`${how === 'clear' ? 'cleared' : how === 'allow' ? 'picked' : 'forbade'} ${it.kind} ${it.id}`);
    // you took back or forbade a pick the reference set: it is yours now, and Back to my look leaves it alone
    if (how !== 'allow' && s.reference && s.reference.added) s.reference.added = s.reference.added.filter(x => x !== ref);
  }
  if (p.music) {
    const m = p.music;
    if (m.bed !== undefined) { if (m.bed && m.bed !== 'auto' && m.bed !== 'none' && !cat.beds.some(b => b.id === m.bed) && m.bed !== 'upload') errs.push(`music.bed: no bed "${m.bed}"`); else { const was = s.music.bed; s.music.bed = m.bed || 'auto'; if (s.picks.bed) delete s.picks.bed; if (s.music.bed !== was) log.push(`bed ${s.music.bed}`); } }
    if (m.energy !== undefined) { if (!ENERGY.includes(m.energy)) errs.push('music.energy: auto, low, mid or high'); else { s.music.energy = m.energy; log.push(`music energy ${m.energy}`); } }
  }
  if (p.sound) for (const k of ['sfx', 'cap']) if (p.sound[k] !== undefined) { if (!['on', 'off'].includes(p.sound[k])) errs.push(`sound.${k}: on or off`); else { s.sound[k] = p.sound[k]; log.push(`sound ${k} ${p.sound[k]}`); } }
  if (p.pace) {
    if (p.pace.tighten !== undefined) { const t = p.pace.tighten; if (t !== null && t !== 'off' && !(+t >= 0.1 && +t <= 2)) errs.push('pace.tighten: null (preset decides), off, or 0.1 to 2 seconds'); else { s.pace.tighten = t === null ? null : t === 'off' ? 'off' : +t; log.push(`tighten ${s.pace.tighten ?? 'preset'}`); } }
    if (p.pace.punch !== undefined) { if (!['on', 'off'].includes(p.pace.punch)) errs.push('pace.punch: on or off'); else { s.pace.punch = p.pace.punch; log.push(`punch ${p.pace.punch}`); } }
    if (p.pace.keepPauses !== undefined) { const k = [].concat(p.pace.keepPauses || []).map(String); if (k.some(x => !/^[\w-]+@\d+(\.\d+)?$/.test(x))) errs.push('pace.keepPauses: clip-id@seconds, from choices.json "pauses"'); else { s.pace.keepPauses = k; log.push(k.length ? `keep pauses ${k.join(', ')}` : 'cut every long pause'); } }
  }
  if (p.export !== undefined) { if (p.export && !cat.exports.includes(p.export)) errs.push(`export: ${cat.exports.join(', ')}`); else { s.export = p.export || null; log.push(`export ${s.export}`); } }
  if (p.reference && p.reference.mode !== undefined) { if (!SLK.MODES.includes(p.reference.mode)) errs.push('reference.mode: influence, recreate, look or off'); else { const was = s.reference.mode; s.reference.mode = p.reference.mode; log.push(`reference mode ${p.reference.mode}`);
    // Recreate or Influence sets the Look from the reference; Off takes it back out (your own picks stay)
    if (was !== s.reference.mode || (s.reference.mode !== 'off' && s.reference.extracted && !s.reference.auto)) { const a = setReferenceLook(s, cat); if (a) log.push(`set the look from the reference (${a.n} change${a.n === 1 ? '' : 's'})`); else if (was !== 'off' && s.reference.mode === 'off') log.push('back to your own look'); } } }
  if (p.reference && p.reference.parts !== undefined) {
    const q = p.reference.parts || {}, bad = Object.keys(q).filter(k => !REF_PARTS.some(x => x.id === k) || typeof q[k] !== 'boolean');
    if (bad.length) errs.push(`reference.parts: { ${REF_PARTS.map(x => x.id).join(', ')} } each true or false`);
    else { s.reference.parts = { ...refParts(s.reference), ...q }; log.push('reference parts: ' + Object.entries(q).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', '));
      if (s.reference.mode === 'influence' && s.reference.extracted) { const a = setReferenceLook(s, cat); if (a) log.push(`set the look from the reference (${a.n} change${a.n === 1 ? '' : 's'})`); } }
  }
  // a saved style look for drafts with no reference in use; null clears it
  // the point of the video, one optional line (kit/studio/point.mjs): it steers what we pick on the Cut step
  if (p.point !== undefined) { const v = cleanPoint(p.point); if (v !== (s.point || '')) { s.point = v; log.push(v ? `point: ${v}` : 'no point set'); } }
  if (p.styleLook !== undefined) {
    const n = p.styleLook === null || p.styleLook === '' ? null : p.styleLook;
    if (n !== null && !SLK.exists(n)) errs.push(`styleLook: no saved look named "${n}"${SLK.list().length ? ` (${SLK.list().map(x => x.name).join(', ')})` : ''}`);
    else if (n !== (s.styleLook || null)) { s.styleLook = n; log.push(n ? `style look ${n}` : 'no style look'); }
  }
  if (p.clips !== undefined) { const c = p.clips ? slash(p.clips) : null; if (c && (c.includes('..') || !existsSync(join(resolve(ROOT, c), 'clips.json')))) errs.push(`clips: no clips.json in ${c}`); else if (c !== s.clips) { s.clips = c; log.push(c ? `clips folder ${c}` : 'clips folder cleared'); } }
  // footage: reorder or drop files the job already has (state.footage), or add a file already in the job's inbox
  if (p.footage !== undefined) {
    if (!Array.isArray(p.footage) || p.footage.some(x => typeof x !== 'string' || !x.trim())) errs.push('footage: a list of file paths from state.footage, in the order to use');
    else {
      const want = p.footage.map(slash), inbox = s.job ? `inbox/studio/${s.job}/` : null;
      const bad = want.filter(f => !s.footage.includes(f) && !(inbox && f.startsWith(inbox) && !f.includes('..') && existsSync(join(ROOT, f))));
      if (bad.length) errs.push(`footage: not in this job: ${bad.join(', ')} (use the paths in state.footage, or upload the file first)`);
      else if (new Set(want).size !== want.length) errs.push('footage: a file is listed twice');
      else if (JSON.stringify(want) !== JSON.stringify(s.footage)) {
        const adding = want.some(f => !s.footage.includes(f)), had = hasEdit(s), sameSet = want.length === s.footage.length && want.every(f => s.footage.includes(f));
        const stamp = draftStamp(s);
        s.footage = want; s.clips = null;
        if (adding && had) { onFootageAdded(s, { hadEdit: true, stamp }); log.push(footageResetNote(s)); }
        else if (!sameSet) onFootageListChanged(s, { added: adding, hadEdit: had, stamp });
        log.push(`footage ${want.length ? want.map(f => basename(f)).join(', ') : 'none'}`);
      }
    }
  }
  // finish: what the one Render makes. from: auto (your pieces when you kept any, else the whole take), pieces or
  // take; reel: the one reel; clips: each piece as its own reel too; plain: each piece as a plain clip too
  if (p.finish !== undefined) {
    const f = p.finish, cur = { ...defaultState().finish, ...(s.finish || {}) };
    if (!f || typeof f !== 'object') errs.push('finish: { from: auto|pieces|take, reel, clips, plain }');
    else {
      if (f.from !== undefined) { if (!['auto', 'pieces', 'take'].includes(f.from)) errs.push('finish.from: auto, pieces or take'); else cur.from = f.from; }
      for (const k of ['reel', 'clips', 'plain']) if (f[k] !== undefined) cur[k] = !!f[k];
      if (!cur.reel && !cur.clips && !cur.plain) errs.push('finish: make at least one thing (reel, clips or plain)');
      else if (JSON.stringify(cur) !== JSON.stringify(s.finish)) { s.finish = cur; log.push(`finish ${cur.from}${cur.reel ? ', reel' : ''}${cur.clips ? ', clips' : ''}${cur.plain ? ', plain clips' : ''}`); }
    }
  }
  if (p.asIs !== undefined) { const v = !!p.asIs; if (v !== !!s.asIs) { s.asIs = v; log.push(v ? 'footage used as it is (already cut)' : 'footage cut into lines'); } }
  if (p.glossary !== undefined) {
    const G = require('../glossary.cjs'), e = typeof p.glossary === 'string' ? [] : G.validate(p.glossary);
    if (e.length) errs.push(...e);
    else { const g = G.parse(p.glossary); if (JSON.stringify(g) !== JSON.stringify(s.glossary || [])) { s.glossary = g; log.push(`glossary ${g.length} word${g.length === 1 ? '' : 's'}`); } }
  }
  if (p.brands !== undefined) {
    const list = Array.isArray(p.brands) ? p.brands : null;
    if (!list) errs.push('brands: a list of { word, logo }');
    else {
      const out = [];
      for (const b of list) {
        const logo = b && b.logo ? slash(b.logo) : '';
        const ok = KIT_BRANDS.includes(logo) || (!!logo && !logo.includes('..') && existsSync(join(brandsDir(), basename(logo))));
        if (!b || !b.word || !String(b.word).trim()) { errs.push('brands: each needs a word'); continue; }
        if (!ok) { errs.push(`brands: logo "${logo}" is not one you added in Studio (or ${KIT_BRANDS.join(', ')})`); continue; }
        out.push({ word: String(b.word).trim(), logo: KIT_BRANDS.includes(logo) ? logo : basename(logo) });
      }
      if (!errs.some(e => e.startsWith('brands')) && JSON.stringify(out) !== JSON.stringify(s.brands || [])) { s.brands = out; log.push(`brands ${out.map(b => b.word).join(', ') || 'none'}`); }
    }
  }
  const at = new Date().toISOString();
  // the Studio chat is its own channel: only lines typed in the page, answers to them, and short action notes
  const line = m => { m.id = s.chatSeq = (s.chatSeq || 0) + 1; m.channel = 'studio'; s.chat.push(m); return m; };
  if (p.say) line({ role: 'user', text: String(p.say).slice(0, 2000), at, from: p.from || 'ui', ...(p.toAgent ? { to: 'agent', status: 'queued' } : {}), ...(p.attach && typeof p.attach === 'object' ? { attach: p.attach } : {}) });
  if (p.reply) line({ role: 'assistant', text: String(p.reply).slice(0, 4000), at, from: p.from || 'assistant', ...(p.replyTo ? { replyTo: p.replyTo } : {}), ...(p.kind ? { kind: p.kind } : {}) });
  let off = [];
  if (touches) {
    const st = CF.settle(s, p, cat, { before, effectsReady: effectsReady() });
    errs.push(...st.errs); off = st.off;
    for (const o of st.off) log.push(`turned off ${o.ref} (${o.by})`);
    const text = [switched, st.text].filter(Boolean).join(' ');
    if (text) s.lastChange = { text, off: st.off, undo: before, at: Date.now() }; else delete s.lastChange;
  }
  const asked = Object.keys(p).some(k => !CHAT_KEYS.includes(k));
  return { errs, log, off, noop: asked && !errs.length && !log.length };
}

// ---------- session -> reel arguments ----------
const all = kind => kind === 'transition' ? L.transitionNames() : kind === 'entrance' ? R.ENTRANCES.slice() : kind === 'graphic' ? L.graphics().map(g => g.id) : kind === 'finish' ? Object.values(catalog().items).filter(i => i.kind === 'finish').map(i => i.id) : [];
const allowed = (s, kind) => { const p = s.picks[kind]; if (!p) return null; if (p.allow.length) return p.allow.filter(x => !p.deny.includes(x)); if (p.deny.length) return all(kind).filter(x => !p.deny.includes(x)); return null; };

export function compose(s, { refPack = null } = {}) {
  const args = [], notes = [], locks = {};
  // a pick another setting rules out is never sent to the reel (kit/studio/conflicts.mjs); the notes say which and why
  const conflicts = CF.conflictsOf(s, catalog());
  if (conflicts.length) {
    const out = new Set(conflicts.map(c => c.ref));
    s = { ...s, picks: Object.fromEntries(Object.entries(s.picks || {}).map(([k, v]) => [k, { ...v, allow: ((v && v.allow) || []).filter(id => !out.has(`${k}:${id}`)) }])) };
    for (const c of conflicts) notes.push(`not used: ${c.label} (${c.reason})`);
  }
  const pack = refPack || s.pack;
  if (pack) args.push('--pack', pack);
  const tr = allowed(s, 'transition'); if (tr && tr.length) locks.transitions = tr;
  const ti = allowed(s, 'entrance'); if (ti && ti.length) locks.titles = ti;
  // graphics: the kit's in the lock; scenes (ref-..., made from a reference or by your agent) placed by --scenes
  const g0 = s.picks.graphic, isScene = id => /^ref-/.test(id), g = g0 && { allow: g0.allow.filter(id => !isScene(id)), deny: g0.deny.filter(id => !isScene(id)) };
  if (g && (g.allow.length || g.deny.length)) locks.graphics = { ...(g.allow.length ? { allow: g.allow.slice() } : {}), ...(g.deny.length ? { deny: g.deny.slice() } : {}) };
  const scn = g0 ? g0.allow.filter(id => isScene(id) && !g0.deny.includes(id) && SCN.get(id)) : [];
  if (scn.length) args.push('--scenes', scn.join(','));
  const scOff = g0 ? g0.deny.filter(isScene) : []; // a forbidden scene stays out, the recipe's own too (Recreate)
  if (scOff.length) args.push('--scenes-off', scOff.join(','));
  const fi = allowed(s, 'finish'); if (fi) locks.finishes = fi.length ? fi : ['none'];
  const one = k => s.picks[k] && s.picks[k].allow[0];
  if (one('captionEntrance')) { locks.captionEntrance = one('captionEntrance'); args.push('--caption-entrance', one('captionEntrance')); }
  if (one('captionStyle')) args.push('--style', one('captionStyle'));
  if (one('look')) args.push('--look', one('look'));
  if (one('theme')) args.push('--theme', one('theme'));
  if (one('titleLayer')) args.push('--title-layer', one('titleLayer'));
  const fonts = s.picks.font && s.picks.font.allow.filter(f => f !== 'theme'); if (fonts && fonts.length) args.push('--fonts', fonts.join(','));
  if (one('beatSync') === 'no-beat-sync') args.push('--no-beat-sync');
  const ed = s.picks.editing || { allow: [], deny: [] }, on = id => ed.allow.includes(id), off = id => ed.deny.includes(id);
  if (on('cards-auto') || on('colour-card') || on('chapter-card')) args.push('--cards', 'auto');
  if (off('cards-auto') || (off('colour-card') && off('chapter-card'))) { args.push('--cards', 'off'); locks.cards = false; }
  if (s.pace.punch === 'off' || off('punch')) { args.push('--no-punch'); locks.punch = false; }
  // the point of the video (kit/studio/point.mjs): the engine leans its big caption word and a look's stickers on it
  if (s.point) args.push('--goal', s.point);
  if (s.pace.tighten === 'off' || off('tighten')) args.push('--no-tighten');
  else if (typeof s.pace.tighten === 'number') args.push('--tighten', String(s.pace.tighten));
  else if (on('tighten')) args.push('--tighten', '0.3');
  if (s.sound.sfx === 'off') { args.push('--no-sfx'); locks.sfx = false; }
  if (s.sound.cap === 'off' || off('sfx-cap')) args.push('--no-sfx-cap');
  if (s.sound.sfx !== 'off' && on('sfx-map')) args.push('--sfx-map'); else if (off('sfx-map')) args.push('--no-sfx-map');
  // the bed: music.bed only (the music panel shows the one the draft uses). none = no bed, even when the pack has one.
  const bed = s.music.bed !== 'auto' && s.music.bed !== 'none' && s.music.bed !== 'upload' ? s.music.bed : null;
  if (s.music.bed === 'upload' && s.music.upload) args.push('--bed', s.music.upload);
  else if (bed) args.push('--bed', bed);
  else if (s.music.bed === 'none') args.push('--no-bed');
  else if (s.music.energy) args.push('--music-energy', s.music.energy);
  if (Array.isArray(s.pace.keepPauses) && s.pace.keepPauses.length) args.push('--keep-pauses', s.pace.keepPauses.join(','));
  if (s.asIs) args.push('--as-is');
  // your words and brand logos (kit/glossary.cjs, kit/brands.cjs), short enough for any command line
  if (Array.isArray(s.glossary) && s.glossary.length) args.push('--glossary', s.glossary.map(e => `${e.heard.join(' | ')} = ${e.say}${e.after && e.after.length ? ' after ' + e.after.join(', ') : ''}`).join('; '));
  if (Array.isArray(s.brands) && s.brands.length) args.push('--brands', JSON.stringify(s.brands.map(b => ({ word: b.word, logo: KIT_BRANDS.includes(b.logo) ? join(ROOT, b.logo) : join(brandsDir(), b.logo) }))));
  if (s.export) args.push('--export', s.export);
  const fx = s.picks.effect ? s.picks.effect.allow.filter(x => !s.picks.effect.deny.includes(x)) : [];
  if (fx.length) notes.push(`effects for the effects pass: ${fx.join(', ')} (run after the reel; needs the effects pass set up)`);
  if ((s.picks.effect || {}).deny?.length) notes.push(`forbidden effects: ${s.picks.effect.deny.join(', ')}`);
  const errs = L.validate(locks);
  const lockString = lockStringOf(locks);
  if (lockString) args.push('--lock', lockString);
  return { args, locks, lockString, notes, conflicts, effects: fx, errs, bed: s.music.bed === 'upload' ? (s.music.upload ? basename(s.music.upload) : null) : s.music.bed };
}
const KEBAB = { maxTitles: 'max-titles', titleWords: 'title-words', captionEntrance: 'caption-entrance' };
export function lockStringOf(l) {
  const parts = [];
  for (const [k, v] of Object.entries(l || {})) {
    if (k === 'graphics') { if (v.allow) parts.push('graphics=' + v.allow.join(',')); if (v.deny) parts.push('no-graphics=' + v.deny.join(',')); continue; }
    parts.push(`${KEBAB[k] || k}=${Array.isArray(v) ? v.join(',') : v === false ? 'off' : v === true ? 'on' : v}`);
  }
  return parts.join('; ');
}

// ---------- reference ----------
// kit/studio/reference.mjs: extract, referenceLook, influencePack and the rest of what a reference gives Studio
export * from './reference.mjs';
import { REF_PARTS, refParts, referencePicks, setReferenceLook } from './reference.mjs';

// a pack whose style must sit inside its locks (pack validate refuses a style transition outside them)
export function fitStyle(pack) {
  const l = pack.locks || {}, st = pack.style || (pack.style = {});
  let base = {}; try { base = require('../preset.cjs').load(pack.extends) || {}; } catch {}
  const tr = st.transition || base.transition;
  if (l.transitions && tr && !l.transitions.includes(tr)) st.transition = l.transitions[0];
  if (l.titles && !st.entranceOrder && base.entranceOrder) st.entranceOrder = base.entranceOrder.slice();
  if (l.finishes && !st.finishPool && base.finishPool) st.finishPool = base.finishPool.slice();
  if (l.titles && st.entranceOrder) { st.entranceOrder = st.entranceOrder.filter(e => l.titles.includes(e)); if (!st.entranceOrder.length) st.entranceOrder = l.titles.slice(); }
  if (l.finishes && st.finishPool) { st.finishPool = st.finishPool.filter(f => l.finishes.includes(f)); if (!st.finishPool.length) delete st.finishPool; }
  if (l.finishes && st.finish && typeof st.finish === 'string' && !l.finishes.includes(st.finish)) delete st.finish;
  if (pack.weights && pack.weights.transitions && l.transitions) { const w = {}; for (const t of l.transitions) w[t] = pack.weights.transitions[t] || 1; pack.weights.transitions = w; }
  return pack;
}

// ---------- effects pass plan ----------
// Picked effects that need no copy of their own, one per beat window after the hook, in the order picked.
export function fxPlan(choices, effects) {
  const cat = catalog(), fxcat = JSON.parse(readFileSync(join(ROOT, 'effects', 'catalog.json'), 'utf8'));
  const by = Object.fromEntries(fxcat.effects.map(e => [e.name, e]));
  const usable = effects.filter(id => by[id] && !(by[id].required || []).length && !by[id].needsCustomText);
  const skipped = effects.filter(id => !usable.includes(id));
  const beats = (choices && choices.beats || []).filter(b => b.end - b.start >= 1.2);
  const out = [];
  let i = 0;
  for (const b of beats.slice(1)) {
    if (i >= usable.length) break;
    const e = by[usable[i]], d = Math.min(Math.max(e.duration ? e.duration[0] : 2, 1), b.end - b.start - 0.2);
    out.push({ fx: usable[i], start: +(b.start + 0.1).toFixed(2), end: +(b.start + 0.1 + d).toFixed(2) }); i++;
  }
  return { plan: { effects: out }, skipped, unplaced: usable.slice(i), cat: !!cat };
}

// ---------- vibes: plain words to picks, without a model ----------
// A small keyword table (kit/studio/vibes.json) plus exact names: "no glitch", "use whip", "typewriter titles".
export function vibes(text, s, cat = catalog()) {
  const V = JSON.parse(readFileSync(join(STUDIO, 'vibes.json'), 'utf8'));
  const t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const patch = { picks: {} }, said = [];
  // when several vibes name a pack, the one said last wins (and only it is reported)
  const at = v => Math.max(...v.words.map(w => t.lastIndexOf(' ' + w + ' ')));
  const packVibes = V.vibes.filter(v => v.pack && at(v) >= 0).sort((a, b) => at(a) - at(b));
  const lastPack = packVibes.length ? packVibes[packVibes.length - 1] : null;
  for (const v of V.vibes) if (v.words.some(w => t.includes(' ' + w + ' '))) {
    if (v.pack && v !== lastPack) { if (v.energy) patch.music = { ...(patch.music || {}), energy: v.energy }; said.push(v.say.replace(/^the [a-z-]+ pack( with)?/, '').trim() || 'energy ' + v.energy); continue; }
    if (v.pack) patch.pack = v.pack;
    if (v.energy) patch.music = { ...(patch.music || {}), energy: v.energy };
    if (v.pace) patch.pace = { ...(patch.pace || {}), ...v.pace };
    for (const [ref, how] of Object.entries(v.picks || {})) patch.picks[ref] = how;
    said.push(v.say);
  }
  const NEG = ['no', 'without', 'not', 'never', 'forbid', 'skip', 'avoid', 'lose', 'drop', 'ban'];
  // clauses, so "no glitch, typewriter titles" forbids glitch and picks typewriter
  const clauses = String(text).toLowerCase().split(/[,.;!?]|\band\b|\bbut\b|\bplus\b/).map(c => ' ' + c.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim() + ' ');
  const AMBIG = ['cut', 'film', 'pop', 'theme', 'warm', 'cool', 'blur', 'zoom', 'wipe', 'tap', 'drop', 'flash', 'push', 'slice', 'wind', 'clock', 'distance', 'modern', 'classic', 'front', 'behind', 'auto', 'swipe', 'noise', 'moody', 'orbit', 'timeline', 'messages', 'highlight', 'ticker', 'versus', 'lineup'];
  const vibePicks = new Set(Object.keys(patch.picks)), ORDER = ['transition', 'entrance', 'graphic', 'finish', 'effect', 'captionStyle', 'captionEntrance', 'look', 'font', 'theme', 'bed'];
  for (const c of clauses) { const hits = []; for (const it of Object.values(cat.items)) {
    if (it.mode === 'info' || it.id.length < 3) continue;
    const name = ' ' + it.id.replace(/-/g, ' ') + ' ', idx = c.indexOf(name) >= 0 ? c.indexOf(name) : c.indexOf(' ' + it.id + ' ');
    if (idx < 0) continue;
    const kindWord = { transition: 'transitions?|cuts?|seams?', finish: 'grade|finish|look', entrance: 'titles?|entrances?', captionEntrance: 'captions?|words?', captionStyle: 'captions?', effect: 'effects?', graphic: 'graphics?|cards?', look: 'look', theme: 'theme', font: 'fonts?', bed: 'music|bed|track' }[it.kind] || 'x^';
    if ((AMBIG.includes(it.id) || V.vibes.some(v => v.words.includes(it.id))) && !new RegExp(`${it.id}\\s+(${kindWord})\\b`).test(c)) continue;
    hits.push({ it, idx, typed: new RegExp(`${it.id.replace(/-/g, '[ -]')}\\s+(${kindWord})\\b`).test(c) });
  }
  for (const h of hits) {
    const same = hits.filter(x => x.it.id === h.it.id);
    if (same.length > 1) { const typed = same.filter(x => x.typed); const keep = typed.length ? typed : same.slice().sort((a, b) => ORDER.indexOf(a.it.kind) - ORDER.indexOf(b.it.kind)).slice(0, 1); if (!keep.includes(h)) continue; }
    const it = h.it, before = c.slice(0, h.idx).trim().split(' ');
    const how = before.some(w => NEG.includes(w)) ? 'deny' : 'allow';
    if (how === 'deny' && it.mode === 'one') continue;
    if (patch.picks[it.ref] === undefined || vibePicks.has(it.ref)) { if (vibePicks.has(it.ref)) { vibePicks.delete(it.ref); } patch.picks[it.ref] = how; said.push(`${how === 'deny' ? 'no' : 'use'} ${it.kind} ${it.id}`); }
  } }
  // "use the transitions from this reference but calmer": the reference's picks for the kinds named, under the vibe words
  const ex = s && s.reference && s.reference.extracted;
  if (ex && /\b(reference|ref|that video|this video|the link|that reel|this reel|that one)\b/.test(t)) {
    const KW = [['transition', /\b(transitions?|cuts?|seams?)\b/], ['entrance', /\b(titles?|entrances?|text)\b/], ['captionStyle', /\b(captions?|subtitles?)\b/], ['finish', /\b(grade|grading|finish(es)?|colou?rs?)\b/],
      ['graphic', /\b(graphics?|stickers?)\b/], ['effect', /\beffects?\b/], ['bed', /\b(music|song|track|bed)\b/], ['beatSync', /\b(beats?|rhythm)\b/]];
    const kinds = KW.filter(([, re]) => re.test(t)).map(([k]) => k);
    const all = /\b(everything|style|look|all of it|same)\b/.test(t) || !kinds.length;
    const rp = referencePicks(ex, all ? null : kinds, cat);
    let n = 0; for (const [ref, how] of Object.entries(rp)) if (patch.picks[ref] === undefined) { patch.picks[ref] = how; n++; }
    if (n) said.push(`from the reference: ${all ? 'its look' : kinds.join(', ')} (${n} pick${n > 1 ? 's' : ''})`);
  }
  if (!Object.keys(patch.picks).length) delete patch.picks;
  return { patch, said };
}

// ---------- jobs ----------
export function jobDir(s) { return s.job ? join(ROOT, 'jobs', s.job) : null; }
export function outputsOf(s) {
  const d = jobDir(s); if (!d || !existsSync(d)) return [];
  return readdirSync(d).filter(f => /^reel(-fx)?-v\d+(-[a-z0-9]+)?\.mp4$/.test(f)).sort((a, b) => (+(b.match(/v(\d+)/) || [0, 0])[1]) - (+(a.match(/v(\d+)/) || [0, 0])[1]) || a.localeCompare(b)).map(f => `jobs/${s.job}/${f}`);
}

// ---------- videos: start fresh, open a past one ----------
// A "video" is a job. Starting fresh never deletes a file: the old job's footage (inbox/studio/<job>), renders and
// reel-vN.build snapshots stay where they are, and its session is saved to jobs/.studio/videos/<job>.json so opening
// it again puts you back where you were. What carries over: your words (glossary) and the counters; with
// keepLook, the look too (pack, picks, music, sound, pace, export, brand logos, the saved style look). Keys, settings and the agent
// connection live in other files and are never touched here.
export const LOOK_KEYS = ['pack', 'picks', 'music', 'sound', 'pace', 'export', 'brands', 'styleLook'];
const KEEP_KEYS = ['format', 'version', 'rev', 'updated', 'chatSeq', 'refSeq', 'importSeq', 'commentSeq', 'videoSeq', 'glossary'];
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
export const videosDir = () => join(stateDir(), 'videos');
const videoPath = job => join(videosDir(), job + '.json');
export const jobName = raw => String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 49).replace(/-+$/, '');
const clone = x => JSON.parse(JSON.stringify(x));
// the part of a session that belongs to its video (everything but your words and the counters)
export function videoSession(s) { const o = {}; for (const [k, v] of Object.entries(s)) if (!KEEP_KEYS.includes(k)) o[k] = clone(v); o.task = null; o.savedAt = new Date().toISOString(); return o; }
export function saveVideo(s) {
  if (!s.job || !JOB_RE.test(s.job)) return null;
  mkdirSync(videosDir(), { recursive: true });
  const f = videoPath(s.job), tmp = f + '.tmp'; writeFileSync(tmp, JSON.stringify(videoSession(s), null, 2)); renameSync(tmp, f);
  return f;
}
export function savedVideo(job) { try { return JOB_RE.test(job) ? JSON.parse(readFileSync(videoPath(job), 'utf8')) : null; } catch { return null; } }
// a clean board for a new job, built from s (s is changed in place and returned)
export function freshSession(s, { job = null, keepLook = true } = {}) {
  const d = defaultState(), keep = {};
  for (const k of KEEP_KEYS) if (s[k] !== undefined) keep[k] = s[k];
  const look = {}; if (keepLook) for (const k of LOOK_KEYS) if (s[k] !== undefined) look[k] = clone(s[k]);
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, d, keep, look, { job: job || null, keepLook: !!keepLook });
  // Clip-specific pause exceptions are edit decisions, not a reusable pace setting.
  if (s.pace.keepPauses) delete s.pace.keepPauses;
  return s;
}
// the footage identity a draft is tied to (order matters). Used to hide a leftover jobs/<job>/build
// when the user has started a new edit on the same job.
export const footageKey = s => JSON.stringify([s.footage || [], s.clips || null]);
export const takeNames = s => (s.footage || []).map(f => String(f).split(/[/\\]/).pop());
// the draft and footage identity to stamp on existing reels before the board's footage changes
export function draftStamp(s) {
  return { key: (s.drafted && s.drafted.key) || ('take:' + footageKey(s)), footage: footageKey(s), takes: takeNames(s), from: (s.drafted && s.drafted.from) || null };
}
function versionOfReel(f) { return +(String(f).match(/reel(?:-fx)?-v(\d+)/) || [0, 0])[1] || 0; }
// what reel-vN.settings.json and reel-vN.build/meta.json say this render was made from
export function outputIdentity(job, v) {
  const dir = join(ROOT, 'jobs', job);
  let settings = null, meta = null, mtime = 0;
  try { settings = JSON.parse(readFileSync(join(dir, `reel-v${v}.settings.json`), 'utf8')); } catch {}
  try { meta = JSON.parse(readFileSync(join(dir, `reel-v${v}.build`, 'meta.json'), 'utf8')); } catch {}
  try { mtime = statSync(join(dir, `reel-v${v}.mp4`)).mtimeMs; } catch {}
  return { v, settings, meta, key: (settings && settings.key) || (meta && meta.key) || null, footage: (settings && settings.footage) || (meta && meta.footage) || null, takes: (settings && settings.takes) || (meta && meta.takes) || [], from: (settings && settings.from) || (meta && meta.from) || null, mtime };
}
// write the draft key onto existing reels that do not have one yet, so Finish can hide them when the
// footage changes and the Outputs library can name the source take and draft. Never moves or deletes a file.
export function tagJobOutputs(s, stamp = draftStamp(s)) {
  if (!s || !s.job || !stamp) return 0;
  const dir = jobDir(s); if (!dir || !existsSync(dir)) return 0;
  let files = []; try { files = readdirSync(dir); } catch { return 0; }
  const vs = [...new Set(files.map(f => versionOfReel(f)).filter(Boolean))];
  let n = 0;
  for (const v of vs) {
    const id = outputIdentity(s.job, v);
    if (id.key) continue;
    const st = { ...(id.settings || { version: v, job: s.job }), key: stamp.key, footage: stamp.footage, takes: stamp.takes, from: stamp.from || (id.settings && id.settings.from) || null };
    if (!st.at) { try { st.at = statSync(join(dir, `reel-v${v}.mp4`)).mtime.toISOString(); } catch { st.at = new Date().toISOString(); } }
    try { writeFileSync(join(dir, `reel-v${v}.settings.json`), JSON.stringify(st, null, 1)); n++; } catch {}
    const metaDir = join(dir, `reel-v${v}.build`);
    if (existsSync(metaDir)) {
      try { writeFileSync(join(metaDir, 'meta.json'), JSON.stringify({ ...(id.meta || {}), key: stamp.key, footage: stamp.footage, takes: stamp.takes, ...(st.from ? { from: st.from } : {}) }, null, 1) + '\n'); } catch {}
    }
  }
  return n;
}
// true when this reel was rendered from the current draft. Match on the key saved in reel-vN.settings.json
// or reel-vN.build/meta.json. Untagged older reels only count when there is no current draft key, or the
// file was written at or after this draft.
export function outputMatchesDraft(s, ident, wantKey) {
  if (!s || !ident || !draftIsCurrent(s)) return false;
  if (ident.key) return ident.key === wantKey;
  if (ident.footage) return ident.footage === footageKey(s) && (!wantKey || wantKey === 'take:' + footageKey(s));
  if (!s.drafted || !s.drafted.key) return true;
  if (s.drafted.at && ident.mtime && ident.mtime >= s.drafted.at - 2000) return true;
  return false;
}
// false when the session says the on-disk draft is leftover (a new upload, or footage that no longer
// matches). When drafted was never set, a build folder still counts, so older tests and jobs stay valid.
export function draftIsCurrent(s) {
  if (!s || s.draftStale) return false;
  if (!s.drafted || !s.drafted.key) return true;
  const k = s.drafted.key;
  if (k.startsWith('take:') && k !== 'take:' + footageKey(s)) return false;
  return true;
}
// true when this board already has an edit, or leftover b-roll, so adding footage should start fresh.
export function hasEdit(s) {
  if ((s.footage || []).length) return true;
  if (s.cut || s.drafted || s.cleanup || s.lockedAtDraft || s.output) return true;
  if (s.asIs || (s.pieces && Object.keys(s.pieces).length) || (s.lines && Object.keys(s.lines).length)) return true;
  const b = s.job && (s.broll || {})[s.job];
  if (b && (Object.keys(b.slots || {}).length || Object.keys(b.ideas || {}).length || (b.marks || []).length || (b.cutins || []).length)) return true;
  // a reference on its own is not an edit: picking a reference, then adding your take, keeps the reference
  return false;
}
// hide leftover spots and the on-disk draft without deleting any file
export function clearBrollTimeline(s) {
  if (s.job && s.broll && s.broll[s.job]) {
    const b = s.broll[s.job];
    b.slots = {}; b.ideas = {}; b.marks = []; b.cutins = [];
    delete b.undo;
  }
  s.drafted = null;
  s.draftStale = true;
  delete s.lockedAtDraft;
  return s;
}
// start a fresh edit on this job: cuts, pieces, b-roll spots, notes (reference), draft and render
// state go; the look stays only when Keep my look was chosen on New video (s.keepLook). Footage,
// the job name, your words, chat, takes, transcripts and files on disk stay.
export function resetEdit(s, { keepLook = s.keepLook === true } = {}) {
  const d = defaultState();
  s.cut = null;
  s.lines = {};
  delete s.pieces;
  delete s.topics;
  s.point = ''; // the point belongs to the video that was on the board
  clearBrollTimeline(s);
  delete s.cleanup;
  s.output = null;
  s.reference = clone(d.reference);
  delete s.undoRef;
  delete s.lastChange; // its Undo belongs to the old video
  s.finish = clone(d.finish);
  delete s.asIs;
  if (s.pace && s.pace.keepPauses) delete s.pace.keepPauses;
  if (!keepLook) {
    s.pack = d.pack;
    s.picks = {};
    s.music = clone(d.music);
    s.sound = clone(d.sound);
    s.pace = clone(d.pace);
    s.export = d.export;
    delete s.brands;
    s.styleLook = null;
  }
  return s;
}
export function footageResetNote(s) {
  return s.keepLook === true
    ? 'Started a fresh edit for this footage and kept your look. Cuts, b-roll and the draft are cleared. Earlier reels stay in Outputs. Use New video if you want this as its own job.'
    : 'Started a fresh edit for this footage. Cuts, b-roll, the look and the draft are cleared. Earlier reels stay in Outputs. Use New video if you want this as its own job.';
}
// stamp: the draft identity from before the footage list changed, so earlier reels keep their own key
export function onFootageAdded(s, { hadEdit, stamp } = {}) {
  if (stamp) tagJobOutputs(s, stamp);
  const had = hadEdit === undefined ? hasEdit(s) : hadEdit;
  if (had) { resetEdit(s, { keepLook: s.keepLook === true }); return true; }
  clearBrollTimeline(s);
  return false;
}
// add a talking-head file to the current job. If the board already had an edit, starts a fresh one.
// Never deletes a file. Returns { added, reset, note }.
export function addFootage(s, relp) {
  const path = slash(relp);
  if ((s.footage || []).includes(path)) return { added: false, reset: false, note: null };
  const had = hasEdit(s);
  const stamp = draftStamp(s);
  s.footage = [...(s.footage || []), path];
  s.clips = null;
  const reset = onFootageAdded(s, { hadEdit: had, stamp });
  return { added: true, reset, note: reset ? footageResetNote(s) : null };
}
export function onFootageListChanged(s, { added = false, hadEdit = false, stamp } = {}) {
  if (stamp) tagJobOutputs(s, stamp);
  if (added && hadEdit) return onFootageAdded(s, { hadEdit: true });
  clearBrollTimeline(s);
  return false;
}
// what a past job has on disk when Studio never saved its session (an older install, or a job made with npm run reel)
export function videoFromDisk(job) {
  const inbox = join(ROOT, 'inbox', 'studio', job), footage = [];
  if (existsSync(inbox)) for (const f of readdirSync(inbox).sort()) if (VIDEO_EXT.test(f)) footage.push(`inbox/studio/${job}/${f}`);
  const takes = join(inbox, 'takes');
  if (existsSync(takes)) for (const f of readdirSync(takes).sort()) if (/^take-\d+\.mp4$/.test(f)) footage.push(`inbox/studio/${job}/takes/${f}`);
  const clips = !footage.length && existsSync(join(ROOT, 'jobs', job, 'clips', 'clips.json')) ? `jobs/${job}/clips` : null;
  return { footage, clips };
}
// open a past job: its saved session, or what is on disk. The look stays as it is when nothing was saved.
export function openSession(s, job) {
  const saved = savedVideo(job);
  if (saved) {
    const keep = {}; for (const k of KEEP_KEYS) if (s[k] !== undefined) keep[k] = s[k];
    for (const k of Object.keys(s)) delete s[k];
    const d = defaultState();
    Object.assign(s, d, saved, keep, { job, task: null, reference: { ...d.reference, ...(saved.reference || {}) } });
    delete s.savedAt;
    return { restored: true };
  }
  freshSession(s, { job, keepLook: true });
  Object.assign(s, videoFromDisk(job));
  return { restored: false };
}
const mtime = p => { try { return statSync(p).mtimeMs; } catch { return 0; } };
// every past video: jobs/<job>, inbox/studio/<job> and saved sessions, newest first, with how many reels each has
export function listVideos(current = null, { limit = Infinity } = {}) {
  const names = new Set();
  const add = (dir, strip) => { if (!existsSync(dir)) return; for (const e of readdirSync(dir, { withFileTypes: true })) { const n = strip ? e.name.replace(/\.json$/, '') : e.name; if ((strip ? e.isFile() && e.name.endsWith('.json') : e.isDirectory()) && JOB_RE.test(n)) names.add(n); } };
  add(join(ROOT, 'jobs'), false); add(join(ROOT, 'inbox', 'studio'), false); add(videosDir(), true);
  if (current) names.add(current);
  const out = [];
  for (const job of names) {
    const saved = savedVideo(job);
    const at = Math.max(mtime(join(ROOT, 'jobs', job)), mtime(join(ROOT, 'inbox', 'studio', job)), saved && saved.savedAt ? Date.parse(saved.savedAt) || 0 : 0);
    const outputs = outputsOf({ job }).length;
    const footage = saved ? (saved.footage || []).length : videoFromDisk(job).footage.length;
    out.push({ job, at: at ? new Date(at).toISOString() : null, outputs, footage, saved: !!saved, current: job === current });
  }
  out.sort((a, b) => (b.current - a.current) || (Date.parse(b.at || 0) || 0) - (Date.parse(a.at || 0) || 0) || a.job.localeCompare(b.job));
  return out.slice(0, limit);
}
// Persisted work which still owns this board. Used by the server and by MCP when Studio is closed.
// a reference link in the queue that is being read (kit/studio/server.mjs runs these in their own lane)
export const REF_READING = ['queued', 'downloading', 'tearing'], REF_BUSY = 'A reference link is still downloading';
const refRunning = s => ((s.reference && s.reference.queue) || []).filter(x => x.status === 'downloading' || x.status === 'tearing');
export function videoBusy(s) {
  if (s.task && s.task.status === 'running') return `A ${s.task.kind || 'task'} is running`;
  if (refRunning(s).length) return REF_BUSY;
  if ((s.imports || []).some(x => x.status === 'downloading')) return 'A footage link is still downloading';
  if ((s.takes || []).some(t => t.status === 'recording' || t.status === 'converting')) return 'A take is still being saved';
  if (Object.values(s.tx || {}).some(x => x && x.status === 'running')) return 'A transcript is still running';
  if (Object.values(s.broll || {}).some(b => b && (b.gens || []).some(g => g.status === 'running'))) return 'A B-roll clip is still generating';
  return null;
}
// work Studio was doing when it last stopped can never finish: mark it, so it does not block switching videos forever
// a file teardown that failed, was cancelled or was cut off: the file is still here to break down again. Left as
// "running" it would refuse every Recreate draft (kit/studio/server.mjs refWait). True when it changed something.
export function settleReference(s) {
  const r = s.reference; if (!r || r.status !== 'running') return false;
  r.status = r.extracted ? 'ready' : r.file ? 'uploaded' : 'none'; if (r.stages) r.stages = failView(r.stages); return true;
}
export function settleStale(s) {
  let n = 0; const stop = (x, status, error) => { Object.assign(x, { status, ...(error ? { error } : {}) }); n++; };
  if (settleReference(s)) n++;
  if (s.task && s.task.status === 'running') stop(s.task, 'cancelled');
  for (const x of s.imports || []) if (x.status === 'downloading') stop(x, 'failed', 'Studio stopped during this download');
  for (const x of refRunning(s)) { stop(x, 'failed', 'Studio stopped while reading this reference'); if (x.stages) x.stages = failView(x.stages); }
  for (const x of Object.values(s.tx || {})) if (x && x.status === 'running') stop(x, 'failed', 'Studio stopped during this transcript');
  for (const b of Object.values(s.broll || {})) for (const g of (b && b.gens) || []) if (g.status === 'running') stop(g, 'failed', 'Studio stopped while this was generating');
  return n;
}
const taken = j => existsSync(join(ROOT, 'jobs', j)) || existsSync(join(ROOT, 'inbox', 'studio', j)) || !!savedVideo(j);
export function freeName(base) { if (!taken(base)) return base; for (let i = 2; i < 1000; i++) { const n = `${base.slice(0, 44)}-${i}`; if (!taken(n)) return n; } return base.slice(0, 40) + '-' + Date.now().toString(36); }
// the one switch the page, the server and the MCP tools share: checks the name, saves the current video's session,
// then starts fresh or opens. Changes s in place; returns { job, restored?, note }. Throws (with .code) when refused.
export function switchVideo(s, { name, keepLook = true, open } = {}, { checkBusy = true } = {}) {
  const fail = (msg, code) => { throw Object.assign(new Error(msg), { code }); };
  const busy = checkBusy && videoBusy(s); if (busy) fail(`${busy}. Cancel it or let it finish, then switch videos.`, 409);
  let job;
  if (open !== undefined && open !== null) {
    job = jobName(open);
    if (!job || !listVideos(s.job).some(v => v.job === job)) fail(`no video named "${open}"`, 404);
    if (job === s.job) return { job, restored: true, note: `${job} is already open` };
  } else {
    const raw = name === undefined || name === null ? '' : String(name);
    job = raw.trim() ? jobName(raw) : freeName('video-' + new Date().toISOString().slice(0, 10));
    if (!job || !JOB_RE.test(job)) fail('name: use letters, numbers and dashes', 400);
    if (job === s.job || taken(job)) fail(`"${job}" is already a video. Open it from the list, or pick another name.`, 409);
  }
  const from = s.job;
  if (from) saveVideo(s);
  let note, restored;
  if (open !== undefined && open !== null) { restored = openSession(s, job).restored; note = `Opened ${job}${restored ? '' : ' (its footage and reels; it had no saved session)'}`; }
  else { freshSession(s, { job, keepLook: keepLook !== false }); note = `Started a new video: ${job}${keepLook !== false ? ', kept the look' : ''}`; }
  if (from) note += `. ${from} is saved: More, Open a past video brings it back.`;
  s.videoSeq = (s.videoSeq || 0) + 1;
  applyPatch(s, { reply: note, kind: 'action', from: 'studio' });
  saveVideo(s); // reserve even an empty new video, and let the list find it before any upload
  return { job, restored, note };
}
