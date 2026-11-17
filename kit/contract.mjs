// Contract drift check: contract.json (the machine-readable command list for agents) must match the real CLIs.
//   node kit/contract.mjs        -> prints CONTRACT PASS or each drift, exit 1 on drift
//   npm run check                -> runs the same check (no job argument)
// What it compares, per command: the npm script points at the contract's script; every --flag the script reads
// (through its flag, opt and argv.includes helpers, and reel's caption-look loop) is in the contract and nothing extra is;
// a script's VALUED set matches the contract's non-boolean flags; enum values match the constants they come from;
// literal defaults passed to opt match; reelmd's subcommands match; every npm script is in the contract; the graphics
// section matches kit/graphics.json and the glyph list.
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const req = createRequire(import.meta.url);

// the values an enum flag takes, read from the kit's own constants
function sourceValues(ref, flagName) {
  const [file, name] = ref.split(' ');
  const mod = req(join(ROOT, file));
  if (name === 'CAPTION_LOOK') return mod.CAPTION_LOOK[flagName] && mod.CAPTION_LOOK[flagName][1];
  if (name === 'MASK_MODELS') return Object.keys(mod.MASK_MODELS);
  if (name === 'FINISH') return null; // FINISH is not exported; compared against the source text below
  return mod[name];
}

function scriptFlags(src) {
  const flags = new Map(); // name -> { valued, default }
  const add = (n, valued, def) => { const f = flags.get(n) || { valued: false, def: undefined }; if (valued) f.valued = true; if (def !== undefined) f.def = def; flags.set(n, f); };
  for (const m of src.matchAll(/\b(flag|opt)\(\s*'([a-z0-9-]+)'\s*(?:,\s*([^)]*))?\)/g)) {
    const lit = m[3] && /^('[^']*'|-?\d+(\.\d+)?)$/.test(m[3].trim()) ? m[3].trim().replace(/^'|'$/g, '') : undefined;
    add(m[2], m[1] === 'opt', lit);
  }
  for (const m of src.matchAll(/argv\.(?:includes|indexOf)\(\s*'--([a-z0-9-]+)'\s*\)/g)) add(m[1], false);
  return flags;
}

export function checkContract() {
  const errs = [];
  const C = JSON.parse(readFileSync(join(ROOT, 'contract.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (C.version !== pkg.version) errs.push(`contract version ${C.version} != package.json ${pkg.version}`);
  if (!existsSync(join(ROOT, C.skill || 'SKILL.md'))) errs.push(`skill file ${C.skill} is missing`);
  // graphics: every type in kit/graphics.json with its mode, entrance, exit, worded fields and field names; the glyph list
  const GJ = JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics, CG = (C.graphics && C.graphics.types) || [];
  const gsig = g => JSON.stringify([g.id, g.mode, g.entrance, g.exit || 'fade', g.spoken || [], g.required || [], Array.isArray(g.fields) ? g.fields : Object.keys(g.fields || {})]);
  if (GJ.map(gsig).join('\n') !== CG.map(gsig).join('\n')) for (const g of GJ) { const c = CG.find(x => x.id === g.id); if (!c) errs.push(`graphic ${g.id} (kit/graphics.json) is not in contract.json graphics`); else if (gsig(c) !== gsig(g)) errs.push(`graphic ${g.id}: contract.json ${gsig(c)} != kit/graphics.json ${gsig(g)}`); }
  for (const c of CG) if (!GJ.some(g => g.id === c.id)) errs.push(`contract.json graphic ${c.id} is not in kit/graphics.json`);
  const glyphs = req(join(KIT, 'reelmd.cjs')).GLYPHS;
  if (((C.graphics && C.graphics.glyphs) || []).join(',') !== glyphs.join(',')) errs.push(`contract.json graphics glyphs != kit/reelmd.cjs GLYPHS ${JSON.stringify(glyphs)}`);
  const byName = new Map(C.commands.map(c => [c.name, c]));
  for (const s of Object.keys(pkg.scripts)) if (!byName.has(s)) errs.push(`npm script "${s}" is not in contract.json`);
  for (const c of C.commands) {
    const script = pkg.scripts[c.name];
    if (!script) { errs.push(`${c.name}: no npm script of that name`); continue; }
    if (c.alias) {
      const base = byName.get(c.alias);
      const want = ['node', base && base.script, ...(c.args || [])].join(' ');
      if (script !== want) errs.push(`${c.name}: npm script is "${script}", contract says "${want}"`);
      continue;
    }
    if (script !== `node ${c.script}`) { errs.push(`${c.name}: npm script is "${script}", contract says "node ${c.script}"`); continue; }
    const file = join(ROOT, c.script);
    if (!existsSync(file)) { errs.push(`${c.name}: ${c.script} is missing`); continue; }
    const src = readFileSync(file, 'utf8');
    const code = scriptFlags(src);
    if (/Object\.entries\(RM\.CAPTION_LOOK\)/.test(src)) for (const k of Object.keys(req(join(KIT, 'reelmd.cjs')).CAPTION_LOOK)) code.set(k, { valued: true });
    const listed = new Map((c.flags || []).map(f => [f.name, f]));
    for (const n of code.keys()) if (!listed.has(n)) errs.push(`${c.name}: ${c.script} reads --${n}, contract.json does not list it`);
    for (const n of listed.keys()) if (!code.has(n)) errs.push(`${c.name}: contract.json lists --${n}, ${c.script} never reads it`);
    for (const [n, f] of listed) {
      const k = code.get(n);
      if (!k) continue;
      if (k.valued && f.type === 'boolean') errs.push(`${c.name} --${n}: the script reads a value, contract says boolean`);
      if (!k.valued && f.type !== 'boolean') errs.push(`${c.name} --${n}: the script reads it as a switch, contract says ${f.type}`);
      if (k.def !== undefined && String(f.default) !== k.def) errs.push(`${c.name} --${n}: default in code is ${k.def}, contract says ${f.default}`);
      if (f.values_from) {
        const want = f.values_from.endsWith(' FINISH')
          ? [...readFileSync(join(ROOT, f.values_from.split(' ')[0]), 'utf8').match(/const FINISH = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s+'?([a-z-]+)'?:/gm)].map(m => m[1])
          : sourceValues(f.values_from, n);
        if (!want) errs.push(`${c.name} --${n}: cannot read ${f.values_from}`);
        else if (want.join(',') !== (f.values || []).join(',')) errs.push(`${c.name} --${n}: values ${JSON.stringify(f.values)} != ${f.values_from} ${JSON.stringify(want)}`);
      }
    }
    const valued = src.match(/const VALUED = new Set\(\[([^\]]*)\]\)/);
    if (valued) {
      const v = [...valued[1].matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]).sort();
      const nb = (c.flags || []).filter(f => f.type !== 'boolean').map(f => f.name).sort();
      if (v.join(',') !== nb.join(',')) errs.push(`${c.name}: VALUED in ${c.script} is [${v}], contract non-boolean flags are [${nb}]`);
    }
    if (c.subcommands) {
      const have = [...new Set([...src.matchAll(/cmd === '([a-z]+)'/g)].map(m => m[1]))].filter(x => x !== 'help').sort();
      const want = c.subcommands.map(s => s.name).sort();
      if (have.join(',') !== want.join(',')) errs.push(`${c.name}: subcommands in code [${have}], contract [${want}]`);
    }
  }
  return errs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errs = checkContract();
  errs.forEach(e => console.log('  error: ' + e));
  console.log(errs.length ? `\n${errs.length} contract drift error(s). Update contract.json (and SKILL.md) to match the CLI.` : 'CONTRACT PASS');
  process.exit(errs.length ? 1 : 0);
}
