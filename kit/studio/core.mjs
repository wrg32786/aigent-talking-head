// Studio core: the catalog Studio shows, the session state it shares with the MCP tools, and how a session becomes the
// same npm run reel arguments you could type yourself. No network, no keys; the server (kit/studio/server.mjs) and the
// MCP server (kit/mcp.mjs) both use this file, so the UI and an assistant always see and edit the same thing.
//   state file: jobs/.studio/state.json (or STUDIO_DIR); the server watches it and pushes changes to the page.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'fs';
import { dirname, join, resolve, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadMenu } from '../menu.mjs';

const require = createRequire(import.meta.url);
export const STUDIO = dirname(fileURLToPath(import.meta.url));
export const KIT = dirname(STUDIO), ROOT = dirname(KIT);
const L = require('../locks.cjs');
const K = require('../packs.cjs');
const R = require('../rules.cjs');

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
let cached = null;
export function catalog({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
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
  const packs = K.list().map(p => ({ name: p.name, label: p.label, description: p.description, version: p.version, shipped: !!p.shipped, locks: L.describe(p.locks || {}),
    preview: p.dir && existsSync(join(p.dir, 'preview.webp')) ? rel(join(p.dir, 'preview.webp')) : null }));
  const beds = JSON.parse(readFileSync(join(KIT, 'music', 'beds.json'), 'utf8'));
  cached = { categories, items, packs, candidates: map.candidates || [], beds: Object.entries(beds).map(([id, b]) => ({ id, title: b.title, seconds: b.seconds, energy: b.energy, file: rel(join(KIT, 'music', b.file)) })),
    exports: menu.items.filter(i => i.section === 'exports').map(i => i.id), errs };
  return cached;
}

// ---------- state ----------
export const stateDir = () => resolve(process.env.STUDIO_DIR || join(ROOT, 'jobs', '.studio'));
export const statePath = () => join(stateDir(), 'state.json');
export function defaultState() {
  return { format: 'aigent-studio', version: 1, rev: 0, job: null, footage: [], clips: null,
    reference: { file: null, url: null, mode: 'influence', status: 'none', out: null, extracted: null, applied: false, queue: [], active: null },
    pack: null, picks: {}, music: { bed: 'auto', energy: 'auto', upload: null }, sound: { sfx: 'on', cap: 'on' }, pace: { tighten: null, punch: 'on' },
    export: 'reels', chat: [], task: null, outputs: [], takes: [], output: null, cut: null, tx: {}, lines: {}, broll: {} };
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
export function applyPatch(s, p, cat = catalog()) {
  const errs = [], log = [];
  if (!p || typeof p !== 'object') return { errs: ['patch must be an object'], log, noop: false };
  const known = ['job', 'pack', 'picks', 'clearPicks', 'music', 'sound', 'pace', 'export', 'reference', 'say', 'reply', 'from', 'footage', 'clips', 'toAgent', 'replyTo', 'kind', 'attach', 'asIs', 'glossary', 'brands'];
  for (const k of Object.keys(p)) if (!known.includes(k)) errs.push(`unknown field "${k}" (${known.join(', ')})`);
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
  if (p.reference && p.reference.mode !== undefined) { if (!['influence', 'recreate', 'off'].includes(p.reference.mode)) errs.push('reference.mode: influence, recreate or off'); else { s.reference.mode = p.reference.mode; log.push(`reference mode ${p.reference.mode}`); } }
  if (p.clips !== undefined) { const c = p.clips ? slash(p.clips) : null; if (c && (c.includes('..') || !existsSync(join(resolve(ROOT, c), 'clips.json')))) errs.push(`clips: no clips.json in ${c}`); else if (c !== s.clips) { s.clips = c; log.push(c ? `clips folder ${c}` : 'clips folder cleared'); } }
  // footage: reorder or drop files the job already has (state.footage), or add a file already in the job's inbox
  if (p.footage !== undefined) {
    if (!Array.isArray(p.footage) || p.footage.some(x => typeof x !== 'string' || !x.trim())) errs.push('footage: a list of file paths from state.footage, in the order to use');
    else {
      const want = p.footage.map(slash), inbox = s.job ? `inbox/studio/${s.job}/` : null;
      const bad = want.filter(f => !s.footage.includes(f) && !(inbox && f.startsWith(inbox) && !f.includes('..') && existsSync(join(ROOT, f))));
      if (bad.length) errs.push(`footage: not in this job: ${bad.join(', ')} (use the paths in state.footage, or upload the file first)`);
      else if (new Set(want).size !== want.length) errs.push('footage: a file is listed twice');
      else if (JSON.stringify(want) !== JSON.stringify(s.footage)) { s.footage = want; s.clips = null; log.push(`footage ${want.length ? want.map(f => basename(f)).join(', ') : 'none'}`); }
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
  const asked = Object.keys(p).some(k => !CHAT_KEYS.includes(k));
  return { errs, log, noop: asked && !errs.length && !log.length };
}

// ---------- session -> reel arguments ----------
const all = kind => kind === 'transition' ? L.transitionNames() : kind === 'entrance' ? R.ENTRANCES.slice() : kind === 'graphic' ? L.graphics().map(g => g.id) : kind === 'finish' ? Object.values(catalog().items).filter(i => i.kind === 'finish').map(i => i.id) : [];
const allowed = (s, kind) => { const p = s.picks[kind]; if (!p) return null; if (p.allow.length) return p.allow.filter(x => !p.deny.includes(x)); if (p.deny.length) return all(kind).filter(x => !p.deny.includes(x)); return null; };

export function compose(s, { refPack = null } = {}) {
  const args = [], notes = [], locks = {};
  const pack = refPack || s.pack;
  if (pack) args.push('--pack', pack);
  const tr = allowed(s, 'transition'); if (tr && tr.length) locks.transitions = tr;
  const ti = allowed(s, 'entrance'); if (ti && ti.length) locks.titles = ti;
  const g = s.picks.graphic; if (g && (g.allow.length || g.deny.length)) locks.graphics = { ...(g.allow.length ? { allow: g.allow.slice() } : {}), ...(g.deny.length ? { deny: g.deny.slice() } : {}) };
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
  if (s.pace.tighten === 'off' || off('tighten')) args.push('--no-tighten');
  else if (typeof s.pace.tighten === 'number') args.push('--tighten', String(s.pace.tighten));
  else if (on('tighten')) args.push('--tighten', '0.3');
  if (s.sound.sfx === 'off') { args.push('--no-sfx'); locks.sfx = false; }
  if (s.sound.cap === 'off' || off('sfx-cap')) args.push('--no-sfx-cap');
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
  if (fx.length) notes.push(`effects for the effects pass: ${fx.join(', ')} (run after the reel; needs npm run effects:setup)`);
  if ((s.picks.effect || {}).deny?.length) notes.push(`forbidden effects: ${s.picks.effect.deny.join(', ')}`);
  const errs = L.validate(locks);
  const lockString = lockStringOf(locks);
  if (lockString) args.push('--lock', lockString);
  return { args, locks, lockString, notes, effects: fx, errs, bed: s.music.bed === 'upload' ? (s.music.upload ? basename(s.music.upload) : null) : s.music.bed };
}
const KEBAB = { maxTitles: 'max-titles', captionEntrance: 'caption-entrance' };
export function lockStringOf(l) {
  const parts = [];
  for (const [k, v] of Object.entries(l || {})) {
    if (k === 'graphics') { if (v.allow) parts.push('graphics=' + v.allow.join(',')); if (v.deny) parts.push('no-graphics=' + v.deny.join(',')); continue; }
    parts.push(`${KEBAB[k] || k}=${Array.isArray(v) ? v.join(',') : v === false ? 'off' : v === true ? 'on' : v}`);
  }
  return parts.join('; ');
}

// ---------- reference: influence ----------
// What a teardown Reel.md says about the reference, as Studio suggestions. Influence mode turns them into a local
// pack (packs/local/ref-<job>/) with soft transition weights and no locks; the user's own picks become locks on top.
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
  const graphics = [...new Set((r.graphics || []).map(g => g.type || g.graphic || g.id).filter(Boolean))];
  const effects = st.effects ? String(st.effects).split(',').map(x => x.trim()).filter(Boolean) : [];
  const cat = catalog();
  const real = (kind, ids) => ids.filter(id => cat.items[`${kind}:${id}`]);
  return {
    summary: summarize(r, recipePath, { transitions: tcount, entrances: real('entrance', entrances), finishes: real('finish', finishes), graphics: real('graphic', graphics), effects: real('effect', effects) }, cat),
    name: (r.card && r.card.name) || basename(dirname(recipePath)), shots: (r.shots || []).length, titles: (r.titles || []).length,
    preset: br.preset && br.preset !== 'none' ? br.preset : null, look: st.look || null, captionStyle: st.captions || null,
    transitions: tcount, entrances: real('entrance', entrances), finishes: real('finish', finishes), graphics: real('graphic', graphics), effects: real('effect', effects),
    music: { bed: mu.bed && mu.bed !== 'none' ? mu.bed : null, energy: mu.energy || null, beatSync: mu['beat-sync'] || null }, punch: st.punch || null,
  };
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
  for (const g of found.graphics) add(`graphic:${g}`, 'graphic seen on screen');
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
  if (want('entrance')) for (const e of ex.entrances || []) picks[`entrance:${e}`] = 'allow';
  if (want('finish')) for (const f of ex.finishes || []) picks[`finish:${f}`] = 'allow';
  if (want('graphic')) for (const g of ex.graphics || []) picks[`graphic:${g}`] = 'allow';
  if (want('effect')) for (const e of ex.effects || []) picks[`effect:${e}`] = 'allow';
  if (want('captionStyle') && ex.captionStyle && cat.items[`captionStyle:${ex.captionStyle}`]) picks[`captionStyle:${ex.captionStyle}`] = 'allow';
  if (want('bed') && ex.music && ex.music.bed && cat.items[`bed:${ex.music.bed}`]) picks[`bed:${ex.music.bed}`] = 'allow';
  if (want('beatSync') && ex.music && ex.music.beatSync === 'on' && cat.items['beatSync:beat-sync']) picks['beatSync:beat-sync'] = 'allow';
  return picks;
}

export function influencePack(ex, job, basePack) {
  const base = basePack ? K.load(basePack) : null;
  const presets = require('../preset.cjs').list().map(x => x.name);
  const ext = base ? base.extends : ex.preset && presets.includes(ex.preset) ? ex.preset : 'aigent';
  const style = { ...(base ? base.style || {} : {}) }, bl = (base && base.locks) || {};
  const inLock = (key, v) => !bl[key] || bl[key].includes(v);
  if (ex.look) style.look = ex.look;
  if (ex.captionStyle) style.captionStyle = ex.captionStyle;
  const ents = ex.entrances.filter(e => inLock('titles', e)); if (ents.length) style.entranceOrder = ents;
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
