// Hash of the Studio page source (kit/studio/web), so npm run check can tell when the committed build in public/ is stale.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const WEB = fileURLToPath(new URL('./web/', import.meta.url));
const walk = d => readdirSync(d).sort().flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
export function webHash() {
  const h = createHash('sha256');
  const files = [...walk(join(WEB, 'src')), ...walk(join(WEB, 'static')), ...['index.html', 'vite.config.mjs', 'package.json', 'package-lock.json'].map(f => join(WEB, f))];
  for (const f of files) h.update(relative(WEB, f).split('\\').join('/') + '\0').update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n') + '\0');
  return h.digest('hex').slice(0, 16);
}
