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
// default), models: { higgsfield, google, openai, replicate, fal } the model each provider uses, auto: b-roll picks
// itself after each draft (null means on, unless STUDIO_BROLL_AUTO=0) }
export const BROLL_DEFAULTS = { library: null, generate: false, provider: null, models: {}, auto: null };
// post: the Post step (kit/studio/post.mjs). host: r2 | cloudinary | url; r2 and cloudinary hold only what is not secret
// (the keys live in keys.json); channels: the Buffer channel ids picked last time; youtubeCategory: the Shorts category id
export const POST_DEFAULTS = { host: null, r2: { account: null, bucket: null, publicBase: null, prefix: null }, cloudinary: { cloud: null, preset: null, folder: null }, channels: [], youtubeCategory: '22' };
const postOf = j => { const p = (j && j.post) || {}; return { ...POST_DEFAULTS, ...p, r2: { ...POST_DEFAULTS.r2, ...(p.r2 || {}) }, cloudinary: { ...POST_DEFAULTS.cloudinary, ...(p.cloudinary || {}) }, channels: Array.isArray(p.channels) ? p.channels : [] }; };
export function defaults() { return { downloads: null, renders: null, actionNotes: true, agent: null, chat: { backend: 'agent', baseUrl: null, model: null }, broll: { ...BROLL_DEFAULTS }, post: postOf({}) }; }
export function loadFile() {
  try { const j = JSON.parse(readFileSync(settingsPath(), 'utf8')); const d = defaults(); return { ...d, ...j, chat: { ...d.chat, ...(j.chat || {}) }, broll: { ...d.broll, ...(j.broll || {}), models: { ...((j.broll || {}).models || {}) } }, post: postOf(j) }; }
  catch { return defaults(); }
}
// the file plus the environment, with where each value came from
export function load(env = process.env) {
  const f = loadFile(), from = {};
  const pick = (k, envKey, v) => { if (env[envKey]) { from[k] = 'env ' + envKey; return env[envKey]; } from[k] = v != null ? 'settings' : 'default'; return v; };
  const s = { downloads: pick('downloads', 'STUDIO_DOWNLOADS', f.downloads), renders: pick('renders', 'STUDIO_RENDERS', f.renders), actionNotes: f.actionNotes !== false, agent: AGENT_IDS.includes(f.agent) ? f.agent : null,
    chat: { backend: pick('backend', 'STUDIO_CHAT', f.chat.backend) || 'agent', baseUrl: pick('baseUrl', 'STUDIO_LOCAL_URL', f.chat.baseUrl), model: pick('model', 'STUDIO_MODEL', f.chat.model) },
    broll: { library: pick('brollLibrary', 'STUDIO_BROLL_LIBRARY', f.broll.library), generate: f.broll.generate === true, provider: f.broll.provider || null, models: f.broll.models || {}, auto: typeof f.broll.auto === 'boolean' ? f.broll.auto : null }, post: postOf(f) };
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
    if (b.auto !== undefined) { if (b.auto !== null && typeof b.auto !== 'boolean') errs.push('broll.auto: true, false or null'); else f.broll.auto = b.auto; }
    if (b.generate !== undefined) { if (typeof b.generate !== 'boolean') errs.push('broll.generate: true or false'); else f.broll.generate = b.generate; }
    if (b.provider !== undefined) { if (b.provider !== null && !GEN_IDS.includes(b.provider)) errs.push(`broll.provider: ${GEN_IDS.join(', ')} or null`); else f.broll.provider = b.provider; }
    if (b.models !== undefined) { if (!b.models || typeof b.models !== 'object') errs.push('broll.models: { provider: model }'); else for (const [k, v] of Object.entries(b.models)) { if (!GEN_IDS.includes(k)) errs.push(`broll.models: no provider ${k}`); else if (v && !/^[\w.\-/:@]{1,120}$/.test(String(v))) errs.push(`broll.models.${k}: a model id like owner/name`); else f.broll.models[k] = v ? String(v) : null; } }
  }
  if (p.post) {
    const q = p.post, o = f.post = postOf(f), str = (v, re, max = 200) => v == null || v === '' ? null : re.test(String(v).trim()) ? String(v).trim().slice(0, max) : undefined;
    if (q.host !== undefined) { if (q.host !== null && !['r2', 'cloudinary', 'url'].includes(q.host)) errs.push('post.host: r2, cloudinary, url or null'); else o.host = q.host; }
    if (q.r2) {
      const r = q.r2;
      if (r.account !== undefined) { const v = str(r.account, /^[a-f0-9]{32}$/i); if (v === undefined) errs.push('post.r2.account: the 32-character account ID from the Cloudflare dashboard'); else o.r2.account = v; }
      if (r.bucket !== undefined) { const v = str(r.bucket, /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/); if (v === undefined) errs.push('post.r2.bucket: lowercase letters, numbers and dashes'); else o.r2.bucket = v; }
      if (r.publicBase !== undefined) { const v = str(r.publicBase, /^https:\/\/[^\s?#]+$/); if (v === undefined) errs.push('post.r2.publicBase: the bucket\'s public https:// address (r2.dev or your own domain)'); else o.r2.publicBase = v ? v.replace(/\/$/, '') : null; }
      if (r.prefix !== undefined) { const v = str(r.prefix, /^[\w./-]{1,80}$/); if (v === undefined) errs.push('post.r2.prefix: a folder name like reels'); else o.r2.prefix = v; }
    }
    if (q.cloudinary) {
      const c = q.cloudinary;
      if (c.cloud !== undefined) { const v = str(c.cloud, /^[\w-]{1,80}$/); if (v === undefined) errs.push('post.cloudinary.cloud: your cloud name'); else o.cloudinary.cloud = v; }
      if (c.preset !== undefined) { const v = str(c.preset, /^[\w-]{1,80}$/); if (v === undefined) errs.push('post.cloudinary.preset: an upload preset name'); else o.cloudinary.preset = v; }
      if (c.folder !== undefined) { const v = str(c.folder, /^[\w./-]{1,80}$/); if (v === undefined) errs.push('post.cloudinary.folder: a folder name like reels'); else o.cloudinary.folder = v; }
    }
    if (q.channels !== undefined) { if (!Array.isArray(q.channels)) errs.push('post.channels: a list of Buffer channel ids'); else o.channels = q.channels.map(String).filter(x => /^[\w-]{1,64}$/.test(x)).slice(0, 30); }
    if (q.youtubeCategory !== undefined) { if (!/^\d{1,3}$/.test(String(q.youtubeCategory))) errs.push('post.youtubeCategory: a YouTube category id like 22'); else o.youtubeCategory = String(q.youtubeCategory); }
  }
  for (const k of Object.keys(p)) if (!['downloads', 'renders', 'chat', 'actionNotes', 'agent', 'broll', 'post'].includes(k)) errs.push(`unknown setting "${k}" (downloads, renders, actionNotes, agent, chat, broll, post)`);
  if (errs.length) return { errs, settings: load() };
  mkdirSync(stateDir(), { recursive: true });
  const tmp = settingsPath() + '.tmp'; writeFileSync(tmp, JSON.stringify(f, null, 2) + '\n'); renameSync(tmp, settingsPath());
  return { errs, settings: load() };
}
