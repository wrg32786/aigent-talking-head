// Release notes: draft the plain-words notes for one version from its CHANGELOG.md section.
//   npm run release:notes                          -> prints the draft for the version in package.json
//   npm run release:notes -- --version 1.3.0       -> another version
//   npm run release:notes -- --write               -> also saves docs/releases/v<version>.md (never overwrites without --force)
//   npm run release:notes -- --images docs/studio/a.png,docs/studio/b.png  -> screenshots, linked from the tag so they show on GitHub
// It only drafts: edit the file into plain words, then whoever cuts the release uses it as the body
// (gh release create v<version> --notes-file docs/releases/v<version>.md). It never makes a tag or a release.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = 'wrg32786/aigent-talking-head';
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

// one version's bullets from CHANGELOG.md: [{ title, text }]
export function section(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(l => new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines.slice(start + 1, end < 0 ? undefined : end);
  return body.filter(l => /^- /.test(l)).map(l => {
    const m = l.match(/^- \*\*(.+?)\*\*\s*(.*)$/);
    return m ? { title: m[1].replace(/\.$/, ''), text: m[2] } : { title: null, text: l.slice(2) };
  });
}

// the first sentence, without code marks or links, for a plain line under each heading
export function plain(text) {
  const t = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : t).trim();
}

export function draft(changelog, version, images = []) {
  const items = section(changelog, version);
  if (!items) return null;
  const out = [`# aigent-talking-head v${version}`, '', 'One paragraph in plain words: what this release lets you do that you could not before.', '', '## What is new', ''];
  for (const it of items) out.push(it.title ? `- **${it.title}.** ${plain(it.text)}` : `- ${plain(it.text)}`);
  if (images.length) {
    out.push('', '## Screenshots', '');
    for (const p of images) out.push(`<img src="https://raw.githubusercontent.com/${REPO}/v${version}/${p}" width="480" alt="${p.split('/').pop().replace(/\.\w+$/, '').replace(/-/g, ' ')}">`);
  }
  out.push('', '## Update', '', 'In your copy of the kit: `git pull`, then `npm run setup:all` (it only installs what is missing). Or tell your agent "Update aigent-talking-head".', '',
    `Full list: [CHANGELOG.md](https://github.com/${REPO}/blob/v${version}/CHANGELOG.md).`, '');
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const version = String(opt('version', pkg.version)).replace(/^v/, '');
  const images = String(opt('images') || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const p of images) if (!existsSync(join(ROOT, p))) { console.error(`not found: ${p}`); process.exit(1); }
  const text = draft(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version, images);
  if (!text) { console.error(`no "## ${version}" section in CHANGELOG.md`); process.exit(1); }
  if (!flag('write')) { process.stdout.write(text); process.exit(0); }
  const file = join(ROOT, 'docs', 'releases', `v${version}.md`);
  if (existsSync(file) && !flag('force')) { console.error(`docs/releases/v${version}.md already exists (edit it, or --force to draft it again)`); process.exit(1); }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote docs/releases/v${version}.md`);
}
