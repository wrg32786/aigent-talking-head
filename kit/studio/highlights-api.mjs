// Studio highlight routes: find moments in a long talk, let the user or their agent pick, and extract them as the take.
// Mounted from kit/studio/server.mjs. Scoring lives in kit/highlights.mjs (local rules, or scores from the agent).
//   GET  /api/highlights              current candidates, transcript status, the brief
//   POST /api/highlights/find         { path?, n, min, max, goal } transcribe if needed, then score with the local rules
//   POST /api/highlights/score        { scores: [{ id or start, end, score, reason }] } from the agent
//   POST /api/highlights/keep         { ids, keep } tick or untick clips
//   POST /api/highlights/pick         { ids? } extract kept (or these) ids as the take, already trimmed
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as H from '../highlights.mjs';
import * as MEDIA from './media.mjs';
import * as C from './core.mjs';

const stillThere = (ROOT, path) => !!(path && !path.includes('..') && existsSync(join(ROOT, path)));
const cutSource = (s, path, okFootage, ROOT) => {
  if (path && (okFootage(s, path) || stillThere(ROOT, path))) return path;
  if (s.highlights && stillThere(ROOT, s.highlights.source)) return s.highlights.source;
  return (s.footage || []).find(f => okFootage(s, f)) || null;
};

function empty(source = null) {
  return { source, duration: null, n: H.DEFAULT_N, min: H.DEFAULT_MIN, max: H.DEFAULT_MAX, goal: 'organic',
    sentences: null, candidates: [], scoredBy: null, pending: null, usedAsTake: false, originalFootage: null };
}

export function view(s, { okFootage, durOf } = {}) {
  const h = s.highlights || empty();
  const source = h.source || (s.footage || [])[0] || null;
  const duration = source && durOf ? durOf(source) : h.duration;
  const tx = source ? ((s.tx || {})[source] || (MEDIA.transcript(source) ? { status: 'ready' } : null)) : null;
  const long = H.isLong(duration);
  return { ...h, source, duration, tx, long, brief: H.briefOf(h, { job: s.job }), offer: !!(source && (long || (h.candidates || []).length)) };
}

export function mount({ ROOT, C: Core, update, json, readBody, view: pageView, startTranscribe, okFootage, durOf, runTask, pushState }) {
  const srcOf = (s, path) => cutSource(s, path, okFootage, ROOT);
  const save = (s, patch) => { s.highlights = { ...(s.highlights || empty()), ...patch, at: Date.now() }; };

  function findOn(rel, opts) {
    const words = (MEDIA.transcript(rel) || {}).words;
    if (!words || !words.length) throw Object.assign(new Error('transcribe the footage first'), { code: 400 });
    const duration = durOf(rel);
    const found = H.fromWords(words, { ...opts, duration, point: Core.load().point });
    update(x => save(x, { source: rel, ...found, pending: null, usedAsTake: false }));
    return found;
  }

  async function handle(p, M, u, req, res) {
    const s = Core.load();
    if (p === '/api/highlights' && M === 'GET') return json(res, 200, view(s, { okFootage, durOf }));

    if (p === '/api/highlights/find' && M === 'POST') {
      const b = await readBody(req), rel = srcOf(s, b.path);
      if (!rel) return json(res, 400, { error: 'add footage first' });
      if (!s.job) return json(res, 400, { error: 'name the reel first' });
      const opt = H.options({ n: b.n, min: b.min, max: b.max, goal: b.goal, point: s.point });
      if (opt.errs.length) return json(res, 400, { error: opt.errs.join('; ') });
      update(x => save(x, { source: rel, n: opt.n, min: opt.min, max: opt.max, goal: opt.goal, pending: 'transcript', candidates: (x.highlights && x.highlights.source === rel) ? x.highlights.candidates : [] }));
      const fail = e => update(x => { if (x.highlights && x.highlights.source === rel) { x.highlights.pending = null; x.highlights.error = e.message; } });
      if (!MEDIA.transcript(rel)) {
        startTranscribe(rel, () => { try { findOn(rel, opt); } catch (e) { fail(e); } }, fail);
        return json(res, 202, { transcribing: true, ...pageView(Core.load()) });
      }
      try { findOn(rel, opt); }
      catch (e) { fail(e); return json(res, e.code || 500, { error: e.message, ...pageView(Core.load()) }); }
      return json(res, 200, { scorer: 'rules', ...pageView(Core.load()) });
    }

    if (p === '/api/highlights/score' && M === 'POST') {
      const b = await readBody(req), cur = s.highlights;
      if (!cur || !(cur.candidates || []).length) return json(res, 400, { error: 'find highlights first' });
      const rel = cur.source, words = rel ? ((MEDIA.transcript(rel) || {}).words) : null;
      let next;
      try { next = H.applyScores(cur, b.scores, { words, duration: cur.duration }); }
      catch (e) { return json(res, e.code || 400, { error: e.message }); }
      if (b.by) next.scoredBy = String(b.by).slice(0, 80);
      update(x => save(x, { ...next, pending: null, error: null }));
      return json(res, 200, pageView(Core.load()));
    }

    if (p === '/api/highlights/keep' && M === 'POST') {
      const b = await readBody(req), cur = s.highlights;
      if (!cur) return json(res, 400, { error: 'find highlights first' });
      const ids = [].concat(b.ids || (b.id ? [b.id] : []));
      if (!ids.length) return json(res, 400, { error: 'ids: one or more highlight ids' });
      update(x => save(x, H.setKeep(x.highlights, ids, b.keep !== false)));
      return json(res, 200, pageView(Core.load()));
    }

    if (p === '/api/highlights/pick' && M === 'POST') {
      const b = await readBody(req), cur = s.highlights;
      if (!s.job) return json(res, 400, { error: 'name the reel first' });
      if (!cur || !cur.source) return json(res, 400, { error: 'find highlights first' });
      const ids = [].concat(b.ids || H.keptOf(cur).map(c => c.id));
      const picks = (cur.candidates || []).filter(c => ids.includes(c.id));
      if (!picks.length) return json(res, 400, { error: 'tick at least one highlight, or pass ids' });
      const src = cur.source, dir = `inbox/studio/${s.job}/highlights`;
      mkdirSync(join(ROOT, dir), { recursive: true });
      const files = picks.map(c => `${dir}/${c.id}.mp4`);
      const steps = picks.map((c, i) => ['kit/studio/cut-run.mjs', ['extract', '--src', src, '--ranges', `${c.start}-${c.end}`, '--out', files[i]]]);
      const original = (cur.originalFootage && cur.originalFootage.length) ? cur.originalFootage : (s.footage || []).slice();
      try {
        runTask('highlights', () => steps, () => {
          const missing = files.filter(f => !existsSync(join(ROOT, f)));
          if (missing.length) throw new Error('could not extract ' + missing.map(f => f.split('/').pop()).join(', '));
          update(st => {
            const stamp = C.draftStamp(st), had = C.hasEdit(st);
            st.footage = files.slice();
            st.clips = null;
            C.onFootageAdded(st, { hadEdit: had, stamp });
            st.asIs = true;
            save(st, { usedAsTake: true, originalFootage: original, picked: picks.map(c => c.id) });
          });
          if (pushState) pushState();
          return { files, ids: picks.map(c => c.id) };
        });
      } catch (e) {
        return json(res, e.code || 500, { error: e.message });
      }
      return json(res, 202, pageView(Core.load()));
    }

    return false;
  }

  const route = async (p, M, u, req, res) => (p === '/api/highlights' || p.startsWith('/api/highlights/')) ? (await handle(p, M, u, req, res)) !== false : false;
  return { route, view: s => view(s, { okFootage, durOf }) };
}

