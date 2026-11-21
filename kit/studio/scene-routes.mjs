// Studio scene routes: effects and graphics made from a reference or by your agent (kit/scenes.cjs), in the menu with a
// REF badge. GET/POST /api/scenes, GET /api/scenes/<id>, GET /api/scenes/<id>/still.png (rendered once, like a Make
// card), DELETE /api/scenes/<id> (also takes it out of the picks). The server passes its helpers in.
import { existsSync, createReadStream } from 'fs';
import { createRequire } from 'module';
import * as C from './core.mjs';
const SCN = createRequire(import.meta.url)('../scenes.cjs');

export function mountScenes({ json, readBody, update, chromeOk }) {
  const stillBusy = new Map();
  async function sceneStill(id) {
    const sc = SCN.get(id); if (!sc) return null;
    const f = SCN.stillPath(id); if (existsSync(f)) return f;
    if (!chromeOk()) return null;
    if (!stillBusy.has(id)) stillBusy.set(id, (await import('./broll-make.mjs')).sceneStill(SCN.page(sc), { w: sc.box.w * 1080, h: sc.box.h * 1920, seconds: sc.seconds, file: f }).catch(() => null).finally(() => stillBusy.delete(id)));
    await stillBusy.get(id); return existsSync(f) ? f : null;
  }
  async function sceneApi(req, res, p, M) {
    if (p === '/api/scenes' && M === 'GET') return json(res, 200, { scenes: SCN.list().map(({ html, css, ...x }) => ({ ...x, still: C.sceneStillUrl(x.id) })) });
    if (p === '/api/scenes' && M === 'POST') {
      const b = await readBody(req, 6e6), r = SCN.save({ ...(b.scene || b), by: (b.scene || b).by === 'reference' ? 'reference' : 'agent' });
      update(st => C.applyPatch(st, { reply: `${r.added ? 'Added' : 'Already in the menu'}: ${r.scene.name} (${r.scene.kind}), on the Look step with a REF badge.`, from: 'assistant', kind: 'action' }));
      return json(res, 200, { scene: { ...r.scene, still: C.sceneStillUrl(r.scene.id) }, added: r.added });
    }
    const m = p.match(/^\/api\/scenes\/(ref-[a-z0-9-]+)(\/still\.png)?$/); if (!m) return false;
    if (m[2] && M === 'GET') { const f = await sceneStill(m[1]); if (!f) return json(res, 404, { error: 'no still for that scene (it needs Chrome)' }); res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=60' }); return createReadStream(f).pipe(res); }
    if (!m[2] && M === 'GET') { const sc = SCN.get(m[1]); return sc ? json(res, 200, { scene: sc, page: SCN.page(sc) }) : json(res, 404, { error: 'no scene ' + m[1] }); }
    if (!m[2] && M === 'DELETE') { const ok = SCN.remove(m[1]); if (ok) update(st => { const g = st.picks.graphic; if (g) { g.allow = g.allow.filter(x => x !== m[1]); g.deny = g.deny.filter(x => x !== m[1]); } }); return json(res, ok ? 200 : 404, { removed: ok }); }
    return false;
  }
  return sceneApi;
}
