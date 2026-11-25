// Sections of a reel: each cut.json segment tagged "hook", "body" or "cta" (docs/specs/studio-builder.md 8.1), and the
// seams a transition timing allows. Used by --transitions-when (reel.cjs) and the presenter effect timing (Studio fxPlan).
//   hook: from 0 to the end of the first sentence that ends at or after 3 s (at most 40% of the reel)
//   cta:  from the start of the last sentence or two that ask for something (follow, subscribe, link, try, join...)
//   body: the rest
// Words are reel-time [{ start, end, word }] (kit/spoken.cjs timeline). Without words the first 3 s are the hook.
const CTA = /^(follow|subscribe|comment|join|try|download|visit|grab|check|sign|book|dm|message|share|save|click|tap|get|star|install|link)$/;
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
  for (const s of ss.slice(-2)) if (s.words.some(w => CTA.test(low(w.word)))) { ctaStart = s.start; break; }
  if (ctaStart !== null && ctaStart < hookEnd) ctaStart = hookEnd >= len ? null : hookEnd;
  return { hookEnd: r3(hookEnd), ctaStart: ctaStart === null ? null : r3(ctaStart) };
}

// tag every segment in place; returns the list of sections in order
function tag(cut, words) {
  const segs = cut.segs || [], tt = times(segs), len = tt.length ? tt[tt.length - 1].end : 0, b = bounds(words, len);
  return segs.map((s, i) => {
    const { start, end } = tt[i], mid = (start + end) / 2;
    s.section = start < b.hookEnd - 0.05 ? 'hook' : b.ctaStart !== null && (mid >= b.ctaStart || start >= b.ctaStart - 0.05) ? 'cta' : 'body';
    return s.section;
  });
}

// is the seam into segment i (i >= 1) one that this timing keeps a named transition on?
function seamAllowed(segs, i, when) {
  if (!when || when === 'every-cut') return true;
  const a = segs[i - 1], b = segs[i];
  if (when === 'hook-cta') return [a.section, b.section].some(x => x === 'hook' || x === 'cta');
  // topic: where the section changes, or a new take starts (another file)
  if (when === 'topic') return a.section !== b.section || (a.file && b.file && a.file !== b.file);
  return true;
}

// cut.transitionsWhen applied: a seam it does not keep becomes a plain hard cut (no blend and no shake there).
// Needs the segments tagged. Returns how many seams it turned into hard cuts.
function applyTransitionsWhen(cut) {
  const when = cut.transitionsWhen, segs = cut.segs || [];
  if (!when || when === 'every-cut') return 0;
  const tt = times(segs); let n = 0;
  for (let i = 1; i < segs.length; i++) {
    if (seamAllowed(segs, i, when) || segs[i].jump) continue;
    if (segs[i].transition !== 'cut') { segs[i].transition = 'cut'; n++; }
    const at = tt[i].start;
    if (Array.isArray(cut.hits)) cut.hits = cut.hits.filter(h => Math.abs((Array.isArray(h) ? h[0] : h) - at) > 0.06);
  }
  return n;
}

// the [start, end] windows of the reel in the given sections (adjacent ones merged)
function windows(cut, want) {
  const segs = cut.segs || [], tt = times(segs), out = [];
  segs.forEach((s, i) => { if (!want.includes(s.section)) return; const last = out[out.length - 1]; if (last && Math.abs(last[1] - tt[i].start) < 0.01) last[1] = tt[i].end; else out.push([tt[i].start, tt[i].end]); });
  return out;
}

module.exports = { CTA, WHEN, sentences, times, bounds, tag, seamAllowed, applyTransitionsWhen, windows };
