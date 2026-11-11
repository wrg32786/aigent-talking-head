// Cinematic SFX pack: load kit/sfx/sfx.json, validate it, and auto-pick sounds for effect hits.
// Used by assemble.cjs, fx.cjs, check.mjs and smoke.mjs. The locked cut.json set (whoosh, swipe,
// boom, click, typing, F, D) lives in rules.cjs and is unchanged.
const fs = require('fs');
const path = require('path');
const KIT = __dirname;
const MANIFEST = path.join(KIT, 'sfx', 'sfx.json');
const CATEGORIES = ['hit', 'riser', 'release', 'whoosh', 'swipe', 'pop', 'ui', 'glitch', 'camera', 'paper', 'counter', 'sub', 'shimmer'];

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function soundPath(s, man) {
  const file = typeof s === 'string' ? (loadManifest().sounds.find(x => x.id === s) || {}).file : s.file;
  return file ? path.join(KIT, 'sfx', file) : null;
}

function lookup(id, man) {
  const M = man || loadManifest();
  return (M.sounds || []).find(s => s.id === id) || null;
}

// Errors (fail check) and notes (warnings).
function validateManifest(man) {
  const M = man || loadManifest();
  const errs = [], warns = [];
  const cats = new Set(M.categories || CATEGORIES);
  for (const c of CATEGORIES) if (!cats.has(c)) errs.push(`sfx.json missing category "${c}"`);
  const ids = new Set();
  if (!Array.isArray(M.sounds) || M.sounds.length < 1) errs.push('sfx.json has no sounds');
  for (const s of M.sounds || []) {
    if (!s.id) { errs.push('sound missing id'); continue; }
    if (ids.has(s.id)) errs.push(`duplicate sound id "${s.id}"`);
    ids.add(s.id);
    if (!s.file) errs.push(`${s.id}: missing file`);
    else if (!fs.existsSync(path.join(KIT, 'sfx', s.file))) errs.push(`${s.id}: file not found (kit/sfx/${s.file})`);
    if (!s.license) errs.push(`${s.id}: missing license`);
    if (!s.source) errs.push(`${s.id}: missing source`);
    if (!CATEGORIES.includes(s.category)) errs.push(`${s.id}: unknown category "${s.category}"`);
    if (!(s.duration > 0)) errs.push(`${s.id}: duration must be > 0`);
    if (!(s.hit >= 0) || s.hit > (s.duration || 0) + 0.05) errs.push(`${s.id}: hit point ${s.hit} is outside the sound`);
    if (!(s.gain > 0) || s.gain > 2) errs.push(`${s.id}: gain ${s.gain} looks wrong`);
  }
  const byName = {};
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(KIT, '..', 'effects', 'catalog.json'), 'utf8'));
    for (const e of cat.effects || []) byName[e.name] = e;
  } catch {}
  for (const [name, spec] of Object.entries(M.effects || {})) {
    if (byName[name] === undefined && Object.keys(byName).length) warns.push(`sfx.json maps unknown effect "${name}"`);
    if (!CATEGORIES.includes(spec.category)) errs.push(`effect ${name}: unknown category "${spec.category}"`);
  }
  for (const name of Object.keys(byName)) if (!M.effects || !M.effects[name]) warns.push(`no sfx category mapped for effect "${name}"`);
  return { errs, warns };
}

function defaultMap(name, man) {
  const M = man || loadManifest();
  return (M.effects && M.effects[name]) || { category: 'whoosh', hit: 0.08 };
}

// Auto-pick a sound per effect hit. No-repeat rotation within a category; risers end on the hit
// for build moments; releases start just after heavy hits; fewer and deeper (one primary per
// effect, riser/release only on marked moments, skip a stacked primary within 0.2 s).
function planHits(effects, opts = {}) {
  const M = opts.manifest || loadManifest();
  if (opts.off) return [];
  const pool = M.sounds || [];
  const byCat = {};
  for (const s of pool) (byCat[s.category] = byCat[s.category] || []).push(s);
  const rot = {}, used = new Set();
  function pick(cat, prefer) {
    const list = byCat[cat] || [];
    if (!list.length) return null;
    if (prefer) {
      const hit = list.find(s => s.id === prefer);
      if (hit && !used.has(hit.id)) { used.add(hit.id); return hit; }
    }
    const start = rot[cat] || 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[(start + i) % list.length];
      if (!used.has(s.id)) { used.add(s.id); rot[cat] = (start + i + 1) % list.length; return s; }
    }
    // category exhausted: allow a repeat, still rotate
    const s = list[start % list.length];
    rot[cat] = (start + 1) % list.length;
    return s;
  }
  const rows = [];
  const list = (effects || []).filter(e => e && e.sfx !== false && e.fx && e.end > e.start)
    .slice().sort((a, b) => a.start - b.start);
  let lastT = -99;
  list.forEach((e, i) => {
    const spec = defaultMap(e.fx, M);
    const hitAt = e.start + (spec.hit ?? 0.08);
    const override = typeof e.sfx === 'string' && e.sfx ? e.sfx : null;
    let primary;
    if (override) {
      primary = lookup(override, M);
      if (!primary) throw new Error(`unknown sfx "${override}" on ${e.fx} (see kit/sfx/sfx.json)`);
      used.add(primary.id);
    } else if (hitAt - lastT < 0.2 && i > 0) {
      // fewer and deeper: two effects landing on top of each other share the earlier sound
      primary = null;
    } else {
      primary = pick(spec.category);
    }
    if (primary) {
      rows.push({ id: primary.id, t: +hitAt.toFixed(3), gain: primary.gain, hit: primary.hit, fx: e.fx, role: 'primary' });
      lastT = hitAt;
    }
    // riser ends on the hit, only for moments marked riser in the manifest (hook builds, huge-strike, ...)
    if (spec.riser && (!primary || primary.category !== 'riser')) {
      const r = pick('riser');
      if (r) rows.push({ id: r.id, t: +hitAt.toFixed(3), gain: r.gain, hit: r.hit, fx: e.fx, role: 'riser' });
    }
    if (spec.release) {
      const rel = pick('release');
      if (rel) {
        const t = +(hitAt + 0.22).toFixed(3);
        rows.push({ id: rel.id, t, gain: rel.gain, hit: rel.hit, fx: e.fx, role: 'release' });
      }
    }
  });
  return rows;
}

module.exports = { CATEGORIES, MANIFEST, loadManifest, lookup, soundPath, validateManifest, defaultMap, planHits };
