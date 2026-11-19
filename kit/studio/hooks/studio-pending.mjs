#!/usr/bin/env node
// Claude Code hook: tells Claude when messages are waiting in the Studio page chat, so they are picked up at the next
// step even while it is busy in the terminal. A terminal agent cannot be interrupted mid-step; this makes sure it
// notices at the next tool call (PostToolUse), the next prompt (UserPromptSubmit) or the end of its turn (Stop).
// Installed by npm run studio:connect -- claude. It only reads: it asks Studio's local endpoint
// (http://127.0.0.1:<STUDIO_PORT or 4757>/api/agent/pending) and falls back to the session file. It prints nothing when
// no Studio message waits, and never copies anything into Studio.
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
let input = {}; try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
const event = input.hook_event_name || process.argv[2] || 'PostToolUse';
const port = +(process.env.STUDIO_PORT || 4757);

async function pending() {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/agent/pending`, { signal: AbortSignal.timeout(800) }); if (r.ok) return await r.json(); } catch {}
  try {
    const s = JSON.parse(readFileSync(join(resolve(process.env.STUDIO_DIR || join(ROOT, 'jobs', '.studio')), 'state.json'), 'utf8'));
    const q = (s.chat || []).filter(m => m.role === 'user' && m.to === 'agent' && m.status === 'queued');
    if (!q.length) return { count: 0 };
    const last = q[q.length - 1];
    return { count: q.length, notice: `Studio: ${q.length} message${q.length > 1 ? 's' : ''} waiting in the Studio page chat (a separate channel from this terminal conversation). Latest: "${String(last.text).slice(0, 200)}". Call studio_get_pending to read and studio_reply to answer in Studio.` };
  } catch { return { count: 0 }; }
}

const q = await pending();
if (!q.count) process.exit(0);
if (event === 'Stop' || event === 'SubagentStop') {
  // one nudge per stop: if Claude is already continuing because of a stop hook, let it stop
  if (input.stop_hook_active) process.exit(0);
  process.stdout.write(JSON.stringify({ decision: 'block', reason: q.notice }));
} else {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: q.notice } }));
}
