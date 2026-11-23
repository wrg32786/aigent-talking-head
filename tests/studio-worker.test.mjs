// The always-on Studio agent (kit/studio/worker.mjs) with a fake agent (tests/fixtures/fake-agent.mjs): it starts,
// it is started again when it exits, the choice is remembered for the next Studio start, and Stop really stops it.
// Run: node tests/studio-worker.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const STATE = mkdtempSync(join(tmpdir(), 'studio-worker-test-'));
process.env.STUDIO_DIR = STATE;
process.env.STUDIO_AGENT_CMD = 'tests/fixtures/fake-agent.mjs';
process.env.FAKE_AGENT_MS = '400';
const W = await import('../kit/studio/worker.mjs');
const CH = await import('../kit/studio/channel.mjs');
const runs = () => existsSync(join(STATE, 'fake-agent-runs')) ? readFileSync(join(STATE, 'fake-agent-runs'), 'utf8').trim().split('\n').length : 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(100); } throw new Error('timed out: ' + what); }
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

try {
  await t('off by default, and an agent is available (the fake one)', async () => {
    const s = W.status(); assert.strictEqual(s.enabled, false); assert.strictEqual(s.phase, 'off'); assert.strictEqual(s.available, true);
  });
  await t('Wake starts the agent; it shows as listening', async () => {
    W.start({ url: 'http://127.0.0.1:1' });
    await until(() => runs() >= 1, 5000, 'first run');
    await until(() => CH.presence().listening, 3000, 'listening');
    assert.strictEqual(JSON.parse(readFileSync(join(STATE, 'worker.json'), 'utf8')).enabled, true, 'remembered as on');
  });
  await t('when the agent exits it is started again', async () => {
    await until(() => runs() >= 3, 15000, 'restarts');
    assert.ok(W.status().starts >= 3, JSON.stringify(W.status()));
  });
  await t('Stop: no more restarts, remembered as off', async () => {
    W.stop(); const before = runs(); await sleep(4000);
    assert.ok(runs() <= before + 1, `kept restarting after stop: ${before} -> ${runs()}`);
    assert.strictEqual(W.status().phase, 'off');
    assert.strictEqual(JSON.parse(readFileSync(join(STATE, 'worker.json'), 'utf8')).enabled, false);
  });
  await t('resume brings it back only when it was left on', async () => {
    W.resume({}); await sleep(1200); const off = runs();
    await sleep(1500); assert.strictEqual(runs(), off, 'resume started it although it was off');
  });
  console.log(`\nstudio-worker: ${n} passed`);
} finally { W.shutdown(); rmSync(STATE, { recursive: true, force: true }); }
