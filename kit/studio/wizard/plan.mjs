// The video plan (Studio builder, docs/specs/studio-builder.md section 4): one document for every choice the builder
// makes. The page, the server, the MCP tools and the agent read the same plan. toState() is the only bridge into the
// session the engine already understands (kit/studio/core.mjs applyPatch), so the engine itself is not rewritten.
// Plain JS with no imports, so the page, the tests and the server all use this one file.
//
// null in a choice means "we decide" (no pick is sent, the Look or the engine picks). An empty list means "none".
// A choice the engine cannot draw yet is kept in the plan and listed by pending(), so nothing is silently lost.

export const FORMAT = 'aigent-video-plan', VERSION = 1;

// Pacing, the first step. look: the Look decides (today's default). The rest go from slow to high energy.
export const PACES = {
  look: { label: 'Let the Look decide', says: 'The Look you pick sets the pace.', tighten: null, punch: true, energy: 'auto', beatSync: null, transitionsWhen: 'every-cut' },
  calm: { label: 'Calm', says: 'Your pauses stay. Slow, soft cuts and a quiet bed.', tighten: 'off', punch: false, energy: 'low', beatSync: false, transitionsWhen: 'topic' },
  steady: { label: 'Steady', says: 'Long pauses come out. A breath stays between lines.', tighten: 0.45, punch: false, energy: 'mid', beatSync: false, transitionsWhen: 'topic' },
  lively: { label: 'Lively', says: 'Tight lines, a zoom on some cuts, music on the beat.', tighten: 0.45, punch: true, energy: 'mid', beatSync: true, transitionsWhen: 'every-cut' },
  high: { label: 'High energy', says: 'Almost no quiet, zooms and quick cuts, a loud bed.', tighten: 0.25, punch: true, energy: 'high', beatSync: true, transitionsWhen: 'every-cut' },
};
export const PACE_ORDER = ['calm', 'steady', 'lively', 'high'];

// caption styles split by the first text question: just captions, or kinetic words
export const KINETIC_LOOKS = ['kinetic', 'oneword', 'one-word'], CAPTION_LOOKS = ['classic', 'pill', 'hormozi', 'karaoke'];
export const KEY_LEVELS = ['off', 'subtle', 'strong', 'dramatic'];
export const TRANSITION_WHEN = ['every-cut', 'topic', 'hook-cta'];
export const WHEN = ['whole', 'hook', 'key-moments', 'cta', 'hook-cta'];
export const FILTER_WHEN = ['whole', 'hook', 'cta', 'hook-cta'];
export const PLACES = { captions: ['chest', 'lower'], titles: ['left', 'right', 'above'] };
// presenter items that are not catalog effects (catalog effects are "effect:<id>")
export const PRESENTER = ['frame-breakout', 'behind-head', 'punch'];
// catalog effects the Presenter step offers (the rest sit on Graphics, Filters or the repo layouts; steps.json)
export const PRESENTER_EFFECTS = new Set(['locked-on', 'lean-in', 'spotlight', 'slow-push', 'over-the-shoulder-zoom', 'rabbit-hole', 'red-collage', 'pastel-word', 'orbit', 'shortcut-rain', 'backdrop-word', 'huge-strike', 'crayon-write', 'led-sign', 'swipe', 'reel-frame', 'place-in-grid']);
// the Graphics step's toggles and the graphics each one turns off when it is off
export const GRAPHIC_GROUPS = {
  nameTag: ['lower-third'],
  numbers: ['stat-callout', 'checklist', 'step-counter', 'number-pop', 'data-chart'],
  stickers: ['sticker-pop', 'ordinal-sticker', 'highlight', 'icon-badge', 'hud-callout'],
  cta: ['cta-card', 'cta-button'],
};

const clone = x => JSON.parse(JSON.stringify(x));
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

export function blank() {
  return {
    format: FORMAT, version: VERSION, template: null, pace: 'look',
    words: { type: null, look: null, entrance: null, titles: { on: null, entrances: [], effect: null, exit: null },
      place: { captions: null, titles: [] }, colors: { theme: null, text: null, accent: null, outline: null }, fonts: null,
      keyWords: { level: 'off', color: 'accent', maxPerLine: 1 } },
    transitions: { ids: null, when: 'every-cut' },
    presenter: [{ id: 'punch', when: 'whole' }],
    graphics: { agent: true, nameTag: true, numbers: true, stickers: true, cta: true, cards: null },
    filters: { ids: null, when: 'whole' },
    content: { repoFeature: false, repos: [], layout: 'split', takeovers: 'auto', example: null },
    music: { bed: 'auto', energy: 'auto', beatSync: null, sfx: true },
    notes: '', advanced: { picks: {}, tighten: null }, touched: [],
  };
}

// fill what a plan leaves out from blank(), keeping what it has (an older or partial plan still works)
// A value of the wrong shape (null where a section goes, a word where a list goes) keeps the default; shapeErrs() names it.
export function normalize(p) {
  const merge = (base, x) => {
    if (x === undefined) return clone(base);
    if (isObj(base)) { if (!isObj(x)) return clone(base); const o = clone(base); for (const k of Object.keys(x)) o[k] = Object.hasOwn(base, k) ? merge(base[k], x[k]) : clone(x[k]); return o; }
    if (Array.isArray(base) && !Array.isArray(x)) return clone(base);
    return clone(x);
  };
  return merge(blank(), isObj(p) ? p : {});
}
function shapeErrs(p, base = blank(), path = '') {
  const errs = [];
  for (const k of Object.keys(base)) {
    const x = p[k], b = base[k], at = path + k; if (x === undefined) continue;
    if (isObj(b) && !isObj(x)) errs.push(`${at} must be a group of choices, not ${JSON.stringify(x)}.`);
    else if (Array.isArray(b) && !Array.isArray(x)) errs.push(`${at} must be a list.`);
    else if (isObj(b) && Object.keys(b).length) errs.push(...shapeErrs(x, b, at + '.'));
  }
  return errs;
}

// the plan a pace starts from; the fields you already chose (plan.touched) stay as they are
export function applyPace(plan, pace) {
  const p = normalize(plan), P = Object.hasOwn(PACES, pace) ? PACES[pace] : null; if (!P) return p;
  const mine = k => p.touched.includes(k);
  p.pace = pace; p.advanced.tighten = null;
  if (!mine('music.energy')) p.music.energy = P.energy;
  if (!mine('music.beatSync')) p.music.beatSync = P.beatSync;
  if (!mine('transitions.when')) p.transitions.when = P.transitionsWhen;
  if (!mine('presenter')) { p.presenter = p.presenter.filter(x => x.id !== 'punch'); if (P.punch) p.presenter.unshift({ id: 'punch', when: 'whole' }); }
  return p;
}
export function defaults(pace = 'look') { return applyPace(blank(), pace); }
// A pace picked on its own (the builder's Pacing step). plan: the plan read from the session as it is now. A field
// whose value is not what the plan's current pace gives was set somewhere else (a classic step, the chat, an agent),
// so it counts as yours and the new pace leaves it alone. Returns the new plan and the small patch for core.mjs
// applyPatch that sets only what a pace changes (no clearing of picks, so nothing else moves).
// last: the pace saved last time (s.videoPlan.pace), or none: then the session never had a pace picked and starts from
// Let the Look decide. The plan's own pace is only a guess from the pause length, so it is not used here.
export function pacePatch(plan, pace, last = null) {
  let p = normalize(plan); const lp = last || 'look', was = Object.hasOwn(PACES, lp) ? PACES[lp] : PACES.look;
  if (p.music.energy !== was.energy) p = touch(p, 'music.energy');
  if (p.music.beatSync !== was.beatSync) p = touch(p, 'music.beatSync');
  if (p.presenter.some(x => x.id === 'punch') !== was.punch) p = touch(p, 'presenter');
  if (p.transitions.when !== was.transitionsWhen) p = touch(p, 'transitions.when');
  const next = touch(applyPace(p, pace), 'pace'), P = Object.hasOwn(PACES, next.pace) ? PACES[next.pace] : PACES.look, bs = next.music.beatSync;
  const patch = { transitionsWhen: Array.isArray(next.transitions.ids) && !next.transitions.ids.length ? 'every-cut' : next.transitions.when, music: { energy: next.music.energy }, pace: { tighten: next.advanced.tighten ?? P.tighten, punch: next.presenter.some(x => x.id === 'punch') ? 'on' : 'off' },
    // with no music there is no beat to cut on, so a pace never asks for beat sync then
    picks: next.music.bed === 'none' && bs !== false ? {} : bs === null ? { 'beatSync:beat-sync': 'clear', 'beatSync:no-beat-sync': 'clear' } : { [`beatSync:${bs ? 'beat-sync' : 'no-beat-sync'}`]: 'allow' } };
  return { plan: next, patch };
}
// The smallest session patch that turns prev into next: picks the two plans set differently, and only the session
// fields that change. No clearPicks, so picks neither plan speaks for (a scene, a b-roll rule) stay as they are.
// prev should be read from the session (api.mjs planOf), so its picks are the session's own.
export function diffPatch(prev, next, cat = null) {
  const a = toState(prev, cat), b = toState(next, cat), picks = {};
  for (const ref of Object.keys(a.picks)) if (!(ref in b.picks)) picks[ref] = 'clear';
  for (const [ref, how] of Object.entries(b.picks)) if (a.picks[ref] !== how) picks[ref] = how;
  const patch = Object.keys(picks).length ? { picks } : {};
  for (const k of ['pack', 'styleLook', 'titles', 'keyWords', 'transitionsWhen', 'finishWhen', 'music', 'sound', 'pace']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) patch[k] = b[k];
  return patch;
}
// a builder step's words choices laid over the plan (only the fields given change)
export function withWords(plan, words) {
  const p = normalize(plan), deep = (base, x) => { if (!isObj(x)) return x; const o = isObj(base) ? clone(base) : {}; for (const k of Object.keys(x)) o[k] = isObj(x[k]) && isObj(o[k]) ? deep(o[k], x[k]) : clone(x[k]); return o; };
  p.words = deep(p.words, words);
  // a choice made here wins over an All options pick of the same kind (a deny of it, or a second font in a list)
  const kinds = new Set(); const has = k => Object.hasOwn(words || {}, k);
  if (has('look') || has('type')) kinds.add('captionStyle'); if (has('entrance')) kinds.add('captionEntrance'); if (has('fonts')) kinds.add('font');
  if (isObj(words && words.titles)) { const t = words.titles; if (has.call(null, 'titles') && Object.hasOwn(t, 'entrances')) kinds.add('entrance'); if (Object.hasOwn(t, 'effect')) kinds.add('titleEffect'); if (Object.hasOwn(t, 'exit')) kinds.add('titleExit'); }
  if (isObj(words && words.colors) && Object.hasOwn(words.colors, 'theme')) kinds.add('theme');
  if (kinds.size) for (const r of Object.keys(p.advanced.picks)) if (kinds.has(r.split(':')[0])) delete p.advanced.picks[r];
  return touch(p, 'words');
}
// a builder step's Between shots, You on screen or Extras choice laid over the plan: transitions and graphics change
// only the fields given, presenter is the whole list. A choice here wins over All options picks it speaks for.
export const PARTS = ['transitions', 'presenter', 'graphics', 'filters', 'music', 'notes'];
export function withPart(plan, part, value) {
  const p = normalize(plan), before = clone(p);
  if (part === 'presenter') p.presenter = clone(value);
  else if (part === 'notes') p.notes = typeof value === 'string' ? value : '';
  else p[part] = { ...p[part], ...clone(value) };
  // only the All options picks for what this choice changed
  let speaks = () => false;
  if (part === 'transitions' && value && 'ids' in value) speaks = (k) => k === 'transition';
  if (part === 'graphics') {
    const ids = new Set(Object.entries(GRAPHIC_GROUPS).filter(([g]) => before.graphics[g] !== p.graphics[g] || (value && 'agent' in value)).flatMap(([, v]) => v));
    const cards = before.graphics.cards !== p.graphics.cards;
    speaks = (k, id) => (k === 'graphic' && ids.has(id)) || (cards && k === 'editing' && id === 'cards-auto');
  }
  if (part === 'presenter') {
    const key = x => `${x.id}@${x.when}`, a = new Set(before.presenter.map(key)), b = new Set(p.presenter.map(key));
    const moved = new Set([...before.presenter.filter(x => !b.has(key(x))), ...p.presenter.filter(x => !a.has(key(x)))].map(x => x.id));
    speaks = (k, id) => (k === 'titleLayer' && moved.has('behind-head')) || (k === 'effect' && moved.has('effect:' + id));
  }
  if (part === 'filters' && value && 'ids' in value) speaks = k => k === 'finish';
  if (part === 'music' && value) speaks = k => ('beatSync' in value && k === 'beatSync') || ('bed' in value && k === 'music');
  for (const r of Object.keys(p.advanced.picks)) { const i = r.indexOf(':'); if (speaks(r.slice(0, i), r.slice(i + 1))) delete p.advanced.picks[r]; }
  const extra = part === 'transitions' && value && 'when' in value ? ['transitions.when'] : part === 'filters' && value && 'when' in value ? ['filters.when']
    : part === 'music' && value ? ['energy', 'beatSync'].filter(k => k in value).map(k => 'music.' + k) : [];
  return touch(p, ...extra, part);
}
// mark a field as yours, so a later pace change leaves it alone
export function touch(plan, ...keys) { const p = normalize(plan); for (const k of keys) if (!p.touched.includes(k)) p.touched.push(k); return p; }

// ---------- checking a plan ----------
// cat: the Studio catalog (core.mjs catalog()); without it only the shape is checked. Errors are plain English.
export function validate(plan, cat = null) {
  const errs = [];
  if (!isObj(plan)) return { ok: false, errs: ['The plan must be an object.'] };
  errs.push(...shapeErrs(plan));
  const p = normalize(plan), has = (kind, id) => !cat || !!(cat.items && cat.items[`${kind}:${id}`]);
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  const named = (kind, id, what) => need(has(kind, id), `${what}: we do not have one called ${id}.`);
  need(p.format === FORMAT, `format must be ${FORMAT}.`);
  need(Object.hasOwn(PACES, p.pace), `Pacing: pick ${Object.keys(PACES).join(', ')}.`);
  if (p.template !== null) {
    need(isObj(p.template) && ['pack', 'look'].includes(p.template.kind) && typeof p.template.name === 'string' && p.template.name, 'Template: give its kind (pack or look) and its name.');
    if (cat && p.template && p.template.kind === 'pack') need((cat.packs || []).some(x => x.name === p.template.name), `Template: no starter template called ${p.template.name}.`);
  }
  const w = p.words;
  need([null, 'captions', 'kinetic'].includes(w.type), 'Caption type: just captions or kinetic.');
  if (w.look !== null) { named('captionStyle', w.look, 'Caption look');
    if (w.type === 'captions') need(CAPTION_LOOKS.includes(w.look), `Caption look: ${w.look} is a kinetic style. Pick kinetic words, or one of ${CAPTION_LOOKS.join(', ')}.`);
    if (w.type === 'kinetic') need(KINETIC_LOOKS.includes(w.look), `Caption look: ${w.look} is not kinetic. Pick one of ${KINETIC_LOOKS.join(', ')}.`); }
  if (w.entrance !== null) { named('captionEntrance', w.entrance, 'How words come in'); need(w.type !== 'captions', 'How words come in only moves kinetic words. Pick kinetic words, or leave it to us.'); }
  need([null, true, false].includes(w.titles.on), 'Big titles: on, off, or leave it to us.');
  need(Array.isArray(w.titles.entrances), 'Big titles: entrances must be a list.');
  for (const id of w.titles.entrances || []) named('entrance', id, 'Big titles');
  if (w.titles.effect) named('titleEffect', w.titles.effect, 'Title effect');
  if (w.titles.exit) named('titleExit', w.titles.exit, 'Title exit');
  need(w.place.captions === null || PLACES.captions.includes(w.place.captions), `Where captions sit: ${PLACES.captions.join(' or ')}.`);
  need(Array.isArray(w.place.titles) && w.place.titles.every(x => PLACES.titles.includes(x)), `Where titles sit: any of ${PLACES.titles.join(', ')}. Never on the face.`);
  if (w.colors.theme) named('theme', w.colors.theme, 'Text colors');
  for (const k of ['text', 'accent', 'outline']) need(w.colors[k] === null || /^#[0-9a-f]{6}$/i.test(w.colors[k]), `Text colors: ${k} must look like #5cf9e2.`);
  if (w.fonts) named('font', w.fonts, 'Font pairing');
  need(KEY_LEVELS.includes(w.keyWords.level), `Key words: ${KEY_LEVELS.join(', ')}.`);
  if (w.keyWords.level !== 'off') need(w.type !== 'captions', 'Key words grow only with kinetic words.');
  need([1, 2].includes(w.keyWords.maxPerLine), 'Key words: at most 1 or 2 per line.');
  const t = p.transitions;
  need(t.ids === null || Array.isArray(t.ids), 'Transitions: a list, an empty list for none, or leave it to us.');
  for (const id of t.ids || []) named('transition', id, 'Transitions');
  need(TRANSITION_WHEN.includes(t.when), `Transitions how often: ${TRANSITION_WHEN.join(', ')}.`);
  need(Array.isArray(p.presenter), 'Presenter effects must be a list.');
  for (const x of p.presenter || []) {
    if (!isObj(x)) { errs.push('Presenter effects: each one is { id, when }.'); continue; }
    if (String(x.id).startsWith('effect:')) named('effect', String(x.id).slice(7), 'Presenter effects'); else need(PRESENTER.includes(x.id), `Presenter effects: we do not have one called ${x.id}.`);
    need(WHEN.includes(x.when), `Presenter effects: when is one of ${WHEN.join(', ')}.`);
    if (x.id === 'punch') need(x.when === 'whole', 'Zoom punch works on the whole video for now.');
    if (x.id === 'behind-head') need(['whole', 'hook', 'key-moments'].includes(x.when), 'Words behind your head: the whole video, the hook or key moments.');
  }
  for (const k of ['agent', 'nameTag', 'numbers', 'stickers', 'cta']) need(typeof p.graphics[k] === 'boolean', `Graphics: ${k} is on or off.`);
  need([null, true, false].includes(p.graphics.cards), 'Graphics: cards on, off, or leave it to us.');
  need(p.filters.ids === null || Array.isArray(p.filters.ids), 'Filters: a list, an empty list for none, or leave it to us.');
  for (const id of p.filters.ids || []) named('finish', id, 'Filters');
  need(FILTER_WHEN.includes(p.filters.when), `When filters show: ${FILTER_WHEN.join(', ')}.`);
  const c = p.content;
  need(typeof c.repoFeature === 'boolean', 'Repo feature: on or off.');
  need(Array.isArray(c.repos) && c.repos.length <= 3 && c.repos.every(u => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(u)), 'Repos: up to 3 links like https://github.com/owner/repo.');
  if (c.repoFeature) need(c.repos.length > 0, 'Repo feature: add at least one repo link.');
  need(['split'].includes(c.layout) && ['auto', 'off'].includes(c.takeovers), 'Repo feature: layout split, takeovers auto or off.');
  const m = p.music;
  if (cat && !['auto', 'none', 'upload'].includes(m.bed)) need((cat.beds || []).some(b => b.id === m.bed), `Music: we do not have a track called ${m.bed}.`);
  need(['auto', 'low', 'mid', 'high'].includes(m.energy), 'Music energy: auto, low, mid or high.');
  need([null, true, false].includes(m.beatSync) && typeof m.sfx === 'boolean', 'Music: beat sync on, off or ours; sound effects on or off.');
  need(typeof p.notes === 'string' && p.notes.length <= 2000, 'Notes: plain text, up to 2000 characters.');
  need(isObj(p.advanced.picks) && Object.values(p.advanced.picks).every(v => ['allow', 'deny'].includes(v)), 'All options: each pick is allow or deny.');
  const tg = p.advanced.tighten; need(tg === null || tg === 'off' || (typeof tg === 'number' && tg >= 0.1 && tg <= 2), 'Pauses: off, or 0.1 to 2 seconds.');
  if (cat) for (const r of Object.keys(p.advanced.picks || {})) need(!!cat.items[r], `All options: we do not have ${r}.`);
  return { ok: !errs.length, errs };
}

// ---------- plan -> session ----------
// The patch for core.mjs applyPatch: clear the picks, then set exactly what the plan says. Just captions chosen in
// the builder (words touched) turns big titles off; a classic session's caption style alone keeps its titles as before. Filters are picks
// (finish:<id>); state.finish is what Render makes and is never touched here.
export function toState(plan, cat = null) {
  const p = normalize(plan), w = p.words, picks = {}, pick = (kind, id, how = 'allow') => { picks[`${kind}:${id}`] = how; };
  const P = Object.hasOwn(PACES, p.pace) ? PACES[p.pace] : PACES.look;
  const patch = { clearPicks: true, picks, pack: p.template && p.template.kind === 'pack' ? p.template.name : null,
    styleLook: p.template && p.template.kind === 'look' ? p.template.name : null, titles: w.titles.on === false || (w.type === 'captions' && p.touched.includes('words')) ? 'off' : 'auto',
    music: { bed: p.music.bed, energy: p.music.energy }, sound: { sfx: p.music.sfx ? 'on' : 'off' },
    pace: { tighten: p.advanced.tighten ?? P.tighten, punch: p.presenter.some(x => x.id === 'punch') ? 'on' : 'off' }, keyWords: w.keyWords.level,
    transitionsWhen: Array.isArray(p.transitions.ids) && !p.transitions.ids.length ? 'every-cut' : p.transitions.when,
    // filters chosen in the builder (or given a timing) show where you said, on their own pieces; filters only
    // allowed on a classic step, or none chosen, leave it to the look as before
    finishWhen: Array.isArray(p.filters.ids) && p.filters.ids.length && (p.touched.includes('filters') || p.filters.when !== 'whole') ? p.filters.when : 'none' };
  const look = w.look || (w.type === 'captions' ? 'classic' : w.type === 'kinetic' ? 'kinetic' : null);
  if (look) pick('captionStyle', look);
  if (w.entrance && w.type !== 'captions') pick('captionEntrance', w.entrance);
  if (w.titles.on !== false) { for (const id of w.titles.entrances) pick('entrance', id); if (w.titles.effect) pick('titleEffect', w.titles.effect); if (w.titles.exit) pick('titleExit', w.titles.exit); }
  if (w.colors.theme) pick('theme', w.colors.theme);
  if (w.fonts) pick('font', w.fonts);
  if (Array.isArray(p.transitions.ids)) { if (!p.transitions.ids.length) pick('transition', 'cut'); else for (const id of p.transitions.ids) pick('transition', id); }
  for (const x of p.presenter) {
    if (x.id === 'behind-head') pick('titleLayer', x.when === 'whole' ? 'behind' : 'auto');
    else if (String(x.id).startsWith('effect:')) pick('effect', x.id.slice(7));
  }
  if (!p.graphics.agent) for (const [k, ids] of Object.entries(GRAPHIC_GROUPS)) if (!p.graphics[k]) for (const id of ids) pick('graphic', id, 'deny');
  if (p.graphics.cards !== null) pick('editing', 'cards-auto', p.graphics.cards ? 'allow' : 'deny');
  // no filters: every finish forbidden (the catalog has the list)
  if (Array.isArray(p.filters.ids)) { if (p.filters.ids.length) for (const id of p.filters.ids) pick('finish', id); else for (const id of finishIds(cat)) pick('finish', id, 'deny'); }
  if (p.music.beatSync === false || (p.music.beatSync === true && p.music.bed !== 'none')) pick('beatSync', p.music.beatSync ? 'beat-sync' : 'no-beat-sync');
  Object.assign(picks, p.advanced.picks);
  return patch;
}
const finishIds = cat => (cat ? Object.values(cat.items).filter(it => it.kind === 'finish').map(it => it.id) : []);

// what the plan asks for that the engine cannot draw yet (later phases wire each one); plain English
export function pending(plan) {
  const p = normalize(plan), w = p.words, out = [];
  const add = (field, text) => out.push({ field, text });
  if (w.place.captions || w.place.titles.length) add('words.place', 'Where words sit');
  if (w.colors.text || w.colors.accent || w.colors.outline) add('words.colors', 'Your own text colors');
  if (w.keyWords.level !== 'off' && (w.keyWords.color !== 'accent' || w.keyWords.maxPerLine !== 1)) add('words.keyWords', 'Key word color and how many per line');
  for (const x of p.presenter) {
    if (x.id === 'frame-breakout') add('presenter.frame-breakout', 'Frame breakout');
  }
  if (p.content.repoFeature) add('content', 'Repo or tool feature');
  return out.filter((x, i, a) => a.findIndex(y => y.field === x.field) === i);
}

// ---------- session -> plan ----------
// Best effort reverse, so a session changed on a classic step, in the chat or by an agent shows up in the plan.
// Picks the plan has no field for go to advanced.picks, so toState(fromState(s)) gives the same picks back.
// prev: the plan before, whose plan-only fields (notes, timings, content, place, key words) are kept.
export function fromState(s, prev = null, cat = null) {
  const base = normalize(prev || {}), p = clone(base), picks = s.picks || {}, used = new Set();
  const allow = k => ((picks[k] && picks[k].allow) || []).filter(id => !((picks[k].deny || []).includes(id)));
  const deny = k => (picks[k] && picks[k].deny) || [];
  const take = (k, id) => used.add(`${k}:${id}`);
  p.template = s.pack ? { kind: 'pack', name: s.pack } : s.styleLook ? { kind: 'look', name: s.styleLook } : null;
  const t = s.pace && s.pace.tighten;
  p.pace = t === null || t === undefined ? 'look' : t === 'off' ? 'calm' : t <= 0.3 ? 'high' : ['steady', 'lively'].includes(base.pace) ? base.pace : 'steady';
  // a pause length set by hand on the Cut step that no pace uses is kept as it is
  p.advanced.tighten = t === null || t === undefined || t === PACES[p.pace].tighten ? null : t;
  const w = p.words, look = allow('captionStyle')[0] || null;
  if (look) { take('captionStyle', look); w.look = look; w.type = KINETIC_LOOKS.includes(look) ? 'kinetic' : 'captions'; } else { w.look = null; w.type = null; }
  // just captions: no word entrance and no key words (those move kinetic words only), and the titles off that
  // toState derives from the type is not taken as your own choice, so going back to kinetic brings titles back
  const caps = w.type === 'captions';
  const ce = caps ? null : allow('captionEntrance')[0] || null; w.entrance = ce; if (ce) take('captionEntrance', ce);
  w.keyWords.level = caps ? 'off' : s.keyWords || 'off';
  w.titles.on = s.titles === 'off' && !(caps && base.words.titles.on !== false) ? false : s.titles === 'off' ? base.words.titles.on : base.words.titles.on === false ? null : base.words.titles.on;
  w.titles.entrances = allow('entrance'); for (const id of w.titles.entrances) take('entrance', id);
  w.titles.effect = allow('titleEffect')[0] || null; if (w.titles.effect) take('titleEffect', w.titles.effect);
  w.titles.exit = allow('titleExit')[0] || null; if (w.titles.exit) take('titleExit', w.titles.exit);
  w.colors.theme = allow('theme')[0] || null; if (w.colors.theme) take('theme', w.colors.theme);
  w.fonts = allow('font')[0] || null; if (w.fonts) take('font', w.fonts);
  const tr = allow('transition');
  if (tr.length) { p.transitions.ids = tr.length === 1 && tr[0] === 'cut' ? [] : tr; for (const id of tr) take('transition', id); } else p.transitions.ids = null;
  // straight cuts send no timing, so the timing you chose before stays in the plan
  p.transitions.when = Array.isArray(p.transitions.ids) && !p.transitions.ids.length ? base.transitions.when : s.transitionsWhen || 'every-cut';
  const wasWhen = id => (base.presenter.find(x => x.id === id) || {}).when;
  const pres = [];
  if (!(s.pace && s.pace.punch === 'off')) pres.push({ id: 'punch', when: 'whole' });
  const tl = allow('titleLayer')[0];
  if (tl === 'behind') { pres.push({ id: 'behind-head', when: 'whole' }); take('titleLayer', tl); }
  else if (tl === 'auto') { const was = wasWhen('behind-head'); pres.push({ id: 'behind-head', when: was && was !== 'whole' ? was : 'key-moments' }); take('titleLayer', tl); }
  if (base.presenter.some(x => x.id === 'frame-breakout')) pres.push(base.presenter.find(x => x.id === 'frame-breakout'));
  const presenterFx = new Set(base.presenter.filter(x => String(x.id).startsWith('effect:')).map(x => x.id.slice(7)));
  for (const id of allow('effect')) if (presenterFx.has(id) || PRESENTER_EFFECTS.has(id)) { pres.push({ id: 'effect:' + id, when: wasWhen('effect:' + id) || 'whole' }); take('effect', id); }
  p.presenter = pres;
  const gd = new Set(deny('graphic'));
  const groupOff = Object.fromEntries(Object.entries(GRAPHIC_GROUPS).map(([k, ids]) => [k, ids.every(id => gd.has(id))]));
  const anyOff = Object.values(groupOff).some(Boolean);
  for (const [k, ids] of Object.entries(GRAPHIC_GROUPS)) { p.graphics[k] = !groupOff[k]; if (groupOff[k]) for (const id of ids) take('graphic', id); }
  const ed = picks.editing || { allow: [], deny: [] };
  p.graphics.cards = ed.allow.includes('cards-auto') ? true : ed.deny.includes('cards-auto') ? false : null;
  if (p.graphics.cards !== null) take('editing', 'cards-auto');
  // the agent chooses unless a group is off; with no group off, what the plan said before stands
  p.graphics.agent = anyOff ? false : base.graphics.agent;
  if (!anyOff && base.graphics.agent) Object.keys(GRAPHIC_GROUPS).forEach(k => { p.graphics[k] = base.graphics[k]; });
  const fa = allow('finish'), fd = deny('finish');
  if (fa.length) { p.filters.ids = fa; for (const id of fa) take('finish', id); }
  else if (fd.length && cat && finishIds(cat).every(id => fd.includes(id))) { p.filters.ids = []; for (const id of fd) take('finish', id); }
  else p.filters.ids = null;
  p.filters.when = s.finishWhen && s.finishWhen !== 'none' ? s.finishWhen : base.filters.when;
  p.music.bed = (s.music && s.music.bed) || 'auto'; p.music.energy = (s.music && s.music.energy) || 'auto';
  const bs = allow('beatSync')[0]; p.music.beatSync = bs === 'beat-sync' ? true : bs === 'no-beat-sync' ? false : null; if (bs) take('beatSync', bs);
  p.music.sfx = !(s.sound && s.sound.sfx === 'off');
  const adv = {};
  for (const [k, slot] of Object.entries(picks)) {
    if (!slot || typeof slot !== 'object') continue;
    for (const id of slot.allow || []) if (!used.has(`${k}:${id}`) && !(slot.deny || []).includes(id)) adv[`${k}:${id}`] = 'allow';
    for (const id of slot.deny || []) if (!used.has(`${k}:${id}`)) adv[`${k}:${id}`] = 'deny';
  }
  p.advanced.picks = adv;
  return p;
}

// ---------- a template ----------
// a template.json ({ plan }), a starter pack name, or a saved look ({ name }) becomes a plan
export function fromTemplate(t) {
  if (!t) return defaults();
  if (t.plan) return normalize({ ...t.plan, template: t.template || t.plan.template || null });
  if (t.kind === 'pack' || t.kind === 'look') return normalize({ template: { kind: t.kind, name: t.name } });
  return defaults();
}

// ---------- the summary on Your notes ----------
const nameOf = id => String(id).replace(/-/g, ' ');
const list = xs => xs.length ? xs.join(', ') : 'none';
export function summary(plan, cat = null) {
  const p = normalize(plan), w = p.words, rows = [], row = (section, step, text) => rows.push({ section, step, text });
  if (p.template) row('Template', 'start', `${p.template.kind === 'pack' ? 'Starter template' : 'Your template'} ${p.template.name}`);
  row('Pace', 'pace', PACES[p.pace] ? PACES[p.pace].label : p.pace);
  const words = [w.type === 'kinetic' ? 'Kinetic words' : w.type === 'captions' ? 'Just captions' : 'Captions: we decide'];
  if (w.look && !(w.type === 'kinetic' && w.look === 'kinetic')) words.push(nameOf(w.look));
  if (w.entrance) words.push(`${nameOf(w.entrance)} in`);
  words.push(w.titles.on === false ? 'no big titles' : w.titles.entrances.length ? `titles ${w.titles.entrances.join(', ')}` : 'titles: we decide');
  if (w.colors.theme) words.push(`${w.colors.theme} colors`);
  if (w.fonts) words.push(`${w.fonts} fonts`);
  if (w.keyWords.level !== 'off') words.push(`${w.keyWords.level} key words`);
  row('Words on screen', 'captionType', words.join(', '));
  row('Between shots', 'transitions', p.transitions.ids === null ? 'We pick' : p.transitions.ids.length ? `${list(p.transitions.ids)}, ${p.transitions.when.replace(/-/g, ' ')}` : 'Straight cuts only');
  const PN = { punch: 'zoom punch', 'behind-head': 'words behind your head', 'frame-breakout': 'frame breakout' };
  row('You on screen', 'presenter', list(p.presenter.map(x => `${PN[x.id] || String(x.id).replace(/^effect:/, '').replace(/-/g, ' ')}${x.when !== 'whole' ? ` (${x.when.replace(/-/g, ' ')})` : ''}`)));
  row('Graphics', 'graphics', p.graphics.agent ? 'The agent chooses' : list(Object.keys(GRAPHIC_GROUPS).filter(k => p.graphics[k]).map(k => ({ nameTag: 'name tag', numbers: 'numbers and lists', stickers: 'stickers', cta: 'call to action' })[k])));
  row('Filters', 'filters', p.filters.ids === null ? 'We pick' : p.filters.ids.length ? `${list(p.filters.ids)}${p.filters.when !== 'whole' ? `, ${p.filters.when.replace(/-/g, ' and ')} only` : ''}` : 'None');
  if (p.content.repoFeature) row('Content', 'content', `Repo feature: ${list(p.content.repos.map(u => u.replace(/^https:\/\/github\.com\//, '')))}`);
  row('Music', 'music', [p.music.bed === 'auto' ? 'we pick the track' : p.music.bed === 'none' ? 'no music' : p.music.bed, p.music.sfx ? 'sound effects on' : 'no sound effects'].join(', '));
  if (p.notes.trim()) row('Your notes', 'notes', p.notes.trim());
  return rows;
}
