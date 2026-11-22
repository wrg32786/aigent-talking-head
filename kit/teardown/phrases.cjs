// Phrase titles (1.29.0, Studio report 4 item 16): a reference whose text is designed phrases, one to three lines with
// one key word, and no running captions. The text tracks and half-second items rea-video writes
// (shots[].text.tracks[], shots[].text.items[]) are grouped into one title per phrase here; kit/phrase-titles.cjs maps
// them onto your own words for a draft. The user's agent can read the contact sheets and send the titles as designed
// (the set_reference_titles tool); they are kept beside the teardown in titles.agent.json and win over the OCR read.
'use strict';
const fs = require('fs'), path = require('path');
const { TITLE_EFFECTS, TITLE_EXITS, TITLE_BUILDS } = require('../rules.cjs');

const AGENT_FILE = 'titles.agent.json';
const KEY_FONTS = ['italic serif', 'serif', 'sans', 'script', 'mono'];
const r2 = x => Math.round(x * 100) / 100;

// The titles an agent (or a vision model) read from the sheets: checked, cleaned, in time order.
// { ok, errs, titles: [{ start, end, lines, key, font, glow, effect, exit, build, swap, count }] }
function validateAgentTitles(input) {
  const errs = [], out = [], list = Array.isArray(input) ? input : input && input.titles;
  if (!Array.isArray(list) || !list.length) return { ok: false, errs: ['titles must be a list with at least one title'], titles: [] };
  if (list.length > 80) return { ok: false, errs: ['at most 80 titles'], titles: [] };
  const str = v => typeof v === 'string' && v.trim() && v.length <= 80 && !/[\u0000-\u001f|]/.test(v);
  list.forEach((t, i) => {
    const at = `title ${i + 1}: `, e = m => errs.push(at + m);
    if (!t || typeof t !== 'object') return e('must be an object');
    const start = +t.start, end = +t.end;
    if (!(Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start && end - start <= 30)) return e('start and end are seconds in the reference, end after start, at most 30 s apart');
    const lines = Array.isArray(t.lines) ? t.lines : typeof t.text === 'string' ? t.text.split('/') : null;
    if (!lines || lines.length < 1 || lines.length > 3 || !lines.every(str)) return e('lines is 1 to 3 lines of text, each up to 80 letters');
    const o = { start: r2(start), end: r2(end), lines: lines.map(l => l.trim().replace(/\s+/g, ' ')) };
    if (t.key != null && t.key !== '') {
      if (!str(t.key)) return e('key is the key word, as it is written in the lines');
      if (!o.lines.join(' ').toLowerCase().includes(t.key.trim().toLowerCase())) return e(`key "${t.key}" is not in the lines`);
      o.key = t.key.trim();
    }
    for (const [k, allowed] of [['font', KEY_FONTS], ['effect', TITLE_EFFECTS], ['exit', TITLE_EXITS], ['build', TITLE_BUILDS]]) {
      if (t[k] == null || t[k] === '' || t[k] === 'none') continue;
      if (!allowed.includes(t[k])) return e(`${k} must be one of ${allowed.join(', ')}`);
      o[k] = t[k];
    }
    if (t.glow != null) o.glow = !!t.glow;
    if (t.swap != null) { if (!Array.isArray(t.swap) || t.swap.length < 2 || t.swap.length > 6 || !t.swap.every(str)) return e('swap is 2 to 6 words that roll one after another'); o.swap = t.swap.map(x => x.trim()); }
    if (t.count != null) {
      const c = t.count;
      if (!c || typeof c !== 'object' || !Number.isFinite(+c.from) || !Number.isFinite(+c.to) || (c.unit != null && !str(c.unit)) || (c.final != null && !str(c.final))) return e('count is { from, to, unit, final }: two numbers, a unit word and the text it ends on');
      o.count = { from: +c.from, to: +c.to, ...(c.unit ? { unit: c.unit.trim() } : {}), ...(c.final ? { final: c.final.trim() } : {}) };
    }
    out.push(o);
  });
  out.sort((a, b) => a.start - b.start);
  return { ok: !errs.length, errs, titles: errs.length ? [] : out };
}
// Beside the teardown (the folder with Reel.md), so a re-run keeps it.
function readAgentTitles(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, AGENT_FILE), 'utf8')), v = validateAgentTitles(j); return v.ok ? { ...j, titles: v.titles } : null; } catch { return null; }
}
function writeAgentTitles(dir, titles, by) {
  const v = validateAgentTitles(titles); if (!v.ok) return v;
  fs.writeFileSync(path.join(dir, AGENT_FILE), JSON.stringify({ version: 1, by: by || 'agent', at: new Date().toISOString(), titles: v.titles }, null, 1));
  return v;
}


// ---- grouping the text tracks into phrase titles
const BIG = 0.025;   // a line under 2.5% of the frame height is small print (a screen recording, a UI), never a title
const nrm = s => String(s || '').toLowerCase().replace(/[^a-z0-9$%#']+/g, ' ').trim();
const maskNum = s => nrm(s).replace(/\d[\d,.]*/g, '#');
const numOf = s => { const m = /\d[\d,]*(?:\.\d+)?/.exec(String(s)); return m ? +m[0].replace(/,/g, '') : null; };
const rgb = h => { const m = /^#([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255].map(v => v / 255); };
const lumOf = h => { const c = rgb(h); return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : 1; };
const satOf = h => { const c = rgb(h); if (!c) return 0; const mx = Math.max(...c); return mx ? (mx - Math.min(...c)) / mx : 0; };
const bandOf = y => (y < 0.36 ? 'top' : y > 0.6 ? 'bottom' : 'middle');

// what is on screen at each half-second sample: the big lines, top to bottom, words on one row joined left to right
function samples(b) {
  const at = new Map();
  (b.shots || []).forEach((sh, si) => {
    for (const it of ((sh.text || {}).items || [])) {
      const bb = it.bbox || it.box; if (!bb || !(bb[3] >= BIG) || (it.conf ?? it.confidence ?? 1) < 0.5 || Math.abs(+it.angle || 0) > 10) continue;
      const text = String(it.text || '').trim(), fill = it.style && it.style.fill;
      if (text.replace(/[^A-Za-z0-9]/g, '').length < 2 || /^[@#]|\.(com|html|io)\b/i.test(text) || lumOf(fill) < 0.25) continue;   // handles, addresses and dark print on a card are not titles
      const t = +it.t; if (!at.has(t)) at.set(t, { t, shot: si, rows: [] });
      at.get(t).rows.push({ text, x: bb[0], y: bb[1] + bb[3] / 2, h: bb[3], fill, sat: satOf(fill) > 0.35 && lumOf(fill) > 0.3, grey: satOf(fill) < 0.2 && lumOf(fill) < 0.62, conf: it.conf ?? it.confidence ?? 1 });
    }
  });
  const out = [...at.values()].sort((a, z) => a.t - z.t);
  for (const s of out) {
    const lines = [];
    for (const r of s.rows.sort((a, z) => a.y - z.y || a.x - z.x)) {
      const l = lines.find(l => Math.abs(l.y - r.y) < 0.5 * Math.min(l.h, r.h));
      if (l) { l.parts.push(r); l.parts.sort((a, z) => a.x - z.x); l.text = l.parts.map(p => p.text).join(' '); l.h = Math.max(l.h, r.h); l.sat = l.sat || r.sat; l.conf = Math.min(l.conf, r.conf); }
      else lines.push({ ...r, parts: [r] });
    }
    s.lines = lines; delete s.rows;
  }
  return out;
}
// the same line a half second later: the same words, the line still growing, a number counting, or its last word swapped
const sameRow = (a, z) => Math.abs(a.y - z.y) < 0.03;
function grows(a, z) { const x = nrm(a.text), y = nrm(z.text); return x.length >= 2 && y.length >= 2 && (x === y || y.startsWith(x) || x.startsWith(y)); }
function counts(a, z) { return sameRow(a, z) && /\d/.test(a.text) && maskNum(a.text) === maskNum(z.text); }
function swaps(a, z) { if (!sameRow(a, z)) return false; const x = nrm(a.text).split(' '), y = nrm(z.text).split(' '); let k = 0; while (k < x.length && k < y.length && x[k] === y[k]) k++; return k >= 2 && k < x.length && k < y.length && k >= Math.max(x.length, y.length) - 2; }
const related = (a, z) => grows(a, z) || counts(a, z) || swaps(a, z);

function cutFlags(start, end, shots) {
  const cuts = (shots || []).slice(1).map(s => +s.start);
  return { onCut: cuts.some(c => Math.abs(c - start) <= 0.12), endsOnCut: cuts.some(c => Math.abs(c - end) <= 0.15), acrossCut: cuts.some(c => c > start + 0.15 && c < end - 0.15) };
}
const EXIT_OF = { flash: 'blow-up', fade: 'dip-black' };   // the transition into the next shot, when the title ends on that cut

// One title per phrase, in time order:
// { n, start, end, text ("LINE/LINE"), lines, key, band, y, build, effect, exit, swap, count, onCut, endsOnCut, acrossCut, conf, source }
// build: how it arrives (word by word, letter by letter, line by line; null = all at once). effect and exit are the
// nearest of ours when the samples show one (a count, a swapped word, older lines fading, typing); the agent pass
// (titles.agent.json) reads them properly.
function phraseTitles(b) {
  const S = samples(b), shots = b.shots || [], groups = [];
  let cur = null;
  for (const s of S) {
    if (!s.lines.length) continue;
    const last = cur && cur[cur.length - 1];
    if (last && s.t - last.t <= 0.75 && s.lines.some(l => last.lines.some(p => related(p, l)))) cur.push(s); else groups.push(cur = [s]);
  }
  const out = [];
  for (const g of groups) {
    const chars = s => s.lines.reduce((a, l) => a + l.text.length, 0);
    const full = g.reduce((a, s) => (chars(s) >= chars(a) ? s : a), g[0]);
    let lines = full.lines.map(l => ({ ...l }));
    const words = lines.reduce((a, l) => a + l.text.split(/\s+/).length, 0);
    if (words < 2 && !(g.length >= 2 && /\d/.test(lines[0].text))) continue;   // one word alone is a caption word or a sticker, unless it is a number that stays up
    // a count or a swapped word: the line reads as it ends
    let count = null, swap = null;
    for (const l of lines) {
      const seq = g.map(s => s.lines.find(p => counts(p, l))).filter(Boolean), nums = [...new Set(seq.map(p => numOf(p.text)).filter(v => v != null))];
      if (nums.length >= 2) { const lastL = seq[seq.length - 1], unit = lastL.text.replace(/[$]?\d[\d,.]*/, '').trim(); l.text = lastL.text; if (/^\d[\d,]*\s/.test(lastL.text) && nums.every((v, i) => !i || v > nums[i - 1])) count = { from: nums[0], to: nums[nums.length - 1], ...(unit ? { unit } : {}) }; l.rolls = true; continue; }
      const sw = g.map(s => s.lines.find(p => swaps(p, l) || (sameRow(p, l) && nrm(p.text) === nrm(l.text)))).filter(Boolean), diff = sw.find(p => nrm(p.text) !== nrm(l.text));
      if (diff) { const x = nrm(diff.text).split(' '), y = nrm(l.text).split(' '); let k = 0; while (k < x.length && x[k] === y[k]) k++;
        swap = [...new Set(sw.map(p => p.text.split(/\s+/).slice(k).join(' ')).filter(Boolean))]; l.text = sw[sw.length - 1].text; }
    }
    // how it builds
    let build = null;
    for (let i = 1; i < g.length && build !== 'letter'; i++) for (const l of g[i].lines) {
      const p = g[i - 1].lines.find(q => grows(q, l) && nrm(q.text) !== nrm(l.text)); if (!p) continue;
      const a = nrm(p.text).split(' '), z = nrm(l.text).split(' '), [sh, lo] = a.length <= z.length ? [a, z] : [z, a];
      if (sh[sh.length - 1] !== lo[sh.length - 1]) { build = 'letter'; break; }
      build = 'word';
    }
    if (!build && g.some((s, i) => i && s.lines.length > g[i - 1].lines.length)) build = 'line';
    // older lines going grey or leaving while newer ones arrive
    const seen = new Set(g.flatMap(s => s.lines.map(l => nrm(l.text)))), final = g[g.length - 1];
    const fades = g.length >= 2 && (final.lines.some(l => l.grey && lines.length > 1) || (final.lines.length >= 1 && [...seen].some(x => !final.lines.some(l => grows({ text: x }, l) || counts({ text: x, y: l.y }, l) || swaps({ text: x, y: l.y }, l))) && g[0].lines.length < full.lines.length + 1 && build === 'line'));
    // the key word: the line in a colour while the rest is white, else the line set clearly bigger
    const med = a => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)] || 0; };
    let keyL = lines.filter(l => l.sat).length === 1 && lines.length > 1 ? lines.find(l => l.sat) : null;
    if (!keyL && lines.length > 1) { const big = [...lines].sort((a, z) => z.h - a.h)[0], rest = med(lines.filter(l => l !== big).map(l => l.h)); if (big.h >= 1.25 * rest) keyL = big; }
    if (!keyL && lines.length === 1 && lines[0].sat && words <= 3) keyL = lines[0];
    const key = keyL && keyL.text.split(/\s+/).length <= 3 ? keyL.text : null;
    if (lines.length > 3) lines = [{ ...lines[0], text: lines.slice(0, lines.length - 2).map(l => l.text).join(' ') }, ...lines.slice(-2)];   // more than three rows: the opening rows read as one line
    // when it is up
    const t0 = g[0].t, t1 = g[g.length - 1].t, cuts = shots.slice(1).map(s => +s.start);
    const cutIn = cuts.find(c => c > t0 - 0.5 && c <= t0 + 0.001), cutOut = cuts.find(c => c > t1 && c <= t1 + 0.5);
    const prevEnd = out.length ? out[out.length - 1].end : 0;
    const start = r2(Math.max(prevEnd, cutIn != null ? cutIn : Math.max(0, t0 - 0.25))), end = r2(cutOut != null ? cutOut : t1 + 0.25);
    const fl = cutFlags(start, end, shots), next = fl.endsOnCut ? shots.find(s => Math.abs(+s.start - end) <= 0.15) : null;
    const effect = count ? 'count-up' : swap || lines.some(l => l.rolls) ? 'slot-roll' : fades ? 'stack-fade' : build === 'letter' ? 'type' : null;
    const y = med(lines.map(l => l.y));
    out.push({ n: out.length + 1, start, end, text: lines.map(l => l.text).join('/'), lines: lines.map(l => l.text), key, band: bandOf(y), y: r2(y), build, effect, exit: (next && EXIT_OF[next.transition_in]) || null,
      ...(swap ? { swap } : {}), ...(count ? { count } : {}), ...fl, conf: r2(Math.min(...lines.map(l => l.conf))), fill: (keyL || lines[0]).fill || null, source: 'ocr' });
  }
  return out;
}

// The agent's titles win over the OCR read: its text, lines, key word, effect and exit; where the title sits and what it
// does at the cuts still come from the measured breakdown.
function withAgent(ocr, agent, shots) {
  return (agent || []).map((t, i) => {
    const near = (ocr || []).filter(o => o.start < t.end && t.start < o.end).sort((a, z) => (Math.min(z.end, t.end) - Math.max(z.start, t.start)) - (Math.min(a.end, t.end) - Math.max(a.start, t.start)))[0];
    return { n: i + 1, start: t.start, end: t.end, text: t.lines.join('/'), lines: t.lines, key: t.key || null, band: near ? near.band : 'top', y: near ? near.y : null, build: t.build || (near && near.build) || null,
      effect: t.effect || null, exit: t.exit || null, ...(t.swap ? { swap: t.swap } : {}), ...(t.count ? { count: t.count } : {}), ...(t.font ? { font: t.font } : {}), ...(t.glow != null ? { glow: t.glow } : {}),
      ...cutFlags(t.start, t.end, shots), conf: 1, fill: near ? near.fill : null, source: 'agent' };
  });
}

// The fields of a phrase title on its Reel.md title line (read back by kit/reelmd.cjs).
function lineFields(t) {
  const f = [`lines ${t.lines.length}`];
  if (t.key) f.push(`key ${t.key}`);
  if (t.build) f.push(`build ${t.build}`);
  if (t.effect) f.push(`effect ${t.effect}`);
  if (t.exit) f.push(`exit ${t.exit}`);
  if (t.swap) f.push(`swap ${t.swap.join(', ')}`);
  if (t.count) f.push(`count ${t.count.from}-${t.count.to}${t.count.unit ? ' ' + t.count.unit : ''}${t.count.final ? ' > ' + t.count.final : ''}`);
  if (t.band) f.push(`band ${t.band}`);
  if (t.glow) f.push('glow on');
  if (t.onCut) f.push('on-cut on');
  if (t.acrossCut) f.push('across-cut on');
  return f;
}
// "1-365 Days > 1 Year" -> { from, to, unit, final }
function parseCount(v) { const m = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)(?:\s+([^>]+?))?(?:\s*>\s*(.+))?$/.exec(String(v || '').trim()); return m ? { from: +m[1], to: +m[2], ...(m[3] ? { unit: m[3].trim() } : {}), ...(m[4] ? { final: m[4].trim() } : {}) } : null; }

module.exports = { BIG, samples, phraseTitles, withAgent, cutFlags, lineFields, parseCount, AGENT_FILE, KEY_FONTS, validateAgentTitles, readAgentTitles, writeAgentTitles };
