// API keys and providers for b-roll (Settings, "API keys and providers"). Keys stay on this computer: an environment
// variable wins, else jobs/.studio/keys.json (or STUDIO_DIR), which git ignores and is written owner-only (chmod 600).
// A key is never logged, never sent to the page (the page sees set / not set and where it came from) and never given
// to the agent (the MCP tool broll_providers says only whether each one is set).
//
// Test key calls each provider's own documented endpoint. For the tests, STUDIO_API_BASE_<ID> (for example
// STUDIO_API_BASE_PEXELS=http://127.0.0.1:9999) points a provider at a mock server.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const stateDir = () => resolve(process.env.STUDIO_DIR || join(ROOT, 'jobs', '.studio'));
export const keysPath = () => join(stateDir(), 'keys.json');

// what each key is for, where to get it, its env names and the documented call Test key makes
export const PROVIDERS = [
  { id: 'pexels', name: 'Pexels', group: 'stock', for: 'Free stock video for b-roll', env: ['PEXELS_API_KEY'], base: 'https://api.pexels.com', get: 'https://www.pexels.com/api/', docs: 'https://www.pexels.com/api/documentation/', free: true,
    test: { method: 'GET', path: '/v1/videos/search?query=office&per_page=1', auth: k => ({ Authorization: k }) } },
  { id: 'pixabay', name: 'Pixabay', group: 'stock', for: 'Free stock video for b-roll', env: ['PIXABAY_API_KEY'], base: 'https://pixabay.com', get: 'https://pixabay.com/api/docs/', docs: 'https://pixabay.com/api/docs/#api_search_videos', free: true,
    test: { method: 'GET', path: k => `/api/videos/?key=${encodeURIComponent(k)}&q=office&per_page=3`, auth: () => ({}) } },
  { id: 'higgsfield', name: 'Higgsfield', group: 'generate', for: 'Generate b-roll video and images (paid)', env: ['HF_API_KEY_ID', 'HF_API_KEY_SECRET'], pair: ['Key ID', 'Key secret'], base: 'https://api.higgsfield.ai', get: 'https://console.higgsfield.ai', docs: 'https://docs.higgsfield.ai/docs/authentication',
    // the estimate endpoint is free and needs a valid key (docs: Billing and retention)
    test: { method: 'POST', path: '/estimate/higgsfield-ai/soul/v2/standard', body: { prompt: 'key check' }, auth: k => ({ Authorization: 'Key ' + k }) } },
  { id: 'openai', name: 'OpenAI', group: 'generate', for: 'Generate b-roll images (paid); the Studio chat too', env: ['OPENAI_API_KEY'], base: 'https://api.openai.com', get: 'https://platform.openai.com/api-keys', docs: 'https://platform.openai.com/docs/api-reference/models/list',
    test: { method: 'GET', path: '/v1/models', auth: k => ({ Authorization: 'Bearer ' + k }) } },
  { id: 'anthropic', name: 'Anthropic', group: 'text', for: 'B-roll ideas per beat and the Studio chat (text only, no images or video)', env: ['ANTHROPIC_API_KEY'], base: 'https://api.anthropic.com', get: 'https://console.anthropic.com/settings/keys', docs: 'https://docs.anthropic.com/en/api/models-list',
    test: { method: 'GET', path: '/v1/models', auth: k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) } },
  { id: 'google', name: 'Google (Gemini)', group: 'generate', for: 'Generate b-roll video with Gemini Omni Flash (paid)', env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], any: true, base: 'https://generativelanguage.googleapis.com', get: 'https://aistudio.google.com/apikey', docs: 'https://ai.google.dev/api/models',
    test: { method: 'GET', path: '/v1beta/models?pageSize=1', auth: k => ({ 'x-goog-api-key': k }) } },
  { id: 'replicate', name: 'Replicate', group: 'generate', for: 'Generate b-roll with a model you pick on Replicate (paid)', env: ['REPLICATE_API_TOKEN'], base: 'https://api.replicate.com', get: 'https://replicate.com/account/api-tokens', docs: 'https://replicate.com/docs/reference/http#account.get',
    test: { method: 'GET', path: '/v1/account', auth: k => ({ Authorization: 'Bearer ' + k }) } },
  { id: 'fal', name: 'fal', group: 'generate', for: 'Generate b-roll with a model you pick on fal (paid)', env: ['FAL_KEY'], base: 'https://queue.fal.run', get: 'https://fal.ai/dashboard/keys', docs: 'https://docs.fal.ai/model-apis/model-endpoints/queue',
    test: null }, // fal documents no key-check endpoint, so Test key says so instead of spending a request
  // Posting (the Post step, kit/studio/post.mjs): your own Buffer key, and where the video is hosted so Buffer can fetch it
  { id: 'buffer', name: 'Buffer', group: 'post', for: 'Send reels to Buffer as drafts or scheduled posts (your account, every plan)', env: ['BUFFER_API_KEY'], base: 'https://api.buffer.com', get: 'https://publish.buffer.com/settings/api', docs: 'https://developers.buffer.com/guides/getting-started.html', free: true,
    test: { run: async (key, o) => (await import('./post.mjs')).testBuffer(key, o) } },
  { id: 'r2', name: 'Cloudflare R2', group: 'post', for: 'Host the video for Buffer in your R2 bucket (an R2 API token with Object Read and Write)', env: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'], pair: ['Access key ID', 'Secret access key'], base: 'https://r2.cloudflarestorage.com', get: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens', docs: 'https://developers.cloudflare.com/r2/api/s3/api/',
    test: { run: async (key, o) => (await import('./post.mjs')).testHost('r2', o) } },
  { id: 'cloudinary', name: 'Cloudinary', group: 'post', for: 'Host the video for Buffer on Cloudinary (API key and secret; or only an unsigned upload preset in the Post step)', env: ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], pair: ['API key', 'API secret'], base: 'https://api.cloudinary.com', get: 'https://console.cloudinary.com/settings/api-keys', docs: 'https://cloudinary.com/documentation/upload_images#uploading_with_a_direct_call_to_the_rest_api',
    test: { run: async (key, o) => (await import('./post.mjs')).testHost('cloudinary', o) } },
];
export const byId = id => PROVIDERS.find(p => p.id === id);
export const baseOf = (p, env = process.env) => (env['STUDIO_API_BASE_' + p.id.toUpperCase()] || p.base).replace(/\/$/, '');

function readFile() { try { const j = JSON.parse(readFileSync(keysPath(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function writeFile(j) {
  mkdirSync(stateDir(), { recursive: true });
  const f = keysPath(), tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 }); try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, f); try { chmodSync(f, 0o600); } catch {}
}
// the key for a provider (env first), or null. Higgsfield is "KEY_ID:KEY_SECRET".
export function get(id, env = process.env) {
  const p = byId(id); if (!p) return null;
  if (p.pair) { const [a, b] = p.env; if (env[a] && env[b]) return `${env[a]}:${env[b]}`; }
  else for (const e of p.env) if (env[e]) return env[e];
  const v = readFile()[id]; return typeof v === 'string' && v ? v : null;
}
const fromOf = (p, env) => { if (p.pair ? p.env.every(e => env[e]) : p.env.some(e => env[e])) return 'env ' + (p.pair ? p.env.join(' and ') : p.env.find(e => env[e])); return readFile()[p.id] ? 'settings' : null; };
// what the page and the agent may see: never a value
export function status(env = process.env) {
  const tests = readFile()._tests || {};
  return PROVIDERS.map(p => { const from = fromOf(p, env); return { id: p.id, name: p.name, group: p.group, for: p.for, env: p.env, pair: p.pair || null, get: p.get, docs: p.docs, free: !!p.free,
    set: !!from, from, canTest: !!p.test, tested: tests[p.id] || null }; });
}
export const isSet = (id, env) => !!get(id, env);
// save or remove a key in keys.json (an env key still wins; the page says so)
export function save(id, value) {
  const p = byId(id); if (!p) throw Object.assign(new Error(`no provider ${id}`), { code: 404 });
  const j = readFile();
  if (value == null || value === '') { delete j[id]; if (j._tests) delete j._tests[id]; writeFile(j); return status(); }
  let v = String(value).trim();
  if (p.pair && typeof value === 'object') v = `${String(value.id || '').trim()}:${String(value.secret || '').trim()}`;
  if (p.pair && !/^[^:\s]+:[^:\s]+$/.test(v)) throw Object.assign(new Error(`${p.name} needs the ${p.pair[0]} and the ${p.pair[1]}`), { code: 400 });
  if (!v || /\s/.test(v) || v.length > 400) throw Object.assign(new Error('that does not look like a key'), { code: 400 });
  j[id] = v; if (j._tests) delete j._tests[id]; writeFile(j); return status();
}
// a provider's message without the key in it
export const scrub = (msg, key) => { let m = String(msg || ''); if (key) for (const part of [key, ...key.split(':')]) if (part && part.length > 3) m = m.split(part).join('[key]'); return m.slice(0, 300); };
// Test key: one documented, free call; ok, or the provider's status and a plain reason
export async function test(id, { env = process.env, fetchImpl = fetch, value } = {}) {
  const p = byId(id); if (!p) throw Object.assign(new Error(`no provider ${id}`), { code: 404 });
  const key = value || get(id, env); if (!key) return { ok: false, error: 'No key set.' };
  if (!p.test) return { ok: null, note: `${p.name} has no documented key check, so the key is saved but not tested. A generate shows any key error.` };
  const t = p.test, path = typeof t.path === 'function' ? t.path(key) : t.path;
  let r, res;
  if (t.run) { try { r = await t.run(key, { env, fetchImpl }); } catch (e) { r = { ok: false, error: scrub(e.message, key) }; } }
  else try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    res = await fetchImpl(baseOf(p, env) + path, { method: t.method, headers: { ...t.auth(key), ...(t.body ? { 'content-type': 'application/json' } : {}) }, body: t.body ? JSON.stringify(t.body) : undefined, signal: ctl.signal });
    clearTimeout(timer);
    r = res.ok ? { ok: true, note: `${p.name} accepted the key.` }
      : { ok: false, status: res.status, error: res.status === 401 || res.status === 403 ? `${p.name} says the key is not valid (${res.status}).` : res.status === 429 ? `${p.name} says too many requests (429). Try again in a minute.` : `${p.name} answered ${res.status}: ${scrub(await res.text().catch(() => ''), key)}` };
  } catch (e) { r = { ok: false, error: `Could not reach ${p.name}: ${scrub(e.name === 'AbortError' ? 'timed out' : e.message, key)}` }; }
  if (!value) { const j = readFile(); j._tests = { ...(j._tests || {}), [id]: { ok: r.ok, at: new Date().toISOString() } }; if (j[id] || fromOf(p, env)) writeFile(j); }
  return r;
}
// the environment plus saved keys, for the chat's model calls (an env value wins)
export function envWithKeys(env = process.env) {
  const out = { ...env };
  for (const [id, name] of [['openai', 'OPENAI_API_KEY'], ['anthropic', 'ANTHROPIC_API_KEY']]) if (!out[name]) { const v = readFile()[id]; if (v) out[name] = v; }
  return out;
}
// the reference's descriptions (rea-video --vlm, a vision model reading each shot): the keys for it, from the
// environment or Studio's saved keys, as the env rea-video reads. null when there is no vision key. A Gemini key goes
// in as is; an OpenAI key as an OpenAI-compatible server (gpt-4o-mini, STUDIO_VLM_MODEL to change it). Keys stay on
// this computer: they only go to the teardown process.
export function vlmEnv(env = process.env) {
  if (env.REA_VLM_API_KEY && env.REA_VLM_BASE_URL) return {};
  const g = get('google', env); if (g) return { GEMINI_API_KEY: g };
  const o = get('openai', env); if (o) return { REA_VLM_BASE_URL: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''), REA_VLM_API_KEY: o, REA_VLM_MODEL: env.STUDIO_VLM_MODEL || 'gpt-4o-mini' };
  return null;
}
export const fileExists = () => existsSync(keysPath());
