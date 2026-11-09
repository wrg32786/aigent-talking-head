// One-time setup for the effects pass: a Python venv at effects/.venv with the vendored requirements
// (numpy, opencv-python, pillow, mediapipe; about 150 MB). Safe to re-run. Prints READY.   npm run effects:setup
// Python: set PYTHON, else the first of python3.12, python3.11, python3.13, python3.10, python3 (py -3 on Windows).
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const HERE = dirname(fileURLToPath(import.meta.url));
const VENV = join(HERE, '.venv'), WIN = process.platform === 'win32';
export const venvPython = join(VENV, WIN ? 'Scripts/python.exe' : 'bin/python');
const REQ = join(HERE, 'vendor/claude-video-effects/requirements.txt');
const ok = py => { try { execFileSync(py, ['-c', 'import mediapipe, cv2, PIL, numpy'], { stdio: 'ignore' }); return true; } catch { return false; } };
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync(venvPython) && ok(venvPython)) { console.log('READY', venvPython); process.exit(0); }
  const cands = process.env.PYTHON ? [[process.env.PYTHON]] : WIN ? [['py', '-3.12'], ['py', '-3']] : [['python3.12'], ['python3.11'], ['python3.13'], ['python3.10'], ['python3']];
  const py = cands.find(([c, ...a]) => { try { execFileSync(c, [...a, '-c', 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)'], { stdio: 'ignore' }); return true; } catch { return false; } });
  if (!py) { console.error('NEED_PYTHON: install Python 3.10 or newer, or set PYTHON'); process.exit(1); }
  const run = (c, a) => execFileSync(c, a, { stdio: 'inherit' });
  run(py[0], [...py.slice(1), '-m', 'venv', VENV]);
  run(venvPython, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '-q', '-r', REQ]);
  if (!ok(venvPython)) { console.error('install finished but imports fail'); process.exit(1); }
  console.log('READY', venvPython);
}
