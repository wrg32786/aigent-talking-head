// Sizes: the versions one Render makes. The 9:16 reel is always made (it is the master: every other size is built
// from the same edit). The Instagram Feed takes 4:5 to 1.91:1 only, so the 4:5 (1080x1350) and the square 1:1 are
// their own versions: the frame follows the face and the layout is made again inside it (kit/export-frame.cjs).
//   state.sizes: [] or any of 'feed45', 'square' (applyPatch takes those, or '4:5', '1:1', 'feed'; '9:16' is always on)
//   exportArg(s): the --export value of a render: the 9:16 preset the reel is laid out for, then the sizes
//   fileOf(reel, size): the file of the same version in that size (reel-v1-feed-4x5.mp4), whether it exists or not
//   POST /api/sizes/make { size, file? }: make one size of a finished reel (kit/export.mjs), as a task with progress
import { existsSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { createRequire } from 'module';
const X = createRequire(import.meta.url)('../exports.cjs');

export const SIZES = [
  { id: 'reels', size: '9:16', label: 'Reels and Stories 9:16', use: 'For Reels and Stories', always: true },
  { id: 'feed45', size: '4:5', label: 'Instagram Feed 4:5 (1080x1350)', use: X.get('feed45').use },
  { id: 'square', size: '1:1', label: 'Square 1:1', use: X.get('square').use },
];
export const EXTRA = SIZES.filter(z => !z.always).map(z => z.id);
const ALIAS = { '4:5': 'feed45', '4x5': 'feed45', feed: 'feed45', feed45: 'feed45', '1:1': 'square', '1x1': 'square', square: 'square', '9:16': null, '9x16': null, reels: null, reel: null };
// a list from a person or an agent -> { sizes, bad }: known names in a fixed order, 9:16 dropped (it is always made)
export function norm(v) {
  const list = v == null || v === false ? [] : (Array.isArray(v) ? v : typeof v === 'object' ? Object.keys(v).filter(k => v[k]) : String(v).split(',')).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const bad = list.filter(x => !(x in ALIAS)), got = new Set(list.map(x => ALIAS[x]).filter(Boolean));
  return { sizes: EXTRA.filter(x => got.has(x)), bad };
}
export const sizesOf = s => norm([...(Array.isArray(s && s.sizes) ? s.sizes : []), ...(s && X.isReframed(s.export) ? [s.export] : [])]).sizes;
// "reels,feed45": the 9:16 layout preset first (an older session may hold a 4:5 or 1:1 there: that is a size now)
export function exportArg(s) { const main = s && s.export && !X.isReframed(s.export) ? s.export : null; return [main, ...sizesOf(s)].filter(Boolean).join(',') || null; }
export const info = f => X.fileInfo(basename(String(f || '')));
export const labelOf = f => { const i = info(f); return !i ? basename(String(f || '')) : i.fx ? 'With effects' : i.use; };
export const isReel = f => X.FILE_RE.test(basename(String(f || '')));
// newest version first; inside a version the effects pass, then the reel, then its other sizes
const rank = f => { const i = info(f); return !i ? 9 : i.fx ? 0 : i.main ? 1 : 2; };
export const sortFiles = list => [...list].sort((a, b) => ((info(b) || {}).v || 0) - ((info(a) || {}).v || 0) || rank(a) - rank(b) || a.localeCompare(b));
// the 9:16 reel a file belongs to, and that version in another size
export function mainOf(rel) { const i = info(rel); return i ? join(dirname(rel), `reel-v${i.v}.mp4`).split('\\').join('/') : null; }
export function fileOf(rel, size) { const m = mainOf(rel); return m && X.get(size) ? X.outName(m, size) : null; }
// which file a placement gets: the Feed gets the 4:5 of the same version, everything else the reel that was picked.
// { file, size, missing } (missing: the 4:5 is not made yet; nothing 9:16 ever goes to the Feed in its place)
export function fileFor(rel, placement, root) {
  if (placement !== 'feed') return { file: rel, size: (info(rel) || {}).size || null, missing: false };
  const i = info(rel); if (i && i.size !== '9:16' && i.size) return { file: rel, size: i.size, missing: false };
  const f = fileOf(rel, 'feed45'); return { file: f, size: '4:5', missing: !f || !existsSync(resolve(root, f)) };
}
// the file name pattern of a size, for people and agents: reel-vN.mp4, reel-vN-feed-4x5.mp4
export const nameOf = id => X.isReframed(id) ? `reel-vN-${X.suffixOf(id)}.mp4` : 'reel-vN.mp4';
export const MAKE_FEED = 'Make the 4:5 version for the Feed';
export const WHERE = 'Reels and Stories get the 9:16 file. The Instagram Feed gets the 4:5 file.';

// what the page shows: the three boxes and the plain label of every output file
export function viewOf(s, outputs = []) { const on = sizesOf(s); return { list: SIZES.map(z => ({ ...z, on: !!z.always || on.includes(z.id) })), on, files: Object.fromEntries(outputs.map(f => [f, { use: labelOf(f), size: (info(f) || {}).size || null }])), where: WHERE, makeFeed: MAKE_FEED }; }

export function mount({ ROOT, C, json, readBody, runTask, needFor }) {
  async function route(p, M, u, req, res) {
    if (p !== '/api/sizes/make' || M !== 'POST') return false;
    const b = await readBody(req).catch(() => ({})), s = C.load(), n = norm([b.size == null ? 'feed45' : b.size]);
    if (n.bad.length || n.sizes.length !== 1) { json(res, 400, { error: 'size: 4:5 or 1:1' }); return true; }
    const size = n.sizes[0], outs = C.outputsOf(s);
    const src = b.file ? mainOf(String(b.file)) : outs.map(mainOf).find(f => f && outs.includes(f));
    if (!s.job || !src || !outs.includes(src)) { json(res, 400, { error: b.file ? 'That reel is not one of this video\'s renders.' : 'Render the reel first, then we can make this size from it.' }); return true; }
    const miss = needFor && !process.env.STUDIO_EXPORT ? needFor('render') : null; // a stand-in (the tests) needs no tools
    if (miss) { json(res, 400, miss); return true; }
    const out = X.outName(src, size);
    try { runTask('render', () => [[process.env.STUDIO_EXPORT || 'kit/export.mjs', [s.job, '--export', size, '--file', resolve(ROOT, src), '--json']]], () => ({ outputs: C.outputsOf(C.load()), made: out, size })); }
    catch (e) { json(res, e.code || 500, { error: e.message }); return true; }
    json(res, 202, { ok: true, size, from: src, file: out });
    return true;
  }
  return { route };
}
