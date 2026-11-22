// Shared edit rules: the locked sound set, the eight title entrances, named transitions, the punch defaults and
// the humanizer copy lint. Used by assemble.cjs, reel.cjs, autocaption.mjs, check.mjs and verify.mjs, so every
// script reads the same numbers. Adapted from the Muse reel workflow (Will Gwyn and Muse, Nov 2026) to this
// repo's 1080x1920, 24 fps format.
const fs = require('fs');
const path = require('path');
const KIT = __dirname;

// Locked sound set: five mono 48 kHz WAVs in kit/sfx/. "peak" is where the sound's measured peak sits, so the peak
// lands on the time you give. "vol" is the default gain. Rule: fewer and deeper, never a sound on every cut, the
// key moment gets the loudest sound (give it [time, gain] with a higher gain, or use boom).
// F and D are the original two picks (same files as MP3), kept so older cut.json files sound the same.
const SFX = {
  whoosh: { file: 'sfx/whoosh.wav', peak: 0.69, vol: 0.45, use: 'entrances and the big cuts (the original cinematic woosh pick, Freesound 648729, CC0)' },
  swipe: { file: 'sfx/swipe.wav', peak: 0.24, vol: 0.4, use: 'cards or titles sliding in or out (quick woosh, Freesound 683101, CC0)' },
  boom: { file: 'sfx/boom.wav', peak: 0.03, vol: 0.5, use: 'the one big moment: payoff or end card (motion-pack snd.hit.deep_impact, CC0)' },
  click: { file: 'sfx/click.wav', peak: 0.0, vol: 0.4, use: 'on-screen UI clicks (motion-pack snd.ui.click, CC0)' },
  typing: { file: 'sfx/typing.wav', peak: 0.0, vol: 0.3, use: 'text typing on screen (motion-pack snd.ui.typing_burst, CC0)' },
  F: { file: 'sfx/F-cinematic-woosh-648729.mp3', peak: 0.69, vol: 0.6, use: 'legacy name for whoosh at the old level' },
  D: { file: 'sfx/D-quick-woosh-683101.mp3', peak: 0.24, vol: 0.5, use: 'legacy name for swipe at the old level' },
};
const CUT_SOUNDS = ['whoosh', 'swipe', 'boom', 'F', 'D'];
// an sfx entry is a time or [time, gain]
const sfxHits = list => (list || []).map(h => (Array.isArray(h) ? { t: +h[0], g: h[1] == null ? null : +h[1] } : { t: +h, g: null }));

// Nine title entrances, each used at most once per video. Flicker only on the hook (first title) and payoff (last).
const ENTRANCES = ['stagger-rise', 'slam', 'blur-rise', 'slide-left', 'elastic', 'flip', 'pop-zoom', 'drop', 'typewriter'];
const TITLE_ENTER = 0.45; // seconds until a title has settled
// Title effects (1.29.0), one per title: "effect" on a mode 7 flip, Reel.md "| effect type". Drawn by kit/overlay.html
// (the phrase title renderer), documented in docs/effects.md. type: letter by letter with a caret. slot-roll: digits or
// one word swap by a vertical roll. count-up: an eased number count that can roll to a final text. stack-fade: new
// lines stack and older ones go grey, blur and fade. decode: random glyphs settle into the word. split-flap: the same
// on a flap board.
const TITLE_EFFECTS = ['type', 'slot-roll', 'count-up', 'stack-fade', 'decode', 'split-flap'];
// A title's exit that is also the transition at the cut it ends on: "exit" on a flip, Reel.md "| exit polaroid".
const TITLE_EXITS = ['blow-up', 'polaroid', 'glitch-slice', 'dip-black'];
// How a phrase title builds when it has no effect: word by word as said, letter by letter, or line by line.
const TITLE_BUILDS = ['word', 'letter', 'line'];
const TITLE_MODE = 7;
// front (default): the whole title sits in front of the person.
// behind: the hero word goes behind the head (partner words stay in front).
// auto: at most two punch titles (hook and payoff when they are not neighbours) go behind; never consecutive.
const TITLE_LAYERS = ['front', 'behind', 'auto'];
function normalizeLayer(v, fallback) {
  if (v == null || v === '') return fallback;
  const n = String(v).toLowerCase();
  return TITLE_LAYERS.includes(n) ? n : null;
}

// Zoom punch: every cut toggles a 10% punch-in; a big punch adds 12% more over 0.3 s (cut after the hook, cut into the payoff).
const PUNCH = { zoom: 0.10, big: 0.12, bigDur: 0.3, y: 0.4 };

const TRANSITIONS = JSON.parse(fs.readFileSync(path.join(KIT, 'transitions.json'), 'utf8'));
const XFADE_MODES = new Set(['custom', 'fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'circlecrop', 'rectcrop', 'distance', 'fadeblack', 'fadewhite', 'radial', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'circleopen', 'circleclose', 'vertopen', 'vertclose', 'horzopen', 'horzclose', 'dissolve', 'pixelize', 'diagtl', 'diagtr', 'diagbl', 'diagbr', 'hlslice', 'hrslice', 'vuslice', 'vdslice', 'hblur', 'fadegrays', 'wipetl', 'wipetr', 'wipebl', 'wipebr', 'squeezeh', 'squeezev', 'zoomin', 'fadefast', 'fadeslow', 'hlwind', 'hrwind', 'vuwind', 'vdwind', 'coverleft', 'coverright', 'coverup', 'coverdown', 'revealleft', 'revealright', 'revealup', 'revealdown']);
// name -> xfade mode, null for the default glitch seam / hard cut, undefined if unknown
function xfadeMode(name) {
  if (name == null || name === '') return null;
  const n = String(name).toLowerCase();
  // a string is a stock xfade mode, an object a drawn one from kit/xfx.cjs, null the hard cut
  if (n in TRANSITIONS.names) return TRANSITIONS.names[n];
  if (XFADE_MODES.has(n) && n !== 'custom') return n;
  return undefined;
}

// Output clock for a cut.json: where each segment starts, the seams and the total length.
function timeline(C) {
  let t = 0; const segs = [], seams = [];
  (C.segs || []).forEach((s, i) => { const start = t, end = t + (s.out - s.in) + (s.pad || 0); if (i) seams.push(+start.toFixed(3)); segs.push({ i, start, end, s }); t = end; });
  return { segs, seams, total: +(t + (C.tail ?? 0.3)).toFixed(3) };
}

// Humanizer copy standard (scripts, captions, titles). Errors fail `npm run check`; warnings print.
const BANNED = [
  [/[\u2014\u2013]|\s--\s/, 'em dash or en dash: use a period, comma, colon or parentheses'],
  [/\bnot (just |only |merely )?[\w' ]{1,30}?[,;]? but\b/i, '"not X but Y" contrast'],
  [/\bit'?s not (about )?[\w' ]{1,30}?[.,;] it'?s\b/i, '"it\'s not X, it\'s Y" contrast'],
  [/\b(here'?s the thing|here'?s the kicker|here'?s why|let me explain|the truth is|truth be told|spoiler alert)\b/i, 'staged run-up'],
  [/(^|[.!?]\s*)(honestly|frankly|look|listen)[?,!]/i, 'staged run-up'],
  [/\b(let that sink in|read that again|and that'?s the point|period\.|full stop\.)/i, 'one-line dramatic closer'],
  [/\b(delve|delving|testament|tapestry|landscape|showcas(e|ing)|realm|navigate the|unleash|unlock(ing)? the power|elevate|game[- ]?changer|revolutioni[sz]e|supercharge|seamless(ly)?|cutting[- ]edge|next[- ]level|mind[- ]blowing|insane(ly)?|groundbreaking|ultimate|skyrocket|10x your)\b/i, 'hype or overused AI word'],
];
const TRIAD = /\b(\w+), (\w+),? and (\w+)\b/i; // a warning, not an error: a list of three is sometimes the truth
function lintCopy(text) {
  const errs = [], warns = [];
  const s = String(text || '').replace(/\|/g, ' ').replace(/[\u2018\u2019]/g, "'");
  for (const [re, why] of BANNED) { const m = s.match(re); if (m) errs.push(`${why}: "${m[0].trim()}"`); }
  const tm = s.match(TRIAD); if (tm) warns.push(`possible forced triad: "${tm[0]}"`);
  return { errs, warns };
}

// Script shape: hook, one reveal per beat, payoff; 40-55 words, 15-20 s spoken; over 25 s cut a middle sentence.
function scriptShape(words, seconds) {
  const notes = [];
  if (words && (words < 40 || words > 55)) notes.push(`script is ${words} words; aim for 40 to 55`);
  if (seconds > 25) notes.push(`${seconds.toFixed(1)} s spoken; over 25 s, cut a middle sentence (never the hook or the end line)`);
  else if (seconds && (seconds < 15 || seconds > 20)) notes.push(`${seconds.toFixed(1)} s spoken; 15 to 20 s reads best`);
  return notes;
}

function readCaptions(file) {
  const src = fs.readFileSync(file, 'utf8');
  const g = {}; new Function('window', src)(g); // captions.js is our own job file: window.CAPTIONS = {...}
  return g.CAPTIONS || { flips: [] };
}

// Titles in order with their entrance, flicker and layer resolved the same way overlay.html resolves them.
// layer is always 'front' or 'behind' after this (auto is resolved). Job default: CAP.titleLayer or cut.titleLayer, else front.
function resolveTitles(CAP, cut) {
  const ts = (CAP.flips || []).filter(f => f.mode === TITLE_MODE).sort((a, b) => a.start - b.start);
  const used = new Set(ts.map(t => t.entrance).filter(Boolean));
  const free = ENTRANCES.filter(e => !used.has(e));
  // An effect ("effect", else "swap" or "count", else the job's titleEffect) is the title's entrance: it is reported as
  // the entrance, takes none from the pool and has no flicker. "exit": false on a title leaves the job's titleExit out.
  const out = ts.map((t, i) => { const effect = TITLE_EFFECTS.includes(t.effect) ? t.effect : t.swap ? 'slot-roll' : t.count ? 'count-up' : t.effect == null && TITLE_EFFECTS.includes(CAP.titleEffect) ? CAP.titleEffect : null, exit = TITLE_EXITS.includes(t.exit) ? t.exit : t.exit == null && TITLE_EXITS.includes(CAP.titleExit) ? CAP.titleExit : null;
    const entrance = t.entrance || effect || (ENTRANCES.includes(CAP.titleEntrance) ? CAP.titleEntrance : null) || free.shift() || ENTRANCES[i % ENTRANCES.length]; return { ...t, entrance, effect, exit, flicker: (i === 0 || i === ts.length - 1) && !effect && entrance !== 'typewriter' ? t.flicker !== false : false, role: i === 0 ? 'hook' : i === ts.length - 1 ? 'payoff' : 'beat' }; });
  const job = normalizeLayer((CAP && CAP.titleLayer) != null ? CAP.titleLayer : (cut && cut.titleLayer), 'front') || 'front';
  const raw = out.map(t => normalizeLayer(t.layer, job) || job);
  const behind = new Set();
  raw.forEach((v, i) => { if (v === 'behind') behind.add(i); });
  const autos = raw.map((v, i) => v === 'auto' ? i : -1).filter(i => i >= 0);
  if (autos.length) {
    const scored = autos.map(i => {
      const t = out[i];
      let s = 0;
      if (t.role === 'hook' || t.role === 'payoff') s += 3;
      if (t.entrance === 'slam') s += 2;
      if (t.flicker) s += 1;
      return { i, s };
    }).sort((a, b) => b.s - a.s || a.i - b.i);
    for (const { i } of scored) {
      if (behind.size >= 2) break;
      if (behind.has(i - 1) || behind.has(i + 1)) continue;
      behind.add(i);
    }
  }
  return out.map((t, i) => ({ ...t, layer: behind.has(i) ? 'behind' : 'front' }));
}

// A title's exit is the transition at the cut it ends on. For each seam (the index of the segment that starts there) with
// a title whose exit ends within 0.2 s of it: the picture's move. m is the xfade mode (a drawn one from kit/xfx.cjs, a
// stock one, or null for a hard cut under the blow-up flash), d its length and lead how much of it plays before the
// cut, while the title is still up (kit/overlay.html TEX is the same lead, so text and picture move together).
// kit/assemble.cjs uses it in place of the segment's own transition.
const TITLE_EXIT_MOVES = { 'blow-up': { m: null, d: 0.3, lead: 0.3 }, polaroid: { m: { custom: 'polaroid' }, d: 0.45, lead: 0.45 }, 'glitch-slice': { m: { custom: 'glitch-slice' }, d: 0.3, lead: 0.3 }, 'dip-black': { m: 'fadeblack', d: 0.4, lead: 0.2 } };
function titleExitSeams(CAP, cut) {
  const out = {}, segs = timeline(cut || {}).segs;
  for (const t of resolveTitles(CAP || {}, cut)) {
    if (!t.exit || !(t.end < 90)) continue;
    let best = null;
    for (const g of segs) { const gap = Math.abs(g.start - t.end); if (g.i && gap <= 0.2 && (!best || gap < best.gap)) best = { i: g.i, gap }; }
    const mv = TITLE_EXIT_MOVES[t.exit];
    if (best && segs[best.i - 1].end - segs[best.i - 1].start > mv.lead) out[best.i] = { exit: t.exit, text: String(t.text || '').replace(/\|/g, ' '), ...mv };
  }
  return out;
}

// Where the captions sit relative to the person: captionLayer front | behind | auto. auto (the default for captions at
// the top, where they meet the head) = behind. Behind captions draw on the title layer, under the person mask.
function captionLayer(caps) {
  const pos = caps && caps.captionPosition;
  const l = ['front', 'behind', 'auto'].includes(caps && caps.captionLayer) ? caps.captionLayer : (pos === 'top' ? 'auto' : 'front');
  return l === 'behind' || (l === 'auto' && pos === 'top') ? 'behind' : 'front';
}

// Screen cards and b-roll panels (mode 11): behind the presenter's head (his head goes over the panel where it reaches
// into it, his body stays under the panel) or in front of everything. Per panel "layer", else the job's panelLayer,
// default auto, which is behind (no difference from front where the head never reaches the panel).
// Graphics 12 to 38 (kit/graphics.json) take the same layer and the same panel layer under the crown mask; their auto
// is behind only when the graphic sits high in the frame (y below autoBehindY), where the top of the head can reach it.
const PANEL_LAYERS = ['front', 'behind', 'auto'];
const GFXJ = JSON.parse(fs.readFileSync(path.join(KIT, 'graphics.json'), 'utf8'));
const PANEL_MODES = GFXJ.graphics.filter(g => g.mode >= 11).map(g => g.mode);
const GFX_DEFAULTS = Object.fromEntries(GFXJ.graphics.map(g => [g.mode, g.defaults || {}]));
function panelLayer(f, caps) {
  const l = PANEL_LAYERS.includes(f && f.layer) ? f.layer : PANEL_LAYERS.includes(caps && caps.panelLayer) ? caps.panelLayer : 'auto';
  if (l !== 'auto') return l;
  if (!f || f.mode == null || f.mode === 11) return 'behind';
  const y = f.y != null && !isNaN(+f.y) ? +f.y : (GFX_DEFAULTS[f.mode] || {}).y;
  return y != null && y < (GFXJ.autoBehindY ?? 0.45) ? 'behind' : 'front';
}
const panelsBehind = caps => ((caps && caps.flips) || []).filter(f => PANEL_MODES.includes(f.mode) && panelLayer(f, caps) === 'behind');

// Person-mask path and backend. cut.json may use "mask": "mask.mkv" or
// "mask": {"file":"mask.mkv","model":"birefnet","person":"person.mkv"}, plus optional top-level "maskModel" / "person".
// birefnet = birefnet-portrait, the default (kit/mask.py: BiRefNet's second tier, Swin-L at 1024); birefnet-lite is the faster
// third tier; mediapipe is the fast preview.
const MASK_MODELS = { birefnet: 'birefnet-portrait', 'birefnet-portrait': 'birefnet-portrait', 'birefnet-general': 'birefnet-general', 'birefnet-lite': 'birefnet-lite', 'birefnet-general-lite': 'birefnet-lite', mediapipe: 'mediapipe' };
function maskSpec(cut, opts = {}) {
  const m = cut && cut.mask;
  if (!m && !opts.model && !cut?.maskModel) return { file: null, model: null, person: null };
  const file = !m ? null : (typeof m === 'string' ? m : (m.file || m.path || 'mask.mkv'));
  const raw = opts.model || cut.maskModel || (m && typeof m === 'object' && m.model) || process.env.MASK_MODEL || '';
  const key = String(raw || '').toLowerCase();
  const model = key ? (MASK_MODELS[key] || null) : null; // null = let mask.py pick (birefnet-portrait, else the mediapipe preview with a warning)
  if (key && !MASK_MODELS[key]) throw new Error('unknown mask model ' + raw + ' (use birefnet-portrait, birefnet-general, birefnet-lite or mediapipe)');
  const person = opts.person || cut.person || (m && typeof m === 'object' && m.person) || null;
  return { file, model, person };
}


// Music beds: our own tracks in kit/music/, listed in beds.json (npm run music). Each is loudness-matched to -13 LUFS
// on the way in (npm run music:add), so the reel default bedVol 0.16 fits every one. A bed is a library name
// ("vinyl-sunrise") or a path to your own file.
const BEDS = JSON.parse(fs.readFileSync(path.join(KIT, 'music/beds.json'), 'utf8'));
// own keys only ("constructor" is not a bed), and only entries that name their file
const isBed = b => typeof b === 'string' && Object.hasOwn(BEDS, b) && typeof (BEDS[b] || {}).file === 'string';
const bedFile = b => (isBed(b) ? path.join(KIT, 'music', BEDS[b].file) : b);
// Music matched to energy: every library bed is tagged low, mid or high (beds.json "energy", measured tempo and
// onset density). A calm explainer gets a low bed, a fast list gets a high one. scriptEnergy reads the pace of what
// you say (words per second over the speech): 3.2 or more is high, 2.3 or less is low, mid between.
const ENERGIES = ['low', 'mid', 'high'];
const bedsByEnergy = e => Object.keys(BEDS).filter(k => isBed(k) && BEDS[k].energy === e).sort();
function scriptEnergy(words) {
  const ws = (words || []).filter(w => w && w.length >= 2);
  if (ws.length < 4) return 'mid';
  const span = ws[ws.length - 1][1] - ws[0][0], wps = span > 0 ? ws.length / span : 0;
  return wps >= 3.2 ? 'high' : wps <= 2.3 ? 'low' : 'mid';
}
// one bed for an energy, stable per job name (so a rebuild keeps the same track)
function pickBed(energy, seed = '') {
  const l = bedsByEnergy(ENERGIES.includes(energy) ? energy : 'mid');
  if (!l.length) return null;
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return l[h % l.length];
}

// One or the other (Will, 2026-11-18): caption words that repeat an effect's on-screen copy while both show.
// Approximate, warning only. A caption word counts from when it shows to when it goes, by caption style: kinetic
// (default) from the word to the end of its flip, one-word from the word to the next word, other styles the whole
// flip; a flip with no word timings counts its text for the whole flip. Only caption cues count (mode 0, and the
// mode 1 spray word on the caption track): titles (mode 7), stickers, cards and CTAs are skipped, since the overlay
// draws only part of their text (a one-word title shows its hero alone). Effect copy (COPY_FIELDS) counts for the
// whole effect window: per-message reveal times are not modelled. Windows that hide the caption track (merged
// when they overlap or touch) do not count.
const COPY_FIELDS = ['text', 'sub', 'title', 'reply', 'lines', 'label', 'hl', 'pill', 'total'];
const mergeSpans = spans => spans.map(([a, b]) => [+a, +b]).sort((x, y) => x[0] - y[0])
  .reduce((m, s) => { const l = m[m.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else m.push(s); return m; }, []);
const dupWords = (plan, caps, hidden = []) => {
  const norm = w => String(w).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''), out = [], hide = mergeSpans(hidden);
  const flips = ((caps && caps.flips) || []).filter(f => !f.mode || f.mode === 1), base = String((caps && caps.captionStyle) || 'kinetic').toLowerCase();
  const shown = f => {   // [word, from, to] for each caption word while it is on screen
    const st = String(f.style || base).toLowerCase(), ws = f.words && f.words.length ? f.words : null;
    if (!ws) return String(f.text || '').split(/\s+/).filter(Boolean).map(w => [w, +f.start, +f.end]);
    if (f.mode === 1) return String(f.text || ws.map(w => w[2]).join(' ')).split(/\s+/).filter(Boolean).map(w => [w, +f.start, +f.end]);   // a spray shows its displayed text, whole, from the cue start
    if (/one-?word/.test(st)) return ws.map((w, i) => [w[2], +w[0], i + 1 < ws.length ? +ws[i + 1][0] : +(f.end ?? w[1])]);
    if (st === 'kinetic') return ws.map(w => [w[2], +w[0], +(f.end ?? w[1])]);
    return ws.map(w => [w[2], +f.start, +f.end]);
  };
  for (const d of plan) {
    const copy = COPY_FIELDS.map(k => d[k]).filter(v => typeof v === 'string' && v).join(' ');
    const fxw = new Set(copy.split(/::|[\s|]+/).map(norm).filter(Boolean));
    if (!fxw.size) continue;
    for (const f of flips) for (const [w, from, to] of shown(f)) {
      let a = Math.max(from, +d.start); const b = Math.min(to, +d.end);
      if (a >= b || !fxw.has(norm(w))) continue;
      for (const [h0, h1] of hide) if (h0 <= a && h1 > a) a = h1;   // first instant no hide covers (hides are merged and sorted)
      if (a >= b) continue;
      out.push(`"${w}" is in the ${d.fx} copy and in the caption at ${a.toFixed(2)} s (approximate check): drop it from the caption flip or hide captions for the window (one or the other)`);
    }
  }
  return out;
};
module.exports = { BEDS, isBed, bedFile, ENERGIES, bedsByEnergy, scriptEnergy, pickBed, SFX, CUT_SOUNDS, sfxHits, ENTRANCES, TITLE_ENTER, TITLE_EFFECTS, TITLE_EXITS, TITLE_BUILDS, TITLE_EXIT_MOVES, titleExitSeams, TITLE_MODE, TITLE_LAYERS, normalizeLayer, PUNCH, TRANSITIONS, xfadeMode, timeline, lintCopy, scriptShape, readCaptions, resolveTitles, maskSpec, MASK_MODELS, captionLayer, PANEL_LAYERS, PANEL_MODES, panelLayer, panelsBehind, dupWords };
