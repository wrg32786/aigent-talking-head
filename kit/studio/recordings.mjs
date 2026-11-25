// Recordings: every take filmed in Studio, across all videos, for the Recording tab.
// Takes live in inbox/studio/<job>/takes/take-<n>.mp4 (record.mjs). A take filmed before any video is named goes to the
// holding folder inbox/studio/_recordings/takes, which is never a video (its name fails JOB_RE). Each finished take has a
// small take-<n>.json beside it ({ seconds, at, script }); older takes without one are read from the saved session or probed once.
// Use in a video moves a held take into the video's own inbox (applyPatch only accepts footage from there) and copies a
// take from another video, so that video keeps its footage.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import * as C from './core.mjs';

const { ROOT } = C;
export const HOLD = '_recordings';
const STUDIO = join('inbox', 'studio');
const FILE_RE = /^inbox\/studio\/([a-z0-9][a-z0-9-]{0,48}|_recordings)\/takes\/take-(\d+)\.mp4$/;
const fail = (msg, code) => { throw Object.assign(new Error(msg), { code }); };
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const probe = f => { try { const d = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8', timeout: 15000 })); return Number.isFinite(d) ? Math.round(d * 10) / 10 : null; } catch { return null; } };
export const sideOf = mp4 => mp4.replace(/\.mp4$/, '.json');
export const writeSide = (mp4, info) => { try { writeFileSync(join(ROOT, sideOf(mp4)), JSON.stringify(info) + '\n'); } catch {} };

// the next free take number in a folder: above every take in the session, every file on disk and every number the folder
// ever gave out (takes/.last), so a take that moved away never has its number reused under an old session's record
export function nextId(s, dir) {
  const abs = join(ROOT, dir), last = join(abs, '.last');
  const onDisk = existsSync(abs) ? readdirSync(abs).map(f => +(f.match(/^take-(\d+)\./) || [])[1] || 0) : [];
  const id = Math.max(0, +(existsSync(last) ? readFileSync(last, 'utf8') : 0) || 0, ...(s.takes || []).map(t => t.id), ...onDisk) + 1;
  mkdirSync(abs, { recursive: true }); writeFileSync(last, String(id));
  return id;
}
// length, date and script of a take: its take-<n>.json, else the session that filmed it, else a probe (then saved)
function infoOf(file, saved) {
  const side = readJson(join(ROOT, sideOf(file))); if (side) return side;
  const t = ((saved && saved.takes) || []).find(x => x.file === file), abs = join(ROOT, file);
  const info = { seconds: (t && t.seconds) || probe(abs), at: (t && t.at) || statSync(abs).mtime.toISOString(), script: t && t.script ? { title: t.script.title, text: t.script.text } : null };
  writeSide(file, info); return info;
}
const takeOf = (id, file, info, extra = {}) => ({ id, raw: null, file, thumb: existsSync(join(ROOT, file.replace(/\.mp4$/, '.jpg'))) ? file.replace(/\.mp4$/, '.jpg') : null, seconds: info.seconds ?? null,
  status: 'ready', kept: true, error: null, at: info.at || new Date().toISOString(), mime: 'video/mp4', script: info.script && info.script.text ? { id: null, title: info.script.title || '', text: info.script.text } : null, ...extra });

// every finished take, newest first
export function list(s) {
  const root = join(ROOT, STUDIO); if (!existsSync(root)) return [];
  const out = [];
  for (const job of readdirSync(root)) {
    const dir = join(root, job, 'takes'); if (!existsSync(dir)) continue;
    const saved = job === s.job ? s : job !== HOLD ? C.savedVideo(job) : null;
    for (const f of readdirSync(dir)) {
      if (!/^take-\d+\.mp4$/.test(f)) continue;
      const file = `inbox/studio/${job}/takes/${f}`, info = infoOf(file, saved);
      // a take copied in from another video stands for its original here
      const copy = (s.takes || []).find(x => x.source === file && (s.footage || []).includes(x.file));
      const jpg = file.replace(/\.mp4$/, '.jpg');
      out.push({ file, thumb: existsSync(join(ROOT, jpg)) ? jpg : null, job: job === HOLD ? null : job, seconds: info.seconds ?? null, at: info.at || null,
        script: info.script && info.script.title ? info.script.title : null, inVideo: !!copy || (job === s.job && (s.footage || []).includes(file)) });
    }
  }
  return out.sort((a, b) => (Date.parse(b.at || 0) || 0) - (Date.parse(a.at || 0) || 0));
}

// the take's folder name, or a 404 when the path is not a take on disk
export function found(file) {
  const m = String(file || '').match(FILE_RE);
  if (!m || !existsSync(join(ROOT, file))) fail('That recording is not there any more.', 404);
  return m;
}
// put a take into the open video's footage. Held takes move; another video's takes are copied (once: using it again
// reuses the copy). When the footage change resets the edit, the chat says so, like any new footage
export function use(s, file) {
  const m = found(file);
  if (!s.job) fail('Name the video first.', 400);
  const add = f => { const r = C.addFootage(s, f); if (r.reset) C.applyPatch(s, { reply: r.note, from: 'Studio', kind: 'action' }); return r; };
  const from = m[1];
  if (from === s.job) {
    const t = (s.takes || []).find(x => x.file === file);
    if (t) t.kept = true; else (s.takes = s.takes || []).push(takeOf(nextId(s, join(STUDIO, s.job, 'takes')), file, infoOf(file, s)));
    return add(file);
  }
  const copied = (s.takes || []).find(x => x.source === file && existsSync(join(ROOT, x.file)));
  if (copied) { copied.kept = true; return add(copied.file); }
  const dir = join(STUDIO, s.job, 'takes'), saved = from !== HOLD ? C.savedVideo(from) : null;
  const id = nextId(s, dir), base = `inbox/studio/${s.job}/takes/take-${id}`, src = file.replace(/\.mp4$/, '');
  const info = infoOf(file, saved);
  const put = from === HOLD ? renameSync : copyFileSync;
  put(join(ROOT, file), join(ROOT, base + '.mp4'));
  if (existsSync(join(ROOT, src + '.jpg'))) put(join(ROOT, src + '.jpg'), join(ROOT, base + '.jpg'));
  writeSide(base + '.mp4', info);
  if (from === HOLD) rmSync(join(ROOT, src + '.json'), { force: true });
  // a held take filmed in this session leaves the session's list; the moved one joins it
  s.takes = (s.takes || []).filter(t => t.file !== file);
  s.takes.push(takeOf(id, base + '.mp4', info, from === HOLD ? {} : { source: file }));
  return add(base + '.mp4');
}
