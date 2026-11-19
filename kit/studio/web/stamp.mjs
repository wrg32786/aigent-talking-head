// After vite build: record the source hash (npm run check compares it) and write the license notices for
// every package bundled into ../public.
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { webHash } from '../web-hash.mjs';
const pub = new URL('../public/', import.meta.url);
const MIT = who => `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;
// packages that publish no LICENSE file in their npm tarball (text from their repos)
const FALLBACK = { '@astryxdesign/core': MIT('2026 Meta Platforms, Inc.'), '@stylexjs/stylex': MIT('Meta Platforms, Inc. and affiliates.') };
const dirs = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim().split(/\r?\n/).slice(1);
const seen = new Set(), parts = ['Third-party code bundled into the Studio page (kit/studio/public/assets). Built from kit/studio/web.\n'];
for (const d of dirs.sort()) {
  const p = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')), id = `${p.name}@${p.version}`;
  if (seen.has(id)) continue; seen.add(id);
  const lf = existsSync(d) && readdirSync(d).find(f => /^licen[cs]e/i.test(f));
  const text = lf ? readFileSync(join(d, lf), 'utf8') : FALLBACK[p.name];
  if (!text) throw new Error(`no license text for ${id}`);
  if (!/^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0)$/.test(p.license || '')) throw new Error(`${id} has license ${p.license}; only MIT, ISC, BSD or Apache-2.0 may ship`);
  parts.push(`\n==== ${id} (${p.license}) ====\n\n${text.trim()}\n`);
}
writeFileSync(new URL('THIRD_PARTY_LICENSES.txt', pub), parts.join(''));
writeFileSync(new URL('build.json', pub), JSON.stringify({ source: webHash(), note: 'Built from kit/studio/web by npm run studio:build. Do not edit kit/studio/public by hand.' }, null, 2) + '\n');
console.log('stamped', webHash(), `(${seen.size} bundled packages, licenses in public/THIRD_PARTY_LICENSES.txt)`);
