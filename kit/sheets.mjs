// Build labelled contact sheets and a GitHub-rendered gallery markdown
// from the committed showcase stills. Used by npm run showcase, or:
//   node kit/sheets.mjs
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadMenu } from './menu.mjs';

const require = createRequire(import.meta.url);
const Preset = require('./preset.cjs');

const KIT = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(KIT);
const OUT = join(ROOT, 'showcase');
const SHEETS = join(OUT, 'sheets');
const FOLDER = {
  finish: 'finish', effect: 'effect', graphic: 'graphic', transition: 'transition', font: 'font',
  theme: 'theme', entrance: 'entrance', look: 'look', captionStyle: 'caption',
  preset: 'preset', bed: 'bed', sfx: 'sfx', beatSync: 'beatSync', titleLayer: 'titleLayer',
};

function whichPillowPy() {
  const cands = ['python3', process.env.PYTHON, process.platform === 'win32' ? 'py' : null].filter(Boolean);
  for (const py of cands) {
    try {
      execFileSync(py, ['-c', 'from PIL import Image'], { stdio: 'ignore' });
      return py;
    } catch {}
  }
  throw new Error('Need Python with Pillow to build contact sheets (python3 -c "from PIL import Image")');
}

function stillPath(kind, id) {

  const dir = FOLDER[kind] || kind;
  return join(OUT, 'media', dir, id + '.jpg');
}

// the looping WebP from npm run menu:render (docs/menu/), used instead of a still where there is one
const ANIM = { entrance: 'titles', transition: 'transitions', captionStyle: 'caption-styles', captionEntrance: 'caption-entrances' };
export function animPreview(kind, id) {
  const dir = ANIM[kind];
  return dir && existsSync(join(ROOT, 'docs', 'menu', dir, id + '.webp')) ? `../docs/menu/${dir}/${id}.webp` : null;
}

function sectionItems(menu, sectionId, kind) {
  const sec = menu.sections.find(s => s.id === sectionId);
  if (!sec) return [];
  let items = sec.items;
  if (sectionId === 'presets') {
    const shipped = new Set(Preset.shipped().map(p => p.name));
    items = items.filter(it => shipped.has(it.id));
  }
  return items.map(it => ({
    id: it.id,
    kind: it.kind || kind,
    flag: it.flag || it.id,
    label: it.label || '',
    src: stillPath(it.kind || kind, it.id),
  }));
}

function writeContactSheets(menu) {
  mkdirSync(SHEETS, { recursive: true });
  const plan = {
    outDir: SHEETS,
    sheets: [
      { id: 'effects', title: 'Effects', subtitle: '51', cols: 7, tile_w: 220, label_h: 48, items: sectionItems(menu, 'effects', 'effect') },
      { id: 'graphics', title: 'Graphics', subtitle: `${sectionItems(menu, 'graphics', 'graphic').length}, in the theme's colours and fonts; placeholders where you bring an icon or a screen`, cols: 5, tile_w: 250, label_h: 56, items: sectionItems(menu, 'graphics', 'graphic').map(it => ({ ...it, caption: it.id + ' · ' + (it.flag.match(/entrance ([a-z-]+)/) || [])[1] })) },
      { id: 'finishes', title: 'Film finishes', subtitle: '10', cols: 5, tile_w: 280, label_h: 52, items: sectionItems(menu, 'finishes', 'finish') },
      { id: 'title-layer', type: 'pair', title: 'Title layer', subtitle: 'same title, front vs behind', tile_w: 360, label_h: 56,
        left: { src: stillPath('titleLayer', 'front'), label: 'In front' },
        right: { src: stillPath('titleLayer', 'behind'), label: 'Behind head' } },
      { id: 'entrances', title: 'Title entrances', subtitle: 'in front by default', cols: 7, tile_w: 240, label_h: 56,
        items: sectionItems(menu, 'title-entrances', 'entrance').map(it => ({ ...it, caption: it.id + ' · in front' })) },
      { id: 'captions', title: 'Caption styles', cols: 7, tile_w: 240, label_h: 52, items: sectionItems(menu, 'caption-styles', 'captionStyle') },
      { id: 'fonts', title: 'Font pairings', subtitle: 'hero + partner lockups', cols: 6, tile_w: 240, label_h: 52, items: sectionItems(menu, 'fonts', 'font') },
      { id: 'presets', title: 'Presets', subtitle: '10 shipped', cols: 5, tile_w: 280, label_h: 52, items: sectionItems(menu, 'presets', 'preset') },
    ],
  };
  const planFile = join(tmpdir(), 'ath-sheets-plan.json');
  writeFileSync(planFile, JSON.stringify(plan));
  const py = whichPillowPy();
  execFileSync(py, [join(KIT, 'sheets.py'), planFile], { stdio: 'inherit' });
  return plan.sheets;
}

function mdRow(cells, perRow) {
  const lines = [];
  for (let i = 0; i < cells.length; i += perRow) {
    const slice = cells.slice(i, i + perRow);
    while (slice.length < perRow) slice.push('');
    lines.push('| ' + slice.join(' | ') + ' |');
  }
  return lines.join('\n');
}

export function writeGalleryMarkdown(menu) {
  const header = (n) => '|' + Array(n).fill('').join(' --- |') + ' --- |';
  const blocks = [];
  const groups = [
    ['Effects', 'effects', 'effect', 5],
    ['Graphics', 'graphics', 'graphic', 5],
    ['Film finishes', 'finishes', 'finish', 5],
    ['Title layer', 'title-layer', 'titleLayer', 3],
    ['Title entrances', 'title-entrances', 'entrance', 7],
    ['Caption styles', 'caption-styles', 'captionStyle', 7],
    ['Caption entrances', 'caption-entrances', 'captionEntrance', 5],
    ['Font pairings', 'fonts', 'font', 5],
    ['Presets', 'presets', 'preset', 5],
    ['Looks', 'looks', 'look', 5],
    ['Themes', 'themes', 'theme', 2],
    ['Transitions', 'transitions', 'transition', 5],
    ['Music beds', 'beds', 'bed', 5],
    ['SFX pack', 'sfx', 'sfx', 5],
  ];
  for (const [title, sectionId, kind, perRow] of groups) {
    const items = sectionItems(menu, sectionId, kind);
    if (!items.length) continue;
    const cells = items.map(it => {
      const rel = animPreview(it.kind, it.id) || `media/${FOLDER[it.kind] || it.kind}/${it.id}.jpg`;
      return `![${it.id}](${rel})<br>\`${it.id}\``;
    });
    blocks.push(`## ${title}\n\n${header(perRow)}\n${mdRow(cells, perRow)}\n`);
  }
  const md = `# Showcase gallery

Every option, labelled, from the committed stills. Transitions, title entrances, caption entrances and caption styles play as looping previews from the [effects menu](../docs/effects.md). These images render on GitHub. The contact sheets in [\`sheets/\`](sheets/) are the same set, packed into a few montages, and are what the root README shows.

The interactive page is [index.html](index.html). Open it from a full clone or zip of the repo; if you download only that HTML file, the images will not load.

Stills use an AI-generated fictional presenter (Apache-2.0 with the repo). Rebuild with \`npm run showcase\` from the repo root.

${blocks.join('\n')}
`;
  writeFileSync(join(OUT, 'GALLERY.md'), md);
}

export function writeSheetsAndGallery(menu) {
  const sheets = writeContactSheets(menu);
  writeGalleryMarkdown(menu);
  return sheets;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const menu = loadMenu();
  writeSheetsAndGallery(menu);
}
