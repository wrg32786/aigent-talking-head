// The always-on Studio agent: Studio runs its own background agent so the chat stays connected even when nobody's
// terminal agent is listening. Off until the person turns it on (Wake agent in the chat, or POST /api/agent/wake).
//   - Claude Code, headless: claude -p "<run the Studio chat loop>" with only this kit's MCP server loaded
//     (--mcp-config + --strict-mcp-config) and only its tools allowed (--allowedTools mcp__aigent-talking-head,
//     --permission-mode dontAsk refuses everything else: no shell, no file edits).
//   - Supervised: when it exits (a -p run ends after its turns) it is started again, with a growing wait when it keeps
//     failing fast; when it stops answering (no presence for STALE_MS) it is restarted.
//   - STUDIO_AGENT_CMD=<script.mjs> runs that script with node instead (tests use a fake agent).
// The choice is remembered in <state>/worker.json, so Studio brings the agent back after a restart.
import { spawn, spawnSync } from 'child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as C from './core.mjs';
import * as CH from './channel.mjs';
import * as AGT from './agents.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const STALE_MS = 90e3;
const conf = () => join(C.stateDir(), 'worker.json');
const logPath = () => join(C.stateDir(), 'agent.log');
const st = { enabled: false, child: null, url: null, starts: 0, quick: 0, startedAt: 0, lastExit: null, error: null, phase: 'off', timer: null, watch: null };

function remember() { try { mkdirSync(C.stateDir(), { recursive: true }); writeFileSync(conf(), JSON.stringify({ enabled: st.enabled })); } catch {} }
function remembered() { try { return !!JSON.parse(readFileSync(conf(), 'utf8')).enabled; } catch { return false; } }

let claudeOk = null;
// is there an agent to run? (cached: the check runs a process)
export function available() {
  if (process.env.STUDIO_AGENT_CMD) return true;
  if (claudeOk === null) { try { claudeOk = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32' }).status === 0; } catch { claudeOk = false; } }
  return claudeOk;
}

export function prompt(url) {
  return `You are the always-on Studio agent for AIgent Talking Head${url ? ` (Studio is at ${url})` : ''}. Run the Studio chat loop and keep it running: `
    + 'call studio_wait_for_message again and again (timeout_s 30); when it returns messages, act on them with the Studio tools '
    + '(studio_set_selections, studio_run, studio_add_reference_url, write_script and the rest) and answer each one with studio_reply in plain, short sentences. '
    + 'Follow the rules in skills/aigent-studio/SKILL.md: only menu names, never render, post or share anything the person did not ask for. '
    + 'Never stop listening on your own; when nothing comes, call studio_wait_for_message again.';
}

function command(url) {
  if (process.env.STUDIO_AGENT_CMD) return { cmd: process.execPath, args: [resolve(ROOT, process.env.STUDIO_AGENT_CMD), url || ''] };
  const py = AGT.python(), mcp = join(C.stateDir(), 'worker-mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { [AGT.NAME]: { command: AGT.NODE, args: [AGT.MCP], ...(py ? { env: { PYTHON: py } } : {}) } } }, null, 2));
  return { cmd: 'claude', args: ['-p', prompt(url), '--mcp-config', mcp, '--strict-mcp-config', '--allowedTools', `mcp__${AGT.NAME}`, '--permission-mode', 'dontAsk', '--output-format', 'text'] };
}

function launch() {
  if (!st.enabled || st.child) return;
  if (!available()) { st.error = 'Claude Code (the claude command) is not installed here. Use Connect agent instead.'; st.enabled = false; st.phase = 'off'; remember(); return; }
  mkdirSync(C.stateDir(), { recursive: true });
  const { cmd, args } = command(st.url), fd = openSync(logPath(), 'a');
  let p;
  try { p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env }, shell: process.platform === 'win32' }); }
  catch (e) { closeSync(fd); st.error = e.message; schedule(); return; }
  closeSync(fd);
  st.child = p; st.starts++; st.startedAt = Date.now(); st.phase = 'starting'; st.error = null;
  p.on('error', e => { st.error = e.message; });
  p.on('exit', code => {
    st.child = null; st.lastExit = code;
    if (!st.enabled) { st.phase = 'off'; return; }
    st.quick = Date.now() - st.startedAt < 20e3 ? st.quick + 1 : 0; // keeps failing fast: wait longer each time
    schedule();
  });
}
function schedule() {
  clearTimeout(st.timer); st.phase = 'restarting';
  const wait = Math.min(60e3, 1500 * 2 ** Math.min(5, st.quick));
  st.timer = setTimeout(launch, wait); st.timer.unref && st.timer.unref();
}
// a running agent that stopped touching Studio (stuck, or lost its tools) is restarted
function watchdog() {
  if (!st.enabled || !st.child) return;
  const a = CH.presence();
  if (a.listening || a.connected) { st.phase = 'running'; return; }
  const since = Date.now() - Math.max(st.startedAt, a.lastSeen || 0);
  if (since > STALE_MS) { st.error = 'it stopped answering, restarting it'; try { st.child.kill('SIGTERM'); } catch {} }
}

export function start({ url } = {}) {
  if (url) st.url = url;
  st.enabled = true; remember();
  if (!st.watch) { st.watch = setInterval(watchdog, 5e3); st.watch.unref && st.watch.unref(); }
  if (!st.child) { clearTimeout(st.timer); st.quick = 0; launch(); }
  return status();
}
export function stop() {
  st.enabled = false; remember(); clearTimeout(st.timer);
  if (st.child) { try { st.child.kill('SIGTERM'); } catch {} }
  st.phase = 'off'; return status();
}
// bring the agent back after Studio restarts, if the person had it on
export function resume({ url } = {}) { if (remembered()) start({ url }); }
export function status() {
  return { enabled: st.enabled, phase: st.enabled ? st.phase : 'off', starts: st.starts, available: available(), error: st.error, lastExit: st.lastExit, log: 'jobs/.studio/agent.log' };
}
// Studio is closing: the agent goes with it (it comes back on the next start if it was on)
export function shutdown() { clearTimeout(st.timer); clearInterval(st.watch); if (st.child) { try { st.child.kill('SIGTERM'); } catch {} } }
