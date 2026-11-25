// Sections of a reel: each cut.json segment tagged "hook", "body" or "cta" (docs/specs/studio-builder.md 8.1), and the
// seams a transition timing allows. Used by --transitions-when (reel.cjs) and the presenter effect timing (Studio fxPlan).
//   hook: from 0 to the end of the first sentence that ends at or after 3 s (at most 40% of the reel)
//   cta:  from the start of the last sentence or two that ask for something (follow, subscribe, link, try, join...)
//   body: the rest
// Words are reel-time [{ start, end, word }] (kit/spoken.cjs timeline). Without words the first 3 s are the hook.
// a call to action: a strong asking verb anywhere, or a common verb that starts the sentence or follows "and", "so",
// "now", "just", "go" ("check out", "get the free guide"), so "this will save you hours" is not one
const CTA_STRONG = /^(follow|subscribe|download|dm|install)$/;
const CTA_SOFT = /^(try|grab|check|sign|book|share|save|get|star|link|hit|drop|comment|join|visit|message|click|tap)$/;
const LEADS = new Set(['and', 'so', 'now', 'just', 'go', 'then', 'please']);
const isCta = (ws, k) => { const w = low(ws[k].word); return CTA_STRONG.test(w) || (CTA_SOFT.test(w) && (k === 0 || LEADS.has(low(ws[k - 1].word)))); };
const WHEN = ['every-cut', 'topic', 'hook-cta'];
const r3 = x => +(+x).toFixed(3);
const low = w => String(w).toLowerCase().replace(/[^a-z']/g, '');

// sentences from word times: a word ending in . ! ? closes one, and so does a pause of half a second
function sentences(words) {
  const out = []; let cur = [];
  (words || []).forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1], end = /[.!?]["')\]]*$/.test(String(w.word).trim()) || !next || next.start - w.end >= 0.5;
    if (end) { out.push({ start: cur[0].start, end: w.end, words: cur }); cur = []; }
  });
  return out;
}
// segment start and end times on the reel timeline (pads count, as in spoken.timeline)
function times(segs) { let t = 0; return (segs || []).map(s => { const a = t; t += (+s.out - +s.in) + (+s.pad || 0); return { start: r3(a), end: r3(t) }; }); }

// { hookEnd, ctaStart } in reel seconds (ctaStart null when nothing is asked for)
function bounds(words, len) {
  const ss = sentences(words);
  const first = ss.find(s => s.end >= 3);
  let hookEnd = first ? first.end : Math.min(3, len);
  hookEnd = Math.min(hookEnd, Math.max(3, len * 0.4), len);
  let ctaStart = null;
  for (const s of ss.slice(-2)) if (s.words.some((w, k) => isCta(s.words, k))) { ctaStart = s.start; break; }
  if (ctaStart !== null && ctaStart < hookEnd) ctaStart = hookEnd >= len ? null : hookEnd;
  return { hookEnd: r3(hookEnd), ctaStart: ctaStart === null ? null : r3(ctaStart) };
}

// tag every segment in place; returns the list of sections in order. The first segment is always hook; a segment is
// hook when most of it is before the hook's end, cta when most of it is after the call to action starts (or, when
// none is, the one the call to action starts in).
function tag(cut, words) {
  const segs = cut.segs || [], tt = times(segs), len = tt.length ? tt[tt.length - 1].end : 0, b = bounds(words, len);
  const out = segs.map((s, i) => { const { start, end } = tt[i], mid = (start + end) / 2;
    return i === 0 || mid < b.hookEnd ? 'hook' : b.ctaStart !== null && (mid >= b.ctaStart || start >= b.ctaStart - 0.05) ? 'cta' : 'body'; });
  if (b.ctaStart !== null && !out.includes('cta')) { const k = tt.findIndex(x => x.start <= b.ctaStart && b.ctaStart < x.end); if (k > 0 && out[k] !== 'hook') out[k] = 'cta'; }
  segs.forEach((s, i) => { s.section = out[i]; });
  return out;
}

// is the seam into segment i (i >= 1) one that this timing keeps a named transition on? takeOf(seg) names the
// recording a segment comes from (clips.json "take"), or null when that is not known
function seamAllowed(segs, i, when, takeOf = () => null) {
  if (!when || when === 'every-cut') return true;
  const a = segs[i - 1], b = segs[i];
  if (when === 'hook-cta') return [a.section, b.section].some(x => x === 'hook' || x === 'cta');
  // topic: where the section changes, or another recording starts
  if (when === 'topic') { const ta = takeOf(a), tb = takeOf(b); return a.section !== b.section || (ta != null && tb != null && ta !== tb); }
  return true;
}

// Undo an earlier timing pass: every seam it made a plain cut gets its own transition back (seg.heldTransition) and
// the shakes it took off come back (cut.heldHits). Returns true when anything was held.
function restore(cut) {
  let any = false;
  // only a seam still a plain cut gets its transition back: one you changed since (choices --apply, cut.json) stays yours
  for (const s of cut.segs || []) if ('heldTransition' in s) { if (s.transition === 'cut') { if (s.heldTransition == null) delete s.transition; else s.transition = s.heldTransition; } delete s.heldTransition; any = true; }
  if (Array.isArray(cut.heldHits)) { cut.hits = [...(cut.hits || []), ...cut.heldHits].sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b)); delete cut.heldHits; any = true; }
  return any;
}

// cut.transitionsWhen applied: a seam it does not keep becomes a plain hard cut (no blend and no shake there), with what
// it had kept aside so a later timing (or every cut) brings it back. Seams you set yourself (choices --apply,
// cut.edited.transitions), a tightened pause and a recreated reference's own seams are left alone.
// Needs the segments tagged. Returns how many seams it turned into hard cuts.
function applyTransitionsWhen(cut, { takeOf, window = 0.15 } = {}) {
  restore(cut);
  const when = cut.transitionsWhen, segs = cut.segs || [], mine = new Set((cut.edited && cut.edited.transitions) || []);
  if (!when || when === 'every-cut') return 0;
  const tt = times(segs); let n = 0; const held = [];
  for (let i = 1; i < segs.length; i++) {
    if (seamAllowed(segs, i, when, takeOf) || segs[i].jump || segs[i].recut || mine.has(i)) continue;
    if (segs[i].transition === 'cut') continue;
    segs[i].heldTransition = segs[i].transition ?? null; segs[i].transition = 'cut'; n++;
    const at = tt[i].start;
    if (Array.isArray(cut.hits)) cut.hits = cut.hits.filter(h => { const near = Math.abs((Array.isArray(h) ? h[0] : h) - at) <= window; if (near) held.push(h); return !near; });
  }
  if (held.length) cut.heldHits = held;
  return n;
}

// the [start, end] windows of the reel in the given sections (adjacent ones merged)
function windows(cut, want) {
  const segs = cut.segs || [], tt = times(segs), out = [];
  segs.forEach((s, i) => { if (!want.includes(s.section)) return; const last = out[out.length - 1]; if (last && Math.abs(last[1] - tt[i].start) < 0.01) last[1] = tt[i].end; else out.push([tt[i].start, tt[i].end]); });
  return out;
}

module.exports = { isCta, WHEN, sentences, times, bounds, tag, seamAllowed, restore, applyTransitionsWhen, windows };
