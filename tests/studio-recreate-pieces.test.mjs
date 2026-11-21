// Recreate drafts from your pieces (1.17.2), with no Chrome, no keys and no network (a stand-in transcriber and reel):
// - with a reference on Recreate and pieces kept on Cut, the draft is your pieces, already cut (--as-is), with the
//   reference's Reel.md as the recipe; the line you cut out stays out
// - after the draft, Your edit says drafted (not stale) and the next thing is Render, so Render comes on
// Run: node tests/studio-recreate-pieces.test.mjs   (npm run smoke runs it too; it needs ffmpeg)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-recreate-pieces-')), JOB = 'recreate-pieces-' + process.pid;
const TD = `teardown/studio-${JOB}-r1`;
process.env.STUDIO_DIR = STATE;
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// a 9 s take: tone bursts are the words, at the times the stand-in transcriber says
const SYN = join(STATE, 'syn.mp4'), REAL = [[1.0, 1.6], [1.75, 2.4], [3.3, 4.0], [4.1, 4.8], [6.0, 6.7], [6.8, 7.5]];
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x303840:s=360x640:r=12:d=9', '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*200*t)*(${REAL.map(([a, b]) => `between(t,${a},${b})`).join('+')})':s=48000:d=9`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', SYN], { stdio: 'pipe' });
const TXW = join(STATE, 'words.json');
writeFileSync(TXW, JSON.stringify({ 'rc-take': { duration: 9, words: [[1.0, 1.6, 'One'], [1.75, 2.4, 'two.'], [3.3, 4.0, 'Three'], [4.1, 4.8, 'four.'], [6.0, 6.7, 'Five'], [6.8, 7.5, 'six.']] } }));
// a reference already broken down, on Recreate: the shipped cinematic recipe stands in for its teardown
mkdirSync(join(ROOT, TD), { recursive: true }); copyFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), join(ROOT, TD, 'Reel.md'));
const base = C.defaultState();
writeFileSync(join(STATE, 'state.json'), JSON.stringify({ ...base, job: JOB, sound: { ...base.sound, sfx: 'off' }, music: { ...base.music, bed: 'none' },
  reference: { ...base.reference, status: 'ready', mode: 'recreate', out: TD, extracted: C.extract(join(ROOT, TD, 'Reel.md')) } }));

const env = { ...process.env, FAKE_TX_WORDS: TXW, CI: '1', STUDIO_DIR: STATE, STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '50', STUDIO_REEL: 'tests/fixtures/fake-reel.mjs', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let out = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const waitTask = async () => { await wait(300); return until(async () => { const v = await api('/api/state'); return v.task && v.task.status !== 'running' ? v : null; }, 120000); };

try {
  const take = (await (await fetch(`${url}/api/upload?kind=footage&name=rc%20take.mp4`, { method: 'POST', body: readFileSync(SYN) })).json()).path;
  await api('/api/cut/find', { path: take, scorer: 'rules' });
  await until(async () => { const x = await api('/api/cut'); return x.source === take && x.candidates.length ? x : null; });
  await api('/api/cut/set', { source: take, by: 'test', candidates: [{ kind: 'clip', label: 'First', ranges: [[0.95, 2.45]] }, { kind: 'clip', label: 'Last', ranges: [[5.9, 7.6]] }, { kind: 'clip', label: 'Middle', ranges: [[3.2, 4.9]], keep: false }] });

  await t('Recreate drafts from your pieces, with the reference as the recipe; the line you cut out stays out', async () => {
    const e = await api('/api/edit'); assert.strictEqual(e.edit.from.mode, 'pieces'); assert.strictEqual(e.edit.next.label, 'Draft it');
    const d = await api('/api/draft', {}); assert.ok(!d.error, JSON.stringify(d).slice(0, 300)); assert.strictEqual(d.from, 'pieces');
    const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 600));
    const L = readFileSync(join(ROOT, 'jobs', JOB, 'fake-reel.log'), 'utf8');
    assert.ok(/--as-is/.test(L) && /--recipe \S*Reel\.md/.test(L) && /--recut/.test(L), L);
    assert.ok(/cuts\/c1\.mp4/.test(L) && /cuts\/c2\.mp4/.test(L) && !/cuts\/c3\.mp4/.test(L) && !/rc-take\.mp4/.test(L), 'your pieces, not the whole take: ' + L);
    assert.ok(!/--pack/.test(L.split('\n')[0]), 'the recipe, not a pack');
  });
  await t('after the draft: drafted, not stale, and Render is next', async () => {
    const e = await api('/api/edit'); assert.strictEqual(e.edit.drafted, true); assert.strictEqual(e.edit.stale, false); assert.strictEqual(e.edit.next.label, 'Render');
    assert.strictEqual((await api('/api/state')).state.drafted.from, 'pieces');
  });
  await t('the whole take still works on Recreate when you pick it', async () => {
    await api('/api/state', { finish: { from: 'take' } });
    await api('/api/draft', {}); const v = await waitTask(); assert.strictEqual(v.task.status, 'done');
    const L = readFileSync(join(ROOT, 'jobs', JOB, 'fake-reel.log'), 'utf8').trim().split('\n').pop();
    assert.ok(/rc-take\.mp4/.test(L) && /--recipe/.test(L), L);
    const e = await api('/api/edit'); assert.strictEqual(e.edit.drafted, true); assert.strictEqual(e.edit.stale, false);
  });
  console.log(`studio-recreate-pieces: ${n} passed`);
} finally {
  srv.kill();
  rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, TD), { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
}
process.exit(0);
