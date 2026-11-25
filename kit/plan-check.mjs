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
//   cta        when the plan keeps a call to action, the words have one to show it on
//   face, text, contrast   from the render's own checks
// --fix: each failed row that has a fix (filters, transitions, key words, repo shots left from an older plan) is
// applied to cut.json and captions.js, then checked again, up to --rounds (3). The video changes on the next render
// (Studio: Render again); the report says which fixes wait for it.
// Writes build/plan-check.json { round, rounds, checks: [{ id, selection, ok, measured, time, frame, note, fix }],
// points, fixed, needsRender, looked, at }. --video pulls a small still per checked moment into build/plan-check/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SEC = require('./sections.cjs'), SP = require('./spoken.cjs');
const r2 = x => +(+x).toFixed(2);
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
export const readCaptions = f => { try { const t = readFileSync(f, 'utf8'); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return null; } };
const writeCaptions = (f, c) => writeFileSync(f, 'window.CAPTIONS=' + JSON.stringify(c, null, 1) + ';\n');
const SECTION_WORDS = { hook: 'the hook', cta: 'the call to action', 'hook-cta': 'the hook and the call to action', whole: 'the whole video' };

export function load(build) {
  const plan = readJson(join(build, 'video-plan.json')), cut = readJson(join(build, 'cut.json')), caps = readCaptions(join(build, 'captions.js'));
  return { plan, cut, caps };
}
// the reel's words and the hook and CTA bounds; segments are tagged in place
export function sections(cut, build) {
  let words = []; try { words = SP.timeline(cut.segs, build); } catch {}
  const tt = SEC.times(cut.segs || []), len = tt.length ? tt[tt.length - 1].end : 0, b = SEC.bounds(words, len);
  SEC.tag(cut, words);
  return { words, tt, len, b };
}

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
  (cut.inserts || []).filter(x => x.repo).forEach((x, k) => add(`repo-${k + 1}`, +x.at + 0.3, x.place === 'full' ? 'the repo full screen' : 'the repo split'));
  return pts.sort((p, q) => p.time - q.time);
}

// the measured checks; each row: { id, selection, ok, measured: true, time, note, fix (a fix we can apply, or null) }
export function check({ plan, cut, caps, build }) {
  const rows = [], row = (id, selection, ok, note, extra = {}) => rows.push({ id, selection, ok, measured: true, time: null, note, fix: null, ...extra });
  if (!plan || !cut) return rows;
  const { tt, b } = sections(cut, build), segs = cut.segs || [];
  // filters
  const f = plan.filters || {}, when = f.when || 'whole', ids = Array.isArray(f.ids) ? f.ids.filter(x => x && x !== 'none') : null;
  if (when !== 'whole' || (ids && ids.length)) {
    const want = when === 'hook-cta' ? ['hook', 'cta'] : when === 'whole' ? null : [when];
    const stray = want ? segs.map((s, i) => ({ s, i })).filter(({ s }) => s.finish && !want.includes(s.section)) : [];
    const wide = want && cut.finish && cut.finish !== 'none';
    const odd = ids && ids.length ? [...new Set([cut.finish, ...segs.map(s => s.finish)].filter(x => x && x !== 'none' && !ids.includes(x)))] : [];
    const ok = !stray.length && !wide && !odd.length;
    row('filters', `Filters: ${SECTION_WORDS[when] || when}`, ok,
      ok ? `Filters show only on ${SECTION_WORDS[when] || when}.` : wide ? `A filter covers the whole video, but the plan says ${SECTION_WORDS[when]} only.` : stray.length ? `A filter shows outside ${SECTION_WORDS[when]} (from ${tt[stray[0].i].start.toFixed(1)} s).` : `A filter you did not pick is used: ${odd.join(', ')}.`,
      { time: wide ? 0.5 : stray.length ? r2(tt[stray[0].i].start + 0.2) : null, fix: ok ? null : { kind: 'filters', when, ids } });
  }
  // transitions
  const tr = plan.transitions || {}, picked = Array.isArray(tr.ids) ? tr.ids.filter(Boolean) : null, tw = tr.when || 'every-cut';
  const used = segs.map((s, i) => ({ i, t: s.transition })).filter(x => x.i && x.t && x.t !== 'cut');
  if (picked && picked.length) {
    const odd = used.filter(x => !picked.includes(x.t));
    row('transitions', 'Transitions: the ones you picked', !odd.length, odd.length ? `${odd[0].t} is used at ${tt[odd[0].i].start.toFixed(1)} s, which you did not pick.` : 'Only the transitions you picked are used.', { time: odd.length ? tt[odd[0].i].start : null, fix: odd.length ? { kind: 'transitions-picked', picked } : null });
  }
  if (tw !== 'every-cut') {
    const off = used.filter(x => !SEC.seamAllowed(segs, x.i, tw) && !segs[x.i].jump && !segs[x.i].recut && !((cut.edited && cut.edited.transitions) || []).includes(x.i));
    row('transitions-when', `Transitions: ${tw === 'topic' ? 'when the topic changes' : 'hook and call to action only'}`, !off.length, off.length ? `A transition sits at ${tt[off[0].i].start.toFixed(1)} s, outside where the plan keeps them.` : 'Transitions sit only where the plan keeps them.', { time: off.length ? tt[off[0].i].start : null, fix: off.length ? { kind: 'transitions-when', when: tw } : null });
  }
  // key words
  const kw = (plan.words && plan.words.keyWords && plan.words.keyWords.level) || 'off';
  if (caps) { const have = caps.keyWords || 'off'; row('key-words', `Key words: ${kw}`, have === kw, have === kw ? (kw === 'off' ? 'No key words, as planned.' : `Key words are ${kw}.`) : `The captions have key words ${have}, the plan says ${kw}.`, { fix: have === kw ? null : { kind: 'key-words', level: kw } }); }
  // titles
  const tOn = plan.words && plan.words.titles ? plan.words.titles.on : null, titles = ((caps && caps.flips) || []).filter(x => x.mode === 7);
  if (caps && tOn === false) row('titles', 'Titles: off', !titles.length, titles.length ? `${titles.length} title${titles.length > 1 ? 's are' : ' is'} still in the captions: draft again to take them out.` : 'No titles, as planned.', { time: titles.length ? r2(titles[0].start + 0.3) : null });
  if (caps && tOn === true) row('titles', 'Titles: on', titles.length > 0, titles.length ? `${titles.length} title${titles.length > 1 ? 's' : ''}.` : 'Titles are on but none were made: say a short line that can be one, or add one on Words.', {});
  // repo mode
  const c = plan.content || {}, rep = (cut.inserts || []).filter(x => x.repo);
  if (c.repoFeature) row('repo', 'Repo feature', rep.length > 0, rep.length ? `${rep.filter(x => x.place !== 'full').length} split and ${rep.filter(x => x.place === 'full').length} full screen repo shots.` : 'No repo shots yet: check the links, or try again online.', { time: rep.length ? r2(+rep[0].at + 0.3) : null });
  else if (rep.length) row('repo', 'Repo feature: off', false, 'Repo shots from an earlier plan are still in the cut.', { time: r2(+rep[0].at + 0.3), fix: { kind: 'repo-off' } });
  // a call to action to show the CTA card on
  if (plan.graphics && plan.graphics.cta !== false) row('cta', 'Call to action', b.ctaStart != null, b.ctaStart != null ? `Starts at ${b.ctaStart.toFixed(1)} s.` : 'We did not hear a call to action (like "follow for more"), so there is nowhere to show one. Say one at the end, or turn the call to action off on Extras.', { time: b.ctaStart != null ? r2(b.ctaStart + 0.4) : null });
  // what the render measured
  const fc = readJson(join(build, 'facecheck.json')), tc = readJson(join(build, 'textcheck.json')), lg = readJson(join(build, 'legibility.json'));
  if (fc) { const hit = (fc.hits || [])[0]; row('face', 'Words off your face', fc.faceSafe !== false && !(fc.hits || []).length, fc.faceSafe !== false && !(fc.hits || []).length ? 'No words over your face.' : `Words touch your face${hit && hit.t != null ? ` at ${(+hit.t).toFixed(1)} s` : ''}.`, { time: hit && hit.t != null ? +hit.t : null }); }
  if (tc) { const cl = (tc.clashes || [])[0]; row('text', 'Words not on words', !(tc.clashFrames > 0 || (tc.clashes || []).length), cl ? `Two pieces of text overlap${cl.t != null ? ` at ${(+cl.t).toFixed(1)} s` : ''}.` : 'No text sits on other text.', { time: cl && cl.t != null ? +cl.t : null }); }
  if (lg) { const sp = (lg.spans || [])[0]; row('contrast', 'Easy to read', !(lg.under > 0), lg.under > 0 ? `Some words are hard to read${sp && sp.start != null ? ` at ${(+sp.start).toFixed(1)} s` : ''}.` : 'Every caption is easy to read.', { time: sp && sp.start != null ? +sp.start : null }); }
  return rows.map(r => ({ ...r, time: r.time == null ? null : r2(r.time) }));
}

// apply the fixes we know to cut.json and captions.js; returns the lines that say what changed
export function applyFixes(rows, { cut, caps, build }) {
  const done = [];
  for (const r of rows.filter(x => !x.ok && x.fix)) {
    const fx = r.fix;
    if (fx.kind === 'filters') {
      const have = [...new Set([cut.finish, ...(cut.segs || []).map(s => s.finish), ...(cut.finishIds || [])].filter(x => x && x !== 'none'))];
      const ids = fx.ids && fx.ids.length ? fx.ids : have.length ? have : null;
      if (!ids) continue;
      cut.finishWhen = fx.when; cut.finishIds = ids; sections(cut, build); SEC.applyFinishWhen(cut);
      done.push(`Filters now show only on ${SECTION_WORDS[fx.when] || fx.when}.`);
    } else if (fx.kind === 'transitions-picked') {
      let k = 0; for (let i = 1; i < (cut.segs || []).length; i++) { const s = cut.segs[i]; if (s.transition && s.transition !== 'cut' && !fx.picked.includes(s.transition)) s.transition = fx.picked[k++ % fx.picked.length]; }
      done.push(`Transitions you did not pick were swapped for ${fx.picked.join(', ')}.`);
    } else if (fx.kind === 'transitions-when') {
      cut.transitionsWhen = fx.when; sections(cut, build); SEC.applyTransitionsWhen(cut);
      done.push('Transitions now sit only where the plan keeps them.');
    } else if (fx.kind === 'key-words' && caps) {
      if (fx.level === 'off') delete caps.keyWords; else caps.keyWords = fx.level;
      done.push(`Key words set to ${fx.level}.`);
    } else if (fx.kind === 'repo-off') {
      cut.inserts = (cut.inserts || []).filter(x => !x.repo); if (!cut.inserts.length) delete cut.inserts; delete cut.repoTakeovers;
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

// the whole run: check, fix, check again (up to rounds), and the report
export function run(build, { fix = false, rounds = 3, video = null } = {}) {
  const st = load(build); if (!st.cut) throw new Error('make a draft first: no build/cut.json');
  if (!st.plan) throw new Error('no plan for this video: build it in Studio (Build my own) first');
  st.build = build; const hist = [], fixed = [];
  let rows = check(st), round = 1; hist.push({ round, failed: rows.filter(r => !r.ok).map(r => r.id) });
  while (fix && round < rounds && rows.some(r => !r.ok && r.fix)) {
    const done = applyFixes(rows, st); if (!done.length) break;
    fixed.push(...done.map(note => ({ round, note })));
    writeFileSync(join(build, 'cut.json'), JSON.stringify(st.cut, null, 1)); if (st.caps) writeCaptions(join(build, 'captions.js'), st.caps);
    round++; rows = check(st); hist.push({ round, failed: rows.filter(r => !r.ok).map(r => r.id) });
  }
  const points = checkpoints(st.cut, st.caps, build), old = readJson(join(build, 'plan-check.json'));
  let shots = {}; if (video && existsSync(video)) shots = stills(video, [...points, ...rows.filter(r => r.time != null).map(r => ({ id: `row-${r.id}`, time: r.time }))], join(build, 'plan-check'));
  const frame = id => shots[id] ? `plan-check/${id}.jpg` : null;
  const checks = rows.map(r => ({ ...r, frame: frame(`row-${r.id}`) }));
  const rep = { round, rounds: hist, checks, points: points.map(p => ({ ...p, frame: frame(p.id) })), fixed, needsRender: fixed.length > 0, looked: old && old.looked && !fixed.length ? old.looked : [], at: new Date().toISOString() };
  writeFileSync(join(build, 'plan-check.json'), JSON.stringify(rep, null, 1) + '\n');
  writeFileSync(join(build, 'scene-plan.json'), JSON.stringify(scenePlan(st), null, 1) + '\n');
  return rep;
}
// an agent's looked-at checks: [{ id, selection, ok, note, time }], kept beside the measured ones
export function report(build, looked) {
  const f = join(build, 'plan-check.json'), rep = readJson(f) || { round: 0, rounds: [], checks: [], points: [], fixed: [], looked: [] };
  const clean = (Array.isArray(looked) ? looked : []).filter(x => x && x.id).slice(0, 60).map(x => ({ id: String(x.id).slice(0, 60), selection: String(x.selection || x.id).slice(0, 120), ok: !!x.ok, measured: false, time: Number.isFinite(+x.time) ? r2(x.time) : null, note: String(x.note || '').slice(0, 400) }));
  const byId = new Map((rep.looked || []).map(x => [x.id, x])); clean.forEach(x => byId.set(x.id, x));
  rep.looked = [...byId.values()]; writeFileSync(f, JSON.stringify(rep, null, 1) + '\n');
  return rep;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; }, cmd = a[0];
  if (!['check', 'scene', 'points', 'report'].includes(cmd) || !opt('name')) { console.error('usage: plan-check.mjs check|scene|points|report --name <job> [--jobs dir] [--fix] [--rounds 3] [--video file] [--looked file.json]'); process.exit(2); }
  const build = join(opt('jobs') ? resolve(opt('jobs')) : join(ROOT, 'jobs'), opt('name'), 'build');
  try {
    if (cmd === 'check') {
      const r = run(build, { fix: a.includes('--fix'), rounds: Math.max(1, Math.min(3, +(opt('rounds') || 3))), video: opt('video') });
      if (a.includes('--json')) console.log(JSON.stringify(r));
      else { for (const c of r.checks) console.log(`${c.ok ? 'ok  ' : 'warn'} ${c.selection}: ${c.note}`); r.fixed.forEach(x => console.log(`fixed (round ${x.round}): ${x.note}`)); if (r.needsRender) console.log('Render again to see the fixes.'); }
    } else if (cmd === 'scene') { const st = load(build); if (!st.cut) throw new Error('make a draft first'); writeFileSync(join(build, 'scene-plan.json'), JSON.stringify(scenePlan({ ...st, build }), null, 1) + '\n'); console.log(JSON.stringify({ ok: true })); }
    else if (cmd === 'points') { const st = load(build); if (!st.cut) throw new Error('make a draft first'); console.log(JSON.stringify(checkpoints(st.cut, st.caps, build))); }
    else { const f = opt('looked'); if (!f) throw new Error('--looked <file.json> is needed'); console.log(JSON.stringify(report(build, JSON.parse(readFileSync(f, 'utf8'))))); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
