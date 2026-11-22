// Teardown converter (kit/videomd2reel.cjs): the running captions (style, place, colour, outline, shadow, layer).
'use strict';
const { r2, norm, hexOK } = require('./util.cjs');

// One big word at a time that matches the speech (the one-word caption look). rea-video files these as labels, so
// they are found by matching single big words on screen to the transcript's word times.
function oneWordStream(b) {
  const words = ((b.speech || {}).words || []).map(w => ({ t: w[0], w: norm(w[2]) })).filter(w => w.w.length >= 2);
  if (words.length < 8) return null;
  const cues = ((b.packaging || {}).text_cues || []).filter(c => c.text && String(c.text).trim().split(/\s+/).length === 1 && (c.line_h ?? (c.bbox ? c.bbox[3] : 0)) >= 0.04 && (c.t1 - c.t0) <= 1.6 && (c.conf ?? 1) >= 0.6);
  const hit = cues.filter(c => { const n = norm(c.text); return n.length >= 2 && words.some(w => Math.abs(w.t - c.t0) <= 0.8 && (w.w === n || (n.length >= 4 && (w.w.startsWith(n) || n.startsWith(w.w))))); });
  if (hit.length < 8) return null;
  const bands = {}; hit.forEach(c => { bands[c.band] = (bands[c.band] || 0) + 1; });
  const band = Object.entries(bands).sort((a, c) => c[1] - a[1])[0][0];
  return { cues: new Set(hit), band, n: hit.length, of: words.length };
}

// Phrases on screen (Studio report 4 item 16): the breakdown's text tracks (shots[].text.items, sampled every half
// second) show what was on screen at each moment. Big text of two or more words at a moment, in one line or in lines
// stacked on each other, is a designed phrase title ("IF WE MADE / $30K"), also when it is built word by word and so
// matches the speech one word at a time. Tiny text (a screen recording, a UI) and unsure reads are left out. Returns
// { n, of, share, examples } when phrases are the rule: 4 or more different ones, on a third or more of the moments
// that show big text. One-word captions with a few titles between them stay one-word.
function phrasesOnScreen(b) {
  const seen = new Map(); let multi = 0, single = 0;
  for (const s of b.shots || []) {
    const byT = new Map();
    for (const it of ((s.text || {}).items) || []) {
      const h = it.bbox ? +it.bbox[3] : 0, txt = String(it.text || '').trim();
      if (!(h >= 0.03) || (it.conf ?? 1) < 0.6 || !/[\p{L}\p{N}]{2}/u.test(txt)) continue;
      if (!byT.has(it.t)) byT.set(it.t, []);
      byT.get(it.t).push({ y0: +it.bbox[1], y1: +it.bbox[1] + h, h, txt });
    }
    for (const items of byT.values()) {
      items.sort((p, q) => p.y0 - q.y0);
      // lines stacked on each other (the gap under a line is at most its own height) are one block
      const blocks = []; for (const it of items) { const last = blocks[blocks.length - 1]; if (last && it.y0 - last.y1 <= Math.max(last.h, it.h)) { last.lines.push(it.txt); last.y1 = Math.max(last.y1, it.y1); last.h = Math.max(last.h, it.h); } else blocks.push({ y1: it.y1, h: it.h, lines: [it.txt] }); }
      const best = blocks.map(k => ({ lines: k.lines, words: k.lines.join(' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length })).sort((p, q) => q.words - p.words)[0];
      if (!best) continue;
      if (best.words >= 2) { multi++; const key = norm(best.lines.join(' ')); if (key && !seen.has(key)) seen.set(key, best.lines.join(' / ')); } else single++;
    }
  }
  // a phrase that grows word by word ("IF", "IF WE", "IF WE MADE") counts once: keep the longest
  const keys = [...seen.keys()].sort((p, q) => q.length - p.length), kept = [];
  for (const k of keys) if (!kept.some(x => x.startsWith(k) || x.includes(k))) kept.push(k);
  const of = multi + single, share = of ? multi / of : 0;
  if (kept.length < 4 || share < 1 / 3) return null;
  return { n: kept.length, moments: multi, of, share: r2(share), examples: kept.slice(0, 3).map(k => seen.get(k)) };
}
// Did a vision model look at the frames (breakdown.json analysis.vlm)? null when the breakdown does not say.
function visionPass(b) {
  const v = (b && b.analysis || {}).vlm; if (v == null) return null;
  if (typeof v === 'string') return /^(ok|on|used|done)$/i.test(v) ? 'on' : 'off';
  return v.used === true || /^(ok|on|used|done)$/i.test(String(v.status || '')) ? 'on' : 'off';
}
const VISION_OFF = 'We read this reference without the vision pass, so titles may be misread';

// Running captions -> one of our caption styles. One-word is never said when the text on screen is phrases.
function captionStyle(b) {
  const cs = captionStyle0(b), ph = cs.style === 'one-word' ? phrasesOnScreen(b) : null;
  if (!ph) return cs;
  return { ...cs, style: 'kinetic', was: 'one-word', phrases: ph,
    why: `the text on screen is phrases, not one word at a time: ${ph.moments} of ${ph.of} moments with big text show two or more words, ${ph.n} different phrases (${ph.examples.map(x => `"${x}"`).join(', ')}). They are designed titles, so the captions are kinetic (a key word with the rest of its phrase) and not one-word. What looked like one-word captions: ${cs.why}` };
}
function captionStyle0(b) {
  const ow = oneWordStream(b);
  if (ow) return { style: 'one-word', why: `${ow.n} big single words on screen match the speech (${ow.of} words spoken), mostly in the ${ow.band} band`, band: ow.band, ...placeOf([...ow.cues]) };
  // tiny text (a screen recording, a UI) is not a caption
  const subs = ((b.packaging || {}).text_cues || []).filter(c => c.kind === 'subtitle' && (c.line_h ?? (c.bbox ? c.bbox[3] : 1)) >= 0.025);
  if (!subs.length) return { style: 'kinetic', why: 'no running captions found; kinetic is the house default' };
  const words = subs.map(c => String(c.text).trim().split(/\s+/).length);
  const avgW = words.reduce((a, x) => a + x, 0) / words.length;
  const avgChars = subs.reduce((a, c) => a + String(c.text).replace(/\s/g, '').length, 0) / subs.length;
  const share = f => subs.filter(f).length / subs.length;
  const boxed = share(c => c.style && c.style.box), multi = share(c => c.style && (c.style.multicolor || c.style.highlight_name));
  const caps = share(c => /[A-Z]/.test(c.text) && c.text === c.text.toUpperCase()), stroke = share(c => c.style && c.style.stroke_ratio > 0.015);
  const avgDur = subs.reduce((a, c) => a + (c.t1 - c.t0), 0) / subs.length;
  const facts = `${subs.length} caption cues, ${avgW.toFixed(1)} words and ${avgChars.toFixed(0)} letters each, ${avgDur.toFixed(2)} s on screen, boxed ${Math.round(boxed * 100)}%, highlighted ${Math.round(multi * 100)}%, upper case ${Math.round(caps * 100)}%`;
  const pl = placeOf(subs);
  if (avgW <= 1.3 && avgChars <= 9 && avgDur < 0.9) return { style: 'one-word', why: facts, ...pl };
  if (boxed >= 0.5) return { style: 'pill', why: facts, ...pl };
  if (multi >= 0.4) return { style: 'karaoke', why: facts, ...pl };
  if (caps >= 0.6 && stroke >= 0.4) return { style: 'hormozi', why: facts, ...pl };
  return { style: 'kinetic', why: facts, ...pl };
}
// Where the captions sit (top / middle / bottom from the median centre of their boxes) and their colour (the median
// fill, snapped to white or black when it is close, since OCR reads anti-aliased edges into the fill).
function placeOf(cs) {
  const ys = cs.filter(c => c.bbox).map(c => c.bbox[1] + c.bbox[3] / 2).sort((a, z) => a - z);
  const y = ys.length ? ys[Math.floor(ys.length / 2)] : null;
  const position = y == null ? null : y < 0.36 ? 'top' : y > 0.6 ? 'bottom' : 'middle';
  const fills = cs.map(c => c.style && c.style.fill).filter(hexOK).map(h => parseInt(h.slice(1), 16)).map(n => [n >> 16, (n >> 8) & 255, n & 255]);
  let color = null;
  if (fills.length) {
    const m = [0, 1, 2].map(k => { const v = fills.map(f => f[k]).sort((a, z) => a - z); return v[Math.floor(v.length / 2)]; });
    const lumi = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255, sat = Math.max(...m) ? (Math.max(...m) - Math.min(...m)) / Math.max(...m) : 0;
    color = sat < 0.12 && lumi > 0.82 ? '#ffffff' : sat < 0.12 && lumi < 0.15 ? '#000000' : '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // letter case of the words: all lower, all caps, or as said
  const ws = cs.map(c => String(c.text).replace(/[^A-Za-z]/g, '')).filter(w => w.length >= 2);
  const lo = ws.filter(w => w === w.toLowerCase()).length, up = ws.filter(w => w === w.toUpperCase()).length;
  const textCase = !ws.length ? null : lo >= 0.6 * ws.length ? 'lower' : up >= 0.6 * ws.length ? 'upper' : 'as-said';
  return { position, color, y: y == null ? null : r2(y), textCase };
}

// Outline and shadow of the caption words, from teardown.py's ring measures (caption_look samples) on the cues that
// are the running captions: a hard dark band right at the letters is an outline (thick when it carries on into the
// next ring), a milder darkening a soft shadow, else none. Samples on a dark background are skipped.
function captionLook(samples, cues, layerSamples) {
  const key = c => `${r2(c.t0)}|${c.text}`, want = cues ? new Set([...cues].map(key)) : null;
  const vs = (samples || []).filter(m => !want || want.has(key(m))).map(m => {
    if (m.far < 70) return null;
    if (m.near < 0.45 * m.far && m.near < 90) return m.mid < 0.55 * m.far ? 'thick' : 'thin';
    if (m.near < 0.85 * m.far || m.mid < 0.9 * m.far) return 'shadow';
    return 'none';
  }).filter(Boolean);
  if (vs.length < 3) return null;
  const outl = vs.filter(v => v === 'thin' || v === 'thick');
  // front or behind the person (teardown.py caption_layer): on the words whose box meets the person (30 or more pixels of
  // the eroded mask), letters that vanish over the person (text density there under a third of the density beside it,
  // in the same rows) are drawn behind; behind when 60% or more of at least 2 such words are
  const ov = (layerSamples || []).filter(m => (!want || want.has(key(m))) && m.on_n >= 30 && m.text_off_person >= 0.05);
  const beh = ov.filter(m => m.text_on_person < 0.3 * m.text_off_person).length;
  const layer = ov.length >= 2 ? (beh >= 0.6 * ov.length ? 'behind' : 'front') : null;
  return { layer, layerN: ov.length, layerBehind: beh, outline: outl.length >= 0.5 * vs.length ? (outl.filter(v => v === 'thick').length >= outl.length / 2 ? 'thick' : 'thin') : 'none',
    shadow: vs.filter(v => v === 'shadow').length >= 0.4 * vs.length ? 'soft' : 'none', n: vs.length };
}

module.exports = { oneWordStream, captionStyle, phrasesOnScreen, visionPass, VISION_OFF, placeOf, captionLook };
