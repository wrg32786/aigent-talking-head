// The two ends of a piece, beyond "never cut a word" (kit/cutpoints.cjs does that part):
//
//   the end    The last piece ends at the end of the sentence that holds the closing line. A take often runs on for
//              a word or two after it ("So what are you waiting for? Like,"): those words are left out, and the cut
//              goes in the quiet after the sentence, where kit/cutpoints.cjs says a cut is safe.
//   the start  A piece starts on the first frame the speaker looks at the lens, when the take allows it: only inside
//              the quiet before the piece's first word, so no word is cut and none starts half said. When the
//              speaker looks away for all of that quiet, the piece starts just before the first word.
//
// "Looks at the lens" is the head pose, read with YuNet's five face points (kit/framing.py pose), against the same
// speaker's own middle pose while talking in this take. It is the head, not the eyes: a glance down with a still
// head is not seen.
// kit/reel.cjs calls trimEnd() and lensStarts() on every draft, before any re-cut. --keep-ends turns both off.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const CP = require('./cutpoints.cjs');

const r3 = x => +(+x).toFixed(3);
const TAIL = { maxWords: 4, maxSeconds: 2.5, minSentence: 2 };
const LENS = { fps: 12, bodyFps: 2, minRoom: 0.2, maxLead: 4, pitch: 0.045, pitchMax: 0.08, yaw: 0.09, yawMax: 0.15, size: 0.35, hold: 2, away: 0.3, lead: CP.SNAP.leadTarget };

// ---------- the end ----------
// a word that ends a sentence: a full stop, a question mark or an exclamation mark (a quote mark or bracket may
// follow). A word that trails off ("Uh...", "so…") does not end one.
const ENDS = w => { const t = String(w || '').trim(); return /[.?!]["'”’)\]]*$/.test(t) && !/(\.\.|…)["'”’)\]]*$/.test(t); };
// words: [start, end, text] in play order. The words after the last full sentence, when the take runs on: returns
// { keep (index of the sentence's last word), tail (the words left out) } or null when the last word ends a sentence,
// when nothing is punctuated, or when what follows is long enough to be a line of its own.
function runOn(words, o = TAIL) {
  const W = (words || []).filter(w => w && String(w[2] || '').trim());
  if (W.length < 2 || ENDS(W[W.length - 1][2])) return null;
  let k = -1; for (let i = W.length - 2; i >= 0; i--) if (ENDS(W[i][2])) { k = i; break; }
  if (k < 0) return null;
  const tail = W.slice(k + 1);
  if (tail.length > o.maxWords || tail[tail.length - 1][1] - tail[0][0] > o.maxSeconds) return null;
  // the sentence kept must be a sentence: two words or more back to the sentence before it
  let n = 1; for (let i = k - 1; i >= 0 && !ENDS(W[i][2]); i--) n++;
  if (n < o.minSentence) return null;
  return { keep: words.indexOf(W[k]), last: W[k], next: tail[0], tail };
}
// The new end of a segment { in, out } whose words (clip seconds) run on past the closing sentence.
// env: the clip's audio envelope (kit/cutpoints.cjs), or null: then the cut is 180 ms after the word, short of the next.
// Returns null when there is nothing to trim, else { out, was, left (the words left out), after (the last words kept) }.
function trimEnd(seg, words, env, dur) {
  const W = (words || []).filter(w => w[1] > seg.in + 0.02 && w[0] < seg.out - 0.02);
  const ro = runOn(W);
  if (!ro) return null;
  const all = (words || []).filter(w => w[1] > w[0]);
  let cut;
  if (CP.isEnv(env)) {
    // the words as the audio has them (the same alignment every other cut uses), then the end cut after the sentence
    const A = CP.retime(CP.align(all, env), env), li = all.indexOf(ro.last), ni = all.indexOf(ro.next);
    if (li >= 0 && ni >= 0 && A[li] && A[ni]) cut = CP.endEdge(A[li], A[ni], env, dur || seg.out, CP.SNAP, A).cut;
  }
  if (!(cut > ro.last[1] - 0.08 && cut < ro.next[0] + 0.02)) cut = Math.max(ro.last[1], Math.min(ro.last[1] + CP.SNAP.tailTarget, ro.next[0] - 0.03));
  cut = r3(Math.min(cut, seg.out));
  if (!(cut - seg.in >= 0.3) || seg.out - cut < 0.04) return null;
  const txt = a => a.map(w => String(w[2]).trim()).join(' ');
  return { out: cut, was: seg.out, left: txt(ro.tail), after: txt(W.slice(Math.max(0, W.indexOf(ro.last) - 2), W.indexOf(ro.last) + 1)) };
}

// ---------- the start ----------
const med = a => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
// the speaker's own middle pose from samples taken while talking: [[t, pitch, yaw, h], ...]
function baseOf(samples, o = LENS) {
  const S = (samples || []).filter(s => s && s[1] != null);
  if (S.length < 6) return null;
  const pitch = med(S.map(s => s[1])), yaw = med(S.map(s => s[2])), h = med(S.map(s => s[3]));
  const mad = (k, m) => med(S.map(s => Math.abs(s[k] - m)));
  return { pitch, yaw, h, n: S.length, pitchTol: Math.min(o.pitchMax, Math.max(o.pitch, 3 * mad(1, pitch))), yawTol: Math.min(o.yawMax, Math.max(o.yaw, 3 * mad(2, yaw))) };
}
const atLens = (s, base, o = LENS) => !!(s && s[1] != null && base && Math.abs(s[1] - base.pitch) <= base.pitchTol && Math.abs(s[2] - base.yaw) <= base.yawTol && (!base.h || !s[3] || Math.abs(s[3] / base.h - 1) <= o.size));
// Where a piece should start. lo: where it starts now; hi: the latest safe start (the lead before its first word);
// samples: the pose on every frame from lo to hi. Returns null to leave it, else { in, why }.
//  - looking at the lens from the first frame: nothing to do
//  - looks away, then at the lens and holds it to the first word: start on that first frame
//  - never settles on the lens before the first word: start at hi when that takes out 0.3 s or more of looking away
function lensStart({ lo, hi, samples, base }, o = LENS) {
  const S = (samples || []).filter(s => s[0] >= lo - 1e-3 && s[0] <= hi + 1e-3);
  if (!base || hi - lo < o.minRoom || S.length < 3) return null;
  const ok = S.map(s => atLens(s, base, o));
  // the first frame from which the speaker looks at the lens on every frame up to the first word
  let k = S.length; while (k > 0 && ok[k - 1]) k--;
  if (k === 0) return null;
  if (k <= S.length - o.hold) return { in: r3(Math.min(hi, Math.max(lo, S[k][0]))), why: 'lens', away: r3(S[k][0] - lo) };
  return hi - lo >= o.away ? { in: r3(hi), why: 'away', away: r3(hi - lo) } : null;
}

// kit/framing.py pose over spans of one file: [[a, b, fps], ...] -> one list of samples per span (null when it fails)
function pose(python, video, spans) {
  if (!spans.length) return [];
  try {
    const out = execFileSync(python, [path.join(__dirname, 'framing.py'), 'pose', video, '--spans', spans.map(([a, b, f]) => `${r3(a)}-${r3(b)}@${f}`).join(',')],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, env: { ...process.env, PYTHONUTF8: '1' } }).toString().trim().split(/\r?\n/).pop();
    return JSON.parse(out).spans || spans.map(() => null);
  } catch { return spans.map(() => null); }
}

// Every piece that starts at a new place in the take (the first piece, a new clip, a jump) and has quiet before its
// first word: its start moved to the first frame at the lens. segs are changed in place.
//   words(i): the clip words behind segment i (clip seconds);  fileOf(i): the clip file to read
//   firstSound(i, word): where the word's sound really starts (the audio), or null to use the transcript
// Returns { moved: [{ seg, was, in, why, away }], lines } and never throws: a take we cannot read is left as it is.
function lensStarts({ segs, words, fileOf, python, firstSound = () => null, poseFn = pose, log = () => {} }, o = LENS) {
  const want = [];
  segs.forEach((s, i) => {
    const p = segs[i - 1];
    if (i && p.file === s.file && Math.abs(s.in - p.out) < 0.05) return; // the take plays on across this cut
    const F = (words(i) || []).find(w => w[1] > s.in + 0.02 && w[0] < s.out - 0.02 && w[1] > w[0]);
    if (!F) return;
    const snd = firstSound(i, F), hi = Math.min((Number.isFinite(snd) ? snd : F[0]) - o.lead, F[0] - 0.03);
    if (hi - s.in >= o.minRoom && hi - s.in <= o.maxLead) want.push({ i, lo: s.in, hi: r3(hi) });
  });
  const out = { moved: [], lines: [] };
  if (!want.length) return out;
  const files = [...new Set(want.map(w => fileOf(w.i)))];
  for (const file of files) {
    const mine = want.filter(w => fileOf(w.i) === file), body = segs.map((s, i) => (fileOf(i) === file ? s : null)).filter(Boolean);
    // the speaker's own pose while talking: the body of every piece of this file, a couple of frames a second
    // (at most 8 pieces of it, 6 s of each: enough to know the middle pose, and quick)
    const some = body.length > 8 ? Array.from({ length: 8 }, (_, k) => body[Math.floor(k * body.length / 8)]) : body;
    const bodyOf = s => { const a = Math.min(s.out, s.in + 0.5); return [a, Math.min(s.out, a + 6)]; }, secs = some.reduce((a, s) => a + bodyOf(s)[1] - bodyOf(s)[0], 0);
    // a short take is read more often, so there are a dozen frames or more to take the middle of
    const bfps = Math.min(8, Math.max(o.bodyFps, Math.ceil(14 / Math.max(0.5, secs))));
    const spans = [...mine.map(w => [w.lo, w.hi + 0.09, o.fps]), ...some.map(s => [...bodyOf(s), bfps])];
    const got = poseFn(python, file, spans);
    if (!got || got.some(g => !g)) { out.lines.push('start on the lens: the face could not be read (Python with opencv missing?); starts stay where they are'); break; }
    const base = baseOf(got.slice(mine.length).flat(), o);
    if (!base) { out.lines.push('start on the lens: too few frames with a face to know where the speaker looks; starts stay where they are'); continue; }
    mine.forEach((w, n) => {
      const r = lensStart({ lo: w.lo, hi: w.hi, samples: got[n], base }, o);
      if (!r || !(segs[w.i].out - r.in >= 0.3)) return;
      out.moved.push({ seg: w.i, was: w.lo, ...r }); segs[w.i].in = r.in;
    });
  }
  for (const m of out.moved) out.lines.push(m.why === 'lens'
    ? `start on the lens: piece ${m.seg + 1} starts ${m.away.toFixed(2)} s later, on the first frame the speaker looks at the lens (before the first word, no word touched)`
    : `start on the lens: piece ${m.seg + 1} starts ${m.away.toFixed(2)} s later, just before its first word (the speaker looks away for all of the quiet before it)`);
  out.lines.forEach(l => log(l));
  return out;
}

module.exports = { runOn, trimEnd, baseOf, atLens, lensStart, lensStarts, pose, TAIL, LENS };
