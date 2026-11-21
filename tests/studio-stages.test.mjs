// Studio stages: the parser that turns teardown log lines into the status line, the list and the bar.
//   node tests/studio-stages.test.mjs
import assert from 'assert';
import * as S from '../kit/studio/stages.mjs';

let n = 0; const ok = (name, f) => { f(); n++; console.log('ok ' + name); };

ok('the stage list is the ten plain names and the shares add up to 100', () => {
  assert.deepStrictEqual(S.STAGES.map(x => x.label), ['Downloading', 'Finding cuts', 'Reading captions', 'Reading camera moves', 'Transcribing', 'Reading music and sounds', 'Reading graphics', 'Reading framing', 'Reading colors', 'Putting it together']);
  assert.strictEqual(S.STAGES.reduce((a, x) => a + x.w, 0), 100);
});

ok('stageOf reads our markers, the download and the tools, and nothing else', () => {
  assert.strictEqual(S.stageOf('stage cuts: finding cuts'), 'cuts');
  assert.strictEqual(S.stageOf('stage framing: reading framing'), 'framing');
  assert.strictEqual(S.stageOf('stage nonsense'), null);
  assert.strictEqual(S.stageOf('progress 40%'), 'download');
  assert.strictEqual(S.stageOf('$ node kit/studio/fetch.mjs https://x.test/a.mp4 --out f.mp4'), 'download');
  assert.strictEqual(S.stageOf('> rea-video decompose /tmp/a.mp4 -o out/videomd --lang en'), 'cuts');
  assert.strictEqual(S.stageOf('> python3 /kit/teardown.py analyze a.mp4 --out f.json'), 'cuts');
  assert.strictEqual(S.stageOf('Teardown: teardown/x/Reel.md'), 'done');
  for (const l of ['', 'framing: a face in 3 of 4 shots', 'the next stage is fine', 'note: extras failed', null]) assert.strictEqual(S.stageOf(l), null);
});

ok('a full run walks the stages in order and never goes back', () => {
  const run = S.newRun(), seen = [];
  const lines = ['$ node kit/studio/fetch.mjs u --out f', 'progress 10%', 'progress 100%', '$ node kit/teardown.mjs f', '> rea-video decompose f -o p', 'stage cuts: finding cuts', 'stage captions: reading captions',
    'stage camera: reading camera moves', 'stage transcribe: transcribing', 'stage sound: reading music and sounds', 'stage graphics: reading graphics', 'stage cuts: finding cuts',
    'stage framing: reading framing', 'framing: a face in 2 of 2 shots', 'stage colours: reading colours', 'stage recipe: building the recipe'];
  for (const l of lines) if (S.feed(run, l)) seen.push(run.stage);
  assert.deepStrictEqual(seen, ['download', 'cuts', 'captions', 'camera', 'transcribe', 'sound', 'graphics', 'framing', 'colours', 'recipe']);
  assert.deepStrictEqual(run.done, S.STAGES.slice(0, 9).map(x => x.id));
  assert.ok(S.feed(run, 'Teardown: teardown/x/Reel.md'));
  assert.strictEqual(run.stage, null); assert.strictEqual(run.done.length, 10); assert.strictEqual(S.percent(run), 100);
});

ok('a skipped stage counts as done when a later one starts', () => {
  const run = S.newRun();
  S.feed(run, 'stage cuts'); S.feed(run, 'stage sound');
  assert.deepStrictEqual(run.done, ['download', 'cuts', 'captions', 'camera', 'transcribe']);
  assert.strictEqual(run.stage, 'sound');
});

ok('the percent only goes up, and the download uses its real progress', () => {
  const run = S.newRun(); let last = -1;
  S.feed(run, 'progress 0%');
  assert.strictEqual(S.percent(run, 0), 0); assert.strictEqual(S.percent(run, 0.5), 5); assert.strictEqual(S.percent(run, 1), 10);
  for (const x of S.STAGES.slice(1)) { S.feed(run, 'stage ' + x.id); const p = S.percent(run); assert.ok(p > last, `${x.id} ${p} > ${last}`); assert.ok(p < 100); last = p; }
});

ok('the view has one live line, a state per stage and can leave the download out', () => {
  const run = S.newRun(); S.feed(run, 'stage graphics');
  const v = S.view(run);
  assert.strictEqual(v.label, 'Reading graphics'); assert.strictEqual(v.stage, 'graphics'); assert.strictEqual(v.message, null);
  assert.deepStrictEqual(v.list.map(x => x.state), ['done', 'done', 'done', 'done', 'done', 'done', 'now', 'todo', 'todo', 'todo']);
  assert.strictEqual(S.view(run, { skip: ['download'] }).list.length, 9);
  assert.strictEqual(S.view(null).list.every(x => x.state === 'todo'), true);
});

ok('a run that stops names the stage in plain words, and a retry starts clean', () => {
  const run = S.newRun(); S.feed(run, 'stage transcribe'); S.fail(run);
  const v = S.view(run);
  assert.strictEqual(v.failed, 'transcribe'); assert.strictEqual(v.stage, null); assert.strictEqual(v.message, 'We stopped while transcribing.');
  assert.strictEqual(v.list.find(x => x.id === 'transcribe').state, 'failed');
  assert.ok(!/[\u2014]/.test(v.message));
  S.feed(run, 'stage colours'); assert.strictEqual(run.failed, null);
});

ok('a saved view from a run that died with Studio turns into a stopped one', () => {
  const run = S.newRun(); S.feed(run, 'stage captions');
  const v = S.failView(S.view(run));
  assert.strictEqual(v.failed, 'captions'); assert.strictEqual(v.message, 'We stopped while reading captions.');
  assert.strictEqual(v.list.find(x => x.id === 'captions').state, 'failed');
  const fin = S.view(Object.assign(S.newRun(), { done: S.STAGES.map(x => x.id) }));
  assert.strictEqual(S.failView(fin), fin);
});

// The server: a breakdown that stopped says "We stopped while ..." on its own reference only. Clearing the reference,
// or adding another file, takes the line away (it was left on the board, with a Try again that had nothing to try).
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
