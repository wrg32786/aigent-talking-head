// The Template Library store (docs/specs/studio-builder.md section 5): looks/local/<name>/template.json next to an
// optional look.json, local and out of git (LOOKS_DIR), as style looks are.
//   list(cat)              saved templates, saved looks with no template.json (their plan derived), the six starter packs
//   save(name, { plan })   from the builder's Make it step; saveFromLook(name, look, from) after a teardown
//   rename, duplicate, remove (the page asks first), planFor(name, cat) the plan a template starts a video with
// Starters are read only: Duplicate one to make it yours. A look you saved stays a look: Rename only sets its label.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import * as VP from './wizard/plan.mjs';
import { planFromLook } from './wizard/from-look.mjs';

const require = createRequire(import.meta.url);
const SL = require('../stylelook.cjs');
export const FORMAT = 'aigent-template', VERSION = 1;
const fail = (msg, code = 400) => Object.assign(new Error(msg), { code });
export const fileOf = name => join(SL.dirOf(), name, 'template.json');
export const exists = name => typeof name === 'string' && SL.NAME_RE.test(name) && existsSync(fileOf(name));
export function load(name) { try { const t = JSON.parse(readFileSync(fileOf(name), 'utf8')); return t && t.format === FORMAT ? t : null; } catch { return null; } }
// a short name from the plan when you give none: "lively kinetic", then "lively kinetic 2" and so on
function nameFor(plan) {
  const base = SL.slug([plan.pace !== 'look' ? plan.pace : 'my', plan.words.type === 'kinetic' ? 'kinetic' : plan.words.type === 'captions' ? 'captions' : 'video'].join(' '));
  for (let i = 1; i < 100; i++) { const n = i === 1 ? base : `${base}-${i}`; if (!existsSync(join(SL.dirOf(), n))) return n; }
  return SL.slug(base + '-' + Date.now());
}
// save(rawName | '', { plan, from }) -> { name, label, file }. The plan is kept without notes (a template is a look,
// not one video's words); a name already used is refused, so nothing is written over.
export function save(rawName, { plan, from = { kind: 'builder' }, cat = null } = {}) {
  const v = VP.validate(plan, cat); if (!v.ok) throw fail(v.errs.join(' '));
  const p = VP.normalize(plan); p.notes = '';
  if (p.music.bed === 'upload') p.music.bed = 'auto'; // your uploaded track stays with this video
  const label = String(rawName || '').trim().slice(0, 60), name = label ? SL.slug(label).replace(/^-+|-+$/g, '') : nameFor(p);
  if (!name || !SL.NAME_RE.test(name)) throw fail('Give the template a name with letters or numbers.');
  if (existsSync(join(SL.dirOf(), name))) throw fail(`You already have a template or look called ${name}. Pick another name.`, 409);
  const t = { format: FORMAT, version: VERSION, name, label: label || name.replace(/-/g, ' '), createdAt: new Date().toISOString(), from, plan: p,
    summary: Object.fromEntries(VP.summary(p, cat).map(r => [r.step, r.text])), preview: null };
  mkdirSync(join(SL.dirOf(), name), { recursive: true });
  try { writeFileSync(fileOf(name), JSON.stringify(t, null, 2) + '\n', { flag: 'wx' }); }
  catch (e) { throw e.code === 'EEXIST' ? fail(`You already have a template called ${name}. Pick another name.`, 409) : fail(`We could not save the template: ${e.message}`, 500); }
  return { name, label: t.label, file: fileOf(name) };
}

// ---------- the library ----------
const STARTER = p => p.shipped && !/^ref-/.test(p.name);
const starters = cat => ((cat && cat.packs) || []).filter(STARTER);
const lookOf = name => { try { return SL.load(name); } catch { return null; } };
const writeT = (name, t) => { mkdirSync(join(SL.dirOf(), name), { recursive: true }); writeFileSync(fileOf(name), JSON.stringify(t, null, 2) + '\n'); };
const SOURCE = { builder: 'Built by you', 'teardown-url': 'From a link', 'teardown-file': 'From a file', teardown: 'From a teardown', starter: 'Starter', copy: 'Your copy' };
// one card: { name, label, kind: template | look | pack, source (plain words), from, createdAt, pace, preview, readOnly }
export function list(cat = null) {
  const out = [], dir = SL.dirOf(); let names = [];
  try { names = readdirSync(dir).filter(n => SL.NAME_RE.test(n)).sort(); } catch {}
  for (const n of names) {
    const t = load(n), look = existsSync(SL.fileOf(n)) ? lookOf(n) : null;
    if (t) { const fk = (t.from && t.from.kind) || 'builder', src = t.from && (t.from.url || t.from.file);
      out.push({ name: n, label: t.label || n, kind: 'template', look: !!look, source: SOURCE[fk] || 'Yours', from: src || null, createdAt: t.createdAt || null, pace: (t.plan && t.plan.pace) || 'look', preview: previewOf(t.plan, cat), readOnly: false }); }
    else if (look) out.push({ name: n, label: n.replace(/-/g, ' '), kind: 'look', look: true, source: 'From a teardown', from: (look.from && (look.from.reference || look.from.teardown)) || null, createdAt: look.created || null, pace: planFromLook(look, cat).pace, preview: null, readOnly: false });
  }
  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  for (const p of starters(cat)) out.push({ name: p.name, label: p.name.replace(/-/g, ' '), line: p.label || p.description || '', kind: 'pack', source: 'Starter', from: null, createdAt: null, pace: 'look', preview: p.preview || null, readOnly: true });
  return out;
}
// a saved template's picture: the starter it came from, when it came from one
function previewOf(plan, cat) { const t = plan && plan.template; if (!t || t.kind !== 'pack') return null; const p = starters(cat).find(x => x.name === t.name); return p ? p.preview || null : null; }
const find = (name, cat) => list(cat).find(x => x.name === name) || null;
const need = (name, cat) => { const x = typeof name === 'string' ? find(name, cat) : null; if (!x) throw fail(`We do not have a template called ${name}.`, 404); return x; };
// the plan a template starts a new video with: a saved template's own plan; a look or a starter leaves every choice to
// it (plan.mjs fromTemplate). edit: true makes a look's choices your own, one step each (from-look.mjs), for Edit in builder
export function planFor(name, cat = null, { edit = false } = {}) {
  const x = need(name, cat);
  if (x.kind === 'template') { const t = load(name); return VP.normalize({ ...t.plan, notes: '' }); }
  if (x.kind === 'look') return edit ? planFromLook(lookOf(name), cat) : VP.fromTemplate({ kind: 'look', name });
  return VP.fromTemplate({ kind: 'pack', name });
}
// after a teardown: the look you just saved, as a template with its plan derived from it
export function saveFromLook(name, from = { kind: 'teardown' }, cat = null) {
  const look = lookOf(name); if (!look) throw fail(`We could not read the look ${name}.`);
  const p = planFromLook(look, cat); p.template = { kind: 'look', name };
  const t = { format: FORMAT, version: VERSION, name, label: name.replace(/-/g, ' '), createdAt: new Date().toISOString(), from, plan: p,
    summary: Object.fromEntries(VP.summary(p, cat).map(r => [r.step, r.text])), preview: null };
  writeT(name, t); return { name, label: t.label, file: fileOf(name) };
}
export function rename(name, label, cat = null) {
  const x = need(name, cat), l = String(label || '').trim().slice(0, 60);
  if (x.readOnly) throw fail('Starter templates cannot be renamed. Duplicate it first.');
  if (!l) throw fail('Give the template a name.');
  if (x.kind === 'template') { const t = load(name); t.label = l; writeT(name, t); }
  else { const p = planFromLook(lookOf(name), cat); p.template = { kind: 'look', name }; writeT(name, { format: FORMAT, version: VERSION, name, label: l, createdAt: new Date().toISOString(), from: { kind: 'teardown' }, plan: p, summary: {}, preview: null }); }
  return find(name, cat);
}
// a copy you can change: its own folder, template.json only (a look's style stays with the look it points to)
export function duplicate(name, cat = null) {
  const x = need(name, cat), plan = x.kind === 'template' ? load(name).plan : x.kind === 'look' ? { ...planFromLook(lookOf(name), cat), template: { kind: 'look', name } } : VP.fromTemplate({ kind: 'pack', name });
  let n = SL.slug(name + '-copy'); for (let i = 2; existsSync(join(SL.dirOf(), n)); i++) n = SL.slug(`${name}-copy-${i}`);
  const t = { format: FORMAT, version: VERSION, name: n, label: `${x.label} copy`, createdAt: new Date().toISOString(), from: { kind: 'copy', of: name }, plan: VP.normalize({ ...plan, notes: '' }), summary: {}, preview: null };
  writeT(n, t); return find(n, cat);
}
// remove a saved template or look (the page asks first). Starters stay.
export function remove(name, cat = null) {
  const x = need(name, cat); if (x.readOnly) throw fail('Starter templates cannot be deleted.');
  if (!SL.NAME_RE.test(name)) throw fail('No such template.');
  rmSync(join(SL.dirOf(), name), { recursive: true, force: true }); return true;
}
