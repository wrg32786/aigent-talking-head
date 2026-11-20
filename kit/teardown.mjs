// Tear down a reference reel into a Reel.md you can remake with your own clip and brand.
//
//   npm run teardown -- <reel.mp4> [--out teardown/<name>] [--engine rea|lite] [--install] [--no-asr] [--no-ocr] [--vlm] [--reuse]
//   npm run teardown -- --url https://www.instagram.com/reel/<code>/   (optional, needs: pip install instaloader)
//   --reuse keeps an earlier rea-video breakdown and transcript in the out folder and only redoes the mapping
//   then: npm run reel -- --recipe teardown/<name>/Reel.md --clip inbox/my-clip.mp4
//
// Engine: rea-video (https://github.com/JuneYaooo/rea-video, Apache-2.0) does the breakdown: shots, captions and styled
// text with timing, colour and entrance, music BPM and beats, sound effects, grade and camera. It writes a VIDEO.md
// package. kit/videomd2reel.cjs then maps that onto the talking-head menu. --install pip-installs rea-video into the
// Python that runs the kit (PYTHON, or python3). Without rea-video, the built-in fallback (kit/teardown.py: ffmpeg
// scene cuts, pixel stats, rapidocr and faster-whisper when installed) gives a rougher recipe, fully offline.
// Extras rea-video does not measure (front/behind per title with the person mask, vignette, a labelled contact sheet)
// come from kit/teardown.py extras either way.
//
// Local files you provide. The one exception is the optional --url helper: a single Instagram post you name, fetched
// anonymously with instaloader (MIT) when it is installed, into teardown-in/ (gitignored). No login, no profiles, no bulk.
// Only use it on content you have the rights to, and follow Instagram's terms.
// Writes teardown/<name>/: Reel.md, teardown.md (what was detected and how sure), contact.jpg, videomd/ (rea-video's
// package and report.html) or fallback.json.
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { basename, dirname, join, resolve, relative, delimiter } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const V = require('./videomd2reel.cjs');
const RM = require('./reelmd.cjs');
const R = require('./rules.cjs');

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const VALUED = new Set(['out', 'engine', 'name', 'model', 'url']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const die = m => { console.error(m); process.exit(1); };
// the kit's Python: PYTHON, else the kit's .venv, else the system one
const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
const REA_PKG = 'rea-video[ocr] @ git+https://github.com/JuneYaooo/rea-video';

const pyHas = mod => spawnSync(PY, ['-c', `import ${mod}`], { stdio: 'ignore' }).status === 0;
const IG_POST = /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,})\/?(?:[?#].*)?$/;
const URL_HELP = 'teardown reads local files. The only URL it takes is a single Instagram post with --url (optional, needs instaloader). Anything else: download it yourself where you have the rights, then pass the file path.';

// Optional: fetch one named Instagram post anonymously with instaloader, then tear it down like a local file.
function fetchInstagram(url) {
  const m = IG_POST.exec(url);
  if (!m) die(`--url takes a single Instagram post or reel link (instagram.com/reel/<code>/ or /p/<code>/). Got: ${url}\nProfiles, hashtags, stories and other sites are not supported. ` + URL_HELP);
  if (!pyHas('instaloader')) die(`--url needs instaloader, an optional extra (MIT): ${PY} -m pip install instaloader\nOr download the video yourself where you have the rights and pass the file path.`);
  const dir = join(ROOT, 'teardown-in');
  console.log(`fetching Instagram post ${m[1]} anonymously (instaloader, no login) into ${relative(ROOT, dir)}/`);
  console.log('make sure you have the rights to this content and follow Instagram\'s terms.');
  const r = spawnSync(PY, [join(KIT, 'ig_fetch.py'), m[1], dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const file = (r.stdout || '').trim().split(/\r?\n/).pop();
  if (r.status !== 0 || !file || !existsSync(file)) die('Instagram download failed (see above). Nothing was logged in to.');
  return file;
}

const urlArg = opt('url');
if (flag('url') && !urlArg) die('usage: npm run teardown -- --url https://www.instagram.com/reel/<code>/');
if (pos[0] && /^[a-z]+:\/\//i.test(pos[0])) die((IG_POST.test(pos[0]) ? `Pass Instagram links with --url: npm run teardown -- --url ${pos[0]}\n` : '') + URL_HELP);
const input = urlArg ? fetchInstagram(urlArg) : pos[0];
if (!input) die('usage: npm run teardown -- <reel.mp4> [--out dir] [--engine rea|lite] [--install]  |  --url <instagram post url>');
const video = resolve(input);
if (!existsSync(video)) die('Not found: ' + video);
const name = (opt('name') || basename(video).replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reference';
const out = resolve(opt('out', join(ROOT, 'teardown', name)));
mkdirSync(out, { recursive: true });
const run = (cmd, args, o = {}) => { console.log('>', basename(cmd), args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')); execFileSync(cmd, args, { stdio: 'inherit', ...o }); };

function findRea() {
  if (process.env.REA_VIDEO && existsSync(process.env.REA_VIDEO)) return process.env.REA_VIDEO;
  const bin = process.platform === 'win32' ? 'rea-video.exe' : 'rea-video';
  const pyDir = PY.includes('/') || PY.includes('\\') ? dirname(PY) : null;
  for (const d of [pyDir, ...(process.env.PATH || '').split(delimiter)].filter(Boolean)) { const f = join(d, bin); if (existsSync(f)) return f; }
  return null;
}
function installRea() {
  console.log(`installing rea-video into ${PY} (Apache-2.0; first breakdown downloads ~216 MB of audio models)`);
  run(PY, ['-m', 'pip', 'install', REA_PKG]);
  // rapidocr-onnxruntime pulls opencv-python, which fights opencv-python-headless for cv2 (rea-video's setup note)
  spawnSync(PY, ['-m', 'pip', 'uninstall', '-y', 'opencv-python'], { stdio: 'inherit' });
  run(PY, ['-m', 'pip', 'install', '--force-reinstall', '--no-deps', 'opencv-python-headless>=4.8,<5']);
}

let engine = opt('engine', 'rea');
let rea = engine === 'rea' ? findRea() : null;
if (engine === 'rea' && !rea && flag('install')) { installRea(); rea = findRea(); }
if (engine === 'rea' && !rea) {
  console.warn(`note: rea-video not found. For the full breakdown: npm run teardown -- ${input} --install\n      (or pip install "${REA_PKG}"). Using the built-in fallback for now.`);
  engine = 'lite';
}

let b;
if (engine === 'rea') {
  const pkg = join(out, 'videomd');
  if (flag('reuse') && existsSync(join(pkg, 'breakdown.json'))) console.log('reusing ' + join(pkg, 'breakdown.json') + ' (--reuse)');
  else run(rea, ['decompose', video, '-o', pkg, '--lang', 'en', ...(flag('vlm') ? ['--vlm'] : []), ...(flag('no-ocr') ? ['--no-ocr'] : []), ...(flag('no-asr') ? ['--no-asr'] : [])]);
  b = V.loadBreakdown(pkg);
} else {
  const f = join(out, 'fallback.json');
  run(PY, [join(KIT, 'teardown.py'), 'analyze', video, '--out', f, ...(flag('no-ocr') ? ['--no-ocr'] : []), ...(flag('no-asr') ? ['--no-asr'] : []), '--model', opt('model', 'base.en')]);
  b = V.loadBreakdown(f);
}

// speech: rea-video's optional ASR is SenseVoice; when it is off, use faster-whisper (already a kit dependency)
if (!(b.speech && b.speech.ok && (b.speech.lines || []).length) && !flag('no-asr') && engine === 'rea' && pyHas('faster_whisper')) {
  const f = join(out, 'speech.json');
  if (flag('reuse') && existsSync(f)) { const sp = JSON.parse(readFileSync(f, 'utf8')); if (sp.ok) b.speech = sp; }
  else {
  const r = spawnSync(PY, ['-c', `import sys,json;sys.path.insert(0,${JSON.stringify(KIT)});import teardown as T;json.dump(T.speech_words(${JSON.stringify(video)},${JSON.stringify(opt('model', 'base.en'))}) or {},open(${JSON.stringify(f)},'w'))`], { stdio: 'inherit' });
  if (!r.status && existsSync(f)) { const sp = JSON.parse(readFileSync(f, 'utf8')); if (sp.ok) b.speech = sp; }
  }
}

// tempo of each library bed, once, so the recipe can suggest the closest one
const cacheF = join(ROOT, 'teardown', '.bed-bpm.json');
let bpms = {}; try { bpms = JSON.parse(readFileSync(cacheF, 'utf8')); } catch {}
const audio = b.audio || {};
if ((audio.tempo_bpm || (audio.music || {}).tempo_bpm) && pyHas('librosa')) {
  for (const bed of Object.keys(R.BEDS || {})) {
    if (bpms[bed]) continue;
    const f = R.bedFile(bed);
    if (!f || !existsSync(f)) continue;
    const g = join(out, '.bed-grid.json');
    const r = spawnSync(PY, [join(KIT, 'beats.py'), f, '--duration', '60', '--out', g], { stdio: 'ignore' });
    if (!r.status && existsSync(g)) bpms[bed] = JSON.parse(readFileSync(g, 'utf8')).tempo_bpm;
  }
  mkdirSync(dirname(cacheF), { recursive: true });
  writeFileSync(cacheF, JSON.stringify(bpms, null, 1));
}

// extras: front/behind per title, vignette and noise per shot, labelled contact sheet
const titles = V.pickTitles(b);
writeFileSync(join(out, 'titles.json'), JSON.stringify(titles, null, 1));
const fxPy = join(ROOT, 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const exPy = existsSync(fxPy) ? fxPy : PY; // the effects venv has MediaPipe for the person mask
const bf = engine === 'rea' ? join(out, 'videomd', 'breakdown.json') : join(out, 'fallback.json');
let extras = {};
const ex = spawnSync(exPy, [join(KIT, 'teardown.py'), 'extras', video, '--breakdown', bf, '--titles', join(out, 'titles.json'), '--out', join(out, 'extras.json'), '--sheet', join(out, 'contact.jpg')], { stdio: 'inherit' });
if (!ex.status) extras = JSON.parse(readFileSync(join(out, 'extras.json'), 'utf8'));
else console.warn('note: extras failed (no layer hints, vignette or contact sheet)');

const res = V.convert(b, extras, { name, bpms, recipePath: relative(ROOT, join(out, 'Reel.md')) });
writeFileSync(join(out, 'Reel.md'), res.md);
writeFileSync(join(out, 'teardown.md'), res.report);
const r = RM.load(join(out, 'Reel.md'));
const { errs } = RM.validate(r);
if (errs.length) console.warn('note: the Reel.md needs a fix before a remake:\n- ' + errs.join('\n- '));
console.log('\n' + RM.summary(r));
console.log(`\nTeardown: ${join(out, 'Reel.md')}\nReport:   ${join(out, 'teardown.md')} (contact sheet: contact.jpg${engine === 'rea' ? ', full rea-video report: videomd/report.html' : ''})
Show the user what was detected, let them change it, then remake:
  npm run reel -- --recipe ${relative(process.cwd(), join(out, 'Reel.md'))} --clip inbox/<your-clip>.mp4`);
