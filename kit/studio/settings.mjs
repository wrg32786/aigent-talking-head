// Studio settings: where reference downloads and finished reels go, and who answers the Studio chat. Kept in
// jobs/.studio/settings.json (or STUDIO_DIR), which git ignores. Environment variables win over the file:
//   STUDIO_DOWNLOADS  folder for downloaded reference videos (default: teardown-in/studio/<job>/ in the kit)
//   STUDIO_RENDERS    folder that finished reels are copied to (default: none; reels stay in jobs/<job>/)
//   STUDIO_CHAT       agent (default) | auto | anthropic | openai | local | keywords
//   STUDIO_LOCAL_URL  an OpenAI-compatible server for local models (Ollama, LM Studio, llama.cpp server)
//   STUDIO_MODEL      the model name for the API or local backend
// actionNotes (default true): when your terminal agent changes the edit from the terminal conversation, Studio shows a
// one-line action note in the page chat ("Changed transitions to whip, from the terminal"). Never conversation text.
// agent: the terminal agent picked in the Connect agent dialog (claude, codex, cursor, gemini, opencode, windsurf, generic).
// Keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, LOCAL_LLM_API_KEY) are read from the environment only, never saved here.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

export const BACKENDS = ['agent', 'auto', 'anthropic', 'openai', 'local', 'keywords'];
export const LOCAL_PRESETS = [
  { id: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio', url: 'http://127.0.0.1:1234/v1' },
  { id: 'llamacpp', label: 'llama.cpp server', url: 'http://127.0.0.1:8080/v1' },
];
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const stateDir = () => resolve(process.env.STUDIO_DIR || join(ROOT, 'jobs', '.studio'));
export const settingsPath = () => join(stateDir(), 'settings.json');

export const GEN_IDS = ['higgsfield', 'google', 'openai', 'replicate', 'fal'];
export const AGENT_IDS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'windsurf', 'generic'];
// broll: { library: the b-roll folder (default <kit>/broll-library), generate: paid generating is allowed (off by
// default), models: { higgsfield, google, openai, replicate, fal } the model each provider uses }
export const BROLL_DEFAULTS = { library: null, generate: false, provider: null, models: {} };
export function defaults() { return { downloads: null, renders: null, actionNotes: true, agent: null, chat: { backend: 'agent', baseUrl: null, model: null }, broll: { ...BROLL_DEFAULTS } }; }
export function loadFile() {
  try { const j = JSON.parse(readFileSync(settingsPath(), 'utf8')); const d = defaults(); return { ...d, ...j, chat: { ...d.chat, ...(j.chat || {}) }, broll: { ...d.broll, ...(j.broll || {}), models: { ...((j.broll || {}).models || {}) } } }; }
  catch { return defaults(); }
}
// the file plus the environment, with where each value came from
export function load(env = process.env) {
  const f = loadFile(), from = {};
  const pick = (k, envKey, v) => { if (env[envKey]) { from[k] = 'env ' + envKey; return env[envKey]; } from[k] = v != null ? 'settings' : 'default'; return v; };
  const s = { downloads: pick('downloads', 'STUDIO_DOWNLOADS', f.downloads), renders: pick('renders', 'STUDIO_RENDERS', f.renders), actionNotes: f.actionNotes !== false, agent: AGENT_IDS.includes(f.agent) ? f.agent : null,
    chat: { backend: pick('backend', 'STUDIO_CHAT', f.chat.backend) || 'agent', baseUrl: pick('baseUrl', 'STUDIO_LOCAL_URL', f.chat.baseUrl), model: pick('model', 'STUDIO_MODEL', f.chat.model) },
    broll: { library: pick('brollLibrary', 'STUDIO_BROLL_LIBRARY', f.broll.library), generate: f.broll.generate === true, provider: f.broll.provider || null, models: f.broll.models || {} } };
  if (!BACKENDS.includes(s.chat.backend)) s.chat.backend = 'agent';
  return { ...s, from };
}
const expand = p => p.replace(/^~(?=$|[\\/])/, homedir());
// a folder the user named: must be absolute (or ~), exist or be creatable, and be writable
export function checkFolder(p) {
  if (p == null || p === '') return { ok: true, path: null };
  const abs = expand(String(p).trim());
  if (!isAbsolute(abs)) return { ok: false, error: `use a full path, like ${process.platform === 'win32' ? 'D:\\Reels\\references' : '~/Movies/references'}` };
  try { if (!existsSync(abs)) mkdirSync(abs, { recursive: true }); } catch (e) { return { ok: false, error: `cannot create ${abs}: ${e.code || e.message}` }; }
  try { if (!statSync(abs).isDirectory()) return { ok: false, error: `${abs} is a file, not a folder` }; accessSync(abs, constants.W_OK); } catch (e) { return { ok: false, error: `cannot write to ${abs}: ${e.code || e.message}` }; }
  return { ok: true, path: abs };
}
// { downloads, renders, actionNotes, chat: { backend, baseUrl, model } }; null or '' resets a value to its default
export function update(p) {
  const f = loadFile(), errs = [];
  for (const k of ['downloads', 'renders']) if (p[k] !== undefined) { const c = checkFolder(p[k]); if (!c.ok) errs.push(`${k}: ${c.error}`); else f[k] = c.path; }
  if (p.actionNotes !== undefined) { if (typeof p.actionNotes !== 'boolean') errs.push('actionNotes: true or false'); else f.actionNotes = p.actionNotes; }
  if (p.agent !== undefined) { if (p.agent !== null && !AGENT_IDS.includes(p.agent)) errs.push(`agent: ${AGENT_IDS.join(', ')} or null`); else f.agent = p.agent; }
  if (p.chat) {
    if (p.chat.backend !== undefined) { if (!BACKENDS.includes(p.chat.backend)) errs.push(`chat.backend: ${BACKENDS.join(', ')}`); else f.chat.backend = p.chat.backend; }
    if (p.chat.baseUrl !== undefined) { const u = String(p.chat.baseUrl || '').trim(); if (u && !/^https?:\/\/[^\s]+$/.test(u)) errs.push('chat.baseUrl: an http(s) address, like http://127.0.0.1:11434/v1'); else f.chat.baseUrl = u ? u.replace(/\/$/, '') : null; }
    if (p.chat.model !== undefined) f.chat.model = p.chat.model ? String(p.chat.model).slice(0, 120) : null;
  }
  if (p.broll) {
    const b = p.broll;
    if (b.library !== undefined) { const c = checkFolder(b.library); if (!c.ok) errs.push(`broll.library: ${c.error}`); else f.broll.library = c.path; }
    if (b.generate !== undefined) { if (typeof b.generate !== 'boolean') errs.push('broll.generate: true or false'); else f.broll.generate = b.generate; }
    if (b.provider !== undefined) { if (b.provider !== null && !GEN_IDS.includes(b.provider)) errs.push(`broll.provider: ${GEN_IDS.join(', ')} or null`); else f.broll.provider = b.provider; }
    if (b.models !== undefined) { if (!b.models || typeof b.models !== 'object') errs.push('broll.models: { provider: model }'); else for (const [k, v] of Object.entries(b.models)) { if (!GEN_IDS.includes(k)) errs.push(`broll.models: no provider ${k}`); else if (v && !/^[\w.\-/:@]{1,120}$/.test(String(v))) errs.push(`broll.models.${k}: a model id like owner/name`); else f.broll.models[k] = v ? String(v) : null; } }
  }
  for (const k of Object.keys(p)) if (!['downloads', 'renders', 'chat', 'actionNotes', 'agent', 'broll'].includes(k)) errs.push(`unknown setting "${k}" (downloads, renders, actionNotes, agent, chat, broll)`);
  if (errs.length) return { errs, settings: load() };
  mkdirSync(stateDir(), { recursive: true });
  const tmp = settingsPath() + '.tmp'; writeFileSync(tmp, JSON.stringify(f, null, 2) + '\n'); renameSync(tmp, settingsPath());
  return { errs, settings: load() };
}
