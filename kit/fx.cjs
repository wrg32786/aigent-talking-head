// Effects pass: add claude-video-effects on top of a reel, as a second pass after the cut and captions.
//   npm run fx -- --name <job> --plan fx.json            -> jobs/<job>/reel-fx-vN.mp4 (captions stay on top)
//   npm run fx -- --name <job> --plan fx.json --still 1.2,6.5   -> check frames in jobs/<job>/build/fx/ (with captions)
//   npm run fx -- some-video.mp4 --plan fx.json [--out x.mp4]   -> any video; effects draw over whatever is baked in
//   npm run fx -- --list                                  -> the catalog, grouped by moment
// Other flags: --jobs <dir>, --allow-demo-copy (fill neutral [placeholders] for missing copy; never upstream text), --captions on|off (force for all),
//   --pill (turn on the upstream "Edited by Claude" pill on glass-widgets; off by default, or set "pill" per entry),
//   --sfx off (no pack auto-pick and no locked-set sounds; or NOSFX=1). Per-effect in fx.json: "sfx": "01-cinematic-hit-a" or "sfx": false.
// Job mode rebuilds the picture as graded cut -> effects -> caption overlay -> glitch hits, and the sound is mixed
// from the segments as usual (voice, locked-set wooshes, auto-picked pack sounds, ducked bed). Pack sounds are
// auto-picked from kit/sfx/sfx.json: one per effect, no-repeat rotation, risers ending on the hit, releases after
// heavy hits, ducked under the voice.
//
// fx.json (times are on the reel's output clock, the same as captions.js):
// { "profile": {"name": "Sam", "handle": "@sam.makes"},
//   "effects": [ {"fx": "lean-in", "start": 0.4, "end": 1.4},
//                {"fx": "checklist", "start": 6, "end": 10, "text": "Record::phone|Drop::inbox|Ask::Claude", "title": "Your workflow"},
//                {"fx": "tap", "start": 14, "end": 16, "captions": "off"},
//                {"fx": "spotlight", "start": 18, "end": 20, "sfx": "24-shimmer-sparkle-b"} ] }
// Per-entry "captions": "off" hides captions for that window, "on" keeps them even for effects the catalog marks "off".
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = __dirname, ROOT = path.dirname(KIT), FX = path.join(ROOT, 'effects');
const PY = path.join(FX, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const RUNNER = path.join(FX, 'fx_runner.py');
const cat = JSON.parse(fs.readFileSync(path.join(FX, 'catalog.json'), 'utf8'));
const byName = Object.fromEntries(cat.effects.map(e => [e.name, e]));
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const VALUED = new Set(['name', 'plan', 'still', 'out', 'jobs', 'captions', 'sfx', 'mask', 'matte']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const die = m => { console.error(m); process.exit(1); };
const SFXPLAN = require('./sfx-plan.cjs');
const B = require('./beats.cjs');
const sh = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
// Windows only: when Application Control blocks MediaPipe's DLL, run the effects in WSL instead. Set FX_WSL to the
// Python inside WSL that has the effects packages (e.g. /root/fxvenv/bin/python), FX_WSL_DISTRO to pick a distro.
const WSL = process.platform === 'win32' && process.env.FX_WSL;
const wp = s => (typeof s === 'string' && /^[A-Za-z]:[\\/]/.test(s) ? '/mnt/' + s[0].toLowerCase() + s.slice(2).split('\\').join('/') : s);
// --mask birefnet | birefnet-portrait | mediapipe: the person cut-out the effects use. Default: the job's cut.json
// "maskModel" (the same setting the titles-behind-the-head mask reads), else MASK_MODEL / FX_MATTE, else MediaPipe.
// The BiRefNet mattes come from rembg through kit/mask_refine.py, need no MediaPipe (so no WSL on Windows), and the slow
// raw matte is cached per frame in build/fx/matte-<model>/. birefnet-portrait has the best edge; birefnet is twice as fast.
const R = require('./rules.cjs');
let MATTE = opt('mask') || opt('matte') || process.env.FX_MATTE || process.env.MASK_MODEL;
// the effects pass mattes every frame, so plain "birefnet" stays birefnet-general-lite here (kit/mask_refine.py MATTE_MODELS)
const matteModel = m => { if (!m) return undefined; const key = String(m).toLowerCase(); const k = key === 'birefnet' ? 'birefnet' : R.MASK_MODELS[key]; if (!k) die('unknown mask model ' + m + ' (use birefnet, birefnet-portrait, birefnet-general, birefnet-lite or mediapipe)'); return k === 'mediapipe' ? undefined : k; };
const runFx = args => {
  // PYTHONUTF8: Windows Python reads the plan as cp1252 otherwise, and "·" in a plan comes out as "Â·" on screen
  if (matteModel(MATTE)) return sh(PY, [RUNNER, ...args], undefined, { PYTHONUTF8: '1', FX_MATTE: matteModel(MATTE), FX_MATTE_CACHE: path.dirname(args[2]), FX_TRACK_W: process.env.FX_TRACK_W || '1080' });
  // MediaPipe chosen (or nothing set): an FX_MATTE left in the environment must not switch the runner to a matte
  if (!WSL) return sh(PY, [RUNNER, ...args], undefined, { PYTHONUTF8: '1', FX_MATTE: '' });
  const i = args.indexOf('--plan'), pf = args[i + 1], plan = JSON.parse(fs.readFileSync(pf, 'utf8'));
  const wpf = pf.replace(/\.json$/, '.wsl.json'); fs.writeFileSync(wpf, JSON.stringify(plan, (k, v) => wp(v), 1));   // image folders in the plan too
  const a = args.slice(); a[i + 1] = wpf;
  // --exec runs the Python straight, without the Linux shell, so a file name like take$(id).mp4 or O'Brien.mp4 stays a name
  sh('wsl.exe', [...(process.env.FX_WSL_DISTRO ? ['-d', process.env.FX_WSL_DISTRO] : []), '--exec', WSL, wp(RUNNER), ...a.map(wp)], undefined, { FX_MATTE: '' });
};

if (flag('list')) {
  for (const m of Object.keys(cat.moments)) {
    console.log(`\n${m.toUpperCase()}: ${cat.moments[m]}`);
    for (const e of cat.effects.filter(e => e.moments.includes(m))) console.log(`  ${e.name.padEnd(24)} ${e.energy.padEnd(6)} captions:${e.captions.padEnd(5)} ${e.does.slice(0, 80)}`);
  }
  console.log('\nFull details: effects/CATALOG.md');
  process.exit(0);
}
if (!(WSL && !matteModel(MATTE)) && !fs.existsSync(PY)) die('Effects are not set up yet. Run: npm run effects:setup');
const planPath = opt('plan'); if (!planPath) die('Pass --plan fx.json (see the header of kit/fx.cjs or effects/CATALOG.md)');
const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const profile = raw.profile || {};
const plan = (Array.isArray(raw) ? raw : raw.effects).map(d => ({ ...d }));

// resolve aliases (same table as upstream), then validate against the catalog
const src = fs.readFileSync(path.join(FX, 'vendor/claude-video-effects/scripts/fx.py'), 'utf8');
const aliases = Object.fromEntries([...(src.match(/ALIASES = \{([\s\S]*?)\}/)[1]).matchAll(/'([^']+)':\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
const looks = { 'glitter-spotlight': ['spotlight', 'sparkle'], glitter: ['spotlight', 'sparkle'] };
const problems = [], warnings = [];
const JOBNAME = opt('name') || (positional[0] ? path.basename(positional[0]).replace(/\.[^.]+$/, '') : '');
for (const d of plan) {
  let n = String(d.fx || '').toLowerCase().replace(/^\//, '');
  if (looks[n]) { d.look = d.look || looks[n][1]; n = looks[n][0]; }
  n = aliases[n] || n; d.fx = n;
  const e = byName[n];
  if (!e) { problems.push(`unknown effect "${d.fx}" (npm run fx -- --list)`); continue; }
  if (!(d.end > d.start)) problems.push(`${n}: needs start < end`);
  if (n === 'glass-widgets') { // the upstream "Edited by Claude" pill is off unless the plan opts in ("pill": true or custom text, or --pill)
    if (d.pill === true || (d.pill === undefined && flag('pill'))) d.pill = 'Edited by |Claude';
    else if (d.pill === undefined || d.pill === false) d.pill = '';
  }
  // Profile fields (name, handle, reel-frame's handle): from the plan's "profile"; refused if missing.
  for (const k of e.fromProfile || []) if (d[k] === undefined) {
    const pk = k === 'text' ? 'handle' : k;
    if (profile[pk]) d[k] = profile[pk]; else { problems.push(`${n}: set "${pk}" in "profile" (otherwise the upstream author's would show)`); if (flag('allow-demo-copy')) d[k] = `[${pk}]`; }
  }
  // Required copy: refused if missing (the upstream defaults are the author's brand, handle or demo stats).
  const req = [...e.required, ...Object.entries(e.requiredIf || {}).flatMap(([k, m]) => m[d[k]] || [])];
  const missing = req.filter(k => d[k] === undefined || d[k] === '');
  for (const k of missing) problems.push(`${n}: set "${k}" (${e.options[k] || 'your copy'})`);
  if (missing.length && flag('allow-demo-copy')) for (const k of missing.filter(k => k !== 'images')) d[k] = /^(to|count|total|views|from)$/.test(k) ? '0' : `[${k}]`;
  // Neutral fills for optional upstream-specific fields, so nothing of the author's shows by default.
  const now = new Date();
  const tok = { '$profile.name': profile.name || ' ', '$profile.handle': profile.handle || ' ', '$job': JOBNAME || 'this reel',
    '$day': now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(), '$date': String(now.getDate()),
    '$issue': 'ISSUE  ·  ' + now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() };
  for (const [k, v] of Object.entries(e.neutral || {})) if (d[k] === undefined) d[k] = tok[v] ?? v;
  const len = d.end - d.start;
  if (len < e.duration[0] * 0.7 || len > e.duration[1] * 1.5) warnings.push(`${n}: ${len.toFixed(1)} s is outside its usual ${e.duration[0]}-${e.duration[1]} s`);
  if (e.captions === 'check' && d.captions === undefined) warnings.push(`${n} (${d.start}-${d.end}): read a check frame, it can crowd the caption band. ${e.captionNote}`);
}
const highs = plan.filter(d => byName[d.fx]?.energy === 'high').sort((a, b) => a.start - b.start);
for (let i = 1; i < highs.length; i++) if (highs[i].start - highs[i - 1].start < cat.pacing.maxHighEnergyEvery) warnings.push(`pacing: ${highs[i - 1].fx} and ${highs[i].fx} are both high energy and start < ${cat.pacing.maxHighEnergyEvery} s apart`);
const known = plan.filter(d => byName[d.fx]);
if (known.length && !known.some(d => d.start <= cat.pacing.hookWithin)) warnings.push(`pacing: no effect starts in the first ${cat.pacing.hookWithin} s (hook)`);
if (known.length > cat.pacing.perReel[1]) warnings.push(`pacing: ${known.length} effects; ${cat.pacing.perReel[0]}-${cat.pacing.perReel[1]} reads best`);
const cams = plan.filter(d => byName[d.fx]?.camera);
for (let i = 0; i < cams.length; i++) for (let j = i + 1; j < cams.length; j++) if (cams[i].start < cams[j].end && cams[j].start < cams[i].end) warnings.push(`camera effects ${cams[i].fx} and ${cams[j].fx} overlap; they will fight over the zoom`);
plan.sort((a, b) => (byName[b.fx]?.camera ? 1 : 0) - (byName[a.fx]?.camera ? 1 : 0) || a.start - b.start); // camera effects first (upstream rule)
warnings.forEach(w => console.warn('note:', w));
if (problems.length && !flag('allow-demo-copy')) die('Fix the plan first (these effects need your own copy; see "Needs your copy" in effects/CATALOG.md):\n  ' + problems.join('\n  ') + '\n(--allow-demo-copy fills neutral [placeholders] instead, for a quick look only)');
const capsMode = opt('captions');
const hide = plan.filter(d => capsMode === 'off' || (capsMode !== 'on' && (d.captions === 'off' || (d.captions !== 'on' && byName[d.fx]?.captions === 'off'))));
const ovlOff = hide.map(d => `${(+d.start).toFixed(2)}-${(+d.end).toFixed(2)}`).join(',');
const clean = plan.map(({ captions, ...d }) => d);

const still = opt('still');
const direct = positional[0];
if (direct) {
  const out = opt('out') || direct.replace(/(\.[^.]+)?$/, still ? '_check.png' : '_fx.mp4');
  const pf = path.join(path.dirname(path.resolve(out)), path.basename(out).replace(/\.[^.]+$/, '') + '.plan.json');
  fs.writeFileSync(pf, JSON.stringify({ effects: clean }, null, 1));
  console.warn('note: direct mode draws effects over anything already in the video, captions included. Use --name <job> to keep captions on top.');
  runFx(['--plan', pf, path.resolve(direct), path.resolve(out), ...(still ? ['--still', still] : [])]);
  process.exit(0);
}

const name = opt('name'); if (!name) die('Pass --name <job> (a folder in jobs/) or a video path.');
const job = path.resolve(opt('jobs') || path.join(ROOT, 'jobs'), name), build = path.join(job, 'build'), dir = path.join(build, 'fx');
if (!fs.existsSync(path.join(build, 'cut.json'))) die('No ' + path.join(build, 'cut.json') + '. Make the reel first (npm run reel).');
fs.mkdirSync(dir, { recursive: true });
const cut = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8'));
// One or the other (Will, 2026-11-18): a word an effect puts on screen must not also be in the caption at the same time.
const capSrc = path.join(build, 'captions.js');
if (cut.overlay && fs.existsSync(capSrc)) for (const w of R.dupWords(plan.filter(d => !hide.includes(d)), R.readCaptions(capSrc), hide.map(d => [+d.start, +d.end]))) console.warn('note:', w);
if (!MATTE) MATTE = R.maskSpec(cut).model;   // the job's own mask model, so titles and effects share one cut-out
if (matteModel(MATTE)) console.log('> person cut-out for the effects:', matteModel(MATTE));
const LEN = cut.segs.reduce((a, s) => a + (s.out - s.in) + (s.pad || 0), 0) + (cut.tail ?? 0.3);
if (cut.overlay && !fs.existsSync(path.join(build, 'ovl'))) sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build);
// Caption zones: effects the catalog marks "off" hide the caption track and the kinetic titles for their window;
// "check" effects (they can reach the caption band) move the caption track up to captions.js altY instead, unless
// the entry says "captions": "on". fxzones.js tells overlay.html; the overlay is re-rendered when the zones change.
const zones = plan.filter(d => byName[d.fx]).map(d => {
  const c = capsMode || d.captions || byName[d.fx].captions;
  return c === 'off' ? { start: +d.start, end: +d.end, act: 'hide', fx: d.fx } : (c === 'check' || c === 'move') ? { start: +d.start, end: +d.end, act: 'move', fx: d.fx } : null;
}).filter(Boolean);
const zf = path.join(build, 'fxzones.js'), zsrc = 'window.FXZONES=' + JSON.stringify(zones) + ';\n';
if (!fs.existsSync(zf) || fs.readFileSync(zf, 'utf8') !== zsrc) {
  fs.writeFileSync(zf, zsrc);
  if (cut.overlay) { console.log('> caption zones changed, re-rendering the overlay', zones.map(z => `${z.fx} ${z.act}`).join(', ')); sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build); }
}
const pf = path.join(dir, 'plan.resolved.json');
fs.writeFileSync(pf, JSON.stringify({ effects: clean }, null, 1));
const base = path.join(dir, 'base.mp4');
console.log('> base cut (no captions) for the effects');
sh(process.execPath, [path.join(KIT, 'assemble.cjs'), base], build, { BASEONLY: '1' });
if (still) {
  for (const f of fs.readdirSync(dir)) if (/^check.*\.png$/.test(f)) fs.rmSync(path.join(dir, f));
  runFx(['--plan', pf, base, path.join(dir, 'check.png'), '--still', still]);
  const pngs = fs.readdirSync(dir).filter(f => /^check(_[0-9.]+)?\.png$/.test(f));
  for (const f of pngs) {
    const png = path.join(dir, f), m = f.match(/_([0-9.]+)\.png$/), t = m ? +m[1] : +still;
    const ov = path.join(build, 'ovl', String(Math.round(t * 24)).padStart(4, '0') + '.png');
    const hidden = hide.some(d => t >= d.start && t <= d.end);
    const ovt = path.join(build, 'ovlt', path.basename(ov));
    if (fs.existsSync(ovt) && !hidden) { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-i', ovt, '-filter_complex', 'overlay', png + '.tmp.png']); fs.renameSync(png + '.tmp.png', png); }
    if (fs.existsSync(ov) && !hidden) { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-i', ov, '-filter_complex', 'overlay', png + '.tmp.png']); fs.renameSync(png + '.tmp.png', png); }
    console.log('check frame', png, hidden ? '(captions hidden here)' : '(with captions)');
  }
  process.exit(0);
}
const fxv = path.join(dir, 'base-fx.mp4');
runFx(['--plan', pf, base, fxv]);
const sfxOff = opt('sfx') === 'off' || flag('no-sfx') || process.env.NOSFX;
let sfxHits = [];
if (!sfxOff) {
  sfxHits = SFXPLAN.planHits(plan);
  const cutNow = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8'));
  const beatPy = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
    const grid = B.loadGrid(build) || (B.wantBeatSync(cutNow) && cutNow.bed ? B.analyseBed(cutNow, build, { python: beatPy }) : null);
  if (grid) {
    const win = B.windowOf(cutNow), times = B.anchors(grid);
    sfxHits = sfxHits.map(h => ({ ...h, t: B.snap(+h.t, times, win).t }));
  }
  cutNow.sfxHits = sfxHits;
  fs.writeFileSync(path.join(build, 'cut.json'), JSON.stringify(cutNow, null, 1));
  fs.writeFileSync(path.join(dir, 'sfx-hits.json'), JSON.stringify({ note: 'Auto-picked by kit/fx.cjs from kit/sfx/sfx.json. Override a line in fx.json with "sfx": "<id>" or "sfx": false, then re-run. Times snap to the bed beat grid when beat-sync is on.', hits: sfxHits }, null, 1));
  sfxHits.forEach(h => console.log(`  sfx  ${h.t.toFixed(2).padStart(6)}s  ${h.fx.padEnd(24)} ${h.id.padEnd(28)} ${h.role}`));
}
let v = 1; while (fs.existsSync(path.join(job, `reel-fx-v${v}.mp4`))) v++;
const out = path.join(job, `reel-fx-v${v}.mp4`);
sh(process.execPath, [path.join(KIT, 'assemble.cjs'), out], build, { BASE: fxv, OVL_OFF: ovlOff, ...(sfxOff ? { NOSFX: '1' } : {}) });
console.log(`\nReel with effects: ${out}${ovlOff ? `  (captions hidden: ${ovlOff})` : ''}${sfxOff ? '  (sfx off)' : sfxHits.length ? `  (${sfxHits.length} pack sounds)` : ''}`);
