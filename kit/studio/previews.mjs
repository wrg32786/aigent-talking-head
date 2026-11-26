// Make missing previews (Settings): runs kit/demos.mjs --missing in the background and reads its progress lines
// ("making 3/12 finish grain", then "3/12 finish grain 20 KB" or "... failed: why") for the page. The page names the
// options itself (showName), and nothing here is shown as a command.
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as D from '../demos.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
let job = null, child = null; // job: { status: running|done|failed, done, total, now: {kind,id}|null, failed: [{kind,id}], why }
// a run left going by Studio stopping is ended with it (a run started some other way is only read through the lock)
process.on('exit', () => { if (child) try { child.kill(); } catch {} });

export function missing() { return D.items().filter(({ kind, it }) => !existsSync(D.demoPath(kind, it.id))); }
export function status() {
  const m = missing(), fx = D.fxReady(), canMake = fx ? m.length : m.filter(x => x.kind !== 'effect').length;
  const elsewhere = !(job && job.status === 'running') && D.lockHolder() ? true : false;
  return { missing: m.length, canMake, effectsNeedAddon: !fx && m.some(x => x.kind === 'effect'), busyElsewhere: elsewhere, job };
}
export function start(onDone = () => {}) {
  const st = status();
  if ((job && job.status === 'running') || st.busyElsewhere || !st.canMake) return st;
  job = { status: 'running', done: 0, total: st.canMake, now: null, failed: [], why: null };
  const p = child = spawn(process.execPath, [join(ROOT, 'kit', 'demos.mjs'), '--missing'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '', err = '', finished = false;
  p.stdout.on('data', d => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      let r;
      if ((r = /^making (\d+)\/(\d+) (\w+) (\S+)/.exec(l))) { job.done = +r[1] - 1; job.total = +r[2]; job.now = { kind: r[3], id: r[4] }; }
      else if ((r = /^(\d+)\/(\d+) (\w+) (\S+)( failed)?/.exec(l))) { job.done = +r[1]; if (r[5]) job.failed.push({ kind: r[3], id: r[4] }); }
      else if (/^Done/.test(l)) finished = true;
    }
  });
  p.stderr.on('data', d => { err = (err + d).slice(-2000); });
  const end = code => {
    if (job.status !== 'running') return;
    child = null; job.now = null;
    job.status = code === 0 || finished ? 'done' : 'failed';
    if (job.status === 'failed') { job.why = /ffmpeg/i.test(err) ? 'ffmpeg' : /chrome/i.test(err) ? 'chrome' : null; if (err.trim()) console.error('Make missing previews stopped:\n' + err.trim().split('\n').slice(-6).join('\n')); }
    try { onDone(); } catch {}
  };
  p.on('close', end); p.on('error', e => { err += e.message; end(1); });
  return status();
}
