// Camera moves you can see (Studio report 4, item 10: the reference's pushes came across as 3.5 and 7 percent, which
// a talking head does not show; the user asked for "the camera motion the reference had").
// - kit/camera_move.py measures how far the camera moves inside a shot (a push, a pull, a still shot)
// - the teardown's size goes into the recipe as "move-size" and comes back out of it
// - the motion strength (Subtle, Medium, Strong) sizes every move; Medium is the default, and at Medium a push is
//   never under 8 percent
// - a rebuild with a new strength sizes the moves again
// - Studio: pace.motion, the --motion argument, and the control shows only when a reference or a saved look is in use
// Run: node tests/motion.test.mjs   (needs ffmpeg and Python with OpenCV; part of npm run check)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const PY = process.env.PYTHON || [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')].find(f => existsSync(f)) || (process.platform === 'win32' ? 'py' : 'python3');
const TMP = mkdtempSync(join(tmpdir(), 'motion-test-'));
process.env.STUDIO_DIR = join(TMP, 'studio'); process.env.LOOKS_DIR = join(TMP, 'looks'); mkdirSync(process.env.STUDIO_DIR, { recursive: true });
const SPL = require('../kit/shotplan.cjs'), RC = require('../kit/recreate.cjs'), RM = require('../kit/reelmd.cjs'), V2R = require('../kit/videomd2reel.cjs'), SL = require('../kit/stylelook.cjs'), LK = require('../kit/lookplan.cjs');
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const ff = a => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'pipe'] });

try {
  t('the measure reads a push, a pull and a still shot', () => {
    const base = join(TMP, 'base.mp4'), mv = join(TMP, 'mv.mp4');
    // one still test picture with a little noise: the only thing that moves is the camera
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=24:d=1', '-frames:v', '1', join(TMP, 'still.png')]);
    ff(['-loop', '1', '-r', '24', '-t', '6', '-i', join(TMP, 'still.png'), '-vf', 'noise=alls=6:allf=t', '-pix_fmt', 'yuv420p', base]);
    const zp = (a, b, z) => `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS,scale=1080:1920,zoompan=z='${z}':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*0.4':d=1:s=540x960:fps=24`;
    ff(['-i', base, '-filter_complex', `${zp(0, 2, '1+0.10*min(on/48,1)')}[a];${zp(2, 4, '1.06-0.06*min(on/48,1)')}[b];[0:v]trim=4:6,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1[v]`, '-map', '[v]', '-pix_fmt', 'yuv420p', mv]);
    const r = JSON.parse(execFileSync(PY, [join(ROOT, 'kit', 'camera_move.py'), 'measure', mv, '--spans', '0-2,2-4,4-6,6-6.05'], { encoding: 'utf8' })).spans;
    assert.ok(Math.abs(r[0].scale - 0.10) < 0.02, 'a 10% push reads as about 10%: ' + r[0].scale);
    assert.ok(Math.abs(r[1].scale + 0.057) < 0.02 && r[1].scale < -0.03, 'a 6% pull reads as a pull: ' + r[1].scale);
    assert.ok(Math.abs(r[2].scale) < 0.01 && Math.hypot(r[2].dx, r[2].dy) < 0.02, 'a still shot has no move: ' + JSON.stringify(r[2]));
    assert.strictEqual(r[3], null, 'a span with no frames has no numbers');
    assert.strictEqual(SPL.measuredMove(r[0]), 'push'); assert.strictEqual(SPL.measuredMove(r[1]), 'pull'); assert.strictEqual(SPL.measuredMove(r[2]), null);
  });

  t('a measured move gets a name; a named move keeps its name; a wobble is not a move', () => {
    assert.deepStrictEqual(SPL.moveFor({}, { scale: 0.05, dx: 0, dy: 0 }), ['push']);
    assert.deepStrictEqual(SPL.moveFor({}, { scale: -0.03, dx: 0, dy: 0 }), ['pull']);
    assert.deepStrictEqual(SPL.moveFor({}, { scale: 0.004, dx: 0.06, dy: 0 }), ['drift']);
    assert.deepStrictEqual(SPL.moveFor({}, { scale: 0.012, dx: 0.01, dy: 0.01 }), []);
    assert.deepStrictEqual(SPL.moveFor({ move: 'pan / track' }, { scale: 0.05 }), ['drift'], 'the name rea-video gave wins');
    assert.deepStrictEqual(SPL.moveFor({ move: 'push in' }), ['push']);
    assert.strictEqual(SPL.measuredSize('push', { scale: 0.0352 }), 0.035); assert.strictEqual(SPL.measuredSize('pull', { scale: -0.07 }), 0.07);
    assert.strictEqual(SPL.measuredSize('drift', { scale: 0.05 }), null);
  });

  t('Medium is the default and a push shows: the report\'s 3.5% and 7% become 8% and more', () => {
    assert.strictEqual(SPL.MOTION_DEFAULT, 'medium');
    for (const z of [0.01, 0.035, 0.07, 0.1, 0.3]) { const v = SPL.moveSize('push', 'medium', z); assert.ok(v >= 0.08 && v <= 0.16, `a ${z} push at Medium is 8% to 16%: ${v}`); }
    assert.ok(SPL.moveSize('push', 'medium', 0.07) > SPL.moveSize('push', 'medium', 0.035), 'a bigger move in the reference stays bigger');
    assert.strictEqual(SPL.moveSize('push', undefined, 0.07), SPL.moveSize('push', 'medium', 0.07));
    for (const mv of ['push', 'pull', 'drift']) {
      const [a, b, c] = ['subtle', 'medium', 'strong'].map(k => Math.abs(SPL.moveSize(mv, k)));
      assert.ok(a < b && b < c, `${mv}: subtle < medium < strong`);
      const [x, y, z] = ['subtle', 'medium', 'strong'].map(k => Math.abs(SPL.moveSize(mv, k, 0.06)));
      assert.ok(x <= y && y <= z, `${mv} with a measured size: subtle <= medium <= strong`);
    }
    assert.ok(SPL.moveSize('pull', 'medium') < 0 && SPL.moveSize('pull', 'medium', 0.05) < 0, 'a pull is a minus push');
    assert.ok(Math.abs(SPL.moveSize('pull', 'medium')) >= 0.1 && Math.abs(SPL.moveSize('pull', 'medium')) <= 0.12, 'a pull at Medium is 10% to 12%');
    assert.deepStrictEqual(['push', 'pull', 'drift'].map(m => SPL.moveSize(m, 'subtle')), [0.07, -0.07, 0.035], 'Subtle is what every move was before');
    assert.strictEqual(SPL.moveSize('spin', 'medium'), null);
  });

  // a breakdown with a measured move per shot, as kit/teardown.py extras writes it
  const shot = (i, a, b, cam = {}) => ({ index: i, start: a, end: b, transition_in: i > 1 ? 'cut' : 'start', aspects: { camera: { measured: cam, result: cam } } });
  const B = { source: { file: 'ref.mp4', duration: 12, width: 1080, height: 1920, fps: 30 }, shots: [shot(1, 0, 3), shot(2, 3, 6), shot(3, 6, 9, { move: 'pull out' }), shot(4, 9, 12)], speech: { words: [], lines: [] }, packaging: { text_cues: [], stickers: [] } };
  const EX = { shots: [{ move: { scale: 0.004, dx: 0, dy: 0 } }, { move: { scale: 0.035, dx: 0, dy: 0 } }, { move: { scale: -0.07, dx: 0, dy: 0 } }, {}] };
  let recipe;
  t('the measured size is written to the recipe and read back', () => {
    const res = V2R.convert(B, EX, { name: 'motion-ref' });
    const lines = res.md.split('\n').filter(l => /^#0\d /.test(l));
    assert.ok(!/move/.test(lines[0]) && !/move/.test(lines[3]), 'no move where none was measured');
    assert.ok(/\| move push \| move-size 0\.035/.test(lines[1]), lines[1]);
    assert.ok(/\| move pull \| move-size 0\.07/.test(lines[2]), lines[2]);
    recipe = RM.parse(res.md, 'Reel.md');
    const ss = RM.shotSettings(recipe);
    assert.deepStrictEqual(ss.map(s => [s.move || null, s.moveSize || null]), [[null, null], ['push', 0.035], ['pull', 0.07], [null, null]]);
  });

  const segsOf = () => [0, 1, 2, 3].map(i => ({ file: `c${i}.mp4`, in: 0, out: 3 }));
  t('a draft sizes the moves by the strength, from the reference\'s own size', () => {
    const run = motion => { const segs = segsOf(); RC.applyShotPlan({ recipe, segs, clipStart: [0, 1, 2, 3], wantPunch: false, ...(motion ? { motion } : {}) }); return segs; };
    const med = run(), sub = run('subtle'), str = run('strong');
    assert.deepStrictEqual(med.map(s => s.push ?? null), [null, 0.08, -0.112, null]);
    assert.deepStrictEqual(med.map(s => s.move ?? null), [null, 'push', 'pull', null]); assert.strictEqual(med[1].moveRef, 0.035);
    assert.deepStrictEqual(sub.map(s => s.push ?? null), [null, 0.04, -0.07, null]);
    assert.ok(str[1].push > med[1].push && str[2].push < med[2].push);
    assert.ok(/motion: medium; 1 push of 8%, 1 pull of 11% on 2 of 4 pieces \(2 sized from the reference's own move\)/.test(RC.motionLine(med, 'medium')), RC.motionLine(med, 'medium'));
    const plan = RC.planOf({ recipe, cut: { segs: med, motion: 'medium' } });
    assert.strictEqual(plan.motion, 'medium'); assert.deepStrictEqual(plan.moves.map(m => [m.move, m.push, m.measured]), [['push', 0.08, 0.035], ['pull', -0.112, 0.07]]);
  });

  t('re-cut shots that play as one keep the long shot\'s move', () => {
    // the reference: 1 s still, 1 s still, then an 11 s push; your take had no quiet to cut the first two on
    const r = RM.parse(['---', 'name: m', '---', '', '# m', '', '## Shots', '', '```videomd-timeline', '#01 0-1 | story hook', '#02 1-2 | story beat', '#03 2-13 | story beat | move push | move-size 0.038', '#04 13-16 | story payoff | move pull | move-size 0.031', '```', ''].join('\n'), 'Reel.md');
    const segs = [{ file: 'a.mp4', in: 0, out: 6 }, { file: 'a.mp4', in: 6, out: 8 }];
    RC.applyShotPlan({ recipe: r, segs, rc: { shotStart: [0, 1], shotOf: [0, 3] }, wantPunch: false });
    assert.deepStrictEqual([segs[0].move, segs[0].push, segs[0].moveRef], ['push', 0.08, 0.038], 'the 11 s push is on the piece that stands for shots 1 to 3');
    assert.deepStrictEqual([segs[1].move, segs[1].push], ['pull', -0.08]);
    // a short move inside a long still stretch is not spread over it
    const r2 = RM.parse(['---', 'name: m', '---', '', '# m', '', '## Shots', '', '```videomd-timeline', '#01 0-9 | story hook', '#02 9-10 | story beat | move push', '#03 10-12 | story payoff', '```', ''].join('\n'), 'Reel.md');
    const s2 = [{ file: 'a.mp4', in: 0, out: 5 }, { file: 'a.mp4', in: 5, out: 6 }]; RC.applyShotPlan({ recipe: r2, segs: s2, rc: { shotStart: [0, 1], shotOf: [0, 2] }, wantPunch: false });
    assert.strictEqual(s2[0].push, undefined);
  });

  t('a rebuild with a new strength sizes the moves again; a big punch keeps its own move', () => {
    const segs = segsOf(); RC.applyShotPlan({ recipe, segs, clipStart: [0, 1, 2, 3], wantPunch: false });
    segs[3].bigPunch = true;
    assert.strictEqual(RC.resizeMoves(segs, 'strong'), 2);
    assert.deepStrictEqual(segs.map(s => s.push ?? null), [null, SPL.moveSize('push', 'strong', 0.035), SPL.moveSize('pull', 'strong', 0.07), null]);
    // a job drafted before 1.28.0 has only "push": the sign says what it was
    const old = [{ push: 0.07 }, { push: -0.07 }, {}]; RC.resizeMoves(old, 'medium');
    assert.deepStrictEqual(old.map(s => [s.move || null, s.push ?? null]), [['push', 0.12], ['pull', -0.11], [null, null]]);
  });

  t('a recipe with no measured size (an older teardown) still gets a move that shows', () => {
    const r = RM.parse(V2R.convert(B, {}, { name: 'old-ref' }).md, 'Reel.md'), segs = segsOf();
    RC.applyShotPlan({ recipe: r, segs, clipStart: [0, 1, 2, 3], wantPunch: false });
    assert.deepStrictEqual(segs.map(s => s.push ?? null), [null, null, -0.11, null]); assert.ok(!('moveRef' in segs[2]));
  });

  t('a saved look carries the middle size of the reference\'s pushes and Copy the look draws it', () => {
    const dir = join(TMP, 'td'); mkdirSync(dir, { recursive: true });
    const many = { ...B, shots: Array.from({ length: 8 }, (_, i) => shot(i + 1, i * 2, i * 2 + 2)), source: { ...B.source, duration: 16 } };
    const ex = { shots: many.shots.map((_, i) => (i % 2 ? { move: { scale: 0.05, dx: 0, dy: 0 } } : {})) };
    require('fs').writeFileSync(join(dir, 'Reel.md'), V2R.convert(many, ex, { name: 'look-ref' }).md);
    const look = SL.fromTeardown(dir, { name: 'motion-look' });
    assert.strictEqual(look.moves.size.push, 0.05); assert.ok(look.moves.push >= 0.4);
    const segs = [{ file: 'a.mp4', in: 0, out: 20 }], words = Array.from({ length: 40 }, (_, i) => [i * 0.5, i * 0.5 + 0.3, 'word' + i + (i % 4 === 3 ? '.' : '')]);
    LK.cut({ look, segs, words: () => words, quiet: (i, a, b) => (a + b) / 2, seed: 'x', motion: 'strong' });
    const pushed = segs.filter(s => s.push != null);
    assert.ok(pushed.length >= 1, 'the look puts a push on some shots'); assert.ok(pushed.every(s => s.push === SPL.moveSize('push', 'strong', 0.05) && s.move === 'push'));
  });

  const cat = C.catalog();
  t('Studio: Medium unless you pick, the pick goes to the draft as --motion, a wrong value is refused', () => {
    const s = C.defaultState(); s.job = 'v';
    assert.strictEqual(C.motionOf(s).value, 'medium'); assert.ok(!C.compose(s).args.includes('--motion'), 'nothing sent until you pick: the engine starts at Medium');
    assert.deepStrictEqual(C.applyPatch(s, { pace: { motion: 'strong' } }, cat).errs, []);
    const a = C.compose(s).args; assert.strictEqual(a[a.indexOf('--motion') + 1], 'strong'); assert.strictEqual(C.motionOf(s).value, 'strong');
    assert.ok(C.applyPatch(s, { pace: { motion: 'wild' } }, cat).errs.length, 'wild is refused'); assert.strictEqual(s.pace.motion, 'strong');
    assert.deepStrictEqual(C.applyPatch(s, { pace: { motion: null } }, cat).errs, []); assert.strictEqual(C.motionOf(s).value, 'medium');
    assert.deepStrictEqual(C.motionOf(s).options.map(o => o.label), ['Subtle', 'Medium', 'Strong']);
  });

  t('Studio: the control shows only when a reference or a saved look is in use', () => {
    const s = C.defaultState(); s.job = 'v';
    assert.strictEqual(C.motionOf(s).on, false, 'no reference: nothing to size');
    s.reference = { ...s.reference, mode: 'recreate', status: 'ready', extracted: { shots: 4 } }; assert.strictEqual(C.motionOf(s).on, true);
    s.reference.mode = 'off'; assert.strictEqual(C.motionOf(s).on, false);
    s.styleLook = 'my-look'; assert.strictEqual(C.motionOf(s).on, true);
  });

  console.log(`\nmotion: ${n} tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
