// Refresh the vendored copy of claude-video-effects (MIT, by Vibha Ramprakash).
//   npm run effects:update                      -> latest commit on the upstream default branch
//   npm run effects:update -- --ref <sha|tag>   -> a specific commit
//   npm run effects:update -- --from <dir>      -> copy from an existing local clone instead of cloning
// Copies only the files the pipeline needs, keeps upstream LICENSE, model NOTICE and font licences intact,
// records the commit in UPSTREAM.json, then runs effects/check.mjs (catalog + runner patches still match).
// Not copied: README.md (promo links), assets/ (promo image), scripts/setup.sh (npm run effects:setup replaces it).
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = 'https://github.com/Vibha-Ramprakash/claude-video-effects.git';
const DEST = join(HERE, 'vendor', 'claude-video-effects');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

let src = opt('from'), tmp;
if (!src) {
  tmp = mkdtempSync(join(tmpdir(), 'cve-'));
  src = join(tmp, 'repo');
  const ref = opt('ref');
  if (ref) { git(['init', '-q', src]); git(['remote', 'add', 'origin', REPO], src); git(['fetch', '-q', '--depth', '1', 'origin', ref], src); git(['checkout', '-q', 'FETCH_HEAD'], src); }
  else git(['clone', '-q', '--depth', '1', REPO, src]);
}
const commit = git(['rev-parse', 'HEAD'], src), date = git(['log', '-1', '--format=%cI'], src);
const KEEP = ['LICENSE', 'SKILL.md', 'requirements.txt', 'scripts/fx.py', 'scripts/words.py', 'models/NOTICE.md', 'models/yunet.onnx', 'models/selfie_segmenter.tflite'];
const fonts = readdirSync(join(src, 'fonts')).map(f => 'fonts/' + f);
const files = [...KEEP, ...fonts];
for (const f of files) if (!existsSync(join(src, f))) { console.error('upstream is missing ' + f + '; update effects/update.mjs'); process.exit(1); }
rmSync(DEST, { recursive: true, force: true });
for (const f of files) { mkdirSync(dirname(join(DEST, f)), { recursive: true }); copyFileSync(join(src, f), join(DEST, f)); }
const bytes = files.reduce((a, f) => a + statSync(join(DEST, f)).size, 0);
writeFileSync(join(DEST, 'UPSTREAM.json'), JSON.stringify({
  repo: 'https://github.com/Vibha-Ramprakash/claude-video-effects', commit, committed_at: date, fetched_at: new Date().toISOString(),
  license: 'MIT (code), SIL OFL 1.1 / Apache-2.0 (fonts, see fonts/), MIT (YuNet) and Apache-2.0 (MediaPipe selfie segmenter), see models/NOTICE.md',
  files, excluded: ['README.md (promo links)', 'assets/ (promo image)', 'scripts/setup.sh (replaced by npm run effects:setup)'], bytes
}, null, 1) + '\n');
console.log(`vendored ${files.length} files (${(bytes / 1e6).toFixed(1)} MB) at ${commit.slice(0, 12)} (${date})`);
// flag anything promotional that slipped into the copied text, so we don't surface it to users
for (const f of files.filter(f => /\.(md|py|txt)$/.test(f) && !f.startsWith('fonts/'))) {
  readFileSync(join(DEST, f), 'utf8').split('\n').forEach((l, i) => { if (/https?:\/\/(?!github\.com\/opencv|ai\.google\.dev|openfontlicense)|hop studio|vibha\.is/i.test(l)) console.warn(`  note ${f}:${i + 1}: ${l.trim().slice(0, 110)}`); });
}
if (tmp) rmSync(tmp, { recursive: true, force: true });
try { execFileSync(process.execPath, [join(HERE, 'check.mjs')], { stdio: 'inherit' }); }
catch { console.error('\nThe update landed, but effects/check.mjs failed. Fix effects/catalog.json or effects/fx_runner.py before using it.'); process.exit(1); }
