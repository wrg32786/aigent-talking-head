// Generate b-roll with your own provider key (off by default; Settings, "Allow generating"). Every generate shows an
// estimate and waits for a yes on the page; the agent can only ask (fill_slot with generate: true). Results land in
// the b-roll library with the provider, model and prompt, and credits.txt says they were generated.
//
// Adapters use each provider's documented HTTP API:
//   higgsfield  verified (docs.higgsfield.ai): POST https://api.higgsfield.ai/<model> with "Authorization: Key ID:SECRET"
//               returns { request_id, status_url }; GET status_url until completed (video.url or images[].url),
//               failed, nsfw or canceled. POST /estimate/<model> gives { usd } for free. Failed and nsfw are not charged.
//   google      Gemini Omni Flash video, POST /v1beta/interactions (x-goog-api-key). Not verified here: the price
//               (about $0.07 a second at 720p) and the response shape are from the docs page, no live run.
//   openai      gpt-image-2.5 images (POST /v1/images/generations), shown as a slow push-in. Price not verified. The
//               Sora video API closed on 2026-09-24, so OpenAI is images only.
//   replicate   POST /v1/models/<owner>/<name>/predictions with "Prefer: wait"; you name the model. Cost is per model,
//               so the estimate says "see the model page".
//   fal         POST https://queue.fal.run/<model>, poll the status_url; you name the model. Cost as above.
// Stubbed and documented, not wired: Runway (api.dev.runwayml.com, X-Runway-Version), Veo (its preview ended
// 2026-10-22; use Google above), Kling (use it through Higgsfield) and Sora (closed).
// STUDIO_API_BASE_<ID> points an adapter at a mock server (tests).
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as KEYS from './keys.mjs';

const bad = (m, code = 400, x) => Object.assign(new Error(m), { code }, x || {});
export const DEFAULT_MODELS = {
  higgsfield: { video: 'kling-video/v2.5-turbo/pro/text-to-video', image: 'higgsfield-ai/soul/v2/standard' },
  google: { video: 'gemini-omni-1.2-flash' },
  openai: { image: 'gpt-image-2.5-sunburst' },
  replicate: {}, fal: {},
};
export const ADAPTERS = {
  higgsfield: { kinds: ['video', 'image'], verified: true, seconds: [5, 10], note: 'Verified against docs.higgsfield.ai. Estimate is Higgsfield\'s own, free to ask.' },
  google: { kinds: ['video'], verified: false, seconds: [4, 8], note: 'Not verified: no live run; the price and response shape are from Google\'s docs.' },
  openai: { kinds: ['image'], verified: false, note: 'Images only (Sora closed 2026-09-24). Price not verified. Shown as a slow push in.' },
  replicate: { kinds: ['video', 'image'], verified: false, needsModel: true, note: 'You name the model (owner/name). Cost is per model: see its page.' },
  fal: { kinds: ['video', 'image'], verified: false, needsModel: true, note: 'You name the model (for example fal-ai/...). Cost is per model: see its page.' },
};
export const STUBS = {
  runway: 'Runway: documented API (api.dev.runwayml.com, Bearer key, X-Runway-Version 2024-11-06), not wired in this version.',
  veo: 'Veo: the preview API ended 2026-10-22. Use Google (Gemini Omni Flash).',
  kling: 'Kling: use it through Higgsfield (kling-video models).',
  sora: 'Sora: OpenAI closed the video API on 2026-09-24.',
};
export const PROVIDERS = Object.keys(ADAPTERS);
const modelOf = (r, settings) => String(r.model || (settings && settings.broll && settings.broll.models && settings.broll.models[r.provider]) || (DEFAULT_MODELS[r.provider] || {})[r.kind || 'video'] || '').trim();

export function list(settings, env = process.env) {
  return [...PROVIDERS.map(id => ({ id, name: KEYS.byId(id).name, set: KEYS.isSet(id, env), kinds: ADAPTERS[id].kinds, verified: ADAPTERS[id].verified, needsModel: !!ADAPTERS[id].needsModel,
    model: (settings && settings.broll && settings.broll.models && settings.broll.models[id]) || null, defaults: DEFAULT_MODELS[id], seconds: ADAPTERS[id].seconds || null, note: ADAPTERS[id].note })),
    ...Object.entries(STUBS).map(([id, note]) => ({ id, name: id[0].toUpperCase() + id.slice(1), stub: true, note }))];
}
// a request the page or the agent may make: { provider, kind: video|image, prompt, seconds, aspect, model }
export function check(r, settings, env = process.env) {
  if (!r || typeof r !== 'object') throw bad('send { provider, kind, prompt }');
  if (STUBS[r.provider]) throw bad(STUBS[r.provider]);
  const a = ADAPTERS[r.provider]; if (!a) throw bad(`provider: ${PROVIDERS.join(', ')}`);
  const kind = r.kind || a.kinds[0]; if (!a.kinds.includes(kind)) throw bad(`${KEYS.byId(r.provider).name} makes ${a.kinds.join(' or ')} here`);
  if (!String(r.prompt || '').trim()) throw bad('say what to generate (prompt)');
  if (String(r.prompt).length > 1500) throw bad('prompt: 1500 characters at most');
  if (r.aspect && !['9:16', '16:9', '1:1'].includes(r.aspect)) throw bad('aspect: 9:16, 16:9 or 1:1');
  if (!KEYS.isSet(r.provider, env)) throw bad(`Add your ${KEYS.byId(r.provider).name} key in Settings, API keys and providers.`, 400, { needKey: r.provider });
  const model = modelOf({ ...r, kind }, settings); if (!model) throw bad(`name a ${KEYS.byId(r.provider).name} model (owner/name) in Settings or in the request`);
  if (!/^[\w.\-/:]+$/.test(model)) throw bad('that does not look like a model name');
  return { ...r, kind, model, seconds: r.seconds ? +r.seconds : (a.seconds ? a.seconds[0] : null), aspect: r.aspect || '9:16' };
}
const base = id => KEYS.baseOf(KEYS.byId(id));
const hfBody = q => ({ prompt: q.prompt, ...(q.kind === 'video' ? { duration: q.seconds >= 10 ? 10 : 5, aspect_ratio: q.aspect } : { aspect_ratio: q.aspect, resolution: '1080p' }) });
async function jfetch(url, o, key, fetchImpl) {
  const r = await fetchImpl(url, o); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw bad(r.status === 401 || r.status === 403 ? 'The provider did not accept the key. Check it in Settings.' : r.status === 402 ? 'The provider says the account is out of credits (402).' : r.status === 429 ? 'The provider says too many requests (429).' : `The provider answered ${r.status}: ${KEYS.scrub((j && (j.detail || j.error && (j.error.message || j.error))) || t, key)}`, 502);
  return j || {};
}
// what it would cost, from the provider when it says (Higgsfield), else a stated rule or "unknown"
export async function estimate(r, settings, { env = process.env, fetchImpl = fetch } = {}) {
  const q = check(r, settings, env), key = KEYS.get(q.provider, env);
  if (q.provider === 'higgsfield') {
    const j = await jfetch(`${base('higgsfield')}/estimate/${q.model}`, { method: 'POST', headers: { Authorization: 'Key ' + key, 'content-type': 'application/json' }, body: JSON.stringify(hfBody(q)) }, key, fetchImpl);
    return { provider: q.provider, model: q.model, kind: q.kind, seconds: q.seconds, usd: j.usd != null ? +j.usd : null, from: 'Higgsfield estimate', verified: true };
  }
  if (q.provider === 'google') return { provider: q.provider, model: q.model, kind: q.kind, seconds: q.seconds, usd: +(0.07 * (q.seconds || 4)).toFixed(2), from: 'about $0.07 a second at 720p (Google pricing page; not verified)', verified: false };
  if (q.provider === 'openai') return { provider: q.provider, model: q.model, kind: q.kind, usd: null, from: 'per image, see OpenAI pricing (not verified)', verified: false };
  return { provider: q.provider, model: q.model, kind: q.kind, usd: null, from: `per model: see the model's page on ${KEYS.byId(q.provider).name}`, verified: false };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function download(url, out, fetchImpl) { const r = await fetchImpl(url); if (!r.ok || !r.body) throw bad(`download failed (${r.status})`, 502); await pipeline(Readable.fromWeb(r.body), createWriteStream(out)); return out; }
// a still into a short clip with a slow push in, so a generated picture can sit in the lane like video
export function stillToVideo(img, out, seconds = 4, aspect = '9:16') {
  const [w, h] = aspect === '16:9' ? [1920, 1080] : aspect === '1:1' ? [1080, 1080] : [1080, 1920], n = Math.round(seconds * 24);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '24', '-t', String(seconds), '-i', img, '-vf', `scale=${Math.round(w * 1.1)}:${Math.round(h * 1.1)}:force_original_aspect_ratio=increase,crop=${Math.round(w * 1.1)}:${Math.round(h * 1.1)},zoompan=z='1+0.08*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=24,format=yuv420p`, '-c:v', 'libx264', '-crf', '20', '-an', out], { stdio: 'ignore' });
  if (r.status !== 0) throw bad('could not turn the picture into a clip (ffmpeg)', 500); return out;
}
// run one generate (the caller has the user's yes). Resolves { file, provider, model, prompt, kind }.
export async function run(r, settings, { env = process.env, fetchImpl = fetch, onStatus = () => {}, pollMs = 4000, timeoutMs = 15 * 60e3 } = {}) {
  const q = check(r, settings, env), key = KEYS.get(q.provider, env), dir = join(tmpdir(), 'studio-gen'); mkdirSync(dir, { recursive: true });
  const id = randomBytes(4).toString('hex'), t0 = Date.now(); let url = null, b64 = null, isImage = q.kind === 'image';
  try {
    if (q.provider === 'higgsfield') {
      const h = { Authorization: 'Key ' + key, 'content-type': 'application/json', 'Idempotency-Key': r.id || id };
      const j = await jfetch(`${base('higgsfield')}/${q.model}`, { method: 'POST', headers: h, body: JSON.stringify(hfBody(q)) }, key, fetchImpl);
      const su = j.status_url || `${base('higgsfield')}/requests/${j.request_id}/status`;
      for (;;) {
        const s = await jfetch(su, { headers: { Authorization: 'Key ' + key } }, key, fetchImpl); onStatus(s.status);
        if (s.status === 'completed') { url = (s.video && s.video.url) || (s.images && s.images[0] && s.images[0].url); break; }
        if (['failed', 'nsfw', 'canceled'].includes(s.status)) throw bad(s.status === 'nsfw' ? 'Higgsfield refused the prompt (nsfw). Not charged.' : `Higgsfield: ${s.status}${s.status === 'failed' ? ' (not charged)' : ''}`, 502);
        if (Date.now() - t0 > timeoutMs) throw bad('Higgsfield is still working after 15 minutes; it may finish later (outputs keep 7 days)', 504);
        await sleep(pollMs);
      }
    } else if (q.provider === 'google') {
      const j = await jfetch(`${base('google')}/v1beta/interactions`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ model: q.model, input: [{ type: 'text', text: q.prompt }], output: { type: 'video', duration_seconds: q.seconds, aspect_ratio: q.aspect, resolution: '720p' } }) }, key, fetchImpl);
      const part = (j.steps || j.outputs || []).flatMap(s => s.content || [s]).find(c => c && (c.video || c.data || c.uri));
      if (!part) throw bad('Google answered without a video (polling long jobs is not verified in this version)', 502);
      b64 = part.data || (part.video && part.video.data) || null; url = part.uri || (part.video && part.video.uri) || null;
    } else if (q.provider === 'openai') {
      const j = await jfetch(`${base('openai')}/v1/images/generations`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model: q.model, prompt: q.prompt, size: q.aspect === '16:9' ? '1536x1024' : q.aspect === '1:1' ? '1024x1024' : '1024x1536', n: 1 }) }, key, fetchImpl);
      const d = (j.data || [])[0] || {}; b64 = d.b64_json || null; url = d.url || null; isImage = true;
    } else if (q.provider === 'replicate') {
      const [owner, name] = q.model.split('/'); if (!owner || !name) throw bad('Replicate model: owner/name');
      let j = await jfetch(`${base('replicate')}/v1/models/${owner}/${name}/predictions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json', Prefer: 'wait' }, body: JSON.stringify({ input: { prompt: q.prompt, aspect_ratio: q.aspect, ...(q.seconds && q.kind === 'video' ? { duration: q.seconds } : {}) } }) }, key, fetchImpl);
      while (!['succeeded', 'failed', 'canceled'].includes(j.status)) { if (Date.now() - t0 > timeoutMs) throw bad('Replicate timed out', 504); await sleep(pollMs); j = await jfetch(j.urls.get, { headers: { Authorization: 'Bearer ' + key } }, key, fetchImpl); onStatus(j.status); }
      if (j.status !== 'succeeded') throw bad(`Replicate: ${j.status}`, 502); url = Array.isArray(j.output) ? j.output[0] : j.output;
    } else if (q.provider === 'fal') {
      const h = { Authorization: 'Key ' + key, 'content-type': 'application/json' };
      const j = await jfetch(`${base('fal')}/${q.model}`, { method: 'POST', headers: h, body: JSON.stringify({ prompt: q.prompt, aspect_ratio: q.aspect, ...(q.seconds && q.kind === 'video' ? { duration: String(q.seconds) } : {}) }) }, key, fetchImpl);
      for (;;) { const s = await jfetch(j.status_url, { headers: h }, key, fetchImpl); onStatus(s.status); if (s.status === 'COMPLETED') break; if (Date.now() - t0 > timeoutMs) throw bad('fal timed out', 504); await sleep(pollMs); }
      const o = await jfetch(j.response_url, { headers: h }, key, fetchImpl); url = (o.video && o.video.url) || (o.images && o.images[0] && o.images[0].url) || (o.image && o.image.url);
    }
    if (!url && !b64) throw bad('the provider finished without a file', 502);
    if (url && !/^https?:\/\//.test(url)) throw bad('the provider sent a file link that is not http(s)', 502);
    const looksImg = isImage || (url && /\.(png|jpe?g|webp)(\?|$)/i.test(url));
    const raw = join(dir, `${id}${looksImg ? '.png' : '.mp4'}`);
    if (b64) writeFileSync(raw, Buffer.from(b64, 'base64')); else await download(url, raw, fetchImpl);
    const file = looksImg ? stillToVideo(raw, join(dir, `${id}.mp4`), Math.min(6, Math.max(3, q.seconds || 4)), q.aspect) : raw;
    return { file, provider: q.provider, model: q.model, prompt: q.prompt, kind: q.kind };
  } catch (e) { e.message = KEYS.scrub(e.message, key); throw e; }
}
