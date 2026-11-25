// See what the kit picked, and why; change any of it; pin it with a lock. Works on a drafted job (build/cut.json and
// build/captions.js), so it fits between npm run reel -- --draft and --rebuild.
//   npm run choices -- <job>                 print every pick per beat with the reason, and write jobs/<job>/choices.json
//   npm run choices -- <job> --json          the same as JSON
//   npm run choices -- <job> --apply         write your edits in jobs/<job>/choices.json back into the job
//   npm run choices -- <job> --lock "transitions=whip,zoom; titles=typewriter"   pin locks on the job (kit/locks.cjs)
//   then: npm run reel -- --rebuild --name <job>
// What you can edit in choices.json: a beat's "transition" (null = the glitch seam default), "finish" and "bigPunch";
// a title's "entrance", "place" and "layer"; a graphic's "layer", or "keep": false to drop it; captions "entrance".
// Reasons: "locked" (a lock you set), "pack <name>" or "preset <name>" (its style), "recipe", "you" (set by hand or
// by --apply), "kit default", or "engine picks at render" (the next unused title entrance, in a fixed order).
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./rules.cjs');
const B = require('./beats.cjs');
const L = require('./locks.cjs');

const KIT = __dirname, ROOT = path.dirname(KIT);
const ENGINE_ORDER = ['stagger-rise', 'slam', 'blur-rise', 'slide-left', 'elastic', 'flip', 'pop-zoom', 'drop', 'typewriter']; // kit/overlay.html ENTR
const r3 = x => Math.round(+x * 1000) / 1000;

function buildDir(target, jobsDir) {
  const tries = [path.resolve(target), path.resolve(target, 'build'), path.join(jobsDir || path.join(ROOT, 'jobs'), target, 'build')];
  const b = tries.find(d => fs.existsSync(path.join(d, 'cut.json')));
  if (!b) throw new Error(`No drafted job at ${target} (run npm run reel -- <clip> --name <job> --draft first)`);
  return b;
}
const readCut = b => JSON.parse(fs.readFileSync(path.join(b, 'cut.json'), 'utf8'));
const readCaps = b => (fs.existsSync(path.join(b, 'captions.js')) ? R.readCaptions(path.join(b, 'captions.js')) : { flips: [] });
const writeCut = (b, c) => fs.writeFileSync(path.join(b, 'cut.json'), JSON.stringify(c, null, 1));
const writeCaps = (b, c) => fs.writeFileSync(path.join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(c, null, 1) + ';\n');
const styleName = cut => (cut.pack ? `pack ${cut.pack}` : cut.preset ? `preset ${cut.preset}` : null);

function graphicText(f) {
  const v = f.text || (Array.isArray(f.items) ? f.items.join(', ') : '') || f.value || f.name || f.title || '';
  return String(v).replace(/\|/g, ' ').slice(0, 40);
}

// the job's picks, one row per beat, title and graphic, each with its reason
function explain(b) {
  const cut = readCut(b), caps = readCaps(b), locks = L.merge(cut.locks, caps.locks), ps = cut.packStyle || {}, you = cut.edited || {};
  const sn = styleName(cut);
  const beats = [];
  let t = 0;
  (cut.segs || []).forEach((s, i) => {
    const len = s.out - s.in, row = { n: i + 1, start: r3(t), end: r3(t + len) };
    if (i === 0) { row.transition = null; row.transitionWhy = 'first shot'; }
    else if (s.jump) { row.transition = 'cut'; row.transitionWhy = 'jump inside a line (a tightened pause stays a hard cut)'; }
    else {
      const off = cut.glitch === false; // glitch off (a recipe whose reference does not glitch): a plain hard cut
      row.transition = s.transition || (off ? 'cut' : null);
      const v = s.transition || (off ? 'cut' : 'glitch');
      row.transitionWhy = (you.transitions || []).includes(i) ? 'you'
        : cut.weights && cut.weights.transitions && locks.transitions && locks.transitions.includes(v) ? (sn || 'style') + ' weighted pick (' + locks.transitions.join(', ') + ')'
        : locks.transitions && locks.transitions.includes(v) && v !== ps.transition ? 'locked (' + locks.transitions.join(', ') + ')'
          : s.transition && ps.transition === s.transition ? sn || 'style'
            : s.transition && cut.recipe ? 'recipe'
              : s.transition ? 'set in cut.json' : off ? 'hard cut (glitch off' + (cut.recipe ? ': the reference does not glitch)' : ')') : 'kit default: hard cut with the glitch seam';
    }
    const fin = s.finish != null ? s.finish : cut.finish != null ? cut.finish : null;
    row.finish = s.finish != null ? s.finish : null;
    row.finishWhy = fin == null ? 'none' : s.finish == null ? 'the job finish (' + (typeof fin === 'string' ? fin : 'custom') + ')'
      : (you.finishes || []).includes(i) ? 'you' : locks.finishes ? 'locked (' + locks.finishes.join(', ') + ')' : (ps.finishPool || []).includes(s.finish) ? (sn || 'style') + ' finish pool' : 'set in cut.json';
    row.bigPunch = !!s.bigPunch;
    if (s.section) row.section = s.section; // hook, body or cta (kit/sections.cjs)
    if (s.jump) row.jump = true;
    beats.push(row);
    t += len;
  });
  const flips = caps.flips || [];
  const titles = flips.filter(f => f.mode === R.TITLE_MODE).sort((a, b2) => a.start - b2.start);
  const used = new Set(titles.map(f => f.entrance).filter(Boolean)), free = ENGINE_ORDER.filter(e => !used.has(e));
  const titleRows = titles.map((f, i) => {
    const row = { n: i + 1, start: r3(f.start), end: r3(f.end), text: String(f.text || '').replace(/\|/g, ' ') };
    if (f.entrance) {
      row.entrance = f.entrance;
      row.entranceWhy = (you.titles || []).includes(r3(f.start)) ? 'you' : locks.titles && locks.titles.includes(f.entrance) ? 'locked (' + locks.titles.join(', ') + ')' : (ps.entranceOrder || []).includes(f.entrance) ? (sn || 'style') + ' entrance order' : cut.recipe ? 'recipe' : 'set in captions.js';
    } else { row.entrance = null; row.entranceWhy = `engine picks at render: ${free.shift() || ENGINE_ORDER[i % ENGINE_ORDER.length]} (next unused, fixed order)`; }
    row.place = f.place || 'center'; row.layer = f.layer || caps.titleLayer || 'front';
    return row;
  });
  const G = new Map(L.graphics().map(g => [g.mode, g]));
  const graphics = flips.filter(f => G.has(f.mode)).sort((a, b2) => a.start - b2.start).map((f, i) => ({
    n: i + 1, start: r3(f.start), end: r3(f.end), id: G.get(f.mode).id, mode: f.mode, text: graphicText(f), layer: f.layer || 'front', keep: true,
    why: f.why || (cut.recipe ? 'recipe' : 'drafted from what you say'),
  }));
  const cards = flips.filter(f => f.mode === 8).sort((a, b2) => a.start - b2.start).map(f => ({ start: r3(f.start), end: r3(f.end), bg: f.bg || 'olive', ...(f.chapter != null ? { chapter: f.chapter } : {}) }));
  const sfx = Object.entries(cut.sfx || {}).map(([k, v]) => `${k} x${Array.isArray(v) ? v.length : 1}`);
  return {
    job: path.basename(path.dirname(b)), build: path.relative(ROOT, b).split(path.sep).join('/') || b,
    style: { pack: cut.pack || null, preset: cut.preset || null, recipe: cut.recipe || null },
    locks, locksText: L.describe(locks),
    captions: { style: caps.captionStyle || 'kinetic', entrance: caps.captionEntrance || null, entranceWhy: caps.captionEntrance ? (locks.captionEntrance === caps.captionEntrance ? 'locked' : 'set') : 'kit default: pop, per word', fonts: caps.fonts || 'theme' },
    beats, titles: titleRows, graphics, cards,
    // pauses --tighten cut inside a line; keep one with npm run reel -- --keep-pauses <clip>@<at> (Studio: Keep this pause)
    pauses: (cut.tightened || []).map(x => ({ clip: x.clip, at: x.at, resume: x.resume, gap: x.gap, after: x.after, keep: `${x.clip}@${x.at}` })),
    music: { bed: cut.bed ? (typeof cut.bed === 'string' ? path.basename(cut.bed) : 'custom') : null, beatSync: !!cut.beatSync },
    sound: { sfx: sfx.length ? sfx.join(', ') : 'none', sfxMap: !!cut.sfxMap, cap: cut.sfxCap === false ? 'off' : 'on' },
    punch: cut.punch === false ? 'off' : (cut.punch || 0.1),
    edit: 'Edit this file, then: npm run choices -- <job> --apply, then npm run reel -- --rebuild --name <job>',
  };
}

function printTable(x) {
  const L2 = [];
  const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
  L2.push(`choices for ${x.job}  (style: ${x.style.pack ? 'pack ' + x.style.pack : x.style.preset ? 'preset ' + x.style.preset : 'kit default'}${x.style.recipe ? ', recipe ' + x.style.recipe : ''})`);
  L2.push(`locks: ${x.locksText}`);
  L2.push(`captions: ${x.captions.style}, entrance ${x.captions.entrance || 'pop'} (${x.captions.entranceWhy}), fonts ${x.captions.fonts}`);
  L2.push('', 'beats');
  for (const r of x.beats) L2.push(`  ${pad(r.n, 3)} ${pad(r.start.toFixed(2) + '-' + r.end.toFixed(2) + 's', 14)} ${pad(r.n === 1 ? '' : (r.transition || 'glitch'), 12)} ${pad(r.transitionWhy, 44)} finish ${r.finish || '-'}${r.bigPunch ? '  big punch' : ''}`);
  if (x.titles.length) { L2.push('', 'titles'); for (const r of x.titles) L2.push(`  ${pad(r.n, 3)} ${pad(r.start.toFixed(2) + 's', 8)} ${pad('"' + r.text + '"', 28)} ${pad(r.entrance || '(auto)', 13)} ${pad(r.entranceWhy, 44)} ${r.place}, ${r.layer}`); }
  if (x.graphics.length) { L2.push('', 'graphics'); for (const r of x.graphics) L2.push(`  ${pad(r.n, 3)} ${pad(r.start.toFixed(2) + 's', 8)} ${pad(r.id, 18)} ${pad('"' + r.text + '"', 28)} ${r.why}`); }
  if (x.pauses && x.pauses.length) { L2.push('', 'pauses cut (keep one: --keep-pauses <clip>@<at>)'); for (const r of x.pauses) L2.push(`  ${pad(r.clip, 10)} ${pad(r.at + '-' + r.resume + ' s', 14)} ${r.gap} s after "${r.after}"`); }
  if (x.cards.length) L2.push('', `cards: ${x.cards.map(c => `${c.start}s ${c.bg}${c.chapter != null ? ' #' + c.chapter : ''}`).join(', ')}`);
  L2.push('', `music: ${x.music.bed || 'none'}${x.music.beatSync ? ', beat-synced' : ''};  sound: ${x.sound.sfx}${x.sound.sfxMap ? ', mapped to moves' : ''};  punch: ${x.punch}`);
  return L2.join('\n');
}

// choices.json edits -> the job. Returns lines saying what changed.
function apply(b, edited) {
  const cut = readCut(b), caps = readCaps(b), log = [], errs = [];
  const T = L.transitionNames(), CE = L.captionEntrances(), locks = L.merge(cut.locks, caps.locks);
  cut.edited = cut.edited || {};
  const mark = (k, v) => { const a = cut.edited[k] || (cut.edited[k] = []); if (!a.includes(v)) a.push(v); };
  for (const row of edited.beats || []) {
    const i = row.n - 1, s = (cut.segs || [])[i];
    if (!s) { errs.push(`beat ${row.n}: no such beat`); continue; }
    if (i > 0 && !s.jump && 'transition' in row) {
      const want = row.transition || null;
      if (want && !T.includes(want)) errs.push(`beat ${row.n}: unknown transition "${want}" (npm run list -- transitions)`);
      else if ((s.transition || null) !== want) {
        if (want) s.transition = want; else delete s.transition;
        mark('transitions', i); log.push(`beat ${row.n}: transition ${want || 'glitch (default)'}`);
        if (locks.transitions && !locks.transitions.includes(want || 'glitch')) log.push(`  note: outside your transitions lock (${locks.transitions.join(', ')}); your edit wins`);
      }
    }
    if ('finish' in row && (s.finish || null) !== (row.finish || null)) {
      if (row.finish) { try { B.parseFinish(row.finish); s.finish = row.finish; mark('finishes', i); log.push(`beat ${row.n}: finish ${row.finish}`); } catch (e) { errs.push(`beat ${row.n}: ${e.message}`); } }
      else { delete s.finish; mark('finishes', i); log.push(`beat ${row.n}: no finish`); }
    }
    if ('bigPunch' in row && !!s.bigPunch !== !!row.bigPunch) { if (row.bigPunch) s.bigPunch = true; else delete s.bigPunch; log.push(`beat ${row.n}: big punch ${row.bigPunch ? 'on' : 'off'}`); }
  }
  const flips = caps.flips || [];
  for (const row of edited.titles || []) {
    const f = flips.find(x => x.mode === R.TITLE_MODE && Math.abs(x.start - row.start) < 0.01);
    if (!f) { errs.push(`title at ${row.start}s: no title starts there (keep "start" as it was)`); continue; }
    if (row.entrance !== undefined && (f.entrance || null) !== (row.entrance || null)) {
      if (row.entrance && !R.ENTRANCES.includes(row.entrance)) errs.push(`title at ${row.start}s: unknown entrance "${row.entrance}" (${R.ENTRANCES.join(', ')})`);
      else { if (row.entrance) f.entrance = row.entrance; else delete f.entrance; mark('titles', r3(f.start)); log.push(`title at ${row.start}s: entrance ${row.entrance || '(engine picks)'}`); }
    }
    if (row.place && row.place !== (f.place || 'center')) { if (!['left', 'right', 'above', 'chest', 'face', 'center'].includes(row.place)) errs.push(`title at ${row.start}s: place "${row.place}"`); else { if (row.place === 'center') delete f.place; else f.place = row.place; log.push(`title at ${row.start}s: place ${row.place}`); } }
    if (row.layer && row.layer !== (f.layer || caps.titleLayer || 'front')) { if (!R.TITLE_LAYERS.includes(row.layer)) errs.push(`title at ${row.start}s: layer "${row.layer}"`); else { f.layer = row.layer; log.push(`title at ${row.start}s: layer ${row.layer}`); } }
  }
  const G = new Map(L.graphics().map(g => [g.id, g]));
  let out = flips;
  for (const row of edited.graphics || []) {
    const g = G.get(row.id), f = g && out.find(x => x.mode === g.mode && Math.abs(x.start - row.start) < 0.01);
    if (!f) { errs.push(`graphic ${row.id} at ${row.start}s: not in the job`); continue; }
    if (row.keep === false) { out = out.filter(x => x !== f); log.push(`graphic ${row.id} at ${row.start}s: dropped`); continue; }
    if (row.layer && row.layer !== (f.layer || 'front')) { f.layer = row.layer; log.push(`graphic ${row.id} at ${row.start}s: layer ${row.layer}`); }
  }
  caps.flips = out;
  const ce = edited.captions && edited.captions.entrance;
  if (ce !== undefined && (caps.captionEntrance || null) !== (ce || null)) {
    if (ce && !CE.includes(ce)) errs.push(`captions entrance "${ce}" (${CE.join(', ')})`);
    else { if (ce) caps.captionEntrance = ce; else delete caps.captionEntrance; log.push(`captions: entrance ${ce || 'pop (default)'}`); }
  }
  // the same entrance on two titles is your call: let the plan check allow it
  const ents = out.filter(x => x.mode === R.TITLE_MODE && x.entrance).map(x => x.entrance);
  if (new Set(ents).size < ents.length) caps.entranceRepeat = true;
  if (errs.length) throw new Error('choices.json problems:\n- ' + errs.join('\n- '));
  writeCut(b, cut); writeCaps(b, caps);
  return log;
}

function lockJob(b, locks) {
  const errs = L.validate(locks);
  if (errs.length) throw new Error(errs.join('; '));
  const cut = readCut(b), caps = readCaps(b);
  const log = [...L.applyCut(locks, cut, { weights: cut.weights }), ...L.applyCaptions(locks, caps)];
  writeCut(b, cut); writeCaps(b, caps);
  return log;
}

// self-test for npm run check: a tiny drafted job in a temp folder, explained, edited and locked
function selfTest() {
  const errs = [], os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-choices-')), b = path.join(dir, 'build');
  try {
    fs.mkdirSync(b);
    const chk = L.graphics().find(g => g.id === 'checklist');
    writeCut(b, { segs: [{ in: 0, out: 2 }, { in: 2, out: 4, transition: 'crossfade' }, { in: 4, out: 5, jump: true }, { in: 5, out: 7 }], preset: 'magazine', packStyle: { transition: 'crossfade', entranceOrder: ['typewriter'] }, hits: [] });
    writeCaps(b, { flips: [{ start: 0.2, end: 1.5, mode: 7, text: 'Hook', entrance: 'typewriter' }, { start: 5.2, end: 6.5, mode: 7, text: 'Payoff' }, { start: 2.5, end: 4, mode: chk.mode, items: ['One', 'Two'] }] });
    const x = explain(b);
    if (x.beats.length !== 4) errs.push('explain: beats ' + x.beats.length);
    if (!/preset magazine/.test(x.beats[1].transitionWhy)) errs.push('explain: crossfade should come from the preset, got ' + x.beats[1].transitionWhy);
    if (!/glitch/.test(x.beats[3].transitionWhy)) errs.push('explain: a seam with no transition is the glitch default, got ' + x.beats[3].transitionWhy);
    if (!/engine picks at render: stagger-rise/.test(x.titles[1].entranceWhy)) errs.push('explain: engine entrance, got ' + x.titles[1].entranceWhy);
    if (x.graphics[0].id !== 'checklist') errs.push('explain: graphics');
    x.beats[3].transition = 'whip'; x.titles[1].entrance = 'typewriter'; x.graphics[0].keep = false;
    apply(b, x);
    const cut = readCut(b), caps = readCaps(b);
    if (cut.segs[3].transition !== 'whip') errs.push('apply: transition not written');
    if (caps.flips.some(f => f.mode === chk.mode)) errs.push('apply: graphic not dropped');
    if (!caps.entranceRepeat) errs.push('apply: a repeated entrance by hand should set entranceRepeat');
    if (!/^you$/.test(explain(b).beats[3].transitionWhy)) errs.push('explain after apply: reason should be you');
    let threw = false; try { apply(b, { beats: [{ n: 2, transition: 'nope' }] }); } catch { threw = true; }
    if (!threw) errs.push('apply accepted an unknown transition');
    lockJob(b, L.parse('transitions=dissolve; titles=slam'));
    const c2 = readCut(b), k2 = readCaps(b);
    if (c2.segs[1].transition !== 'dissolve' || c2.segs[2].transition) errs.push('lockJob: transitions ' + JSON.stringify(c2.segs.map(s => s.transition)));
    if (k2.flips.filter(f => f.mode === 7).some(f => f.entrance !== 'slam')) errs.push('lockJob: title entrances');
    if (!/locked/.test(explain(b).beats[1].transitionWhy)) errs.push('explain after lock: reason should be locked');
  } catch (e) { errs.push('choices self-test threw: ' + e.message); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return errs;
}

module.exports = { explain, printTable, apply, lockJob, buildDir, ENGINE_ORDER, selfTest };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = k => argv.includes('--' + k);
  const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
  const VALUED = new Set(['lock', 'jobs']);
  const target = argv.find((a, i) => !a.startsWith('--') && !(i && VALUED.has(argv[i - 1].replace(/^--/, ''))));
  const JSON_OUT = flag('json');
  try {
    if (!target) throw new Error('usage: npm run choices -- <job> [--apply] [--lock "..."] [--json]');
    const b = buildDir(target, opt('jobs') ? path.resolve(opt('jobs')) : undefined), file = path.join(path.dirname(b), 'choices.json');
    let log = [];
    if (flag('apply')) {
      if (!fs.existsSync(file)) throw new Error(`No ${file}; run npm run choices -- ${target} first`);
      log = apply(b, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (opt('lock')) log.push(...lockJob(b, L.parse(opt('lock'))));
    const x = explain(b);
    fs.writeFileSync(file, JSON.stringify(x, null, 1) + '\n');
    const next = log.length ? `next: npm run reel -- --rebuild --name ${x.job}` : `edit ${path.relative(process.cwd(), file)}, then npm run choices -- ${target} --apply`;
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, changed: log, choices: path.relative(ROOT, file), next, ...x }));
    else { log.forEach(l => console.log(l)); if (log.length) console.log(''); console.log(printTable(x)); console.log('\n' + next); }
  } catch (e) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: e.message }));
    console.error(e.message || e);
    process.exit(1);
  }
}
