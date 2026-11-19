// Record now: takes filmed in the Studio page with the browser's camera and mic. The page records with MediaRecorder
// (webm in Chrome and Firefox, mp4 in Safari) and sends the recording in small numbered chunks while it films, so a
// long take survives a slow disk or a dropped request. On finish the server converts it to an H.264/AAC mp4 with
// ffmpeg, writes a thumbnail, and the take joins the footage like an uploaded clip.
//   files: inbox/studio/<job>/takes/take-<n>.mp4 and take-<n>.jpg (gitignored, like every Studio upload)
//   state: s.takes = [{ id, file, thumb, seconds, status: recording | converting | ready | failed, kept, error, at }]
import { spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, sep } from 'path';
import * as C from './core.mjs';

const { ROOT } = C;
export const MAX_CHUNK = 64 * 1024 * 1024;      // one chunk; the page sends about one per second
export const MAX_TAKE = 8 * 1024 * 1024 * 1024; // 8 GB, about an hour at high quality
const live = new Map();                          // id -> { raw, next, bytes, mime }
const relOf = p => p.split(sep).join('/');
export const takesDir = s => join('inbox', 'studio', s.job, 'takes');
const extFor = mime => /mp4/i.test(mime || '') ? '.mp4' : /x-matroska/i.test(mime || '') ? '.mkv' : '.webm';
const fmt = sec => { const s = Math.round(sec); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };

// start a take: returns its id; chunks follow with seq 0, 1, 2 ...
export function start(s, { mime, script } = {}) {
  if (!s.job) throw Object.assign(new Error('name the reel first'), { code: 400 });
  const dir = takesDir(s); mkdirSync(join(ROOT, dir), { recursive: true });
  s.takes = s.takes || [];
  const id = Math.max(0, ...s.takes.map(t => t.id)) + 1;
  const raw = relOf(join(dir, `take-${id}.part${extFor(mime)}`));
  writeFileSync(join(ROOT, raw), '');
  live.set(id, { raw, next: 0, bytes: 0, mime: String(mime || '') });
  s.takes.push({ id, raw, file: null, thumb: null, seconds: null, status: 'recording', kept: true, error: null, at: new Date().toISOString(), mime: String(mime || ''),
    // the script it was read from, as it was when filmed: the draft hands it to Whisper so captions spell its words
    script: script && typeof script.text === 'string' && script.text.trim() ? { id: script.id ? String(script.id).slice(0, 64) : null, title: String(script.title || '').slice(0, 120), text: script.text.slice(0, 20000) } : null });
  return id;
}
// append chunk seq of a take. A repeat of a chunk already written is ignored (the page retries on errors);
// a gap is refused so the page resends in order.
export function chunk(id, seq, buf) {
  const t = live.get(id);
  if (!t) throw Object.assign(new Error(`take ${id} is not recording`), { code: 404 });
  if (!Number.isInteger(seq) || seq < 0) throw Object.assign(new Error('seq: 0, 1, 2 ...'), { code: 400 });
  if (seq < t.next) return { ok: true, duplicate: true, next: t.next, bytes: t.bytes };
  if (seq > t.next) throw Object.assign(new Error(`chunk ${seq} arrived before ${t.next}; send ${t.next} first`), { code: 409, next: t.next });
  if (t.bytes + buf.length > MAX_TAKE) throw Object.assign(new Error('take is too long (8 GB)'), { code: 413 });
  appendFileSync(join(ROOT, t.raw), buf);
  t.next++; t.bytes += buf.length;
  return { ok: true, next: t.next, bytes: t.bytes };
}
const run = (cmd, args) => new Promise((ok, bad) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err = (err + d).slice(-4000); });
  p.on('error', bad); p.on('close', code => code === 0 ? ok(out) : bad(new Error(`${cmd} failed: ${err.trim().split('\n').slice(-3).join(' ')}`)));
});
const probe = async f => { const o = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); const d = parseFloat(o); return Number.isFinite(d) ? d : null; };

// finish: convert to mp4 (H.264 + AAC, constant 30 fps, even size, faststart) and make a thumbnail.
// save(fn) applies a change to the session and pushes it to the page; returns the conversion promise.
export function finish(id, { seconds } = {}, save) {
  const t = live.get(id);
  if (!t) throw Object.assign(new Error(`take ${id} is not recording`), { code: 404 });
  live.delete(id);
  if (!t.bytes) { rmSync(join(ROOT, t.raw), { force: true }); save(s => { s.takes = (s.takes || []).filter(x => x.id !== id); }); throw Object.assign(new Error('the take is empty'), { code: 400 }); }
  const base = t.raw.replace(/\.part\.[a-z0-9]+$/, ''), mp4 = base + '.mp4', jpg = base + '.jpg';
  save(s => { const x = (s.takes || []).find(y => y.id === id); if (x) x.status = 'converting'; });
  return (async () => {
    try {
      const src = join(ROOT, t.raw);
      await run('ffmpeg', ['-y', '-v', 'error', '-fflags', '+genpts', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', join(ROOT, mp4)]);
      const dur = (await probe(join(ROOT, mp4))) || +seconds || 0;
      await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(1, dur / 2)), '-i', join(ROOT, mp4), '-frames:v', '1', '-vf', 'scale=320:-2', join(ROOT, jpg)]).catch(() => {});
      rmSync(src, { force: true });
      save(s => {
        const x = (s.takes || []).find(y => y.id === id); if (!x) return;
        Object.assign(x, { status: 'ready', file: relOf(mp4), thumb: existsSync(join(ROOT, jpg)) ? relOf(jpg) : null, seconds: Math.round(dur * 10) / 10, bytes: statSync(join(ROOT, mp4)).size });
        if (x.kept) { if (!s.footage.includes(x.file)) s.footage.push(x.file); s.clips = null; }
        C.applyPatch(s, { reply: `New take recorded: ${fmt(dur)} (take ${id}).`, from: 'Studio', kind: 'action' });
      });
    } catch (e) {
      save(s => { const x = (s.takes || []).find(y => y.id === id); if (x) Object.assign(x, { status: 'failed', error: e.message.slice(0, 400) }); });
    }
  })();
}
// keep (back into the footage) or discard (out of the footage, files deleted)
export function act(s, id, action) {
  const x = (s.takes || []).find(y => y.id === id);
  if (!x) throw Object.assign(new Error(`no take ${id}`), { code: 404 });
  if (action === 'keep') { x.kept = true; if (x.status === 'ready' && !s.footage.includes(x.file)) { s.footage.push(x.file); s.clips = null; } return; }
  if (action === 'unkeep') { x.kept = false; s.footage = s.footage.filter(f => f !== x.file); return; }
  if (action === 'discard') {
    if (x.status === 'recording' || x.status === 'converting') throw Object.assign(new Error('wait until the take is saved'), { code: 409 });
    s.footage = s.footage.filter(f => f !== x.file);
    for (const f of [x.file, x.thumb, x.status === 'failed' ? x.raw : null]) if (f) rmSync(join(ROOT, f), { force: true });
    s.takes = s.takes.filter(y => y.id !== id); return;
  }
  throw Object.assign(new Error('action: keep, unkeep or discard'), { code: 400 });
}
// stop a take without saving (the page was closed or the recorder failed)
export function abort(s, id) {
  const t = live.get(id); live.delete(id);
  if (t) rmSync(join(ROOT, t.raw), { force: true });
  s.takes = (s.takes || []).filter(y => !(y.id === id && y.status === 'recording'));
}
// for MCP and the agent: what was recorded this session
export const list = s => (s.takes || []).map(({ id, file, thumb, seconds, status, kept, error, at, script }) => ({ id, file, thumb, seconds, status, kept, inFootage: !!file && s.footage.includes(file), error, at, script: script ? { id: script.id, title: script.title, text: script.text } : null }));
