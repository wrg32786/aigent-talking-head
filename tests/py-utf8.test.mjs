// Every text open() in our Python names utf-8, so a breakdown with a non-ASCII character works on Windows (report 4 item 1)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); if (/node_modules|\.venv|__pycache__/.test(n)) return []; return statSync(p).isDirectory() ? walk(p) : /\.py$/.test(n) ? [p] : []; });
const bad = [];
for (const f of [...walk(join(ROOT, 'kit')), ...walk(join(ROOT, 'effects', 'vendor', 'claude-video-effects', 'scripts'))]) {
  const s = readFileSync(f, 'utf8'); const re = /(?<![\w.])open\(/g; let m;
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length, depth = 1; while (depth && i < s.length) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; i++; }
    const args = s.slice(m.index + 5, i - 1);
    if (/encoding\s*=/.test(args) || /['"][rwa+]*b[rwa+]*['"]/.test(args)) continue;
    bad.push(`${relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length} open(${args})`);
  }
}
if (bad.length) { console.error('open() without encoding="utf-8":\n' + bad.join('\n')); process.exit(1); }
console.log('ok every text open() in our Python names utf-8');
