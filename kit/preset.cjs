// Brand styles / presets. A preset is a saved mix of theme, look, caption style,
// fonts, finishes (including a per-scene variety pool), transitions, effect favourites,
// and optional bed or SFX prefs.
//
//   npm run preset                  list shipped + local presets
//   npm run preset -- --list
//   npm run preset -- --show <name>
//   npm run preset -- --save <name> --from <job>
//   npm run reel -- --preset <name>
//   npm run reel -- --preset auto   pick one, vary finishes across scenes, print what was picked
//
// Shipped files live in kit/presets/*.json. User-saved files go in kit/presets/local/
// (gitignored). A local file of the same name overrides the shipped one. Any flag or
// cut.json field the user sets wins over the preset (full customize).
const fs = require('fs');
const path = require('path');
const B = require('./beats.cjs');
const R = require('./rules.cjs');

const KIT = __dirname;
const ROOT = path.dirname(KIT);
const SHIPPED = path.join(KIT, 'presets');
const LOCAL = path.join(KIT, 'presets', 'local');

const LOOKS = ['kinetic', 'muse', 'classic', 'one-word'];
const STYLES = ['kinetic', 'classic', 'pill', 'hormozi', 'karaoke', 'one-word'];

function themes() {
  return fs.readdirSync(path.join(KIT, 'themes')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
}
function fontNames() {
  const fonts = JSON.parse(fs.readFileSync(path.join(KIT, 'fonts', 'pairings.json'), 'utf8'));
  return Object.keys(fonts.pairings || {});
}
function transitionNames() {
  const t = JSON.parse(fs.readFileSync(path.join(KIT, 'transitions.json'), 'utf8'));
  return Object.keys(t.names || {});
}

function isPlain(n) {
  return typeof n === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(n);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function shippedFiles() {
  if (!fs.existsSync(SHIPPED)) return [];
  return fs.readdirSync(SHIPPED).filter(f => f.endsWith('.json')).map(f => path.join(SHIPPED, f));
}

function localFiles() {
  if (!fs.existsSync(LOCAL)) return [];
  return fs.readdirSync(LOCAL).filter(f => f.endsWith('.json')).map(f => path.join(LOCAL, f));
}

function normalize(raw, origin) {
  if (!raw || typeof raw !== 'object') throw new Error('preset must be a JSON object');
  const name = raw.name || path.basename(origin || 'preset', '.json');
  if (!isPlain(name)) throw new Error(`preset name "${name}" must be lowercase letters, numbers and dashes`);
  const out = { ...raw, name, origin: origin ? path.relative(ROOT, origin).split(path.sep).join('/') : undefined };
  out.shipped = !!(origin && path.dirname(origin) === SHIPPED);
  return out;
}

function load(name, opts = {}) {
  if (!name || name === 'auto') return null;
  if (!isPlain(name)) throw new Error(`preset name "${name}" must be lowercase letters, numbers and dashes`);
  const local = path.join(opts.dir || LOCAL, name + '.json');
  const shipped = path.join(SHIPPED, name + '.json');
  if (!opts.shippedOnly && fs.existsSync(local)) return normalize(readJson(local), local);
  if (opts.dir && fs.existsSync(path.join(opts.dir, name + '.json'))) return normalize(readJson(path.join(opts.dir, name + '.json')), path.join(opts.dir, name + '.json'));
  if (fs.existsSync(shipped)) return normalize(readJson(shipped), shipped);
  return null;
}

function list() {
  const by = new Map();
  for (const f of shippedFiles()) {
    const p = normalize(readJson(f), f);
    by.set(p.name, p);
  }
  for (const f of localFiles()) {
    const p = normalize(readJson(f), f);
    p.overridesShipped = by.has(p.name) && by.get(p.name).shipped;
    by.set(p.name, p);
  }
  return [...by.values()].sort((a, b) => {
    if (a.shipped && !b.shipped) return -1;
    if (!a.shipped && b.shipped) return 1;
    return a.name.localeCompare(b.name);
  });
}

function shipped() {
  return list().filter(p => p.shipped && p.origin && p.origin.startsWith('kit/presets/') && !p.origin.includes('/local/'));
}

function validate(p) {
  const errs = [];
  if (!p || !p.name) errs.push('missing name');
  if (p.theme && !themes().includes(p.theme)) errs.push(`unknown theme "${p.theme}"`);
  if (p.look && !LOOKS.includes(p.look)) errs.push(`unknown look "${p.look}"`);
  if (p.captionStyle && !STYLES.includes(p.captionStyle)) errs.push(`unknown captionStyle "${p.captionStyle}"`);
  if (p.fonts && p.fonts !== 'theme' && !fontNames().includes(p.fonts) && !p.fonts.startsWith('local')) {
    // local fonts are allowed as a name under kit/fonts/local/; don't fail unknown here if it looks like a custom id
    if (!isPlain(p.fonts)) errs.push(`bad fonts "${p.fonts}"`);
  }
  if (p.finish) {
    try { B.parseFinish(p.finish); } catch (e) { errs.push(e.message); }
  }
  for (const f of p.finishPool || []) {
    try { B.parseFinish(f); } catch (e) { errs.push('finishPool: ' + e.message); }
  }
  if (p.transition && !transitionNames().includes(p.transition)) errs.push(`unknown transition "${p.transition}"`);
  if (p.bed && !R.isBed(p.bed)) errs.push(`unknown bed "${p.bed}" (library names only in a shipped preset)`);
  return errs;
}

// CLI flags win. Used by reel.cjs: pass a getter that reports whether the user set a flag.
function apply(preset, dest, overrides = {}) {
  if (!preset) return dest;
  const cut = dest.cut || dest;
  const caps = dest.captions || null;
  const has = k => Object.prototype.hasOwnProperty.call(overrides, k) && overrides[k] !== undefined && overrides[k] !== null;
  const pick = (k, presetKey) => has(k) ? overrides[k] : (preset[presetKey || k] !== undefined ? preset[presetKey || k] : undefined);

  const look = pick('look');
  const style = pick('style', 'captionStyle');
  const theme = pick('theme');
  const fonts = pick('fonts');
  const titles = has('titles') ? overrides.titles : (look === 'classic' ? false : (preset.titles !== undefined ? preset.titles : undefined));
  const punch = has('punch') ? overrides.punch : (preset.punch !== undefined ? preset.punch : undefined);
  const finish = pick('finish');
  const bed = pick('bed');
  const transition = pick('transition');
  const beatSync = has('beatSync') ? overrides.beatSync : preset.beatSync;

  const applied = { name: preset.name, label: preset.label };
  if (theme) applied.theme = theme;
  if (look) applied.look = look;
  if (style) applied.captionStyle = style;
  if (fonts) applied.fonts = fonts;
  if (titles !== undefined) applied.titles = titles;
  if (punch !== undefined) applied.punch = punch;
  if (bed) applied.bed = bed;
  if (beatSync !== undefined) applied.beatSync = beatSync;

  if (cut && typeof cut === 'object') {
    cut.preset = preset.name;
    if (bed && !has('bed')) {
      cut.bed = R.isBed(bed) ? bed : bed;
      if (cut.bedVol == null) cut.bedVol = 0.16;
    }
    if (beatSync !== undefined && !has('beatSync')) cut.beatSync = beatSync;
    if (punch === false && !has('punch')) cut.punch = false;
    if (transition && !has('transition') && Array.isArray(cut.segs)) {
      cut.segs.forEach((s, i) => { if (!s.transition) s.transition = transition; });
    }
    if (has('finish') && overrides.finish) {
      cut.finish = overrides.finish;
      applied.finish = overrides.finish;
    } else {
      const pool = (preset.finishPool && preset.finishPool.length) ? preset.finishPool : null;
      if (pool && Array.isArray(cut.segs) && cut.segs.length > 1) {
        cut.segs.forEach((s, i) => { if (s.finish == null) s.finish = pool[i % pool.length]; });
        applied.finishPool = pool;
      } else if (finish || (pool && pool[0])) {
        if (cut.finish == null) cut.finish = finish || pool[0];
        applied.finish = cut.finish;
      }
    }
    if (preset.effectsFavourites) applied.effectsFavourites = preset.effectsFavourites;
  }
  if (caps && typeof caps === 'object') {
    if (style && !has('style')) caps.captionStyle = style;
    if (fonts && !has('fonts')) caps.fonts = fonts;
  }
  return { cut, captions: caps, applied, theme: applied.theme, look: applied.look, style: applied.captionStyle, fonts: applied.fonts, titles: applied.titles };
}

function pickAuto(hints = {}) {
  const all = shipped();
  if (!all.length) throw new Error('no shipped presets');
  const want = String(hints.want || hints.style || hints.energy || '').toLowerCase();
  const map = {
    'one-word': 'one-word', oneword: 'one-word', punchy: 'one-word',
    hormozi: 'hormozi-bold', bold: 'hormozi-bold',
    karaoke: 'karaoke', lyric: 'karaoke',
    quiet: 'minimal-clean', clean: 'minimal-clean', minimal: 'minimal-clean',
    film: 'cinematic', cinematic: 'cinematic', moody: 'cinematic',
    editorial: 'editorial', serif: 'editorial',
    muse: 'muse-pill', pill: 'muse-pill',
    retro: 'retro-scan-lines', 'scan-lines': 'retro-scan-lines', crt: 'retro-scan-lines',
    neutral: 'neutral', unbranded: 'neutral',
    aigent: 'aigent',
  };
  for (const [k, name] of Object.entries(map)) {
    if (want.includes(k)) {
      const p = all.find(x => x.name === name);
      if (p) return p;
    }
  }
  // Default auto pick: aigent is the house style. Callers can still ask for another.
  return all.find(x => x.name === 'aigent') || all[0];
}

function fromJob(jobDir) {
  const build = fs.existsSync(path.join(jobDir, 'cut.json')) ? jobDir : path.join(jobDir, 'build');
  const cutFile = path.join(build, 'cut.json');
  const capFile = path.join(build, 'captions.js');
  if (!fs.existsSync(cutFile)) throw new Error('no cut.json in ' + build);
  const cut = JSON.parse(fs.readFileSync(cutFile, 'utf8'));
  const caps = fs.existsSync(capFile) ? R.readCaptions(capFile) : {};
  const finishes = [];
  if (cut.finish) finishes.push(cut.finish);
  for (const s of cut.segs || []) if (s.finish) finishes.push(s.finish);
  const uniq = [...new Set(finishes.map(f => typeof f === 'string' ? f : JSON.stringify(f)))];
  const trans = [...new Set((cut.segs || []).map(s => s.transition).filter(Boolean))];
  return {
    theme: undefined, // theme.js is a file, not always named
    captionStyle: caps.captionStyle,
    fonts: caps.fonts,
    titles: !!(cut.titles),
    finish: typeof cut.finish === 'string' ? cut.finish : undefined,
    finishPool: uniq.filter(f => typeof f === 'string'),
    transition: trans[0],
    bed: typeof cut.bed === 'string' && R.isBed(cut.bed) ? cut.bed : undefined,
    punch: cut.punch === false ? false : true,
    beatSync: cut.beatSync,
    notes: 'Saved from a job. Check theme, look and effect favourites before you rely on this as a house style.',
  };
}

function save(name, data, destDir) {
  if (!isPlain(name)) throw new Error(`preset name "${name}" must be lowercase letters, numbers and dashes`);
  const dir = destDir || LOCAL;
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name + '.json');
  const body = { ...data, name, draft: data.draft || undefined };
  const errs = validate(body);
  if (errs.length) throw new Error('invalid preset: ' + errs.join('; '));
  fs.writeFileSync(dest, JSON.stringify(body, null, 2) + '\n');
  return dest;
}

function printList() {
  const rows = list();
  const lines = ['aigent-talking-head presets', 'Use one with npm run reel -- --preset <name>. Flags you pass win over the preset.', ''];
  for (const p of rows) {
    const where = p.shipped ? 'shipped' : 'local';
    lines.push(`  ${p.name.padEnd(20)} ${p.label || ''}  (${where})`);
  }
  lines.push('', 'Tip: --preset auto picks a shipped style and prints what it chose.');
  lines.push('Save one from a job: npm run preset -- --save <name> --from <job>');
  return lines.join('\n');
}

function resolveJob(name) {
  if (fs.existsSync(path.join(name, 'cut.json')) || fs.existsSync(path.join(name, 'build', 'cut.json'))) return path.resolve(name);
  const j = path.join(ROOT, 'jobs', name);
  if (fs.existsSync(j)) return j;
  throw new Error('no job at ' + name + ' (pass a job name or a folder with cut.json)');
}

module.exports = {
  LOOKS, STYLES, SHIPPED, LOCAL,
  load, list, shipped, validate, apply, pickAuto, fromJob, save, printList,
  themes, fontNames, transitionNames, isPlain,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = k => argv.includes('--' + k);
  const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
  try {
    if (flag('show')) {
      const name = opt('show') || argv.find(a => !a.startsWith('--') && a !== opt('show'));
      const p = load(name);
      if (!p) { console.error('No preset named ' + name); process.exit(1); }
      const errs = validate(p);
      process.stdout.write(JSON.stringify(p, null, 2) + '\n');
      if (errs.length) { console.error('invalid: ' + errs.join('; ')); process.exit(1); }
    } else if (flag('save')) {
      const name = opt('save');
      const from = opt('from');
      if (!name || !from) { console.error('usage: npm run preset -- --save <name> --from <job>'); process.exit(1); }
      const data = fromJob(resolveJob(from));
      const dest = save(name, data);
      console.log('saved', dest);
    } else {
      process.stdout.write(printList() + '\n');
      const bad = list().flatMap(p => validate(p).map(e => `${p.name}: ${e}`));
      if (bad.length) { console.error('invalid presets: ' + bad.join('; ')); process.exit(1); }
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
