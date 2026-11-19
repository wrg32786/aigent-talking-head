// The Studio chat channel for a terminal agent (Claude Code, Codex, Cursor or any MCP client). The Studio page chat is
// its own conversation: lines typed in the page, the agent's answers to them, and short action notes. The agent's
// terminal conversation is a separate channel and is never copied here.
//   page line   -> { role: user, to: agent, status: queued }   (POST /api/chat while the backend is agent)
//   agent reads -> status seen      (studio_wait_for_message long-polls; studio_get_pending checks without waiting)
//   agent reply -> status answered  (studio_reply with replyTo)
// Presence lives in agent.json next to the session: who is connected, when it was last seen, whether it is waiting.
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as C from './core.mjs';

export const presencePath = () => join(C.stateDir(), 'agent.json');
export const CONNECTED_MS = 120e3, LISTENING_MS = 20e3;
const NAMES = { 'claude-code': 'Claude Code', 'claude-ai': 'Claude', codex: 'Codex', 'codex-mcp-client': 'Codex', cursor: 'Cursor', 'cursor-vscode': 'Cursor', 'cursor-agent': 'Cursor CLI', 'gemini-cli': 'Gemini CLI', windsurf: 'Windsurf', vscode: 'VS Code', 'visual-studio-code': 'VS Code' };
export const prettyName = n => !n ? 'Your agent' : NAMES[n] || NAMES[String(n).toLowerCase()] || String(n).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40);

export function readPresence() { try { return JSON.parse(readFileSync(presencePath(), 'utf8')); } catch { return {}; } }
export function presence(now = Date.now()) {
  const p = readPresence(), seen = p.lastSeen ? now - p.lastSeen : Infinity;
  return { name: p.name ? prettyName(p.name) : null, client: p.name || null, connected: seen < CONNECTED_MS, listening: !!p.waiting && seen < LISTENING_MS, lastSeen: p.lastSeen || null };
}
export function touch(info = {}) {
  const p = { ...readPresence(), ...info, lastSeen: Date.now() };
  mkdirSync(C.stateDir(), { recursive: true });
  const tmp = presencePath() + '.tmp'; writeFileSync(tmp, JSON.stringify(p)); renameSync(tmp, presencePath());
  return p;
}

export const pending = s => (s.chat || []).filter(m => m.role === 'user' && m.to === 'agent' && m.status === 'queued');
export const unanswered = s => (s.chat || []).filter(m => m.role === 'user' && m.to === 'agent' && m.status !== 'answered');
const brief = m => ({ id: m.id, text: m.text, at: m.at, ...(m.attach ? { attach: m.attach } : {}) });

// what the agent needs to act on a Studio message, without the whole menu
export function context(s) {
  let comp = {}; try { comp = C.compose(s); } catch (e) { comp = { errs: [e.message] }; }
  return { job: s.job, footage: s.footage, pack: s.pack, picks: s.picks, music: s.music, sound: s.sound, pace: s.pace, export: s.export,
    reference: C.refContext(s), takes: (s.takes || []).map(t => ({ id: t.id, file: t.file, seconds: t.seconds, status: t.status, kept: t.kept })), task: s.task, outputs: C.outputsOf(s), reelArgs: comp.args, problems: comp.errs,
    recentStudioChat: (s.chat || []).slice(-10).map(m => ({ id: m.id, role: m.role, text: m.text, status: m.status, kind: m.kind })) };
}
// mark the queued page lines seen and return them; nothing queued returns []
export function take(limit = 20) {
  const s = C.load(), q = pending(s).slice(0, limit);
  if (!q.length) return { messages: [], state: s };
  const at = new Date().toISOString();
  for (const m of q) { m.status = 'seen'; m.seenAt = at; }
  C.save(s);
  return { messages: q.map(brief), state: s };
}
// answer in the Studio channel; replyTo marks those page lines answered. A patch (same fields as studio_set_selections)
// is applied first; names the engine does not have are refused and nothing is changed.
export function reply({ text, replyTo, patch, agent } = {}) {
  const s = C.load();
  if (patch && Object.keys(patch).length) { const r = C.applyPatch(s, patch); if (r.errs.length) return { errs: r.errs }; var log = r.log; }
  const ids = [].concat(replyTo || []).map(Number).filter(Boolean);
  const target = ids.length ? ids : unanswered(s).map(m => m.id);
  if (text) C.applyPatch(s, { reply: String(text), from: prettyName(agent), replyTo: target[target.length - 1] || undefined, kind: 'reply' });
  const at = new Date().toISOString();
  for (const m of s.chat) if (target.includes(m.id) && m.role === 'user' && m.to === 'agent') { m.status = 'answered'; m.answeredAt = at; }
  C.save(s);
  return { errs: [], changed: log || [], answered: target };
}
// a one-line action note for an edit made from another channel (the terminal). Never conversation text.
export function actionNote(s, changes, agent) {
  if (!changes || !changes.length) return null;
  const KINDS = { captionStyle: 'caption style', captionEntrance: 'caption entrance', entrance: 'title entrance', titleLayer: 'title layer', beatSync: 'beat sync', bed: 'music bed' };
  const words = changes.map(c => c.replace(/\b(captionStyle|captionEntrance|entrance|titleLayer|beatSync|bed)\b/g, k => KINDS[k]));
  const text = `${prettyName(agent)}: ${words.slice(0, 6).join(', ')}${words.length > 6 ? ` and ${words.length - 6} more` : ''} (from the terminal).`;
  C.applyPatch(s, { reply: text, from: prettyName(agent), kind: 'action' });
  return text;
}
// for the Claude Code hook and studio_get_pending: a peek that does not mark anything seen
export function peek(s = C.load()) {
  const q = pending(s);
  return { count: q.length, messages: q.map(brief), presence: presence() };
}
export function notice(q) {
  if (!q.count) return '';
  const last = q.messages[q.messages.length - 1];
  return `Studio: ${q.count} message${q.count > 1 ? 's' : ''} waiting in the Studio page chat (a separate channel from this terminal conversation). Latest: "${String(last.text).slice(0, 200)}". Call studio_get_pending (or studio_wait_for_message) to read ${q.count > 1 ? 'them' : 'it'}, act, and answer with studio_reply so the reply shows in Studio, not here.`;
}
