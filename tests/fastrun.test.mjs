// Fast run and the whole fit (Studio report 4, item 11: "in reference he has this sick b roll effect scene. we could
// use our websites we have 30"). The report's agent built it by hand: nine sites, one per half beat, each whole site
// sharp over a blurred copy of itself with a short push in, placed as one insert.
// - a run's cuts land on the bed's beats or half beats; with no bed it keeps a steady pace
// - the made clip shows each picture whole (its own edges are in the frame, first frame and last) over its blur
// - cut.json "run" inserts are made by the build, start on a beat and play as one insert; a new build reuses the clip
// - a wide clip in the split panel is shown whole instead of cropped to its middle; "fit": "fill" keeps the crop
// - a run of fast cuts in a reference is one B-roll slot with "run" and "step", through the recipe and the plan
// - Studio: a run is one library clip made from others, its members go to the render, credits name them
// Run: node tests/fastrun.test.mjs   (needs ffmpeg; part of npm run check)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('skip the fast run tests (needs ffmpeg)'); process.exit(0); }

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const FR = require('../kit/fastrun.cjs'), BS = require('../kit/broll-slots.cjs'), RM = require('../kit/reelmd.cjs');
const TMP = mkdtempSync(join(tmpdir(), 'fastrun-test-'));
process.env.STUDIO_DIR = join(TMP, 'studio'); process.env.STUDIO_BROLL_LIBRARY = join(TMP, 'lib'); mkdirSync(process.env.STUDIO_DIR, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const ff = a => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'pipe'] });
// one pixel of one frame of a video, as [r, g, b]
const px = (file, frame, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select='eq(n\\,${frame})',format=rgb24,crop=2:2:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])].slice(0, 3);
const near = (p, c, tol = 60) => p.length === 3 && p.every((v, i) => Math.abs(v - c[i]) <= tol);
const RED = [255, 0, 0];
// a "site": a wide picture, one flat colour inside a red edge 24 px thick, so we can see whether its edges made it in
const COLS = { a: [20, 60, 200], b: [20, 160, 60], c: [220, 200, 20], d: [200, 40, 200], e: [30, 190, 200] };
const hex = c => c.map(v => v.toString(16).padStart(2, '0')).join('');
const site = (k, w = 1280, h = 720) => { const f = join(TMP, `site-${k}.png`); if (!existsSync(f)) ff(['-f', 'lavfi', '-i', `color=c=0x${hex(COLS[k])}:s=${w}x${h}`, '-vf', `drawbox=x=0:y=0:w=${w}:h=${h}:color=red:t=24`, '-frames:v', '1', f]); return f; };

try {
  await t('a run cuts on the beats or half beats of the bed, from the beat nearest where you asked', () => {
    const grid = { tempo_bpm: 143, beats: Array.from({ length: 40 }, (_, i) => +(0.3 + i * 0.42).toFixed(3)) };
    const half = FR.schedule({ n: 5, at: 12.33, step: 'half', grid });
    assert.strictEqual(half.onBeat, true); assert.strictEqual(half.at, 12.27, 'starts on the half beat nearest 12.33: ' + half.at);
    assert.strictEqual(half.durs.length, 5); assert.ok(half.durs.every(d => Math.abs(d - 0.21) < 0.012), 'one every half beat (0.21 s at 143 BPM): ' + half.durs);
    assert.deepStrictEqual(half.cuts[0], 0); assert.ok(Math.abs(half.dur - 1.05) < 0.03);
    const beat = FR.schedule({ n: 4, at: 12.33, step: 'beat', grid });
    assert.strictEqual(beat.at, 12.48); assert.ok(beat.durs.every(d => Math.abs(d - 0.42) < 0.012));
    // every step is a whole number of frames, so no cut lands between two frames
    for (const d of [...half.durs, ...beat.durs]) assert.ok(Math.abs(d * 24 - Math.round(d * 24)) < 0.01, 'whole frames: ' + d);
    // a half beat that is not a whole number of frames (99.4 BPM: 7.25 frames) does not drift: every cut stays
    // within half a frame of its beat, over 30 cuts
    const g99 = { beats: Array.from({ length: 40 }, (_, i) => +(0.2 + i * 60 / 99.38).toFixed(4)) }, long = FR.schedule({ n: 30, at: 0.2, step: 'half', grid: g99 });
    long.cuts.forEach((c, i) => assert.ok(Math.abs(c - i * 30 / 99.38) <= 0.5 / 24 + 0.002, `cut ${i} is on its half beat: ${c} vs ${(i * 30 / 99.38).toFixed(3)}`));
    assert.ok(new Set(long.durs.map(d => Math.round(d * 24))).size === 2, 'steps of 7 and 8 frames: ' + [...new Set(long.durs.map(d => Math.round(d * 24)))]);
    // past the last beat it carries on at the same pace
    const late = FR.schedule({ n: 6, at: 16.5, step: 'beat', grid }); assert.strictEqual(late.durs.length, 6);
    // no bed: a steady pace; a number is seconds; never faster than 3 frames
    assert.deepStrictEqual(FR.schedule({ n: 3, at: 2, step: 'half' }).durs, [0.25, 0.25, 0.25]); assert.strictEqual(FR.schedule({ n: 3, at: 2 }).onBeat, false);
    assert.deepStrictEqual(FR.schedule({ n: 2, at: 2, step: 'beat' }).durs, [0.5, 0.5]);
    assert.ok(FR.schedule({ n: 2, at: 0, step: 0.21 }).durs.every(d => Math.abs(d - 0.208) < 0.002)); assert.ok(FR.schedule({ n: 2, at: 0, step: 0.01 }).durs.every(d => d >= 0.125));
    // a length to fit: the clips that do not fit are left off, and one always plays
    assert.strictEqual(FR.schedule({ n: 9, at: 0, step: 0.25, max: 1.05 }).durs.length, 4); assert.strictEqual(FR.schedule({ n: 9, at: 0, step: 0.5, max: 0.2 }).durs.length, 1);
  });

  let run;
  await t('the made clip shows each picture whole, sharp over its own blur, cut when it should', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map(k => site(k)), sc = FR.schedule({ n: 5, at: 0, step: 5 / 24 });
    run = FR.make({ items, durs: sc.durs, out: join(TMP, 'run.mp4'), size: [1080, 960] });
    assert.deepStrictEqual(run.size, [1080, 960]); assert.ok(Math.abs(run.seconds - 25 / 24) < 0.01, 'five cuts of 5 frames: ' + run.seconds);
    const frames = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', run.file]).toString().trim();
    assert.strictEqual(frames, 25, 'exactly 5 frames each');
    ['a', 'b', 'c', 'd', 'e'].forEach((k, i) => {
      for (const fr of [i * 5, i * 5 + 4]) assert.ok(near(px(run.file, fr, 540, 480), COLS[k]), `frame ${fr} is picture ${k}: ` + px(run.file, fr, 540, 480));
    });
    // whole: the picture's own red edge is inside the frame on every side, on the first frame and after the push in
    const edges = fr => { const w = fr % 5 === 0 ? 1080 / 1.06 : 1080, h = w * 720 / 1280, x0 = (1080 - w) / 2, y0 = (960 - h) / 2, m = 8;
      return [[x0 + m, 480], [1080 - x0 - m - 2, 480], [540, y0 + m], [540, 960 - y0 - m - 2]].map(([x, y]) => px(run.file, fr, Math.round(x), Math.round(y))); };
    for (const fr of [0, 4, 10, 14]) assert.ok(edges(fr).every(p => near(p, RED, 80)), `frame ${fr}: all four edges of the picture are in the frame: ` + JSON.stringify(edges(fr)));
    // above and below it, its own blurred copy (never black bars, never the sharp red edge)
    const bar = px(run.file, 2, 540, 60); assert.ok(bar.some(v => v > 25) && !near(bar, RED, 40), 'the bar is the blurred picture: ' + bar);
    // a tall picture in an upright frame, and a short clip that holds its last frame, also work
    const tall = join(TMP, 'tall.png'); ff(['-f', 'lavfi', '-i', 'color=c=0x208040:s=600x1400', '-frames:v', '1', tall]);
    const clip = join(TMP, 'clip.mp4'); ff(['-f', 'lavfi', '-i', 'color=c=0x2060c0:s=1280x720:r=24:d=0.2', '-pix_fmt', 'yuv420p', clip]);
    const mixed = FR.make({ items: [tall, clip, site('a')], durs: [0.25, 0.5, 0.25], out: join(TMP, 'mixed.mp4'), size: [1080, 1920] });
    assert.ok(Math.abs(mixed.seconds - 1) < 0.01); assert.ok(near(px(mixed.file, 14, 540, 960), [32, 96, 192], 50), 'the short clip holds: ' + px(mixed.file, 14, 540, 960));
    assert.throws(() => FR.make({ items: [join(TMP, 'nope.png')], durs: [0.25], out: join(TMP, 'x.mp4') }), /no such file/);
  });

  await t('whole or fill: a wide clip in the split panel is whole, a near fit fills, and what you ask for wins', () => {
    assert.strictEqual(FR.cropLoss(1920, 1080, 1080, 960), 0.367, 'a 16:9 clip made to fill the split panel loses 37 percent');
    assert.strictEqual(FR.fitFor({ place: 'top' }, { w: 1920, h: 1080 }, 1080, 960), 'whole');
    assert.strictEqual(FR.fitFor({ place: 'top' }, { w: 1440, h: 1080 }, 1080, 960), 'fill', 'a 4:3 clip loses 16 percent: it fills');
    assert.strictEqual(FR.fitFor({ place: 'top' }, { w: 1080, h: 1920 }, 1080, 960), 'whole', 'an upright clip in the wide panel too');
    assert.strictEqual(FR.fitFor({ place: 'top', fit: 'fill' }, { w: 1920, h: 1080 }, 1080, 960), 'fill');
    assert.strictEqual(FR.fitFor({ place: 'full' }, { w: 1920, h: 1080 }, 1080, 1920), 'fill', 'a full cutaway still fills the frame');
    assert.strictEqual(FR.fitFor({ place: 'full', fit: 'whole' }, { w: 1920, h: 1080 }, 1080, 1920), 'whole');
    assert.strictEqual(FR.fitFor({ place: 'full', run: ['a', 'b'] }, null, 1080, 1920), 'whole', 'a fast run is always whole');
    assert.strictEqual(FR.fitFor({ place: 'top' }, null, 1080, 960), 'fill', 'a clip we cannot measure is left as it was');
  });

  await t('the build makes a cut.json run on the beats and plays it as one insert; a second build reuses the clip', () => {
    const build = join(TMP, 'job', 'build'); mkdirSync(build, { recursive: true });
    const grid = { tempo_bpm: 143, beats: Array.from({ length: 20 }, (_, i) => +(0.1 + i * 0.42).toFixed(3)) };
    const cut = { segs: [{ file: 'base.mp4', in: 0, out: 6 }], inserts: [{ file: 'other.mp4', at: 0.5, dur: 1 }, { run: ['a', 'b', 'c', 'd', 'e'].map(k => site(k)), at: 2.3, step: 'half', place: 'top' }] };
    const lines = FR.resolve(cut, build, grid), ins = cut.inserts[1];
    assert.match(lines[0], /^fast run: 5 cuts from 2\.2 s, one every 0\.21 s on the bed's half beats, 1\.04\d* s as one insert \(top\)$/);
    assert.ok(/^runs\/run-[0-9a-f]{12}\.mp4$/.test(ins.file) && existsSync(join(build, ins.file)));
    assert.deepStrictEqual([ins.at, ins.in, ins.fit, ins.runAt, ins.cuts.length], [2.2, 0, 'whole', 2.3, 5]); assert.ok(Math.abs(ins.dur - 1.04) < 0.02);
    assert.strictEqual(cut.inserts[0].file, 'other.mp4', 'other inserts are untouched'); assert.strictEqual(cut.inserts.length, 2, 'the run is one insert');
    const made = statSync(join(build, ins.file)).mtimeMs; FR.resolve(cut, build, grid);
    assert.strictEqual(statSync(join(build, ins.file)).mtimeMs, made, 'the same run is not made twice'); assert.strictEqual(ins.at, 2.2, 'and it does not walk away from where you asked');
    // a new bed: the run moves to its beat and is cut again
    const g2 = { beats: Array.from({ length: 20 }, (_, i) => +(i * 0.5).toFixed(3)) }, f1 = ins.file; FR.resolve(cut, build, g2);
    assert.strictEqual(ins.at, 2.25); assert.notStrictEqual(ins.file, f1); assert.ok(ins.cuts.every((c, i) => Math.abs(c - i * 0.25) < 0.01));
    // no bed: a steady half beat
    FR.resolve(cut, build, null); assert.strictEqual(ins.at, 2.3); assert.match(FR.resolve(cut, build, null)[0], /no bed to follow/);
    // a missing file never stops a build: the run is left out of it and stays in cut.json
    const bad = { inserts: [{ run: [site('a'), join(TMP, 'gone.png')], at: 1, place: 'full' }] }; const l2 = FR.resolve(bad, build, null);
    assert.match(l2[0], /1 of its 2 files are missing \(gone\.png\), left out of this build/); assert.strictEqual(bad.inserts[0].skip, true); assert.strictEqual(bad.inserts[0].run.length, 2);
  });

  await t('assemble: a wide clip in the split panel is whole (both its edges show), fill crops it, and a run plays as one insert', () => {
    const b = join(TMP, 'asm', 'build'); mkdirSync(b, { recursive: true });
    ff(['-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920:r=24:d=5', '-f', 'lavfi', '-i', 'sine=f=300:d=5', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(b, 'base.mp4')]);
    ff(['-loop', '1', '-r', '24', '-t', '2', '-i', site('b'), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(b, 'wide.mp4')]);
    const cut = { segs: [{ file: 'base.mp4', in: 0, out: 5 }], tail: 0, inserts: [{ file: 'wide.mp4', at: 0.5, dur: 1, place: 'top' }, { file: 'wide.mp4', at: 2, dur: 1, place: 'top', fit: 'fill' }, { run: ['a', 'c', 'd'].map(k => site(k)), at: 3.5, step: 0.25, place: 'top' }, { run: [join(TMP, 'gone.png')], at: 4.6, place: 'full' }] };
    FR.resolve(cut, b, null); writeFileSync(join(b, 'cut.json'), JSON.stringify(cut));
    execFileSync(process.execPath, [join(ROOT, 'kit', 'assemble.cjs'), 'out.mp4'], { cwd: b, env: { ...process.env, NOBED: '1', NOSFX: '1' }, stdio: 'pipe' });
    const at = (tm, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(tm), '-i', join(b, 'out.mp4'), '-frames:v', '1', '-vf', `format=rgb24,crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])].slice(0, 3);
    const blue = p => p[2] > 120 && p[0] < 60 && p[1] < 60;
    // whole: the clip's red edge is at the left and right of the frame, its colour in the middle, you below
    assert.ok(near(at(1, 8, 400), RED, 80) && near(at(1, 1068, 400), RED, 80), 'whole: both side edges of the clip are in the panel: ' + at(1, 8, 400) + ' / ' + at(1, 1068, 400));
    assert.ok(near(at(1, 540, 400), COLS.b) && blue(at(1, 540, 1700)), 'the clip on top, the speaker below');
    // fill (the old way): the sides are cropped away, so the clip's own colour reaches the frame edge
    assert.ok(near(at(2.5, 8, 400), COLS.b) && near(at(2.5, 1068, 400), COLS.b), 'fill: the side edges are cropped off: ' + at(2.5, 8, 400));
    // the run: three pictures in turn inside one insert, then the speaker again
    assert.ok(near(at(3.6, 540, 400), COLS.a) && near(at(3.85, 540, 400), COLS.c) && near(at(4.1, 540, 400), COLS.d), 'the run plays its cuts in order: ' + [at(3.6, 540, 400), at(3.85, 540, 400), at(4.1, 540, 400)].join(' | '));
    assert.ok(blue(at(4.4, 540, 400)) && blue(at(4.8, 540, 400)), 'after the run, and where a run had no files, the speaker is on screen');
  });

  await t('a run of fast cuts in the reference is one B-roll slot, through the recipe and onto your edit', () => {
    const cands = [{ start: 10, end: 13, kind: 'full', shows: 'a dashboard' }, ...[0, 1, 2, 3, 4].map(i => ({ start: +(77 + i * 0.21).toFixed(2), end: +(77 + (i + 1) * 0.21).toFixed(2), kind: 'full' })), { start: 80, end: 80.2, kind: 'full' }, { start: 82, end: 82.3, kind: 'full' }, { start: 82.3, end: 82.6, kind: 'full' }];
    const slots = BS.detect(cands, []);
    assert.deepStrictEqual(slots.map(s => [s.start, s.end, s.run || null, s.step || null]), [[10, 13, null, null], [77, 78.05, 5, 0.21]], 'five cuts 0.21 s apart are one slot; one or two quick cutaways are not a run');
    // what kit/broll_fx.py measure gives for those slots: each edge stretched over its neighbours (it looks 0.7 s around a slot)
    const measured = cands.map(c => ({ at: [+(c.start - 0.2).toFixed(2), +(c.end + 0.25).toFixed(2)], in: 'cut', out: 'cut' }));
    assert.deepStrictEqual(BS.detect(cands, measured).map(s => s.run || null), [null, 5], 'the run is still found with the measured edges');
    const line = BS.blockLines(slots)[1]; assert.match(line, /\| run 5 \| step 0\.21$/);
    const md = BS.appendBlock('---\nname: r\n---\n\n# r\n', slots), back = BS.fromRecipe(RM.parse(md, 'Reel.md'));
    assert.deepStrictEqual([back[1].run, back[1].step, back[1].kind], [5, 0.21, 'full']);
    // on a shorter edit the run keeps its own pace (the music is not scaled) and still lands on words
    const words = Array.from({ length: 62 }, (_, i) => ({ start: +(i * 0.38).toFixed(2), end: +(i * 0.38 + 0.3).toFixed(2), word: 'w' + i }));
    const plan = BS.forRecreate(back, { k: 23.5 / 86.6, len: 23.5, words, refLen: 86.6 }), r = plan.find(s => s.run);
    assert.ok(r, 'the run is in the plan'); assert.ok(Math.abs((r.end - r.start) - 1.05) < 0.06, 'as long as its five cuts: ' + (r.end - r.start)); assert.strictEqual(r.state, 'needs');
    const br = BS.brief(r); assert.match(br.what, /^a fast run of 5 clips or pictures/); assert.match(br.treat, /one every 0\.21 s, on the beat/);
    const ask = BS.agentAsk(r, { job: 'j', spot: 3 }); assert.match(ask, /a fast run\./); assert.match(ask, /run set to their ids on beat 3/); assert.ok(!/\u2014|npm |\$ /.test(ask));
    // an older teardown has only "cutaway on" shots: the same run is found from them
    const old = RM.parse(['---', 'name: old', '---', '', '# old', '', '## Shots', '', '```videomd-timeline', '#01 0-10 | story hook', ...[0, 1, 2, 3].map(i => `#0${i + 2} ${(10 + i * 0.2).toFixed(1)}-${(10.2 + i * 0.2).toFixed(1)} | story beat | cutaway on`), '#06 10.8-20 | story payoff', '```', ''].join('\n'), 'Reel.md');
    assert.deepStrictEqual(BS.fromRecipe(old).map(s => [s.run, s.step]), [[4, 0.2]]);
    assert.strictEqual(BS.lookSummary(back, 86.6).slots[1].run, 5, 'a saved look keeps it');
  });

  await t('Studio: a run is one library clip made from others; the render gets its clips and the credits name them', async () => {
    const BR = await import('../kit/studio/broll.mjs'), LANE = await import('../kit/studio/lane.mjs');
    assert.ok(BR.SOURCES.includes('run'));
    const a = BR.add(site('a'), { title: 'Site A', source: 'capture', sourceUrl: 'https://a.example/' }), c = BR.add(site('c'), { title: 'Site C', source: 'upload' });
    const made = FR.make({ items: [BR.pathOf(a), BR.pathOf(c)], durs: [0.25, 0.25], out: join(TMP, 'lib-run.mp4'), size: FR.SIZE_FOR.top });
    const runClip = BR.add(made.file, { move: true, name: 'fast-run-2.mp4', title: 'Fast run: 2 clips', source: 'run', run: { clips: [a.id, c.id], step: 0.25, beat: 'half', bpm: null, seconds: made.seconds } });
    assert.strictEqual(BR.get(runClip.id).source, 'run'); assert.deepStrictEqual(BR.get(runClip.id).run.clips, [a.id, c.id]); assert.match(BR.get(runClip.id).license.name, /fast run/);
    const beats = [{ n: 1, start: 0, end: 6, seconds: 6 }], byId = id => BR.get(id);
    const ins = LANE.inserts({ 1: { clip: runClip.id, place: 'top', offset: 2, dur: 0.5 } }, beats, byId, BR.pathOf)[0];
    assert.deepStrictEqual(ins.run, [BR.pathOf(a), BR.pathOf(c)], 'the render cuts the clips again on the real beats'); assert.strictEqual(ins.step, 'half'); assert.strictEqual(ins.fit, 'whole'); assert.strictEqual(ins.file, BR.pathOf(runClip));
    // one of its clips is deleted: the made clip plays as it is
    BR.remove(c.id); const ins2 = LANE.inserts({ 1: { clip: runClip.id, place: 'top', offset: 2, dur: 0.5 } }, beats, byId, BR.pathOf)[0];
    assert.strictEqual(ins2.run, undefined); assert.strictEqual(ins2.file, BR.pathOf(runClip)); assert.strictEqual(ins2.fit, 'whole');
    const cr = BR.credits([BR.get(runClip.id), BR.get(a.id)], 'job'); assert.match(cr, /Fast run: 2 clips \(run\)/); assert.match(cr, /https:\/\/a\.example\//);
  });

  console.log(`\nfastrun: ${n} tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
