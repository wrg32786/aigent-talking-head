// Studio's Vault routes (kit/studio/broll-api.mjs mounts them under /api/vault). The page and the MCP tools use the
// same routes, and the bodies are checked against kit/studio/vault-schema.mjs.
//   GET  /api/vault            the grid: items (search_vault's filters), the tag chips, how full it is, the last delete
//   GET  /api/vault/file       an item's file, thumbnail (thumb=1), frame (frame=n) or capture part (part=og|top|full|scroll)
//   POST /api/vault/upload     a file (the raw body; name, title, tags, brand, rights in the query)
//   POST /api/vault/link       a link (capture_link's body; wait: true answers when the capture is done)
//   POST /api/vault/item       { id, action: update | delete | undo, name, tags, brand, rights, describe }
// No network call is made here except the visit to a link someone added.
import { existsSync } from 'fs';
import { join } from 'path';
import * as V from './vault.mjs';
import * as M from './vault-match.mjs';
import * as S from './settings.mjs';
import { check, fromQuery } from './vault-schema.mjs';

const bad = (m, code = 400) => Object.assign(new Error(m), { code });
export const picturesOn = () => S.loadFile().broll.vaultPictures === true;
export function list(a = {}) {
  V.purge();
  const all = V.load(), items = V.search(a.q || '', a), u = V.usage(), last = all.trash[0];
  return { items: items.slice(0, a.limit > 0 ? a.limit : 400).map(it => V.brief(it)), count: items.length, total: all.items.length, tags: V.topTags(all.items), kinds: V.KINDS, sources: V.FROM, rights: V.RIGHTS_LABEL,
    usage: { ...u, line: u.full ? 'Your Vault is full. Delete something you do not use.' : u.near ? 'Your Vault is nearly full.' : null },
    stale: all.items.filter(it => V.stale(it)).length, undo: last ? { id: last.id, name: last.name } : null };
}
// ctx: { json, readBody, serveFile, rawToFile, capture (or null when Chrome is missing or capture is off), changed(),
//        dropSlots(id), offer(slot, item, by), briefOf(slot n), by(name) }
export async function handle(ctx, p, Mth, u, req, res) {
  const { json, readBody } = ctx, q = k => u.searchParams.get(k);
  if (p === '/api/vault' && Mth === 'GET') {
    const a = check('search_vault', fromQuery('search_vault', u.searchParams));
    if (a.slot == null) return json(res, 200, { ...list(a), capture: !!ctx.capture, pictures: picturesOn() });
    // ranked for one slot's brief: the reason on each, best first
    const brief = ctx.briefOf(a.slot); if (!brief) throw bad(`no B-roll slot ${a.slot} in this draft`, 404);
    const c = M.candidates(brief, V.search(a.q || '', a), { n: a.limit > 0 ? a.limit : 8 });
    return json(res, 200, { slot: a.slot, brief, items: c.map(x => ({ ...V.brief(x.item), reason: x.reason, ok: x.ok })), count: c.length, total: V.load().items.length, pictures: picturesOn() });
  }
  if (p === '/api/vault/file' && Mth === 'GET') {
    const it = V.get(q('id')); if (!it) return json(res, 404, { error: 'not found' });
    const part = q('part'), rel = q('thumb') ? it.thumb : q('frame') != null ? `items/${it.id}/frames/${String(+q('frame') || 0).padStart(3, '0')}.jpg` : part ? (it.capture || {})[['og', 'top', 'full', 'scroll'].includes(part) ? part : 'top'] : it.file;
    if (!rel || !existsSync(join(V.dir(), rel))) return json(res, 404, { error: 'no picture' });
    return ctx.serveFile(req, res, join(V.dir(), rel));
  }
  if (p === '/api/vault/upload' && Mth === 'POST') {
    const name = String(q('name') || 'clip.mp4'); if (!V.VIDEO.test(name) && !V.IMAGE.test(name)) throw bad('The Vault takes videos (mp4, mov, webm, m4v, mkv) and pictures (jpg, png, webp).');
    if (q('rights') && !V.RIGHTS.includes(q('rights'))) throw bad(`rights: ${V.RIGHTS.join(', ')}`);
    const f = await ctx.rawToFile(req, V.LIMITS.fileBytes), it = V.add(f, { move: true, name, source: 'upload', title: q('title') || null, rights: q('rights') || 'mine', tags: (q('tags') || '').split(',').filter(Boolean), brand: (q('brand') || '').split(',').filter(Boolean) });
    ctx.changed(); return json(res, 200, { item: V.brief(it), duplicate: !!it.duplicate, ...(it.duplicate ? { note: 'You already have this.' } : {}) });
  }
  if (p === '/api/vault/link' && Mth === 'POST') {
    const b = await readBody(req), wait = b.wait === true, by = b.by; delete b.wait; delete b.by; check('capture_link', b);
    const r = V.addLink(b.link, { mine: b.mine === true, title: b.title, tags: b.tags, brand: b.brand, describe: b.description }, { capture: ctx.capture });
    r.ready.then(it => { ctx.changed(); if (it && b.slot != null) { try { ctx.offer(b.slot, it, by); } catch {} } }).catch(() => {});
    const it = wait ? (await r.ready) || r.item : r.item; ctx.changed();
    return json(res, r.duplicate || wait ? 200 : 202, { item: V.brief(it), duplicate: r.duplicate, ...(r.duplicate ? { note: 'You already have this.' } : {}), ...(it.rights === 'reference' ? { reference: 'Saved as reference only. It is someone else\'s, so it is never placed in a reel.' } : {}) });
  }
  if (p === '/api/vault/item' && Mth === 'POST') {
    const b = await readBody(req);
    if (b.action === 'undo') { const it = V.restore(b.id || null); ctx.changed(); return json(res, 200, { item: V.brief(it), note: 'It is back in your Vault.' }); }
    if (b.action === 'delete') {
      if (req.headers['x-studio-page'] !== '1') throw bad('Only the page can delete from the Vault. Deleting is the user\'s.', 403);
      const it = V.remove(String(b.id || '')); ctx.dropSlots(it.id); ctx.changed(); return json(res, 200, { deleted: it.id, undo: { id: it.id, name: it.name }, note: 'Deleted from your Vault. You can undo for 7 days.' });
    }
    const it = V.update(String(b.id || ''), { name: b.name, tags: b.tags, brand: b.brand, rights: b.rights, describe: b.describe }); if (b.rights === 'reference') ctx.dropSlots(it.id);
    ctx.changed(); return json(res, 200, { item: V.brief(it) });
  }
  return false;
}
