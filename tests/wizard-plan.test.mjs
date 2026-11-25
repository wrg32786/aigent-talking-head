// The Studio builder plan (kit/studio/wizard/plan.mjs, docs/specs/studio-builder.md section 4): defaults for every
// pace, plain errors, the plan turned into the same picks a click on the classic steps makes, a classic change read
// back into the plan with its plan-only choices kept, no big titles and no filters reaching the reel's locks, the
// plan riding into the next video with Keep my look, a saved look as a plan, and the page route and MCP tools.
// Run: node tests/wizard-plan.test.mjs   (npm run check runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'wizard-plan-test-'));
process.env.STUDIO_DIR = STATE;
const VP = await import('../kit/studio/wizard/plan.mjs');
const FL = await import('../kit/studio/wizard/from-look.mjs');
const C = await import('../kit/studio/core.mjs');
const API = await import('../kit/studio/wizard/api.mjs');
const cat = C.catalog();
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const fresh = () => C.defaultState();
const apply = (s, p) => { const r = C.applyPatch(s, p, cat); assert.deepStrictEqual(r.errs, [], JSON.stringify(p)); return s; };
const picksOf = s => JSON.stringify(Object.fromEntries(Object.entries(s.picks).map(([k, v]) => [k, { allow: [...v.allow].sort(), deny: [...v.deny].sort() }]).filter(([, v]) => v.allow.length || v.deny.length).sort()));
const reel = s => { const c = C.compose(s); return { lock: c.lockString, args: c.args.join(' ') }; };

try {
  await t('every pace gives a plan that passes the check, from calm to high energy', () => {
    for (const pace of Object.keys(VP.PACES)) { const v = VP.validate(VP.defaults(pace), cat); assert.ok(v.ok, pace + ': ' + v.errs.join('; ')); }
    assert.deepStrictEqual(VP.PACE_ORDER, ['calm', 'steady', 'lively', 'high']);
    assert.strictEqual(VP.defaults('calm').presenter.some(x => x.id === 'punch'), false, 'calm has no zoom punch');
    assert.strictEqual(VP.defaults('high').music.energy, 'high');
  });

  await t('errors are plain English, with no em dash, and name what is wrong', () => {
    const bad = VP.normalize({ pace: 'zoomy', words: { type: 'captions', entrance: 'pop', look: 'kinetic' }, transitions: { ids: ['nope'] }, content: { repoFeature: true }, presenter: [{ id: 'fly', when: 'whole' }] });
    const v = VP.validate(bad, cat); assert.strictEqual(v.ok, false);
    const text = v.errs.join('\n');
    for (const want of [/Pacing/, /only moves kinetic words/, /kinetic style/, /Transitions: we do not have one called nope/, /add at least one repo link/, /Presenter effects: we do not have one called fly/]) assert.match(text, want);
    assert.ok(!/\u2014/.test(text), 'no em dash');
    assert.ok(!/allow|deny|captionStyle|flag/.test(v.errs.filter(e => !e.startsWith('All options')).join(' ')), 'no engine words');
    // a section of the wrong shape is a plain error, never a crash
    for (const junk of [{ words: null }, { content: 'x' }, { advanced: null }, { words: { titles: { entrances: 5 } } }, { presenter: {} }, { pace: 'constructor' }]) {
      const r = VP.validate({ format: 'aigent-video-plan', ...junk }, cat); assert.strictEqual(r.ok, false, JSON.stringify(junk)); }
    assert.match(VP.validate({ format: 'aigent-video-plan', presenter: [{ id: 'punch', when: 'hook' }] }, cat).errs.join(' '), /whole video/);
  });

  await t('a plan sets the same picks as the same clicks on the classic steps', () => {
    const cases = [
      [{ words: { type: 'kinetic', entrance: 'pop' } }, { picks: { 'captionStyle:kinetic': 'allow', 'captionEntrance:pop': 'allow' } }],
      [{ words: { type: 'captions', look: 'pill', fonts: 'druk', colors: { theme: 'magazine' } } }, { picks: { 'captionStyle:pill': 'allow', 'font:druk': 'allow', 'theme:magazine': 'allow' }, titles: 'off' }], // just captions: no big titles (spec 14.2)
      [{ transitions: { ids: ['whip', 'glitch'], when: 'every-cut' } }, { picks: { 'transition:whip': 'allow', 'transition:glitch': 'allow' } }],
      [{ filters: { ids: ['mono'], when: 'whole' }, music: { beatSync: false } }, { picks: { 'finish:mono': 'allow', 'beatSync:no-beat-sync': 'allow' }, finishWhen: 'whole' }], // filters chosen in the builder show (spec 14.1)
      [{ presenter: [{ id: 'punch', when: 'whole' }, { id: 'behind-head', when: 'whole' }, { id: 'effect:slow-push', when: 'whole' }] }, { picks: { 'titleLayer:behind': 'allow', 'effect:slow-push': 'allow' } }],
      [{ graphics: { agent: false, nameTag: false, numbers: true, stickers: true, cta: true, cards: false } }, { picks: { 'graphic:lower-third': 'deny', 'editing:cards-auto': 'deny' } }],
    ];
    for (const [plan, clicks] of cases) {
      const a = apply(fresh(), { videoPlan: VP.touch(VP.normalize(plan), ...Object.keys(plan)) }), b = apply(fresh(), clicks);
      assert.strictEqual(picksOf(a), picksOf(b), JSON.stringify(plan));
      assert.deepStrictEqual(reel(a), reel(b), JSON.stringify(plan));
    }
  });

  await t('just captions turns titles and key words off without losing the kinetic choices', () => {
    let s = apply(fresh(), { videoPlan: VP.touch({ words: { type: 'kinetic', entrance: 'pop', keyWords: { level: 'strong' }, titles: { on: null, entrances: ['slam'] } } }, 'words') });
    s = apply(s, { picks: { 'captionStyle:kinetic': 'clear', 'captionStyle:classic': 'allow' }, titles: 'off' });
    const p = VP.fromState(s, s.videoPlan);
    assert.strictEqual(p.words.type, 'captions'); assert.strictEqual(p.words.keyWords.level, 'off'); assert.strictEqual(p.words.entrance, null);
    assert.notStrictEqual(p.words.titles.on, false, 'the derived titles off is not your own choice');
    assert.ok(VP.validate(p).ok, VP.validate(p).errs.join(' '));
  });
  await t('a words choice wins over an All options pick of the same kind', () => {
    const p = VP.withWords(VP.normalize({ advanced: { picks: { 'entrance:slam': 'deny', 'font:modern': 'allow', 'transition:whip': 'allow' } } }), { fonts: 'druk', titles: { entrances: ['slam'] } });
    assert.deepStrictEqual(p.advanced.picks, { 'transition:whip': 'allow' });
  });
  await t('transition timing reaches the reel, and straight cuts or the look picking leave it as it was', () => {
    const a = apply(fresh(), { videoPlan: VP.normalize({ transitions: { ids: ['whip'], when: 'topic' } }) });
    assert.strictEqual(a.transitionsWhen, 'topic'); assert.ok(reel(a).args.includes('--transitions-when topic'));
    const b = apply(fresh(), { videoPlan: VP.normalize({ transitions: { ids: [], when: 'topic' } }) });
    assert.ok(!reel(b).args.includes('--transitions-when'));
    assert.strictEqual(VP.fromState(a, null, cat).transitions.when, 'topic');
    const calm = VP.pacePatch(VP.normalize({}), 'calm'); assert.strictEqual(calm.patch.transitionsWhen, 'topic');
    const mine = VP.pacePatch(VP.normalize({ transitions: { ids: ['whip'], when: 'hook-cta' } }), 'high'); assert.strictEqual(mine.patch.transitionsWhen, 'hook-cta', 'a timing set elsewhere stays');
    const sc = apply(fresh(), { videoPlan: VP.normalize({ transitions: { ids: [], when: 'hook-cta' } }) }); assert.strictEqual(VP.fromState(sc, sc.videoPlan, cat).transitions.when, 'hook-cta');
    const g = VP.withPart(VP.normalize({ graphics: { agent: false, nameTag: true, numbers: true, stickers: true, cta: true, cards: null }, advanced: { picks: { 'graphic:stat-callout': 'deny' } } }), 'graphics', { cta: false });
    assert.deepStrictEqual(g.advanced.picks, { 'graphic:stat-callout': 'deny' }, 'turning off the call to action keeps a numbers pick');
  });
  await t('a Between shots, You on screen or Extras choice wins over All options picks it speaks for', () => {
    const base = VP.normalize({ advanced: { picks: { 'transition:film': 'allow', 'effect:lean-in': 'deny', 'graphic:lower-third': 'allow', 'font:anton': 'allow' } } });
    assert.deepStrictEqual(Object.keys(VP.withPart(base, 'transitions', { ids: ['whip'] }).advanced.picks).sort(), ['effect:lean-in', 'font:anton', 'graphic:lower-third']);
    assert.deepStrictEqual(Object.keys(VP.withPart(base, 'presenter', [{ id: 'effect:lean-in', when: 'hook' }]).advanced.picks).sort(), ['font:anton', 'graphic:lower-third', 'transition:film']);
    const g = VP.withPart(base, 'graphics', { agent: false, nameTag: false }); assert.ok(!('graphic:lower-third' in g.advanced.picks)); assert.ok(g.touched.includes('graphics'));
    assert.ok(VP.withPart(base, 'transitions', { when: 'hook-cta' }).touched.includes('transitions.when'));
  });
  await t('a pace change leaves the choices you made yourself alone', () => {
    let p = VP.defaults('calm'); p.music.energy = 'high'; p = VP.touch(p, 'music.energy');
    const q = VP.applyPace(p, 'high');
    assert.strictEqual(q.pace, 'high'); assert.strictEqual(q.music.energy, 'high'); assert.strictEqual(q.music.beatSync, true);
    const r = VP.applyPace(VP.touch(q, 'presenter'), 'calm');
    assert.ok(r.presenter.some(x => x.id === 'punch'), 'your presenter list stays');
    assert.strictEqual(r.music.beatSync, false, 'what you did not touch follows the pace');
  });

  await t('a pace picked on its own keeps classic edits and moves nothing else', () => {
    const font = Object.values(cat.items).find(it => it.kind === 'font').id, pack = cat.packs[0].name;
    // a classic step set music energy and a font; the session has a pack and no builder plan yet
    const s = apply(fresh(), { pack, picks: { [`font:${font}`]: 'allow' }, music: { energy: 'low' } });
    s.fontLock = false; const before = picksOf(s);
    const { plan, patch } = VP.pacePatch(API.planOf(s, cat), 'high');
    assert.ok(!patch.clearPicks && !('pack' in patch) && !('styleLook' in patch), 'the pace patch only sets what a pace sets');
    apply(s, patch); s.videoPlan = plan;
    assert.strictEqual(s.music.energy, 'low', 'energy set on a classic step stays');
    assert.strictEqual(s.pace.tighten, 0.25); assert.strictEqual(s.pace.punch, 'on');
    assert.strictEqual(s.pack, pack, 'the pack stays'); assert.strictEqual(s.fontLock, false, 'a pace click never makes a font yours');
    const after = JSON.parse(picksOf(s)); assert.deepStrictEqual(after.beatSync, { allow: ['beat-sync'], deny: [] }); delete after.beatSync;
    assert.deepStrictEqual(after, JSON.parse(before), 'only the beat sync pick moved');
    // the next pace still follows for what you never touched
    const r = VP.pacePatch(API.planOf(s, cat), 'calm'); apply(s, r.patch);
    assert.strictEqual(s.pace.tighten, 'off'); assert.strictEqual(s.pace.punch, 'off'); assert.strictEqual(s.music.energy, 'low');
  });

  await t('a words step changes only the picks it moves', () => {
    const pack = cat.packs[0].name, sc = Object.values(cat.items).find(it => it.kind === 'graphic').ref;
    const s = apply(fresh(), { pack, picks: { [sc]: 'deny', 'captionStyle:classic': 'allow' }, music: { energy: 'low' } });
    const prev = API.planOf(s, cat), next = VP.withWords(prev, { type: 'kinetic', look: 'kinetic', entrance: 'cascade', keyWords: { level: 'strong' } });
    assert.ok(VP.validate(next, cat).ok, VP.validate(next, cat).errs.join(' '));
    const patch = VP.diffPatch(prev, next, cat);
    assert.ok(!patch.clearPicks && !('pack' in patch) && !('music' in patch), JSON.stringify(patch));
    apply(s, patch);
    assert.deepStrictEqual(s.picks.captionStyle.allow, ['kinetic']); assert.deepStrictEqual(s.picks.captionEntrance.allow, ['cascade']);
    assert.strictEqual(s.keyWords, 'strong'); assert.strictEqual(s.pack, pack); assert.strictEqual(s.music.energy, 'low');
    assert.ok(s.picks.graphic.deny.includes(sc.split(':')[1]), 'a pick the step does not speak for stays');
    // and back: plain captions take the entrance and key words away again
    const back = VP.withWords(API.planOf(s, cat), { type: 'captions', look: 'pill', entrance: null, keyWords: { level: 'off' } });
    apply(s, VP.diffPatch(API.planOf(s, cat), back, cat));
    assert.deepStrictEqual(s.picks.captionStyle.allow, ['pill']); assert.deepStrictEqual(s.picks.captionEntrance.allow, []); assert.strictEqual(s.keyWords, 'off');
  });

  await t('a pace compares against the pace saved last, not a guess from the pause length', () => {
    // a new session with a hand-set pause of 0.6 s: nothing else was touched, so Calm sets all of its fields
    let s = apply(fresh(), { pace: { tighten: 0.6 } }), r = VP.pacePatch(API.planOf(s, cat), 'calm', s.videoPlan && s.videoPlan.pace);
    apply(s, r.patch); s.videoPlan = r.plan;
    assert.strictEqual(s.music.energy, 'low'); assert.strictEqual(s.pace.punch, 'off'); assert.strictEqual(s.pace.tighten, 'off');
    // Lively, then pauses turned off on a classic step, then High: Lively's own values were never yours
    r = VP.pacePatch(API.planOf(s, cat), 'lively', s.videoPlan.pace); apply(s, r.patch); s.videoPlan = r.plan;
    apply(s, { pace: { tighten: 'off' } });
    r = VP.pacePatch(API.planOf(s, cat), 'high', s.videoPlan.pace); apply(s, r.patch); s.videoPlan = r.plan;
    assert.strictEqual(s.music.energy, 'high'); assert.deepStrictEqual(r.plan.touched, ['pace']);
  });

  await t('a session from the classic steps reads into a plan and back to the same picks and reel', () => {
    const sessions = [
      { picks: { 'captionStyle:hormozi': 'allow', 'transition:whip': 'allow', 'graphic:checklist': 'allow', 'effect:todo': 'allow' } },
      { picks: { 'transition:glitch': 'deny', 'finish:grain': 'allow', 'finish:mono': 'allow', 'font:anton': 'allow', 'entrance:slam': 'allow', 'titleExit:polaroid': 'allow' } },
      { picks: { 'look:muse': 'allow', 'titleLayer:auto': 'allow', 'effect:lean-in': 'allow', 'beatSync:no-beat-sync': 'allow', 'editing:colour-card': 'allow' }, pace: { tighten: 'off', punch: 'off' }, music: { bed: 'none' }, sound: { sfx: 'off' } },
      { pack: 'cinematic', picks: { 'graphic:cta-card': 'deny', 'graphic:cta-button': 'deny', 'captionEntrance:cascade': 'allow', 'captionStyle:kinetic': 'allow' }, pace: { tighten: 0.25 } },
    ];
    for (const p of sessions) {
      const a = apply(fresh(), p), plan = VP.fromState(a, null, cat);
      assert.ok(VP.validate(plan, cat).ok, VP.validate(plan, cat).errs.join('; '));
      const b = apply(fresh(), { videoPlan: plan });
      assert.strictEqual(picksOf(b), picksOf(a), JSON.stringify(p));
      assert.deepStrictEqual(reel(b), reel(a), JSON.stringify(p));
      assert.strictEqual(b.pack || null, a.pack || null);
    }
  });

  await t('a change on a classic step updates the plan and keeps its notes and repo links, and a classic filter pick resets filter timing', () => {
    const plan = VP.normalize({ notes: 'Hook with big red words.', filters: { ids: ['mono'], when: 'hook' }, content: { repoFeature: true, repos: ['https://github.com/wrg32786/aigent-talking-head'] } });
    const s = apply(fresh(), { videoPlan: plan });
    apply(s, { picks: { 'transition:whip': 'allow', 'finish:warm': 'allow' } });
    const now = API.planOf(s, cat);
    assert.deepStrictEqual(now.transitions.ids, ['whip']);
    assert.deepStrictEqual(now.filters.ids.sort(), ['mono', 'warm']);
    assert.strictEqual(now.filters.when, 'whole', 'a filter picked where there is no timing control goes back to the look\'s way'); assert.strictEqual(now.notes, 'Hook with big red words.');
    assert.strictEqual(now.content.repos.length, 1);
    assert.deepStrictEqual(VP.pending(now).map(x => x.field).sort(), ['content']); assert.strictEqual(s.finishWhen, 'none', 'none, so a rebuild clears the old timing');
    // a pause length set by hand on Cut survives a read and a set
    apply(s, { pace: { tighten: 1.2 } }); const again = apply(fresh(), { videoPlan: API.planOf(s, cat) });
    assert.strictEqual(again.pace.tighten, 1.2);
    // graphics: "not the agent" with every group on stays that way
    const g = apply(fresh(), { videoPlan: VP.normalize({ graphics: { agent: false } }) }); assert.strictEqual(API.planOf(g, cat).graphics.agent, false);
  });

  await t('no big titles and no filters reach the reel as locks; none for transitions is straight cuts', () => {
    const s = apply(fresh(), { videoPlan: VP.normalize({ words: { titles: { on: false } }, filters: { ids: [], when: 'whole' }, transitions: { ids: [], when: 'every-cut' } }) });
    const c = C.compose(s);
    assert.strictEqual(c.locks.maxTitles, 0); assert.deepStrictEqual(c.locks.finishes, ['none']); assert.deepStrictEqual(c.locks.transitions, ['cut']);
    assert.match(c.lockString, /max-titles=0/);
    const back = VP.fromState(s, s.videoPlan, cat);
    assert.strictEqual(back.words.titles.on, false); assert.deepStrictEqual(back.filters.ids, []); assert.deepStrictEqual(back.transitions.ids, []);
    apply(s, { titles: 'auto' }); assert.strictEqual(C.compose(s).locks.maxTitles, undefined);
    apply(s, { titles: 'off' }); apply(s, { clearPicks: true }); assert.strictEqual(s.titles, 'auto', 'clearing every pick brings titles back');
    assert.ok(C.applyPatch(s, { titles: 'some' }, cat).errs.length);
  });

  await t('the plan goes into the next video with Keep my look, and a new video without it starts clean', () => {
    assert.ok(C.LOOK_KEYS.includes('videoPlan') && C.LOOK_KEYS.includes('titles'));
    const mk = () => apply(fresh(), { videoPlan: VP.normalize({ ...VP.defaults('lively'), words: { fonts: 'druk' } }) });
    const kept = C.freshSession(mk(), { job: 'next', keepLook: true }), clean = C.freshSession(mk(), { job: 'other', keepLook: false });
    assert.strictEqual(API.planOf(kept, cat).words.fonts, null, 'a font pick stays with its video, in the plan too');
    assert.strictEqual(kept.videoPlan && kept.videoPlan.pace, 'lively');
    assert.ok(!clean.videoPlan);
  });

  await t('a saved look reads into a plan the check accepts; a template leaves choices to the look', () => {
    const look = { pace: { shotMean: 1.9 }, captions: { style: 'pill', font: 'druk' }, titles: { on: true, entrances: ['slam', 'nope'], layer: 'auto' },
      transitions: { mix: { cut: 0.6, whip: 0.3, nonsense: 0.1 } }, grade: { finish: 'warm' }, music: { present: true, energy: 'high' }, brand: { theme: 'aigent' } };
    const p = FL.planFromLook(look, cat);
    assert.ok(VP.validate(p, cat).ok, VP.validate(p, cat).errs.join('; '));
    assert.strictEqual(p.pace, 'lively'); assert.strictEqual(p.words.type, 'captions'); assert.deepStrictEqual(p.words.titles.entrances, ['slam']);
    assert.deepStrictEqual(p.transitions.ids, ['whip']); assert.deepStrictEqual(p.filters.ids, ['warm']); assert.ok(p.presenter.some(x => x.id === 'behind-head' && x.when === 'key-moments'));
    assert.strictEqual(FL.planFromLook({ pace: { shotMean: 6 }, music: { present: false } }, cat).music.bed, 'none');
    const tp = VP.fromTemplate({ kind: 'pack', name: 'cinematic' });
    assert.deepStrictEqual(tp.template, { kind: 'pack', name: 'cinematic' }); assert.strictEqual(tp.transitions.ids, null);
    const s = apply(fresh(), { videoPlan: tp }); assert.strictEqual(s.pack, 'cinematic');
  });

  await t('a Filters, Music or Your notes choice changes only what it speaks for, and marks it yours', () => {
    const p = VP.normalize({ advanced: { picks: { 'finish:warm': 'allow', 'beatSync:beat-sync': 'allow', 'font:anton': 'allow' } } });
    const f = VP.withPart(p, 'filters', { ids: ['mono'] }); assert.ok(!f.advanced.picks['finish:warm'] && f.advanced.picks['beatSync:beat-sync'] && f.touched.includes('filters'));
    const ft = VP.withPart(f, 'filters', { when: 'cta' }); assert.deepStrictEqual(ft.filters, { ids: ['mono'], when: 'cta' }); assert.ok(ft.touched.includes('filters.when'));
    const m = VP.withPart(p, 'music', { beatSync: false }); assert.ok(!m.advanced.picks['beatSync:beat-sync'] && m.advanced.picks['finish:warm']);
    assert.ok(m.touched.includes('music.beatSync') && !m.touched.includes('music.energy'));
    assert.strictEqual(VP.applyPace(m, 'high').music.beatSync, false, 'a pace keeps your beat choice');
    const n = VP.withPart(p, 'notes', 'Hi'); assert.strictEqual(n.notes, 'Hi'); assert.deepStrictEqual(n.advanced.picks, p.advanced.picks);
    const hook = VP.toState(VP.withPart(VP.withPart(p, 'filters', { ids: ['mono'] }), 'filters', { when: 'hook' })); assert.strictEqual(hook.finishWhen, 'hook');
  });
  await t('no music keeps your beat choice for when music comes back, and a pace never asks for beat sync with no music', () => {
    const s = fresh(); apply(s, { music: { bed: 'none' } });
    const prev = VP.normalize({ music: { bed: 'none', beatSync: true } }), p = VP.fromState(s, prev, cat); assert.strictEqual(p.music.beatSync, true);
    const { patch, plan } = VP.pacePatch(p, 'calm', 'lively'); assert.deepStrictEqual(patch.picks, {}); assert.ok(!plan.touched.includes('music.beatSync') || plan.music.beatSync === true);
  });
  await t('only a pace you picked counts as the last pace, never one stored with a draft', () => {
    assert.strictEqual(VP.lastPace({ videoPlan: VP.normalize({ pace: 'high' }) }), null, 'a guessed pace is not a choice');
    assert.strictEqual(VP.lastPace({ videoPlan: VP.normalize({ pace: 'high', touched: ['pace'] }) }), 'high'); assert.strictEqual(VP.lastPace({}), null);
  });
  await t('a filter picked with no timing control puts timing back to the look; the builder always sends its timing', () => {
    const s = fresh(); apply(s, { finishWhen: 'hook', picks: { 'finish:mono': 'allow' } }); assert.strictEqual(s.finishWhen, 'hook');
    apply(s, { picks: { 'finish:grain': 'allow' } }); assert.strictEqual(s.finishWhen, 'none', 'a classic filter is not hook only');
    const a = VP.normalize({ filters: { ids: ['mono'], when: 'hook' }, touched: ['filters'] }), b = VP.withPart(a, 'filters', { ids: ['mono', 'grain'] });
    assert.strictEqual(VP.diffPatch(a, b).finishWhen, 'hook');
  });
  await t('the summary reads in plain words for the Your notes step', () => {
    const rows = VP.summary(VP.normalize({ pace: 'high', words: { type: 'kinetic', keyWords: { level: 'strong' } }, notes: 'Keep it fun.' }), cat);
    const text = rows.map(r => `${r.section}: ${r.text}`).join('\n');
    assert.match(text, /Pace: High energy/); assert.match(text, /Kinetic words/); assert.match(text, /strong key words/); assert.match(text, /Your notes: Keep it fun\./);
    assert.ok(!/\u2014/.test(text));
  });

  await t('the page route and the MCP tools read and set the same plan', async () => {
    const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, LOOKS_DIR: join(STATE, 'looks'), STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
    const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
    try {
      const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.on('exit', () => bad(new Error(out))); setTimeout(() => bad(new Error('Studio did not start: ' + out)), 20000); });
      const get = await (await fetch(url + '/api/video-plan')).json();
      assert.strictEqual(get.plan.format, 'aigent-video-plan'); assert.ok(get.paces.calm); assert.strictEqual(get.own, false);
      const steps = await (await fetch(url + '/api/wizard/steps')).json(); assert.strictEqual(steps.steps[0].id, 'pace');
      const bad = await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: { format: 'aigent-video-plan', pace: 'zoomy' } }) });
      assert.strictEqual(bad.status, 400); assert.match((await bad.json()).error, /Pacing/);
      const typo = await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoplan: {} }) });
      assert.strictEqual(typo.status, 400, 'a typo never clears the plan');
      const ok = await (await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: VP.defaults('steady') }) })).json();
      assert.strictEqual(ok.plan.pace, 'steady'); assert.strictEqual(ok.state.pace.tighten, 0.45); assert.strictEqual(ok.own, true);
      const pc = await (await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pace: 'lively' }) })).json();
      assert.strictEqual(pc.plan.pace, 'lively'); assert.ok(pc.plan.touched.includes('pace')); assert.strictEqual(pc.state.pace.tighten, 0.45);
      const wd = await (await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ words: { type: 'kinetic', look: 'kinetic', keyWords: { level: 'dramatic' } } }) })).json();
      assert.strictEqual(wd.plan.words.keyWords.level, 'dramatic'); assert.strictEqual(wd.state.keyWords, 'dramatic');
      const wbad = await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ words: { type: 'captions', look: 'classic', keyWords: { level: 'strong' } } }) });
      assert.strictEqual(wbad.status, 400, 'key words need kinetic words');
      const post = b => fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      const tr = await (await post({ transitions: { ids: ['whip', 'crossfade'], when: 'hook-cta' } })).json();
      assert.deepStrictEqual([tr.plan.transitions.ids, tr.plan.transitions.when], [['whip', 'crossfade'], 'hook-cta']); assert.strictEqual(tr.state.transitionsWhen, 'hook-cta');
      assert.ok(tr.compose.args.join(' ').includes('--transitions-when hook-cta'));
      const pr = await (await post({ presenter: [{ id: 'behind-head', when: 'hook' }, { id: 'effect:lean-in', when: 'key-moments' }] })).json();
      assert.deepStrictEqual(pr.plan.presenter.map(x => x.id + '@' + x.when), ['behind-head@hook', 'effect:lean-in@key-moments']);
      const gx = await (await post({ graphics: { agent: false, nameTag: false, numbers: true, stickers: true, cta: true } })).json();
      assert.strictEqual(gx.plan.graphics.nameTag, false); assert.ok(gx.state.picks.graphic.deny.includes('lower-third'));
      assert.strictEqual((await post({ presenter: { id: 'punch' } })).status, 400);
      assert.strictEqual((await post({ presenter: [{ id: 'punch', when: 'hook' }] })).status, 400, 'zoom punch is the whole video for now');
      const fi = await (await post({ filters: { ids: ['mono'] } })).json(), ft = await (await post({ filters: { when: 'hook' } })).json();
      assert.deepStrictEqual([ft.plan.filters.ids, ft.plan.filters.when], [['mono'], 'hook']); assert.strictEqual(fi.state.finishWhen, 'whole'); assert.strictEqual(ft.state.finishWhen, 'hook');
      assert.ok(ft.compose.args.join(' ').includes('--finish-when hook'), ft.compose.args.join(' '));
      const mu = await (await post({ music: { bed: 'none', sfx: false, beatSync: false } })).json();
      assert.deepStrictEqual([mu.state.music.bed, mu.state.sound.sfx, mu.plan.music.beatSync], ['none', 'off', false]); assert.ok(mu.plan.touched.includes('music.beatSync'));
      const nt = await (await post({ notes: 'Keep it under 30 seconds.' })).json(); assert.strictEqual(nt.plan.notes, 'Keep it under 30 seconds.');
      assert.strictEqual((await post({ notes: 42 })).status, 400); assert.strictEqual((await post({ notes: 'x'.repeat(2001) })).status, 400);
      const tp = await fetch(url + '/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'My Test' }) });
      const tj = await tp.json(); assert.strictEqual(tp.status, 200, JSON.stringify(tj)); assert.strictEqual(tj.template.name, 'my-test');
      const saved = JSON.parse(readFileSync(join(STATE, 'looks', 'my-test', 'template.json'), 'utf8'));
      assert.strictEqual(saved.format, 'aigent-template'); assert.strictEqual(saved.plan.notes, '', 'a template keeps no notes'); assert.deepStrictEqual(saved.plan.filters, { ids: ['mono'], when: 'hook' });
      assert.strictEqual((await fetch(url + '/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'my test' }) })).status, 409, 'never written over');
      const auto = await (await fetch(url + '/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json(); assert.match(auto.template.name, /^[a-z0-9-]+$/);
      // the Template Library: list, use, rename, duplicate, delete; starters are read only
      const tpost = (r, b) => fetch(url + '/api/templates/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      // a look you saved before templates existed shows in the library, its choices read from the look
      mkdirSync(join(STATE, 'looks', 'old-look'), { recursive: true });
      writeFileSync(join(STATE, 'looks', 'old-look', 'look.json'), JSON.stringify({ kind: 'style-look', version: 1, name: 'old-look', created: '2026-01-02T00:00:00Z', framing: {}, grade: { finish: 'warm' }, captions: { style: 'pill' }, titles: {}, stickers: {}, transitions: {}, moves: {}, pace: { shotMean: 1.9 }, broll: {}, music: {}, sfx: {}, loudness: {} }));
      const lib = (await (await fetch(url + '/api/templates')).json()).templates, mine = lib.find(x => x.name === 'my-test');
      const old = lib.find(x => x.name === 'old-look'); assert.deepStrictEqual([old && old.kind, old && old.source, old && old.pace], ['look', 'From a teardown', 'lively'], JSON.stringify(old));
      const oldEdit = await (await tpost('use', { name: 'old-look', edit: true })).json(); assert.deepStrictEqual(oldEdit.plan.filters.ids, ['warm'], 'Edit in builder makes the look\'s choices your own');
      const oldRen = await (await tpost('rename', { name: 'old-look', label: 'My old look' })).json(); assert.strictEqual(oldRen.template.label, 'My old look');
      assert.ok(existsSync(join(STATE, 'looks', 'old-look', 'look.json')), 'a rename leaves the look where it is');
      assert.deepStrictEqual([mine.kind, mine.source, mine.label, mine.readOnly], ['template', 'Built by you', 'My Test', false]);
      const starter = lib.find(x => x.kind === 'pack'); assert.ok(starter && starter.readOnly, 'the starter packs are in the library');
      assert.strictEqual(lib.filter(x => x.kind === 'pack').length, cat.packs.filter(p => p.shipped && !/^ref-/.test(p.name)).length);
      await post({ notes: 'For this video only.' });
      const used = await (await tpost('use', { name: 'my-test' })).json();
      assert.deepStrictEqual(used.plan.filters, { ids: ['mono'], when: 'hook' }); assert.strictEqual(used.state.finishWhen, 'hook'); assert.strictEqual(used.plan.notes, '', 'a template brings no notes');
      const ren = await (await tpost('rename', { name: 'my-test', label: 'Hook in mono' })).json(); assert.strictEqual(ren.template.label, 'Hook in mono'); assert.strictEqual(ren.template.name, 'my-test', 'the folder keeps its name');
      const dup = await (await tpost('duplicate', { name: 'my-test' })).json(); assert.strictEqual(dup.template.name, 'my-test-copy'); assert.strictEqual(dup.template.source, 'Your copy');
      assert.strictEqual((await tpost('duplicate', { name: 'my-test' })).status, 200); assert.ok(existsSync(join(STATE, 'looks', 'my-test-copy-2', 'template.json')), 'a second copy gets its own folder');
      const sdup = await (await tpost('duplicate', { name: starter.name })).json(); assert.strictEqual(sdup.template.readOnly, false, 'a starter copy is yours');
      assert.strictEqual((await tpost('rename', { name: starter.name, label: 'x' })).status, 400); assert.strictEqual((await tpost('delete', { name: starter.name })).status, 400, 'starters stay');
      assert.strictEqual((await tpost('use', { name: 'no-such' })).status, 404); assert.strictEqual((await tpost('rename', { name: 'my-test', label: '  ' })).status, 400);
      const del = await (await tpost('delete', { name: 'my-test-copy' })).json(); assert.ok(!del.templates.some(x => x.name === 'my-test-copy')); assert.ok(!existsSync(join(STATE, 'looks', 'my-test-copy')));
      const su = await (await tpost('use', { name: starter.name })).json(); assert.deepStrictEqual(su.plan.template, { kind: 'pack', name: starter.name });
      // a starter's name is never taken; a long name still gets its own copies; a look another template uses stays
      const sn = await fetch(url + '/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: starter.name }) }); assert.strictEqual(sn.status, 409, 'a starter name is refused');
      const long = 'a'.repeat(30) + ' ' + 'b'.repeat(29), ls = await (await fetch(url + '/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: long }) })).json();
      const c1 = await (await tpost('duplicate', { name: ls.template.name })).json(), c2 = await (await tpost('duplicate', { name: ls.template.name })).json();
      assert.ok(c1.template && c2.template && c1.template.name !== c2.template.name && c1.template.name !== ls.template.name, JSON.stringify([c1.template, c2.template]));
      const oc = await (await tpost('duplicate', { name: 'old-look' })).json(); assert.strictEqual(oc.template.name, 'old-look-copy');
      const blocked = await tpost('delete', { name: 'old-look' }); assert.strictEqual(blocked.status, 409); assert.match((await blocked.json()).error, /uses this look/);
      assert.strictEqual((await tpost('delete', { name: 'old-look-copy' })).status, 200); assert.strictEqual((await tpost('delete', { name: 'old-look' })).status, 200, 'with its copy gone the look can go');
      const np = await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pace: 'zoomy' }) });
      assert.strictEqual(np.status, 400);
      await fetch(url + '/api/video-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: VP.defaults('steady') }) });
    } finally { srv.kill(); }
    const client = new Client({ name: 'wizard-plan-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env, stderr: 'ignore' }));
    try {
      const g = (await client.callTool({ name: 'get_video_plan', arguments: {} })).structuredContent;
      assert.strictEqual(g.plan.pace, 'steady');
      const set = (await client.callTool({ name: 'set_video_plan', arguments: { plan: { ...g.plan, notes: 'From the agent.', transitions: { ids: ['crossfade'], when: 'topic' } } } })).structuredContent;
      assert.strictEqual(set.ok, true); assert.strictEqual(set.plan.notes, 'From the agent.'); assert.deepStrictEqual(set.plan.transitions.ids, ['crossfade']);
      // the notes reach the agent: in studio_get_state and get_video_plan
      assert.strictEqual((await client.callTool({ name: 'studio_get_state', arguments: {} })).structuredContent.notes, 'From the agent.');
      assert.strictEqual((await client.callTool({ name: 'get_video_plan', arguments: {} })).structuredContent.plan.notes, 'From the agent.');
      // the Template Library for agents: list it, save the plan as a template (no notes), a used name refused
      const tl = (await client.callTool({ name: 'list_templates', arguments: {} })).structuredContent.templates;
      assert.ok(tl.some(x => x.name === 'my-test' && x.label === 'Hook in mono') && tl.some(x => x.readOnly), JSON.stringify(tl.map(x => x.name)));
      const st = (await client.callTool({ name: 'save_template', arguments: { name: 'Agent Look' } })).structuredContent;
      assert.strictEqual(st.template.name, 'agent-look'); assert.strictEqual(JSON.parse(readFileSync(join(STATE, 'looks', 'agent-look', 'template.json'), 'utf8')).plan.notes, '');
      assert.ok((await client.callTool({ name: 'save_template', arguments: { name: 'agent look' } })).isError, 'never written over');
      const no = await client.callTool({ name: 'set_video_plan', arguments: { plan: { format: 'aigent-video-plan', filters: { ids: ['sepia'] } } } });
      assert.ok(no.isError); assert.match(JSON.stringify(no.content), /Filters: we do not have one called sepia/);
    } finally { await client.close(); }
  });
  console.log(`\nwizard plan: ${n} tests passed`);
} finally { rmSync(STATE, { recursive: true, force: true }); }
