// The font and a reference (Will, 2026-11-21: a Recreate used the font combo picked for the video before it).
// - a reference whose style we copy (Recreate, Copy the look) clears an older font pick and its own font is used:
//   no --fonts goes to the reel, so the pairing the teardown matched (Reel.md Brand kit fonts) draws the words
// - a font you pick after that is yours and holds (state.fontLock)
// - Back to my look gives your earlier font back; Influence leaves your font alone
// - a new reference, a new video, new footage on a board with an edit and a saved look each clear the pick and the lock
// - the teardown's font goes into the recipe, the look and build/match.json, and Review shows Font: Matched, Close or Guess
// No server, no Chrome, no network. Run: node tests/studio-fonts.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const TMP = mkdtempSync(join(tmpdir(), 'studio-fonts-test-'));
process.env.STUDIO_DIR = join(TMP, 'studio'); process.env.LOOKS_DIR = join(TMP, 'looks'); mkdirSync(process.env.STUDIO_DIR, { recursive: true });
const C = await import('../kit/studio/core.mjs');
const { matchChips } = await import('../kit/studio/web/src/steps.js');
const FID = require('../kit/fidelity.cjs'), RM = require('../kit/reelmd.cjs'), V2R = require('../kit/videomd2reel.cjs'), SL = require('../kit/stylelook.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const cat = C.catalog();
const fontsArg = s => { const a = C.compose(s).args, i = a.indexOf('--fonts'); return i < 0 ? null : a[i + 1]; };
const picked = s => ((s.picks.font && s.picks.font.allow) || []).slice();

// a reference recipe whose teardown matched a font: the shipped cinematic recipe with the lines kit/teardown writes
const refDir = name => { const d = join(TMP, name); mkdirSync(d, { recursive: true });
  const md = readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8').replace(/^- fonts:.*$/m, '- fonts: haas').replace(/^- captions:.*$/m, m => m + '\n- font: sans bold\n- font-face: Inter Tight\n- font-match: close');
  assert.ok(/- fonts: haas/.test(md) && /- font-match: close/.test(md), 'the test recipe carries the font lines');
  writeFileSync(join(d, 'Reel.md'), md); return d; };
const A = refDir('ref-a'), B = refDir('ref-b');
const EX = C.extract(join(A, 'Reel.md'));
const withRef = (s, dir, mode) => { s.reference = { ...C.defaultState().reference, status: 'ready', mode: 'off', out: dir, extracted: C.extract(join(dir, 'Reel.md')), active: null }; const r = C.applyPatch(s, { reference: { mode } }, cat); assert.deepStrictEqual(r.errs, []); return s; };
// the board as the last video left it: a blackletter combo picked there
const old = () => { const s = C.defaultState(); s.job = 'video-one'; const r = C.applyPatch(s, { picks: { 'font:pirata': 'allow' } }, cat); assert.deepStrictEqual(r.errs, []); return s; };

try {
  t('a font you pick is sent to the reel when no reference is in use', () => {
    const s = old(); assert.deepStrictEqual(picked(s), ['pirata']); assert.strictEqual(fontsArg(s), 'pirata'); });

  t('the teardown\'s font is read from the recipe: pairing, kind, face and how sure', () => {
    assert.deepStrictEqual(EX.font, { pairing: 'haas', kind: 'sans bold', face: 'Inter Tight', match: 'close' });
    assert.strictEqual(RM.toPreset(RM.load(join(A, 'Reel.md'))).fonts, 'haas', 'the reel draws with it (the recipe preset)');
    assert.strictEqual(C.extract(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md')).font, null, 'a recipe with no font read has none'); });

  t('Recreate: the old font pick is cleared and never sent, so the reference\'s font draws the words', () => {
    const s = withRef(old(), A, 'recreate');
    assert.deepStrictEqual(picked(s), [], 'the pick from the last video is gone'); assert.strictEqual(s.fontLock, false);
    assert.strictEqual(fontsArg(s), null, 'no --fonts: the recipe\'s own pairing is used');
    assert.deepStrictEqual(C.refFontOf(s), { from: 'reference', locked: false, font: EX.font }, 'the page can say whose font it is'); });

  t('a state file from before this fix (a font pick, no lock) still cannot leak into a Recreate', () => {
    const s = C.defaultState(); s.picks = { font: { allow: ['pirata'], deny: [] } }; delete s.fontLock;
    s.reference = { ...s.reference, status: 'ready', mode: 'recreate', out: A, extracted: EX, fontFor: A }; // already in use, never synced
    assert.strictEqual(fontsArg(s), null); assert.ok(C.compose(s).notes.some(x => /the reference sets them/.test(x)), 'and the notes say why'); });

  t('a font picked after the reference is yours and holds', () => {
    const s = withRef(old(), A, 'recreate');
    assert.deepStrictEqual(C.applyPatch(s, { picks: { 'font:literata': 'allow' } }, cat).errs, []);
    assert.strictEqual(s.fontLock, true); assert.strictEqual(fontsArg(s), 'literata'); assert.strictEqual(C.refFontOf(s).locked, true);
    // it holds through another look at the same reference (a mode change and back, a re-read)
    C.setReferenceLook(s, cat); assert.strictEqual(fontsArg(s), 'literata', 'the same reference set again keeps your font');
    // and taking it back hands the font back to the reference
    C.applyPatch(s, { picks: { 'font:literata': 'clear' } }, cat); assert.strictEqual(s.fontLock, false); assert.strictEqual(fontsArg(s), null); });

  t('locking the theme\'s own fonts over a reference is sent too', () => {
    const s = withRef(old(), A, 'recreate'); C.applyPatch(s, { picks: { 'font:theme': 'allow' } }, cat);
    assert.strictEqual(s.fontLock, true); assert.strictEqual(fontsArg(s), 'theme'); });

  t('Copy the look does the same as Recreate', () => {
    const s = withRef(old(), A, 'look'); assert.deepStrictEqual(picked(s), []); assert.strictEqual(fontsArg(s), null);
    C.applyPatch(s, { picks: { 'font:bricolage': 'allow' } }, cat); assert.strictEqual(fontsArg(s), 'bricolage'); });

  t('Back to my look gives your earlier font back; Recreate again clears it again', () => {
    const s = withRef(old(), A, 'recreate');
    C.applyPatch(s, { reference: { mode: 'off' } }, cat); assert.deepStrictEqual(picked(s), ['pirata']); assert.strictEqual(fontsArg(s), 'pirata');
    C.applyPatch(s, { reference: { mode: 'recreate' } }, cat); assert.deepStrictEqual(picked(s), []); assert.strictEqual(fontsArg(s), null); });

  t('Influence keeps your look, so your font stays and is sent', () => {
    const s = withRef(old(), A, 'influence'); assert.deepStrictEqual(picked(s), ['pirata']); assert.strictEqual(fontsArg(s), 'pirata'); assert.strictEqual(C.refFontOf(s), null); });

  t('a new reference clears the font again, a locked one too', () => {
    const s = withRef(old(), A, 'recreate'); C.applyPatch(s, { picks: { 'font:literata': 'allow' } }, cat); assert.strictEqual(fontsArg(s), 'literata');
    s.reference = { ...s.reference, out: B, extracted: C.extract(join(B, 'Reel.md')), auto: null }; C.setReferenceLook(s, cat); // what the server does when another reference comes into use
    assert.deepStrictEqual(picked(s), []); assert.strictEqual(s.fontLock, false); assert.strictEqual(fontsArg(s), null); });

  t('a new video never carries the font over, with Keep my look or without', () => {
    for (const keepLook of [true, false]) { const s = old(); s.fontLock = true; s.pack = 'magazine'; C.freshSession(s, { job: 'video-two', keepLook });
      assert.deepStrictEqual(picked(s), [], `keepLook ${keepLook}`); assert.strictEqual(s.fontLock, false); assert.strictEqual(fontsArg(s), null);
      assert.strictEqual(s.pack, keepLook ? 'magazine' : C.defaultState().pack, 'the rest of the look follows Keep my look as before'); } });

  t('new footage on a board that already has an edit clears the font with the rest of the old edit', () => {
    const s = withRef(old(), A, 'recreate'); C.applyPatch(s, { picks: { 'font:literata': 'allow' } }, cat); s.keepLook = true;
    C.resetEdit(s); assert.deepStrictEqual(picked(s), []); assert.strictEqual(s.fontLock, false); assert.strictEqual(fontsArg(s), null); });

  t('a saved look brings its own font: picking one clears your font, and it holds no lock', () => {
    const look = SL.fromTeardown(A, { name: 'fonts-test-look' });
    assert.deepStrictEqual(look.captions.font, { pairing: 'haas', kind: 'sans bold', face: 'Inter Tight', match: 'close' }); assert.deepStrictEqual(look.titles.font, look.captions.font);
    assert.strictEqual(look.brand.fonts, 'haas'); assert.strictEqual(RM.toPreset(SL.toRecipe(look)).fonts, 'haas', 'a draft with the look draws with it');
    SL.save(look);
    const s = old(); assert.deepStrictEqual(C.applyPatch(s, { styleLook: 'fonts-test-look' }, cat).errs, []);
    assert.deepStrictEqual(picked(s), []); assert.strictEqual(fontsArg(s), null);
    C.applyPatch(s, { picks: { 'font:pirata': 'allow' } }, cat); assert.strictEqual(fontsArg(s), 'pirata', 'your own pick after it holds'); });

  t('the converter only ever names a pairing we ship', () => {
    assert.deepStrictEqual(V2R.fontOf({ pairing: 'pirata', category: 'blackletter', weight: 'bold', case: 'lower', color: '#FFFFFF', match: 'matched', score: 0.9, samples: 12 }),
      { pairing: 'pirata', category: 'blackletter', weight: 'bold', case: 'lower', color: '#ffffff', face: 'Pirata One', match: 'matched', score: 0.9, samples: 12 });
    assert.strictEqual(V2R.fontOf({ pairing: '../../etc/passwd', match: 'matched' }), null); assert.strictEqual(V2R.fontOf(null), null);
    assert.strictEqual(V2R.fontOf({ pairing: 'haas', match: 'sure' }).match, 'guess', 'an unknown word reads as a guess'); });

  t('match.json has a font part and Review shows Font: Matched, Close or Guess', () => {
    const tgt = m => ({ pairing: 'haas', kind: 'sans bold', face: 'Inter Tight', match: m });
    for (const [m, word] of [['matched', 'Matched'], ['close', 'Close'], ['guess', 'Guess']]) {
      const p = FID.fontPart({ fonts: 'haas' }, tgt(m)); assert.strictEqual(p.word, word); assert.ok(p.score > 0 && /Inter Tight/.test(p.note));
      const chip = matchChips({ overall: 80, parts: { font: p, captions: { score: 100, note: 'x' } } }).find(c => c.id === 'font');
      assert.deepStrictEqual({ label: chip.label, word: chip.word }, { label: 'Font', word }); }
    const mine = FID.fontPart({ fonts: 'pirata' }, tgt('matched')); assert.strictEqual(mine.word, 'Off'); assert.ok(/your own pick/.test(mine.note));
    assert.strictEqual(FID.fontPart({ fonts: 'haas' }, null).score, null, 'no font read: no chip');
    assert.strictEqual(matchChips({ parts: { font: FID.fontPart({ fonts: 'haas' }, null) } }).length, 0);
    const recipe = RM.load(join(A, 'Reel.md')); assert.deepStrictEqual(FID.targetOfRecipe(recipe, { len: 20 }).font, tgt('close'));
    assert.deepStrictEqual(FID.targetOfLook(SL.fromTeardown(A, { name: 'x' }), { len: 20 }).font, tgt('close'));
    assert.ok(matchChips({ parts: { framing: { score: 95 }, font: FID.fontPart({ fonts: 'haas' }, tgt('close')) } }).map(c => c.label + ' ' + c.word).includes('Font Close')); });
  console.log(`\n${n} studio font tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
