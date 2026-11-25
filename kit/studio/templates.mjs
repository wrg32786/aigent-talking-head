// Saved templates (docs/specs/studio-builder.md section 5): looks/local/<name>/template.json next to an optional
// look.json, local and out of git (LOOKS_DIR), as style looks are. Phase 7 saves one from the builder's Make it step;
// the Template Library (list, rename, duplicate, remove, preview) builds on this file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import * as VP from './wizard/plan.mjs';

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
