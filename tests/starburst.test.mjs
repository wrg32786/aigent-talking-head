// Starburst sticker (1.28.0), no Chrome, no ffmpeg:
// - kit/teardown.py _bursts reads a spiky star as shape starburst with its point count, a round disc as seal
// - kit/teardown/graphics.cjs carries shape and spikes; the recipe writes `shape starburst | spikes N`
// - Reel.md takes the keys, checks them, and gives them to captions.js flips (mode 9); an export writes them back
// - kit/overlay.html has the starburst drawing path, and its face check counts only the word of a burst behind the head
// Run: node tests/starburst.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), KIT = join(ROOT, 'kit');
const { mapGraphics } = require('../kit/teardown/graphics.cjs'), RM = require('../kit/reelmd.cjs'), SP = require('../kit/spoken.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

// a drawn star or disc with a head and shoulders over it, the way a person covers a burst behind them
const PY = `
import sys, json, math
sys.path.insert(0, sys.argv[1])
import cv2, numpy as np
import teardown as T
def pic(n, person=True):
    img = np.full((960, 540, 3), (90, 110, 120), np.uint8); cx, cy, R = 270, 330, 190
    if n:
        pts = [[cx + (R if i % 2 == 0 else R * 0.62) * math.cos(i * math.pi / n - math.pi / 2 + 0.1), cy + (R if i % 2 == 0 else R * 0.62) * math.sin(i * math.pi / n - math.pi / 2 + 0.1)] for i in range(2 * n)]
        cv2.fillPoly(img, [np.array(pts, np.int32)], (74, 224, 245))
    else:
        cv2.circle(img, (cx, cy), R, (74, 224, 245), -1)
    if person:
        cv2.ellipse(img, (cx, cy + 30), (75, 100), 0, 0, 360, (60, 80, 150), -1)
        cv2.rectangle(img, (cx - 150, cy + 110), (cx + 150, 960), (200, 200, 200), -1)
    return img
out = {}
for k, n, person in [("star8", 8, True), ("star12", 12, True), ("star12whole", 12, False), ("star18", 18, True), ("disc", 0, True), ("discwhole", 0, False)]:
    img = pic(n, person); b = T._bursts(img, cv2.cvtColor(img, cv2.COLOR_BGR2HSV), None)
    out[k] = b and {"shape": b["shape"], "spikes": b["spikes"], "layer": b["layer"], "color": b["color"]}
print(json.dumps(out))
`;
const py = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const has = spawnSync(py, ['-c', 'import cv2, numpy'], { encoding: 'utf8' });
if (has.status !== 0) console.log('skip _bursts shape and spikes: OpenCV is not installed for ' + py + ' (npm run effects:setup, or set PYTHON)');
else t('a spiky star reads as a starburst with its point count, a round disc as a seal', () => {
  const r = spawnSync(py, ['-c', PY, KIT], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const [k, want] of [['star8', 8], ['star12', 12], ['star12whole', 12], ['star18', 18]]) {
    assert.strictEqual(o[k].shape, 'starburst', k);
    assert.ok(Math.abs(o[k].spikes - want) <= 2, `${k}: ${o[k].spikes} spikes, drawn with ${want}`);
  }
  assert.deepStrictEqual([o.disc.shape, o.disc.spikes], ['seal', null]);
  assert.strictEqual(o.discwhole, null, 'a whole round disc is not a burst (a lamp, a round sticker)');
  assert.strictEqual(o.star12.layer, null, 'no mask and no face found: the layer is not guessed');
  assert.ok(/^#[0-9a-f]{6}$/.test(o.star12.color));
});

const burst = { type: 'ordinal-sticker', start: 2.5, end: 3.25, text: 'FIRST', cue: 'FIRST', bbox: [0.14, 0.21, 0.7, 0.21], width: 0.71, color: '#f2e8a0', layer: 'behind', samples: 3 };
t('the teardown mapping carries shape and spikes, and a seal carries neither', () => {
  const g = mapGraphics({}, { graphics: [{ ...burst, shape: 'starburst', spikes: 10 }, { ...burst, start: 9, end: 10, text: 'SECOND', shape: 'seal', spikes: null }, { ...burst, start: 19, end: 20, text: 'THIRD', shape: 'starburst', spikes: 40 }, { ...burst, start: 29, end: 30, text: 'FOURTH' }] });
  assert.deepStrictEqual(g.map(x => [x.shape, x.spikes]), [['starburst', 10], [undefined, undefined], ['starburst', 24], [undefined, undefined]]);
  assert.deepStrictEqual([g[0].layer, g[0].color, g[0].text], ['behind', '#f2e8a0', 'FIRST']);
});

t('the recipe writes shape starburst and spikes for a starburst only', () => {
  const src = readFileSync(join(KIT, 'teardown', 'recipe.cjs'), 'utf8');
  assert.ok(/g\.type === 'ordinal-sticker' && g\.shape === 'starburst'\) f\.push\('shape starburst', `spikes \$\{g\.spikes \|\| 12\}`\)/.test(src));
});

const HEAD = '---\nvideomd: 1\nname: sb\ndescription: "a test"\nsource:\n  file: a.mp4\n  duration: 30\nshots: 1\nlang: en\nx-reel: 1\n---\n\n# sb\n\n';
const recipe = lines => RM.parse(HEAD + '## Graphics\n\n```reel-graphics\n' + lines.join('\n') + '\n```\n', '/tmp/sb.Reel.md');
t('Reel.md round trip: shape starburst | spikes 12 reaches the flips and comes back out', () => {
  const r = recipe(['#01 2.5-3.5 | type ordinal-sticker | text FIRST | layer behind | shape starburst | spikes 12 | color #f2e8a0 | size 386']);
  const v = RM.validate(r);
  assert.deepStrictEqual((v.errs || v.errors || []).filter(e => /graphics/.test(e)), []);
  const [f] = RM.graphicFlips(r);
  assert.deepStrictEqual([f.mode, f.shape, f.spikes, f.layer, f.color, f.size], [9, 'starburst', 12, 'behind', '#f2e8a0', 386]);
  const md = RM.exportJob({ segs: [{ file: 'a.mp4', in: 0, out: 30 }] }, { flips: [f] }, { name: 'sb' });
  assert.ok(/type ordinal-sticker \| text FIRST \| shape starburst \| spikes 12 \|/.test(md), md.split('\n').find(l => /ordinal/.test(l)));
  const [f2] = RM.graphicFlips(RM.parse(md, '/tmp/sb2.Reel.md'));
  assert.deepStrictEqual([f2.shape, f2.spikes], ['starburst', 12]);
  // your own ordinal takes the recipe sticker's shape with it
  const fit = SP.fitGraphics([f], [{ start: 5, end: 5.3, word: 'second,' }], 20).gfx;
  assert.deepStrictEqual([fit[0].text, fit[0].shape, fit[0].spikes], ['SECOND', 'starburst', 12]);
});

t('Reel.md checks the keys: a wrong shape or spike count is an error, a highlight keeps its own shapes', () => {
  const errs = lines => { const v = RM.validate(recipe(lines)); return (v.errs || v.errors || []).filter(e => /graphics/.test(e)); };
  assert.ok(errs(['#01 1-2 | type ordinal-sticker | text FIRST | shape circle']).some(e => /shape must be seal or starburst/.test(e)));
  assert.ok(errs(['#01 1-2 | type ordinal-sticker | text FIRST | shape starburst | spikes 99']).some(e => /spikes must be a number from 6 to 24/.test(e)));
  assert.deepStrictEqual(errs(['#01 1-2 | type ordinal-sticker | text FIRST | shape seal', '#02 3-4 | type highlight | shape circle']), []);
  assert.ok(errs(['#01 1-2 | type highlight | shape starburst']).some(e => /shape must be circle/.test(e)));
});

t('the catalog lists the keys and the overlay draws the starburst', () => {
  const cat = JSON.parse(readFileSync(join(KIT, 'graphics.json'), 'utf8')).graphics.find(g => g.id === 'ordinal-sticker');
  assert.ok(cat.fields.shape && cat.fields.spikes);
  const html = readFileSync(join(KIT, 'overlay.html'), 'utf8');
  for (const s of ['function starPath(R,n)', 'function starBurst(c,t)', 'function starWord(c,t)', "o.shape==='starburst'", 'if(isStar(c[4]))return starBurst(c,t)', 'if(isStar(c[4]))return starWord(c,t)']) assert.ok(html.includes(s), 'overlay.html: ' + s);
  // a burst behind the head is left out of the face check, its word is not; a burst in front is counted whole
  assert.ok(html.includes("c[4].layer==='behind'&&CAP.personMask!==false") && html.includes('!(WORDONLY&&STARBEH(c))'));
  for (const f of ['kit/overlay.html', 'kit/teardown.py', 'kit/teardown/graphics.cjs', 'tests/starburst.test.mjs', 'docs/teardown.md', 'docs/reel-md.md']) assert.ok(!readFileSync(join(ROOT, f), 'utf8').includes(String.fromCharCode(8212)), f + ' has an em dash');
});
console.log(`starburst sticker: ${n} tests passed`);
