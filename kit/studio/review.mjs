// Studio review tools, all local and read from files the kit already writes:
//   swapList(Reel.md)   the reference's parts with times (hook, cuts, titles, b-roll, CTA), each mapped to Studio picks
//   cleanup(clips.json) long silences, filler words and flagged retakes from the Whisper word times, for a keep or
//                       remove review; plan() turns the decisions into the cleanup file reel.cjs reads (--cleanup)
//   receipt(choices)    jobs/<job>/choices.json as plain sentences: what was picked for the edit and why
//   commentLine()       a click or box on a preview frame as one Studio chat line for the agent
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const clock = t => { const s = Math.max(0, +t || 0), m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };
export { clock };

// ---------- what to swap ----------
const CTA_STORY = /\b(cta|call|outro|follow|subscribe|payoff|ending|end)\b/i;
const BROLL_STORY = /\b(b-?roll|cutaway|insert|screen|demo|overlay)\b/i;
const CTA_GFX = /^cta-|^(channel|logo)-bug$/;
const BROLL_GFX = /^(screen-card|feature-cards|terminal-session|code-card|data-chart)$/;
export function swapList(recipePath, cat) {
  const RM = require('../reelmd.cjs');
  const r = RM.parse(readFileSync(recipePath, 'utf8'), recipePath);
  const st = r.style || {}, shots = r.shots || [], titles = r.titles || [], graphics = r.graphics || [], cards = r.cards || [];
  const len = +((r.card && r.card.source && r.card.source.duration) || (shots.length ? shots[shots.length - 1].end : 0)) || 0;
  const ok = ref => cat.items[ref] && cat.items[ref].mode !== 'info';
  const refs = list => [...new Set(list.filter(Boolean))].filter(ok).map(ref => ({ ref, kind: cat.items[ref].kind, id: cat.items[ref].id }));
  const fin = v => String(v || '').split(',').map(x => x.trim()).filter(x => x && x !== 'none').map(x => 'finish:' + x);
  const parts = [];
  const add = p => parts.push({ ...p, at: +(+p.at).toFixed(2), end: p.end != null ? +(+p.end).toFixed(2) : null, refs: refs(p.refs || []) });
  // the hook: the first shot (or the first 3 s), with what is on screen in it
  const hookEnd = shots.length ? Math.min(shots[0].end, Math.max(3, Math.min(5, shots[0].end))) : Math.min(3, len || 3);
  const hookTitle = titles.find(t => t.start < hookEnd);
  add({ kind: 'hook', at: 0, end: hookEnd, label: 'Hook', detail: hookTitle ? `Opens on "${hookTitle.text || ''}"` : 'The first shot',
    refs: [hookTitle && hookTitle.entrance && 'entrance:' + hookTitle.entrance, st.captions && 'captionStyle:' + st.captions, st.look && 'look:' + st.look, ...(shots[0] ? fin(shots[0].finish) : []), shots[0] && shots[0].punch && 'editing:punch'] });
  // every cut between shots and how it moves
  for (const sh of shots.slice(1)) {
    const tr = sh.transition || st.transition;
    const isBroll = BROLL_STORY.test(sh.story || '') || sh.broll || /^(on|yes|true)$/i.test(String(sh.cutaway || ''));
    add({ kind: isBroll ? 'broll' : 'cut', at: sh.start, end: sh.end, label: isBroll ? 'B-roll' : `Cut to shot ${sh.n}`,
      ...(isBroll && sh.broll && sh.broll !== true && !/^(on|yes|true)$/i.test(String(sh.broll)) ? { what: String(sh.broll) } : {}),
      detail: [sh.cutaway && (sh.broll && typeof sh.broll === 'string' && !/^(on|yes|true)$/i.test(sh.broll) ? `it shows ${sh.broll}` : 'the reference cuts away here'), tr && tr !== 'none' ? `${tr} transition` : 'hard cut', sh.framing && sh.framing, sh.story && `story ${sh.story}`, sh.punch && `punch ${sh.punch === true ? 'in' : sh.punch}`].filter(Boolean).join(', '),
      refs: [tr && tr !== 'none' && 'transition:' + tr, ...fin(sh.finish), sh.punch && 'editing:punch'] });
  }
  for (const t of titles) if (t !== hookTitle) add({ kind: 'title', at: t.start, end: t.end, label: 'Title', detail: `"${t.text || ''}"${t.entrance ? `, ${t.entrance} entrance` : ''}`, refs: [t.entrance && 'entrance:' + t.entrance, t.layer && t.layer !== 'auto' && 'titleLayer:' + t.layer] });
  for (const c of cards) add({ kind: 'broll', at: c.start, end: c.end, label: 'B-roll', detail: c.chapter ? `chapter card ${c.chapter}` : 'colour card cutaway', refs: [c.chapter ? 'editing:chapter-card' : 'editing:colour-card'] });
  for (const g of graphics) {
    const type = g.type || g.graphic || g.id || '';
    const k = CTA_GFX.test(type) ? 'cta' : BROLL_GFX.test(type) ? 'broll' : 'graphic';
    add({ kind: k, at: g.start, end: g.end, label: k === 'cta' ? 'CTA' : k === 'broll' ? 'B-roll' : 'Graphic', detail: `${type}${g.text ? `: "${g.text}"` : ''}`, refs: ['graphic:' + type] });
  }
  // the CTA: a CTA graphic, else the last shot when its story says so, else the last 3 s
  if (!parts.some(p => p.kind === 'cta') && len) {
    const last = shots[shots.length - 1], at = last && CTA_STORY.test(last.story || '') ? last.start : Math.max(0, len - 3);
    const t = titles.filter(x => x.start >= at).pop();
    add({ kind: 'cta', at, end: len, label: 'CTA', detail: t ? `Ends on "${t.text || ''}"` : last && last.story ? `Last shot, story ${last.story}` : 'The last seconds',
      refs: [t && t.entrance && 'entrance:' + t.entrance, 'graphic:cta-card', ...(last ? fin(last.finish) : []), last && last.punch && 'editing:punch'] });
  }
  const order = { hook: 0, cta: 2 };
  parts.sort((a, b) => a.at - b.at || (order[a.kind] ?? 1) - (order[b.kind] ?? 1));
  return { seconds: len || null, parts: parts.map((p, i) => ({ id: i + 1, ...p })) };
}

// ---------- clean-up pass ----------
export const FILLERS = ['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm'];
const bare = w => String(w || '').toLowerCase().replace(/[^a-z']/g, '');
// items: { id, type: silence | filler | take, clip, from, to, text, why, remove }  (times in clip seconds)
export function cleanup(clipsJson, { silence = 0.7, keepBreath = 0.12 } = {}) {
  const clips = (clipsJson && clipsJson.clips) || [], items = [];
  let n = 0;
  for (const c of clips) {
    const ws = (c.words || []).filter(w => Array.isArray(w) && w[1] >= w[0]);
    if (/^retake/.test(c.status || '')) {
      items.push({ id: `take-${c.id}`, type: 'take', clip: c.id, from: 0, to: +(+c.dur).toFixed(2), text: c.text || '', why: `flagged as a ${c.status.replace(/^retake\s*/, 'retake ').trim()} by the take check`, remove: true });
      continue;
    }
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (FILLERS.includes(bare(w[2]))) items.push({ id: `f-${c.id}-${++n}`, type: 'filler', clip: c.id, from: +Math.max(0, w[0] - 0.03).toFixed(2), to: +(w[1] + 0.03).toFixed(2), text: String(w[2]).trim(), why: 'filler word', remove: true });
      const nx = ws[i + 1];
      if (nx && nx[0] - w[1] > silence) {
        const a = w[1] + keepBreath / 2, b = nx[0] - keepBreath / 2;
        items.push({ id: `s-${c.id}-${++n}`, type: 'silence', clip: c.id, from: +a.toFixed(2), to: +b.toFixed(2), text: `${String(w[2]).trim()} ... ${String(nx[2]).trim()}`, why: `${(nx[0] - w[1]).toFixed(1)} s pause`, remove: true });
      }
    }
  }
  return items;
}
// the decisions as the file reel.cjs reads with --cleanup: cuts per clip (clip seconds) and takes to drop or bring back
export function plan(items, decisions = {}, clipsJson = null) {
  const out = { format: 'aigent-cleanup', version: 1, cuts: {}, drop: [], keep: [] };
  for (const it of items) {
    const remove = decisions[it.id] !== undefined ? !!decisions[it.id] : it.remove;
    if (it.type === 'take') { if (!remove) out.keep.push(it.clip); continue; }
    if (remove) (out.cuts[it.clip] || (out.cuts[it.clip] = [])).push([it.from, it.to]);
  }
  for (const [id, d] of Object.entries(decisions)) if (/^clip:/.test(id) && d) out.drop.push(id.slice(5));
  for (const k of Object.keys(out.cuts)) out.cuts[k].sort((a, b) => a[0] - b[0]);
  const durOf = clipsJson ? Object.fromEntries((clipsJson.clips || []).map(c => [c.id, +c.dur])) : {};
  out.saved = +Object.entries(out.cuts).reduce((a, [, l]) => a + l.reduce((x, [f, t]) => x + (t - f), 0), 0).toFixed(2);
  out.savedTakes = +out.keep.reduce((a, id) => a - (durOf[id] || 0), 0).toFixed(2);
  return out;
}
// remove spans from [from, to] pieces; what reel.cjs does with a clip's cuts (kept here too so the tests check one rule)
export function subtract(spans, cuts) {
  let out = spans.map(s => s.slice());
  for (const [a, b] of cuts || []) out = out.flatMap(([x, y]) => b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([p, q]) => q - p > 0.05));
  return out.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
}

// ---------- edit receipt ----------
// rows: { at (s or null), what, why }; text: the same as plain lines to copy
export function receipt(x) {
  if (!x) return null;
  const sec = [], row = (at, what, why) => ({ at: at == null ? null : +(+at).toFixed(2), what, why: why ? String(why).replace(/\.$/, '') : null });
  const look = [];
  if (x.style) look.push(row(null, `Style from ${x.style.recipe ? `the recipe ${x.style.recipe}` : x.style.pack ? `the pack ${x.style.pack}` : x.style.preset ? `the preset ${x.style.preset}` : 'the kit defaults'}`));
  look.push(row(null, x.locksText ? `Locked: ${x.locksText}` : 'Nothing locked', x.locksText ? 'your picks; the auto-picker only chose inside them' : 'the auto-picker chose freely'));
  if (x.captions) look.push(row(null, `Captions ${x.captions.style || 'kinetic'}, entrance ${x.captions.entrance || 'pop'}${x.captions.fonts ? `, fonts ${x.captions.fonts}` : ''}`, x.captions.entranceWhy));
  if (x.music) look.push(row(null, `Music ${x.music.bed || 'none'}${x.music.beatSync ? ', cuts on the beat' : ''}`, x.music.why || x.music.bedWhy));
  if (x.punch !== undefined) look.push(row(null, `Zoom punch ${x.punch === false ? 'off' : 'on'}`));
  sec.push({ h: 'Look', rows: look });
  const beats = (x.beats || []).map(b => row(b.start, `Beat ${b.n}: ${b.n === 1 ? 'opening shot' : b.jump ? 'jump cut' : `${b.transition || 'glitch'} transition`}${b.finish ? `, ${b.finish} finish` : ''}${b.bigPunch ? ', big punch-in' : ''}`,
    [b.n === 1 || b.jump ? null : b.transitionWhy, b.finish ? b.finishWhy : null].filter(Boolean).join('; ')));
  if (beats.length) sec.push({ h: `Cuts, ${beats.length} beat${beats.length === 1 ? '' : 's'}`, rows: beats });
  const titles = (x.titles || []).map(t => row(t.start, `Title "${t.text}": ${t.entrance || 'engine pick'}, ${t.place || 'centre'}, ${t.layer || 'front'}`, t.entranceWhy));
  sec.push({ h: `Titles, ${titles.length}`, rows: titles.length ? titles : [row(null, 'No kinetic titles')] });
  const gfx = (x.graphics || []).map(g => row(g.start, `${g.id}${g.text ? ` "${g.text}"` : ''}${g.keep === false ? ', removed by you' : ''}`, g.why));
  const cards = (x.cards || []).map(c => row(c.start, `${c.chapter ? `Chapter card ${c.chapter}` : 'Colour card'}${c.bg ? `, ${c.bg}` : ''}`, c.why));
  if (gfx.length || cards.length) sec.push({ h: `Graphics and cards, ${gfx.length + cards.length}`, rows: [...gfx, ...cards].sort((a, b) => a.at - b.at) });
  const n = (x.beats || []).length, t = (x.titles || []).length, g = (x.graphics || []).filter(z => z.keep !== false).length;
  const end = (x.beats || []).reduce((m, b) => Math.max(m, +b.end || 0), 0);
  const summary = `${n} beat${n === 1 ? '' : 's'}${end ? ` over ${Math.round(end)} s` : ''}, ${t} title${t === 1 ? '' : 's'}, ${g} graphic${g === 1 ? '' : 's'}.`;
  const line = r => `- ${r.at != null ? clock(r.at) + ' ' : ''}${r.what}.${r.why ? ` Why: ${r.why}.` : ''}`;
  return { summary, sections: sec, text: `Edit receipt for ${x.job || 'this reel'}: ${summary}\n\n` + sec.map(s => `${s.h}\n${s.rows.map(line).join('\n')}`).join('\n\n') };
}

// ---------- comments on the preview ----------
export function commentLine({ text, t, end, region, video, frame }) {
  const pct = v => Math.round(Math.max(0, Math.min(1, +v || 0)) * 100);
  const where = !region ? 'the whole frame' : region.w > 0.02 || region.h > 0.02
    ? `the box from ${pct(region.x)}% to ${pct(region.x + region.w)}% across and ${pct(region.y)}% to ${pct(region.y + region.h)}% down`
    : `the point ${pct(region.x)}% across and ${pct(region.y)}% down`;
  const when = end != null && +end > +t + 0.05 ? `from ${clock(t)} to ${clock(end)} (${(+t || 0).toFixed(2)} to ${(+end).toFixed(2)} s)` : `at ${clock(t)} (${(+t || 0).toFixed(2)} s)`;
  return `Comment on ${video ? video.split('/').pop() : 'the preview'} ${when}, ${where}: ${String(text || '').trim()}${frame ? ` Frame: ${frame}` : ''}`;
}
