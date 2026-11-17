// Shared edit rules: the locked sound set, the seven title entrances, named transitions, the punch defaults and
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

// Seven title entrances, each used at most once per video. Flicker only on the hook (first title) and payoff (last).
const ENTRANCES = ['stagger-rise', 'slam', 'blur-rise', 'slide-left', 'elastic', 'flip', 'pop-zoom'];
const TITLE_ENTER = 0.45; // seconds until a title has settled
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
  const out = ts.map((t, i) => ({ ...t, entrance: t.entrance || free.shift() || ENTRANCES[i % ENTRANCES.length], flicker: (i === 0 || i === ts.length - 1) ? t.flicker !== false : false, role: i === 0 ? 'hook' : i === ts.length - 1 ? 'payoff' : 'beat' }));
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
// Graphics 12 to 23 (kit/graphics.json) take the same layer and the same panel layer under the crown mask; their auto
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
const MASK_MODELS = { birefnet: 'birefnet', 'birefnet-general-lite': 'birefnet', 'birefnet-portrait': 'birefnet-portrait', mediapipe: 'mediapipe' };
function maskSpec(cut, opts = {}) {
  const m = cut && cut.mask;
  if (!m && !opts.model && !cut?.maskModel) return { file: null, model: null, person: null };
  const file = !m ? null : (typeof m === 'string' ? m : (m.file || m.path || 'mask.mkv'));
  const raw = opts.model || cut.maskModel || (m && typeof m === 'object' && m.model) || process.env.MASK_MODEL || '';
  const key = String(raw || '').toLowerCase();
  const model = key ? (MASK_MODELS[key] || null) : null; // null = let mask.py pick (birefnet if cached, else mediapipe)
  if (key && !MASK_MODELS[key]) throw new Error('unknown mask model ' + raw + ' (use birefnet, birefnet-portrait or mediapipe)');
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

module.exports = { BEDS, isBed, bedFile, SFX, CUT_SOUNDS, sfxHits, ENTRANCES, TITLE_ENTER, TITLE_MODE, TITLE_LAYERS, normalizeLayer, PUNCH, TRANSITIONS, xfadeMode, timeline, lintCopy, scriptShape, readCaptions, resolveTitles, maskSpec, MASK_MODELS, captionLayer, PANEL_LAYERS, PANEL_MODES, panelLayer, panelsBehind };
