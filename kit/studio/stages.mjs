// Studio stages: where a reference breakdown is, in plain words. The download and the teardown print lines as they
// go; stageOf reads one line and names the stage it starts, feed keeps a small run record ({ stage, done, failed }),
// and view turns that into what the page shows: one live line, a list with a check per finished stage and a percent
// for the bar. Pure: no files, and the clock is handed in (now, in ms), so the same record survives a page reload from
// the saved state. Each stage keeps when it started and how long it took, so the page can say "Reading graphics,
// 1 min 20 s" and nobody has to ask whether it is stuck.

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
  { id: 'colours', label: 'Reading colors', w: 6 },
  { id: 'recipe', label: 'Putting it together', w: 4 },
];
const IDS = STAGES.map(x => x.id), AT = Object.fromEntries(IDS.map((id, i) => [id, i]));
export const stageLabel = id => (STAGES[AT[id]] || {}).label || null;

// The stage a log line starts, or null. Our own scripts print "stage <id>" (kit/teardown.mjs, kit/teardown.py); the
// other patterns read the lines older runs and the tools themselves print, so a custom teardown still moves the bar.
const READS = [
  [/^stage ([a-z]+)\b/, m => (m[1] in AT ? m[1] : null)],
  [/^progress \d+%/, () => 'download'],
  [/^\$ node kit[\\/]studio[\\/]fetch\.mjs\b/, () => 'download'],
  // the tool lines carry whole paths: on Windows those have backslashes, a drive letter and often a space
  // ("D:\AIgent Studio\...", "C:\Program Files\..."), with or without quotes
  [/^> (?:.*[\\/])?"?rea-video(?:\.exe)?"? decompose\b/, () => 'cuts'],
  [/^> .*teardown\.py"? analyze\b/, () => 'cuts'],
  [/^Teardown: /, () => 'done'],
];
export function stageOf(line) {
  const l = String(line || '').trim();
  for (const [re, f] of READS) { const m = re.exec(l); if (m) return f(m); }
  return null;
}

export const newRun = () => ({ stage: null, done: [], failed: null, at: {}, took: {} });
// the stage that is running stops the clock: how long it took, in seconds
function close(run, now) {
  if (!run.at) run.at = {}; if (!run.took) run.took = {};
  if (run.stage && now != null && run.at[run.stage] != null) run.took[run.stage] = Math.max(0, Math.round((now - run.at[run.stage]) / 1000));
}
// seconds as plain words: 45 s, 1 min 20 s, 12 min
export function tookWords(sec) {
  const s = Math.max(0, Math.round(+sec || 0)), m = Math.floor(s / 60);
  return m < 1 ? `${s} s` : m >= 10 || s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}

// one line in: the record moves on when the line starts a later stage. A stage that starts closes every stage before
// it (a stage with nothing to do is skipped, which is done). It never goes back. Returns true when something changed.
export function feed(run, line, now = null) {
  const id = stageOf(line);
  if (!id) return false;
  if (id === 'done') return finish(run, now);
  const cur = run.stage ? AT[run.stage] : -1;
  if (AT[id] <= cur) return false;
  close(run, now);
  run.stage = id; run.failed = null; if (now != null) run.at[id] = now;
  run.done = IDS.slice(0, AT[id]);
  return true;
}
export function finish(run, now = null) {
  if (!run.stage && run.done.length === IDS.length) return false;
  close(run, now);
  run.stage = null; run.failed = null; run.done = IDS.slice();
  return true;
}
// the run stopped: the stage it was on is the one that failed
export function fail(run, now = null) { close(run, now); run.failed = run.stage || run.failed || IDS[Math.min(run.done.length, IDS.length - 1)]; run.stage = null; return true; }

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
  const took = r.took || {}, at = r.at || {};
  // took: seconds, on a stage that ran and ended (a skipped stage has none)
  const list = STAGES.filter(s => !skip.includes(s.id)).map(s => ({ id: s.id, label: s.label, state: r.failed === s.id ? 'failed' : r.done.includes(s.id) ? 'done' : r.stage === s.id ? 'now' : 'todo', ...(took[s.id] != null ? { took: took[s.id] } : {}) }));
  const failed = r.failed ? stageLabel(r.failed) : null;
  const starts = Object.values(at).filter(Number.isFinite);
  // since: when the stage that is running started (ms), so the page can count up; started: when the whole read did
  return { stage: r.stage, label: r.stage ? stageLabel(r.stage) : null, failed: r.failed, message: failed ? `We stopped while ${failed.charAt(0).toLowerCase() + failed.slice(1)}${took[r.failed] != null ? `, after ${tookWords(took[r.failed])}` : ''}.` : null, percent: percent(r, part), list,
    ...(r.stage && at[r.stage] != null ? { since: at[r.stage] } : {}), ...(starts.length ? { started: Math.min(...starts) } : {}) };
}

// a saved view whose run died with Studio (a restart mid breakdown): the stage it was on is the one that stopped
export function failView(v) {
  if (!v || !v.stage) return v;
  const label = stageLabel(v.stage) || 'reading the reference';
  const { since, ...rest } = v; v = rest;
  return { ...v, failed: v.stage, stage: null, label: null, message: `We stopped while ${label.charAt(0).toLowerCase() + label.slice(1)}.`, list: (v.list || []).map(x => (x.state === 'now' ? { ...x, state: 'failed' } : x)) };
}
