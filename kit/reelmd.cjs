// Reel.md: a plain-Markdown recipe for a talking-head reel, read by people and agents, compiled to cut.json and
// caption settings. A Reel.md is a VIDEO.md-compatible profile (https://videomd.github.io/videomd/): the front matter
// is a VIDEO.md card plus an "x-reel" extension, and the shot list uses the VIDEO.md timeline line syntax.
// Spec: docs/reel-md.md. Examples: examples/recipes/.
//
//   npm run reelmd -- check <Reel.md>                 parse + validate, print a summary
//   npm run reelmd -- compile <Reel.md> [--out dir]   write recipe.cut.json + recipe.captions.json (default: next to it)
//   npm run reelmd -- export <job|build dir|cut.json> [--out Reel.md] [--name n]   a finished reel back to a Reel.md
//   npm run reelmd -- package <Reel.md> <dir>         write a full VIDEO.md package (VIDEO.md + video/timeline.md + shots)
//   npm run reel -- --recipe <Reel.md> [--clip my-clip.mp4]   make a reel with this recipe (see kit/reel.cjs)
//
// Precedence when a reel is made: command-line flags > the Reel.md > the preset it names > built-in defaults.
// After a draft, build/cut.json and build/captions.js are the source of truth: edit them and run --rebuild.
'use strict';
const fs = require('fs');
const path = require('path');

const KIT = __dirname, ROOT = path.dirname(KIT);
const SHOTS_BLOCK = 'videomd-timeline', TITLES_BLOCK = 'reel-titles', SCRIPT_BLOCK = 'reel-script', GRAPHICS_BLOCK = 'reel-graphics';
// graphic overlays (kit/graphics.json): type -> captions.js mode
const GRAPHICS = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'graphics.json'), 'utf8')).graphics.map(g => [g.id, g.mode]));
const CAPTION_POSITIONS = ['top', 'middle', 'bottom'];
const SRC = require('./sources.cjs');
// the one-word caption's look: Reel.md key -> captions.js key and its values
const CAPTION_LOOK = { 'caption-outline': ['captionOutline', ['none', 'thin', 'thick']], 'caption-shadow': ['captionShadow', ['none', 'soft']], 'caption-case': ['captionCase', ['upper', 'lower', 'as-said']] };
const ENTRANCES = ['stagger-rise', 'slam', 'blur-rise', 'slide-left', 'elastic', 'flip', 'pop-zoom'];
const LAYERS = ['front', 'behind', 'auto'];

// ---------- tiny YAML subset (front matter only): maps by 2-space indent, scalars, [inline, lists] ----------
function scalar(v) {
  v = v.trim();
  if (v === '') return '';
  if (/^".*"$/.test(v)) return JSON.parse(v);
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).map(scalar);
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no|off)$/i.test(v)) return false;
  if (/^(null|~)$/i.test(v)) return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return +v;
  return v;
}
function parseYaml(text) {
  const root = {}, stack = [{ ind: -1, obj: root }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const ind = raw.match(/^ */)[0].length, m = raw.trim().match(/^([A-Za-z0-9_~-]+):(?:\s+(.*))?$/);
    if (!m) throw new Error('front matter: cannot read line: ' + raw.trim());
    while (stack.length > 1 && ind <= stack[stack.length - 1].ind) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (m[2] === undefined || m[2] === '') { parent[m[1]] = {}; stack.push({ ind, obj: parent[m[1]] }); }
    else parent[m[1]] = scalar(m[2].replace(/\s+#.*$/, ''));
  }
  return root;
}
function yScalar(v) {
  if (Array.isArray(v)) return '[' + v.map(yScalar).join(', ') + ']';
  if (typeof v === 'string' && (v === '' || /[:#\[\]{},&*!|>'"%@`]|^\s|\s$|^(true|false|yes|no|on|off|null|~|-?\d+(\.\d+)?)$/i.test(v))) return JSON.stringify(v);
  return String(v);
}
function dumpYaml(obj, ind = '') {
  let s = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) s += `${ind}${k}:\n` + dumpYaml(v, ind + '  ');
    else s += `${ind}${k}: ${yScalar(v)}\n`;
  }
  return s;
}

// ---------- body helpers ----------
const keyOf = k => k.trim().toLowerCase().replace(/[\s_]+/g, '-');
function sections(body) {
  const out = {}; let cur = '_intro';
  out[cur] = [];
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = keyOf(h[1]); out[cur] = []; continue; }
    out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}
function bullets(text) {
  const o = {};
  // bullets outside fenced blocks only
  const clean = (text || '').replace(/^```[\s\S]*?^```/gm, '');
  for (const line of clean.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.*?)\s*$/);
    if (m) o[keyOf(m[1])] = m[2].replace(/\s+\(.*\)\s*$/, '').trim();
  }
  return o;
}
function fenced(body, name) {
  const m = body.match(new RegExp('^```' + name + '[ \\t]*\\n([\\s\\S]*?)^```', 'm'));
  return m ? m[1].split(/\r?\n/).filter(l => l.trim()) : null;
}
// "#07 16.2-18.5 | key value | key value" (the VIDEO.md timeline line)
function parseLine(line, where) {
  const parts = line.trim().split(/\s+\|\s+/);
  const m = parts[0].match(/^#(\d+)\s+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`${where}: not a timeline line: ${line.trim().slice(0, 80)}`);
  const o = { n: +m[1], start: +m[2], end: +m[3] };
  for (const p of parts.slice(1)) {
    const k = p.match(/^([a-z][a-z0-9_-]*~?)(?:\s+(.*))?$/);
    if (!k) throw new Error(`${where}: bad field "${p}" in #${m[1]}`);
    o[k[1]] = k[2] === undefined ? true : k[2].trim();
  }
  if (o.end < o.start) throw new Error(`${where}: #${m[1]} ends before it starts`);
  return o;
}
const fmtT = t => String(+(+t).toFixed(3));
const pad2 = n => String(n).padStart(2, '0');
const onOff = v => v == null || v === '' ? undefined : (typeof v === 'boolean' ? v : /^(on|yes|true|1)$/i.test(String(v)) ? true : /^(off|no|false|0|none)$/i.test(String(v)) ? false : undefined);
const none = v => v == null || /^(none|-|null|)$/i.test(String(v).trim());
const list = v => none(v) ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean);

// ---------- parse ----------
function parse(text, file = 'Reel.md') {
  if (!text.startsWith('---')) throw new Error(`${file}: must start with a --- front matter card (VIDEO.md style)`);
  const end = text.indexOf('\n---', 3);
  if (end < 0) throw new Error(`${file}: front matter is not closed with ---`);
  const card = parseYaml(text.slice(text.indexOf('\n') + 1, end));
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  const S = sections(body);
  const brand = bullets(S['brand-kit'] || S.brand), music = bullets(S.music), style = bullets(S.style);
  const shotLines = fenced(body, SHOTS_BLOCK) || [];
  const titleLines = fenced(body, TITLES_BLOCK) || [];
  const scriptLines = fenced(body, SCRIPT_BLOCK) || [];
  const graphicLines = fenced(body, GRAPHICS_BLOCK) || [];
  const shots = shotLines.map(l => parseLine(l, file + ' shots'));
  const titles = titleLines.map(l => parseLine(l, file + ' titles'));
  const script = scriptLines.map(l => parseLine(l, file + ' script'));
  const graphics = graphicLines.map(l => parseLine(l, file + ' graphics'));
  const title = (body.match(/^#\s+(.+)$/m) || [])[1];
  return { file, card, title, brand, music, style, shots, titles, script, graphics, notes: (S._intro || '').replace(/^#\s+.+$/m, '').trim() };
}

function validate(r) {
  const errs = [], warn = [];
  const c = r.card || {};
  for (const k of ['videomd', 'name', 'description', 'source', 'shots', 'lang']) if (c[k] === undefined) errs.push(`card: missing "${k}" (VIDEO.md card field)`);
  if (c.videomd !== undefined && c.videomd !== 1) errs.push('card: videomd must be 1');
  if (c.name && !/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(c.name)) errs.push('card: name must be lowercase letters, digits and hyphens');
  if (c.source && c.source.duration == null) errs.push('card: source.duration is required');
  if (c.shots != null && c.shots !== r.shots.length) errs.push(`card says ${c.shots} shots, the Shots block has ${r.shots.length}`);
  if (c['x-reel'] === undefined) warn.push('card: no "x-reel: 1" (this reads as a plain VIDEO.md card)');
  r.shots.forEach((s, i) => { if (s.n !== i + 1) errs.push(`shots: #${pad2(s.n)} out of order (expected #${pad2(i + 1)})`); });
  r.titles.forEach((t, i) => {
    if (t.entrance && !ENTRANCES.includes(t.entrance)) errs.push(`titles #${pad2(t.n)}: unknown entrance "${t.entrance}" (${ENTRANCES.join(', ')})`);
    if (t.layer && !LAYERS.includes(t.layer)) errs.push(`titles #${pad2(t.n)}: layer must be front, behind or auto`);
  });
  (r.graphics || []).forEach(g => {
    const type = g.type || g['type~'];
    if (!GRAPHICS[type]) errs.push(`graphics #${pad2(g.n)}: type must be ${Object.keys(GRAPHICS).join(', ')}`);
    for (const k of ['color', 'border', 'tile', 'ink']) if (g[k] && !/^#[0-9a-f]{6}$/i.test(g[k])) errs.push(`graphics #${pad2(g.n)}: ${k} must be a #rrggbb colour`);
    if (g.layer && !['front', 'behind'].includes(g.layer)) errs.push(`graphics #${pad2(g.n)}: layer must be front or behind`);
    for (const k of ['icon', 'src']) if (g[k] && !none(g[k]) && !fs.existsSync(path.resolve(path.dirname(r.file || '.'), g[k]))) warn.push(`graphics #${pad2(g.n)}: ${k} ${g[k]} not found next to the recipe; the placeholder is drawn`);
    if (g.source && !none(g.source)) {
      if (SRC.isUrl(g.source)) { const c = SRC.cached(g.source); if (!c.video && !c.image) warn.push(`graphics #${pad2(g.n)}: source ${g.source} not captured yet (npm run capture -- --recipe <this Reel.md>, after the user confirms the URLs); the placeholder is drawn`); }
      else if (!fs.existsSync(path.resolve(path.dirname(r.file || '.'), g.source))) warn.push(`graphics #${pad2(g.n)}: source ${g.source} not found next to the recipe; the placeholder is drawn`);
    }
    for (const k of ['head', 'head-y']) if (g[k] != null && isNaN(+g[k])) errs.push(`graphics #${pad2(g.n)}: ${k} must be a number`);
  });
  const st = r.style || {};
  if (st['caption-position'] && !none(st['caption-position']) && !CAPTION_POSITIONS.includes(st['caption-position'])) errs.push(`style: caption-position must be ${CAPTION_POSITIONS.join(', ')}`);
  for (const [k, [, vals]] of Object.entries(CAPTION_LOOK)) if (st[k] && !vals.includes(String(st[k]).toLowerCase())) errs.push(`style: ${k} must be ${vals.join(', ')}`);
  if (st['caption-color'] && !none(st['caption-color']) && !/^#[0-9a-f]{6}$/i.test(st['caption-color'])) errs.push('style: caption-color must be a #rrggbb colour');
  const P = require('./preset.cjs');
  const pre = toPreset(r);
  const perrs = P.validate({ ...pre, bed: pre.bed && !require('./rules.cjs').isBed(pre.bed) ? undefined : pre.bed });
  errs.push(...perrs.filter(e => !/missing name/.test(e)));
  if (pre.bed && !require('./rules.cjs').isBed(pre.bed) && !fs.existsSync(path.resolve(path.dirname(r.file || '.'), pre.bed))) warn.push(`music: bed "${pre.bed}" is not a library name or a file next to the recipe`);
  const B = require('./beats.cjs');
  r.shots.forEach(s => { if (s.finish && !none(s.finish)) try { B.parseFinish(s.finish); } catch (e) { errs.push(`shots #${pad2(s.n)}: ${e.message}`); } });
  if (r.brand.preset && !none(r.brand.preset) && r.brand.preset !== 'auto' && !P.load(r.brand.preset)) errs.push(`brand: unknown preset "${r.brand.preset}" (npm run preset -- --list)`);
  return { errs, warn };
}

// The recipe as a preset-shaped object (kit/preset.cjs), so reel.cjs applies it with the same precedence rules.
function toPreset(r) {
  const P = require('./preset.cjs');
  const b = r.brand || {}, m = r.music || {}, s = r.style || {};
  const base = (b.preset && !none(b.preset) && b.preset !== 'auto') ? (P.load(b.preset) || {}) : {};
  const out = { ...base, name: (r.card && r.card.name) || 'recipe', label: r.title || (r.card && r.card.description) || 'Reel.md recipe' };
  delete out.origin; delete out.shipped;
  if (!none(b.theme)) out.theme = b.theme;
  if (!none(b.fonts)) out.fonts = b.fonts;
  if (!none(b.logo)) out.logo = b.logo;
  if (list(b.colors).length) out.colors = list(b.colors);
  if (!none(s.look)) out.look = s.look;
  if (!none(s.captions)) out.captionStyle = s.captions;
  if (!none(s['caption-position'])) out.captionPosition = String(s['caption-position']).toLowerCase();
  if (!none(s['caption-color'])) out.captionColor = String(s['caption-color']).toLowerCase();
  for (const [k, [key, vals]] of Object.entries(CAPTION_LOOK)) if (s[k] && vals.includes(String(s[k]).toLowerCase())) out[key] = String(s[k]).toLowerCase(); // none is a value here
  if (onOff(s.titles) !== undefined) out.titles = onOff(s.titles);
  if (!none(s['title-layer'])) out.titleLayer = s['title-layer'].toLowerCase();
  if (s.finish !== undefined) { const f = list(s.finish); out.finish = f.length ? f.join(',') : null; delete out.finishPool; }
  if (s['finish-pool'] !== undefined) { const f = list(s['finish-pool']); if (f.length) { out.finishPool = f; delete out.finish; } else delete out.finishPool; }
  if (!none(s.transition)) out.transition = s.transition;
  if (onOff(s.punch) !== undefined) out.punch = onOff(s.punch);
  if (s.effects !== undefined) out.effectsFavourites = list(s.effects);
  if (m.bed !== undefined) out.bed = none(m.bed) ? null : m.bed;
  if (onOff(m['beat-sync']) !== undefined) out.beatSync = onOff(m['beat-sync']);
  if (m['bed-start'] != null && m['bed-start'] !== '') out.bedStart = +m['bed-start'];
  if (m['bed-volume'] != null && m['bed-volume'] !== '') out.bedVol = +m['bed-volume'];
  if (m.bpm != null && m.bpm !== '') out.bpm = +m.bpm;
  return out;
}

// Per-shot settings for drafted segments, in order: finish, big punch, transition.
function shotSettings(r) {
  return r.shots.map(s => {
    const o = {};
    if (s.finish && !none(s.finish)) o.finish = s.finish;
    if (s.punch === 'big') o.bigPunch = true;
    if (s.transition && !none(s.transition)) o.transition = s.transition;
    if (s.src) { o.file = s.src; o.in = +(s.in ?? 0); o.out = s.out != null ? +s.out : +(s.in ?? 0) + (s.end - s.start); }
    return o;
  });
}

// Titles as captions.js flips (mode 7).
function titleFlips(r) {
  return r.titles.map(t => {
    const f = { start: +t.start, end: +t.end, text: t.text || '', mode: 7 };
    if (t.entrance) f.entrance = t.entrance;
    if (t.layer) f.layer = t.layer;
    if (t.hero != null) f.hero = String(t.hero).split(',').map(Number);
    if (t.flicker != null) f.flicker = onOff(t.flicker);
    return f;
  });
}

// Graphics as captions.js flips (mode 9 ordinal sticker, 10 app label, 11 screen card). icon and src are resolved
// against the recipe's folder; "~" fields (a teardown's guesses) count the same as plain ones.
function graphicFlips(r) {
  const dir = path.dirname(path.resolve(r.file || 'Reel.md'));
  const v = (g, k) => g[k] !== undefined ? g[k] : g[k + '~'];
  return (r.graphics || []).filter(g => GRAPHICS[v(g, 'type')]).map(g => {
    const f = { start: +g.start, end: +g.end, mode: GRAPHICS[v(g, 'type')] };
    const text = v(g, 'text'); if (text != null && !none(text)) f.text = String(text).replace(/\s*\/\s*/g, ' ');
    for (const k of ['layer', 'color', 'ink', 'border', 'tile']) { const x = v(g, k); if (x != null && !none(x)) f[k] = String(x); }
    for (const k of ['x', 'y', 'w', 'in', 'size']) { const x = v(g, k); if (x != null && x !== '' && !isNaN(+x)) f[k] = +x; }
    // head: the burst's width in head widths, head-y: its centre below the head centre in head widths (reel.cjs turns
    // them into size and y for your clip's head)
    for (const [k, key] of [['head', 'head'], ['head-y', 'headY']]) { const x = v(g, k); if (x != null && x !== '' && !isNaN(+x)) f[key] = +x; }
    for (const k of ['icon', 'src']) { const x = v(g, k); if (x != null && !none(x)) f[k] = path.resolve(dir, String(x)); }
    // source: a public page (captured by npm run capture into assets/web/) or a file. Only a confirmed source counts;
    // a teardown's guess (source~) is shown to the user first.
    if (g.source && !none(g.source) && !f.src) {
      if (SRC.isUrl(g.source)) { const c = SRC.cached(g.source); f.source = SRC.normUrl(g.source); if (c.video || c.image) f.src = c.video || c.image; }
      else f.src = path.resolve(dir, String(g.source));
    }
    return f;
  });
}

// Reel.md -> { cut, captions }. cut.segs is complete only when every shot names a src; otherwise the shot list is a
// per-shot plan (shotPlan) that reel.cjs lays over the segments it drafts from your clip.
function compile(r) {
  const pre = toPreset(r);
  const cut = {};
  if (r.notes) cut.note = r.notes; // the recipe's intro text; cut.recipe names where the settings came from
  if (pre.name) cut.recipe = pre.name;
  if (pre.preset || (r.brand.preset && !none(r.brand.preset))) cut.preset = r.brand.preset;
  const plan = shotSettings(r);
  const full = plan.length && plan.every(p => p.file);
  if (full) {
    cut.segs = plan.map(p => { const s = { file: p.file, in: p.in, out: p.out }; for (const k of ['finish', 'bigPunch', 'transition']) if (p[k] !== undefined) s[k] = p[k]; return s; });
    cut.tail = 0.3;
  } else if (plan.length) cut.shotPlan = plan;
  if (pre.finish) cut.finish = pre.finish;
  if (pre.finishPool) cut.finishPool = pre.finishPool;
  if (pre.bed) { cut.bed = pre.bed; cut.bedVol = pre.bedVol ?? 0.16; if (pre.bedStart != null) cut.bedStart = pre.bedStart; }
  if (pre.beatSync !== undefined) cut.beatSync = pre.beatSync;
  if (pre.titleLayer) cut.titleLayer = pre.titleLayer;
  if (pre.punch === false) cut.punch = false;
  if (pre.transition && pre.transition !== 'glitch' && full) cut.segs.forEach((s, i) => { if (i && !s.transition) s.transition = pre.transition; });
  const captions = {};
  if (pre.captionStyle) captions.captionStyle = pre.captionStyle;
  if (pre.captionPosition) captions.captionPosition = pre.captionPosition;
  for (const [, [key]] of Object.entries(CAPTION_LOOK)) if (pre[key]) captions[key] = pre[key];
  if (pre.captionColor) captions.captionColor = pre.captionColor;
  if (pre.fonts) captions.fonts = pre.fonts;
  if (pre.titleLayer) captions.titleLayer = pre.titleLayer;
  if (r.titles.length) captions.titles = titleFlips(r);
  if ((r.graphics || []).length) captions.graphics = graphicFlips(r);
  return { cut, captions, preset: pre };
}

// ---------- export: a finished job back to Reel.md ----------
function readCaptionsFile(f) { return require('./rules.cjs').readCaptions(f); }
function exportJob(cut, caps, opts = {}) {
  const P = require('./preset.cjs');
  const pre = cut.preset ? (P.load(cut.preset) || {}) : {};
  const segs = cut.segs || [];
  let t = 0;
  const shots = segs.map((s, i) => { const d = (s.out - s.in) + (s.pad || 0); const o = { n: i + 1, start: t, end: t + d, s }; t += d; return o; });
  const dur = +(t + (cut.tail ?? 0.3)).toFixed(3);
  const flips = ((caps && caps.flips) || []).filter(f => f.mode === 7).sort((a, b) => a.start - b.start);
  const name = (opts.name || cut.recipe || cut.preset || 'my-reel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-reel';
  const card = {
    videomd: 1, name,
    description: opts.description || `Talking-head reel recipe: ${shots.length} shots, ${flips.length} titles${cut.bed ? ', music bed ' + (typeof cut.bed === 'string' ? path.basename(cut.bed) : 'set') : ''}. Exported from a finished aigent-talking-head job.`,
    source: { file: opts.source || 'reel.mp4', duration: dur },
    shots: shots.length, lang: opts.lang || 'en', generator: { name: 'aigent-talking-head', version: require('../package.json').version }, 'x-reel': 1,
  };
  const fin = cut.finish ? (Array.isArray(cut.finish) ? cut.finish.join(', ') : typeof cut.finish === 'object' ? Object.keys(cut.finish).join(', ') : cut.finish) : 'none';
  // transition: per-shot transitions are written on the shots; the job line only says what every later shot shares
  const later = segs.slice(1).map(s => s.transition || 'glitch');
  const jobTrans = later.length && later.every(x => x === later[0]) ? later[0] : 'glitch';
  // fonts: a pairing name (or a comma list of them) carries over; a job-local fonts file does not
  let fontsOut = (caps && caps.fonts) || pre.fonts || 'theme';
  if (P.validate({ name: 'x', fonts: fontsOut }).length) fontsOut = 'theme';
  const L = [];
  L.push('---', dumpYaml(card).trimEnd(), '---', '', `# ${opts.title || name}`, '');
  if (cut.note) L.push(String(cut.note).replace(/\u2014/g, ',').trim(), '');
  L.push('## Brand kit', `- preset: ${cut.preset || 'none'}`, `- theme: ${opts.theme || pre.theme || 'aigent'}`, `- colors: ${(opts.colors || pre.colors || []).join(', ') || 'none'}`, `- fonts: ${fontsOut}`, `- logo: ${(caps && caps.logo && caps.logo.src) || 'none'}`, '');
  L.push('## Music', `- bed: ${cut.bed ? (typeof cut.bed === 'string' ? cut.bed : 'custom') : 'none'}`);
  if (cut.bedStart != null) L.push(`- bed-start: ${cut.bedStart}`);
  if (cut.bedVol != null) L.push(`- bed-volume: ${cut.bedVol}`);
  L.push(`- beat-sync: ${cut.beatSync === false ? 'off' : cut.bed ? 'on' : 'off'}`, '');
  L.push('## Style', `- look: ${opts.look || pre.look || 'kinetic'}`, `- captions: ${(caps && caps.captionStyle) || pre.captionStyle || 'kinetic'}`, `- titles: ${flips.length ? 'on' : 'off'}`,
    ...(caps && caps.captionPosition ? [`- caption-position: ${caps.captionPosition}`] : []), ...(caps && caps.captionColor ? [`- caption-color: ${caps.captionColor}`] : []),
    ...Object.entries(CAPTION_LOOK).filter(([, [key]]) => caps && caps[key]).map(([k, [key]]) => `- ${k}: ${caps[key]}`),
    `- title-layer: ${(caps && caps.titleLayer) || cut.titleLayer || 'front'}`, `- finish: ${fin}`, `- transition: ${jobTrans}`, `- punch: ${cut.punch === false ? 'off' : 'on'}`, `- effects: ${(pre.effectsFavourites || []).join(', ') || 'none'}`, '');
  L.push('## Shots', '', '```' + SHOTS_BLOCK);
  for (const sh of shots) {
    const s = sh.s, f = [`#${pad2(sh.n)} ${fmtT(sh.start)}-${fmtT(sh.end)}`];
    f.push(`story ${sh.n === 1 ? 'hook' : sh.n === shots.length ? 'payoff' : 'beat'}`);
    if (s.finish) f.push(`finish ${Array.isArray(s.finish) ? s.finish.join(',') : s.finish}`);
    if (s.bigPunch) f.push('punch big');
    if (s.transition) f.push(`transition ${s.transition}`);
    if (s.file) f.push(`src ${s.file}`, `in ${fmtT(s.in)}`, `out ${fmtT(s.out)}`);
    L.push(f.join(' | '));
  }
  L.push('```', '');
  if (flips.length) {
    L.push('## Titles', '', '```' + TITLES_BLOCK);
    flips.forEach((x, i) => {
      const f = [`#${pad2(i + 1)} ${fmtT(x.start)}-${fmtT(x.end >= 99 ? dur : x.end)}`];
      if (x.entrance) f.push(`entrance ${x.entrance}`);
      if (x.layer) f.push(`layer ${x.layer}`);
      if (Array.isArray(x.hero)) f.push(`hero ${x.hero.join(',')}`);
      f.push(`text ${String(x.text || '').replace(/\s*\|\s*/g, ' / ').replace(/\n/g, ' ')}`);
      L.push(f.join(' | '));
    });
    L.push('```', '');
  }
  const gfx = ((caps && caps.flips) || []).filter(f => f.mode >= 9 && f.mode <= 11).sort((a, b) => a.start - b.start);
  if (gfx.length) {
    const TYPE = Object.fromEntries(Object.entries(GRAPHICS).map(([k, m]) => [m, k]));
    L.push('## Graphics', '', '```' + GRAPHICS_BLOCK);
    gfx.forEach((g, i) => {
      const f = [`#${pad2(i + 1)} ${fmtT(g.start)}-${fmtT(g.end >= 99 ? dur : g.end)}`, `type ${TYPE[g.mode]}`];
      if (g.text) f.push(`text ${String(g.text).replace(/\n/g, ' ')}`);
      for (const k of ['layer', 'color', 'ink', 'border', 'tile', 'x', 'y', 'w', 'in', 'size']) if (g[k] != null) f.push(`${k} ${g[k]}`);
      if (g.head != null) f.push(`head ${g.head}`);
      if (g.headY != null) f.push(`head-y ${g.headY}`);
      if (g.source) f.push(`source ${g.source}`);
      else for (const k of ['icon', 'src']) if (g[k]) f.push(`${k} ${g[k]}`);
      L.push(f.join(' | '));
    });
    L.push('```', '');
  }
  return L.join('\n');
}

// ---------- VIDEO.md package ----------
function toPackage(r, dir) {
  fs.mkdirSync(path.join(dir, 'video', 'shots'), { recursive: true });
  const card = { ...r.card };
  if (typeof card.generator === 'string') card.generator = { name: card.generator };
  const tl = r.shots.map(s => `#${pad2(s.n)} ${fmtT(s.start)}-${fmtT(s.end)}` + Object.entries(s).filter(([k]) => !['n', 'start', 'end'].includes(k)).map(([k, v]) => ` | ${k} ${v}`).join(''));
  const map = ['video/timeline.md | - | One line per shot with the reel fields (finish, punch, transition, src)'];
  r.shots.forEach(s => map.push(`video/shots/${pad2(s.n)}.md | - | Shot ${s.n}`));
  fs.writeFileSync(path.join(dir, 'VIDEO.md'), `---\n${dumpYaml(card)}---\n\n# ${r.title || card.name}\n\n${card.description}\n\nThe render recipe (brand kit, music, style, titles) is in the Reel.md this package came from.\n\n## Map\n\n\`\`\`videomd-map\n${map.join('\n')}\n\`\`\`\n`);
  fs.writeFileSync(path.join(dir, 'video', 'timeline.md'), `---\n${dumpYaml({ videomd: 1, part: 'timeline', shots: r.shots.length, tokens: 0 })}---\n\n\`\`\`${SHOTS_BLOCK}\n${tl.join('\n')}\n\`\`\`\n`);
  for (const s of r.shots) fs.writeFileSync(path.join(dir, 'video', 'shots', pad2(s.n) + '.md'), `---\n${dumpYaml({ videomd: 1, part: 'shot', shot: s.n, time: [s.start, s.end], tokens: 0 })}---\n\n${s.story ? 'Story: ' + s.story + '\n' : ''}`);
  return dir;
}

function load(file) { return parse(fs.readFileSync(file, 'utf8'), file); }

function summary(r) {
  const p = toPreset(r);
  return [`recipe: ${r.card.name} (${r.shots.length} shots, ${r.titles.length} titles, ${r.card.source && r.card.source.duration}s)`,
    `brand: preset ${r.brand.preset || 'none'}, theme ${p.theme || 'aigent'}, fonts ${p.fonts || 'theme'}${p.colors ? ', colors ' + p.colors.join(' ') : ''}`,
    `music: bed ${p.bed || 'none'}, beat-sync ${p.beatSync === false ? 'off' : p.beatSync || p.bed ? 'on (when a bed is set)' : 'off'}${p.bpm ? ', ~' + p.bpm + ' BPM in the reference' : ''}`,
    `style: look ${p.look || 'kinetic'}, captions ${p.captionStyle || 'kinetic'}, title layer ${p.titleLayer || 'front'}, finish ${p.finishPool ? 'vary across shots: ' + p.finishPool.join('/') : p.finish || 'none'}, transition ${p.transition || 'glitch'}`,
    ...(p.captionPosition || p.captionColor || p.captionOutline ? [`captions at ${p.captionPosition || 'the default band'}${p.captionColor ? ', colour ' + p.captionColor : ''}${p.captionOutline ? ', outline ' + p.captionOutline : ''}${p.captionShadow ? ', shadow ' + p.captionShadow : ''}${p.captionCase ? ', case ' + p.captionCase : ''}`] : []),
    ...r.titles.map(t => `  title #${pad2(t.n)} ${t.start}-${t.end}s ${t.entrance || 'any entrance'}, ${t.layer || 'job layer'}: ${t.text || ''}`),
    ...(r.graphics || []).map(g => `  graphic #${pad2(g.n)} ${g.start}-${g.end}s ${g.type || g['type~']}${(g.text || g['text~']) ? ': ' + (g.text || g['text~']) : ''}${g.icon || g.src ? ' (your file)' : g.source ? (SRC.isUrl(g.source) && !SRC.cached(g.source).image && !SRC.cached(g.source).video ? ' (source ' + g.source + ', not captured yet)' : ' (source ' + g.source + ')') : g['source~'] ? ' (suggested source ' + g['source~'] + ', confirm it)' : ' (placeholder)'}`)].join('\n');
}

module.exports = { parse, load, validate, compile, toPreset, shotSettings, titleFlips, graphicFlips, GRAPHICS, CAPTION_POSITIONS, CAPTION_LOOK, exportJob, toPackage, summary, parseYaml, dumpYaml, parseLine, ENTRANCES, LAYERS };

if (require.main === module) {
  const argv = process.argv.slice(2), cmd = argv[0];
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const pos = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i && all[i - 1].startsWith('--')));
  const die = m => { console.error(m); process.exit(1); };
  try {
    if (cmd === 'check' || cmd === 'compile' || cmd === 'package') {
      if (!pos[0]) die(`usage: npm run reelmd -- ${cmd} <Reel.md>`);
      const r = load(pos[0]);
      const { errs, warn } = validate(r);
      warn.forEach(w => console.warn('note: ' + w));
      if (errs.length) die('REELMD FAIL\n- ' + errs.join('\n- '));
      if (cmd === 'check') { console.log(summary(r)); console.log('REELMD PASS'); }
      if (cmd === 'compile') {
        const out = path.resolve(opt('out', path.dirname(pos[0])));
        fs.mkdirSync(out, { recursive: true });
        const c = compile(r);
        fs.writeFileSync(path.join(out, 'recipe.cut.json'), JSON.stringify(c.cut, null, 1));
        fs.writeFileSync(path.join(out, 'recipe.captions.json'), JSON.stringify(c.captions, null, 1));
        console.log(`wrote ${path.join(out, 'recipe.cut.json')} and recipe.captions.json${c.cut.segs ? ' (full cut: every shot names a src)' : ' (shot plan: applied over the segments drafted from your clip)'}`);
      }
      if (cmd === 'package') {
        if (!pos[1]) die('usage: npm run reelmd -- package <Reel.md> <dir>');
        toPackage(r, path.resolve(pos[1]));
        console.log('VIDEO.md package written to ' + path.resolve(pos[1]) + ' (validate with: python -m videomd check <dir>, if videomd is installed)');
      }
    } else if (cmd === 'export') {
      if (!pos[0]) die('usage: npm run reelmd -- export <job name|build dir|cut.json> [--out Reel.md]');
      let p = pos[0];
      if (!fs.existsSync(p) && fs.existsSync(path.join(ROOT, 'jobs', p))) p = path.join(ROOT, 'jobs', p);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = fs.existsSync(path.join(p, 'build', 'cut.json')) ? path.join(p, 'build', 'cut.json') : path.join(p, 'cut.json');
      if (!fs.existsSync(p)) die('No cut.json at ' + p);
      const cut = JSON.parse(fs.readFileSync(p, 'utf8'));
      const capF = path.join(path.dirname(p), 'captions.js');
      const caps = fs.existsSync(capF) ? readCaptionsFile(capF) : null;
      const md = exportJob(cut, caps, { name: opt('name') });
      const out = opt('out');
      if (out) { fs.writeFileSync(out, md); console.log('wrote ' + out); } else process.stdout.write(md);
    } else {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 14).join('\n'));
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
    }
  } catch (e) { die(e.message); }
}
