// Nothing from the last video reaches a draft that copies a reference (Will, 2026-11-21, after a Recreate on his PC:
// "i think it was looking for stuff based on the previous selected styles etc?"; report 4 item 7).
// The board here is as a previous video left it: a Look, a font, a caption style, a look, a theme, a title layer, title
// entrances, transitions, finishes, effects, a graphic, a music bed and energy, sounds off, pace, and B-roll ideas with
// their search words. Then a reference comes into use (Recreate or Copy the look):
// - none of those reaches the draft's reel arguments or its locks, and none of the old B-roll search words is left
// - what you pick after the reference is yours and holds; a new reference clears that too
// - a reference still on its way counts from the moment you chose it
// - Back to my look gives the old look back, and the page says "Your saved look is in use, not the reference's"
//   with one button that switches to the reference; Influence says it too when your Look or picks sit under it
// - a board saved before this rule is set from the reference alone the first time it is read
// - a new video and new footage do not bring the old B-roll ideas along
// No server, no Chrome, no network. Run: node tests/studio-leak.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = mkdtempSync(join(tmpdir(), 'studio-leak-test-'));
process.env.STUDIO_DIR = join(TMP, 'studio'); process.env.LOOKS_DIR = join(TMP, 'looks'); mkdirSync(process.env.STUDIO_DIR, { recursive: true });
const C = await import('../kit/studio/core.mjs');
const LANE = await import('../kit/studio/lane.mjs');
const CH = await import('../kit/studio/channel.mjs');
const LLM = await import('../kit/studio/llm.mjs');
const SLK = await import('../kit/studio/stylelooks.mjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const cat = C.catalog();
const ok = (s, p) => { const r = C.applyPatch(s, p, cat); assert.deepStrictEqual(r.errs, [], JSON.stringify(p)); return r; };

// two references: the shipped cinematic recipe (kinetic captions, film and crossfade, its own entrances, bed and pack)
const refDir = (name, edit = x => x) => { const d = join(TMP, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'Reel.md'), edit(readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8'))); return d; };
const A = refDir('ref-a'), B = refDir('ref-b');
const EX = C.extract(join(A, 'Reel.md'));
assert.strictEqual(EX.captionStyle, 'kinetic'); assert.deepStrictEqual(EX.entrances, ['blur-rise', 'slide-left', 'stagger-rise']); assert.strictEqual(EX.music.bed, 'cinematic-build');

// what the video before left on the board. None of it is in the reference above.
const OLD = { pack: 'hormozi-bold', picks: { 'font:pirata': 'allow', 'captionStyle:one-word': 'allow', 'look:one-word': 'allow', 'theme:magazine': 'allow', 'titleLayer:behind': 'allow',
  'entrance:pop-zoom': 'allow', 'entrance:slam': 'allow', 'entrance:elastic': 'allow', 'transition:glitch': 'allow', 'transition:dip': 'allow', 'finish:bleach': 'allow', 'finish:cool': 'allow',
  'effect:led-sign': 'allow', 'effect:scribble': 'allow', 'graphic:split-flap': 'allow', 'transition:dissolve': 'deny' },
  music: { bed: 'houston-drumline', energy: 'high' }, sound: { sfx: 'off', cap: 'off' }, pace: { tighten: 0.25, punch: 'off' } };
// every word of the old look that must not show up in a draft's arguments
const OLD_WORDS = ['hormozi-bold', 'pirata', 'one-word', 'magazine', 'behind', 'pop-zoom', 'slam', 'elastic', 'glitch', 'dip', 'dissolve', 'bleach', 'cool', 'led-sign', 'scribble', 'split-flap', 'houston-drumline', 'high', '--no-sfx', '--no-sfx-cap', '--no-punch', '--tighten', '--theme', '--title-layer', '--fonts'];
const OLD_IDEAS = () => ({ 1: { idea: 'Stock: sourdough starter', why: 'old', query: 'sourdough starter', by: 'Studio', source: 'rules' }, 2: { idea: 'Like the reference: a bakery counter', why: 'old', query: 'bakery counter', by: 'Studio', source: 'reference' },
  3: { idea: 'Stock: oven timer', why: 'old', query: 'oven timer', by: 'the rules' }, 4: { idea: 'A chart of rising dough', why: 'from the agent', query: 'dough chart', by: 'Claude Code' } });
const oldBoard = () => { const s = C.defaultState(); s.job = 'from-the-heart'; ok(s, OLD); s.footage = ['inbox/studio/from-the-heart/a.mp4']; s.broll = { 'from-the-heart': { slots: {}, ideas: OLD_IDEAS(), marks: [], cutins: [] } }; return s; };
const useRef = (s, dir, mode) => { s.reference = { ...C.defaultState().reference, status: 'ready', mode: s.reference.mode, out: dir, extracted: C.extract(join(dir, 'Reel.md')), active: null }; if (s.reference.mode === mode) C.setReferenceLook(s, cat); else ok(s, { reference: { mode } }); return s; };
// the reel arguments of a Recreate draft, as kit/studio/server.mjs draftSteps builds them
const draftArgs = s => { const comp = C.compose(s); assert.deepStrictEqual(comp.errs, []); const a = comp.args.slice(); return { args: s.reference.mode === 'recreate' ? C.recreateArgs(a, 'ref/Reel.md') : a, comp }; };
const words = args => args.join(' ').split(/[\s,;=]+/);
const noneOfOld = (s, why) => { const { args, comp } = draftArgs(s), w = words(args); for (const x of OLD_WORDS) assert.ok(!w.includes(x), `${why}: "${x}" from the last video is in the draft's arguments: ${args.join(' ')}`);
  assert.ok(!comp.effects.some(e => ['led-sign', 'scribble'].includes(e)), `${why}: the old effects are in the effects pass`); return { args, comp }; };
const queries = s => Object.values(((s.broll || {})[s.job] || {}).ideas || {}).map(x => x.query);

try {
  t('the old board, with no reference: its picks are what a draft uses (so the test can see a leak)', () => {
    const s = oldBoard(), w = words(C.compose(s).args);
    for (const x of ['hormozi-bold', 'pirata', 'one-word', 'magazine', 'behind', 'pop-zoom', 'glitch', 'bleach', 'houston-drumline', '--no-sfx', '--no-punch', '--tighten']) assert.ok(w.includes(x), x + ' is sent'); });

  t('a new video keeps the look by default (Keep my look), and still not the font or the B-roll ideas', () => {
    const s = oldBoard(); C.switchVideo(s, { name: 'video-two' }, { checkBusy: false });
    assert.strictEqual(s.job, 'video-two'); assert.strictEqual(s.pack, 'hormozi-bold'); assert.ok(!s.picks.font, 'the font never rides along');
    assert.deepStrictEqual(queries(s), [], 'no B-roll idea or search word from the old video'); assert.deepStrictEqual(s.chat.filter(m => m.role === 'user'), [], 'and no chat from it');
    assert.strictEqual(C.savedLookOf(s), null, 'no reference, so nothing to say about whose look it is'); });

  t('Recreate on that board: none of the last video\'s picks reaches the draft', () => {
    const s = oldBoard(); C.switchVideo(s, { name: 'video-three' }, { checkBusy: false }); useRef(s, A, 'recreate');
    const { args, comp } = noneOfOld(s, 'Recreate');
    assert.ok(args.includes('--recipe') && args.includes('--recut') && !args.includes('--pack'), 'the reference\'s recipe is the look');
    assert.strictEqual(comp.locks.titles, undefined, 'no title entrance lock at all (report 4 item 9: the lock held the old three; a reference\'s own entrances are a preference, never a lock)');
    assert.deepStrictEqual(comp.locks.transitions, ['film', 'crossfade']); assert.ok(!comp.locks.graphics, 'no graphics lock from the old video');
    assert.strictEqual(args[args.indexOf('--style') + 1], 'kinetic'); assert.strictEqual(args[args.indexOf('--bed') + 1], 'cinematic-build');
    assert.deepStrictEqual(s.sound, { sfx: 'on', cap: 'on' }); assert.strictEqual(s.pace.tighten, null); assert.strictEqual(s.pace.punch, 'on');
    assert.deepStrictEqual(C.savedLookOf(s), { inUse: false, by: [], text: null, mode: 'recreate', name: null, yours: [] }, 'the reference\'s look alone: the page has nothing to flag'); });

  t('the same on one board (no new video): the reference clears what was picked before it, B-roll ideas from the old reference too', () => {
    const s = oldBoard(); useRef(s, A, 'recreate'); noneOfOld(s, 'Recreate, same video');
    assert.ok(!queries(s).includes('bakery counter'), 'an idea made from an older reference goes when the reference changes');
    assert.strictEqual(C.dropAutoIdeas(s), 2, 'a new draft drops the ideas we made for the older cut');
    assert.deepStrictEqual(queries(s), ['dough chart'], 'an idea your agent added stays'); });

  t('Copy the look clears the same way', () => {
    const s = oldBoard(); useRef(s, A, 'look'); const { args } = noneOfOld(s, 'Copy the look');
    assert.ok(!args.includes('--recipe'), 'Copy the look never re-cuts'); });

  t('B-roll searches come from the new take\'s words', () => {
    const p = LANE.pick({ text: 'Our dashboard shows every invoice in one place', seconds: 4, start: 0, end: 4 });
    assert.ok(p && p.query, 'a spot gets a search from its own words');
    for (const w of ['sourdough', 'bakery', 'oven', 'starter']) assert.ok(!p.query.includes(w));
    assert.ok(/dashboard|invoice/.test(p.query), p.query); });

  t('what you pick after the reference is yours and reaches the draft', () => {
    const s = oldBoard(); useRef(s, A, 'recreate');
    ok(s, { picks: { 'captionStyle:pill': 'allow', 'entrance:drop': 'allow', 'font:literata': 'allow', 'theme:neutral': 'allow' }, music: { bed: 'granular-stabs' }, sound: { sfx: 'off' } });
    const { args, comp } = draftArgs(s);
    assert.strictEqual(args[args.indexOf('--style') + 1], 'pill'); assert.strictEqual(args[args.indexOf('--fonts') + 1], 'literata'); assert.strictEqual(args[args.indexOf('--theme') + 1], 'neutral');
    assert.strictEqual(args[args.indexOf('--bed') + 1], 'granular-stabs'); assert.ok(args.includes('--no-sfx')); assert.ok(comp.locks.titles.includes('drop'));
    const l = C.savedLookOf(s); assert.strictEqual(l.inUse, false, 'a pick made for this video is not a saved look: no line on the page'); assert.strictEqual(l.text, null);
    assert.deepStrictEqual(l.yours, ['captions', 'titles', 'sound', 'fonts'], 'the agent is told which parts are yours'); });

  t('"Use the reference\'s look" takes your picks back out', () => {
    const s = oldBoard(); useRef(s, A, 'recreate'); ok(s, { picks: { 'captionStyle:pill': 'allow', 'font:literata': 'allow' }, music: { bed: 'granular-stabs' } });
    ok(s, { useReferenceLook: true });
    const { args } = noneOfOld(s, 'after Use the reference\'s look'); assert.strictEqual(args[args.indexOf('--style') + 1], 'kinetic'); assert.ok(!args.includes('--fonts')); assert.strictEqual(args[args.indexOf('--bed') + 1], 'cinematic-build');
    assert.deepStrictEqual(C.savedLookOf(s).yours, []); });

  t('a new reference clears the picks made under the one before', () => {
    const s = oldBoard(); useRef(s, A, 'recreate'); ok(s, { picks: { 'captionStyle:pill': 'allow', 'transition:whip': 'allow' } });
    useRef(s, B, 'recreate');
    const { args, comp } = noneOfOld(s, 'a second reference'); assert.strictEqual(args[args.indexOf('--style') + 1], 'kinetic'); assert.deepStrictEqual(comp.locks.transitions, ['film', 'crossfade']); });

  t('a reference still on its way counts from the moment you chose it: what you pick while you wait holds', () => {
    const s = oldBoard(); ok(s, { reference: { mode: 'recreate' } });
    s.reference.queue = [{ id: 1, url: 'https://example.com/reel', status: 'downloading' }]; C.syncRefFont(s);
    assert.strictEqual(s.pack, null); assert.deepStrictEqual(Object.keys(s.picks), [], 'the old look is set aside as soon as the link is added');
    ok(s, { picks: { 'theme:neutral': 'allow', 'font:literata': 'allow' }, pace: { tighten: 0.45 } });
    s.reference.queue[0].status = 'ready'; s.reference = { ...s.reference, active: 1, status: 'ready', out: A, extracted: EX, auto: null }; C.setReferenceLook(s, cat);
    const { args } = draftArgs(s); assert.strictEqual(args[args.indexOf('--theme') + 1], 'neutral'); assert.strictEqual(args[args.indexOf('--fonts') + 1], 'literata'); assert.strictEqual(args[args.indexOf('--tighten') + 1], '0.45');
    for (const x of ['hormozi-bold', 'pirata', 'pop-zoom', 'houston-drumline', '--no-sfx']) assert.ok(!words(args).includes(x), x); });

  t('Back to my look gives the old look back, and the page says so with one button to the reference', () => {
    const s = oldBoard(); useRef(s, A, 'recreate'); ok(s, { reference: { mode: 'off' } });
    assert.strictEqual(s.pack, 'hormozi-bold'); assert.deepStrictEqual(s.picks.captionStyle.allow, ['one-word']); assert.deepStrictEqual(s.picks.entrance.allow, ['pop-zoom', 'slam', 'elastic']);
    assert.strictEqual(s.music.bed, 'houston-drumline'); assert.strictEqual(s.sound.sfx, 'off'); assert.strictEqual(s.pace.punch, 'off'); assert.deepStrictEqual(s.picks.font.allow, ['pirata']);
    const sl = C.savedLookOf(s); assert.strictEqual(sl.inUse, true); assert.strictEqual(sl.text, 'Your saved look is in use, not the reference\'s'); assert.strictEqual(sl.name, 'hormozi-bold'); assert.strictEqual(sl.mode, 'off');
    assert.ok(sl.by.some(b => b.ref === 'pack:hormozi-bold') && sl.by.some(b => b.ref === 'entrance:pop-zoom') && sl.by.some(b => b.ref === 'transition:dissolve' && b.deny), JSON.stringify(sl.by));
    ok(s, { useReferenceLook: true });
    assert.strictEqual(s.reference.mode, 'recreate', 'it comes back in the mode you last copied it with'); noneOfOld(s, 'after switching to the reference'); assert.strictEqual(C.savedLookOf(s).inUse, false);
    ok(s, { undoChange: true }); assert.strictEqual(s.reference.mode, 'off'); assert.strictEqual(s.pack, 'hormozi-bold'); assert.strictEqual(C.savedLookOf(s).inUse, true, 'one Undo brings the saved look back'); });

  t('Influence is your look with the reference on top: nothing is cleared, and the page says your saved look is in use', () => {
    const s = oldBoard(); useRef(s, A, 'influence');
    assert.strictEqual(s.pack, 'hormozi-bold'); assert.ok(s.picks.entrance.allow.includes('pop-zoom'));
    const sl = C.savedLookOf(s); assert.strictEqual(sl.inUse, true); assert.ok(sl.by.some(b => b.ref === 'pack:hormozi-bold')); assert.ok(!sl.by.some(b => s.reference.added.includes(b.ref)), 'what the reference set is not counted');
    const clean = C.defaultState(); useRef(clean, A, 'influence'); assert.strictEqual(C.savedLookOf(clean).inUse, false, 'Influence on an empty board: nothing earlier to win');
    ok(s, { useReferenceLook: true }); assert.strictEqual(s.reference.mode, 'look', 'never copied before, so Copy the look'); noneOfOld(s, 'Influence, then Use the reference\'s look'); });

  t('a board saved before this rule (Recreate on, the old picks mixed in) is set from the reference alone when it is read', () => {
    const s = oldBoard(); s.reference = { ...s.reference, status: 'ready', mode: 'recreate', out: A, extracted: EX, applied: true, added: ['captionStyle:kinetic'], auto: { mode: 'recreate', n: 1 } };
    s.chat = []; writeFileSync(C.statePath(), JSON.stringify(s));
    const got = C.load(); noneOfOld(got, 'an older state file'); assert.ok(got.reference.lookFor, 'and it is marked, so your later picks hold');
    C.save(got); const again = C.load(); ok(again, { picks: { 'theme:neutral': 'allow' } }); C.save(again);
    assert.deepStrictEqual(C.load().picks.theme.allow, ['neutral'], 'a pick after that is kept across reads'); });

  t('new footage on a board with an edit clears the reference, its picks and the B-roll ideas', () => {
    const s = oldBoard(); useRef(s, A, 'recreate'); s.drafted = { key: 'k', at: 1 };
    C.addFootage(s, 'inbox/studio/from-the-heart/b.mp4');
    assert.strictEqual(s.reference.extracted, null); assert.deepStrictEqual(queries(s), []); assert.strictEqual(s.pack, null); assert.deepStrictEqual(s.picks, {}); });

  t('your agent is told whose look it is, so it does not bring an old style back', () => {
    const s = oldBoard(); useRef(s, A, 'recreate');
    const cx = CH.context(s); assert.strictEqual(cx.lookFrom.from, 'reference'); assert.strictEqual(cx.lookFrom.mode, 'recreate'); assert.ok(/earlier video/.test(cx.lookFrom.note));
    for (const x of ['hormozi-bold', 'pirata', 'houston-drumline', 'pop-zoom']) assert.ok(!JSON.stringify({ pack: cx.pack, picks: cx.picks, music: cx.music, reelArgs: cx.reelArgs }).includes(x), x + ' is not in the agent\'s context');
    const sp = LLM.systemPrompt(s, cat); assert.ok(/comes from the reference \(Recreate\)/.test(sp)); assert.ok(!/hormozi-bold"|pirata"|houston-drumline"/.test(sp.split('Current session: ')[1].split('\n')[0]));
    ok(s, { reference: { mode: 'off' } }); assert.strictEqual(CH.context(s).lookFrom.from, 'saved'); });

  t('the engine: Studio\'s "music energy auto" never goes over the reference\'s own music', () => {
    const src = readFileSync(join(ROOT, 'kit', 'reel.cjs'), 'utf8');
    assert.ok(/const energyFlag = recipe && opt\('music-energy'\) === 'auto' && \(preset && \(preset\.musicEnergy \|\| \(preset\.bed && preset\.bed !== 'auto'\)\)\) \? undefined : opt\('music-energy'\);/.test(src));
    assert.ok(/\(bed === 'auto' \|\| !bed \|\| energyFlag\)/.test(src), 'the recipe\'s bed is replaced only by an energy you picked'); });

  t('the hard-to-read words switch and the camera move size are part of the look: set aside, back with Back to my look, and Undo knows them', () => {
    const s = C.defaultState(); s.job = 'only-switches'; ok(s, { boost: 'off', pace: { motion: 'strong' } }); useRef(s, A, 'recreate');
    assert.ok(s.boost == null && !s.pace.motion, 'both are set aside'); assert.ok(s.reference.prevLook, 'a look that is only these two is still kept');
    ok(s, { reference: { mode: 'off' } }); assert.strictEqual(s.boost, 'off'); assert.strictEqual(s.pace.motion, 'strong');
    ok(s, { useReferenceLook: true }); assert.ok(s.boost == null); ok(s, { undoChange: true }); assert.strictEqual(s.boost, 'off', 'Undo of Use the reference\'s look brings the switch back'); });

  t('a saved look from the last video is not the plan while a reference you chose to copy is still being read', () => {
    const s = C.defaultState(); s.job = 'waiting'; s.styleLook = 'old-look'; s.reference = { ...s.reference, mode: 'recreate', status: 'running', url: 'https://example.com/v' };
    assert.strictEqual(SLK.plan(s, ROOT), null); s.reference.mode = 'off'; assert.strictEqual(SLK.plan(s, ROOT).name, 'old-look'); });

  t('Keep my look after a Recreate or Copy the look takes your own look into the new video, not the reference\'s', () => {
    for (const mode of ['recreate', 'look', 'influence']) {
      const s = useRef(oldBoard(), A, mode);
      if (mode !== 'influence') assert.notStrictEqual(s.pack, 'hormozi-bold', 'the reference is in use on the board');
      ok(s, { picks: { 'finish:chroma': 'allow' } }); // a pick made after the reference is yours
      const refAdded = (s.reference.added || []).slice();
      C.freshSession(s, { job: 'next-one', keepLook: true });
      assert.strictEqual(s.pack, 'hormozi-bold', mode + ': your Look comes along');
      assert.deepStrictEqual(s.music && [s.music.bed, s.music.energy], ['houston-drumline', 'high'], mode + ': your music');
      assert.ok(s.picks.transition && s.picks.transition.allow.includes('glitch'), mode + ': your transitions');
      assert.ok(s.picks.finish && s.picks.finish.allow.includes('chroma'), mode + ': a pick you made after the reference stays');
      for (const ref of refAdded) { const [k, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)]; if (k === 'bed') continue;
        assert.ok(!(s.picks[k] && s.picks[k].allow.includes(id)) || OLD.picks[ref], `${mode}: the reference's ${ref} does not ride into the new video`); }
      assert.ok(!s.reference || !s.reference.out, 'the new video has no reference');
      assert.ok(Object.values(s.picks).every(v => (v.allow || []).length + (v.deny || []).length > 0), mode + ': no empty slots');
    }
    for (const mode of ['recreate', 'look']) { // new footage with Keep my look on goes the same way
      const s = useRef(oldBoard(), A, mode); ok(s, { picks: { 'finish:chroma': 'allow' } });
      C.resetEdit(s, { keepLook: true });
      assert.strictEqual(s.pack, 'hormozi-bold', mode + ': new footage keeps your Look');
      assert.ok(s.picks.finish.allow.includes('chroma') && s.picks.transition.allow.includes('glitch'), mode + ': and your picks');
    }
    const off = C.freshSession(useRef(oldBoard(), A, 'recreate'), { job: 'clean', keepLook: false });
    assert.ok(!off.pack && !Object.keys(off.picks).filter(k => k !== 'font').length, 'without Keep my look the board is clean');
  });
  console.log(`\n${n} studio leak tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
