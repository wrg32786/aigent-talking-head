// Words into phrases with a look-ahead, and the subtitle file beside every reel (1.29.0).
// A greedy cut (close the phrase at N words) strands a last word alone for a quarter of a second. This splits the speech
// into spans at sentence ends and at pauses, then picks, inside each span, the split with the fewest phrases such that
// every phrase lasts long enough to read, reads no faster than maxCps and stays under the word and letter caps; on a
// tie the opening phrase is the longer one. When no split fits, the span is cut by the caps alone and marked
// forced, so the caller can say where: a phrase is never stretched through a pause and no time is made up.
// kit/phrase-titles.cjs uses it for the phrase titles (two to seven words), toSrt() for the .srt.
// phrase grouping rule from higgsfield-ai/skills higgsfield-faceless-video scripts/audio_to_captions.py (MIT); SRT rules from mojomast/open-higgsfield-skills skills/subtitles-captions (MIT)
'use strict';
const txt = w => String(w.word);
const SENT = /[.?!]["”)]?$/;

// words: [{ start, end, word }] in time order. Returns [{ start, end, words, forced? }].
// alone(word): may this word be a phrase by itself (minWords is not asked of it).
function group(words, { maxWords = 7, minWords = 1, maxChars = 84, minDur = 0.4, maxCps = 30, gap = 0.4, breakOn = SENT, alone = () => false } = {}) {
  const spans = []; let cur = [];
  (words || []).forEach((w, i) => { cur.push(w); const n = words[i + 1]; if (!n || breakOn.test(txt(w)) || n.start - w.end >= gap) { spans.push(cur); cur = []; } });
  const out = [];
  for (const sp of spans) {
    const n = sp.length, chars = (i, j) => sp.slice(i, j).map(txt).join(' ').length;
    const fits = (i, j) => { const c = chars(i, j), d = sp[j - 1].end - sp[i].start; return j - i <= maxWords && (j - i >= minWords || (j - i === 1 && alone(sp[i]))) && c <= maxChars && d >= minDur && c / Math.max(d, 0.01) <= maxCps; };
    // best[i]: the fewest phrases for the words from i on; next[i]: where the first of them ends (the longest on a tie)
    const best = Array(n + 1).fill(Infinity), next = Array(n + 1).fill(-1); best[n] = 0;
    for (let i = n - 1; i >= 0; i--) for (let j = Math.min(n, i + maxWords); j > i; j--) if (best[j] + 1 < best[i] && fits(i, j)) { best[i] = best[j] + 1; next[i] = j; }
    const cuts = [];
    if (best[0] < Infinity) for (let i = 0; i < n; i = next[i]) cuts.push([i, next[i], false]);
    else for (let i = 0; i < n;) { let j = i + 1; while (j < n && j - i < maxWords && chars(i, j + 1) <= maxChars) j++; cuts.push([i, j, true]); i = j; }
    for (const [i, j, forced] of cuts) out.push({ start: sp[i].start, end: sp[j - 1].end, words: sp.slice(i, j), ...(forced ? { forced: true } : {}) });
  }
  return out;
}

const stamp = t => { const ms = Math.max(0, Math.round(t * 1000)), p = (v, n = 2) => String(v).padStart(n, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
// one cue's words on at most two lines of about lineChars, split nearest the middle
function twoLines(ws, lineChars = 42) {
  const s = ws.join(' '); if (s.length <= lineChars || ws.length < 2) return s;
  let b = 1, d = Infinity; for (let i = 1; i < ws.length; i++) { const x = Math.abs(ws.slice(0, i).join(' ').length - s.length / 2); if (x < d) { d = x; b = i; } }
  return ws.slice(0, b).join(' ') + '\n' + ws.slice(b).join(' ');
}
// The text of an .srt: what is said, also when the captions are burned in or not drawn at all. said: every word on the
// reel's clock ([{ start, end, word }], kit/spoken.cjs timeline); captions.js alone leaves out the words a title or a
// graphic carries, so its mode 0 flips are used only when there is no transcript. At most 2 lines of about 42 letters, each cue up for 1 to 7 s and gone before the next.
function toSrt(CAP, total = Infinity, said = null) {
  const words = (said || []).filter(w => String(w.word || '').trim() && +w.end > 0 && +w.start < total).map(w => ({ start: Math.max(0, +w.start), end: +w.end, word: String(w.word).trim() }));
  if (!words.length) for (const f of ((CAP && CAP.flips) || []).filter(f => f.mode === 0).sort((a, b) => a.start - b.start)) {
    const ws = Array.isArray(f.words) && f.words.length ? f.words : String(f.text || '').split(/\s+/).filter(Boolean).map((w, i, a) => [f.start + (f.end - f.start) * i / a.length, f.start + (f.end - f.start) * (i + 1) / a.length, w]);
    for (const w of ws) if (String(w[2]).trim()) words.push({ start: +w[0], end: +w[1], word: String(w[2]).trim() });
  }
  const cues = group(words, { maxWords: 16, maxChars: 84, minDur: 0, gap: 0.8 });
  return cues.map((c, i) => { const nx = cues[i + 1], cap = Math.min(nx ? nx.start - 0.04 : Infinity, total), end = Math.max(c.start + 0.2, Math.min(Math.max(c.end, c.start + 1), c.start + 7, cap));
    return `${i + 1}\n${stamp(c.start)} --> ${stamp(end)}\n${twoLines(c.words.map(txt))}\n`; }).join('\n');
}
module.exports = { group, toSrt, twoLines, stamp };
