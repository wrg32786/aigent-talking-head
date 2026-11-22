// Pacing on the Cut step: one control for how much quiet we take out. Natural leaves your pauses, Tight and Very
// tight cap every pause inside a line. It is the engine's own rule (--tighten in kit/reel.cjs, tightenSpans in
// kit/cutpoints.cjs): pauses are read from the audio, a cut goes after the last sound and the clip resumes before
// the next one, so a word is never cut and never starts half way. The same spans play in the page's stitched
// previews (GET /api/cut/preview), so what you hear on Cut is what the draft does.
import CP from '../cutpoints.cjs';

export const PACING = [
  { id: 'natural', label: 'Natural', tighten: 'off', says: 'Your pauses stay as you said them.' },
  { id: 'tight', label: 'Tight', tighten: 0.45, says: 'Long pauses come out. A breath stays between lines.' },
  { id: 'very', label: 'Very tight', tighten: 0.25, says: 'Almost no quiet between words. Fast, for ads and short clips.' },
];
// which of the three the next draft uses, from its composed flags (the Look or a preset can set the pace too)
export function pacingOf(args = []) {
  const i = args.indexOf('--tighten'); if (i < 0 || args.includes('--no-tighten')) return { id: 'natural', maxPause: null };
  const v = +args[i + 1]; return { id: v <= 0.3 ? 'very' : 'tight', maxPause: v };
}
export const pacePatch = id => { const p = PACING.find(x => x.id === id); return p ? { pace: { tighten: p.tighten } } : null; };
// the stretches of the take a clip plays, in order: its ranges, with every pause longer than maxPause taken out.
// { spans: [[from, to]], seconds, saved (the quiet that went, in seconds), cuts (how many pauses) }
export function playSpans(ranges, words, env, maxPause, dur) {
  const spans = []; let cuts = 0;
  for (const [a, b] of ranges || []) {
    if (!(b > a)) continue;
    const r = maxPause && CP.isEnv(env) ? CP.tightenSpans(words || [], env, maxPause, { range: [a, b], dur }) : { spans: [[a, b]], cuts: [] };
    spans.push(...r.spans); cuts += r.cuts.length;
  }
  const len = R => R.reduce((s, [x, y]) => s + (y - x), 0), seconds = +len(spans).toFixed(2);
  return { spans, seconds, saved: +Math.max(0, len((ranges || []).filter(([a, b]) => b > a)) - seconds).toFixed(2), cuts };
}
