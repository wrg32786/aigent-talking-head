// The kit's Python reads text files as UTF-8, never in the platform encoding. On Windows a bare open() decodes as cp1252,
// and a breakdown holding a byte cp1252 lacks (0x81, the second byte of "Á") stopped the teardown's extras step: no
// extras.json, no contact sheet, and Studio blamed the Effects pass.
// Run: node tests/python-json-utf8.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert');
const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');
const ROOT = join(__dirname, '..');
// Every text read names its encoding: the builtin open() in a read mode, and Path.read_text(). That covers
// json.load(open(p)), `with open(p) as f: json.load(f)` and json.loads(Path(p).read_text()). Writes and binary
// reads pass: json.dump is ASCII-safe.
// shortcut: p.open() and io.open() are not scanned, and a ")" inside a string argument ends the call early; move to
// Python's ast module if either shows up in the kit.
const CALL = /(?<![\w.])open\(|\.read_text\(/g;
const MODE = /,\s*(?:mode\s*=\s*)?["']([rwaxbt+]{1,3})["']/;
const callArgs = (text, from) => {
  let depth = 1, i = from;
  while (depth && i < text.length) { const c = text[i++]; depth += c === '(' ? 1 : c === ')' ? -1 : 0; }
  return text.slice(from, i - 1);
};
const bareReads = (text) => [...text.matchAll(CALL)].flatMap((m) => {
  const args = callArgs(text, m.index + m[0].length);
  const mode = m[0] === 'open(' ? MODE.exec(args) : null;
  if (/\bencoding\s*=/.test(args) || (mode && /[waxb]/.test(mode[1]))) return [];
  return [text.slice(0, m.index).split('\n').length];
});

// the pattern can fail: it catches each bare read and passes the fixed ones, the writes and the binary reads
assert.deepStrictEqual(bareReads([
  'x = json.load(open(p))',
  'y = json.load(open(p, encoding="utf-8"))',
  'z = json.loads(Path(p).read_text())',
  'z = json.loads(Path(p).read_text(encoding="utf-8"))',
  'with open(os.path.join(d, "a.json")) as f:',
  '    v = json.load(f)',
  'with open(os.path.join(d, "a.json"), encoding="utf-8") as f: v = json.load(f)',
  'with open(p, "w") as f: json.dump(v, f)',
  'raw = open(p, "rb").read()',
  'im = Image.open(p)',
  'txt = open(p, "r").read()',
].join('\n')), [1, 3, 5, 11]);

// effects/vendor is third-party code, pinned and not ours to edit
const files = ['kit', 'tests', 'effects'].flatMap((dir) => readdirSync(join(ROOT, dir), { recursive: true })
  .map((f) => (dir + '/' + f).replace(/\\/g, '/'))
  .filter((f) => f.endsWith('.py') && !f.startsWith('effects/vendor/') && !f.includes('node_modules/') && !f.includes('/.venv/')));
assert.ok(files.includes('kit/teardown.py'), 'the scan found the kit');
const hits = files.flatMap((f) => bareReads(readFileSync(join(ROOT, f), 'utf8')).map((n) => f + ':' + n));
assert.deepStrictEqual(hits, [], 'a text read without encoding="utf-8"');
console.log('ok ' + files.length + ' Python files read text as UTF-8');
