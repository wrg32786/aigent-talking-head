// Start Studio in the background (if it is not already running), wait until it answers, open the page, print the URL.
// For terminal agents: one command that returns, instead of a server that holds the terminal.
//   npm run studio:agent                 -> {"url":"http://127.0.0.1:4757","started":true,"log":"jobs/.studio/server.log"}
//   npm run studio:agent -- --no-open --port 4758
//   npm run studio:agent -- --stop       stops the Studio this command started
import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const STUDIO = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(dirname(STUDIO));
const stateDir = () => resolve(process.env.STUDIO_DIR || join(ROOT, 'jobs', '.studio'));
async function up(url) { try { const r = await fetch(url + '/api/state', { signal: AbortSignal.timeout(1500) }); return r.ok && !!(await r.json()).state; } catch { return false; } }
export function openBrowser(url) {
  if (process.env.CI) return false;
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); return true; } catch { return false; }
}
export async function start({ port = +(process.env.STUDIO_PORT || 4757), open = true } = {}) {
  const url = `http://127.0.0.1:${port}`;
  if (await up(url)) { if (open) openBrowser(url); return { url, started: false, running: true }; }
  mkdirSync(stateDir(), { recursive: true });
  const logPath = join(stateDir(), 'server.log'), fd = openSync(logPath, 'a');
  const py = process.env.PYTHON || [join(ROOT, '.venv', 'bin', 'python'), join(ROOT, '.venv', 'Scripts', 'python.exe')].find(existsSync);
  const p = spawn(process.execPath, [join(STUDIO, 'server.mjs'), '--port', String(port), '--no-open'], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ...(py ? { PYTHON: py } : {}) } });
  p.unref(); closeSync(fd);
  writeFileSync(join(stateDir(), 'server.pid'), String(p.pid));
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 250)); if (await up(url)) { if (open) openBrowser(url); return { url, started: true, running: true, pid: p.pid, log: logPath }; } }
  let tail = ''; try { tail = readFileSync(logPath, 'utf8').trim().split('\n').slice(-6).join('\n'); } catch {}
  throw new Error(`Studio did not start on ${url}. Log (${logPath}):\n${tail}`);
}
export function stop() {
  const f = join(stateDir(), 'server.pid'); if (!existsSync(f)) return { stopped: false };
  const pid = +readFileSync(f, 'utf8'); try { process.kill(pid); } catch {} rmSync(f, { force: true }); return { stopped: true, pid };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    if (argv.includes('--stop')) console.log(JSON.stringify(stop()));
    else console.log(JSON.stringify(await start({ port: opt('port') ? +opt('port') : undefined, open: !argv.includes('--no-open') })));
  } catch (e) { console.error(e.message); process.exit(1); }
}
