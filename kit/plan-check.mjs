// The plan check (docs/specs/studio-builder.md section 10): does the drafted or rendered job do what the builder plan
// says? Measured checks only (no model); an agent adds its own looked-at checks with `report`.
//   node kit/plan-check.mjs check  --name <job> [--jobs <dir>] [--fix] [--rounds 3] [--video <file>] [--json]
//   node kit/plan-check.mjs scene  --name <job> [--jobs <dir>]     where each choice lands: build/scene-plan.json
//   node kit/plan-check.mjs points --name <job> [--jobs <dir>]     the moments to look at, as JSON
//   node kit/plan-check.mjs report --name <job> --looked <file.json> [--jobs <dir>]   add an agent's looked-at checks
//
// Reads build/video-plan.json (Studio writes it beside the draft), build/cut.json, build/captions.js and, after a
// render, the checks the render already wrote (facecheck.json: text off the face; textcheck.json: text on text;
// legibility.json: contrast). One row per selection:
//   filters    the filters sit only in the sections picked (Hook only, CTA only, Hook and CTA) and are picked ones
//   transitions only picked transitions are used, and only on the seams the timing keeps
//   key words  the key words level reaches the captions
//   titles     titles off means none; titles on means at least one
//   repo       repo mode on means repo shots in the cut; off means none
//   repo-rule  repo mode: the repo stays in its card, never full screen and never README or page text
//   cta        when the plan keeps a call to action, the words have one to show it on
//   face, text, contrast   from the render's own checks
// --fix: each failed row that has a fix (filters, transitions, key words, repo shots left from an older plan) is
// applied to cut.json and captions.js, then checked again, up to --rounds (3). The video changes on the next render
// (Studio: Render again); the report says which fixes wait for it.
// Writes build/plan-check.json { round, rounds, checks: [{ id, selection, ok, measured, time, frame, note, fix }],
// points, fixed, needsRender, looked, at }. --video pulls a small still per checked moment into build/plan-check/.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RB = await import('./repo-broll.mjs');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SEC = require('./sections.cjs'), SP = require('./spoken.cjs');
const r2 = x => +(+x).toFixed(2);
export const JOB_RE = /^[a-z0-9][a-z0-9-]{0,48}$/; // as Studio names jobs (kit/studio/core.mjs)
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
export const readCaptions = f => { try { const t = readFileSync(f, 'utf8'); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return null; } };
const writeCaptions = (f, c) => writeFileSync(f, 'window.CAPTIONS=' + JSON.stringify(c, null, 1) + ';\n');
const SECTION_WORDS = { hook: 'the hook', cta: 'the call to action', 'hook-cta': 'the hook and the call to action', whole: 'the whole video' };

export function load(build) {
  const plan = readJson(join(build, 'video-plan.json')), cut = readJson(join(build, 'cut.json')), caps = readCaptions(join(build, 'captions.js'));
  return { plan, cut, caps };
}
// the reel's words and the hook and CTA bounds; segments are tagged in place
// (no word times, as in an edited job whose clips moved: the tags it had stay, as reel.cjs does, and known is false
// when there are none, so no check or fix leans on made-up sections)
export function sections(cut, build) {
  let words = []; try { words = SP.timeline(cut.segs, build); } catch {}
  const segs = cut.segs || [], tt = SEC.times(segs), len = tt.length ? tt[tt.length - 1].end : 0, b = SEC.bounds(words, len);
  const had = segs.some(x => x.section);
  // only real word times tag the cut; without them the tags it had stay and nothing new is written into it
  if (words.length) SEC.tag(cut, words);
  return { words, tt, len, b, known: words.length > 0 || had };
}
// the recording each piece comes from (clips.json "take" beside the clip), for "when the topic changes", as reel.cjs
export function takeOfFor(build) {
  const cache = {};
  return sg => { const f = resolve(build, sg.file || ''), cj = join(dirname(f), 'clips.json');
    if (!(cj in cache)) { try { cache[cj] = JSON.parse(readFileSync(cj, 'utf8')).clips || []; } catch { cache[cj] = []; } }
    const c = cache[cj].find(x => String(x.file || '').split(/[\\/]/).pop() === f.split(/[\\/]/).pop()); return c && c.take ? c.take : null; };
}
const shakeWindow = cut => { try { const B = require('./beats.cjs'); return Math.max(0.15, B.windowOf ? +B.windowOf(cut) || 0 : 0); } catch { return 0.15; } };
// a seam you set yourself (choices --apply), a recreated one or a jump cut: never ours to change
const mineSeam = (cut, i) => { const s = cut.segs[i]; return !!(s.jump || s.recut || ((cut.edited && cut.edited.transitions) || []).includes(i)); };

// the moments to look at: first caption, hook end, CTA start, each title (coming in and settled), each named
// transition mid-seam, each filter boundary, each repo shot start
export function checkpoints(cut, caps, build) {
  const { tt, len, b } = sections(cut, build), pts = [], add = (id, time, what) => { if (time >= 0 && time <= len + 0.01) pts.push({ id, time: r2(time), what }); };
  const flips = (caps && caps.flips) || [];
  const first = flips.find(f => f.mode === 0 || f.mode == null); if (first) add('caption-1', first.start + 0.2, 'the first caption');
  add('hook-end', Math.max(0, b.hookEnd - 0.2), 'the end of the hook');
  if (b.ctaStart != null) add('cta', b.ctaStart + 0.4, 'the call to action');
  flips.filter(f => f.mode === 7).forEach((f, k) => { add(`title-${k + 1}-in`, f.start + 0.15, `title "${String(f.text).slice(0, 40)}" coming in`); add(`title-${k + 1}`, Math.min(f.end, f.start + 0.8), `title "${String(f.text).slice(0, 40)}" settled`); });
  (cut.segs || []).forEach((s, i) => { if (i && s.transition && s.transition !== 'cut') add(`seam-${i}`, tt[i].start, `the ${s.transition} transition`); });
  (cut.segs || []).forEach((s, i) => { if (i && (s.finish || null) !== (cut.segs[i - 1].finish || null)) add(`filter-${i}`, tt[i].start + 0.2, `the filter ${s.finish ? 'starting' : 'ending'}`); });
  (cut.inserts || []).filter(x => x.repo).forEach((x, k) => add(`repo-${k + 1}`, +x.at + 0.3, 'the repo card'));
  (cut.repoTakeovers || []).filter(x => x.who === 'you' && x.why === 'punch line').forEach((x, k) => add(`you-${k + 1}`, +x.at + 0.3, 'you full screen on a punch line'));
  return pts.sort((p, q) => p.time - q.time);
}

// the measured checks; each row: { id, selection, ok, measured: true, time, note, fix (a fix we can apply, or null) }
export function check({ plan, cut, caps, build, state = null, since = 0 }) {
  const rows = [], row = (id, selection, ok, note, extra = {}) => rows.push({ id, selection, ok, measured: true, time: null, note, fix: null, ...extra });
  if (!plan || !cut) return rows;
  const { tt, b, known } = sections(cut, build), segs = cut.segs || [], takeOf = takeOfFor(build);
  // a fix is only offered when Studio's own setting agrees with the plan: the next render passes that setting, so a fix
  // it disagrees with would be undone (state is the session's finishWhen, transitionsWhen and keyWords, when known)
  const agrees = (k, v) => !state || state[k] === undefined || state[k] === v;
  const differs = ' Studio\'s own setting differs from the plan: pick it again in the builder.';
  // filters: ids null is "not chosen", [] is "No filters"
  const f = plan.filters || {}, when = f.when || 'whole', ids = Array.isArray(f.ids) ? f.ids.filter(x => x && x !== 'none') : null;
  const yoursF = new Set((cut.edited && cut.edited.finishes) || []); // pieces whose filter you set yourself stay yours
  const fin = [cut.finish, ...segs.filter((s, i) => !yoursF.has(i)).map(s => s.finish)].filter(x => x && x !== 'none');
  if (ids && !ids.length) {
    const ok = !fin.length;
    row('filters', 'Filters: none', ok, ok ? 'No filters, as planned.' : 'A filter is used, but the plan says no filters.', { time: ok ? null : 0.5, fix: ok ? null : { kind: 'filters-none' } });
  } else if (when !== 'whole' && !known) {
    row('filters', `Filters: ${SECTION_WORDS[when] || when}`, null, 'We could not check where the filters sit: this draft has no word times. Draft again to check it.', {});
  } else if (when === 'cta' && !segs.some(x => x.section === 'cta')) {
    row('filters', 'Filters: the call to action', false, 'We did not hear a call to action, so the filter has nowhere to go. Say one at the end, or pick another filter timing on Look.', {});
  } else if (when !== 'whole') {
    const want = when === 'hook-cta' ? ['hook', 'cta'] : [when];
    const pieces = segs.map((s, i) => ({ s, i })).filter(({ i }) => !yoursF.has(i));
    const stray = pieces.filter(({ s }) => s.finish && s.finish !== 'none' && !want.includes(s.section));
    const wide = cut.finish && cut.finish !== 'none';
    const there = pieces.filter(({ s }) => want.includes(s.section));
    const missing = ids ? there.filter(({ s }) => !(s.finish && ids.includes(s.finish))) : [];
    const odd = ids ? [...new Set(fin.filter(x => !ids.includes(x)))] : [];
    const noCta = want.includes('cta') && !segs.some(s => s.section === 'cta');
    const ok = !stray.length && !wide && !odd.length && !missing.length;
    const fx = ok || !ids ? null : agrees('finishWhen', when) ? { kind: 'filters', when, ids } : null;
    row('filters', `Filters: ${SECTION_WORDS[when] || when}`, ok,
      (ok ? `Filters show only on ${SECTION_WORDS[when]}.` : wide ? `A filter covers the whole video, but the plan says ${SECTION_WORDS[when]} only.` : stray.length ? `A filter shows outside ${SECTION_WORDS[when]} (from ${tt[stray[0].i].start.toFixed(1)} s).` : odd.length ? `A filter you did not pick is used: ${odd.join(', ')}.` : `The filter is missing on ${SECTION_WORDS[when]} (at ${tt[missing[0].i].start.toFixed(1)} s).`)
      + (noCta ? ' We did not hear a call to action, so there is no call to action part for it.' : '') + (!ok && ids && !fx ? differs : ''),
      { time: wide ? 0.5 : stray.length ? r2(tt[stray[0].i].start + 0.2) : missing.length ? r2(tt[missing[0].i].start + 0.2) : null, fix: fx });
  } else if (ids) {
    // the whole video: only picked filters; and when Studio's own timing says whole, a picked filter on every piece
    const odd = [...new Set(fin.filter(x => !ids.includes(x)))];
    const bare = state && state.finishWhen === 'whole' && !(cut.finish && ids.includes(cut.finish)) ? segs.map((x, i) => ({ x, i })).filter(({ x, i }) => !yoursF.has(i) && !(x.finish && ids.includes(x.finish))) : [];
    row('filters', 'Filters: the ones you picked', !odd.length && !bare.length, odd.length ? `A filter you did not pick is used: ${odd.join(', ')}.` : bare.length ? `The filter is missing from ${bare[0].i ? `${tt[bare[0].i].start.toFixed(1)} s` : 'the start'}.` : 'Only the filters you picked are used.', { time: bare.length ? r2(tt[bare[0].i].start + 0.2) : null });
  }
  // transitions
  const tr = plan.transitions || {}, picked = Array.isArray(tr.ids) ? tr.ids.filter(Boolean) : null, tw = tr.when || 'every-cut';
  const used = segs.map((s, i) => ({ i, t: s.transition })).filter(x => x.i && x.t && x.t !== 'cut' && !mineSeam(cut, x.i));
  // a seam the timing made a plain cut keeps its old transition aside (heldTransition); it comes back if the timing allows
  const held = segs.map((s, i) => ({ i, t: s.heldTransition })).filter(x => x.i && x.t && x.t !== 'cut' && !mineSeam(cut, x.i) && SEC.seamAllowed(segs, x.i, tw, takeOf));
  // straight cuts: the default seam is a hard cut with a glitch shake (cut.hits), so a shake at a seam is not straight
  // (also the shakes the timing set aside, cut.heldHits, which come back on the next render, and the caption glitches, captions.js glitchAt)
  const seamShakes = () => [...(cut.hits || []), ...(cut.heldHits || []), ...((caps && caps.glitchAt) || [])];
  const shakes = picked && !picked.length ? segs.map((s, i) => i).filter(i => i && seamShakes().some(h => Math.abs((Array.isArray(h) ? h[0] : h) - tt[i].start) <= 0.15)) : [];
  if (picked) {
    const odd = [...used, ...held].filter(x => !picked.length || !picked.includes(x.t));
    if (!odd.length && shakes.length) odd.push({ i: shakes[0], t: 'glitch' });
    const sel = picked.length ? 'Transitions: the ones you picked' : 'Transitions: straight cuts only';
    row('transitions', sel, !odd.length, odd.length ? (picked.length ? `${odd[0].t} is used at ${tt[odd[0].i].start.toFixed(1)} s, which you did not pick.` : `A ${odd[0].t} transition is used at ${tt[odd[0].i].start.toFixed(1)} s; the plan says straight cuts.`) : picked.length ? 'Only the transitions you picked are used.' : 'Straight cuts only, as planned.', { time: odd.length ? tt[odd[0].i].start : null, fix: odd.length ? { kind: 'transitions-picked', picked } : null });
  }
  if (tw !== 'every-cut' && known && !(picked && !picked.length)) {
    const off = used.filter(x => !SEC.seamAllowed(segs, x.i, tw, takeOf));
    row('transitions-when', `Transitions: ${tw === 'topic' ? 'when the topic changes' : 'hook and call to action only'}`, !off.length, off.length ? `A transition sits at ${tt[off[0].i].start.toFixed(1)} s, outside where the plan keeps them.` : 'Transitions sit only where the plan keeps them.', { time: off.length ? tt[off[0].i].start : null, fix: off.length && agrees('transitionsWhen', tw) ? { kind: 'transitions-when', when: tw } : null });
  }
  // key words
  const kw = (plan.words && plan.words.keyWords && plan.words.keyWords.level) || 'off';
  if (caps) { const have = caps.keyWords || 'off'; row('key-words', `Key words: ${kw}`, have === kw, have === kw ? (kw === 'off' ? 'No key words, as planned.' : `Key words are ${kw}.`) : `The captions have key words ${have}, the plan says ${kw}.`, { fix: have === kw || (state && state.keyWords !== undefined && (state.keyWords || 'off') !== kw) ? null : { kind: 'key-words', level: kw } }); }
  // titles
  const tOn = plan.words && plan.words.titles ? plan.words.titles.on : null, titles = ((caps && caps.flips) || []).filter(x => x.mode === 7);
  if (caps && tOn === false) row('titles', 'Titles: off', !titles.length, titles.length ? `${titles.length} title${titles.length > 1 ? 's are' : ' is'} still in the captions: draft again to take them out.` : 'No titles, as planned.', { time: titles.length ? r2(titles[0].start + 0.3) : null });
  if (caps && tOn === true) row('titles', 'Titles: on', titles.length > 0, titles.length ? `${titles.length} title${titles.length > 1 ? 's' : ''}.` : 'Titles are on but none were made: say a short line that can be one, or add one on Words.', {});
  // repo mode
  const c = plan.content || {}, rep = (cut.inserts || []).filter(x => x.repo);
  if (c.repoFeature) row('repo', 'Repo feature', rep.length > 0, !(c.repos || []).length ? 'Add a repo link on the Content step.' : rep.length ? `${rep.length} repo card shots.` : 'No repo shots yet: check the links, or try again online.', { time: rep.length ? r2(+rep[0].at + 0.3) : null });
  if (c.repoFeature && (cut.inserts || []).length) { const br = RB.repoRuleBreaks(cut.inserts); row('repo-rule', 'Repo shots stay in their card', !br.length, br.length ? `At ${(+br[0].at).toFixed(1)} s: ${br[0].why}. Make the draft again so the repo stays in its card.` : 'No full screen b-roll and no README or page text.', { time: br.length ? r2(+br[0].at + 0.3) : null }); }
  else if (rep.length) row('repo', 'Repo feature: off', false, 'Repo shots from an earlier plan are still in the cut.', { time: r2(+rep[0].at + 0.3), fix: { kind: 'repo-off' } });
  // a call to action to show the CTA card on
  if (plan.graphics && plan.graphics.cta !== false && (known || b.ctaStart != null)) row('cta', 'Call to action', b.ctaStart != null, b.ctaStart != null ? `Starts at ${b.ctaStart.toFixed(1)} s.` : 'We did not hear a call to action (like "follow for more"), so there is nowhere to show one. Say one at the end, or turn the call to action off on Extras.', { time: b.ctaStart != null ? r2(b.ctaStart + 0.4) : null });
  // what the render measured
  // (a result older than the cut or the captions is from an earlier render, so it is left out)
  // (the render writes these, then may touch cut.json itself, so the bar is the draft's captions.js or our last fix)
  // and when the render left its signature (render-sig.json), a cut.json or captions.js changed since then also makes them old
  const sig = readJson(join(build, 'render-sig.json')), same = n => { if (!sig || !sig[n === 'cut.json' ? 'cut' : 'captions']) return true; try { return createHash('sha1').update(readFileSync(join(build, n))).digest('hex') === sig[n === 'cut.json' ? 'cut' : 'captions']; } catch { return false; } };
  const unchanged = same('cut.json') && same('captions.js');
  const fresh = n => { try { return unchanged && statSync(join(build, n)).mtimeMs >= since; } catch { return false; } };
  const rd = n => fresh(n) ? readJson(join(build, n)) : null;
  const fc = rd('facecheck.json'), tc = rd('textcheck.json'), lg = rd('legibility.json');
  const was = ['facecheck.json', 'textcheck.json', 'legibility.json'].some(n => existsSync(join(build, n)) && !fresh(n));
  if (was) row('render-checks', 'Face, text and contrast', null, 'Not checked yet for this draft: render it, then check again.', {});
  if (fc) { const hit = (fc.hits || [])[0]; row('face', 'Words off your face', fc.faceSafe !== false && !(fc.hits || []).length, fc.faceSafe !== false && !(fc.hits || []).length ? 'No words over your face.' : `Words touch your face${hit && hit.t != null ? ` at ${(+hit.t).toFixed(1)} s` : ''}.`, { time: hit && hit.t != null ? +hit.t : null }); }
  if (tc) { const cl = (tc.clashes || [])[0]; row('text', 'Words not on words', !(tc.clashFrames > 0 || (tc.clashes || []).length), cl ? `Two pieces of text overlap${cl.t != null ? ` at ${(+cl.t).toFixed(1)} s` : ''}.` : 'No text sits on other text.', { time: cl && cl.t != null ? +cl.t : null }); }
  // legibility.py writes spans as [start, end, ratio]
  if (lg) { const sp = (lg.spans || [])[0], at = Array.isArray(sp) ? +sp[0] : sp && sp.start != null ? +sp.start : null; row('contrast', 'Easy to read', !(lg.under > 0), lg.under > 0 ? `Some words are hard to read${at != null ? ` at ${at.toFixed(1)} s` : ''}.` : 'Every caption is easy to read.', { time: at }); }
  return rows.map(r => ({ ...r, time: r.time == null ? null : r2(r.time) }));
}

// apply the fixes we know to cut.json and captions.js; returns the lines that say what changed
export function applyFixes(rows, { cut, caps, build }) {
  const done = [];
  for (const r of rows.filter(x => !x.ok && x.fix)) {
    const fx = r.fix;
    if (fx.kind === 'filters') {
      if (!fx.ids || !fx.ids.length) continue;
      const ed = (cut.edited && cut.edited.finishes) || [], keep = ed.map(i => [i, (cut.segs[i] || {}).finish]);
      cut.finishWhen = fx.when; cut.finishIds = fx.ids; sections(cut, build); SEC.applyFinishWhen(cut);
      keep.forEach(([i, f]) => { const sg = cut.segs[i]; if (!sg) return; if (f) sg.finish = f; else delete sg.finish; }); // yours stay (restoreFinish keeps a changed one)
      done.push(`Filters (${fx.ids.join(', ')}) now show only on ${SECTION_WORDS[fx.when] || fx.when}.`);
    } else if (fx.kind === 'filters-none') {
      const ed = new Set((cut.edited && cut.edited.finishes) || []);
      SEC.restoreFinish(cut); delete cut.finish; delete cut.finishWhen; delete cut.finishIds; (cut.segs || []).forEach((s, i) => { if (!ed.has(i)) delete s.finish; });
      done.push('Filters taken off: the plan says no filters.');
    } else if (fx.kind === 'transitions-picked') {
      let k = 0; const at = [];
      const tt = SEC.times(cut.segs || []);
      for (let i = 1; i < (cut.segs || []).length; i++) { const s = cut.segs[i]; if (mineSeam(cut, i)) continue;
        if (s.heldTransition && s.heldTransition !== 'cut' && !fx.picked.includes(s.heldTransition)) delete s.heldTransition;
        if (s.transition && s.transition !== 'cut' && !fx.picked.includes(s.transition)) { s.transition = fx.picked.length ? fx.picked[k++ % fx.picked.length] : 'cut'; at.push(i); }
        if (!fx.picked.length) { const off = h => Math.abs((Array.isArray(h) ? h[0] : h) - tt[i].start) > 0.15;
          for (const [o, k] of [[cut, 'hits'], [cut, 'heldHits'], [caps, 'glitchAt']]) { if (!o || !Array.isArray(o[k])) continue; const n0 = o[k].length; o[k] = o[k].filter(off); if (o[k].length !== n0 && !at.includes(i)) at.push(i); }
          if (Array.isArray(cut.heldHits) && !cut.heldHits.length) delete cut.heldHits; } }
      done.push(fx.picked.length ? `Transitions you did not pick (${at.length}) were swapped for ${fx.picked.join(', ')}.` : `Transitions taken out (${at.length}): the plan says straight cuts.`);
    } else if (fx.kind === 'transitions-when') {
      cut.transitionsWhen = fx.when; sections(cut, build); SEC.applyTransitionsWhen(cut, { takeOf: takeOfFor(build), window: shakeWindow(cut) });
      done.push('Transitions now sit only where the plan keeps them.');
    } else if (fx.kind === 'key-words' && caps) {
      if (fx.level === 'off') delete caps.keyWords; else caps.keyWords = fx.level;
      done.push(`Key words set to ${fx.level}.`);
    } else if (fx.kind === 'repo-off') {
      // b-roll that repo mode put in its card (fullBefore) goes back to full screen, as the repo step does when it is off
      cut.inserts = (cut.inserts || []).filter(x => !x.repo).map(x => { if (!x.fullBefore) return x; const { fullBefore, fit, bands, frameBg, ...y } = x; return { ...y, place: 'full' }; }); if (!cut.inserts.length) delete cut.inserts; delete cut.repoTakeovers;
      done.push('Repo shots from an earlier plan were taken out.');
    }
  }
  return done;
}

// where each choice lands, from the drafted cut (spec 10 step 1): sections, titles, seams with their transition,
// filters per section, repo shots and takeovers
export function scenePlan({ plan, cut, caps, build }) {
  const { tt, b } = sections(cut, build);
  return {
    hookEnd: b.hookEnd, ctaStart: b.ctaStart,
    segments: (cut.segs || []).map((s, i) => ({ i, start: tt[i].start, end: tt[i].end, section: s.section, transitionIn: i ? s.transition || 'cut' : null, filter: s.finish || cut.finish || null })),
    titles: ((caps && caps.flips) || []).filter(x => x.mode === 7).map(x => ({ start: x.start, end: x.end, text: x.text })),
    presenter: ((plan && plan.presenter) || []).map(x => ({ id: x.id, when: x.when, windows: x.when && x.when !== 'whole' ? SEC.windows(cut, x.when === 'hook-cta' ? ['hook', 'cta'] : [x.when]) : [[0, tt.length ? tt[tt.length - 1].end : 0]] })),
    repo: (cut.inserts || []).filter(x => x.repo).map(x => ({ at: x.at, dur: x.dur, place: x.place })), takeovers: cut.repoTakeovers || [],
  };
}

// small stills of each checked moment from a rendered video (FFmpeg), for the Review panel
export function stills(video, points, dir) {
  mkdirSync(dir, { recursive: true }); const out = {};
  for (const p of points) {
    const f = join(dir, `${p.id}.jpg`);
    try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(p.time), '-i', video, '-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '5', f], { stdio: 'ignore', timeout: 30000 }); out[p.id] = f; } catch {}
  }
  return out;
}

// the plan a report was made for, so the page can say when the plan changed after it (check again)
export const planSig = plan => plan ? createHash('sha1').update(JSON.stringify(plan)).digest('hex').slice(0, 16) : null;
// the whole run: check, fix, check again (up to rounds), and the report
export function run(build, { fix = false, rounds = 3, video = null, state = null } = {}) {
  const st = load(build); if (!st.cut) throw new Error('make a draft first: no build/cut.json');
  if (!st.plan) throw new Error('no plan for this video: build it in Studio (Build my own) first');
  const mt = n => { try { return statSync(join(build, n)).mtimeMs; } catch { return 0; } };
  const prev = readJson(join(build, 'plan-check.json'));
  if (!video) { try { const d = dirname(build); video = readdirSync(d).filter(f => /^reel-v\d+\.mp4$/.test(f)).map(f => join(d, f)).sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0] || null; } catch {} }
  st.build = build; st.state = state; st.since = Math.max(mt('captions.js') - 2000, prev && prev.fixedAt ? Date.parse(prev.fixedAt) : 0); const hist = [], fixed = [];
  let rows = check(st), round = 1; hist.push({ round, failed: rows.filter(r => r.ok === false).map(r => r.id) });
  // rounds counts checks, so at least one fix pass even with rounds 1 (check, fix, check again)
  while (fix && round < Math.max(2, rounds) && rows.some(r => r.ok === false && r.fix)) {
    const done = applyFixes(rows.filter(r => r.ok === false), st); if (!done.length) break;
    fixed.push(...done.map(note => ({ round, note })));
    writeFileSync(join(build, 'cut.json'), JSON.stringify(st.cut, null, 1)); if (st.caps) writeCaptions(join(build, 'captions.js'), st.caps);
    st.since = Date.now(); // the render's own checks were for the cut before this fix
    round++; rows = check(st); hist.push({ round, failed: rows.filter(r => r.ok === false).map(r => r.id) });
  }
  // the receipt and Every pick and why follow the fixed cut (kit/choices.cjs, as reel.cjs writes it)
  if (fixed.length) { try { const CH = require('./choices.cjs'); writeFileSync(join(dirname(build), 'choices.json'), JSON.stringify(CH.explain(build), null, 1) + '\n'); } catch {} }
  const points = checkpoints(st.cut, st.caps, build), old = prev;
  const vt = video && existsSync(video) ? statSync(video).mtimeMs : 0, oldAt = old && old.at ? Date.parse(old.at) : 0;
  let shots = {}; if (video && existsSync(video)) shots = stills(video, [...points, ...rows.filter(r => r.time != null).map(r => ({ id: `row-${r.id}`, time: r.time }))], join(build, 'plan-check'));
  const frame = id => shots[id] ? `plan-check/${id}.jpg` : null;
  const checks = rows.map(r => ({ ...r, frame: frame(`row-${r.id}`) }));
  const pending = fixed.length > 0 || !!(old && old.needsRender && vt <= oldAt);
  const rep = { round, rounds: hist, checks, points: points.map(p => ({ ...p, frame: frame(p.id) })), fixed: fixed.length ? fixed : pending && old ? old.fixed || [] : [], needsRender: pending,
    fixedAt: fixed.length ? new Date().toISOString() : old && old.fixedAt || null, planSig: planSig(st.plan),
    // an agent's looks hold until the next draft, fix or render
    looked: old && old.looked && !fixed.length ? old.looked.filter(x => !x.at || (Date.parse(x.at) >= st.since && Date.parse(x.at) >= vt)) : [], at: new Date().toISOString() };
  writeFileSync(join(build, 'plan-check.json'), JSON.stringify(rep, null, 1) + '\n');
  writeFileSync(join(build, 'scene-plan.json'), JSON.stringify(scenePlan(st), null, 1) + '\n');
  return rep;
}
// an agent's looked-at checks: [{ id, selection, ok, note, time }], kept beside the measured ones
export function report(build, looked) {
  const f = join(build, 'plan-check.json'), rep = readJson(f) || { round: 0, rounds: [], checks: [], points: [], fixed: [], looked: [] };
  const now = new Date().toISOString();
  const clean = (Array.isArray(looked) ? looked : []).filter(x => x && x.id).slice(0, 60).map(x => ({ id: String(x.id).slice(0, 60), selection: String(x.selection || x.id).slice(0, 120), ok: !!x.ok, measured: false, time: x.time != null && Number.isFinite(+x.time) ? r2(x.time) : null, note: String(x.note || '').slice(0, 400), at: now }));
  const byId = new Map((rep.looked || []).map(x => [x.id, x])); clean.forEach(x => byId.set(x.id, x));
  rep.looked = [...byId.values()]; writeFileSync(f, JSON.stringify(rep, null, 1) + '\n');
  return rep;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; }, cmd = a[0];
  if (!['check', 'scene', 'points', 'report'].includes(cmd) || !opt('name')) { console.error('usage: plan-check.mjs check|scene|points|report --name <job> [--jobs dir] [--fix] [--rounds 3] [--video file] [--looked file.json]'); process.exit(2); }
  if (!JOB_RE.test(opt('name'))) { console.error('--name: lowercase letters, numbers and dashes'); process.exit(2); }
  const build = join(opt('jobs') ? resolve(opt('jobs')) : join(ROOT, 'jobs'), opt('name'), 'build');
  try {
    if (cmd === 'check') {
      const r = run(build, { fix: a.includes('--fix'), rounds: Math.max(1, Math.min(3, +(opt('rounds') || 3))), video: opt('video') });
      if (a.includes('--json')) console.log(JSON.stringify(r));
      else { for (const c of r.checks) console.log(`${c.ok ? 'ok  ' : c.ok === null ? '?   ' : 'warn'} ${c.selection}: ${c.note}`); r.fixed.forEach(x => console.log(`fixed (round ${x.round}): ${x.note}`)); if (r.needsRender) console.log('Render again to see the fixes.'); }
    } else if (cmd === 'scene') { const st = load(build); if (!st.cut) throw new Error('make a draft first'); writeFileSync(join(build, 'scene-plan.json'), JSON.stringify(scenePlan({ ...st, build }), null, 1) + '\n'); console.log(JSON.stringify({ ok: true })); }
    else if (cmd === 'points') { const st = load(build); if (!st.cut) throw new Error('make a draft first'); console.log(JSON.stringify(checkpoints(st.cut, st.caps, build))); }
    else { const f = opt('looked'); if (!f) throw new Error('--looked <file.json> is needed'); console.log(JSON.stringify(report(build, JSON.parse(readFileSync(f, 'utf8'))))); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
