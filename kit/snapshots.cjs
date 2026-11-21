// Reel snapshots: everything a finished reel was made from, kept beside it, so a later Draft never erases it.
// After every render kit/reel.cjs saves jobs/<job>/reel-vN.build/: cut.json, captions.js, theme.js, fonts and layout
// files, choices.json, clips.json and the clean-up plan. The clips the cut plays (and b-roll inserts and a music file
// of your own) are copied once into jobs/<job>/.media/ and the snapshot's cut.json points there, so a redraft that
// re-cuts the clips cannot change them. "Edit this reel" (Studio, the reopen_reel tool, or the command below) puts a
// snapshot back into build/ (the build it replaces is saved first as draft-<time>.build/), then Render rebuilds it.
//
//   node kit/snapshots.cjs list <job>                  the reels of a job and whether each can be reopened
//   node kit/snapshots.cjs reopen <job> <v3|reel-v3.mp4>
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.dirname(__dirname);
// generated files a rebuild makes again (big, or caches): never copied
const SKIP = /^(base\.mp4|base\.sig|mask.*\.mkv|maskhead\.mkv|boxes\.json)$/i, VID = /\.(mp4|mov|m4v|mkv|webm|wav|mp3|m4a|aac|flac)$/i;
const jobDir = (job, jobs) => path.resolve(jobs || path.join(ROOT, 'jobs'), job);
const vOf = x => { const m = /v(\d+)/.exec(String(x)); return m ? +m[1] : null; };
const snapDir = (dir, v) => path.join(dir, `reel-v${v}.build`);

// copy a media file into <job>/.media once (name, size and time in the name), return its path relative to build/
function stash(dir, build, f) {
  const abs = path.resolve(build, f); let st; try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile()) return null;
  const media = path.join(dir, '.media'), ext = path.extname(abs), base = path.basename(abs, ext).replace(/[^A-Za-z0-9._-]+/g, '-');
  const name = `${base}-${st.size}-${Math.round(st.mtimeMs)}${ext}`, dst = path.join(media, name);
  if (path.dirname(abs) === media) return path.relative(build, abs).split(path.sep).join('/');
  if (!fs.existsSync(dst)) { fs.mkdirSync(media, { recursive: true }); fs.copyFileSync(abs, dst); }
  return path.relative(build, dst).split(path.sep).join('/');
}

// save the build behind a reel: save(<job dir>, <reel file>|null, { name }) -> the snapshot folder
function save(dir, reel, { name } = {}) {
  const build = path.join(dir, 'build'), cutF = path.join(build, 'cut.json');
  if (!fs.existsSync(cutF)) return null;
  const out = name ? path.join(dir, name) : snapDir(dir, vOf(path.basename(reel)));
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const cut = JSON.parse(fs.readFileSync(cutF, 'utf8')), media = [];
  const keep = f => { if (!f || typeof f !== 'string' || /^[a-z]+:/i.test(f)) return f; const r = stash(dir, build, f); if (r) media.push(r); return r || f; };
  for (const s of cut.segs || []) if (s.file) s.file = keep(s.file);
  for (const s of cut.inserts || []) if (s.file) s.file = keep(s.file);
  if (cut.bed && typeof cut.bed === 'string' && fs.existsSync(path.resolve(build, cut.bed)) && !path.resolve(build, cut.bed).startsWith(path.join(ROOT, 'kit'))) cut.bed = keep(cut.bed);
  const used = new Set((cut.segs || []).concat(cut.inserts || []).map(s => s.file));
  for (const f of fs.readdirSync(build)) {
    const p = path.join(build, f);
    if (f === 'cut.json' || SKIP.test(f) || !fs.statSync(p).isFile() || (VID.test(f) && !used.has(f))) continue;
    fs.copyFileSync(p, path.join(out, f));
  }
  fs.writeFileSync(path.join(out, 'cut.json'), JSON.stringify(cut, null, 1));
  for (const [from, to] of [[path.join(dir, 'choices.json'), 'choices.json'], [path.join(dir, 'clips', 'clips.json'), 'clips.json'], [path.join(dir, 'cleanup.json'), 'cleanup.json'], [path.join(dir, 'broll.json'), 'broll.json'], [path.join(dir, 'fx.json'), 'fx.json']])
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(out, to));
  let kit = null; try { kit = require(path.join(ROOT, 'package.json')).version; } catch {}
  const key = process.env.STUDIO_DRAFT_KEY || undefined, footage = process.env.STUDIO_FOOTAGE_KEY || undefined;
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ reel: reel ? path.basename(reel) : null, saved: new Date().toISOString(), kit, media, ...(key ? { key } : {}), ...(footage ? { footage } : {}) }, null, 1) + '\n');
  return out;
}

// the reels of a job: [{ reel, v, snapshot, saved }]
function list(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^reel-v\d+\.mp4$/.test(f)).map(f => { const v = vOf(f), d = snapDir(dir, v), ok = fs.existsSync(path.join(d, 'cut.json'));
    let saved = null; try { saved = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8')).saved; } catch {}
    return { reel: f, v, snapshot: ok ? path.relative(dir, d) : null, saved }; }).sort((a, b) => b.v - a.v);
}

// put a reel's snapshot back into build/, saving the build it replaces first
function reopen(dir, which) {
  const v = vOf(which); if (!v) throw new Error('which reel? v3 or reel-v3.mp4');
  const src = snapDir(dir, v);
  if (!fs.existsSync(path.join(src, 'cut.json'))) throw new Error(`reel-v${v} has no saved build (reels rendered before 1.10.1 were not saved)`);
  const build = path.join(dir, 'build');
  let backup = null;
  if (fs.existsSync(path.join(build, 'cut.json'))) backup = save(dir, null, { name: `draft-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.build` });
  fs.mkdirSync(build, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (['meta.json', 'choices.json', 'clips.json', 'cleanup.json', 'broll.json', 'fx.json'].includes(f)) continue;
    fs.copyFileSync(path.join(src, f), path.join(build, f));
  }
  if (fs.existsSync(path.join(src, 'choices.json'))) fs.copyFileSync(path.join(src, 'choices.json'), path.join(dir, 'choices.json'));
  return { reel: `reel-v${v}.mp4`, build, backup: backup ? path.relative(dir, backup) : null, next: `npm run reel -- --rebuild --name ${path.basename(dir)}` };
}

module.exports = { save, list, reopen, jobDir };

if (require.main === module) {
  // npm run reels -- <job> lists; npm run reopen -- <job> [v3] reopens
  const av = process.argv.slice(2); if (!['list', 'reopen'].includes(av[0])) av.unshift('list');
  const [cmd, job, which] = av;
  const die = m => { console.error('error: ' + m); process.exit(1); };
  if (!cmd || !job) die('use: list <job> | reopen <job> <v3>');
  const dir = jobDir(job);
  if (!fs.existsSync(dir)) die('no job ' + job);
  if (cmd === 'list') { const L = list(dir); if (!L.length) console.log('no reels yet'); for (const r of L) console.log(`${r.reel}  ${r.snapshot ? 'can be reopened (' + r.snapshot + ')' : 'no saved build'}`); }
  else if (cmd === 'reopen') { try { const r = reopen(dir, which); console.log(`${r.reel} is back in ${path.relative(ROOT, r.build)}${r.backup ? ` (the build it replaced: ${r.backup})` : ''}. Edit build/captions.js or build/cut.json, then: ${r.next}`); } catch (e) { die(e.message); } }
  else die('use list or reopen');
}
