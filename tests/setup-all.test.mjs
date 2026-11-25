// Studio report 6: npm run setup:all must not pass args with shell:true (Node 24 DEP0190), and it
// ends with a line to restart Studio if it is already running.
// Run: node tests/setup-all.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const setup = readFileSync(join(ROOT, 'kit', 'setup.mjs'), 'utf8');
const build = readFileSync(join(ROOT, 'kit', 'studio', 'build.mjs'), 'utf8');
const stamp = readFileSync(join(ROOT, 'kit', 'studio', 'web', 'stamp.mjs'), 'utf8');
const connect = readFileSync(join(ROOT, 'kit', 'studio', 'connect.mjs'), 'utf8');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const NO_DASH = s => assert.ok(!/[–—]/.test(String(s)), 'no dash: ' + s);
// DEP0190 is args array plus shell:true. A single command string, or shell:false, is fine.
const noArgsWithShellTrue = (src, label) => {
  assert.ok(!/shell:\s*WIN/.test(src) && !/shell:\s*process\.platform === 'win32'/.test(src),
    label + ' still sets shell from the platform when args are passed');
};

t('setup.mjs does not pass args with shell:true; Windows shims go through cmd /d /c', () => {
  noArgsWithShellTrue(setup, 'setup.mjs');
  assert.ok(/shell:\s*false/.test(setup), 'run() should set shell:false');
  assert.ok(/'\/d',\s*'\/c'/.test(setup), 'Windows path should use cmd /d /c');
});

t('studio:build, the license stamp and connect do not pass args with shell:true', () => {
  noArgsWithShellTrue(build, 'build.mjs');
  noArgsWithShellTrue(stamp, 'stamp.mjs');
  noArgsWithShellTrue(connect, 'connect.mjs');
  assert.ok(/run\('npm ci --no-audit --no-fund'/.test(build) && /run\('npm run build'/.test(build)
    && /execSync\(cmd,/.test(build), 'build.mjs should use one command string');
  assert.ok(/execSync\('npm ls --omit=dev --all --parseable'/.test(stamp), 'stamp.mjs should use one command string');
  assert.ok(/'\/d',\s*'\/c',\s*'claude'/.test(connect), 'connect.mjs should start claude via cmd /d /c on Windows');
});

t('setup:all ends with a plain line to restart Studio if it is already running', () => {
  const line = 'If Studio is already running, restart it so it picks this up.';
  assert.ok(setup.includes(line), 'the restart line is missing');
  NO_DASH(line);
  const checkIdx = setup.indexOf("if (flag('check'))");
  const lineIdx = setup.indexOf(line);
  assert.ok(lineIdx > checkIdx, 'the restart line belongs on a real setup run, after --check');
});

console.log(n + ' setup-all tests ok');
