// Studio stages: the parser that turns teardown log lines into the status line, the list and the bar.
//   node tests/studio-stages.test.mjs
import assert from 'assert';
import * as S from '../kit/studio/stages.mjs';

let n = 0; const ok = (name, f) => { f(); n++; console.log('ok ' + name); };

ok('the stage list is the ten plain names and the shares add up to 100', () => {
  assert.deepStrictEqual(S.STAGES.map(x => x.label), ['Downloading', 'Finding cuts', 'Reading captions', 'Reading camera moves', 'Transcribing', 'Reading music and sounds', 'Reading graphics', 'Reading framing', 'Reading colours', 'Building the recipe']);
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
  assert.ok(!/[—]/.test(v.message));
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

console.log(`\n${n} checks passed`);
