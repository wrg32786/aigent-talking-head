// Maintainer command: archive a committed release without including local files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--ref' || !args[1] || args[1].startsWith('-'))) {
    throw new Error('Usage: npm run release:zip -- [--ref <ref>]');
  }
  if (git('status', '--porcelain=v1', '--untracked-files=all').trim()) {
    throw new Error('Refusing to release a dirty working tree. Commit or remove pending changes first, including untracked files.');
  }

  // Pin the ref once, then read its version so older releases keep their own name.
  const commit = git('rev-parse', '--verify', '--end-of-options', `${args[1] || 'HEAD'}^{commit}`).trim();
  const { name, version } = JSON.parse(git('show', `${commit}:package.json`));
  if (name !== 'aigent-talking-head' || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('The selected ref must have an aigent-talking-head package.json with a valid version.');
  }

  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const temporary = mkdtempSync(join(dist, '.release-'));
  const filename = `aigent-talking-head-${version}.zip`;
  const archive = join(dist, filename);
  try {
    const pending = join(temporary, filename);
    git('archive', '--format=zip', `--prefix=aigent-talking-head-${version}/`, `--output=${pending}`, commit);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(pending)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    writeFileSync(`${pending}.sha256`, `${sha256}  ${filename}\n`);
    renameSync(pending, archive);
    renameSync(`${pending}.sha256`, `${archive}.sha256`);
    console.log(`ZIP: ${archive}`);
    console.log(`Size: ${(statSync(archive).size / 1_000_000).toFixed(2)} MB`);
    console.log(`SHA256: ${sha256}`);
    console.log(`Checksum: ${archive}.sha256`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`release:zip: ${error.stderr?.toString().trim() || error.message}`);
  process.exitCode = 1;
});
