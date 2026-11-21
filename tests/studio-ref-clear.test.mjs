// A breakdown that stopped says "We stopped while ..." on its own reference only: clearing the reference, or adding
// another file, takes the line away. Starts a Studio server on a temp state; no Chrome, no ffmpeg, no network.
//   node tests/studio-ref-clear.test.mjs
import assert from 'assert';
import * as S from '../kit/studio/stages.mjs';
let n = 0;
{
  const { spawn } = await import('child_process'), { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('fs'), { tmpdir } = await import('os'), { join, dirname } = await import('path'), { fileURLToPath } = await import('url');
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), STATE = mkdtempSync(join(tmpdir(), 'studio-stages-test-')), SDIR = join(STATE, 'studio'), JOB = 'stages-test-' + process.pid;
  process.env.STUDIO_DIR = SDIR;
  const C = await import('../kit/studio/core.mjs');
  const run = S.newRun(); S.feed(run, 'stage cuts'); S.fail(run); const stopped = S.view(run, { skip: ['download'] });
  assert.strictEqual(stopped.failed, 'cuts');
  mkdirSync(SDIR, { recursive: true });
  writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, reference: { ...C.defaultState().reference, file: `inbox/studio/${JOB}/ref.mp4`, status: 'uploaded', stages: stopped } }));
  const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env: { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome') } });
  try {
    let out = '';
    const url = await new Promise((yes, no) => { srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) yes(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => no(new Error('server exited ' + c + ': ' + out))); });
    const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
    const ref = async () => (await req('/api/state')).j.state.reference;
    assert.strictEqual((await ref()).stages.failed, 'cuts', 'the stopped breakdown is on the board');
    const cl = await req('/api/reference/clear', {}); assert.strictEqual(cl.status, 200, JSON.stringify(cl.j).slice(0, 200));
    assert.ok(!(await ref()).stages, 'Clear reference takes the stopped line with it'); n++; console.log('ok Clear reference takes "We stopped while ..." with it');
    assert.strictEqual((await req('/api/reference/clear', { undo: true })).status, 200); assert.strictEqual((await ref()).stages.failed, 'cuts', 'Undo puts the reference back as it was');
    const up = await fetch(`${url}/api/upload?kind=reference&name=other.mp4`, { method: 'POST', body: Buffer.from('not a video') }); assert.strictEqual(up.status, 200, await up.text());
    const r2 = await ref(); assert.ok(/other\.mp4$/.test(r2.file) && !r2.stages, 'a new reference file does not show the last one\'s stopped line: ' + JSON.stringify(r2.stages)); n++; console.log('ok a new reference file starts with no stopped line');
  } finally { srv.kill(); rmSync(STATE, { recursive: true, force: true }); for (const d of [['inbox', 'studio'], ['teardown-in', 'studio'], ['jobs']]) rmSync(join(ROOT, ...d, JOB), { recursive: true, force: true }); }
}

console.log(`\n${n} checks passed`);
