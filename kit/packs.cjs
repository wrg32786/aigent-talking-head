// Style packs: a whole look in one shareable, versioned folder. A pack names a base preset (kit/presets), overrides any
// of its style keys, and pins choices with locks (kit/locks.cjs), so the auto-picker stays inside what you chose.
//
//   packs/<name>/pack.json     the pack (JSON Schema: packs/pack.schema.json)
//   packs/<name>/README.md     what it is for, in plain words
//   packs/<name>/preview.webp  a looping preview, and preview.png a still strip (npm run pack:preview -- <name>)
//
//   npm run pack                               list every pack (shipped in packs/, yours in packs/local/)
//   npm run pack -- list --json                the same as JSON
//   npm run pack -- show <name|path> [--json]  one pack, resolved: the merged style and its locks
//   npm run pack:new -- <name> [--from <preset|pack|job>] [--dir <folder>] [--lock "..."] [--force]
//                                              scaffold a pack (default from the aigent preset) into packs/local/<name>
//   npm run pack:validate [-- <name|path> ...] check packs against the schema and the kit's catalogs (all when none given)
//   npm run reel -- <clip> --pack <name|path>  make a reel with it; flags and --lock still win
// Shipped packs live in packs/; your own go in packs/local/ (gitignored). A local pack of the same name wins.
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./preset.cjs');
const L = require('./locks.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);
const SHIPPED = path.join(ROOT, 'packs'), LOCAL = path.join(SHIPPED, 'local');
const FORMAT = 'aigent-style-pack', FORMAT_VERSION = 1;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const STYLE_KEYS = ['theme', 'look', 'captionStyle', 'captionOutline', 'fonts', 'titles', 'finish', 'finishPool', 'transition', 'glitch', 'punch', 'tighten', 'cards', 'cardPalette', 'musicEnergy', 'bed', 'sfxMap', 'sfxCap', 'titlePlaces', 'entranceOrder', 'titleLayer', 'splitPlace', 'effectsFavourites', 'beatSync', 'glossary', 'brands'];
const { SPLIT_PLACES, KIND_PLACE } = require('./broll-slots.cjs');
const OUTLINES = require('./reelmd.cjs').CAPTION_LOOK['caption-outline'][1];
const TOP_KEYS = ['$schema', 'format', 'formatVersion', 'name', 'version', 'label', 'description', 'author', 'license', 'extends', 'style', 'locks', 'weights', 'preview', 'assets', 'notes'];
const LICENSES = ['Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0', 'OFL-1.1'];

function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function dirsIn(d) { return fs.existsSync(d) ? fs.readdirSync(d).filter(n => n !== 'local' && fs.existsSync(path.join(d, n, 'pack.json'))).map(n => path.join(d, n)) : []; }
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

// a name, a pack folder, or a pack.json path
function locate(ref) {
  if (!ref) return null;
  const asPath = path.resolve(ref);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isFile() && path.basename(asPath) === 'pack.json') return path.dirname(asPath);
  if (fs.existsSync(path.join(asPath, 'pack.json'))) return asPath;
  if (!P.isPlain(ref)) return null;
  for (const d of [LOCAL, SHIPPED]) if (fs.existsSync(path.join(d, ref, 'pack.json'))) return path.join(d, ref);
  return null;
}

function load(ref) {
  const dir = locate(ref);
  if (!dir) return null;
  const raw = readJson(path.join(dir, 'pack.json'));
  return { ...raw, dir, origin: rel(dir), shipped: path.dirname(dir) === SHIPPED };
}

function list() {
  const by = new Map();
  for (const d of dirsIn(SHIPPED)) { const p = load(d); by.set(p.name, p); }
  for (const d of dirsIn(LOCAL)) { const p = load(d); p.overridesShipped = by.has(p.name); by.set(p.name, p); }
  return [...by.values()].sort((a, b) => (a.shipped === b.shipped ? 0 : a.shipped ? -1 : 1) || (a.name === 'aigent' ? -1 : b.name === 'aigent' ? 1 : a.name.localeCompare(b.name)));
}
const shipped = () => list().filter(p => p.shipped);

// the pack as a preset: the base preset it extends, then its style keys on top
function toPreset(pack) {
  const base = pack.extends ? P.load(pack.extends) : null;
  if (pack.extends && !base) throw new Error(`pack "${pack.name}" extends unknown preset "${pack.extends}"`);
  const out = { ...(base || {}), ...(pack.style || {}), name: pack.name, label: pack.label || (base && base.label) || pack.name };
  delete out.origin; delete out.shipped; delete out.overridesShipped;
  out.pack = pack.name;
  return out;
}

// structure (the schema's rules, checked here so CI needs no extra dependency), then the kit's catalogs
function validate(pack) {
  const errs = [];
  if (!pack || typeof pack !== 'object') return ['pack.json must be a JSON object'];
  for (const k of Object.keys(pack)) if (!TOP_KEYS.includes(k) && !['dir', 'origin', 'shipped', 'overridesShipped'].includes(k)) errs.push(`unknown key "${k}"`);
  if (pack.format !== FORMAT) errs.push(`format must be "${FORMAT}"`);
  if (pack.formatVersion !== FORMAT_VERSION) errs.push(`formatVersion ${pack.formatVersion} is not supported (this kit reads ${FORMAT_VERSION})`);
  if (!P.isPlain(pack.name)) errs.push('name must be lowercase letters, numbers and dashes');
  if (pack.dir && path.basename(pack.dir) !== pack.name) errs.push(`name "${pack.name}" must match its folder "${path.basename(pack.dir)}"`);
  if (!SEMVER.test(String(pack.version || ''))) errs.push('version must be semver, e.g. 1.0.0');
  if (!pack.label || typeof pack.label !== 'string') errs.push('label is required (one line)');
  if (pack.license && !LICENSES.includes(pack.license)) errs.push(`license "${pack.license}" (${LICENSES.join(', ')})`);
  for (const k of ['label', 'description', 'notes']) if (typeof pack[k] === 'string' && pack[k].includes('\u2014')) errs.push(`${k} has an em dash`);
  if (pack.style != null && (typeof pack.style !== 'object' || Array.isArray(pack.style))) errs.push('style must be an object');
  for (const k of Object.keys(pack.style || {})) if (!STYLE_KEYS.includes(k)) errs.push(`style: unknown key "${k}" (${STYLE_KEYS.join(', ')})`);
  if (pack.style?.captionOutline !== undefined && !OUTLINES.includes(pack.style.captionOutline)) errs.push(`style.captionOutline must be one of ${OUTLINES.join(', ')}`);
  if (pack.style?.splitPlace !== undefined && !SPLIT_PLACES.includes(pack.style.splitPlace)) errs.push(`style.splitPlace must be one of ${SPLIT_PLACES.join(', ')}`);
  if (pack.style && pack.style.glossary != null) errs.push(...require('./glossary.cjs').validate(pack.style.glossary).map(e => 'style.' + e));
  if (pack.style && pack.style.brands != null) errs.push(...require('./brands.cjs').validate(pack.style.brands, pack.dir).map(e => 'style.' + e));
  if (pack.weights != null) {
    for (const k of Object.keys(pack.weights)) if (k !== 'transitions') errs.push(`weights: unknown key "${k}" (transitions)`);
    for (const [t, w] of Object.entries(pack.weights.transitions || {})) {
      if (!L.transitionNames().includes(t)) errs.push(`weights.transitions: unknown transition "${t}"`);
      if (!(+w > 0 && +w <= 10)) errs.push(`weights.transitions.${t} must be a number above 0, up to 10`);
    }
  }
  for (const a of pack.assets || []) {
    if (!a || !a.path || !a.license || !a.source) { errs.push('each asset needs path, license and source'); continue; }
    if (!LICENSES.includes(a.license)) errs.push(`asset ${a.path}: license "${a.license}" is not one the kit accepts (${LICENSES.join(', ')})`);
    if (pack.dir && !fs.existsSync(path.join(pack.dir, a.path))) errs.push(`asset ${a.path} is missing`);
  }
  if (pack.preview && pack.dir) for (const k of ['webp', 'png']) if (pack.preview[k] && !fs.existsSync(path.join(pack.dir, pack.preview[k]))) errs.push(`preview.${k} ${pack.preview[k]} is missing (npm run pack:preview -- ${pack.name})`);
  errs.push(...L.validate(pack.locks));
  if (!errs.length || !errs.some(e => /extends|style/.test(e))) {
    try { errs.push(...P.validate(toPreset(pack)).map(e => 'style: ' + e)); } catch (e) { errs.push(e.message); }
  }
  // a lock that rules out the pack's own default transition or entrance order is a contradiction worth flagging
  const st = (() => { try { return toPreset(pack); } catch { return {}; } })();
  if (pack.locks && pack.locks.transitions && st.transition && !pack.locks.transitions.includes(st.transition)) errs.push(`style transition "${st.transition}" is outside locks.transitions`);
  return errs;
}

function resolved(pack) {
  const preset = toPreset(pack);
  return { name: pack.name, version: pack.version, label: pack.label, description: pack.description, origin: pack.origin, shipped: !!pack.shipped, extends: pack.extends || null, style: preset, locks: pack.locks || {}, weights: pack.weights || {}, preview: pack.preview ? Object.fromEntries(Object.entries(pack.preview).map(([k, v]) => [k, pack.origin + '/' + v])) : null, locksText: L.describe(pack.locks) };
}

// a new pack from a preset, a pack, or a job (its cut.json and captions.js, with any locks it carried)
function scaffold(name, opts = {}) {
  if (!P.isPlain(name)) throw new Error(`pack name "${name}" must be lowercase letters, numbers and dashes`);
  const from = opts.from || 'aigent';
  let body;
  const asPack = locate(from), asPreset = P.isPlain(from) ? P.load(from) : null;
  if (asPack) {
    const src = load(asPack);
    body = { extends: src.extends, style: { ...(src.style || {}) }, locks: src.locks, weights: src.weights };
  } else if (asPreset) {
    body = { extends: asPreset.name, style: {}, locks: {} };
  } else {
    const job = [path.resolve(from), path.join(ROOT, 'jobs', from)].find(d => fs.existsSync(path.join(d, 'build', 'cut.json')) || fs.existsSync(path.join(d, 'cut.json')));
    if (!job) throw new Error(`--from "${from}" is not a pack, a preset or a job`);
    const st = P.fromJob(job), cutF = fs.existsSync(path.join(job, 'cut.json')) ? path.join(job, 'cut.json') : path.join(job, 'build', 'cut.json');
    const cut = readJson(cutF), style = {};
    for (const k of STYLE_KEYS) if (st[k] !== undefined && st[k] !== null && !(Array.isArray(st[k]) && !st[k].length)) style[k] = st[k];
    body = { extends: cut.preset && P.load(cut.preset) ? cut.preset : 'aigent', style, locks: cut.locks || {} };
  }
  const locks = L.merge(body.locks, opts.locks);
  const pack = {
    $schema: '../../pack.schema.json', format: FORMAT, formatVersion: FORMAT_VERSION, name, version: '0.1.0',
    label: opts.label || `${name}: my own look, started from ${from}`,
    description: `Started from ${from}. Change the style keys and locks, then run npm run pack:validate -- ${name} and npm run pack:preview -- ${name}.`,
    author: opts.author || '', license: 'Apache-2.0', extends: body.extends || undefined,
    style: body.style || {}, locks, ...(body.weights && Object.keys(body.weights).length ? { weights: body.weights } : {}),
    preview: { webp: 'preview.webp', png: 'preview.png' }, assets: [],
  };
  const dest = path.join(opts.dir ? path.resolve(opts.dir) : LOCAL, name);
  if (fs.existsSync(path.join(dest, 'pack.json')) && !opts.force) throw new Error(`${rel(dest)}/pack.json exists (pass --force to replace it)`);
  if (path.basename(path.dirname(dest)) === 'packs' && path.dirname(dest) === SHIPPED) pack.$schema = '../pack.schema.json';
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  if (!fs.existsSync(path.join(dest, 'README.md')) || opts.force) fs.writeFileSync(path.join(dest, 'README.md'), readme(pack));
  return dest;
}

function readme(pack) {
  return `# ${pack.name}\n\n${pack.label}\n\n${pack.description || ''}\n\n` +
    `Use it: \`npm run reel -- <clip> --pack ${pack.name}\`\n\n` +
    `Pinned choices (locks): ${L.describe(pack.locks)}\n\n` +
    'Set `style.captionOutline` to `none`, `thin` or `thick` for the caption stroke.\n\n' +
    'Set `style.splitPlace` to `top` (the default) or `frame` for split B-roll slots. A slot with its own place keeps it.\n\n' +
    `Edit \`pack.json\` (schema: packs/pack.schema.json), then:\n\n` +
    '```\n' + `npm run pack:validate -- ${pack.name}\nnpm run pack:preview -- ${pack.name}\n` + '```\n';
}

function printList(rows) {
  const lines = ['aigent-talking-head style packs', 'Use one with npm run reel -- <clip> --pack <name>. Flags and --lock you pass still win.', ''];
  for (const p of rows) lines.push(`  ${p.name.padEnd(16)} v${String(p.version).padEnd(7)} ${p.label}  (${p.shipped ? 'shipped' : 'yours'})`, `  ${''.padEnd(16)} locks: ${L.describe(p.locks)}`);
  lines.push('', 'Gallery with previews: docs/packs.md. Make your own: npm run pack:new -- <name> --from <preset|pack|job>');
  return lines.join('\n');
}

function selfTest() {
  const errs = [];
  const split = require('../packs/pack.schema.json').properties.style.properties.splitPlace;
  if (split?.enum?.join(',') !== SPLIT_PLACES.join(',') || split.default !== KIND_PLACE.split) errs.push('splitPlace schema must match the split places and their default');
  for (const p of shipped()) { const e = validate(p); e.forEach(x => errs.push(`${p.origin}: ${x}`)); }
  if (!shipped().some(p => p.name === 'aigent')) errs.push('packs/aigent is missing (the default look as a pack)');
  const bad = { format: FORMAT, formatVersion: FORMAT_VERSION, name: 'x', version: '1', label: 'x', style: { nope: 1 }, locks: { transitions: ['nope'] } };
  const be = validate(bad);
  if (!be.some(e => /version/.test(e)) || !be.some(e => /unknown key "nope"/.test(e)) || !be.some(e => /unknown transition/.test(e))) errs.push('pack validate missed problems in a bad pack: ' + be.join('; '));
  return errs;
}

module.exports = { FORMAT, FORMAT_VERSION, STYLE_KEYS, SHIPPED, LOCAL, locate, load, list, shipped, toPreset, validate, resolved, scaffold, printList, selfTest };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = k => argv.includes('--' + k);
  const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
  const VALUED = new Set(['from', 'dir', 'lock', 'label']);
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
  const cmd = pos[0] || 'list', args = pos.slice(1), JSON_OUT = flag('json');
  const out = o => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
  try {
    if (cmd === 'list') {
      const rows = list();
      if (JSON_OUT) out({ packs: rows.map(resolved), doc: 'docs/packs.md' }); else process.stdout.write(printList(rows) + '\n');
    } else if (cmd === 'show') {
      const p = load(args[0]);
      if (!p) throw new Error(`No pack named ${args[0]} (npm run pack lists them)`);
      const errs = validate(p), r = resolved(p);
      if (JSON_OUT) out({ ...r, ok: !errs.length, errors: errs });
      else { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); }
      if (errs.length) { console.error('invalid: ' + errs.join('; ')); process.exit(1); }
    } else if (cmd === 'new') {
      if (!args[0]) throw new Error('usage: npm run pack:new -- <name> [--from <preset|pack|job>] [--dir <folder>] [--lock "..."]');
      const dest = scaffold(args[0], { from: opt('from'), dir: opt('dir'), locks: opt('lock') ? L.parse(opt('lock')) : null, label: opt('label'), force: flag('force') });
      const p = load(dest), errs = validate({ ...p, preview: undefined });
      if (errs.length) throw new Error('the new pack does not validate: ' + errs.join('; '));
      if (JSON_OUT) out({ ok: true, pack: rel(dest) });
      else console.log(`made ${rel(dest)}/pack.json and README.md\nnext: edit pack.json, then npm run pack:validate -- ${args[0]} and npm run pack:preview -- ${args[0]}\nuse it: npm run reel -- <clip> --pack ${args[0]}`);
    } else if (cmd === 'validate') {
      const targets = args.length ? args.map(a => { const p = load(a); if (!p) throw new Error(`No pack at ${a}`); return p; }) : list();
      const res = targets.map(p => ({ pack: p.origin, errors: validate(p) }));
      const bad = res.filter(r => r.errors.length);
      if (JSON_OUT) out({ ok: !bad.length, results: res });
      else { for (const r of res) console.log(`${r.errors.length ? 'FAIL' : 'ok  '} ${r.pack}${r.errors.map(e => '\n      ' + e).join('')}`); console.log(bad.length ? `\n${bad.length} pack(s) with problems` : `\nPACKS PASS (${res.length})`); }
      process.exit(bad.length ? 1 : 0);
    } else throw new Error(`unknown subcommand "${cmd}" (list, show, new, validate)`);
  } catch (e) {
    if (JSON_OUT) out({ ok: false, error: e.message });
    console.error(e.message || e);
    process.exit(1);
  }
}
