// Brands: a logo when a word is said. When a listed word is spoken, a plate with that brand's mark lands on it for
// about a second (captions.js mode 5 with its own "logo"; kit/overlay.html draws it on a white plate so the mark keeps
// its colours).
//   [{ "word": "Skool", "logo": "kit/example/skool-logo.svg" },
//    { "word": "ChatGPT", "logo": "brands/chatgpt.png", "heard": ["chat GPT"], "seconds": 1.2 }]
// Only marks you have the right to use: the kit's own (kit/example/skool-logo.svg) or files you add (Studio: Words and
// brands, saved in jobs/.studio/brands/). Nothing is downloaded. Sources: the pack or preset "brands", Studio's list
// (jobs/<job>/brands.json) and --brands <file.json> on npm run reel.
// One plate per brand at most every 4 s, 8 in a reel at most, never over a kinetic title or another plate.
const fs = require('fs');
const path = require('path');
const { tok } = require('./glossary.cjs');

const IMG = /\.(svg|png|webp|jpe?g)$/i;
function parse(x, base = process.cwd()) {
  if (!x) return [];
  const list = Array.isArray(x) ? x : typeof x === 'object' ? Object.entries(x).map(([word, logo]) => ({ word, logo })) : [];
  return list.filter(b => b && b.word && b.logo).map(b => ({ word: String(b.word), logo: path.resolve(base, String(b.logo)), heard: [].concat(b.heard || []).map(String), ...(b.seconds ? { seconds: +b.seconds } : {}) }));
}
function validate(x, base) {
  const errs = [];
  if (x == null) return errs;
  if (!Array.isArray(x)) return ['brands: a list of { word, logo }'];
  x.forEach((b, i) => {
    if (!b || typeof b.word !== 'string' || !b.word.trim()) errs.push(`brands[${i}]: needs "word"`);
    if (!b || typeof b.logo !== 'string' || !IMG.test(b.logo)) errs.push(`brands[${i}]: "logo" must be an .svg, .png, .webp or .jpg file`);
    else if (base && !fs.existsSync(path.resolve(base, b.logo))) errs.push(`brands[${i}]: logo ${b.logo} is missing`);
    if (b && b.seconds != null && !(+b.seconds >= 0.4 && +b.seconds <= 4)) errs.push(`brands[${i}]: seconds 0.4 to 4`);
  });
  return errs;
}
function read(file) { const f = path.resolve(String(file)); return parse(JSON.parse(fs.readFileSync(f, 'utf8')), path.dirname(f)); }
// said: [{ start, end, word }] on the reel clock (kit/spoken.cjs timeline); busy: [[start, end]] taken by titles and
// other plates. Returns flips to add and the logo files to copy: { flips, files: { name in build: source path } }
function plan(said, brands, { busy = [], gap = 4, max = 8, total = Infinity } = {}) {
  const flips = [], files = {}, last = {};
  const pats = brands.flatMap((b, bi) => [b.word, ...b.heard].map(h => ({ b, bi, t: tok(h) }))).filter(p => p.t.length).sort((a, b) => b.t.length - a.t.length);
  const st = said.map(w => tok(w.word));
  const taken = busy.slice();
  for (let i = 0; i < said.length && flips.length < max; i++) {
    for (const p of pats) {
      let k = i, ti = 0, ok = true;
      while (ti < p.t.length) { if (k >= said.length || !st[k].length) { ok = false; break; } for (const x of st[k]) { if (ti >= p.t.length || x !== p.t[ti]) { ok = false; break; } ti++; } if (!ok) break; k++; }
      if (!ok || ti !== p.t.length) continue;
      const t0 = said[i].start, t1 = Math.min(total, t0 + (p.b.seconds || 1.0));
      if (last[p.bi] != null && t0 - last[p.bi] < gap) break;
      if (taken.some(([a, b]) => t0 < b && a < t1)) break;
      const name = `brand-${p.bi + 1}-${path.basename(p.b.logo).replace(/[^A-Za-z0-9._-]+/g, '-')}`;
      files[name] = p.b.logo;
      flips.push({ start: +t0.toFixed(2), end: +t1.toFixed(2), text: '', mode: 5, logo: name, brand: p.b.word });
      taken.push([t0, t1]); last[p.bi] = t0; i = k - 1; break;
    }
  }
  return { flips, files };
}
function selfTest() {
  const errs = [], said = [{ start: 0.5, end: 0.8, word: 'Join' }, { start: 0.8, end: 1.2, word: 'Skool.' }, { start: 2, end: 2.3, word: 'skool' }, { start: 6, end: 6.4, word: 'chat' }, { start: 6.4, end: 6.8, word: 'GPT' }, { start: 9, end: 9.3, word: 'Skool' }];
  const b = [{ word: 'Skool', logo: '/x/skool.svg', heard: [] }, { word: 'ChatGPT', logo: '/x/gpt.png', heard: ['chat GPT'] }];
  const r = plan(said, b, { busy: [[8.8, 9.6]] });
  const got = r.flips.map(f => `${f.brand}@${f.start}`).join(',');
  if (got !== 'Skool@0.8,ChatGPT@6') errs.push('brands plan: ' + got);
  if (Object.keys(r.files).length !== 2) errs.push('brands files: ' + JSON.stringify(r.files));
  return errs;
}
module.exports = { parse, validate, read, plan, selfTest, IMG };
