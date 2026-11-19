// Style pack previews: a short looping WebP and a still strip per pack, drawn by the kit itself, plus the gallery page.
//   npm run pack:preview                      every pack (needs ffmpeg and Chrome: npm run chrome)
//   npm run pack:preview -- <name|path> ...   just these packs
//   npm run pack:preview -- --sheet <file.png>   also write one contact sheet of every preview strip (for review)
//   npm run pack:preview -- --docs-only       rewrite docs/packs.md from the packs without rendering
// Each preview: the pack's title entrance on a kinetic title, its caption style and caption entrance on a spoken line,
// a colour card when the pack uses cards, its first film finish, then its first allowed transition into a second shot.
// Titles and captions are drawn by kit/overlay.html through kit/render.mjs with the pack's theme and fonts; the
// transition runs through the same xfade options as kit/assemble.cjs. The picture is showcase/source/presenter.jpg
// (an AI-generated fictional presenter made for this project).
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const K = require('./packs.cjs'), L = require('./locks.cjs'), B = require('./beats.cjs'), XFX = require('./xfx.cjs');
const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const PRESENTER = join(ROOT, 'showcase', 'source', 'presenter.jpg');
const MONO = join(KIT, 'fonts', 'JetBrainsMono-VF.ttf');
const W = 270, H = 480, FPS = 15, A_LEN = 3.0, T_AT = 2.6, T_D = 0.4, B_LEN = 1.4, LEN = T_AT + T_D + B_LEN - T_D;
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const SHEET = opt('sheet');
const names = argv.filter((a, i) => !a.startsWith('--') && !(i && ['sheet'].includes(argv[i - 1].replace(/^--/, ''))));

function sh(cmd, args, opts = {}) {
  try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }
  catch (e) { throw new Error([e.message, e.stderr && e.stderr.toString()].filter(Boolean).join('\n')); }
}
const ff = args => sh('ffmpeg', ['-v', 'error', '-y', ...args]);
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
const label = name => `drawbox=x=0:y=ih-32:w=iw:h=32:color=black@0.66:t=fill,drawtext=fontfile='${esc(MONO)}':text='${esc(name)}':fontsize=16:fontcolor=white:x=(w-tw)/2:y=h-23`;
const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

// what the preview shows, from the pack: locks first, then the pack's own style
export function previewPlan(pack) {
  const st = K.toPreset(pack), lk = pack.locks || {};
  const finishes = (lk.finishes || st.finishPool || (st.finish ? [st.finish] : [])).filter(f => f && f !== 'none');
  const titles = st.titles !== false && st.look !== 'classic' && lk.maxTitles !== 0;
  return {
    theme: st.theme || 'aigent', fonts: st.fonts || 'theme', captionStyle: st.captionStyle || 'kinetic',
    titleEntrance: titles ? ((lk.titles && lk.titles[0]) || (st.entranceOrder && st.entranceOrder[0]) || 'stagger-rise') : null,
    captionEntrance: lk.captionEntrance || null,
    card: (st.cards === 'auto' && lk.cards !== false) ? ((st.cardPalette && st.cardPalette[0]) || 'olive') : null,
    finishA: finishes[0] || null, finishB: finishes[1] || finishes[0] || null,
    transition: (lk.transitions && lk.transitions[0]) || st.transition || 'glitch',
  };
}

const WORDS = ['Record', 'one', 'take', 'on', 'your', 'phone'];
function overlayDoc(pl) {
  const flips = [];
  const capAt = pl.titleEntrance ? 1.35 : 0.25;
  if (pl.titleEntrance) flips.push({ start: 0.15, end: 1.3, text: 'Make it yours', mode: 7, hero: [2], entrance: pl.titleEntrance, flicker: false, layer: 'front' });
  flips.push({ start: capAt, end: A_LEN, text: WORDS.join(' '), mode: 0, words: WORDS.map((w, k) => [+(capAt + 0.05 + k * 0.18).toFixed(2), +(capAt + 0.23 + k * 0.18).toFixed(2), w]), hero: 'record', ...(pl.captionEntrance ? { entrance: pl.captionEntrance } : {}) });
  if (pl.card) flips.push({ start: 2.05, end: 2.6, mode: 8, text: '', bg: pl.card, chapter: '1' });
  return { captionStyle: pl.captionStyle, layout: false, ...(pl.captionEntrance ? { captionEntrance: pl.captionEntrance } : {}), flips };
}

function renderPack(pack, work) {
  const pl = previewPlan(pack), dir = join(work, pack.name);
  mkdirSync(join(dir, 'build'), { recursive: true });
  writeFileSync(join(dir, 'build', 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(overlayDoc(pl)) + ';\n');
  sh(process.execPath, [join(KIT, 'render.mjs'), String(A_LEN)], { cwd: join(dir, 'build'), env: { ...process.env, THEME: pl.theme, FONTS: pl.fonts, FPS: String(FPS) } });
  const fin = f => (f ? ',' + B.finishChain(f) : '');
  // shot A: the presenter with the overlay layers; shot B: the same frame mirrored, a second finish
  // a soft shade over the top third, under the type: the plate is a light wall, and a real reel gets the kit's
  // legibility pass (kit/legibility.py), which a preview skips
  const shade = join(work, 'shade.png');
  if (!existsSync(shade)) ff(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920,format=rgba', '-vf', "geq=r=0:g=0:b=0:a='if(lt(Y,760),110*pow(1-Y/760,1.4),0)'", '-frames:v', '1', shade]);
  const a = join(dir, 'a.mp4'), b = join(dir, 'b.mp4'), ins = ['-loop', '1', '-framerate', String(FPS), '-i', PRESENTER, '-loop', '1', '-framerate', String(FPS), '-i', shade];
  const layers = ['ovlt', 'ovlp', 'ovl'].filter(d => existsSync(join(dir, 'build', d)) && readdirSync(join(dir, 'build', d)).length);
  for (const d of layers) ins.push('-framerate', String(FPS), '-i', join(dir, 'build', d, '%04d.png'));
  let f = `[0:v]scale=1080:1920,setsar=1${fin(pl.finishA)},format=rgba[p0];[p0][1:v]overlay=0:0:format=auto[b0]`, last = 'b0';
  layers.forEach((_, i) => { f += `;[${last}][${i + 2}:v]overlay=0:0:format=auto[b${i + 1}]`; last = `b${i + 1}`; });
  f += `;[${last}]scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[o]`;
  ff([...ins, '-filter_complex', f, '-map', '[o]', '-t', String(A_LEN), ...enc, a]);
  ff(['-loop', '1', '-framerate', String(FPS), '-i', PRESENTER, '-vf', `scale=1080:1920,setsar=1,hflip${fin(pl.finishB)},scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p`, '-t', String(B_LEN), ...enc, b]);
  const trans = require('./transitions.json'), mode = trans.names[pl.transition], clip = join(dir, 'clip.mp4');
  const tag = `${pack.name} | ${pl.transition}`;
  if (mode) ff(['-i', a, '-i', b, '-filter_complex', `[0][1]xfade=${XFX.xfadeOpts(mode, { color: '#5cf9e2' })}:duration=${T_D}:offset=${T_AT},format=yuv420p,${label(tag)}`, ...enc, clip]);
  else {
    const cutAt = T_AT + T_D / 2, k = W / 1080;
    const env = hz => `${(24 * k).toFixed(2)}*gte(t,${cutAt})*exp(-8*(t-${cutAt}))*sin(2*PI*${hz}*(t-${cutAt}))`;
    const win = `between(t,${(cutAt - 0.04).toFixed(2)},${(cutAt + 0.17).toFixed(2)})`;
    const seam = pl.transition === 'glitch' ? `,split[sa][sb];[sa][sb]overlay=x='${env(17)}':y='${env(23)}':eval=frame,rgbashift=rh=-4:bh=4:rv=1:bv=-1:enable='${win}',noise=c0s=46:c0f=t+u:enable='${win}'` : '';
    ff(['-i', a, '-i', b, '-filter_complex', `[0]trim=0:${cutAt},setpts=PTS-STARTPTS[x];[1]trim=${T_D / 2}:${B_LEN},setpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=1[c];[c]format=yuv420p${seam},${label(tag)}`, ...enc, clip]);
  }
  const webp = join(pack.dir, (pack.preview && pack.preview.webp) || 'preview.webp'), png = join(pack.dir, (pack.preview && pack.preview.png) || 'preview.png');
  ff(['-i', clip, '-vf', `fps=${FPS}`, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '60', '-compression_level', '6', '-loop', '0', webp]);
  // the still strip: the title landing, the caption (or the card), and just after the transition
  const at = [pl.titleEntrance ? 0.95 : 0.9, 2.52, T_AT + T_D + 0.25];
  const frames = at.map((t, i) => { const p = join(dir, `s${i}.png`); ff(['-ss', String(t), '-i', clip, '-frames:v', '1', '-update', '1', p]); return p; });
  ff([...frames.flatMap(p => ['-i', p]), '-filter_complex', `hstack=inputs=${frames.length}`, '-frames:v', '1', '-update', '1', png]);
  return { pack: pack.name, plan: pl, webp, png };
}

export function writePacksDoc(packs = K.list().filter(p => p.shipped)) {
  const lines = [
    '# Style packs',
    '',
    'A style pack is a whole look in one folder: the base preset, any style keys on top, locks that pin your choices, transition weights, and a preview. The auto-picker only chooses inside the locks, so you get variety without losing control.',
    '',
    'Use one: `npm run reel -- <clip> --pack <name>`. See every option first: [docs/effects.md](effects.md) (animated) or `npm run list -- <kind>`.',
    '',
    '## Gallery',
    '',
  ];
  for (const p of packs) {
    const r = K.resolved(p), pl = previewPlan(p);
    lines.push(`### ${p.name}  (v${p.version})`, '', p.label, '');
    if (p.preview && p.preview.webp) lines.push(`<img src="../${p.origin}/${p.preview.webp}" width="180" alt="${p.name} preview: ${pl.titleEntrance ? pl.titleEntrance + ' title, ' : ''}${pl.captionStyle} captions, ${pl.transition} transition">`, '');
    lines.push(`- Use it: \`npm run reel -- <clip> --pack ${p.name}\``, `- Starts from preset: \`${p.extends || 'none'}\`; theme \`${r.style.theme || 'aigent'}\`, look \`${r.style.look || 'kinetic'}\`, captions \`${r.style.captionStyle || 'kinetic'}\`, fonts \`${r.style.fonts || 'theme'}\``, `- Locks: ${L.describe(p.locks)}`, `- Folder: [${p.origin}](../${p.origin})`, '');
  }
  lines.push(
    '## Take control',
    '',
    'Three ways to pin what the kit picks, from lightest to most exact:',
    '',
    '1. **Lock on the command line.** Locks win over the pack and the auto-picker:',
    '   ```',
    '   npm run reel -- inbox/take.mov --pack magazine --lock "transitions=whip,zoom; titles=typewriter; no-graphics=checklist"',
    '   ```',
    '   Keys: `transitions`, `titles` (title entrances), `max-titles`, `caption-entrance`, `graphics` (only these), `no-graphics`, `finishes` (`none` for no finish), `cards=off`, `sfx=off`, `punch` (`off` or 0.02 to 0.3).',
    '2. **See what was picked, then change it.** Every draft writes `jobs/<job>/choices.json` and prints a table: each beat\'s transition, finish and punch, each title\'s entrance, place and layer, each graphic, the music and the sounds, with the reason for each pick (locked, from the pack, from the recipe, or the kit\'s default).',
    '   ```',
    '   npm run choices -- <job>              # print the table again',
    '   # edit jobs/<job>/choices.json: change a transition or an entrance, set "keep": false on a graphic',
    '   npm run choices -- <job> --apply      # write your edits into the job',
    '   npm run reel -- --rebuild --name <job>',
    '   ```',
    '   Or pin a lock on an existing job: `npm run choices -- <job> --lock "titles=typewriter"`, then rebuild.',
    '3. **Save it as a pack.** `npm run pack:new -- my-look --from <preset|pack|job>` writes `packs/local/my-look/` with `pack.json` and a README. Edit the style keys and locks, then `npm run pack:validate -- my-look` and `npm run pack:preview -- my-look`.',
    '',
    'Agents get the same through the MCP server: `list_packs`, `get_pack`, `explain` (the choices table) and `set_locks`, and `render` takes `pack` and `lock`.',
    '',
    '## Make your own pack',
    '',
    '```',
    'packs/local/my-look/',
    '  pack.json      the pack (schema: packs/pack.schema.json)',
    '  README.md      what it is for',
    '  preview.webp   a looping preview (npm run pack:preview -- my-look)',
    '  preview.png    a still strip of the same',
    '```',
    '',
    '`pack.json` fields:',
    '',
    '| Field | What it does |',
    '| --- | --- |',
    '| `format`, `formatVersion` | `aigent-style-pack`, `1`. A breaking change to the format bumps the version, and the kit refuses versions it does not know. |',
    '| `name`, `version`, `label` | The folder name, the pack\'s own semver, and a one-line label. |',
    '| `extends` | A preset in `kit/presets` to start from. |',
    '| `style` | Any preset key on top: theme, look, captionStyle, fonts, titles, finish, finishPool, transition, glitch, punch, tighten, cards, cardPalette, musicEnergy, bed, sfxMap, sfxCap, titlePlaces, entranceOrder, titleLayer, effectsFavourites, beatSync. |',
    '| `locks` | Pinned choices: transitions, titles, maxTitles, captionEntrance, graphics `{ allow, deny }`, finishes, cards, sfx, punch. |',
    '| `weights.transitions` | How often each allowed transition comes up, e.g. `{ "crossfade": 3, "dissolve": 1 }`. |',
    '| `preview` | The preview files, `{ "webp": "preview.webp", "png": "preview.png" }`. |',
    '| `assets` | Files the pack ships (a font, a bed, a logo), each with `path`, `license` and `source`. Only Apache-2.0, MIT, BSD, ISC, CC0 or OFL. |',
    '',
    'Share a pack by sharing its folder. Someone drops it into `packs/local/` (or passes the path: `--pack ./my-look`) and runs `npm run pack:validate` first. Packs are data only: no code runs from a pack.',
    '',
    'Got a pack worth showing? Open a "Show your reel" issue with the pack folder and a reel made with it.',
    '',
  );
  writeFileSync(join(ROOT, 'docs', 'packs.md'), lines.join('\n'));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const packs = names.length ? names.map(n => { const p = K.load(n); if (!p) { console.error(`No pack ${n}`); process.exit(1); } return p; }) : K.list();
  if (!argv.includes('--docs-only')) {
    if (!existsSync(PRESENTER)) throw new Error('missing ' + PRESENTER);
    const work = mkdtempSync(join(tmpdir(), 'ath-packs-'));
    const made = [];
    try {
      for (const p of packs) { process.stdout.write(`pack ${p.name} ... `); const r = renderPack(p, work); made.push(r); console.log(`${r.plan.titleEntrance || 'no title'}, ${r.plan.captionStyle}, ${r.plan.transition}`); }
      if (SHEET) {
        const dest = resolve(SHEET); mkdirSync(dirname(dest), { recursive: true });
        ff([...made.flatMap(r => ['-i', r.png]), '-filter_complex', made.length > 1 ? `vstack=inputs=${made.length}` : 'null', '-frames:v', '1', '-update', '1', dest]);
        console.log('contact sheet', dest);
      }
    } finally { if (!process.env.PACK_PREVIEW_KEEP) rmSync(work, { recursive: true, force: true }); else console.log("kept " + work); }
  }
  writePacksDoc();
  console.log('wrote docs/packs.md');
}
