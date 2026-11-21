// Every text open() in our Python names utf-8, so a breakdown with a non-ASCII character works on Windows (report 4 item 1)
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); if (/node_modules|\.venv|__pycache__/.test(n)) return []; return statSync(p).isDirectory() ? walk(p) : /\.py$/.test(n) ? [p] : []; });
const bad = [];
for (const f of [...walk(join(ROOT, 'kit')), ...walk(join(ROOT, 'effects', 'vendor', 'claude-video-effects', 'scripts')), join(ROOT, 'effects', 'fx_runner.py')]) {
  const s = readFileSync(f, 'utf8'); const re = /(?<![\w.])open\(/g; let m;
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length, depth = 1; while (depth && i < s.length) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; i++; }
    const args = s.slice(m.index + 5, i - 1);
    if (/encoding\s*=/.test(args) || /['"][rwa+]*b[rwa+]*['"]/.test(args)) continue;
    bad.push(`${relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length} open(${args})`);
  }
  // Path.read_text() and write_text() use the code page too
  const rt = /\.(read_text|write_text)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  while ((m = rt.exec(s))) if (!/encoding\s*=/.test(m[2])) bad.push(`${relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length} ${m[1]}(${m[2]})`);
}
if (bad.length) { console.error('open() without encoding="utf-8":\n' + bad.join('\n')); process.exit(1); }
console.log('ok every text open() in our Python names utf-8');

// A word outside the Windows code page in the transcript (a music note from Whisper, an accented name) must not stop
// the clip step when its output is a pipe: kit/clip.py prints each line it found. The code page is stood in for with
// PYTHONIOENCODING=cp1252, which is what a Windows pipe gives Python.
{
  const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
  const d = mkdtempSync(join(tmpdir(), 'pyutf8-'));
  try {
    writeFileSync(join(d, 'words.json'), JSON.stringify({ 't.mp4': [[0.2, 0.6, '\u266a'], [0.7, 1.1, 'Caf\u00e9'], [1.2, 1.6, '\u65e5\u672c'], [1.7, 2.2, 'is'], [2.3, 2.9, 'open.']] }));
    writeFileSync(join(d, 't.mp4'), '');
    const env = { ...process.env, PYTHONIOENCODING: 'cp1252' }; delete env.PYTHONUTF8;
    const r = spawnSync(PY, [join(ROOT, 'kit', 'clip.py'), join(d, 't.mp4'), '--words', join(d, 'words.json'), '--out', join(d, 'clips'), '--plan-only', '--min', '1'], { env, encoding: 'utf8' });
    if (r.error || /ModuleNotFoundError|No module named/.test(r.stderr || '')) console.log('skip the clip.py print check (Python or its packages are not here)');
    else if (/UnicodeEncodeError/.test(r.stderr || '')) { console.error('kit/clip.py stops on a word outside the code page:\n' + r.stderr.split('\n').slice(-3).join('\n')); process.exit(1); }
    else console.log('ok kit/clip.py prints a transcript with words outside the Windows code page');
  } finally { rmSync(d, { recursive: true, force: true }); }
}
