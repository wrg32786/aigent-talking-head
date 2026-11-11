// One command from a phone clip (or several takes) to a draft reel.
//   npm run reel                        -> the takes in inbox/ (every video from the newest recording session; one file is fine)
//   npm run reel -- inbox/my-take.mov   -> that file;  npm run reel -- inbox/a.mov inbox/b.mov  -> those takes
// Options: --theme aigent|neutral (default neutral)  --cropx 0.4 (face left of centre)  --model medium.en
//          --name <job>  --clips <dir> (reuse an existing clip.py folder, skips transcription)  --newest (inbox: newest file only)
//          --hook <take> (first sentence from this take: your most extreme angle)
//          --look kinetic|muse|classic (default kinetic: every word animated + one kinetic title per beat behind the head;
//            muse = pill captions + titles; classic = the original captions + spray hero word)
//          --style kinetic|classic|pill|hormozi|karaoke (override the caption style)  --no-titles  --fonts modern|druk|elegant|editorial|<local>
//          --no-punch (no zoom punch)  --no-mask (titles in front, skip the person mask)
//          --mask birefnet|mediapipe (person-mask backend; default mediapipe, fast. birefnet is the quality option, slow on CPU)
//          --draft (stop after captions.js so you can edit it)  --rebuild (re-render + re-assemble an edited job)
//          --bed music.wav  --bed-start 0  --logo logo.svg  --jobs <dir> (default jobs/)  --force
//          --sfx off  (skip locked-set sounds on this draft; also used by npm run fx)
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

const KIT = __dirname, ROOT = path.dirname(KIT);
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['theme', 'cropx', 'model', 'name', 'clips', 'bed', 'logo', 'jobs', 'hook', 'style', 'look', 'fonts', 'sfx', 'bed-start', 'mask']);
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
// titles), classic (the original captions + spray hero word, no titles)
const look = opt('look', 'kinetic');
if (!['kinetic', 'muse', 'classic'].includes(look)) die('--look must be kinetic, muse or classic');
const STYLE = opt('style', { kinetic: 'kinetic', muse: 'pill', classic: 'classic' }[look]);
const TITLES = !flag('no-titles') && (flag('titles') || look !== 'classic');
const FONTS = opt('fonts');
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
  if (!flag('no-punch') && segs.length >= 3) { segs[1].bigPunch = true; segs[segs.length - 1].bigPunch = true; }
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
  const cut = { note: `Drafted by kit/reel.cjs from ${keep.length} keep clips (${clips.length - keep.length} retakes skipped). Edit, then: npm run reel -- --rebuild --name ${name}`, segs, tail: 0.3, punch: flag('no-punch') ? false : 0.1, hits: [[0.02, 14], ...seams.map(s => [s, 24])], sfx, overlay: 'ovl/%04d.png' };
  if (TITLES) {
    if (flag('no-mask')) Object.assign(cut, { titles: 'ovlt/%04d.png' });
    else {
      const model = opt('mask');
      if (model) R.maskSpec({ mask: 'mask.mkv', maskModel: model }); // validate
      Object.assign(cut, { titles: 'ovlt/%04d.png', mask: 'mask.mkv', ...(model ? { maskModel: model } : {}) });
    }
  }
  const bed = opt('bed'); if (bed) Object.assign(cut, { bed: path.resolve(bed), bedVol: 0.16, ...(opt('bed-start') != null ? { bedStart: +opt('bed-start') } : {}) });
  if (fs.existsSync(path.join(build, 'cut.json')) && !flag('force')) die('build/cut.json exists. Use --rebuild to render your edits, or --force to redraft.');
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
  console.log(`cut.json: ${segs.length} segments, seams ${JSON.stringify(seams)}`);
  // 3. captions from the clips' word times
  const logo = opt('logo');
  if (logo) fs.copyFileSync(path.resolve(logo), path.join(build, path.basename(logo)));
  sh(process.execPath, [path.join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--force', TITLES ? '--titles' : '--hero', '--style', STYLE, ...(FONTS ? ['--fonts', FONTS] : []), ...(logo ? ['--logo', path.basename(logo)] : [])], build);
  // 4. theme
  const th = path.join(KIT, 'themes', opt('theme', 'neutral') + '.js');
  if (!fs.existsSync(th)) die('No theme ' + th);
  fs.copyFileSync(th, path.join(build, 'theme.js'));
  if (flag('draft')) { console.log(`\nDraft ready. Edit ${build}/captions.js (and cut.json), then: npm run reel -- --rebuild --name ${name}`); process.exit(0); }
}

// 5. render + assemble
const cut = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8'));
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
console.log(`\nReel: ${out}\nCheck it: npm run verify -- ${name} (contact sheet, ffprobe, loudness, mask), watch it, read clips/clips.md for skipped retakes, then edit build/captions.js or build/cut.json and run: npm run reel -- --rebuild --name ${name}`);
