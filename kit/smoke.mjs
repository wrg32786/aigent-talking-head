// End-to-end smoke test on a synthetic clip. No footage, keys or network needed.
// The person mask uses MediaPipe (--mask mediapipe) so this does not download birefnet-general-lite (~214 MB).
//   npm run smoke                 (or: node kit/smoke.mjs [--keep] [--whisper])
// Makes a 3 s colour-bars + tone clip with ffmpeg, fakes word timings, drafts captions with autocaption.mjs,
// renders stills and 2 s of overlay frames in headless Chrome (AIgent theme default, plus a neutral still), assembles
// a 1080x1920 cut with seams, wooshes and a ducked bed, checks it with ffprobe, then runs the one-command
// reel.cjs path on faked clip.py output (retake skipped) and its --rebuild loop.
// --whisper also runs kit/tx.py with the tiny.en model (needs faster-whisper; downloads ~75 MB on first run).
// Effects pass: runs when effects are set up (npm run effects:setup) or with --effects: a face-free grade (moody),
// a face-tracking camera effect (locked-on) and a captions-off effect (checklist) on the one-command reel.
// The synthetic clip has no face, so this proves the pipeline runs and falls back cleanly, not detection quality.
// --keep leaves the work folder in place and prints its path.
import { execFileSync } from 'child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { findChrome } from './chrome.mjs';
import { createRequire } from 'module';
const SFXPLAN = createRequire(import.meta.url)('./sfx-plan.cjs');
const B = createRequire(import.meta.url)('./beats.cjs');

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
  step('render stills (aigent theme default)', () => {
    run(node, [join(KIT, 'render.mjs'), '0', '0.6,1.9,2.6'], build);
    const s = readdirSync(join(build, 'stills')); if (s.length !== 3) fail('stills: ' + s);
    if (!/aigent/.test(readFileSync(join(build, 'theme.js'), 'utf8'))) fail('aigent theme not used by default');
    if (statSync(join(build, 'stills', 't0.60.png')).size < 8000) fail('caption still looks blank');
  });
  step('render overlay frames (2 s)', () => { run(node, [join(KIT, 'render.mjs'), '2'], build); const n = readdirSync(join(build, 'ovl')).length; if (n !== 48) fail('frames ' + n); });
  step('sfx pack manifest + auto-pick', () => {
    const v = SFXPLAN.validateManifest();
    if (v.errs.length) fail('sfx.json: ' + v.errs.join('; '));
    const man = SFXPLAN.loadManifest();
    if (man.sounds.length !== 31) fail('expected 31 pack sounds, got ' + man.sounds.length);
    const hits = SFXPLAN.planHits([
      { fx: 'locked-on', start: 0.0, end: 1.0 },
      { fx: 'rabbit-hole', start: 1.2, end: 2.4 },
      { fx: 'huge-strike', start: 2.6, end: 4.0 },
      { fx: 'timeline', start: 2.65, end: 3.4, sfx: false },
      { fx: 'spotlight', start: 4.2, end: 5.5, sfx: '24-shimmer-sparkle-b' }
    ]);
    if (!hits.some(h => h.fx === 'locked-on' && h.role === 'primary')) fail('no primary for locked-on: ' + JSON.stringify(hits));
    if (!hits.some(h => h.fx === 'rabbit-hole' && h.role === 'riser')) fail('rabbit-hole should get a riser');
    if (!hits.some(h => h.fx === 'huge-strike' && h.role === 'release')) fail('huge-strike should get a release');
    if (hits.some(h => h.fx === 'timeline')) fail('sfx:false was ignored');
    const spot = hits.find(h => h.fx === 'spotlight' && h.role === 'primary');
    if (!spot || spot.id !== '24-shimmer-sparkle-b') fail('override not honoured: ' + JSON.stringify(spot));
    const primaries = hits.filter(h => h.role === 'primary').map(h => h.id);
    if (new Set(primaries).size !== primaries.length) fail('primary ids repeated: ' + primaries);
  });
  step('assemble.cjs places a pack sound', () => {
    const cut = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8'));
    cut.sfxHits = [{ id: '11-pop-sticker', t: 1.2 }];
    writeFileSync(join(build, 'cut.json'), JSON.stringify(cut));
    const log = run(node, [join(KIT, 'assemble.cjs'), 'smoke-pack.mp4'], build);
    if (!existsSync(join(build, 'smoke-pack.mp4'))) fail('no smoke-pack.mp4\n' + log);
    const d = +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'smoke-pack.mp4'], build).trim();
    if (Math.abs(d - 3.5) > 0.25) fail('pack assemble duration ' + d);
  });
  step('assemble.cjs -> smoke.mp4', () => run(node, [join(KIT, 'assemble.cjs'), 'smoke.mp4'], build));
  step('output is 1080x1920 with audio, ~3.5 s', () => {
    const j = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', 'smoke.mp4'], build));
    const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio'), d = +j.format.duration;
    if (!v || v.width !== 1080 || v.height !== 1920) fail('bad video stream ' + JSON.stringify(v));
    if (!a) fail('no audio stream');
    if (Math.abs(d - 3.5) > 0.25) fail('duration ' + d);
  });
  step('neutral preset stills', () => {
    rmSync(join(build, 'theme.js'));
    run(node, [join(KIT, 'render.mjs'), '0', '0.6'], build, { THEME: 'neutral' });
    if (!/neutral/.test(readFileSync(join(build, 'theme.js'), 'utf8'))) fail('neutral theme not copied');
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
    run(node, [join(KIT, 'reel.cjs'), '--clips', clips, '--jobs', join(work, 'jobs'), '--name', 'smoke-reel', '--mask', 'mediapipe'], work);
    const cut = JSON.parse(readFileSync(join(work, 'jobs', 'smoke-reel', 'build', 'cut.json'), 'utf8'));
    if (cut.segs.length !== 2) fail('retake not skipped: ' + cut.segs.length + ' segs');
    const dcap = readFileSync(join(work, 'jobs', 'smoke-reel', 'build', 'captions.js'), 'utf8');
    if (!/"captionStyle": "kinetic"/.test(dcap) || !/"mode": 7/.test(dcap)) fail('default look should be kinetic captions + titles');
    const out = join(work, 'jobs', 'smoke-reel', 'reel-v1.mp4'); if (!existsSync(out)) fail('no reel-v1.mp4');
    const d = +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim();
    if (Math.abs(d - 3.3) > 0.25) fail('reel duration ' + d);
    run(node, [join(KIT, 'reel.cjs'), '--rebuild', '--jobs', join(work, 'jobs'), '--name', 'smoke-reel', '--mask', 'mediapipe'], work);
    if (!existsSync(join(work, 'jobs', 'smoke-reel', 'reel-v2.mp4'))) fail('--rebuild did not write reel-v2.mp4');
  });
  // --- Muse edit rules: multi-take picking, zoom punch, kinetic titles, pills, named transitions, sound rules, check, verify
  step('clip.py multi-take: best take per sentence across files (word times given, no Whisper)', () => {
    const mt = join(work, 'mt'); mkdirSync(mt);
    for (const [n, f] of [[1, 300], [2, 500]]) run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=6', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=6:sample_rate=48000`, '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `take${n}.mp4`], mt);
    const W = (list, p) => list.flatMap(([t0, txt]) => txt.split(' ').map((w, i) => [t0 + i * 0.3, t0 + i * 0.3 + 0.28, w, p]));
    writeFileSync(join(mt, 'words.json'), JSON.stringify({
      'take1.mp4': [...W([[0.2, 'Stop editing reels by hand.']], 0.95), ...W([[2.4, 'Drop the the clip in.']], 0.5), ...W([[4.4, 'Ask for the reel.']], 0.9)],
      'take2.mp4': [...W([[0.2, 'Stop editing reels by hand.']], 0.6), ...W([[2.4, 'Drop the clip in inbox.']], 0.95), ...W([[4.4, 'Ask for the reel.']], 0.92)] }));
    const py = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
    run(py, [join(KIT, 'clip.py'), 'take1.mp4', 'take2.mp4', '--words', 'words.json', '--out', 'clips', '--min', '1', '--vertical'], mt);
    const cj = JSON.parse(readFileSync(join(mt, 'clips', 'clips.json'), 'utf8')).clips, keep = cj.filter(c => c.status.startsWith('keep'));
    const got = keep.map(c => `${c.take}:${c.text}`).join(' / ');
    if (got !== 'take1.mp4:Stop editing reels by hand. / take2.mp4:Drop the clip in inbox. / take2.mp4:Ask for the reel.') fail('multi-take picks: ' + got);
    if (cj.filter(c => /^retake\(see clip-\d+\)/.test(c.status)).length !== 3) fail('expected 3 retakes pointing at their winner: ' + cj.map(c => c.status));
    run(py, [join(KIT, 'clip.py'), 'take1.mp4', 'take2.mp4', '--words', 'words.json', '--out', 'clips-hook', '--min', '1', '--hook', 'take2.mp4'], mt);
    const hk = JSON.parse(readFileSync(join(mt, 'clips-hook', 'clips.json'), 'utf8')).clips.filter(c => c.status.startsWith('keep'))[0];
    if (hk.take !== 'take2.mp4') fail('--hook did not pick the hook take: ' + hk.take);
  });
  step('reel.cjs --look muse: punch, big punches, titles (7 entrances, no repeats), pills, few sounds, mask, render', () => {
    const clips = join(work, 'clips-muse'); mkdirSync(clips);
    const lines = ['Stop editing reels by hand.', 'Record one take on your phone.', 'Drop the file in the inbox.', 'Ask your agent for the reel.'];
    lines.forEach((_, i) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=24:duration=1.6', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 100}:duration=1.6:sample_rate=48000`,
      '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `clip-00${i + 1}.mp4`], clips));
    const w = txt => txt.split(' ').map((x, i) => [0.1 + i * 0.25, 0.33 + i * 0.25, x]);
    writeFileSync(join(clips, 'clips.json'), JSON.stringify({ src: 'synthetic', clips: lines.map((t, i) => ({ id: `clip-00${i + 1}`, file: `clips/clip-00${i + 1}.mp4`, dur: 1.6, status: 'keep', text: t, words: w(t) })) }));
    run(node, [join(KIT, 'reel.cjs'), '--clips', clips, '--jobs', join(work, 'jobs'), '--name', 'muse', '--look', 'muse', '--mask', 'mediapipe'], work);
    const b = join(work, 'jobs', 'muse', 'build');
    const cut = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8'));
    if (cut.punch !== 0.1 || !cut.segs[1].bigPunch || !cut.segs[3].bigPunch || cut.segs[2].bigPunch) fail('punch plan: ' + JSON.stringify(cut.segs.map(s => s.bigPunch || 0)));
    if ((cut.sfx.whoosh || []).length >= 3 || !(cut.sfx.boom || []).length || cut.sfx.F) fail('sound plan is not fewer and deeper: ' + JSON.stringify(cut.sfx));
    const caps = JSON.parse(readFileSync(join(b, 'captions.js'), 'utf8').replace(/^window\.CAPTIONS=/, '').replace(/;\s*$/, ''));
    if (caps.captionStyle !== 'pill' || caps.flips.filter(f => f.mode === 0).some(f => !f.words)) fail('pill captions without word times');
    if (caps.flips.filter(f => f.mode === 0).some(f => caps.flips.some(t => t.mode === 7 && t.start === f.start))) fail('a titled phrase is still on the caption track');
    const titles = caps.flips.filter(f => f.mode === 7);
    if (titles.length !== 4) fail('expected one title per beat, got ' + titles.length);
    if (readdirSync(join(b, 'ovlt')).length !== readdirSync(join(b, 'ovl')).length) fail('title layer frames missing');
    if (existsSync(fxPy) && !existsSync(join(b, 'mask.mkv'))) fail('no person mask with the effects venv present');
    const out = join(work, 'jobs', 'muse', 'reel-v1.mp4'); if (!existsSync(out)) fail('no muse reel');
    const d = +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim();
    if (Math.abs(d - 6.7) > 0.2) fail('muse reel duration ' + d);
  });
  step('title entrances: mid-entrance differs from settled, all seven resolve once, flicker on hook + payoff only', () => {
    const b = join(work, 'jobs', 'muse', 'build');
    const caps = JSON.parse(readFileSync(join(b, 'captions.js'), 'utf8').replace(/^window\.CAPTIONS=/, '').replace(/;\s*$/, ''));
    caps.flips = caps.flips.filter(f => f.mode !== 7);
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'].forEach((t, i) => caps.flips.push({ start: i * 0.9, end: i * 0.9 + 0.85, text: t, mode: 7 }));
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
    const o = run(node, [join(KIT, 'render.mjs'), '0', '0.1,0.7'], b);
    const m = o.match(/titles (.*)/); if (!m) fail('render did not report titles');
    const ent = m[1].split(', ').map(x => x.split(' ')[1].replace('+flicker', ''));
    if (new Set(ent).size !== 7) fail('entrances repeat: ' + m[1]);
    const fl = m[1].split(', ').map(x => /\+flicker/.test(x)); if (!fl[0] || !fl[6] || fl.slice(1, 6).some(Boolean)) fail('flicker placement: ' + m[1]);
    const a = readFileSync(join(b, 'stills', 't0.10.png')), z = readFileSync(join(b, 'stills', 't0.70.png'));
    if (a.equals(z)) fail('title did not move between mid-entrance and settled');
    caps.flips.push({ start: 6.3, end: 6.5, text: 'EIGHT', mode: 7, entrance: 'slam' });
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
    try { run(node, [join(KIT, 'check.mjs'), b], work); fail('check passed 8 titles with a repeated entrance'); } catch (e) { if (!/entrance "slam" already used|8 titles/.test(String(e.stdout || ''))) throw e; }
  });
  step('font pairings: druk, modern, elegant, editorial load and render as two-font lockups; unknown pairing refused', () => {
    const b = join(work, 'jobs', 'muse', 'build'), capF = join(b, 'captions.js'), keep = readFileSync(capF, 'utf8');
    const w = (t0, txt) => txt.split(' ').map((x, i) => [+(t0 + i * 0.2).toFixed(2), +(t0 + i * 0.2 + 0.2).toFixed(2), x]);
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'kinetic', flips: [
      { start: 0, end: 2, text: 'Record one take', mode: 7, hero: [0] },
      { start: 0, end: 2, text: 'Record one take on your phone', mode: 0, words: w(0, 'Record one take on your phone'), hero: 'record' },
      { start: 2, end: 4, text: 'Drop the file in the inbox', mode: 7 },
      { start: 2, end: 4, text: 'Ask for the reel', mode: 0, words: w(2, 'Ask for the reel') }] }) + ';\n');
    for (const fp of ['druk', 'modern', 'elegant', 'editorial']) {
      const o = run(node, [join(KIT, 'render.mjs'), '0', '1.0'], b, { FONTS: fp });
      if (!new RegExp('fonts ' + fp).test(o)) fail('pairing not applied: ' + fp + '\n' + o);
      if (!/"url":"file:/.test(readFileSync(join(b, 'fonts.js'), 'utf8'))) fail('fonts.js has no font files for ' + fp);
      // two-font lockups: every multi-word title and kinetic line pairs a big hero with a smaller partner on one line
      const L = JSON.parse(readFileSync(join(b, 'lockups.json'), 'utf8'));
      if (!L.some(l => l.kind === 'title')) fail(fp + ': no title lockups');
      const want = { druk: 'stack', modern: 'overlap', elegant: 'overlap' }[fp];
      for (const l of L) {
        if (!l.partners.length) continue;
        for (const q of l.partners) { const r = q.size / l.heroSize; if (r < 0.25 || r > 0.9) fail(`${fp} ${l.kind} ${l.start}s: partner/hero size ${r.toFixed(2)}`); if (q.w > 960) fail(`${fp}: partner "${q.txt}" wider than the frame`); }
        if (l.kind === 'kinetic') for (const q of l.partners) if (q.size < (q.script ? 60 : 46) || q.size / l.heroSize < 0.5) fail(`${fp} kinetic ${l.start}s: partner "${q.txt}" ${q.size}px (hero ${l.heroSize}px) is too small to read`);
        if (want && l.arrange !== want) fail(`${fp}: ${l.kind} arranged ${l.arrange}, want ${want}`);
        if ((fp === 'modern' || fp === 'elegant') && !l.partners.every(q => q.script)) fail(fp + ': partner is not the script face');
        if (l.kind === 'title' && l.hero.length <= 7 && l.heroW < 0.8 * 960 && l.heroSize < 360) fail(`${fp}: title hero "${l.hero}" only ${l.heroW}px wide`);
      }
      if (!L.some(l => l.partners.length)) fail(fp + ': no lockup has a partner face');
    }
    writeFileSync(capF, keep);
    try { run(node, [join(KIT, 'render.mjs'), '0', '1.0'], b, { FONTS: 'helvetica-please' }); fail('unknown pairing accepted'); } catch (e) { if (!/Unknown font pairing/.test(String(e.stderr || ''))) throw e; }
    run(node, [join(KIT, 'render.mjs'), '0', '1.0'], b, { FONTS: 'theme' });
  });
  step('music beds: only real library names resolve; a missing bed fails the check; add refuses a taken or empty name', () => {
    const b = join(work, 'jobs', 'muse', 'build'), cutF = join(b, 'cut.json'), keep = readFileSync(cutF, 'utf8'), add = join(KIT, 'music', 'add.mjs');
    for (const bed of ['constructor', 'no-such-bed']) {
      writeFileSync(cutF, JSON.stringify({ ...JSON.parse(keep), bed }));
      try { run(node, [join(KIT, 'check.mjs'), b], work); fail('check passed bed "' + bed + '"'); } catch (e) { if (!/not a library bed/.test(String(e.stdout || ''))) throw e; }
    }
    writeFileSync(cutF, keep);
    const lib = join(KIT, 'music', 'vinyl-sunrise.mp3'), before = statSync(lib).mtimeMs;
    for (const [name, want] of [['Vinyl Sunrise.wav', /already in the library/], ['!!!.wav', /no letters or digits/]]) {
      copyFileSync(join(work, 'bed.wav'), join(work, name));
      try { run(node, [add, join(work, name)], work); fail('music:add accepted ' + name); } catch (e) { if (!want.test(String(e.stderr || ''))) throw e; }
    }
    if (statSync(lib).mtimeMs !== before || existsSync(join(KIT, 'music', '.mp3'))) fail('music:add wrote to the library on a refused import');
  });
  step('check.mjs flags em dashes and banned phrases in captions', () => {
    const b = join(work, 'jobs', 'muse', 'build');
    const caps = { captionStyle: 'pill', flips: [{ start: 0, end: 1, text: 'This is not a tool but a team', mode: 0 }, { start: 1, end: 2, text: 'Fast \u2014 really fast', mode: 0 }] };
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
    try { run(node, [join(KIT, 'check.mjs'), b], work); fail('check passed banned copy'); } catch (e) { const o = String(e.stdout || ''); if (!/not X but Y/.test(o) || !/em dash/.test(o)) throw new Error('check output: ' + o); }
  });
  step('named transition (crossfade) keeps the timeline; zoom punch changes the picture', () => {
    const b = join(work, 'jobs', 'muse', 'build');
    const cut = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8'));
    const plain = { ...cut, overlay: undefined, titles: undefined, mask: undefined, sfx: {}, hits: [], punch: false, segs: cut.segs.map(({ bigPunch, ...s }) => s) };
    writeFileSync(join(b, 'cut.json'), JSON.stringify(plain)); run(node, [join(KIT, 'assemble.cjs'), 'plain.mp4'], b);
    const tx = { ...plain, punch: 0.1, segs: plain.segs.map((s, i) => (i === 2 ? { ...s, transition: 'crossfade', transitionDur: 0.3 } : s)) };
    writeFileSync(join(b, 'cut.json'), JSON.stringify(tx)); run(node, [join(KIT, 'assemble.cjs'), 'tx.mp4'], b);
    const d = f => +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], b).trim();
    if (Math.abs(d(join(b, 'tx.mp4')) - d(join(b, 'plain.mp4'))) > 0.05) fail('transition changed the length');
    const frame = (f, t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=108:192', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { cwd: b });
    const diff = (x, y) => x.reduce((a, v, k) => a + Math.abs(v - y[k]), 0) / x.length;
    if (diff(frame('plain.mp4', 2.2), frame('tx.mp4', 2.2)) < 2) fail('no punch-in on segment 1');
    if (diff(frame('plain.mp4', 0.8), frame('tx.mp4', 0.8)) > 2) fail('segment 0 should not be punched');
    writeFileSync(join(b, 'cut.json'), JSON.stringify(cut));
  });
  step('verify.mjs: ffprobe, loudness, stills + contact sheet, mask alpha, copy lint', () => {
    const b = join(work, 'jobs', 'muse', 'build');
    rmSync(join(b, 'captions.js')); run(node, [join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--titles', '--style', 'pill'], b);
    const o = run(node, [join(KIT, 'verify.mjs'), 'muse', '--jobs', join(work, 'jobs')], work);
    if (!/VERIFY PASS/.test(o)) fail('verify:\n' + o);
    const v = join(work, 'jobs', 'muse', 'verify');
    if (!existsSync(join(v, 'contact.png'))) fail('no contact sheet');
    if (readdirSync(v).filter(f => /title-mid/.test(f)).length !== 4 || readdirSync(v).filter(f => /big-punch/.test(f)).length !== 2) fail('verify stills: ' + readdirSync(v));
  });
  step('beat-sync helpers: snap within 120 ms, never move speech cuts, cap two drop shakes per shot; unknown finish fails check', () => {
    const times = [0, 0.5, 1.0, 1.5, 2.0];
    const hit = B.snap(1.08, times, 0.12);
    if (!hit.snapped || Math.abs(hit.t - 1.0) > 1e-6) fail('should snap 1.08 to 1.00: ' + JSON.stringify(hit));
    const miss = B.snap(1.25, times, 0.12);
    if (miss.snapped || miss.t !== 1.25) fail('1.25 is outside the window: ' + JSON.stringify(miss));
    const cut = {
      segs: [
        { file: 'a.mp4', in: 0.4, out: 1.82 },
        { file: 'b.mp4', in: 0.2, out: 1.4, bigPunch: true }
      ],
      tail: 0.3, punch: 0.1, bed: 'x.wav', beatSync: true,
      sfx: { whoosh: [1.5], boom: [[2.68, 0.55]] },
      hits: [[1.52, 24]],
      sfxHits: [{ id: '11-pop-sticker', t: 1.08 }]
    };
    const caps = { flips: [{ start: 0.05, end: 1.4, text: 'Stay put', mode: 0 }, { start: 1.58, end: 2.8, text: 'SNAP ME', mode: 7 }] };
    const grid = { tempo_bpm: 120, beats: [0, 0.5, 1.0, 1.5, 2.0, 2.5], onsets: [1.0, 1.5], drops: [
      { time: 1.52, intensity: 0.95, type: 'energy_spike' },
      { time: 1.7, intensity: 0.92, type: 'energy_spike' },
      { time: 1.85, intensity: 0.99, type: 'energy_spike' },
      { time: 2.6, intensity: 0.9, type: 'energy_spike' }
    ] };
    const { cut: c2, captions } = B.applySync(cut, caps, grid);
    if (c2.segs[0].in !== 0.4 || c2.segs[0].out !== 1.82 || c2.segs[1].in !== 0.2 || c2.segs[1].out !== 1.4) fail('speech cuts moved: ' + JSON.stringify(c2.segs));
    const whoosh = Array.isArray(c2.sfx.whoosh[0]) ? c2.sfx.whoosh[0][0] : c2.sfx.whoosh[0];
    if (Math.abs(whoosh - 1.5) > 1e-6) fail('whoosh should sit on 1.5: ' + JSON.stringify(c2.sfx));
    if (Math.abs(c2.sfxHits[0].t - 1.0) > 1e-6) fail('pack hit should snap 1.08 -> 1.0: ' + JSON.stringify(c2.sfxHits));
    const title = captions.flips.find(f => f.mode === 7);
    if (Math.abs(title.start - 1.5) > 0.011) fail('title entrance should snap to 1.5: ' + title.start);
    if (Math.abs(captions.flips[0].start - 0.05) > 1e-6) fail('speech caption moved');
    // first drop is already on a snapped hit; the next two are in seg 1; cap is 2
    const inSeg1 = (c2.dropHits || []).filter(([t]) => t >= 1.5 && t < 2.7);
    if (inSeg1.length > B.MAX_SHAKES_PER_SEG) fail('drop-shake cap broken: ' + JSON.stringify(c2.dropHits));
    if (Math.abs((c2.segs[1].punchDelay || 0) - 0.08) > 0.011) fail('big punch should delay ~80 ms to the 1.5s beat, got ' + c2.segs[1].punchDelay);
    if (B.finishChain(['grain', 'vignette']).indexOf('noise=') < 0 || B.finishChain('chroma').indexOf('rgbashift') < 0) fail('finish chain');
    if (B.finishName('scan_lines') !== 'scan_lines' && !B.FINISH['scan-lines']) fail('scan-lines alias');
    const b = join(work, 'jobs', 'muse', 'build');
    const keep = readFileSync(join(b, 'cut.json'), 'utf8');
    writeFileSync(join(b, 'cut.json'), JSON.stringify({ ...JSON.parse(keep), finish: 'not-a-look' }));
    try { run(node, [join(KIT, 'check.mjs'), b], work); fail('check passed unknown finish'); } catch (e) { if (!/unknown finish/.test(String(e.stdout || e.message || ''))) throw e; }
    writeFileSync(join(b, 'cut.json'), keep);
  });
  step('film finish: grain+vignette changes the picture, not the duration', () => {
    const b = join(work, 'jobs', 'muse', 'build');
    const cut = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8'));
    const plain = { ...cut, overlay: undefined, titles: undefined, mask: undefined, sfx: {}, hits: [], dropHits: [], punch: false, finish: undefined, beatSync: false, segs: cut.segs.map(({ bigPunch, punchDelay, finish, ...s }) => s) };
    writeFileSync(join(b, 'cut.json'), JSON.stringify(plain)); run(node, [join(KIT, 'assemble.cjs'), 'fin-plain.mp4'], b);
    writeFileSync(join(b, 'cut.json'), JSON.stringify({ ...plain, finish: ['grain', 'vignette'] })); run(node, [join(KIT, 'assemble.cjs'), 'fin-look.mp4'], b);
    const d = f => +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], b).trim();
    if (Math.abs(d('fin-plain.mp4') - d('fin-look.mp4')) > 0.05) fail('finish changed the length');
    const frame = (f, t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=108:192', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { cwd: b });
    const diff = (x, y) => x.reduce((a, v, k) => a + Math.abs(v - y[k]), 0) / x.length;
    if (diff(frame('fin-plain.mp4', 0.8), frame('fin-look.mp4', 0.8)) < 0.5) fail('finish did not change the picture');
    writeFileSync(join(b, 'cut.json'), JSON.stringify(cut));
  });
  {
    const py = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
    let has = false;
    try { run(py, ['-c', 'import librosa']); has = true; } catch {}
    if (has) step('beats.py on a click bed + python tests', () => {
      const o = run(py, [join(dirname(KIT), 'tests', 'test_beats.py')], work);
      if (!/OK/.test(o) && !/OK$/.test(o.trim().split('\n').pop() || '')) {
        // unittest prints OK to stderr; execFileSync merges? we only have stdout. Accept exit 0.
      }
      run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.8*lt(mod(t\\,0.5)\\,0.012)*sin(2*PI*1000*t):s=48000:d=6', 'clicks.wav'], work);
      const out = join(work, 'grid.json');
      const log = run(py, [join(KIT, 'beats.py'), join(work, 'clicks.wav'), '--start', '0.5', '--duration', '4', '--out', out], work);
      const g = JSON.parse(readFileSync(out, 'utf8'));
      if (!(g.tempo_bpm > 80 && g.tempo_bpm < 160) || !g.beats.length) fail('click grid: ' + log + JSON.stringify(g));
      if (g.bed_start !== 0.5) fail('bed_start not recorded');
      if (Math.min(...g.beats) < -0.01) fail('beats should be on the reel clock');
    });
    else console.log('- beats.py on a click bed + python tests ... skipped (pip install -r requirements.txt for librosa)');
  }
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
    const zones = readFileSync(join(jobs, 'smoke-reel', 'build', 'fxzones.js'), 'utf8');
    if (!/"act":"hide","fx":"checklist"/.test(zones) || !/"act":"move","fx":"glass-widgets"/.test(zones)) fail('caption zones not written: ' + zones);
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
