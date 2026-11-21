// B-roll slots: the one list of where B-roll goes in an edit, what it should show and how it is treated.
//
// A reference's B-roll is read by the teardown into the Reel.md "## B-roll" block (reel-broll), one line per slot:
//   #01 3.33-15.92 | kind panel | y 0.68 | w 0.62 | h 0.21 | border #d87b5b | layer front | shows OmniRoute |
//       shot screen recording | motion push | zoom 1.22 | shake off | glitch off | colour none | in pop | out slide-up
// kind: full (it covers the frame), panel (a framed window over the speaker), split (it takes the top, the speaker the
// bottom) or pip (a small box). The effects are measured from the picture by kit/broll_fx.py.
//
// A draft from a recipe carries them into build/plan.json "broll" on your edit's clock:
//   { n, start, end, kind, layer, y, w, h, border, fx: { motion, zoom, shake, glitch, colour, in, out }, what, shot,
//     line (your words under it), ref: { n, start, end }, state: needs | filled | skipped, file (when filled) }
// Recreate: the reference's moments mapped to your timeline, starting and ending on your words.
// Copy the look: the same number a minute, the same kinds and lengths, landed on your lines that fit.
// A slot with no clip stays in the plan. kit/reel.cjs draws a calm card where a panel will sit; Studio's B-roll step
// shows "Needs B-roll" for it (kit/studio/broll-api.mjs) and its render leaves you on screen there.
'use strict';

const KINDS = ['full', 'panel', 'split', 'pip'];
const MOTIONS = ['push', 'pull', 'drift', 'still'];
const COLOURS = ['none', 'bw', 'muted', 'vivid', 'warm', 'cool'];
const EDGES = ['cut', 'fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'flash', 'zoom', 'glitch'];
const BLOCK = 'reel-broll';
const r2 = x => +(+x).toFixed(2), r3 = x => +(+x).toFixed(3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const on = v => v === true || /^(on|yes|true|1)$/i.test(String(v == null ? '' : v));
const hexOK = h => /^#[0-9a-f]{6}$/i.test(String(h || ''));
const pick = (v, list, d) => (list.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : d);
const median = a => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };

// what a card showed, from the text read in it: a name a person would say, never a line of misread text
function cleanWhat(t) {
  const s = String(t || '').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 60) return null;
  const letters = s.replace(/[^A-Za-z]/g, '').length;
  if (letters / s.length < 0.7 || !/[A-Za-z]{4}/.test(s) || /[\\/_*<>{}=]|\.\w{2,4}$/.test(s)) return null;
  return s;
}
const fxOf = (m = {}) => ({ motion: pick(m.motion, MOTIONS, 'still'), zoom: Number.isFinite(+m.zoom) && +m.zoom > 0 ? r2(clamp(+m.zoom, 0.7, 1.5)) : 1, shake: on(m.shake), glitch: on(m.glitch),
  colour: pick(m.colour || m.color, COLOURS, 'none'), in: pick(m.in, EDGES, 'cut'), out: pick(m.out, EDGES, 'cut') });

// the kind of a slot from where it sits on the frame (box: [x, y, w, h] in fractions), null box: it covers the frame
function kindOf(box) {
  if (!box) return 'full';
  const [x, y, w, h] = box.map(Number);
  if (w >= 0.9 && h >= 0.9) return 'full';
  if (w >= 0.9 && y <= 0.06 && h >= 0.3 && h <= 0.7) return 'split';
  if (w <= 0.45 && h <= 0.3 && (x <= 0.1 || x + w >= 0.9) && (y <= 0.2 || y + h >= 0.8)) return 'pip';
  return 'panel';
}

// ---------- teardown: the reference's slots ----------
// cands: what the teardown found, on the reference's clock:
//   { start, end, box?, border?, shows?, shot?, source? }   (a screen card, a split span, a shot with no speaker)
// measured: kit/broll_fx.py measure, by the same order (its "at" refines start and end)
// faces: per reference shot { start, end, eyeY, faceH } (to tell a panel the head reaches into)
// Panels that touch or overlap in the same place are one slot: a detector that lost a panel for a moment, or a panel
// whose content changes, is still one B-roll.
function detect(cands, measured = [], { faces = [], script = [] } = {}) {
  let out = cands.map((c, i) => {
    const m = measured[i] || {}, at = Array.isArray(m.at) && m.at.length === 2 && m.at[1] > m.at[0] ? m.at : [c.start, c.end];
    const box = Array.isArray(c.box) && c.box.length === 4 ? c.box.map(Number) : null, kind = KINDS.includes(c.kind) ? c.kind : kindOf(box);
    return { start: r2(at[0]), end: r2(at[1]), kind, box: kind === 'full' ? null : box, border: hexOK(c.border) ? c.border.toLowerCase() : null, shows: [cleanWhat(c.shows)].filter(Boolean), shot: c.shot || null, source: c.source || null, fx: fxOf(m) };
  }).filter(s => s.end - s.start >= 0.4).sort((a, b) => a.start - b.start);
  const same = (a, b) => a.kind === b.kind && (!a.box || !b.box || a.box.every((v, k) => Math.abs(v - b.box[k]) < 0.06));
  const merged = [];
  for (const s of out) {
    const p = merged[merged.length - 1];
    if (p && s.start <= p.end + 0.3 && same(p, s)) {
      // the longer part says how it moves; it arrives like the first and leaves like the last
      const longer = (s.end - s.start) > (p.end - p.start) ? s : p;
      Object.assign(p, { end: Math.max(p.end, s.end), shows: [...new Set([...p.shows, ...s.shows])], source: p.source || s.source, border: p.border || s.border,
        fx: { ...longer.fx, shake: p.fx.shake || s.fx.shake, glitch: p.fx.glitch || s.fx.glitch, in: p.fx.in, out: s.end >= p.end ? s.fx.out : p.fx.out } });
    } else merged.push(s);
  }
  return merged.map((s, i) => {
    // a panel the head reaches into sits behind it (a reference never covers its speaker's face)
    const f = faces.find(x => s.start < x.end && s.end > x.start && x.eyeY != null && x.faceH);
    const layer = s.box && f && s.box[1] < f.eyeY + 0.55 * f.faceH && s.kind !== 'full' ? 'behind' : 'front';
    const says = script.filter(l => l.end > s.start + 0.2 && l.start < s.end - 0.2).map(l => String(l.say || l.text || '')).join(' ').replace(/\s+/g, ' ').trim();
    return { n: i + 1, start: s.start, end: s.end, kind: s.kind, layer, ...(s.box ? { y: r3(s.box[1] + s.box[3] / 2), w: r3(s.box[2]), h: r3(s.box[3]) } : {}), ...(s.border ? { border: s.border } : {}),
      ...(s.shows.length ? { shows: s.shows.slice(0, 3).join(', ') } : {}), ...(s.shot ? { shot: s.shot } : {}), ...(s.source ? { source: s.source } : {}), fx: s.fx, ...(says ? { says: says.slice(0, 160) } : {}) };
  });
}

// the Reel.md block for the slots (kit/teardown.mjs writes it; kit/reelmd.cjs reads it back as recipe.broll)
function blockLines(slots) {
  const one = v => String(v).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return slots.map((s, i) => {
    const f = [`#${String(i + 1).padStart(2, '0')} ${s.start}-${s.end}`, `kind ${s.kind}`, `layer ${s.layer || 'front'}`];
    for (const k of ['y', 'w', 'h']) if (s[k] != null) f.push(`${k} ${s[k]}`);
    if (s.border) f.push(`border ${s.border}`);
    if (s.shows) f.push(`shows~ ${one(s.shows)}`);
    if (s.shot) f.push(`shot ${one(s.shot)}`);
    if (s.source) f.push(`source~ ${one(s.source)}`);
    const x = s.fx || fxOf();
    f.push(`motion ${x.motion}`, `zoom ${x.zoom}`, `shake ${x.shake ? 'on' : 'off'}`, `glitch ${x.glitch ? 'on' : 'off'}`, `colour ${x.colour}`, `in ${x.in}`, `out ${x.out}`);
    if (s.says) f.push(`says~ ${one(s.says)}`);
    return f.join(' | ');
  });
}
const BLOCK_NOTE = 'Where the reference shows B-roll, what it showed and how it is treated: `kind` is full (it covers the frame), panel (a framed window over the speaker), split or pip. A remake keeps a slot at each of these moments. Give a slot your own clip with `src <file>` (a path next to this file), or fill it on the B-roll step in Studio; a slot with no clip stays in the plan as "needs B-roll".';
function appendBlock(md, slots) {
  const body = String(md).replace(/\n## B-roll\n[\s\S]*?\n```\n(?=\n|$)/, '\n');
  if (!slots.length) return body;
  const sec = ['## B-roll', '', BLOCK_NOTE, '', '```' + BLOCK, ...blockLines(slots), '```', ''].join('\n');
  // before the script when there is one, so the recipe reads shots, titles, graphics, b-roll, sounds, script
  const at = body.search(/^## (Sound effects|Script)\b/m);
  return at >= 0 ? body.slice(0, at) + sec + '\n' + body.slice(at) : body.replace(/\n*$/, '\n\n') + sec;
}

// The reference's slots from a parsed recipe (kit/reelmd.cjs parse). The B-roll block when the teardown wrote one;
// else (a recipe written by hand, or an older teardown) its screen cards and the shots marked as cutaways.
function fromRecipe(recipe) {
  const v = (g, k) => (g[k] !== undefined ? g[k] : g[k + '~']);
  const num = x => (x != null && x !== '' && Number.isFinite(+x) ? +x : null);
  if (Array.isArray(recipe.broll) && recipe.broll.length) {
    return recipe.broll.map((g, i) => ({ n: i + 1, start: +g.start, end: +g.end, kind: pick(v(g, 'kind'), KINDS, 'full'), layer: pick(v(g, 'layer'), ['front', 'behind'], 'front'),
      ...Object.fromEntries(['y', 'w', 'h'].map(k => [k, num(v(g, k))]).filter(([, x]) => x != null)), ...(hexOK(v(g, 'border')) ? { border: String(v(g, 'border')).toLowerCase() } : {}),
      ...(v(g, 'shows') && v(g, 'shows') !== true ? { shows: String(v(g, 'shows')) } : {}), ...(v(g, 'shot') && v(g, 'shot') !== true ? { shot: String(v(g, 'shot')) } : {}),
      ...(v(g, 'source') && v(g, 'source') !== true ? { source: String(v(g, 'source')) } : {}), ...(g.src && g.src !== true ? { src: String(g.src) } : {}), ...(v(g, 'says') && v(g, 'says') !== true ? { says: String(v(g, 'says')) } : {}),
      fx: fxOf({ motion: v(g, 'motion'), zoom: v(g, 'zoom'), shake: v(g, 'shake'), glitch: v(g, 'glitch'), colour: v(g, 'colour') ?? v(g, 'color'), in: v(g, 'in'), out: v(g, 'out') }) }));
  }
  const cands = [];
  for (const g of recipe.graphics || []) {
    if (v(g, 'type') !== 'screen-card' || (g.src && g.src !== true) || (g.source && g.source !== true)) continue; // a card with its own file is already filled
    const w = num(v(g, 'w')) ?? 0.66, y = num(v(g, 'y')) ?? 0.68, h = r3(w * 0.34);
    cands.push({ start: +g.start, end: +g.end, kind: 'panel', box: [r3((1 - w) / 2), r3(y - h / 2), w, h], border: v(g, 'border'), shows: v(g, 'subject'), shot: 'screen recording', source: v(g, 'source') });
  }
  for (const s of recipe.shots || []) if (on(s.cutaway)) cands.push({ start: +s.start, end: +s.end, kind: 'full', shows: s.broll && s.broll !== true && !on(s.broll) ? String(s.broll) : null });
  const script = (recipe.script || []).map(l => ({ start: +l.start, end: +l.end, say: l.say }));
  return detect(cands, cands.map(c => ({ motion: 'still', in: c.kind === 'panel' ? 'pop' : 'cut', out: c.kind === 'panel' ? 'fade' : 'cut' })), { script })
    .map((s, i) => { const c = cands.find(x => Math.abs(x.start - s.start) < 0.01); return c && c.shows && !s.shows ? { ...s, shows: String(c.shows).slice(0, 80) } : s; });
}
// the screen-card graphics a slot list stands for (so a draft does not draw them twice)
const ownsCard = (slots, g) => slots.some(s => s.kind !== 'full' && +g.start < s.end + 0.3 && +g.end > s.start - 0.3);

// ---------- words ----------
// your lines on the edit's clock: words (kit/spoken.cjs timeline) grouped at a pause or the end of a sentence
function linesOf(words, gap = 0.45) {
  const out = []; let cur = null;
  for (const w of words || []) {
    if (cur && (w.start - cur.end > gap || /[.!?]$/.test(cur.last))) { out.push(cur); cur = null; }
    if (!cur) cur = { start: w.start, end: w.end, text: '', last: '' };
    cur.end = w.end; cur.last = String(w.word).trim(); cur.text = (cur.text + ' ' + cur.last).trim();
  }
  if (cur) out.push(cur);
  return out.map(({ start, end, text }) => ({ start, end, text }));
}
const textUnder = (words, a, b) => (words || []).filter(w => (w.start + w.end) / 2 >= a - 0.05 && (w.start + w.end) / 2 <= b + 0.05).map(w => String(w.word).trim()).join(' ').replace(/\s+/g, ' ').trim();
// a B-roll never starts or ends inside a word: the start goes to the nearest word start, the end to a word end
function snap(a, b, words, len) {
  const ws = words || [];
  if (!ws.length) return [r3(clamp(a, 0, Math.max(0, len - 0.4))), r3(clamp(b, 0, len))];
  const near = (t, key, max) => { const c = ws.map(w => w[key]).reduce((p, x) => (Math.abs(x - t) < Math.abs(p - t) ? x : p), ws[0][key]); return Math.abs(c - t) <= max ? c : t; };
  let s = near(a, 'start', 0.6), e = near(b, 'end', 0.6);
  // a touch before the word, so the picture is there when the word lands
  s = Math.max(0, s - 0.08);
  if (e - s < 1) e = Math.min(len, s + Math.max(1, b - a));
  return [r3(s), r3(Math.min(len, e))];
}
// how much a line asks for B-roll: a number, a tool or a thing named, a how-to. Higher is better.
const NAMED = /\b(app|tool|site|website|screen|dashboard|page|plugin|prompt|code|setup|click|type|open|install|search|file|folder|button|chart|numbers?|results?|views?|sales|revenue|clients?|customers?)\b/i;
const STOPW = new Set('the a an and or but so of to in on at for with by from is are was were be been it its this that these those i you we they he she my your our their me us them just really very like about into than then there here what when where which who how all any some more most much can will would could should do does did have has had get got going gonna not no yes one because if as up out over also only even still now'.split(' '));
function wantScore(text) {
  const t = String(text || ''), ws = t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  let sc = 0;
  if (/\d/.test(t)) sc += 2;
  if (NAMED.test(t)) sc += 2;
  if (/\b[A-Z][a-z]+[A-Z]\w*|\b[A-Z]{2,}\b/.test(t) || /\s[A-Z][a-z]{2,}/.test(t.slice(1))) sc += 1.5; // a name
  sc += Math.min(2, ws.filter(w => w.length > 5 && !STOPW.has(w)).length * 0.5);
  return sc;
}
const slotOut = (s, a, b, words, extra = {}) => ({ n: 0, start: a, end: b, kind: s.kind, layer: s.layer || 'front', ...(s.y != null ? { y: s.y } : {}), ...(s.w != null ? { w: s.w } : {}), ...(s.h != null ? { h: s.h } : {}),
  ...(s.border ? { border: s.border } : {}), fx: { ...fxOf(s.fx) }, what: s.shows || null, shot: s.shot || (s.kind === 'panel' ? 'screen recording' : null), ...(s.source ? { source: s.source } : {}),
  line: textUnder(words, a, b), ...extra, state: s.src ? 'filled' : 'needs', ...(s.src ? { file: s.src, by: 'recipe' } : {}) });
const number = list => list.sort((p, q) => p.start - q.start).map((s, i) => ({ ...s, n: i + 1 }));
// a full cutaway hides the speaker: it stays off the hook and the last line unless the reference covered its own
function guardFull(s, a, b, { len, lines, refLen, ref }) {
  if (s.kind !== 'full') return [a, b];
  const hook = Math.min(1.2, len * 0.2), last = lines.length > 1 ? lines[lines.length - 1].start : len;
  if (!(ref && ref.start < Math.min(1.2, refLen * 0.05))) a = Math.max(a, hook);
  if (!(ref && ref.end > refLen - 1.5)) b = Math.min(b, last - 0.05);
  return [r3(a), r3(b)];
}

// Recreate: each reference slot at its moment scaled to your edit (k = your length / the reference's), landed on
// your words. A slot that falls off the end, or has under a second left, is left out and said so.
function forRecreate(refSlots, { k = 1, len, words = [], refLen = null, log = () => {} } = {}) {
  const lines = linesOf(words), out = [], RL = refLen || (len / (k || 1));
  for (const s of refSlots) {
    let [a, b] = snap(s.start * k, s.end * k, words, len);
    [a, b] = guardFull(s, a, b, { len, lines, refLen: RL, ref: s });
    const prev = out[out.length - 1];
    if (prev && a < prev.end + 0.15) a = r3(prev.end + 0.15);
    if (a > len - 0.8 || b - a < 0.8) { log(`b-roll: the reference's slot ${s.n} (${s.start} to ${s.end} s) has no room on your ${len.toFixed(1)} s edit, left out`); continue; }
    out.push(slotOut(s, a, b, words, { ref: { n: s.n, start: s.start, end: s.end } }));
  }
  return number(out);
}

// Copy the look: lookBroll is the look's "broll" (kit/stylelook.cjs): { perMin, share, slots: [{ kind, dur, ... }] }.
// As many slots a minute as the reference, each the kind and about the length of one of its own (taken in turn),
// on your lines that ask for one most, spread out, never two on one line.
function forLook(lookBroll, { len, words = [], log = () => {} } = {}) {
  const proto = ((lookBroll && lookBroll.slots) || []).filter(p => KINDS.includes(p.kind));
  if (!proto.length || !(len > 2)) return [];
  const lines = linesOf(words), want = Math.max(1, Math.round((+lookBroll.perMin || 0) * len / 60));
  const cand = lines.map((l, i) => ({ ...l, i, sc: wantScore(l.text) - (i === 0 ? 3 : 0) - (i === lines.length - 1 && lines.length > 2 ? 2 : 0) })).filter(l => l.end - l.start >= 1 && l.sc > 0).sort((a, b) => b.sc - a.sc || a.start - b.start);
  const minGap = Math.max(1.5, len / (want * 2.5)), taken = [], out = [];
  for (const l of cand) {
    if (out.length >= want) break;
    if (taken.some(t => l.start < t[1] + minGap && l.end > t[0] - minGap)) continue;
    const p = proto[out.length % proto.length], d = clamp(+p.dur || 3, 1.2, Math.max(1.2, l.end - l.start));
    let [a, b] = snap(l.start, l.start + d, words, len);
    [a, b] = guardFull(p, a, b, { len, lines, refLen: len, ref: null });
    if (b - a < 0.8) continue;
    taken.push([a, b]); out.push(slotOut({ ...p, shows: null }, a, b, words, {}));
  }
  if (out.length < want) log(`b-roll: the look has about ${want} slot${want === 1 ? '' : 's'} for this length; ${out.length} of your lines fit one`);
  return number(out);
}
// what a look keeps of a reference's B-roll (kit/stylelook.cjs)
function lookSummary(refSlots, dur) {
  const total = refSlots.reduce((a, s) => a + (s.end - s.start), 0), by = k => refSlots.filter(s => s.kind === k).length;
  return { perMin: dur ? r2(refSlots.length * 60 / dur) : 0, share: dur ? r2(Math.min(1, total / dur)) : 0, kinds: Object.fromEntries(KINDS.map(k => [k, by(k)]).filter(([, n]) => n)),
    slots: refSlots.slice(0, 12).map(s => ({ kind: s.kind, layer: s.layer || 'front', dur: r2(s.end - s.start), ...(s.y != null ? { y: s.y } : {}), ...(s.w != null ? { w: s.w } : {}), ...(s.h != null ? { h: s.h } : {}), ...(s.border ? { border: s.border } : {}), ...(s.shot ? { shot: s.shot } : {}), fx: fxOf(s.fx) })) };
}

// ---------- what a slot needs, in plain words ----------
const MOTION_WORDS = { push: 'slow push in', pull: 'slow pull out', drift: 'a gentle drift', still: 'held still' };
const KIND_WORDS = { full: 'covers the whole frame', panel: 'a framed panel under your face', split: 'the top half, you below', pip: 'a small box in a corner' };
const EDGE_WORDS = { cut: 'cuts in', fade: 'fades in', pop: 'pops in', 'slide-up': 'slides up', 'slide-down': 'slides down', 'slide-left': 'slides in from the right', 'slide-right': 'slides in from the left', flash: 'flashes in', zoom: 'zooms in', glitch: 'glitches in' };
function brief(slot) {
  const secs = r2(slot.end - slot.start), shot = slot.shot || (slot.kind === 'panel' ? 'screen recording' : 'clip');
  const an = /^[aeiou]/i.test(shot) ? 'an' : 'a';
  const what = slot.what ? `${an} ${shot} of ${slot.what}` : slot.line ? `${an} ${shot} that fits "${slot.line.length > 70 ? slot.line.slice(0, 68).trim() + '...' : slot.line}"` : `${an} ${shot}`;
  const fx = slot.fx || fxOf(), treat = [MOTION_WORDS[fx.motion], fx.shake && 'a little shake', fx.glitch && 'a glitch', fx.colour !== 'none' && (fx.colour === 'bw' ? 'black and white' : fx.colour + ' colour'), EDGE_WORDS[fx.in]].filter(Boolean);
  return { what, seconds: secs, shape: KIND_WORDS[slot.kind] || KIND_WORDS.full, treat: treat.join(', '), line: slot.line || '',
    // 16:9 for a panel or the top of a split, upright for a full cutaway
    frame: slot.kind === 'full' ? 'upright 9:16' : 'wide 16:9' };
}
// the ready instruction for an agent that can capture it (Copy for my agent, Send to my agent)
function agentAsk(slot, { job = '', spot = null } = {}) {
  const b = brief(slot);
  return [`B-roll for my reel${job ? ` "${job}"` : ''}, slot ${slot.n}${spot != null ? ` (spot ${spot} on the B-roll step)` : ''}.`,
    `Capture ${b.what}, about ${Math.max(2, Math.ceil(b.seconds + 1))} seconds, ${b.frame}, no sound needed.`,
    b.line ? `It plays while I say: "${b.line}".` : '',
    slot.source ? `The reference showed ${slot.source}. Check the address with me before you record it.` : '',
    `In the reel it is ${b.shape}${b.treat ? ` (${b.treat})` : ''}; we add that, so record it plain.`,
    `Use only pages and apps I am allowed to show, nothing private on screen. When you have the file, add it with add_broll${spot != null ? ` on beat ${spot}` : ''} and tell me.`].filter(Boolean).join(' ');
}

// ---------- drawing ----------
// a panel slot as a screen card (captions.js flip, mode 11): your clip in it when filled, else the calm card
function flipOf(slot) {
  const fx = slot.fx || fxOf();
  return { start: slot.start, end: slot.end, mode: 11, text: '', slot: slot.n, ...(slot.y != null ? { y: clamp(slot.y, 0.3, 0.86) } : {}), ...(slot.w != null ? { w: clamp(slot.w, 0.4, 0.92) } : {}), ...(slot.border ? { border: slot.border } : {}),
    layer: slot.layer === 'behind' ? 'behind' : 'front', enter: fx.in, exit: fx.out, ...(fx.shake ? { shake: true } : {}), ...(fx.glitch ? { glitch: true } : {}), ...(fx.colour !== 'none' ? { tone: fx.colour } : {}),
    ...(fx.motion === 'push' || fx.motion === 'pull' ? { cam: fx.motion === 'push' ? `1 .5 .5; ${clamp(fx.zoom, 1.04, 1.4)} .5 .5` : `${clamp(2 - fx.zoom, 1.04, 1.4)} .5 .5; 1 .5 .5` } : fx.motion === 'drift' ? { cam: '1.08 .46 .5; 1.08 .54 .5' } : {}),
    ...(slot.file ? { src: slot.file, ...(slot.in ? { in: +slot.in } : {}) } : { need: (slot.what || slot.shot || 'B-roll').slice(0, 40) }) };
}
// a full, split or pip slot with a clip as a cut.json insert (kit/assemble.cjs draws the fx)
function insertOf(slot) {
  if (!slot.file) return null;
  return { file: slot.file, at: slot.start, dur: r3(slot.end - slot.start), in: +slot.in || 0, place: slot.kind === 'split' ? 'top' : slot.kind === 'pip' ? 'pip' : 'full', fx: { ...fxOf(slot.fx) }, slot: slot.n };
}
// a panel must not sit on the face: move it down (and make it smaller when the frame runs out) until its top edge is
// under the chin. zones: build/facezone.json. Returns how many were moved.
function clearFaces(flips, fz, H = 1920) {
  if (!fz || !Array.isArray(fz.zones) || !fz.fps) return 0;
  let moved = 0;
  for (const f of flips) {
    if (f.mode !== 11 || f.slot == null) continue;
    const zs = fz.zones.slice(Math.max(0, Math.floor(f.start * fz.fps)), Math.ceil(f.end * fz.fps) + 1).filter(Boolean);
    if (!zs.length) continue;
    const chin = Math.max(...zs.map(z => +z[3])) / H, w = f.w ?? 0.66, h = Math.min(0.42, w * 1080 * 0.6 / H + 0.045), top = (f.y ?? 0.68) - h / 2;
    if (top >= chin + 0.012) continue;
    const y = Math.min(0.97 - h / 2, chin + 0.012 + h / 2);
    if (y - h / 2 >= chin + 0.004) { f.y = r3(y); moved++; continue; }
    // no room at this size: a smaller panel on the bottom edge
    const h2 = Math.max(0.12, 0.965 - chin - 0.012), k = h2 / h;
    f.w = r3(Math.max(0.36, w * k)); f.y = r3(0.965 - h2 / 2); moved++;
  }
  return moved;
}

module.exports = { KINDS, MOTIONS, COLOURS, EDGES, BLOCK, BLOCK_NOTE, fxOf, kindOf, cleanWhat, detect, blockLines, appendBlock, fromRecipe, ownsCard, linesOf, snap, wantScore, forRecreate, forLook, lookSummary, brief, agentAsk, flipOf, insertOf, clearFaces };
