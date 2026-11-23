// Matching a B-roll slot to the Vault, by words (docs/specs/broll-sourcing.md, sections 3 and 4). The brief's words
// (the things it names, then its subject) are looked for in each item's name, tags, brand, page title and the text
// the capture found. No picture model yet, so "fits the brief" is word overlap; a named thing still wins.
// One score from 0 to 100 per candidate; the page never shows it, it shows the reason line.
//   fits the brief 45, fits the slot 25, where it is from 15, fresh 10, clean 5
// Under BAR nothing is placed. Reference only items and links with no picture are never offered.
// shortcut: "clean" is a flat 5 (no watermark or caption detector yet) and "fits the brief" has no search by meaning,
// both land with the local picture model.
import { createRequire } from 'module';
import * as V from './vault.mjs';
const BB = createRequire(import.meta.url)('../broll-brief.cjs');

export const BAR = 55;
const DAY = 24 * 3600e3;
// a whole word (or its stem), or the whole phrase with a word edge on both sides: "car" is not in "postcard"
const has = (hay, toks, w) => { const x = String(w).toLowerCase(); return toks.has(V.stem(x)) || new RegExp('(^|[^a-z0-9])' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(hay); };
// an item's words, split once however many slots it is scored for (the view scores every item against every slot)
const SETS = new WeakMap();
const setsOf = it => { let s = SETS.get(it); if (!s) { const names = [it.name, it.title, ...(it.tags || []), ...(it.brand || []), it.from && it.from.site, it.describe].map(v => String(v || '').toLowerCase()).join(' '), text = String(it.text || '').toLowerCase();
  SETS.set(it, s = { names, text, nt: new Set(V.words(names).map(V.stem)), tt: new Set(V.words(text).map(V.stem)) }); } return s; };
const when = (iso, now) => { const d = Math.floor((now - Date.parse(iso)) / DAY); return d < 1 ? 'today' : d < 7 ? 'this week' : d < 14 ? 'last week' : d < 45 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`; };

// one item against one brief: { score, reason, parts } or null when no word of the brief is in it
export function score(brief, it, { now = Date.now() } = {}) {
  if (!V.placeable(it)) return null;
  const { names, text, nt, tt } = setsOf(it);
  const named = (brief.named || []).filter(x => !/^\$?\d/.test(x)), inName = named.find(n => has(names, nt, n)), inText = !inName && named.find(n => has(text, tt, n));
  const ws = BB.subjectWords(brief), hit = ws.filter(w => has(names, nt, w) || has(text, tt, w));
  // the reference cutaway is the second voice: what it showed counts when our own words find nothing, and for less
  const rw = !inName && !inText && !hit.length && brief.reference && brief.reference.showed ? [...new Set(V.words(brief.reference.showed))] : [], rhit = rw.filter(w => has(names, nt, w) || has(text, tt, w));
  if (!inName && !inText && !hit.length && !rhit.length) return null;
  // fits the brief: a named thing in the item beats a clip that only shares plain words
  const fit = inName || inText ? 38 + (ws.length ? 7 * hit.length / ws.length : 7) : hit.length ? 12 + 26 * hit.length / ws.length : 8 + 20 * rhit.length / rw.length;
  // fits the slot: the kind of shot, the shape, long enough, and material that suits the slot's move
  const kind = V.kindOf(it), still = it.kind === 'image', wide = (it.width || 16) >= (it.height || 9), wantWide = !/upright/.test(brief.frame || '');
  const shot = brief.shot === 'screen recording' ? (kind === 'page' || kind === 'screen' ? 10 : still ? 5 : 3) : brief.shot === 'graphic' ? (still || it.source === 'agent' ? 10 : 4) : kind === 'page' || kind === 'screen' ? 4 : 10;
  const shape = wide === wantWide ? 5 : still ? 3 : 1, long = still || !it.seconds || it.seconds >= (brief.seconds || 0) - 1 ? 5 : 2;
  const move = ['push', 'pull', 'drift'].includes(brief.motion) ? (still ? 5 : 3) : still ? 2 : 5;
  const from = it.rights === 'mine' ? (it.source === 'generate' ? 5 : 15) : it.rights === 'public-page' ? 12 : 8;
  const fresh = Math.max(0, 10 - 3 * (it.usedIn || []).length - (V.stale(it, now) ? 3 : 0));
  const total = Math.round(Math.min(100, fit + shot + shape + long + move + from + fresh + 5));
  const quote = inName || inText || hit.join(' ') || rhit.join(' ');
  const reason = inText ? `From your Vault: says "${inText}" on screen`
    : it.rights === 'mine' && it.from && it.from.type === 'link' && it.captured ? `From your Vault: your page "${String(it.name).slice(0, 40)}", captured ${when(it.captured, now)}`
      : `From your Vault: matches "${quote}"`;
  return { score: total, reason, parts: { brief: Math.round(fit), slot: shot + shape + long + move, from, fresh, clean: 5 } };
}
// the best items for a brief, best first: [{ id, score, reason, ok (over the bar), check, item }]
export function candidates(brief, items, { exclude = new Set(), now = Date.now(), n = 4 } = {}) {
  const out = [];
  for (const it of items) { if (exclude.has(it.id)) continue; const s = score(brief, it, { now }); if (s) out.push({ id: it.id, ...s, ok: s.score >= BAR, ...(it.rights === 'public-page' ? { check: 'Check that you may show it.' } : {}), item: it }); }
  return out.sort((a, b) => b.score - a.score || String(b.item.addedAt).localeCompare(String(a.item.addedAt))).slice(0, n);
}
// every slot at once. slots: [{ key, brief }], used: ids already in the reel. The same item is never the pick of two
// slots: a slot on a line that serves the point of the video chooses first, then the earlier slot.
export function assign(slots, items, { used = new Set(), now = Date.now(), n = 4 } = {}) {
  const taken = new Set(used), out = {};
  const order = slots.map((s, i) => ({ ...s, i })).sort((a, b) => (b.brief.serves ? 1 : 0) - (a.brief.serves ? 1 : 0) || a.i - b.i);
  for (const s of order) { const c = candidates(s.brief, items, { exclude: taken, now, n }); out[s.key] = c; if (c[0] && c[0].ok) taken.add(c[0].id); }
  return out;
}
