// Cut a stretch out of a clip by hand: a noise between two sentences, a cough, a false start no word sits on (session
// report 2, D: "a weird noise before I say join" that no transcript switch could reach). Kept in jobs/<job>/manual-cuts.json
// in SOURCE seconds (the take's own clock), so a redraft that re-cuts the clips still cuts the same stretch. kit/reel.cjs
// reads it on every draft: each cut becomes a jump inside its clip, with the short audio fades every seam has.
//   node kit/manual-cuts.cjs add <job> <clip-id> <from> <to>    clip seconds (as in clips.json words), or --source
//   node kit/manual-cuts.cjs list <job> | clear <job> | noises <job> [clip-id]
// noises: short sounds no word sits on (80 ms to 0.3 s) inside the pauses of each kept clip, from the audio
// (kit/cutpoints.cjs), with the add command that cuts each one.
'use strict';
const fs = require('fs'), path = require('path');
const CP = require('./cutpoints.cjs');
const ROOT = path.dirname(__dirname);
const fileOf = dir => path.join(dir, 'manual-cuts.json');
const r3 = x => +(+x).toFixed(3);
function read(dir) { try { const j = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8')); return Array.isArray(j.cuts) ? j.cuts : []; } catch { return []; } }
function write(dir, cuts) { fs.writeFileSync(fileOf(dir), JSON.stringify({ format: 'aigent-manual-cuts', version: 1, note: 'source seconds of each take; kit/reel.cjs cuts these on every draft', cuts }, null, 1) + '\n'); }
// the clips a job was drafted from (its clips/ or the folder its cut.json plays)
function clipsOf(dir, clipsDir) {
  for (const d of [clipsDir, path.join(dir, 'clips')].filter(Boolean)) { try { return { dir: d, ...JSON.parse(fs.readFileSync(path.join(d, 'clips.json'), 'utf8')) }; } catch {} }
  return null;
}
const takeOf = c => c.take || path.basename(c.file || '');
// add a cut: { clip, from, to } in clip seconds (or source: true for take seconds)
function add(dir, { clip, from, to, source = false, note = '' }, clipsDir) {
  from = +from; to = +to;
  if (!(to > from) || from < 0) throw new Error('from and to: seconds, to after from');
  if (to - from > 30) throw new Error('that is over 30 s; drop the clip instead');
  const cj = clipsOf(dir, clipsDir); if (!cj) throw new Error('no clips.json: draft the job first');
  const c = (cj.clips || []).find(x => x.id === clip); if (!c) throw new Error(`no clip ${clip} (clips: ${(cj.clips || []).map(x => x.id).join(', ')})`);
  const off = source ? 0 : +c.src_in || 0, a = r3(from + off), b = r3(to + off);
  if (!source && (from > +c.dur + 0.05)) throw new Error(`${clip} is ${c.dur} s long`);
  const cuts = read(dir).filter(x => !(x.take === takeOf(c) && x.from === a && x.to === b));
  cuts.push({ take: takeOf(c), from: a, to: b, clip, ...(note ? { note: String(note).slice(0, 120) } : {}), at: new Date().toISOString() });
  cuts.sort((x, y) => x.take.localeCompare(y.take) || x.from - y.from); write(dir, cuts);
  return { take: takeOf(c), from: a, to: b, clip, clipFrom: r3(a - (+c.src_in || 0)), clipTo: r3(b - (+c.src_in || 0)), total: cuts.length };
}
// a clip's manual cuts in clip seconds
function forClip(cuts, c) {
  const s0 = +c.src_in || 0, s1 = c.src_out != null ? +c.src_out : s0 + +c.dur;
  return cuts.filter(m => m.take === takeOf(c) && m.to > s0 && m.from < s1).map(m => [r3(Math.max(0, m.from - s0)), r3(Math.min(+c.dur, m.to - s0))]).filter(([a, b]) => b - a > 0.02);
}
// short non-speech sounds inside the pauses of each kept clip (or one clip)
function noises(dir, clip, clipsDir) {
  const cj = clipsOf(dir, clipsDir); if (!cj) throw new Error('no clips.json: draft the job first');
  const out = [];
  for (const c of (cj.clips || []).filter(x => clip ? x.id === clip : !/^(retake|fragment)/.test(x.status))) {
    const f = path.isAbsolute(c.file) ? c.file : path.join(cj.dir, path.basename(c.file)), env = fs.existsSync(f) ? CP.envelopeSync(f) : null;
    if (!env) continue;
    for (const n of CP.noisesIn(c.words || [], env, [0, env.seconds])) out.push({ clip: c.id, from: n.from, to: n.to, seconds: n.seconds, after: n.after, before: n.before, source: [r3(n.from + (+c.src_in || 0)), r3(n.to + (+c.src_in || 0))], cut: `npm run cut -- add ${path.basename(dir)} ${c.id} ${r3(Math.max(0, n.from - 0.05))} ${r3(n.to + 0.05)}` });
  }
  return out;
}
module.exports = { read, write, add, forClip, noises, fileOf };

if (require.main === module) {
  const a = process.argv.slice(2), [cmd, job] = a, die = m => { console.error('error: ' + m); process.exit(1); };
  if (!cmd || !job) die('use: add <job> <clip> <from> <to> [--source] | list <job> | clear <job> | noises <job> [clip]');
  const dir = path.resolve(ROOT, 'jobs', job); if (!fs.existsSync(dir)) die('no job ' + job);
  try {
    if (cmd === 'add') { const r = add(dir, { clip: a[2], from: a[3], to: a[4], source: a.includes('--source') }); console.log(`cut ${r.clip} ${r.clipFrom}-${r.clipTo} s (take ${r.take} ${r.from}-${r.to} s). ${r.total} cut${r.total === 1 ? '' : 's'} by hand in this job. Draft again to hear it.`); }
    else if (cmd === 'list') { const L = read(dir); if (!L.length) console.log('no cuts by hand'); for (const m of L) console.log(`${m.take} ${m.from}-${m.to} s${m.clip ? ' (' + m.clip + ')' : ''}`); }
    else if (cmd === 'clear') { write(dir, []); console.log('cleared'); }
    else if (cmd === 'noises') { const L = noises(dir, a[2]); if (!L.length) console.log('no short noises in the pauses'); for (const n of L) console.log(`${n.clip} ${n.from}-${n.to} s (${n.seconds} s) between "${n.after}" and "${n.before}": ${n.cut}`); }
    else die('use add, list, clear or noises');
  } catch (e) { die(e.message); }
}
