// The font matcher (kit/fontmatch.py): words drawn in faces we ship are cut out as a phone video would show them
// (a busy background, a little blur, JPEG) and matched back to the library. Blackletter, sans, serif and condensed
// must each come back as their own kind, with the right pairing; weight, case and colour are read too. Faces from
// outside the library (system fonts, when the machine has them) must still land in the right kind, as Close or Guess.
// Run: node tests/fontmatch.test.mjs   (needs Python with Pillow and OpenCV, both in requirements.txt; part of npm run check)
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), FM = join(ROOT, 'kit', 'fontmatch.py');
const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.error('FAIL ' + m); } };
const dir = mkdtempSync(join(tmpdir(), 'fontmatch-'));
let n = 0;
const crop = (src, text, size, bg) => { const out = join(dir, `c${n++}.png`); execFileSync(PY, [FM, 'crop', ...src, '--text', text, '--out', out, '--size', String(size), '--bg', String(bg)], { stdio: ['ignore', 'pipe', 'pipe'] }); return out; };
const classify = items => { const f = join(dir, `i${n++}.json`); writeFileSync(f, JSON.stringify(items)); return JSON.parse(execFileSync(PY, [FM, 'classify', '--json', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); };
const words = (src, list, size, fill = '#ffffff') => classify(list.map((w, i) => ({ image: crop(src, w, size, i + 1), text: w, fill })));
try {
  const lib = JSON.parse(execFileSync(PY, [FM, 'library'], { encoding: 'utf8' }));
  for (const c of ['sans', 'serif', 'condensed', 'blackletter']) ok(lib.some(f => f.category === c), `the library has a ${c} face`);

  // the four kinds, each from the pairing that carries it, at a caption's size and at a small one
  const LOWER = ['terms', 'usage', 'limit', 'magazine'], CAPS = ['TERMS', 'USAGE', 'LIMIT', 'MAGAZINE'];
  for (const [pairing, category, list] of [['pirata', 'blackletter', LOWER], ['haas', 'sans', LOWER], ['playfair', 'serif', LOWER], ['recoleta', 'serif', LOWER], ['anton', 'condensed', CAPS], ['literata', 'sans', CAPS]]) {
    for (const size of [96, 46]) {
      const r = words(['--pairing', pairing], list, size);
      ok(r.category === category, `${pairing} at ${size}px reads as ${category} (got ${r.category}, nearest ${r.nearest.map(x => x.face + ' ' + x.score).join(', ')})`);
      ok(r.pairing === pairing, `${pairing} at ${size}px comes back as itself (got ${r.pairing})`);
      ok(r.match !== 'guess', `${pairing} at ${size}px is Matched or Close, not a guess (${r.match}, ${r.score})`);
      if (size === 96) ok(r.match === 'matched', `${pairing} at caption size is Matched (${r.match}, ${r.score})`);
      ok(r.case === (list === CAPS ? 'upper' : 'lower'), `${pairing}: case ${r.case}`);
      ok(r.color === '#ffffff', `${pairing}: white words read as white (${r.color})`);
    }
  }
  // capitals in a face whose pairing is not caps only still match; lower case never picks a caps-only pairing
  { const r = words(['--pairing', 'literata'], LOWER, 96); ok(r.category === 'sans' && r.pairing !== 'literata' && r.pairing !== 'modern', `lower case in Archivo Black picks a sans pairing that is not caps only (${r.pairing})`); ok(r.match !== 'matched', `and does not claim Matched for a different face (${r.match})`); }
  // weight: the same family light and heavy
  { const f = join(ROOT, 'kit', 'fonts', 'InterTight-VF.ttf');
    const light = words(['--file', f, '--weight', '400'], LOWER, 96), heavy = words(['--file', f, '--weight', '800'], LOWER, 96);
    ok(light.weight === 'regular', `Inter Tight 400 reads as regular (${light.weight}, stroke ${light.stroke})`);
    ok(heavy.weight === 'bold' || heavy.weight === 'black', `Inter Tight 800 reads as bold or black (${heavy.weight}, stroke ${heavy.stroke})`);
    ok(heavy.stroke > light.stroke * 1.5, `the heavy one has the wider stroke (${light.stroke} against ${heavy.stroke})`);
    ok(light.category === 'sans' && heavy.category === 'sans', 'both are sans'); }
  // faces we do not ship still land in the right kind, and never as Matched to a different kind
  for (const [file, category] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'sans'], ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 'serif'], ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'sans'], ['C:\\Windows\\Fonts\\arialbd.ttf', 'sans'], ['C:\\Windows\\Fonts\\timesbd.ttf', 'serif'], ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'sans']]) {
    if (!existsSync(file)) continue;
    const r = words(['--file', file, '--weight', '700'], LOWER, 96);
    ok(r.category === category, `${file.split(/[\\/]/).pop()} (not ours) reads as ${category} (got ${r.category})`);
    ok(r.match !== 'matched' || r.score >= 0.72, `${file.split(/[\\/]/).pop()}: ${r.match} at ${r.score}`);
  }
  // nothing to read: no answer, not a made-up one
  ok(classify([]) === null, 'no crops, no font');
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} FAILED, ${pass} passed` : `\n${pass} font match checks passed`);
process.exit(failed ? 1 : 0);
