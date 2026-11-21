// The title check (Studio report 4, item 5). Round every title, on the frames that were really drawn.
// For each title: every frame from two before its start to five after, and the same at its end.
//   Rule 1: while a title is up, no other word is in the caption bar.
//   Rule 2: a title's own word is not in the caption bar just before or just after its title.
// Rule 1 is read two ways: from the caption words as the overlay places them (titleframes.json "words"), and from the
// pixels of the text layer (build/ovl/%04d.png, or ovlt/ when captions sit behind the person): letter pixels in the
// caption bar that are not the title's own and not a graphic's. Rule 2 is read from the caption words.
// One-word captions only (the other styles share the screen with a title by design; the layout pass keeps them apart).
//   import { titleCheck } from './titlecheck.mjs';  titleCheck(build, { dur, fps }) -> { ran, frames, fails: [...], notes: [...] }
//   node kit/titlecheck.mjs <build dir> <seconds> [fps]     prints the result, exit 1 on a fail
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
const KIT = dirname(fileURLToPath(import.meta.url));
const INK = 215, MIN_PX = 250; // a letter pixel is nearly solid (a picture dim is at most 80% black); fewer than this is an edge, not a word
const nw = w => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');

// letter pixels of one drawn frame inside the bar, outside the boxes in skip (each grown by pad)
function inkIn(png, band, skip, pad) {
  const w = band.x1 - band.x0, h = band.y1 - band.y0;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=${w}:${h}:${band.x0}:${band.y0}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 << 20 });
  const S = skip.map(b => ({ x0: b.x0 - pad - band.x0, x1: b.x1 + pad - band.x0, y0: b.y0 - pad - band.y0, y1: b.y1 + pad - band.y0 }));
  let n = 0, x0 = 1e9, x1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (buf[(y * w + x) * 4 + 3] <= INK) continue;
    if (S.some(b => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1)) continue;
    n++; if (x < x0) x0 = x; if (x > x1) x1 = x;
  }
  return { px: n, x0: x0 + band.x0, x1: x1 + band.x0 };
}

export function titleCheck(build, { dur, fps = 24, model = null } = {}) {
  const out = { ran: false, titles: 0, frames: 0, pixelFrames: 0, fails: [], notes: [] };
  let M = model;
  if (!M) {
    try { execFileSync(process.execPath, [join(KIT, 'render.mjs'), (+dur).toFixed(2)], { cwd: build, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TITLECHECK: '1', FPS: String(fps) } }); M = JSON.parse(readFileSync(join(build, 'titleframes.json'), 'utf8')); }
    catch (e) { out.notes.push('the title check could not read the overlay: ' + String(e.stderr || e.message).split('\n')[0]); return out; }
  }
  if (!M || !M.titles || !M.titles.length) return out; // no one-word captions, or no titles: nothing to check
  out.ran = true; out.titles = M.titles.length;
  const words = M.words || [];
  const dir = join(build, M.captionLayer === 'behind' ? 'ovlt' : 'ovl'), png = f => join(dir, String(f).padStart(4, '0') + '.png');
  const pixels = !!M.band && existsSync(dir);
  if (!pixels) out.notes.push(`no drawn frames in ${M.captionLayer === 'behind' ? 'ovlt' : 'ovl'}/: the title check read the caption words only`);
  for (const T of M.titles) {
    const end = T.end > 90 ? Infinity : T.end, said = new Set();
    for (const fr of T.frames) {
      out.frames++;
      const here = words.filter(w => w.start <= fr.t + 1e-6 && w.end > fr.t + 1e-6); // the word on screen on this frame
      for (const w of here) {
        const own = T.words.includes(nw(w.word));
        if (fr.up) { const k = 'u' + w.word + w.start; if (!said.has(k)) { said.add(k); out.fails.push(`frame ${fr.f} (${fr.t.toFixed(2)} s): the caption word "${w.word}" is in the bar while the title "${T.text}" is up (${T.start} to ${T.end > 90 ? 'the end' : T.end} s)`); } }
        else if (own) { const k = 'o' + w.word + w.start; if (!said.has(k)) { said.add(k); out.fails.push(`frame ${fr.f} (${fr.t.toFixed(2)} s): "${w.word}" is in the caption bar ${fr.t < T.start ? 'just before' : 'just after'} its own title "${T.text}"`); } }
      }
      if (!pixels || !fr.up || !existsSync(png(fr.f))) continue;
      out.pixelFrames++;
      let ink; try { ink = inkIn(png(fr.f), M.band, [...(fr.box ? [fr.box] : []), ...(fr.others || [])], M.pad || 16); } catch (e) { out.notes.push(`frame ${fr.f}: could not read ${png(fr.f)}`); continue; }
      if (ink.px > MIN_PX && !said.has('p')) { said.add('p'); out.fails.push(`frame ${fr.f} (${fr.t.toFixed(2)} s): a word is drawn in the caption bar while the title "${T.text}" is up (${ink.px} letter pixels between x ${ink.x0} and ${ink.x1} on ${M.captionLayer === 'behind' ? 'ovlt' : 'ovl'}/${String(fr.f).padStart(4, '0')}.png)`); }
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [b, d, f] = process.argv.slice(2);
  if (!b || !d) { console.error('use: node kit/titlecheck.mjs <build dir> <seconds> [fps]'); process.exit(2); }
  const r = titleCheck(resolve(b), { dur: +d, fps: +f || 24 });
  console.log(JSON.stringify(r, null, 1)); process.exit(r.fails.length ? 1 : 0);
}
