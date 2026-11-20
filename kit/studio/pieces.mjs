// Pieces and the Combo (1.15.0). A piece is a stretch of a take that says one thing: one line of the Cut step
// (kit/studio/cut.mjs lines, every edge in the quiet next to its words), with a category and topic tags. The Combo is
// the pieces you want, in your order; it is what Draft, B-roll and Render use (kit/studio/server.mjs comboOf).
//   categories: a fixed 8 (Hook, Story, Tip, Proof or quote, List, CTA, Aside, Retake or fragment), sorted by rules
//     here; you or your agent can move a piece to another one
//   topics: words this footage keeps coming back to (pricing, Claude Code...), to filter by subject
//   choose: Let AI choose. The best hook, then the strongest story, tip, proof and list pieces up to the length you
//     picked, in the take's order, then the call to action, each with one reason
import { sentenceScore, signals } from './cut.mjs';

export const CATS = [
  { id: 'hook', label: 'Hook', use: 'The open: a claim, a question or "you"' },
  { id: 'story', label: 'Story', use: 'Sets up the payoff' },
  { id: 'tip', label: 'Tip', use: 'One actionable line' },
  { id: 'proof', label: 'Proof or quote', use: 'A number or someone else\'s words back it' },
  { id: 'list', label: 'List', use: 'A run of short points' },
  { id: 'cta', label: 'CTA', use: 'The ask that ends the reel' },
  { id: 'aside', label: 'Aside', use: 'Off topic, apologies, filler talk. Hidden by default' },
  { id: 'retake', label: 'Retake or fragment', use: 'Said again later, or cut off. Hidden by default' },
];
export const CAT_IDS = CATS.map(c => c.id);
const ASIDE = /^(sorry|anyway|where was i|hold on|one sec|wait|ok(ay)? so|um+|uh+|let me (start|try) (again|over))\b|\b(my (dog|cat|phone)|excuse me|bear with me|where was i)\b/i;
const PROOF = /\b\d|\b(doubled|tripled|percent|revenue|clients?|customers?|results?|leads|views|followers|grew|months? later|said|told me|says)\b/i;
const HARD_PROOF = /\b\d|\b(doubled|tripled|percent|said|told me|says)\b/i;
const LIST = /\b(first|second|third|fourth|number (one|two|three)|rules?|steps?|ways|things|reasons|tips|mistakes)\b|^(one|two|three|next|finally|last)\b/i;
const TIP = /\b(how to|you can|you should|try (this|it)|use|open|type|set (it )?up|make sure|don'?t|do this|start with|write|keep|read it|film)\b/i;
const STORY = /\b(i was|when i|my (first|friend|client)|i remember|years? ago|last (year|month|week)|i (quit|started|tried|lost|made|spent|built|did)|she|he)\b/i;
const CTA = /\b(follow|subscribe|link in (my )?bio|comment|dm me|sign up|join|download|check out|try it|book a call|grab|get yours|click)\b/i;

const STOP = new Set('the a an and or but so of to in on at for with by from is are was were be been it its this that these those i you we they he she my your our their me us them just really very like about into than then there here what when where which who how all any some more most much can will would could should do does did have has had get got going gonna not no yes one two three because if as up out over also only even still now make made want know think need said says tell told start take give keep thing things people time work look feel right good best great actually literally every never always something someone everything nothing follow using went come came doing done let maybe pretty little lot stuff okay yeah well whole same other first last next used sure kind sort tried every single most'.split(' '));
export const contentWords = t => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).map(w => w.replace(/'s$|'/g, '')).filter(w => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w) && !/(ing|ly|ed)$/.test(w));

export function categoryOf(line, i, n) {
  const t = String(line.text || '').trim(), g = signals({ text: t, start: line.start, end: line.end });
  if (line.hint === 'retake' || line.hint === 'fragment') return 'retake';
  if (ASIDE.test(t) || (g.filler > 0.3) || (g.short && !g.hook && !g.cta && !PROOF.test(t))) return 'aside';
  if (CTA.test(t)) return 'cta';
  if ((g.hook || g.question) && i < Math.max(3, n * 0.3)) return 'hook';
  // a number or someone's words is proof; "my first client" is a story about a client, not proof
  if (HARD_PROOF.test(t)) return 'proof';
  if (STORY.test(t)) return 'story';
  if (PROOF.test(t)) return 'proof';
  if (LIST.test(t)) return 'list';
  if (TIP.test(t)) return 'tip';
  return g.hook || g.question ? 'hook' : 'story';
}
// topic tags: content words said in at least two lines, the most often first (up to 8)
export function topicsOf(lines, max = 8) {
  const n = new Map();
  for (const l of lines) for (const w of new Set(contentWords(l.text))) n.set(w, (n.get(w) || 0) + 1);
  return [...n.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([w]) => w);
}
// the pieces of a take: one a line, with its category (yours wins over the rules), score and topics
export function build(lines, { goal = 'organic', cats = {} } = {}) {
  const L = lines || [], topics = topicsOf(L);
  const pieces = L.map((l, i) => { const ws = new Set(contentWords(l.text)), rule = categoryOf(l, i, L.length);
    return { id: l.id, n: l.n, start: l.start, end: l.end, seconds: l.seconds, text: l.text, hint: l.hint || null, why: l.why || null,
      category: CAT_IDS.includes(cats[l.id]) ? cats[l.id] : rule, rule, score: Math.round(sentenceScore({ text: l.text, start: l.start, end: l.end }, goal)), topics: topics.filter(w => ws.has(w)) }; });
  return { pieces, topics };
}
const REASON = {
  hook: p => `Strongest open${signals({ text: p.text, start: p.start, end: p.end }).question ? ': a question' : ''}. Score ${p.score}.`,
  story: () => 'Sets up the payoff.', tip: () => 'The actionable line.', proof: p => (/\d|doubled|tripled|percent/i.test(p.text) ? 'A number backs it.' : 'Someone else\'s words back it.'),
  list: () => 'Fast rhythm before the ask.', cta: () => 'Clear ask, ends the reel.',
};
// Let AI choose: a hook, the best middle up to the length you picked (in the take's order), then the CTA
export function choose(pieces, { min = 30, max = 60 } = {}) {
  const ok = pieces.filter(p => p.category !== 'aside' && p.category !== 'retake' && p.seconds >= 0.8);
  const best = cat => ok.filter(p => p.category === cat).sort((a, b) => b.score - a.score || a.start - b.start)[0] || null;
  const hook = best('hook') || ok.slice().sort((a, b) => a.start - b.start)[0] || null, cta = best('cta');
  const aim = Math.max(min, Math.min(max, (min + max) / 2)), used = new Set([hook, cta].filter(Boolean).map(p => p.id));
  let secs = [hook, cta].filter(Boolean).reduce((a, p) => a + p.seconds, 0);
  const mid = [];
  for (const p of ok.filter(x => !used.has(x.id) && ['story', 'tip', 'proof', 'list', 'hook'].includes(x.category)).sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (secs + p.seconds > max) continue; mid.push(p); secs += p.seconds; if (secs >= aim) break;
  }
  mid.sort((a, b) => a.start - b.start);
  const out = [hook, ...mid, cta].filter(Boolean);
  const reasons = Object.fromEntries(out.map(p => [p.id, p === hook ? REASON.hook(p) : p === cta ? REASON.cta(p) : p.category === 'hook' ? 'Keeps the open going.' : (REASON[p.category] || REASON.story)(p)]));
  return { ids: out.map(p => p.id), reasons, seconds: +secs.toFixed(2) };
}
// the Combo's pieces as ranges: neighbours in the take that sit next to each other in the Combo join into one range,
// so a line is never cut away from the one it runs into
export function comboRanges(ids, pieces) {
  const by = Object.fromEntries(pieces.map(p => [p.id, p])), out = [];
  for (const id of ids) { const p = by[id]; if (!p) continue; const last = out[out.length - 1];
    if (last && last.lastN + 1 === p.n) { last.ranges[0][1] = p.end; last.lastN = p.n; last.ids.push(p.id); last.text += ' ' + p.text; }
    else out.push({ id: p.id, ids: [p.id], lastN: p.n, ranges: [[p.start, p.end]], text: p.text, category: p.category }); }
  return out;
}
