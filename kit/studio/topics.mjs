// Topics on the Cut step: 3 to 5 themes a take keeps coming back to, each a short phrase ("starting with ChatGPT",
// "building with AI"), to filter the lines by subject. A model or your agent names them when one is connected
// (topicsPrompt and readTopics here, asked by kit/studio/server.mjs); this file is the local way, with no model:
//   1. every line becomes words; stop words, fillers and contractions never start, end or make a theme
//   2. candidates are phrases of 2 to 4 words that start and end on a content word (small joining words may sit inside)
//   3. a phrase said in 2 or more lines is a theme; so is a subject word said in 2 or more lines, named by the best
//      phrase around it
//   4. themes spread across the take rank higher, and near duplicates merge (same words, or the same lines)
// Nothing good (fewer than 2 themes) returns none, and the page hides the row.
import { tokens, JOIN } from './words.mjs';

const MAX_WORDS = 4;
const label = toks => toks.map((t, k) => (/[A-Z]/.test(t.raw.slice(1)) || /^[A-Z0-9]+$/.test(t.raw) || (t.cap && !t.first) ? t.raw : t.raw.toLowerCase())).join(' ');

// the phrases of one line: [{ key (content stems), stems, text }]
function phrasesOf(text) {
  const out = [];
  for (const part of String(text || '').split(/[,.;:!?()"“”]+/)) {
    const T = tokens(part).map((t, k) => ({ ...t, first: k === 0, cap: /^[A-Z]/.test(t.raw) }));
    for (let i = 0; i < T.length; i++) {
      if (T[i].stop) continue;
      for (let j = i + 1; j < Math.min(T.length, i + MAX_WORDS); j++) {
        const inner = T.slice(i + 1, j); if (inner.some(t => t.stop && !JOIN.has(t.w))) break;
        if (T[j].stop) continue;
        const span = T.slice(i, j + 1), stems = span.filter(t => !t.stop).map(t => t.stem);
        if (inner.filter(t => t.stop).length > 2 || new Set(stems).size < stems.length) continue;
        out.push({ key: stems.join(' '), stems, text: label(span) });
      }
    }
  }
  return out;
}

// lines: [{ id, n, text }] -> [{ label, lines: [ids], stems }], the best first
export function themesOf(lines, { max = 5, min = 2 } = {}) {
  const L = (lines || []).filter(l => l && l.text), N = L.length; if (N < 3) return [];
  const stemLines = new Map(), phr = new Map();
  L.forEach((l, k) => {
    for (const t of tokens(l.text)) if (!t.stop) { if (!stemLines.has(t.stem)) stemLines.set(t.stem, new Set()); stemLines.get(t.stem).add(k); }
    for (const p of phrasesOf(l.text)) {
      const e = phr.get(p.key) || { key: p.key, stems: p.stems, lines: new Set(), texts: new Map() };
      e.lines.add(k); e.texts.set(p.text, (e.texts.get(p.text) || 0) + 1); phr.set(p.key, e);
    }
  });
  const df = s => (stemLines.get(s) || new Set()).size;
  const spread = set => { const a = [...set]; return a.length < 2 ? 0 : (Math.max(...a) - Math.min(...a)) / Math.max(1, N - 1); };
  const best = e => [...e.texts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  const cands = [];
  // a phrase said in two or more lines
  for (const e of phr.values()) if (e.lines.size >= min) cands.push({ label: best(e), stems: e.stems, lines: e.lines, score: e.lines.size * (1 + e.stems.length) + 2 * spread(e.lines) + 1 });
  // a subject said in two or more lines, named by the strongest phrase around it
  for (const [s, set] of stemLines) {
    if (set.size < min || s.length < 2 || /^\d+$/.test(s)) continue;
    let top = null;
    for (const e of phr.values()) { if (!e.stems.includes(s)) continue; const v = e.stems.reduce((a, x) => a + df(x), 0) + e.lines.size * 2 - e.stems.length * 0.01; if (!top || v > top.v) top = { e, v }; }
    if (!top) continue;
    cands.push({ label: best(top.e), stems: top.e.stems, lines: set, anchor: s, score: set.size * 1.5 + 2 * spread(set) });
  }
  cands.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const out = [];
  for (const c of cands) {
    const dup = out.some(o => {
      const shared = c.stems.filter(x => o.stems.includes(x)).length, both = [...c.lines].filter(x => o.lines.has(x)).length;
      return shared >= Math.min(c.stems.length, o.stems.length) || (c.anchor && o.stems.includes(c.anchor)) || (o.anchor && c.stems.includes(o.anchor)) || both / Math.min(c.lines.size, o.lines.size) >= 0.75 || o.label.toLowerCase() === c.label.toLowerCase();
    });
    if (dup) continue;
    out.push(c); if (out.length >= max) break;
  }
  if (out.length < 2) return [];
  return out.map(c => ({ label: c.label, lines: [...c.lines].sort((a, b) => a - b).map(k => L[k].id), stems: c.stems }));
}

// ---------- a model or your agent names the themes ----------
export function topicsPrompt(lines, point) {
  return ['Name the 3 to 5 themes this talking-head take keeps coming back to, so the user can filter its lines by subject.',
    'Each theme is a short phrase of 2 to 4 plain words in the speaker\'s own terms, such as "starting with ChatGPT" or "building with AI". Lower case, except names. No single words, no filler, no em dashes.',
    point ? `The point of the video, in the user's words: "${point}".` : '',
    'List the line numbers that belong to each theme (a line can be in more than one, or in none). Reply with JSON only: {"topics":[{"label":"...","lines":[1,4,7]}]}.',
    'Lines: ' + JSON.stringify((lines || []).map(l => [l.n, l.text]))].filter(Boolean).join('\n');
}
// check a reply (a model's text, or the list an agent sent): 2 to 5 words, real lines, no doubles; null when nothing holds
export function readTopics(reply, lines) {
  let j = reply;
  if (typeof reply === 'string') { try { j = JSON.parse(reply.match(/\{[\s\S]*\}/)[0]); } catch { return null; } }
  const list = Array.isArray(j) ? j : j && Array.isArray(j.topics) ? j.topics : null; if (!list) return null;
  const byN = new Map((lines || []).map(l => [l.n, l.id])), ids = new Set((lines || []).map(l => l.id)), seen = new Set(), out = [];
  for (const t of list) {
    if (!t || typeof t.label !== 'string') continue;
    const lab = t.label.replace(/—/g, ', ').replace(/["\s]+/g, ' ').trim().slice(0, 48), n = lab.split(' ').length;
    if (n < 2 || n > 5 || seen.has(lab.toLowerCase())) continue;
    const ls = [...new Set((Array.isArray(t.lines) ? t.lines : []).map(x => (typeof x === 'number' || /^\d+$/.test(String(x)) ? byN.get(+x) : String(x))).filter(x => ids.has(x)))];
    if (!ls.length) continue;
    seen.add(lab.toLowerCase()); out.push({ label: lab, lines: ls }); if (out.length >= 5) break;
  }
  return out.length >= 2 ? out : null;
}
