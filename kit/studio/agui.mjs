// AG-UI adapter for Studio (https://github.com/ag-ui-protocol/ag-ui, MIT). Studio speaks its own /api/events stream to the page;
// this file maps the same session onto AG-UI event shapes so any AG-UI client can watch or talk to Studio:
//   GET  /api/agui/events  observer stream: STATE_SNAPSHOT + MESSAGES_SNAPSHOT, then STATE_DELTA (JSON Patch), TEXT_MESSAGE_*,
//                          STEP_STARTED / STEP_FINISHED for drafts, renders and reference downloads, CUSTOM for message status and action notes
//   POST /api/agui         a run: RunAgentInput in, SSE events out. The last user message goes into the Studio chat (same channel as the page);
//                          the answer comes from whoever answers the Studio chat (your terminal agent by default).
// Event shapes follow the AG-UI core types; no AG-UI code is copied and there is no dependency.

export const encode = ev => `data: ${JSON.stringify({ timestamp: Date.now(), ...ev })}\n\n`;

// the part of the session an AG-UI client cares about (the edit, not the plumbing)
export function snapshot(s) {
  const r = s.reference || {};
  return { job: s.job || null, footage: s.footage || [], clips: s.clips || null, pack: s.pack || null, picks: s.picks || {}, music: s.music || {}, sound: s.sound || {}, pace: s.pace || {}, export: s.export || null,
    reference: { mode: r.mode || 'off', status: r.status || 'none', active: r.active || null, queue: (r.queue || []).map(q => ({ id: q.id, url: q.url, site: q.site, status: q.status, progress: q.progress || 0, error: q.error || null, title: q.title || null })), summary: r.extracted ? r.extracted.summary || null : null } };
}
const mid = m => 'studio-' + m.id;
export function messages(s) {
  return (s.chat || []).filter(m => m.kind !== 'action').map(m => m.role === 'user' ? { id: mid(m), role: 'user', content: m.text } : { id: mid(m), role: 'assistant', content: m.text, ...(m.from ? { name: String(m.from) } : {}) });
}

// RFC 6902 JSON Patch between two plain JSON values
const esc = k => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
export function diff(a, b, path = '', out = []) {
  if (a === b) return out;
  const obj = x => x && typeof x === 'object' && !Array.isArray(x);
  if (obj(a) && obj(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) out.push({ op: 'remove', path: `${path}/${esc(k)}` });
    for (const k of Object.keys(b)) { if (!(k in a)) out.push({ op: 'add', path: `${path}/${esc(k)}`, value: b[k] }); else diff(a[k], b[k], `${path}/${esc(k)}`, out); }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ op: 'replace', path: path || '', value: b });
  return out;
}
export function applyPatch(doc, ops) { // enough of RFC 6902 to check our own deltas
  let d = JSON.parse(JSON.stringify(doc));
  for (const o of ops) {
    if (!o.path) { d = o.value; continue; }
    const keys = o.path.split('/').slice(1).map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
    let t = d; for (const k of keys.slice(0, -1)) t = t[k];
    const last = keys.at(-1);
    if (o.op === 'remove') { if (Array.isArray(t)) t.splice(+last, 1); else delete t[last]; } else t[last] = o.value;
  }
  return d;
}

// one observer per stream: feed it each new session (and task) and it returns the AG-UI events since the last one
export function observer(s0, task0) {
  let snap = snapshot(s0), seen = new Map((s0.chat || []).map(m => [m.id, m.status || '']));
  let lastTask = task0 ? `${task0.id}:${task0.status}` : '';
  const first = [{ type: 'STATE_SNAPSHOT', snapshot: snap }, { type: 'MESSAGES_SNAPSHOT', messages: messages(s0) }];
  return {
    first,
    next(s, task) {
      const ev = [], ns = snapshot(s), delta = diff(snap, ns);
      if (delta.length) ev.push({ type: 'STATE_DELTA', delta });
      snap = ns;
      let newUser = false;
      for (const m of s.chat || []) {
        const had = seen.has(m.id), was = seen.get(m.id);
        if (!had) {
          if (m.kind === 'action') ev.push({ type: 'CUSTOM', name: 'studio.action_note', value: { id: mid(m), text: m.text, from: m.from || null } });
          else if (m.role === 'assistant') ev.push({ type: 'TEXT_MESSAGE_START', messageId: mid(m), role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: mid(m), delta: m.text }, { type: 'TEXT_MESSAGE_END', messageId: mid(m) });
          else newUser = true;
        }
        if (m.role === 'user' && m.to === 'agent' && (m.status || '') !== (was || '') ) ev.push({ type: 'CUSTOM', name: 'studio.message_status', value: { id: mid(m), status: m.status } });
        seen.set(m.id, m.status || '');
      }
      if (newUser) ev.push({ type: 'MESSAGES_SNAPSHOT', messages: messages(s) });
      if (task) {
        const k = `${task.id}:${task.status}`;
        if (k !== lastTask) { lastTask = k; ev.push(task.status === 'running' ? { type: 'STEP_STARTED', stepName: task.kind } : { type: 'STEP_FINISHED', stepName: task.kind, ...(task.status !== 'done' ? { metadata: { status: task.status } } : {}) }); }
      }
      return ev;
    },
  };
}

// the text of the last user message in a RunAgentInput (string content or text parts)
export function lastUserText(input) {
  const ms = (input && Array.isArray(input.messages) ? input.messages : []).filter(m => m && m.role === 'user');
  const m = ms.at(-1); if (!m) return '';
  return typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : '';
}
