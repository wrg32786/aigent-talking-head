// Check that effects/catalog.json covers exactly the effects in the vendored fx.py, that every runner patch
// in effects/fx_runner.py still matches upstream, and that CATALOG.md is up to date.  npm run effects:check
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { renderCatalog } from './catalog.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const fx = readFileSync(join(HERE, 'vendor/claude-video-effects/scripts/fx.py'), 'utf8');
const names = [...fx.matchAll(/@effect\('([^']+)'/g)].map(m => m[1]);
const cat = JSON.parse(readFileSync(join(HERE, 'catalog.json'), 'utf8'));
const have = cat.effects.map(e => e.name);
let bad = 0;
const missing = names.filter(n => !have.includes(n)), extra = have.filter(n => !names.includes(n));
if (missing.length) { bad++; console.error('catalog.json is missing:', missing.join(', ')); }
if (extra.length) { bad++; console.error('catalog.json lists effects upstream no longer has:', extra.join(', ')); }
const runner = readFileSync(join(HERE, 'fx_runner.py'), 'utf8');
for (const m of runner.matchAll(/^\s*\("""([\s\S]*?)""",/gm)) if (!fx.includes(m[1])) { bad++; console.error('runner patch no longer matches upstream:', m[1].slice(0, 80)); }
// the vendored fx.py names its author only in the docstring attribution; update.mjs scrubs the sample fallbacks
if (fx.split('\n').slice(2).some(l => /vibha/i.test(l))) { bad++; console.error('sample identity left in the vendored fx.py: add it to SCRUB in effects/update.mjs'); }
// a Windows checkout with core.autocrlf has CRLF here; the content is what has to match
const md = existsSync(join(HERE, 'CATALOG.md')) ? readFileSync(join(HERE, 'CATALOG.md'), 'utf8').replace(/\r\n/g, '\n') : '';
if (md !== renderCatalog(cat)) { bad++; console.error('CATALOG.md is stale: run npm run effects:catalog'); }
if (bad) process.exit(1);
console.log(`effects check ok: ${names.length} effects catalogued, runner patches match, CATALOG.md current`);
