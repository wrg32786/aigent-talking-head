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

// report 4, item 15: "is the video breakdown stuck?" Each stage keeps its time, and the tool lines are read on Windows paths
ok('each stage keeps when it started and how long it took; the view gives the page a clock to count from', () => {
  const run = S.newRun(), T0 = 1_700_000_000_000;
  S.feed(run, 'stage cuts: finding cuts', T0);
  let v = S.view(run, { skip: ['download'] });
  assert.strictEqual(v.since, T0); assert.strictEqual(v.started, T0); assert.ok(v.list.every(x => x.took == null));
  S.feed(run, 'stage captions: reading captions', T0 + 42_000);
  S.feed(run, 'stage captions: reading captions', T0 + 50_000); // the same stage again does not restart its clock
  S.feed(run, 'stage graphics: reading graphics', T0 + 42_000 + 200_000);
  v = S.view(run, { skip: ['download'] });
  assert.strictEqual(v.since, T0 + 242_000); assert.strictEqual(v.label, 'Reading graphics');
  const took = Object.fromEntries(v.list.map(x => [x.id, x.took]));
  assert.strictEqual(took.cuts, 42); assert.strictEqual(took.captions, 200);
  assert.strictEqual(took.camera, undefined, 'a stage that was skipped has no time'); assert.strictEqual(took.graphics, undefined, 'the running stage has none yet');
  S.finish(run, T0 + 242_000 + 80_000); v = S.view(run);
  assert.strictEqual(v.list.find(x => x.id === 'graphics').took, 80); assert.strictEqual(v.since, undefined); assert.strictEqual(v.stage, null);
});

ok('times read as plain words', () => {
  assert.deepStrictEqual([0, 9, 45, 60, 80, 125, 599, 600, 754].map(S.tookWords), ['0 s', '9 s', '45 s', '1 min', '1 min 20 s', '2 min 5 s', '9 min 59 s', '10 min', '12 min']);
  assert.ok(!/\u2014/.test([0, 80, 754].map(S.tookWords).join('')));
});

ok('a stage that stops says after how long, and a restart drops the running clock', () => {
  const run = S.newRun(); S.feed(run, 'stage cuts', 1000); S.feed(run, 'stage graphics', 11_000); S.fail(run, 91_000);
  const v = S.view(run); assert.strictEqual(v.message, 'We stopped while reading graphics, after 1 min 20 s.'); assert.strictEqual(v.since, undefined);
  const live = S.newRun(); S.feed(live, 'stage transcribe', 5000);
  const dead = S.failView(S.view(live)); assert.strictEqual(dead.since, undefined); assert.strictEqual(dead.failed, 'transcribe');
});

ok('no clock handed in (an older caller): the stages still move, with no times', () => {
  const run = S.newRun(); assert.ok(S.feed(run, 'stage cuts')); assert.ok(S.feed(run, 'stage sound')); assert.ok(S.finish(run));
  const v = S.view(run); assert.strictEqual(v.percent, 100); assert.ok(v.list.every(x => x.took == null)); assert.strictEqual(v.since, undefined);
  // a record saved before 1.28.0 has no "at" or "took"
  const old = { stage: 'cuts', done: ['download'], failed: null }; assert.ok(S.feed(old, 'stage captions', 2000)); assert.strictEqual(S.view(old).since, 2000);
});

ok('a breakdown started on Windows paths moves the stage line', () => {
  for (const l of ['> C:\\Users\\Will\\AppData\\Roaming\\Python\\Scripts\\rea-video.exe decompose D:\\AIgent Studio\\teardown-in\\studio\\video-2026-11-21\\ref5.mp4 -o C:\\dev\\aigent-talking-head-studio\\teardown\\studio-video-2026-11-21-r5\\videomd --lang en',
    '> "C:\\Program Files\\rea\\rea-video.exe" decompose "D:\\AIgent Studio\\ref.mp4" -o out',
    '> rea-video.exe decompose D:/AIgent Studio/ref.mp4 -o out\r']) assert.strictEqual(S.stageOf(l), 'cuts', l);
  for (const l of ['> C:\\dev\\aigent-talking-head-studio\\.venv\\Scripts\\python.exe C:\\dev\\aigent-talking-head-studio\\kit\\teardown.py analyze D:\\AIgent Studio\\ref.mp4 --out f.json',
    '> "C:\\Program Files\\Python312\\python.exe" "D:\\AIgent Studio\\kit\\teardown.py" analyze "D:\\AIgent Studio\\ref.mp4" --out f.json',
    '> py D:\\AIgent Studio\\kit\\teardown.py analyze ref.mp4']) assert.strictEqual(S.stageOf(l), 'cuts', l);
  assert.strictEqual(S.stageOf('$ node kit\\studio\\fetch.mjs https://x.test/a.mp4 --out D:\\AIgent Studio\\f.mp4'), 'download');
  assert.strictEqual(S.stageOf('stage graphics: reading graphics\r'), 'graphics', 'a line that ends \\r\\n');
  assert.strictEqual(S.stageOf('Teardown: C:\\dev\\aigent-talking-head-studio\\teardown\\studio-video-2026-11-21-r5\\Reel.md'), 'done');
  // a path that only mentions the tools is not a stage
  for (const l of ['wrote D:\\AIgent Studio\\rea-video decompose notes.txt', 'note: teardown.py analyze is the built-in reader']) assert.strictEqual(S.stageOf(l), null, l);
  // a whole run on Windows lines, with a clock
  const run = S.newRun(); let t = 0;
  for (const l of ['$ node kit\\teardown.mjs D:\\AIgent Studio\\ref.mp4 --name r5', '> C:\\Tools\\rea-video.exe decompose D:\\AIgent Studio\\ref.mp4 -o out', 'stage captions: reading captions', 'stage transcribe: transcribing', 'stage graphics: reading graphics', 'stage framing: reading framing', 'Teardown: teardown\\r5\\Reel.md'])
    S.feed(run, l + '\r', (t += 30_000));
  const v = S.view(run); assert.strictEqual(v.percent, 100); assert.deepStrictEqual(v.list.filter(x => x.took != null).map(x => [x.id, x.took]), [['cuts', 30], ['captions', 30], ['transcribe', 30], ['graphics', 30], ['framing', 30]]);
});

console.log(`\n${n} checks passed`);
