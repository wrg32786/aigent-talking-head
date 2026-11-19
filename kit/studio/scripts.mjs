// Scripts: what you will say on camera, kept per job next to the Studio session (jobs/.studio/scripts/<job>/, gitignored).
// A script is plain text. Optional markers: a line that is just [hook], [body] or [cta] starts a section, and [pause]
// anywhere is a beat to breathe (the teleprompter holds there). Studio's page, the MCP tools list_scripts, get_script and
// write_script, and the chat all read and write the same files, so a script your agent writes shows up in the page.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stateDir } from './core.mjs';

export const SECTIONS = ['hook', 'body', 'cta'];
export const PAUSE_S = 1.5;
const dirFor = job => join(stateDir(), 'scripts', job || '_unsorted');
const slug = t => String(t || 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'script';
const okId = id => /^[a-z0-9][a-z0-9-]{0,60}$/.test(String(id || ''));

// words, seconds at wpm (pauses add PAUSE_S each), sections and their start times
export function stats(text, wpm = 150) {
  const lines = String(text || '').split(/\r?\n/);
  let words = 0, pauses = 0, t = 0; const sections = [];
  for (const l of lines) {
    const m = l.trim().match(/^\[(hook|body|cta)\]$/i);
    if (m) { sections.push({ name: m[1].toLowerCase(), at: Math.round(t * 10) / 10 }); continue; }
    const p = (l.match(/\[pause\]/gi) || []).length, w = l.replace(/\[[a-z]+\]/gi, ' ').split(/\s+/).filter(x => /[\p{L}\p{N}]/u.test(x)).length;
    words += w; pauses += p; t += (w / wpm) * 60 + p * PAUSE_S;
  }
  return { words, pauses, seconds: Math.round(t), wpm, sections };
}
// the lines a teleprompter shows: [{ text, words, pause, section, at, dur }], timed at wpm
export function cue(text, wpm = 150) {
  const out = []; let t = 0, section = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    const m = l.match(/^\[(hook|body|cta)\]$/i); if (m) { section = m[1].toLowerCase(); continue; }
    const pause = (l.match(/\[pause\]/gi) || []).length, shown = l.replace(/\s*\[pause\]\s*/gi, ' ').trim();
    const words = shown.split(/\s+/).filter(x => /[\p{L}\p{N}]/u.test(x)).length, dur = (words / wpm) * 60 + pause * PAUSE_S;
    out.push({ text: shown, words, pause, section, at: t, dur }); section = null; t += dur;
  }
  return out;
}
const read = (job, id) => { const f = join(dirFor(job), id + '.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
const store = (job, sc) => { const d = dirFor(job); mkdirSync(d, { recursive: true }); const f = join(d, sc.id + '.json'); writeFileSync(f + '.tmp', JSON.stringify(sc, null, 2)); renameSync(f + '.tmp', f); return sc; };
const brief = sc => ({ id: sc.id, title: sc.title, updated: sc.updated, by: sc.by || null, from: sc.from || null, ...stats(sc.text, sc.wpm || 150) });

export function list(job) {
  const d = dirFor(job); if (!existsSync(d)) return [];
  return readdirSync(d).filter(f => f.endsWith('.json')).map(f => { try { return brief(JSON.parse(readFileSync(join(d, f), 'utf8'))); } catch { return null; } })
    .filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}
export function get(job, id) {
  if (!okId(id)) throw Object.assign(new Error('script id: lowercase letters, numbers and dashes'), { code: 400 });
  const sc = read(job, id); if (!sc) throw Object.assign(new Error(`no script ${id}`), { code: 404 });
  return { ...sc, ...stats(sc.text, sc.wpm || 150) };
}
// create (no id) or replace; returns the saved script. by: who wrote it (you, an agent name, a model); from: e.g. a reference url
export function write(job, { id, title, text, wpm, by, from } = {}) {
  if (text != null && typeof text !== 'string') throw Object.assign(new Error('text: a string'), { code: 400 });
  if (String(text || '').length > 60000) throw Object.assign(new Error('script too long (60,000 characters)'), { code: 400 });
  if (wpm != null && !(+wpm >= 60 && +wpm <= 260)) throw Object.assign(new Error('wpm: 60 to 260'), { code: 400 });
  const old = id ? read(job, id) : null;
  if (id && !okId(id)) throw Object.assign(new Error('script id: lowercase letters, numbers and dashes'), { code: 400 });
  let nid = id || slug(title || String(text || '').split('\n').find(l => l.trim() && !/^\[/.test(l.trim())) || 'script');
  if (!id) { const base = nid; for (let k = 2; read(job, nid); k++) nid = `${base}-${k}`; }
  const sc = { id: nid, title: String(title ?? old?.title ?? nid).slice(0, 120), text: text ?? old?.text ?? '', wpm: +(wpm ?? old?.wpm ?? 150),
    by: by ?? old?.by ?? null, from: from ?? old?.from ?? null, created: old?.created || new Date().toISOString(), updated: new Date().toISOString() };
  return { ...store(job, sc), ...stats(sc.text, sc.wpm) };
}
export function remove(job, id) { get(job, id); rmSync(join(dirFor(job), id + '.json'), { force: true }); }
export function duplicate(job, id) { const sc = get(job, id); return write(job, { title: sc.title + ' copy', text: sc.text, wpm: sc.wpm, by: sc.by, from: sc.from }); }
export function rename(job, id, title) { get(job, id); return write(job, { id, title: String(title || '').trim() || id }); }

// The short form of the humanizer rules (skills/humanizer, MIT, blader/humanizer) that Studio's API and local model
// chat follows when it writes a script. Agents run the full skill.
export const HUMANIZER_RULES = [
  'Write like one person talking to one viewer: short spoken sentences, contractions, specific details, plain words.',
  'No staged contrasts ("not X, but Y", "it is not about X, it is about Y") and no one-line closers that repeat the point.',
  'No forced groups of three, no em dashes, no rhetorical question chains, no "here is the thing" or "let that sink in".',
  'No inflated claims (game-changer, revolutionary, unlock, supercharge, elevate, seamless, delve, landscape, journey).',
  'No sales filler or hype; say the fact. No emoji, no hashtags, no bold labels.',
  'Vary sentence length the way speech does. Cut any sentence that adds nothing new.',
];
export const SCRIPT_FORMAT = 'Script format: plain lines to read aloud. Optional section lines [hook], [body], [cta] each alone on a line, and [pause] where the speaker should breathe. Hook in the first 3 seconds. About 150 words a minute, so 30 seconds is about 75 words.';
