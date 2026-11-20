// kit/manual-cuts.cjs (session report 2, D): cut a stretch out of a clip by hand (a noise between two sentences no word
// sits on), kept in source seconds so a redraft that re-cuts the clips still cuts it; and the noise finder.
// Run: node tests/manual-cuts.test.cjs   (npm run check runs it too; the noise finder part needs ffmpeg)
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const M = require('../kit/manual-cuts.cjs');
const { speech, SR } = require('./fixtures/speech.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcut-')), clips = path.join(dir, 'clips'); fs.mkdirSync(clips);
function wav(f, x) { const b = Buffer.alloc(44 + x.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40); for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2); fs.writeFileSync(f, b); }
try {
  // "help you." [noise 1.48-1.73] "So join", as clip-002 of a take starting 816.5 s in
  wav(path.join(clips, 'clip-002.wav'), speech(4, { voiced: [[0.5, 1.1], [2.5, 2.9], [2.95, 3.4]], breath: [[1.48, 1.73]] }));
  const words = [[0.5, 1.1, 'you.'], [2.5, 2.9, 'So'], [2.95, 3.4, 'join']];
  fs.writeFileSync(path.join(clips, 'clips.json'), JSON.stringify({ clips: [{ id: 'clip-002', file: path.join(clips, 'clip-002.wav'), take: 'from-the-heart.mp4', src_in: 816.5, src_out: 820.5, dur: 4, status: 'keep', words }] }));
  const r = M.add(dir, { clip: 'clip-002', from: 1.4, to: 1.8 });
  assert.deepStrictEqual([r.from, r.to, r.take], [817.9, 818.3, 'from-the-heart.mp4'], 'stored on the take clock');
  // a redraft re-cuts the take: the same line is now clip-005 starting at 817.0 s
  assert.deepStrictEqual(M.forClip(M.read(dir), { id: 'clip-005', take: 'from-the-heart.mp4', src_in: 817, src_out: 821, dur: 4 }), [[0.9, 1.3]]);
  assert.deepStrictEqual(M.forClip(M.read(dir), { id: 'x', take: 'other.mp4', src_in: 817, dur: 4 }), [], 'only its own take');
  assert.throws(() => M.add(dir, { clip: 'clip-009', from: 1, to: 2 }), /no clip/);
  assert.throws(() => M.add(dir, { clip: 'clip-002', from: 2, to: 1 }), /to after from/);
  if (spawnSync('ffmpeg', ['-version']).status === 0) {
    const n = M.noises(dir);
    assert.strictEqual(n.length, 1, JSON.stringify(n)); assert.ok(Math.abs(n[0].from - 1.48) < 0.04 && Math.abs(n[0].to - 1.73) < 0.04 && n[0].before === 'So', JSON.stringify(n));
    assert.ok(/npm run cut -- add .* clip-002 /.test(n[0].cut));
  } else console.log('(noise finder skipped: no ffmpeg)');
  console.log('ok cuts by hand: kept on the take clock, follow a redraft; the noise finder flags the 0.25 s noise');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
