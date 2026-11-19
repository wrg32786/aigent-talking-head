// Rebuild the Studio page (React + Astryx) from kit/studio/web into kit/studio/public. Only needed after editing
// kit/studio/web; the built page is committed, so installing and running Studio never builds anything.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('./web/', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = args => execFileSync(npm, args, { cwd: web, stdio: 'inherit', shell: process.platform === 'win32' });
run(['ci', '--no-audit', '--no-fund']);
run(['run', 'build']);
console.log('Built kit/studio/public. Commit it with your kit/studio/web changes.');
