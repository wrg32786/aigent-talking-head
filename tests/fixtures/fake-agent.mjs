// A stand-in for the always-on Studio agent (STUDIO_AGENT_CMD in tests): it says it is listening, counts its own
// starts in <state>/fake-agent-runs, then exits after a moment like a headless run that ended, so the supervisor
// has to start it again.
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
const dir = process.env.STUDIO_DIR;
mkdirSync(dir, { recursive: true });
appendFileSync(join(dir, 'fake-agent-runs'), 'run\n');
const CH = await import('../../kit/studio/channel.mjs');
CH.touch({ name: 'claude-code', waiting: true });
setTimeout(() => { CH.touch({ name: 'claude-code', waiting: false }); process.exit(0); }, Number(process.env.FAKE_AGENT_MS || 800));
