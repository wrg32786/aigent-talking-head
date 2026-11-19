#!/usr/bin/env node
// Caption rules (Will, 2026-11-18): bold with thin font pairs, one word on screen once, an outline switch for the
// kinetic caption, and the true last frame on the clip contact sheet. Run: node --test tests/caption-rules.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../kit/rules.cjs');
const P = require('../kit/preset.cjs');

const fx = (text, start, end, more = {}) => ({ fx: 'backdrop-word', text, start, end, ...more });
const kinetic = { flips: [
  { start: 1.0, end: 3.0, words: [[1.0, 1.3, 'Record'], [1.3, 1.6, 'it']] },
  { start: 3.0, end: 4.0, words: [[3.0, 3.5, 'surfing.']] },
] };

// What it catches
test('flags a caption word the effect also shows', () => {
  assert.strictEqual(R.dupWords([fx('SURFING', 3.2, 4.5)], kinetic).length, 1);
});
test('kinetic: a word stays on screen to the end of its flip', () => {
  assert.strictEqual(R.dupWords([fx('record', 2.0, 2.8)], kinetic).length, 1);
});
test('reports the time the two first overlap', () => {
  assert.match(R.dupWords([fx('record', 2.0, 2.8)], kinetic)[0], /at 2\.00 s/);
});
test('reads sub, title, reply and the :: and | parts', () => {
  assert.strictEqual(R.dupWords([fx('Record::phone', 1.1, 1.2)], kinetic).length, 1);
  assert.strictEqual(R.dupWords([fx('Phone', 3.1, 3.4, { sub: 'surfing' })], kinetic).length, 1);
  assert.strictEqual(R.dupWords([{ fx: 'checklist', title: 'Record', start: 1.1, end: 1.2 }], kinetic).length, 1);
  assert.strictEqual(R.dupWords([{ fx: 'comment-box', text: 'x', reply: 'it', start: 1.4, end: 1.5 }], kinetic).length, 1);
});
test('a flip with no word timings counts its text for the whole flip', () => {
  const classic = { captionStyle: 'classic', flips: [{ start: 1.0, end: 2.0, text: 'Record it' }] };
  assert.strictEqual(R.dupWords([fx('Record', 1.5, 2.5)], classic).length, 1);
});
test('pill and other whole-line styles show every word from the flip start', () => {
  const pill = { captionStyle: 'pill', flips: [{ start: 1.0, end: 2.0, words: [[1.0, 1.4, 'Record'], [1.6, 1.9, 'today']] }] };
  assert.strictEqual(R.dupWords([fx('today', 1.1, 1.3)], pill).length, 1);
});
test('keeps Unicode letters, digits and one-character words', () => {
  const caps = { flips: [{ start: 0, end: 2, words: [[0, 0.5, 'CAFÉ'], [0.5, 1, '東京'], [1, 1.5, '5']] }] };
  assert.strictEqual(R.dupWords([fx('café', 0, 2)], caps).length, 1);
  assert.strictEqual(R.dupWords([fx('東京', 0, 2)], caps).length, 1);
  assert.strictEqual(R.dupWords([fx('5', 0, 2)], caps).length, 1);
});

// What it does not warn about
test('one-word captions: a word is gone once the next word shows (no false warning)', () => {
  const one = { captionStyle: 'one-word', flips: [{ start: 1.0, end: 2.0, words: [[1.0, 1.3, 'Record'], [1.4, 1.8, 'today']] }] };
  assert.strictEqual(R.dupWords([fx('Record', 1.5, 2.5)], one).length, 0);
  assert.strictEqual(R.dupWords([fx('today', 1.5, 2.5)], one).length, 1);
});
test('skips windows another effect hides, merging overlapping and touching hides', () => {
  assert.strictEqual(R.dupWords([fx('SURFING', 3.2, 3.9)], kinetic, [[3.0, 4.0]]).length, 0);
  const long = { flips: [{ start: 0, end: 2, words: [[0.2, 0.4, 'Record']] }] };
  assert.strictEqual(R.dupWords([fx('Record', 0.2, 1.8)], long, [[0, 1.2], [1.0, 2.0]]).length, 0);
  assert.strictEqual(R.dupWords([fx('Record', 0.2, 1.8)], long, [[0, 1.0], [1.0, 2.0]]).length, 0);
  assert.strictEqual(R.dupWords([fx('Record', 0.2, 1.8)], long, [[0, 0.9], [1.0, 2.0]]).length, 1);
});
test('is quiet when nothing repeats', () => {
  assert.strictEqual(R.dupWords([fx('MONTHS', 0, 5)], kinetic).length, 0);
});

test('titles, stickers and cards are not captions (a one-word title draws only its hero)', () => {
  const caps = { captionStyle: 'one-word', flips: [{ start: 1.0, end: 2.0, mode: 7, hero: [0], text: 'Record today', words: [[1.0, 1.3, 'Record'], [1.4, 1.8, 'today']] },
    { start: 2.0, end: 99, mode: 34, text: 'Take today' }] };
  assert.strictEqual(R.dupWords([fx('TODAY', 0.9, 3.0)], caps).length, 0);
  assert.strictEqual(R.dupWords([fx('TODAY', 0.9, 3.0)], { flips: [{ start: 1.0, end: 2.0, mode: 1, words: [[1.4, 1.8, 'today']] }] }).length, 1);
  assert.match(R.dupWords([fx('TODAY', 0.9, 3.0)], { flips: [{ start: 1.0, end: 2.0, mode: 1, words: [[1.4, 1.8, 'today']] }] })[0], /at 1\.00 s/);   // spray shows at cue start
});
test('a spray cue is judged by its displayed text, not its timed words (edited cue)', () => {
  const caps = { flips: [{ start: 1.0, end: 2.0, mode: 1, text: 'RECORD TODAY', words: [[1.0, 1.3, 'Record'], [1.4, 1.8, 'tomorrow']] }] };
  assert.strictEqual(R.dupWords([fx('today', 1.45, 1.6)], caps).length, 1);
  assert.strictEqual(R.dupWords([fx('tomorrow', 1.45, 1.6)], caps).length, 0);
});
test('a hide over only the start reports the first uncovered instant', () => {
  const long = { flips: [{ start: 0, end: 2, words: [[0.2, 0.4, 'Record']] }] };
  assert.match(R.dupWords([fx('Record', 0.2, 1.8)], long, [[0, 0.5], [0.5, 1.1]])[0], /at 1\.10 s/);
});

// Pinned limitation: effect copy counts for the whole effect window (per-message reveal times are not modelled)
test('approximate: a messages effect counts every bubble from the effect start', () => {
  const caps = { flips: [{ start: 0.1, end: 0.35, words: [[0.2, 0.3, 'Record']] }] };
  const hits = R.dupWords([{ fx: 'messages', text: 'First|Record', start: 0, end: 3 }], caps);
  assert.strictEqual(hits.length, 1);
  assert.match(hits[0], /approximate check/);
});

// Font pairing rule
test('the shipped catalog marks the thin-with-thin pairs', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kit', 'fonts', 'pairings.json'), 'utf8')).pairings;
  assert.strictEqual(shipped.elegant.contrast, 'low');
  assert.strictEqual(shipped.editorial.contrast, 'low');
});
test('automatic picks never hand out a low-contrast pairing', () => {
  const low = new Set(Object.entries(P.pairingCatalog()).filter(([, v]) => v && v.contrast === 'low').map(([k]) => k));   // shipped + local, as the picker sees it
  for (const style of ['cinematic', 'editorial', 'serif', 'film', 'hormozi', '']) {
    const p = P.pickAuto({ style });
    for (const n of String(p.fonts || '').split(',').map(s => s.trim()).filter(Boolean)) assert.ok(!low.has(n), `${style}: ${n}`);
  }
});
test('the pick reads local overrides and validates its fallback', () => {
  const cat = { druk: { contrast: 'low' }, literata: { contrast: 'low' }, bricolage: {}, modern: {} };
  assert.strictEqual(P.contrastSafe({ name: 'x', fonts: 'druk' }, cat).fonts, 'bricolage');
  assert.strictEqual(P.contrastSafe({ name: 'x', fonts: 'druk,modern' }, cat).fonts, 'modern');
  assert.strictEqual(P.contrastSafe({ name: 'x', fonts: 'modern' }, cat).fonts, 'modern');
});

// Outline switch
test('captionOutline reaches the kinetic caption partners only', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'kit', 'overlay.html'), 'utf8');
  assert.match(html, /const ol=\(x,y\)=>\{if\(!p\.outline\)return;/);
  assert.match(html, /partnerDraw\(COUT==='none'\?\{\.\.\.p,outline:false\}:COUT==='thin'\?\{\.\.\.p,thin:true\}:p,R\.pc/);
  assert.match(html, /partnerDraw\(\{\.\.\.p,outline:!cd\},pc,/);   // title partners: unchanged
});

// Contact sheet last frame
function clip(dir, extraAudio) {
  const v = path.join(dir, extraAudio ? 'long-audio.mp4' : 'v.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=24:duration=2',
    ...(extraAudio ? ['-f', 'lavfi', '-i', 'sine=duration=3', '-c:a', 'aac'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v]);
  return v;
}
const png = (args, out) => { try { fs.rmSync(out, { force: true }); execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, out]); } catch {} return fs.existsSync(out) ? fs.readFileSync(out) : null; };
const lastFrame = (v, dir) => {
  const n = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', v]).toString().trim();
  return png(['-i', v, '-vf', `select='eq(n,${n - 1})'`, '-frames:v', '1'], path.join(dir, 'last.png'));
};
test('contact-sheet last frame is the true final frame', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastframe-')), v = clip(dir, false);
  const last = lastFrame(v, dir);
  assert.ok(png(['-sseof', '-0.25', '-i', v, '-update', '1'], path.join(dir, 'b.png')).equals(last), 'clip.py args miss the last frame');
  assert.ok(!png(['-sseof', '-0.25', '-i', v, '-frames:v', '1'], path.join(dir, 'old.png')).equals(last), 'control: -frames:v 1 lands early');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('when audio outlasts the video, the full-decode retry still finds the last frame', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastframe-')), v = clip(dir, true);
  const last = lastFrame(v, dir);
  const tail = png(['-sseof', '-0.25', '-i', v, '-update', '1'], path.join(dir, 'b.png'));
  assert.strictEqual(tail, null, 'premise: the tail seek finds no video frame on this clip');
  const full = png(['-i', v, '-update', '1'], path.join(dir, 'b.png'));   // the clip.py retry
  assert.ok(full && full.equals(last));
  fs.rmSync(dir, { recursive: true, force: true });
});
