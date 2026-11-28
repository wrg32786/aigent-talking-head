// Mix parts of several teardowns or saved looks into one style look (Teardowns tab).
// A part is one of the Influence parts: captions, titles, transitions, grade, effects, graphics, pace, sound, fonts.
// The mixed look has no script, title words or timeline from any reference.
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SL = require('../stylelook.cjs');

export const PARTS = [
  { id: 'captions', label: 'Captions', keys: ['captions'] },
  { id: 'titles', label: 'Titles', keys: ['titles'] },
  { id: 'transitions', label: 'Transitions', keys: ['transitions'] },
  { id: 'grade', label: 'Grade', keys: ['grade'] },
  { id: 'effects', label: 'Effects', keys: ['moves'] },
  { id: 'graphics', label: 'Graphics', keys: ['stickers', 'broll'] },
  { id: 'pace', label: 'Pace', keys: ['pace'] },
  { id: 'sound', label: 'Music and sound', keys: ['music', 'sfx', 'loudness', 'musicKeys'] },
  { id: 'fonts', label: 'Fonts and theme', keys: ['brand'] },
];
export const PART_IDS = PARTS.map(p => p.id);
// the Reel.md Style lines the draft reads for each part (stylelook toRecipe: look.style), so a mixed part reaches the
// video and not only the card: the caption style from the captions source, the finish from the grade source, and so on
const STYLE_OF = { captions: /^(captions|look|running-captions|caption-.+)$/, titles: /^(titles|title-.+)$/, transitions: /^(transition|glitch)$/,
  grade: /^finish$/, effects: /^(punch|effects)$/, graphics: /^(stickers?|graphics?)$/, sound: /^sfx-.+$/, fonts: /^font(-.+)?$/ };
const fail = (msg, code = 400) => { throw Object.assign(new Error(msg), { code }); };
const clone = x => (x == null ? x : structuredClone(x));

// Resolve a source { kind: 'look', name } or { kind: 'teardown', id } to a look and a short title.
export function resolveSource(src, { queue = [], root } = {}) {
  if (!src || typeof src !== 'object') fail('Pick a video or a saved look for each part.');
  if (src.kind === 'look') {
    const name = String(src.name || '');
    const look = SL.NAME_RE.test(name) ? SL.load(name) : null; // a name, never a path
    if (!look) fail(`No saved look "${name}".`, 404);
    return { look, title: look.label || look.name, kind: 'look', name: look.name };
  }
  if (src.kind === 'teardown') {
    const id = +src.id;
    const it = (queue || []).find(x => x.id === id && x.status === 'ready' && x.out);
    if (!it) fail('That video is not broken down yet.');
    if (!root) fail('We could not find that video\'s teardown.');
    let look;
    try { look = SL.fromTeardown(join(root, it.out)); }
    catch (e) { fail(`We could not read the look of that video: ${e.message}`); }
    const title = it.title || (it.file && String(it.file).split(/[\\/]/).pop()) || look.name;
    return { look, title, kind: 'teardown', id: it.id, out: it.out };
  }
  fail('Each part needs a video or a saved look.');
}

export function mixLooks({ name, parts, base, titles } = {}) {
  const srcs = parts && typeof parts === 'object' ? parts : {};
  const used = PART_IDS.filter(id => srcs[id] && srcs[id].look);
  if (!used.length) fail('Pick at least one part from a video or a saved look.');
  const baseLook = (base && base.look) || srcs[used[0]].look;
  const out = clone(baseLook);
  delete out.file;
  const n = SL.slug(name || out.name || 'mixed-look');
  if (!SL.NAME_RE.test(n)) fail('Give the look a name with letters or numbers.');
  out.name = n;
  out.label = String(titles && titles.label || name || n).trim().slice(0, 60) || n.replace(/-/g, ' ');
  out.created = new Date().toISOString();
  const mixParts = {};
  for (const p of PARTS) {
    const src = srcs[p.id] || base;
    const look = (src && src.look) || baseLook;
    for (const k of p.keys) if (look[k] !== undefined) out[k] = clone(look[k]);
    const re = STYLE_OF[p.id];
    if (re && look !== baseLook) { out.style = { ...(out.style || {}) }; for (const k of Object.keys(out.style)) if (re.test(k)) delete out.style[k]; for (const [k, v] of Object.entries(look.style || {})) if (re.test(k)) out.style[k] = v; }
    const title = (src && src.title) || look.name;
    mixParts[p.id] = { title, kind: (src && src.kind) || 'look', ...(src && src.name ? { name: src.name } : {}), ...(src && src.out ? { out: src.out } : {}) };
  }
  // fonts from a different look also set the caption and title font fields
  const fontSrc = srcs.fonts && srcs.fonts.look;
  if (fontSrc) {
    const font = (fontSrc.captions && fontSrc.captions.font) || (fontSrc.titles && fontSrc.titles.font) || null;
    if (font && out.captions) out.captions = { ...out.captions, font: clone(font) };
    if (font && out.titles) out.titles = { ...out.titles, font: clone(font) };
  }
  const unique = [...new Set(Object.values(mixParts).map(x => x.title))];
  out.mix = {
    base: { title: (base && base.title) || baseLook.name, kind: (base && base.kind) || 'look', ...(base && base.name ? { name: base.name } : {}), ...(base && base.out ? { out: base.out } : {}) },
    parts: mixParts,
  };
  out.from = { reference: null, teardown: unique.length > 1 ? 'mixed' : (baseLook.from && baseLook.from.teardown) || 'mixed', duration: (baseLook.from && baseLook.from.duration) || null };
  const errs = SL.validate(out);
  if (errs.length) fail('We could not build that look: ' + errs.join('; '));
  return out;
}

// Build and save a mixed look from API sources. sources: { captions: { kind, name|id }, ... }
export function mixAndSave(raw, { queue, root } = {}) {
  const name = SL.slug(raw && raw.name);
  if (!name || !SL.NAME_RE.test(name)) fail('Give the look a name with letters or numbers.');
  if (SL.exists(name)) fail('You already have a look with that name. Pick another name.', 409); // a mix never replaces a saved look
  const rawParts = (raw && raw.parts) || {};
  const bad = Object.keys(rawParts).filter(k => !PART_IDS.includes(k));
  if (bad.length) fail(`Unknown part: ${bad.join(', ')}.`);
  const resolved = {};
  for (const id of PART_IDS) {
    if (!rawParts[id]) continue;
    resolved[id] = resolveSource(rawParts[id], { queue, root });
  }
  if (!Object.keys(resolved).length) fail('Pick at least one part from a video or a saved look.');
  const base = raw && raw.base ? resolveSource(raw.base, { queue, root }) : resolved[PART_IDS.find(id => resolved[id])] ;
  const look = mixLooks({ name, parts: resolved, base, titles: { label: raw.label || raw.name } });
  return SL.save(look, name);
}

export function mixSummary(look) {
  if (!look || !look.mix || !look.mix.parts) return null;
  const titles = [...new Set(Object.values(look.mix.parts).map(x => x.title).filter(Boolean))];
  if (titles.length < 2) return null;
  return `Mixed from ${titles.join(', ')}`;
}
