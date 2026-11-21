// Copy the look: a style look (kit/stylelook.cjs) put on your take. Nothing here reads the reference's timeline,
// script or text: every time comes from your own words.
//   shots()     a shot list for your take's length from the look's pace (shot lengths drawn from its spread, the hook
//               first), each with a shot size from the look's framing mix, and the look's share of transitions, camera
//               moves, shakes and cutaways
//   cut()       your edit re-cut to that list by kit/shotplan.cjs recut(): every cut in the quiet between two of your
//               words (never inside a word, never starting mid-word); no quiet near a wanted cut, no cut
//   stickers()  the look's sticker on your key words: ordinals first, then numbers, then strong keywords
//   titles()    the look's title style on the titles drafted from your words
//   sounds()    the look's sounds at its density, on your stickers, titles and cuts
// kit/reel.cjs --style-look runs these; kit/reframe.cjs and kit/grade-match.cjs then set the framing and the grade.
'use strict';
const SPL = require('./shotplan.cjs');
const RF = require('./reframe.cjs');
const S = require('./spoken.cjs');
const SFXPLAN = require('./sfx-plan.cjs');

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

const STOP = new Set('about above after again against because before being below between both could does doing down during each from further have having here itself just more most myself once only other ourselves over same should some such than that their theirs them themselves then there these they this those through under until very were what when where which while will with would your yours yourself really actually going gonna thing things something anything everything every people pretty right yeah okay well also into like know want need make made take took get got much many even still back look think'.split(' '));
const bare = w => String(w || '').replace(/^[^\p{L}\p{N}$%]+|[^\p{L}\p{N}$%]+$/gu, '');
const isNumber = w => /^\$?\d[\d,.]*[%xk]?$/i.test(w) || /^(two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty|hundred|thousand|million|billion)$/i.test(w);

// Your key words for a sticker, best first: ordinals you say, numbers, then strong keywords (long, said once).
function keyWords(words) {
  const out = [], ords = S.ordinalsSaid(words);
  for (const w of ords) out.push({ start: w.start, end: w.end, text: String(Object.keys(S.ORD).find(k => S.ORD[k] === w.n && /^[a-z]+$/.test(k)) || bare(w.word)).toUpperCase(), spoken: bare(w.word), kind: 'ordinal', rank: 3 });
  const counts = {}; for (const w of words) { const b = bare(w.word).toLowerCase(); counts[b] = (counts[b] || 0) + 1; }
  for (const w of words) {
    const b = bare(w.word); if (!b || ords.some(o => o.start === w.start)) continue;
    if (isNumber(b)) out.push({ start: w.start, end: w.end, text: b.toUpperCase(), spoken: b, kind: 'number', rank: 2 });
    else if (b.length >= 6 && /^[\p{L}'-]+$/u.test(b) && !STOP.has(b.toLowerCase()) && counts[b.toLowerCase()] === 1) out.push({ start: w.start, end: w.end, text: b.toUpperCase(), spoken: b, kind: 'keyword', rank: 1 + Math.min(0.9, (b.length - 6) * 0.1 + (/^[A-Z]/.test(b) ? 0.2 : 0)) });
  }
  return out.sort((a, b) => b.rank - a.rank || a.start - b.start);
}

// The look's sticker on your key words, as captions.js flips (mode 9). len: the edit's length; busy: spans to keep
// clear of ([{ start, end }], your titles). As many as the look's density asks for, never two within STICKER_GAP.
function stickers(look, words, len, { busy = [] } = {}) {
  const st = (look.stickers || {}).ordinal;
  if (!st) return { flips: [], lines: ['stickers: the look has none'] };
  const want = Math.max(1, Math.round((+st.per10 || 0.5) * len / 10)), secs = clamp(+st.seconds || 1, 0.8, 1.6), picked = [];
  for (const k of keyWords(words)) {
    if (picked.length >= want) break;
    const a = Math.max(0, k.start - 0.15), b = Math.min(len, a + secs);
    if (a < 0.8 || b > len - 0.3) continue;
    if (picked.some(p => Math.abs(p.start - a) < STICKER_GAP) || busy.some(x => a < x.end + 0.2 && b > x.start - 0.2)) continue;
    picked.push({ start: r3(a), end: r3(b), mode: 9, text: k.text, spoken: k.spoken, kind: k.kind, layer: st.layer || 'front', ...(st.shape === 'starburst' ? { shape: 'starburst', spikes: st.spikes || 12 } : {}), ...(st.color ? { color: st.color } : {}),
      ...(st.x != null ? { x: st.x } : {}), ...(st.y != null ? { y: st.y } : {}), ...(st.size != null ? { size: st.size } : {}) });
  }
  picked.sort((a, b) => a.start - b.start);
  const lines = [picked.length ? `stickers: ${picked.length} in the look's style (${st.shape === 'starburst' ? `a ${st.spikes}-point starburst` : 'a round seal'}${st.color ? ', ' + st.color : ''}) on your words: ${picked.map(p => `"${p.spoken}" (${p.kind}) at ${p.start}s`).join(', ')}` : 'stickers: none of your words made a sticker (no ordinal, number or strong keyword clear of a title)'];
  for (const k of ['appLabel', 'screenCard']) if ((look.stickers || {})[k]) lines.push(`${k === 'appLabel' ? 'app labels' : 'screen cards'}: the look keeps their style; they need your own ${k === 'appLabel' ? 'icons' : 'screens'}, so none are placed on a draft`);
  return { flips: picked.map(({ kind, ...f }) => f), lines };
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
