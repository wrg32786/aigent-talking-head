// One-time setup for the effects pass: a Python venv at effects/.venv with the vendored requirements
// (numpy, opencv-python, pillow, mediapipe; about 150 MB) plus rembg + onnxruntime (the DirectML build on Windows) for the BiRefNet
// person-mask backend (another ~390 MB of packages). Safe to re-run. Prints READY.   npm run effects:setup
// Pass --birefnet to also download the birefnet-portrait weights (~928 MB), the default person mask (kit/mask.py), into rembg's cache.
// Python: set PYTHON, else the first of python3.12, python3.11, python3.13, python3.10, python3 (py -3 on Windows).
// rembg needs Python 3.11+; on 3.10 the MediaPipe mask still works and birefnet is skipped.
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const HERE = dirname(fileURLToPath(import.meta.url));
const VENV = join(HERE, '.venv'), WIN = process.platform === 'win32';
export const venvPython = join(VENV, WIN ? 'Scripts/python.exe' : 'bin/python');
const REQ = join(HERE, 'vendor/claude-video-effects/requirements.txt');
const dirSize = (d) => { try { return readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(join(d, e.name)) : (e.isFile() ? statSync(join(d, e.name)).size : 0)), 0); } catch { return 0; } };
const mb = n => (n / 1048576).toFixed(0) + ' MB';
const ok = py => { try { execFileSync(py, ['-c', 'import mediapipe, cv2, PIL, numpy'], { stdio: 'ignore' }); return true; } catch { return false; } };
const rembgOk = py => { try { execFileSync(py, ['-c', 'import rembg, onnxruntime'], { stdio: 'ignore' }); return true; } catch { return false; } };
const MASK_REQ = join(HERE, 'requirements-mask.txt');
const run = (c, a) => execFileSync(c, a, { stdio: 'inherit' });
const wantDownload = process.argv.includes('--birefnet');
const installRembg = () => {
  const pyVer = execFileSync(venvPython, ['-c', 'import sys; print(sys.version_info[0]*100+sys.version_info[1])']).toString().trim();
  if (Number(pyVer) < 311) {
    console.warn('note: rembg needs Python 3.11+ (this venv is ' + execFileSync(venvPython, ['-c', 'import sys; print("%d.%d"%sys.version_info[:2])']).toString().trim() + '); person mask will use MediaPipe');
    return;
  }
  const before = dirSize(VENV);
  run(venvPython, ['-m', 'pip', 'install', '-q', '-r', MASK_REQ]);
  if (!rembgOk(venvPython)) console.warn('note: rembg/onnxruntime installed but imports fail; person mask will use MediaPipe');
  else console.log('rembg+onnxruntime ready, added ~' + mb(Math.max(0, dirSize(VENV) - before)) + ' (packages only; the birefnet-portrait mask weights are ~928 MB on first use or with --birefnet)');
};
const downloadModel = () => {
  if (!rembgOk(venvPython)) { console.error('cannot download the BiRefNet weights: rembg is not importable'); process.exit(1); }
  run(venvPython, [join(HERE, '..', 'kit', 'mask.py'), '--download']);
};
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync(venvPython) && ok(venvPython)) {
    if (!rembgOk(venvPython)) installRembg();
    if (wantDownload) downloadModel();
    console.log('READY', venvPython); process.exit(0);
  }
  const cands = process.env.PYTHON ? [[process.env.PYTHON]] : WIN ? [['py', '-3.12'], ['py', '-3']] : [['python3.12'], ['python3.11'], ['python3.13'], ['python3.10'], ['python3']];
  const py = cands.find(([c, ...a]) => { try { execFileSync(c, [...a, '-c', 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)'], { stdio: 'ignore' }); return true; } catch { return false; } });
  if (!py) { console.error('NEED_PYTHON: install Python 3.10 or newer, or set PYTHON'); process.exit(1); }
  run(py[0], [...py.slice(1), '-m', 'venv', VENV]);
  run(venvPython, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '-q', '-r', REQ]);
  if (!ok(venvPython)) { console.error('install finished but imports fail'); process.exit(1); }
  installRembg();
  if (wantDownload) downloadModel();
  console.log('READY', venvPython);
}
