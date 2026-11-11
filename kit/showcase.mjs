// Build the labelled gallery at showcase/index.html so every option is visible.
//   npm run showcase
// Renders stills (and a few short loops) from a synthetic presenter frame. No private
// footage, no brand portraits. Regenerates the committed gallery; keep the folder modest.
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadMenu, demoFields, sourceCatalogIds, showcaseHas } from './menu.mjs';

const require = createRequire(import.meta.url);
const B = require('./beats.cjs');
const KIT = dirname(fileURLToPath(import.meta.url));
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
  sh('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale=${W}:${H}`, '-q:v', '5', dest]);
}

const PERSON_PY = `
from PIL import Image, ImageDraw, ImageFilter
import sys
W, H = 1080, 1920
bg = Image.new('RGB', (W, H), (28, 24, 22))
d = ImageDraw.Draw(bg)
for i, c in enumerate([(54, 44, 38), (40, 48, 52), (36, 32, 46)]):
    x, y = 200 + i * 280, 240 + i * 80
    d.ellipse((x, y, x + 520, y + 520), fill=c)
bg = bg.filter(ImageFilter.GaussianBlur(48))
d = ImageDraw.Draw(bg)
d.rounded_rectangle((220, 1180, 860, 1920), 180, fill=(42, 36, 34))
d.polygon([(400, 1240), (680, 1240), (760, 1920), (320, 1920)], fill=(58, 46, 42))
d.rectangle((490, 980, 590, 1180), fill=(210, 168, 140))
d.ellipse((340, 520, 740, 1080), fill=(226, 184, 154))
d.ellipse((320, 500, 760, 900), fill=(36, 28, 26))
d.ellipse((370, 560, 710, 940), fill=(226, 184, 154))
d.ellipse((430, 760, 500, 820), fill=(40, 28, 24))
d.ellipse((580, 760, 650, 820), fill=(40, 28, 24))
d.arc((470, 850, 610, 960), 20, 160, fill=(140, 80, 70), width=8)
bg.save(sys.argv[1])
mask = Image.new('L', (W, H), 0)
m = ImageDraw.Draw(mask)
m.rounded_rectangle((220, 1180, 860, 1920), 180, fill=255)
m.polygon([(400, 1240), (680, 1240), (760, 1920), (320, 1920)], fill=255)
m.rectangle((490, 980, 590, 1180), fill=255)
m.ellipse((340, 520, 740, 1080), fill=255)
m.ellipse((320, 500, 760, 900), fill=255)
mask.filter(ImageFilter.GaussianBlur(2)).save(sys.argv[2])
print('ok')
`;

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
}
bg, accent = palettes.get(kind, ((20, 18, 22), (243, 238, 230)))
im = Image.new('RGB', (W, H), bg)
d = ImageDraw.Draw(im)
d.rectangle((0, 0, 12, H), fill=accent)
font_big = font_sm = ImageFont.load_default()
# wrap title
y = 80
d.text((40, y), kind, fill=accent)
y = 140
# crude wrap
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

function writePerson(dir, py) {
  const script = join(dir, 'person.py');
  writeFileSync(script, PERSON_PY);
  sh(py, [script, join(dir, 'person.png'), join(dir, 'mask.png')], dir);
}

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
    <p>Every effect, film finish, look, caption style, font pairing, theme, title entrance and transition, labelled with the exact name or flag to use. Music beds and SFX are listed the same way (listen to the files in the kit; they are not embedded here). Vary finishes across scenes rather than one look on everything.</p>
    <p>Generated by <code>npm run showcase</code> from the catalogs, so this page stays in sync. Open this file locally, or serve the <code>showcase/</code> folder.</p>
  </header>
  <nav>${nav}</nav>
  <main>${blocks}</main>
</body>
</html>
`;
}

function typeStill(build, t, env, outFile) {
  if (existsSync(join(build, 'stills'))) rmSync(join(build, 'stills'), { recursive: true, force: true });
  sh(node, [join(KIT, 'render.mjs'), '0', String(t)], build, env);
  const files = readdirSync(join(build, 'stills')).filter(f => f.endsWith('.png'));
  const want = files.find(f => Math.abs(parseFloat(f.slice(1)) - t) < 0.03) || files[0];
  if (!want) throw new Error('render wrote no still at ' + t);
  jpg(join(build, 'stills', want), outFile);
}

function captionsDoc(style, fonts, titles) {
  const words = [[0.1, 0.4, 'Record'], [0.4, 0.6, 'one'], [0.6, 0.9, 'take'], [0.9, 1.1, 'on'], [1.1, 1.3, 'your'], [1.3, 1.8, 'phone']];
  const flips = [];
  if (titles) {
    titles.forEach((ent, i) => flips.push({ start: i * 1.2, end: i * 1.2 + 1.1, text: 'Record one take', mode: 7, hero: [0], entrance: ent }));
  } else {
    flips.push({ start: 0, end: 2.4, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam' });
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
  sh(fxPy, [runner, '--plan', planPath, clip, stillOut, '--still', mid.join(',')], dir);
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

function main() {
  const menu = loadMenu();
  const py = whichPy();
  const work = mkdtempSync(join(tmpdir(), 'ath-showcase-'));
  const stills = {};
  const put = (kind, id, file) => { stills[`${kind}:${id}`] = relPath(file); };
  mkdirSync(join(OUT, 'media'), { recursive: true });
  mkdirSync(join(OUT, 'loops'), { recursive: true });
  console.log('work', work);

  writePerson(work, py);
  const person = join(work, 'person.png');
  jpg(person, join(OUT, 'media', 'plate.jpg'));

  console.log('finishes');
  for (const it of menu.sections.find(s => s.id === 'finishes').items) {
    const vf = B.finishChain(it.id);
    const tmp = join(work, 'fin-' + it.id + '.png');
    const out = join(OUT, 'media', 'finish', it.id + '.jpg');
    try {
      sh('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', person, '-t', '0.4',
        '-vf', `format=yuv420p,${vf},format=yuv420p`, '-frames:v', '1', tmp]);
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
  const build = join(work, 'type');
  mkdirSync(build, { recursive: true });
  const mid = 0.7;
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
      typeStill(build, mid, { THEME: 'aigent', FONTS: 'theme' }, out);
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
  const lookStyle = { kinetic: 'kinetic', muse: 'pill', classic: 'classic' };
  for (const lk of menu.sections.find(s => s.id === 'looks').items) {
    typeOrCard('look', lk, out => {
      const doc = captionsDoc(lookStyle[lk.id] || 'kinetic', 'theme');
      if (lk.id === 'classic') doc.flips = doc.flips.filter(f => f.mode !== 7);
      writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
      typeStill(build, mid, { THEME: 'aigent', FONTS: 'theme' }, out);
    });
  }
  const ents = menu.sections.find(s => s.id === 'title-entrances').items;
  try {
    writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(captionsDoc('kinetic', 'theme', ents.map(i => i.id))) + ';\n');
    const entTimes = ents.map((_, i) => (i * 1.2 + 0.15).toFixed(2)).join(',');
    if (existsSync(join(build, 'stills'))) rmSync(join(build, 'stills'), { recursive: true, force: true });
    sh(node, [join(KIT, 'render.mjs'), '0', entTimes], build, { THEME: 'aigent', FONTS: 'theme' });
    const rendered = readdirSync(join(build, 'stills')).filter(f => f.endsWith('.png')).sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)));
    ents.forEach((it, i) => {
      const src = rendered[i] || rendered[0];
      const out = join(OUT, 'media', 'entrance', it.id + '.jpg');
      jpg(join(build, 'stills', src), out);
      put('entrance', it.id, out);
    });
  } catch (e) {
    console.warn('title entrances failed, using cards: ' + e.message.split('\n')[0]);
    for (const it of ents) {
      const out = join(OUT, 'media', 'entrance', it.id + '.jpg');
      cardStill(py, work, 'entrance', it.id, it.label, out);
      put('entrance', it.id, out);
    }
  }

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
    sh('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', person, '-t', '1.2', '-vf', `format=yuv420p,${gvf},scale=${W}:${H}`,
      '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-r', '16', join(loopDir, 'grain.webm')]);
  } catch (e) {
    console.warn('loop encode skipped: ' + e.message.split('\n')[0]);
  }

  const html = writeHtml(menu, stills);
  writeFileSync(join(OUT, 'index.html'), html);
  writeFileSync(join(OUT, '.nojekyll'), '');
  writeFileSync(join(OUT, 'README.md'), `# Showcase

A labelled gallery of every option in aigent-talking-head: effects, film finishes, looks, caption styles, font pairings, themes, title entrances, transitions, the SFX pack and the music beds.

Open \`index.html\` in a browser, or serve this folder. Rebuild with \`npm run showcase\` from the repo root (needs ffmpeg, Chrome, and \`npm run effects:setup\` for the 51 effect stills). Stills are synthetic. No private footage.

This folder is GitHub Pages-ready (\`.nojekyll\`). Repo settings and workflows are not changed by the generator.
`);
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
  rmSync(work, { recursive: true, force: true });
}

main();
