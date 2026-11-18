// The full option menu, always sourced from the catalogs so a new effect, finish,
// bed, font, theme, transition or sound cannot stay hidden.
//   npm run menu              print every option, grouped, with a one-line label
//   npm run menu -- --json    machine-readable
//   npm run list -- transitions|titles|captions|graphics|effects [--json]   one part of the effects menu (docs/effects.md)
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
const XFX = require('./xfx.cjs');
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
// what each kinetic title entrance does (drawn by heroEnter in kit/overlay.html; names from kit/rules.cjs ENTRANCES)
export const ENTRANCE_ABOUT = {
  'stagger-rise': 'letters rise into place one after another',
  slam: 'the word slams in oversized, overshoots and shakes to a stop',
  'blur-rise': 'the word rises from below out of a heavy blur',
  'slide-left': 'the word slides in from the right with a slant that straightens',
  elastic: 'the word scales up with an elastic wobble',
  flip: 'the word flips in vertically, like a card turning over',
  'pop-zoom': 'the word pops in from nothing with a small overshoot',
  drop: 'each letter falls in from above with a small bounce and tilt',
  typewriter: 'the letters type on one at a time from the left behind a blinking caret',
};
// what each caption entrance does to kinetic hero words (capEnter in kit/overlay.html; names from kit/reelmd.cjs CAPTION_LOOK)
export const CAPTION_ENTRANCE_ABOUT = {
  pop: 'the whole word springs in with a pop (default)',
  unfurl: 'each letter opens out from its left edge',
  cascade: 'letters drop in one after another and settle',
  orbit: 'letters swing in on an arc',
  warp: 'letters stretch and wobble, then settle',
  crystallize: 'scattered, blurred letters gather into the word',
  compute: 'the word decodes from random characters',
  levitate: 'letters float up into place',
  undulate: 'letters ride a wave that calms down',
  typewriter: 'the word types on letter by letter behind a blinking caret',
};
// the editing principles built in (docs/guide.md "Editing principles built in"): each one on its own, and all of them
// together as the magazine preset (--preset magazine, or "- preset: magazine" in a Reel.md)
export const EDITING = [
  { id: 'magazine', flag: '--preset magazine  or  Reel.md  - preset: magazine', label: 'every principle below at once: serif and sans mixed, placed titles, colour and chapter cards, energy-matched music, mapped and capped sounds, 12% punch-ins, typewriter and crossfades, no dead air' },
  { id: 'accent-script', flag: '"lockup": { "accent": "script" }  or  Reel.md title  | accent script |', label: 'three faces in one phrase: a serif numeral or hero word, one italic serif word, sans for the rest (pairings playfair and dmserif do it by default)' },
  { id: 'place-left', flag: '"place": "left"  on a title or caption  or  Reel.md  | place left |', label: 'the words sit left of your head at eye level' },
  { id: 'place-right', flag: '"place": "right"  or  | place right |', label: 'the words sit right of your head at eye level' },
  { id: 'place-above', flag: '"place": "above"  or  | place above |', label: 'the words sit above your head' },
  { id: 'place-chest', flag: '"place": "chest"  or  | place chest |', label: 'the words sit across your chest' },
  { id: 'place-face', flag: '"place": "face"  or  | place face |', label: 'big over your face, behind your head while it covers under 22% of the letters, else above it (a title goes in front with layer front)' },
  { id: 'title-places', flag: '"titlePlaces": ["left","face","right","chest"]  in a preset  or  Reel.md  - title-places: left, face, right', label: 'drafted titles take these places in turn' },
  { id: 'colour-card', flag: '{ "mode": 8, "bg": "olive" }  or  Reel.md reel-cards  #01 4.2-5.4 | bg olive', label: 'the frame cuts to a flat colour for a beat and your caption words carry it in the card ink (olive, ivory, sage, clay, blush, forest, navy, cream, paper, blue, ink)' },
  { id: 'chapter-card', flag: '{ "mode": 8, "bg": "ivory", "chapter": "2" }  or  reel-cards  | bg ivory | chapter 2', label: 'a colour card with a big serif numeral, one per list item' },
  { id: 'cards-auto', flag: '--cards auto  or  "cards": "auto"  or  Reel.md  - cards: auto', label: 'chapter cards when you count off a list, colour cards on short lines to land, and the number-pop intro; npm run plan -- <job> --cards writes them to the Reel.md first' },
  { id: 'music-energy', flag: '--music-energy low|mid|high|auto  or  Reel.md Music  - energy: auto  (- bed: auto)', label: 'a library bed picked by energy; auto reads how fast you talk' },
  { id: 'sfx-map', flag: '"sfxMap": true  or  Reel.md  - sfx-map: on', label: 'a whoosh on named transitions, a swipe on cards, a pop on titles, graphics and list numbers, typing under a typewriter title, a click on a big punch-in' },
  { id: 'sfx-cap', flag: '"sfxCap": { "minGap": 0.25, "per10": 6 }  or  --no-sfx-cap  or  Reel.md  - sfx-cap: 0.4/4', label: 'the sound density cap, on by default: sounds stay apart and sparse, the bigger move wins' },
  { id: 'punch', flag: '"punch": 0.12  in cut.json or a preset  or  Reel.md  - punch: 0.12', label: 'every other cut punches in by this much (10% by default; 10 to 15% reads best)' },
  { id: 'tighten', flag: '--tighten 0.3  or  "tighten": 0.3  or  Reel.md  - tighten: 0.3   (--no-tighten)', label: 'no dead air: a pause inside a line longer than this cuts to a jump, keeping a breath' },
];
const RM = require('./reelmd.cjs');
const CAPTION_ENTRANCES = RM.CAPTION_LOOK['caption-entrance'][1];

const TITLE_LAYER = [
  { id: 'front', flag: '"layer": "front"  or  "titleLayer": "front"', label: 'the whole title sits in front of the person (default)' },
  { id: 'behind', flag: '"layer": "behind"  or  "titleLayer": "behind"', label: 'the hero word goes behind the head; partner words stay in front. Slam still lands low and rises.' },
  { id: 'auto', flag: '"layer": "auto"  or  "titleLayer": "auto"', label: 'only the strongest 1 or 2 punch titles go behind the head, never consecutive ones (hook and payoff when they are not neighbours)' },
];

// Graphic overlays (kit/graphics.json): ordinal sticker, app label, screen card, lower third, stat callout, checklist,
// quote card, highlight, step counter, versus, icon badge, sticker pop, price tag, CTA card, code card.
export function loadGraphics() {
  return JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics || [];
}

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
  const gfx = loadGraphics();

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
    flag: `"entrance": "${id}"  on a mode 7 title  or  Reel.md reel-titles  | entrance ${id} |`,
    label: ENTRANCE_ABOUT[id] || 'kinetic title entrance',
  }));

  const captionEntrances = CAPTION_ENTRANCES.map(id => ({
    kind: 'captionEntrance', id, section: 'caption-entrances',
    flag: `--caption-entrance ${id}  or  "captionEntrance": "${id}"`,
    label: CAPTION_ENTRANCE_ABOUT[id] || 'caption entrance',
  }));

  const about = trans.about || {};
  const transitions = Object.keys(trans.names || {}).map(id => {
    const mode = trans.names[id];
    const tech = mode == null ? (id === 'glitch' ? 'hard cut with the glitch seam (default)' : 'hard cut, no seam') : XFX.label(mode);
    return {
      kind: 'transition', id, section: 'transitions',
      flag: `"transition": "${id}"`,
      label: about[id] ? (mode == null ? about[id] : `${about[id]} (${tech})`) : tech,
      engine: tech,
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

  const graphics = gfx.map(g => ({
    kind: 'graphic', id: g.id, section: 'graphics',
    flag: `"mode": ${g.mode}  (entrance ${g.entrance})`,
    label: g.label, mode: g.mode, entrance: g.entrance, fields: g.fields || {}, example: g.example,
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
    label: `${b.title} (${b.seconds}s, ${b.lufs} LUFS${b.energy ? ', ' + b.energy + ' energy' : ''})`,
  }));

  const exportItems = Object.entries(JSON.parse(readFileSync(join(KIT, 'exports.json'), 'utf8')).presets).map(([id, x]) => ({
    kind: 'export', id, section: 'exports',
    flag: `--export ${id}`,
    label: `${x.label}: ${x.w}x${x.h}, up to ${x.maxSec} s, ${x.videoKbps} kbps; safe area top ${x.safe.top}, bottom ${x.safe.bottom}, left ${x.safe.left}, right ${x.safe.right} px`,
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
    { id: 'caption-entrances', title: 'Caption entrances', hint: 'How kinetic hero words come in, letter by letter. One for the job (--caption-entrance, "captionEntrance", Reel.md caption-entrance) or "entrance" on a caption flip. Applies to the kinetic caption style.', items: captionEntrances },
    { id: 'title-layer', title: 'Title layer', hint: 'Front, behind the head, or auto, per title or for the job. Offer this per title. Agents and --preset auto use auto unless the preset says otherwise.', items: titleLayer },
    { id: 'transitions', title: 'Transitions', hint: 'Named cuts in cut.json. The glitch seam is the default.', items: transitions },
    { id: 'graphics', title: 'Graphics', hint: 'Original overlay graphics drawn in the theme colours and fonts, each with its own entrance and exit: captions.js flips (modes 9 to 38) or a reel-graphics block in a Reel.md. Words on them must be words you say (kit/spoken.cjs). Layer front, behind or auto: behind tucks only the top of your head over the graphic, never your face. Bring your icon or screen recording, or the kit draws a neutral placeholder. Teardown maps the first three from a reference (kit/graphics.json).', items: graphics },
    { id: 'effects', title: 'Effects', hint: 'Optional second pass (npm run fx). 51 starter effects, grouped by moment.', items: effects, moments, effectsByMoment },
    { id: 'sfx', title: 'SFX pack', hint: '37 CC0 sounds, auto-picked on npm run fx. Locked cut set is whoosh, swipe, boom, click, typing.', items: sfx },
    { id: 'beds', title: 'Music beds', hint: 'Our own tracks, loudness-matched to -13 LUFS. Hear them with the files in kit/music/.', items: beds },
    { id: 'exports', title: 'Export presets', hint: 'npm run reel -- ... --export <name> lays the reel out for that platform (titles, captions and graphics kept out of its UI) and writes reel-vN-<name>.mp4; npm run export re-exports a finished reel; npm run verify -- <job> --export <name> checks it.', items: exportItems },
    { id: 'editing', title: 'Editing principles', hint: 'Common short-form editing advice built into the engine, each usable on its own; --preset magazine (or "- preset: magazine" in a Reel.md) turns them all on. Plain words: docs/guide.md "Editing principles built in".', items: EDITING.map(x => ({ kind: 'editing', section: 'editing', ...x })) },
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
    graphic: loadGraphics().map(g => g.id),
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
  lines.push('Tip: docs/effects.md shows every transition, title entrance and caption entrance animated; npm run list -- <kind> prints one part.');
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

// npm run list -- <kind>: the effects menu (docs/effects.md) as names and one-liners. A kind is one of LIST_KINDS or
// any section id above. The preview is the looping WebP from npm run menu:render, when there is one.
export const LIST_KINDS = {
  transitions: ['transitions'],
  titles: ['title-entrances'],
  captions: ['caption-entrances', 'caption-styles'],
  graphics: ['graphics'],
  effects: ['effects'],
  editing: ['editing'],
};
const PREVIEW_DIR = { transitions: 'transitions', 'title-entrances': 'titles', 'caption-entrances': 'caption-entrances', 'caption-styles': 'caption-styles' };
export function listKind(kind, menu) {
  const m = menu || loadMenu();
  const ids = LIST_KINDS[kind] || (m.sections.some(s => s.id === kind) ? [kind] : null);
  if (!ids) return null;
  const sections = ids.map(id => {
    const s = m.sections.find(x => x.id === id);
    return { id: s.id, title: s.title, hint: s.hint, items: s.items.map(it => {
      const rel = PREVIEW_DIR[id] ? `docs/menu/${PREVIEW_DIR[id]}/${it.id}.webp` : null;
      return { id: it.id, flag: it.flag, label: it.label, ...(rel && existsSync(join(ROOT, rel)) ? { preview: rel } : {}) };
    }) };
  });
  return { kind, doc: 'docs/effects.md', sections };
}
export function printList(res) {
  const lines = [];
  for (const s of res.sections) {
    lines.push(`${s.title}  (${s.items.length})`);
    for (const it of s.items) lines.push(`  ${it.id.padEnd(24)} ${it.label}`, `  ${''.padEnd(24)} ${it.flag}`);
    lines.push('');
  }
  lines.push('Animated previews of each: docs/effects.md');
  return lines.join('\n');
}
function opt(name) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const menu = loadMenu();
  const json = process.argv.includes('--json');
  const kind = opt('list');
  if (kind !== undefined) {
    const res = kind ? listKind(kind, menu) : null;
    if (!res) {
      const kinds = { kinds: Object.keys(LIST_KINDS), sections: menu.sections.map(s => s.id), usage: 'npm run list -- <kind> [--json]', doc: 'docs/effects.md' };
      if (json) process.stdout.write(JSON.stringify(kinds, null, 2) + '\n');
      else process.stdout.write(`${kind ? `unknown kind "${kind}". ` : ''}Usage: npm run list -- <kind> [--json]\nKinds: ${kinds.kinds.join(', ')}\nOr a section: ${kinds.sections.join(', ')}\nAnimated previews: docs/effects.md\n`);
      process.exit(kind ? 1 : 0);
    }
    process.stdout.write((json ? JSON.stringify(res, null, 2) : printList(res)) + '\n');
    process.exit(0);
  }
  if (json) process.stdout.write(JSON.stringify(menu, null, 2) + '\n');
  else process.stdout.write(printMenu(menu) + '\n');
  const cov = coverage(menu);
  if (!cov.ok) {
    console.error('menu is missing catalog entries: ' + cov.missing.join(', '));
    process.exit(1);
  }
}
