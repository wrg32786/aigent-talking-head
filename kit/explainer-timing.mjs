// The explainer's timing math, kept apart from the media work so it can be tested on a plain word list
// (tests/explainer-timing.test.mjs). Words are [start, end, text] in seconds.
export const r2 = x => Math.round(x * 100) / 100;
export const norm = w => String(w).toLowerCase().replace(/[^a-z0-9']/g, '');

// first occurrence of a phrase whose first word starts at or after t: [first index, last index], or null
export function findPhrase(words, phrase, t = 0) {
  const p = String(phrase).split(/\s+/).map(norm).filter(Boolean);
  if (!p.length) return null;
  for (let i = 0; i <= words.length - p.length; i++) {
    if (words[i][0] < t) continue;
    if (p.every((x, k) => norm(words[i + k][2]) === x)) return [i, i + p.length - 1];
  }
  return null;
}
const need = (m, what, phrase, t) => { if (!m) throw new Error(`${what} "${phrase}" is not in what you said (after ${t.toFixed(2)} s)`); return m; };

// cutaways go in the pause after their phrase (never on the transcript's word end, which clips the tail of the word).
// cutaways: [{ after, dur, ...anything }] in order. Returns the cuts placed on the talk track and the words shifted
// past each cutaway (the cutaway's own sound is not captioned).
export function placeCuts(words, cutaways = []) {
  const cuts = [];
  let after = 0;
  for (const c of cutaways) {
    const [, j] = need(findPhrase(words, c.after, after), 'cutaway phrase', c.after, after);
    const end = words[j][1], next = words[j + 1] ? words[j + 1][0] : end + 0.4;
    const at = r2(Math.min(Math.max(end + 0.15, (end + next) / 2), next - 0.05));
    cuts.push({ ...c, at });
    after = next;
  }
  let acc = 0;
  for (const c of cuts) { c.start = r2(c.at + acc); acc += c.dur; c.end = r2(c.start + c.dur); }
  const shifted = words.map(([s, e, w]) => {
    const add = cuts.filter(c => s >= c.at).reduce((a, c) => a + c.dur, 0);
    return [r2(s + add), r2(e + add), w];
  });
  return { cuts, words: shifted };
}

// beats keyed to phrases, searched in order: the next search starts after the words just matched, so a phrase said
// twice lands on its second saying. T is the talk track's length. Returns the beats with start and end, the call to
// action, when the hook ends, and the full-frame windows (cutaways, keyword punch-ins, the call to action).
export function planBeats(words, spec = {}, T, cuts = []) {
  const beats = [];
  let t0 = 0;
  for (const b of spec.beats || []) {
    const [i, j] = need(findPhrase(words, b.at, t0), 'beat phrase', b.at, t0);
    beats.push({ ...b, start: r2(Math.max(0, words[i][0] - 0.1)) });
    t0 = words[j][1];
  }
  let cta = null;
  if (spec.cta) {
    const [i] = need(findPhrase(words, spec.cta.at, t0), 'call to action phrase', spec.cta.at, t0);
    cta = { ...spec.cta, start: r2(Math.max(0, words[i][0] - 0.4)) };
  }
  const stops = [...beats.map(b => b.start), ...cuts.map(c => c.start), cta ? cta.start : T, T].sort((a, b) => a - b);
  for (const b of beats) {
    b.end = r2(Math.min(...stops.filter(s => s > b.start + 0.05), T));
    if (b.type === 'keyword') b.start = r2(Math.max(0, b.start - 0.3));
  }
  const hookEnd = r2(Math.min(...beats.filter(b => b.type !== 'progress').map(b => b.start), ...cuts.map(c => c.start), cta ? cta.start : T, T));
  const full = [...cuts.map(c => ({ a: c.start, b: c.end, hard: true })),
    ...beats.filter(b => b.type === 'keyword').map(b => ({ a: b.start, b: b.end })),
    ...(cta ? [{ a: cta.start, b: T }] : [])].sort((x, y) => x.a - y.a);
  return { beats, cta, hookEnd, full };
}
