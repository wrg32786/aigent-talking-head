// Connect a terminal agent to Studio: register the kit's MCP server in the agent's own config and, for Claude Code,
// install the hook that flags waiting Studio messages. Run it from the agent itself during setup (AGENTS.md).
//   npm run studio:connect -- claude [--user] [--no-hooks]   claude mcp add + hooks in .claude/settings.local.json (--user: ~/.claude/settings.json)
//   npm run studio:connect -- codex                          [mcp_servers.aigent-talking-head] in ~/.codex/config.toml
//   npm run studio:connect -- cursor [--user]                .cursor/mcp.json in the kit (--user: ~/.cursor/mcp.json)
//   npm run studio:connect -- print                          show the config for any MCP client, change nothing
// Safe to run again: it only adds what is missing. Restart the agent (or reload its MCP servers) once afterwards.
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, delimiter } from 'path';
import { homedir } from 'os';

// the paths and names are shared with the Connect agent dialog in Studio (kit/studio/agents.mjs)
import { ROOT, NAME, MCP, HOOK, NODE, python } from './agents.mjs';
const PY = python();
const onPath = b => (process.env.PATH || '').split(delimiter).some(d => existsSync(join(d, b)) || existsSync(join(d, b + '.cmd')) || existsSync(join(d, b + '.exe')));
const say = m => console.log(m);
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
const writeJson = (f, j) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); };
const envObj = PY ? { PYTHON: PY } : {};

const claudeRun = (args, o) => process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'claude', ...args], o)
  : spawnSync('claude', args, o);
function claude(user, hooks) {
  if (onPath('claude')) {
    const has = claudeRun(['mcp', 'get', NAME], { encoding: 'utf8', shell: false });
    if (has.status === 0) say(`Claude Code: ${NAME} is already registered`);
    else {
      const args = ['mcp', 'add', NAME, ...(user ? ['-s', 'user'] : []), ...(PY ? ['-e', `PYTHON=${PY}`] : []), '--', NODE, MCP];
      const r = claudeRun(args, { stdio: 'inherit', shell: false, cwd: ROOT });
      say(r.status === 0 ? `Claude Code: registered ${NAME}` : `Claude Code: claude mcp add failed; run it yourself: claude ${args.join(' ')}`);
    }
  } else say(`Claude Code CLI not found on PATH. Register by hand:\n  claude mcp add ${NAME}${user ? ' -s user' : ''}${PY ? ` -e PYTHON=${PY}` : ''} -- ${NODE} ${MCP}`);
  if (!hooks) return;
  const f = user ? join(homedir(), '.claude', 'settings.json') : join(ROOT, '.claude', 'settings.local.json'), j = readJson(f);
  j.hooks = j.hooks || {};
  const cmd = `"${NODE}" "${HOOK}"`; let added = 0;
  for (const ev of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
    const list = j.hooks[ev] = j.hooks[ev] || [];
    if (list.some(g => (g.hooks || []).some(h => String(h.command || '').includes('studio-pending.mjs')))) continue;
    list.push({ ...(ev === 'PostToolUse' ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: cmd, timeout: 5 }] }); added++;
  }
  writeJson(f, j);
  say(added ? `Claude Code: Studio hook added to ${f} (UserPromptSubmit, PostToolUse, Stop)` : `Claude Code: Studio hook already in ${f}`);
}
function codex() {
  const f = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
  const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
  if (cur.includes(`[mcp_servers.${NAME}]`)) return say(`Codex: ${NAME} is already in ${f}`);
  const block = `\n[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(NODE)}\nargs = [${JSON.stringify(MCP)}]\ntool_timeout_sec = 300\n${PY ? `env = { PYTHON = ${JSON.stringify(PY)} }\n` : ''}`;
  mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, cur + block);
  say(`Codex: added ${NAME} to ${f}. Codex has no hook for this; it checks studio_get_pending each turn (AGENTS.md).`);
}
function cursor(user) {
  const f = user ? join(homedir(), '.cursor', 'mcp.json') : join(ROOT, '.cursor', 'mcp.json'), j = readJson(f);
  j.mcpServers = j.mcpServers || {};
  if (j.mcpServers[NAME]) return say(`Cursor: ${NAME} is already in ${f}`);
  j.mcpServers[NAME] = { command: NODE, args: [MCP], ...(PY ? { env: envObj } : {}) };
  writeJson(f, j); say(`Cursor: added ${NAME} to ${f}. Cursor checks studio_get_pending each turn (AGENTS.md).`);
}
function print() {
  say(JSON.stringify({ mcpServers: { [NAME]: { command: NODE, args: [MCP], ...(PY ? { env: envObj } : {}) } } }, null, 2));
  say(`\nClaude Code hook command (optional): "${NODE}" "${HOOK}"`);
}

const argv = process.argv.slice(2), who = (argv.find(x => !x.startsWith('--')) || '').toLowerCase();
if (who === 'claude' || who === 'claude-code') claude(argv.includes('--user'), !argv.includes('--no-hooks'));
else if (who === 'codex') codex();
else if (who === 'cursor' || who === 'cursor-agent') cursor(argv.includes('--user'));
else if (who === 'print' || !who) print();
else { console.error(`unknown agent "${who}": claude, codex, cursor or print`); process.exit(2); }
if (who && who !== 'print') say('\nNext: restart your agent session (or reload its MCP servers) once, then run: npm run studio:agent, and tell it "Run the Studio chat loop".');
