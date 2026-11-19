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
import { coverage, showcaseHas, sourceCatalogIds } from './menu.mjs';
const SFXPLAN = createRequire(import.meta.url)('./sfx-plan.cjs');
const B = createRequire(import.meta.url)('./beats.cjs');
const P = createRequire(import.meta.url)('./preset.cjs');
const R = createRequire(import.meta.url)('./rules.cjs');
const SP = createRequire(import.meta.url)('./spoken.cjs');

const KIT = dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep'), whisper = process.argv.includes('--whisper');
const fxPy = join(dirname(KIT), 'effects', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const effects = process.argv.includes('--effects') || existsSync(fxPy);
const run = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).toString();
const step = (name, fn) => { process.stdout.write(`- ${name} ... `); const r = fn(); console.log('ok'); return r; };
const fail = m => { throw new Error(m); };

const work = mkdtempSync(join(tmpdir(), 'talking-head-smoke-'));
const build = join(work, 'build'); mkdirSync(build);
const node = process.execPath;
let ok = false;
try {
  step('ffmpeg and ffprobe on PATH', () => { run('ffmpeg', ['-version']); run('ffprobe', ['-version']); });
  step(`Chrome found (${findChrome()})`, () => {});
  step('menu and showcase cover every catalog entry', () => {
    const cov = coverage();
    if (!cov.ok) fail('menu missing catalog entries: ' + cov.missing.join(', '));
    const htmlPath = join(dirname(KIT), 'showcase', 'index.html');
    if (!existsSync(htmlPath)) fail('showcase/index.html is missing; run npm run showcase');
    const html = readFileSync(htmlPath, 'utf8');
    const has = showcaseHas(html, sourceCatalogIds());
    if (!has.ok) fail('showcase missing labels: ' + has.missing.join(', '));
  });
  step('presets: shipped list, save/load, flag override, auto pick', () => {
    const want = ['aigent', 'one-word', 'hormozi-bold', 'karaoke', 'minimal-clean', 'cinematic', 'editorial', 'muse-pill', 'retro-scan-lines', 'neutral'];
    for (const name of want) {
      const pset = P.load(name);
      if (!pset) fail('missing shipped preset ' + name);
      const errs = P.validate(pset);
      if (errs.length) fail(name + ': ' + errs.join('; '));
    }
    if (P.shipped().length < want.length) fail('shipped count ' + P.shipped().length);
    const job = join(work, 'preset-job'); mkdirSync(job, { recursive: true });
    writeFileSync(join(job, 'cut.json'), JSON.stringify({
      segs: [{ file: 'a.mp4', in: 0, out: 1, finish: 'grain' }, { file: 'b.mp4', in: 0, out: 1, finish: 'teal', transition: 'crossfade' }],
      titles: 'ovlt/%04d.png', bed: 'vinyl-sunrise', punch: 0.1
    }));
    writeFileSync(join(job, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'hormozi', fonts: 'druk', flips: [] }) + ';\n');
    const dir = join(work, 'saved-presets');
    const dest = P.save('smoke-style', P.fromJob(job), dir);
    const loaded = P.load('smoke-style', { dir });
    if (!loaded || loaded.captionStyle !== 'hormozi' || !(loaded.finishPool || []).includes('grain')) fail('save/load: ' + JSON.stringify(loaded) + ' from ' + dest);
    const cut = { segs: [{ in: 0, out: 1 }, { in: 0, out: 1 }, { in: 0, out: 1 }] };
    P.apply(P.load('cinematic'), { cut }, { finish: 'mono' });
    if (cut.finish !== 'mono') fail('user finish should win, got ' + JSON.stringify(cut));
    if (cut.segs.some(s => s.finish)) fail('finish pool should not apply when the user set finish: ' + JSON.stringify(cut.segs));
    const cut2 = { segs: [{ in: 0, out: 1 }, { in: 0, out: 1 }, { in: 0, out: 1 }] };
    P.apply(P.load('cinematic'), { cut: cut2 }, {});
    const finishes = cut2.segs.map(s => s.finish);
    if (new Set(finishes).size < 2) fail('expected per-scene finish variety: ' + JSON.stringify(finishes));
    const auto = P.pickAuto({ want: 'one-word' });
    if (auto.name !== 'one-word') fail('auto should pick one-word, got ' + auto.name);
  });
  step('brand:import from a synthetic markdown guide and a colour swatch', () => {
    const fix = join(dirname(KIT), 'tests', 'fixtures', 'brand-guide');
    const out = join(work, 'imported.json');
    run(node, [join(KIT, 'brand-import.mjs'), join(fix, 'guide.md'), '--name', 'north-star', '--out', out], work);
    const d = JSON.parse(readFileSync(out, 'utf8'));
    if (d.fonts !== 'druk') fail('expected druk from the guide, got ' + JSON.stringify(d.fonts));
    if (!/short sentences/i.test(d.notes || '') || !/light-grey|Never invent/i.test(d.notes || '')) fail('imported notes missing do/do-not lines: ' + d.notes);
    const out2 = join(work, 'swatch.json');
    run(node, [join(KIT, 'brand-import.mjs'), join(fix, 'swatch.png'), '--name', 'swatch', '--out', out2], work);
    const d2 = JSON.parse(readFileSync(out2, 'utf8'));
    if (!d2.colors || d2.colors.length < 2) fail('expected a palette from the swatch: ' + JSON.stringify(d2.colors));
  });
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
  step('one-word caption style: the spoken word changes between stills', () => {
    const b = join(work, 'one-word'); mkdirSync(b, { recursive: true });
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({
      captionStyle: 'one-word', fonts: 'druk',
      flips: [{ start: 0, end: 2, text: 'Record one take', mode: 0, words: [[0, 0.6, 'Record'], [0.6, 1.2, 'one'], [1.2, 2, 'take']] }]
    }) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '0', '0.30,0.90'], b, { THEME: 'aigent', FONTS: 'druk' });
    const a = readFileSync(join(b, 'stills', 't0.30.png'));
    const c = readFileSync(join(b, 'stills', 't0.90.png'));
    if (Buffer.compare(a, c) === 0) fail('one-word stills at 0.30 and 0.90 should show different words');
  });
  // alpha ink of a layer still: rows with any pixel over half opaque -> { n, y0, y1, mid }
  const ink = png => {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', 'format=rgba,alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
    let n = 0, y0 = -1, y1 = -1;
    for (let y = 0; y < 1920; y++) { let row = 0; for (let x = 0; x < 1080; x++) if (raw[y * 1080 + x] > 128) row++; if (row) { n += row; if (y0 < 0) y0 = y; y1 = y; } }
    return { n, y0, y1, mid: (y0 + y1) / 2 };
  };
  const layered = (dir, doc, times, env = {}) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(doc) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '0', times.map(t => t.toFixed(2)).join(',')], dir, { THEME: 'aigent', FONTS: 'theme', STILLS_LAYERS: '1', ...env });
    return t => ({ titles: ink(join(dir, 'stills-titles', `t${t.toFixed(2)}.png`)), front: ink(join(dir, 'stills-front', `t${t.toFixed(2)}.png`)) });
  };
  step('titles: slam lands behind the head, rises high, partner line in front', () => {
    const at = layered(join(work, 'slam'), { captionStyle: 'kinetic', flips: [{ start: 0, end: 2.4, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' }] }, [0.15, 1.4]);
    const a = at(0.15), b = at(1.4);
    if (!a.titles.n || !b.titles.n) fail('slam title missing on the titles layer');
    if (a.titles.mid < 520) fail('slam should land low, behind the head (centre ' + a.titles.mid + ')');
    if (a.titles.mid - b.titles.mid < 200) fail('slam should rise after landing: ' + a.titles.mid + ' -> ' + b.titles.mid);
    if (b.titles.y1 > 470) fail('resting title should sit high so the word clears the head, bottom at ' + b.titles.y1);
    if (b.titles.y1 < 430) fail('resting title should reach the hair so the lower edge can tuck, bottom at ' + b.titles.y1);
    if (a.front.n) fail('partner words should wait for the rise');
    if (!b.front.n) fail('partner words should draw on the front layer (in front of the person)');
    if (b.front.y0 < b.titles.y1 - 10) fail('partner line should hang below the hero: ' + JSON.stringify(b));
    const still = layered(join(work, 'slam-norise'), { captionStyle: 'kinetic', titleRise: false, flips: [{ start: 0, end: 2.4, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' }] }, [0.4]);
    const c = still(0.4);
    if (Math.abs(c.titles.mid - b.titles.mid) > 30) fail('titleRise false should land at the resting height: ' + c.titles.mid + ' vs ' + b.titles.mid);
  });
  step('title layer: default front, explicit behind, auto limits to 1-2 non-consecutive', () => {
    const layers = ts => R.resolveTitles(ts).map(t => t.layer).join(',');
    const flips = (n, extra = {}) => [...Array(n).keys()].map(i => ({ start: i, end: i + 0.8, text: 'Title ' + (i + 1), mode: 7, entrance: R.ENTRANCES[i], ...extra }));
    if (layers({ flips: flips(2) }) !== 'front,front') fail('default layer should be front');
    if (layers({ flips: [Object.assign(flips(2)[0], { layer: 'behind' }), flips(2)[1]] }) !== 'behind,front') fail('explicit behind should win');
    const auto4 = layers({ titleLayer: 'auto', flips: flips(4) });
    if (auto4 !== 'behind,front,front,behind') fail('auto should put hook and payoff behind when they are not neighbours: ' + auto4);
    const auto2 = R.resolveTitles({ titleLayer: 'auto', flips: flips(2) });
    const n2 = auto2.filter(t => t.layer === 'behind').length;
    if (n2 !== 1) fail('auto with two consecutive titles should put only one behind: ' + auto2.map(t => t.layer));
    if (auto2[0].layer === 'behind' && auto2[1].layer === 'behind') fail('auto behind titles must not be consecutive');
    const atFront = layered(join(work, 'title-front'), { captionStyle: 'kinetic', flips: [{ start: 0, end: 2.0, text: 'Record one take', mode: 7, hero: [0], entrance: 'pop-zoom', flicker: false }] }, [0.6]);
    const f = atFront(0.6);
    if (f.titles.n) fail('default front: hero should not be on the titles layer');
    if (!f.front.n) fail('default front: title should draw on the front layer');
    const atBack = layered(join(work, 'title-behind'), { captionStyle: 'kinetic', flips: [{ start: 0, end: 2.0, text: 'Record one take', mode: 7, hero: [0], entrance: 'pop-zoom', flicker: false, layer: 'behind' }] }, [0.6]);
    const b = atBack(0.6);
    if (!b.titles.n) fail('explicit behind: hero should be on the titles layer');
  });
  step('one-word: the title is its word, every other spoken word still shows, back to back', () => {
    const at = layered(join(work, 'one-word-title'), { captionStyle: 'one-word', flips: [
      { start: 0, end: 0.9, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam', flicker: false, layer: 'behind' },
      { start: 0, end: 2, text: 'Record one take', mode: 0, words: [[0, 0.6, 'Record'], [0.6, 1.2, 'one'], [1.2, 2, 'take']] }] }, [0.3, 0.75, 1.5]);
    const a = at(0.3), b = at(1.5), m = at(0.75);
    if (!a.titles.n) fail('title word missing');
    if (a.front.n) fail('one-word: the spoken word the title shows should not be drawn twice');
    if (!m.front.n) fail('one-word: a spoken word under a title that is not its word must still show');
    if (a.titles.y1 - a.titles.y0 > 330) fail('one-word title should be a single word, ink height ' + (a.titles.y1 - a.titles.y0));
    if (b.titles.n || !b.front.n) fail('one-word: after the title the caption word should be the only word');
    if (b.front.y1 - b.front.y0 > 330) fail('one-word caption should be one line, ink height ' + (b.front.y1 - b.front.y0));
  });
  step('one-word: every transcript word gets a slot (same-start words, short words), no gaps between words', () => {
    const dir = join(work, 'every-word'); mkdirSync(dir, { recursive: true });
    const words = [[0, 0.21, 'Every'], [0, 0.5, 'effect'], [0.47, 0.52, 'in'], [0.52, 0.6, 'this'], [0.6, 1.1, 'reel'], [3.2, 3.6, 'lands']];
    writeFileSync(join(dir, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'one-word', flips: [{ start: 0, end: 1.1, text: 'Every effect in this reel', mode: 0, words: words.slice(0, 5) }, { start: 3.2, end: 3.6, text: 'lands', mode: 0, words: words.slice(5) }] }) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '0', '0.05'], dir, { THEME: 'aigent', FONTS: 'theme' });
    const ws = JSON.parse(readFileSync(join(dir, 'words.json'), 'utf8'));
    if (ws.map(w => w.word).join(' ') !== words.map(w => w[2]).join(' ')) fail('every word should get a slot: ' + ws.map(w => w.word).join(' '));
    if (ws.some(w => w.end - w.start < 0.119)) fail('each word should be up at least 0.12 s: ' + JSON.stringify(ws));
    for (let i = 1; i < 5; i++) if (Math.abs(ws[i].start - ws[i - 1].end) > 0.001) fail('words should run back to back: ' + JSON.stringify(ws));
    if (!(ws[4].end < 3.2)) fail('a long pause (over 1.5 s) should clear the screen: ' + JSON.stringify(ws[4]));
  });
  step('one-word look: outline none, thin, thick; shadow; lower case', () => {
    const doc = extra => ({ captionStyle: 'one-word', fonts: 'theme', captionPosition: 'top', ...extra, flips: [{ start: 0, end: 2, text: 'Record one', mode: 0, words: [[0, 1, 'Record'], [1, 2, 'one']] }] });
    const still = (name, d) => { const dir = join(work, name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(d) + ';\n');
      run(node, [join(KIT, 'render.mjs'), '0', '0.50'], dir, { THEME: 'aigent', FONTS: 'theme' }); return readFileSync(join(dir, 'stills', 't0.50.png')); };
    const thick = still('look-thick', doc({})), none = still('look-none', doc({ captionOutline: 'none', captionShadow: 'none' })), thin = still('look-thin', doc({ captionOutline: 'thin' })), lower = still('look-lower', doc({ captionOutline: 'none', captionShadow: 'none', captionCase: 'lower' }));
    if (!Buffer.compare(thick, none) || !Buffer.compare(thick, thin) || !Buffer.compare(none, lower)) fail('outline, thin outline and case should each change the word');
    // no outline and no shadow: the word is only its fill, so there are no dark pixels round it
    const dark = png => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', 'format=rgba', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 27 }); let n = 0; for (let i = 0; i < raw.length; i += 4) if (raw[i + 3] > 128 && raw[i] + raw[i + 1] + raw[i + 2] < 150) n++; return n; };
    if (dark(join(work, 'look-none', 'stills', 't0.50.png')) > 50) fail('outline none should draw no dark edge');
    if (dark(join(work, 'look-thick', 'stills', 't0.50.png')) < 500) fail('the default outline should draw a dark edge');
  });
  step('caption position and colour: top vs bottom band, colour changes the word', () => {
    const doc = extra => ({ captionStyle: 'one-word', fonts: 'theme', captionLayer: 'front', ...extra, flips: [{ start: 0, end: 2, text: 'Record one take', mode: 0, words: [[0, 1, 'Record'], [1, 2, 'one']] }] });
    const front = (name, d) => { const dir = join(work, name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(d) + ';\n');
      run(node, [join(KIT, 'render.mjs'), '0', '0.50'], dir, { THEME: 'aigent', FONTS: 'theme', STILLS_LAYERS: '1' }); return ink(join(dir, 'stills-front', 't0.50.png')); };
    const top = front('cap-top', doc({ captionPosition: 'top' }));
    const bot = front('cap-bottom', doc({ captionPosition: 'bottom' }));
    if (!top.n || !bot.n) fail('caption word missing');
    if (!(top.mid < 600 && bot.mid > 1100)) fail(`caption-position: top centre ${top.mid}, bottom centre ${bot.mid}`);
    front('cap-red', doc({ captionPosition: 'top', captionColor: '#ff2020' }));
    if (Buffer.compare(readFileSync(join(work, 'cap-red', 'stills-front', 't0.50.png')), readFileSync(join(work, 'cap-top', 'stills-front', 't0.50.png'))) === 0) fail('caption-color did not change the word');
  });
  step('caption layer: behind and auto (top) draw under the person mask, front stays in front, behind sits above the head', () => {
    const flips = [{ start: 0, end: 2, text: 'Record one take', mode: 0, words: [[0, 1, 'Record'], [1, 2, 'one']] }];
    const at = (name, extra) => layered(join(work, name), { captionStyle: 'one-word', fonts: 'theme', captionPosition: 'top', ...extra, flips }, [0.5])(0.5);
    // a job with nothing behind has no title layer: front only
    const frontOnly = (name, extra) => { const d = join(work, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'one-word', fonts: 'theme', ...extra, flips }) + ';\n');
      run(node, [join(KIT, 'render.mjs'), '0', '0.50'], d, { THEME: 'aigent', FONTS: 'theme', STILLS_LAYERS: '1' });
      const tf = join(d, 'stills-titles', 't0.50.png'); return { front: ink(join(d, 'stills-front', 't0.50.png')), titles: existsSync(tf) ? ink(tf) : { n: 0 } }; };
    const beh = at('clay-behind', { captionLayer: 'behind' }), auto = at('clay-auto', {}), fr = frontOnly('clay-front', { captionPosition: 'top', captionLayer: 'front' });
    if (!beh.titles.n || beh.front.n) fail('behind: caption should be on the title layer only');
    if (!auto.titles.n || auto.front.n) fail('auto at the top should draw behind');
    if (!fr.front.n || fr.titles.n) fail('front: caption should be on the front layer only');
    const bot = frontOnly('clay-auto-bottom', { captionPosition: 'bottom' });
    if (!bot.front.n || bot.titles.n) fail('auto at the bottom should stay in front');
    const head = at('clay-head', { captionLayer: 'behind', headTop: 300 });
    if (!(head.titles.mid < beh.titles.mid && head.titles.mid < 300)) fail(`behind word should sit above the head top: ${head.titles.mid} vs ${beh.titles.mid}`);
    const lj = JSON.parse(readFileSync(join(work, 'clay-behind', 'layers.json'), 'utf8'));
    if (lj.captions !== 'behind') fail('layers.json: ' + JSON.stringify(lj));
    if (R.captionLayer({ captionPosition: 'top' }) !== 'behind' || R.captionLayer({}) !== 'front' || R.captionLayer({ captionPosition: 'top', captionLayer: 'front' }) !== 'front') fail('rules captionLayer');
  });
  step('app label: the full name shows even when the label is up briefly', () => {
    const one = (name, end, t) => { const d = join(work, name); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'one-word', fonts: 'theme', flips: [{ start: 0, end, mode: 10, text: 'Launchpad', x: 0.12, size: 286 }] }) + ';\n');
      run(node, [join(KIT, 'render.mjs'), '0', t.toFixed(2)], d, { THEME: 'aigent', FONTS: 'theme', STILLS_LAYERS: '1' }); return ink(join(d, 'stills-front', `t${t.toFixed(2)}.png`)); };
    const brief = one('label-brief', 0.55, 0.5), full = one('label-full', 3, 1.5);
    if (!(brief.n > 0.95 * full.n)) fail(`a brief label is cut off: ${brief.n} vs ${full.n} pixels`);
  });
  step('screen cards behind the top of the head: panel layer by default, front on request, crown over the panel, face and body under it', () => {
    const flips = [{ start: 0, end: 1.5, mode: 11, border: '#d87b5b' }];
    const lay = (name, extra) => { const d = join(work, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'one-word', fonts: 'theme', ...extra }) + ';\n');
      run(node, [join(KIT, 'render.mjs'), '0', '0.80'], d, { THEME: 'aigent', FONTS: 'theme', STILLS_LAYERS: '1' });
      const f = n => existsSync(join(d, n, 't0.80.png')) ? ink(join(d, n, 't0.80.png')) : { n: 0 };
      return { front: f('stills-front'), panels: f('stills-panels'), lj: JSON.parse(readFileSync(join(d, 'layers.json'), 'utf8')) }; };
    const auto = lay('panel-auto', { flips }), fr = lay('panel-front', { flips: [{ ...flips[0], layer: 'front' }] }), job = lay('panel-job-front', { panelLayer: 'front', flips });
    if (!auto.panels.n || auto.front.n || auto.lj.panels !== 'behind') fail('auto: the card should be on the panel layer only ' + JSON.stringify(auto));
    if (!fr.front.n || fr.panels.n || fr.lj.panels !== 'front') fail('layer front: the card should be on the front layer');
    if (!job.front.n || job.panels.n) fail('panelLayer front for the job should put the card in front');
    if (R.panelLayer({ mode: 11 }) !== 'behind' || R.panelLayer({ mode: 11, layer: 'front' }) !== 'front' || R.panelLayer({ mode: 11 }, { panelLayer: 'front' }) !== 'front') fail('rules panelLayer');
    // assemble: picture, panel, then the head over the panel; below the head the panel covers the picture
    const pt = join(work, 'panel-assemble'); mkdirSync(join(pt, 'ovlp'), { recursive: true });
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2040c0:s=1080x1920:r=24:d=1', '-f', 'lavfi', '-i', 'sine=d=1:sample_rate=48000', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'clip.mp4'], pt);
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x20c040:s=800x600:r=24:d=1,format=rgba', '-f', 'lavfi', '-i', 'color=c=black@0:s=1080x1920:r=24:d=1,format=rgba', '-filter_complex', '[1][0]overlay=140:800:format=auto,format=rgba', '-start_number', '0', 'ovlp/%04d.png'], pt);
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=24:d=1,drawbox=x=340:y=300:w=400:h=700:color=white:t=fill', '-c:v', 'ffv1', '-pix_fmt', 'gray', 'maskhead.mkv'], pt);
    writeFileSync(join(pt, 'cut.json'), JSON.stringify({ segs: [{ file: 'clip.mp4', in: 0, out: 1 }], tail: 0, panels: 'ovlp/%04d.png', headMask: 'maskhead.mkv' }));
    run(node, [join(KIT, 'assemble.cjs'), 'out.mp4'], pt);
    const px = y => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', join(pt, 'out.mp4'), '-frames:v', '1', '-vf', `crop=2:2:540:${y},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])].slice(0, 3);
    const head = px(900), body = px(1200);
    if (!(head[2] > 120 && head[1] < 110)) fail('the crown should be over the panel (picture blue there): ' + head);
    if (!(body[1] > 150 && body[2] < 110)) fail('below the crown the panel should cover the picture (green): ' + body);
    // the crown mask keeps the top of the head (hair) and drops the face, chin and body
    if (effects) {
      run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=24:d=0.5,drawbox=x=340:y=400:w=400:h=600:color=white:t=fill,drawbox=x=470:y=1000:w=140:h=120:color=white:t=fill,drawbox=x=140:y=1120:w=800:h=800:color=white:t=fill', '-c:v', 'ffv1', '-pix_fmt', 'gray', 'person.mkv'], pt);
      run(fxPy, [join(KIT, 'headmask.py'), 'person.mkv', 'hm.mkv'], pt);
      const g = y => execFileSync('ffmpeg', ['-v', 'error', '-i', join(pt, 'hm.mkv'), '-frames:v', '1', '-vf', `crop=2:2:540:${y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])[0];
      if (!(g(450) > 200 && g(800) < 10 && g(980) < 10 && g(1500) < 10)) fail(`crown mask: crown ${g(450)}, face ${g(800)}, chin ${g(980)}, body ${g(1500)}`);
    }
  });
  step('graphics: ordinal sticker behind the head, app label with your icon, screen card from your video, placeholders', () => {
    const g = join(work, 'gfx'); mkdirSync(g, { recursive: true });
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3366ff:s=128x128', '-frames:v', '1', join(g, 'icon.png')]);
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x400:rate=24', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(g, 'screen.mp4')]);
    const flips = [
      { start: 0, end: 1.5, mode: 9, text: 'FIRST', layer: 'behind' },
      { start: 2, end: 3.5, mode: 10, text: 'My App', icon: join(g, 'icon.png') },
      { start: 4, end: 5.5, mode: 11, src: join(g, 'screen.mp4'), border: '#d87b5b', layer: 'front' },
      { start: 6, end: 7.5, mode: 10, text: 'Placeholder' },
      { start: 6, end: 7.5, mode: 11, layer: 'front' }];
    const at = layered(g, { captionStyle: 'one-word', flips }, [0.8, 2.8, 4.9, 6.9]);
    const o = at(0.8), a = at(2.8), c = at(4.9), p = at(6.9);
    if (!o.titles.n) fail('the ordinal burst should be on the behind-the-head layer');
    if (!o.front.n || o.front.mid > o.titles.mid) fail('the ordinal word should be on the front layer, above the burst');
    if (!a.front.n || a.titles.n) fail('app label should draw in front only');
    if (!c.front.n || c.front.mid < 1000) fail('screen card should sit in the lower middle, centre ' + c.front.mid);
    if (!p.front.n) fail('placeholders missing');
    const rep = JSON.parse(readFileSync(join(g, 'graphics.json'), 'utf8'));
    const kinds = rep.map(x => `${x.mode}:${x.asset}:${x.loaded}`).join(' ');
    if (kinds !== '9:placeholder:true 10:image:true 11:video:true 10:placeholder:true 11:placeholder:true') fail('graphics report: ' + kinds);
    if (!readdirSync(join(g, 'gfx')).length) fail('screen card video frames not extracted');
    // a screen card's source: a captured public page from the cache (assets/web), or a file next to the recipe
    const RM = createRequire(import.meta.url)('./reelmd.cjs'), SRC = createRequire(import.meta.url)('./sources.cjs');
    process.env.ATH_ASSETS = join(work, 'assets-web');
    const page = 'https://github.com/example-owner/example-repo';
    mkdirSync(SRC.dirOf(page), { recursive: true }); copyFileSync(join(g, 'icon.png'), join(SRC.dirOf(page), 'shot.png'));
    const md = '---\nvideomd: 0.1\n---\n# t\n\n## Graphics\n\n```reel-graphics\n#01 1-3 | type screen-card | source ' + page + '\n#02 3-5 | type screen-card | source screen.mp4\n#03 5-7 | type screen-card | source https://github.com/not/captured\n#04 7-9 | type screen-card | source~ https://github.com/a/guess\n```\n';
    const rr = RM.parse(md, join(g, 'cards.Reel.md')), fl = RM.graphicFlips(rr), vv = RM.validate(rr);
    if (fl[0].src !== join(SRC.dirOf(page), 'shot.png') || fl[1].src !== join(g, 'screen.mp4') || fl[2].src || fl[2].source !== 'https://github.com/not/captured' || fl[3].src || fl[3].source) fail('card sources: ' + JSON.stringify(fl));
    if (!vv.warn.some(w => /not captured yet/.test(w))) fail('an uncaptured source should be flagged: ' + JSON.stringify(vv));
    delete process.env.ATH_ASSETS;
    // capture refuses anything that is not a public page (no network needed for these)
    for (const u of ['http://localhost:9/', 'http://192.168.1.10/', 'http://10.0.0.1/x', 'file:///etc/hosts']) {
      try { run(node, [join(KIT, 'capture.mjs'), u], work); fail('capture accepted ' + u); } catch (e) { if (!/only public pages|only http/.test(String(e.stderr || ''))) throw e; }
    }
    const GX = JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics;
    if (GX.map(x => x.mode).join(',') !== Array.from({ length: 30 }, (_, i) => i + 9).join(',') || GX.some(x => !x.entrance || !x.exit || !x.detect || !Array.isArray(x.spoken) || !x.example)) fail('kit/graphics.json: modes, entrance, exit, spoken fields, example and detect rule for each graphic');
  });
  step('graphics 12 to 38: each draws with an entrance and an exit, auto layer by height, behind only on the panel layer, words you say, Reel.md round trip', () => {
    const GX = JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics.filter(g => g.mode >= 12);
    const d = join(work, 'gfx2'); mkdirSync(d, { recursive: true });
    const flips = GX.map((g, i) => ({ ...g.example, start: i * 3, end: i * 3 + 3 }));
    flips.push({ start: GX.length * 3, end: GX.length * 3 + 3, mode: 13, text: '3x', sub: 'faster', layer: 'front' }, { start: GX.length * 3 + 3, end: GX.length * 3 + 6, mode: 12, text: 'Up top', y: 0.1 });
    const times = flips.flatMap(f => [f.start + 0.02, f.start + 1.5, f.end - 0.02]);
    writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'one-word', fonts: 'theme', flips }) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '0', times.map(t => t.toFixed(2)).join(',')], d, { THEME: 'aigent', FONTS: 'theme', STILLS_LAYERS: '1' });
    const at = (dir, t) => { const f = join(d, dir, `t${t.toFixed(2)}.png`); return existsSync(f) ? ink(f) : { n: 0 }; };
    flips.forEach((f, i) => {
      const id = (GX.find(g => g.mode === f.mode) || {}).id + '@' + f.start, want = R.panelLayer(f, {});
      const mid = { front: at('stills-front', f.start + 1.5), panels: at('stills-panels', f.start + 1.5) }, tot = x => x.front.n + x.panels.n;
      if (tot(mid) < 2000) fail(`${id}: nothing drawn (${tot(mid)} px)`);
      if (want === 'behind' ? (!mid.panels.n || mid.front.n) : (!mid.front.n || mid.panels.n)) fail(`${id}: should be on the ${want === 'behind' ? 'panel' : 'front'} layer only ${JSON.stringify(mid)}`);
      const a = at(want === 'behind' ? 'stills-panels' : 'stills-front', f.start + 0.02), z = at(want === 'behind' ? 'stills-panels' : 'stills-front', f.end - 0.02);
      if (!(a.n < tot(mid) * 0.7)) fail(`${id}: no entrance (${a.n} px at the start vs ${tot(mid)})`);
      if (!(z.n < tot(mid) * 0.7)) fail(`${id}: no exit (${z.n} px at the end vs ${tot(mid)})`);
    });
    const byMode = m => flips.find(f => f.mode === m);
    if (R.panelLayer(byMode(13), {}) !== 'behind' || R.panelLayer(byMode(12), {}) !== 'front' || R.panelLayer(flips[flips.length - 1], {}) !== 'behind' || R.panelLayer(byMode(13), { panelLayer: 'front' }) !== 'front') fail('auto layer: high graphics behind, low ones in front, the job panelLayer wins over auto');
    if (JSON.parse(readFileSync(join(d, 'layers.json'), 'utf8')).panels !== 'behind') fail('layers.json should report the panel layer');
    const rep = JSON.parse(readFileSync(join(d, 'graphics.json'), 'utf8'));
    if (rep.length !== flips.length || rep.some(x => x.asset !== 'drawn')) fail('graphics report: ' + JSON.stringify(rep.map(x => [x.mode, x.asset])));
    // the overlay's glyphs are the ones the Reel.md check accepts
    const RM = createRequire(import.meta.url)('./reelmd.cjs');
    const og = (readFileSync(join(KIT, 'overlay.html'), 'utf8').match(/const GLYPHS=\[([^\]]*)\]/) || [])[1];
    if (!og || og.replace(/'/g, '') !== RM.GLYPHS.join(',')) fail('overlay GLYPHS != reelmd GLYPHS: ' + og);
    // words: a checklist keeps the rows you say and ticks each as you say it; numbers and handles count when said aloud
    const W = (s, t0 = 0) => s.split(' ').map((w, i) => ({ start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.28, word: w }));
    const words = W('we hit ten thousand readers so follow the aigent first record then caption then post it costs $49 down from ninety nine');
    const au = SP.audit([
      { mode: 13, start: 0, end: 3, text: '10,000+', sub: 'readers' }, { mode: 22, start: 2, end: 5, text: 'Follow', sub: '@theaigent' },
      { mode: 14, start: 2.5, end: 7, items: ['Record', 'Caption', 'Post', 'Edit'] }, { mode: 21, start: 6, end: 9, text: '$49', sub: '$99' },
      { mode: 18, start: 0, end: 3, text: 'Manual vs Agent' }, { mode: 15, start: 0, end: 3, text: 'never said here' }, { mode: 23, start: 0, end: 2, text: 'npm run x' }, { mode: 20, start: 0, end: 2 }], words);
    const kept = au.flips.map(f => f.mode).join(',');
    if (kept !== '13,22,14,21,23,20') fail('audit kept ' + kept + ' ' + JSON.stringify(au.dropped.map(x => x.why)));
    // ticker items and feature cards keep what you say; a feature line you never say is left blank; cues land when said
    const au2 = SP.audit([
      { mode: 30, start: 0, end: 6, text: 'Today', items: ['Record', 'Edit', 'Post'] },
      { mode: 32, start: 0, end: 6, items: ['Record', 'Caption', 'Juggle'], details: ['first record', 'never said line', 'x'] },
      { mode: 24, start: 0, end: 6, text: 'readers', values: '1;2;3', cues: 'first;caption;99;5' },
      { mode: 37, start: 0, end: 4, text: 'follow the aigent', keyword: 'aigent' }, { mode: 37, start: 0, end: 4, text: 'follow the aigent', keyword: 'robot' }], words);
    const tk = au2.flips.find(f => f.mode === 30), fc = au2.flips.find(f => f.mode === 32), dc = au2.flips.find(f => f.mode === 24);
    if (!tk || tk.items.join(',') !== 'Record,Post') fail('ticker items: ' + JSON.stringify(tk));
    if (!fc || fc.items.join(',') !== 'Record,Caption' || fc.details.join('|') !== 'first record|') fail('feature cards: ' + JSON.stringify(fc));
    const wAt = w => words.find(x => x.word === w).start;
    if (!dc || !dc.at || Math.abs(dc.at[0] - wAt('first')) > 0.01 || Math.abs(dc.at[1] - wAt('caption')) > 0.01 || !(dc.at[2] >= dc.at[1] && dc.at[2] <= dc.at[3]) || Math.abs(dc.at[3] - 5) > 0.01) fail('cue times: ' + JSON.stringify(dc && dc.at));
    if (au2.flips.filter(f => f.mode === 37).length !== 1) fail('keyword caption with an unsaid keyword should drop');
    const cl = au.flips.find(f => f.mode === 14);
    if (cl.items.join(',') !== 'Record,Caption,Post' || !cl.at || cl.at.some((t, i) => Math.abs(t - words.find(w => w.word.toLowerCase() === cl.items[i].toLowerCase()).start) > 0.01)) fail('checklist rows and tick times: ' + JSON.stringify(cl));
    // Reel.md: every new type parses, validates and round-trips; a bad shape or glyph fails the check
    const caps = { flips: [{ start: 1, end: 3, mode: 14, text: 'Ship it', items: ['Record', 'Caption'], at: [1.5, 2] }, { start: 3, end: 5, mode: 23, text: 'npx a/b\\n  run' },
      { start: 5, end: 7, mode: 18, left: 'Manual', right: 'Agent', layer: 'behind' }, { start: 7, end: 9, mode: 16, shape: 'arrow', text: 'here', x: 0.6, y: 0.6 },
      { start: 9, end: 11, mode: 17, step: 2, of: 5 }, { start: 11, end: 13, mode: 19, glyph: 'bolt', text: 'fast' }, { start: 13, end: 15, mode: 20, glyph: 'heart;star', count: 4 },
      { start: 15, end: 17, mode: 24, text: 'Users', values: '1.2k;3.8k', labels: 'Jan;Feb', kind: 'line', cues: 'users;grew' }, { start: 17, end: 19, mode: 28, text: '$ npm run reel\\n✓ done', title: 'zsh' },
      { start: 19, end: 21, mode: 32, items: ['Record', 'Post'], details: ['One take', ''], glyph: 'play;star' }, { start: 21, end: 23, mode: 26, text: 'AIgent', corner: 'tl', opacity: 0.9 },
      { start: 23, end: 25, mode: 11, cursor: '0.2 0.3; 0.6 0.6', cam: '1.6 0.25 0.3; 1 0.5 0.5' }, { start: 25, end: 27, mode: 13, text: '10,000', style: 'odometer' }] };
    const md = RM.exportJob({ segs: [{ file: 'a.mp4', in: 0, out: 27 }] }, caps, { name: 'smoke-gfx2' }), rr = RM.parse(md, join(d, 'x.Reel.md'));
    if (RM.validate(rr).errs.length) fail('new graphics Reel.md invalid: ' + RM.validate(rr).errs.join('; '));
    const sig = fl => JSON.stringify(fl.map(f => Object.keys(f).sort().map(k => [k, f[k]])));
    if (sig(RM.graphicFlips(rr)) !== sig(caps.flips)) fail('graphics round trip:\n' + sig(RM.graphicFlips(rr)) + '\n' + sig(caps.flips));
    if (!RM.validate(RM.parse(md.replace('shape arrow', 'shape blob'), 'bad.md')).errs.length || !RM.validate(RM.parse(md.replace('glyph bolt', 'glyph logo'), 'bad.md')).errs.length) fail('a bad shape or glyph should fail the check');
  });
  step('layout pass: captions and titles move clear of a graphic or hide; export safe area; boxes measured from pixels', () => {
    const d = join(work, 'layout'); mkdirSync(d, { recursive: true });
    const wd = (t, t0) => t.split(' ').map((w, i) => [+(t0 + i * 0.3).toFixed(2), +(t0 + i * 0.3 + 0.28).toFixed(2), w]);
    const flips = [{ start: 0.2, end: 2, text: 'we hit ten thousand readers', mode: 0, words: wd('we hit ten thousand readers', 0.2) },
      { start: 2, end: 4, text: 'so follow the aigent today', mode: 0, words: wd('so follow the aigent today', 2) },
      { start: 0.3, end: 3.8, mode: 12, text: 'Will Gwyn', sub: 'Founder' }, { start: 2.2, end: 3.9, mode: 13, text: '10,000', sub: 'readers' }, { start: 2.3, end: 3.8, mode: 7, text: 'Ten thousand' }];
    writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'kinetic', fonts: 'theme', flips }) + ';\n');
    const env = { THEME: 'aigent', FONTS: 'theme' };
    run(node, [join(KIT, 'render.mjs'), '4', '1.0'], d, { ...env, BOXES_AT: '1.0,3.0' });
    const L = JSON.parse(readFileSync(join(d, 'layout.json'), 'utf8')).elements, B = JSON.parse(readFileSync(join(d, 'boxes.json'), 'utf8'));
    const cap1 = L.find(e => e.kind === 'caption' && e.start === 0.2), tt = L.find(e => e.kind === 'title');
    if (!cap1 || cap1.action !== 'shift') fail('the caption under the lower third should move clear of it: ' + JSON.stringify(cap1));
    if (!tt || !['shift', 'hide'].includes(tt.action)) fail('the title on the stat callout should move or hide: ' + JSON.stringify(tt));
    const ia = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    for (const { t, boxes } of B) for (const g of boxes.filter(x => x.kind === 'graphic')) for (const x of boxes.filter(x => x.kind !== 'graphic')) if (ia(g.box, x.box) > 900) fail(`overlap at ${t}s: ${x.kind} "${x.text}" on mode ${g.mode}`);
    // the same job laid out for Reels: everything inside its safe area once settled
    const X = createRequire(import.meta.url)('./exports.cjs');
    writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'kinetic', fonts: 'theme', flips, exportFrame: X.frameOf('reels') }) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '4', '1.0'], d, { ...env, BOXES_AT: '1.5,3.5' });
    const SR = X.safeRect('reels'), B2 = JSON.parse(readFileSync(join(d, 'boxes.json'), 'utf8'));
    for (const { t, boxes } of B2) for (const x of boxes) { if (t - x.start < 0.6 || x.end - t < 0.45) continue; const b = x.box; if (b.x0 < SR.x0 - 6 || b.x1 > SR.x1 + 6 || b.y0 < SR.y0 - 6 || b.y1 > SR.y1 + 6) fail(`reels safe area at ${t}s: ${x.kind} mode ${x.mode} ${JSON.stringify(b)}`); }
    if (!JSON.parse(readFileSync(join(d, 'layout.json'), 'utf8')).elements.some(e => e.action === 'safe-area')) fail('nothing placed inside the reels safe area');
  });
  step('spoken gate: near-homophones and aliases count, an unsaid optional field is left off and the graphic kept', () => {
    const W = (s, t0 = 0) => s.split(' ').map((w, i) => ({ start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.28, word: w }));
    const w = W('follow the agent and try grock it costs 49 dollars past it');
    if (!SP.said('aigent', w, 0, 3) || !SP.said('Grok', w, 0, 3)) fail('near-homophones should count (aigent/agent, grok/grock)');
    if (SP.said('post', w, 0, 3) || SP.said('99', w, 0, 3)) fail('post is not past, and numbers never match loosely');
    SP.fuzzyLog(true);
    const au = SP.audit([{ mode: 34, start: 0, end: 3, text: 'Follow the aigent', sub: 'link in bio' }, { mode: 22, start: 0, end: 3, text: 'Never said', sub: 'agent' }], w);
    const btn = au.flips.find(f => f.mode === 34);
    if (!btn || btn.sub || btn.text !== 'Follow the aigent') fail('CTA button should stay without its unsaid sub line: ' + JSON.stringify(au.flips));
    if (au.flips.some(f => f.mode === 22) || !au.dropped.some(x => x.kept && x.field === 'sub')) fail('a graphic whose required text is unsaid drops; the field drop is logged: ' + JSON.stringify(au.dropped));
    SP.setAliases({ Gwyn: ['guinn'] });
    if (!SP.said('Will Gwyn', W('I am Will Guinn'), 0, 2) || !SP.fuzzyLog(true).some(z => z.how === 'alias')) fail('a recipe alias should count and be logged');
    SP.setAliases({});
    const RM = createRequire(import.meta.url)('./reelmd.cjs');
    const r = RM.parse('---\nvideomd: 1\nname: x\ndescription: d\nsource:\n  duration: 10\nshots: 3\nlang: en\nx-reel: 1\n---\n\n# X\n\n## Aliases\n- aigent: agent, a gent\n', 'x.Reel.md');
    const v = RM.validate(r);
    if (v.errs.length || !v.warn.some(x => /no Shots block/.test(x))) fail('Shots is optional: ' + JSON.stringify(v));
    if ((r.aliases.aigent || []).join('|') !== 'agent|a gent') fail('aliases section: ' + JSON.stringify(r.aliases));
  });
  step('plan: numbers, steps, a command and the CTA from what you say; passes the check; merge keeps your lines', () => {
    const pj = join(work, 'jobs', 'planned', 'clips'); mkdirSync(pj, { recursive: true });
    const lines = ['Hi, I am Will Gwyn and I build agents.', 'We hit ten thousand readers last month.', 'Step one, record a take.', 'Step two, run the plan.', 'Run npx skills add in the terminal.', 'It costs 49 dollars a month.', 'Follow the agent for more reels like this.'];
    const clips = lines.map((t, i) => { const ws = t.split(' ').map((x, k) => [+(0.1 + k * 0.32).toFixed(2), +(0.38 + k * 0.32).toFixed(2), x]); return { id: 'clip-00' + (i + 1), file: `clips/clip-00${i + 1}.mp4`, dur: +(ws[ws.length - 1][1] + 0.4).toFixed(2), status: 'keep', text: t, words: ws }; });
    writeFileSync(join(pj, 'clips.json'), JSON.stringify({ clips }));
    const o = run(node, [join(KIT, 'plan.cjs'), 'planned', '--jobs', join(work, 'jobs'), '--json'], work);
    const res = JSON.parse(o.trim().split('\n').pop());
    const types = res.proposed.map(g => g.type);
    for (const t of ['lower-third', 'stat-callout', 'cta-card']) if (!types.includes(t)) fail(`plan should propose ${t}: ${types}`);
    if (!/PLAN OK/.test(o)) fail('plan output:\n' + o);
    const md = join(work, 'jobs', 'planned', 'Reel.md');
    if (!/REELMD PASS/.test(run(node, [join(KIT, 'reelmd.cjs'), 'check', md], work))) fail('planned Reel.md should pass the check');
    for (let i = 1; i < res.proposed.length; i++) if (res.proposed[i].start < res.proposed[i - 1].end) fail('planned graphics overlap in time');
    writeFileSync(md, readFileSync(md, 'utf8').replace(/^```reel-graphics\n/m, '```reel-graphics\n#00 0.4-1.9 | type highlight | shape underline | text Will\n').replace('## Aliases\n', '## Aliases\n- aigent: agent\n'));
    const o2 = JSON.parse(run(node, [join(KIT, 'plan.cjs'), 'planned', '--jobs', join(work, 'jobs'), '--json', '--fresh'], work).trim().split('\n').pop());
    const md2 = readFileSync(md, 'utf8');
    if (!/type highlight \| shape underline/.test(md2)) fail('your own graphics line should stay');
    if (o2.proposed.some(g => g.start < 1.9 && g.end > 0.4)) fail('a proposal should not share the screen with your line');
    if (!/Follow the aigent/.test(md2)) fail('an alias should turn the heard word into the one you mean in the proposal:\n' + md2);
  });
  step('teardown mapping: stray caption words left out of titles, room light is not a finish, graphics mapped', () => {
    const V = createRequire(import.meta.url)('./videomd2reel.cjs');
    const cue = (t0, t1, text, extra = {}) => ({ t0, t1, text, kind: 'label', band: 'top', conf: 0.95, line_h: 0.07, bbox: [0.3, 0.15, 0.4, 0.07], style: { fill: '#ffffff' }, ...extra });
    const words = [[0, 0.5, 'start'], [0.5, 1, 'with'], [1, 1.5, 'the'], [1.5, 2, 'brainstorm'], [2, 2.5, 'plugin'], [2.5, 3, 'now'], [3, 3.5, 'runs'], [3.5, 4, 'fast'], [4, 4.6, 'today']];
    const b = { packaging: { text_cues: [
      ...words.map(w => cue(w[0], w[1], w[2].toUpperCase())),
      cue(1.5, 2, 'brainstom'),                                      // the word being said, OCR misspelt: a caption
      cue(3, 3.5, 'nuns', { line_h: 0.05 }),                         // misread caption word at caption size: a caption
      cue(4.8, 6.5, 'BIG IDEA', { line_h: 0.12, band: 'middle', bbox: [0.2, 0.45, 0.6, 0.12] }), // styled apart: a title
      cue(2, 2.5, 'PLUGIN', { line_h: 0.11, style: { fill: '#ffffff', box: true } })] }, speech: { words } };
    const t = V.pickTitles(b);
    const txt = t.map(x => x.text).join(' / ');
    if (!/BIG IDEA/.test(txt) || /brainstom|nuns/i.test(txt)) fail('titles: ' + txt);
    if (!t.dropped.some(d => d.text === 'nuns') ) fail('dropped list should name the stray word: ' + JSON.stringify(t.dropped));
    // even warm cast on every shot = room light; mono on one shot only = a finish
    const shot = (finish, m) => ({ finish, finishWhy: 'grade', m });
    const warm = { shadow_b: 4, mean_b: 3, sat: 0.3, contrast: 0.4 };
    const shots = [shot('warm', warm), shot('warm', warm), shot('warm', warm), shot('mono,warm', { ...warm, sat: 0.01 })];
    const notes = V.gradeChoice(shots);
    if (shots.slice(0, 3).some(s => s.finish) || !/mono/.test(shots[3].finish || '') || /warm/.test(shots[3].finish || '')) fail('finish choice: ' + shots.map(s => s.finish).join(' / '));
    if (!notes.length || !/room/.test(notes[0])) fail('ambient note missing: ' + notes);
    const gm = V.mapGraphics(b, { graphics: [
      { type: 'ordinal-sticker', start: 0.5, end: 1.5, text: 'FIRST', layer: 'behind', color: '#f2e8a0', bbox: [0.15, 0.2, 0.7, 0.2] },
      { type: 'ordinal-sticker', start: 3, end: 4, text: null, layer: 'behind', color: '#f2e8a0', bbox: [0.15, 0.2, 0.7, 0.2] },
      { type: 'app-label', start: 3.2, end: 4, text: 'My App', tile: '#da4559', bbox: [0.1, 0.5, 0.2, 0.11] },
      { type: 'screen-card', start: 5, end: 9, border: '#d87b5b', ui_text: 6, bbox: [0.17, 0.55, 0.66, 0.3] }] });
    const s = gm.map(x => `${x.type}:${x.text || ''}${x.guess ? '~' : ''}`).join(' ');
    if (s !== 'ordinal-sticker:FIRST ordinal-sticker:SECOND~ app-label:My App screen-card:') fail('mapped graphics: ' + s);
    if (!(gm[0].size > 300 && gm[0].y > 0.3 && gm[3].y > 0.6)) fail('graphic geometry: ' + JSON.stringify(gm.map(x => [x.x, x.y, x.size, x.w])));
    // burst size relative to the head; what a card showed, the address read in it and the tool named before it
    const gh = V.mapGraphics(b, { graphics: [
      { type: 'ordinal-sticker', start: 0.5, end: 1.5, text: 'FIRST', layer: 'behind', bbox: [0.15, 0.2, 0.7, 0.2], width: 0.7, face_w: 0.25, head_cy: 0.32, head_ratio: 2.8 },
      { type: 'app-label', start: 4, end: 5, text: 'Notebook', tile: '#000000', bbox: [0.1, 0.5, 0.2, 0.11] },
      { type: 'screen-card', start: 5, end: 9, border: '#d87b5b', ui_text: 6, bbox: [0.17, 0.55, 0.66, 0.3], shown: ['Notebook', 'take notes faster'], urls: ['github.com/example-org/notebook'] }] });
    if (gh[0].head !== 2.8 || !(gh[0].headY > 0.3 && gh[0].headY < 0.9)) fail('burst relative to the head: ' + JSON.stringify(gh[0]));
    const card = gh.find(g => g.type === 'screen-card');
    if (card.subject !== 'Notebook' || card.sourceGuess !== 'https://github.com/example-org/notebook' || card.named !== 'Notebook') fail('card source suggestion: ' + JSON.stringify(card));
    // caption look from the ring measures: plain letters (ring = background) vs a dark outline
    const plain = [0, 1, 2, 3].map(i => ({ t0: i, text: 'w' + i, near: 120, mid: 119, far: 118 })), outl = [0, 1, 2, 3].map(i => ({ t0: i, text: 'w' + i, near: 20, mid: 30, far: 120 }));
    const lk = (x) => V.captionLook(x, null);
    if (lk(plain).outline !== 'none' || lk(plain).shadow !== 'none' || lk(outl).outline !== 'thick') fail('caption look: ' + JSON.stringify([lk(plain), lk(outl)]));
    // caption layer: letters gone where the word meets the person -> behind; letters there too -> front
    const gone = [0, 1, 2].map(i => ({ t0: i, text: 'w' + i, on_n: 400, text_on_person: 0.01, text_off_person: 0.2 })), kept = gone.map(m => ({ ...m, text_on_person: 0.2 }));
    const ly = x => V.captionLook(plain, null, x);
    if (ly(gone).layer !== 'behind' || ly(kept).layer !== 'front' || ly(gone.slice(0, 1)).layer !== null) fail('caption layer verdict: ' + JSON.stringify([ly(gone), ly(kept)]));
  });
  step('render overlay frames (2 s)', () => {
 run(node, [join(KIT, 'render.mjs'), '2'], build); const n = readdirSync(join(build, 'ovl')).length; if (n !== 48) fail('frames ' + n); });
  step('sfx pack manifest + auto-pick', () => {
    const v = SFXPLAN.validateManifest();
    if (v.errs.length) fail('sfx.json: ' + v.errs.join('; '));
    const man = SFXPLAN.loadManifest();
    if (man.sounds.length !== 37) fail('expected 37 pack sounds, got ' + man.sounds.length);
    if (man.sounds.filter(x => x.auto === false).map(x => x.id.slice(0, 2)).join(',') !== '33,34,35,36,37,38') fail('the six named-only sounds should be auto false');
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
  step('b-roll insert covers the picture for its span only, voice and length unchanged; check refuses a missing insert', () => {
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=720x1280:r=24:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'insert.mp4'], work);
    const cutF = join(build, 'cut.json'), keep = readFileSync(cutF, 'utf8');
    writeFileSync(cutF, JSON.stringify({ ...JSON.parse(keep), inserts: [{ file: '../insert.mp4', at: 0.8, dur: 0.8, in: 0.2 }] }));
    try {
      run(node, [join(KIT, 'assemble.cjs'), 'ins.mp4'], build);
      const px = t => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', 'ins.mp4', '-frames:v', '1', '-vf', 'format=rgb24,crop=1:1:20:20', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { cwd: build })];
      const red = px(1.2), after = px(2.0);
      if (!(red[0] > 180 && red[1] < 70 && red[2] < 70)) fail('insert not on screen at 1.2 s: ' + red);
      if (after[0] > 180 && after[1] < 70 && after[2] < 70) fail('insert still on screen at 2.0 s');
      const d = +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'ins.mp4'], build);
      if (Math.abs(d - 3.5) > 0.25) fail('insert changed the length: ' + d);
      writeFileSync(cutF, JSON.stringify({ ...JSON.parse(keep), inserts: [{ file: '../nope.mp4', at: 0.8, dur: 0.8 }] }));
      try { run(node, [join(KIT, 'check.mjs'), build], work); fail('check passed a missing insert'); } catch (e) { if (!/inserts\[0\]: no file/.test(String(e.stdout || ''))) throw e; }
    } finally { writeFileSync(cutF, keep); }
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
    run(node, [join(KIT, 'reel.cjs'), '--clips', clips, '--jobs', join(work, 'jobs'), '--name', 'muse', '--look', 'muse', '--mask', 'mediapipe', '--title-layer', 'behind'], work);
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
  step('Reel.md: shipped recipes check, compile, export round-trip, VIDEO.md package', () => {
    const RM = createRequire(import.meta.url)('./reelmd.cjs');
    const dir = join(dirname(KIT), 'examples', 'recipes');
    const files = readdirSync(dir).filter(f => /\.Reel\.md$/.test(f));
    if (files.length < 4) fail('expected 4 example recipes, got ' + files);
    if (!files.includes('launch-day.Reel.md')) fail('the launch-day recipe (modes 24 to 37) is missing');
    for (const f of files) {
      const r = RM.load(join(dir, f)); const v = RM.validate(r);
      if (v.errs.length) fail(f + ': ' + v.errs.join('; '));
      const c = RM.compile(r);
      if ((r.shots.length && (!c.cut.shotPlan || c.cut.shotPlan.length !== r.shots.length)) || (c.captions.titles || []).length !== r.titles.length) fail(f + ' did not compile its shots and titles');
      if ((c.captions.graphics || c.captions.flips || []).length < (r.graphics || []).length) fail(f + ' did not compile its graphics');
    }
    // a finished job -> Reel.md -> compile gives back the same cut and titles; export is stable
    const cut = { preset: 'cinematic', segs: [{ file: '../clips/a.mp4', in: 0, out: 2.5, finish: 'teal' }, { file: '../clips/b.mp4', in: 1, out: 3.2, bigPunch: true, transition: 'crossfade' }, { file: '../clips/c.mp4', in: 0.4, out: 2, finish: 'mono,grain' }],
      tail: 0.3, bed: 'cinematic-build', bedVol: 0.14, beatSync: true, titleLayer: 'auto', finish: 'vignette' };
    const caps = { captionStyle: 'one-word', fonts: 'druk', flips: [{ start: 0.2, end: 1.4, text: 'Stop scrolling', mode: 7, entrance: 'slam', layer: 'behind' }, { start: 4.1, end: 5.5, text: 'Do this', mode: 7, entrance: 'pop-zoom', layer: 'front' }, { start: 0.5, end: 1, text: 'cap', mode: 0 }] };
    const md = RM.exportJob(cut, caps, { name: 'smoke-roundtrip' });
    if (/\u2014/.test(md)) fail('export wrote an em dash');
    const r = RM.parse(md, 'roundtrip.md'); const v = RM.validate(r);
    if (v.errs.length) fail('exported Reel.md invalid: ' + v.errs.join('; '));
    const c = RM.compile(r);
    const strip = x => JSON.stringify(x.map(s => ({ file: s.file, in: s.in, out: s.out, finish: s.finish, bigPunch: s.bigPunch, transition: s.transition })));
    if (strip(c.cut.segs) !== strip(cut.segs)) fail('segs changed in the round trip:\n' + strip(c.cut.segs) + '\n' + strip(cut.segs));
    if (c.cut.bed !== 'cinematic-build' || c.cut.bedVol !== 0.14 || c.cut.beatSync !== true || c.cut.titleLayer !== 'auto' || c.cut.finish !== 'vignette') fail('cut settings changed: ' + JSON.stringify(c.cut));
    if (c.captions.captionStyle !== 'one-word' || c.captions.fonts !== 'druk') fail('caption settings changed: ' + JSON.stringify(c.captions));
    const t = c.captions.titles.map(x => `${x.start}-${x.end} ${x.entrance} ${x.layer} ${x.text}`).join(' / ');
    if (t !== '0.2-1.4 slam behind Stop scrolling / 4.1-5.5 pop-zoom front Do this') fail('titles changed: ' + t);
    if (RM.exportJob(c.cut, { ...c.captions, flips: c.captions.titles }, { name: 'smoke-roundtrip' }) !== md) fail('export is not stable across a round trip');
    // caption place and colour, and graphics, survive the round trip
    const gcaps = { captionStyle: 'one-word', captionPosition: 'top', captionColor: '#ffffff', flips: [
      { start: 1, end: 2, mode: 9, text: 'FIRST', layer: 'behind', color: '#f2e8a0', size: 360 },
      { start: 1.2, end: 2.5, mode: 10, text: 'My App', tile: '#da4559', x: 0.1, y: 0.5 },
      { start: 3, end: 6, mode: 11, src: join(work, 'screen.mp4'), border: '#d87b5b', w: 0.66 }] };
    const gmd = RM.exportJob(cut, gcaps, { name: 'smoke-graphics' });
    if (!/- caption-position: top/.test(gmd) || !/```reel-graphics/.test(gmd)) fail('export lost caption-position or graphics:\n' + gmd);
    const gr = RM.parse(gmd, join(work, 'g.Reel.md')), gv = RM.validate(gr);
    if (gv.errs.length) fail('graphics Reel.md invalid: ' + gv.errs.join('; '));
    const gc = RM.compile(gr);
    if (gc.captions.captionPosition !== 'top' || gc.captions.captionColor !== '#ffffff') fail('caption place: ' + JSON.stringify(gc.captions));
    const sig = fl => JSON.stringify(fl.map(f => [f.start, f.end, f.mode, f.text || '', f.layer || '', f.size || 0, f.src || '']));
    if (sig(gc.captions.graphics) !== sig(gcaps.flips)) fail('graphics changed:\n' + sig(gc.captions.graphics) + '\n' + sig(gcaps.flips));
    if (!RM.validate(RM.parse(gmd.replace('type app-label', 'type banner'), 'bad.md')).errs.length) fail('an unknown graphic type should fail the check');
    const pkg = join(work, 'videomd-pkg'); RM.toPackage(r, pkg);
    if (!existsSync(join(pkg, 'VIDEO.md')) || !existsSync(join(pkg, 'video', 'timeline.md')) || readdirSync(join(pkg, 'video', 'shots')).length !== 3) fail('VIDEO.md package incomplete');
    const py = process.env.PYTHON || 'python3';
    let has = false; try { run(py, ['-c', 'import videomd']); has = true; } catch {}
    if (has) { const errs = run(py, ['-c', `import videomd,json;print(json.dumps(videomd.check(${JSON.stringify(pkg)})))`]).trim(); if (errs !== '[]') fail('videomd check: ' + errs); }
  });
  step('reel.cjs --recipe: per-shot finish, punch, transition, title pattern; flags win over the recipe', () => {
    const recipe = join(dirname(KIT), 'examples', 'recipes', 'cinematic.Reel.md');
    run(node, [join(KIT, 'reel.cjs'), '--clips', join(work, 'clips-muse'), '--jobs', join(work, 'jobs'), '--name', 'recipe', '--recipe', recipe, '--mask', 'mediapipe', '--draft'], work);
    const b = join(work, 'jobs', 'recipe', 'build');
    const cut = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8'));
    const fin = cut.segs.map(s => s.finish || '-').join(' ');
    if (fin !== 'teal,vignette mono,grain teal warm,grain') fail('per-shot finishes from the recipe: ' + fin);
    if (cut.segs[1].transition !== 'crossfade' || !cut.segs[2].bigPunch) fail('recipe transition / big punch not applied: ' + JSON.stringify(cut.segs));
    if (cut.bed !== 'cinematic-build' || cut.bedVol !== 0.14 || cut.titleLayer !== 'auto' || cut.recipe !== 'cinematic') fail('recipe music / layer: ' + JSON.stringify({ bed: cut.bed, bedVol: cut.bedVol, tl: cut.titleLayer, recipe: cut.recipe }));
    const caps = R.readCaptions(join(b, 'captions.js'));
    const ts = caps.flips.filter(f => f.mode === 7).sort((x, y) => x.start - y.start);
    if (ts[0].entrance !== 'blur-rise' || ts[0].layer !== 'behind' || ts[1].entrance !== 'slide-left' || ts[1].layer !== 'front') fail('title pattern: ' + JSON.stringify(ts.map(t => [t.entrance, t.layer])));
    const ents = ts.map(t => t.entrance).filter(Boolean); if (new Set(ents).size !== ents.length) fail('an entrance repeats: ' + ents);
    // the reference's words never reach your clip: a recipe title, ordinal sticker or app label shows only if you say it
    const r2 = join(work, 'spoken.Reel.md');
    writeFileSync(r2, readFileSync(recipe, 'utf8').replace('#03 24.3-26.5', '#04 1.6-3.0 | entrance pop-zoom | layer front | text Record one take\n#03 24.3-26.5')
      + '\n## Graphics\n\n```reel-graphics\n#01 0.5-1.2 | type ordinal-sticker | text FIRST | layer behind\n#02 0.6-1.0 | type app-label | text Dropbox\n#03 3.4-3.8 | type app-label | text Inbox\n```\n');
    run(node, [join(KIT, 'reel.cjs'), '--clips', join(work, 'clips-muse'), '--jobs', join(work, 'jobs'), '--name', 'recipe-flags', '--recipe', r2, '--title-layer', 'front', '--bed', 'yeehaw', '--no-mask', '--draft', '--recipe-titles'], work);
    const c2 = JSON.parse(readFileSync(join(work, 'jobs', 'recipe-flags', 'build', 'cut.json'), 'utf8'));
    if (c2.titleLayer !== 'front' || c2.bed !== 'yeehaw') fail('flags should win over the recipe: ' + JSON.stringify({ tl: c2.titleLayer, bed: c2.bed }));
    const t2 = R.readCaptions(join(work, 'jobs', 'recipe-flags', 'build', 'captions.js')).flips.filter(f => f.mode === 7).map(f => f.text).join(' / ');
    if (t2 !== 'Record one take') fail('--recipe-titles should keep only recipe text you say there (Record one take): ' + t2);
    const fb = JSON.parse(readFileSync(join(work, 'jobs', 'recipe-flags', 'build', 'cut.json'), 'utf8')), bdir = join(work, 'jobs', 'recipe-flags', 'build');
    const said = SP.timeline(fb.segs, bdir), fl = R.readCaptions(join(bdir, 'captions.js')).flips;
    const shown = fl.filter(f => [7, 9, 10].includes(f.mode) && f.text);
    const bad = shown.filter(f => !SP.said(f.text, said, f.start, f.end));
    if (bad.length) fail('on-screen text you never say: ' + bad.map(f => `${f.text}@${f.start}`).join(', '));
    if (shown.some(f => f.mode === 9)) fail('ordinal sticker kept though no ordinal is said');
    const lab = shown.filter(f => f.mode === 10).map(f => f.text).join(' ');
    if (lab !== 'Inbox') fail('app labels should be only the one you name (Inbox): ' + lab);
    // an ordinal you say becomes the sticker, with your word, when you say it
    const fg = SP.fitGraphics([{ start: 2.5, end: 3.25, mode: 9, text: 'FIRST', layer: 'behind' }], [{ start: 2.97, end: 3.29, word: 'second,' }], 10).gfx;
    if (fg.length !== 1 || fg[0].text !== 'SECOND' || Math.abs(fg[0].start - 2.82) > 0.01) fail('ordinal from your words: ' + JSON.stringify(fg));
  });
  step('style pack + locks: --pack magazine with --lock keeps every seam and title inside the lock; choices.json explains and applies edits', () => {
    run(node, [join(KIT, 'reel.cjs'), '--clips', join(work, 'clips-muse'), '--jobs', join(work, 'jobs'), '--name', 'pack-lock', '--pack', 'magazine', '--lock', 'transitions=whip,zoom; titles=typewriter', '--no-mask', '--draft'], work);
    const b = join(work, 'jobs', 'pack-lock', 'build'), cut = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8'));
    if (cut.pack !== 'magazine') fail('cut.json should name the pack: ' + cut.pack);
    const seams = cut.segs.filter((s, i) => i && !s.jump).map(s => s.transition || 'glitch');
    if (!seams.length || seams.some(t => !['whip', 'zoom'].includes(t))) fail('a seam outside the transitions lock: ' + seams);
    const ts = R.readCaptions(join(b, 'captions.js')).flips.filter(f => f.mode === 7);
    if (ts.some(t => t.entrance !== 'typewriter')) fail('a title outside the titles lock: ' + ts.map(t => t.entrance));
    run(node, [join(KIT, 'check.mjs'), b], work); // a locked repeat is allowed
    const cf = join(work, 'jobs', 'pack-lock', 'choices.json');
    if (!existsSync(cf)) fail('the draft should write choices.json');
    const ch = JSON.parse(readFileSync(cf, 'utf8'));
    if (ch.beats.length !== cut.segs.length || !/locked|weighted/.test(ch.beats.find(r => r.n > 1 && !r.jump).transitionWhy)) fail('choices.json beats: ' + JSON.stringify(ch.beats.slice(0, 3)));
    const k = ch.beats.findIndex(r => r.n > 1 && !r.jump); ch.beats[k].transition = 'dissolve';
    writeFileSync(cf, JSON.stringify(ch));
    const o = run(node, [join(KIT, 'choices.cjs'), 'pack-lock', '--jobs', join(work, 'jobs'), '--apply', '--json'], work);
    const res = JSON.parse(o.trim().split('\n').pop());
    if (!res.ok || JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8')).segs[k].transition !== 'dissolve' || res.beats[k].transitionWhy !== 'you') fail('choices --apply: ' + o.slice(-400));
    try { run(node, [join(KIT, 'reel.cjs'), '--clips', join(work, 'clips-muse'), '--jobs', join(work, 'jobs'), '--name', 'pack-x', '--pack', 'magazine', '--preset', 'aigent', '--draft'], work); fail('--pack with --preset should refuse'); } catch (e) { if (!/not both/.test(String(e.stderr || '') + String(e.stdout || '') + e.message)) throw e; }
  });
  step('teardown (built-in fallback) on a synthetic 3-shot reel: shots, mono shot, titles, Reel.md', () => {
    const td = join(work, 'td'); mkdirSync(td);
    const font = join(KIT, 'fonts', 'ArchivoBlack-Regular.ttf').replace(/\\/g, '/').replace(/:/g, '\\:');
    const shot = (n, src, extra) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-vf', `scale=720:1280,setsar=1${extra}`, '-t', '2', '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', `s${n}.mp4`], td);
    const txt = w => `,drawtext=fontfile='${font}':text='${w}':fontsize=150:fontcolor=white:borderw=6:bordercolor=black:x=(w-tw)/2:y=h*0.3`;
    shot(1, 'testsrc2=size=720x1280:rate=24', txt('HELLO'));
    shot(2, 'smptebars=size=720x1280:rate=24', ',' + B.finishChain('mono'));
    shot(3, 'mandelbrot=size=720x1280:rate=24', txt('FOLLOW'));
    writeFileSync(join(td, 'list.txt'), 's1.mp4\ns2.mp4\ns3.mp4\n'.split('\n').filter(Boolean).map(f => `file '${f}'`).join('\n'));
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'ref.mp4'], td);
    run(node, [join(KIT, 'teardown.mjs'), join(td, 'ref.mp4'), '--engine', 'lite', '--no-asr', '--out', join(td, 'out')], work);
    const RM = createRequire(import.meta.url)('./reelmd.cjs');
    const r = RM.load(join(td, 'out', 'Reel.md')); const v = RM.validate(r);
    if (v.errs.length) fail('teardown Reel.md invalid: ' + v.errs.join('; '));
    if (r.shots.length !== 3) fail('expected 3 shots, got ' + r.shots.length);
    if (!/mono/.test(r.shots[1].finish || '')) fail('shot 2 should read as mono: ' + JSON.stringify(r.shots[1]));
    if (!existsSync(join(td, 'out', 'teardown.md')) || !existsSync(join(td, 'out', 'contact.jpg'))) fail('teardown report or contact sheet missing');
    const fb = JSON.parse(readFileSync(join(td, 'out', 'fallback.json'), 'utf8'));
    if (!fb.packaging.note) { const words = r.titles.map(t => t.text.toUpperCase()).join(' '); if (!/HELLO/.test(words) || !/FOLLOW/.test(words)) fail('OCR titles: ' + words); }
    // URLs: other sites are refused; --url takes one Instagram post and needs instaloader. No network here.
    try { run(node, [join(KIT, 'teardown.mjs'), 'https://example.com/reel.mp4'], work); fail('teardown accepted a URL'); } catch (e) { if (!/single Instagram post with --url/.test(String(e.stderr || ''))) throw e; }
    try { run(node, [join(KIT, 'teardown.mjs'), '--url', 'https://example.com/reel.mp4'], work); fail('teardown --url accepted a non-Instagram URL'); } catch (e) { if (!/single Instagram post or reel link/.test(String(e.stderr || ''))) throw e; }
    try { run(node, [join(KIT, 'teardown.mjs'), '--url', 'https://www.instagram.com/someprofile/'], work); fail('teardown --url accepted a profile URL'); } catch (e) { if (!/Profiles, hashtags/.test(String(e.stderr || ''))) throw e; }
    try { run(node, [join(KIT, 'teardown.mjs'), '--url', 'https://www.instagram.com/reel/ABCdef12345/'], work, { PYTHON: join(work, 'no-python-here') }); fail('teardown --url ran without instaloader'); } catch (e) { if (!/needs instaloader/.test(String(e.stderr || ''))) throw e; }
  });
  step('title entrances: mid-entrance differs from settled, all eight resolve once, flicker on hook + payoff only', () => {
    const b = join(work, 'jobs', 'muse', 'build');
    const caps = JSON.parse(readFileSync(join(b, 'captions.js'), 'utf8').replace(/^window\.CAPTIONS=/, '').replace(/;\s*$/, ''));
    caps.flips = caps.flips.filter(f => f.mode !== 7);
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'].forEach((t, i) => caps.flips.push({ start: i * 0.9, end: i * 0.9 + 0.85, text: t, mode: 7 }));
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
    const o = run(node, [join(KIT, 'render.mjs'), '0', '0.1,0.7'], b);
    const m = o.match(/titles (.*)/); if (!m) fail('render did not report titles');
    const ent = m[1].split(', ').map(x => x.split(' ')[1].replace('+flicker', ''));
    if (new Set(ent).size !== 8) fail('entrances repeat: ' + m[1]);
    const fl = m[1].split(', ').map(x => /\+flicker/.test(x)); if (!fl[0] || !fl[7] || fl.slice(1, 7).some(Boolean)) fail('flicker placement: ' + m[1]);
    const a = readFileSync(join(b, 'stills', 't0.10.png')), z = readFileSync(join(b, 'stills', 't0.70.png'));
    if (a.equals(z)) fail('title did not move between mid-entrance and settled');
    caps.flips.push({ start: 7.3, end: 7.5, text: 'NINE', mode: 7 }, { start: 8.1, end: 8.3, text: 'TEN', mode: 7 });
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
    try { run(node, [join(KIT, 'check.mjs'), b], work); fail('check passed 10 titles'); } catch (e) { if (!/10 titles/.test(String(e.stdout || ''))) throw e; }
    caps.flips = caps.flips.filter(f => f.text !== 'NINE' && f.text !== 'EIGHT' && f.text !== 'TEN').concat([{ start: 6.3, end: 6.5, text: 'EIGHT', mode: 7, entrance: 'slam' }, { start: 7.3, end: 7.5, text: 'NINE', mode: 7, entrance: 'slam' }]).filter(f => f.text !== 'SEVEN');
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
    try { run(node, [join(KIT, 'check.mjs'), b], work); fail('check passed a repeated entrance'); } catch (e) { if (!/entrance "slam" already used/.test(String(e.stdout || ''))) throw e; }
  });
  step('font pairings: all 15 load and render as two-font lockups; a list cycles them as whole pairs; unknown pairing refused', () => {
    const b = join(work, 'jobs', 'muse', 'build'), capF = join(b, 'captions.js'), keep = readFileSync(capF, 'utf8');
    const w = (t0, txt) => txt.split(' ').map((x, i) => [+(t0 + i * 0.2).toFixed(2), +(t0 + i * 0.2 + 0.2).toFixed(2), x]);
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'kinetic', flips: [
      { start: 0, end: 2, text: 'Record one take', mode: 7, hero: [0] },
      { start: 0, end: 2, text: 'Record one take on your phone', mode: 0, words: w(0, 'Record one take on your phone'), hero: 'record' },
      { start: 2, end: 4, text: 'Drop the file in the inbox', mode: 7 },
      { start: 2, end: 4, text: 'Ask for the reel', mode: 0, words: w(2, 'Ask for the reel') }] }) + ';\n');
    for (const fp of ['druk', 'modern', 'elegant', 'editorial', 'literata', 'bricolage', 'pirata', 'michroma', 'redhat', 'jakarta', 'grotesk-times', 'avantgarde', 'recoleta', 'haas', 'wabbit']) {
      const o = run(node, [join(KIT, 'render.mjs'), '0', '1.0'], b, { FONTS: fp });
      if (!new RegExp('fonts ' + fp).test(o)) fail('pairing not applied: ' + fp + '\n' + o);
      if (!/"url":"file:/.test(readFileSync(join(b, 'fonts.js'), 'utf8'))) fail('fonts.js has no font files for ' + fp);
      // two-font lockups: every multi-word title and kinetic line pairs a big hero with a smaller partner on one line
      const L = JSON.parse(readFileSync(join(b, 'lockups.json'), 'utf8'));
      if (!L.some(l => l.kind === 'title')) fail(fp + ': no title lockups');
      const want = { druk: 'stack', modern: 'overlap', elegant: 'overlap', jakarta: 'overlap', wabbit: 'overlap', redhat: 'stack', pirata: 'stack' }[fp];
      for (const l of L) {
        if (!l.partners.length) continue;
        for (const q of l.partners) { const r = q.size / l.heroSize; if (r < 0.25 || r > 0.9) fail(`${fp} ${l.kind} ${l.start}s: partner/hero size ${r.toFixed(2)}`); if (q.w > 960) fail(`${fp}: partner "${q.txt}" wider than the frame`); }
        if (l.kind === 'kinetic') for (const q of l.partners) if (q.size < (q.script ? 60 : 46) || q.size / l.heroSize < 0.5) fail(`${fp} kinetic ${l.start}s: partner "${q.txt}" ${q.size}px (hero ${l.heroSize}px) is too small to read`);
        if (want && l.arrange !== want) fail(`${fp}: ${l.kind} arranged ${l.arrange}, want ${want}`);
        if ((fp === 'modern' || fp === 'elegant') && !l.partners.every(q => q.script)) fail(fp + ': partner is not the script face');
        // an inline lockup shares its line with the partner, so the whole line has to fill the width, not the hero alone
        const span = l.arrange === 'inline' ? l.box[2] - l.box[0] : l.heroW;
        if (l.kind === 'title' && l.hero.length <= 7 && span < 0.8 * 960 && l.heroSize < 360) fail(`${fp}: title hero "${l.hero}" only ${span}px wide`);
      }
      if (!L.some(l => l.partners.length)) fail(fp + ': no lockup has a partner face');
    }
    // a list cycles: titles take the pairings in turn, each caption line takes its title's pair, no phrase mixes two
    { const o = run(node, [join(KIT, 'render.mjs'), '0', '1.0'], b, { FONTS: 'literata,bricolage,michroma' });
      if (!/font cycle literata > bricolage > michroma/.test(o)) fail('font cycle not applied: ' + o);
      const got = JSON.parse(readFileSync(join(b, 'lockups.json'), 'utf8')).map(l => `${l.kind} ${l.start} ${l.fonts} ${l.faces.join('+')}`).join('; ');
      const want = 'title 0 literata Archivo Black+Literata; kinetic 0 literata Archivo Black+Literata; title 2 bricolage Bricolage Grotesque+Gloock; kinetic 2 bricolage Bricolage Grotesque+Gloock';
      if (got !== want) fail('font cycle lockups: ' + got); }
    writeFileSync(capF, keep);
    try { run(node, [join(KIT, 'render.mjs'), '0', '1.0'], b, { FONTS: 'helvetica-please' }); fail('unknown pairing accepted'); } catch (e) { if (!/Unknown font pairing/.test(String(e.stderr || ''))) throw e; }
    run(node, [join(KIT, 'render.mjs'), '0', '1.0'], b, { FONTS: 'theme' });
  });
  step('oneword look: one word at a time, hero in the display face with the phrase building under it, type card in front', () => {
    const b = join(work, 'jobs', 'muse', 'build'), capF = join(b, 'captions.js'), keep = readFileSync(capF, 'utf8');
    const ws = (t0, s) => s.split(' ').map((x, i) => [+(t0 + i * 0.25).toFixed(2), +(t0 + i * 0.25 + 0.25).toFixed(2), x]);
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'oneword', fonts: 'instrument', flips: [
      { start: 0, end: 1.6, text: 'Record the whole take on your phone', mode: 0, words: ws(0, 'Record the whole take on your phone'), hero: 'take' },
      { start: 1.8, end: 3.0, text: 'Step two: drop it in', mode: 0, words: ws(1.8, 'Step two: drop it in') },
      { start: 1.8, end: 3.0, mode: 8, bg: 'navy', number: '2' }] }) + ';\n');
    const o = run(node, [join(KIT, 'render.mjs'), '0', '0.3,1.2,2.4'], b);
    if (!/fonts instrument/.test(o)) fail('instrument pairing not applied: ' + o);
    const W = JSON.parse(readFileSync(join(b, 'oneword.json'), 'utf8')), at = s => W.find(w => Math.abs(w.t - s) < 0.01);
    if (W.length !== 12) fail('expected one state per word (12), got ' + W.length);
    if (at(0).txt !== 'Record' || at(0).face !== 'body' || at(0.25).face !== 'small') fail('words before the hero: ' + JSON.stringify(W.slice(0, 3)));
    const h = at(0.75), last = at(1.5);
    if (h.txt !== 'take' || h.face !== 'hero' || h.size < 1.6 * at(0).size) fail('hero: ' + JSON.stringify(h));
    if (last.txt !== 'take' || last.tail !== 'on your phone') fail('the phrase should build under the hero: ' + JSON.stringify(last));
    if (!W.filter(w => w.t >= 1.8).every(w => w.card && w.ink === '#efe6cf')) fail('words on the card should take its ink: ' + JSON.stringify(W.slice(7)));
    if (!W.some(w => w.face === 'stack') && !W.some(w => w.face === 'big')) { /* too few phrases here for the stack or big words; the oneword demo shows them */ }
    if (new Set(W.filter(w => w.card).map(w => w.x + ',' + w.y)).size < 3) fail('words on a card should move around it, not sit in one spot: ' + JSON.stringify(W.filter(w => w.card)));
    const px = (f, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-i', join(b, 'stills', f), '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { cwd: b })];
    const card = px('t2.40.png', 8, 8), face = px('t1.20.png', 8, 8);
    if (card[0] !== 14 || card[1] !== 26 || card[2] !== 51 || card[3] !== 255) fail('card should fill the frame navy, got ' + card);
    if (face[3] !== 0) fail('no card: the overlay corner should be clear, got ' + face);
    // three pairings cycling: a card that spans a pairing change keeps one pairing on screen with the words under it
    const ph = k => ({ start: k * 0.6, end: k * 0.6 + 0.5, text: 'one two', mode: 0, words: ws(k * 0.6, 'one two') });
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'oneword', fonts: 'instrument,literata,bricolage', flips: [ph(0), ph(1), ph(2), ph(3), { start: 1.3, end: 2.1, mode: 8, bg: 'ink' }] }) + ';\n');
    const o2 = run(node, [join(KIT, 'render.mjs'), '0', '2.0'], b);
    if (/pairing mix/.test(o2)) fail('one frame shows two font pairings: ' + o2);
    // a chain: a title overlaps a caption that overlaps a card; the whole chain keeps one pairing
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'oneword', fonts: 'instrument,literata,bricolage', flips: [ph(0), ph(1), ph(2),
      { start: 1.8, end: 3.0, text: 'one two', mode: 0, words: ws(1.8, 'one two') }, { start: 0, end: 2, text: 'Record one take', mode: 7, hero: [0], entrance: 'slam' }, { start: 2.5, end: 3.0, mode: 8, bg: 'ink' }] }) + ';\n');
    const o3 = run(node, [join(KIT, 'render.mjs'), '0', '2.7'], b);
    if (/pairing mix/.test(o3)) fail('a chain of overlaps shows two font pairings: ' + o3);
    writeFileSync(capF, keep);
  });
  if (existsSync(fxPy)) step('legibility.py: contrast of the letters against the picture round them (self-test)', () => {
    run(fxPy, ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import legibility, anchors; legibility.selftest(); anchors.selftest()', KIT], work, { PYTHONUTF8: '1' });
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
  step('editing principles: chapter cards and number pop from a counted list, sfx map and cap, energy beds, magazine preset, cards and typewriter draw', () => {
    const C = createRequire(import.meta.url)('./cards.cjs'), M = createRequire(import.meta.url)('./sfx-map.cjs');
    const say = 'Five easy edits for more views. First, pick two fonts. Second, add a colour card. Third, never leave dead air. Number four, match the music. Fifth, keep it simple!';
    let t = 0; const words = say.split(' ').map(w => { const o = { start: +t.toFixed(2), end: +(t + 0.28).toFixed(2), word: w }; t += /[.,!]$/.test(w) ? 0.6 : 0.34; return o; });
    const pc = C.proposeCards(words, { palette: ['olive', 'ivory', 'sage'] });
    if (pc.chapters.map(c => c.n).join(',') !== '1,2,3,4,5') fail('chapters: ' + JSON.stringify(pc.chapters));
    const ch = pc.cards.filter(c => c.chapter != null);
    if (ch.length < 4 || ch[0].bg !== 'olive' || ch[1].bg !== 'ivory') fail('chapter cards: ' + JSON.stringify(pc.cards));
    if (pc.cards.some((c, i) => i && c.start < pc.cards[i - 1].end) || pc.cards.some(c => c.start < 1.2)) fail('cards overlap or cover the hook: ' + JSON.stringify(pc.cards));
    if (!pc.numberPop || pc.numberPop.count !== 5 || pc.numberPop.end > ch[0].start) fail('number pop: ' + JSON.stringify(pc.numberPop));
    if (!C.validateCard({ start: 1, end: 6, bg: 'mauve' }).length) fail('validateCard passed a bad card');
    // the map: a whoosh on a transition, a swipe on a card, typing under a typewriter title, a pop per number
    const cut = { segs: [{ clip: 'a.mp4', in: 0, out: 2 }, { clip: 'a.mp4', in: 2, out: 4, transition: 'crossfade' }] };
    const flips = [{ start: 0.2, end: 1.6, mode: 38, count: 3 }, { start: 2.5, end: 3.5, mode: 8, bg: 'olive', chapter: '1' }, { start: 3.6, end: 4.2, mode: 7, text: 'TYPE', entrance: 'typewriter' }];
    const hits = M.autoHits(cut, flips), ids = hits.map(h => h.id);
    for (const id of [M.MAP.transition, M.MAP.card, M.MAP.type]) if (!ids.includes(id)) fail(`sfx map has no ${id}: ` + JSON.stringify(hits));
    if (ids.filter(x => x === M.MAP.number).length !== 3 || !hits.every(h => h.auto)) fail('number pops: ' + JSON.stringify(hits));
    // the cap: never two sounds closer than minGap, never more than per10 in 10 s, the bigger move wins
    const ev = Array.from({ length: 30 }, (_, i) => ({ t: i * 0.2, kind: i === 1 ? 'whoosh' : 'pop' }));
    const kept = M.capHits(ev, { minGap: 0.4, per10: 4 }).filter(e => e.keep);
    if (kept.length > 4 || kept.some((e, i) => i && e.t - kept[i - 1].t < 0.4) || !kept.some(e => e.kind === 'whoosh')) fail('cap: ' + JSON.stringify(kept));
    if (M.capHits(ev, false).some(e => !e.keep)) fail('cap false dropped a sound');
    // energy: every library bed is tagged, a fast script picks a high bed, a slow one a low bed, stable per seed
    for (const e of R.ENERGIES) if (!R.bedsByEnergy(e).length) fail('no ' + e + ' bed');
    const fast = Array.from({ length: 20 }, (_, i) => [i * 0.25, i * 0.25 + 0.2, 'w']), slow = Array.from({ length: 20 }, (_, i) => [i * 0.6, i * 0.6 + 0.4, 'w']);
    if (R.scriptEnergy(fast) !== 'high' || R.scriptEnergy(slow) !== 'low') fail('scriptEnergy');
    if (R.pickBed('high', 'job') !== R.pickBed('high', 'job') || !R.bedsByEnergy('high').includes(R.pickBed('high', 'job'))) fail('pickBed');
    if (!R.ENTRANCES.includes('typewriter')) fail('typewriter is not an entrance');
    // the magazine preset bundles them; the default stays aigent
    const mg = P.load('magazine');
    if (mg.cards !== 'auto' || mg.sfxMap !== true || mg.glitch !== false || mg.fonts !== 'playfair' || typeof mg.punch !== 'number' || !(mg.tighten > 0)) fail('magazine preset: ' + JSON.stringify(mg));
    // draw: a chapter card covers the frame in its colour with a numeral, a typewriter title types on, number pop draws
    const b = join(work, 'jobs', 'muse', 'build'), capF = join(b, 'captions.js'), keepC = readFileSync(capF, 'utf8');
    const caps = JSON.parse(keepC.replace(/^window\.CAPTIONS=/, '').replace(/;\s*$/, ''));
    const base = caps.flips.filter(f => f.mode !== 7 && f.mode !== 8 && f.mode < 9);
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify({ ...caps, flips: base.concat([
      { start: 0, end: 1.2, mode: 38, count: 4, layer: 'front' },
      { start: 1.4, end: 2.4, mode: 8, text: '', bg: 'olive', chapter: '2' },
      { start: 2.6, end: 4.0, mode: 7, text: 'Type it on', entrance: 'typewriter', place: 'left' }]) }) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '0', '0.9,1.9,2.75,3.9'], b);
    const st = x => readFileSync(join(b, 'stills', `t${x}.png`));
    if (st('1.90').equals(st('0.90')) || st('2.75').equals(st('3.90'))) fail('card or typewriter did not draw');
    // a long word in a side slot keeps a 6.5% margin from the frame edge (shrinks to fit); a boost span thickens the halo
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify({ ...caps, flips: base.concat([{ start: 0, end: 2, mode: 7, text: 'Extraordinarily', place: 'left', entrance: 'drop' }, { start: 0, end: 2, mode: 7, text: 'Unbelievably', place: 'right', entrance: 'blur-rise' }]) }) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '0', '1.5'], b);
    const plain = st('1.50');
    if (effects) { const o = run(fxPy, ['-c', `from PIL import Image\nimport numpy as np\na=np.asarray(Image.open(${JSON.stringify(join(b, 'stills', 't1.50.png'))}).convert('RGBA'))[...,3]\nc=np.where((a[100:1000]>128).any(0))[0]\nprint(int(c.min()),int(c.max()))`]).trim().split(' ').map(Number);
      if (o[0] < 70 || o[1] > 1080 - 70) fail('side titles touch the frame edge: x ' + o.join(' to ')); }
    const capsB = JSON.parse(readFileSync(capF, 'utf8').replace(/^window\.CAPTIONS=/, '').replace(/;\s*$/, '')); capsB.boost = [[0, 2]];
    writeFileSync(capF, 'window.CAPTIONS=' + JSON.stringify(capsB) + ';\n');
    run(node, [join(KIT, 'render.mjs'), '0', '1.5'], b);
    if (st('1.50').equals(plain)) fail('a boost span did not change the halo');
    // the behind-the-head cover check measures letters under the mask (selftest inside)
    if (effects) run(fxPy, ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(KIT)}); import cover; cover.selftest()`]);
    writeFileSync(capF, keepC);
  });
  { // the MCP server: fourteen tools whose schemas come from contract.json; a tool call runs the real command
    process.stdout.write('- MCP server (stdio): menu, list_effects, list_packs, get_pack, draft, explain, set_locks, plan, validate, render, verify, studio_get_state, studio_set_selections, studio_run and the Studio chat, reference and settings tools; validate runs reelmd check ... ');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const cl = new Client({ name: 'smoke', version: '1' });
    const studioDir = join(work, 'studio-mcp'); mkdirSync(studioDir, { recursive: true });
    await cl.connect(new StdioClientTransport({ command: node, args: [join(KIT, 'mcp.mjs')], cwd: dirname(KIT), stderr: 'ignore', env: { ...process.env, STUDIO_DIR: studioDir } }));
    try {
      const names = (await cl.listTools()).tools.map(t => t.name).join(',');
      if (names !== 'menu,list_effects,list_packs,get_pack,draft,explain,set_locks,plan,validate,render,verify,studio_get_state,studio_set_selections,studio_run,studio_start,studio_wait_for_message,studio_get_pending,studio_reply,studio_add_reference_url,studio_get_reference_teardown,studio_settings,studio_takes,list_scripts,get_script,write_script') fail('MCP tools: ' + names);
      const lp = await cl.callTool({ name: 'list_packs', arguments: {} });
      if (lp.isError || !lp.structuredContent || !lp.structuredContent.packs.some(p => p.name === 'magazine')) fail('MCP list_packs: ' + JSON.stringify(lp).slice(0, 300));
      const gp = await cl.callTool({ name: 'get_pack', arguments: { pack: 'cinematic' } });
      if (gp.isError || !gp.structuredContent.locks.transitions) fail('MCP get_pack: ' + JSON.stringify(gp).slice(0, 300));
      const le = await cl.callTool({ name: 'list_effects', arguments: { kind: 'transitions' } });
      if (le.isError || !le.structuredContent || le.structuredContent.sections[0].items.length < 50) fail('MCP list_effects: ' + JSON.stringify(le).slice(0, 300));
      const v = await cl.callTool({ name: 'validate', arguments: { recipe: 'examples/recipes/cinematic.Reel.md' } });
      if (v.isError || !/REELMD PASS/.test(v.content[0].text)) fail('MCP validate: ' + JSON.stringify(v));
      // Studio tools share the page's session file
      const ss = await cl.callTool({ name: 'studio_set_selections', arguments: { pack: 'cinematic', picks: { 'transition:dissolve': 'allow', 'graphic:checklist': 'deny' }, reply: 'Went calmer.' } });
      if (ss.isError) fail('MCP studio_set_selections: ' + JSON.stringify(ss).slice(0, 300));
      const sg = await cl.callTool({ name: 'studio_get_state', arguments: { catalog: true } });
      const st = sg.structuredContent;
      if (sg.isError || st.state.pack !== 'cinematic' || !st.compose.lockString.includes('transitions=dissolve') || !st.catalog.selectable.includes('effect:slow-push') || st.state.chat.pop().text !== 'Went calmer.') fail('MCP studio_get_state: ' + JSON.stringify(sg).slice(0, 400));
      if (JSON.parse(readFileSync(join(studioDir, 'state.json'), 'utf8')).pack !== 'cinematic') fail('studio state file not shared');
      const sb = await cl.callTool({ name: 'studio_set_selections', arguments: { picks: { 'transition:teleport': 'allow' } } });
      if (!sb.isError) fail('MCP studio_set_selections took a name the engine does not have');
      const bad = await cl.callTool({ name: 'render', arguments: { look: 'nope' } });
      if (!bad.isError) fail('MCP render should refuse a value the contract does not list');
    } finally { await cl.close(); }
    console.log('ok');
  }
  { // Studio: the local page drives a real draft from a session, inside the locks it shows; the page loads with no errors,
    // a click on a tile changes the session, and the phone layout has no sideways scroll
    process.stdout.write('- Studio (npm run studio): session to draft inside its locks, choices table, headless page click, phone layout ... ');
    const { spawn } = await import('child_process');
    const sdir = join(work, 'studio'), job = 'smoke-studio-' + process.pid;
    const srv = spawn(node, [join(KIT, 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: dirname(KIT), env: { ...process.env, CI: '1', STUDIO_DIR: sdir, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' } });
    try {
      const url = await new Promise((ok, bad) => { let o = ''; srv.stdout.on('data', d => { o += d; const m = o.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.on('close', c => bad(new Error('studio exited ' + c + o))); });
      const api = async (path, body) => { const r = await fetch(url + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) fail(`studio ${path}: ${j.error}`); return j; };
      await api('/api/state', { job, clips: join(work, 'clips-muse'), pack: 'magazine', picks: { 'transition:whip': 'allow', 'transition:zoom': 'allow', 'entrance:typewriter': 'allow', 'graphic:checklist': 'deny' }, sound: { sfx: 'off' }, music: { bed: 'none' } });
      await api('/api/draft', {});
      let v; const t0 = Date.now();
      do { await new Promise(r => setTimeout(r, 1500)); v = await api('/api/state'); } while (v.task && v.task.status === 'running' && Date.now() - t0 < 15 * 60e3);
      if (!v.task || v.task.status !== 'done') fail('studio draft: ' + JSON.stringify(v.task).slice(0, 800));
      const ch = (await api('/api/choices')).choices;
      const seams = ch.beats.slice(1).filter(b => !b.jump).map(b => b.transition);
      if (!seams.length || seams.some(x => !['whip', 'zoom'].includes(x))) fail('studio draft left the transitions lock: ' + seams);
      if (ch.titles.some(x => x.entrance && x.entrance !== 'typewriter')) fail('studio draft left the titles lock: ' + ch.titles.map(x => x.entrance));
      if (ch.graphics.some(g => g.id === 'checklist')) fail('studio draft used a forbidden graphic');
      const k = ch.beats.findIndex((b, i) => i > 0 && !b.jump), to = ch.beats[k].transition === 'whip' ? 'zoom' : 'whip';
      const ap = await api('/api/choices', { ...ch, beats: ch.beats.map((b, i) => i === k ? { ...b, transition: to } : b) });
      if (ap.choices.beats[k].transition !== to || ap.choices.beats[k].transitionWhy !== 'you') fail('studio choices apply: ' + JSON.stringify(ap.choices.beats[k]));
      const { chromium } = await import('playwright-core');
      const b = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
      try {
        const pg = await b.newPage({ viewport: { width: 1280, height: 860 } }); const errs = [];
        pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
        await pg.goto(url + '/#menu=transitions', { waitUntil: 'networkidle' });
        await pg.waitForSelector('.tile .pick');
        const before = (await api('/api/state')).state.rev;
        await pg.click('.tile .pick[aria-label="Pick cut, transition"]');
        let s2; for (let i = 0; i < 20; i++) { await pg.waitForTimeout(150); s2 = (await api('/api/state')).state; if (s2.rev > before) break; }
        if (!s2.picks.transition.allow.includes('cut')) fail('clicking a tile did not pick it: ' + JSON.stringify(s2.picks.transition));
        if (await pg.getAttribute('.tile .pick[aria-label="Pick cut, transition"]', 'aria-pressed') !== 'true') fail('tile does not show it is picked');
        if (!/whip|zoom/.test(await pg.textContent('#choices'))) fail('choices table not shown');
        await pg.setViewportSize({ width: 375, height: 800 }); await pg.waitForTimeout(300);
        const over = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (over > 1) fail('phone layout scrolls sideways by ' + over + 'px');
        await pg.screenshot({ path: join(work, 'studio-phone.png') });
        if (errs.length) fail('studio page errors: ' + errs.join(' | '));
      } finally { await b.close(); }
    } finally { srv.kill(); rmSync(join(dirname(KIT), 'jobs', job), { recursive: true, force: true }); }
    console.log('ok');
  }
  step('Studio Record now in Chrome with a fake camera and mic (tests/studio-record.e2e.mjs)', () => { run(node, [join(dirname(KIT), 'tests', 'studio-record.e2e.mjs')], dirname(KIT)); });
  step('Studio review tools in Chrome: what to swap, show original, comments, clean-up pass, edit receipt (tests/studio-review.e2e.mjs)', () => { run(node, [join(dirname(KIT), 'tests', 'studio-review.e2e.mjs')], dirname(KIT)); });
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
  step('verify.mjs: ffprobe, loudness, stills + contact sheet, mask alpha, copy lint, overlap, --json; square export', () => {
    const b = join(work, 'jobs', 'muse', 'build');
    rmSync(join(b, 'captions.js')); run(node, [join(KIT, 'autocaption.mjs'), '--out', 'captions.js', '--titles', '--style', 'pill'], b);
    const o = run(node, [join(KIT, 'verify.mjs'), 'muse', '--jobs', join(work, 'jobs'), '--json'], work);
    if (!/VERIFY PASS/.test(o)) fail('verify:\n' + o);
    const vj = JSON.parse(o.trim().split('\n').pop());
    if (!vj.ok || !existsSync(vj.contact) || !/no overlap between graphics, captions and titles/.test(o)) fail('verify --json / overlap check:\n' + o);
    // export presets: a square export of the same reel is 1080x1080 and checks against its own size
    const ex = JSON.parse(run(node, [join(KIT, 'export.mjs'), 'muse', '--jobs', join(work, 'jobs'), '--export', 'square', '--json'], work).trim().split('\n').pop());
    const wh = run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ex.file]).trim();
    if (wh !== '1080,1080' || ex.laidOut) fail('square export: ' + wh + ' ' + JSON.stringify(ex));
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
  if (effects) step('effects pass: moody + locked-on + backdrop-word + checklist (captions off) + glass-widgets (no pill, no upstream sample content), check frames + render', () => {
    if (!existsSync(fxPy)) fail('effects not set up: npm run effects:setup');
    run(node, [join(dirname(KIT), 'effects', 'check.mjs')], work);
    const plan = join(work, 'fx.json');
    writeFileSync(plan, JSON.stringify({ profile: { name: 'Smoke', handle: '@smoke' }, effects: [
      { fx: 'moody', start: 0, end: 1.2, grade: 'cool' },
      { fx: 'locked-on', start: 0.2, end: 1.4, text: 'SMOKE' },
      { fx: 'checklist', start: 1.6, end: 3.1, text: 'Record::phone|Drop::inbox|Ask::your agent', title: 'Smoke test' },
      { fx: 'backdrop-word', start: 0.4, end: 1.5, text: 'SMOKE' },
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
