// Build the labelled gallery at showcase/index.html so every option is visible.
//   npm run showcase            (add --from-stills to reuse committed stills, or --graphics-only for just the graphics tiles)
// Renders stills (and a few short loops) from showcase/source/presenter.jpg, an
// AI-generated fictional presenter made for this project. No private footage, no
// brand portraits. Titles are composited behind the head with the person mask.
// Regenerates the committed gallery; keep the folder modest.
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadMenu, demoFields, sourceCatalogIds, showcaseHas } from './menu.mjs';
import { writeSheetsAndGallery } from './sheets.mjs';

const require = createRequire(import.meta.url);
const B = require('./beats.cjs');
const Preset = require('./preset.cjs');
const KIT = dirname(fileURLToPath(import.meta.url));
// fx.cjs fills these before the runner sees a plan; calling the runner directly must do the same, or the upstream
// author's name and handle (its defaults) show in the stills
const FX_CAT = Object.fromEntries(JSON.parse(readFileSync(join(dirname(KIT), 'effects', 'catalog.json'), 'utf8')).effects.map(e => [e.name, e]));
const ROOT = dirname(KIT);
const OUT = join(ROOT, 'showcase');
const W = 540, H = 960;
const node = process.execPath;
const skipEffects = process.argv.includes('--skip-effects');

function sh(cmd, args, cwd, env) {
  try {
    return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  } catch (e) {
    throw new Error([e.message, e.stderr && e.stderr.toString(), e.stdout && e.stdout.toString()].filter(Boolean).join('\n'));
  }
}

function whichPy() {
  const fx = join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (existsSync(fx)) return fx;
  return process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
}

function relPath(file) {
  return relative(OUT, file).split('\\').join('/');
}

function jpg(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  sh('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale=${W}:${H}`, '-frames:v', '1', '-update', '1', '-q:v', '5', dest]);
}

const PRESENTER = join(OUT, 'source', 'presenter.jpg');
const PRESENTER_MASK = join(OUT, 'source', 'presenter-mask.png');

function presenterPath() {
  if (!existsSync(PRESENTER)) throw new Error('missing ' + PRESENTER + ' (AI-generated fictional presenter, 1080x1920)');
  return PRESENTER;
}

function ensureMask(py, work) {
  if (existsSync(PRESENTER_MASK) && !process.argv.includes('--refresh-mask')) return PRESENTER_MASK;
  const clip = join(work, 'masksrc.mp4');
  videoFromStill(PRESENTER, clip, 0.25);
  const mkv = join(work, 'mask.mkv');
  const tryModel = (model) => {
    sh(py, [join(KIT, 'mask.py'), clip, mkv, '--model', model, '--no-download', '--windows', '0-0.25'], work);
  };
  try {
    console.log('person mask: birefnet');
    tryModel('birefnet');
  } catch (e) {
    console.warn('birefnet mask failed, trying mediapipe: ' + e.message.split('\n')[0]);
    tryModel('mediapipe');
  }
  sh('ffmpeg', ['-v', 'error', '-y', '-i', mkv, '-frames:v', '1', '-update', '1', PRESENTER_MASK]);
  return PRESENTER_MASK;
}

const CARD_PY = `
from PIL import Image, ImageDraw, ImageFont
import sys
W, H = 540, 960
kind, title, label, dest = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
palettes = {
    'sfx': ((18, 22, 28), (92, 249, 226)),
    'bed': ((28, 18, 24), (241, 196, 120)),
    'beatSync': ((16, 24, 22), (168, 220, 160)),
    'effect': ((22, 18, 20), (243, 238, 230)),
    'preset': ((18, 22, 28), (92, 249, 226)),
}
bg, accent = palettes.get(kind, ((20, 18, 22), (243, 238, 230)))
im = Image.new('RGB', (W, H), bg)
d = ImageDraw.Draw(im)
d.rectangle((0, 0, 12, H), fill=accent)
y = 80
d.text((40, y), kind, fill=accent)
y = 140
line, lines = '', []
for w in title.split():
    t = (line + ' ' + w).strip()
    if len(t) > 18 and line:
        lines.append(line); line = w
    else:
        line = t
if line: lines.append(line)
for ln in lines[:6]:
    d.text((40, y), ln, fill=(243, 238, 230))
    y += 36
y += 20
line, lines = '', []
for w in label.split():
    t = (line + ' ' + w).strip()
    if len(t) > 22 and line:
        lines.append(line); line = w
    else:
        line = t
if line: lines.append(line)
for ln in lines[:8]:
    d.text((40, y), ln, fill=(154, 146, 136))
    y += 28
im.save(dest, quality=80)
`;

function cardStill(py, work, kind, id, label, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const script = join(work, 'card.py');
  if (!existsSync(script)) writeFileSync(script, CARD_PY);
  sh(py, [script, kind, id, label || '', dest], work);
}

function videoFromStill(png, mp4, seconds = 2) {
  sh('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', png, '-t', String(seconds), '-r', '24',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', mp4]);
}

function writeHtml(menu, stills) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const imgFor = (kind, id) => {
    const rel = stills[`${kind}:${id}`];
    return rel ? `<img src="${esc(rel)}" alt="${esc(id)}" width="${W / 2}" height="${H / 2}" loading="lazy">` : '<div class="ph"></div>';
  };
  const card = (it) => `
    <figure class="tile" data-id="${esc(it.kind)}:${esc(it.id)}" id="${esc(it.kind)}-${esc(it.id)}">
      ${imgFor(it.kind, it.id)}
      <figcaption>
        <code>${esc(it.flag)}</code>
        <span>${esc(it.label)}</span>
      </figcaption>
    </figure>`;
  const nav = menu.sections.map(s => `<a href="#${esc(s.id)}">${esc(s.title)}</a>`).join('');
  const blocks = menu.sections.map(s => {
    let body = '';
    if (s.id === 'effects' && s.effectsByMoment) {
      body = Object.entries(s.moments || {}).map(([mid, label]) => `
        <h3 id="moment-${esc(mid)}">${esc(mid)}</h3>
        <p class="hint">${esc(label)}</p>
        <div class="grid">${(s.effectsByMoment[mid] || []).map(card).join('')}</div>`).join('');
    } else {
      body = `<div class="grid">${s.items.map(card).join('')}</div>`;
    }
    return `<section id="${esc(s.id)}"><h2>${esc(s.title)} <small>${s.items.length}</small></h2><p class="hint">${esc(s.hint || '')}</p>${body}</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>aigent-talking-head showcase</title>
  <style>
    :root { --bg:#111014; --card:#1c1a1f; --ink:#f3eee6; --muted:#9a9288; --line:#2e2a32; --accent:#5cf9e2; }
    * { box-sizing: border-box; }
    body { margin:0; font: 16px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
    header { padding: 28px 20px 12px; max-width: 1200px; margin:0 auto; }
    header h1 { font-size: 1.6rem; font-weight: 650; margin:0 0 8px; }
    header p { color:var(--muted); margin:0 0 8px; max-width: 70ch; }
    nav { position: sticky; top:0; z-index:2; background:rgba(17,16,20,.92); backdrop-filter: blur(8px); border-bottom:1px solid var(--line); display:flex; gap:12px; flex-wrap:wrap; padding:10px 20px; }
    nav a { color:var(--ink); text-decoration:none; font-size:13px; }
    nav a:hover { color:var(--accent); }
    main { max-width: 1200px; margin:0 auto; padding: 12px 20px 80px; }
    section { margin: 32px 0; }
    h2 { font-size: 1.25rem; margin: 0 0 6px; }
    h2 small { color:var(--muted); font-weight:500; }
    h3 { margin: 18px 0 4px; font-size: 1rem; text-transform: lowercase; }
    .hint { color:var(--muted); margin:0 0 14px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
    .tile { margin:0; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
    .tile img, .tile .ph { width:100%; aspect-ratio: 9/16; object-fit:cover; background:#0c0b0e; display:block; }
    figcaption { padding: 8px 10px 10px; }
    figcaption code { display:block; font: 11px/1.35 ui-monospace, monospace; color:var(--accent); white-space:pre-wrap; }
    figcaption span { display:block; color:var(--muted); font-size:12px; margin-top:4px; }
  </style>
</head>
<body>
  <header>
    <h1>aigent-talking-head showcase</h1>
    <p>Every effect, graphic, film finish, look, caption style, font pairing, theme, title entrance and transition, labelled with the exact name or flag to use. Music beds and SFX are listed the same way (listen to the files in the kit; they are not embedded here). Vary finishes across scenes rather than one look on everything.</p>
    <p>Stills use an AI-generated fictional presenter made for this project (Apache-2.0 with the repo). Generated by <code>npm run showcase</code> from the catalogs, so this page stays in sync. Open this file from a full clone or zip of the repo (or serve the <code>showcase/</code> folder). If you download only this HTML file, the images will not load. The contact sheets in the README and <a href="GALLERY.md">GALLERY.md</a> render on GitHub.</p>
  </header>
  <nav>${nav}</nav>
  <main>${blocks}</main>
</body>
</html>
`;
}

function pickLayerStill(dir, t) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.endsWith('.png'));
  const want = files.find(f => Math.abs(parseFloat(f.slice(1)) - t) < 0.03) || files[0];
  return want ? join(dir, want) : null;
}

// Titles go behind the person (mask), captions and other overlay sit in front.
// picture, titles behind the person, panels (screen cards and graphics behind the top of the head) under the crown
// mask, then the front layer
function composeOverPerson(person, mask, titles, front, dest, panels) {
  const tmp = dest.replace(/\.jpg$/i, '') + '.compose.png';
  mkdirSync(dirname(dest), { recursive: true });
  const inputs = ['-i', person];
  const filters = [];
  let n = 1;
  if (titles && existsSync(titles) && mask && existsSync(mask)) {
    inputs.push('-i', titles, '-i', mask);
    filters.push(`[0:v]format=rgba[bg];[${n}:v]format=rgba[ti];[${n + 1}:v]format=gray[ma]`);
    filters.push('[bg][ti]overlay=0:0:format=auto[bt]');
    filters.push('[0:v]format=rgba[pr];[pr][ma]alphamerge[cut]');
    filters.push('[bt][cut]overlay=0:0:format=auto[mid]');
    n += 2;
  } else {
    filters.push('[0:v]format=rgba[mid]');
  }
  let last = 'mid';
  if (panels && existsSync(panels)) {
    inputs.push('-i', panels);
    if (CROWN && existsSync(CROWN)) {
      inputs.push('-i', CROWN);
      filters.push(`[${n}:v]format=rgba[pn];[${n + 1}:v]format=gray[cm];[${last}][pn]overlay=0:0:format=auto[mp];[0:v]format=rgba[pc];[pc][cm]alphamerge[crn];[mp][crn]overlay=0:0:format=auto[mid2]`);
      n += 2;
    } else { filters.push(`[${n}:v]format=rgba[pn];[${last}][pn]overlay=0:0:format=auto[mid2]`); n += 1; }
    last = 'mid2';
  }
  if (front && existsSync(front)) {
    inputs.push('-i', front);
    filters.push(`[${n}:v]format=rgba[fr];[${last}][fr]overlay=0:0:format=auto[outv]`);
    last = 'outv';
  }
  sh('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', `[${last}]`,
    '-frames:v', '1', '-update', '1', tmp]);
  jpg(tmp, dest);
  try { rmSync(tmp); } catch {}
}

let PERSON = null, MASK = null, CROWN = null;

// the crown mask of the presenter (kit/headmask.py on the person mask): graphics behind the top of the head draw under it
function crownMask(py, work) {
  if (!MASK || !existsSync(MASK)) return null;
  const mkv = join(work, 'crown-src.mkv'), hm = join(work, 'crown.mkv'), png = join(work, 'crown.png');
  if (existsSync(png)) return png;
  try {
    sh('ffmpeg', ['-v', 'error', '-y', '-i', MASK, '-frames:v', '1', '-c:v', 'ffv1', '-pix_fmt', 'gray', mkv]);
    sh(py, [join(KIT, 'headmask.py'), mkv, hm], work);
    sh('ffmpeg', ['-v', 'error', '-y', '-i', hm, '-frames:v', '1', '-update', '1', png]);
    return png;
  } catch (e) { console.warn('crown mask failed; behind graphics drawn in front: ' + String(e.message || e).split('\n')[0]); return null; }
}

function typeStill(build, t, env, outFile) {
  for (const d of ['stills', 'stills-front', 'stills-titles', 'stills-panels']) {
    if (existsSync(join(build, d))) rmSync(join(build, d), { recursive: true, force: true });
  }
  if (env && env.THEME) {
    try { rmSync(join(build, 'theme.js')); } catch {}
  }
  sh(node, [join(KIT, 'render.mjs'), '0', String(t)], build, { ...env, STILLS_LAYERS: '1' });
  const front = pickLayerStill(join(build, 'stills-front'), t);
  const titles = pickLayerStill(join(build, 'stills-titles'), t);
  const panels = pickLayerStill(join(build, 'stills-panels'), t);
  if (PERSON && (front || titles || panels)) composeOverPerson(PERSON, MASK, titles, front, outFile, panels);
  else {
    const fallback = front || titles || pickLayerStill(join(build, 'stills'), t);
    if (!fallback) throw new Error('render wrote no still at ' + t);
    jpg(fallback, outFile);
  }
}

function captionsDoc(style, fonts, titles) {
  const words = [[0.1, 0.4, 'Record'], [0.4, 0.6, 'one'], [0.6, 0.9, 'take'], [0.9, 1.1, 'on'], [1.1, 1.3, 'your'], [1.3, 1.8, 'phone']];
  const flips = [];
  if (titles) {
    titles.forEach((ent, i) => flips.push({ start: i * 1.2, end: i * 1.2 + 1.1, text: 'Record one take', mode: 7, hero: [0], entrance: ent, layer: 'front' }));
  } else {
    // one-word keeps one word on screen: the title is the word until it leaves, then the caption words take over
    // oneword shows its caption signature (the key word big, the phrase building under it); its behind-head words are
    // single beats in a reel, and a title here would say the key word twice
    if (style !== 'oneword') flips.push({ start: 0, end: style === 'one-word' ? 0.9 : 2.4, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', layer: 'front' });
  }
  flips.push({ start: 0, end: 2.4, text: 'Record one take on your phone', mode: 0, words, hero: 'record' });
  return { captionStyle: style, ...(fonts ? { fonts } : {}), flips };
}

function expectedStillName(dstPng, t, fps) {
  const frame = Math.round(Number(t) * fps);
  const nameT = (frame / fps).toFixed(2);
  return dstPng.replace('.png', `_${nameT}.png`);
}

function runEffectBatch(fxPy, runner, person, imgs, batch, work, fps) {
  const slot = 1.2;
  const plan = { profile: { name: 'Showcase', handle: '@showcase' }, effects: [] };
  batch.forEach((e, i) => {
    const row = { ...demoFields(e), start: +(i * slot).toFixed(2), end: +((i + 1) * slot).toFixed(2) };
    const ce = FX_CAT[e.id] || {}, prof = plan.profile;
    const tok = { '$profile.name': prof.name, '$profile.handle': prof.handle, '$job': 'showcase', '$day': 'MON', '$date': '1', '$issue': 'ISSUE  ·  SHOWCASE' };
    for (const k of ce.fromProfile || []) row[k] = prof[k === 'text' ? 'handle' : k];
    for (const [k, v] of Object.entries(ce.neutral || {})) if (row[k] === undefined) row[k] = tok[v] ?? v;
    if (e.id === 'glass-widgets' && row.pill === undefined) row.pill = '';   // the upstream "Edited by Claude" pill is off unless asked for, as in fx.cjs
    if ((e.required || []).includes('images') || (e.needs || []).includes('images')) row.images = imgs;
    plan.effects.push(row);
  });
  const dur = batch.length * slot + 0.2;
  const dir = mkdtempSync(join(work, 'fx-'));
  const clip = join(dir, 'fxsrc.mp4');
  videoFromStill(person, clip, dur);
  const planPath = join(dir, 'fxplan.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 1));
  const mid = batch.map((_, i) => (i * slot + 0.7).toFixed(2));
  const stillOut = join(dir, 'fxstill.png');
  // PYTHONUTF8 as in fx.cjs: Windows Python reads the plan as cp1252 otherwise and a middle dot renders as mojibake
  sh(fxPy, [runner, '--plan', planPath, clip, stillOut, '--still', mid.join(',')], dir, { PYTHONUTF8: '1' });
  return batch.map((e, i) => {
    const t = mid[i];
    let src = expectedStillName(stillOut, t, fps);
    if (!existsSync(src) && batch.length === 1 && existsSync(stillOut)) src = stillOut;
    if (!existsSync(src)) {
      // closest fxstill_*.png
      const cands = readdirSync(dir).filter(f => f.startsWith('fxstill') && f.endsWith('.png'));
      const want = Number(t);
      let best = null, bestD = 99;
      for (const f of cands) {
        const m = f.match(/_([0-9]+(?:\.[0-9]+)?)\.png$/);
        const d = m ? Math.abs(+m[1] - want) : 99;
        if (d < bestD) { bestD = d; best = join(dir, f); }
      }
      if (best && bestD < 0.2) src = best;
    }
    return { id: e.id, src: existsSync(src) ? src : null };
  });
}

async function main() {
  const menu = loadMenu();
  // The committed gallery shows shipped presets only. Local drafts (brand:import,
  // user saves) still appear in `npm run menu`.
  const presetSec = menu.sections.find(s => s.id === 'presets');
  if (presetSec) {
    const names = new Set(Preset.shipped().map(p => p.name));
    presetSec.items = presetSec.items.filter(it => names.has(it.id));
  }
  const py = whichPy();
  const work = mkdtempSync(join(tmpdir(), 'ath-showcase-'));
  const stills = {};
  const put = (kind, id, file) => { stills[`${kind}:${id}`] = relPath(file); };
  mkdirSync(join(OUT, 'media'), { recursive: true });
  mkdirSync(join(OUT, 'loops'), { recursive: true });
  console.log('work', work);

  const person = presenterPath();
  PERSON = person;
  MASK = ensureMask(py, work);
  jpg(person, join(OUT, 'media', 'plate.jpg'));
  console.log('presenter', person);
  console.log('mask', MASK);

  console.log('finishes');
  for (const it of menu.sections.find(s => s.id === 'finishes').items) {
    const vf = B.finishChain(it.id);
    const tmp = join(work, 'fin-' + it.id + '.png');
    const out = join(OUT, 'media', 'finish', it.id + '.jpg');
    try {
      sh('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', person, '-t', '0.4',
        '-vf', `format=yuv444p,${vf},format=yuv420p`, '-frames:v', '1', '-update', '1', tmp]);
      jpg(tmp, out);
    } catch (e) {
      console.warn('finish ' + it.id + ' failed, using plate: ' + e.message.split('\n')[0]);
      jpg(person, out);
    }
    put('finish', it.id, out);
  }

  console.log('transitions');
  const transJson = JSON.parse(readFileSync(join(KIT, 'transitions.json'), 'utf8'));
  const aCol = join(work, 'ta.png'), bCol = join(work, 'tb.png');
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x5cf9e2:s=1080x1920:d=1', '-frames:v', '1', aCol]);
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2a1810:s=1080x1920:d=1', '-i', person,
    '-filter_complex', '[0][1]overlay=0:0', '-frames:v', '1', bCol]);
  videoFromStill(aCol, join(work, 'ta.mp4'), 1);
  videoFromStill(bCol, join(work, 'tb.mp4'), 1);
  for (const it of menu.sections.find(s => s.id === 'transitions').items) {
    const mode = transJson.names[it.id];
    const tmp = join(work, 'tx-' + it.id + '.png');
    const out = join(OUT, 'media', 'transition', it.id + '.jpg');
    try {
      if (mode) {
        sh('ffmpeg', ['-v', 'error', '-y', '-i', join(work, 'ta.mp4'), '-i', join(work, 'tb.mp4'),
          '-filter_complex', `[0][1]xfade=transition=${mode}:duration=0.4:offset=0.3,format=yuv420p`,
          '-ss', '0.48', '-frames:v', '1', tmp]);
      } else if (it.id === 'glitch') {
        sh('ffmpeg', ['-v', 'error', '-y', '-i', bCol, '-vf', 'format=rgba,rgbashift=rh=18:bh=-18,noise=c0s=30:c0f=t+u', tmp]);
      } else {
        copyFileSync(bCol, tmp);
      }
      jpg(tmp, out);
    } catch (e) {
      console.warn('transition ' + it.id + ' failed, using plate: ' + e.message.split('\n')[0]);
      jpg(bCol, out);
    }
    put('transition', it.id, out);
  }

  console.log('type stills');
  refreshTypeStills(py, work, stills, put, menu);

  console.log('title layer stills');
  renderTitleLayerStills(py, work, stills, put);
  console.log('title entrances (front)');
  refreshEntranceStills(work, stills, put, menu);
  console.log('graphics');
  renderGraphicStills(work, put, menu);

  const fxPy = join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const runner = join(ROOT, 'effects', 'fx_runner.py');
  const effects = menu.sections.find(s => s.id === 'effects').items;
  if (!skipEffects && existsSync(fxPy) && existsSync(runner)) {
    console.log('effects (' + effects.length + ')');
    const imgs = join(work, 'broll');
    mkdirSync(imgs, { recursive: true });
    for (let i = 0; i < 6; i++) {
      sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${['5cf9e2', 'f1e8dc', '3a2a22', '8899aa', 'cc7744', '226688'][i]}:s=640x640:d=0.1`,
        '-frames:v', '1', join(imgs, `i${i}.jpg`)]);
    }
    const BATCH = 6;
    const fps = 24;
    for (let i = 0; i < effects.length; i += BATCH) {
      const batch = effects.slice(i, i + BATCH);
      console.log('  effects ' + (i + 1) + '-' + (i + batch.length));
      let rows = [];
      try {
        rows = runEffectBatch(fxPy, runner, person, imgs, batch, work, fps);
      } catch (e) {
        console.warn('  batch failed, retrying one at a time: ' + e.message.split('\n')[0]);
        for (const e1 of batch) {
          try { rows = rows.concat(runEffectBatch(fxPy, runner, person, imgs, [e1], work, fps)); }
          catch (e2) {
            console.warn('  effect ' + e1.id + ' failed: ' + e2.message.split('\n')[0]);
            rows.push({ id: e1.id, src: null });
          }
        }
      }
      for (const row of rows) {
        const it = effects.find(e => e.id === row.id);
        const out = join(OUT, 'media', 'effect', row.id + '.jpg');
        if (row.src && existsSync(row.src)) jpg(row.src, out);
        else {
          console.warn('  no still for ' + row.id + ', using card');
          cardStill(py, work, 'effect', row.id, it ? it.label : row.id, out);
        }
        put('effect', row.id, out);
      }
    }
  } else {
    console.warn(skipEffects ? 'effects skipped (--skip-effects)' : 'effects venv or runner missing; writing labelled cards (npm run effects:setup)');
    for (const it of effects) {
      const out = join(OUT, 'media', 'effect', it.id + '.jpg');
      cardStill(py, work, 'effect', it.id, it.label, out);
      put('effect', it.id, out);
    }
  }

  for (const sec of ['sfx', 'beds', 'beat-sync']) {
    for (const it of menu.sections.find(s => s.id === sec).items) {
      const out = join(OUT, 'media', it.kind, it.id + '.jpg');
      cardStill(py, work, it.kind, it.id, it.label, out);
      put(it.kind, it.id, out);
    }
  }

  console.log('loops');
  try {
    const loopDir = join(OUT, 'loops');
    sh('ffmpeg', ['-v', 'error', '-y', '-i', join(work, 'ta.mp4'), '-i', join(work, 'tb.mp4'),
      '-filter_complex', `[0][1]xfade=transition=fade:duration=0.4:offset=0.3,format=yuv420p,scale=${W}:${H}`,
      '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-t', '1.0', join(loopDir, 'crossfade.webm')]);
    const gvf = B.finishChain('grain');
    // Subtle ken-burns (slow zoom and pan) plus grain, so the still has a little motion.
    sh('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', person, '-t', '1.5',
      '-vf', `scale=1188:2112,crop=1080:1920:x='(in_w-out_w)*t/1.5':y='(in_h-out_h)*t/3',format=yuv420p,${gvf},scale=${W}:${H}`,
      '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-r', '16', join(loopDir, 'grain.webm')]);
  } catch (e) {
    console.warn('loop encode skipped: ' + e.message.split('\n')[0]);
  }

  const html = writeHtml(menu, stills);
  writeFileSync(join(OUT, 'index.html'), html);
  writeFileSync(join(OUT, '.nojekyll'), '');
  writeFileSync(join(OUT, 'README.md'), `# Showcase

Labelled contact sheets of every effect, graphic, film finish, title entrance, caption style, font pairing and preset. The root README shows these too.

![Effects](sheets/effects.jpg)

![Graphics](sheets/graphics.jpg)

![Film finishes](sheets/finishes.jpg)

![In front versus behind the head](sheets/title-layer.jpg)

![Title entrances](sheets/entrances.jpg)

![Caption styles](sheets/captions.jpg)

![Font pairings](sheets/fonts.jpg)

![Presets](sheets/presets.jpg)

Every option, one tile at a time, is in the [full gallery](GALLERY.md).

Open [index.html](index.html) from a full clone or zip of the repo, or serve this folder. If you download only that HTML file, the images will not load. Rebuild with \`npm run showcase\` from the repo root (needs ffmpeg, Chrome, Pillow, and \`npm run effects:setup\` for the 51 effect stills and the person mask). Stills use \`source/presenter.jpg\`, an AI-generated fictional person made for this project, licensed Apache-2.0 with the repo. No private footage and no third-party portraits.

This folder is GitHub Pages-ready (\`.nojekyll\`). Repo settings and workflows are not changed by the generator.
`);
  writeSheetsAndGallery(menu);
  const ids = sourceCatalogIds();
  const cov = showcaseHas(html, ids);
  if (!cov.ok) {
    console.error('showcase html missing labels: ' + cov.missing.join(', '));
    process.exitCode = 1;
  }
  let bytes = 0, files = 0;
  const walk = d => { for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else { bytes += statSync(p).size; files++; }
  } };
  walk(OUT);
  console.log(`showcase: ${files} files, ${(bytes / 1e6).toFixed(1)} MB, stills for ${Object.keys(stills).length} tiles`);
  if (bytes > 25 * 1024 * 1024) {
    console.error('showcase is over 25 MB; shrink stills before committing');
    process.exitCode = 1;
  }
  try {
    await writePreview();
    console.log('wrote showcase/preview.png');
  } catch (e) {
    console.warn('preview.png skipped: ' + (e.message || e).toString().split('\n')[0]);
  }
  rmSync(work, { recursive: true, force: true });
}

async function writePreview() {
  const { chromium } = await import('playwright-core');
  const { pathToFileURL } = await import('url');
  const { findChrome } = await import('./chrome.mjs');
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(OUT, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'preview.png') });
  await browser.close();
}


function loadExistingStills() {
  const stills = {};
  const dirToKind = {
    finish: 'finish', effect: 'effect', graphic: 'graphic', transition: 'transition', font: 'font',
    theme: 'theme', entrance: 'entrance', look: 'look', caption: 'captionStyle',
    preset: 'preset', bed: 'bed', sfx: 'sfx', beatSync: 'beatSync', titleLayer: 'titleLayer',
  };
  const media = join(OUT, 'media');
  if (!existsSync(media)) return stills;
  for (const dir of readdirSync(media, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const kind = dirToKind[dir.name];
    if (!kind) continue;
    for (const f of readdirSync(join(media, dir.name))) {
      if (!f.endsWith('.jpg')) continue;
      stills[`${kind}:${f.replace(/\.jpg$/, '')}`] = relPath(join(media, dir.name, f));
    }
  }
  return stills;
}


function refreshTypeStills(py, work, stills, put, menu) {
  PERSON = presenterPath();
  MASK = existsSync(PRESENTER_MASK) ? PRESENTER_MASK : null;
  const build = join(work, 'type');
  mkdirSync(build, { recursive: true });
  const mid = 1.0; // after the default slam title has risen to its resting height
  const stillAt = style => (style === 'one-word' ? 1.5 : mid); // one-word: after the title, on the word "phone"
  const typeOrCard = (kind, it, fn) => {
    const out = join(OUT, 'media', kind, it.id + '.jpg');
    try { fn(out); }
    catch (e) {
      console.warn(kind + ' ' + it.id + ' failed, using card: ' + e.message.split('\n')[0]);
      cardStill(py, work, kind, it.id, it.label, out);
    }
    put(it.kind, it.id, out);
  };
  for (const st of menu.sections.find(s => s.id === 'caption-styles').items) {
    typeOrCard('caption', st, out => {
      writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(captionsDoc(st.id, 'theme')) + ';\n');
      typeStill(build, stillAt(st.id), { THEME: 'aigent', FONTS: 'theme' }, out);
    });
  }
  for (const fo of menu.sections.find(s => s.id === 'fonts').items) {
    typeOrCard('font', fo, out => {
      writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(captionsDoc('kinetic', fo.id)) + ';\n');
      typeStill(build, mid, { THEME: 'aigent', FONTS: fo.id }, out);
    });
  }
  for (const th of menu.sections.find(s => s.id === 'themes').items) {
    typeOrCard('theme', th, out => {
      writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(captionsDoc('kinetic', 'theme')) + ';\n');
      typeStill(build, mid, { THEME: th.id }, out);
    });
  }
  const lookStyle = { kinetic: 'kinetic', oneword: 'oneword', muse: 'pill', classic: 'classic', 'one-word': 'one-word' };
  for (const lk of menu.sections.find(s => s.id === 'looks').items) {
    typeOrCard('look', lk, out => {
      const doc = captionsDoc(lookStyle[lk.id] || 'kinetic', 'theme');
      if (lk.id === 'classic') doc.flips = doc.flips.filter(f => f.mode !== 7);
      writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
      typeStill(build, stillAt(lookStyle[lk.id] || 'kinetic'), { THEME: 'aigent', FONTS: 'theme' }, out);
    });
  }
  const presetTiles = menu.sections.find(s => s.id === 'presets');
  if (presetTiles) {
    console.log('presets');
    for (const pr of presetTiles.items) {
      const full = Preset.load(pr.id) || {};
      typeOrCard('preset', pr, out => {
        const style = full.captionStyle || 'kinetic';
        const fonts = full.fonts && full.fonts !== 'theme' ? full.fonts : 'theme';
        const theme = full.theme || 'aigent';
        const doc = captionsDoc(style, fonts);
        if (full.titles === false) doc.flips = doc.flips.filter(f => f.mode !== 7);
        writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
        const pool = (full.finishPool && full.finishPool.length) ? full.finishPool : (full.finish ? [full.finish] : []);
        let plate = PERSON;
        if (pool[0]) {
          plate = join(work, 'preset-plate-' + pr.id + '.png');
          const vf = B.finishChain(pool[0]);
          sh('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', PERSON, '-t', '0.3',
            '-vf', `format=yuv444p,${vf},format=yuv420p`, '-frames:v', '1', '-update', '1', plate]);
        }
        const prev = PERSON;
        PERSON = plate;
        try { typeStill(build, stillAt(style), { THEME: theme, FONTS: fonts }, out); }
        finally { PERSON = prev; }
      });
    }
  }
}

function renderTitleLayerStills(py, work, stills, put) {
  mkdirSync(join(OUT, 'media', 'titleLayer'), { recursive: true });
  PERSON = presenterPath();
  MASK = existsSync(PRESENTER_MASK) ? PRESENTER_MASK : null;
  const build = join(work, 'title-layer-build');
  mkdirSync(build, { recursive: true });
  // After slam hold (0.5 s) + rise (0.35 s) the word is at resting titleY, readable, with only its lower edge tucked.
  const restAt = 1.00;
  for (const layer of ['front', 'behind']) {
    const doc = { captionStyle: 'kinetic', flips: [
      { start: 0, end: 2.4, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer },
    ] };
    writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
    const out = join(OUT, 'media', 'titleLayer', layer + '.jpg');
    typeStill(build, restAt, { THEME: 'aigent', FONTS: 'theme' }, out);
    put('titleLayer', layer, out);
  }
  const autoOut = join(OUT, 'media', 'titleLayer', 'auto.jpg');
  cardStill(py, work, 'titleLayer', 'auto', 'Only the strongest 1 or 2 punch titles go behind the head, never consecutive ones.', autoOut);
  put('titleLayer', 'auto', autoOut);
}

// Graphics (kit/graphics.json): each one after its entrance settles, on the presenter, with the neutral placeholder
// art (no third-party icons or screenshots). The ordinal burst goes behind the head with the person mask; graphics
// on the panel layer go under the crown mask. The others use their kit/graphics.json example.
const GFX_DEMO = {
  'ordinal-sticker': [{ start: 0, end: 3, mode: 9, text: 'First', layer: 'behind' }],
  'app-label': [{ start: 0, end: 3, mode: 10, text: 'Your App', y: 0.52 }],
  'screen-card': [{ start: 0, end: 3, mode: 11, border: '#ff7a45' }],
};
// when each tile is taken: after the entrance, with a checklist half ticked, a quote fully in and the code typed
const GFX_AT = { checklist: 1.3, 'quote-card': 1.8, 'price-tag': 1.4, 'code-card': 2.0 };
function renderGraphicStills(work, put, menu) {
  PERSON = presenterPath();
  MASK = existsSync(PRESENTER_MASK) ? PRESENTER_MASK : null;
  CROWN = crownMask(whichPy(), work);
  const build = join(work, 'graphics-build');
  mkdirSync(build, { recursive: true });
  for (const it of menu.sections.find(s => s.id === 'graphics').items) {
    const flips = GFX_DEMO[it.id] || [{ ...(it.example || {}), start: 0, end: 3 }];
    writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'kinetic', flips }) + ';\n');
    const out = join(OUT, 'media', 'graphic', it.id + '.jpg');
    typeStill(build, GFX_AT[it.id] || 1.2, { THEME: 'aigent', FONTS: 'theme' }, out);
    put('graphic', it.id, out);
  }
}

function refreshEntranceStills(work, stills, put, menu) {
  PERSON = presenterPath();
  MASK = existsSync(PRESENTER_MASK) ? PRESENTER_MASK : null;
  const ents = menu.sections.find(s => s.id === 'title-entrances').items;
  const build = join(work, 'entrance-build');
  mkdirSync(build, { recursive: true });
  const doc = captionsDoc('kinetic', 'theme', ents.map(i => i.id));
  writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
  const entTimes = ents.map((it, i) => (i * 1.2 + (it.id === 'slam' ? 1.0 : 0.15)).toFixed(2));
  for (const d of ['stills', 'stills-front', 'stills-titles']) {
    if (existsSync(join(build, d))) rmSync(join(build, d), { recursive: true, force: true });
  }
  sh(node, [join(KIT, 'render.mjs'), '0', entTimes.join(',')], build, { THEME: 'aigent', FONTS: 'theme', STILLS_LAYERS: '1' });
  ents.forEach((it, i) => {
    const t = +entTimes[i];
    const out = join(OUT, 'media', 'entrance', it.id + '.jpg');
    const front = pickLayerStill(join(build, 'stills-front'), t);
    const titles = pickLayerStill(join(build, 'stills-titles'), t);
    composeOverPerson(PERSON, MASK, titles, front, out);
    put('entrance', it.id, out);
  });
}

async function rebuildFromStills() {
  const menu = loadMenu();
  const presetSec = menu.sections.find(s => s.id === 'presets');
  if (presetSec) {
    const names = new Set(Preset.shipped().map(p => p.name));
    presetSec.items = presetSec.items.filter(it => names.has(it.id));
  }
  const py = whichPy();
  const work = mkdtempSync(join(tmpdir(), 'ath-showcase-'));
  const stills = loadExistingStills();
  const put = (kind, id, file) => { stills[`${kind}:${id}`] = relPath(file); };
  // --graphics-only: render just the graphics tiles and rebuild the page and sheets around the committed stills
  const all = !process.argv.includes('--graphics-only');
  if (all) {
  console.log('title layer stills');
  renderTitleLayerStills(py, work, stills, put);
  console.log('type stills');
  refreshTypeStills(py, work, stills, put, menu);
  console.log('title entrances (front)');
  try { refreshEntranceStills(work, stills, put, menu); }
  catch (e) { console.warn('entrances refresh failed: ' + (e.message || e).toString().split('\n')[0]); }
  }
  console.log('graphics');
  renderGraphicStills(work, put, menu);
  const html = writeHtml(menu, stills);
  writeFileSync(join(OUT, 'index.html'), html);
  writeFileSync(join(OUT, '.nojekyll'), '');
  // README is written by the same template as main(); rebuild sheets first so images exist
  writeSheetsAndGallery(menu);
  writeFileSync(join(OUT, 'README.md'), `# Showcase

Labelled contact sheets of every effect, graphic, film finish, title entrance, caption style, font pairing and preset. The root README shows these too.

![Effects](sheets/effects.jpg)

![Graphics](sheets/graphics.jpg)

![Film finishes](sheets/finishes.jpg)

![In front versus behind the head](sheets/title-layer.jpg)

![Title entrances](sheets/entrances.jpg)

![Caption styles](sheets/captions.jpg)

![Font pairings](sheets/fonts.jpg)

![Presets](sheets/presets.jpg)

Every option, one tile at a time, is in the [full gallery](GALLERY.md).

Open [index.html](index.html) from a full clone or zip of the repo, or serve this folder. If you download only that HTML file, the images will not load. Rebuild with \`npm run showcase\` from the repo root (needs ffmpeg, Chrome, Pillow, and \`npm run effects:setup\` for the 51 effect stills and the person mask). Stills use \`source/presenter.jpg\`, an AI-generated fictional person made for this project, licensed Apache-2.0 with the repo. No private footage and no third-party portraits.

This folder is GitHub Pages-ready (\`.nojekyll\`). Repo settings and workflows are not changed by the generator.
`);
  const ids = sourceCatalogIds();
  const cov = showcaseHas(html, ids);
  if (!cov.ok) {
    console.error('showcase html missing labels: ' + cov.missing.join(', '));
    process.exitCode = 1;
  }
  rmSync(work, { recursive: true, force: true });
  console.log('rebuilt gallery from stills');
}

if (process.argv.includes('--from-stills') || process.argv.includes('--graphics-only')) rebuildFromStills();
else main();
