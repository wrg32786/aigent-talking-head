// End-to-end smoke test on a synthetic clip. No footage, keys or network needed.
//   npm run smoke                 (or: node kit/smoke.mjs [--keep] [--whisper])
// Makes a 3 s colour-bars + tone clip with ffmpeg, fakes word timings, drafts captions with autocaption.mjs,
// renders stills and 2 s of overlay frames in headless Chrome (neutral theme, plus AIgent stills), assembles
// a 1080x1920 cut with seams, wooshes and a ducked bed, checks it with ffprobe, then runs the one-command
// reel.cjs path on faked clip.py output (retake skipped) and its --rebuild loop.
// --whisper also runs kit/tx.py with the tiny.en model (needs faster-whisper; downloads ~75 MB on first run).
// Effects pass: runs when effects are set up (npm run effects:setup) or with --effects: a face-free grade (moody),
// a face-tracking camera effect (locked-on) and a captions-off effect (checklist) on the one-command reel.
// The synthetic clip has no face, so this proves the pipeline runs and falls back cleanly, not detection quality.
// --keep leaves the work folder in place and prints its path.
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { findChrome } from './chrome.mjs';

const KIT = dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep'), whisper = process.argv.includes('--whisper');
const fxPy = join(dirname(KIT), 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const effects = process.argv.includes('--effects') || existsSync(fxPy);
const run = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).toString();
const step = (name, fn) => { process.stdout.write(`- ${name} ... `); const r = fn(); console.log('ok'); return r; };
const fail = m => { throw new Error(m); };

const work = mkdtempSync(join(tmpdir(), 'talking-head-smoke-'));
const build = join(work, 'build'); mkdirSync(build);
let ok = false;
try {
  step('ffmpeg and ffprobe on PATH', () => { run('ffmpeg', ['-version']); run('ffprobe', ['-version']); });
  step(`Chrome found (${findChrome()})`, () => {});
  step('synthetic clip + bed', () => {
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=48000',
      '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'seg1.mp4'], work);
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=8:sample_rate=48000', 'bed.wav'], work);
  });
  if (whisper) step('tx.py (faster-whisper tiny.en)', () => {
    const py = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
    run(py, [join(KIT, 'tx.py'), 'seg1.mp4'], work, { TX_MODEL: 'tiny.en' });
    if (!existsSync(join(work, 'words.json'))) fail('tx.py wrote no words.json');
  });
  // A tone has no speech, so word timings are faked in tx.py's format either way.
  writeFileSync(join(build, 'words.json'), JSON.stringify({ 'seg1.mp4': [[0.2, 0.5, 'This'], [0.5, 0.7, 'is'], [0.7, 0.9, 'a'], [0.9, 1.3, 'smoke'], [1.3, 1.7, 'test.'], [1.9, 2.2, 'Every'], [2.2, 2.6, 'seam'], [2.6, 2.9, 'glitches.']] }));
  writeFileSync(join(build, 'cut.json'), JSON.stringify({
    segs: [{ file: '../seg1.mp4', in: 0, out: 1.8, fadeIn: 0.25 }, { file: '../seg1.mp4', in: 1.8, out: 3.0, pad: 0.2, cropX: 0.3 }],
    tail: 0.3, hits: [[1.8, 24]], sfx: { F: [1.8], D: [2.4] }, bed: '../bed.wav', bedVol: 0.2, overlay: 'ovl/%04d.png'
  }));
  const node = process.execPath;
  step('timeline.mjs', () => { const o = run(node, [join(KIT, 'timeline.mjs')], build); if (!/seams: \[1\.8\]/.test(o)) fail('unexpected seams:\n' + o); });
  step('autocaption.mjs -> captions.js', () => {
    run(node, [join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--hero'], build);
    const src = readFileSync(join(build, 'captions.js'), 'utf8');
    const caps = JSON.parse(src.replace(/^window\.CAPTIONS=/, '').replace(/;\s*$/, ''));
    if (caps.flips.length < 3) fail('too few captions: ' + caps.flips.length);
    if (!caps.flips.some(f => f.mode === 1)) fail('no hero word from --hero');
    caps.flips.push({ start: 2.4, end: 3.2, text: 'STICKER', mode: 2 });   // exercise a second mode
    writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
  });
  step('render stills (neutral theme)', () => {
    run(node, [join(KIT, 'render.mjs'), '0', '0.6,1.9,2.6'], build);
    const s = readdirSync(join(build, 'stills')); if (s.length !== 3) fail('stills: ' + s);
    if (!/neutral/.test(readFileSync(join(build, 'theme.js'), 'utf8'))) fail('neutral theme not used by default');
    if (statSync(join(build, 'stills', 't0.60.png')).size < 8000) fail('caption still looks blank');
  });
  step('render overlay frames (2 s)', () => { run(node, [join(KIT, 'render.mjs'), '2'], build); const n = readdirSync(join(build, 'ovl')).length; if (n !== 48) fail('frames ' + n); });
  step('assemble.cjs -> smoke.mp4', () => run(node, [join(KIT, 'assemble.cjs'), 'smoke.mp4'], build));
  step('output is 1080x1920 with audio, ~3.5 s', () => {
    const j = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', 'smoke.mp4'], build));
    const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio'), d = +j.format.duration;
    if (!v || v.width !== 1080 || v.height !== 1920) fail('bad video stream ' + JSON.stringify(v));
    if (!a) fail('no audio stream');
    if (Math.abs(d - 3.5) > 0.25) fail('duration ' + d);
  });
  step('AIgent preset stills', () => {
    rmSync(join(build, 'theme.js'));
    run(node, [join(KIT, 'render.mjs'), '0', '0.6'], build, { THEME: 'aigent' });
    if (!/aigent/.test(readFileSync(join(build, 'theme.js'), 'utf8'))) fail('aigent theme not copied');
  });
  step('reel.cjs one-command path (faked clip.py output, 1 retake)', () => {
    const clips = join(work, 'clips'); mkdirSync(clips);
    const mk = (n, f) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1080x1920:rate=24:duration=1.5`, '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=1.5:sample_rate=48000`,
      '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `clip-00${n}.mp4`], clips);
    mk(1, 300); mk(2, 400); mk(3, 500);
    const w = txt => txt.split(' ').map((x, i) => [0.1 + i * 0.3, 0.35 + i * 0.3, x]);
    writeFileSync(join(clips, 'clips.json'), JSON.stringify({ src: 'synthetic', clips: [
      { id: 'clip-001', file: 'clips/clip-001.mp4', dur: 1.5, status: 'retake(see clip-002)', text: 'Hi I mean', words: w('Hi I mean') },
      { id: 'clip-002', file: 'clips/clip-002.mp4', dur: 1.5, status: 'keep', text: 'Hi team, this works.', words: w('Hi team, this works.') },
      { id: 'clip-003', file: 'clips/clip-003.mp4', dur: 1.5, status: 'keep', text: 'Drop clips in inbox.', words: w('Drop clips in inbox.') }] }));
    run(node, [join(KIT, 'reel.cjs'), '--clips', clips, '--jobs', join(work, 'jobs'), '--name', 'smoke-reel'], work);
    const cut = JSON.parse(readFileSync(join(work, 'jobs', 'smoke-reel', 'build', 'cut.json'), 'utf8'));
    if (cut.segs.length !== 2) fail('retake not skipped: ' + cut.segs.length + ' segs');
    const out = join(work, 'jobs', 'smoke-reel', 'reel-v1.mp4'); if (!existsSync(out)) fail('no reel-v1.mp4');
    const d = +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim();
    if (Math.abs(d - 3.3) > 0.25) fail('reel duration ' + d);
    run(node, [join(KIT, 'reel.cjs'), '--rebuild', '--jobs', join(work, 'jobs'), '--name', 'smoke-reel'], work);
    if (!existsSync(join(work, 'jobs', 'smoke-reel', 'reel-v2.mp4'))) fail('--rebuild did not write reel-v2.mp4');
  });
  if (effects) step('effects pass: moody + locked-on + checklist (captions off) + glass-widgets (no pill, no upstream sample content), check frames + render', () => {
    if (!existsSync(fxPy)) fail('effects not set up: npm run effects:setup');
    run(node, [join(dirname(KIT), 'effects', 'check.mjs')], work);
    const plan = join(work, 'fx.json');
    writeFileSync(plan, JSON.stringify({ profile: { name: 'Smoke', handle: '@smoke' }, effects: [
      { fx: 'moody', start: 0, end: 1.2, grade: 'cool' },
      { fx: 'locked-on', start: 0.2, end: 1.4, text: 'SMOKE' },
      { fx: 'checklist', start: 1.6, end: 3.1, text: 'Record::phone|Drop::inbox|Ask::your agent', title: 'Smoke test' },
      { fx: 'glass-widgets', start: 2.2, end: 3.2, text: '3X', title: 'Smoke', sub: 'reels|this week', chart: 'Signups::1.2K::3|5|8|13|21' }] }));
    // glass-widgets has no pill unless the plan opts in
    const jobs = join(work, 'jobs'), fxdir = join(jobs, 'smoke-reel', 'build', 'fx');
    const pillOf = () => JSON.parse(readFileSync(join(fxdir, 'plan.resolved.json'), 'utf8')).effects.find(e => e.fx === 'glass-widgets').pill;
    run(node, [join(KIT, 'fx.cjs'), '--name', 'smoke-reel', '--jobs', jobs, '--plan', plan, '--still', '0.8,2.4'], work);
    if (readdirSync(fxdir).filter(f => /^check_.*\.png$/.test(f)).length !== 2) fail('expected 2 check frames: ' + readdirSync(fxdir));
    if (pillOf() !== '') fail('Edited-by pill should be off by default, got ' + JSON.stringify(pillOf()));
    const resolved = readFileSync(join(fxdir, 'plan.resolved.json'), 'utf8');
    if (/vibha|claude|soft UI pops|Top reels|197K|Post 2 reels/i.test(resolved)) fail('upstream sample content leaked into the plan: ' + resolved);
    const gw = JSON.parse(resolved).effects.find(e => e.fx === 'glass-widgets');
    if (gw.song !== 'smoke-reel' || !gw.day || gw.handle !== '@smoke') fail('neutral fills missing: ' + JSON.stringify(gw));
    run(node, [join(KIT, 'fx.cjs'), '--name', 'smoke-reel', '--jobs', jobs, '--plan', plan], work);
    const out = join(jobs, 'smoke-reel', 'reel-fx-v1.mp4'); if (!existsSync(out)) fail('no reel-fx-v1.mp4');
    const j = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', out]));
    const v = j.streams.find(s => s.codec_type === 'video');
    if (!v || v.width !== 1080 || v.height !== 1920 || !j.streams.some(s => s.codec_type === 'audio')) fail('bad fx output ' + JSON.stringify(j.streams));
    if (Math.abs(+j.format.duration - 3.3) > 0.25) fail('fx reel duration ' + j.format.duration);
    writeFileSync(plan.replace('fx.json', 'bad.json'), JSON.stringify({ effects: [{ fx: 'backdrop-word', start: 0, end: 1 }] }));
    try { run(node, [join(KIT, 'fx.cjs'), '--name', 'smoke-reel', '--jobs', jobs, '--plan', plan.replace('fx.json', 'bad.json')], work); fail('demo-copy check did not fire'); } catch (e) { if (!/need your own copy/.test(String(e.stderr || ''))) throw e; }
  });
  else console.log('- effects pass ... skipped (npm run effects:setup to include it)');
  ok = true;
  console.log('\nSMOKE PASS' + (keep ? `  (work folder: ${work})` : ''));
} catch (e) {
  console.log('FAIL');
  console.error(e.stderr ? e.stderr.toString() : '', e.message);
  console.error(`work folder kept for inspection: ${work}`);
} finally {
  if (ok && !keep) rmSync(work, { recursive: true, force: true });
  process.exitCode = ok ? 0 : 1;
}
