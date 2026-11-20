// kit/snapshots.cjs (session report 2, A): a new Draft overwrote build/cut.json and captions.js behind a finished reel,
// so reel-v3 could not be rebuilt. Every render now saves reel-vN.build/ with its clips stashed in .media/, and reopen
// puts it back. Run: node tests/snapshots.test.cjs   (npm run check runs it too)
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const S = require('../kit/snapshots.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-')), build = path.join(dir, 'build'), clips = path.join(dir, 'clips');
const w = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, x); }, r = f => fs.readFileSync(f, 'utf8');
try {
  // the job behind reel-v3: two clips, captions, choices, a mask that is not worth keeping
  w(path.join(clips, 'clip-001.mp4'), 'CLIP ONE v3'); w(path.join(clips, 'clip-002.mp4'), 'CLIP TWO v3'); w(path.join(clips, 'clips.json'), '{"clips":[1,2]}');
  w(path.join(build, 'cut.json'), JSON.stringify({ segs: [{ file: '../clips/clip-001.mp4', in: 0, out: 2 }, { file: '../clips/clip-002.mp4', in: 0.5, out: 3 }], overlay: 'ovl/%04d.png' }));
  w(path.join(build, 'captions.js'), 'window.CAPTIONS={"flips":["v3 words"]};'); w(path.join(build, 'mask.mkv'), 'BIG'); w(path.join(build, 'base.mp4'), 'BIG');
  w(path.join(build, 'ovl', '0001.png'), 'frame'); w(path.join(dir, 'choices.json'), '{"v":3}'); w(path.join(dir, 'reel-v3.mp4'), 'REEL');
  const snap = S.save(dir, path.join(dir, 'reel-v3.mp4'));
  assert.strictEqual(path.basename(snap), 'reel-v3.build');
  for (const f of ['cut.json', 'captions.js', 'choices.json', 'clips.json', 'meta.json']) assert.ok(fs.existsSync(path.join(snap, f)), f + ' saved');
  for (const f of ['mask.mkv', 'base.mp4', 'ovl']) assert.ok(!fs.existsSync(path.join(snap, f)), f + ' not saved (a rebuild makes it again)');
  const sc = JSON.parse(r(path.join(snap, 'cut.json')));
  assert.ok(sc.segs.every(s => s.file.startsWith('../.media/')), 'the snapshot plays stashed clips: ' + JSON.stringify(sc.segs));
  // a new Draft of the whole take: new clips, new cut, new captions
  w(path.join(clips, 'clip-001.mp4'), 'CLIP ONE redraft'); w(path.join(build, 'captions.js'), 'window.CAPTIONS={"flips":["139 beats"]};');
  w(path.join(build, 'cut.json'), JSON.stringify({ segs: [{ file: '../clips/clip-001.mp4', in: 0, out: 600 }] })); w(path.join(dir, 'choices.json'), '{"v":"draft"}');
  assert.deepStrictEqual(S.list(dir).map(x => [x.reel, !!x.snapshot]), [['reel-v3.mp4', true]]);
  const o = S.reopen(dir, 'v3');
  assert.ok(/v3 words/.test(r(path.join(build, 'captions.js'))), 'captions back');
  const bc = JSON.parse(r(path.join(build, 'cut.json')));
  assert.deepStrictEqual(bc.segs.map(s => r(path.resolve(build, s.file))), ['CLIP ONE v3', 'CLIP TWO v3'], 'the clips the reel played, not the redraft');
  assert.strictEqual(r(path.join(dir, 'choices.json')), '{"v":3}');
  assert.ok(o.backup && /139 beats/.test(r(path.join(dir, o.backup, 'captions.js'))), 'the replaced draft is kept: ' + o.backup);
  // a reel rendered from the reopened build stashes nothing new
  const n = fs.readdirSync(path.join(dir, '.media')).length; w(path.join(dir, 'reel-v4.mp4'), 'REEL4'); S.save(dir, path.join(dir, 'reel-v4.mp4'));
  assert.strictEqual(fs.readdirSync(path.join(dir, '.media')).length, n, 'no second copy of the same clip');
  assert.throws(() => S.reopen(dir, 'v9'), /no saved build/);
  console.log('ok snapshots: saved beside the reel, survive a redraft, reopen with the same clips, old draft kept');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
