// The b-roll lane: one slot per beat of the drafted reel. A beat is one segment of build/cut.json (output time, after
// the cut), with the caption words that fall in it. A slot puts a library clip over part of its beat:
//   { clip, place: full | top | pip, offset (seconds into the beat), dur, in (seconds into the clip) }
// and becomes a cut.json insert at render (kit/studio/broll-run.mjs, kit/assemble.cjs).
export const PLACES = ['full', 'top', 'pip'];
export const PLACE_LABEL = { full: 'Full cutaway', top: 'Split top panel', pip: 'Picture in picture' };
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
