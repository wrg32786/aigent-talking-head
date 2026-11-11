// Draft a preset from a brand guide (PDF, image, or markdown/text).
//   npm run brand:import -- <file> [--name <preset>] [--out kit/presets/local/<name>.json]
//
// Extracts a colour palette (k-means on images or PDF pages), font names mentioned
// in the text (mapped to shipped OFL pairings or kit/fonts/local), tone / do-don't
// notes, and any obvious logo file next to the guide. Writes a draft preset for a
// human to confirm. Presets work without this step.
//
// Light deps only: ffmpeg and the effects venv Pillow if present. pdftoppm / pdftotext
// are used when installed; if they are missing, PDFs are refused with a clear note
// and images or markdown still work.
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { dirname, join, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

const require = createRequire(import.meta.url);
const Preset = require('./preset.cjs');
const KIT = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(KIT);

const FONT_MAP = [
  { re: /druk|heavy sans|impact/i, fonts: 'druk' },
  { re: /editorial|canela|playfair|caslon|crimson|serif/i, fonts: 'editorial' },
  { re: /elegant|script|allura|pinyon|italic display/i, fonts: 'elegant' },
  { re: /modern|unbounded|geometric|grotesk|inter|helvetica/i, fonts: 'modern' },
  { re: /archivo|hanken|instrument|theme|brand sans/i, fonts: 'theme' },
];

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
function hasCmd(name) {
  try { execSync((process.platform === 'win32' ? 'where ' : 'command -v ') + name, { stdio: 'ignore' }); return true; }
  catch { return false; }
}
function whichPy() {
  const fx = join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (existsSync(fx)) return fx;
  return process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
}

const KMEANS_PY = `
import json, sys, collections
from PIL import Image
path, k, dest = sys.argv[1], int(sys.argv[2]), sys.argv[3]
im = Image.open(path).convert('RGB')
im = im.resize((160, 160))
px = list(im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata())
# simple k-means
import random
random.seed(1)
# unique-ish starts
cent = [px[i * len(px) // k] for i in range(k)]
for _ in range(8):
    buckets = [[] for _ in range(k)]
    for r,g,b in px:
        d = [abs(r-cr)+abs(g-cg)+abs(b-cb) for cr,cg,cb in cent]
        buckets[d.index(min(d))].append((r,g,b))
    for i,bkt in enumerate(buckets):
        if not bkt: continue
        n=len(bkt)
        cent[i] = (sum(p[0] for p in bkt)//n, sum(p[1] for p in bkt)//n, sum(p[2] for p in bkt)//n)
# sort by count
counts = []
for i,bkt in enumerate(buckets):
    c = cent[i]
    counts.append((len(bkt), '#%02x%02x%02x' % c, c))
counts.sort(reverse=True)
# drop near-white / near-black if we have enough
def boring(c):
    r,g,b=c
    return (r>245 and g>245 and b>245) or (r<12 and g<12 and b<12)
kept = [x for x in counts if not boring(x[2])] or counts
out = [{'hex': h, 'rgb': list(c), 'share': round(n/max(1,sum(x[0] for x in counts)), 3)} for n,h,c in kept[:6]]
open(dest,'w').write(json.dumps(out))
`;

function paletteFromImage(img, work, py) {
  const script = join(work, 'kmeans.py');
  const dest = join(work, 'palette.json');
  writeFileSync(script, KMEANS_PY);
  sh(py, [script, img, '6', dest]);
  return JSON.parse(readFileSync(dest, 'utf8')).filter(c => c.share > 0);
}

function pdfToPages(src, work) {
  const dir = join(work, 'pages');
  mkdirSync(dir, { recursive: true });
  if (hasCmd('pdftoppm')) {
    sh('pdftoppm', ['-png', '-r', '72', '-l', '3', src, join(dir, 'p')]);
  } else {
    throw new Error('pdftoppm is not on PATH, so this PDF cannot be rasterised. Convert a page to a PNG or install poppler-utils, then rerun.');
  }
  return readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => join(dir, f));
}

function pdfText(src) {
  if (hasCmd('pdftotext')) {
    try { return sh('pdftotext', ['-layout', src, '-']).toString(); }
    catch { return ''; }
  }
  return '';
}

function extractFonts(text) {
  const hits = [];
  for (const row of FONT_MAP) {
    if (row.re.test(text)) hits.push(row.fonts);
  }
  // also record raw names after "font:" or "typeface:"
  const named = [];
  const re = /(?:font(?:s| family)?|typeface|typography)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 \-]{1,40})/gi;
  let m;
  while ((m = re.exec(text))) named.push(m[1].trim());
  return { fonts: hits[0] || 'theme', mentions: [...new Set(named)] };
}

function extractNotes(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const dos = [], donts = [], tone = [];
  for (const ln of lines) {
    if (/^do not\b|^don't\b|^never\b|^avoid\b/i.test(ln) || /do not use|don't use/i.test(ln)) donts.push(ln.replace(/^[\-*\d.\s]+/, ''));
    else if (/^do\b|^always\b|^prefer\b|^use\b/i.test(ln)) dos.push(ln.replace(/^[\-*\d.\s]+/, ''));
    else if (/\btone\b|voice|personality/i.test(ln) && ln.length < 200) tone.push(ln);
  }
  const notes = [];
  if (tone.length) notes.push((/^tone:/i.test(tone[0]) ? '' : 'Tone: ') + tone.slice(0, 3).join(' '));
  if (dos.length) notes.push('Do: ' + dos.slice(0, 5).join(' | '));
  if (donts.length) notes.push("Don't: " + donts.slice(0, 5).join(' | '));
  return notes.join(' ').slice(0, 800);
}

function nearbyLogo(src) {
  const dir = dirname(src);
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const hit = names.find(f => /logo|wordmark|mark/i.test(f) && /\.(svg|png|jpe?g|webp)$/i.test(f));
  return hit ? join(dir, hit) : null;
}

function slug(s) {
  return String(s || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
}

export async function importGuide(src, opts = {}) {
  const file = resolve(src);
  if (!existsSync(file)) throw new Error('not found: ' + file);
  const ext = extname(file).toLowerCase();
  const py = whichPy();
  const work = mkdtempSync(join(tmpdir(), 'ath-brand-'));
  let text = '', pages = [], warnings = [];
  try {
    if (ext === '.pdf') {
      try { pages = pdfToPages(file, work); }
      catch (e) { warnings.push(e.message); }
      text = pdfText(file);
      if (!text && !pages.length) {
        warnings.push('pdftotext is not on PATH, so no text was extracted from the PDF.');
      }
    } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.bmp'].includes(ext)) {
      pages = [file];
    } else if (['.md', '.txt', '.markdown'].includes(ext)) {
      text = readFileSync(file, 'utf8');
    } else {
      throw new Error('unsupported brand guide type ' + ext + ' (use a PDF, image, or markdown/text file)');
    }

    let palette = [];
    if (pages.length) {
      try { palette = paletteFromImage(pages[0], work, py); }
      catch (e) { warnings.push('palette failed: ' + (e.message || e).toString().split('\\n')[0]); }
    }
    const fonts = extractFonts(text);
    const notes = extractNotes(text);
    const logo = nearbyLogo(file);
    const name = slug(opts.name || basename(file, ext));
    const draft = {
      name,
      label: 'Draft from ' + basename(file) + ' (confirm before use)',
      draft: true,
      theme: 'neutral',
      look: 'kinetic',
      captionStyle: 'kinetic',
      fonts: fonts.fonts,
      titles: true,
      finish: null,
      finishPool: [],
      transition: 'cut',
      effectsFavourites: [],
      colors: palette,
      fontMentions: fonts.mentions,
      logo: logo || undefined,
      notes: notes || 'Draft imported from a brand guide. Confirm colours, fonts and tone before using this as a preset.',
      source: file,
    };
    const dest = opts.out || join(Preset.LOCAL, name + '.json');
    mkdirSync(dirname(dest), { recursive: true });
    // validate may fail on unknown custom bits; keep colors extra
    try { Preset.save(name, { ...draft, colors: undefined, fontMentions: undefined, logo: draft.logo, source: undefined, draft: true }); }
    catch {
      writeFileSync(dest, JSON.stringify(draft, null, 2) + '\n');
    }
    // Always write the rich draft (colours, mentions) to the dest
    writeFileSync(dest, JSON.stringify(draft, null, 2) + '\n');
    return { dest, draft, warnings };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
  const src = argv.find(a => !a.startsWith('--') && a !== opt('name') && a !== opt('out'));
  if (!src) { console.error('usage: npm run brand:import -- <file> [--name <preset>]'); process.exit(1); }
  try {
    const { dest, draft, warnings } = await importGuide(src, { name: opt('name'), out: opt('out') });
    console.log('draft preset:', dest);
    console.log('fonts:', draft.fonts, draft.fontMentions && draft.fontMentions.length ? '(mentions: ' + draft.fontMentions.join(', ') + ')' : '');
    if (draft.colors && draft.colors.length) console.log('colours:', draft.colors.map(c => c.hex).join(', '));
    if (draft.notes) console.log('notes:', draft.notes);
    warnings.forEach(w => console.warn('note:', w));
    console.log('This is a draft. Open it, confirm the choices, then use: npm run reel -- --preset ' + draft.name);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
