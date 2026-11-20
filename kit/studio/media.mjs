// Footage media for Studio's player and Cut step, cached by file (path, size and time) in jobs/.studio/media/:
//   probe()       length, frame size, codec and bytes (ffprobe)
//   peaks()       the waveform: 1200 loudness peaks from 0 to 1 (ffmpeg decodes a 2 kHz mono copy)
//   proxy()       a 540p H.264 copy for big or browser-unfriendly files, so playback starts at once
//   transcribe()  Whisper word times a chunk at a time (kit/studio/tx_chunks.py), with progress, resumable
// STUDIO_TX swaps the transcriber for a stand-in (the tests); it gets the same <video> <out.json> arguments.
import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve, extname } from 'path';
import { ROOT, STUDIO, stateDir } from './core.mjs';
import { python } from '../setup.mjs';
import CP from '../cutpoints.cjs';

export const mediaDir = () => join(stateDir(), 'media');
const PLAYABLE = ['h264', 'vp8', 'vp9', 'av1'];
export const PROXY_BYTES = 300e6;
const has = c => spawnSync(c, ['-version'], { stdio: 'ignore' }).status === 0;
let tools = null; const ff = () => tools || (tools = { ffmpeg: has('ffmpeg'), ffprobe: has('ffprobe') });

export function keyOf(rel) {
  const abs = resolve(ROOT, rel), st = statSync(abs);
  return createHash('sha1').update(`${abs}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 16);
}
const cacheFile = (rel, ext) => { mkdirSync(mediaDir(), { recursive: true }); return join(mediaDir(), keyOf(rel) + ext); };
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function probe(rel) {
  const f = cacheFile(rel, '.probe.json'), c = readJson(f); if (c) return c;
  const abs = resolve(ROOT, rel), size = statSync(abs).size;
  let out = { duration: null, width: null, height: null, codec: null, audio: null, size };
  if (ff().ffprobe) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', abs], { encoding: 'utf8' });
    try { const j = JSON.parse(r.stdout), v = (j.streams || []).find(s => s.codec_type === 'video'), a = (j.streams || []).find(s => s.codec_type === 'audio');
      out = { duration: +(+j.format.duration).toFixed(2) || null, width: v ? v.width : null, height: v ? v.height : null, codec: v ? v.codec_name : null, audio: a ? a.codec_name : null, size }; } catch {}
  }
  if (out.duration) writeFileSync(f, JSON.stringify(out));
  return out;
}

// a proxy when the file is big or the browser cannot play its codec (HEVC, ProRes, ...)
export function needsProxy(info, rel) { return !!info && (info.size > PROXY_BYTES || (info.codec && !PLAYABLE.includes(info.codec)) || /\.(mkv|avi)$/i.test(extname(rel))); }
const running = new Map();
export function proxyPath(rel) { const f = cacheFile(rel, '.proxy.mp4'); return existsSync(f) ? f : null; }
export function proxy(rel, onDone = () => {}) {
  const f = cacheFile(rel, '.proxy.mp4'); if (existsSync(f)) return { status: 'ready', file: f };
  if (!ff().ffmpeg) return { status: 'unavailable' };
  if (running.has(f)) return { status: 'making' };
  const tmp = f.replace(/\.mp4$/, '.part.mp4');
  const p = spawn('ffmpeg', ['-v', 'error', '-y', '-i', resolve(ROOT, rel), '-vf', "scale=w='min(540,iw)':h='min(540,ih)':force_original_aspect_ratio=increase:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp], { stdio: 'ignore' });
  running.set(f, p);
  p.on('close', c => { running.delete(f); if (c === 0) { renameSync(tmp, f); onDone('ready'); } else { rmSync(tmp, { force: true }); onDone('failed'); } });
  return { status: 'making' };
}

const peakJobs = new Map();
export function peaks(rel, n = 1200) {
  const f = cacheFile(rel, `.peaks${n}.json`), c = readJson(f); if (c) return Promise.resolve(c);
  if (peakJobs.has(f)) return peakJobs.get(f);
  if (!ff().ffmpeg) return Promise.resolve(null);
  const job = new Promise(ok => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', resolve(ROOT, rel), '-vn', '-ac', '1', '-ar', '2000', '-f', 's16le', '-']);
    const bufs = []; p.stdout.on('data', d => bufs.push(d)); p.on('error', () => ok(null));
    p.on('close', () => {
      const b = Buffer.concat(bufs), samples = Math.floor(b.length / 2); if (!samples) return ok(null);
      const per = Math.max(1, Math.floor(samples / n)), out = [];
      for (let k = 0; k < n && k * per < samples; k++) { let m = 0; for (let i = k * per; i < Math.min(samples, (k + 1) * per); i++) { const v = Math.abs(b.readInt16LE(i * 2)); if (v > m) m = v; } out.push(m); }
      const top = Math.max(1, ...out), r = { n: out.length, seconds: +(samples / 2000).toFixed(2), peaks: out.map(v => +(v / top).toFixed(3)) };
      writeFileSync(f, JSON.stringify(r)); ok(r);
    });
  }).finally(() => peakJobs.delete(f));
  peakJobs.set(f, job); return job;
}

// the cached transcript: { file, duration, total, done: [chunks], words: [[start, end, word]] }
export const txFile = rel => cacheFile(rel, '.tx.json');
export function transcript(rel) { const t = readJson(txFile(rel)); return t && t.total && t.done && t.done.length >= t.total ? t : null; }
export function partial(rel) { return readJson(txFile(rel)); }
const txJobs = new Map();
export function transcribing(rel) { return txJobs.has(rel); }
export function transcribe(rel, { onProgress = () => {}, onDone = () => {}, chunk = 120 } = {}) {
  if (txJobs.has(rel)) return { status: 'running' };
  const out = txFile(rel), stand = process.env.STUDIO_TX;
  const [cmd, args] = stand ? [process.execPath, [resolve(ROOT, stand), resolve(ROOT, rel), out, '--chunk', String(chunk)]] : [python(), [join(STUDIO, 'tx_chunks.py'), resolve(ROOT, rel), out, '--chunk', String(chunk)]];
  if (!cmd) { onDone(new Error('Python is missing. Fix: npm run setup:all')); return { status: 'failed' }; }
  const p = spawn(cmd, args, { cwd: ROOT, env: process.env });
  txJobs.set(rel, p);
  let err = '';
  const read = d => { for (const l of String(d).split(/\r?\n/)) { const m = l.match(/^progress (\d+) (\d+)/); if (m) onProgress(+m[1], +m[2]); else if (l.trim()) err = l.trim().slice(0, 300); } };
  p.stdout.on('data', read); p.stderr.on('data', read);
  p.on('error', e => { err = e.message; });
  p.on('close', c => { txJobs.delete(rel); onDone(c === 0 && transcript(rel) ? null : new Error(/faster_whisper/.test(err) ? 'faster-whisper is missing. Fix: npm run setup:all' : err || `transcription stopped (${c})`)); });
  return { status: 'running' };
}
export function stopAll() { for (const p of [...running.values(), ...txJobs.values()]) try { p.kill(); } catch {} }

// the envelope for cut points (kit/cutpoints.cjs): whole band and s/f/th band levels every 5 ms, cached per file
export function energy(rel) {
  const f = cacheFile(rel, '.cut.json'), c = CP.fromJSON(readJson(f)); if (c) return Promise.resolve(c);
  if (peakJobs.has(f)) return peakJobs.get(f);
  if (!ff().ffmpeg) return Promise.resolve(null);
  const job = CP.envelopeOf(resolve(ROOT, rel)).then(env => { if (env) writeFileSync(f, JSON.stringify(CP.toJSON(env))); return env; }).finally(() => peakJobs.delete(f));
  peakJobs.set(f, job); return job;
}
