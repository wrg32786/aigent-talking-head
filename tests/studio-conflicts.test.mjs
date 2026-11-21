// Settings that rule out others (1.20.0, kit/studio/conflicts.mjs), with no Chrome, no keys and no network:
// - every rule matches the engine: caption entrances only move Kinetic captions (kit/overlay.html), titles are off in
//   the Classic look and the minimal-clean Look (kit/reel.cjs), Beat sync needs music, Sound map and Sparse sounds need
//   sound effects, Tighten pauses and Keep pauses, Punch-in and Zoom punch off
// - a change that rules out a pick turns it off with one line ("Single word captions turned off the Typewriter caption
//   entrance."), and Undo puts it back; a ruled out pick the same change asks for is refused with the reason
// - switchFor: the one click switch picks the option and the one change it needs
// - compose never sends a ruled out pick to the reel and says so; Sound map reaches the reel (--sfx-map)
// - the page and the server read the same file; the agent (MCP studio_set_selections) gets the same rules
// Run: node tests/studio-conflicts.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-conflicts-')), SDIR = join(STATE, 'studio');
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
const CF = await import('../kit/studio/conflicts.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const cat = C.catalog();
const fresh = () => JSON.parse(JSON.stringify({ ...C.defaultState(), job: 'conflicts-test' }));
const allow = (s, k) => (s.picks[k] && s.picks[k].allow) || [];

let client;
try {
  await t('the rules match the engine: caption entrances move Kinetic captions only, titles off in Classic', async () => {
    const ov = readFileSync(join(ROOT, 'kit', 'overlay.html'), 'utf8');
    // the only caller of the caption entrance is kinetic(), which only Kinetic captions reach
    assert.strictEqual((ov.match(/capEnter\(ce,/g) || []).length, 1); assert.ok(/if\(st==='kinetic'\)re/.test(ov), 'caption() sends Kinetic captions to kinetic()');
    const reel = readFileSync(join(ROOT, 'kit', 'reel.cjs'), 'utf8');
    assert.ok(reel.includes("look !== 'classic'"), 'reel.cjs: titles off in the Classic look');
    assert.ok(reel.includes("opt('style', (!lookFlag && preset && preset.captionStyle) || LOOK_STYLE[look])"), 'reel.cjs: a picked look wins over the pack, a picked style over both');
    for (const p of cat.packs) assert.ok(p.sets && typeof p.sets === 'object', p.name + ' has sets');
    assert.strictEqual(cat.packs.find(p => p.name === 'minimal-clean').sets.titles, false);
    assert.strictEqual(cat.packs.find(p => p.name === 'hormozi-bold').sets.captionStyle, 'hormozi');
    const ctx = s => CF.contextOf(s, cat);
    let s = fresh(); assert.strictEqual(ctx(s).style, 'kinetic'); assert.strictEqual(ctx(s).titles, true);
    s.picks = { captionStyle: { allow: ['one-word'], deny: [] } }; assert.strictEqual(CF.blockOf(cat.items['captionEntrance:typewriter'], ctx(s)).reason, 'Not with Single word captions');
    assert.strictEqual(CF.blockOf(cat.items['entrance:typewriter'], ctx(s)), null, 'title entrances still work with Single word captions');
    s = fresh(); s.pack = 'hormozi-bold'; assert.strictEqual(CF.blockOf(cat.items['captionEntrance:warp'], ctx(s)).reason, 'Not with Hormozi captions, set by the hormozi-bold Look');
    s.picks = { captionStyle: { allow: ['kinetic'], deny: [] } }; assert.strictEqual(CF.blockOf(cat.items['captionEntrance:warp'], ctx(s)), null, 'your caption style wins over the pack');
    s = fresh(); s.pack = 'minimal-clean'; assert.ok(/Titles are off in the minimal-clean Look/.test(CF.blockOf(cat.items['entrance:slam'], ctx(s)).reason));
    assert.ok(CF.blockOf(cat.items['titleLayer:behind'], ctx(s)));
    s = fresh(); s.picks = { look: { allow: ['classic'], deny: [] } }; assert.ok(/Classic look/.test(CF.blockOf(cat.items['entrance:drop'], ctx(s)).reason));
    s = fresh(); s.music.bed = 'none'; assert.strictEqual(CF.blockOf(cat.items['beatSync:beat-sync'], ctx(s)).reason, 'Not with No music'); assert.strictEqual(CF.blockOf(cat.items['beatSync:no-beat-sync'], ctx(s)), null);
    assert.ok(CF.controlOf('energy', ctx(s))); s.music.bed = 'auto'; assert.strictEqual(CF.controlOf('energy', ctx(s)), null);
    s.sound.sfx = 'off'; for (const r of ['editing:sfx-map', 'editing:sfx-cap']) assert.strictEqual(CF.blockOf(cat.items[r], ctx(s)).reason, 'Not with sound effects off'); assert.ok(CF.controlOf('cap', ctx(s)));
    s = fresh(); s.pace.tighten = 'off'; assert.strictEqual(CF.blockOf(cat.items['editing:tighten'], ctx(s)).reason, 'Not with Keep pauses');
    s = fresh(); s.pace.punch = 'off'; assert.strictEqual(CF.blockOf(cat.items['editing:punch'], ctx(s)).reason, 'Not with Zoom punch off');
    // every rule names a real option, and every reason is short and plain
    for (const r of CF.RULES) assert.ok(Object.values(cat.items).some(r.applies), r.id + ' covers an option');
    for (const it of Object.values(cat.items)) { const b = CF.blockOf(it, CF.contextOf({ ...fresh(), pack: 'minimal-clean', picks: { captionStyle: { allow: ['pill'], deny: [] } }, music: { bed: 'none' }, sound: { sfx: 'off' }, pace: { tighten: 'off', punch: 'off' } }, cat));
      if (b) { assert.ok(b.reason.length <= 60 && !/[\u2014\u2013]/.test(b.reason + b.why + b.act), b.reason); } }
  });
  await t('a pick that rules something out turns it off with one line, and Undo puts it back', async () => {
    const s = fresh();
    assert.deepStrictEqual(C.applyPatch(s, { picks: { 'captionEntrance:typewriter': 'allow' } }).errs, []);
    const r = C.applyPatch(s, { picks: { 'captionStyle:one-word': 'allow' } });
    assert.deepStrictEqual(r.errs, []); assert.deepStrictEqual(allow(s, 'captionEntrance'), []); assert.deepStrictEqual(r.off.map(o => o.ref), ['captionEntrance:typewriter']);
    assert.strictEqual(s.lastChange.text, 'Single word captions turned off the Typewriter caption entrance.');
    C.applyPatch(s, { undoChange: true });
    assert.deepStrictEqual(allow(s, 'captionEntrance'), ['typewriter']); assert.deepStrictEqual(allow(s, 'captionStyle'), []); assert.ok(!s.lastChange);
    // the next change drops the old line (its Undo would take that change back too)
    C.applyPatch(s, { picks: { 'captionStyle:one-word': 'allow' } }); assert.ok(s.lastChange); C.applyPatch(s, { picks: { 'transition:whip': 'allow' } }); assert.ok(!s.lastChange);
    // a pack or a look that has no titles turns off title picks, naming it
    const p = fresh(); C.applyPatch(p, { picks: { 'entrance:slam': 'allow', 'entrance:drop': 'allow' } }); C.applyPatch(p, { pack: 'minimal-clean' });
    assert.strictEqual(p.lastChange.text, 'The minimal-clean Look turned off the Slam and Drop title entrances.');
    // a Look you pick brings its own captions
    const l = fresh(); C.applyPatch(l, { picks: { 'captionStyle:pill': 'allow' } }); C.applyPatch(l, { picks: { 'look:classic': 'allow' } });
    assert.strictEqual(l.lastChange.text, 'The Classic look replaced your Pill captions.'); assert.deepStrictEqual(allow(l, 'captionStyle'), []);
    // the music and pace panel
    const m = fresh(); C.applyPatch(m, { picks: { 'beatSync:beat-sync': 'allow', 'editing:sfx-map': 'allow', 'editing:tighten': 'allow' } });
    C.applyPatch(m, { music: { bed: 'none' }, sound: { sfx: 'off' }, pace: { tighten: 'off' } });
    assert.strictEqual(m.lastChange.text, 'No music turned off Beat sync. Sound effects off turned off Sound map. Keep pauses turned off Tighten pauses.');
    assert.deepStrictEqual(allow(m, 'beatSync'), []); assert.deepStrictEqual(allow(m, 'editing'), []);
  });
  await t('a ruled out pick is refused with the reason, and switchFor switches in one go', async () => {
    const s = fresh(); C.applyPatch(s, { picks: { 'captionStyle:one-word': 'allow' } });
    const r = C.applyPatch(s, { picks: { 'captionEntrance:cascade': 'allow' } });
    assert.strictEqual(r.errs.length, 1); assert.ok(/Not with Single word captions\. Caption entrances only move Kinetic captions\. To switch, send switchFor/.test(r.errs[0]), r.errs[0]);
    assert.deepStrictEqual(allow(s, 'captionEntrance'), []);
    // asking for both at once is fine
    const b = fresh(); C.applyPatch(b, { picks: { 'captionStyle:one-word': 'allow' } }); assert.deepStrictEqual(C.applyPatch(b, { picks: { 'captionStyle:kinetic': 'allow', 'captionEntrance:cascade': 'allow' } }).errs, []);
    const w = C.applyPatch(s, { switchFor: 'captionEntrance:cascade' });
    assert.deepStrictEqual(w.errs, []); assert.deepStrictEqual(allow(s, 'captionEntrance'), ['cascade']); assert.deepStrictEqual(allow(s, 'captionStyle'), ['kinetic']);
    assert.strictEqual(s.lastChange.text, 'Switched to Kinetic captions for the Cascade caption entrance.');
    C.applyPatch(s, { undoChange: true }); assert.deepStrictEqual(allow(s, 'captionStyle'), ['one-word']); assert.deepStrictEqual(allow(s, 'captionEntrance'), []);
    // titles: back on with your captions kept
    const p = fresh(); C.applyPatch(p, { pack: 'minimal-clean' }); C.applyPatch(p, { switchFor: 'entrance:slam' });
    assert.deepStrictEqual(allow(p, 'entrance'), ['slam']); assert.deepStrictEqual(allow(p, 'look'), ['kinetic']); assert.deepStrictEqual(allow(p, 'captionStyle'), ['classic']);
    assert.ok(CF.contextOf(p, cat).titles);
    const m = fresh(); m.music.bed = 'none'; C.applyPatch(m, { switchFor: 'beatSync:beat-sync' }); assert.strictEqual(m.music.bed, 'auto'); assert.deepStrictEqual(allow(m, 'beatSync'), ['beat-sync']);
    const q = fresh(); q.pace.punch = 'off'; C.applyPatch(q, { switchFor: 'editing:punch' }); assert.strictEqual(q.pace.punch, 'on');
    assert.ok(/no option/.test(C.applyPatch(fresh(), { switchFor: 'transition:nope' }).errs[0]));
  });
  await t('compose never sends a ruled out pick to the reel, and says why; Sound map reaches the reel', async () => {
    const s = fresh(); s.pack = 'hormozi-bold'; s.picks = { captionEntrance: { allow: ['warp'], deny: [] }, entrance: { allow: ['slam'], deny: [] } };
    const c = C.compose(s);
    assert.ok(!c.args.includes('--caption-entrance')); assert.ok(!/caption-entrance/.test(c.lockString || '')); assert.ok(/titles=slam/.test(c.lockString));
    assert.deepStrictEqual(c.conflicts.map(x => x.ref), ['captionEntrance:warp']); assert.ok(c.notes.includes('not used: the Warp caption entrance (Not with Hormozi captions, set by the hormozi-bold Look)'));
    const k = fresh(); k.picks = { captionEntrance: { allow: ['warp'], deny: [] } }; assert.ok(C.compose(k).args.join(' ').includes('--caption-entrance warp'));
    const m = fresh(); m.picks = { editing: { allow: ['sfx-map'], deny: [] } }; assert.ok(C.compose(m).args.includes('--sfx-map'));
    m.picks = { editing: { allow: [], deny: ['sfx-map'] } }; assert.ok(C.compose(m).args.includes('--no-sfx-map'));
    const reel = readFileSync(join(ROOT, 'kit', 'reel.cjs'), 'utf8'); assert.ok(reel.includes("flag('no-sfx-map')") && reel.includes("flag('sfx-map')"));
  });
  await t('the page reads the same rules file', async () => {
    const src = join(ROOT, 'kit', 'studio', 'web', 'src');
    assert.ok(/from '\.\.\/\.\.\/conflicts\.mjs'/.test(readFileSync(join(src, 'Style.jsx'), 'utf8')));
    assert.ok(/from '\.\.\/\.\.\/conflicts\.mjs'/.test(readFileSync(join(src, 'BRoll.jsx'), 'utf8')));
    const conf = readFileSync(join(ROOT, 'kit', 'studio', 'conflicts.mjs'), 'utf8'); assert.ok(!/^import /m.test(conf), 'no imports, so the page can bundle it');
    const built = readdirSync(join(ROOT, 'kit', 'studio', 'public', 'assets')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(ROOT, 'kit', 'studio', 'public', 'assets', f), 'utf8')).join('\n');
    assert.ok(built.includes('Caption entrances only move Kinetic captions.'), 'the built page carries the rules (npm run studio:build)');
  });
  await t('MCP: studio_set_selections refuses a ruled out pick with the reason, turns off what a change rules out, switches', async () => {
    mkdirSync(SDIR, { recursive: true }); writeFileSync(join(SDIR, 'state.json'), JSON.stringify(fresh()));
    client = new Client({ name: 'conflicts-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: SDIR, STUDIO_PORT: '1' } }));
    const tool = (await client.listTools()).tools.find(x => x.name === 'studio_set_selections');
    assert.ok(/caption entrances only move Kinetic captions/.test(tool.description)); assert.ok(tool.inputSchema.properties.switchFor && tool.inputSchema.properties.undoChange);
    const call = async args => { const r = await client.callTool({ name: 'studio_set_selections', arguments: args }); return { err: r.isError, body: r.isError ? r.content[0].text : (r.structuredContent || JSON.parse(r.content[0].text)) }; };
    assert.ok(!(await call({ picks: { 'captionEntrance:typewriter': 'allow' } })).err);
    const off = await call({ picks: { 'captionStyle:one-word': 'allow' } });
    assert.deepStrictEqual(off.body.turnedOff.map(o => o.ref), ['captionEntrance:typewriter']); assert.ok(/^Single word captions turned off the Typewriter caption entrance\./.test(off.body.note));
    const no = await call({ picks: { 'captionEntrance:orbit': 'allow' } }); assert.ok(no.err); assert.ok(/Not with Single word captions/.test(no.body), no.body);
    const sw = await call({ switchFor: 'captionEntrance:orbit' }); assert.ok(!sw.err); assert.ok(sw.body.changed.some(x => /Switched to Kinetic captions/.test(x)));
    const st = JSON.parse(readFileSync(join(SDIR, 'state.json'), 'utf8')); assert.deepStrictEqual(st.picks.captionEntrance.allow, ['orbit']); assert.deepStrictEqual(st.picks.captionStyle.allow, ['kinetic']);
  });
  console.log(`studio-conflicts: ${n} passed`);
} finally {
  try { await client?.close(); } catch {}
  rmSync(STATE, { recursive: true, force: true });
}
