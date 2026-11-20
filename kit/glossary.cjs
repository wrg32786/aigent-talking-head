// Glossary: words Whisper mishears, written your way in clips.json, captions and titles every time a draft is made.
//   [{ "say": "ChatGPT", "heard": ["chat GBT", "chat GPT"] },
//    { "say": "Skool", "heard": ["school"], "after": ["on", "in"] },        only after one of these words
//    { "say": "claude.ai", "heard": ["cloud.ai", "cloud .ai"], "keepCase": true }]
// Also accepted: { "ChatGPT": ["chat GBT"] } and the text form "chat GBT = ChatGPT; school = Skool after on, in".
// Matching ignores case and punctuation, so "cloud .ai", "Cloud.ai" and "cloud ai" are one spelling. A match across
// several words becomes one word that keeps the first word's start and the last word's end and punctuation.
// keepCase: the display face sets hero words and titles in capitals; a word with its own casing ("AIgent", "ChatGPT",
// "claude.ai") keeps it. On by default for words that are not plain lower case or Capitalised; "keepCase": false
// turns it off, true keeps every word of "say" as written.
// Sources, in order: kit/glossary.json (shipped, brand names any creator says), the pack or preset "glossary", Studio's
// word list (jobs/<job>/glossary.json) and --glossary <file or text> on npm run reel.
const fs = require('fs');
const path = require('path');

const tok = s => String(s || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);

function parseText(t) {
  const out = [];
  for (const part of String(t).split(/[;\n]/)) {
    const m = /^\s*(.+?)\s*(?:=|->|=>)\s*(.+?)(?:\s+after\s+(.+))?\s*$/i.exec(part);
    if (m) out.push({ say: m[2].trim(), heard: m[1].split('|').map(x => x.trim()).filter(Boolean), ...(m[3] ? { after: m[3].split(/[,\s]+/).filter(Boolean) } : {}) });
  }
  return out;
}
// any accepted form -> [{ say, heard: [..], after?: [..], keepCase? }]
function parse(x) {
  if (x == null || x === '') return [];
  if (typeof x === 'string') return parseText(x);
  if (Array.isArray(x)) return x.flatMap(e => typeof e === 'string' ? parseText(e) : e && e.say ? [{ say: String(e.say), heard: [].concat(e.heard || []).map(String).filter(Boolean), ...(e.after ? { after: [].concat(e.after).map(String) } : {}), ...(e.keepCase != null ? { keepCase: !!e.keepCase } : {}) }] : []);
  if (typeof x === 'object') return Object.entries(x).map(([say, heard]) => ({ say, heard: [].concat(heard).flatMap(h => String(h).split(/[,|]/)).map(h => h.trim()).filter(Boolean) }));
  return [];
}
function validate(x) {
  const errs = [];
  if (x == null) return errs;
  if (typeof x !== 'string' && typeof x !== 'object') return ['glossary: a list of { say, heard } entries'];
  if (Array.isArray(x)) x.forEach((e, i) => { if (typeof e === 'string') return; if (!e || typeof e.say !== 'string' || !e.say.trim()) errs.push(`glossary[${i}]: needs "say"`); else if (!e.heard || ![].concat(e.heard).length) errs.push(`glossary[${i}]: needs "heard" (what Whisper writes)`); });
  return errs;
}
// read a --glossary value: a .json file, a text file, or the text form itself
function read(v, base = process.cwd()) {
  if (!v) return [];
  const f = path.resolve(base, String(v));
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { const t = fs.readFileSync(f, 'utf8'); return parse(/\.json$/i.test(f) ? JSON.parse(t) : t); }
  return parse(String(v));
}
function shipped() { try { return parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'glossary.json'), 'utf8')).glossary); } catch { return []; } }
// several sources -> one list; a later "say" for the same heard spelling wins
function merge(...lists) {
  const by = new Map();
  for (const e of lists.flat().filter(Boolean)) for (const h of e.heard) by.set(tok(h).join(' ') + '|' + (e.after || []).join(','), { ...e, heard: [h] });
  return [...by.values()];
}

// words: [[start, end, word], ...] (clips.json, captions "words") -> { words, n, hits: [{ i, say }] }
function applyWords(words, entries) {
  if (!entries.length || !Array.isArray(words) || !words.length) return { words, n: 0, hits: [] };
  const pats = entries.flatMap(e => e.heard.map(h => ({ e, t: tok(h) }))).filter(p => p.t.length).sort((a, b) => b.t.length - a.t.length);
  const wt = words.map(w => tok(Array.isArray(w) ? w[2] : w));
  const out = [], hits = []; let n = 0;
  for (let i = 0; i < words.length;) {
    let done = false;
    for (const p of pats) {
      // match p.t against the tokens of words i, i+1, ... ending on a word boundary
      let k = i, ti = 0, ok = true;
      while (ti < p.t.length) {
        if (k >= words.length) { ok = false; break; }
        const ts = wt[k]; if (!ts.length) { ok = false; break; }
        for (const x of ts) { if (ti >= p.t.length || x !== p.t[ti]) { ok = false; break; } ti++; }
        if (!ok) break; k++;
      }
      if (!ok || ti !== p.t.length) continue;
      if (p.e.after && p.e.after.length) { const prev = i ? wt[i - 1][wt[i - 1].length - 1] : null; if (!prev || !p.e.after.map(a => a.toLowerCase()).includes(prev)) continue; }
      const first = words[i], last = words[k - 1], raw0 = String(Array.isArray(first) ? first[2] : first), rawN = String(Array.isArray(last) ? last[2] : last);
      const lead = (/^[^\p{L}\p{N}]+/u.exec(raw0) || [''])[0], trail = (/[.,;:!?…"”)]+$/u.exec(rawN) || [''])[0];
      const said = lead + p.e.say + trail;
      if (said === words.slice(i, k).map(w => String(Array.isArray(w) ? w[2] : w)).join(' ')) break; // already right
      out.push(Array.isArray(first) ? [first[0], last[1], said, ...first.slice(3)] : said);
      hits.push({ i: out.length - 1, from: i, to: k, say: p.e.say }); n++; i = k; done = true; break;
    }
    if (!done) { out.push(words[i]); i++; }
  }
  return { words: n ? out : words, n, hits };
}
function applyText(text, entries) {
  if (!entries.length || typeof text !== 'string' || !text.trim()) return text;
  const parts = text.split(/(\s+)/), ws = parts.filter((_, i) => i % 2 === 0);
  const r = applyWords(ws.filter(Boolean), entries);
  return r.n ? r.words.join(' ') : text;
}
// a caption or title flip: text and its word list (hero indices follow merged words)
function applyFlips(flips, entries) {
  let n = 0;
  for (const f of flips || []) {
    const before = JSON.stringify([f.text, f.words, f.hero]);
    if (Array.isArray(f.words) && f.words.length && Array.isArray(f.words[0])) {
      const r = applyWords(f.words, entries);
      if (r.n) {
        // old index -> new index, so hero words still point at the right word
        const map = []; let j = 0;
        for (let i = 0; i < f.words.length;) { const h = r.hits.find(x => x.from === i); if (h) { for (let q = h.from; q < h.to; q++) map[q] = h.i; i = h.to; j = h.i + 1; } else { map[i] = j++; i++; } }
        if (Array.isArray(f.hero)) f.hero = [...new Set(f.hero.map(h => map[h] ?? h))];
        f.words = r.words;
      }
    }
    if (typeof f.text === 'string') f.text = applyText(f.text, entries);
    if (JSON.stringify([f.text, f.words, f.hero]) !== before) n++;
  }
  return n;
}
// clips.json: every clip's words and text; returns how many clips changed
function applyClips(cj, entries) {
  let n = 0;
  for (const c of cj.clips || []) {
    const r = applyWords(c.words || [], entries);
    if (r.n) { c.words = r.words; c.text = r.words.map(w => w[2]).join(' '); n++; }
    else if (typeof c.text === 'string') { const t = applyText(c.text, entries); if (t !== c.text) { c.text = t; n++; } }
  }
  return n;
}
// words that keep their own casing when the display face sets capitals
function keepCase(entries) {
  const out = new Set();
  for (const e of entries) {
    if (e.keepCase === false) continue;
    for (const w of String(e.say).split(/\s+/).filter(Boolean)) if (e.keepCase === true || /\p{Ll}/u.test(w) && (/\p{Lu}/u.test(w.slice(1)) || /[.]/.test(w))) out.add(w);
  }
  return [...out];
}
function selfTest() {
  const errs = [], G = parse([{ say: 'AIgent Academy', heard: ['Agent Academy'] }, { say: 'Skool', heard: ['school'], after: ['on', 'in'] }, { say: 'claude.ai', heard: ['cloud.ai', 'cloud .ai'] }, { say: 'ChatGPT', heard: ['chat GBT'] }]);
  const t = applyText('Join the Agent Academy on school, not at school. Try cloud .ai and chat GBT.', G);
  if (t !== 'Join the AIgent Academy on Skool, not at school. Try claude.ai and ChatGPT.') errs.push('glossary text: ' + t);
  const w = applyWords([[0, 0.3, 'Agent'], [0.3, 0.8, 'Academy.']], G).words;
  if (JSON.stringify(w) !== JSON.stringify([[0, 0.8, 'AIgent Academy.']])) errs.push('glossary words: ' + JSON.stringify(w));
  const k = keepCase(G);
  if (!k.includes('AIgent') || !k.includes('ChatGPT') || !k.includes('claude.ai') || k.includes('Academy') || k.includes('Skool')) errs.push('glossary keepCase: ' + k);
  if (parseText('chat GBT = ChatGPT; school = Skool after on, in')[1].after.join() !== 'on,in') errs.push('glossary text form');
  return errs;
}
module.exports = { parse, parseText, validate, read, shipped, merge, applyWords, applyText, applyFlips, applyClips, keepCase, selfTest, tok };
