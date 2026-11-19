// Optional direct chat for Studio: when ANTHROPIC_API_KEY or OPENAI_API_KEY is set in the environment, a chat line goes
// to that API with the menu and the session, and the reply comes back as a short answer plus a Studio patch (the same
// patch the page and the MCP tools send, checked against the engine's names before it is applied).
// Keys are read from the environment only and never written anywhere. STUDIO_MODEL picks the model;
// ANTHROPIC_BASE_URL and OPENAI_BASE_URL point at a compatible endpoint (or a local test server).
export function provider(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return { name: 'anthropic', model: env.STUDIO_MODEL || 'claude-sonnet-4-5', base: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '') };
  if (env.OPENAI_API_KEY) return { name: 'openai', model: env.STUDIO_MODEL || 'gpt-4o-mini', base: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') };
  return null;
}

export function systemPrompt(state, cat) {
  const byKind = {};
  for (const it of Object.values(cat.items)) if (it.mode !== 'info') (byKind[it.kind] = byKind[it.kind] || []).push(it.id);
  const menu = Object.entries(byKind).map(([k, ids]) => `${k}: ${ids.join(', ')}`).join('\n');
  const session = { pack: state.pack, picks: state.picks, music: state.music, sound: state.sound, pace: state.pace, export: state.export, reference: state.reference && state.reference.extracted ? { mode: state.reference.mode, extracted: state.reference.extracted } : null };
  return [
    'You are the video editor inside AIgent Studio, a local talking-head reel editor. The user tells you a vibe or asks for effects; you change the session by returning a patch.',
    'Reply with one JSON object only: {"reply": "one or two plain sentences to the user, no em dashes", "patch": {...}}.',
    'Patch fields (all optional): "pack": one of ' + cat.packs.map(p => p.name).join(', ') + ' or null; "picks": {"<kind>:<id>": "allow" | "deny" | "clear"}; "clearPicks": true; "music": {"bed": "auto" | "none" | a bed id, "energy": "auto" | "low" | "mid" | "high"}; "sound": {"sfx": "on" | "off", "cap": "on" | "off"}; "pace": {"tighten": null | "off" | seconds 0.1 to 2, "punch": "on" | "off"}; "export": ' + cat.exports.join(' | ') + '.',
    'allow on a transition, title entrance, graphic, finish or effect means only allowed ones may be used; deny forbids one. Kinds captionStyle, captionEntrance, look, theme, titleLayer, bed and beatSync take one allow. Use only names from this menu; never invent one:',
    menu,
    'Music beds: ' + cat.beds.map(b => `${b.id} (${b.energy})`).join(', '),
    'Current session: ' + JSON.stringify(session),
  ].join('\n');
}

export function parseReply(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return { reply: String(text || '').trim().slice(0, 1000), patch: {} };
  try { const j = JSON.parse(m[0]); return { reply: String(j.reply || '').replace(/\u2014/g, ', '), patch: j.patch && typeof j.patch === 'object' ? j.patch : {} }; }
  catch { return { reply: String(text).trim().slice(0, 1000), patch: {} }; }
}

export async function chat(text, state, cat, env = process.env) {
  const p = provider(env);
  if (!p) throw new Error('no ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment');
  const sys = systemPrompt(state, cat);
  const history = (state.chat || []).slice(-8).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text }));
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 60e3);
  try {
    let out;
    if (p.name === 'anthropic') {
      const r = await fetch(p.base + '/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: p.model, max_tokens: 800, system: sys, messages: [...history, { role: 'user', content: text }] }) });
      const j = await r.json(); if (!r.ok) throw new Error(`anthropic ${r.status}: ${(j.error && j.error.message) || 'request failed'}`);
      out = (j.content || []).map(c => c.text || '').join('');
    } else {
      const r = await fetch(p.base + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.OPENAI_API_KEY },
        body: JSON.stringify({ model: p.model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, ...history, { role: 'user', content: text }] }) });
      const j = await r.json(); if (!r.ok) throw new Error(`openai ${r.status}: ${(j.error && j.error.message) || 'request failed'}`);
      out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    }
    return { ...parseReply(out), provider: p.name, model: p.model };
  } finally { clearTimeout(timer); }
}
