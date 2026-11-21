// Copy the look: a style look (kit/stylelook.cjs) put on your take. Nothing here reads the reference's timeline,
// script or text: every time comes from your own words.
//   shots()     a shot list for your take's length from the look's pace (shot lengths drawn from its spread, the hook
//               first), each with a shot size from the look's framing mix, and the look's share of transitions, camera
//               moves, shakes and cutaways
//   cut()       your edit re-cut to that list by kit/shotplan.cjs recut(): every cut in the quiet between two of your
//               words (never inside a word, never starting mid-word); no quiet near a wanted cut, no cut
//   stickers()  the look's sticker on your key words: ordinals first, then numbers and stats, then the words of your
//               goal (--goal, "what is the point of this video"), then other strong keywords. Generic words never
//               get one: with too few good words we place fewer stickers than the look has.
//   titles()    the look's title style on the titles drafted from your words
//   sounds()    the look's sounds at its density, on your stickers, titles and cuts
// kit/reel.cjs --style-look runs these; kit/reframe.cjs and kit/grade-match.cjs then set the framing and the grade.
'use strict';
const SPL = require('./shotplan.cjs');
const RF = require('./reframe.cjs');
const S = require('./spoken.cjs');
const SFXPLAN = require('./sfx-plan.cjs');
const GW = require('./goalwords.cjs');

const MIN_LEN = 1.2;       // no planned shot under this
const STICKER_GAP = 2.5;   // seconds between two stickers
const r2 = x => +(+x).toFixed(2), r3 = x => +(+x).toFixed(3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// a small seeded generator, so the same take and look always give the same plan
function rng(seed) {
  let h = 2166136261; for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h |= 0; h = h + 0x6D2B79F5 | 0; let t = Math.imul(h ^ h >>> 15, 1 | h); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// spread a share over a run of slots: true on about share of the calls, evenly (error diffusion)
function spreader(share, start = 0.5) { let acc = start; return () => { acc += share; if (acc >= 1) { acc -= 1; return true; } return false; }; }

// shot lengths from the look's pace: its quantiles when it has them, else its mean and spread
function lengthAt(pace, u) {
  const q = pace.quantiles;
  if (Array.isArray(q) && q.length >= 2) { const x = u * (q.length - 1), i = Math.min(q.length - 2, Math.floor(x)); return q[i] + (q[i + 1] - q[i]) * (x - i); }
  return pace.shotMean + (u - 0.5) * 2 * (pace.shotSpread || 0);
}

// The shot list for an edit of len seconds. Each: { dur, cls, framing, face (the target), transition, move, shake, cutaway }.
function shots(look, len, seed = '') {
  const pace = look.pace || {}, rand = rng(`${look.name}|${seed}|${Math.round(len)}`);
  const lo = Math.max(MIN_LEN, +pace.shotMin || MIN_LEN), hi = Math.max(lo, +pace.shotMax || 8), mid = +pace.shotMedian || +pace.shotMean || 3;
  const durs = [clamp(+pace.hook || mid, lo, Math.min(hi, 6))];
  let t = durs[0];
  while (t < len - lo) { const d = clamp(lengthAt(pace, rand()), lo, hi); durs.push(d); t += d; }
  // the last shot takes what is left; a short tail joins the shot before it
  const over = t - len; durs[durs.length - 1] -= over;
  if (durs.length > 1 && durs[durs.length - 1] < lo) { const last = durs.pop(); durs[durs.length - 1] += last; }
  const fr = look.framing || {}, classes = Object.entries(fr.mix || {}).sort((a, b) => b[1] - a[1]);
  const pickers = classes.map(([c, share]) => [c, spreader(share, c === (classes[0] || [])[0] ? 0.99 : 0.3)]);
  const tm = Object.entries((look.transitions || {}).mix || {}).filter(([k]) => k !== 'cut').map(([k, share]) => [k, spreader(share)]);
  const mv = ['push', 'pull', 'drift'].map(k => [k, spreader(+(look.moves || {})[k] || 0)]), shake = spreader(+(look.moves || {}).shake || 0), away = spreader(clamp(+(look.broll || {}).cutawayShare || 0, 0, 0.6), 0.2);
  const change = spreader(clamp(+fr.changeRate || 0, 0, 1), 0.99);
  let prev = null, close = false;
  return durs.map((dur, i) => {
    const cls = (pickers.find(([, pick]) => pick()) || classes[0] || ['MCU'])[0], c = (fr.classes || {})[cls] || { faceH: 0.17, eyeY: 0.33, cx: 0.5 };
    // the same class twice in a row: the look's closer and wider framings of it take turns as often as its framing
    // changed on a cut (a short shot takes the closer one, as a punch-in does), so the cut reads
    if (cls !== prev) close = dur < mid * 0.6; else if (change()) close = dur < mid * 0.6 ? true : !close;
    prev = cls;
    const faceH = close ? c.hi || c.faceH : c.lo || c.faceH;
    const o = { dur: r3(dur), cls, framing: RF.CLASS_WORDS[cls], face: { faceH, eyeY: c.eyeY, cx: c.cx != null ? c.cx : 0.5 } };
    if (i) { const tr = tm.find(([, pick]) => pick()); if (tr) o.transition = tr[0]; const m = mv.find(([, pick]) => pick()); if (m) o.move = m[0]; if (shake()) o.shake = true; if (away() && dur >= 1.5) o.cutaway = true; }
    return o;
  });
}

// Re-cut segs (in place) to the look's shot list on your own pauses and set each shot's transition, move and shake.
// quiet(i, a, b) as kit/shotplan.cjs wants it. Returns { rc, plan (the shot list), shakeAt, lines }.
function cut({ look, segs, words, quiet, seed = '', wantPunch = true }) {
  const len = segs.reduce((a, s) => a + s.out - s.in, 0), plan = shots(look, len, seed);
  const rc = SPL.recut(segs, words, plan, quiet);
  segs.splice(0, segs.length, ...rc.segs);
  const shakeAt = [];
  rc.shotStart.forEach((k, j) => {
    const p = plan[rc.shotOf[j]] || {}, sg = segs[k];
    if (rc.plan[j]) Object.assign(rc.plan[j], { cls: p.cls });
    if (!j) return;
    if (p.transition) sg.transition = p.transition;
    if (p.move && !sg.bigPunch) sg.push = SPL.MOVES[p.move];
    if (p.shake) shakeAt.push(k);
  });
  const lines = [`look: ${rc.plan.length || 1} shots on your ${len.toFixed(1)} s from the look's pace (a cut about every ${look.pace.shotMean} s), cuts at ${rc.cuts.map(c => c.t + ' s (' + c.on + ')').join(', ') || 'none'}${rc.skipped.length ? `; no quiet between your words near ${rc.skipped.map(x => x.at + ' s').join(', ')}, so no cut there` : ''}`];
  return { rc, plan, shakeAt, lines };
}

const bare = w => String(w || '').replace(/^[^\p{L}\p{N}$%]+|[^\p{L}\p{N}$%]+$/gu, '');
const isNumber = w => /^\$?\d[\d,.]*(%|x|k|m|bn?)?$/i.test(w) || /^(two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)$/i.test(w);
// "second" as a length of time is not an ordinal: "the second I say it", "ten seconds", "a split second"
const SUBJECT = new Set(['i', 'you', 'we', 'they', 'he', 'she', 'it']);
const timeUnit = (words, i) => {
  const prev = bare((words[i - 1] || {}).word).toLowerCase(), next = bare((words[i + 1] || {}).word).toLowerCase();
  if (!/^seconds?$/i.test(bare(words[i].word))) return false;
  if (/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|few|split|per)$/.test(prev)) return true;
  // "the second I say it": "the" before it and a subject right behind. "Second, you paste" stays an ordinal.
  return /^(the|that|this)$/.test(prev) && SUBJECT.has(next);
};

// Your key words for a sticker, best first:
//   4 ordinals you say (first, second, third)       always qualify
//   3 numbers and stats (3, 10x, 50%, $100)         always qualify
//   2 the words of your goal (opts.goal, one line)  each once, by its stem
//   1 other strong keywords                         a name (a brand from opts.names, or a word written with a capital
//                                                   inside a sentence) or a word you say more than once; six letters
//                                                   or more, not a stopword, not a generic word
// A stopword or a generic word (kit/goalwords.cjs) is never a keyword, however long it is, and a long word said once
// is not one either: nothing says it matters.
function keyWords(words, { goal = '', names = [] } = {}) {
  const out = [], goalStems = GW.contentWords(goal), seen = new Set(), brand = new Set(names.map(x => String(x).toLowerCase()));
  const count = {}; for (const w of words) { const st = GW.stem(bare(w.word)); count[st] = (count[st] || 0) + 1; }
  const midSentence = i => i > 0 && !/[.?!]["')\]]?$/.test(String(words[i - 1].word).trim());
  const ords = S.ordinalsSaid(words).filter(w => !timeUnit(words, words.findIndex(x => x.start === w.start)));
  for (const w of ords) out.push({ start: w.start, end: w.end, text: String(Object.keys(S.ORD).find(k => S.ORD[k] === w.n && /^[a-z]+$/.test(k)) || bare(w.word)).toUpperCase(), spoken: bare(w.word), kind: 'ordinal', rank: 4 });
  words.forEach((w, i) => {
    const b = bare(w.word); if (!b || ords.some(o => o.start === w.start)) return;
    if (isNumber(b)) { out.push({ start: w.start, end: w.end, text: b.toUpperCase(), spoken: b, kind: 'number', rank: 3 }); return; }
    if (!/^[\p{L}\p{N}'-]+$/u.test(b) || GW.isStop(b) || S.ORD[b.toLowerCase()]) return;
    const st = GW.stem(b); if (seen.has(st)) return;
    if (goalStems.includes(st)) { seen.add(st); out.push({ start: w.start, end: w.end, text: b.toUpperCase(), spoken: b, kind: 'goal', rank: 2 }); }
    else if (b.length >= 6 && /^[\p{L}'-]+$/u.test(b) && !GW.isGeneric(b)) {
      const name = brand.has(b.toLowerCase()) || (/^\p{Lu}/u.test(b) && midSentence(i)), often = count[st] >= 2;
      if (!name && !often) return;
      seen.add(st); out.push({ start: w.start, end: w.end, text: b.toUpperCase(), spoken: b, kind: 'keyword', rank: 1 + (name ? 0.5 : 0) + (often ? 0.3 : 0) + Math.min(0.15, (b.length - 6) * 0.03) });
    }
  });
  return out.sort((a, b) => b.rank - a.rank || a.start - b.start);
}

// The look's sticker on your key words, as captions.js flips (mode 9). len: the edit's length; busy: spans to keep
// clear of ([{ start, end }], your titles); goal: the point of the video, one line; names: brand words (the
// glossary). The look's density is the most
// we place (never two within STICKER_GAP); with fewer good words we place fewer.
function stickers(look, words, len, { busy = [], goal = '', names = [] } = {}) {
  const st = (look.stickers || {}).ordinal;
  if (!st) return { flips: [], lines: ['stickers: the look has none'], want: 0 };
  const want = Math.max(1, Math.round((+st.per10 || 0.5) * len / 10)), secs = clamp(+st.seconds || 1, 0.8, 1.6), picked = [];
  for (const k of keyWords(words, { goal, names })) {
    if (picked.length >= want) break;
    const a = Math.max(0, k.start - 0.15), b = Math.min(len, a + secs);
    if (a < 0.8 || b > len - 0.3) continue;
    if (picked.some(p => Math.abs(p.start - a) < STICKER_GAP) || busy.some(x => a < x.end + 0.2 && b > x.start - 0.2)) continue;
    picked.push({ start: r3(a), end: r3(b), mode: 9, text: k.text, spoken: k.spoken, kind: k.kind, layer: st.layer || 'front', ...(st.shape === 'starburst' ? { shape: 'starburst', spikes: st.spikes || 12 } : {}), ...(st.color ? { color: st.color } : {}),
      ...(st.x != null ? { x: st.x } : {}), ...(st.y != null ? { y: st.y } : {}), ...(st.size != null ? { size: st.size } : {}) });
  }
  picked.sort((a, b) => a.start - b.start);
  const KIND = { ordinal: 'ordinal', number: 'number', goal: 'your goal', keyword: 'keyword' };
  const lines = [picked.length ? `stickers: ${picked.length} in the look's style (${st.shape === 'starburst' ? `a ${st.spikes}-point starburst` : 'a round seal'}${st.color ? ', ' + st.color : ''}) on your words: ${picked.map(p => `"${p.spoken}" (${KIND[p.kind]}) at ${p.start}s`).join(', ')}` : `stickers: none of your words made a sticker (no ordinal, number${goal ? ', goal word' : ''} or strong keyword clear of a title)`];
  if (picked.length && picked.length < want) lines.push(`stickers: the look has room for ${want} on your ${len.toFixed(1)} s; only ${picked.length} of your words ${picked.length === 1 ? 'is' : 'are'} strong enough (an ordinal, a number${goal ? ', a word of your goal' : ''} or a strong keyword), so we place ${picked.length} and no generic ones${goal ? '' : '. A goal line (--goal) gives us more words to pick from'}`);
  for (const k of ['appLabel', 'screenCard']) if ((look.stickers || {})[k]) lines.push(`${k === 'appLabel' ? 'app labels' : 'screen cards'}: the look keeps their style; they need your own ${k === 'appLabel' ? 'icons' : 'screens'}, so none are placed on a draft`);
  return { flips: picked.map(({ kind, ...f }) => f), lines, want, kinds: picked.map(p => p.kind) };
}

// A sticker placed for the reference's face, moved and sized for yours: shotsPlan entries carry face (what you got) and
// faceTarget (what the sticker was placed for). In place.
function placeOnFace(flips, shotsPlan) {
  let n = 0;
  for (const g of flips) {
    if (g.mode !== 9 || g.y == null) continue;
    const sh = (shotsPlan || []).find(p => g.start >= p.start - 0.01 && g.start < p.end) || null;
    if (!sh || !sh.face || !sh.faceTarget) continue;
    const k = sh.face.faceH / sh.faceTarget.faceH;
    if (Math.abs(k - 1) < 0.03 && Math.abs(sh.face.eyeY - sh.faceTarget.eyeY) < 0.01) continue;
    g.y = r3(clamp(sh.face.eyeY + (g.y - sh.faceTarget.eyeY) * k, 0.1, 0.7));
    if (g.x != null) g.x = r3(clamp(sh.face.cx + (g.x - sh.faceTarget.cx) * k, 0.15, 0.85));
    if (g.size != null) g.size = Math.round(clamp(g.size * k, 160, 620));
    n++;
  }
  return n;
}

// The look's title style on the titles drafted from your words (mode 7 flips, in place): how many, the entrances in
// the order the look used them (each once), and the layer. Returns the flips to keep and a line for the log.
function titles(look, flips, len) {
  const tl = look.titles || {}, mine = flips.filter(f => f.mode === 7).sort((a, b) => a.start - b.start);
  if (!mine.length) return { flips, line: 'titles: none drafted from your words' };
  const want = clamp(Math.round((+tl.perMin || 2) * len / 60), 1, mine.length);
  // the hook stays; the rest are kept evenly through the reel
  const keep = new Set([mine[0]]);
  for (let i = 1; i < want; i++) keep.add(mine[Math.round(i * (mine.length - 1) / Math.max(1, want - 1))]);
  const used = new Set(); let k = 0;
  for (const f of mine) { if (!keep.has(f)) continue; const e = (tl.entrances || [])[k++]; if (e && !used.has(e)) { f.entrance = e; used.add(e); } else if (f.entrance && used.has(f.entrance)) delete f.entrance; if (tl.layer && tl.layer !== 'front') f.layer = tl.layer; }
  return { flips: flips.filter(f => f.mode !== 7 || keep.has(f)), line: `titles: ${keep.size} of your ${mine.length} drafted titles kept (the look has ${tl.perMin} a minute), ${tl.layer || 'front'}${(tl.entrances || []).length ? ', entrances ' + tl.entrances.join(', ') : ''}` };
}

// The look's sounds on your edit: as many as its density asks for, shared between your stickers, titles and cuts the
// way the look shared them, each as the kit sound the look used for that job. Returns [{ id, t }] and a line.
const PREF = { stickers: ['pop', 'shimmer', 'ding', 'click'], titles: ['click', 'pop', 'ding', 'tick', 'typing'], cuts: ['whoosh', 'swoosh', 'swipe', 'click', 'boom', 'hit'] };
function sounds(look, { stickers: st = [], titles: tt = [], cuts = [], len }) {
  const sx = look.sfx || {};
  if (!sx.count) return { hits: [], line: 'sounds: the look has none' };
  const types = Object.entries(sx.types || {}).sort((a, b) => b[1] - a[1]).map(([k]) => k), idFor = job => { const t = PREF[job].find(x => types.includes(x)) || types[0]; return (sx.sounds || {})[t] || SPL.sfxId(t); };
  const total = Math.max(1, Math.round((+sx.per10 || 1) * len / 10)), on = sx.on || {}, w = { stickers: (on.stickers || 0) + 0.01, titles: (on.titles || 0) + (on.captions || 0) * 0.5, cuts: (on.cuts || 0) + (on.other || 0) + (on.captions || 0) * 0.5 };
  const pool = { stickers: st.map(t => +t), titles: tt.map(t => +t), cuts: cuts.map(t => +t) }, sum = w.stickers + w.titles + w.cuts || 1, hits = [];
  const add = (job, t) => { if (hits.some(h => Math.abs(h.t - t) < 0.35) || !SFXPLAN.lookup(idFor(job))) return false; hits.push({ id: idFor(job), t: r3(t), look: true, on: job }); return true; };
  for (const job of ['stickers', 'titles', 'cuts']) { let n = Math.round(total * w[job] / sum); for (const t of pool[job]) { if (n <= 0) break; if (add(job, t)) n--; } }
  // what one job could not take goes to the others, stickers first
  for (const job of ['stickers', 'cuts', 'titles']) for (const t of pool[job]) { if (hits.length >= total) break; add(job, t); }
  hits.sort((a, b) => a.t - b.t);
  return { hits, line: `sounds: ${hits.length} at the look's density (${sx.per10} per 10 s): ${hits.map(h => `${h.id}@${h.t} (${h.on.replace(/s$/, '')})`).join(', ') || 'no moment to put one on'}` };
}

module.exports = { shots, cut, stickers, placeOnFace, titles, sounds, keyWords, rng, MIN_LEN, STICKER_GAP };
