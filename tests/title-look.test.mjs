// The look of a reference's titles, from the teardown to the draft (Studio report 4, items 6 to 9 and 13).
//   kit/titlelook.py reads a frame: one line or two, the key word's face (serif or sans, italic), case and colour, the
//     partner line's, a glow round the key word and how much the picture is dimmed. Frames are drawn here like the
//     reference in the report (a small white sans line in caps over one big yellow word in an italic serif).
//   kit/videomd2reel.cjs turns that into the recipe: the pairing with those two faces, the Style lines, blur-rise for an
//     entrance that was not read, and a "check" mark on title text the teardown is not sure of.
//   kit/reelmd.cjs reads the Style lines back into the captions.js keys the overlay draws with.
// Run: node tests/title-look.test.mjs   (needs Python with Pillow and OpenCV; part of npm run check)
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), TL = join(ROOT, 'kit', 'titlelook.py');
const V = require('../kit/videomd2reel.cjs'), RM = require('../kit/reelmd.cjs'), R = require('../kit/rules.cjs'), { textDoubt } = require('../kit/teardown/titles.cjs');
const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
try { execFileSync(PY, ['-c', 'import cv2, PIL'], { stdio: 'ignore' }); } catch { console.log('skip the title look tests (needs Python with OpenCV and Pillow, from requirements.txt)'); process.exit(0); }
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.error('FAIL ' + m); } };
const dir = mkdtempSync(join(tmpdir(), 'titlelook-'));
let n = 0;
const py = args => JSON.parse(execFileSync(PY, [TL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const frame = (flags, extra = []) => { const out = join(dir, `f${n++}.png`), meta = py(['frame', '--out', out, ...flags, ...extra]); return py(['read', '--image', out, '--bbox', meta.bbox.join(','), '--text', meta.text, '--before', out.replace('.png', '-before.png')]); };
try {
  // ---- the reference's lockup
  const ref = frame([]);
  ok(ref.lines === 2, `two lines are read (${ref.lines})`);
  ok(ref.key.category === 'serif' && ref.key.italic === true, `the key word reads as an italic serif (${ref.key.category}, slant ${ref.key.slant})`);
  ok(/^#f[0-9a-f]{1}[c-d][0-9a-f]0[0-9a-f]$/.test(ref.key.color) || /^#ff?d/.test(ref.key.color), `the key word's yellow is read (${ref.key.color})`);
  ok(ref.partner && ref.partner.category === 'sans' && !ref.partner.italic && ref.partner.case === 'upper' && ref.partner.color === '#ffffff', `the partner line reads as an upright sans in white capitals (${JSON.stringify(ref.partner)})`);
  ok(ref.partner.place === 'above' && ref.partner.scale < 0.35, `the partner line is small and above the key word (${ref.partner.place}, ${ref.partner.scale})`);
  ok(ref.glow >= 0.12, `the glow round the key word is read (${ref.glow})`);
  ok(Math.abs(ref.dim - 0.4) < 0.06, `the picture is read as about 40% darker with the title up (${ref.dim})`);
  const bare = frame(['--no-glow', '--no-dim']);
  ok(bare.glow < 0.12 && bare.dim < 0.06, `no glow and no dim where there is none (${bare.glow}, ${bare.dim})`);
  ok(bare.key.italic && bare.lines === 2, 'the lockup is still read without them');
  const plain = frame(['--plain']);
  ok(plain.key.category === 'sans' && plain.key.italic === false && plain.glow < 0.12, `a plain upright sans title is not read as an italic serif or as glowing (${plain.key.category}, slant ${plain.key.slant}, glow ${plain.glow})`);
  const one = frame(['--one']);
  ok(one.lines === 1 && !one.partner, `one big word alone is one line (${one.lines})`);
  const other = frame([], ['--key', '347 Days', '--partner', "THAT'D KEEP ME GOING FOR"]);
  ok(other.lines === 2 && other.key.italic && other.partner.case === 'upper', `another title of the same look reads the same ("347 Days": ${other.lines} lines, italic ${other.key.italic})`);
  // ---- every title folded into one look
  const sf = join(dir, 'rows.json'); writeFileSync(sf, JSON.stringify([ref, other, one, null]));
  const sum = py(['summary', '--json', sf]);
  ok(sum.lockup === 'two-line' && sum.two_line === 2 && sum.titles === 3, `two of three titles in two lines is a two-line lockup (${sum.lockup}, ${sum.two_line} of ${sum.titles})`);
  ok(sum.key.category === 'serif' && sum.key.italic && sum.partner.category === 'sans' && sum.partner.case === 'upper' && sum.glow > 0 && sum.dim > 0.3, `the look: ${JSON.stringify(sum)}`);
  writeFileSync(sf, JSON.stringify([one, plain && { ...plain, lines: 1, partner: undefined }, one]));
  ok(py(['summary', '--json', sf]).lockup === 'one-line', 'titles of one line are a one-line lockup');

  // ---- the recipe
  const look = V.titleLookFrom({ look: sum });
  ok(look.lockup === 'two-line' && look.pairing === 'instrument', `the pairing with an italic serif key face and a sans partner is instrument (${look.pairing})`);
  ok(look.glow && look.dim >= 0.3 && look.dim <= 0.6, `glow ${look.glow}, dim ${look.dim}`);
  const sansLook = V.titleLookFrom({ look: { titles: 3, two_line: 0, lockup: 'one-line', key: { category: 'sans', italic: false, case: 'upper', color: '#ffffff' }, glow: 0, dim: 0 } });
  ok(sansLook.lockup === 'one-line' && !sansLook.glow && !sansLook.dim && sansLook.partner === null, 'a plain one-line sans look asks for no partner line, glow or dim');
  ok(V.titleLookFrom(null) === null && V.titleLookFrom({ look: null }) === null, 'no title look read: nothing is set');
  // a small breakdown: two big two-line titles and the words said under them
  const cue = (t0, t1, text, conf, extra = {}) => ({ t0, t1, text, conf, bbox: [0.1, 0.18, 0.8, 0.18], line_h: 0.11, n_lines: 2, kind: 'scene', band: 'top', style: { fill: '#ffd400' }, ...extra });
  const b = { source: { file: 'ref.mp4', duration: 20 }, shots: [{ index: 1, start: 0, end: 10 }, { index: 2, start: 10, end: 20 }],
    packaging: { text_cues: [cue(1, 2.4, 'IF WE MADE/$30K', 0.95), cue(6, 7.4, "THAT'D KEEP ME GOING FOR/360 Days", 0.93), cue(12, 13.4, 'Inthe age of At,/be the signal,', 0.9, { anim_in: { kind: 'pop' } }), cue(16, 17.2, 'I DO NOT KNOW/Kng', 0.7)] },
    speech: { words: [[0.8, 1.0, 'if'], [1.0, 1.2, 'we'], [1.2, 1.5, 'made'], [1.5, 2.2, '$30k'], [5.6, 5.9, "that'd"], [5.9, 6.1, 'keep'], [6.1, 6.2, 'me'], [6.2, 6.5, 'going'], [6.5, 6.7, 'for'], [6.7, 7.0, '347'], [7.0, 7.3, 'days'], [11.8, 12.0, 'in'], [12.0, 12.1, 'the'], [12.1, 12.4, 'age'], [12.4, 12.5, 'of'], [12.5, 12.8, 'AI'], [12.8, 12.9, 'be'], [12.9, 13.0, 'the'], [13.0, 13.4, 'signal']] } };
  const res = V.convert(b, { title_look: { rows: [ref, other, ref, ref], look: sum } }, {});
  const md = res.md, style = md.split('## Style')[1].split('## Shots')[0];
  ok(/^- fonts: instrument$/m.test(md), 'Brand kit fonts is the pairing with the reference\'s two faces');
  for (const l of ['- title-lockup: two-line', '- title-key: italic serif', '- title-key-case: as-said', '- title-partner: sans above', '- title-partner-case: upper', '- title-partner-color: #ffffff', '- title-entrance: blur-rise']) ok(style.includes(l + '\n'), `Style has "${l}"`);
  ok(/- title-key-color: #f/.test(style) && /- title-glow: (soft|strong)/.test(style) && /- title-dim: 0\.\d+/.test(style), 'Style has the key colour, the glow and the dim');
  ok(/^#01 .*\| text IF WE MADE\/\$30K$/m.test(md) && !/^#01 .*check/m.test(md), 'a title read well has no check mark');
  ok(/^#02 .*\| check not the number said at that moment \|/m.test(md), '"360 Days" where the speaker says 347 days is marked');
  ok(/^#03 .*\| check /m.test(md) && /^#03 .*entrance pop-zoom/m.test(md), '"Inthe age of At,/be the signal," is marked, and its own entrance, which was read, stays');
  ok(/^#04 .*\| check read with low confidence \(70%\)/m.test(md), 'a title read with low confidence is marked');
  ok(res.titles.filter(t => t.lowConfidence).length === 3 && res.titles.every(t => !t.lowConfidence || t.why), 'titles.json carries lowConfidence and why');
  ok(/## Check these titles/.test(res.report) && /#2 at 6s: "THAT'D KEEP ME GOING FOR\/360 Days"/.test(res.report), 'the report lists the titles to check first');
  ok(/## Title look/.test(res.report) && /\| Pairing \| instrument \|/.test(res.report) && /blur-rise \(not read/.test(res.report), 'the report says the look that was read and the default entrance');
  // read back
  const r = RM.parse(md), v = RM.validate(r), pre = RM.toPreset(r), tl = pre.titleLook;
  ok(!v.errs.length, 'the recipe is valid: ' + v.errs.join('; '));
  ok(pre.fonts === 'instrument' && tl && tl.titleLockup === 'full' && tl.titleEntrance === 'blur-rise' && tl.titleGlow && tl.titleDim > 0.3, `the preset carries the look (${JSON.stringify(tl)})`);
  ok(tl.lockup.partnerUpper === true && tl.lockup.heroUpper === false && tl.lockup.partnerColor === '#ffffff' && /^#f/.test(tl.lockup.heroColor) && tl.lockup.arrange === 'stack', 'the lockup: partner in capitals, key word as said, their colours, stacked');
  ok(r.titles[1].check === 'not the number said at that moment' && r.titles[0].check === undefined, 'the check field reads back from the title line');
  const back = RM.titleLookLines({ ...tl });
  ok(JSON.stringify(RM.titleLookOf(Object.fromEntries(back.map(l => l.replace(/^- /, '').split(': '))))) === JSON.stringify(tl), 'the Style lines written from a job read back the same');
  { const e = []; RM.titleLookOf({ 'title-lockup': 'three', 'title-glow': 'huge', 'title-dim': '2', 'title-entrance': 'wobble', 'title-key-color': 'yellowish', 'caption-face': 'big' }, e); ok(e.length === 6, `bad values are refused, one error each (${e.length})`); }
  ok(JSON.stringify(RM.titleLookOf({ 'title-glow': 'off', 'title-dim': 'off', 'title-lockup': 'one-line' })) === '{}', 'off and one-line set nothing');

  // ---- the words alone
  ok(textDoubt({ text: 'Kng', start: 1, end: 2, conf: 0.95 }, []) && /does not read as a word/.test(textDoubt({ text: 'Kng', start: 1, end: 2, conf: 0.95 }, [])), '"Kng" does not read as a word');
  ok(!textDoubt({ text: 'IF WE MADE/$30K', start: 1, end: 2.4, conf: 0.95 }, b.speech.words), 'a clean title that is what is said passes');
  ok(!textDoubt({ text: 'How to pitch', start: 30, end: 31, conf: 0.9 }, []), 'no speech near it: the read itself decides');
  ok(!textDoubt({ text: 'CTA NOW', start: 30, end: 31, conf: 0.9 }, []), 'a short acronym in capitals is a word');

  // ---- the entrance default
  const caps = { titleEntrance: 'blur-rise', flips: [{ start: 1, end: 2, text: 'a', mode: 7 }, { start: 3, end: 4, text: 'b', mode: 7, entrance: 'slam' }, { start: 5, end: 6, text: 'c', mode: 7 }] };
  ok(R.resolveTitles(caps).map(t => t.entrance).join() === 'blur-rise,slam,blur-rise', 'titles with no entrance of their own take titleEntrance; a named one stays');
  ok(R.resolveTitles({ flips: caps.flips }).map(t => t.entrance).join() === 'stagger-rise,slam,blur-rise', 'without it the engine picks a free one for each, as before');
} catch (e) { failed++; console.error('FAIL the test stopped: ' + (e.stderr || e.stack || e.message)); }
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED, ${pass} passed` : `\n${pass} title look checks passed`);
process.exit(failed ? 1 : 0);
