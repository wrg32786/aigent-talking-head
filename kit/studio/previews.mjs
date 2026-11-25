// Make missing previews (Settings): runs kit/demos.mjs --missing in the background and reads its progress lines
// ("3/12 finish grain 20 KB") into plain words for the page. Nothing here is shown as a command.
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as D from '../demos.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const NAME = { effect: 'effect', graphic: 'graphic', finish: 'finish', titleLayer: 'title layer' };
let job = null; // { status: running|done|failed, done, total, now, failed: [], skipped }

export function missing() { return D.items().filter(({ kind, it }) => !existsSync(D.demoPath(kind, it.id))); }
export function status() {
  const m = missing();
  return { missing: m.length, effectsNeedAddon: !D.fxReady() && m.some(x => x.kind === 'effect'), job };
}
export function start() {
  if (job && job.status === 'running') return status();
  const m = missing(), todo = D.fxReady() ? m : m.filter(x => x.kind !== 'effect');
  job = { status: 'running', done: 0, total: todo.length, now: null, failed: [], skipped: m.length - todo.length };
  if (!todo.length) { job.status = 'done'; return status(); }
  const p = spawn(process.execPath, [join(ROOT, 'kit', 'demos.mjs'), '--missing'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  p.stdout.on('data', d => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      const r = /^(\d+)\/(\d+) (\w+) (\S+)( failed)?/.exec(l); if (!r) continue;
      job.done = +r[1]; job.total = +r[2]; job.now = `${NAME[r[3]] || r[3]} ${r[4].replace(/-/g, ' ')}`; if (r[5]) job.failed.push(r[4]);
    }
  });
  p.stderr.on('data', () => {});
  p.on('close', code => { job.status = code === 0 || job.failed.length ? 'done' : 'failed'; job.now = null; });
  p.on('error', () => { job.status = 'failed'; });
  return status();
}
