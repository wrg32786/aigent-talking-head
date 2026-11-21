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
//          --mask birefnet-portrait|birefnet-general|birefnet-lite|mediapipe (person-mask backend; default birefnet-portrait,
//          the second of BiRefNet's three tiers, keyframed and cached, kit/mask.py; mediapipe is the fast preview)
//          --no-face-safe (keep the face check but do not move text off the face)  --no-face-zone (skip face detection)
//          --draft (stop after captions.js so you can edit it)  --rebuild (re-render + re-assemble an edited job)
//          --broll <folder> (cutaways from your own clips, voice running on)  --bed <name from npm run music> or --bed music.wav  --bed-start 0  --logo logo.svg  --jobs <dir> (default jobs/)  --force
//          --sfx off  (skip locked-set sounds on this draft; also used by npm run fx)
//          --beat-sync / --no-beat-sync  (default on when a bed is set: snap punches, SFX, titles and fx hits to the bed)
//          --finish grain[,vignette,...]  optional film look (grain, vignette, chroma, scan-lines, warm, cool, teal, crushed, mono, bleach)
//          --preset <name>|auto  apply a brand style (npm run preset -- --list). Flags you pass win over the preset.
//          --pack <name|path>  apply a style pack (packs/, npm run pack; docs/packs.md): its base preset, style keys and
//            locks. Use --pack or --preset, not both. Flags you pass still win over the pack's style.
//          --lock "transitions=whip,zoom; titles=typewriter; no-graphics=checklist"  pin choices: the auto-picker only
//            chooses inside them (kit/locks.cjs lists the keys). Adds to a pack's locks, key by key. Works on --rebuild too.
//          Every draft writes jobs/<name>/choices.json and prints each pick per beat with its reason; edit it and run
//            npm run choices -- <name> --apply, then --rebuild (kit/choices.cjs).
//          --title-layer front|behind|auto  job default for whether titles sit in front or behind the head (default front)
//          --recipe Reel.md  make it from a Reel.md recipe (docs/reel-md.md): brand kit, music, style, per-shot finishes and
//            punches, title entrances and layers in order. Flags win over the recipe; the recipe wins over the preset it names.
//            --recipe-titles also uses the recipe's title text and times instead of titles drafted from your words, only
//            where you say that text (kit/spoken.cjs); recipe stickers and labels show only words you say.
//            --capture-sources captures the recipe's confirmed screen-card sources (public pages) first, see kit/capture.mjs.
//          --scenes id,id  place these scenes from the library (kit/scenes.cjs; effects and graphics made from a reference
//            or by your agent) once each, spread over the reel. Recipe graphics of type scene play from its scenes.json.
//          --scenes-off id,id  leave these scenes out, the recipe's own too (forbidden on the Look step).
//          --clip <file>  the video to use (same as passing the path; reads well with --recipe)
//            A recipe's graphics (ordinal stickers, app labels, screen cards) land at the recipe's times; icon and src
//            paths are relative to the recipe, and anything left out is drawn as a neutral placeholder.
//          --caption-position top|middle|bottom  --caption-color #rrggbb  where the captions sit and their colour
//          --caption-outline none|thin|thick  --caption-shadow none|soft  --caption-case upper|lower|as-said  the one-word look
//          --caption-layer front|behind|auto  captions under the person where they overlap the head (auto = behind at the top)
//          --panel-layer front|behind|auto  screen cards behind the head where it reaches into them (auto = behind)
//          --tighten <s> / --no-tighten  no dead air: cut every pause inside a line longer than <s> seconds to a jump,
//            measured on the audio (kit/cutpoints.cjs: at least 0.12 s of breath kept, never mid-word; each jump gets the
//            punch toggle). On at 0.3 in the magazine preset.
//          --music-energy low|mid|high|auto  pick a library bed by energy (auto reads your pace); --bed still wins
//          --no-bed  no music bed, even when the pack, preset or recipe names one
//          --cards auto|off  colour cards on short lines to land and numbered chapter cards on a list (kit/cards.cjs),
//            plus the number-pop intro on a list. Auto in the magazine preset.
//          --no-sfx-cap  turn off the sound density cap (on by default: kit/sfx-map.cjs)
//          --sfx-map / --no-sfx-map  sounds mapped to the moves (kit/sfx-map.cjs), on or off whatever the preset says
//          --aliases "Gwyn: Guinn, Gwin; aigent: agent"  names Whisper mishears, written your way in captions and titles
//            (adds to a recipe's ## Aliases)
//          --glossary <words.json | "chat GBT = ChatGPT; school = Skool after on, in">  brand words fixed in clips.json,
//            captions and titles every draft, on top of kit/glossary.json and the pack's "glossary" (kit/glossary.cjs);
//            a word with its own casing ("AIgent") keeps it under a caps display face. Repeatable.
//          --brands <brands.json>  a logo plate when a word is said ([{ "word": "Skool", "logo": "skool.svg" }],
//            kit/brands.cjs), on top of the pack's "brands". Only marks you have the right to use.
//          --as-is  the files are already cut: one clip per file, in the order given (clip.py --whole). Without it,
//            several files that each start and end on speech are used whole too, and files with a clips.json beside
//            them (a clip.py folder) are reused as they are.
//          --words <words.json>  word times you already have ({ "<file name>": [[start, end, word]] }, Studio's
//            transcript): clip.py uses them instead of running Whisper again (one transcript per take)
//          --order auto|files|script  several files: takes of one script (best take per sentence) or different clips
//            (the order given); auto decides from how many sentences the files share
//          --keep-pauses "clip-003@2.72,clip-005@1.1"  with --tighten, leave these pauses (clip id @ clip seconds, as
//            listed in choices.json "pauses") uncut
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
const K = require('./packs.cjs');
const L = require('./locks.cjs');
const CH = require('./choices.cjs');
const RM = require('./reelmd.cjs');
const S = require('./spoken.cjs');
const CARDS = require('./cards.cjs');
const SFXMAP = require('./sfx-map.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['words', 'scenes', 'scenes-off', 'pack', 'lock', 'aliases', 'export', 'caption-position', 'caption-color', 'caption-outline', 'caption-shadow', 'caption-case', 'caption-layer', 'panel-layer', 'caption-entrance', 'recipe', 'clip', 'theme', 'cropx', 'model', 'name', 'clips', 'bed', 'logo', 'jobs', 'hook', 'style', 'look', 'fonts', 'sfx', 'bed-start', 'mask', 'broll', 'finish', 'preset', 'title-layer', 'tighten', 'music-energy', 'cards', 'cleanup', 'glossary', 'brands', 'order', 'keep-pauses']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const sh = (cmd, args, cwd, env) => { console.log('>', path.basename(cmd), args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')); execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } }); };
const JSON_OUT = flag('json');
const die = m => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: m })); console.error(m); process.exit(1); };
const X = require('./exports.cjs');
const EXPORT = opt('export') ? String(opt('export')).toLowerCase() : null;
if (EXPORT && !X.get(EXPORT)) die('--export must be ' + X.NAMES.join(', '));
const VIDEO = /\.(mov|mp4|m4v|mkv|webm|avi)$/i;
// the kit's Python: PYTHON, else the kit's .venv (where the installer put Whisper, yt-dlp and the rest), else the system one
const PY = process.env.PYTHON || [path.join(ROOT, '.venv', 'Scripts', 'python.exe'), path.join(ROOT, '.venv', 'bin', 'python')].find(f => fs.existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
const GL = require('./glossary.cjs');
const BR = require('./brands.cjs');
const CP = require('./cutpoints.cjs');
const SFXPLAN = require('./sfx-plan.cjs');
const many = k => argv.flatMap((a, i) => (a === '--' + k && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []));

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
// --pack: a style pack is a preset plus locks (kit/packs.cjs). --lock adds to its locks, key by key.
const packArg = opt('pack');
let pack = null;
if (packArg) {
  if (presetArg) die('Use --pack or --preset, not both (a pack names its base preset in "extends").');
  pack = K.load(packArg);
  if (!pack) die('Unknown pack "' + packArg + '". See npm run pack');
  const kerrs = K.validate({ ...pack, preview: undefined });
  if (kerrs.length) die('Invalid pack "' + packArg + '": ' + kerrs.join('; '));
  preset = K.toPreset(pack);
  console.log(`pack: ${pack.name} v${pack.version} - ${pack.label}`);
}
const lockArgs = opt('lock') ? argv.flatMap((a, i) => (a === '--lock' && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : [])) : [];
let LOCKS = {};
try { LOCKS = L.merge(pack && pack.locks, ...lockArgs.map(L.parse)); } catch (e) { die('--lock: ' + e.message); }
{ const lerrs = L.validate(LOCKS); if (lerrs.length) die('locks: ' + lerrs.join('; ')); }
if (!L.isEmpty(LOCKS)) console.log('locks: ' + L.describe(LOCKS));
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
// the glossary and brand logos: the kit's list, the pack's or preset's, then --glossary / --brands (later ones win)
let GLOSS = [], BRANDS = [];
try { GLOSS = GL.merge(GL.shipped(), GL.parse(preset && preset.glossary), ...many('glossary').map(v => GL.read(v))); } catch (e) { die('--glossary: ' + e.message); }
try { BRANDS = [...BR.parse(preset && preset.brands, (pack && pack.dir) || ROOT), ...many('brands').flatMap(v => /^\s*\[/.test(v) ? BR.parse(JSON.parse(v)) : BR.read(v))]; } catch (e) { die('--brands: ' + e.message); }
{ const bad = BRANDS.filter(b => !fs.existsSync(b.logo) || !BR.IMG.test(b.logo)); if (bad.length) die('brands: logo file missing or not an image: ' + bad.map(b => b.logo).join(', ')); }
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

// files that clip.py already cut (a clips.json beside them lists them): copy them into the job's clips/ as they are,
// in the order given, instead of cutting them again (a second cut shaves first words)
function reusePrecut(files, dir) {
  const found = [];
  for (const f of files) {
    const cj = path.join(path.dirname(path.resolve(f)), 'clips.json');
    let c = null; try { c = (JSON.parse(fs.readFileSync(cj, 'utf8')).clips || []).find(x => path.basename(x.file) === path.basename(f) && Array.isArray(x.words)); } catch {}
    if (!c) return false;
    found.push([f, c]);
  }
  if (!found.length || path.resolve(dir) === path.dirname(path.resolve(files[0]))) return false;
  fs.mkdirSync(dir, { recursive: true });
  const used = new Set(), out = found.map(([f, c], i) => {
    let name = path.basename(f); if (used.has(name)) name = `${i + 1}-${name}`; used.add(name);
    fs.copyFileSync(path.resolve(f), path.join(dir, name));
    return { ...c, id: `clip-${String(i + 1).padStart(3, '0')}`, file: `${path.basename(dir)}/${name}`, take: c.take || path.basename(f), status: 'keep', from: path.resolve(f) };
  });
  fs.writeFileSync(path.join(dir, 'clips.json'), JSON.stringify({ src: files.map(f => path.resolve(f)), takes: files.map(f => path.basename(f)), order: 'files', precut: true, clips: out }, null, 1));
  return true;
}
if (!flag('rebuild')) {
  // 1. clips
  let clipsDir = clipsArg ? path.resolve(clipsArg) : path.join(job, 'clips');
  if (!clipsArg) {
    for (const f of srcs) if (!fs.existsSync(f)) die('Not found: ' + f);
    // a clips.json still marked pending is from a clip.py run that did not finish: never reuse it
    const cjOld = path.join(clipsDir, 'clips.json'), pendingOld = fs.existsSync(cjOld) && (() => { try { return !!JSON.parse(fs.readFileSync(cjOld, 'utf8')).pending; } catch { return true; } })();
    if (fs.existsSync(cjOld) && !pendingOld && !flag('force')) console.log('clips/ already exists, reusing it (pass --force to re-clip)');
    else if (reusePrecut(srcs, clipsDir)) console.log(`clips: ${srcs.length} file${srcs.length === 1 ? '' : 's'} already cut by clip.py (clips.json beside them), used as they are, in the order given`);
    else sh(PY, [path.join(KIT, 'clip.py'), ...srcs.map(f => path.resolve(f)), '--out', clipsDir, '--vertical', '--cropx', opt('cropx', '0.5'), ...(opt('model') ? ['--model', opt('model')] : []), ...(opt('hook') ? ['--hook', opt('hook')] : []), ...(opt('words') ? ['--words', path.resolve(opt('words'))] : []), ...(flag('as-is') ? ['--whole'] : []), ...(opt('order') ? ['--order', opt('order')] : [])], job);
  }
  const cjPath = path.join(clipsDir, 'clips.json'), cjAll = JSON.parse(fs.readFileSync(cjPath, 'utf8'));
  if (cjAll.pending) die(`${cjPath} is from a clip.py run that did not finish. Run it again (or pass --force).`);
  // brand words the way you write them, in clips.json too (the Studio clips view and the captions both read it)
  { const gn = GL.applyClips(cjAll, GLOSS); if (gn) { fs.writeFileSync(cjPath, JSON.stringify(cjAll, null, 1)); console.log(`glossary: ${gn} clip${gn === 1 ? '' : 's'} in the words you mean (${GLOSS.length} entries)`); } }
  const clips = cjAll.clips;
  // --cleanup <file>: the clean-up pass from Studio (kit/studio/review.mjs): spans to cut out of a clip (clip seconds,
  // they become jump cuts like --tighten), retakes to keep after all, and clips to leave out
  let CLEAN = null;
  if (opt('cleanup')) { try { CLEAN = JSON.parse(fs.readFileSync(path.resolve(opt('cleanup')), 'utf8')); } catch (e) { die('--cleanup: ' + e.message); } }
  const inList = (k, c) => !!(CLEAN && Array.isArray(CLEAN[k]) && CLEAN[k].includes(c.id));
  let keep = clips.filter(c => inList('keep', c) || (!inList('drop', c) && !/^(retake|fragment)/.test(c.status)));
  // fragments (under 1 s on their own, or ending on a cut-off word) stay out while there is anything else to use
  if (!keep.length) keep = clips.filter(c => inList('keep', c) || (!inList('drop', c) && !/^retake/.test(c.status)));
  else { const fr = clips.filter(c => /^fragment/.test(c.status) && !inList('keep', c)); if (fr.length) console.log(`fragments left out: ${fr.map(c => `${c.id} "${String(c.text).slice(0, 30)}"`).join(', ')} (keep one with the clean-up pass)`); }
  if (!keep.length) die('No keep clips in ' + clipsDir);
  // 2. cut.json from every keep clip, in order; a glitch hit and a woosh on each seam
  const rel = p => path.relative(build, path.isAbsolute(p) ? p : path.join(path.dirname(clipsDir), p)).split(path.sep).join('/');
  // no dead air (--tighten <s>, or the preset's "tighten"): a pause inside a line longer than that cuts to a jump. The
  // pause is measured on the clip's audio, not the word times (kit/cutpoints.cjs, the cut-point module every path
  // uses): the cut goes 180 ms after the last sound (an s or th tail counts as sound) and the clip resumes 110 ms before
  // the next one, so a word is never clipped and at least 120 ms of breath stays. A pause where less than 0.2 s would
  // go stays. Every cut pause is listed in cut.json "tightened" and choices.json "pauses";
  // --keep-pauses clip-003@2.72 (or the clean-up plan's "keepPauses") leaves one uncut.
  const TIGHT = flag('no-tighten') ? false : opt('tighten') != null ? +opt('tighten') : (preset && preset.tighten != null ? preset.tighten : false);
  if (TIGHT !== false && !(TIGHT >= 0.15 && TIGHT <= 2)) die('--tighten must be the longest pause to keep, 0.15 to 2 seconds');
  const KEEPP = {};
  for (const x of [...String(opt('keep-pauses') || '').split(','), ...Object.entries((CLEAN && CLEAN.keepPauses) || {}).flatMap(([id, ts]) => [].concat(ts).map(t => `${id}@${t}`))]) { const m = /^\s*([\w-]+)@([\d.]+)\s*$/.exec(x); if (m) (KEEPP[m[1]] = KEEPP[m[1]] || []).push(+m[2]); }
  const TIGHTENED = [], SPANS = new Map();
  const spansOf0 = c => {
    const dur = +(+c.dur).toFixed(3), ws = (c.words || []).filter(w => w[1] > w[0]);
    if (!TIGHT || ws.length < 2) return [[0, dur]];
    if (SPANS.has(c.id)) return SPANS.get(c.id);
    const env = CP.envelopeSync(path.join(clipsDir, path.basename(c.file)));
    if (!env) { console.log(`no dead air: ${c.id} has no readable audio, its pauses stay`); SPANS.set(c.id, [[0, dur]]); return [[0, dur]]; }
    const keepIt = (at, i, L, N) => (KEEPP[c.id] || []).some(t => Math.abs(t - at) < 0.15 || (t >= L[1] - 0.05 && t <= N[0]));
    const r = CP.tightenSpans(ws, env, TIGHT, { range: [0, dur], dur, keep: keepIt });
    for (const x of r.cuts) if (!TIGHTENED.some(y => y.clip === c.id && y.at === x.at)) TIGHTENED.push({ clip: c.id, at: x.at, resume: x.resume, gap: x.gap, after: x.after, ...(x.noise ? { noise: x.noise } : {}) });
    SPANS.set(c.id, r.spans); return r.spans;
  };
  // cuts by hand (kit/manual-cuts.cjs, the cut_range tool): source seconds in jobs/<job>/manual-cuts.json, so they
  // survive a redraft that re-cuts the clips
  const MC = require('./manual-cuts.cjs'), MANUAL = MC.read(job);
  if (MANUAL.length) console.log(`cuts by hand: ${MANUAL.length} (${path.relative(ROOT, MC.fileOf(job))})`);
  const cutsOf = c => [...(CLEAN && CLEAN.cuts && Array.isArray(CLEAN.cuts[c.id]) ? CLEAN.cuts[c.id] : []), ...MC.forClip(MANUAL, c)].filter(x => Array.isArray(x) && +x[1] > +x[0]);
  const spansOf = c => {
    let out = spansOf0(c);
    for (const [a, b] of cutsOf(c)) out = out.flatMap(([x, y]) => +b <= x || +a >= y ? [[x, y]] : [[x, +a], [+b, y]].filter(([p, q]) => q - p > 0.05));
    return out.map(([x, y]) => [+(+x).toFixed(3), +(+y).toFixed(3)]);
  };
  if (CLEAN) {
    const before = keep.reduce((a, c) => a + +c.dur, 0);
    keep = keep.filter(c => spansOf(c).length);
    if (!keep.length) die('--cleanup removes every clip');
    const after = keep.reduce((a, c) => a + spansOf(c).reduce((x, [p, q]) => x + q - p, 0), 0), n = keep.reduce((a, c) => a + cutsOf(c).length, 0);
    console.log(`clean-up: ${n} cut${n === 1 ? '' : 's'} inside clips, ${(CLEAN.keep || []).length} retake${(CLEAN.keep || []).length === 1 ? '' : 's'} kept, ${(CLEAN.drop || []).length} clip${(CLEAN.drop || []).length === 1 ? '' : 's'} left out (${(before - after).toFixed(1)} s shorter before pauses)`);
  }
  const segs = [], clipStart = [], segClip = [];
  keep.forEach((c, ci) => { clipStart.push(segs.length); spansOf(c).forEach(([a, b], k) => segClip.push(c) && segs.push({ file: rel(path.join(clipsDir, path.basename(c.file))), in: a, out: b, ...(k ? { jump: true } : {}), ...(ci === 0 && k === 0 ? { fadeIn: 0.25 } : {}) })); });
  if (TIGHT) { const was = keep.reduce((a, c) => a + +c.dur, 0), now = segs.reduce((a, s) => a + s.out - s.in, 0), n = segs.filter(s => s.jump).length; console.log(`no dead air: ${n} pause${n === 1 ? '' : 's'} over ${TIGHT} s cut to jumps (${(was - now).toFixed(1)} s shorter)${TIGHTENED.some(x => x.noise) ? `, ${TIGHTENED.filter(x => x.noise).length} with a short noise inside it cut too` : ''}`); }
  // big punch on the cut after the hook and the cut into the payoff (with 3+ clips); a jump inside a line keeps the toggle
  const wantPunch = flag('no-punch') ? false : (preset && preset.punch === false ? false : true);
  if (wantPunch && keep.length >= 3) { segs[clipStart[1]].bigPunch = true; segs[clipStart[keep.length - 1]].bigPunch = true; }
  // --recut (Studio's Recreate): your edit re-cut to the recipe's shot plan, on word boundaries, with the reference's
  // framing per shot (kit/shotplan.cjs). The recipe's per-shot settings then go to these shots, not to your clips.
  let RECUT = null, REFSHAKES = [];
  if (flag('recut') && recipe && recipe.shots.length >= 2) {
    const SPL = require('./shotplan.cjs'), envs = new Map();
    const envOf = i => { const f = path.join(clipsDir, path.basename(segClip[i].file)); if (!envs.has(f)) envs.set(f, CP.envelopeSync(f)); return envs.get(f); };
    const quiet = (i, a, b) => { const e = envOf(i); return e ? SPL.quietFrom(CP, e)(a, b) : null; };
    const plan0 = RM.shotSettings(recipe);
    if (keep.length >= 3) segs.forEach(x => { delete x.bigPunch; });
    RECUT = SPL.recut(segs, i => segClip[i].words || [], plan0, quiet);
    segs.splice(0, segs.length, ...RECUT.segs);
    console.log(`recut: ${RECUT.plan.length} shots from the recipe's ${plan0.length} (scaled to ${segs.reduce((a, x) => a + x.out - x.in, 0).toFixed(1)} s), cuts at ${RECUT.cuts.map(c => c.t + ' s (' + c.on + ')').join(', ') || 'none'}${RECUT.skipped.length ? `; no quiet near ${RECUT.skipped.map(x => x.at + ' s').join(', ')}, those shots play as one` : ''}`);
  }
  let t = 0; const seams = [], jumpSeams = new Set();
  segs.forEach((s, i) => { if (i) { seams.push(+t.toFixed(3)); if (s.jump || s.recut) jumpSeams.add(+t.toFixed(3)); } t += s.out - s.in; });
  // sound, fewer and deeper: a whoosh on the big-punch cuts (or the first cut), the boom (loudest) into the payoff;
  // every seam keeps its glitch hit, but not a sound
  const big = segs.map((s, i) => (s.bigPunch ? i : -1)).filter(i => i > 0).map(i => seams[i - 1]);
  const sfx = {};
  if (seams.length) {
    const clipSeams = seams.filter(x => !jumpSeams.has(x)), last = clipSeams.length ? clipSeams[clipSeams.length - 1] : seams[seams.length - 1], wh = (big.length ? big : [clipSeams[0] ?? seams[0]]).filter(x => x !== last || seams.length === 1);
    if (wh.length) sfx.whoosh = wh;
    if (clipSeams.length >= 2) sfx.boom = [[last, 0.55]];
  }
  if (TIGHTENED.length) for (const x of TIGHTENED) console.log(`pause cut: ${x.clip} ${x.at}-${x.resume} s (a ${x.gap} s pause after "${x.after}"; keep it with --keep-pauses ${x.clip}@${x.at})`);
  const cut = { note: `Drafted by kit/reel.cjs from ${keep.length} keep clips (${clips.length - keep.length} retakes skipped). Edit, then: npm run reel -- --rebuild --name ${name}`, segs, tail: 0.3, punch: wantPunch ? (typeof (preset && preset.punch) === 'number' ? preset.punch : 0.1) : false, hits: [[0.02, 14], ...seams.filter(s => !jumpSeams.has(s)).map(s => [s, 24])], sfx, overlay: 'ovl/%04d.png', ...(TIGHTENED.length ? { tightened: TIGHTENED } : {}) };
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
  // --no-bed: no music at all, even when the pack or preset names one (Studio's "No music")
  let bed = flag('no-bed') ? undefined : opt('bed') || (preset && preset.bed) || undefined, energyBed = false;
  const energyArg = flag('no-bed') ? undefined : opt('music-energy') || (preset && preset.musicEnergy) || (bed === 'auto' ? 'auto' : undefined);
  if (energyArg && !['auto', ...R.ENERGIES].includes(String(energyArg))) die('--music-energy must be low, mid, high or auto');
  if (!opt('bed') && energyArg && (bed === 'auto' || !bed || opt('music-energy'))) {
    const words = []; let off = 0; for (const c of keep) { for (const w of c.words || []) words.push([w[0] + off, w[1] + off]); off += +c.dur; }
    const e = energyArg === 'auto' ? R.scriptEnergy(words) : energyArg; bed = R.pickBed(e, name) || undefined; energyBed = true;
    console.log(`music: ${e} energy${energyArg === 'auto' ? ' (from your pace)' : ''} -> bed ${bed || 'none'} (npm run music lists them by energy)`);
  } else if (bed === 'auto') bed = undefined;
  if (bed) Object.assign(cut, { bed: require('./rules.cjs').isBed(bed) ? bed : path.resolve(bed), bedVol: 0.16, ...(opt('bed-start') != null ? { bedStart: +opt('bed-start') } : {}) });
  // sound mapped to the moves and the density cap (kit/sfx-map.cjs)
  if ((preset && preset.sfxMap) || flag('sfx-map')) cut.sfxMap = true;
  if (flag('no-sfx-map')) cut.sfxMap = false;
  if (preset && preset.sfxCap !== undefined) cut.sfxCap = preset.sfxCap;
  if (flag('no-sfx-cap')) cut.sfxCap = false;
  if (flag('no-beat-sync')) cut.beatSync = false;
  else if (flag('beat-sync') || bed) cut.beatSync = true;
  if (recipe) {
    const plan = RM.shotSettings(recipe), SPLM = require('./shotplan.cjs'), shakeAt = [];
    // per-shot settings go to each clip (its first segment, or every segment for a finish, when pauses were tightened)
    if (RECUT) {
      RECUT.shotStart.forEach((k, j) => { const p = plan[RECUT.shotOf[j]] || {}, sg = segs[k], subs = segs.slice(k, RECUT.shotStart[j + 1] ?? segs.length); if (p.finish) subs.forEach(x => { x.finish = p.finish; }); if (p.bigPunch && wantPunch) sg.bigPunch = true; if (p.transition && j) sg.transition = p.transition; if (p.move && !sg.bigPunch) sg.push = SPLM.MOVES[p.move]; if (p.shake && j) shakeAt.push(k); });
      cut.refShots = RECUT.plan;
      // the reference's sound effects, scaled to your edit, as the kit's sounds (the cap still thins them)
      const len = segs.reduce((a, x) => a + x.out - x.in, 0), R0 = +(recipe.card.source && recipe.card.source.duration) || recipe.shots[recipe.shots.length - 1].end || len, k = len / R0;
      const hits = (recipe.sfx || []).map(x => ({ id: x.sound || require('./shotplan.cjs').sfxId(x.type), t: +(x.start * k).toFixed(3), ref: true })).filter(h => h.t < len - 0.1 && SFXPLAN.lookup(h.id));
      if (hits.length) { cut.sfx = {}; cut.sfxHits = (cut.sfxHits || []).concat(hits); console.log(`recut: ${hits.length} sound effects from the reference at its times, scaled (${hits.map(h => h.id + '@' + h.t).join(', ')})`); }
    } else plan.forEach((p, i) => { const k = clipStart[i]; if (k == null) return; const sg = segs[k], subs = segs.slice(k, clipStart[i + 1] ?? segs.length); if (p.finish) subs.forEach(x => { x.finish = p.finish; }); if (p.bigPunch && wantPunch) sg.bigPunch = true; if (p.transition && i) sg.transition = p.transition; if (p.move && !sg.bigPunch) sg.push = SPLM.MOVES[p.move]; if (p.shake && i) shakeAt.push(k); });
    // the reference's handheld or shaking shots: a shake on the cut in, just after the seam (the voice runs on across it)
    if (shakeAt.length) { const at = k => segs.slice(0, k).reduce((a, x) => a + x.out - x.in, 0);
      REFSHAKES = shakeAt.map(k => [+(at(k) + 0.08).toFixed(3), 18]); }
    if (!RECUT && plan.length !== keep.length) console.log(`recipe: ${plan.length} shots in the recipe, ${keep.length} clips from your takes; per-shot settings applied to the first ${Math.min(plan.length, keep.length)}`);
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
  // the reference's handheld or shaking shots: a shake on the cut in, just after the seam (kept with glitch off: the
  // reference shook there)
  if (REFSHAKES.length) { const hits = cut.hits || (cut.hits = []), added = [];
    for (const h of REFSHAKES) if (!hits.some(([x]) => Math.abs(x - h[0]) < 0.2)) { hits.push(h); added.push(h[0]); }
    hits.sort((a, z) => a[0] - z[0]); if (added.length) console.log(`recipe: a shake at ${added.join(', ')} s (the reference's handheld shots)`); }
  if (opt('title-layer')) {
    const layer = String(opt('title-layer')).toLowerCase();
    if (!R.TITLE_LAYERS.includes(layer)) die('--title-layer must be front, behind or auto');
    cut.titleLayer = layer;
  }
  // the pack and its locks: what the style asked for (choices.json explains each pick from it), then the locks win
  if (pack) { cut.pack = pack.name; if (pack.weights) cut.weights = pack.weights; }
  if (preset) cut.packStyle = { transition: preset.transition, entranceOrder: preset.entranceOrder, finishPool: preset.finishPool };
  if (!L.isEmpty(LOCKS)) for (const l of L.applyCut(LOCKS, cut, { weights: pack && pack.weights, repick: !!(pack && pack.weights && pack.weights.transitions), defaultTransition: preset && preset.transition })) console.log(l);
  if (fs.existsSync(path.join(build, 'cut.json')) && !flag('force')) die('build/cut.json exists. Use --rebuild to render your edits, or --force to redraft.');
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
  console.log(`cut.json: ${segs.length} segments, seams ${JSON.stringify(seams)}`);
  // 3. captions from the clips' word times
  const logo = opt('logo');
  if (logo) fs.copyFileSync(path.resolve(logo), path.join(build, path.basename(logo)));
  sh(process.execPath, [path.join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--force', ...(cut.hits && cut.hits.length === 0 ? ['--no-glitch'] : []), ...(TITLES ? ['--titles'] : look === 'oneword' ? [] : ['--hero']), ...(look === 'oneword' ? ['--cards'] : []), '--style', STYLE, ...(FONTS ? ['--fonts', FONTS] : []), ...(logo ? ['--logo', path.basename(logo)] : []), ...(LOCKS.titleWords ? ['--title-words', LOCKS.titleWords] : [])], build);
  // captions and titles in the words you mean: the recipe's Aliases, and numbers Whisper split at the comma ("10 ,000")
  // and the glossary (kit/glossary.cjs): brand words, with their own casing kept under a caps display face
  { const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF), n = S.meantFlips(caps.flips) + GL.applyFlips(caps.flips, GLOSS);
    const said = JSON.stringify((caps.flips || []).map(f => [f.text, f.words])), kc = GL.keepCase(GLOSS).filter(w => said.includes(w));
    if (kc.length) caps.keepCase = kc;
    if (n || kc.length) { fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n'); console.log(`captions: ${n} lines in the words you mean (aliases, glossary, split numbers)${kc.length ? '; own casing kept: ' + kc.join(', ') : ''}`); } }
  // brands (kit/brands.cjs): a logo plate when a listed word is said, about a second, never over a title
  if (BRANDS.length) {
    const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF), len = segs.reduce((a, s) => a + (s.out - s.in), 0);
    const busy = (caps.flips || []).filter(f => f.mode === 7 || f.mode === 5).map(f => [f.start, Math.min(f.end, len)]);
    const bp = BR.plan(S.timeline(segs, build), BRANDS, { busy, total: len });
    for (const [name, src] of Object.entries(bp.files)) fs.copyFileSync(src, path.join(build, name));
    if (bp.flips.length) { caps.flips = (caps.flips || []).concat(bp.flips).sort((a, b) => a.start - b.start); fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n'); }
    console.log(`brands: ${bp.flips.length ? bp.flips.map(f => `${f.brand} at ${f.start}s`).join(', ') : 'none of ' + BRANDS.map(b => b.word).join(', ') + ' said'}`);
  }
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
      const byRole = RECUT ? require('./shotplan.cjs').matchRoles(mine, rt) : null; // Recreate: by what each title does (hook, number, timer, brand)
      mine.forEach((f, i) => { const r = byRole ? byRole.get(f) : rt[i]; if (!r) return; if (r.entrance && !used.has(r.entrance)) { f.entrance = r.entrance; used.add(r.entrance); set.add(f); } if (r.layer) f.layer = r.layer; if (r.place) f.place = r.place; if (r.lockup) f.lockup = r.lockup; });
      mine.forEach(f => { if (!set.has(f) && f.entrance && used.has(f.entrance)) delete f.entrance; }); // each entrance once; the engine fills the rest
      if (RECUT) { // a timer or number slot in the reference none of your titles took: a title from your matching words there
        const len = segs.reduce((a, x) => a + x.out - x.in, 0), R0 = +(recipe.card.source && recipe.card.source.duration) || recipe.shots[recipe.shots.length - 1].end || len;
        const made = require('./shotplan.cjs').fillSlots(rt, [...byRole.values()], S.timeline(segs, build), { k: len / R0, len, taken: mine });
        if (made.length) { caps.flips = caps.flips.concat(made).sort((a, b) => a.start - b.start); console.log(`recipe title slots: ${made.map(f => `"${f.text}" (${f.role}) at ${f.start}s`).join(', ')} from your words`); }
      }
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
    // Recreate: the reference's graphics at its times scaled to your edit, like its shots and sounds
    if (RECUT && gfx.length) {
      const len = segs.reduce((a, x) => a + x.out - x.in, 0), R0 = +(recipe.card.source && recipe.card.source.duration) || recipe.shots[recipe.shots.length - 1].end || len, k = len / R0;
      if (Math.abs(k - 1) > 0.01) { for (const g of gfx) { const d = g.end - g.start; g.start = +(g.start * k).toFixed(3); g.end = +(g.start + Math.max(0.6, Math.min(d, d * k + 0.4))).toFixed(3); } console.log(`recut: ${gfx.length} graphics from the reference at its times, scaled by ${k.toFixed(2)}`); }
    }
    // scenes (kit/scenes.cjs): what the menu had no item for, made from the reference (its scenes.json, else the
    // library) or picked from the menu (--scenes). {{text}} shows a word you say then, never the reference's words.
    {
      const SC = require('./scenes.cjs'), len = segs.reduce((a, x) => a + x.out - x.in, 0), said = S.timeline(segs, build);
      let local = {}; try { if (recipe) for (const x of JSON.parse(fs.readFileSync(path.join(path.dirname(recipe.file), 'scenes.json'), 'utf8')).scenes || []) if (!SC.check(x).length) local[x.id] = x; } catch {}
      const wordAt = (a, b) => said.filter(w => w.end > a && w.start < b).map(w => String(w.word).replace(/[^\p{L}\p{N}'$%+-]/gu, '')).filter(w => w.length > 1).sort((x, y) => y.length - x.length)[0] || null;
      const fill = (g, sc) => {
        const needs = /\{\{\s*text\s*\}\}/.test(sc.html || '');
        const text = needs ? wordAt(g.start - 0.15, g.start + 1) : null;
        if (needs && !text) return `scene ${sc.name} at ${g.start}s: no word said there for its text`;
        Object.assign(g, { mode: 39, scene: sc.id, sceneName: sc.name, html: sc.html, css: sc.css || '', seconds: sc.seconds, x: sc.box.x, y: sc.box.y, w: sc.box.w, h: sc.box.h, layer: 'front', ...(text ? { text } : {}), ...(sc.loop ? { loop: true } : {}) });
        return null;
      };
      const off = new Set(String(opt('scenes-off') || '').split(',').map(x => x.trim()).filter(Boolean)); // forbidden on the Look step
      for (let i = gfx.length - 1; i >= 0; i--) { const g = gfx[i]; if (g.mode !== 39) continue; if (off.has(g.scene)) { console.log(`scene ${g.scene} at ${g.start}s: forbidden, left out`); gfx.splice(i, 1); continue; } const sc = local[g.scene] || SC.get(g.scene);
        const why = !sc ? `scene ${g.scene} at ${g.start}s: not in the recipe's scenes.json or the scene library` : fill(g, sc);
        if (why) { console.log('recipe graphic dropped: ' + why); gfx.splice(i, 1); continue; }
        // an effect lands on a cut: the nearest seam of your edit, when one is within a second
        if (sc.kind === 'effect' && seams.length) { const near = seams.reduce((b, x) => Math.abs(x - g.start) < Math.abs(b - g.start) ? x : b, seams[0]); if (Math.abs(near - g.start) <= 1) { const d = g.end - g.start; g.start = +Math.max(0, near - 0.1).toFixed(3); g.end = +(g.start + d).toFixed(3); } } }
      // picked on the Look step: each once, spread over the reel; an effect on the cut nearest its spot, a graphic on a word
      const picked = String(opt('scenes') || '').split(',').map(x => x.trim()).filter(Boolean);
      picked.forEach((id, i) => {
        if (off.has(id)) return;
        const sc = local[id] || SC.get(id); if (!sc) { console.log(`scene ${id}: not in the scene library, left out`); return; }
        if (gfx.some(g => g.scene === id)) return;
        let at = len * (i + 1) / (picked.length + 1);
        if (sc.kind === 'effect' && seams.length) at = Math.max(0, seams.reduce((b, x) => Math.abs(x - at) < Math.abs(b - at) ? x : b, seams[0]) - 0.1);
        else { const w = said.find(w => w.start >= at - 0.3); if (w) at = w.start; }
        if (at > len - 0.6) return;
        const g = { start: +at.toFixed(3), end: +Math.min(len, at + sc.seconds + 0.2).toFixed(3) }, why = fill(g, sc);
        if (why) console.log('scene left out: ' + why); else { gfx.push(g); console.log(`scene: ${sc.name} at ${g.start}s (picked)`); }
      });
      gfx.sort((a, b) => a.start - b.start);
    }
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
  // locks on the captions side: title entrances and count, caption entrance, graphics, cards (kit/locks.cjs)
  if (!L.isEmpty(LOCKS)) {
    const capF = path.join(build, 'captions.js'), caps = R.readCaptions(capF), lg = L.applyCaptions(LOCKS, caps);
    fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
    lg.forEach(l => console.log(l));
  }
  // 4. theme
  const th = path.join(KIT, 'themes', opt('theme', (preset && preset.theme) || 'aigent') + '.js');
  if (!fs.existsSync(th)) die('No theme ' + th);
  fs.copyFileSync(th, path.join(build, 'theme.js'));
  // a recipe's colours (Reel.md brand kit "colors", read from the reference's titles and captions): its accent goes on the
  // theme's hero words, stickers, number tiles and cards, unless you named a theme yourself
  if (recipe && !opt('theme') && preset && Array.isArray(preset.colors) && preset.colors.length) {
    const hex = preset.colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)), rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const lum = h => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }, sat = h => { const c = rgb(h), mx = Math.max(...c); return mx ? (mx - Math.min(...c)) / mx : 0; };
    const accent = hex.find(h => sat(h) > 0.3 && lum(h) > 0.25) || hex.find(h => lum(h) > 0.5);
    if (accent) { fs.appendFileSync(path.join(build, 'theme.js'), `\n// the reference's accent (Reel.md brand kit colors), set by kit/reel.cjs\nwindow.THEME.colors.accent = '${accent.toLowerCase()}';\n`); console.log(`theme: ${path.basename(th, '.js')}, accent ${accent.toLowerCase()} from the reference`); }
  }
  // what was picked, per beat, and why: jobs/<name>/choices.json to edit (kit/choices.cjs)
  try {
    const x = CH.explain(build);
    fs.writeFileSync(path.join(job, 'choices.json'), JSON.stringify(x, null, 1) + '\n');
    console.log('\n' + CH.printTable(x) + `\nChange any pick: edit jobs/${name}/choices.json, then npm run choices -- ${name} --apply (or pin one: --lock). docs/packs.md`);
  } catch (e) { console.warn('note: could not write choices.json: ' + e.message); }
  if (flag('draft')) { console.log(`\nDraft ready. Edit ${build}/captions.js (and cut.json), then: npm run reel -- --rebuild --name ${name}`); process.exit(0); }
}

// --lock on --rebuild: pin choices on the edited job before it renders
if (flag('rebuild') && !L.isEmpty(LOCKS)) { try { CH.lockJob(build, LOCKS).forEach(l => console.log(l)); } catch (e) { die('--lock: ' + e.message); } }
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
// base.mp4 (the graded picture alone, BASEONLY) is made once per picture: the face zone and the person mask both read it,
// and a rebuild that only changes captions, titles, sounds or layers reuses it (base.sig: the cut without those keys)
const LAYER_KEYS = new Set(['overlay', 'titles', 'mask', 'maskModel', 'person', 'panels', 'headMask', 'sfx', 'sfxHits', 'sfxMap', 'sfxCap', 'bed', 'bedStart', 'bedVol', 'bedNoFade', 'bedFadeOut', 'export', 'behindMax', 'maskClear']);
const baseSig = () => { const c = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8')); const pic = Object.fromEntries(Object.entries(c).filter(([k]) => !LAYER_KEYS.has(k)));
  const files = [...new Set([...(c.segs || []), ...(c.inserts || [])].map(s => s.file).filter(Boolean))].map(f => { try { const st = fs.statSync(path.resolve(build, f)); return [f, st.size, Math.round(st.mtimeMs)]; } catch { return [f]; } });
  return require('crypto').createHash('sha1').update(JSON.stringify([pic, files])).digest('hex'); };
const ensureBase = () => { const bf = path.join(build, 'base.mp4'), sf = path.join(build, 'base.sig'), sig = baseSig();
  if (fs.existsSync(bf) && fs.existsSync(sf) && fs.readFileSync(sf, 'utf8') === sig) { console.log('base.mp4: picture unchanged, reused'); return; }
  sh(process.execPath, [path.join(KIT, 'assemble.cjs'), 'base.mp4'], build, { BASEONLY: '1' }); fs.writeFileSync(sf, sig); };
// split and framed b-roll (kit/split.cjs) move your picture for their spans, so the face zone moves with it there and
// the captions keep clear of where your face is on screen; they also need the person mask over those spans to put the
// top of your head over the panel (on by default, --no-mask keeps the head under the panel)
const SPL = require('./split.cjs');
const splitIns = () => (cut.inserts || []).filter(s => SPL.SPLIT.includes(s.place) && +s.dur > 0);
const fxReady = () => fs.existsSync(path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
function splitZones(fz) {
  const ins = splitIns(); if (!ins.length) return fz.zones;
  const mask = !flag('no-mask') && fxReady(), zones = fz.zones.slice();
  for (const s of ins) {
    const g = SPL.layout(s, SPL.faceOver(fz, +s.at, +s.dur), { mask });
    for (let i = Math.max(0, Math.floor(+s.at * fz.fps)); i < Math.min(zones.length, Math.ceil((+s.at + +s.dur) * fz.fps)); i++) zones[i] = SPL.mapZone(zones[i], g);
  }
  return zones;
}
if (splitIns().length && !cut.mask && !flag('no-mask') && fxReady()) { cut.mask = 'mask.mkv'; fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1)); }
// face keep-out (Will, 2026-11-19): find the face in every moment of the picture (kit/facezone.py, YuNet, cached) and hand
// the zone to the layout pass, so no caption, title or kinetic word lands on the eyes, nose, mouth or chin. --no-face-safe
// keeps the zone for the check (facecheck.json) but does not move anything.
{ const capF = path.join(build, 'captions.js');
  if (fs.existsSync(capF) && !flag('no-face-zone')) {
    const fxPyF = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    try {
      ensureBase();
      execFileSync(fs.existsSync(fxPyF) ? fxPyF : PY, [path.join(KIT, 'facezone.py'), 'base.mp4', 'facezone.json'], { cwd: build, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
      const fz = JSON.parse(fs.readFileSync(path.join(build, 'facezone.json'), 'utf8')), caps = R.readCaptions(capF);
      caps.faceTrack = { fps: fz.fps, zones: splitZones(fz) };
      if (flag('no-face-safe')) caps.faceSafe = false;
      fs.writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(caps, null, 1) + ';\n');
    } catch (e) { console.warn('note: face zone skipped (' + String(e.message).split('\n')[0] + '); captions are not kept off the face this run'); }
  } }
sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build);
// screen cards behind the head render to ovlp/; assemble.cjs needs to know (with the head mask below, else in front)
{ let lj = {}; try { lj = JSON.parse(fs.readFileSync(path.join(build, 'layers.json'), 'utf8')); } catch {}
  const want = lj.panels === 'behind' ? 'ovlp/%04d.png' : undefined;
  if (cut.panels !== want) { if (want) cut.panels = want; else { delete cut.panels; delete cut.headMask; } fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1)); } }
// --no-mask on a rebuild (Studio's "Titles in front" when memory is short): drop the mask from this job, so everything
// that would sit behind the head draws in front and no mask is made
if (flag('rebuild') && flag('no-mask') && (cut.mask || cut.headMask || cut.person)) {
  delete cut.mask; delete cut.maskModel; delete cut.person; delete cut.headMask;
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
  console.log('titles in front: no person mask this render (--no-mask); remove the flag and set "mask": "mask.mkv" in cut.json to put it back');
}
// memory for the mask (kit/memcheck.cjs; kit/mask.py checks again before it loads the model)
if ((cut.titles || splitIns().length) && cut.mask) { const mc = require('./memcheck.cjs').renderCheck(build, { model: opt('mask') });
  if (mc.needed) console.log(mc.ok ? `memory: ${mc.freeGB} GB free, the ${mc.model} mask needs about ${mc.needGB} GB` : `WARNING: ${mc.message} (--no-mask puts titles in front; --mask mediapipe is the lighter mask)`); }
// person mask only for titles that sit behind the head (needs npm run effects:setup)
if ((cut.titles || splitIns().length) && cut.mask) {
  let capsNow = {}; try { capsNow = R.readCaptions(path.join(build, 'captions.js')); } catch {}
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
  const splits = splitIns().map(x => ({ start: +x.at, end: Math.min(+x.at + +x.dur, LEN) }));
  if (splits.length) { behind.push(...splits); console.log(`split b-roll: mask over ${splits.length} span${splits.length > 1 ? 's' : ''} so your head sits in front of the panel`); }
  if (!behind.length) {
    console.log('title layer: all titles and stickers in front; skipping the person mask');
  } else {
    const fxPy = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const spec = R.maskSpec(cut, { model: opt('mask') });
    if (!fs.existsSync(fxPy)) { console.warn('WARNING: some titles, captions or graphics are set to sit behind your head (behind, or auto), but the person mask is not set up, so they stay in front. Set it up once with: npm run effects:setup'); process.env.MASK_WARNED = '1'; }
    else {
      ensureBase(); // BASEONLY drops sfx and bed; reused when the picture has not changed
      const win = behind.map(t => `${Math.max(0, t.start - 0.1).toFixed(2)}-${Math.min(LEN, t.end + 0.1).toFixed(2)}`).join(',');
      const maskArgs = [path.join(KIT, 'mask.py'), 'base.mp4', spec.file || 'mask.mkv', ...(win ? ['--windows', win] : []), ...(spec.model ? ['--model', spec.model] : []), ...(spec.person ? ['--person', spec.person] : [])];
      // when only split b-roll wants the mask, a mask that cannot run (memory, a missing model) does not stop the reel:
      // the head stays under the panel (kit/split.cjs) instead
      if (splits.length === behind.length) { try { sh(fxPy, maskArgs, build); } catch (e) { process.env.SPLIT_NO_MASK = '1'; console.warn('note: the person mask did not run, so on the split b-roll your head stays under the panel this render'); } }
      else sh(fxPy, maskArgs, build);
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
// everything this reel was made from, kept beside it (jobs/<job>/reel-vN.build/), so a later Draft cannot erase it
// and the reel can be reopened (kit/snapshots.cjs, Studio "Edit this reel", the reopen_reel tool)
let snapshot = null; try { snapshot = require('./snapshots.cjs').save(job, out); if (snapshot) console.log(`saved the build behind this reel: ${path.relative(job, snapshot)} (reopen: npm run reopen -- ${name} v${v})`); } catch (e) { console.warn('note: could not save the build behind this reel: ' + e.message); }
let LAY = null; try { LAY = JSON.parse(fs.readFileSync(path.join(build, 'layout.json'), 'utf8')); } catch {}
const lay = LAY ? { moved: LAY.elements.filter(e => e.action === 'shift').length, hidden: LAY.elements.filter(e => e.action === 'hide').length, safeArea: LAY.elements.filter(e => e.action === 'safe-area').length } : null;
console.log(`\nReel: ${out}${exported ? '\nExport: ' + exported : ''}\nCheck it: npm run verify -- ${name}${cut.export ? ' --export ' + cut.export : ''} (contact sheet, ffprobe, loudness, mask, overlap${cut.export ? ', safe area' : ''}), watch it, read clips/clips.md for skipped retakes, then edit build/captions.js or build/cut.json and run: npm run reel -- --rebuild --name ${name}`);
try { require('./star.cjs').maybePrompt({ json: JSON_OUT }); } catch {}
if (JSON_OUT) console.log(JSON.stringify({ ok: true, job: name, dir: job, reel: out, export: exported, exportPreset: cut.export || null, seconds: +LEN.toFixed(2), layout: lay, verify: `npm run verify -- ${name}${cut.export ? ' --export ' + cut.export : ''} --json`, snapshot: snapshot ? path.relative(job, snapshot) : null }));
