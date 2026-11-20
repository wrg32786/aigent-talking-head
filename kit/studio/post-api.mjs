// Studio's Post routes (kit/studio/server.mjs mounts them). The page never sees a key and never calls Buffer, R2 or
// Cloudinary itself: it asks these routes, which run kit/studio/post.mjs in this local server.
//   GET  /api/post            what is set up (key set or not, the host, the reels, the last sends), never a key
//   GET  /api/post/channels   your Buffer channels (cached 2 min; ?fresh=1 to reload)
//   POST /api/post/check      { reel, channels, caption, captions, youtubeTitle } per-channel warnings before a send
//   POST /api/post/host       { host, r2: {...}, cloudinary: {...} } save the host choice and its non-secret fields
//   POST /api/post/host/test  { host } check the host
//   POST /api/post/send       start a send (202 { id }); GET /api/post/send?id= follows it
import * as POST from './post.mjs';
import * as S from './settings.mjs';
import { resolve } from 'path';

export function mount({ ROOT, C, json, readBody }) {
  let cache = null; const sends = new Map(); let seq = 0;
  const channels = async fresh => { if (!fresh && cache && Date.now() - cache.at < 120e3) return cache.v; const v = await POST.channels(); cache = { at: Date.now(), v }; return v; };
  const err = (res, e) => json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message, ...(e.setup ? { setup: e.setup } : {}) });
  async function handle(p, M, u, req, res) {
    try {
      if (p === '/api/post' && M === 'GET') return json(res, 200, POST.status({ job: C.load().job }));
      if (p === '/api/post/channels' && M === 'GET') return json(res, 200, await channels(u.searchParams.has('fresh')));
      if (p === '/api/post/check' && M === 'POST') {
        const b = await readBody(req), s = C.load(), rel = b.reel || POST.reelsOf(s.job)[0];
        const info = rel ? POST.probe(resolve(ROOT, rel)) : null, all = (await channels()).channels, ids = [].concat(b.channels || []);
        return json(res, 200, { info, channels: all.filter(c => ids.includes(c.id)).map(c => ({ id: c.id, ...POST.checkChannel(c, info, { text: (b.captions && b.captions[c.id] != null ? b.captions[c.id] : b.caption) || '', title: b.youtubeTitle }) })) });
      }
      if (p === '/api/post/host' && M === 'POST') {
        const b = await readBody(req), patch = {}; for (const k of ['host', 'r2', 'cloudinary', 'youtubeCategory']) if (b[k] !== undefined) patch[k] = b[k];
        const r = S.update({ post: patch }); if (r.errs.length) return json(res, 400, { error: r.errs.join('; ') });
        return json(res, 200, POST.status({ job: C.load().job }));
      }
      if (p === '/api/post/host/test' && M === 'POST') { const b = await readBody(req); return json(res, 200, await POST.testHost(String(b.host || ''))); }
      if (p === '/api/post/send' && M === 'GET') { const j = sends.get(+u.searchParams.get('id')); return j ? json(res, 200, j) : json(res, 404, { error: 'no such send' }); }
      if (p === '/api/post/send' && M === 'POST') {
        const b = await readBody(req), s = C.load();
        if (b.mode === 'now' && b.confirmNow !== true) return json(res, 400, { error: 'Post now publishes right away. Tick the confirm box first.' });
        POST.preflight(b);
        const id = ++seq, j = { id, status: 'running', phase: 'start', result: null, error: null };
        sends.set(id, j); if (sends.size > 20) sends.delete(Math.min(...sends.keys()));
        POST.send({ ...b, job: s.job }, { onPhase: ph => { j.phase = ph; } })
          .then(r => { j.status = 'done'; j.result = r; }).catch(e => { j.status = 'failed'; j.error = e.message; j.setup = e.setup || null; });
        return json(res, 202, { id });
      }
    } catch (e) { return err(res, e); }
    return false;
  }
  const route = async (p, M, u, req, res) => p === '/api/post' || p.startsWith('/api/post/') ? (await handle(p, M, u, req, res)) !== false : false;
  return { route };
}
