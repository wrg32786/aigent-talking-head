// A style look: the style of a reference reel, saved as a named file you can put on any take (Copy the look).
// Recreate re-cuts the reference's own timeline onto your take. A style look carries no timeline, script or text from
// the reference: only how it looks and moves. kit/lookplan.cjs applies one; kit/reel.cjs --style-look <name> drives it.
//
//   npm run look -- save <teardown dir> --name <name>     make a look from a teardown (npm run teardown) and save it
//   npm run look -- list                                  the saved looks
//   npm run look -- show <name or path>                   one look, summarised
//   npm run reel -- --style-look <name or path> --clip inbox/take.mp4
//
// Saved looks live in looks/local/<name>/look.json (out of git, kept across jobs and projects; LOOKS_DIR moves it).
// The file (version 1):
//   framing      the shot scale mix (share of ECU, CU, MCU, MS, WS by time), per class the face height and eye line to
//                reframe to (kit/reframe.cjs), and how often the framing changes on a cut
//   grade        the colour target in Lab (kit/grade-match.cjs refits it on a new take), each shot's colour, the finish
//   captions     style, look, position, colour, outline, shadow, case, layer, entrance, words per cue, size, accent
//   titles       on or off, entrances in the order used, layer, how many a minute
//   stickers     the ordinal sticker (shape, spikes, colour, layer, size, place, seconds, how many per 10 s), the app
//                label style (tile colours, size, place) and the screen card frame (border, place, width, seconds)
//   transitions  the job default and the mix (share of cuts per transition; "cut" is a hard cut)
//   moves        share of shots with a push, pull or drift, and with a shake
//   pace         shot length mean, spread, shortest and longest, the hook length, words per second, cut on pauses
//   broll        share of the time on cutaways, and the layout (full, card or split)
//   music        present or not, the library bed nearest in tempo, tempo, energy, level, mood words when known
//   sfx          the sounds used (type and kit sound), how many per 10 s, and what they sit on (cuts, stickers, titles)
//   loudness     the voice level to master to
//   brand        theme, colours and fonts; style and musicKeys keep the Reel.md lines the draft reads
'use strict';
const fs = require('fs');
const isPhrase = t => t.lines != null || t.key != null || t.build != null || t.effect != null || t.exit != null;   // a phrase title line of a Reel.md
const path = require('path');
const RM = require('./reelmd.cjs');
const RF = require('./reframe.cjs');
const GM = require('./grade-match.cjs');
const SPL = require('./shotplan.cjs');

const VERSION = 1, KIND = 'style-look';
const ROOT = path.dirname(__dirname);
const dirOf = () => process.env.LOOKS_DIR || path.join(ROOT, 'looks', 'local');
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const r2 = x => +(+x).toFixed(2), r3 = x => +(+x).toFixed(3);
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const quant = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : null; };
const none = v => v == null || /^(none|-|null|)$/i.test(String(v).trim());
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// a class's usual framing when the teardown measured no face: the framing words only
const DEFAULT_FACE = { ECU: { faceH: 0.38, eyeY: 0.4 }, CU: { faceH: 0.26, eyeY: 0.37 }, MCU: { faceH: 0.17, eyeY: 0.33 }, MS: { faceH: 0.1, eyeY: 0.3 }, WS: { faceH: 0.06, eyeY: 0.32 } };
const wordClass = f => { const s = String(f || '').toLowerCase(); return /extreme close/.test(s) ? 'ECU' : /medium close/.test(s) ? 'MCU' : /close/.test(s) ? 'CU' : /medium/.test(s) ? 'MS' : /wide|long|full/.test(s) ? 'WS' : null; };

function framingOf(shots) {
  const rows = shots.map(s => ({ dur: s.dur, face: s.face || null, cls: s.face ? RF.classOf(s.face.faceH) : wordClass(s.framing) })).filter(r => r.cls && r.dur > 0);
  const total = rows.reduce((a, r) => a + r.dur, 0) || 1, classes = {};
  for (const [c] of RF.CLASSES) {
    const rs = rows.filter(r => r.cls === c); if (!rs.length) continue;
    const fs_ = rs.filter(r => r.face).map(r => r.face), d = DEFAULT_FACE[c];
    const hs = fs_.map(f => f.faceH);
    classes[c] = { share: r2(rs.reduce((a, r) => a + r.dur, 0) / total), faceH: r3(hs.length ? median(hs) : d.faceH), eyeY: r3(fs_.length ? median(fs_.map(f => f.eyeY)) : d.eyeY), cx: r3(fs_.length ? median(fs_.map(f => f.cx)) : 0.5),
      lo: r3(hs.length ? quant(hs, 0.2) : d.faceH * 0.94), hi: r3(hs.length ? quant(hs, 0.8) : d.faceH * 1.1), measured: fs_.length };
  }
  // how often the framing changes on a cut: the face height moves by 6% or more, or the class does
  let cuts = 0, changes = 0;
  for (let i = 1; i < rows.length; i++) { cuts++; const a = rows[i - 1], b = rows[i]; if (a.cls !== b.cls || (a.face && b.face && Math.abs(a.face.faceH - b.face.faceH) / a.face.faceH >= 0.06)) changes++; }
  return { mix: Object.fromEntries(Object.entries(classes).map(([c, v]) => [c, v.share])), classes, changeRate: cuts ? r2(changes / cuts) : 0, measured: rows.some(r => r.face) };
}

function paceOf(shots, dur, words) {
  const d = shots.map(s => s.dur).filter(x => x > 0), mean = d.length ? d.reduce((a, x) => a + x, 0) / d.length : dur;
  const sd = d.length ? Math.sqrt(d.reduce((a, x) => a + (x - mean) ** 2, 0) / d.length) : 0;
  const spoken = (words || []).filter(w => w[1] > w[0]), span = spoken.length ? spoken[spoken.length - 1][1] - spoken[0][0] : 0;
  return { shots: d.length, shotMean: r2(mean), shotSpread: r2(sd), shotMedian: r2(median(d) || mean), shotMin: r2(Math.min(...d, mean)), shotMax: r2(Math.max(...d, mean)), cutsPerMin: dur ? r2((Math.max(0, d.length - 1)) / dur * 60) : 0,
    hook: r2(d[0] || mean), quantiles: d.length >= 4 ? [0, 0.25, 0.5, 0.75, 1].map(q => r2(quant(d, q))) : null, cutOnPauses: true, wordsPerSecond: span > 1 ? r2(spoken.length / span) : null };
}

function shares(list) { const n = list.length || 1, o = {}; for (const k of list) o[k] = (o[k] || 0) + 1; return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v / n)])); }

function stickersOf(graphics, dur) {
  const v = (g, k) => (g[k] !== undefined ? g[k] : g[k + '~']);
  const of = t => graphics.filter(g => v(g, 'type') === t), num = (gs, k) => { const a = gs.map(g => +v(g, k)).filter(Number.isFinite); return a.length ? r2(median(a)) : null; };
  const secs = gs => { const a = gs.map(g => g.end - g.start).filter(x => x > 0); return a.length ? r2(median(a)) : null; };
  const out = {}, ord = of('ordinal-sticker'), app = of('app-label'), card = of('screen-card');
  if (ord.length) { const g = ord[0], shape = ord.filter(x => v(x, 'shape') === 'starburst').length * 2 >= ord.length ? 'starburst' : 'seal';
    out.ordinal = { shape, ...(shape === 'starburst' ? { spikes: Math.round(num(ord, 'spikes') || 12) } : {}), color: v(g, 'color') || null, layer: shares(ord.map(x => v(x, 'layer') || 'front')) && Object.keys(shares(ord.map(x => v(x, 'layer') || 'front')))[0],
      size: num(ord, 'size'), x: num(ord, 'x'), y: num(ord, 'y'), ...(num(ord, 'head') != null ? { head: num(ord, 'head'), headY: num(ord, 'head-y') } : {}), seconds: secs(ord), count: ord.length, per10: dur ? r2(ord.length / dur * 10) : 0 }; }
  if (app.length) out.appLabel = { tiles: [...new Set(app.map(g => v(g, 'tile')).filter(Boolean))].slice(0, 6), size: num(app, 'size'), x: num(app, 'x'), y: num(app, 'y'), seconds: secs(app), count: app.length };
  if (card.length) out.screenCard = { border: v(card[0], 'border') || null, y: num(card, 'y'), w: num(card, 'w'), seconds: secs(card), count: card.length, share: dur ? r2(card.reduce((a, g) => a + g.end - g.start, 0) / dur) : 0 };
  return out;
}

// what each of the reference's sounds sits on: a sticker or label coming in, a title, a cut, or nothing we can name
function sfxOf(recipe, dur) {
  const sfx = recipe.sfx || [], starts = (arr, pad) => t => arr.some(x => Math.abs(x - t) <= pad);
  const v = (g, k) => (g[k] !== undefined ? g[k] : g[k + '~']);
  const onSticker = starts((recipe.graphics || []).filter(g => /ordinal-sticker|app-label|sticker-pop/.test(v(g, 'type') || '')).map(g => g.start), 0.6);
  const onTitle = starts((recipe.titles || []).map(t => t.start), 0.4), onCut = starts((recipe.shots || []).slice(1).map(s => s.start), 0.35);
  const on = { stickers: 0, titles: 0, cuts: 0, captions: 0, other: 0 }, types = {}, sounds = {};
  for (const x of sfx) {
    const type = String(x.type || 'pop'), hint = String(x['on~'] || x.on || '');
    types[type] = (types[type] || 0) + 1; sounds[type] = x.sound || SPL.sfxId(type);
    if (onSticker(x.start) || /sticker|label/.test(hint)) on.stickers++; else if (onTitle(x.start) || /title/.test(hint)) on.titles++; else if (onCut(x.start) || /cut|transition/.test(hint)) on.cuts++; else if (/subtitle|caption/.test(hint)) on.captions++; else on.other++;
  }
  return { count: sfx.length, per10: dur ? r2(sfx.length / dur * 10) : 0, types, sounds, on };
}

// A look from a teardown folder (Reel.md, and extras.json, speech.json and videomd/breakdown.json when they are there).
function fromTeardown(dir, opts = {}) {
  const d = path.resolve(dir), file = fs.existsSync(d) && fs.statSync(d).isFile() ? d : path.join(d, 'Reel.md'), td = path.dirname(file);
  if (!fs.existsSync(file)) throw new Error('No Reel.md in ' + d + ' (run npm run teardown first)');
  const recipe = RM.load(file), shots = RM.shotSettings(recipe), st = recipe.style || {}, mu = recipe.music || {}, br = recipe.brand || {};
  const dur = +(recipe.card.source && recipe.card.source.duration) || shots.reduce((a, s) => a + s.dur, 0);
  const b = readJson(path.join(td, 'videomd', 'breakdown.json')) || readJson(path.join(td, 'fallback.json')) || {};
  const speech = (b.speech && b.speech.ok && b.speech) || readJson(path.join(td, 'speech.json')) || {};
  const words = speech.words || [];
  const subs = (((b.packaging || {}).text_cues) || []).filter(c => c && c.kind === 'subtitle' && c.line_h >= 0.025);
  const captionStyle = none(st.captions) ? 'kinetic' : st.captions;
  const wordsPerCue = captionStyle === 'one-word' ? 1 : subs.length ? r2(subs.reduce((a, c) => a + String(c.text).trim().split(/\s+/).length, 0) / subs.length) : null;
  const colors = RM.toPreset(recipe).colors || [];
  const labs = shots.map(s => (!s.cutaway && s.lab) || null); // a cutaway's colour is not the speaker's grade
  const levels = (b.stems && b.stems.level_db) || {};
  const bpm = mu.bpm != null && mu.bpm !== '' ? +mu.bpm : null, hasMusic = !none(mu.bed);
  const cut = shots.filter(s => s.cutaway), cards = (recipe.graphics || []).filter(g => (g.type || g['type~']) === 'screen-card');
  const name = slug(opts.name || recipe.card.name || path.basename(td)) || 'look';
  const tl = (recipe.titles || []);
  // the font the teardown matched (Reel.md Style font, font-face, font-match; Brand kit fonts): captions and titles share it
  const font = st['font-match'] && !none(br.fonts) && br.fonts !== 'theme' ? { pairing: br.fonts, kind: st.font || null, face: st['font-face'] || null, match: st['font-match'] } : null;
  return {
    version: VERSION, kind: KIND, name,
    from: { reference: (recipe.card.source && recipe.card.source.file) || null, teardown: recipe.card.name || path.basename(td), duration: dur },
    created: opts.created || new Date().toISOString(),
    framing: framingOf(shots),
    grade: { target: GM.pool(labs, shots.map(s => s.dur)), shots: labs.filter(Boolean), finish: none(st.finish) ? null : st.finish, skin: GM.SKIN },
    captions: { style: captionStyle, look: none(st.look) ? null : st.look, font, size: subs.length ? r3(median(subs.map(c => c.line_h))) : null, position: st['caption-position'] || null, color: st['caption-color'] || null,
      outline: st['caption-outline'] || null, shadow: st['caption-shadow'] || null, case: st['caption-case'] || null, layer: st['caption-layer'] || null, entrance: st['caption-entrance'] || null, wordsPerCue, ...(/^(off|no|false)$/i.test(String(st['running-captions'] || '')) ? { running: false } : {}), accent: require('./recreate.cjs').accentFor({ colors }) },
    titles: { on: !/^(off|no|false)$/i.test(String(st.titles || 'on')), font, size: null, entrances: [...new Set(tl.map(t => t.entrance).filter(Boolean))], layer: st['title-layer'] || 'front', colors, count: tl.length, perMin: dur ? r2(tl.length / dur * 60) : 0, seconds: tl.length ? r2(median(tl.map(t => t.end - t.start))) : null,
      // designed phrase titles (1.29.0): the pattern only (when, how many lines, where the key word sits, build, effect, exit), never the reference's words
      ...(tl.some(isPhrase) ? { phrases: tl.filter(isPhrase).map(t => require('./phrase-titles.cjs').shapeOf(t)) } : {}) },
    stickers: stickersOf(recipe.graphics || [], dur),
    transitions: { default: none(st.transition) ? 'cut' : st.transition, glitch: /^(on|yes|true)$/i.test(String(st.glitch || '')), mix: shares(shots.slice(1).map(s => (s.transition && !none(s.transition) ? s.transition : 'cut'))) },
    moves: { push: r2(shots.filter(s => s.move === 'push').length / (shots.length || 1)), pull: r2(shots.filter(s => s.move === 'pull').length / (shots.length || 1)), drift: r2(shots.filter(s => s.move === 'drift').length / (shots.length || 1)),
      // the middle measured size of the reference's pushes and pulls (the zoom gained), when the teardown read one
      size: Object.fromEntries(['push', 'pull'].map(k => [k, median(shots.filter(s => s.move === k && s.moveSize > 0).map(s => s.moveSize))]).filter(([, v]) => v > 0)),
      shake: r2(shots.filter(s => s.shake).length / (shots.length || 1)), bigPunch: r2(shots.filter(s => s.bigPunch).length / (shots.length || 1)), punch: !/^(off|no|false)$/i.test(String(st.punch || 'on')) },
    pace: paceOf(shots, dur, words),
    // slots: how often the reference shows B-roll, the kinds and how each is treated (kit/broll-slots.cjs lookSummary)
    broll: { cutawayShare: dur ? r2(cut.reduce((a, s) => a + s.dur, 0) / dur) : 0, cutaways: cut.length, layout: cards.length ? 'card' : 'full', ...require('./broll-slots.cjs').lookSummary(require('./broll-slots.cjs').fromRecipe(recipe), dur) },
    music: { present: hasMusic, bed: hasMusic && mu.bed !== 'auto' ? mu.bed : null, bpm, energy: !none(mu.energy) ? mu.energy : bpm ? (bpm < 95 ? 'low' : bpm < 125 ? 'mid' : 'high') : null, level: mu['bed-volume'] != null && mu['bed-volume'] !== '' ? +mu['bed-volume'] : null,
      mood: [].concat((b.audio && b.audio.music && (b.audio.music.mood || b.audio.music.genre)) || []).map(String).slice(0, 4), beatSync: /^(on|yes|true)$/i.test(String(mu['beat-sync'] || '')) },
    sfx: sfxOf(recipe, dur),
    loudness: { voiceLufs: -16, ...(Number.isFinite(+levels.vocals) ? { measured: { voiceDb: +levels.vocals, ...(Number.isFinite(+levels.music) ? { musicDb: +levels.music } : {}) } } : {}) },
    brand: { theme: none(br.theme) ? null : br.theme, colors, fonts: none(br.fonts) ? null : br.fonts },
    style: { ...st }, musicKeys: { ...mu },
  };
}

function validate(look) {
  const errs = [];
  if (!look || typeof look !== 'object') return ['not a style look'];
  if (look.kind !== KIND) errs.push('kind must be "style-look"');
  if (look.version !== VERSION) errs.push(`version must be ${VERSION}`);
  if (!NAME_RE.test(String(look.name || ''))) errs.push('name must be lowercase letters, digits and hyphens');
  for (const k of ['framing', 'grade', 'captions', 'titles', 'stickers', 'transitions', 'moves', 'pace', 'broll', 'music', 'sfx', 'loudness']) if (!look[k] || typeof look[k] !== 'object') errs.push(`missing "${k}"`);
  return errs;
}

function fileOf(name) { return path.join(dirOf(), name, 'look.json'); }
// save a look under a name (replaces one of the same name). Returns { name, file }.
function save(look, name) {
  const n = slug(name || look.name);
  if (!NAME_RE.test(n)) throw new Error('A look name needs letters or digits (lowercase, hyphens)');
  const out = { ...look, name: n }, errs = validate(out);
  if (errs.length) throw new Error('Not a style look: ' + errs.join('; '));
  fs.mkdirSync(path.dirname(fileOf(n)), { recursive: true });
  fs.writeFileSync(fileOf(n), JSON.stringify(out, null, 1) + '\n');
  return { name: n, file: fileOf(n) };
}
// a saved look by name, or a look.json by path. null when there is none.
function load(nameOrPath) {
  const s = String(nameOrPath || '');
  if (!s) return null;
  const cands = [/[\\/]|\.json$/.test(s) ? path.resolve(s) : null, /[\\/]/.test(s) ? path.join(path.resolve(s), 'look.json') : null, NAME_RE.test(s) ? fileOf(s) : null].filter(Boolean);
  for (const f of cands) { if (!fs.existsSync(f) || !fs.statSync(f).isFile()) continue; const l = readJson(f); if (l && !validate(l).length) return { ...l, file: f }; }
  return null;
}
const exists = name => NAME_RE.test(String(name || '')) && fs.existsSync(fileOf(name));
function remove(name) { if (!exists(name)) return false; fs.rmSync(path.dirname(fileOf(name)), { recursive: true, force: true }); return true; }

// a few words per part, for a list or a chip
function summary(look) {
  const pct = x => Math.round(x * 100) + '%', f = look.framing || {}, mix = Object.entries(f.mix || {}).sort((a, b) => b[1] - a[1]);
  const top = mix[0] && f.classes[mix[0][0]], st = (look.stickers || {}).ordinal, sx = look.sfx || {}, tr = Object.entries((look.transitions || {}).mix || {}).filter(([k]) => k !== 'cut');
  return {
    framing: mix.length ? `${mix.map(([c, s]) => `${RF.CLASS_WORDS[c]} ${pct(s)}`).join(', ')}${top ? `; face ${pct(top.faceH)} of the frame, eyes ${pct(top.eyeY)} down` : ''}` : 'not measured',
    grade: look.grade && look.grade.target ? `matched to the reference's colour (Lab ${look.grade.target.mean.map(x => Math.round(x)).join(', ')})${look.grade.finish ? ', finish ' + look.grade.finish : ''}` : look.grade && look.grade.finish ? 'finish ' + look.grade.finish : 'your own colour',
    captions: [look.captions.style, look.captions.position, look.captions.color, look.captions.case && look.captions.case + ' case'].filter(Boolean).join(', '),
    titles: look.titles.on ? `${look.titles.perMin} a minute, ${look.titles.layer}${(look.titles.entrances || []).length ? ', ' + look.titles.entrances.join(' / ') : ''}` : 'off',
    stickers: st ? `${st.shape === 'starburst' ? `starburst, ${st.spikes} points` : 'round seal'}${st.color ? ', ' + st.color : ''}, ${st.layer === 'behind' ? 'behind the head' : 'in front'}` : 'none',
    transitions: tr.length ? tr.map(([k, s]) => `${k} ${pct(s)}`).join(', ') + ', the rest hard cuts' : 'hard cuts',
    pace: `a cut every ${look.pace.shotMean} s (${look.pace.shotMin} to ${look.pace.shotMax} s)${look.pace.wordsPerSecond ? `, ${look.pace.wordsPerSecond} words a second` : ''}`,
    music: look.music.present ? `${look.music.energy || 'a'} bed${look.music.bpm ? ` near ${Math.round(look.music.bpm)} BPM` : ''}` : 'no music',
    sfx: sx.count ? `${Object.keys(sx.types).join(', ')}; ${sx.per10} per 10 s, mostly on ${Object.entries(sx.on).sort((a, b) => b[1] - a[1])[0][0]}` : 'none',
  };
}
function list() {
  let names = []; try { names = fs.readdirSync(dirOf()).filter(n => NAME_RE.test(n) && fs.existsSync(fileOf(n))).sort(); } catch {}
  return names.map(n => { const l = load(n); return l ? { name: l.name, from: (l.from && (l.from.reference || l.from.teardown)) || null, created: l.created || null, summary: summary(l) } : null; }).filter(Boolean);
}

// The look as a recipe with no timeline: the Reel.md lines the draft reads for brand, music and style (captions, title
// layer, finish, punch), and no shots, titles, graphics, sounds or script. kit/reel.cjs runs it like any recipe.
function toRecipe(look) {
  const style = { ...(look.style || {}) }, music = { ...(look.musicKeys || {}) };
  delete style.effects;
  if (!look.music.present) { music.bed = 'none'; music['beat-sync'] = 'off'; }
  else if (none(music.bed)) { music.bed = 'auto'; if (look.music.energy) music.energy = look.music.energy; }
  return { file: look.file || path.join(dirOf(), look.name, 'look.json'), title: `Style look ${look.name}`,
    card: { videomd: 1, name: look.name, description: `Style look ${look.name}: a reference's style with no timeline`, source: { file: 'style-look', duration: 0 }, shots: 0, lang: 'en', 'x-reel': 1 },
    brand: { preset: 'auto', theme: (look.brand && look.brand.theme) || 'neutral', colors: ((look.brand && look.brand.colors) || []).join(', ') || 'none', fonts: (look.brand && look.brand.fonts) || 'theme', logo: 'none' },
    music, style, aliases: {}, shots: [], titles: [], script: [], graphics: [], cards: [], sfx: [], notes: '' };
}

module.exports = { fromTeardown, save, load, list, remove, exists, summary, validate, toRecipe, fileOf, dirOf, slug, VERSION, KIND, NAME_RE, DEFAULT_FACE, wordClass };

if (require.main === module) {
  const argv = process.argv.slice(2), cmd = argv[0];
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const pos = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i && arr[i - 1].startsWith('--')));
  const show = l => { const s = summary(l); console.log(`${l.name}${l.from && l.from.reference ? ` (from ${l.from.reference})` : ''}`); for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(12)} ${v}`); };
  try {
    if (cmd === 'save') {
      if (!pos[0]) throw new Error('usage: npm run look -- save <teardown dir> --name <name>');
      const look = fromTeardown(pos[0], { name: opt('name') }), r = save(look, opt('name') || look.name);
      console.log(`look saved: ${r.name} -> ${path.relative(process.cwd(), r.file)}`); show({ ...look, name: r.name });
      console.log(`\nUse it on any take: npm run reel -- --style-look ${r.name} --clip inbox/<your-clip>.mp4`);
    } else if (cmd === 'list' || !cmd) {
      const ls = list();
      if (argv.includes('--json')) console.log(JSON.stringify({ looks: ls }));
      else if (!ls.length) console.log('No saved looks yet. Make one from a teardown: npm run look -- save teardown/<name> --name <name>');
      else for (const l of ls) console.log(`${l.name.padEnd(24)} ${l.from || ''}\n  ${Object.entries(l.summary).map(([k, v]) => `${k}: ${v}`).join('\n  ')}`);
    } else if (cmd === 'show') {
      const l = load(pos[0]); if (!l) throw new Error('No look "' + pos[0] + '" (npm run look -- list)');
      if (argv.includes('--json')) console.log(JSON.stringify(l, null, 1)); else show(l);
    } else if (cmd === 'remove') { console.log(remove(pos[0]) ? 'removed ' + pos[0] : 'no look ' + pos[0]); }
    else throw new Error('usage: npm run look -- save <teardown dir> --name <name> | list | show <name> | remove <name>');
  } catch (e) { console.error(e.message); process.exit(1); }
}
