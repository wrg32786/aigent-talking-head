// The stroke on a title's small words, and the legibility shadow as a choice (Studio report 4 item 19).
// - a title's partner words follow captionOutline (none, thin, thick), as a kinetic caption's partners do: with
//   "none" no dark stroke is drawn round them (the real overlay, kit/overlay.html through kit/render.mjs)
// - Studio: "Make hard-to-read words easier to read" is on by default; it starts off when the reference whose style
//   we copy draws its captions with no outline or no shadow; your own choice wins either way; off sends --no-boost
// - npm run reel --no-boost also clears the moments an earlier build marked (captions.js "boost")
// Run: node tests/title-outline-boost.test.mjs   (the drawn part needs Chrome and ffmpeg; part of npm run check)
import assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), KIT = join(ROOT, 'kit');
const TMP = mkdtempSync(join(tmpdir(), 'outline-boost-test-'));
process.env.STUDIO_DIR = join(TMP, 'studio'); mkdirSync(process.env.STUDIO_DIR, { recursive: true });
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const cat = C.catalog();
const hasFf = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let chrome = null; try { chrome = (await import('../kit/chrome.mjs')).findChrome(); } catch {}

// a reference recipe as kit/teardown writes it, with the caption look lines we ask for
const refDir = (name, lines) => { const d = join(TMP, name); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'Reel.md'), readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8').replace(/^- captions:.*$/m, m => [m, ...lines].join('\n'))); return d; };
const withRef = (s, dir, mode) => { s.reference = { ...C.defaultState().reference, status: 'ready', mode: 'off', out: dir, extracted: C.extract(join(dir, 'Reel.md')), active: null }; const r = C.applyPatch(s, { reference: { mode } }, cat); assert.deepStrictEqual(r.errs, []); return s; };
const noBoost = s => C.compose(s).args.includes('--no-boost');

try {
  t('the switch is on by default and nothing is sent', () => {
    const s = C.defaultState(); assert.strictEqual(s.boost, null); assert.deepStrictEqual(C.boostOf(s), { on: true, by: 'default' }); assert.ok(!noBoost(s)); });
  t('your choice: off sends --no-boost, on takes it away again, anything else is refused', () => {
    const s = C.defaultState();
    assert.deepStrictEqual(C.applyPatch(s, { boost: 'off' }, cat).errs, []); assert.deepStrictEqual(C.boostOf(s), { on: false, by: 'you' }); assert.ok(noBoost(s));
    assert.deepStrictEqual(C.applyPatch(s, { boost: 'on' }, cat).errs, []); assert.ok(!noBoost(s));
    assert.ok(C.applyPatch(s, { boost: 'loud' }, cat).errs.length === 1); assert.strictEqual(s.boost, 'on');
    assert.deepStrictEqual(C.applyPatch(s, { boost: null }, cat).errs, []); assert.strictEqual(s.boost, null);
  });
  t('a reference with bare captions (no outline, or no shadow) starts it off, in Recreate and Copy the look only', () => {
    const bare = refDir('bare', ['- caption-outline: none', '- caption-shadow: soft']), bare2 = refDir('bare2', ['- caption-outline: thick', '- caption-shadow: none']), full = refDir('full', ['- caption-outline: thick', '- caption-shadow: soft']);
    assert.strictEqual(C.extract(join(bare, 'Reel.md')).captionPlain, true); assert.strictEqual(C.extract(join(full, 'Reel.md')).captionPlain, false);
    for (const d of [bare, bare2]) for (const mode of ['recreate', 'look']) { const s = withRef(C.defaultState(), d, mode); assert.deepStrictEqual(C.boostOf(s), { on: false, by: 'reference' }, mode); assert.ok(noBoost(s), mode); }
    const inf = withRef(C.defaultState(), bare, 'influence'); assert.ok(C.boostOf(inf).on && !noBoost(inf), 'Influence keeps your look, so the default holds');
    const f = withRef(C.defaultState(), full, 'recreate'); assert.ok(C.boostOf(f).on && !noBoost(f), 'a reference with an outline and a shadow leaves it on');
    const mine = withRef(C.defaultState(), bare, 'recreate'); C.applyPatch(mine, { boost: 'on' }, cat); assert.deepStrictEqual(C.boostOf(mine), { on: true, by: 'you' }); assert.ok(!noBoost(mine), 'you turned it on: it stays on');
  });
  t('the choice is part of the look a new video can keep', () => { assert.ok(C.LOOK_KEYS.includes('boost')); });
  t('the page has one plain switch for it on Text and graphics, and the agent tool takes the same field', () => {
    const jsx = ['Style.jsx', 'AllOptions.jsx'].map(f => readFileSync(join(KIT, 'studio', 'web', 'src', f), 'utf8')).join('\n'); // the layer tiles live in AllOptions.jsx since the builder
    assert.ok(/cur === 'text'[^\n]*id="boost"[^\n]*label="Make hard-to-read words easier to read"/.test(jsx)); assert.ok(/patch\(\{ boost: on \? 'on' : 'off' \}\)/.test(jsx));
    assert.ok(/boost: \{ type: \['string', 'null'\]/.test(readFileSync(join(KIT, 'mcp.mjs'), 'utf8')));
  });
  t('npm run reel --no-boost clears the moments an earlier build marked', () => {
    const src = readFileSync(join(KIT, 'reel.cjs'), 'utf8'), i = src.indexOf("if (flag('no-boost')) { const capF"), j = src.indexOf("sh(process.execPath, [path.join(KIT, 'render.mjs'), LEN.toFixed(2)], build);");
    assert.ok(i > 0 && i < j, 'the marked moments are cleared before the words are drawn'); assert.ok(/delete caps\.boost/.test(src.slice(i, j)));
  });
  if (chrome && hasFf) t('a title\'s small words follow captionOutline: no dark stroke with "none", a stroke with "thick", a finer one with "thin"', () => {
    const flips = [{ start: 1, end: 2.4, text: 'if we made $30K', mode: 7, hero: '$30K' }];
    const dark = outline => { const d = mkdtempSync(join(TMP, 'draw-'));
      writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'one-word', captionColor: '#ffffff', captionOutline: outline, captionShadow: 'none', fonts: 'instrument', titleLayer: 'front', titleLockup: 'full', lockup: { partnerUpper: true, heroUpper: false }, flips }) + ';\n');
      execFileSync('node', [join(KIT, 'render.mjs'), '3', '1.9'], { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] });
      const lk = JSON.parse(readFileSync(join(d, 'lockups.json'), 'utf8'))[0]; assert.ok(lk.partners.length === 1 && lk.partners[0].txt === 'IF WE MADE', 'the partner line is drawn');
      const still = execFileSync('ffmpeg', ['-v', 'error', '-i', join(d, 'stills', 't1.90.png'), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 << 20 });
      let k = 0; for (let i = 0; i < still.length; i += 4) if (still[i + 3] > 90 && Math.max(still[i], still[i + 1], still[i + 2]) < 70) k++; return k; };
    const none = dark('none'), thin = dark('thin'), thick = dark('thick');
    // what is left with none is the soft drop shadow every title has (under 2000 dark pixels); a stroke is ten times that
    assert.ok(none < 2000, `captionOutline none: no dark stroke round the partner words (${none} dark pixels)`);
    assert.ok(thick > none + 10000, `captionOutline thick: the partner words keep their stroke (${thick} dark pixels against ${none})`);
    assert.ok(thin > none + 4000 && thin < thick - 4000, `captionOutline thin: a finer stroke (${thin}, between ${none} and ${thick})`);
  }); else console.log('skip the drawn title partner (needs Chrome and ffmpeg)');
} finally { rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${n} title outline and legibility choice tests passed`);
