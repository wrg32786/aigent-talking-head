// Studio stages: where a reference breakdown is, in plain words. The download and the teardown print lines as they
// go; stageOf reads one line and names the stage it starts, feed keeps a small run record ({ stage, done, failed }),
// and view turns that into what the page shows: one live line, a list with a check per finished stage and a percent
// for the bar. Pure: no files, no clock, so the same record survives a page reload from the saved state.

// in the order the work really runs. w is each stage's share of the bar (they add up to 100)
export const STAGES = [
  { id: 'download', label: 'Downloading', w: 10 },
  { id: 'cuts', label: 'Finding cuts', w: 14 },
  { id: 'captions', label: 'Reading captions', w: 20 },
  { id: 'camera', label: 'Reading camera moves', w: 10 },
  { id: 'transcribe', label: 'Transcribing', w: 10 },
  { id: 'sound', label: 'Reading music and sounds', w: 6 },
  { id: 'graphics', label: 'Reading graphics', w: 12 },
  { id: 'framing', label: 'Reading framing', w: 8 },
  { id: 'colours', label: 'Reading colours', w: 6 },
  { id: 'recipe', label: 'Building the recipe', w: 4 },
];
const IDS = STAGES.map(x => x.id), AT = Object.fromEntries(IDS.map((id, i) => [id, i]));
export const stageLabel = id => (STAGES[AT[id]] || {}).label || null;

// The stage a log line starts, or null. Our own scripts print "stage <id>" (kit/teardown.mjs, kit/teardown.py); the
// other patterns read the lines older runs and the tools themselves print, so a custom teardown still moves the bar.
const READS = [
  [/^stage ([a-z]+)\b/, m => (m[1] in AT ? m[1] : null)],
  [/^progress \d+%/, () => 'download'],
  [/^\$ node kit[\\/]studio[\\/]fetch\.mjs\b/, () => 'download'],
  [/^> rea-video(?:\.exe)? decompose\b/, () => 'cuts'],
  [/^> \S*python\S* \S*teardown\.py analyze\b/, () => 'cuts'],
  [/^Teardown: /, () => 'done'],
];
export function stageOf(line) {
  const l = String(line || '').trim();
  for (const [re, f] of READS) { const m = re.exec(l); if (m) return f(m); }
  return null;
}

export const newRun = () => ({ stage: null, done: [], failed: null });

// one line in: the record moves on when the line starts a later stage. A stage that starts closes every stage before
// it (a stage with nothing to do is skipped, which is done). It never goes back. Returns true when something changed.
export function feed(run, line) {
  const id = stageOf(line);
  if (!id) return false;
  if (id === 'done') return finish(run);
  const cur = run.stage ? AT[run.stage] : -1;
  if (AT[id] <= cur) return false;
  run.stage = id; run.failed = null;
  run.done = IDS.slice(0, AT[id]);
  return true;
}
export function finish(run) {
  if (!run.stage && run.done.length === IDS.length) return false;
  run.stage = null; run.failed = null; run.done = IDS.slice();
  return true;
}
// the run stopped: the stage it was on is the one that failed
export function fail(run) { run.failed = run.stage || run.failed || IDS[Math.min(run.done.length, IDS.length - 1)]; run.stage = null; return true; }

// 0 to 100 for the bar. part is how far the current stage is (0 to 1) when we know it (the download does), else we
// count a started stage as a third in, so the bar moves when a stage starts and again when it ends.
export function percent(run, part) {
  if (!run) return 0;
  let p = 0;
  for (const s of STAGES) if (run.done.includes(s.id)) p += s.w;
  const cur = STAGES[AT[run.stage]];
  if (cur) p += cur.w * (part == null ? 1 / 3 : Math.max(0, Math.min(1, part)));
  return Math.max(0, Math.min(100, Math.round(p)));
}

// what the page shows. skip leaves stages out of the list (an uploaded file has no download)
export function view(run, { skip = [], part } = {}) {
  const r = run || newRun();
  const list = STAGES.filter(s => !skip.includes(s.id)).map(s => ({ id: s.id, label: s.label, state: r.failed === s.id ? 'failed' : r.done.includes(s.id) ? 'done' : r.stage === s.id ? 'now' : 'todo' }));
  const failed = r.failed ? stageLabel(r.failed) : null;
  return { stage: r.stage, label: r.stage ? stageLabel(r.stage) : null, failed: r.failed, message: failed ? `We stopped while ${failed.charAt(0).toLowerCase() + failed.slice(1)}.` : null, percent: percent(r, part), list };
}

// a saved view whose run died with Studio (a restart mid breakdown): the stage it was on is the one that stopped
export function failView(v) {
  if (!v || !v.stage) return v;
  const label = stageLabel(v.stage) || 'reading the reference';
  return { ...v, failed: v.stage, stage: null, label: null, message: `We stopped while ${label.charAt(0).toLowerCase() + label.slice(1)}.`, list: (v.list || []).map(x => (x.state === 'now' ? { ...x, state: 'failed' } : x)) };
}
