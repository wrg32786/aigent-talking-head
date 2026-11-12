// The full option menu, always sourced from the catalogs so a new effect, finish,
// bed, font, theme, transition or sound cannot stay hidden.
//   npm run menu              print every option, grouped, with a one-line label
//   npm run menu -- --json    machine-readable
//
// Used by kit/showcase.mjs and npm run check (coverage: every catalog entry must
// appear in the menu, and in showcase/index.html once that gallery is generated).
import { readdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const B = require('./beats.cjs');
const R = require('./rules.cjs');
const SFXPLAN = require('./sfx-plan.cjs');
const Preset = require('./preset.cjs');

const KIT = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(KIT);

const LOOKS = [
  { id: 'kinetic', flag: '--look kinetic', label: 'every word animates, plus a kinetic title behind the head (default)' },
  { id: 'oneword', flag: '--look oneword', label: 'one word at a time, size and face changing per word, type cards, cycling pairings (kit/looks/oneword.md)' },
  { id: 'muse', flag: '--look muse', label: 'pill captions and kinetic titles behind the head' },
  { id: 'classic', flag: '--look classic', label: 'the original phrase captions and a spray-painted hero word, no titles' },
  { id: 'one-word', flag: '--look one-word', label: 'one big word at a time on screen, kinetic and punchy, plus titles behind the head' },
];
const CAPTION_STYLES = [
  { id: 'kinetic', flag: '--style kinetic  or  "captionStyle": "kinetic"', label: 'two-font lockup, hero word big in the display face' },
  { id: 'oneword', flag: '--style oneword  or  "captionStyle": "oneword"', label: 'one word at a time, key word big in the display face with the phrase building under it' },
  { id: 'pill', flag: '--style pill  or  "captionStyle": "pill"', label: '3 to 5 words in a lower-third pill' },
  { id: 'hormozi', flag: '--style hormozi  or  "captionStyle": "hormozi"', label: 'bold caps with a cyan active word' },
  { id: 'karaoke', flag: '--style karaoke  or  "captionStyle": "karaoke"', label: 'colour wipe as each word is said' },
  { id: 'classic', flag: '--style classic  or  "captionStyle": "classic"', label: 'the original phrase captions' },
  { id: 'one-word', flag: '--style one-word  or  "captionStyle": "one-word"', label: 'one big word at a time, punchy, in the display face' },
];
const BEAT_SYNC = [
  { id: 'beat-sync', flag: '--beat-sync  or  "beatSync": true', label: 'snap punches, SFX, fx hits and title entrances to the bed (default when a bed is set)' },
  { id: 'no-beat-sync', flag: '--no-beat-sync  or  "beatSync": false', label: 'leave those times alone' },
  { id: 'beatWindow', flag: '"beatWindow": 0.12', label: 'max snap distance in seconds; speech cuts never move' },
];
const TITLE_LAYER = [
  { id: 'front', flag: '"layer": "front"  or  "titleLayer": "front"', label: 'the whole title sits in front of the person (default)' },
  { id: 'behind', flag: '"layer": "behind"  or  "titleLayer": "behind"', label: 'the hero word goes behind the head; partner words stay in front. Slam still lands low and rises.' },
  { id: 'auto', flag: '"layer": "auto"  or  "titleLayer": "auto"', label: 'only the strongest 1 or 2 punch titles go behind the head, never consecutive ones (hook and payoff when they are not neighbours)' },
];

function themeLabel(name, src) {
  if (name === 'aigent') return 'AIgent brand guide, cyan accent (default)';
  if (name === 'neutral') return 'unbranded, offline, system fonts, no logo';
  const m = src && src.match(/\/\/\s*(.+)/);
  return m ? m[1].trim() : 'theme file kit/themes/' + name + '.js';
}

export function loadMenu() {
  const cat = JSON.parse(readFileSync(join(ROOT, 'effects', 'catalog.json'), 'utf8'));
  const fonts = JSON.parse(readFileSync(join(KIT, 'fonts', 'pairings.json'), 'utf8'));
  const trans = JSON.parse(readFileSync(join(KIT, 'transitions.json'), 'utf8'));
  const themes = readdirSync(join(KIT, 'themes')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort();
  const man = SFXPLAN.loadManifest();

  const finishes = B.CANON.map(id => ({
    kind: 'finish', id, section: 'finishes',
    flag: `--finish ${id}  or  "finish": "${id}"`,
    label: B.FINISH[id].does,
  }));

  const looks = LOOKS.map(x => ({ kind: 'look', section: 'looks', ...x }));
  const captionStyles = CAPTION_STYLES.map(x => ({ kind: 'captionStyle', section: 'caption-styles', ...x }));
  const beatSync = BEAT_SYNC.map(x => ({ kind: 'beatSync', section: 'beat-sync', ...x }));
  const titleLayer = TITLE_LAYER.map(x => ({ kind: 'titleLayer', section: 'title-layer', ...x }));

  const fontPairings = Object.keys(fonts.pairings || {}).map(id => {
    const p = fonts.pairings[id];
    return {
      kind: 'font', id, section: 'fonts',
      flag: `--fonts ${id}  or  "fonts": "${id}"`,
      label: id === 'theme' ? "the theme's own fonts (default)" : (p && p.about) || id,
    };
  });

  const themeItems = themes.map(id => {
    const src = readFileSync(join(KIT, 'themes', id + '.js'), 'utf8');
    return {
      kind: 'theme', id, section: 'themes',
      flag: `--theme ${id}`,
      label: themeLabel(id, src),
    };
  });

  const titleEntrances = R.ENTRANCES.map(id => ({
    kind: 'entrance', id, section: 'title-entrances',
    flag: `"entrance": "${id}"  on a mode 7 title`,
    label: 'kinetic title entrance (each used at most once per video)',
  }));

  const transitions = Object.keys(trans.names || {}).map(id => {
    const mode = trans.names[id];
    return {
      kind: 'transition', id, section: 'transitions',
      flag: `"transition": "${id}"`,
      label: mode == null ? (id === 'glitch' ? 'hard cut with the glitch seam (default)' : 'hard cut, no seam') : `ffmpeg xfade ${mode}`,
    };
  });

  const effects = (cat.effects || []).map(e => ({
    kind: 'effect', id: e.name, section: 'effects',
    flag: `"fx": "${e.name}"`,
    label: e.does,
    moments: e.moments || [],
    energy: e.energy,
    n: e.n,
    needs: e.needs || [],
    required: e.required || [],
    requiredIf: e.requiredIf || {},
    options: e.options || {},
    duration: e.duration,
    captions: e.captions,
  }));

  const moments = cat.moments || {};
  const effectsByMoment = {};
  for (const id of Object.keys(moments)) effectsByMoment[id] = effects.filter(e => e.moments.includes(id));

  const sfx = (man.sounds || []).map(s => ({
    kind: 'sfx', id: s.id, section: 'sfx',
    flag: `"sfx": "${s.id}"  or  sfxHits id`,
    label: `${s.category} pack sound (${s.duration}s, hit at ${s.hit}s)`,
    category: s.category,
  }));

  const beds = Object.entries(R.BEDS).filter(([, v]) => v && typeof v.file === 'string').map(([id, b]) => ({
    kind: 'bed', id, section: 'beds',
    flag: `--bed ${id}  or  "bed": "${id}"`,
    label: `${b.title} (${b.seconds}s, ${b.lufs} LUFS)`,
  }));

  const presetItems = Preset.list().map(p => ({
    kind: 'preset', id: p.name, section: 'presets',
    flag: `--preset ${p.name}`,
    label: p.label || p.name,
    shipped: !!p.shipped,
    draft: !!p.draft,
  }));

  const sections = [
    { id: 'finishes', title: 'Film finishes', hint: 'On the picture, before titles. Set globally or per segment, and vary them across scenes rather than one look on everything.', items: finishes },
    { id: 'beat-sync', title: 'Beat-sync', hint: 'When a music bed is set, accents can land on the music. Speech cuts stay put.', items: beatSync },
    { id: 'looks', title: 'Looks', hint: 'The overall edit. --look also picks a default caption style.', items: looks },
    { id: 'caption-styles', title: 'Caption styles', hint: 'Override the look with --style, or "captionStyle" in captions.js.', items: captionStyles },
    { id: 'fonts', title: 'Font pairings', hint: 'Two faces as a lockup. Your own licensed fonts go in kit/fonts/local/.', items: fontPairings },
    { id: 'themes', title: 'Themes', hint: 'Colours, default fonts, optional logo.', items: themeItems },
    { id: 'title-entrances', title: 'Title entrances', hint: 'One kinetic title per beat. Flicker only on the hook and the payoff. Default layer is in front of the person.', items: titleEntrances },
    { id: 'title-layer', title: 'Title layer', hint: 'Front, behind the head, or auto, per title or for the job. Offer this per title. Agents and --preset auto use auto unless the preset says otherwise.', items: titleLayer },
    { id: 'transitions', title: 'Transitions', hint: 'Named cuts in cut.json. The glitch seam is the default.', items: transitions },
    { id: 'effects', title: 'Effects', hint: 'Optional second pass (npm run fx). 51 starter effects, grouped by moment.', items: effects, moments, effectsByMoment },
    { id: 'sfx', title: 'SFX pack', hint: '31 CC0 sounds, auto-picked on npm run fx. Locked cut set is whoosh, swipe, boom, click, typing.', items: sfx },
    { id: 'beds', title: 'Music beds', hint: 'Our own tracks, loudness-matched to -13 LUFS. Hear them with the files in kit/music/.', items: beds },
    { id: 'presets', title: 'Brand presets', hint: 'A saved mix of theme, look, type, finishes and favourites. npm run reel -- --preset <name>. Flags you pass win. --preset auto picks one and prints what it chose.', items: presetItems },
  ];

  const items = sections.flatMap(s => s.items);
  return { sections, items, moments, effectsByMoment, catalog: cat };
}

export function catalogIds(menu) {
  const m = menu || loadMenu();
  const by = {};
  for (const it of m.items) (by[it.kind] || (by[it.kind] = [])).push(it.id);
  return by;
}

// Every id that lives in a source catalog (not the hardcoded look/style/beat flags).
export function sourceCatalogIds() {
  const cat = JSON.parse(readFileSync(join(ROOT, 'effects', 'catalog.json'), 'utf8'));
  const fonts = JSON.parse(readFileSync(join(KIT, 'fonts', 'pairings.json'), 'utf8'));
  const trans = JSON.parse(readFileSync(join(KIT, 'transitions.json'), 'utf8'));
  const themes = readdirSync(join(KIT, 'themes')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
  const man = SFXPLAN.loadManifest();
  const beds = Object.entries(R.BEDS).filter(([, v]) => v && typeof v.file === 'string').map(([id]) => id);
  return {
    finish: [...B.CANON],
    effect: cat.effects.map(e => e.name),
    transition: Object.keys(trans.names || {}),
    font: Object.keys(fonts.pairings || {}),
    theme: themes.sort(),
    sfx: (man.sounds || []).map(s => s.id),
    bed: beds,
    entrance: [...R.ENTRANCES],
    look: LOOKS.map(x => x.id),
    captionStyle: CAPTION_STYLES.map(x => x.id),
    beatSync: BEAT_SYNC.map(x => x.id),
    titleLayer: TITLE_LAYER.map(x => x.id),
    preset: Preset.shipped().map(p => p.name),
  };
}

export function coverage(menu) {
  const m = menu || loadMenu();
  const have = catalogIds(m);
  const want = sourceCatalogIds();
  const missing = [], extra = [];
  for (const kind of Object.keys(want)) {
    const a = new Set(have[kind] || []);
    const b = want[kind] || [];
    for (const id of b) if (!a.has(id)) missing.push(`${kind}:${id}`);
    for (const id of a) if (!b.includes(id)) extra.push(`${kind}:${id}`);
  }
  return { missing, extra, ok: missing.length === 0 };
}

// Showcase / --allow-demo-copy fills: generic labels, never upstream brand copy.
export function demoFields(effect) {
  const opt = (effect.options && effect.options.text) || '';
  let text = effect.id.replace(/-/g, ' ').split(' ')[0].toUpperCase();
  if (/step::|::meta/.test(opt)) text = 'One::first|Two::next|Three::last';
  else if (/headline::/.test(opt)) text = 'Hook::one|Claim::two';
  else if (/tile names|pills joined|rows joined|messages joined|items joined/.test(opt)) text = 'One|Two|Three';
  else if (/two lines|two labels/.test(opt)) text = 'First line|Second line';
  else if (/big number|the number, default/.test(opt)) text = '12';
  else if (/price/.test(opt)) text = '$12';
  else if (effect.id === 'liquid-glass-graph') text = 'Score';
  else if (effect.id === 'timeline') text = 'Demo';
  const out = {
    text,
    title: effect.id.replace(/-/g, ' '),
    lines: 'Line one|Line two|Line three',
    sub: 'one|two',
    chart: 'Demo::48::2|5|8|13|21',
    chip: 'link',
    reply: 'Nice work',
    label: 'total',
    pill: 'NEW',
    item: 'Top pick',
    others: 'A|B|C',
    count: '12',
    total: '48',
    to: effect.id === 'over-the-shoulder-zoom' ? '12|48' : '48',
    from: '0',
    views: '1|2|3|4|5|6|7|8|12',
  };
  const need = [...(effect.required || [])];
  const o = { fx: effect.id, sfx: false };
  for (const k of need) if (out[k] !== undefined) o[k] = out[k];
  return o;
}

export function printMenu(menu) {
  const m = menu || loadMenu();
  const lines = [];
  lines.push('aigent-talking-head menu');
  lines.push('Every option, grouped. Open showcase/index.html to see them labelled.');
  lines.push('Vary film finishes across scenes; do not use one look on the whole reel.');
  lines.push('');
  for (const s of m.sections) {
    lines.push(`${s.title}  (${s.items.length})`);
    if (s.hint) lines.push(`  ${s.hint}`);
    if (s.id === 'effects' && s.effectsByMoment) {
      for (const [mid, label] of Object.entries(s.moments || {})) {
        const list = s.effectsByMoment[mid] || [];
        lines.push(`  ${mid}  ${label}`);
        for (const it of list) {
          const en = it.energy ? ` [${it.energy}]` : '';
          lines.push(`    ${it.id.padEnd(24)} ${it.flag.padEnd(28)} ${it.label}${en}`);
        }
      }
    } else {
      for (const it of s.items) {
        lines.push(`  ${it.id.padEnd(24)} ${it.flag}`);
        lines.push(`    ${it.label}`);
      }
    }
    lines.push('');
  }
  lines.push('Tip: npm run showcase  rebuilds the labelled gallery at showcase/index.html');
  return lines.join('\n');
}

export function showcaseHas(html, ids) {
  const missing = [];
  for (const [kind, list] of Object.entries(ids)) {
    for (const id of list) {
      const token = `data-id="${kind}:${id}"`;
      if (!html.includes(token)) missing.push(`${kind}:${id}`);
    }
  }
  return { missing, ok: missing.length === 0 };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const menu = loadMenu();
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(menu, null, 2) + '\n');
  else process.stdout.write(printMenu(menu) + '\n');
  const cov = coverage(menu);
  if (!cov.ok) {
    console.error('menu is missing catalog entries: ' + cov.missing.join(', '));
    process.exit(1);
  }
}
