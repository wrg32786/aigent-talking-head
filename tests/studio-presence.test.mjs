// The agent badge's windows (kit/studio/channel.mjs presence): listening while it waits, connected for 2 minutes after
// it last touched Studio, then "between replies" (recent) for 10 minutes, then no agent.
// Run: node tests/studio-presence.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const STATE = mkdtempSync(join(tmpdir(), 'studio-presence-test-'));
process.env.STUDIO_DIR = STATE;
const CH = await import('../kit/studio/channel.mjs');
const at = (msAgo, waiting = false) => writeFileSync(CH.presencePath(), JSON.stringify({ name: 'claude-code', lastSeen: Date.now() - msAgo, waiting }));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ' + name); };

try {
  t('no agent.json: nothing connected, nothing recent', () => { const p = CH.presence(); assert.strictEqual(p.connected, false); assert.strictEqual(p.recent, false); });
  t('waiting just now: listening, connected, recent', () => { at(1000, true); const p = CH.presence(); assert.ok(p.listening && p.connected && p.recent); assert.strictEqual(p.name, 'Claude Code'); });
  t('answered 30 s ago, not waiting: connected (busy), not listening', () => { at(30e3); const p = CH.presence(); assert.ok(p.connected && p.recent); assert.strictEqual(p.listening, false); });
  t('answered 5 min ago: between replies (recent), not connected', () => { at(5 * 60e3); const p = CH.presence(); assert.strictEqual(p.connected, false); assert.strictEqual(p.recent, true); });
  t('answered 20 min ago: no agent', () => { at(20 * 60e3); const p = CH.presence(); assert.strictEqual(p.connected, false); assert.strictEqual(p.recent, false); });
  t('the windows are ordered listening < connected < recent', () => assert.ok(CH.LISTENING_MS < CH.CONNECTED_MS && CH.CONNECTED_MS < CH.RECENT_MS));
  console.log(`\nstudio-presence: ${n} passed`);
} finally { rmSync(STATE, { recursive: true, force: true }); }
