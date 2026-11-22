import { refContext } from './core.mjs';
import { HUMANIZER_RULES, SCRIPT_FORMAT } from './scripts.mjs';
// Fallback chat backends for Studio, when no terminal agent answers the page chat (the default backend, see
// kit/studio/channel.mjs). Pick one in Studio's settings or with STUDIO_CHAT:
//   anthropic  ANTHROPIC_API_KEY, model STUDIO_MODEL (default claude-sonnet-4-5), ANTHROPIC_BASE_URL for a compatible server
//   openai     OPENAI_API_KEY, model STUDIO_MODEL (default gpt-4o-mini), OPENAI_BASE_URL for a compatible server
//   local      any OpenAI-compatible server on your computer: Ollama (http://127.0.0.1:11434/v1), LM Studio
//              (http://127.0.0.1:1234/v1), llama.cpp server (http://127.0.0.1:8080/v1). No key needed (LOCAL_LLM_API_KEY if yours asks).
//   auto       an API key if one is set, otherwise keywords
// A chat line goes out with the menu, the session and the reference teardown; the reply comes back as a short answer
// plus a Studio patch, checked against the engine's names before it is applied. Keys are read from the environment
// only and never written anywhere.
export function provider(env = process.env, chat = null) {
  const backend = (chat && chat.backend) || env.STUDIO_CHAT || 'auto', model = (chat && chat.model) || env.STUDIO_MODEL;
  const anthropic = () => env.ANTHROPIC_API_KEY ? { name: 'anthropic', model: model || 'claude-sonnet-4-5', base: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''), key: env.ANTHROPIC_API_KEY } : null;
  const openai = () => env.OPENAI_API_KEY ? { name: 'openai', model: model || 'gpt-4o-mini', base: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''), key: env.OPENAI_API_KEY } : null;
  if (backend === 'anthropic') return anthropic();
  if (backend === 'openai') return openai();
  if (backend === 'local') return { name: 'local', model: model || null, base: ((chat && chat.baseUrl) || env.STUDIO_LOCAL_URL || 'http://127.0.0.1:11434/v1').replace(/\/$/, ''), key: env.LOCAL_LLM_API_KEY || null };
  if (backend === 'auto') return anthropic() || openai();
  return null;
}
// the models a local (or OpenAI-compatible) server offers, for the model picker
export async function models(base, key) {
  const r = await fetch(String(base).replace(/\/$/, '') + '/models', { headers: key ? { authorization: 'Bearer ' + key } : {}, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${base} answered ${r.status}`);
  const j = await r.json();
  return (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
}

export function systemPrompt(state, cat, scripts = []) {
  const byKind = {};
  for (const it of Object.values(cat.items)) if (it.mode !== 'info') (byKind[it.kind] = byKind[it.kind] || []).push(it.id);
  const menu = Object.entries(byKind).map(([k, ids]) => `${k}: ${ids.join(', ')}`).join('\n');
  const ref = refContext(state);
  const session = { pack: state.pack, picks: state.picks, music: state.music, sound: state.sound, pace: state.pace, export: state.export };
  return [
    'You are the video editor inside AIgent Studio, a local talking-head reel editor. The user tells you a vibe or asks for effects; you change the session by returning a patch.',
    'Reply with one JSON object only: {"reply": "one or two plain sentences to the user, no em dashes", "patch": {...}}.',
    'Patch fields (all optional): "pack": one of ' + cat.packs.map(p => p.name).join(', ') + ' or null; "picks": {"<kind>:<id>": "allow" | "deny" | "clear"}; "clearPicks": true; "music": {"bed": "auto" | "none" | a bed id, "energy": "auto" | "low" | "mid" | "high"}; "sound": {"sfx": "on" | "off", "cap": "on" | "off"}; "pace": {"tighten": null | "off" | seconds 0.1 to 2, "punch": "on" | "off"}; "export": ' + cat.exports.join(' | ') + '.',
    'allow on a transition, title entrance, graphic, finish or effect means only allowed ones may be used; deny forbids one. Kinds captionStyle, captionEntrance, look, theme, titleLayer, bed and beatSync take one allow. Use only names from this menu; never invent one:',
    menu,
    'Music beds: ' + cat.beds.map(b => `${b.id} (${b.energy})`).join(', '),
    'Current session: ' + JSON.stringify(session),
    state.point ? `The point of this video, in the user's words: "${state.point}". Let it guide what you pick and write.` : '',
    ref.active ? 'Reference teardown (what the reel the user linked or uploaded does; "the reference" means this one; its suggestions are menu refs you may use in picks): ' + JSON.stringify(ref.active) : 'No reference has been broken down yet.',
    ref.active && ['recreate', 'look'].includes(ref.mode) ? 'The look of this video comes from the reference (' + (ref.mode === 'recreate' ? 'Recreate' : 'Copy the look') + '). The picks in the current session are the reference\'s or ones the user made after it. Change a pick only when the user asks for it now; never bring back a style from an earlier video.' : '',
    ref.others.length ? 'Other references in the queue: ' + JSON.stringify(ref.others) : '',
    'Scripts: when the user asks you to write or rewrite a script (what they will say on camera), also return "script": {"id": "<an existing id to replace it, or leave out for a new one>", "title": "...", "text": "..."}. ' + SCRIPT_FORMAT + ' When asked for one from the reference, follow its hook, shot count, pacing and beat times. Write it so it sounds human: ' + HUMANIZER_RULES.join(' '),
    scripts.length ? 'Saved scripts: ' + JSON.stringify(scripts.slice(0, 12).map(x => ({ id: x.id, title: x.title, words: x.words, seconds: x.seconds }))) : '',
  ].filter(Boolean).join('\n');
}

export function parseReply(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return { reply: String(text || '').trim().slice(0, 1000), patch: {} };
  try { const j = JSON.parse(m[0]); return { reply: String(j.reply || '').replace(/\u2014/g, ', '), patch: j.patch && typeof j.patch === 'object' ? j.patch : {}, ...(j.script && typeof j.script === 'object' && typeof j.script.text === 'string' ? { script: j.script } : {}) }; }
  catch { return { reply: String(text).trim().slice(0, 1000), patch: {} }; }
}

export async function chat(text, state, cat, env = process.env, chatSettings = null, scripts = []) {
  const p = provider(env, chatSettings);
  if (!p) throw new Error('no chat backend: set ANTHROPIC_API_KEY or OPENAI_API_KEY, or pick a local model in Studio settings');
  const sys = systemPrompt(state, cat, scripts);
  const history = (state.chat || []).filter(m => m.kind !== 'action').slice(-8).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text }));
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), p.name === 'local' ? 180e3 : 60e3);
  try {
    let out;
    if (p.name === 'anthropic') {
      const r = await fetch(p.base + '/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: p.model, max_tokens: 1600, system: sys, messages: [...history, { role: 'user', content: text }] }) });
      const j = await r.json(); if (!r.ok) throw new Error(`anthropic ${r.status}: ${(j.error && j.error.message) || 'request failed'}`);
      out = (j.content || []).map(c => c.text || '').join('');
    } else {
      let model = p.model;
      if (!model && p.name === 'local') { const ms = await models(p.base, p.key).catch(() => []); model = ms[0]; if (!model) throw new Error(`no model found at ${p.base}; start your local server and pull a model`); }
      const send = json => fetch(p.base + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', ...(p.key ? { authorization: 'Bearer ' + p.key } : {}) },
        body: JSON.stringify({ model, ...(json ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'system', content: sys }, ...history, { role: 'user', content: text }] }) });
      let r = await send(true);
      if (!r.ok && p.name === 'local' && r.status >= 400 && r.status < 500) r = await send(false); // some local servers refuse response_format
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p.name} ${r.status}: ${(j.error && (j.error.message || j.error)) || 'request failed'}`);
      out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      p.model = model;
    }
    return { ...parseReply(out), provider: p.name, model: p.model };
  } finally { clearTimeout(timer); }
}

// one plain request to the picked backend (system + user text in, text out), for jobs like scoring cuts and
// adapting a script; the same keys and servers as the chat
export async function complete(system, user, env = process.env, chatSettings = null, { maxTokens = 2000, json = true } = {}) {
  const p = provider(env, chatSettings);
  if (!p) throw new Error('no model backend: set ANTHROPIC_API_KEY or OPENAI_API_KEY, or pick a local model in Studio settings');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), p.name === 'local' ? 300e3 : 90e3);
  try {
    if (p.name === 'anthropic') {
      const r = await fetch(p.base + '/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: p.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }) });
      const j = await r.json(); if (!r.ok) throw new Error(`anthropic ${r.status}: ${(j.error && j.error.message) || 'request failed'}`);
      return { text: (j.content || []).map(c => c.text || '').join(''), provider: p.name, model: p.model };
    }
    let model = p.model;
    if (!model && p.name === 'local') { const ms = await models(p.base, p.key).catch(() => []); model = ms[0]; if (!model) throw new Error(`no model found at ${p.base}`); }
    const send = fmt => fetch(p.base + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', ...(p.key ? { authorization: 'Bearer ' + p.key } : {}) },
      body: JSON.stringify({ model, ...(fmt ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    let r = await send(json);
    if (!r.ok && json && p.name === 'local' && r.status >= 400 && r.status < 500) r = await send(false);
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p.name} ${r.status}: ${(j.error && (j.error.message || j.error)) || 'request failed'}`);
    return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', provider: p.name, model };
  } finally { clearTimeout(timer); }
}
