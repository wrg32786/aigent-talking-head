// App labels and "check" (1.28.0, Will's pick on report 4 item 13): only a label the teardown was not sure it read right
// is left out when the caption says the same word. The doubt comes from the OCR confidence or letters that do not read
// as a word; it rides in the Reel.md graphics line as "check <why>" and into captions.js as "check".
// Run: node tests/label-check.test.cjs   (part of npm run check)
const assert = require('assert');
const { mapGraphics } = require('../kit/teardown/graphics.cjs'), { textDoubt } = require('../kit/teardown/titles.cjs'), RM = require('../kit/reelmd.cjs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
t('the teardown carries an app label\'s OCR confidence, and a low one is a doubt', () => {
  const g = mapGraphics({}, { graphics: [{ type: 'app-label', start: 1, end: 2, text: 'DESIGNER', conf: 0.6, bbox: [0.1, 0.4, 0.2, 0.05] }, { type: 'app-label', start: 3, end: 4, text: 'Figma', conf: 0.97, bbox: [0.1, 0.4, 0.2, 0.05] }] });
  assert.deepStrictEqual(g.map(x => x.conf), [0.6, 0.97]);
  assert.ok(/low confidence/.test(textDoubt(g[0], [])), 'a label read at 60% is in doubt');
  assert.strictEqual(textDoubt(g[1], []), null, 'a cleanly read Figma is not, even with no speech near it');
});
t('"check" in a Reel.md graphics line reaches the flip; a plain label has none', () => {
  const r = { file: '/tmp/Reel.md', graphics: ['#01 1-2 | type app-label | check read with low confidence (60%) | text DESIGNER', '#02 3-4 | type app-label | text Figma'].map(l => RM.parseLine(l, 'graphics')) };
  const f = RM.graphicFlips(r);
  assert.strictEqual(f[0].mode, 10); assert.strictEqual(f[0].check, 'read with low confidence (60%)'); assert.strictEqual(f[1].check, undefined);
});
console.log(`LABEL CHECK PASS (${n} tests)`);
