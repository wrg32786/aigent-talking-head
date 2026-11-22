// A reference's look in Recreate and Copy the look (Studio report 4, items 7, 9 and 13: a Recreate that drew the last
// video's look, could not use blur-rise on a rebuild, and drew title text the breakdown had misread).
// - item 9: the entrances a teardown read are a preference (the reference pack's entranceOrder, the recipe's own
//   titles), never an allow pick and never locks.titles; an entrance you pick yourself still locks; a session saved
//   before this whose entrance picks are exactly the reference's does not lock either
// - item 7: the reference wins in Recreate and Copy the look (the look kept from the video before is set aside,
//   tests/studio-leak.test.mjs has every input); when an earlier look is in use instead (the reference Off after Back
//   to my look, or Influence) savedLookOf finds it, the page line is "Your saved look is in use, not the reference's",
//   and one switch sets the board from the reference with one Undo (useReferenceLook, POST /api/reference/use-look,
//   studio_get_state savedLook)
// - item 13: extract says which titles need a check and why; fixTitleText and POST /api/reference/title rewrite one
//   title's text in the reference's Reel.md, take off its check field and leave every other byte alone
// No Chrome, no keys, no network. Run: node tests/studio-reflook.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const TMP = mkdtempSync(join(tmpdir(), 'studio-reflook-test-')), SDIR = join(TMP, 'studio'), JOB = 'reflook-test-' + process.pid;
process.env.STUDIO_DIR = SDIR; mkdirSync(SDIR, { recursive: true });
const C = await import('../kit/studio/core.mjs');
const RM = require('../kit/reelmd.cjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const cat = C.catalog();
const allow = (s, k) => ((s.picks[k] && s.picks[k].allow) || []).slice();
const lock = s => C.compose(s).lockString || '';
const flag = (s, f) => { const a = C.compose(s).args, i = a.indexOf(f); return i < 0 ? null : a[i + 1]; };

// a reference recipe: the shipped cinematic one (kinetic captions, three title entrances), with two titles the
// teardown was not sure of, written the way kit/teardown writes them
const RECIPE = readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8')
  .replace('#01 0.4-2.2 | entrance blur-rise | layer behind | text Ten years ago', '#01 0.4-2.2 | check read with low confidence (82%) | entrance blur-rise | layer behind | text Kng')
  .replace('#03 24.3-26.5 | entrance stagger-rise | layer auto | text Now', '#03 24.3-26.5 | entrance stagger-rise | layer auto | text 360 Days | check the number is not in the speech');
assert.ok(/text Kng/.test(RECIPE) && /check the number/.test(RECIPE), 'the test recipe carries the check fields');
// the route reads the recipe under the kit folder (reference.out is a path in it); teardown/ is not checked in
const OUT = `teardown/${JOB}`, DIR = join(ROOT, OUT), FILE = join(DIR, 'Reel.md');
mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, RECIPE);
const EX = C.extract(FILE);
const withRef = (s, mode) => { s.reference = { ...C.defaultState().reference, status: 'ready', mode: 'off', out: OUT, extracted: C.extract(FILE), active: null }; const r = C.applyPatch(s, { reference: { mode } }, cat); assert.deepStrictEqual(r.errs, []); return s; };
// the board as the video before left it (New video, Keep my look): one-word captions, titles in front, one entrance
const KEPT = { 'captionStyle:one-word': 'allow', 'titleLayer:front': 'allow', 'entrance:pop-zoom': 'allow' };
const old = () => { const s = C.defaultState(); s.job = 'video-one'; const r = C.applyPatch(s, { picks: KEPT }, cat); assert.deepStrictEqual(r.errs, []);
  C.freshSession(s, { job: 'video-two', keepLook: true }); assert.strictEqual(s.keepLook, true); assert.deepStrictEqual(allow(s, 'titleLayer'), ['front']); return s; };
const refs = sl => sl.by.map(b => b.ref).sort();

let srv, client;
try {
  // ---------- item 9: entrances ----------
  await t('the entrances a reference read are never picks, in any mode', async () => {
    assert.deepStrictEqual(EX.entrances.slice().sort(), ['blur-rise', 'slide-left', 'stagger-rise']);
    assert.ok(!Object.keys(C.referencePicks(EX, null, cat)).some(r => r.startsWith('entrance:')), 'referencePicks');
    assert.deepStrictEqual(C.referencePicks(EX, ['entrance'], cat), {}, 'asked for by kind too');
    for (const mode of ['recreate', 'influence']) assert.ok(!Object.keys(C.referenceLook(EX, mode, cat).picks).some(r => r.startsWith('entrance:')), mode);
    assert.ok(EX.summary.suggestions.some(x => x.ref === 'entrance:blur-rise'), 'still a suggestion you can pick by hand');
  });
  await t('Recreate, Copy the look and Influence set no titles lock, so a rebuild can use any entrance', async () => {
    for (const mode of ['recreate', 'look', 'influence']) { const s = withRef(C.defaultState(), mode);
      assert.deepStrictEqual(allow(s, 'entrance'), [], mode); assert.ok(!/titles=/.test(lock(s)), `${mode}: ${lock(s)}`); assert.strictEqual(C.compose(s).locks.titles, undefined); }
  });
  await t('the reference pack carries them as a preference (entranceOrder), with no lock; Titles off leaves them out', async () => {
    const p = C.fitStyle(C.influencePack(EX, 'x', null));
    assert.deepStrictEqual(p.style.entranceOrder, EX.entrances); assert.strictEqual(p.locks.titles, undefined);
    assert.strictEqual(C.influencePack(EX, 'x', null, { titles: false }).style.entranceOrder, undefined);
    assert.deepStrictEqual(C.influencePack(EX, 'x', null, { titles: true }).style.entranceOrder, EX.entrances);
  });
  await t('an entrance you pick yourself still locks, the reference\'s own set included', async () => {
    const s = withRef(C.defaultState(), 'recreate');
    C.applyPatch(s, { picks: { 'entrance:slam': 'allow' } }, cat); assert.strictEqual(s.entranceLock, true); assert.ok(/titles=slam/.test(lock(s)), lock(s));
    C.applyPatch(s, { picks: { 'entrance:slam': 'clear' } }, cat); assert.strictEqual(s.entranceLock, false); assert.ok(!/titles=/.test(lock(s)));
    C.applyPatch(s, { picks: Object.fromEntries(EX.entrances.map(e => [`entrance:${e}`, 'allow'])) }, cat);
    assert.strictEqual(C.refEntrancesOnly(s), false); assert.deepStrictEqual(C.compose(s).locks.titles.slice().sort(), EX.entrances.slice().sort(), 'you chose exactly those: a lock');
    const f = C.defaultState(); C.applyPatch(f, { picks: { 'entrance:drop': 'deny' } }, cat); assert.ok(/titles=/.test(lock(f)) && !/drop/.test(lock(f)), 'forbidding one is a lock too');
  });
  await t('a session saved before this, holding exactly the reference\'s entrances as picks, does not lock', async () => {
    const s = C.defaultState(); s.job = 'older';
    s.reference = { ...s.reference, status: 'ready', mode: 'recreate', out: OUT, extracted: EX, added: EX.entrances.map(e => `entrance:${e}`).concat('captionStyle:kinetic') };
    s.picks = { entrance: { allow: EX.entrances.slice().reverse(), deny: [] }, captionStyle: { allow: ['kinetic'], deny: [] } };
    assert.strictEqual(C.refEntrancesOnly(s), true); assert.ok(!/titles=/.test(lock(s)), lock(s));
    // and reading it from disk takes the picks off the page
    writeFileSync(C.statePath(), JSON.stringify(s)); const l = C.load();
    assert.strictEqual(l.picks.entrance, undefined); assert.ok(l.reference.added.includes('captionStyle:kinetic') && !l.reference.added.some(x => x.startsWith('entrance:')), l.reference.added.join(' ')); assert.deepStrictEqual(allow(l, 'captionStyle'), ['kinetic']);
    // one more or one fewer than the reference's is your own choice and still locks
    const more = JSON.parse(JSON.stringify(s)); more.picks.entrance.allow.push('slam'); assert.strictEqual(C.refEntrancesOnly(more), false); assert.ok(/titles=/.test(lock(more)));
    const off = JSON.parse(JSON.stringify(s)); off.reference.mode = 'off'; assert.strictEqual(C.refEntrancesOnly(off), false, 'with no reference in use they are yours');
    rmSync(C.statePath(), { force: true });
  });

  // ---------- item 7: whose look is in use ----------
  await t('no reference, or one not read yet: nothing to say', async () => {
    assert.strictEqual(C.savedLookOf(old(), cat), null);
    const reading = old(); reading.reference = { ...reading.reference, mode: 'recreate', out: OUT, status: 'running' }; assert.strictEqual(C.savedLookOf(reading, cat), null, 'not read yet');
  });
  await t('Recreate on a board that kept the last look: the reference wins, the kept picks are set aside', async () => {
    const s = withRef(old(), 'recreate'), sl = C.savedLookOf(s, cat);
    assert.deepStrictEqual(allow(s, 'captionStyle'), ['kinetic'], 'the reference\'s caption style');
    assert.deepStrictEqual(sl, { inUse: false, by: [], text: null, mode: 'recreate', name: null, yours: [] }, 'nothing earlier is in use, so the page has no line');
    assert.deepStrictEqual(allow(s, 'titleLayer'), []); assert.deepStrictEqual(allow(s, 'entrance'), []); assert.strictEqual(s.entranceLock, false);
    assert.strictEqual(flag(s, '--title-layer'), null); assert.ok(!/titles=/.test(lock(s)), 'the last video\'s entrance is not a lock on the Recreate: ' + lock(s));
    assert.deepStrictEqual(Object.keys(s.reference.prevLook.picks).sort(), ['captionStyle', 'entrance', 'titleLayer'], 'kept for Back to my look');
  });
  await t('Copy the look sets the kept picks aside too', async () => {
    const s = withRef(old(), 'look'), sl = C.savedLookOf(s, cat);
    assert.strictEqual(sl.inUse, false); assert.strictEqual(sl.mode, 'look'); assert.deepStrictEqual(s.picks, {});
  });
  await t('a pick you make after the reference came into use is yours, not your saved look', async () => {
    const s = withRef(old(), 'recreate');
    C.applyPatch(s, { picks: { 'titleLayer:behind': 'allow', 'entrance:slam': 'allow' } }, cat);
    const sl = C.savedLookOf(s, cat); assert.strictEqual(sl.inUse, false, 'no line for a choice made for this video'); assert.deepStrictEqual(sl.yours, ['titles'], 'the agent is told which part is yours');
    assert.strictEqual(flag(s, '--title-layer'), 'behind'); assert.ok(/titles=slam/.test(lock(s)), 'and it is used');
  });
  await t('Back to my look: the kept picks come back, and the line says the saved look is in use', async () => {
    const s = withRef(old(), 'recreate'); C.applyPatch(s, { reference: { mode: 'off' } }, cat);
    assert.deepStrictEqual(allow(s, 'titleLayer'), ['front']); assert.deepStrictEqual(allow(s, 'entrance'), ['pop-zoom']); assert.deepStrictEqual(allow(s, 'captionStyle'), ['one-word'], 'your whole look is back');
    assert.strictEqual(s.entranceLock, true); assert.ok(/titles=pop-zoom/.test(lock(s)), 'your own entrance locks again');
    const sl = C.savedLookOf(s, cat);
    assert.strictEqual(sl.inUse, true); assert.strictEqual(sl.text, "Your saved look is in use, not the reference's"); assert.strictEqual(sl.text, C.SAVED_LOOK_TEXT); assert.strictEqual(sl.mode, 'off');
    assert.deepStrictEqual(refs(sl), ['captionStyle:one-word', 'entrance:pop-zoom', 'titleLayer:front']);
    assert.ok(sl.by.every(b => b.label && b.kind && b.id)); assert.strictEqual(sl.by.find(b => b.kind === 'titleLayer').label, 'title layer front');
    const none = withRef(C.defaultState(), 'recreate'); C.applyPatch(none, { reference: { mode: 'off' } }, cat); assert.strictEqual(C.savedLookOf(none, cat).inUse, false, 'the reference Off with nothing on the board: no line');
  });
  await t('Influence keeps your look under the reference, so the line shows; what the reference set is not counted', async () => {
    const s = withRef(old(), 'influence'), sl = C.savedLookOf(s, cat);
    assert.strictEqual(sl.inUse, true); assert.strictEqual(sl.mode, 'influence'); assert.strictEqual(sl.text, 'Your saved look is the base, with the reference on top', 'Influence: the reference goes on top, so the line does not say "not the reference\'s"'); assert.ok(refs(sl).includes('titleLayer:front') && refs(sl).includes('entrance:pop-zoom'), refs(sl).join(' '));
    assert.ok(!sl.by.some(b => s.reference.added.includes(b.ref)));
    assert.strictEqual(C.savedLookOf(withRef(C.defaultState(), 'influence'), cat).inUse, false, 'an empty board on Influence: nothing earlier');
    const d = C.defaultState(), tr = Object.values(cat.items).find(i => i.kind === 'transition' && !EX.transitions[i.id]).id; C.applyPatch(d, { picks: { [`transition:${tr}`]: 'deny' } }, cat); withRef(d, 'influence');
    const by = C.savedLookOf(d, cat).by.filter(x => x.kind === 'transition' && x.deny); assert.deepStrictEqual(by.map(x => x.ref), [`transition:${tr}`]); assert.ok(/^no transition /.test(by[0].label), 'a forbidden one counts');
  });
  await t('the switch sets the board from the reference alone, says so, and one Undo puts the saved look back', async () => {
    const s = withRef(old(), 'recreate'); C.applyPatch(s, { reference: { mode: 'off' } }, cat);
    const r = C.applyPatch(s, { useReferenceLook: true }, cat); assert.deepStrictEqual(r.errs, []); assert.strictEqual(r.noop, false); assert.ok(/reference's look is in use \(Recreate\)/.test(r.log.join(' ')), r.log.join('; '));
    assert.strictEqual(s.reference.mode, 'recreate', 'back on, in the mode it was last copied with');
    assert.deepStrictEqual(allow(s, 'titleLayer'), []); assert.deepStrictEqual(allow(s, 'entrance'), []); assert.deepStrictEqual(allow(s, 'captionStyle'), ['kinetic'], 'the reference\'s own picks');
    assert.strictEqual(flag(s, '--title-layer'), null); assert.ok(!/titles=/.test(lock(s)), lock(s)); assert.strictEqual(s.entranceLock, false);
    assert.strictEqual(C.savedLookOf(s, cat).inUse, false); assert.strictEqual(s.lastChange.text, "Switched to the reference's look.");
    assert.strictEqual(C.applyPatch(s, { useReferenceLook: true }, cat).noop, true, 'nothing left to switch'); assert.strictEqual(s.lastChange.text, "Switched to the reference's look.", 'and the Undo is still there');
    C.applyPatch(s, { undoChange: true }, cat);
    assert.strictEqual(s.reference.mode, 'off'); assert.deepStrictEqual(allow(s, 'titleLayer'), ['front']); assert.deepStrictEqual(allow(s, 'entrance'), ['pop-zoom']); assert.strictEqual(s.entranceLock, true);
    assert.deepStrictEqual(refs(C.savedLookOf(s, cat)), ['captionStyle:one-word', 'entrance:pop-zoom', 'titleLayer:front'], 'the line is back with them');
    assert.strictEqual(C.useReferenceLook(C.defaultState(), cat), null, 'no reference: nothing to do'); assert.strictEqual(C.applyPatch(C.defaultState(), { useReferenceLook: true }, cat).noop, true);
  });
  await t('the switch from Influence, or with no copy before, turns on Copy the look; in Recreate it takes your later picks off', async () => {
    const i = withRef(old(), 'influence'); C.applyPatch(i, { useReferenceLook: true }, cat);
    assert.strictEqual(i.reference.mode, 'look', 'your own cut stays'); assert.strictEqual(C.savedLookOf(i, cat).inUse, false); assert.deepStrictEqual(i.picks, {});
    C.applyPatch(i, { reference: { mode: 'off' } }, cat); assert.deepStrictEqual(allow(i, 'titleLayer'), ['front'], 'Back to my look still gives it back');
    const s = withRef(C.defaultState(), 'recreate'); C.applyPatch(s, { picks: { 'theme:magazine': 'allow' } }, cat); assert.strictEqual(flag(s, '--theme'), 'magazine');
    assert.strictEqual(C.applyPatch(s, { useReferenceLook: true }, cat).noop, false); assert.strictEqual(flag(s, '--theme'), null); assert.strictEqual(flag(s, '--style'), 'kinetic');
  });
  await t('a session from before this (a reference in use, older picks mixed in) is set from the reference alone when it is read', async () => {
    const s = C.defaultState(); s.job = 'older';
    s.picks = { captionStyle: { allow: ['kinetic'], deny: [] }, titleLayer: { allow: ['front'], deny: [] }, theme: { allow: ['magazine'], deny: [] } };
    s.reference = { ...s.reference, status: 'ready', mode: 'recreate', out: OUT, extracted: EX, added: ['captionStyle:kinetic'] };
    writeFileSync(C.statePath(), JSON.stringify(s)); const l = C.load(); rmSync(C.statePath(), { force: true });
    assert.strictEqual(flag(l, '--theme'), null); assert.strictEqual(flag(l, '--title-layer'), null); assert.strictEqual(flag(l, '--style'), 'kinetic'); assert.strictEqual(C.savedLookOf(l, cat).inUse, false);
  });

  // ---------- item 13: title text the breakdown may have misread ----------
  await t('extract says which titles need a check, and why', async () => {
    assert.deepStrictEqual(EX.checks, [{ n: 1, at: 0.4, text: 'Kng', why: 'read with low confidence (82%)' }, { n: 3, at: 24.3, text: '360 Days', why: 'the number is not in the speech' }]);
    assert.deepStrictEqual(C.extract(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md')).checks, [], 'none in a recipe with no check field');
    assert.strictEqual(EX.titles, 3); assert.strictEqual(EX.summary.titles[0].text, 'Kng');
  });
  await t('fixTitleText rewrites one title\'s text, takes off its check and leaves every other byte alone', async () => {
    const f = join(TMP, 'a.Reel.md'); writeFileSync(f, RECIPE);
    assert.deepStrictEqual(C.fixTitleText(f, 1, '  King  '), { n: 1, text: 'King', changed: true });
    const want = RECIPE.replace('#01 0.4-2.2 | check read with low confidence (82%) | entrance blur-rise | layer behind | text Kng', '#01 0.4-2.2 | entrance blur-rise | layer behind | text King');
    assert.strictEqual(readFileSync(f, 'utf8'), want, 'only that line changed');
    assert.deepStrictEqual(C.extract(f).checks.map(x => x.n), [3]); assert.strictEqual(RM.load(f).titles[0].text, 'King'); assert.strictEqual(RM.load(f).titles[0].check, undefined);
    // the check field after the text, and saving the same text: it was right
    C.fixTitleText(f, 3, '360 Days'); assert.strictEqual(readFileSync(f, 'utf8'), want.replace('#03 24.3-26.5 | entrance stagger-rise | layer auto | text 360 Days | check the number is not in the speech', '#03 24.3-26.5 | entrance stagger-rise | layer auto | text 360 Days'));
    assert.deepStrictEqual(C.extract(f).checks, []); assert.deepStrictEqual(RM.validate(RM.load(f)).errs, [], 'still a valid recipe');
    assert.deepStrictEqual(C.fixTitleText(f, 2, 'Then this'), { n: 2, text: 'Then this', changed: false }, 'a title with nothing to fix is left as it is');
  });
  await t('Windows line endings and odd text survive', async () => {
    const f = join(TMP, 'crlf.Reel.md'), crlf = RECIPE.replace(/\n/g, '\r\n'); writeFileSync(f, crlf);
    C.fixTitleText(f, 3, '347\nDays | now');
    const got = readFileSync(f, 'utf8'); assert.ok(got.includes('| layer auto | text 347 Days / now\r\n'), 'a bar or a new line in the text never breaks the line');
    assert.strictEqual(got.replace('| layer auto | text 347 Days / now\r\n', '| layer auto | text 360 Days | check the number is not in the speech\r\n'), crlf); assert.strictEqual(RM.parseLine(got.split('\r\n').find(l => l.startsWith('#03 24.3')), 't').text, '347 Days / now');
    assert.strictEqual(C.cleanTitleText('  a   b  '), 'a b');
    assert.throws(() => C.fixTitleText(f, 9, 'x'), e => e.code === 404 && /no title 9/.test(e.message)); assert.throws(() => C.fixTitleText(f, 1, '   '), e => e.code === 400);
  });

  // ---------- the server and the agent tools ----------
  // a board that kept the last look, a reference copied once and then switched Off (Back to my look)
  const base = old(); withRef(base, 'recreate'); C.applyPatch(base, { reference: { mode: 'off' } }, cat); base.job = JOB; writeFileSync(C.statePath(), JSON.stringify(base));
  const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', CHROME_PATH: join(TMP, 'no-chrome'), STUDIO_BROLL_AUTO: '' };
  srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  let srvOut = '';
  const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
  const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const j = await r.json(); j.status = r.status; return j; };

  await t('the page state carries savedLook, and the agent\'s studio_get_state does too', async () => {
    const v = await req('/api/state'); assert.strictEqual(v.savedLook.inUse, true); assert.strictEqual(v.savedLook.text, "Your saved look is in use, not the reference's"); assert.deepStrictEqual(refs(v.savedLook), ['captionStyle:one-word', 'entrance:pop-zoom', 'titleLayer:front']);
    client = new Client({ name: 'reflook-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: SDIR, STUDIO_PORT: url.split(':').pop() } }));
    const tools = (await client.listTools()).tools;
    assert.match(tools.find(x => x.name === 'studio_get_state').description, /savedLook/); assert.ok(tools.find(x => x.name === 'studio_set_selections').inputSchema.properties.useReferenceLook);
    const r = await client.callTool({ name: 'studio_get_state', arguments: {} }); assert.ok(!r.isError, JSON.stringify(r.content).slice(0, 300));
    const j = JSON.parse(r.content[0].text); assert.strictEqual(j.savedLook.inUse, true); assert.deepStrictEqual(refs(j.savedLook), ['captionStyle:one-word', 'entrance:pop-zoom', 'titleLayer:front']);
  });
  await t('POST /api/reference/use-look switches to the reference\'s look; Undo puts the saved one back', async () => {
    const v = await req('/api/reference/use-look', {}); assert.strictEqual(v.status, 200, JSON.stringify(v).slice(0, 300));
    assert.strictEqual(v.savedLook.inUse, false); assert.strictEqual(v.state.reference.mode, 'recreate'); assert.strictEqual(v.state.picks.titleLayer, undefined); assert.ok(!v.compose.args.includes('--title-layer')); assert.ok(!/titles=/.test(v.compose.lockString || ''));
    assert.match(v.note, /^Switched to the reference's look\./); assert.strictEqual(v.state.lastChange.text, "Switched to the reference's look.");
    const again = await req('/api/reference/use-look', {}); assert.strictEqual(again.status, 200); assert.match(again.note, /already in use/);
    const u = await req('/api/state', { undoChange: true }); assert.strictEqual(u.savedLook.inUse, true); assert.deepStrictEqual(u.state.picks.titleLayer.allow, ['front']);
    // the agent can switch too
    const r = await client.callTool({ name: 'studio_set_selections', arguments: { useReferenceLook: true } }); assert.ok(!r.isError, JSON.stringify(r.content).slice(0, 300));
    assert.strictEqual((await req('/api/state')).savedLook.inUse, false);
  });
  await t('POST /api/reference/title fixes a title in the reference\'s Reel.md and the page sees one fewer to check', async () => {
    let v = await req('/api/state'); assert.deepStrictEqual(v.state.reference.extracted.checks.map(x => x.n), [1, 3]);
    v = await req('/api/reference/title', { n: 1, text: 'King' }); assert.strictEqual(v.status, 200, JSON.stringify(v).slice(0, 300));
    assert.deepStrictEqual(v.title, { n: 1, text: 'King', changed: true }); assert.deepStrictEqual(v.state.reference.extracted.checks.map(x => x.n), [3]); assert.strictEqual(v.state.reference.extracted.summary.titles[0].text, 'King');
    assert.strictEqual(readFileSync(FILE, 'utf8'), RECIPE.replace('#01 0.4-2.2 | check read with low confidence (82%) | entrance blur-rise | layer behind | text Kng', '#01 0.4-2.2 | entrance blur-rise | layer behind | text King'), 'the rest of the file is byte for byte the same');
    assert.strictEqual(v.state.reference.mode, 'recreate', 'the mode and the picks are left alone'); assert.deepStrictEqual(v.state.picks.captionStyle.allow, ['kinetic']);
    const bad = await req('/api/reference/title', { n: 1, text: ' ' }); assert.strictEqual(bad.status, 400); assert.match(bad.error, /Type the text/);
    const none = await req('/api/reference/title', { n: 42, text: 'x' }); assert.strictEqual(none.status, 404);
    await req('/api/reference/clear', {}); const gone = await req('/api/reference/title', { n: 3, text: 'x' }); assert.strictEqual(gone.status, 400); assert.match(gone.error, /Add a reference/);
  });
  console.log(`studio-reflook: ${n} passed`);
} finally {
  try { await client?.close(); } catch {}
  if (srv) srv.kill();
  rmSync(TMP, { recursive: true, force: true }); rmSync(DIR, { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`), { recursive: true, force: true });
}
