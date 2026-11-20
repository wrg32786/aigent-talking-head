// Session report 2, H: in the caption face a capital I is a plain bar, the same as a lowercase l, so "AIgent" read as
// "Algent". overlay.html gives an I inside a word two short serifs; a word that starts with I, all-caps words of 4+
// letters and serif faces stay as they are. Renders one still of each spelling and checks they differ, then the rule.
// Needs Chrome. Run: node tests/caption-glyphs.e2e.mjs   (npm run smoke runs it)
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import assert from 'assert';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit'), d = mkdtempSync(join(tmpdir(), 'glyph-'));
try {
  const still = w => { const b = join(d, w); mkdirSync(b);
    writeFileSync(join(b, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'oneword', fonts: 'theme', flips: [{ start: 0, end: 2, mode: 0, text: `join the ${w} Academy`, y: 1300, style: 'phrase' }] }) + ';\n');
    execFileSync(process.execPath, [join(KIT, 'render.mjs'), '2', '1.5'], { cwd: b, env: { ...process.env, THEME: 'aigent', FONTS: 'theme' }, stdio: 'pipe' });
    return readFileSync(join(b, 'stills', 't1.50.png')); };
  assert.ok(!still('AIgent').equals(still('Algent')), '"AIgent" and "Algent" render the same');
  const b = await chromium.launch({ executablePath: findChrome() }), p = await b.newPage();
  await p.goto(pathToFileURL(join(d, 'AIgent', 'overlay.html')).href); await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  const n = (w, f = '400 76px "Hanken Grotesk", sans-serif') => p.evaluate(([w, f]) => window.__serifI(w, f), [w, f]);
  // [drawn letter by letter, drawn as one string]
  for (const w of ['AIgent', 'OpenAI', 'AI']) assert.deepStrictEqual(await n(w), [1, 1], w + ' gets the serifs');
  for (const w of ['In the', 'I think', 'Ill', 'Algent']) assert.deepStrictEqual(await n(w), [0, 0], w + ' stays as it is');
  assert.deepStrictEqual(await n('AIGENT', '860 76px "Sofia Sans Extra Condensed", sans-serif'), [0, 0], 'display caps stay');
  assert.deepStrictEqual(await n('AIgent', '400 76px "Instrument Serif", serif'), [0, 0], 'a serif face has its own');
  await b.close();
  console.log('ok a capital I inside a word reads as I, not l');
} finally { rmSync(d, { recursive: true, force: true }); }
