// The Studio builder plan (kit/studio/wizard/plan.mjs, docs/specs/studio-builder.md section 4): defaults for every
// pace, plain errors, the plan turned into the same picks a click on the classic steps makes, a classic change read
// back into the plan with its plan-only choices kept, no big titles and no filters reaching the reel's locks, the
// plan riding into the next video with Keep my look, a saved look as a plan, and the page route and MCP tools.
// Run: node tests/wizard-plan.test.mjs   (npm run check runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
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
      [{ words: { type: 'captions', look: 'pill', fonts: 'druk', colors: { theme: 'magazine' } } }, { picks: { 'captionStyle:pill': 'allow', 'font:druk': 'allow', 'theme:magazine': 'allow' } }],
      [{ transitions: { ids: ['whip', 'glitch'], when: 'every-cut' } }, { picks: { 'transition:whip': 'allow', 'transition:glitch': 'allow' } }],
      [{ filters: { ids: ['mono'], when: 'whole' }, music: { beatSync: false } }, { picks: { 'finish:mono': 'allow', 'beatSync:no-beat-sync': 'allow' } }],
      [{ presenter: [{ id: 'punch', when: 'whole' }, { id: 'behind-head', when: 'whole' }, { id: 'effect:slow-push', when: 'whole' }] }, { picks: { 'titleLayer:behind': 'allow', 'effect:slow-push': 'allow' } }],
      [{ graphics: { agent: false, nameTag: false, numbers: true, stickers: true, cta: true, cards: false } }, { picks: { 'graphic:lower-third': 'deny', 'editing:cards-auto': 'deny' } }],
    ];
    for (const [plan, clicks] of cases) {
      const a = apply(fresh(), { videoPlan: VP.normalize(plan) }), b = apply(fresh(), clicks);
      assert.strictEqual(picksOf(a), picksOf(b), JSON.stringify(plan));
      assert.deepStrictEqual(reel(a), reel(b), JSON.stringify(plan));
    }
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

  await t('a change on a classic step updates the plan and keeps its notes, timing and repo links', () => {
    const plan = VP.normalize({ notes: 'Hook with big red words.', filters: { ids: ['mono'], when: 'hook' }, content: { repoFeature: true, repos: ['https://github.com/wrg32786/aigent-talking-head'] } });
    const s = apply(fresh(), { videoPlan: plan });
    apply(s, { picks: { 'transition:whip': 'allow', 'finish:warm': 'allow' } });
    const now = API.planOf(s, cat);
    assert.deepStrictEqual(now.transitions.ids, ['whip']);
    assert.deepStrictEqual(now.filters.ids.sort(), ['mono', 'warm']);
    assert.strictEqual(now.filters.when, 'hook'); assert.strictEqual(now.notes, 'Hook with big red words.');
    assert.strictEqual(now.content.repos.length, 1);
    assert.deepStrictEqual(VP.pending(now).map(x => x.field).sort(), ['content', 'filters.when']);
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
    assert.deepStrictEqual(p.transitions.ids, ['whip']); assert.deepStrictEqual(p.filters.ids, ['warm']); assert.ok(p.presenter.some(x => x.id === 'behind-head' && x.when === 'hook'));
    assert.strictEqual(FL.planFromLook({ pace: { shotMean: 6 }, music: { present: false } }, cat).music.bed, 'none');
    const tp = VP.fromTemplate({ kind: 'pack', name: 'cinematic' });
    assert.deepStrictEqual(tp.template, { kind: 'pack', name: 'cinematic' }); assert.strictEqual(tp.transitions.ids, null);
    const s = apply(fresh(), { videoPlan: tp }); assert.strictEqual(s.pack, 'cinematic');
  });

  await t('the summary reads in plain words for the Your notes step', () => {
    const rows = VP.summary(VP.normalize({ pace: 'high', words: { type: 'kinetic', keyWords: { level: 'strong' } }, notes: 'Keep it fun.' }), cat);
    const text = rows.map(r => `${r.section}: ${r.text}`).join('\n');
    assert.match(text, /Pace: High energy/); assert.match(text, /Kinetic words/); assert.match(text, /strong key words/); assert.match(text, /Your notes: Keep it fun\./);
    assert.ok(!/\u2014/.test(text));
  });

  await t('the page route and the MCP tools read and set the same plan', async () => {
    const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
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
      const no = await client.callTool({ name: 'set_video_plan', arguments: { plan: { format: 'aigent-video-plan', filters: { ids: ['sepia'] } } } });
      assert.ok(no.isError); assert.match(JSON.stringify(no.content), /Filters: we do not have one called sepia/);
    } finally { await client.close(); }
  });
  console.log(`\nwizard plan: ${n} tests passed`);
} finally { rmSync(STATE, { recursive: true, force: true }); }
