// One command from a phone clip (or several takes) to a draft reel.
//   npm run reel                        -> the takes in inbox/ (every video from the newest recording session; one file is fine)
//   npm run reel -- inbox/my-take.mov   -> that file;  npm run reel -- inbox/a.mov inbox/b.mov  -> those takes
// Options: --theme aigent|neutral (default aigent)  --cropx 0.4 (face left of centre)  --model medium.en
//          --name <job>  --clips <dir> (reuse an existing clip.py folder, skips transcription)  --newest (inbox: newest file only)
//          --hook <take> (first sentence from this take: your most extreme angle)
//          --look kinetic|oneword|muse|classic|one-word (default kinetic: every word animated + one kinetic title per beat behind the head;
//            oneword = one word at a time, type sizes and faces changing per word, flat-colour type cards;
//            muse = pill captions + titles; classic = the original captions + spray hero word; one-word = one big word at a time)
//          --style kinetic|oneword|classic|pill|hormozi|karaoke|one-word (override the caption style)  --no-titles  --fonts modern|druk|elegant|editorial|<any name in kit/fonts/pairings.json>|<local> (a,b,c cycles them, one per title)
//          --no-punch (no zoom punch)  --no-mask (titles in front, skip the person mask)
//          --mask birefnet|mediapipe (person-mask backend; default mediapipe, fast. birefnet is the quality option, slow on CPU)
//          --draft (stop after captions.js so you can edit it)  --rebuild (re-render + re-assemble an edited job)
//          --broll <folder> (cutaways from your own clips, voice running on)  --bed <name from npm run music> or --bed music.wav  --bed-start 0  --logo logo.svg  --jobs <dir> (default jobs/)  --force
//          --sfx off  (skip locked-set sounds on this draft; also used by npm run fx)
//          --beat-sync / --no-beat-sync  (default on when a bed is set: snap punches, SFX, titles and fx hits to the bed)
//          --finish grain[,vignette,...]  optional film look (grain, vignette, chroma, scan-lines, warm, cool, teal, crushed, mono, bleach)
//          --preset <name>|auto  apply a brand style (npm run preset -- --list). Flags you pass win over the preset.
// Writes jobs/<name>/: clips/ (clip.py output), build/ (cut.json, captions.js, theme.js, overlay frames), reel-vN.mp4.
// Steps: clip.py (Whisper, best take per sentence, retakes flagged) -> cut.json from every "keep" clip (zoom punch on
// every cut, big punch after the hook and into the payoff, a few sounds on the key cuts only) -> autocaption ->
// check (copy lint) -> render -> person mask when there are titles (effects venv) -> assemble.
// It is a first draft. Review clips/clips.md and the reel, then edit build/cut.json or build/captions.js and run --rebuild.
// Before you hand it over: npm run verify -- <name>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const R = require('./rules.cjs');
const B = require('./beats.cjs');
const P = require('./preset.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['theme', 'cropx', 'model', 'name', 'clips', 'bed', 'logo', 'jobs', 'hook', 'style', 'look', 'fonts', 'sfx', 'bed-start', 'mask', 'broll', 'finish', 'preset']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const sh = (cmd, args, cwd, env) => { console.log('>', path.basename(cmd), args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')); execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } }); };
const die = m => { console.error(m); process.exit(1); };
const VIDEO = /\.(mov|mp4|m4v|mkv|webm|avi)$/i;
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');

let srcs = positional.slice();
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
  const segs = keep.map((c, i) => ({ file: rel(path.join(clipsDir, path.basename(c.file))), in: 0, out: +c.dur.toFixed(3), ...(i === 0 ? { fadeIn: 0.25 } : {}) }));
  // big punch on the cut after the hook and the cut into the payoff (with 3+ segments)
  const wantPunch = flag('no-punch') ? false : (preset && preset.punch === false ? false : true);
  if (wantPunch && segs.length >= 3) { segs[1].bigPunch = true; segs[segs.length - 1].bigPunch = true; }
  let t = 0; const seams = [];
  segs.forEach((s, i) => { if (i) seams.push(+t.toFixed(3)); t += s.out - s.in; });
  // sound, fewer and deeper: a whoosh on the big-punch cuts (or the first cut), the boom (loudest) into the payoff;
  // every seam keeps its glitch hit, but not a sound
  const big = segs.map((s, i) => (s.bigPunch ? i : -1)).filter(i => i > 0).map(i => seams[i - 1]);
  const sfx = {};
  if (seams.length) {
    const last = seams[seams.length - 1], wh = (big.length ? big : [seams[0]]).filter(x => x !== last || seams.length === 1);
    if (wh.length) sfx.whoosh = wh;
    if (seams.length >= 2) sfx.boom = [[last, 0.55]];
  }
  const cut = { note: `Drafted by kit/reel.cjs from ${keep.length} keep clips (${clips.length - keep.length} retakes skipped). Edit, then: npm run reel -- --rebuild --name ${name}`, segs, tail: 0.3, punch: wantPunch ? 0.1 : false, hits: [[0.02, 14], ...seams.map(s => [s, 24])], sfx, overlay: 'ovl/%04d.png' };
  if (TITLES) {
    if (flag('no-mask')) Object.assign(cut, { titles: 'ovlt/%04d.png' });
    else {
      const model = opt('mask');
      if (model) R.maskSpec({ mask: 'mask.mkv', maskModel: model }); // validate
      Object.assign(cut, { titles: 'ovlt/%04d.png', mask: 'mask.mkv', ...(model ? { maskModel: model } : {}) });
    }
  }
  // a library name stays a name in cut.json (portable across machines); your own file becomes an absolute path
  const bed = opt('bed') || (preset && preset.bed) || undefined;
  if (bed) Object.assign(cut, { bed: require('./rules.cjs').isBed(bed) ? bed : path.resolve(bed), bedVol: 0.16, ...(opt('bed-start') != null ? { bedStart: +opt('bed-start') } : {}) });
  if (flag('no-beat-sync')) cut.beatSync = false;
  else if (flag('beat-sync') || bed) cut.beatSync = true;
  const finish = opt('finish') || (preset && !preset.finishPool && preset.finish) || undefined;
  if (finish) { try { B.parseFinish(finish); } catch (e) { die(e.message); } cut.finish = finish; }
  if (preset) {
    P.apply(preset, { cut }, {
      finish: opt('finish') || undefined,
      bed: opt('bed') || undefined,
      punch: flag('no-punch') ? false : undefined,
      beatSync: flag('no-beat-sync') ? false : (flag('beat-sync') ? true : undefined),
    });
  }
  if (fs.existsSync(path.join(build, 'cut.json')) && !flag('force')) die('build/cut.json exists. Use --rebuild to render your edits, or --force to redraft.');
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
  console.log(`cut.json: ${segs.length} segments, seams ${JSON.stringify(seams)}`);
  // 3. captions from the clips' word times
  const logo = opt('logo');
  if (logo) fs.copyFileSync(path.resolve(logo), path.join(build, path.basename(logo)));
  sh(process.execPath, [path.join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--force', ...(cut.hits && cut.hits.length === 0 ? ['--no-glitch'] : []), ...(TITLES ? ['--titles'] : look === 'oneword' ? [] : ['--hero']), ...(look === 'oneword' ? ['--cards'] : []), '--style', STYLE, ...(FONTS ? ['--fonts', FONTS] : []), ...(logo ? ['--logo', path.basename(logo)] : [])], build);
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
    const nDrop = (cut.dropHits || []).length;
    console.log(`beat-sync: ${grid.tempo_bpm} BPM, ${(grid.beats || []).length} beats, ${nDrop} drop shakes (window ${B.windowOf(cut)}s); speech cuts unchanged`);
  }
} else if (cut.dropHits) {
  delete cut.dropHits;
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
}
const LEN = cut.segs.reduce((a, s) => a + (s.out - s.in) + (s.pad || 0), 0) + (cut.tail ?? 0.3);
// copy lint and title/sound rules: printed, not blocking (npm run check -- <name> and npm run verify fail on errors)
try { sh(process.execPath, [path.join(KIT, 'check.mjs'), build, '--warn-only'], build); } catch {}
sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build);
// person mask for the kinetic titles: the graded cut, segmented in the title windows (needs npm run effects:setup)
if (cut.titles && cut.mask) {
  const fxPy = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const spec = R.maskSpec(cut, { model: opt('mask') });
  if (!fs.existsSync(fxPy)) console.warn('note: no person mask (npm run effects:setup to put titles behind the speaker); titles go in front');
  else {
    sh(process.execPath, [path.join(KIT, 'assemble.cjs'), 'base.mp4'], build, { BASEONLY: '1' }); // BASEONLY already drops sfx and bed
    const win = R.resolveTitles(R.readCaptions(path.join(build, 'captions.js'))).map(t => `${Math.max(0, t.start - 0.1).toFixed(2)}-${Math.min(LEN, t.end + 0.1).toFixed(2)}`).join(',');
    const maskArgs = [path.join(KIT, 'mask.py'), 'base.mp4', spec.file || 'mask.mkv', ...(win ? ['--windows', win] : []), ...(spec.model ? ['--model', spec.model] : []), ...(spec.person ? ['--person', spec.person] : [])];
    sh(fxPy, maskArgs, build);
  }
}
let v = 1; while (fs.existsSync(path.join(job, `reel-v${v}.mp4`))) v++;
const out = path.join(job, `reel-v${v}.mp4`);
sh(process.execPath, [path.join(KIT, 'assemble.cjs'), out], build, (flag('no-sfx') || opt('sfx') === 'off') ? { NOSFX: '1' } : {});
// is every caption word readable against what's behind it (kit/legibility.py)? Printed, not blocking
{ const py = path.join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (cut.overlay && fs.existsSync(py)) try { execFileSync(py, [path.join(KIT, 'legibility.py'), build, out], { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } }); } catch { console.warn('note: some caption moments read under 3:1 against the picture (listed above). Move the word, change its colour or pick another shot.'); } }
console.log(`\nReel: ${out}\nCheck it: npm run verify -- ${name} (contact sheet, ffprobe, loudness, mask), watch it, read clips/clips.md for skipped retakes, then edit build/captions.js or build/cut.json and run: npm run reel -- --rebuild --name ${name}`);
