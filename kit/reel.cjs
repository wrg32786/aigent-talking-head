// One command from a phone clip to a draft reel.
//   npm run reel                        -> newest video in inbox/
//   npm run reel -- inbox/my-take.mov   -> that file
// Options: --theme aigent|neutral (default neutral)  --cropx 0.4 (face left of centre)  --model medium.en
//          --name <job>  --clips <dir> (reuse an existing clip.py folder, skips transcription)
//          --draft (stop after captions.js so you can edit it)  --rebuild (re-render + re-assemble an edited job)
//          --bed music.wav  --logo logo.svg  --jobs <dir> (default jobs/)  --force
// Writes jobs/<name>/: clips/ (clip.py output), build/ (cut.json, captions.js, theme.js, overlay frames), reel-vN.mp4.
// Steps: clip.py (Whisper, retakes flagged) -> cut.json from every "keep" clip -> autocaption -> render -> assemble.
// It is a first draft. Review clips/clips.md and the reel, then edit build/cut.json or build/captions.js and run --rebuild.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = __dirname, ROOT = path.dirname(KIT);
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['theme', 'cropx', 'model', 'name', 'clips', 'bed', 'logo', 'jobs']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const sh = (cmd, args, cwd, env) => { console.log('>', path.basename(cmd), args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')); execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } }); };
const die = m => { console.error(m); process.exit(1); };
const VIDEO = /\.(mov|mp4|m4v|mkv|webm|avi)$/i;
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');

let src = positional[0];
const clipsArg = opt('clips');
if (!src && !clipsArg && !flag('rebuild')) {
  const inbox = path.join(ROOT, 'inbox');
  const vids = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter(f => VIDEO.test(f)).map(f => path.join(inbox, f)) : [];
  if (!vids.length) die('No video given and inbox/ has none. Drop your phone clip into inbox/ or pass a path.');
  src = vids.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
const name = opt('name') || (src ? path.basename(src).replace(/\.[^.]+$/, '') : path.basename(path.resolve(clipsArg || '.')))
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reel';
const job = path.resolve(opt('jobs', path.join(ROOT, 'jobs')), name), build = path.join(job, 'build');
fs.mkdirSync(build, { recursive: true });
console.log('job:', job);

if (!flag('rebuild')) {
  // 1. clips
  let clipsDir = clipsArg ? path.resolve(clipsArg) : path.join(job, 'clips');
  if (!clipsArg) {
    if (!src || !fs.existsSync(src)) die('Not found: ' + src);
    if (fs.existsSync(path.join(clipsDir, 'clips.json')) && !flag('force')) console.log('clips/ already exists, reusing it (pass --force to re-clip)');
    else sh(PY, [path.join(KIT, 'clip.py'), path.resolve(src), '--out', clipsDir, '--vertical', '--cropx', opt('cropx', '0.5'), ...(opt('model') ? ['--model', opt('model')] : [])], job);
  }
  const clips = JSON.parse(fs.readFileSync(path.join(clipsDir, 'clips.json'), 'utf8')).clips;
  const keep = clips.filter(c => !/^retake/.test(c.status));
  if (!keep.length) die('No keep clips in ' + clipsDir);
  // 2. cut.json from every keep clip, in order; a glitch hit and a woosh on each seam
  const rel = p => path.relative(build, path.isAbsolute(p) ? p : path.join(path.dirname(clipsDir), p)).split(path.sep).join('/');
  const segs = keep.map((c, i) => ({ file: rel(path.join(clipsDir, path.basename(c.file))), in: 0, out: +c.dur.toFixed(3), ...(i === 0 ? { fadeIn: 0.25 } : {}) }));
  let t = 0; const seams = [];
  segs.forEach((s, i) => { if (i) seams.push(+t.toFixed(3)); t += s.out - s.in; });
  const cut = { note: `Drafted by kit/reel.cjs from ${keep.length} keep clips (${clips.length - keep.length} retakes skipped). Edit, then: npm run reel -- --rebuild --name ${name}`, segs, tail: 0.3, hits: [[0.02, 14], ...seams.map(s => [s, 24])], sfx: { F: seams }, overlay: 'ovl/%04d.png' };
  const bed = opt('bed'); if (bed) Object.assign(cut, { bed: path.resolve(bed), bedVol: 0.16 });
  if (fs.existsSync(path.join(build, 'cut.json')) && !flag('force')) die('build/cut.json exists. Use --rebuild to render your edits, or --force to redraft.');
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cut, null, 1));
  console.log(`cut.json: ${segs.length} segments, seams ${JSON.stringify(seams)}`);
  // 3. captions from the clips' word times
  const logo = opt('logo');
  if (logo) fs.copyFileSync(path.resolve(logo), path.join(build, path.basename(logo)));
  sh(process.execPath, [path.join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--force', '--hero', ...(logo ? ['--logo', path.basename(logo)] : [])], build);
  // 4. theme
  const th = path.join(KIT, 'themes', opt('theme', 'neutral') + '.js');
  if (!fs.existsSync(th)) die('No theme ' + th);
  fs.copyFileSync(th, path.join(build, 'theme.js'));
  if (flag('draft')) { console.log(`\nDraft ready. Edit ${build}/captions.js (and cut.json), then: npm run reel -- --rebuild --name ${name}`); process.exit(0); }
}

// 5. render + assemble
const cut = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8'));
const LEN = cut.segs.reduce((a, s) => a + (s.out - s.in) + (s.pad || 0), 0) + (cut.tail ?? 0.3);
sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build);
let v = 1; while (fs.existsSync(path.join(job, `reel-v${v}.mp4`))) v++;
const out = path.join(job, `reel-v${v}.mp4`);
sh(process.execPath, [path.join(KIT, 'assemble.cjs'), out], build);
console.log(`\nReel: ${out}\nCheck it: watch it, read clips/clips.md for skipped retakes, then edit build/captions.js or build/cut.json and run: npm run reel -- --rebuild --name ${name}`);
