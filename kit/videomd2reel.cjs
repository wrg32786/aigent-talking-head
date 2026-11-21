// VIDEO.md (a rea-video breakdown) -> Reel.md. Maps what a teardown measured onto the talking-head menu:
//   captions        -> caption style (one-word, pill, karaoke, hormozi, kinetic), look, caption position and colour
//   big on-screen text -> titles, with the nearest of the eight entrances and a front/behind hint (a word the speaker
//                      is saying, styled like the captions, is a caption word and is left out)
//   graphics        -> ordinal stickers, app labels, screen cards (kit/teardown.py extras finds them)
//   colour grade    -> nearest film finish per shot, only when the grade changes across shots or is strong
//   cuts and beats  -> shot list, punch, beat sync;  music BPM -> the closest library bed
//   palette and text colours -> brand kit colours
//
//   node kit/videomd2reel.cjs <rea-video out dir | breakdown.json | fallback.json> [--extras extras.json] [--out Reel.md] [--report teardown.md]
//
// Reads breakdown.json (rea-video's full data, or kit/teardown.py's fallback with the same field names). Everything
// it writes is a guess you should check: see "How sure is this" in docs/teardown.md.
// The parts live in kit/teardown/ (captions, titles, graphics, grade, music, palette, scenes-out, recipe, report);
// convert() here puts them together.
'use strict';
const fs = require('fs');
const path = require('path');
const SC = require('./scenes.cjs');
const SPL = require('./shotplan.cjs');
const { r2, norm, sameWord } = require('./teardown/util.cjs');
const { oneWordStream, captionStyle, placeOf, captionLook } = require('./teardown/captions.cjs');
const { ENTRANCE_MAP, pickTitles, textDoubt } = require('./teardown/titles.cjs');
const { mapGraphics, stickerImage } = require('./teardown/graphics.cjs');
const { finishOf, gradeChoice } = require('./teardown/grade.cjs');
const { suggestBed, musicOf } = require('./teardown/music.cjs');
const { brandColours, themeFor, jobTransition } = require('./teardown/palette.cjs');
const { saveScenes, placeScenes } = require('./teardown/scenes-out.cjs');
const { recipeMd } = require('./teardown/recipe.cjs');
const { report } = require('./teardown/report.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);

function loadBreakdown(p) {
  let dir = p, file = p;
  if (fs.statSync(p).isDirectory()) file = path.join(p, 'breakdown.json'); else dir = path.dirname(p);
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b._dir = dir;
  return b;
}

// extras.json "font" -> { pairing, category, weight, case, color, face, match } or null. The pairing must be one in
// kit/fonts/pairings.json (never a path or a name from the file), the match one of matched, close, guess.
function fontOf(f) {
  if (!f || typeof f !== 'object') return null;
  const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'fonts', 'pairings.json'), 'utf8')).pairings || {};
  if (!f.pairing || !P[f.pairing]) return null;
  const pick = (v, list) => (list.includes(v) ? v : null);
  return { pairing: f.pairing, category: pick(f.category, ['sans', 'serif', 'condensed', 'blackletter', 'script', 'display']) || P[f.pairing].category || 'sans', weight: pick(f.weight, ['regular', 'bold', 'black']), case: pick(f.case, ['lower', 'upper', 'as-said']),
    color: /^#[0-9a-f]{6}$/i.test(String(f.color || '')) ? f.color.toLowerCase() : null, face: String((P[f.pairing].display || {}).family || ''), match: pick(f.match, ['matched', 'close', 'guess']) || 'guess', score: Number.isFinite(+f.score) ? +f.score : null, samples: +f.samples || 0 };
}

// extras.json "title_look" (kit/titlelook.py) -> the look of the reference's titles for the recipe, or null.
// { lockup: 'two-line' | 'one-line', key: { category, italic, case, color }, partner: { category, case, color, place } | null,
//   pairing (one we ship whose key face and partner face are the same kinds, else null), glow: null | 'soft' | 'strong',
//   dim: 0 or 0.1 to 0.6, n: { titles, twoLine } }
const SANS_PARTNERS = new Set(['Hanken Grotesk', 'Inter Tight', 'Nunito Sans', 'Plus Jakarta Sans', 'Manrope', 'Red Hat Mono']);
function titleLookFrom(tl) {
  const lk = tl && tl.look;
  if (!lk || !lk.key) return null;
  const pick = (v, list) => (list.includes(v) ? v : null), hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : null);
  const CATS = ['sans', 'serif', 'condensed', 'blackletter'], CASES = ['upper', 'lower', 'as-said'];
  const key = { category: pick(lk.key.category, CATS), italic: lk.key.italic === true, case: pick(lk.key.case, CASES), color: hex(lk.key.color) };
  const two = lk.lockup === 'two-line' && lk.partner;
  const partner = two ? { category: pick(lk.partner.category, CATS), case: pick(lk.partner.case, CASES), color: hex(lk.partner.color), place: pick(lk.partner.place, ['above', 'below']) } : null;
  let pairing = null;
  if (key.category) {
    const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'fonts', 'pairings.json'), 'utf8')).pairings || {};
    let best = 0;
    for (const [name, p] of Object.entries(P)) {
      if (!p || !p.display || p.script || (p.lockup || {}).arrange !== 'stack') continue; // a plain stacked pairing: a script tail or an inline rule is a look of its own
      if ((p.category || 'sans') !== key.category) continue;
      if (p.display.upper && key.case !== 'upper') continue; // a caps-only face is only right for a key word in capitals
      let sc = 3 + ((p.display.style === 'italic') === key.italic ? 2 : 0);
      if (partner && partner.category && p.secondary) sc += (SANS_PARTNERS.has(p.secondary.family) ? 'sans' : 'serif') === partner.category ? 2 : -1;
      if (sc > best) { best = sc; pairing = name; }
    }
    if (best < 5) pairing = null; // the kind alone is not a match: the font read from the words on screen stands
  }
  const g = +lk.glow || 0, d = +lk.dim || 0;
  return { lockup: two ? 'two-line' : 'one-line', key, partner, pairing, glow: g >= 0.3 ? 'strong' : g >= 0.12 ? 'soft' : null, dim: d >= 0.12 ? Math.min(0.6, +d.toFixed(2)) : 0, n: { titles: +lk.titles || 0, twoLine: +lk.two_line || 0 } };
}

function convert(b, extras = {}, opts = {}) {
  const src0 = b.source || {};
  const src = { ...src0, file: src0.file || src0.filename || (src0.path ? path.basename(src0.path) : undefined) };
  const dur = r2(src.duration || (b.summary && b.summary.duration) || (b.shots && b.shots.length ? b.shots[b.shots.length - 1].end : 0));
  const engine = b.x_engine || (b.tool ? `${b.tool.name || 'rea-video'} ${b.tool.version || ''}`.trim() : 'rea-video');
  const picked = pickTitles(b);
  (extras.titles || []).forEach((x, i) => { if (picked[i] && x && x.layer) { picked[i].layer = x.layer; picked[i].overlap = x.person_overlap; } });
  ((extras.title_look || {}).rows || []).forEach((x, i) => { if (picked[i] && x) picked[i].look = { lines: x.lines, italic: !!(x.key && x.key.italic), kind: (x.key && x.key.category) || null, glow: x.glow ?? null, dim: x.dim ?? null }; });
  const graphics = mapGraphics(b, extras);
  // a title that is a graphic's own word (FIRST on a sticker, the label under an icon) belongs to that graphic
  const inBox = (bb, box) => bb && box && bb[0] + bb[2] / 2 >= box[0] && bb[0] + bb[2] / 2 <= box[0] + box[2] && bb[1] + bb[3] / 2 >= box[1] && bb[1] + bb[3] / 2 <= box[1] + box[3];
  const owned = t => graphics.find(g => t.start < g.end + 0.3 && g.start < t.end + 0.3 && (inBox(t.bbox, g.bbox) || [g.cue, g.text].filter(Boolean).some(x => { const a = norm(x), c = norm(t.text); return a && c && (sameWord(a, c) || (c.length >= 4 && a.includes(c))); })));
  const titles = picked.filter(t => !owned(t)).slice(0, 7);
  titles.forEach((t, i) => { t.n = i + 1; });
  const dropped = [...(picked.dropped || []), ...picked.filter(t => owned(t)).map(t => ({ t: t.start, text: t.text, why: `part of the ${owned(t).type} at ${owned(t).start}s` }))];
  const cs = captionStyle(b);
  const owc = oneWordStream(b);
  const cl2 = captionLook((extras.caption_look || {}).samples, owc ? owc.cues : null, (extras.caption_look || {}).layer_samples);
  if (cl2) Object.assign(cs, { outline: cl2.outline, shadow: cl2.shadow, lookN: cl2.n, layer: cl2.layer, layerN: cl2.layerN, layerBehind: cl2.layerBehind });
  const look = cs.style === 'one-word' ? 'one-word' : cs.style === 'pill' ? 'muse' : 'kinetic';
  // the font read from the words on screen (extras.json "font", kit/fontmatch.py): only a pairing we ship is ever named
  const font = fontOf(extras.font);
  // the look of the titles (extras.json "title_look", kit/titlelook.py), and text the teardown is not sure it read right
  const tlook = titleLookFrom(extras.title_look);
  { const sw = (b.speech || {}).words || []; for (const t of titles) { const why = textDoubt(t, sw); if (why) { t.lowConfidence = true; t.why = why; } } }
  // an entrance the teardown could not read: the blur entrance for an italic serif key word (report 4, item 9); the rest
  // are left to the engine. Read entrances stay as they are.
  if (tlook) tlook.entrance = tlook.key.italic && tlook.key.category === 'serif' && titles.some(t => !t.entrance) ? 'blur-rise' : null;
  const shots = (b.shots || []).map((s, i) => {
    const m = { ...((s.aspects && s.aspects.grade && s.aspects.grade.measured) || {}), ...(extras.shots && extras.shots[i] ? extras.shots[i] : {}) };
    if (s.x_scan != null && m.scan == null) m.scan = s.x_scan;
    const fin = finishOf(m, (+s.end || 0) - (+s.start || 0));
    const cam = (s.aspects && s.aspects.camera && (s.aspects.camera.result || s.aspects.camera.measured)) || {};
    const move = cam.move || cam.motion;
    return { n: i + 1, m, start: r2(s.start), end: r2(s.end), finish: fin.finish, finishWhy: fin.why, ...(fin.unread ? { unread: true } : {}), transitionIn: s.transition_in, tx: SPL.transitionFor(s.transition_in, s.transition), moves: SPL.moveFor(cam), vlmText: SC.textOf(s && s.vlm), framing: ((s.aspects && s.aspects.framing && (s.aspects.framing.result || s.aspects.framing.measured)) || {}).shot_size || null, cutaway: SPL.isCutaway(s), broll: SPL.isCutaway(s) ? SPL.brollOf(s, SC.textOf) : null, face: m.face && m.face.h ? { faceH: m.face.h, eyeY: m.face.eye_y, cx: m.face.cx } : null, lab: m.lab && Array.isArray(m.lab.mean) ? m.lab : null, boxes: ((s.overlay && s.overlay.boxes) || []).filter(x => Array.isArray(x.bbox) && x.bbox[2] * x.bbox[3] >= 0.04), move: typeof move === 'string' ? move : null, shake: (s.aspects && s.aspects.camera && s.aspects.camera.measured && s.aspects.camera.measured.shake) };
  });
  const read = shots.filter(s => !s.unread);
  const ambient = gradeChoice(read);
  // the most common finish becomes the job default (over the shots a grade could be read from); shots that differ keep their own
  const counts = {};
  read.forEach(s => { const k = s.finish || 'none'; counts[k] = (counts[k] || 0) + 1; });
  const top = Object.entries(counts).sort((a, c) => c[1] - a[1])[0];
  const jobFinish = top && top[0] !== 'none' && top[1] / read.length >= 0.6 ? top[0] : null;
  const { bpm, level, hasMusic, bed, beatEdit } = musicOf(b, opts);
  const zoomShots = shots.filter(s => s.move && /zoom|push|punch/i.test(s.move)).length;
  const jumpCuts = shots.filter(s => /jump/.test(s.transitionIn || '')).length;
  const avgShot = shots.length ? dur / shots.length : dur;
  const big = shots.length >= 3 ? [2, shots.length] : [];
  const colours = brandColours(b, titles, graphics);
  const speech = b.speech || {};
  const words = speech.words || [];
  const lines = speech.lines || [];
  const name = (opts.name || (src.file || 'reference').replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'reference';
  const layerDefault = titles.some(t => t.layer === 'behind') ? 'auto' : 'front';

  // the reference's sound effects (rea-video audio_plan.sfx_merged), the loud enough ones
  const sfx = (((b.audio_plan || {}).sfx_merged) || []).filter(x => x && Number.isFinite(+x.t) && x.type && !(x.level_db < -60)).slice(0, 24)
    .map(x => ({ t: r2(x.t), dur: +x.dur || 0.2, type: String(x.type).toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z-]/g, ''), on: x.on && x.on.type ? String(x.on.type).replace(/[^a-z_]/g, '') : null }));
  const { extraG, scenes } = placeScenes({ b, opts, src, shots, graphics, titles });
  const ctx = { tlook, b, extras, opts, src, name, dur, engine, shots, titles, dropped, graphics, extraG, scenes, sfx, lines, speech, cs, look, font, colours, bpm, level, hasMusic, bed, beatEdit, jobFinish, ambient, layerDefault, zoomShots, jumpCuts, avgShot, big };
  return { md: recipeMd(ctx), report: report(ctx), scenes, titles, shots, font, titleLook: tlook, captionStyle: cs.style, captionPosition: cs.position, captionColor: cs.color, graphics, dropped, jobFinish, bpm, bed };
}

module.exports = { convert, fontOf, titleLookFrom, textDoubt, saveScenes, stickerImage, pickTitles, mapGraphics, captionLook, gradeChoice, placeOf, captionStyle, oneWordStream, finishOf, suggestBed, loadBreakdown, ENTRANCE_MAP,
  placeScenes, musicOf, brandColours, themeFor, jobTransition, recipeMd, report };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const inp = argv.find((a, i) => !a.startsWith('--') && !(i && argv[i - 1].startsWith('--')));
  if (!inp) { console.error('usage: node kit/videomd2reel.cjs <rea-video out dir | breakdown.json> [--extras extras.json] [--out Reel.md] [--report teardown.md]'); process.exit(1); }
  const b = loadBreakdown(inp);
  const ex = opt('extras') && fs.existsSync(opt('extras')) ? JSON.parse(fs.readFileSync(opt('extras'), 'utf8')) : {};
  const out = opt('out', path.join(b._dir, 'Reel.md'));
  const res = convert(b, ex, { name: opt('name'), recipePath: path.relative(ROOT, out) });
  fs.writeFileSync(out, res.md);
  fs.writeFileSync(opt('report', path.join(path.dirname(out), 'teardown.md')), res.report);
  const added = saveScenes(res, path.dirname(out), { library: !argv.includes('--no-scenes') });
  console.log('wrote ' + out + (res.scenes.length ? `; ${res.scenes.length} scene${res.scenes.length === 1 ? '' : 's'} made from it (${res.scenes.map(x => x.name).join(', ')})${added.length ? ', ' + added.length + ' new in the menu' : ''}` : ''));
}
