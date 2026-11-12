// VIDEO.md (a rea-video breakdown) -> Reel.md. Maps what a teardown measured onto the talking-head menu:
//   captions        -> caption style (one-word, pill, karaoke, hormozi, kinetic) and look
//   big on-screen text -> titles, with the nearest of the seven entrances and a front/behind hint
//   colour grade    -> nearest film finish per shot (grain, vignette, scan-lines, warm, cool, teal, crushed, mono, bleach)
//   cuts and beats  -> shot list, punch, beat sync;  music BPM -> the closest library bed
//   palette and text colours -> brand kit colours
//
//   node kit/videomd2reel.cjs <rea-video out dir | breakdown.json | fallback.json> [--extras extras.json] [--out Reel.md] [--report teardown.md]
//
// Reads breakdown.json (rea-video's full data, or kit/teardown.py's fallback with the same field names). Everything
// it writes is a guess you should check: see "How sure is this" in docs/teardown.md.
'use strict';
const fs = require('fs');
const path = require('path');
const RM = require('./reelmd.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);
const r2 = x => Math.round(x * 100) / 100;
const pad2 = n => String(n).padStart(2, '0');

// rea-video's entrance kinds -> our seven title entrances
const ENTRANCE_MAP = { cut: 'slam', pop: 'pop-zoom', reveal: 'stagger-rise', typewriter: 'stagger-rise', fade: 'blur-rise', slide: 'slide-left', slide_in: 'slide-left', zoom: 'pop-zoom', scale: 'pop-zoom', bounce: 'elastic', flip: 'flip', rotate: 'flip', blur: 'blur-rise' };

function loadBreakdown(p) {
  let dir = p, file = p;
  if (fs.statSync(p).isDirectory()) file = path.join(p, 'breakdown.json'); else dir = path.dirname(p);
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b._dir = dir;
  return b;
}

// Big on-screen words that are not running captions, at most seven (one per entrance), in time order.
function pickTitles(b, max = 7) {
  const ow = oneWordStream(b);
  const cues = ((b.packaging || {}).text_cues || []).filter(c => c && c.text && !(ow && ow.cues.has(c)));
  const ok = c => {
    if (!c.t1 || c.t1 <= c.t0) return false;
    const txt = String(c.text).trim();
    if (c.kind === 'subtitle' || c.part_of_picture) return false;
    if ((c.conf ?? 1) < 0.6 || txt.replace(/[^A-Za-z0-9]/g, '').length < 3 || /^[@#]|\.(com|html|io)\b/i.test(txt)) return false;
    const h = c.line_h ?? (c.bbox ? c.bbox[3] : 0);
    return h >= 0.04 && (c.t1 - c.t0) >= 0.3;
  };
  const cand = cues.filter(ok).map(c => ({ c, score: (c.line_h ?? c.bbox[3]) * Math.min(2, c.t1 - c.t0) * (c.conf ?? 1) * (c.bbox ? Math.min(1, c.bbox[2] * 2) : 1) }));
  cand.sort((a, b2) => b2.score - a.score);
  const picked = [];
  for (const x of cand) {
    if (picked.length >= max) break;
    if (picked.some(p => x.c.t0 < p.c.t1 + 0.4 && p.c.t0 < x.c.t1 + 0.4)) continue; // one title at a time
    picked.push(x);
  }
  picked.sort((a, b2) => a.c.t0 - b2.c.t0);
  const used = new Set();
  return picked.map((x, i) => {
    const kind = x.c.anim_in && x.c.anim_in.kind;
    let ent = kind ? ENTRANCE_MAP[kind] : undefined;
    if (ent && used.has(ent)) ent = undefined; // each entrance once per reel; the engine fills a free one
    if (ent) used.add(ent);
    return { n: i + 1, start: r2(x.c.t0), end: r2(Math.max(x.c.t1, x.c.t0 + 0.8)), text: clean(x.c.text), entrance: ent, seenAs: kind || 'unknown', bbox: x.c.bbox, fill: x.c.style && x.c.style.fill, band: x.c.band };
  });
}
const clean = t => String(t).replace(/\s+/g, ' ').replace(/[|]/g, '/').replace(/\u2014/g, ',').trim();

const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
// One big word at a time that matches the speech (the one-word caption look). rea-video files these as labels, so
// they are found by matching single big words on screen to the transcript's word times.
function oneWordStream(b) {
  const words = ((b.speech || {}).words || []).map(w => ({ t: w[0], w: norm(w[2]) })).filter(w => w.w.length >= 2);
  if (words.length < 8) return null;
  const cues = ((b.packaging || {}).text_cues || []).filter(c => c.text && String(c.text).trim().split(/\s+/).length === 1 && (c.line_h ?? (c.bbox ? c.bbox[3] : 0)) >= 0.04 && (c.t1 - c.t0) <= 1.6 && (c.conf ?? 1) >= 0.6);
  const hit = cues.filter(c => { const n = norm(c.text); return n.length >= 2 && words.some(w => Math.abs(w.t - c.t0) <= 0.8 && (w.w === n || (n.length >= 4 && (w.w.startsWith(n) || n.startsWith(w.w))))); });
  if (hit.length < 8) return null;
  const bands = {}; hit.forEach(c => { bands[c.band] = (bands[c.band] || 0) + 1; });
  const band = Object.entries(bands).sort((a, c) => c[1] - a[1])[0][0];
  return { cues: new Set(hit), band, n: hit.length, of: words.length };
}

// Running captions -> one of our caption styles.
function captionStyle(b) {
  const ow = oneWordStream(b);
  if (ow) return { style: 'one-word', why: `${ow.n} big single words on screen match the speech (${ow.of} words spoken), mostly in the ${ow.band} band`, band: ow.band };
  // tiny text (a screen recording, a UI) is not a caption
  const subs = ((b.packaging || {}).text_cues || []).filter(c => c.kind === 'subtitle' && (c.line_h ?? (c.bbox ? c.bbox[3] : 1)) >= 0.025);
  if (!subs.length) return { style: 'kinetic', why: 'no running captions found; kinetic is the house default' };
  const words = subs.map(c => String(c.text).trim().split(/\s+/).length);
  const avgW = words.reduce((a, x) => a + x, 0) / words.length;
  const avgChars = subs.reduce((a, c) => a + String(c.text).replace(/\s/g, '').length, 0) / subs.length;
  const share = f => subs.filter(f).length / subs.length;
  const boxed = share(c => c.style && c.style.box), multi = share(c => c.style && (c.style.multicolor || c.style.highlight_name));
  const caps = share(c => /[A-Z]/.test(c.text) && c.text === c.text.toUpperCase()), stroke = share(c => c.style && c.style.stroke_ratio > 0.015);
  const avgDur = subs.reduce((a, c) => a + (c.t1 - c.t0), 0) / subs.length;
  const facts = `${subs.length} caption cues, ${avgW.toFixed(1)} words and ${avgChars.toFixed(0)} letters each, ${avgDur.toFixed(2)} s on screen, boxed ${Math.round(boxed * 100)}%, highlighted ${Math.round(multi * 100)}%, upper case ${Math.round(caps * 100)}%`;
  if (avgW <= 1.3 && avgChars <= 9 && avgDur < 0.9) return { style: 'one-word', why: facts };
  if (boxed >= 0.5) return { style: 'pill', why: facts };
  if (multi >= 0.4) return { style: 'karaoke', why: facts };
  if (caps >= 0.6 && stroke >= 0.4) return { style: 'hormozi', why: facts };
  return { style: 'kinetic', why: facts };
}

// One shot's grade -> a finish (or none). Calibrated on the shipped finishes applied to showcase/source/presenter.jpg,
// then made stricter so a dark room or warm light on real footage does not read as a finish. Subtle finishes (grain,
// chroma, a light warm or cool) are often missed; strong ones (mono, scan-lines, heavy vignette, teal) are caught.
function finishOf(m) {
  if (!m || m.sat == null) return { finish: null, why: 'no grade data' };
  const f = [], why = [];
  if (m.sat < 0.03) { f.push('mono'); why.push(`saturation ${m.sat}`); }
  else {
    const spread = (m.highlight_b ?? 0) - (m.shadow_b ?? 0);
    if ((m.shadow_b ?? 0) < -2 && spread > 15) { f.push('teal'); why.push(`teal shadows, warm highlights (b ${m.shadow_b} / ${m.highlight_b})`); }
    else if (m.contrast > 0.3 && m.sat < 0.2) { f.push('bleach'); why.push(`contrast ${m.contrast}, saturation ${m.sat}`); }
    else if ((m.dark_share ?? 0) > 0.38 && m.contrast > 0.3) { f.push('crushed'); why.push(`dark share ${m.dark_share}`); }
    else if ((m.shadow_b ?? 0) < -2.5) { f.push('cool'); why.push(`cool shadows (b ${m.shadow_b})`); }
    else if ((m.shadow_b ?? 0) > 6 || (m.mean_b ?? 0) > 14) { f.push('warm'); why.push(`warm cast (b ${m.mean_b})`); }
  }
  if ((m.scan ?? m.x_scan ?? 0) > 1.5) { f.push('scan-lines'); why.push(`line pattern ${m.scan ?? m.x_scan}`); }
  else if ((m.noise ?? 0) > 2.5) { f.push('grain'); why.push(`noise ${m.noise}`); }
  if (m.vignette != null && m.vignette < 0.12) { f.push('vignette'); why.push(`corners at ${Math.round(m.vignette * 100)}% of the ring inside them`); }
  return { finish: f.length ? f.join(',') : null, why: why.join('; ') || 'natural' };
}

let _bpms = null;
function bedBpms() {
  if (_bpms) return _bpms;
  const cache = path.join(ROOT, 'teardown', '.bed-bpm.json');
  try { _bpms = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { _bpms = {}; }
  return _bpms;
}
// The library bed whose tempo is closest (half and double time count).
function suggestBed(bpm, opts = {}) {
  if (!bpm) return null;
  const R = require('./rules.cjs');
  const beds = Object.keys(R.BEDS || {});
  const known = { ...bedBpms(), ...(opts.bpms || {}) };
  let best = null;
  for (const name of beds) {
    const t = known[name];
    if (!t) continue;
    const d = Math.min(...[t, t * 2, t / 2].map(x => Math.abs(x - bpm)));
    if (!best || d < best.d) best = { name, bpm: t, d };
  }
  return best;
}

function hexOK(h) { return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h); }
function lum(h) { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
function satOf(h) { const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return mx ? (mx - mn) / mx : 0; }
function brandColours(b, titles) {
  const out = [];
  const add = h => { if (hexOK(h) && !out.some(x => dist(x, h) < 60)) out.push(h.toLowerCase()); };
  const dist = (a, c) => { const p = parseInt(a.slice(1), 16), q = parseInt(c.slice(1), 16); return Math.hypot((p >> 16) - (q >> 16), ((p >> 8) & 255) - ((q >> 8) & 255), (p & 255) - (q & 255)); };
  // accent first: saturated title and caption colours
  const texts = [...titles.map(t => t.fill), ...((b.packaging || {}).text_cues || []).filter(c => c.kind === 'subtitle').flatMap(c => [c.style && c.style.fill, c.style && c.style.box_color])];
  texts.filter(h => hexOK(h) && satOf(h) > 0.35).forEach(add);
  texts.filter(h => hexOK(h)).forEach(h => { if (out.length < 3) add(h); });
  (b.x_palette || []).map(p => p.hex).sort((a, c) => lum(a) - lum(c)).forEach(h => { if (out.length < 5) add(h); });
  return out.slice(0, 5);
}

function convert(b, extras = {}, opts = {}) {
  const src0 = b.source || {};
  const src = { ...src0, file: src0.file || src0.filename || (src0.path ? path.basename(src0.path) : undefined) };
  const dur = r2(src.duration || (b.summary && b.summary.duration) || (b.shots && b.shots.length ? b.shots[b.shots.length - 1].end : 0));
  const engine = b.x_engine || (b.tool ? `${b.tool.name || 'rea-video'} ${b.tool.version || ''}`.trim() : 'rea-video');
  const titles = pickTitles(b);
  (extras.titles || []).forEach((x, i) => { if (titles[i] && x && x.layer) { titles[i].layer = x.layer; titles[i].overlap = x.person_overlap; } });
  const cs = captionStyle(b);
  const look = cs.style === 'one-word' ? 'one-word' : cs.style === 'pill' ? 'muse' : 'kinetic';
  const shots = (b.shots || []).map((s, i) => {
    const m = { ...((s.aspects && s.aspects.grade && s.aspects.grade.measured) || {}), ...(extras.shots && extras.shots[i] ? extras.shots[i] : {}) };
    if (s.x_scan != null && m.scan == null) m.scan = s.x_scan;
    const fin = finishOf(m);
    const cam = (s.aspects && s.aspects.camera && (s.aspects.camera.result || s.aspects.camera.measured)) || {};
    const move = cam.move || cam.motion;
    return { n: i + 1, start: r2(s.start), end: r2(s.end), finish: fin.finish, finishWhy: fin.why, transitionIn: s.transition_in, move: typeof move === 'string' ? move : null, shake: (s.aspects && s.aspects.camera && s.aspects.camera.measured && s.aspects.camera.measured.shake) };
  });
  // the most common finish becomes the job default; shots that differ keep their own
  const counts = {};
  shots.forEach(s => { const k = s.finish || 'none'; counts[k] = (counts[k] || 0) + 1; });
  const top = Object.entries(counts).sort((a, c) => c[1] - a[1])[0];
  const jobFinish = top && top[0] !== 'none' && top[1] / shots.length >= 0.6 ? top[0] : null;
  const audio = b.audio || {}, music = audio.music || {};
  const bpm = music.tempo_bpm || audio.tempo_bpm || null;
  const hasMusic = !!(music.present || bpm);
  const bed = suggestBed(bpm, opts);
  const beatEdit = audio.beat_synced_edit === true || (audio.cuts_on_beat_ratio != null && audio.cuts_on_beat_chance != null && audio.cuts_on_beat_ratio > audio.cuts_on_beat_chance + 0.15);
  const zoomShots = shots.filter(s => s.move && /zoom|push|punch/i.test(s.move)).length;
  const jumpCuts = shots.filter(s => /jump/.test(s.transitionIn || '')).length;
  const avgShot = shots.length ? dur / shots.length : dur;
  const big = shots.length >= 3 ? [2, shots.length] : [];
  const colours = brandColours(b, titles);
  const speech = b.speech || {};
  const words = speech.words || [];
  const lines = speech.lines || [];
  const name = (opts.name || (src.file || 'reference').replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'reference';
  const layerDefault = titles.some(t => t.layer === 'behind') ? 'auto' : 'front';

  const card = {
    videomd: 1, name,
    description: `Recipe torn down from ${src.file || 'a reference reel'}: ${shots.length} shots in ${dur}s, ${titles.length} big titles, ${cs.style} captions${bpm ? `, music near ${Math.round(bpm)} BPM` : ''}. Measured by ${engine}; finishes, entrances and layers are best guesses.`,
    source: { file: src.file || 'reference.mp4', duration: dur }, shots: shots.length, lang: opts.lang || b.lang || 'en',
    generator: { name: 'aigent-talking-head teardown', version: require('../package.json').version }, 'x-reel': 1,
  };
  const L = ['---', RM.dumpYaml(card).trimEnd(), '---', '', `# Teardown: ${src.file || name}`, '',
    'Detected from the reference. Read the teardown report next to this file, change anything that looks wrong, then remake:',
    `\`npm run reel -- --recipe ${opts.recipePath || 'teardown/' + name + '/Reel.md'} --clip inbox/your-clip.mp4\``, '',
    '## Brand kit', '- preset: aigent', '- theme: aigent', `- colors: ${colours.join(', ') || 'none'}`, '- fonts: theme', '- logo: none', '',
    '## Music', `- bed: ${hasMusic && bed ? bed.name : 'none'}`, `- bpm: ${bpm ? Math.round(bpm) : ''}`, `- beat-sync: ${hasMusic ? 'on' : 'off'}`, '',
    '## Style', `- look: ${look}`, `- captions: ${cs.style}`, `- titles: ${titles.length ? 'on' : 'off'}`, `- title-layer: ${layerDefault}`,
    `- finish: ${jobFinish ? jobFinish.split(',').join(', ') : 'none'}`, `- transition: ${shots.some(s => /dissolve|fade|cross/.test(s.transitionIn || '')) ? 'crossfade' : 'glitch'}`,
    `- punch: ${zoomShots || jumpCuts || avgShot < 3 ? 'on' : 'off'}`, '- effects: none', '',
    '## Shots', '', '```videomd-timeline'];
  for (const s of shots) {
    const f = [`#${pad2(s.n)} ${s.start}-${s.end}`, `story ${s.n === 1 ? 'hook' : s.n === shots.length ? 'payoff' : 'beat'}`];
    if (s.finish && s.finish !== jobFinish) f.push(`finish ${s.finish}`);
    if (big.includes(s.n)) f.push('punch big');
    if (/dissolve|fade|cross/.test(s.transitionIn || '')) f.push('transition crossfade');
    if (s.move) f.push(`camera~ ${s.move}`);
    L.push(f.join(' | '));
  }
  L.push('```', '');
  if (titles.length) {
    L.push('## Titles', '', '```reel-titles');
    titles.forEach(t => {
      const f = [`#${pad2(t.n)} ${t.start}-${t.end}`];
      if (t.entrance) f.push(`entrance ${t.entrance}`);
      f.push(`layer ${t.layer || 'front'}`, `text ${t.text}`);
      L.push(f.join(' | '));
    });
    L.push('```', '');
  }
  if (lines.length) {
    L.push('## Script', '', 'What the reference says, for timing and structure. Your remake uses your own words.', '', '```reel-script');
    lines.slice(0, 60).forEach((l, i) => L.push(`#${pad2(i + 1)} ${r2(l.start)}-${r2(l.end)} | say ${clean(l.text)}`));
    L.push('```', '');
  }
  const md = L.join('\n');

  // report: what was detected and how
  const R = [`# Teardown report: ${src.file || name}`, '', `Engine: ${engine}. ${b.x_engine ? 'rea-video was not available, so this is the lightweight built-in analyzer.' : 'rea-video did the breakdown; this report maps it onto the talking-head menu.'}`, '',
    'Every line below is a measurement or a guess from one. Check the contact sheet, fix the Reel.md, then remake.', '',
    `![contact sheet](contact.jpg)`, '',
    '| What | Detected | How |', '|---|---|---|',
    `| Length, shots | ${dur}s, ${shots.length} shots (avg ${avgShot.toFixed(1)}s) | scene cuts${jumpCuts ? `, ${jumpCuts} jump cuts` : ''} |`,
    `| Captions | ${cs.style} (look ${look}) | ${cs.why} |`,
    `| Titles | ${titles.length} | big on-screen text that is not a running caption, one at a time, up to 7 |`,
    `| Title layer | ${titles.length ? titles.map(t => t.layer || '?').join(', ') : 'n/a'} | ${extras.mask ? 'text colour over the person vs over the background (MediaPipe mask)' : 'not estimated (no person mask available); front is the default'} |`,
    `| Finish | ${jobFinish || 'none'} as default; ${shots.filter(s => s.finish && s.finish !== jobFinish).length} shots differ | grade stats per shot, nearest shipped finish |`,
    `| Music | ${hasMusic ? `${bpm ? Math.round(bpm) + ' BPM' : 'present'}${bed ? `, closest bed ${bed.name} (${Math.round(bed.bpm)} BPM)` : ''}` : 'none found'} | ${beatEdit ? 'cuts land on the beat more than chance' : 'beat grid'} |`,
    `| Punch | ${zoomShots || jumpCuts || avgShot < 3 ? 'on' : 'off'} | ${zoomShots} zoom moves, ${jumpCuts} jump cuts, ${avgShot.toFixed(1)}s average shot |`,
    `| Brand colours | ${colours.join(' ') || 'none'} | saturated text colours first, then the frame palette |`,
    `| Script | ${lines.length ? lines.length + ' lines' : 'not transcribed'} | ${speech.engine || (speech.ok === false ? 'speech: ' + (speech.reason || 'off') : 'rea-video')} |`, ''];
  if (titles.length) {
    R.push('## Titles', '', '| # | Time | Text | Seen as | Entrance | Layer |', '|---|---|---|---|---|---|');
    titles.forEach(t => R.push(`| ${t.n} | ${t.start}-${t.end}s | ${t.text} | ${t.seenAs} | ${t.entrance || 'engine picks'} | ${t.layer || 'front'}${t.overlap != null ? ` (person under ${Math.round(t.overlap * 100)}% of it)` : ''} |`));
    R.push('');
  }
  R.push('## Shots', '', '| # | Time | Finish | Why |', '|---|---|---|---|');
  shots.forEach(s => R.push(`| ${s.n} | ${s.start}-${s.end}s | ${s.finish || 'none'} | ${s.finishWhy} |`));
  R.push('', '## How sure is this', '', '- Cuts, length, BPM and caption timing are measured and usually right.',
    '- Caption style, entrances and finishes are the nearest match from a short menu. A custom look maps to the closest shipped one.',
    '- Front or behind is a colour test against a person mask. It misses when the text colour matches the clothes or hair.',
    '- OCR misreads stylised or moving type. Check the title text before you remake; your remake should use your own words anyway.', '');
  return { md, report: R.join('\n'), titles, shots, captionStyle: cs.style, jobFinish, bpm, bed };
}

module.exports = { convert, pickTitles, captionStyle, oneWordStream, finishOf, suggestBed, loadBreakdown, ENTRANCE_MAP };

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
  console.log('wrote ' + out);
}
