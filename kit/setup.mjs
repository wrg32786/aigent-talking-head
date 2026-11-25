// Setup: install everything the kit can use, up front, and say what is left for the user.
//   npm run setup:all [-- --yes] [--skip effects,model] [--only ytdlp] [--json]   install what is missing, then print a summary
//     (--only: just those steps; Studio's Install buttons run --only <step>, see kit/studio/fixes.mjs)
//   npm run setup:all -- --check [--json]                         only report (Studio's Setup check and the MCP
//                                                                  setup_status tool use the same list)
// Safe to run again and to stop halfway: every step first checks whether its thing is already there, so a second run
// only does what is still missing. The last run is kept in jobs/.studio/setup.json (or STUDIO_DIR).
// Steps: Node packages, the Python venv (.venv) and requirements.txt, yt-dlp and instaloader (reference links),
// ffmpeg and ffprobe, Chrome, the Whisper model (small.en, about 470 MB), the effects venv (npm run effects:setup:
// MediaPipe, OpenCV, rembg), rea-video for references (optional: --skip rea), the humanizer skill, and the Studio page build.
// ffmpeg and Chrome are system programs: with --yes it uses Homebrew, winget, or apt/dnf/pacman when sudo works
// without a password; otherwise it prints the one command for the user to run (it needs their password).
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { delimiter, dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const VENV_PY = join(ROOT, '.venv', WIN ? 'Scripts/python.exe' : 'bin/python');
const FX_PY = join(ROOT, 'effects', '.venv', WIN ? 'Scripts/python.exe' : 'bin/python');
export const MODEL = process.env.TX_MODEL || 'small.en';
const stateDir = () => resolve(process.env.STUDIO_DIR || join(ROOT, 'jobs', '.studio'));
export const lastRunPath = () => join(stateDir(), 'setup.json');

const onPath = b => (process.env.PATH || '').split(delimiter).filter(Boolean).map(d => [join(d, b), join(d, b + '.exe'), join(d, b + '.cmd')].find(existsSync)).find(Boolean) || null;
// Node 24 DEP0190: do not pass an args array with shell:true. A .exe path is spawned directly. Any other
// command on Windows goes through cmd /d /c so npm.cmd and other shims start (Node refuses .cmd with shell:false).
const run = (cmd, args, o = {}) => {
  const opts = { cwd: ROOT, encoding: 'utf8', timeout: o.timeout || 60e3, stdio: o.inherit ? 'inherit' : 'pipe', shell: false, env: process.env };
  if (WIN && !/\.exe$/i.test(cmd)) return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', cmd, ...args], opts);
  return spawnSync(cmd, args, opts);
};
const okRun = (cmd, args, o) => { try { return run(cmd, args, o).status === 0; } catch { return false; } };
// the Python the kit runs: PYTHON (a path or a name on PATH), else the kit's .venv, else python3 on PATH
export const python = () => { const e = process.env.PYTHON; if (e && (existsSync(e) || onPath(e))) return e; if (existsSync(VENV_PY)) return VENV_PY; return onPath(WIN ? 'python' : 'python3') ? (WIN ? 'python' : 'python3') : null; };
const sysPython = () => ['python3.12', 'python3.11', 'python3.13', 'python3.10', 'python3', WIN ? 'py' : null].filter(Boolean)
  .find(c => onPath(c) && okRun(c, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']));
const hfHome = () => process.env.HF_HOME ? join(process.env.HF_HOME, 'hub') : process.env.HUGGINGFACE_HUB_CACHE || join(homedir(), '.cache', 'huggingface', 'hub');
const modelCached = () => existsSync(join(hfHome(), `models--Systran--faster-whisper-${MODEL}`, 'snapshots'));
function pm() {
  if (MAC) return onPath('brew') ? 'brew' : null;
  if (WIN) return onPath('winget') ? 'winget' : onPath('choco') ? 'choco' : null;
  return onPath('apt-get') ? 'apt' : onPath('dnf') ? 'dnf' : onPath('pacman') ? 'pacman' : null;
}
const SYS = {
  ffmpeg: { brew: 'brew install ffmpeg-full', winget: 'winget install --id Gyan.FFmpeg -e', choco: 'choco install ffmpeg -y', apt: 'sudo apt-get install -y ffmpeg', dnf: 'sudo dnf install -y ffmpeg', pacman: 'sudo pacman -S --noconfirm ffmpeg',
    none: 'Install ffmpeg from https://ffmpeg.org/download.html (a static build is fine; put ffmpeg and ffprobe on PATH)' },
  chrome: { brew: 'brew install --cask google-chrome', winget: 'winget install --id Google.Chrome -e', choco: 'choco install googlechrome -y', apt: 'sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser', dnf: 'sudo dnf install -y chromium', pacman: 'sudo pacman -S --noconfirm chromium',
    none: 'Install Chrome from https://www.google.com/chrome/ (or set CHROME_PATH)' },
};
export const sysFix = what => SYS[what][pm() || 'none'];
// ffmpeg needs the drawtext filter (titles, the smoke clips, verify, pack previews). Homebrew's plain ffmpeg formula is built
// without libfreetype, so it has none; ffmpeg-full has it but is keg-only, so its bin has to go first on PATH. An older
// Homebrew ffmpeg can also stop starting after ffmpeg-full upgrades x265; brew upgrade ffmpeg fixes that.
// ffmpegState: 'ready' | 'missing' (not on PATH) | 'broken' (on PATH, does not start) | 'nodrawtext'
const BREW_PATH = 'put "$(brew --prefix ffmpeg-full)/bin" first on PATH (ffmpeg-full is keg-only)';
// fresh: probe again. The same path can change state (brew upgrade ffmpeg repairs it in place), and Studio and the MCP
// server are long-lived, so every setup check probes; only the fix text between checks reads the cache.
let ffCache = null;
export function ffmpegState(fresh = false) {
  const at = onPath('ffmpeg'), probe = onPath('ffprobe');
  if (!fresh && ffCache && ffCache.at === at && ffCache.probe === probe) return ffCache.state;
  let state = 'missing';
  if (at && probe) { let r = null; try { r = run('ffmpeg', ['-hide_banner', '-filters'], { timeout: 20e3 }); } catch {}
    state = !r || r.status !== 0 ? 'broken' : /\bdrawtext\b/.test(r.stdout || '') ? 'ready' : 'nodrawtext'; }
  ffCache = { at, probe, state }; return state;
}
// the instruction for each state (for the CLI and, inside an agent instruction only, Studio)
export function ffmpegFixFor(state, p = pm()) {
  if (state === 'ready') return null;
  if (state === 'broken') return p === 'brew' ? 'brew upgrade ffmpeg (an older Homebrew ffmpeg stops starting after an x265 upgrade), or brew install ffmpeg-full and ' + BREW_PATH : `reinstall ffmpeg so it starts: ${SYS.ffmpeg[p || 'none']}`;
  if (state === 'nodrawtext') return p === 'brew' ? `brew install ffmpeg-full, then ${BREW_PATH}; the plain ffmpeg formula has no drawtext filter` : 'install an ffmpeg build with the drawtext filter (built with libfreetype), for example a full build from https://ffmpeg.org/download.html, and put it first on PATH';
  return p === 'brew' ? `brew install ffmpeg-full, then ${BREW_PATH}` : SYS.ffmpeg[p || 'none'];
}
export const ffmpegFix = () => ffmpegFixFor(ffmpegState());
const FF_DETAIL = { missing: 'not on PATH', broken: 'on PATH but it does not start', nodrawtext: 'no drawtext filter (built without libfreetype), so titles cannot render' };
const needsPassword = fix => /(^|: )sudo /.test(fix);

// rea-video next to the kit's Python or on PATH (kit/teardown.mjs looks the same way)
export const REA_PKG = 'rea-video[ocr] @ git+https://github.com/JuneYaooo/rea-video';
function findRea(py) {
  if (process.env.REA_VIDEO && existsSync(process.env.REA_VIDEO)) return process.env.REA_VIDEO;
  const bin = WIN ? 'rea-video.exe' : 'rea-video', pyDir = py && (py.includes('/') || py.includes('\\')) ? dirname(py) : null;
  return (pyDir && existsSync(join(pyDir, bin)) ? join(pyDir, bin) : null) || onPath('rea-video');
}
// each check: { id, label, need: 'core' | 'feature', feature, ready, detail, fix, user (only the user can do the fix) }
export function checks() {
  const py = python(), out = [];
  const add = (id, label, need, feature, ready, detail, fix, user = false) => out.push({ id, label, need, feature, status: ready ? 'ready' : 'missing', detail, fix: ready ? null : fix, user: ready ? false : user });
  const nodeMajor = +process.versions.node.split('.')[0];
  add('node', 'Node.js 18+', 'core', 'everything', nodeMajor >= 18, `Node ${process.versions.node}`, 'Install Node.js 18 or newer from https://nodejs.org', true);
  add('npm', 'Node packages', 'core', 'MCP tools, rendering, Studio', existsSync(join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk')) && existsSync(join(ROOT, 'node_modules', 'playwright-core')), 'node_modules', 'npm install');
  const reqs = py && okRun(py, ['-c', 'import faster_whisper, librosa, PIL, cv2'], { timeout: 60e3 });
  add('python', 'Python venv and requirements', 'core', 'transcribing, beats, teardown', !!reqs, py ? py : 'no .venv yet', 'npm run setup:all (makes .venv and installs requirements.txt)');
  const ff = ffmpegState(true);
  add('ffmpeg', 'ffmpeg and ffprobe', 'core', 'drafts, renders, Record now takes, trimming', ff === 'ready', ff === 'ready' ? onPath('ffmpeg') : FF_DETAIL[ff], ffmpegFixFor(ff), true);
  let chrome = null; try { chrome = spawnSync(process.execPath, ['-e', 'import("./kit/chrome.mjs").then(m=>console.log(m.findChrome()))'], { cwd: ROOT, encoding: 'utf8', timeout: 10e3 }).stdout.trim() || null; } catch {}
  add('chrome', 'Chrome or Chromium', 'core', 'rendering titles and graphics', !!chrome, chrome || 'not found', sysFix('chrome'), true);
  add('model', `Whisper model (${MODEL})`, 'feature', 'the first transcription (else it downloads then)', modelCached(), modelCached() ? 'cached' : 'about 470 MB, not downloaded yet', 'npm run setup:all');
  const yt = py && okRun(py, ['-m', 'yt_dlp', '--version']) || !!onPath('yt-dlp');
  add('ytdlp', 'yt-dlp', 'feature', 'YouTube, TikTok, X and Vimeo reference links', !!yt, yt ? 'installed' : 'missing', py ? `${py} -m pip install yt-dlp` : 'npm run setup:all');
  const ig = py && okRun(py, ['-c', 'import instaloader']);
  add('instaloader', 'instaloader', 'feature', 'Instagram reference links (anonymous)', !!ig, ig ? 'installed' : 'missing', py ? `${py} -m pip install instaloader` : 'npm run setup:all');
  const fx = existsSync(FX_PY) && okRun(FX_PY, ['-c', 'import mediapipe, cv2, PIL, numpy']);
  add('effects', 'Effects pass (MediaPipe, OpenCV, rembg)', 'feature', 'film effects and the person mask', !!fx, fx ? 'effects/.venv' : 'not set up', 'npm run effects:setup');
  // the default person mask's weights (birefnet-portrait, about 928 MB), so the first render does not stop to download them
  const maskW = fx && okRun(FX_PY, ['-c', 'import sys; sys.path.insert(0, "kit"); import mask_refine as R; sys.exit(0 if R.cached_weights("birefnet-portrait") else 1)'], { cwd: ROOT, timeout: 60e3 });
  add('mask', 'Person mask weights (birefnet-portrait)', 'feature', 'titles and captions behind your head', !!maskW, maskW ? 'cached' : 'about 928 MB, not downloaded yet', 'npm run effects:setup -- --birefnet');
  // rea-video (Apache-2.0): the full reference breakdown. Without it the built-in analyzer reads references, much rougher
  // (session report 2, F: 11 shots of 21, 0 titles of 7). Optional; needs Git, and the first breakdown downloads ~216 MB.
  const rea = !!findRea(py);
  add('rea', 'rea-video (reference breakdown)', 'feature', 'reading a reference: shots, titles, captions, grade (else the rougher built-in analyzer)', rea, rea ? findRea(py) : 'not installed: the built-in analyzer reads references', 'npm run setup:all -- --only rea');
  add('humanizer', 'Humanizer skill', 'feature', 'scripts your agent writes', existsSync(join(ROOT, 'skills', 'humanizer', 'SKILL.md')), 'skills/humanizer/SKILL.md', 'git checkout skills/humanizer (it ships with the kit)');
  let built = false, why = 'missing';
  try { const stamp = JSON.parse(readFileSync(join(KIT, 'studio', 'public', 'build.json'), 'utf8')); built = existsSync(join(KIT, 'studio', 'public', 'index.html')); why = built ? 'built ' + (stamp.built || '') : why; } catch {}
  add('studio', 'Studio page', 'core', 'Studio', built, why.trim(), 'npm run studio:build');
  return out;
}

// for Studio and the MCP tool: the list, plus the plain-words list of what only the user can do
export function status() {
  const items = checks(), missing = items.filter(x => x.status !== 'ready');
  let last = null; try { last = JSON.parse(readFileSync(lastRunPath(), 'utf8')); } catch {}
  return { ready: !missing.some(x => x.need === 'core'), items, missing: missing.length, forUser: missing.filter(x => x.user).map(x => tellUser(x)), lastRun: last && { at: last.at, summary: last.summary } };
}
export function tellUser(x) {
  // a fix that is a sentence, not a command (ffmpegFixFor: "reinstall ffmpeg so it starts: ...", "install an ffmpeg build ..."), reads as is
  if (x.id === 'ffmpeg' && /^(re)?install /.test(x.fix)) return `${x.label}: ${x.fix}${needsPassword(x.fix) ? ' (it needs your password)' : ''}`;
  if (x.id === 'ffmpeg' || x.id === 'chrome') return needsPassword(x.fix) ? `Installing ${x.label} needs your password: run ${x.fix}` : `Install ${x.label}: run ${x.fix}`;
  if (x.id === 'node') return x.fix;
  return `${x.label}: run ${x.fix}`;
}

// ---------- install ----------
function step(name, fn, log) {
  log(`\n== ${name}`);
  try { const r = fn(); return { name, ...r }; } catch (e) { return { name, result: 'failed', detail: e.message }; }
}
const sh = (cmd, args, log, timeout = 30 * 60e3) => { log('$ ' + [cmd, ...args].join(' ')); const r = run(cmd, args, { inherit: true, timeout }); if (r.status !== 0) throw new Error(`${cmd} ${args[0] || ''} exited ${r.status ?? r.signal}`); };
function trySystem(what, yes, log) {
  const fix = sysFix(what), p = pm();
  if (!yes) return { result: 'needs you', detail: fix };
  if (!p) return { result: 'needs you', detail: fix };
  if (needsPassword(fix) && !(process.getuid && process.getuid() === 0) && !okRun('sudo', ['-n', 'true'])) return { result: 'needs you', detail: `needs your password: run ${fix}` };
  const line = (process.getuid && process.getuid() === 0) ? fix.replace(/sudo /g, '') : fix;
  if (p === 'apt') okRun('sh', ['-c', (line.startsWith('sudo') ? 'sudo -n ' : '') + 'apt-get update -qq'], { timeout: 10 * 60e3 });
  const r = run(WIN ? 'cmd' : 'sh', WIN ? ['/c', line.replace(/^sudo /, 'sudo -n ')] : ['-c', line.replace(/sudo /g, 'sudo -n ')], { inherit: true, timeout: 30 * 60e3 });
  return r.status === 0 ? { result: 'installed' } : { result: 'failed', detail: `run ${fix}` };
}

export function install({ yes = false, skip = [], log = console.log } = {}) {
  const res = [], has = id => checks().find(x => x.id === id).status === 'ready';
  const skipIf = (id, fn) => skip.includes(id) ? { name: id, result: 'skipped', detail: 'skipped with --skip' } : fn();
  res.push(skipIf('npm', () => step('Node packages', () => { if (has('npm')) return { result: 'ready' }; sh(WIN ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], log); return { result: 'installed' }; }, log)));
  res.push(skipIf('python', () => step('Python venv and requirements', () => {
    if (has('python')) return { result: 'ready' };
    const own = process.env.PYTHON && (existsSync(process.env.PYTHON) || onPath(process.env.PYTHON)) ? process.env.PYTHON : null, target = own || VENV_PY;
    if (!own && !existsSync(VENV_PY)) { const sp = sysPython(); if (!sp) return { result: 'needs you', detail: 'Install Python 3.10 or newer from https://www.python.org/downloads/' }; sh(sp, ['-m', 'venv', join(ROOT, '.venv')], log); }
    sh(target, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], log); sh(target, ['-m', 'pip', 'install', '--quiet', '-r', join(ROOT, 'requirements.txt')], log);
    return { result: 'installed' };
  }, log)));
  const py = python();
  res.push(skipIf('ytdlp', () => step('yt-dlp and instaloader', () => {
    if (has('ytdlp') && has('instaloader')) return { result: 'ready' };
    if (!py) return { result: 'failed', detail: 'needs the Python venv first' };
    sh(py, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'yt-dlp', 'instaloader'], log); return { result: 'installed' };
  }, log)));
  res.push(skipIf('ffmpeg', () => step('ffmpeg and ffprobe', () => {
    if (has('ffmpeg')) return { result: 'ready' };
    const ff = ffmpegState();
    // on PATH but broken or without drawtext: only a Mac with Homebrew has a safe one-line fix; ffmpeg-full still needs PATH after
    if (ff === 'broken' || (ff !== 'missing' && pm() !== 'brew')) return { result: 'needs you', detail: ffmpegFixFor(ff) };
    const r = trySystem('ffmpeg', yes, log);
    return pm() === 'brew' && r.result === 'installed' ? { result: 'needs you', detail: `ffmpeg-full is installed: ${BREW_PATH}, then run this again` } : pm() === 'brew' && r.result === 'needs you' ? { ...r, detail: ffmpegFixFor(ff) } : r;
  }, log)));
  res.push(skipIf('chrome', () => step('Chrome', () => has('chrome') ? { result: 'ready' } : trySystem('chrome', yes, log), log)));
  res.push(skipIf('model', () => step(`Whisper model (${MODEL})`, () => {
    if (modelCached()) return { result: 'ready' };
    if (!py) return { result: 'failed', detail: 'needs the Python venv first' };
    sh(py, ['-c', `from faster_whisper import WhisperModel; WhisperModel(${JSON.stringify(MODEL)}, device="cpu", compute_type="int8")`], log); return { result: 'installed' };
  }, log)));
  res.push(skipIf('effects', () => step('Effects pass', () => { if (has('effects')) return { result: 'ready' }; sh(process.execPath, [join(ROOT, 'effects', 'setup.mjs')], log); return { result: 'installed' }; }, log)));
  res.push(skip.includes('effects') && skip.includes('mask') ? { name: 'mask', result: 'skipped', detail: 'skipped with the effects pass' } : skipIf('mask', () => step('Person mask weights (birefnet-portrait)', () => {
    if (has('mask')) return { result: 'ready' };
    if (!existsSync(FX_PY)) return { result: 'failed', detail: 'needs the effects pass first' };
    sh(FX_PY, [join(KIT, 'mask.py'), '--download'], log); return { result: 'installed' };
  }, log)));
  // optional: a failure here never fails setup (references still read with the built-in analyzer)
  res.push(skipIf('rea', () => step('rea-video (reference breakdown, optional)', () => {
    if (has('rea')) return { result: 'ready' };
    const p2 = python(); if (!p2) return { result: 'needs you', detail: 'needs the Python venv first' };
    if (!onPath('git')) return { result: 'needs you', detail: 'rea-video installs from GitHub and needs Git: install Git, then npm run setup:all -- --only rea' };
    try {
      sh(p2, ['-m', 'pip', 'install', '--quiet', REA_PKG], log);
      // rapidocr-onnxruntime pulls opencv-python, which fights opencv-python-headless for cv2 (rea-video's setup note)
      run(p2, ['-m', 'pip', 'uninstall', '-y', 'opencv-python']);
      sh(p2, ['-m', 'pip', 'install', '--quiet', '--force-reinstall', '--no-deps', 'opencv-python-headless>=4.8,<5'], log);
    } catch (e) { return { result: 'needs you', detail: `rea-video did not install (${e.message}); references use the built-in analyzer. Retry: npm run setup:all -- --only rea` }; }
    return has('rea') ? { result: 'installed' } : { result: 'needs you', detail: 'pip finished but rea-video is not on PATH; set REA_VIDEO to its path' };
  }, log)));
  res.push(skipIf('humanizer', () => step('Humanizer skill', () => has('humanizer') ? { result: 'ready' } : { result: 'failed', detail: 'skills/humanizer is missing from this copy: git checkout skills/humanizer' }, log)));
  res.push(skipIf('studio', () => step('Studio page', () => { if (has('studio')) return { result: 'ready' }; sh(process.execPath, [join(KIT, 'studio', 'build.mjs')], log); return { result: 'installed' }; }, log)));
  const summary = { ready: res.filter(r => r.result === 'ready').length, installed: res.filter(r => r.result === 'installed').length, skipped: res.filter(r => r.result === 'skipped').length, failed: res.filter(r => r.result === 'failed').length, needsYou: res.filter(r => r.result === 'needs you').length };
  const rec = { at: new Date().toISOString(), steps: res, summary };
  try { mkdirSync(stateDir(), { recursive: true }); writeFileSync(lastRunPath(), JSON.stringify(rec, null, 2) + '\n'); } catch {}
  return rec;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = k => argv.includes('--' + k);
  const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
  const VALUED = new Set(['skip', 'only']), json = flag('json'), STEP_IDS = ['npm', 'python', 'ytdlp', 'ffmpeg', 'chrome', 'model', 'effects', 'mask', 'rea', 'humanizer', 'studio'];
  // --only effects also fetches the mask weights (as before); --skip effects also skips them
  const only = (opt('only') || '').split(',').map(x => x.trim()).filter(Boolean).flatMap(x => x === 'effects' ? [x, 'mask'] : [x]), skipArg = only.length ? STEP_IDS.filter(x => !only.includes(x)).join(',') : (opt('skip') || '').split(',').flatMap(x => x.trim() === 'effects' ? ['effects', 'mask'] : [x]).join(',');
  if (flag('check')) {
    const s = status();
    if (json) console.log(JSON.stringify(s, null, 2));
    else { for (const x of s.items) console.log(`${x.status === 'ready' ? 'ready  ' : 'MISSING'}  ${x.label}${x.status === 'ready' ? '' : `  (${x.feature}) fix: ${x.fix}`}`); if (s.forUser.length) console.log('\nFor you:\n- ' + s.forUser.join('\n- ')); }
    process.exit(s.ready ? 0 : 1);
  }
  const rec = install({ yes: flag('yes'), skip: skipArg.split(',').map(x => x.trim()).filter(Boolean), log: json ? (m => process.stderr.write(m + '\n')) : console.log });
  const s = status();
  if (json) console.log(JSON.stringify({ ...rec, status: s }, null, 2));
  else {
    console.log('\nSetup summary');
    for (const r of rec.steps) console.log(`  ${r.result.padEnd(10)} ${r.name}${r.detail ? ': ' + r.detail : ''}`);
    console.log(`  ${rec.summary.installed} installed, ${rec.summary.ready} already there, ${rec.summary.skipped} skipped, ${rec.summary.failed} failed, ${rec.summary.needsYou} need you`);
    if (s.forUser.length) console.log('\nOnly you can do these:\n- ' + s.forUser.join('\n- '));
    console.log(s.ready ? '\nSETUP READY' : '\nSETUP INCOMPLETE (see above)');
    console.log('If Studio is already running, restart it so it picks this up.');
  }
  process.exit(rec.summary.failed ? 1 : 0);
}
