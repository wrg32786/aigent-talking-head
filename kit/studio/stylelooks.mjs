// Studio and style looks (Copy the look). A style look is the style of a reference, saved under a name, with none of
// its timeline or words (kit/stylelook.cjs). Here: which look the next draft uses, saving the reference's look, the
// list the page shows, and the fidelity read-out of a draft (kit/fidelity.cjs, build/match.json). No server, no network.
//   reference mode "look" (Copy the look): the reference's own look, saved as look-<job> on every draft
//   state.styleLook: a saved look, used when no reference is in use (mode off, or none broken down)
//   a reference on recreate or influence wins over state.styleLook
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { styleKey } from './reference.mjs';
import * as MIX from './lookmix.mjs';
import * as SAMP from './look-sample.mjs';
import * as TPL from './templates.mjs';

const require = createRequire(import.meta.url);
const SL = require('../stylelook.cjs');
const FID = require('../fidelity.cjs');

export const MODES = ['influence', 'recreate', 'look', 'off'];
export const slug = SL.slug;
export const exists = name => typeof name === 'string' && SL.exists(name);
export const jobLookName = job => SL.slug('look-' + job);
const fail = (msg, code = 400) => Object.assign(new Error(msg), { code });

// the saved looks, read again only when a look file changed
let cache = { sig: null, looks: [] };
export function list() {
  let sig = '';
  try { const d = SL.dirOf(); sig = d + '|' + readdirSync(d).sort().map(n => { try { return n + ':' + statSync(SL.fileOf(n)).mtimeMs; } catch { return ''; } }).join(','); } catch {}
  if (cache.sig !== sig) { let looks = []; try { looks = sig ? SL.list() : []; } catch {} cache = { sig, looks }; }
  return cache.looks;
}

// the reference's teardown folder, once it is broken down (it holds its Reel.md)
export function refDir(s, root) {
  const r = s.reference || {};
  return r.out && existsSync(join(root, r.out, 'Reel.md')) ? join(root, r.out) : null;
}
// which style look the next draft uses, or null:
//   { kind: 'reference', name, dir }  Copy the look: the reference's own, saved as look-<job>
//   { kind: 'saved', name }           state.styleLook, with no reference in use
//   { kind: 'missing', name }         state.styleLook names a look that is gone
export function plan(s, root) {
  const r = s.reference || {}, dir = refDir(s, root);
  if (r.mode === 'look' && dir) return { kind: 'reference', name: jobLookName(s.job || 'reference'), dir };
  if (r.extracted && (r.mode === 'recreate' || r.mode === 'influence')) return null;
  if (styleKey(r)) return null; // a reference you chose to copy, still being read or its folder gone: never the last video's saved look
  if (!s.styleLook) return null;
  return { kind: exists(s.styleLook) ? 'saved' : 'missing', name: s.styleLook };
}
// the look name Your edit shows (null when the next draft uses none)
export function inUse(s, root) { const p = plan(s, root); return p && p.kind !== 'missing' ? p.name : null; }

// make the look from a teardown folder and save it under name (replaces one of the same name)
export function saveFrom(dir, name) {
  let look; try { look = SL.fromTeardown(dir, { name }); } catch (e) { throw fail(`We could not read the look of this reference: ${e.message}`); }
  return SL.save(look, name);
}
// Save the current reference's look under a name the user chose. Returns { name, file }.
export function saveCurrent(s, root, rawName) {
  const name = SL.slug(rawName);
  if (!name || !SL.NAME_RE.test(name)) throw fail('Give the look a name with letters or numbers.');
  const dir = refDir(s, root);
  if (!dir) throw fail('Add a reference and let us break it down first. Then we can save its look.');
  return saveFrom(dir, name);
}

// The draft's reel arguments for a style look: like Recreate, no pack (the look names its own style), then
// --style-look <name>. Never --recipe or --recut: your words and your timing. Returns what was done, or null:
//   { name, kind, note }   the look in use (a reference's look is saved here first)
//   { clear: true, note }  state.styleLook is gone: the draft goes on without it and the caller clears the field
export function forDraft(s, root, args) {
  const p = plan(s, root); if (!p) return null;
  if (p.kind === 'missing') return { name: null, clear: true, note: `The saved look "${p.name}" is no longer there, so we drafted without it.` };
  const name = p.kind === 'reference' ? saveFrom(p.dir, p.name).name : p.name;
  const i = args.indexOf('--pack'); if (i >= 0) args.splice(i, 2);
  args.push('--style-look', name);
  return { name, kind: p.kind, note: p.kind === 'reference' ? `Copy the look: we saved the style of the reference as "${name}" and used it on your take.` : `Using your saved look "${name}".` };
}

// how close the current draft is to what it copies (build/match.json), or null
// the font a saved look carries (the pairing a teardown matched), or null
// a saved look by its name only: SL.load also takes a path, which a page must not reach
const saved = name => (SL.NAME_RE.test(String(name || '')) ? SL.load(name) : null);
export const fontOf = name => { try { const l = name ? saved(name) : null; return (l && l.captions && l.captions.font) || null; } catch { return null; } };
export const matchOf = build => (build ? FID.read(build) : null);


// Teardowns Look library: a list the page can show, plus rename, duplicate and delete.
export function listView() {
  return list().map(x => {
    const look = SL.load(x.name);
    const sample = look ? SAMP.statusOf(x.name, look) : { status: 'missing' };
    return {
      ...x,
      label: (look && look.label) || x.name.replace(/-/g, ' '),
      mix: look ? MIX.mixSummary(look) : null,
      sample: { status: sample.status, url: sample.url || null },
    };
  });
}

export function rename(name, label) {
  const look = saved(name);
  if (!look) throw fail('No such look.', 404);
  const l = String(label || '').trim().slice(0, 60);
  if (!l) throw fail('Give the look a name.');
  look.label = l;
  delete look.file;
  SL.save(look, name);
  return listView().find(x => x.name === name);
}

export function duplicate(name) {
  const look = saved(name);
  if (!look) throw fail('No such look.', 404);
  const base = SL.slug(name).slice(0, 48).replace(/-+$/, '');
  let n = `${base}-copy`;
  for (let i = 2; SL.exists(n); i++) {
    if (i > 999) throw fail('Too many copies of this look. Rename or delete some first.', 409);
    n = `${base}-copy-${i}`;
  }
  const out = { ...look, name: n, label: `${(look.label || look.name).replace(/ copy$/, '')} copy`, created: new Date().toISOString() };
  delete out.file;
  SL.save(out, n);
  try { SAMP.copySample(name, n); } catch {}
  return listView().find(x => x.name === n);
}

export function removeLook(name) {
  if (!SL.exists(name)) throw fail('No such look.', 404);
  // the look shares its folder with its template: the Template Library's remove says which templates use it and keeps it
  TPL.remove(name);
  return true;
}

export const mixAndSave = (raw, ctx) => MIX.mixAndSave(raw, ctx);
export const sampleStatus = (name, look) => SAMP.statusOf(name, look);
export const buildSample = (name, opts) => SAMP.build(name, opts);
