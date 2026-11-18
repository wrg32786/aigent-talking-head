// Auto-plan: read what you said (the job's transcript) and propose graphics for it, as a reel-graphics block in a
// Reel.md you review before rendering. Every proposed word is a word you say (kit/spoken.cjs), and the result passes
// npm run reelmd -- check.
//   npm run plan -- <job>                      -> writes or merges jobs/<job>/Reel.md
//   options: --out <Reel.md> (where to write; an existing file is merged: its graphics stay, proposals fill the gaps)
//            --base <Reel.md> (start a new plan from this recipe's brand, music and style; default the AIgent look)
//            --max <n> (at most n graphics; default one per 3 s of reel)  --dry (print, write nothing)
//            --fresh (propose again over lines an earlier plan wrote; lines you wrote, with no "why", always stay)
//            --cards / --no-cards (colour and chapter cards; default on when the recipe uses them)  --jobs <dir> (default jobs/)  --json (one JSON result line at the end)
// The job needs a transcript: run npm run reel -- inbox/<clip> --name <job> --draft first (or any reel run).
// What it proposes, from what you say:
//   a number (49 dollars, 40 percent, ten thousand readers) -> price-tag, stat-callout, or an odometer stat for big numbers
//   a list (first X, second Y, third Z; or "record, caption and post") -> checklist, rows ticking as you say them
//   "step two" -> step-counter          a quote ("she said ...", "quote ...") -> quote-card
//   "X versus Y", "X vs Y" -> versus    code or terminal talk (npm, git, a command, the terminal) -> terminal-session
//   "I'm <Name>" at the start -> lower-third        the end (follow, subscribe, link, try, join...) -> cta-card or cta-button
//   a short line to land -> a colour card; a counted list (first, second, number three...) -> numbered chapter cards and
//   a number-pop intro (kit/cards.cjs), written to a reel-cards block. On with --cards, or when the recipe uses cards
//   (the magazine preset, or "cards: auto" in its Style); --no-cards leaves them out
// Then: review the Graphics block (each line says why it was proposed), and make the reel with
//   npm run reel -- --recipe jobs/<job>/Reel.md --clips jobs/<job>/clips --name <job> --force
'use strict';
const fs = require('fs'), path = require('path');
const RM = require('./reelmd.cjs'), S = require('./spoken.cjs'), CARDS = require('./cards.cjs');
const KIT = __dirname, ROOT = path.dirname(KIT);

// ---------- transcript in reel time ----------
// the job's cut (when drafted) gives reel time; else the keep clips back to back, as npm run reel drafts them
function transcript(job) {
  const build = path.join(job, 'build'), cutF = path.join(build, 'cut.json'), clipsF = path.join(job, 'clips', 'clips.json');
  if (fs.existsSync(cutF)) {
    const cut = JSON.parse(fs.readFileSync(cutF, 'utf8'));
    const words = S.timeline(cut.segs, build), len = cut.segs.reduce((a, s) => a + (s.out - s.in) + (s.pad || 0), 0);
    if (words.length) return { words, len, from: 'build/cut.json' };
  }
  if (!fs.existsSync(clipsF)) return null;
  const clips = JSON.parse(fs.readFileSync(clipsF, 'utf8')).clips.filter(c => !/^retake/.test(c.status));
  const words = []; let off = 0;
  for (const c of clips) { for (const [a, b, w] of c.words || []) if (b <= c.dur + 0.05) words.push({ start: +(a + off).toFixed(3), end: +(Math.min(b, c.dur) + off).toFixed(3), word: String(w) }); off += c.dur; }
  return { words, len: off, from: 'clips/clips.json' };
}

// ---------- sentences ----------
function sentences(words) {
  const out = []; let cur = [];
  words.forEach((w, i) => { cur.push(w); const nx = words[i + 1]; if (/[.!?]["')]*$/.test(w.word) || !nx || nx.start - w.end > 0.8) { out.push(cur); cur = []; } });
  return out.map(ws => ({ ws, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map(w => w.word).join(' ') }));
}
const clean = w => String(w).replace(/^[^\p{L}\p{N}$@#]+|[^\p{L}\p{N}%+]+$/gu, '');
const lower = w => clean(w).toLowerCase().replace(/['’]/g, '');
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'it', 'that', 'this', 'we', 'you', 'i', 'so', 'just', 'then', 'now', 'our', 'your', 'my', 'its', 'are', 'be', 'was', 'at', 'by', 'as', 'up', 'do']);
const title = s => s.replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const NUMW = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'and']);
const ORDW = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const STEPN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const fmtNum = n => n >= 1000 ? n.toLocaleString('en-US') : String(n);

// a number said in this sentence: { i, j (word span), value, kind: money|percent|times|plain, unitWord }
function numberIn(s) {
  const ws = s.ws, L = ws.map(w => lower(w.word));
  for (let i = 0; i < ws.length; i++) {
    let raw = clean(ws[i].word), j = i, value = null;
    // Whisper sometimes splits a number at its thousands comma ("10" ",000")
    while (/^\d/.test(raw) && ws[j + 1] && /^,\d{3}\b/.test(ws[j + 1].word.trim())) { raw += ws[j + 1].word.trim(); j++; }
    if (/\d/.test(raw)) { const m = raw.replace(/,/g, '').match(/^\$?(\d+(?:\.\d+)?)([kKmM]?)(%|x|X|\+)?$/); if (!m) continue; value = +m[1] * (/k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1); }
    else if (NUMW.has(L[i]) && L[i] !== 'and' && L[i] !== 'one') { while (j + 1 < ws.length && NUMW.has(L[j + 1])) j++; const n = S.numberTokens(L.slice(i, j + 1)); if (!n.length) continue; value = +n[0]; }
    else continue;
    if (!(value >= 2)) continue;
    const after = L[j + 1] || '', after2 = L[j + 2] || '';
    const kind = /^\$/.test(raw) || /^(dollars?|bucks|usd)$/.test(after) ? 'money' : /%$/.test(raw) || /^(percent|per)$/.test(after) ? 'percent' : /x$/i.test(raw) || /^(times|x)$/.test(after) ? 'times' : 'plain';
    if (kind === 'plain' && value < 10) continue; // small counts read better as words in the caption
    let unit = kind === 'money' || kind === 'percent' || kind === 'times' ? (STOP.has(after2) ? '' : clean(ws[j + 2] ? ws[j + 2].word : '')) : (STOP.has(after) ? '' : clean(ws[j + 1] ? ws[j + 1].word : ''));
    if (/^(dollars?|percent|times)$/i.test(unit)) unit = '';
    return { i, j, value, kind, unit, raw };
  }
  return null;
}

// ---------- the rules ----------
function propose(T, opts = {}) {
  const ss = sentences(T.words), out = [], len = T.len;
  const add = g => { g.start = +Math.max(0.3, g.start).toFixed(2); g.end = +Math.min(len - 0.15, Math.max(g.end, g.start + 1.8), g.start + 5).toFixed(2); if (g.end - g.start >= 1.2) out.push(g); };
  const span = (s, a, b) => ({ start: s.ws[a].start - 0.15, end: Math.max(s.ws[Math.min(b, s.ws.length - 1)].end + 1.4, s.end + 0.4) });
 const usedS = new Set();
  // lower third: "I'm <Name>" / "my name is <Name>" in the first sentences
  for (const s of ss.slice(0, 2)) {
    const L = s.ws.map(w => lower(w.word)); let k = L.findIndex((w, i) => w === 'im' || (w === 'i' && L[i + 1] === 'am') || (w === 'is' && L[i - 1] === 'name'));
    if (k < 0) continue; if (L[k] === 'i') k++;
    const nm = []; for (let i = k + 1; i < s.ws.length && nm.length < 3 && /^\p{Lu}/u.test(clean(s.ws[i].word)); i++) nm.push(clean(s.ws[i].word));
    if (nm.length) { usedS.add(ss.indexOf(s)); add({ type: 'lower-third', pri: 2, text: nm.join(' '), ...span(s, k, k + nm.length), why: `you introduce yourself ("${s.ws.slice(k, k + nm.length + 1).map(w => clean(w.word)).join(' ')}")` }); break; }
  }
  // ordinal list across sentences: first X, second Y, third Z
  const ordHits = [];
  const upto = (ws, from) => { const o = []; for (let i = from; i < ws.length && o.length < 2; i++) { const w = clean(ws[i].word); if (ORDW.includes(w.toLowerCase())) break; if (w && !STOP.has(w.toLowerCase())) o.push(w); if (/[,.;:!?]$/.test(ws[i].word)) break; } return o; };
  ss.forEach((s, si) => s.ws.forEach((w, wi) => { const o = ORDW.indexOf(lower(w.word)); if (o >= 0) ordHits.push({ si, wi, o, s }); }));
  if (ordHits.length >= 2 && ordHits.some(h => h.o === 0) && ordHits.some(h => h.o === 1)) {
    const rows = [], seen = new Set();
    for (const h of ordHits) { if (seen.has(h.o)) continue; seen.add(h.o); const item = upto(h.s.ws, h.wi + 1); if (item.length) rows.push({ h, item: title(item.join(' ')) }); }
    if (rows.length >= 2) { const a = rows[0].h, z = rows[rows.length - 1].h; add({ type: 'checklist', pri: 3, items: rows.map(r => r.item), start: a.s.ws[a.wi].start - 0.3, end: Math.max(z.s.end + 1.2, a.s.ws[a.wi].start + 3), why: `you count through a list (${rows.map(r => ORDW[r.h.o]).join(', ')})` }); rows.forEach(r => usedS.add(r.h.si)); }
  }
  ss.forEach((s, si) => {
    if (usedS.has(si)) return;
    const L = s.ws.map(w => lower(w.word)), txt = L.join(' ');
    // step N
    const st = L.findIndex((w, i) => w === 'step' && (STEPN[L[i + 1]] || /^\d+$/.test(L[i + 1])));
    if (st >= 0 && new Set([...T.words.map(w => lower(w.word)).join(' ').matchAll(/\bstep (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/g)].map(m => m[1])).size >= 2) { const n = STEPN[L[st + 1]] || +L[st + 1]; const all = [...T.words.map(w => lower(w.word)).join(' ').matchAll(/\bstep (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/g)].map(m => STEPN[m[1]] || +m[1]);
      // the step's label as said, in sentence case: "Run the plan" (up to five words, to the first pause)
      const lab = []; for (let i = st + 2; i < s.ws.length && lab.length < 5; i++) { const w = clean(s.ws[i].word); if (w) lab.push(w); if (/[,.;:!?]$/.test(s.ws[i].word)) break; }
      while (lab.length && STOP.has(lab[lab.length - 1].toLowerCase())) lab.pop();
      add({ type: 'step-counter', pri: 3, step: n, of: Math.max(n, ...all), ...(lab.length ? { text: lab.join(' ').replace(/^./, c => c.toUpperCase()) } : {}), ...span(s, st, st + 3), why: `you say "step ${L[st + 1]}"` }); return; }
    // code or terminal talk
    const ck = L.findIndex(w => /^(npm|npx|pip|git|brew|terminal|command|bash|cli|install|curl|node|python)$/.test(w));
    if (ck >= 0) { const cmd = []; for (let i = ck; i < s.ws.length && cmd.length < 5; i++) { const w = clean(s.ws[i].word); if (i > ck && STOP.has(w.toLowerCase())) break; if (w) cmd.push(w); if (/[,.;:!?]$/.test(s.ws[i].word)) break; } const run = /^(npm|npx|pip|git|brew|curl|node|python)$/.test(L[ck]) ? cmd.join(' ').toLowerCase() : null;
      if (run) { add({ type: 'terminal-session', pri: 2, text: `$ ${run}`, title: 'terminal', ...span(s, ck, ck + 4), why: `you talk through a command ("${cmd.join(' ')}")` }); return; } }
    // versus
    const vs = L.findIndex(w => w === 'vs' || w === 'versus');
    if (vs > 0 && vs < L.length - 1) { const l = clean(s.ws[vs - 1].word), r = clean(s.ws[vs + 1].word); if (l && r) { add({ type: 'versus', pri: 2, left: title(l), right: title(r), ...span(s, vs - 1, vs + 1), why: `you compare "${l} vs ${r}"` }); return; } }
    // quote
    const q = L.findIndex((w, i) => /^(said|says|quote|told)$/.test(w));
    if (q >= 0 && s.ws.length - q > 4) { const body = s.ws.slice(q + (L[q] === 'told' ? 2 : 1)).map(w => clean(w.word)).filter(Boolean).slice(0, 12); const who = q > 0 && /^\p{Lu}/u.test(clean(s.ws[q - 1].word)) && !/^(I|He|She|They|We|You)$/.test(clean(s.ws[q - 1].word)) ? clean(s.ws[q - 1].word) : null;
      if (body.length >= 4) { add({ type: 'quote-card', pri: 2, text: body.join(' ').replace(/^./, c => c.toUpperCase()), ...(who ? { sub: who } : {}), ...span(s, q, s.ws.length), why: `a quote ("${L.slice(q, q + 4).join(' ')} ...")` }); return; } }
    // a number
    const n = numberIn(s);
    if (n) {
      const shown = n.kind === 'money' ? `$${fmtNum(n.value)}` : n.kind === 'percent' ? `${fmtNum(n.value)}%` : n.kind === 'times' ? `${fmtNum(n.value)}x` : fmtNum(n.value);
      const said = s.ws.slice(n.i, n.j + 2).map(w => w.word.trim()).join(' ').replace(/ ,/g, ',').replace(/[.!?]$/, '');
      if (n.kind === 'money') add({ type: 'price-tag', pri: 3, text: shown, ...(n.unit ? { sub: n.unit.toLowerCase() } : {}), ...span(s, n.i, n.j + 2), why: `a price ("${said}")` });
      else add({ type: 'stat-callout', pri: 3, text: shown, ...(n.unit ? { sub: n.unit.toLowerCase() } : {}), ...(n.value >= 1000 ? { style: 'odometer' } : {}), ...span(s, n.i, n.j + 2), why: `a number ("${said}")` });
      return;
    }
    // a spoken list: three or more short items separated by commas, ending "and Z"
    const parts = s.text.split(/,\s*|\s+and\s+/i).map(p => p.trim()).filter(Boolean);
    const tail = parts.slice(-Math.min(5, parts.length)), short = tail.every(p => p.split(/\s+/).length <= 3);
    if (/,/.test(s.text) && parts.length >= 3 && short) { const items = tail.map(p => p.split(/\s+/).map(clean).filter(w => w && !STOP.has(w.toLowerCase())).slice(-2).join(' ')).filter(Boolean);
      if (items.length >= 3 && items.every(x => x.split(' ').length <= 2)) { add({ type: 'checklist', pri: 1, items: items.map(title), start: s.start - 0.2, end: s.end + 1.5, why: `a list ("${s.text.slice(0, 60)}")` }); return; } }
  });
  // the end: a call to action in the last sentences
  const CTA = /^(follow|subscribe|comment|join|try|download|visit|grab|check|sign|book|dm|message|share|save|click|tap|get|star|install)$/;
  for (const s of ss.slice(-2).reverse()) {
    const L = s.ws.map(w => lower(w.word)), k = L.findIndex(w => CTA.test(w));
    if (k < 0) continue;
    const head = s.ws.slice(k, k + 4).map(w => clean(w.word)).filter(Boolean); while (head.length > 1 && STOP.has(head[head.length - 1].toLowerCase())) head.pop();
    const rest = s.ws.slice(k + head.length).map(w => clean(w.word)).filter(Boolean).slice(0, 6);
    const cap1 = x => x.replace(/^./, c => c.toUpperCase());
    const g = rest.length >= 2 ? { type: 'cta-card', text: cap1(head.join(' ')), sub: rest.join(' ') } : { type: 'cta-button', text: cap1(head.join(' ')) };
    add({ ...g, pri: 9, start: s.ws[k].start - 0.2, end: len - 0.15, why: `your call to action ("${head.join(' ')}")` });
    break;
  }
  // no two graphics on screen at once; at most one per 3 s (or --max), the earliest kept, then the end card
  out.sort((a, b) => a.start - b.start);
  const keep = [];
  // two proposals that would share the screen: the more telling one stays (the call to action always does)
  // when the earlier one can end early and still stay up 1.8 s, it does, and both stay
  // (back-to-back steps hand over faster: the counter only needs 1.2 s and a 0.15 s gap)
  for (const g of out) { const p = keep[keep.length - 1]; const steps = p && p.type === 'step-counter' && g.type === 'step-counter', gap = steps ? 0.15 : 0.4, hold = steps ? 1.2 : 1.8;
    if (p && g.start < p.end + gap) { if (p.pri < 9 && g.start - gap - p.start >= hold) p.end = +(g.start - gap).toFixed(2); else if (g.pri > p.pri) keep.pop(); else continue; } keep.push(g); }
  const max = opts.max || Math.max(2, Math.round(len / 3));
  // over the cap: the least telling proposal goes first (a plain comma list, then quotes and commands, then numbers and steps)
  while (keep.length > max) { let i = -1; keep.forEach((g, k) => { if (i < 0 || g.pri < keep[i].pri || (g.pri === keep[i].pri && k > i)) i = k; }); if (keep[i].pri >= 9) break; keep.splice(i, 1); }
  keep.forEach(g => delete g.pri);
  return keep;
}

// ---------- Reel.md ----------
const FIELDS = ['type', 'text', 'sub', 'left', 'right', 'items', 'step', 'of', 'count', 'style', 'title', 'why'];
const lineOf = (g, n) => [`#${String(n).padStart(2, '0')} ${+g.start.toFixed(2)}-${+g.end.toFixed(2)}`, ...FIELDS.filter(k => g[k] != null && g[k] !== '').map(k => `${k} ${Array.isArray(g[k]) ? g[k].join('; ') : String(g[k]).replace(/\|/g, '/')}`)].join(' | ');
function newRecipe(job, T, base) {
  const name = path.basename(job).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';
  if (base) {
    const r = fs.readFileSync(base, 'utf8');
    return r.replace(/^name: .*$/m, `name: ${name}`).replace(/^shots: .*$/m, 'shots: 0').replace(/^  duration: .*$/m, `  duration: ${+T.len.toFixed(2)}`)
      .replace(/^## Shots[\s\S]*?(?=^## )/m, '').replace(/^## Titles[\s\S]*?(?=^## |(?![\s\S]))/m, '').replace(/^## Graphics[\s\S]*?(?=^## |(?![\s\S]))/m, '');
  }
  return `---\nvideomd: 1\nname: ${name}\ndescription: Planned from what you say by npm run plan. Review the Graphics block, then render.\nsource:\n  file: clips\n  duration: ${+T.len.toFixed(2)}\nshots: 0\nlang: en\ngenerator:\n  name: aigent-talking-head\nx-reel: 1\n---\n\n# ${name}\n\nKinetic captions and titles in the AIgent look, with graphics proposed from your words.\n\n## Brand kit\n- preset: aigent\n\n## Style\n- look: kinetic\n- titles: on\n- title-layer: front\n\n## Aliases\n\n`;
}
function withCards(md, lines) {
  const block = '## Cards\n\n```' + RM.CARDS_BLOCK + '\n' + lines.join('\n') + '\n```\n';
  const re = new RegExp('^## Cards[\\s\\S]*?^```' + RM.CARDS_BLOCK + '[\\s\\S]*?^```[ \\t]*\\n?', 'm');
  if (re.test(md)) return md.replace(re, block);
  return md.replace(/\s*$/, '\n\n') + block;
}
function withGraphics(md, lines) {
  const block = '## Graphics\n\n```reel-graphics\n' + lines.join('\n') + '\n```\n';
  if (/^## Graphics[\s\S]*?^```reel-graphics[\s\S]*?^```\s*$/m.test(md)) return md.replace(/^## Graphics[\s\S]*?^```reel-graphics[\s\S]*?^```[ \t]*\n?/m, block);
  return md.replace(/\s*$/, '\n\n') + block;
}

function plan(job, opts = {}) {
  const T = transcript(job);
  if (!T || !T.words.length) throw new Error(`No transcript in ${job}. Draft the reel first: npm run reel -- inbox/<clip> --name ${path.basename(job)} --draft`);
  const out = path.resolve(opts.out || path.join(job, 'Reel.md'));
  const existing = fs.existsSync(out) ? RM.load(out) : null;
  if (existing) { const v = RM.validate(existing); if (v.errs.length) throw new Error(`${out}: fix it first:\n- ${v.errs.join('\n- ')}`); }
  S.setAliases(existing ? existing.aliases : {});
  // propose, then run the same spoken gate the render runs: whatever you do not say is dropped here, not at render time
  let props = propose(T, opts);
  // cards (kit/cards.cjs): colour cards on short lines to land, chapter cards and the number-pop intro on a counted list
  // on when asked (--cards), or when the recipe uses them (the magazine preset, or "cards: auto" in its Style)
  const baseR = existing || (opts.base ? RM.load(opts.base) : null), bp = baseR ? RM.toPreset(baseR) : {};
  const cardsOn = opts.cards === true || (opts.cards !== false && bp.cards === 'auto');
  const pc = cardsOn ? CARDS.proposeCards(T.words, { len: T.len, palette: bp.cardPalette }) : { cards: [], numberPop: null, chapters: [] };
  // a counted list becomes chapter cards, so the checklist over the same list steps aside
  if (pc.cards.some(c => c.chapter != null)) props = props.filter(g => !(g.type === 'checklist' && /count through a list/.test(g.why || '')));
  if (pc.numberPop && !props.some(g => g.start < pc.numberPop.end && pc.numberPop.start < g.end)) props.push({ type: 'number-pop', ...pc.numberPop });
  // the recipe's aliases also work backwards here: a brand heard as a common word ("agent") is written as you mean it ("aigent")
  const back = new Map(); for (const [w, hs] of Object.entries((existing && existing.aliases) || opts.aliases || {})) for (const h of [].concat(hs)) back.set(S.tokens(h).join(' '), w);
  if (back.size) for (const g of props) for (const k of ['text', 'sub', 'left', 'right', 'items']) { if (g[k] == null) continue;
    const fix = v => { let o = ' ' + String(v) + ' '; for (const [h, w] of back) o = o.replace(new RegExp(`(^|[^\\p{L}])${h.replace(/ /g, '\\s+')}(?=[^\\p{L}]|$)`, 'giu'), (m, a) => a + (/^\p{Lu}/u.test(m.trim()) ? w.replace(/^./, c => c.toUpperCase()) : w)); return o.trim(); };
    g[k] = Array.isArray(g[k]) ? g[k].map(fix) : fix(g[k]); }
  const flipsOf = gs => RM.graphicFlips({ file: out, graphics: gs.map((g, i) => RM.parseLine(lineOf(g, i + 1), 'plan')) });
  const au = S.audit(flipsOf(props), T.words);
  const fuzzy = S.fuzzyLog(true);
  const keptStarts = new Set(au.flips.map(f => f.start));
  const dropped = props.filter(g => !keptStarts.has(+g.start.toFixed(3))).map(g => ({ type: g.type, at: g.start, why: (au.dropped.find(d => d.g.start === g.start && !d.kept) || {}).why || 'not said' }));
  props = props.filter(g => keptStarts.has(+g.start.toFixed(3)));
  for (const d of au.dropped.filter(d => d.kept)) { const g = props.find(p => p.start === d.g.start); if (g && d.field) delete g[d.field]; }
  // merge: your own graphics stay; a proposal that would share the screen with one of them is left out
  // --fresh: the lines an earlier plan wrote (they carry "why") are proposed again; lines you wrote always stay
  const mine = existing ? existing.graphics.map(g => ({ ...g, type: g.type || g['type~'] })).filter(g => !(opts.fresh && g.why)) : [];
  const free = props.filter(p => !mine.some(m => p.start < +m.end && +m.start < p.end));
  const lines = [...mine.map(m => ({ m })), ...free.map(g => ({ g }))].sort((a, b) => (a.m ? +a.m.start : a.g.start) - (b.m ? +b.m.start : b.g.start))
    .map((x, i) => x.m ? existingLine(x.m, i + 1) : lineOf(x.g, i + 1));
  let md = withGraphics(existing ? fs.readFileSync(out, 'utf8') : newRecipe(job, T, opts.base), lines);
  // your own cards stay; else the proposed ones that do not share the screen with a graphic
  const busy = [...mine, ...free].map(g => [+g.start, +g.end]);
  const cards = existing && existing.cards && existing.cards.length ? [] : pc.cards.filter(c => !busy.some(([a, b]) => c.start < b && a < c.end));
  if (cards.length) md = withCards(md, cards.map((c, i) => CARDS.cardLine(c, i + 1)));
  const r = RM.parse(md, out), v = RM.validate(r);
  if (v.errs.length) throw new Error('the planned Reel.md does not pass the check:\n- ' + v.errs.join('\n- '));
  if (!opts.dry) fs.writeFileSync(out, md);
  return { out, from: T.from, seconds: +T.len.toFixed(2), proposed: free, cards, kept: mine.length, skippedForYours: props.length - free.length, dropped, fuzzy, md, warn: v.warn };
}
// an existing graphics line, written back as it was parsed
function existingLine(g, n) {
  const keys = Object.keys(g).filter(k => !['n', 'start', 'end'].includes(k));
  return [`#${String(n).padStart(2, '0')} ${g.start}-${g.end}`, ...keys.map(k => (g[k] === true ? k : `${k} ${g[k]}`))].join(' | ');
}

module.exports = { plan, propose, transcript, sentences };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = k => argv.includes('--' + k);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const VALUED = new Set(['out', 'base', 'max', 'jobs']);
  const JSON_OUT = flag('json');
  const name = argv.find((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
  const die = m => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: m })); console.error(m); process.exit(1); };
  if (!name) die('Usage: npm run plan -- <job> [--out Reel.md] [--base Reel.md] [--max n] [--dry] [--json]');
  let job = path.resolve(opt('jobs', path.join(ROOT, 'jobs')), name);
  if (!fs.existsSync(job) && fs.existsSync(path.resolve(name))) job = path.resolve(name);
  if (!fs.existsSync(job)) die('No job at ' + job + '. Draft one first: npm run reel -- inbox/<clip> --name ' + name + ' --draft');
  const base = opt('base') ? path.resolve(opt('base')) : null;
  if (base && !fs.existsSync(base)) die('No recipe at ' + base);
  try {
    const r = plan(job, { out: opt('out'), base, max: opt('max') ? +opt('max') : undefined, dry: flag('dry'), fresh: flag('fresh'), cards: flag('no-cards') ? false : flag('cards') ? true : undefined });
    if (flag('dry')) console.log(r.md);
    console.log(`plan: ${r.proposed.length} graphic${r.proposed.length === 1 ? '' : 's'} proposed from ${r.seconds} s of what you say (${r.from})${r.kept ? `, ${r.kept} of yours kept` : ''}${r.skippedForYours ? `, ${r.skippedForYours} left out where yours already are` : ''}`);
    for (const c of r.cards) console.log(`  ${c.start}-${c.end}s card ${c.bg}${c.chapter != null ? ' chapter ' + c.chapter : ''}  (${c.why})`);
    for (const g of r.proposed) console.log(`  ${g.start}-${g.end}s ${g.type}${g.text ? ': ' + g.text : ''}${g.items ? ': ' + g.items.join(' / ') : ''}  (${g.why})`);
    for (const d of r.dropped) console.log(`  left out ${d.type} at ${d.at}s: ${d.why}`);
    for (const z of r.fuzzy) console.log(`  spoken match: "${z.want}" counted as said (heard "${z.heard}", ${z.how})`);
    r.warn.forEach(w => console.log('  note: ' + w));
    const rel = path.relative(process.cwd(), r.out) || r.out;
    console.log(flag('dry') ? 'PLAN OK (dry run, nothing written)' : `PLAN OK  ${rel}\nReview the Graphics block (edit or delete lines), then: npm run reel -- --recipe ${rel} --clips ${path.relative(process.cwd(), path.join(job, 'clips'))} --name ${path.basename(job)} --force`);
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, recipe: r.out, seconds: r.seconds, proposed: r.proposed, kept: r.kept, dropped: r.dropped, fuzzy: r.fuzzy, next: `npm run reel -- --recipe ${r.out} --clips ${path.join(job, 'clips')} --name ${path.basename(job)} --force --json` }));
  } catch (e) { die(e.message); }
}
