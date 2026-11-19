// One command from a phone clip (or several takes) to a draft reel.
//   npm run reel                        -> the takes in inbox/ (every video from the newest recording session; one file is fine)
//   npm run reel -- inbox/my-take.mov   -> that file;  npm run reel -- inbox/a.mov inbox/b.mov  -> those takes
// Options: --theme aigent|neutral (default aigent)  --cropx 0.4 (face left of centre)
//          --model small.en (Whisper model for transcription; default small.en, fast on a CPU; large-v3 is the slow, most
//            accurate opt-in, a ~3 GB download the first time)
//          --export tiktok|reels|shorts|feed45|square  lay the reel out for that platform's safe area and write
//            reel-vN-<name>.mp4 too (crop, length and bitrate caps: kit/exports.json)
//          --json  print one JSON result line at the end ({ ok, job, reel, export, layout, verify }), for agents and the MCP server
//          After a successful render (not --draft), a one-line star reminder may print on the first
//            render and once more after 5 renders. Skipped with --json, a non-TTY stdout, CI, or AIGENT_NO_STAR=1.
//          --name <job>  --clips <dir> (reuse an existing clip.py folder, skips transcription)  --newest (inbox: newest file only)
//          --hook <take> (first sentence from this take: your most extreme angle)
//          --look kinetic|oneword|muse|classic|one-word (default kinetic: every word animated + one kinetic title per beat, in front of the person by default;
//            oneword = one word at a time, type sizes and faces changing per word, flat-colour type cards;
//            muse = pill captions + titles; classic = the original captions + spray hero word; one-word = one big word at a time)
//          --style kinetic|oneword|classic|pill|hormozi|karaoke|one-word (override the caption style)  --no-titles  --fonts modern|druk|elegant|editorial|<any name in kit/fonts/pairings.json>|<local> (a,b,c cycles them, one per title)
//          --no-punch (no zoom punch)  --no-mask (skip the person mask; titles already default to the front)
//          --mask birefnet|mediapipe (person-mask backend; default mediapipe, fast. birefnet is the quality option, slow on CPU)
//          --draft (stop after captions.js so you can edit it)  --rebuild (re-render + re-assemble an edited job)
//          --broll <folder> (cutaways from your own clips, voice running on)  --bed <name from npm run music> or --bed music.wav  --bed-start 0  --logo logo.svg  --jobs <dir> (default jobs/)  --force
//          --sfx off  (skip locked-set sounds on this draft; also used by npm run fx)
//          --beat-sync / --no-beat-sync  (default on when a bed is set: snap punches, SFX, titles and fx hits to the bed)
//          --finish grain[,vignette,...]  optional film look (grain, vignette, chroma, scan-lines, warm, cool, teal, crushed, mono, bleach)
//          --preset <name>|auto  apply a brand style (npm run preset -- --list). Flags you pass win over the preset.
//          --title-layer front|behind|auto  job default for whether titles sit in front or behind the head (default front)
//          --recipe Reel.md  make it from a Reel.md recipe (docs/reel-md.md): brand kit, music, style, per-shot finishes and
//            punches, title entrances and layers in order. Flags win over the recipe; the recipe wins over the preset it names.
//            --recipe-titles also uses the recipe's title text and times instead of titles drafted from your words, only
//            where you say that text (kit/spoken.cjs); recipe stickers and labels show only words you say.
//            --capture-sources captures the recipe's confirmed screen-card sources (public pages) first, see kit/capture.mjs.
//          --clip <file>  the video to use (same as passing the path; reads well with --recipe)
//            A recipe's graphics (ordinal stickers, app labels, screen cards) land at the recipe's times; icon and src
//            paths are relative to the recipe, and anything left out is drawn as a neutral placeholder.
//          --caption-position top|middle|bottom  --caption-color #rrggbb  where the captions sit and their colour
//          --caption-outline none|thin|thick  --caption-shadow none|soft  --caption-case upper|lower|as-said  the one-word look
//          --caption-layer front|behind|auto  captions under the person where they overlap the head (auto = behind at the top)
//          --panel-layer front|behind|auto  screen cards behind the head where it reaches into them (auto = behind)
//          --tighten <s> / --no-tighten  no dead air: cut every pause inside a line longer than <s> seconds to a jump
//            (keeps 0.12 s of breath; each jump gets the punch toggle). On at 0.3 in the magazine preset.
//          --music-energy low|mid|high|auto  pick a library bed by energy (auto reads your pace); --bed still wins
//          --cards auto|off  colour cards on short lines to land and numbered chapter cards on a list (kit/cards.cjs),
//            plus the number-pop intro on a list. Auto in the magazine preset.
//          --no-sfx-cap  turn off the sound density cap (on by default: kit/sfx-map.cjs)
//          --aliases "Gwyn: Guinn, Gwin; aigent: agent"  names Whisper mishears, written your way in captions and titles
//            (adds to a recipe's ## Aliases)
//          --no-boost  skip the legibility pass (on by default: a caption moment under 3:1 gets a denser halo and is drawn again)
// A title behind the head moves in front when the person mask covers more than 22% of its letters (cut.json "behindMax";
// kit/cover.py); a face title moves to the slot above the head. Left and right titles keep a 6.5% side margin and shrink to fit.
// Writes jobs/<name>/: clips/ (clip.py output), build/ (cut.json, captions.js, theme.js, overlay frames), reel-vN.mp4.
// Steps: clip.py (Whisper, best take per sentence, retakes flagged) -> cut.json from every "keep" clip (zoom punch on
// every cut, big punch after the hook and into the payoff, a few sounds on the key cuts only) -> autocaption ->
// check (copy lint) -> render -> person mask when a title sits behind the head (effects venv) -> assemble.
// It is a first draft. Review clips/clips.md and the reel, then edit build/cut.json or build/captions.js and run --rebuild.
// Before you hand it over: npm run verify -- <name>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const R = require('./rules.cjs');
const B = require('./beats.cjs');
const P = require('./preset.cjs');
const RM = require('./reelmd.cjs');
const S = require('./spoken.cjs');
const CARDS = require('./cards.cjs');
const SFXMAP = require('./sfx-map.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['aliases', 'export', 'caption-position', 'caption-color', 'caption-outline', 'caption-shadow', 'caption-case', 'caption-layer', 'panel-layer', 'caption-entrance', 'recipe', 'clip', 'theme', 'cropx', 'model', 'name', 'clips', 'bed', 'logo', 'jobs', 'hook', 'style', 'look', 'fonts', 'sfx', 'bed-start', 'mask', 'broll', 'finish', 'preset', 'title-layer', 'tighten', 'music-energy', 'cards']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const sh = (cmd, args, cwd, env) => { console.log('>', path.basename(cmd), args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')); execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } }); };
const JSON_OUT = flag('json');
const die = m => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: m })); console.error(m); process.exit(1); };
const X = require('./exports.cjs');
const EXPORT = opt('export') ? String(opt('export')).toLowerCase() : null;
if (EXPORT && !X.get(EXPORT)) die('--export must be ' + X.NAMES.join(', '));
const VIDEO = /\.(mov|mp4|m4v|mkv|webm|avi)$/i;
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');

let srcs = positional.slice();
if (opt('clip')) srcs.unshift(opt('clip'));
const clipsArg = opt('clips');
if (!srcs.length && !clipsArg && !flag('rebuild')) {
  const inbox = path.join(ROOT, 'inbox');
  const vids = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter(f => VIDEO.test(f)).map(f => path.join(inbox, f)) : [];
  if (!vids.length) die('No video given and inbox/ has none. Drop your phone clip into inbox/ or pass a path.');
  vids.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  // several takes of one script: every video recorded within 2 hours of the newest (older leftovers are ignored)
  const newest = fs.statSync(vids[0]).mtimeMs;
  srcs = flag('newest') ? [vids[0]] : vids.filter(v => newest - fs.statSync(v).mtimeMs < 2 * 3600e3).reverse();
  if (srcs.length > 1) console.log(`takes (${srcs.length}):`, srcs.map(v => path.basename(v)).join(', '), ' (--newest for just one)');
}
const src = srcs[0];
// looks: kinetic (default: every word animates in, hero words big behind the head as kinetic titles), muse (pills +
// titles), oneword (one word at a time + type cards, kit/looks/oneword.md), classic (the original captions + spray hero word,
// no titles), one-word (one big word at a time + titles)
const presetArg = opt('preset');
let preset = null;
if (presetArg === 'auto') {
  preset = P.pickAuto();
  console.log(`preset auto: picked "${preset.name}" (${preset.label || preset.name}). Vary looks across scenes. Pass --preset <name> or flags to pin the choice.`);
} else if (presetArg) {
  preset = P.load(presetArg);
  if (!preset) die('Unknown preset "' + presetArg + '". See npm run preset -- --list');
  const perrs = P.validate(preset);
  if (perrs.length) die('Invalid preset "' + presetArg + '": ' + perrs.join('; '));
  if (preset.draft) console.warn('note: preset "' + preset.name + '" is a draft from a brand guide; confirm it before you ship.');
  console.log('preset:', preset.name, '-', preset.label || '');
}
// names and words Whisper mishears, written the way you mean them in captions and titles and counted as said by the
// spoken check: the recipe's "## Aliases" plus --aliases "Gwyn: Guinn, Gwin; aigent: agent" (the flag adds to the recipe's)
function aliasesFlag(v) { const o = {}; for (const part of String(v || '').split(';')) { const m = /^\s*([^:]+?)\s*:\s*(.+)$/.exec(part); if (m) o[m[1]] = m[2].split(',').map(x => x.trim()).filter(Boolean); } return o; }
function setJobAliases(rec) {
  const all = {};
  for (const src of [rec && rec.aliases, aliasesFlag(opt('aliases'))]) for (const [w, h] of Object.entries(src || {})) all[w] = [...new Set([].concat(all[w] || [], [].concat(h).flatMap(x => String(x).split(/[,|]/)).map(x => x.trim()).filter(Boolean)))];
  if (!Object.keys(all).length) return;
  S.setAliases(all);
  console.log('aliases: ' + Object.entries(all).map(([w, h]) => `${w} = ${h.join(' / ')}`).join('; '));
}
// --recipe Reel.md: the recipe acts as a preset on top of the preset it names (a --preset flag still picks the base)
let recipe = null;
if (opt('recipe')) {
  const rf = path.resolve(opt('recipe'));
  if (!fs.existsSync(rf)) die('No recipe at ' + rf);
  try { recipe = RM.load(rf); } catch (e) { die('Reel.md: ' + e.message); }
  const { errs, warn } = RM.validate(recipe);
  warn.forEach(w => console.warn('note: ' + w));
  if (errs.length) die('Reel.md problems:\n- ' + errs.join('\n- '));
  const rp = RM.toPreset(recipe);
  if (rp.bed && rp.bed !== 'auto' && !R.isBed(rp.bed)) rp.bed = path.resolve(path.dirname(rf), rp.bed);
  if (rp.logo && !opt('logo')) { const lf = path.resolve(path.dirname(rf), rp.logo); if (fs.existsSync(lf)) argv.push('--logo', lf); else console.warn('note: recipe logo not found: ' + lf); }
  preset = preset ? { ...preset, ...rp, name: rp.name } : rp;
  console.log(RM.summary(recipe).split('\n').map(l => 'recipe ' + l).join('\n'));
}
setJobAliases(recipe);
// An explicit --look wins over the preset: its caption style, its titles rule and (oneword) its font cycle come with it.
const lookFlag = opt('look');
const look = lookFlag || (preset && preset.look) || 'kinetic';
if (!P.LOOKS.includes(look)) die('--look must be ' + P.LOOKS.join(', '));
const LOOK_STYLE = { kinetic: 'kinetic', oneword: 'oneword', muse: 'pill', classic: 'classic', 'one-word': 'one-word' };
const STYLE = opt('style', (!lookFlag && preset && preset.captionStyle) || LOOK_STYLE[look]);
if (STYLE && !P.STYLES.includes(STYLE)) die('--style must be ' + P.STYLES.join(', '));
const TITLES = flag('no-titles') ? false : (flag('titles') ? true : (!lookFlag && preset && preset.titles !== undefined ? !!preset.titles : look !== 'classic'));
const FONTS = opt('fonts') || (!lookFlag && preset && preset.fonts) || (look === 'oneword' ? 'instrument,literata,bricolage' : undefined);
const name = opt('name') || (src ? path.basename(src).replace(/\.[^.]+$/, '') : path.basename(path.resolve(clipsArg || '.')))
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reel';
const job = path.resolve(opt('jobs', path.join(ROOT, 'jobs')), name), build = path.join(job, 'build');
fs.mkdirSync(build, { recursive: true });
console.log('job:', job);

if (!flag('rebuild')) {
  // 1. clips
  let clipsDir = clipsArg ? path.resolve(clipsArg) : path.join(job, 'clips');
  if (!clipsArg) {
    for (const f of srcs) if (!fs.existsSync(f)) die('Not found: ' + f);
    if (fs.existsSync(path.join(clipsDir, 'clips.json')) && !flag('force')) console.log('clips/ already exists, reusing it (pass --force to re-clip)');
    else sh(PY, [path.join(KIT, 'clip.py'), ...srcs.map(f => path.resolve(f)), '--out', clipsDir, '--vertical', '--cropx', opt('cropx', '0.5'), ...(opt('model') ? ['--model', opt('model')] : []), ...(opt('hook') ? ['--hook', opt('hook')] : [])], job);
  }
  const clips = JSON.parse(fs.readFileSync(path.join(clipsDir, 'clips.json'), 'utf8')).clips;
  const keep = clips.filter(c => !/^retake/.test(c.status));
  if (!keep.length) die('No keep clips in ' + clipsDir);
  // 2. cut.json from every keep clip, in order; a glitch hit and a woosh on each seam
  const rel = p => path.relative(build, path.isAbsolute(p) ? p : path.join(path.dirname(clipsDir), p)).split(path.sep).join('/');
  // no dead air (--tighten <s>, or the preset's "tighten"): a pause inside a line longer than that cuts to a jump. The
  // word times say where you stop and start; 0.06 s of breath stays on each side, so the jump keeps a 0.12 s pause.
  const TIGHT = flag('no-tighten') ? false : opt('tighten') != null ? +opt('tighten') : (preset && preset.tighten != null ? preset.tighten : false);
  if (TIGHT !== false && !(TIGHT >= 0.15 && TIGHT <= 2)) die('--tighten must be the longest pause to keep, 0.15 to 2 seconds');
  const spansOf = c => {
    const dur = +(+c.dur).toFixed(3), ws = (c.words || []).filter(w => w[1] > w[0]);
    if (!TIGHT || ws.length < 2) return [[0, dur]];
    const out = []; let a = 0;
    for (let i = 0; i < ws.length - 1; i++) { const b = ws[i][1] + 0.06, n = ws[i + 1][0] - 0.06; if (ws[i + 1][0] - ws[i][1] > TIGHT && b - a >= 0.35) { out.push([a, b]); a = n; } }
    out.push([a, dur]);
    return out.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]).filter(([x, y]) => y - x > 0.05);
  };
  const segs = [], clipStart = [];
  keep.forEach((c, ci) => { clipStart.push(segs.length); spansOf(c).forEach(([a, b], k) => segs.push({ file: rel(path.join(clipsDir, path.basename(c.file))), in: a, out: b, ...(k ? { jump: true } : {}), ...(ci === 0 && k === 0 ? { fadeIn: 0.25 } : {}) })); });
  if (TIGHT) { const was = keep.reduce((a, c) => a + +c.dur, 0), now = segs.reduce((a, s) => a + s.out - s.in, 0), n = segs.filter(s => s.jump).length; console.log(`no dead air: ${n} pause${n === 1 ? '' : 's'} over ${TIGHT} s cut to jumps (${(was - now).toFixed(1)} s shorter)`); }
  // big punch on the cut after the hook and the cut into the payoff (with 3+ clips); a jump inside a line keeps the toggle
  const wantPunch = flag('no-punch') ? false : (preset && preset.punch === false ? false : true);
  if (wantPunch && keep.length >= 3) { segs[clipStart[1]].bigPunch = true; segs[clipStart[keep.length - 1]].bigPunch = true; }
  let t = 0; const seams = [], jumpSeams = new Set();
  segs.forEach((s, i) => { if (i) { seams.push(+t.toFixed(3)); if (s.jump) jumpSeams.add(+t.toFixed(3)); } t += s.out - s.in; });
  // sound, fewer and deeper: a whoosh on the big-punch cuts (or the first cut), the boom (loudest) into the payoff;
  // every seam keeps its glitch hit, but not a sound
  const big = segs.map((s, i) => (s.bigPunch ? i : -1)).filter(i => i > 0).map(i => seams[i - 1]);
  const sfx = {};
  if (seams.length) {
    const clipSeams = seams.filter(x => !jumpSeams.has(x)), last = clipSeams.length ? clipSeams[clipSeams.length - 1] : seams[seams.length - 1], wh = (big.length ? big : [clipSeams[0] ?? seams[0]]).filter(x => x !== last || seams.length === 1);
    if (wh.length) sfx.whoosh = wh;
    if (clipSeams.length >= 2) sfx.boom = [[last, 0.55]];
  }
  const cut = { note: `Drafted by kit/reel.cjs from ${keep.length} keep clips (${clips.length - keep.length} retakes skipped). Edit, then: npm run reel -- --rebuild --name ${name}`, segs, tail: 0.3, punch: wantPunch ? (typeof (preset && preset.punch) === 'number' ? preset.punch : 0.1) : false, hits: [[0.02, 14], ...seams.filter(s => !jumpSeams.has(s)).map(s => [s, 24])], sfx, overlay: 'ovl/%04d.png' };
  if (TITLES) {
    if (flag('no-mask')) Object.assign(cut, { titles: 'ovlt/%04d.png' });
    else {
      const model = opt('mask');
      if (model) R.maskSpec({ mask: 'mask.mkv', maskModel: model }); // validate
      Object.assign(cut, { titles: 'ovlt/%04d.png', mask: 'mask.mkv', ...(model ? { maskModel: model } : {}) });
    }
  }
  // a library name stays a name in cut.json (portable across machines); your own file becomes an absolute path.
  // Music matched to energy: "bed": "auto" (or --music-energy, or the preset's musicEnergy) picks a library bed by
  // energy; auto energy reads your pace (kit/rules.cjs scriptEnergy). --bed always wins.
  let bed = opt('bed') || (preset && preset.bed) || undefined, energyBed = false;
  const energyArg = opt('music-energy') || (preset && preset.musicEnergy) || (bed === 'auto' ? 'auto' : undefined);
  if (energyArg && !['auto', ...R.ENERGIES].includes(String(energyArg))) die('--music-energy must be low, mid, high or auto');
  if (!opt('bed') && energyArg && (bed === 'auto' || !bed || opt('music-energy'))) {
    const words = []; let off = 0; for (const c of keep) { for (const w of c.words || []) words.push([w[0] + off, w[1] + off]); off += +c.dur; }
    const e = energyArg === 'auto' ? R.scriptEnergy(words) : energyArg; bed = R.pickBed(e, name) || undefined; energyBed = true;
    console.log(`music: ${e} energy${energyArg === 'auto' ? ' (from your pace)' : ''} -> bed ${bed || 'none'} (npm run music lists them by energy)`);
  } else if (bed === 'auto') bed = undefined;
  if (bed) Object.assign(cut, { bed: require('./rules.cjs').isBed(bed) ? bed : path.resolve(bed), bedVol: 0.16, ...(opt('bed-start') != null ? { bedStart: +opt('bed-start') } : {}) });
  // sound mapped to the moves and the density cap (kit/sfx-map.cjs)
  if (preset && preset.sfxMap) cut.sfxMap = true;
  if (preset && preset.sfxCap !== undefined) cut.sfxCap = preset.sfxCap;
  if (flag('no-sfx-cap')) cut.sfxCap = false;
  if (flag('no-beat-sync')) cut.beatSync = false;
  else if (flag('beat-sync') || bed) cut.beatSync = true;
  if (recipe) {
    const plan = RM.shotSettings(recipe);
    // per-shot settings go to each clip (its first segment, or every segment for a finish, when pauses were tightened)
    plan.forEach((p, i) => { const k = clipStart[i]; if (k == null) return; const sg = segs[k], subs = segs.slice(k, clipStart[i + 1] ?? segs.length); if (p.finish) subs.forEach(x => { x.finish = p.finish; }); if (p.bigPunch && wantPunch) sg.bigPunch = true; if (p.transition && i) sg.transition = p.transition; });
    if (plan.length !== keep.length) console.log(`recipe: ${plan.length} shots in the recipe, ${keep.length} clips from your takes; per-shot settings applied to the first ${Math.min(plan.length, keep.length)}`);
    if (preset.bedStart != null && opt('bed-start') == null && cut.bed) cut.bedStart = preset.bedStart;
    if (preset.bedVol != null && cut.bed) cut.bedVol = preset.bedVol;
    cut.recipe = recipe.card.name;
  }
  const finish = opt('finish') || (preset && !preset.finishPool && preset.finish) || undefined;
  if (finish) { try { B.parseFinish(finish); } catch (e) { die(e.message); } cut.finish = finish; }
  if (preset) {
    P.apply(preset, { cut }, {
      finish: opt('finish') || undefined,
      bed: opt('bed') || (energyBed ? bed || null : undefined),
      punch: flag('no-punch') ? false : undefined,
      beatSync: flag('no-beat-sync') ? false : (flag('beat-sync') ? true : undefined),
      titleLayer: opt('title-layer') || undefined,
    });
  }
  // glitch off (the magazine preset): no glitch seams and no RGB drop shakes from beat-sync, soft transitions only
  if (preset && preset.glitch === false) { cut.hits = []; cut.glitch = false; }
  if (opt('title-layer')) {
    const layer = String(opt('title-layer')).toLowerCase();
    if (!R.TITLE_LAYERS.includes(layer)) die('--title-layer must be front, behind or auto');
    cut.titleLayer = layer;
  }
  if (fs.existsSync(path.join(build, 'cut.json')) && !flag('force')) die('build/cut.json exists. Use --rebuild to render your edits, or --force to redraft.');
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
  console.log(`cut.json: ${segs.length} segments, seams ${JSON.stringify(seams)}`);
  // 3. captions from the clips' word times
  const logo = opt('logo');
  if (logo) fs.copyFileSync(path.resolve(logo), path.join(build, path.basename(logo)));
  sh(process.execPath, [path.join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--force', ...(cut.hits && cut.hits.length === 0 ? ['--no-glitch'] : []), ...(TITLES ? ['--titles'] : look === 'oneword' ? [] : ['--hero']), ...(look === 'oneword' ? ['--cards'] : []), '--style', STYLE, ...(FONTS ? ['--fonts', FONTS] : []), ...(logo ? ['--logo', path.basename(logo)] : [])], build);
  // captions and titles in the words you mean: the recipe's Aliases, and numbers Whisper split at the comma ("10 ,000")
  { const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF), n = S.meantFlips(caps.flips); if (n) { fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n'); console.log(`captions: ${n} lines in the words you mean (aliases, split numbers)`); } }
  if (recipe && recipe.titles.length && TITLES) {
    const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF);
    const rt = RM.titleFlips(recipe);
    if (flag('recipe-titles')) {
      const len = segs.reduce((a, s) => a + (s.out - s.in), 0);
      // the recipe's words only where you say them: a title whose text is not in what you say around its time is dropped
      const said = S.timeline(segs, build), ok = rt.filter(f => f.start < len && S.said(f.text, said, f.start, f.end));
      caps.flips = (caps.flips || []).filter(f => f.mode !== 7).concat(ok.map(f => ({ ...f, end: Math.min(f.end, len) })));
      for (const f of rt.filter(f => !ok.includes(f))) console.log(`recipe title dropped: "${f.text}" at ${f.start}s is not in what you say there`);
      console.log(`recipe titles: ${ok.length} of ${rt.length} from the recipe (text and times; only text you say)`);
    } else {
      const mine = (caps.flips || []).filter(f => f.mode === 7).sort((a, b) => a.start - b.start), used = new Set();
      const set = new Set();
      mine.forEach((f, i) => { const r = rt[i]; if (!r) return; if (r.entrance && !used.has(r.entrance)) { f.entrance = r.entrance; used.add(r.entrance); set.add(f); } if (r.layer) f.layer = r.layer; if (r.place) f.place = r.place; if (r.lockup) f.lockup = r.lockup; });
      mine.forEach(f => { if (!set.has(f) && f.entrance && used.has(f.entrance)) delete f.entrance; }); // each entrance once; the engine fills the rest
      console.log(`recipe titles: entrance, layer and place pattern applied to ${Math.min(mine.length, rt.length)} of your ${mine.length} titles (pass --recipe-titles to use the recipe's text)`);
    }
    fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
  }
  if (cut.titleLayer) {
    const capF = path.join(build, 'captions.js');
    const caps = R.readCaptions(capF);
    if (caps.titleLayer == null) {
      caps.titleLayer = cut.titleLayer;
      fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
    }
  }
  // caption band and colour (--caption-position top|middle|bottom, --caption-color #rrggbb, or the recipe's Style), and
  // the recipe's graphics (ordinal stickers, app labels, screen cards) at the recipe's times, inside your clip's length
  {
    const pos = opt('caption-position') || (preset && preset.captionPosition), col = opt('caption-color') || (preset && preset.captionColor);
    if (pos && !RM.CAPTION_POSITIONS.includes(String(pos))) die('--caption-position must be ' + RM.CAPTION_POSITIONS.join(', '));
    if (col && !/^#[0-9a-f]{6}$/i.test(String(col))) die('--caption-color must be a #rrggbb colour');
    const look = {};
    for (const [k, [key, vals]] of Object.entries(RM.CAPTION_LOOK)) { const v = opt(k) || (preset && preset[key]); if (v == null) continue; if (!vals.includes(String(v))) die(`--${k} must be ${vals.join(', ')}`); look[key] = String(v); }
    // --capture-sources: capture the recipe's confirmed screen-card sources (public pages) first (kit/capture.mjs)
    if (recipe && flag('capture-sources')) { try { sh(process.execPath, [path.join(KIT, 'capture.mjs'), '--recipe', recipe.file], ROOT); } catch { console.warn('note: some sources were not captured (listed above); their cards use the placeholder'); } }
    const gfx = recipe ? RM.graphicFlips(recipe) : [];
    for (const g of gfx) if (g.source && !g.src) console.log(`note: screen card at ${g.start}s: source ${g.source} not captured yet; placeholder drawn (npm run capture -- --recipe ${recipe.file}, or --capture-sources, once the user confirms the URL)`);
    // a burst sized to the head (head, head-y): measure your clip's head with the person mask and set size and y
    let hwMemo;
    const measureHead = () => {
      if (hwMemo !== undefined) return hwMemo;
      const fxPy = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      hwMemo = null;
      if (fs.existsSync(fxPy) && segs.length) try { hwMemo = JSON.parse(execFileSync(fxPy, [path.join(KIT, 'teardown.py'), 'headwidth', path.resolve(build, segs[0].file)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').pop()); } catch {}
      return hwMemo;
    };
    if (gfx.some(g => g.head)) {
      const hw = measureHead();
      if (hw && hw.head_w) {
        for (const g of gfx.filter(g => g.head)) { g.size = Math.round(Math.min(720, Math.max(200, g.head * hw.head_w * 1080 / 2))); g.y = +Math.min(0.6, Math.max(0.15, hw.head_cy + (g.headY || 0) * hw.head_w * 1080 / 1920)).toFixed(3); }
        console.log(`burst sized to your head: head ${(hw.head_w * 100).toFixed(0)}% of the frame wide, centre ${(hw.head_cy * 100).toFixed(0)}% down`);
      } else console.log('note: no person mask to measure your head (npm run effects:setup); bursts keep the recipe size');
    }
    if (pos || col || gfx.length || Object.keys(look).length) {
      const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF);
      if (pos) caps.captionPosition = String(pos);
      if (col) caps.captionColor = String(col).toLowerCase();
      Object.assign(caps, look);
      // captions behind the person need the title layer and the person mask
      if (R.captionLayer(caps) === 'behind' && !cut.titles) { Object.assign(cut, flag('no-mask') ? { titles: 'ovlt/%04d.png' } : { titles: 'ovlt/%04d.png', mask: 'mask.mkv', ...(opt('mask') ? { maskModel: opt('mask') } : {}) }); fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1)); }
      // top captions behind the head stay readable: measure the highest the head goes so the words sit on the hairline, not in the hair
      if (R.captionLayer(caps) === 'behind' && caps.captionPosition === 'top' && caps.headTop == null) {
        const hw = measureHead();
        if (hw && hw.head_top) { caps.headTop = Math.round(hw.head_top * 1920); console.log(`captions behind the head: your head reaches ${(hw.head_top * 100).toFixed(0)}% down; one-word captions sit on top of it`); }
      }
      if (gfx.length) {
        // the recipe's words never show on your clip: ordinal stickers show the ordinal you say when you say it, app
        // labels stay only if you name the app (kit/spoken.cjs); screen cards keep the recipe's times
        const len = segs.reduce((a, sg) => a + (sg.out - sg.in), 0), sp = S.fitGraphics(gfx, S.timeline(segs, build), len);
        for (const d of sp.dropped) console.log('recipe graphic dropped: ' + d.why);
        const fit = sp.gfx.filter(g => g.start < len - 0.3).map(g => ({ ...g, end: +Math.min(g.end, len).toFixed(3) }));
        caps.flips = (caps.flips || []).filter(f => !Object.values(RM.GRAPHICS).includes(f.mode)).concat(fit);
        // a sticker behind the head, or a screen card or graphic behind the top of the head, needs the person mask, even with no titles
        if ((fit.some(g => g.mode === 9 && g.layer === 'behind') || R.panelsBehind(caps).length) && !cut.titles) Object.assign(cut, flag('no-mask') ? { titles: 'ovlt/%04d.png' } : { titles: 'ovlt/%04d.png', mask: 'mask.mkv', ...(opt('mask') ? { maskModel: opt('mask') } : {}) });
        fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
        for (const g of fit.filter(g => g.spoken)) console.log(`recipe graphic: ${g.mode === 9 ? 'ordinal sticker' : 'app label'} "${g.text}" at ${g.start}s (you say "${g.spoken}")`);
        console.log(`recipe graphics: ${fit.length} of ${gfx.length} fit your ${len.toFixed(1)} s (${fit.filter(g => g.icon || g.src).length} with your files, the rest drawn)`);
      }
      // the face zone the layout pass keeps moved captions and titles out of (kit/overlay.html), from your head
      if (gfx.length && caps.faceTop == null) { const hw = measureHead(); if (hw && hw.head_w && hw.head_cy != null) { caps.faceTop = Math.round(Math.max(0, (hw.head_top != null ? hw.head_top : hw.head_cy - hw.head_w * 0.6)) * 1920); caps.faceBottom = Math.round(Math.min(1920, hw.head_cy * 1920 + hw.head_w * 1080 * 0.9)); console.log(`face zone for the layout: ${caps.faceTop} to ${caps.faceBottom} px down (moved captions stay out of it)`); } }
      if (pos || col || Object.keys(look).length) console.log(`captions: ${pos || 'default band'}${col ? ', ' + String(col).toLowerCase() : ''}${Object.entries(look).map(([k, v]) => `, ${k === 'panelLayer' ? 'screen cards' : k.replace('caption', '').toLowerCase()} ${v}`).join('')}`);
      fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
    }
  }
  // Editorial pass (the magazine preset, or the matching flags and Reel.md lines): colour and chapter cards, the
  // number-pop intro on a list, titles placed around the head, a set entrance order. docs/guide.md "Editing principles built in".
  {
    const cardsMode = opt('cards') || (preset && preset.cards) || 'off';
    if (!['auto', 'off'].includes(String(cardsMode))) die('--cards must be auto or off');
    const places = (preset && preset.titlePlaces) || [], order = (preset && preset.entranceOrder) || [];
    const rCards = recipe ? RM.cardFlips(recipe) : [];
    if (cardsMode === 'auto' || rCards.length || places.length || order.length) {
      const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF), len = segs.reduce((a, sg) => a + (sg.out - sg.in), 0);
      let fl = caps.flips || [];
      if (rCards.length || cardsMode === 'auto') {
        let cards = rCards.filter(c => c.start < len - 0.3).map(c => ({ ...c, end: +Math.min(c.end, len).toFixed(3) })), pop = null;
        if (!rCards.length) {
          const pr = CARDS.proposeCards(S.timeline(segs, build), { len, palette: preset && preset.cardPalette });
          cards = pr.cards.map(c => CARDS.cardFlip(c)); pop = pr.numberPop;
          for (const c of pr.cards) console.log(`card: ${c.start}-${c.end}s ${c.bg}${c.chapter != null ? ' chapter ' + c.chapter : ''} (${c.why})`);
        }
        fl = fl.filter(f => f.mode !== 8).concat(cards);
        if (pop && !fl.some(f => f.mode === 38)) { fl.push({ start: pop.start, end: pop.end, mode: 38, count: pop.count }); console.log(`number pop: 1 to ${pop.count} around your head at ${pop.start}s (${pop.why})`); }
        // a title that would sit on a card moves off it; one that starts inside a card is dropped (the card is the headline)
        fl = fl.filter(f => !(f.mode === 7 && cards.some(c => f.start >= c.start && f.start < c.end)));
      }
      const titles = fl.filter(f => f.mode === 7).sort((a, b) => a.start - b.start), used = new Set(titles.map(f => f.entrance).filter(Boolean));
      let k = 0;
      titles.forEach((f, i) => {
        if (order.length && !f.entrance) { const e = order.find(x => !used.has(x)); if (e) { f.entrance = e; used.add(e); } }
        if (places.length && !f.place) { const pl = places[k++ % places.length]; if (pl !== 'center') f.place = pl; }
        if (f.place === 'face' && !f.layer) f.layer = 'behind';
      });
      // the head box for placing words around it (left, right, above, chest, face), from the person mask
      if ((places.length || fl.some(f => f.place)) && caps.headX0 == null) {
        const fxPy = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        let hw = null; if (fs.existsSync(fxPy)) try { hw = JSON.parse(execFileSync(fxPy, [path.join(KIT, 'teardown.py'), 'headwidth', path.resolve(build, segs[0].file)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').pop()); } catch {}
        if (hw && hw.head_w) {
          const cx = (hw.head_cx != null ? hw.head_cx : 0.5) * 1080, w = hw.head_w * 1080;
          caps.headX0 = Math.round(cx - w / 2); caps.headX1 = Math.round(cx + w / 2);
          if (caps.faceTop == null) { caps.faceTop = Math.round(Math.max(0, (hw.head_top != null ? hw.head_top : hw.head_cy - hw.head_w * 0.6)) * 1920); caps.faceBottom = Math.round(Math.min(1920, hw.head_cy * 1920 + w * 0.9)); }
          console.log(`head box for placed titles: x ${caps.headX0} to ${caps.headX1}, y ${caps.faceTop} to ${caps.faceBottom} px`);
        } else console.log('note: no person mask to measure your head (npm run effects:setup); placed titles use a typical head box');
      }
      caps.flips = fl;
      fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
      if (titles.some(f => f.place)) console.log(`titles placed: ${titles.map(f => f.place || 'center').join(', ')}`);
    }
  }
  // last check on a recipe job: every title, ordinal sticker, app label and worded graphic (kit/graphics.json "spoken")
  // shows only words you say around its time; a checklist keeps the rows you say and ticks each as you say it
  if (recipe) {
    const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF), au = S.audit(caps.flips, S.timeline(segs, build));
    if (au.dropped.length) { caps.flips = au.flips; fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n'); for (const d of au.dropped) console.log((d.kept ? 'field left off, graphic kept: ' : 'dropped, not said: ') + d.why); }
    else console.log('on-screen words: every title, sticker, label and graphic is something you say');
    for (const z of S.fuzzyLog(true)) console.log(`spoken match: "${z.want}" counted as said (heard "${z.heard}", ${z.how})${z.how === 'alias' ? '' : `; add "- ${z.want}: ${z.heard}" to the recipe's Aliases to make it explicit`}`);
    if (au.flips.some(f => f.at || f.details)) { caps.flips = au.flips; fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n'); }
  }
  // cues: a graphic's "cues" (words or seconds) become its beat times ("at") from when you say them (kit/spoken.cjs)
  {
    const capF = path.join(build, 'captions.js');
    const caps = fs.existsSync(capF) ? R.readCaptions(capF) : null;
    if (caps && (caps.flips || []).some(f => f.cues)) {
      const cu = S.cueFlips(caps.flips, S.timeline(segs, build));
      caps.flips = cu.flips; fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
      for (const r of cu.resolved) console.log(`cue "${r.cue}" on the graphic at ${r.start}s: ${r.said ? 'said at' : 'placed at'} ${r.at}s`);
    }
  }
  // --broll <folder>: cutaways from your own clips. A phrase that isn't a type card or under a title cuts to the next
  // clip in the folder (every third phrase, 0.8 to 2.2 s), the voice running on; see "inserts" in kit/assemble.cjs.
  if (opt('broll')) {
    const dir = path.resolve(opt('broll')), files = fs.readdirSync(dir).filter(f => VIDEO.test(f)).sort().map(f => path.join(dir, f));
    if (!files.length) die('No video files in ' + dir);
    const fl = R.readCaptions(path.join(build, 'captions.js')).flips || [], busy = fl.filter(x => x.mode === 8 || x.mode === 7);
    const free = fl.filter(x => x.mode === 0 && !busy.some(b => x.start < b.end && b.start < x.end));
    const cutF = path.join(build, 'cut.json'), cj = JSON.parse(fs.readFileSync(cutF, 'utf8'));
    const durOf = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
    cj.inserts = free.filter((_, i) => i % 3 === 2).map((x, k) => { const file = files[k % files.length], dur = +Math.min(2.2, Math.max(0.8, x.end - x.start)).toFixed(2);
      return { file: path.relative(build, file).split(path.sep).join('/'), at: x.start, dur, in: +Math.max(0, Math.min(1, durOf(file) - dur)).toFixed(2) }; });
    fs.writeFileSync(cutF, JSON.stringify(cj, null, 1));
    console.log(`b-roll: ${cj.inserts.length} inserts from ${files.length} clips`);
  }
  // shapes to set words on (kit/anchors.py): a cutaway sets its word on a hard line in the shot (else the head, else a
  // shoulder); on your own shot every third free key word sits on your head or a shoulder while the small words run on
  const fxPyA = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (look === 'oneword' && fs.existsSync(fxPyA)) {
    const cutF = path.join(build, 'cut.json'), cj = JSON.parse(fs.readFileSync(cutF, 'utf8')), capF = path.join(build, 'captions.js'), CAPS = R.readCaptions(capF);
    const ins = cj.inserts || [], fl = CAPS.flips || [], busy = fl.filter(x => x.mode === 8 || x.mode === 7).concat(ins.map(s => ({ start: s.at, end: s.at + s.dur })));
    const heroAt = x => { const w = (x.words || [])[Array.isArray(x.hero) ? x.hero[0] : 0]; return w ? w[0] : x.start; };
    // shapes on your own shot are an accent, twice a reel: a phrase near a third of the way in traces your outline, a
    // key word near two thirds sits on your head (or a shoulder)
    const free = fl.filter(x => x.mode === 0 && !busy.some(b => x.start < b.end && b.start < x.end)), end = fl.reduce((m, x) => Math.max(m, x.end), 0);
    const near = (p, not) => free.filter(x => x !== not && (x.words || []).length >= (p < 0.5 ? 3 : 1)).sort((a, b) => Math.abs(a.start - end * p) - Math.abs(b.start - end * p))[0];
    const f1 = near(0.35), f2 = near(0.7, f1), face = [f1, f2].filter(Boolean);
    sh(process.execPath, [path.join(KIT, 'assemble.cjs'), 'base.mp4'], build, { BASEONLY: '1' });
    const q = [...ins.map(s => [path.resolve(build, s.file), +(s.in + s.dur / 2).toFixed(2)]), ...face.map(x => [path.join(build, 'base.mp4'), +(heroAt(x) + 0.1).toFixed(2)])];
    if (q.length) {
      const found = execFileSync(fxPyA, [path.join(KIT, 'anchors.py'), ...q.flat().map(String)], { env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 1 << 24 }).toString().trim().split(/\r?\n/).map(l => JSON.parse(l));
      const box = s => s && { y: s.y, x0: s.x0, x1: s.x1 };
      ins.forEach((s, k) => { const A = found[k]; const L = A && (A.line || A.head || A.shoulders[0]); if (L) s.line = box(L); });
      // alternate: a key word on the head, the phrase curving along the outline over the head and shoulders, a shoulder
      face.forEach((x, k) => { const A = found[ins.length + k]; if (!A) return; if (x === f1 && A.arc) { x.arc = A.arc; return; } const L = A.head || A.shoulders[0]; if (L) x.anchor = box(L); });
      fs.writeFileSync(cutF, JSON.stringify(cj, null, 1));
      fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(CAPS, null, 1) + ';\n');
      console.log(`shapes: ${ins.filter(s => s.line).length} of ${ins.length} cutaways set on a shape in the shot, ${face.filter(x => x.anchor).length} key words on your head or a shoulder, ${face.filter(x => x.arc).length} phrases along your outline`);
    }
  }
  // 4. theme
  const th = path.join(KIT, 'themes', opt('theme', (preset && preset.theme) || 'aigent') + '.js');
  if (!fs.existsSync(th)) die('No theme ' + th);
  fs.copyFileSync(th, path.join(build, 'theme.js'));
  if (flag('draft')) { console.log(`\nDraft ready. Edit ${build}/captions.js (and cut.json), then: npm run reel -- --rebuild --name ${name}`); process.exit(0); }
}

// 5. beat-sync (optional), then render + assemble
let cut = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8'));
if (flag('no-beat-sync')) cut.beatSync = false;
else if (flag('beat-sync')) cut.beatSync = true;
if (B.wantBeatSync(cut) && cut.bed) {
  const grid = B.analyseBed(cut, build, { required: flag('beat-sync'), python: PY });
  if (grid) {
    const capFile = path.join(build, 'captions.js');
    const caps = fs.existsSync(capFile) ? R.readCaptions(capFile) : null;
    const synced = B.applySync(cut, caps, grid);
    cut = synced.cut;
    fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
    if (synced.captions) B.writeCaptions(capFile, synced.captions);
    if (cut.glitch === false && cut.dropHits) { delete cut.dropHits; fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1)); }
    const nDrop = (cut.dropHits || []).length;
    console.log(`beat-sync: ${grid.tempo_bpm} BPM, ${(grid.beats || []).length} beats, ${nDrop} drop shakes (window ${B.windowOf(cut)}s); speech cuts unchanged`);
  }
} else if (cut.dropHits) {
  delete cut.dropHits;
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
}
const LEN = cut.segs.reduce((a, s) => a + (s.out - s.in) + (s.pad || 0), 0) + (cut.tail ?? 0.3);
// sounds mapped to the moves (cut.json "sfxMap": true, the magazine preset): the auto ones are replaced on every run,
// the ones you placed stay; the density cap in kit/assemble.cjs thins them out
if (cut.sfxMap) {
  const capF = path.join(build, 'captions.js'), fl = fs.existsSync(capF) ? (R.readCaptions(capF).flips || []) : [];
  const auto = SFXMAP.autoHits(cut, fl);
  cut.sfxHits = (cut.sfxHits || []).filter(h => !h.auto).concat(auto);
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
  console.log(`sfx map: ${auto.length} sounds on the moves (${[...new Set(auto.map(h => h.why.split(' ')[0]))].join(', ')})`);
}
// --export <name>: the layout pass keeps everything inside that platform's safe area (captions.js exportFrame); the
// name stays in cut.json so a later --rebuild exports again
{ const capF = path.join(build, 'captions.js');
  if (EXPORT && fs.existsSync(capF)) {
    const caps = R.readCaptions(capF); caps.exportFrame = X.frameOf(EXPORT); fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
    if (cut.export !== EXPORT) { cut.export = EXPORT; fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1)); }
    console.log(`export ${EXPORT}: ${X.get(EXPORT).label}, everything kept inside its safe area`);
  } }
// copy lint and title/sound rules: printed, not blocking (npm run check -- <name> and npm run verify fail on errors)
try { sh(process.execPath, [path.join(KIT, 'check.mjs'), build, '--warn-only'], build); } catch {}
sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build);
// screen cards behind the head render to ovlp/; assemble.cjs needs to know (with the head mask below, else in front)
{ let lj = {}; try { lj = JSON.parse(fs.readFileSync(path.join(build, 'layers.json'), 'utf8')); } catch {}
  const want = lj.panels === 'behind' ? 'ovlp/%04d.png' : undefined;
  if (cut.panels !== want) { if (want) cut.panels = want; else { delete cut.panels; delete cut.headMask; } fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1)); } }
// person mask only for titles that sit behind the head (needs npm run effects:setup)
if (cut.titles && cut.mask) {
  const capsNow = R.readCaptions(path.join(build, 'captions.js'));
  const behind = R.resolveTitles(capsNow, cut).filter(t => t.layer === 'behind')
    .concat((capsNow.flips || []).filter(f => f.mode === 9 && f.layer === 'behind').map(f => ({ start: f.start, end: f.end })));
  // captions behind the person (caption-layer behind, or auto at the top): mask every caption span
  if (R.captionLayer(capsNow) === 'behind') {
    const spans = (capsNow.flips || []).filter(f => f.mode === 0).map(f => [f.start, Math.min(f.end, LEN)]).sort((a, b) => a[0] - b[0]), merged = [];
    for (const [a, b] of spans) { const l = merged[merged.length - 1]; if (l && a <= l[1] + 1.6) l[1] = Math.max(l[1], b + 1.5); else merged.push([a, b + 1.5]); }
    if (merged.length) { behind.push(...merged.map(([a, b]) => ({ start: a, end: Math.min(b, LEN) }))); console.log(`captions behind the person: mask over ${merged.length} caption span${merged.length > 1 ? 's' : ''}`); }
  }
  // a caption placed over the face draws behind the person
  else { const fc = (capsNow.flips || []).filter(f => f.mode === 0 && f.place === 'face'); if (fc.length) behind.push(...fc.map(f => ({ start: f.start, end: Math.min(f.end, LEN) }))); }
  // screen cards behind the head: mask their spans, then cut the head out of the person mask (kit/headmask.py)
  const panels = R.panelsBehind(capsNow).map(f => ({ start: f.start, end: Math.min(f.end, LEN) }));
  if (panels.length && cut.panels) { behind.push(...panels); console.log(`screen cards behind the top of the head: mask over ${panels.length} card span${panels.length > 1 ? 's' : ''}`); }
  if (!behind.length) {
    console.log('title layer: all titles and stickers in front; skipping the person mask');
  } else {
    const fxPy = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const spec = R.maskSpec(cut, { model: opt('mask') });
    if (!fs.existsSync(fxPy)) { console.warn('WARNING: some titles, captions or graphics are set to sit behind your head (behind, or auto), but the person mask is not set up, so they stay in front. Set it up once with: npm run effects:setup'); process.env.MASK_WARNED = '1'; }
    else {
      sh(process.execPath, [path.join(KIT, 'assemble.cjs'), 'base.mp4'], build, { BASEONLY: '1' }); // BASEONLY already drops sfx and bed
      const win = behind.map(t => `${Math.max(0, t.start - 0.1).toFixed(2)}-${Math.min(LEN, t.end + 0.1).toFixed(2)}`).join(',');
      const maskArgs = [path.join(KIT, 'mask.py'), 'base.mp4', spec.file || 'mask.mkv', ...(win ? ['--windows', win] : []), ...(spec.model ? ['--model', spec.model] : []), ...(spec.person ? ['--person', spec.person] : [])];
      sh(fxPy, maskArgs, build);
      // a title behind the head stays readable: measure from the mask how much of its letters the head covers
      // (kit/cover.py); over cut.json "behindMax" (default 0.22) it moves in front, a face title to the slot above
      // the head, and the overlay is drawn again
      { const tb = R.resolveTitles(capsNow, cut).filter(t => t.layer === 'behind');
        if (tb.length) {
          let cov = []; try { cov = JSON.parse(execFileSync(fxPy, [path.join(KIT, 'cover.py'), build, JSON.stringify(tb.map(t => [t.start, Math.min(t.end, LEN)]))], { cwd: build }).toString().trim().split('\n').pop()); } catch (e) { console.warn('note: behind-the-head cover check skipped: ' + String(e.message).split('\n')[0]); }
          const max = typeof cut.behindMax === 'number' ? cut.behindMax : 0.22, capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF);
          let moved = 0;
          tb.forEach((t, k) => {
            const r = cov[k]; if (r == null) return;
            const f = (caps.flips || []).find(x => x.mode === 7 && Math.abs(x.start - t.start) < 0.005 && x.text === t.text);
            if (!f) return;
            if (r <= max) { console.log(`behind the head: "${t.text}" ${Math.round(r * 100)}% covered, stays behind`); return; }
            const wasFace = f.place === 'face';
            f.layer = 'front'; if (wasFace) f.place = 'above'; moved++;
            console.log(`behind the head: "${t.text}" ${Math.round(r * 100)}% covered (over ${Math.round(max * 100)}%), moved in front${wasFace ? ', above the head' : ''}`);
          });
          if (moved) { fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n'); sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build); }
        } }
      if (panels.length && cut.panels) {
        sh(fxPy, [path.join(KIT, 'headmask.py'), spec.file || 'mask.mkv', 'maskhead.mkv'], build);
        if (cut.headMask !== 'maskhead.mkv') { cut.headMask = 'maskhead.mkv'; fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1)); }
      }
    }
  }
}
let v = 1; while (fs.existsSync(path.join(job, `reel-v${v}.mp4`))) v++;
const out = path.join(job, `reel-v${v}.mp4`);
sh(process.execPath, [path.join(KIT, 'assemble.cjs'), out], build, (flag('no-sfx') || opt('sfx') === 'off') ? { NOSFX: '1' } : {});
// is every caption word readable against what's behind it (kit/legibility.py)? Under 3:1 the moment gets a dense
// tight halo (captions.js "boost", kit/overlay.html shadow) and the reel is drawn and assembled once more, then measured
// again. Printed, not blocking
{ const py = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const legib = () => { const jf = path.join(build, 'legibility.json'); try { execFileSync(py, [path.join(KIT, 'legibility.py'), build, out, '--json', jf], { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } }); return []; } catch { try { return JSON.parse(fs.readFileSync(jf, 'utf8')).spans || []; } catch { return []; } } };
  if (cut.overlay && fs.existsSync(py)) {
    let spans = legib();
    const capF = path.join(build, 'captions.js');
    if (spans.length && !flag('no-boost') && fs.existsSync(capF)) {
      const caps = R.readCaptions(capF), have = caps.boost || [];
      const add = spans.map(([a, b]) => [+Math.max(0, a - 0.3).toFixed(2), +Math.min(LEN, b + 0.3).toFixed(2)]).filter(([a, b]) => !have.some(h => h[0] <= a && h[1] >= b));
      if (add.length) {
        caps.boost = have.concat(add).sort((x, y) => x[0] - y[0]);
        fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
        console.log(`legibility: denser halo on ${add.length} low-contrast moment${add.length > 1 ? 's' : ''} (${add.map(x => x.join('-')).join(', ')} s), drawing again`);
        sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build);
        sh(process.execPath, [path.join(KIT, 'assemble.cjs'), out], build, (flag('no-sfx') || opt('sfx') === 'off') ? { NOSFX: '1' } : {});
        spans = legib();
      }
    }
    if (spans.length) console.warn('note: some caption moments read under 3:1 against the picture (listed above). Move the word, change its colour or pick another shot.');
  } }
let exported = null;
if (cut.export && X.get(cut.export)) {
  exported = X.outName(out, cut.export);
  if (LEN > X.get(cut.export).maxSec) console.warn(`note: the reel is ${LEN.toFixed(1)} s, longer than ${X.get(cut.export).label} allows (${X.get(cut.export).maxSec} s); the export is trimmed`);
  execFileSync('ffmpeg', X.ffmpegArgs(cut.export, out, exported, LEN), { stdio: 'inherit' });
  console.log(`export ${cut.export}: ${exported}`);
}
let LAY = null; try { LAY = JSON.parse(fs.readFileSync(path.join(build, 'layout.json'), 'utf8')); } catch {}
const lay = LAY ? { moved: LAY.elements.filter(e => e.action === 'shift').length, hidden: LAY.elements.filter(e => e.action === 'hide').length, safeArea: LAY.elements.filter(e => e.action === 'safe-area').length } : null;
console.log(`\nReel: ${out}${exported ? '\nExport: ' + exported : ''}\nCheck it: npm run verify -- ${name}${cut.export ? ' --export ' + cut.export : ''} (contact sheet, ffprobe, loudness, mask, overlap${cut.export ? ', safe area' : ''}), watch it, read clips/clips.md for skipped retakes, then edit build/captions.js or build/cut.json and run: npm run reel -- --rebuild --name ${name}`);
try { require('./star.cjs').maybePrompt({ json: JSON_OUT }); } catch {}
if (JSON_OUT) console.log(JSON.stringify({ ok: true, job: name, dir: job, reel: out, export: exported, exportPreset: cut.export || null, seconds: +LEN.toFixed(2), layout: lay, verify: `npm run verify -- ${name}${cut.export ? ' --export ' + cut.export : ''} --json` }));
