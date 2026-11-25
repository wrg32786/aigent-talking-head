// Rebuild the Studio page (React + Astryx) from kit/studio/web into kit/studio/public. Only needed after editing
// kit/studio/web; the built page is committed, so installing and running Studio never builds anything.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('./web/', import.meta.url));
// one command string (no args array) so Windows npm.cmd starts without DEP0190
const run = cmd => execSync(cmd, { cwd: web, stdio: 'inherit' });
run('npm ci --no-audit --no-fund');
run('npm run build');
console.log('Built kit/studio/public. Commit it with your kit/studio/web changes.');
