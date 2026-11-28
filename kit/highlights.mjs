// Highlight moments in a long talk or podcast. Pure helpers plus a CLI:
//   npm run highlights -- <video> [--n 10] [--min 20] [--max 60] [--words words.json] [--json]
// Transcribes locally with the kit's Whisper (.venv), splits on sentence ends (never mid-word or mid-sentence),
// and scores up to N complete moments with a reason and start time. An agent can replace those scores (applyScores);
// the local rules are the fallback. Studio and the MCP tools share this file.
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { dirname, join, resolve, basename, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { sentences, candidates, defaultOutput, textIn } from './studio/cut.mjs';
import { python } from './setup.mjs';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);

// a file this long (seconds) is offered the Highlights view on Start; shorter takes still work if you ask
export const LONG_MIN = 180;
export const DEFAULT_N = 10;
export const DEFAULT_MIN = 20;
export const DEFAULT_MAX = 60;
export const MAX_N = 20;

const END = /[.?!]["')\]]*$/;

export const isLong = seconds => +seconds >= LONG_MIN;

// clamp n, min and max: 1 to 20 clips, each at least 5 s, max not below min
export function options(p = {}) {
  const n = Math.round(p.n == null ? DEFAULT_N : +p.n);
  const min = Math.round(p.min == null ? DEFAULT_MIN : +p.min);
  const max = Math.round(p.max == null ? DEFAULT_MAX : +p.max);
  const errs = [];
  if (!(n >= 1 && n <= MAX_N)) errs.push(`n: 1 to ${MAX_N}`);
  if (!(min >= 5 && min <= 7200)) errs.push('min: 5 to 7200 seconds');
  if (!(max >= 5 && max <= 7200)) errs.push('max: 5 to 7200 seconds');
  if (!errs.length && max < min) errs.push('max must be at least min');
  return { n: Math.max(1, Math.min(MAX_N, n || DEFAULT_N)), min: min || DEFAULT_MIN, max: max || DEFAULT_MAX, goal: p.goal === 'ad' ? 'ad' : 'organic', point: p.point || '', errs };
}

// snap a [start, end] onto whole sentences: never start or end mid-sentence or mid-word.
// null when the range is entirely outside the talk, or is not a real interval (so a bad time is not the whole take)
export function snapToSentences(start, end, S, dur) {
  const a = +start, b = +end;
  if (!isFinite(a) || !isFinite(b) || b <= a) return null;
  if (!S || !S.length) {
    const from = +Math.max(0, a).toFixed(2), to = +Math.min(dur == null ? b : dur, b).toFixed(2);
    return to > from ? [from, to] : null;
  }
  // the same 0.12 s breath before and after as the rules' own clips (kit/studio/cut.mjs), and a tolerance above it, so a
  // rules clip's own start and end sent back come out the same and never pull in the next sentence
  const PAD = 0.12, TOL = 0.15, first = S[0].start, last = S[S.length - 1].end;
  if (b <= first + TOL || a >= last - TOL) return null;
  let i = -1, j = -1;
  for (let k = 0; k < S.length; k++) { if (S[k].end > a + TOL) { i = k; break; } }
  for (let k = S.length - 1; k >= 0; k--) { if (S[k].start < b - TOL) { j = k; break; } }
  if (i < 0 || j < 0 || j < i) return null;
  const from = +Math.max(0, S[i].start - PAD).toFixed(2), to = +Math.min(dur == null ? Infinity : dur, S[j].end + PAD).toFixed(2);
  return to > from ? [from, to] : null;
}

// from Whisper word times [[start, end, word], ...]: up to n highlight clips, each a complete thought
export function fromWords(words, p = {}) {
  const opt = options(p);
  if (opt.errs.length) throw Object.assign(new Error(opt.errs.join('; ')), { code: 400, errs: opt.errs });
  const S = sentences(words);
  const dur = p.duration || (words && words.length ? words[words.length - 1][1] : 0);
  // run the Cut scorer at each short-form length, then keep the best non-overlapping windows inside [min, max]
  const bags = [];
  for (const length of ['short', 'medium', 'long']) {
    const o = defaultOutput();
    Object.assign(o, { format: 'short', kind: 'clips', length, clips: opt.n * 2, goal: opt.goal });
    bags.push(...candidates(words, o, { duration: dur, point: opt.point }).filter(c => c.kind === 'clip'));
  }
  const seen = new Set(), all = [];
  for (const c of bags) {
    const a = c.ranges[0][0], b = c.ranges[0][1], d = b - a;
    if (d < opt.min * 0.9 || d > opt.max * 1.1) continue;
    const key = a.toFixed(1) + '-' + b.toFixed(1);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(c);
  }
  all.sort((x, y) => y.score - x.score || x.ranges[0][0] - y.ranges[0][0]);
  const picked = [];
  for (const c of all) {
    if (picked.length >= opt.n) break;
    const [a, b] = c.ranges[0];
    if (picked.some(x => a < x.ranges[0][1] && b > x.ranges[0][0])) continue;
    picked.push(c);
  }
  const list = picked.map((c, k) => ({
    id: 'h' + (k + 1), kind: 'highlight', label: 'Highlight ' + (k + 1),
    start: +c.ranges[0][0].toFixed(2), end: +c.ranges[0][1].toFixed(2), ranges: c.ranges,
    seconds: +(+c.seconds).toFixed(2), score: c.score, reason: c.reason, text: c.text, keep: false,
    ...(c.from != null ? { from: c.from, to: c.to } : {}),
  }));
  return { duration: +(+dur).toFixed(2), n: opt.n, min: opt.min, max: opt.max, goal: opt.goal,
    sentences: S.map(s => ({ i: s.i, start: s.start, end: s.end, text: s.text })), candidates: list, scoredBy: 'rules' };
}

export function applyScores(current, scores, { duration, words } = {}) {
  if (!Array.isArray(scores) || !scores.length) throw Object.assign(new Error('scores: [{ id or start and end, score, reason }, ...]'), { code: 400 });
  const S = current.sentences || sentences(words);
  const dur = duration || current.duration;
  const byId = Object.fromEntries((current.candidates || []).map(c => [c.id, c]));
  const maxSec = (current.max || DEFAULT_MAX) * 1.1, minSec = (current.min || DEFAULT_MIN) * 0.9;
  const out = [];
  let skipped = 0;
  for (const raw of scores) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    let start, end, id = raw.id ? String(raw.id) : null, base = id && byId[id];
    if (base) { start = base.start; end = base.end; }
    else if (raw.start != null && raw.end != null) {
      const snap = snapToSentences(raw.start, raw.end, S, dur);
      if (!snap) { skipped++; continue; }
      [start, end] = snap;
      // a clip sent back by its times is that clip: it keeps its id and the user's tick
      const same = (current.candidates || []).find(c => c.start === start && c.end === end);
      if (same) { base = same; id = same.id; }
    } else { skipped++; continue; }
    const score = Math.max(0, Math.min(100, Math.round(+raw.score || 0)));
    const reason = String(raw.reason || (base && base.reason) || 'Scored by your agent').replace(/\u2014/g, ', ').slice(0, 200);
    const text = (base && base.text) || textIn(words, [[start, end]]);
    const seconds = +(end - start).toFixed(2);
    if (seconds < 0.5) { skipped++; continue; }
    if (!base && (seconds < minSec || seconds > maxSec)) { skipped++; continue; }
    out.push({ id: id && byId[id] ? id : null, kind: 'highlight', label: null, start, end, ranges: [[start, end]], seconds, score, reason, text, keep: base ? !!base.keep : false, from: base && base.from, to: base && base.to });
  }
  // ticks the user already made stay if the agent did not mention those clips
  for (const c of current.candidates || []) {
    if (!c.keep) continue;
    if (out.some(x => x.id === c.id || (x.start === c.start && x.end === c.end))) continue;
    out.push({ ...c });
  }
  out.sort((a, b) => b.score - a.score || a.start - b.start);
  const used = new Set();
  const candidates = out.map((c, k) => {
    let id = c.id && !used.has(c.id) ? c.id : null;
    if (!id) { let n = 1; while (used.has('h' + n)) n++; id = 'h' + n; }
    used.add(id);
    return { ...c, id, label: 'Highlight ' + (k + 1) };
  });
  return { ...current, candidates, scoredBy: 'agent', skipped };
}

export function setKeep(current, ids, keep = true) {
  const want = new Set([].concat(ids || []));
  return { ...current, candidates: (current.candidates || []).map(c => want.has(c.id) ? { ...c, keep: !!keep } : c) };
}

export const keptOf = current => (current.candidates || []).filter(c => c.keep);

// the brief the page copies for the user's agent (no terminal commands)
export function briefOf(current, { job } = {}) {
  const c = current.candidates || [];
  const lines = c.map(x => `- ${x.id}: ${x.start.toFixed(2)}s to ${x.end.toFixed(2)}s (${Math.round(x.seconds)} s, score ${x.score}). ${x.reason}. "${x.text}"`);
  return [
    'Please score the highlight moments of this talk, then pick the ones I should use as my take.',
    job ? `The Studio job is ${job}.` : '',
    'Use the find_highlights, get_highlights, score_highlights and pick_highlights tools. Stay on sentence boundaries. Score a candidate by its id (h1, h2 ...); send start and end only for a new moment. Do not post anything.',
    c.length ? 'Current candidates:\n' + lines.join('\n') : 'Run find_highlights first if there are no candidates yet.',
  ].filter(Boolean).join('\n\n');
}

// load words from a Whisper words.json ({ "file.mp4": [[s,e,w], ...] }) or a transcript { words }
export function wordsFrom(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.words)) return j.words;
  const vals = Object.values(j).filter(Array.isArray);
  if (vals.length) return vals[0];
  throw new Error('no word times in ' + file);
}

// CLI transcript cache: the file name, size and mtime, so two talks called take.mp4 do not share a transcript
export function cacheFile(video) {
  const st = statSync(video);
  const stem = basename(video).replace(/\.[^.]+$/, '');
  return join(ROOT, 'jobs', '.highlights', `${stem}-${st.size}-${Math.round(st.mtimeMs)}.tx.json`);
}

function durationOf(video) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' });
  return r.status === 0 ? +(+r.stdout).toFixed(2) : null;
}

function transcribeFile(video, outFile) {
  const py = python();
  if (!py) throw Object.assign(new Error('Python is missing, so we cannot transcribe yet.'), { fix: 'python' });
  mkdirSync(dirname(outFile), { recursive: true });
  const script = join(ROOT, 'kit', 'studio', 'tx_chunks.py');
  const r = spawnSync(py, [script, video, outFile, '--chunk', '120'], { cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 0 });
  if (r.status !== 0) {
    const err = String(r.stderr || r.stdout || 'transcription failed').trim().split('\n').pop();
    if (/faster_whisper/.test(err)) throw Object.assign(new Error('The Python tools for transcribing (faster-whisper) are missing.'), { fix: 'python' });
    throw new Error(err || 'transcription failed');
  }
  const t = JSON.parse(readFileSync(outFile, 'utf8'));
  if (!t || !Array.isArray(t.words)) throw new Error('transcription wrote no words');
  return t;
}

// CLI
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const argv = process.argv.slice(2);
  const flag = k => argv.includes('--' + k);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const JSON_OUT = flag('json');
  const die = m => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: m })); else console.error(m); process.exit(1); };
  const pos = argv.find((a, i) => !a.startsWith('--') && !(i && ['n', 'min', 'max', 'words', 'goal', 'point', 'out'].includes(argv[i - 1].replace(/^--/, ''))));
  if (!pos) die('Usage: npm run highlights -- <video> [--n 10] [--min 20] [--max 60] [--words file.json] [--json]');
  const video = isAbsolute(pos) ? pos : resolve(process.cwd(), pos);
  if (!existsSync(video) && !opt('words')) die('no such file: ' + pos);
  const optn = options({ n: opt('n'), min: opt('min'), max: opt('max'), goal: opt('goal'), point: opt('point') });
  if (optn.errs.length) die(optn.errs.join('; '));
  let words, duration = null;
  if (opt('words')) { words = wordsFrom(resolve(opt('words'))); duration = words.length ? words[words.length - 1][1] : 0; }
  else {
    duration = durationOf(video);
    const cache = cacheFile(video);
    if (existsSync(cache)) { try { const t = JSON.parse(readFileSync(cache, 'utf8')); if (t && t.words) words = t.words; } catch {} }
    if (!words) {
      if (!JSON_OUT) console.error('transcribing ' + basename(video) + ' locally with Whisper...');
      const t = transcribeFile(video, cache);
      words = t.words; if (t.duration) duration = t.duration;
    }
  }
  const found = fromWords(words, { ...optn, duration: duration || undefined });
  const out = { ok: true, source: pos, ...found };
  if (opt('out')) writeFileSync(opt('out'), JSON.stringify(out, null, 2));
  if (JSON_OUT) console.log(JSON.stringify(out));
  else {
    console.log(`${found.candidates.length} highlight${found.candidates.length === 1 ? '' : 's'} in ${found.duration || '?'} s (${found.scoredBy}):`);
    for (const c of found.candidates) console.log(`  ${c.id}  ${c.start.toFixed(1)}-${c.end.toFixed(1)}s  ${Math.round(c.seconds)}s  ${c.score}  ${c.reason}\n    ${c.text}`);
  }
}
