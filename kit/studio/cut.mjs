// The Cut step: what to make from a take (the Output choice) and where to cut it.
//   Output: format (short, long, square), length (short, medium, long, relative to the format), kind (full, clips,
//   both; full can split into parts), goal (organic or ad), plus exact numbers under More. defaultsFor() picks it from
//   the take's length so a user can just hit Next; summary() is the one line the page shows.
//   candidates(): from Whisper word times, the full edit (best version or parts), clips and ad cuts, each with time
//   ranges, a 0 to 100 score and the reason, scored by these rules. An agent (MCP set_cuts) or a model (rescore) can
//   score them instead; scoredBy says which one did.
// Pure functions: the server (kit/studio/server.mjs), the MCP tools and the tests share them.
import CP from '../cutpoints.cjs';
import { pointScorer, pointLine } from './point.mjs';

export const FORMATS = {
  short: { label: 'Short', sub: 'Reels, Shorts, TikTok', aspect: '9:16', export: 'shorts', lengths: { short: [15, 30], medium: [30, 60], long: [60, 90] } },
  long: { label: 'Long form', sub: 'YouTube', aspect: '16:9', export: null, lengths: { short: [180, 300], medium: [480, 720], long: [900, null] } },
  square: { label: 'Square post', sub: 'Feed', aspect: '1:1', export: 'square', lengths: { short: [15, 30], medium: [30, 60], long: [60, 120] } },
};
export const LENGTHS = ['short', 'medium', 'long'];
export const KINDS = ['full', 'clips', 'both'];
export const GOALS = ['organic', 'ad'];
export const ASPECTS = { '9:16': 'shorts', '1:1': 'square', '4:5': 'feed45', '16:9': null };
export const AD_CUTS = [15, 30];
const KIND_LABEL = { full: 'Full edit', part: 'Part', clip: 'Clip', ad: 'Ad cut' };

const fmtLen = s => s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;
export const clock = t => { const s = Math.max(0, Math.round(+t || 0)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0'); };

// the length label per format: "30-60 s", "8-12 min", "15+ min"
export function lengthLabel(format, length) {
  const [a, b] = (FORMATS[format] || FORMATS.short).lengths[length] || [30, 60];
  if (b == null) return a >= 120 ? `${Math.round(a / 60)}+ min` : `${a}+ s`;
  const u = a >= 120 ? 'min' : 's', n = x => u === 'min' ? Math.round(x / 60) : x;
  return `${n(a)}-${n(b)} ${u}`;
}

// the [min, max] seconds a piece should run, from the output (exact seconds under More win)
export function range(o, which = 'main') {
  if (which === 'clip') {
    const f = o.format === 'square' ? 'square' : 'short';
    const cs = o.clipSeconds || (o.kind === 'clips' ? o.seconds : null); // with Clips only, the exact length is the clips'
    if (cs) return [Math.max(5, cs * 0.8), cs * 1.1];
    return FORMATS[f].lengths[o.kind === 'both' ? (o.clipLength || 'medium') : o.length];
  }
  if (o.seconds) return [Math.max(5, o.seconds * 0.9), o.max || o.seconds * 1.1];
  const r = FORMATS[o.format].lengths[o.length];
  return [r[0], o.max || r[1]];
}
const mid = ([a, b], cap) => b == null ? Math.min(a * 1.33, cap || Infinity) : (a + b) / 2;

export function defaultOutput() { return { format: 'short', length: 'medium', kind: 'clips', split: false, clips: 5, clipLength: 'medium', goal: 'organic', adCuts: false, aspect: null, seconds: null, clipSeconds: null, max: null, cta: null, auto: true }; }

// smart defaults from the take's length: a short take is one edit; a long one becomes a full edit plus clips
export function defaultsFor(seconds) {
  const o = defaultOutput(), d = +seconds || 0;
  if (!d || d <= 120) Object.assign(o, { format: 'short', kind: 'full', length: d && d <= 40 ? 'short' : d && d <= 75 ? 'medium' : 'long' });
  else if (d <= 600) Object.assign(o, { format: 'short', kind: 'clips', length: 'medium', clips: Math.max(2, Math.min(5, Math.floor(d / 60))) });
  else Object.assign(o, { format: 'long', kind: 'both', length: d >= 1200 ? 'medium' : 'short', clips: 5 });
  return o;
}

// check and merge a change; unknown values are refused with the choices that exist
export function normalize(prev, p = {}) {
  const o = { ...defaultOutput(), ...(prev || {}) }, errs = [];
  const pick = (k, list) => { if (p[k] === undefined) return; if (!list.includes(p[k])) errs.push(`${k}: ${list.join(', ')}`); else o[k] = p[k]; };
  pick('format', Object.keys(FORMATS)); pick('length', LENGTHS); pick('kind', KINDS); pick('goal', GOALS); pick('clipLength', LENGTHS);
  if (p.split !== undefined) o.split = !!p.split;
  if (p.adCuts !== undefined) o.adCuts = !!p.adCuts;
  if (p.clips !== undefined) { const n = Math.round(+p.clips); if (!(n >= 1 && n <= 20)) errs.push('clips: 1 to 20'); else o.clips = n; }
  if (p.aspect !== undefined) { if (p.aspect !== null && !(p.aspect in ASPECTS)) errs.push(`aspect: ${Object.keys(ASPECTS).join(', ')} or null`); else o.aspect = p.aspect; }
  for (const k of ['seconds', 'clipSeconds', 'max']) if (p[k] !== undefined) { if (p[k] !== null && !(+p[k] >= 5 && +p[k] <= 7200)) errs.push(`${k}: 5 to 7200 seconds or null`); else o[k] = p[k] === null ? null : +p[k]; }
  if (p.cta !== undefined) o.cta = p.cta ? String(p.cta).replace(/\u2014/g, ', ').trim().slice(0, 60) || null : null;
  const known = ['format', 'length', 'kind', 'goal', 'clipLength', 'split', 'adCuts', 'clips', 'aspect', 'seconds', 'clipSeconds', 'max', 'cta'];
  for (const k of Object.keys(p)) if (!known.includes(k)) errs.push(`unknown output field "${k}" (${known.join(', ')})`);
  if (Object.keys(p).some(k => known.includes(k))) o.auto = false;
  return { output: o, errs };
}

export const aspectOf = o => o.aspect || FORMATS[o.format].aspect;
export const exportOf = (o, which = 'main') => which === 'clip' ? (o.format === 'square' ? 'square' : 'shorts') : (o.aspect ? ASPECTS[o.aspect] : FORMATS[o.format].export);

// "Both: 1 full edit (~10 min) + 5 short clips, for organic"
export function summary(o, sourceSeconds) {
  const f = FORMATS[o.format], goal = o.goal === 'ad' ? 'for an ad' : 'for organic';
  const len = o.seconds ? `~${fmtLen(o.seconds)}` : (() => { const r = f.lengths[o.length]; return r[1] == null ? `${fmtLen(r[0])}+` : `~${fmtLen(mid(r))}`; })();
  const what = f.label.toLowerCase(), clipName = o.format === 'square' ? 'square clips' : 'short clips';
  const parts = sourceSeconds ? Math.max(1, Math.round(sourceSeconds / mid(range(o), sourceSeconds))) : null;
  const ad = o.goal === 'ad' && o.adCuts ? ' + 15 s and 30 s ad cuts' : '';
  if (o.kind === 'full') return o.split ? `Full edit in parts: ${parts ? parts + ' ' : ''}${what} videos (${len} each), ${goal}${ad}` : `Full edit: 1 ${what} video (${len}), ${goal}${ad}`;
  if (o.kind === 'clips') return `Clips: ${o.clips} ${o.format === 'long' ? 'long form clips' : clipName} (${o.clipSeconds || o.seconds ? '~' + fmtLen(o.clipSeconds || o.seconds) : lengthLabel(o.format === 'long' ? 'short' : o.format, o.length)}), ${goal}${ad}`;
  return `Both: 1 full edit (${len}) + ${o.clips} ${clipName}, ${goal}${ad}`;
}

// ---------- transcript to sentences ----------
const END = /[.?!]["')\]]*$/;
export function sentences(words, { gap = 0.9 } = {}) {
  const out = []; let cur = [];
  const flush = () => { if (!cur.length) return; out.push({ i: out.length, start: cur[0][0], end: cur[cur.length - 1][1], text: cur.map(w => w[2]).join(' ').replace(/\s+([,.?!])/g, '$1'), words: cur.length }); cur = []; };
  for (let k = 0; k < (words || []).length; k++) {
    const w = words[k], next = words[k + 1];
    cur.push(w);
    if (END.test(w[2]) || !next || next[0] - w[1] > gap || cur.length >= 45) flush();
  }
  return out;
}

const FILLER = /^(um+|uh+|erm|hmm+|ah+|like|basically|literally|actually)$/i;
const HOOK = /^(what|why|how|stop|here'?s|this|you|your|the (one|secret|truth|biggest|real)|if you|most people|nobody|everyone|i (tried|spent|made|lost|quit|built))\b/i;
const CTA = /\b(follow|subscribe|link in (my )?bio|comment|dm me|sign up|join|download|check out|try it|book a call|grab|get yours|click)\b/i;
const WEAK_START = /^(and|but|so|because|or|then|also|which)\b/i;
const STOP = new Set('the a an and or but so to of in on at for with is are was were be been it this that i you we they he she my your our their me us them do does did have has had not no yes just like um uh'.split(' '));
const content = t => new Set(String(t).toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));

// one sentence's signals: hook, number, question, CTA, filler share, words a second
export function signals(s) {
  const ws = s.text.split(/\s+/), dur = Math.max(0.3, s.end - s.start);
  return { hook: HOOK.test(s.text.trim()), question: /\?\s*$/.test(s.text), number: /\b\d|\b(one|two|three|five|ten|hundred|thousand|million)\b/i.test(s.text), cta: CTA.test(s.text),
    weakStart: WEAK_START.test(s.text.trim()), filler: ws.filter(w => FILLER.test(w.replace(/[^a-z]/gi, ''))).length / Math.max(1, ws.length), rate: ws.length / dur, short: ws.length < 4 };
}
// pt: the scorer for the point of the video (kit/studio/point.mjs pointScorer), or nothing
export function sentenceScore(s, goal, pt) {
  const g = signals(s); let v = 50 + (pt ? pt.boost(s.text) : 0);
  if (g.hook) v += 14; if (g.question) v += 8; if (g.number) v += 8; if (g.cta) v += goal === 'ad' ? 10 : 2;
  if (g.weakStart) v -= 6; if (g.short) v -= 8; v -= g.filler * 60;
  if (g.rate > 2 && g.rate < 4.2) v += 6; else if (g.rate < 1.4) v -= 8;
  return Math.max(0, Math.min(100, v));
}

// a window of sentences [i..j] as a candidate: its score and the reason in plain words
function windowOf(S, i, j, goal, kind, pt) {
  const w = S.slice(i, j + 1), first = signals(w[0]), last = signals(w[w.length - 1]);
  let score = w.reduce((a, s) => a + sentenceScore(s, goal, pt), 0) / w.length;
  const why = [], fits = !!pt && w.filter(s => pt.fits(s.text)).length >= Math.max(1, Math.ceil(w.length / 4));
  if (first.hook || first.question) { score += goal === 'ad' ? 16 : 10; why.push(first.question ? 'opens on a question' : 'opens on a strong line'); }
  else if (goal === 'ad') score -= 10;
  if (first.weakStart) { score -= 10; why.push('starts mid-thought'); }
  if (w.some(s => signals(s).number)) why.push('has a number');
  if (goal === 'ad') { if (w.some(s => signals(s).cta)) { score += 10; why.push('ends with a call to action'); } else why.push('no call to action yet (an end card is added)'); }
  else if (kind !== 'part') { const a = content(w[0].text), b = content(w[w.length - 1].text); if ([...a].some(x => b.has(x)) && w.length > 1) { score += 6; why.push('ending loops back to the start'); } }
  const filler = w.reduce((a, s) => a + signals(s).filler, 0) / w.length; if (filler > 0.08) why.push('some filler words');
  if (!END.test(w[w.length - 1].text)) score -= 4; else if (!why.length) why.push('a complete thought');
  if (last.cta && goal !== 'ad') why.push('ends on a call to action');
  return { score: Math.round(Math.max(0, Math.min(100, score))), reason: cap(why.join(', ') || 'steady delivery'), ...(fits ? { fits: true } : {}) };
}
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
const snippet = (S, i, j) => { const t = S.slice(i, j + 1).map(s => s.text).join(' '); return t.length > 160 ? t.slice(0, 157).replace(/\s+\S*$/, '') + '...' : t; };
const pad = 0.12; // a breath before and after each range
const rng = (S, i, j, dur) => [+Math.max(0, S[i].start - pad).toFixed(2), +Math.min(dur || Infinity, S[j].end + pad).toFixed(2)];
export const lengthOf = c => +c.ranges.reduce((a, [x, y]) => a + (y - x), 0).toFixed(2);

// the best non-overlapping windows between min and max seconds
function bestWindows(S, [min, max], n, goal, kind, dur, pt, taken = []) {
  const all = [];
  for (let i = 0; i < S.length; i++) for (let j = i; j < S.length; j++) {
    const d = S[j].end - S[i].start; if (d > (max || Infinity) * 1.05) break;
    if (d >= min * 0.95) all.push({ i, j, ...windowOf(S, i, j, goal, kind, pt) });
  }
  all.sort((a, b) => b.score - a.score || (a.i - b.i));
  const out = [], used = taken.slice();
  for (const c of all) { if (out.length >= n) break; if (used.some(([a, b]) => c.i <= b && c.j >= a)) continue; used.push([c.i, c.j]); out.push(c); }
  return out.map(c => ({ ranges: [rng(S, c.i, c.j, dur)], score: c.score, reason: c.reason, ...(c.fits ? { fits: true } : {}), text: snippet(S, c.i, c.j), from: c.i, to: c.j }));
}

// parts of about the target length that cover the take, broken at the longest pause near each target (a topic change)
function parts(S, [min, max], dur, goal, pt) {
  const target = mid([min, max], dur), out = []; let i = 0;
  while (i < S.length) {
    let best = null;
    for (let j = i; j < S.length; j++) {
      const d = S[j].end - S[i].start; if (max && d > max * 1.1) break;
      if (d < min * 0.8 && j < S.length - 1) continue;
      const gapAfter = j < S.length - 1 ? S[j + 1].start - S[j].end : 3, fit = 1 - Math.abs(d - target) / target;
      const v = gapAfter * 2 + fit * 3 + (END.test(S[j].text) ? 1 : 0); if (!best || v > best.v) best = { j, v };
    }
    const j = best ? best.j : S.length - 1;
    const rest = S.length - 1 - j; if (rest > 0 && S[S.length - 1].end - S[j + 1].start < min * 0.5) { out.push([i, S.length - 1]); break; } // a short tail joins the last part
    out.push([i, j]); i = j + 1;
  }
  return out.map(([a, b], k) => ({ ranges: [rng(S, a, b, dur)], ...windowOf(S, a, b, goal, 'part', pt), text: snippet(S, a, b), label: `Part ${k + 1} of ${out.length}`, from: a, to: b }));
}

// the best version: the strongest sentences, in order, up to the target; the opening hook always stays
function bestVersion(S, r, dur, goal, pt) {
  const sc = s => sentenceScore(s, goal, pt);
  const total = S.length ? S[S.length - 1].end - S[0].start : 0, target = Math.min(mid(r, total), total);
  const scored = S.map(s => ({ s, v: sc(s) }));
  let keep;
  if (total <= target * 1.08) keep = scored.filter(x => x.v >= 25 || x.s.words >= 4).map(x => x.s);
  else {
    const firstHook = S.slice(0, Math.max(1, Math.ceil(S.length * 0.2))).reduce((b, s) => (sc(s) > sc(b) ? s : b), S[0]);
    const order = scored.filter(x => x.s !== firstHook).sort((a, b) => b.v - a.v), chosen = new Set([firstHook]); let t = firstHook.end - firstHook.start;
    for (const x of order) { const d = x.s.end - x.s.start; if (t + d > target * 1.04) continue; chosen.add(x.s); t += d; }
    if (goal === 'ad') { const c = [...S].reverse().find(s => signals(s).cta); if (c && !chosen.has(c)) chosen.add(c); }
    keep = S.filter(s => chosen.has(s));
  }
  // neighbouring sentences join into one range
  const ranges = [];
  for (const s of keep) { const a = +Math.max(0, s.start - pad).toFixed(2), b = +Math.min(dur || Infinity, s.end + pad).toFixed(2), l = ranges[ranges.length - 1]; if (l && a - l[1] < 0.6) l[1] = b; else ranges.push([a, b]); }
  const avg = keep.length ? Math.round(keep.reduce((a, s) => a + sc(s), 0) / keep.length) : 0;
  const cut = S.length - keep.length, fits = !!pt && keep.some(s => pt.fits(s.text));
  return { ranges, score: avg, reason: cap(`${keep.length} of ${S.length} sentences kept in order${cut ? `, ${cut} weaker or filler ones cut` : ''}, opens on its strongest early line`), ...(fits ? { fits: true } : {}), text: snippet(keep.length ? keep : S, 0, Math.min(2, (keep.length || S.length) - 1)), label: 'Best version' };
}

// ad cuts: the best hook, then the strongest lines, then the call to action, inside 15 or 30 s
function adCut(S, secs, dur, pt) {
  const hooks = S.map(s => ({ s, v: sentenceScore(s, 'ad', pt) + (signals(s).hook || signals(s).question ? 20 : 0) })).sort((a, b) => b.v - a.v);
  const hook = hooks[0] && hooks[0].s; if (!hook) return null;
  const cta = [...S].reverse().find(s => signals(s).cta && s !== hook);
  const L = s => s.end - s.start + 2 * pad, chosen = new Set([hook]); let t = L(hook) + (cta ? L(cta) : 0);
  if (t > secs * 1.1) return null;
  if (cta) chosen.add(cta);
  for (const x of S.filter(s => !chosen.has(s)).map(s => ({ s, v: sentenceScore(s, 'ad', pt) })).sort((a, b) => b.v - a.v)) { const d = L(x.s); if (t + d > secs) continue; chosen.add(x.s); t += d; }
  const ord = [hook, ...S.filter(s => chosen.has(s) && s !== hook && s !== cta), ...(cta ? [cta] : [])];
  const fits = !!pt && ord.some(s => pt.fits(s.text));
  const ranges = ord.map(s => [+Math.max(0, s.start - pad).toFixed(2), +Math.min(dur || Infinity, s.end + pad).toFixed(2)]);
  return { ranges, score: Math.round(ord.reduce((a, s) => a + sentenceScore(s, 'ad', pt), 0) / ord.length), reason: `Hook first, then the strongest lines${cta ? ', ends on your call to action' : ', an end card adds the call to action'}`, ...(fits ? { fits: true } : {}), text: snippet(ord, 0, Math.min(1, ord.length - 1)), label: `${secs} s ad` };
}

// every candidate for the output, ranked; ids are stable per kind and order (full, p1.., c1.., ad15, ad30)
export function candidates(words, o, { duration, point } = {}) {
  const pt = pointScorer(point), S = sentences(words), dur = duration || (words && words.length ? words[words.length - 1][1] : 0), out = [];
  if (!S.length) return [];
  if (o.kind === 'full' || o.kind === 'both') {
    if (o.split && o.kind === 'full') parts(S, range(o), dur, o.goal, pt).forEach((c, k) => out.push({ id: 'p' + (k + 1), kind: 'part', ...c }));
    else out.push({ id: 'full', kind: 'full', ...bestVersion(S, range(o), dur, o.goal, pt) });
  }
  if (o.kind === 'clips' || o.kind === 'both') {
    const r = o.kind === 'both' || o.format !== 'long' ? range(o, 'clip') : range(o);
    let w = bestWindows(S, r, o.clips, o.goal, 'clip', dur, pt);
    // a take shorter than the clip length: clips scaled to the take, a quarter to a half of it
    if (!w.length && dur) w = bestWindows(S, [Math.min(r[0], dur * 0.25), Math.min(r[1] || dur, dur * 0.5)], o.clips, o.goal, 'clip', dur, pt).map(c => ({ ...c, reason: c.reason + ' (shorter than the length you picked, the take is short)' }));
    w.forEach((c, k) => out.push({ id: 'c' + (k + 1), kind: 'clip', label: `Clip ${k + 1}`, ...c }));
  }
  if (o.goal === 'ad' && o.adCuts) for (const secs of AD_CUTS) { const c = adCut(S, secs, dur, pt); if (c) out.push({ id: 'ad' + secs, kind: 'ad', ...c }); }
  return out.map((c, k) => ({ ...c, label: c.label || KIND_LABEL[c.kind], seconds: lengthOf(c), keep: true, order: k }));
}

// clean-up marks for the timeline: filler words and long pauses, in source seconds
export function marks(words, { silence = 0.9 } = {}) {
  const out = [];
  for (let k = 0; k < (words || []).length; k++) {
    const w = words[k], n = words[k + 1];
    if (FILLER.test(String(w[2]).replace(/[^a-z]/gi, '')) && /^(um+|uh+|erm|hmm+|ah+)$/i.test(String(w[2]).replace(/[^a-z]/gi, ''))) out.push({ type: 'filler', from: w[0], to: w[1], text: w[2] });
    if (n && n[0] - w[1] >= silence) out.push({ type: 'silence', from: w[1], to: n[0] });
  }
  return out;
}

// a candidate the user or an agent edits: ranges inside the take, at least half a second each, in order
export function cleanRanges(ranges, dur) {
  if (!Array.isArray(ranges) || !ranges.length) throw Object.assign(new Error('ranges: [[start, end], ...] in seconds'), { code: 400 });
  const out = ranges.map(r => [Math.max(0, +r[0] || 0), Math.min(dur || Infinity, +r[1] || 0)]).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]);
  for (const [a, b] of out) if (!(b - a >= 0.5)) throw Object.assign(new Error(`range ${a}-${b}: at least 0.5 s, inside the take`), { code: 400 });
  return out.sort((x, y) => x[0] - y[0]);
}

// the text inside ranges, for a candidate an agent or the user added
export function textIn(words, ranges) {
  const t = (words || []).filter(w => ranges.some(([a, b]) => w[0] >= a - 0.05 && w[1] <= b + 0.05)).map(w => w[2]).join(' ');
  return t.length > 160 ? t.slice(0, 157).replace(/\s+\S*$/, '') + '...' : t;
}

// ask a model to score the rule-based candidates; returns them re-ranked with its reasons
export function scorePrompt(cands, o, point) {
  return ['You pick the best parts of a talking-head video for ' + summary(o) + '.',
    o.goal === 'ad' ? 'This is an ad: the hook must land in the first 1 to 2 seconds, pacing tight, a clear call to action at the end, no long intro.' : 'This is organic content: story pacing, a strong first line, and for short clips an ending that loops back to the start.',
    pointLine(point),
    'Score each candidate 0 to 100 and give a short plain reason (no em dashes). Reply with JSON only: {"scores":[{"id":"c1","score":80,"reason":"..."}]}.',
    'Candidates: ' + JSON.stringify(cands.map(c => ({ id: c.id, kind: c.kind, seconds: c.seconds, text: c.text })))].filter(Boolean).join('\n');
}
export function applyScores(cands, reply) {
  let j; try { j = JSON.parse(String(reply).match(/\{[\s\S]*\}/)[0]); } catch { return null; }
  const by = Object.fromEntries((j.scores || []).filter(x => x && x.id).map(x => [x.id, x]));
  if (!Object.keys(by).length) return null;
  return cands.map(c => by[c.id] ? { ...c, score: Math.max(0, Math.min(100, Math.round(+by[c.id].score || 0))), reason: String(by[c.id].reason || c.reason).replace(/\u2014/g, ', ').slice(0, 200) } : c);
}

// a script from a transcript: [hook] the opening lines up to about 3 s, [cta] the closing call to action, [pause] at long gaps
export function scriptFrom(words) {
  const S = sentences(words); if (!S.length) return '';
  const t0 = S[0].start; let h = 0; while (h < S.length - 1 && S[h].end - t0 < 3) h++;
  const ctaAt = S.length > h + 1 && signals(S[S.length - 1]).cta ? S.length - 1 : -1;
  const line = (s, k) => s.text + (k < S.length - 1 && S[k + 1].start - s.end > 1.2 ? ' [pause]' : '');
  const lines = ['[hook]', ...S.slice(0, h + 1).map((s, k) => line(s, k)), '[body]'];
  S.forEach((s, k) => { if (k > h && k !== ctaAt) lines.push(line(s, k)); });
  if (ctaAt >= 0) lines.push('[cta]', S[ctaAt].text);
  return lines.join('\n');
}

// ---------- cut points on the audio ----------
// One module decides every cut point in the kit (kit/cutpoints.cjs): the transcript says roughly where each word is,
// the audio says exactly, read on the whole band and on the s, f and th band. An end goes at least 120 ms after the
// last sound, a start at least 60 ms before the first, both only inside a real pause; never mid-word. env is the
// envelope from media.mjs energy() (kit/cutpoints.cjs envelopeOf).
export const SNAP = CP.SNAP;
export const snapRange = (r, words, env, dur, o) => CP.snapRange(r, words, env, dur, o);
export const snapRanges = (ranges, words, env, dur, o) => CP.snapRanges(ranges, words, env, dur, o);
export function snapCandidate(c, words, env, dur, o) {
  const s = snapRanges(c.ranges, words, env, dur, o); if (!s.cuts) return { ...c, snapped: false };
  return { ...c, ranges: s.ranges, seconds: lengthOf({ ranges: s.ranges }), cuts: s.cuts, snapped: true, unsure: s.cuts.filter(p => p.sure === false).length };
}

// ---------- the Lines view: every line of a long take, keep or retake, grouped into named bites ----------
const OPENER = /^(so|and|but|ok(ay)?|now|um+|uh+|well|like|you know|i mean|we know how to|i think|the thing is)\b[\s,]*/i;
const contentWords = t => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
// a line is a likely retake only when a later line soon after says most of it again (not one shared phrase), and the
// later one is not much shorter; very short lines and lines cut off mid-thought are flagged as fragments instead
export function lineHints(S, { within = 120, overlap = 0.7 } = {}) {
  return S.map((s, i) => {
    const secs = s.end - s.start, tail = s.text.trim();
    if (secs < 0.6 || (s.words <= 2 && !END.test(tail))) return { hint: 'fragment', why: secs < 0.6 ? 'under 0.6 s' : 'a few words, cut off' };
    const mine = contentWords(s.text.replace(OPENER, '')); if (mine.length < 3) return { hint: null };
    for (let j = i + 1; j < S.length && S[j].start - s.end <= within; j++) {
      const o = S[j], theirs = new Set(contentWords(o.text.replace(OPENER, '')));
      if (theirs.size < mine.length * 0.6 || (o.end - o.start) < secs * 0.6) continue;
      const shared = mine.filter(w => theirs.has(w)).length / mine.length;
      if (shared >= overlap) return { hint: 'retake', of: j, why: `said again at ${clock(o.start)} (${Math.round(shared * 100)}% the same words)` };
    }
    return { hint: null };
  });
}
// lines with ids l1, l2 ... (stable for a transcript), times snapped to the audio when there is an envelope
export function lines(words, env, dur) {
  const S = sentences(words), H = lineHints(S);
  return S.map((s, i) => {
    let a = s.start, b = s.end;
    if (env) { const r = snapRange([a, b], words, env, dur); [a, b] = r.range; }
    return { id: 'l' + (i + 1), n: i + 1, start: +a.toFixed(2), end: +b.toFixed(2), seconds: +(b - a).toFixed(2), text: s.text, hint: H[i].hint, why: H[i].why || null };
  });
}
// a bite's ranges in its own order (lines can be moved), back-to-back neighbours in order joined into one range
export function biteRanges(ids, L) {
  const by = Object.fromEntries(L.map(l => [l.id, l])), out = [];
  for (const id of ids) { const l = by[id]; if (!l) continue; const last = out[out.length - 1];
    if (last && last.n + 1 === l.n) { last.r[1] = l.end; last.n = l.n; } else out.push({ n: l.n, r: [l.start, l.end] }); }
  return out.map(x => x.r);
}
// one clean take: every kept line in the take's order
export const cleanTake = (L, keep) => L.filter(l => keepOf(l, keep)).map(l => l.id);
export const keepOf = (l, keep) => (keep && l.id in keep ? !!keep[l.id] : l.hint !== 'retake' && l.hint !== 'fragment');
// the ranges a render extracts for a piece: its snapped ranges as they are, touching ones joined (no second cut)
export const renderRanges = c => CP.mergeRanges((c.ranges || []).filter(([a, b]) => b > a).map(([a, b]) => [+a, +b]));
// the words of a piece in its own clock (its ranges joined back to back), for the clips.json a render hands to
// kit/reel.cjs with the file: the reel uses these words and never transcribes or cuts the piece again
export function clipWords(words, ranges) {
  const out = []; let off = 0;
  for (const [a, b] of ranges) { for (const w of words || []) if (w[1] > a + 0.01 && w[0] < b - 0.01) out.push([+(Math.max(w[0], a) - a + off).toFixed(3), +(Math.min(w[1], b) - a + off).toFixed(3), String(w[2])]); off += b - a; }
  return out;
}
