// The Studio live text preview (kit/studio/preview.mjs): the files it serves are the ones a render uses, and the sample
// caption and title never land on the sample presenter's face in any combination of caption look, where words sit,
// key-word level and title place. Each combination loads the real kit/overlay.html in Chrome and samples its face
// check (window.__faceInk, the same count render.mjs writes to facecheck.json, 200 px tolerance) every 1/8 s.
// Without Chrome the face check is skipped with a note (GitHub Actions must have it).
// Run: node tests/preview-face.test.mjs   (npm run check runs it)
import assert from 'assert';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findChrome } from '../kit/chrome.mjs';
import * as LIVE from '../kit/studio/preview.mjs';
import * as OF from '../kit/overlay-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

await t('the preview files are the render\'s own, with font files served by Studio', () => {
  const key = LIVE.keyOf({ type: 'kinetic', fonts: 'druk', colors: { theme: 'magazine' } });
  assert.strictEqual(LIVE.file(key, 'overlay.html').body, readFileSync(join(ROOT, 'kit', 'overlay.html'), 'utf8'));
  assert.strictEqual(LIVE.file(key, 'theme.js').body, readFileSync(join(ROOT, 'kit', 'themes', 'magazine.js'), 'utf8'));
  const fonts = LIVE.file(key, 'fonts.js').body;
  assert.ok(!/file:/.test(fonts) && /\/files\/kit\/fonts\//.test(fonts), 'font URLs point at /files/');
  assert.strictEqual(fonts.replace(/\/files\//g, ''), OF.fontsDoc('druk').text.replace(/file:\/\/[^"]*?\/kit\/fonts\//g, 'kit/fonts/'));
  assert.ok(!/file:/.test(LIVE.file(key, 'gfx.js').body));
  const caps = JSON.parse(LIVE.file(key, 'captions.js').body.replace(/^window\.CAPTIONS=/, '').replace(/;\s*$/, ''));
  assert.ok(caps.faceTrack && caps.faceTrack.zones.length, 'the sample carries the presenter\'s face zone');
  assert.strictEqual(LIVE.file(key, 'nope.js'), null);
  assert.deepStrictEqual(LIVE.wordsOf('%%%'), {}, 'a broken key is an empty plan, not an error');
});

await t('the sample follows the words: look, key words, place, colors, titles off for plain captions', () => {
  const d = LIVE.sampleDoc({ type: 'kinetic', entrance: 'cascade', keyWords: { level: 'strong' }, place: { captions: 'lower', titles: ['left'] }, colors: { text: '#112233', accent: 'red' }, titles: { on: null, entrances: ['drop'] } });
  assert.strictEqual(d.captionStyle, 'kinetic'); assert.strictEqual(d.captionEntrance, 'cascade'); assert.strictEqual(d.keyWords, 'strong');
  assert.strictEqual(d.captionY, LIVE.CAPTION_Y.lower); assert.deepStrictEqual(d.theme, { colors: { text: '#112233' } }, 'only real hex colors go in');
  const title = d.flips.find(f => f.mode === 7); assert.strictEqual(title.entrance, 'drop'); assert.strictEqual(title.place, 'left');
  const plain = LIVE.sampleDoc({ type: 'captions', look: 'pill', keyWords: { level: 'strong' } });
  assert.strictEqual(plain.captionStyle, 'pill'); assert.ok(!plain.flips.some(f => f.mode === 7), 'plain captions have no big title'); assert.ok(!plain.keyWords);
});

let chrome = null;
try { chrome = findChrome(); } catch (e) { if (process.env.CHROME_PATH || process.env.GITHUB_ACTIONS) throw e; }
if (!chrome) console.log('skip the face check: Chrome is not on this computer');
else {
  const { chromium } = await import('playwright-core');
  const combos = [];
  for (const look of ['classic', 'pill', 'hormozi', 'karaoke', 'one-word', 'oneword']) for (const cap of [null, 'chest', 'lower']) combos.push({ type: look === 'oneword' ? 'kinetic' : 'captions', look, place: { captions: cap, titles: [] } });
  for (const level of ['off', 'subtle', 'strong', 'dramatic']) for (const cap of [null, 'chest', 'lower']) for (const tp of [null, 'left', 'right', 'above'])
    combos.push({ type: 'kinetic', look: 'kinetic', keyWords: { level }, place: { captions: cap, titles: tp ? [tp] : [] } });
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  try {
    const pg = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await pg.route('https://preview.local/**', r => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith('/files/')) { const f = join(ROOT, decodeURIComponent(u.pathname.slice(7))); return existsSync(f) ? r.fulfill({ body: readFileSync(f) }) : r.fulfill({ status: 404 }); }
      const [, key, name] = u.pathname.split('/'); const f = LIVE.file(key, name);
      return f ? r.fulfill({ contentType: f.type, body: f.body }) : r.fulfill({ status: 404 });
    });
    await t(`no sample word lands on the face in ${combos.length} combinations of look, place, key words and title place`, async () => {
      const bad = [];
      for (const w of combos) {
        await pg.goto(`https://preview.local/${LIVE.keyOf(w)}/overlay.html`);
        await pg.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
        const hits = await pg.evaluate(() => { const out = []; for (let t = 0; t < 6; t += 0.125) { const r = window.__faceInk(+t.toFixed(3)); if (r) for (const h of r.hits) if (h.px >= 200) out.push({ t: +t.toFixed(2), ...h }); } return out; });
        if (hits.length) bad.push(`${JSON.stringify(w)}: ${hits.slice(0, 2).map(h => `${h.kind} "${h.text}" at ${h.t}s, ${h.px} px`).join('; ')}`);
      }
      if (process.env.PREVIEW_FACE_OUT) (await import('fs')).writeFileSync(process.env.PREVIEW_FACE_OUT, JSON.stringify(bad, null, 1));
      assert.deepStrictEqual(bad, []);
    });
    await t('key words: none and off draw the same caption; subtle, strong and dramatic grow the key word in turn', async () => {
      let doc = null;
      await pg.route('https://raw.local/**', r => { const name = new URL(r.request().url()).pathname.slice(1);
        if (name === 'captions.js') return r.fulfill({ contentType: 'text/javascript', body: 'window.CAPTIONS=' + JSON.stringify(doc) + ';' });
        const f = LIVE.file(LIVE.keyOf({}), name); return f ? r.fulfill({ contentType: f.type, body: f.body }) : r.fulfill({ status: 404 }); });
      const size = async kw => { doc = { captionStyle: 'kinetic', flips: [{ start: 0, end: 3, text: 'Build your first agent this weekend', mode: 0, words: [[0, .5, 'Build'], [.5, 1, 'your'], [1, 1.5, 'first'], [1.5, 2, 'agent'], [2, 2.5, 'this'], [2.5, 3, 'weekend']], hero: 'agent' }], ...(kw ? { keyWords: kw } : {}) };
        await pg.goto('https://raw.local/overlay.html'); await pg.waitForFunction(() => window.__ready === true);
        return pg.evaluate(() => { const l = window.__lockups()[0]; return { size: l.heroSize, box: l.box }; }); };
      const none = await size(null), off = await size('off'), sub = await size('subtle'), strong = await size('strong'), dram = await size('dramatic');
      assert.deepStrictEqual(off, none, 'off is the size it always had');
      assert.ok(sub.size < none.size && none.size < strong.size && strong.size <= dram.size, JSON.stringify({ sub, none, strong, dram }));
    });
  } finally { await browser.close(); }
}
console.log(`\npreview face: ${n} tests passed`);
