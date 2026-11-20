// What to paste into each terminal agent so it connects to Studio: the MCP server command with this install's real
// paths, the line to say, and for Claude Code the hook. The Connect agent dialog (GET /api/connect) and
// kit/studio/connect.mjs both use it. Each config shape was checked against the agent's own docs; the sources and the
// date are in docs/studio.md ("Connect agent"). An agent marked verified: false could not be checked there.
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const NAME = 'aigent-talking-head';
export const MCP = join(ROOT, 'kit', 'mcp.mjs');
export const HOOK = join(ROOT, 'kit', 'studio', 'hooks', 'studio-pending.mjs');
export const CONNECT = join(ROOT, 'kit', 'studio', 'connect.mjs');
export const NODE = process.execPath;
export const python = (env = process.env) => env.PYTHON || [join(ROOT, '.venv', 'bin', 'python'), join(ROOT, '.venv', 'Scripts', 'python.exe')].find(existsSync) || null;
export const SAY = 'Run the Studio chat loop';
// the one line a user pastes into any agent to install, set up and connect Studio from scratch (docs/install.md);
// the README Quick start shows the same line
export const INSTALL_LINE = 'Read https://github.com/wrg32786/aigent-talking-head/blob/main/docs/install.md and follow it to install, set up and connect Talking Head Studio in this agent, then open Studio.';
export const HOOK_EVENTS = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
export const IDS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'windsurf', 'generic'];

// a path for a shell line: quoted only when it needs it (double quotes work in sh, zsh, PowerShell and cmd)
export const q = p => (/^[\w@%+=:,./\\-]+$/.test(p) ? p : JSON.stringify(p));
const json = o => JSON.stringify(o, null, 2);

export function hookConfig(node = NODE, hook = HOOK) {
  const h = { type: 'command', command: `"${node}" "${hook}"`, timeout: 5 };
  return { hooks: Object.fromEntries(HOOK_EVENTS.map(ev => [ev, [ev === 'PostToolUse' ? { matcher: '*', hooks: [h] } : { hooks: [h] }]])) };
}

// every agent: { id, name, verified, docs: [urls], steps: [{ title, code, lang, note }], say, check }
export function setups({ py = python(), node = NODE, mcp = MCP, url } = {}) {
  const N = q(node), M = q(mcp), envPairs = py ? { PYTHON: py } : null;
  const server = { command: node, args: [mcp], ...(envPairs ? { env: envPairs } : {}) };
  const std = json({ mcpServers: { [NAME]: server } });
  const restart = 'Restart the agent once so it loads the new server.';
  const sayLine = `${SAY}${url ? ` (Studio is at ${url})` : ''}`;
  return [
    { id: 'claude', name: 'Claude Code', verified: true, docs: ['https://code.claude.com/docs/en/mcp', 'https://code.claude.com/docs/en/hooks'],
      steps: [
        { title: 'Add the Studio MCP server', lang: 'sh', code: `claude mcp add${py ? ` --env PYTHON=${q(py)}` : ''} --transport stdio --scope user ${NAME} -- ${N} ${M}`, note: 'Run it in any terminal. --scope user makes it work in every folder.' },
        { title: 'Install the hook (flags waiting Studio messages)', lang: 'sh', code: `${N} ${q(CONNECT)} claude --user`, note: 'Adds the UserPromptSubmit, PostToolUse and Stop hooks to ~/.claude/settings.json. Safe to run again.' },
      ], say: sayLine, check: 'claude mcp get ' + NAME, restart },
    { id: 'codex', name: 'Codex CLI', verified: true, docs: ['https://developers.openai.com/codex/mcp'],
      steps: [
        { title: 'Add the Studio MCP server', lang: 'sh', code: `codex mcp add ${NAME}${py ? ` --env PYTHON=${q(py)}` : ''} -- ${N} ${M}` },
        { title: 'Or paste this into ~/.codex/config.toml', lang: 'toml', code: `[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(mcp)}]\ntool_timeout_sec = 300\n${py ? `env = { PYTHON = ${JSON.stringify(py)} }\n` : ''}`, note: 'tool_timeout_sec = 300 lets a render finish inside one tool call.' },
      ], say: sayLine, check: 'codex mcp list', restart },
    { id: 'cursor', name: 'Cursor (CLI and IDE)', verified: true, docs: ['https://cursor.com/docs/context/mcp', 'https://cursor.com/docs/cli/mcp'],
      steps: [
        { title: 'Paste this into ~/.cursor/mcp.json', lang: 'json', code: std, note: 'The Cursor editor and the agent CLI read the same file. Use .cursor/mcp.json in a project to keep it to that project.' },
      ], say: sayLine, check: 'agent mcp list', restart },
    { id: 'gemini', name: 'Gemini CLI', verified: true, docs: ['https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md'],
      steps: [
        { title: 'Add the Studio MCP server', lang: 'sh', code: `gemini mcp add --scope user${py ? ` -e PYTHON=${q(py)}` : ''} ${NAME} ${N} ${M}` },
        { title: 'Or paste this into ~/.gemini/settings.json', lang: 'json', code: std },
      ], say: sayLine, check: 'gemini mcp list', restart },
    { id: 'opencode', name: 'OpenCode', verified: true, docs: ['https://opencode.ai/docs/mcp-servers/'],
      steps: [
        { title: 'Add the Studio MCP server', lang: 'sh', code: `opencode mcp add ${NAME} --global${py ? ` --env PYTHON=${q(py)}` : ''} -- ${N} ${M}` },
        { title: 'Or paste this into opencode.jsonc', lang: 'json', code: json({ $schema: 'https://opencode.ai/config.json', mcp: { servers: { [NAME]: { type: 'local', command: [node, mcp], ...(envPairs ? { environment: envPairs } : {}) } } } }) },
      ], say: sayLine, check: 'opencode mcp list', restart },
    { id: 'windsurf', name: 'Windsurf or another MCP app', verified: false, docs: ['https://docs.windsurf.com/windsurf/cascade/mcp'],
      steps: [
        { title: 'Paste this into the app\'s MCP config', lang: 'json', code: std, note: 'Windsurf\'s MCP page now opens the Devin Local docs, which name ~/.config/devin/mcp_config.json but do not show its format. The mcpServers shape here is the common one; check your app\'s MCP settings if it does not load.' },
      ], say: sayLine, restart },
    { id: 'generic', name: 'Other / generic MCP', verified: true, docs: ['https://modelcontextprotocol.io/docs/develop/connect-local-servers'],
      steps: [
        { title: 'A stdio MCP server with this command', lang: 'sh', code: `${N} ${M}`, note: py ? `Set PYTHON=${py} in its environment.` : 'No extra environment needed.' },
        { title: 'Most apps take this JSON', lang: 'json', code: std },
      ], say: sayLine, restart },
  ];
}

// one prompt for any agent: it reads AGENTS.md and sets itself up
export function setupPrompt({ url } = {}) {
  return `Set up AIgent Studio for yourself. Read ${join(ROOT, 'AGENTS.md')} (the Studio section) and follow it: register the MCP server ${NAME} in your own MCP config with the command ${q(NODE)} ${q(MCP)}${python() ? ` and PYTHON=${python()} in its environment` : ''}, install the Studio hook if you are Claude Code, reload your MCP servers, then run the Studio chat loop so you answer me in the Studio page${url ? ` at ${url}` : ''}.`;
}
