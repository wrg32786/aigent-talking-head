// Publish kit routes: a cover still, post copy per platform, and a ZIP beside a finished reel.
// Mounted from kit/studio/server.mjs. No auto-post, no analytics, keys stay local.
//   GET  /api/publish?reel=           the cover, copy and ZIP if they exist
//   POST /api/publish                 { reel, title, t, description, hashtags } make or remake the kit
//   POST /api/publish/copy            { reel, copy } save edited post copy and refresh the ZIP
import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import * as P from '../publish-kit.mjs';
import * as POST from './post.mjs';

// the cover is drawn 9:16 (1080x1920): only the main reel and its 9:16 copy get a kit, never a 4:5 or 1:1 one
const NINE16 = /reel-v\d+(-reels)?\.mp4$/;
const relOf = (ROOT, p) => relative(ROOT, resolve(ROOT, p)).replace(/\\/g, '/');
const okReel = (ROOT, job, path) => {
  if (!path || path.includes('..') || !job) return null;
  const rel = relOf(ROOT, path);
  if (!rel.startsWith(`jobs/${job}/`) || !NINE16.test(rel)) return null;
  return existsSync(join(ROOT, rel)) ? rel : null;
};

export function kitOf(ROOT, rel) {
  const files = P.pathsOf(join(ROOT, rel));
  const has = k => existsSync(files[k]);
  const read = k => { if (!has(k)) return null; try { return JSON.parse(readFileSync(files[k], 'utf8')); } catch { return null; } };
  const copy = read('copyJson');
  // where the cover title sits and whether it came near the face, so the page can say so (onFace, detector off)
  const cm = read('coverMeta'), coverMeta = cm ? { onFace: !!cm.onFace, detector: cm.detector || null } : null;
  return {
    reel: rel,
    srt: has('srt') ? relOf(ROOT, files.srt) : null,
    cover: has('cover') ? relOf(ROOT, files.cover) : null,
    coverV: has('cover') ? Math.round(statSync(files.cover).mtimeMs) : null, // a remade cover shows at once (the img URL changes)
    copyJson: has('copyJson') ? relOf(ROOT, files.copyJson) : null,
    copyTxt: has('copyTxt') ? relOf(ROOT, files.copyTxt) : null,
    zip: has('zip') ? relOf(ROOT, files.zip) : null,
    copy,
    coverMeta,
    ready: has('cover') && has('zip')
  };
}

export function view(s, ROOT) {
  const reels = POST.reelsOf(s.job).filter(r => NINE16.test(r));
  return { reels: reels.map(r => kitOf(ROOT, r)), offer: reels.length > 0 };
}

export function mount({ ROOT, C, json, readBody, view: pageView }) {
  const pick = (s, path) => {
    if (path) {
      const rel = okReel(ROOT, s.job, path);
      if (!rel) throw Object.assign(new Error('no such reel in this job'), { code: 400 });
      return rel;
    }
    return POST.reelsOf(s.job).find(r => NINE16.test(r)) || null;
  };

  async function handle(p, M, u, req, res) {
    const s = C.load();
    if (p === '/api/publish' && M === 'GET') {
      let rel;
      try { rel = pick(s, u.searchParams.get('reel')); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
      if (!rel) return json(res, 400, { error: 'render a reel first' });
      return json(res, 200, kitOf(ROOT, rel));
    }
    if (p === '/api/publish' && M === 'POST') {
      const b = await readBody(req);
      let rel;
      try { rel = pick(s, b.reel); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
      if (!rel) return json(res, 400, { error: 'render a reel first' });
      const buildDir = join(ROOT, rel.replace(/\.mp4$/, '.build'));
      const saved = kitOf(ROOT, rel).copy;
      const title = (b.title && String(b.title).trim()) || (saved && saved.title) || P.titleFromJob(buildDir) || s.job;
      // a remake keeps the copy you saved (only the title changes) unless new copy is sent
      const copy = P.remakeCopy(saved, { title, description: b.description, hashtags: b.hashtags, text: b.text, point: s.point });
      try {
        P.makeKit(join(ROOT, rel), { title, t: b.t, copy, point: s.point });
      } catch (e) {
        return json(res, e.code || 500, { error: e.message, ...(e.fix ? { fix: e.fix } : {}) });
      }
      return json(res, 200, { ...pageView(C.load()), publish: kitOf(ROOT, rel) });
    }
    if (p === '/api/publish/copy' && M === 'POST') {
      const b = await readBody(req);
      let rel;
      try { rel = pick(s, b.reel); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
      if (!rel) return json(res, 400, { error: 'render a reel first' });
      const cur = kitOf(ROOT, rel).copy || P.copyOf({ title: s.job });
      const c = b.copy || {};
      const next = P.copyOf({
        title: c.title ?? cur.title,
        description: c.description ?? c.caption ?? cur.description,
        hashtags: c.hashtags ?? cur.hashtags,
        point: s.point
      });
      try { P.writeCopy(join(ROOT, rel), next); P.zipKit(join(ROOT, rel)); }
      catch (e) { return json(res, 500, { error: e.message }); }
      return json(res, 200, { ...pageView(C.load()), publish: kitOf(ROOT, rel) });
    }
    return false;
  }

  const route = async (p, M, u, req, res) => (p === '/api/publish' || p.startsWith('/api/publish/')) ? (await handle(p, M, u, req, res)) !== false : false;
  return { route, view: s => view(s, ROOT) };
}
