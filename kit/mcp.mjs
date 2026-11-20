// MCP server (stdio) for agents: the kit's commands as tools, their input schemas generated from contract.json, so the
// tools can never drift from the CLIs (npm run contract checks contract.json against the scripts).
//   npm run mcp            (an MCP client starts this; see docs/mcp.md for Claude Code, Cursor and Codex)
// Tools: menu, list_effects, list_packs, get_pack, draft, explain, set_locks, plan, validate, render, verify. Each runs the matching npm command from the repo root with
// --json where the command has it and returns the log tail plus the JSON result (structuredContent).
// Studio tools: studio_start, studio_get_state, studio_set_selections, studio_run, studio_wait_for_message, studio_get_pending,
// studio_reply, studio_add_reference_url, studio_get_reference_teardown, studio_settings, studio_takes; list_scripts, get_script, write_script (Studio scripts); setup_status (what is installed and the fix for what is not). They read and write the same
// session as the Studio page (npm run studio, kit/studio/core.mjs), so you and the user see and change the same picks; the
// page updates live. The Studio chat is its own channel (kit/studio/channel.mjs): answer page messages with studio_reply,
// keep the terminal conversation in the terminal.
// Built on the official MCP TypeScript SDK (@modelcontextprotocol/sdk, MIT). Logs go to stderr; stdout is the protocol.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as Studio from './studio/core.mjs';
import * as Channel from './studio/channel.mjs';
import * as Settings from './studio/settings.mjs';
import * as Launch from './studio/launch.mjs';
import * as Record from './studio/record.mjs';
import * as Scripts from './studio/scripts.mjs';
import * as Setup from './setup.mjs';

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

const REEL = cmd('reel'), PLAN = cmd('plan'), VERIFY = cmd('verify'), MENU = cmd('menu'), LIST = cmd('list'), RMD = cmd('reelmd'), CHECK = cmd('check'), PACK = cmd('pack'), CHOICES = cmd('choices');
// a locks object ({ "transitions": ["whip"], "graphics": { "deny": ["checklist"] } }) as the --lock string kit/locks.cjs parses
const KEBAB = { maxTitles: 'max-titles', captionEntrance: 'caption-entrance' };
function lockString(l) {
  if (typeof l === 'string') return l;
  const parts = [];
  for (const [k, v] of Object.entries(l || {})) {
    if (k === 'graphics') { if (v && v.allow) parts.push('graphics=' + v.allow.join(',')); if (v && v.deny) parts.push('no-graphics=' + v.deny.join(',')); continue; }
    const val = Array.isArray(v) ? v.join(',') : v === false ? 'off' : v === true ? 'on' : String(v);
    parts.push(`${KEBAB[k] || k}=${val}`);
  }
  return parts.join('; ');
}
const LOCK_HELP = 'Keys: transitions, titles (title entrances), max-titles, caption-entrance, graphics (only these), no-graphics, finishes (none for no finish), cards=off, sfx=off, punch (off or 0.02 to 0.3). String form: "transitions=whip,zoom; titles=typewriter". Object form: { "transitions": ["whip","zoom"], "titles": ["typewriter"], "graphics": { "deny": ["checklist"] } }.';
const TOOLS = [
  { name: 'menu', description: 'Every option the kit has (looks, caption styles, titles, the 30 graphics, the editing principles, transitions, effects, sounds, beds, presets, exports). Offer it to the user before you draft. ' + MENU.summary,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, call: () => ['kit/menu.mjs', [], 60e3] },
  { name: 'list_effects', description: 'One part of the effects menu as names, one-line descriptions, the exact flag or field to use, and a looping preview path (npm run list -- <kind> --json). Kinds: transitions, titles (title entrances), captions (caption entrances and caption styles), graphics, effects, editing (the editing principles and the magazine preset), or any menu section id. Leave kind out for the list of kinds. Show the user docs/effects.md to see them animated. ' + LIST.summary,
    inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'transitions, titles, captions, graphics, effects, editing, or a section id from the menu tool' } }, additionalProperties: false },
    call: a => [MENU.script, ['--list', ...(a.kind ? [String(a.kind)] : []), '--json'], 60e3] },
  { name: 'list_packs', description: 'Every style pack (packs/<name>/pack.json): a whole look with its base preset, style keys, locks that pin what the kit may pick, and a preview path. Offer these before you draft; render with pack. Gallery: docs/packs.md. ' + PACK.summary,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, call: () => [PACK.script, ['list', '--json'], 60e3] },
  { name: 'get_pack', description: 'One style pack, resolved: the merged style (theme, look, caption style, fonts, transition, finishes, cards, music, sounds), its locks and weights, and its preview files.',
    inputSchema: { type: 'object', properties: { pack: { type: 'string', description: 'a pack name from list_packs, or a pack folder' } }, required: ['pack'], additionalProperties: false },
    call: a => [PACK.script, ['show', String(a.pack), '--json'], 60e3] },
  { name: 'draft', description: 'Transcribe a phone clip and draft the reel without rendering (npm run reel -- <clip> --name <job> --draft): cut.json, captions.js and the transcript the plan tool reads. ' + REEL.summary,
    inputSchema: schemaOf(REEL, { omit: ['draft', 'rebuild', 'json'] }), call: a => [REEL.script, argsOf(REEL, a, ['--draft', '--json']), 60 * 60e3] },
  { name: 'explain', description: 'What the kit picked in a drafted job and why, per beat: transition, finish and punch; each title entrance, place and layer; each graphic; captions, music and sound. Reasons: locked, pack or preset, recipe, you, kit default, or engine picks at render. Writes jobs/<job>/choices.json; edit it and call again with apply true, then render with rebuild. ' + CHOICES.summary,
    inputSchema: { type: 'object', properties: { job: { type: 'string', description: 'job name in jobs/ (or a job folder)' }, apply: { type: 'boolean', description: 'write the edits in jobs/<job>/choices.json back into the job first' } }, required: ['job'], additionalProperties: false },
    call: a => [CHOICES.script, [String(a.job), ...(a.apply ? ['--apply'] : []), '--json'], 60e3] },
  { name: 'set_locks', description: 'Pin choices on a drafted job so they stay as the user asked (the kit only picks inside a lock), then render with rebuild. Use when the user says things like "only whip and zoom transitions", "typewriter titles", "no checklist". ' + LOCK_HELP,
    inputSchema: { type: 'object', properties: { job: { type: 'string', description: 'job name in jobs/ (or a job folder)' }, locks: { description: 'the locks, as a string or an object (see the tool description)', oneOf: [{ type: 'string' }, { type: 'object' }] } }, required: ['job', 'locks'], additionalProperties: false },
    call: a => [CHOICES.script, [String(a.job), '--lock', lockString(a.locks), '--json'], 60e3] },
  { name: 'plan', description: 'Propose graphics from what the presenter says (numbers, lists, steps, quotes, commands, the call to action) into jobs/<job>/Reel.md for review. Every proposed word is a word they say. ' + PLAN.summary,
    inputSchema: schemaOf(PLAN, { omit: ['json'] }), call: a => [PLAN.script, argsOf(PLAN, a, ['--json']), 120e3] },
  { name: 'validate', description: 'Check a Reel.md recipe (npm run reelmd -- check) or a drafted job (npm run check -- <job>). Give recipe or job.',
    inputSchema: { type: 'object', properties: { recipe: { type: 'string', description: 'path to a Reel.md' }, job: { type: 'string', description: 'job name in jobs/ (or a job folder)' } }, additionalProperties: false },
    call: a => a.recipe ? [RMD.script, ['check', a.recipe], 60e3] : a.job ? [CHECK.script, [a.job], 60e3] : null },
  { name: 'render', description: 'Make the reel (npm run reel), from a clip, a recipe, or --rebuild of an edited job; export for a platform with export. Returns the reel path and what the layout pass moved. ' + REEL.summary,
    inputSchema: schemaOf(REEL, { omit: ['draft', 'json'] }), call: a => [REEL.script, argsOf(REEL, a, ['--json']), 60 * 60e3] },
  { name: 'verify', description: 'Check a finished reel before handing it over: ffprobe, loudness, overlap between graphics, captions and titles, the export safe area, mask and copy. Returns the contact sheet and stills to look at. ' + VERIFY.summary,
    inputSchema: schemaOf(VERIFY, { omit: ['json'] }), call: a => [VERIFY.script, argsOf(VERIFY, a, ['--json']), 20 * 60e3] },
  { name: 'studio_get_state', description: 'The Studio session the user sees in the browser (npm run studio): job, footage, reference and what was extracted from it, the pack, every pick (allowed and forbidden effects by kind), music, sound, pace, export, the chat with the user, the running task, outputs, and the npm run reel arguments it adds up to. Read the chat: lines from the user are for you to answer with studio_set_selections (reply). With catalog true, also every effect Studio shows, by category, as kind:id refs.',
    inputSchema: { type: 'object', properties: { catalog: { type: 'boolean', description: 'include the menu: categories with kind:id refs, packs, beds, exports' } }, additionalProperties: false },
    direct: a => { const s = Studio.load(), c = Studio.catalog(); let comp; try { comp = Studio.compose(s); } catch (e) { comp = { errs: [e.message] }; }
      const out = { state: s, compose: comp, outputs: Studio.outputsOf(s), statePath: Studio.statePath() };
      if (a.catalog) out.catalog = { categories: c.categories.filter(x => x.count).map(x => ({ id: x.id, label: x.label, items: x.items })), packs: c.packs.map(p => p.name), beds: c.beds.map(b => `${b.id} (${b.energy})`), exports: c.exports, selectable: Object.values(c.items).filter(i => i.mode !== 'info').map(i => i.ref) };
      return out; } },
  { name: 'studio_set_selections', description: 'Change the Studio session; the page updates live. Use it when the user tells you a vibe or names effects. Fields (all optional): pack (a pack name or null), picks { "transition:whip": "allow" | "deny" | "clear" } (kind:id refs from studio_get_state with catalog true; allow means only allowed ones of that kind are used, deny forbids one), clearPicks, music { bed: auto | none | a bed id, energy: auto | low | mid | high }, sound { sfx: on | off, cap: on | off }, pace { tighten: null | off | 0.1 to 2, punch: on | off }, export, job, reference { mode: influence | recreate | off }, reply (your answer to a Studio message, shown in the Studio chat; prefer studio_reply), origin ("studio" when a Studio page message asked for this, "terminal" when the user asked in your terminal conversation: Studio then shows only a one-line action note such as "changed transitions to whip (from the terminal)" if the user keeps action notes on; never put terminal conversation in reply). Unknown names are refused and nothing is changed.',
    inputSchema: { type: 'object', properties: { pack: { type: ['string', 'null'] }, picks: { type: 'object', additionalProperties: { type: 'string', enum: ['allow', 'deny', 'clear'] } }, clearPicks: { type: 'boolean' }, music: { type: 'object' }, sound: { type: 'object' }, pace: { type: 'object' }, export: { type: ['string', 'null'] }, job: { type: 'string' }, reference: { type: 'object' }, reply: { type: 'string' }, say: { type: 'string' }, origin: { type: 'string', enum: ['studio', 'terminal'] } }, additionalProperties: false },
    direct: a => { seen(); const { origin, ...patch } = a; if (origin === 'terminal') { delete patch.reply; delete patch.say; }
      const s = Studio.load(), r = Studio.applyPatch(s, { ...patch, from: Channel.prettyName(agentName()) }); if (r.errs.length) throw new Error(r.errs.join('; '));
      const note = origin === 'terminal' && Settings.load().actionNotes ? Channel.actionNote(s, r.log.filter(x => !/^job /.test(x)), agentName()) : null;
      Studio.save(s); return { ok: true, changed: r.log, actionNote: note, compose: Studio.compose(s) }; } },
  { name: 'studio_run', description: 'Start a draft or a render in the running Studio (npm run studio) so the user sees the progress in the page. Then poll studio_get_state (task) and, after a draft, call explain with the job to talk the picks through. Needs Studio open; otherwise use draft and render.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['draft', 'render'] }, port: { type: 'number', description: 'Studio port, default 4757' } }, required: ['action'], additionalProperties: false },
    direct: async a => { const port = a.port || +(process.env.STUDIO_PORT || 4757); let r; try { r = await fetch(`http://127.0.0.1:${port}/api/${a.action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { throw new Error(`Studio is not running on port ${port}. Ask the user to run npm run studio (or use the draft and render tools).`); }
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `Studio said ${r.status}`); return { ok: true, task: j.task, compose: j.compose }; } },
];
// ---------- Studio as a chat channel for this agent ----------
let clientName = null;
const agentName = () => clientName || 'agent';
const seen = (extra = {}) => { try { Channel.touch({ name: clientName, ...extra }); } catch {} };
const studioPort = a => a.port || +(process.env.STUDIO_PORT || 4757);
async function studioPost(a, path, body) {
  let r; try { r = await fetch(`http://127.0.0.1:${studioPort(a)}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  catch { throw new Error(`Studio is not running on port ${studioPort(a)}. Start it with studio_start (or npm run studio:agent).`); }
  const j = await r.json(); if (!r.ok) throw new Error(j.error || `Studio said ${r.status}`); return j;
}
const CHANNEL_RULE = 'The Studio page chat is a separate channel from your terminal conversation: answer Studio messages with studio_reply (they show only in Studio), answer terminal messages in the terminal, and never paste terminal discussion into Studio unless the user asks.';
TOOLS.push(
  { name: 'studio_start', description: 'Start Studio in the background if it is not running (same as npm run studio:agent), open it in the user\'s browser, and return its URL. Then call studio_wait_for_message to listen to the Studio chat. ' + CHANNEL_RULE,
    inputSchema: { type: 'object', properties: { port: { type: 'number', description: 'default 4757' }, open: { type: 'boolean', description: 'open the browser, default true' } }, additionalProperties: false },
    direct: async a => { seen(); const r = await Launch.start({ port: studioPort(a), open: a.open !== false }); return { ...r, next: 'Tell the user Studio is open at ' + r.url + ', then call studio_wait_for_message.' }; } },
  { name: 'studio_wait_for_message', description: 'Listen to the Studio page chat: waits up to timeout_s (default 45, max 240) for the user to type in Studio, then returns those messages (marked seen on the page) with the session context (picks, reference teardown, task). Answer each with studio_reply, change the edit with studio_set_selections (origin studio) or other studio_ tools, then call this again. Returns { messages: [] , timedOut: true } when nothing came; call it again to keep listening. While it waits the page shows you as listening. ' + CHANNEL_RULE,
    inputSchema: { type: 'object', properties: { timeout_s: { type: 'number', description: 'seconds to wait, default 45 (keep under your client\'s tool timeout)' } }, additionalProperties: false },
    direct: async a => {
      const until = Date.now() + Math.min(Math.max(+a.timeout_s || 45, 1), 240) * 1000;
      let beat = 0;
      try {
        for (;;) {
          const r = Channel.take();
          if (r.messages.length) { seen({ waiting: false }); return { messages: r.messages, context: Channel.context(r.state), howToAnswer: 'studio_reply { replyTo: <id>, text, patch? }' }; }
          if (Date.now() >= until) break;
          if (Date.now() - beat > 4000) { seen({ waiting: true }); beat = Date.now(); }
          await new Promise(ok => setTimeout(ok, 400));
        }
      } finally { seen({ waiting: false }); }
      return { messages: [], timedOut: true, next: 'nothing new in Studio; call studio_wait_for_message again to keep listening, or go back to the terminal' };
    } },
  { name: 'studio_get_pending', description: 'Check the Studio page chat without waiting: returns messages the user typed in Studio that you have not read (and marks them seen), plus the session context. Call it at the start of every turn while Studio is open, so Studio messages are never missed while you work in the terminal. ' + CHANNEL_RULE,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    direct: () => { seen(); const r = Channel.take(); return r.messages.length ? { messages: r.messages, context: Channel.context(r.state) } : { messages: [] }; } },
  { name: 'studio_reply', description: 'Answer in the Studio page chat (the Studio channel only; it never shows in the terminal). replyTo is the id (or ids) of the Studio messages you answer; they show as answered. patch, optional, changes the edit first with the same fields as studio_set_selections (pack, picks, music, sound, pace, export, reference { mode }); unknown names are refused and nothing is changed. ' + CHANNEL_RULE,
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'your answer, plain and short' }, replyTo: { oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] }, patch: { type: 'object' } }, required: ['text'], additionalProperties: false },
    direct: a => { seen(); const r = Channel.reply({ text: a.text, replyTo: a.replyTo, patch: a.patch, agent: agentName() }); if (r.errs.length) throw new Error(r.errs.join('; ')); return { ok: true, ...r }; } },
  { name: 'studio_add_reference_url', description: 'Add one or more reference video links to Studio (YouTube, Shorts, TikTok, X, Vimeo, a direct .mp4, or one public Instagram post fetched anonymously). Studio downloads each to the user\'s download folder, runs the teardown and shows it in the page; poll studio_get_reference_teardown. mode: influence (borrow the style) or recreate (follow its structure). Only for videos the user has the rights to use as a reference. Needs Studio running.',
    inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, mode: { type: 'string', enum: ['influence', 'recreate', 'off'] }, port: { type: 'number' } }, additionalProperties: false },
    direct: async a => { seen(); const j = await studioPost(a, '/api/reference/url', { urls: [].concat(a.urls || [], a.url || []), mode: a.mode }); return { added: j.added.map(x => ({ id: x.id, url: x.url, site: x.site, status: x.status, error: x.error })), next: 'poll studio_get_reference_teardown until status is ready or failed' }; } },
  { name: 'studio_get_reference_teardown', description: 'The reference queue and teardowns: each link with its status (queued, downloading, tearing, ready, failed), progress and error, and for ready ones the teardown summary (duration, shots, cut times, average shot and pacing, music BPM, beats, energy, caption style, titles, detected transitions, finishes, graphics and effects, and suggestions mapped to the Studio menu as kind:id refs with reasons). id picks one; the default is the one the session uses.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, additionalProperties: false },
    direct: a => { seen(); const s = Studio.load(), q = s.reference.queue || [];
      const pickOne = a.id ? q.find(x => x.id === a.id) : q.find(x => x.id === s.reference.active);
      return { mode: s.reference.mode, active: s.reference.active, queue: q.map(x => ({ id: x.id, url: x.url, site: x.site, title: x.title, status: x.status, progress: x.progress, error: x.error })),
        teardown: pickOne ? { id: pickOne.id, url: pickOne.url, status: pickOne.status, recipe: pickOne.out ? pickOne.out + '/Reel.md' : null, report: pickOne.out ? pickOne.out + '/teardown.md' : null, extracted: pickOne.extracted || null } : (s.reference.extracted ? { id: null, file: s.reference.file, extracted: s.reference.extracted } : null) }; } },
  { name: 'studio_settings', description: 'Read or change Studio settings: downloads (folder for reference downloads, a full path; null resets to the kit\'s gitignored teardown-in/studio/<job>/), renders (folder finished reels are copied to; null for none), actionNotes (true: a one-line note in Studio when you change the edit from the terminal), chat { backend: agent (default: you answer the Studio chat) | auto | anthropic | openai | local | keywords, baseUrl (local OpenAI-compatible server), model }. Folders are checked to exist or be creatable and writable.',
    inputSchema: { type: 'object', properties: { downloads: { type: ['string', 'null'] }, renders: { type: ['string', 'null'] }, actionNotes: { type: 'boolean' }, chat: { type: 'object' } }, additionalProperties: false },
    direct: a => { seen(); if (!Object.keys(a).length) return { settings: Settings.load(), path: Settings.settingsPath() }; const r = Settings.update(a); if (r.errs.length) throw new Error(r.errs.join('; ')); try { const s = Studio.load(); Studio.save(s); } catch {} return { ok: true, settings: r.settings }; } },
  { name: 'studio_takes', description: 'Takes the user filmed with Record now in the Studio page (camera and mic in the browser): each with its id, mp4 file, thumbnail, seconds, status (recording, converting, ready, failed) and whether it is kept in the footage. A new take is kept by default and drafts like any footage; Studio also posts a one-line note in its chat ("New take recorded: 42 s"). Give id and action (keep, unkeep or discard) to change one; discard deletes its files.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' }, action: { type: 'string', enum: ['keep', 'unkeep', 'discard'] } }, additionalProperties: false },
    direct: a => { const s = Studio.load(); if (a.action) { if (!a.id) throw new Error('give the take id'); Record.act(s, a.id, a.action); Studio.save(s); } return { takes: Record.list(Studio.load()), folder: s.job ? Record.takesDir(s).split('\\').join('/') : null }; } },
  { name: 'list_scripts', description: 'Scripts the user reads on camera, kept per job in Studio (jobs/.studio/scripts/<job>/): id, title, words, estimated seconds at its WPM, sections and who wrote it. job defaults to the Studio session job.',
    inputSchema: { type: 'object', properties: { job: { type: 'string' } }, additionalProperties: false },
    direct: a => { const job = a.job || Studio.load().job; return { job, scripts: Scripts.list(job) }; } },
  { name: 'get_script', description: 'One script with its full text, word count, estimated seconds, sections and [pause] marks.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, job: { type: 'string' } }, required: ['id'], additionalProperties: false },
    direct: a => ({ script: Scripts.get(a.job || Studio.load().job, a.id) }) },
  { name: 'write_script', description: 'Create or replace a script in Studio (it shows in the Scripts area and the teleprompter at once). Leave out id for a new script; give an id from list_scripts to replace it. ' + Scripts.SCRIPT_FORMAT + ' For a script from a reference, follow its hook, pacing, shot count and beat times (studio_get_reference_teardown). Before saving every draft, run the humanizer skill on it (skills/humanizer in this repo, or an equivalent humanizer skill you already have) and save the humanized text; no em dashes. Then tell the user in the channel they asked in (studio_reply for Studio).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, wpm: { type: 'integer', minimum: 60, maximum: 260 }, from: { type: 'string', description: 'what it was written from, e.g. a reference url or "topic: ..."' }, job: { type: 'string' } }, required: ['text'], additionalProperties: false },
    direct: a => { const s = Studio.load(), job = a.job || s.job; if (!job) throw new Error('no job: name the reel in Studio first or give job');
      const sc = Scripts.write(job, { id: a.id, title: a.title, text: String(a.text).replace(/\u2014/g, ', '), wpm: a.wpm, from: a.from, by: Channel.prettyName(agentName()) });
      if (job === s.job) { s.scriptsAt = Date.now(); Studio.save(s); } return { script: sc }; } },
  { name: 'setup_status', description: 'What the kit has installed: each dependency (Node packages, Python venv and requirements, ffmpeg, Chrome, the Whisper model, yt-dlp, instaloader, the effects pass, the humanizer skill, the Studio page) as ready or missing, the feature it is for and the one fix command, plus forUser: the plain-words list of things only the user can do (for example "Installing ffmpeg needs your password: run sudo apt-get install -y ffmpeg"). Run npm run setup:all yourself for everything else, then tell the user only the forUser lines. Same list as the Setup check in Studio.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    direct: () => Setup.status() }
);
for (const t of TOOLS) if (t.name.startsWith('studio_') && t.direct && !t._wrapped) { const d = t.direct; t.direct = a => { seen(); return d(a); }; t._wrapped = true; }

for (const c of [REEL, PLAN, VERIFY, MENU, RMD, CHECK, PACK, CHOICES]) if (!existsSync(join(ROOT, c.script))) throw new Error(`${c.name}: ${c.script} is missing`);

const server = new Server({ name: 'aigent-talking-head', version: PKG.version }, { capabilities: { tools: {} }, instructions: 'Talking-head reel kit. Flow: menu (offer options; list_effects for transitions, title or caption entrances with preview paths, and docs/effects.md to show them animated; list_packs for whole looks with previews in docs/packs.md), draft (transcribe, with pack and lock when the user picked a look or pinned choices), explain (show the user what was picked per beat and why; they can change any of it, or pin it with set_locks), plan (propose graphics from the words), review the Reel.md with the user, validate, render (with export for a platform), verify (then look at the contact sheet). Studio (npm run studio:agent or studio_start): you are the agent in the Studio page chat. When idle, listen with studio_wait_for_message and answer with studio_reply; while you work in the terminal, call studio_get_pending at the start of each turn. The Studio chat and the terminal are separate channels: answer each where it was asked, and never copy terminal conversation into Studio. Change the edit with studio_set_selections (origin studio or terminal), add reference links with studio_add_reference_url, read teardowns with studio_get_reference_teardown, and start drafts or renders with studio_run. Read skills/aigent-talking-head/SKILL.md for the rules: on-screen words are words the presenter says, nothing ever covers the face.' });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
server.setRequestHandler(CallToolRequestSchema, async req => {
  if (!clientName) { const v = server.getClientVersion && server.getClientVersion(); if (v && v.name) clientName = v.name; }
  const t = TOOLS.find(x => x.name === req.params.name);
  if (!t) return { isError: true, content: [{ type: 'text', text: `unknown tool ${req.params.name}` }] };
  if (t.direct) {
    try { const out = await t.direct(req.params.arguments || {}); return { content: [{ type: 'text', text: JSON.stringify(out, null, 1).slice(0, 60000) }], structuredContent: out }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  }
  let spec;
  try { spec = t.call(req.params.arguments || {}); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  if (!spec) return { isError: true, content: [{ type: 'text', text: 'give recipe (a Reel.md path) or job (a job name)' }] };
  const [script, args, ms] = spec;
  const r = await run(script, args, ms), json = lastJson(r.out);
  const text = `$ npm run ${t.name === 'validate' ? (script.endsWith('reelmd.cjs') ? 'reelmd' : 'check') : t.name === 'draft' || t.name === 'render' ? 'reel' : t.name === 'list_effects' ? 'list' : t.name === 'list_packs' || t.name === 'get_pack' ? 'pack' : t.name === 'explain' || t.name === 'set_locks' ? 'choices' : t.name} -- ${(t.name === 'list_effects' ? args.slice(1) : args).join(' ')}\nexit ${r.code}\n\n${t.name === 'menu' ? r.out.trim() : tail(r.out)}${r.err.trim() ? '\n\nstderr:\n' + tail(r.err, 20) : ''}`;
  return { isError: r.code !== 0, content: [{ type: 'text', text }], ...(json ? { structuredContent: json } : {}) };
});
await server.connect(new StdioServerTransport());
console.error(`aigent-talking-head MCP server ${PKG.version} on stdio (${TOOLS.map(t => t.name).join(', ')})`);
