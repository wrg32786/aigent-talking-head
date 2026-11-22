// Settings that rule out other settings, in one place (Will, 2026-11-20: "some settings if selected make other settings
// not be able to be used ... things like that need to be made obvious"). Plain ESM with no imports: Studio's server
// (kit/studio/core.mjs applyPatch and compose), the agent tools (kit/mcp.mjs, through applyPatch) and the page
// (kit/studio/web/src/Style.jsx, BRoll.jsx) all use this file, so the page, the agent and the render agree.
//
// Each rule says which options it covers, when they work, the short reason shown when they do not ("Not with Single
// word captions"), and the one change that makes them work again (the one click switch). The rules mirror what the
// engine does: kit/reel.cjs (--look, --style and titles), kit/overlay.html (caption entrances move Kinetic captions only)
// and kit/studio/core.mjs compose (music, sound effects and pace).
//   blockOf(item, ctx)       the rule that rules an option out right now, or null (the tile is greyed with rule.reason)
//   settle(s, patch, cat)    after a change: picks the change ruled out are turned off (with one line saying so);
//                            a pick the same change asked for that is ruled out is refused, with the reason
//   switchPatch(item, ctx)   the change that makes an option work, plus the pick itself (one click to switch)
//   needsOf(item, ctx)       a softer note: the option works once something is set up (the effects pass, the mask)

const LOOK_STYLE = { kinetic: 'kinetic', oneword: 'oneword', muse: 'pill', classic: 'classic', 'one-word': 'one-word' };
const NAMES = { 'one-word': 'Single word', oneword: 'Oneword', 'sfx-map': 'Sound map', 'sfx-cap': 'Sparse sounds', 'beat-sync': 'Beat sync', punch: 'Punch-in', tighten: 'Tighten pauses' };
const KIND = { transition: 'transition', entrance: 'title entrance', captionEntrance: 'caption entrance', captionStyle: 'captions', graphic: 'graphic', effect: 'effect', finish: 'finish', font: 'font pairing', look: 'look', theme: 'theme', titleLayer: 'title layer', beatSync: '', editing: '' };
export const nameOf = id => NAMES[id] || String(id).split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const styleName = st => `${nameOf(st)} captions`;
// "the Typewriter caption entrance", "Beat sync"
export function labelOf(it) { const k = KIND[it.kind]; return k ? `the ${nameOf(it.id)} ${k}` : nameOf(it.id); }
const one = (s, k) => (s.picks && s.picks[k] && s.picks[k].allow && s.picks[k].allow[0]) || null;

// what the reel will really use, from the session and the catalog's packs (each pack's base preset: look, captionStyle,
// titles). The same order as kit/reel.cjs: a picked look wins over the pack, a picked caption style wins over both.
export function contextOf(s, cat, env = {}) {
  const packs = (cat && cat.packs) || [], p = s.pack ? packs.find(x => x.name === s.pack) : null;
  const sets = { ...((p && p.sets) || {}) }; let from = p ? `the ${p.name} Look` : null;
  const r = s.reference, ex = r && r.mode && r.mode !== 'off' && r.extracted;
  if (ex && (ex.look || ex.captionStyle)) { if (ex.look) sets.look = ex.look; if (ex.captionStyle) sets.captionStyle = ex.captionStyle; from = 'the reference'; }
  const lookPick = one(s, 'look'), stylePick = one(s, 'captionStyle');
  const look = lookPick || sets.look || 'kinetic';
  const style = stylePick || (!lookPick && sets.captionStyle) || LOOK_STYLE[look] || 'kinetic';
  const titles = !lookPick && sets.titles !== undefined ? !!sets.titles : look !== 'classic';
  const titlesFrom = lookPick ? `the ${nameOf(look)} look` : sets.titles !== undefined ? from : 'the Classic look';
  const m = s.music || {}, so = s.sound || {}, pa = s.pace || {};
  // who set the caption style when you did not: the pack, the reference or the look you picked
  const styleFrom = stylePick ? null : !lookPick && sets.captionStyle ? from : lookPick ? `the ${nameOf(look)} look` : from;
  return { look, style, stylePicked: !!stylePick, styleFrom, titles, titlesFrom, bed: m.bed || 'auto', upload: !!m.upload, sfx: so.sfx !== 'off', punch: pa.punch !== 'off', tighten: pa.tighten ?? null,
    effectsReady: env.effectsReady !== false };
}

export const RULES = [
  { id: 'caption-entrance', applies: it => it.kind === 'captionEntrance', ok: c => c.style === 'kinetic',
    by: c => c.styleFrom ? `${c.styleFrom}'s ${styleName(c.style)}` : styleName(c.style), reason: c => `Not with ${styleName(c.style)}${c.styleFrom ? `, set by ${c.styleFrom}` : ''}`, why: 'Caption entrances only move Kinetic captions.',
    fix: () => ({ picks: { 'captionStyle:kinetic': 'allow' } }), done: () => 'Switched to Kinetic captions', act: () => 'Switch to Kinetic captions' },
  { id: 'titles-off', applies: it => it.kind === 'entrance' || it.kind === 'titleLayer' || it.kind === 'titleEffect' || it.kind === 'titleExit', ok: c => c.titles,
    by: c => c.titlesFrom, reason: c => `Titles are off in ${c.titlesFrom}`, why: 'Title entrances and the title layer need titles.',
    // titles on, captions kept as they are
    fix: c => ({ picks: { 'look:kinetic': 'allow', [`captionStyle:${c.style}`]: 'allow' } }), done: () => 'Turned titles on', act: () => 'Turn titles on' },
  { id: 'beat-sync', applies: it => it.kind === 'beatSync' && it.id === 'beat-sync', ok: c => c.bed !== 'none' && !(c.bed === 'upload' && !c.upload),
    by: () => 'No music', reason: () => 'Not with No music', why: 'Beat sync follows the music bed.',
    fix: () => ({ music: { bed: 'auto' } }), done: () => 'Turned music back on', act: () => 'Turn music on' },
  { id: 'sfx-off', applies: it => it.kind === 'editing' && (it.id === 'sfx-map' || it.id === 'sfx-cap'), ok: c => c.sfx,
    by: () => 'Sound effects off', reason: () => 'Not with sound effects off', why: 'There are no sounds to place.',
    fix: () => ({ sound: { sfx: 'on' } }), done: () => 'Turned sound effects on', act: () => 'Turn sound effects on' },
  { id: 'keep-pauses', applies: it => it.kind === 'editing' && it.id === 'tighten', ok: c => c.tighten !== 'off',
    by: () => 'Keep pauses', reason: () => 'Not with Keep pauses', why: 'Keep pauses leaves every pause in.',
    fix: () => ({ pace: { tighten: null } }), done: () => 'Pace back to the Look', act: () => 'Let the Look set the pace' },
  { id: 'punch-off', applies: it => it.kind === 'editing' && it.id === 'punch', ok: c => c.punch,
    by: () => 'Zoom punch off', reason: () => 'Not with Zoom punch off', why: 'The Zoom punch switch is off.',
    fix: () => ({ pace: { punch: 'on' } }), done: () => 'Turned Zoom punch on', act: () => 'Turn Zoom punch on' },
];
// controls that are not tiles (the Music and pace panel)
export const CONTROLS = {
  energy: { ok: c => c.bed === 'auto', reason: c => c.bed === 'none' ? 'Not with No music' : 'Set by the music you picked', fix: () => ({ music: { bed: 'auto' } }), act: 'Use Auto music' },
  cap: { ok: c => c.sfx, reason: () => 'Not with sound effects off', fix: () => ({ sound: { sfx: 'on' } }), act: 'Turn sound effects on' },
};
export function controlOf(id, ctx) { const r = CONTROLS[id]; return r && !r.ok(ctx) ? { reason: r.reason(ctx), fix: r.fix(ctx), act: r.act } : null; }

export function blockOf(it, ctx) {
  if (!it) return null;
  for (const r of RULES) if (r.applies(it) && !r.ok(ctx)) return { id: r.id, reason: r.reason(ctx), why: r.why, by: r.by(ctx), fix: r.fix(ctx), done: r.done(ctx), act: r.act(ctx) };
  return null;
}
// the change that makes an option usable, with the option picked (one click)
export function switchPatch(it, ctx) {
  const b = blockOf(it, ctx); if (!b) return null;
  return { ...b.fix, picks: { ...(b.fix.picks || {}), [it.ref]: 'allow' } };
}

// softer: it works once something is set up (the render says how)
export const PLACE_NEEDS = { top: 'Your head stays under the panel until the person mask is set up (Set up effects on Render).', frame: 'Your head stays inside its card until the person mask is set up (Set up effects on Render).' };
export function needsOf(it, ctx) {
  if (!it || ctx.effectsReady) return null;
  if (it.kind === 'effect') return 'Needs the effects pass set up. Render shows how.';
  if (it.kind === 'titleLayer' && it.id !== 'front') return 'Needs the person mask set up. Until then titles stay in front.';
  return null;
}

// every pick the reel would ignore right now, with the reason (compose drops them and says so; agents read it)
export function conflictsOf(s, cat, env) {
  const ctx = contextOf(s, cat, env), out = [];
  for (const [k, slot] of Object.entries(s.picks || {})) for (const id of (slot && slot.allow) || []) {
    const it = cat.items[`${k}:${id}`], b = blockOf(it, ctx); if (b) out.push({ ref: it.ref, label: labelOf(it), reason: b.reason, fix: b.fix });
  }
  return out;
}

const joinAnd = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const cap1 = x => x ? x[0].toUpperCase() + x.slice(1) : x;
// "Single word captions turned off the Typewriter caption entrance."
function offText(off) {
  const by = new Map(); for (const o of off) { if (!by.has(o.by)) by.set(o.by, []); by.get(o.by).push(o); }
  return [...by].map(([b, os]) => {
    if (os[0].replaced) return `${cap1(b)} replaced your ${joinAnd(os.map(o => styleName(o.it.id)))}.`;
    const kinds = new Set(os.map(o => o.it.kind)), k = KIND[os[0].it.kind];
    const list = kinds.size === 1 && k && os.length > 1 ? `the ${joinAnd(os.map(o => nameOf(o.it.id)))} ${k}s` : joinAnd(os.map(o => labelOf(o.it)));
    return `${cap1(b)} turned off ${list}.`;
  }).join(' ');
}

// after a patch is applied to s. before: the session as it was (pack, picks, music, sound, pace). Turns off the picks
// the change ruled out and refuses a ruled out pick the patch itself asked for. Returns { errs, off, text }.
export function settle(s, p, cat, { before = null, effectsReady } = {}) {
  const errs = [], off = [];
  const asked = new Set(Object.entries((p && p.picks) || {}).filter(([, h]) => h === 'allow').map(([r]) => r));
  const askedKind = k => [...asked].some(r => r.startsWith(k + ':')) || Object.keys((p && p.picks) || {}).some(r => r.startsWith(k + ':'));
  // a Look you pick brings its own captions: your earlier caption style goes (one line says so)
  const lookAsked = [...asked].find(r => r.startsWith('look:'));
  if (lookAsked && before && !askedKind('captionStyle')) {
    const was = before.picks && before.picks.captionStyle && before.picks.captionStyle.allow && before.picks.captionStyle.allow[0];
    const lk = cat.items[lookAsked];
    if (was && lk && LOOK_STYLE[lk.id] !== was && s.picks.captionStyle) { s.picks.captionStyle.allow = []; off.push({ it: cat.items[`captionStyle:${was}`] || { kind: 'captionStyle', id: was, ref: `captionStyle:${was}` }, by: `the ${nameOf(lk.id)} look`, replaced: true }); }
  }
  const ctx = contextOf(s, cat, { effectsReady });
  for (const [k, slot] of Object.entries(s.picks || {})) {
    if (!slot || !slot.allow) continue;
    for (const id of slot.allow.slice()) {
      const it = cat.items[`${k}:${id}`], b = blockOf(it, ctx); if (!b) continue;
      slot.allow = slot.allow.filter(x => x !== id);
      if (asked.has(it.ref)) errs.push(`${it.ref}: ${b.reason}. ${b.why} To switch, send switchFor: "${it.ref}" (it also sends ${JSON.stringify(b.fix)}).`);
      else off.push({ it, by: b.by, rule: b.id });
    }
  }
  return { errs, off: off.map(o => ({ ref: o.it.ref, label: labelOf(o.it), by: o.by })), text: off.length ? offText(off) : '' };
}
// the line for a one click switch: "Switched to Kinetic captions for the Typewriter caption entrance."
export function switchText(it, ctx) { const b = blockOf(it, ctx); return b ? `${b.done} for ${labelOf(it)}.` : ''; }
