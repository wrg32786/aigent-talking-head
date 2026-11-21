// The b-roll lane: one slot per beat of the drafted reel. A beat is one segment of build/cut.json (output time, after
// the cut), with the caption words that fall in it. A slot puts a library clip over part of its beat:
//   { clip, place: full | top | pip | frame, offset (seconds into the beat), dur, in (seconds into the clip) }
// and becomes a cut.json insert at render (kit/studio/broll-run.mjs, kit/assemble.cjs).
// top: the split, its panel behind the top of your head; frame: two rounded cards, you in the smaller one with your head
// over its top edge (kit/split.cjs)
export const PLACES = ['full', 'top', 'pip', 'frame'];
export const PLACE_LABEL = { full: 'Full cutaway', top: 'Split top panel', pip: 'Picture in picture', frame: 'Framed cards' };
const r2 = x => +(+x).toFixed(2);

export function beats(cut, caps) {
  const out = []; let t = 0;
  const flips = ((caps && caps.flips) || []).filter(f => f && (f.mode == null || f.mode === 0) && f.text);
  (cut && cut.segs || []).forEach((s, i) => {
    const len = (+s.out - +s.in) + (+s.pad || 0), start = t, end = t + len; t = end;
    const text = flips.filter(f => +f.start < end - 0.05 && +f.end > start + 0.05).map(f => String(f.text)).join(' ').replace(/\s+/g, ' ').trim();
    out.push({ n: i + 1, start: r2(start), end: r2(end), seconds: r2(len), text });
  });
  return out;
}
// where a slot sits in its beat: a small lead in, then up to 3.5 s (the clip's length and the beat's room allowing)
export function timing(slot, beat, clip) {
  const lead = Math.min(0.2, beat.seconds * 0.1);
  const offset = Math.max(0, Math.min(slot.offset != null ? +slot.offset : lead, Math.max(0, beat.seconds - 0.4)));
  const room = beat.seconds - offset, cl = clip && clip.kind === 'video' && clip.seconds ? Math.max(0.4, clip.seconds - (+slot.in || 0)) : Infinity;
  const dur = Math.max(0.4, Math.min(slot.dur != null ? +slot.dur : 3.5, room, cl));
  return { offset: r2(offset), dur: r2(dur), at: r2(beat.start + offset), in: r2(+slot.in || 0) };
}
// cut.json inserts for every filled slot (absolute paths; broll-run.mjs makes them relative to build/)
export function inserts(slots, bts, clipOf, pathOf) {
  const out = [];
  for (const b of bts) {
    const sl = slots && slots[b.n]; if (!sl || !sl.clip) continue;
    const c = clipOf(sl.clip); if (!c) continue;
    const t = timing(sl, b, c);
    out.push({ file: pathOf(c), at: t.at, dur: t.dur, in: c.kind === 'image' ? 0 : t.in, place: PLACES.includes(sl.place) ? sl.place : 'full', ...(c.kind === 'image' ? { image: true } : {}), beat: b.n, clip: c.id, studio: true });
  }
  return out;
}
const STOP = new Set('the a an and or but so of to in on at for with by from is are was were be been it its this that these those i you we they he she my your our their me us them just really very like about into than then there here what when where which who how all any some more most much can will would could should do does did have has had get got going gonna not no yes one two three because if as up out over also only even still now'.split(' '));
// a stock search for a line: its two strongest words
export function queryOf(text) {
  const ws = String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).map(w => w.replace(/'s$|'/g, '')).filter(w => w.length > 3 && !STOP.has(w));
  return [...new Set(ws.sort((a, b) => b.length - a.length))].slice(0, 2).join(' ');
}

// ---------- spots (1.13.0): where b-roll can go ----------
// A spot is a moment of the drafted reel with room for one b-roll. Every draft segment is a spot, and a segment longer
// than SPOT_MAX splits at caption ends into spots of about SPOT_AIM seconds (a 27 s take is no longer one beat that
// holds every word). marks are your own split times (Add a spot); refs are the times the reference cuts to b-roll
// ({ at, label, detail } on the draft's clock), and each one also splits and tags the spot it lands in.
export const SPOT_MAX = 10, SPOT_AIM = 7;
const capFlips = caps => ((caps && caps.flips) || []).filter(f => f && (f.mode == null || f.mode === 0) && f.text).map(f => ({ start: +f.start, end: +f.end, text: String(f.text) })).sort((a, b) => a.start - b.start);
// a spot's words: the captions centred in it (so a caption split by a spot shows once), else any that touch it
const textIn = (flips, a, b) => { const j = l => l.map(f => f.text).join(' ').replace(/\s+/g, ' ').trim(), mid = flips.filter(f => (f.start + f.end) / 2 >= a && (f.start + f.end) / 2 < b);
  return j(mid.length ? mid : flips.filter(f => f.start < b - 0.05 && f.end > a + 0.05)); };
export function spots(cut, caps, { marks = [], refs = [] } = {}) {
  const base = beats(cut, caps), flips = capFlips(caps), out = [];
  const snap = (t, a, b) => { const e = flips.map(f => f.end).filter(x => x > a + 1.5 && x < b - 1.5); if (!e.length) return t; const n = e.reduce((p, x) => (Math.abs(x - t) < Math.abs(p - t) ? x : p)); return Math.abs(n - t) <= 1.2 ? n : t; };
  const extra = [...marks.map(t => +t), ...refs.map(r => +r.at)].filter(Number.isFinite);
  for (const b of base) {
    const cuts = [];
    if (b.seconds > SPOT_MAX) { let last = b.start; for (const e of flips.map(f => f.end).filter(x => x > b.start && x < b.end)) if (e - last >= SPOT_AIM - 1 && b.end - e >= 2.5) { cuts.push(e); last = e; } }
    for (const t of extra) { if (!(t > b.start + 1.5 && t < b.end - 1.5)) continue; const x = snap(t, b.start, b.end); if (cuts.every(c => Math.abs(c - x) >= 1.5)) cuts.push(x); }
    const edges = [b.start, ...cuts.sort((p, q) => p - q), b.end];
    for (let k = 0; k + 1 < edges.length; k++) { const a = edges[k], z = edges[k + 1]; out.push({ start: r2(a), end: r2(z), seconds: r2(z - a), text: flips.length ? textIn(flips, a, z) : b.text, seg: b.n }); }
  }
  out.forEach((s, i) => { s.n = i + 1; });
  for (const r of refs) { const s = out.find(x => +r.at >= x.start - 0.05 && +r.at < x.end) || out[out.length - 1]; if (s && !s.ref) s.ref = { label: r.label || 'B-roll', detail: r.detail || '', ...(r.seconds > 0 ? { seconds: +(+r.seconds).toFixed(2) } : {}), ...(r.what ? { what: String(r.what) } : {}) }; }
  for (const t of marks) { const s = out.find(x => Math.abs(x.start - t) < 1.6); if (s) s.mark = true; }
  return out.map(s => ({ n: s.n, start: s.start, end: s.end, seconds: s.seconds, text: s.text, seg: s.seg, ...(s.ref ? { ref: s.ref } : {}), ...(s.mark ? { mark: true } : {}) }));
}
// when the spots change (a spot added or removed, a new draft), move each filled slot and idea to the spot that now
// holds the moment it was on, so nothing jumps to other words
export function remap(map, from, to) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    const o = from.find(x => x.n === +k); if (!o) continue;
    const t = v && v.at != null ? +v.at : o.start + (v && v.offset != null ? +v.offset : 0.2);
    const s = to.find(x => t >= x.start - 0.01 && t < x.end) || to.find(x => x.n === +k); if (!s || out[s.n]) continue;
    out[s.n] = v && v.offset != null ? { ...v, offset: r2(Math.max(0, t - s.start)) } : v;
  }
  return out;
}

// ---------- what to show on a spot, from its words ----------
// a number said becomes a counter card, a quote becomes a quote card, anything else a search on its strongest nouns.
// role: proof (a number or a result), tip (a how-to, a tool or a screen), story or other; Suggest uses it to prefer your
// testimonials and product clips on proof spots and screen recordings on tips.
const NUMW = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000 };
const GROW = { doubled: [2, 'x'], tripled: [3, 'x'], quadrupled: [4, 'x'] };
const VERBS = new Set('make made makes want wants know think need needs said says tell told start started build built show shows take took give gave keep kept thing things people time work works look looks feel right good best great actually literally every never always something someone everything nothing follow follows trying try tried using went come came getting doing done let lets maybe pretty little lot lots stuff okay yeah well whole entire real same other first last next used able sure kind sort'.split(' '));
const PROOF = /\b(\d|doubled|tripled|quadrupled|grew|growth|revenue|sales|clients?|customers?|results?|leads|views|followers|percent|months? later|proof|testimonial|review)\b/i;
const TIP = /\b(how to|here is how|step|setup|set up|tool|app|prompt|screen|click|type|dashboard|website|code|template|use this|try this)\b/i;
const STORY = /\b(when i|i was|years ago|my first|story|remember|back then|one day)\b/i;
export function roleOf(text) { const t = String(text || ''); return PROOF.test(t) ? 'proof' : TIP.test(t) ? 'tip' : STORY.test(t) ? 'story' : 'other'; }
export function nounQuery(text) {
  const ws = String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).map(w => w.replace(/'s$|'/g, '')).filter(w => w.length > 3 && !STOP.has(w) && !VERBS.has(w) && !/^\d+$/.test(w) && !/(ing|ly)$/.test(w));
  const seen = new Map(); ws.forEach((w, i) => { if (!seen.has(w)) seen.set(w, i); });
  return [...seen.keys()].sort((a, b) => b.length - a.length).slice(0, 2).sort((a, b) => seen.get(a) - seen.get(b)).join(' ');
}
export function pick(spot) {
  const t = String(spot.text || ''), role = roleOf(t), query = nounQuery(t);
  const m = t.match(/(\$)?\b(\d[\d,]*(?:\.\d+)?)\s*(%|percent\b|k\b|x\b|times\b)?\s*([a-z]+)?/i);
  if (m) {
    const n = Math.round(+m[2].replace(/,/g, '')), unit = (m[3] || '').toLowerCase(), word = (m[4] || '').toLowerCase();
    if (Number.isFinite(n) && n > 0 && n < 1e9) {
      const suffix = unit === '%' || unit === 'percent' ? '%' : unit === 'k' ? 'K' : unit === 'x' || unit === 'times' ? 'x' : '', label = !unit && word && !STOP.has(word) ? word : unit && word && !STOP.has(word) ? word : '';
      const shown = `${m[1] || ''}${n}${suffix}${label ? ' ' + label : ''}`;
      return { role: 'proof', query, word: m[2], idea: `Counter card: ${shown}`, card: { kind: 'counter', to: n, prefix: m[1] || '', suffix, label }, why: `You say "${m[0].trim()}". A number on screen lands harder.` };
    }
  }
  const g = Object.keys(GROW).find(k => new RegExp('\\b' + k + '\\b', 'i').test(t));
  if (g) return { role: 'proof', query, word: g, idea: `Counter card: ${GROW[g][0]}x`, card: { kind: 'counter', to: GROW[g][0], suffix: GROW[g][1], label: nounQuery(t).split(' ')[0] || '' }, why: `You say "${g}". Show it as a number.` };
  const q = t.match(/\b(?:said|says|told me|asked me)\b[,:]?\s*(.{12,140})/i);
  if (q) return { role, query, word: q[0].split(/\s+/)[0], idea: 'Quote card', card: { kind: 'quote', text: q[1].replace(/[.!?]+$/, '') }, why: 'Someone is quoted here. Put their words on screen.' };
  if (!query) return null;
  return { role, query, word: query.split(' ')[0], idea: `Show ${query}`, why: `You talk about ${query.split(' ').join(' and ')} here.` };
}
// where in the spot the b-roll starts: on the word it is about, a beat before it; never in the first 1.2 s of the
// reel (the hook shows your face first)
export function offsetFor(spot, word, flipsOrCaps) {
  const flips = Array.isArray(flipsOrCaps) ? flipsOrCaps : capFlips(flipsOrCaps), w = String(word || '').toLowerCase();
  const f = w && flips.find(x => x.start >= spot.start - 0.05 && x.start < spot.end && x.text.toLowerCase().includes(w));
  const min = spot.start < 0.05 ? Math.min(1.2, spot.seconds * 0.4) : Math.min(0.2, spot.seconds * 0.1);
  const o = f ? f.start - spot.start - 0.1 : min;
  return r2(Math.max(min, Math.min(o, Math.max(min, spot.seconds - 1))));
}
