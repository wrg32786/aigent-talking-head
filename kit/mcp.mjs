// MCP server (stdio) for agents: the kit's commands as tools, their input schemas generated from contract.json, so the
// tools can never drift from the CLIs (npm run contract checks contract.json against the scripts).
//   npm run mcp            (an MCP client starts this; see docs/mcp.md for Claude Code, Cursor and Codex)
// Tools: menu, list_effects, draft, plan, validate, render, verify. Each runs the matching npm command from the repo root with
// --json where the command has it and returns the log tail plus the JSON result (structuredContent).
// Built on the official MCP TypeScript SDK (@modelcontextprotocol/sdk, MIT). Logs go to stderr; stdout is the protocol.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const C = JSON.parse(readFileSync(join(ROOT, 'contract.json'), 'utf8'));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const cmd = n => { const c = C.commands.find(x => x.name === n); if (!c) throw new Error(`contract.json has no command ${n}`); return c; };

// contract flag -> JSON Schema property
function prop(f) {
  const d = [f.description, f.default != null ? `default: ${f.default}` : null].filter(Boolean).join('; ');
  if (f.type === 'boolean') return { type: 'boolean', description: d };
  if (f.type === 'number') return { type: 'number', description: d };
  if (f.type === 'enum') return { type: 'string', enum: f.values, description: d };
  if (f.type === 'list') return { type: 'string', description: (d ? d + '; ' : '') + 'comma-separated, no spaces' };
  return { type: 'string', description: (f.type === 'path' ? 'path (relative to the repo root, or absolute); ' : '') + d };
}
// a tool's schema: the command's positionals and flags from the contract, less what the tool sets itself
function schemaOf(c, { omit = [], extra = {}, required = [] } = {}) {
  const properties = {};
  for (const p of c.positional || []) properties[p.name] = p.variadic ? { type: 'array', items: { type: 'string' }, description: p.description } : { type: 'string', description: p.description };
  for (const f of c.flags || []) if (!omit.includes(f.name)) properties[f.name] = prop(f);
  Object.assign(properties, extra);
  return { type: 'object', properties, required: [...new Set([...required, ...(c.positional || []).filter(p => p.required).map(p => p.name)])], additionalProperties: false };
}
// tool arguments -> CLI args, refusing anything the contract does not list
function argsOf(c, a, fixed = []) {
  const out = [], flags = new Map((c.flags || []).map(f => [f.name, f]));
  for (const p of c.positional || []) { const v = a[p.name]; if (v == null) continue; out.push(...(Array.isArray(v) ? v : [v]).map(String)); }
  for (const [k, v] of Object.entries(a)) {
    if ((c.positional || []).some(p => p.name === k) || v == null || v === false) continue;
    const f = flags.get(k); if (!f) throw new Error(`${c.name}: unknown option ${k} (contract.json)`);
    if (f.type === 'enum' && !f.values.includes(String(v))) throw new Error(`${c.name}: ${k} must be ${f.values.join(', ')}`);
    if (f.type === 'boolean') out.push('--' + k); else out.push('--' + k, String(v));
  }
  for (const x of fixed) if (!out.includes(x)) out.push(x);
  return out;
}
function run(script, args, timeoutMs) {
  return new Promise(res => {
    const p = spawn(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env: process.env });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGTERM'); err += `\ntimed out after ${Math.round(timeoutMs / 1000)} s`; }, timeoutMs);
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; process.stderr.write(d); });
    p.on('close', code => { clearTimeout(t); res({ code, out, err }); });
  });
}
const lastJson = s => { try { const w = JSON.parse(s); if (w && typeof w === 'object' && !Array.isArray(w)) return w; } catch {} const l = s.trim().split('\n').reverse().find(x => /^\{.*\}$/.test(x.trim())); try { return l ? JSON.parse(l) : null; } catch { return null; } };
const tail = (s, n = 60) => s.trim().split('\n').slice(-n).join('\n');

const REEL = cmd('reel'), PLAN = cmd('plan'), VERIFY = cmd('verify'), MENU = cmd('menu'), LIST = cmd('list'), RMD = cmd('reelmd'), CHECK = cmd('check');
const TOOLS = [
  { name: 'menu', description: 'Every option the kit has (looks, caption styles, titles, the 29 graphics, transitions, effects, sounds, beds, presets, exports). Offer it to the user before you draft. ' + MENU.summary,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, call: () => ['kit/menu.mjs', [], 60e3] },
  { name: 'list_effects', description: 'One part of the effects menu as names, one-line descriptions, the exact flag or field to use, and a looping preview path (npm run list -- <kind> --json). Kinds: transitions, titles (title entrances), captions (caption entrances and caption styles), graphics, effects, or any menu section id. Leave kind out for the list of kinds. Show the user docs/effects.md to see them animated. ' + LIST.summary,
    inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'transitions, titles, captions, graphics, effects, or a section id from the menu tool' } }, additionalProperties: false },
    call: a => [MENU.script, ['--list', ...(a.kind ? [String(a.kind)] : []), '--json'], 60e3] },
  { name: 'draft', description: 'Transcribe a phone clip and draft the reel without rendering (npm run reel -- <clip> --name <job> --draft): cut.json, captions.js and the transcript the plan tool reads. ' + REEL.summary,
    inputSchema: schemaOf(REEL, { omit: ['draft', 'rebuild', 'json'] }), call: a => [REEL.script, argsOf(REEL, a, ['--draft', '--json']), 60 * 60e3] },
  { name: 'plan', description: 'Propose graphics from what the presenter says (numbers, lists, steps, quotes, commands, the call to action) into jobs/<job>/Reel.md for review. Every proposed word is a word they say. ' + PLAN.summary,
    inputSchema: schemaOf(PLAN, { omit: ['json'] }), call: a => [PLAN.script, argsOf(PLAN, a, ['--json']), 120e3] },
  { name: 'validate', description: 'Check a Reel.md recipe (npm run reelmd -- check) or a drafted job (npm run check -- <job>). Give recipe or job.',
    inputSchema: { type: 'object', properties: { recipe: { type: 'string', description: 'path to a Reel.md' }, job: { type: 'string', description: 'job name in jobs/ (or a job folder)' } }, additionalProperties: false },
    call: a => a.recipe ? [RMD.script, ['check', a.recipe], 60e3] : a.job ? [CHECK.script, [a.job], 60e3] : null },
  { name: 'render', description: 'Make the reel (npm run reel), from a clip, a recipe, or --rebuild of an edited job; export for a platform with export. Returns the reel path and what the layout pass moved. ' + REEL.summary,
    inputSchema: schemaOf(REEL, { omit: ['draft', 'json'] }), call: a => [REEL.script, argsOf(REEL, a, ['--json']), 60 * 60e3] },
  { name: 'verify', description: 'Check a finished reel before handing it over: ffprobe, loudness, overlap between graphics, captions and titles, the export safe area, mask and copy. Returns the contact sheet and stills to look at. ' + VERIFY.summary,
    inputSchema: schemaOf(VERIFY, { omit: ['json'] }), call: a => [VERIFY.script, argsOf(VERIFY, a, ['--json']), 20 * 60e3] },
];
for (const c of [REEL, PLAN, VERIFY, MENU, RMD, CHECK]) if (!existsSync(join(ROOT, c.script))) throw new Error(`${c.name}: ${c.script} is missing`);

const server = new Server({ name: 'aigent-talking-head', version: PKG.version }, { capabilities: { tools: {} }, instructions: 'Talking-head reel kit. Flow: menu (offer options; list_effects for transitions, title or caption entrances with preview paths, and docs/effects.md to show them animated), draft (transcribe), plan (propose graphics from the words), review the Reel.md with the user, validate, render (with export for a platform), verify (then look at the contact sheet). Read skills/aigent-talking-head/SKILL.md for the rules: on-screen words are words the presenter says, nothing ever covers the face.' });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
server.setRequestHandler(CallToolRequestSchema, async req => {
  const t = TOOLS.find(x => x.name === req.params.name);
  if (!t) return { isError: true, content: [{ type: 'text', text: `unknown tool ${req.params.name}` }] };
  let spec;
  try { spec = t.call(req.params.arguments || {}); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  if (!spec) return { isError: true, content: [{ type: 'text', text: 'give recipe (a Reel.md path) or job (a job name)' }] };
  const [script, args, ms] = spec;
  const r = await run(script, args, ms), json = lastJson(r.out);
  const text = `$ npm run ${t.name === 'validate' ? (script.endsWith('reelmd.cjs') ? 'reelmd' : 'check') : t.name === 'draft' || t.name === 'render' ? 'reel' : t.name === 'list_effects' ? 'list' : t.name} -- ${(t.name === 'list_effects' ? args.slice(1) : args).join(' ')}\nexit ${r.code}\n\n${t.name === 'menu' ? r.out.trim() : tail(r.out)}${r.err.trim() ? '\n\nstderr:\n' + tail(r.err, 20) : ''}`;
  return { isError: r.code !== 0, content: [{ type: 'text', text }], ...(json ? { structuredContent: json } : {}) };
});
await server.connect(new StdioServerTransport());
console.error(`aigent-talking-head MCP server ${PKG.version} on stdio (${TOOLS.map(t => t.name).join(', ')})`);
