// Fast overlay frame capture for kit/render.mjs.
// The overlay (kit/overlay.html) draws every frame on one 1080x1920 canvas, so a frame does not need a page
// screenshot: Chrome encodes the canvas to PNG itself, on worker threads (OffscreenCanvas.convertToBlob), while the
// page draws the next frame. The PNG files are the same pixels as the screenshot path (checked by npm run smoke and
// node kit/render-bench.mjs), so assemble.cjs, fx.cjs and the rest read them as before.
// Idea from motlab (https://github.com/staryone/motlab, MIT): draw on a canvas and encode inside Chrome rather than
// screenshot each frame. motlab encodes with WebCodecs; Chrome's VideoEncoder cannot keep an alpha channel
// (alpha: 'keep' is unsupported for VP8, VP9, AV1 and H.264), and the overlay layers need alpha, so frames stay PNG.
// RENDER_CAPTURE=screenshot keeps the old path. RENDER_PAGES=<n> sets how many pages draw at once (default from the
// CPU count, free memory, and installed memory). Any error on the fast path (an image from a file tainting the canvas,
// no workers) falls back to screenshots for that page from that frame on, and render.mjs says so.
import os from 'os';

export const BATCH = 12;

// how many pages draw frames at once: about one per three CPU threads, at most 3, and only with memory to spare
// (a page with its encode workers peaks near 600 MB). Machines with under 8 GB of installed memory stay on one page.
export function pickPages(env = process.env, cpus = (os.cpus() || []).length || 1, free = os.freemem(), total = os.totalmem()) {
  if (env.RENDER_PAGES) return Math.max(1, Math.min(8, Math.floor(+env.RENDER_PAGES) || 1));
  const byCpu = Math.floor(cpus / 3), byMem = Math.floor((free / 2 ** 30 - 1.5) / 0.6);
  const cap = total / 2 ** 30 < 8 ? 1 : 3;
  return Math.max(1, Math.min(cap, byCpu, byMem));
}
export const pickWorkers = (cpus = (os.cpus() || []).length || 1, pages = 1) => Math.max(1, Math.min(3, Math.floor(cpus / pages) - 1));

// installs the encoder in the page; resolves to null when the page can do it, else the reason it cannot
export async function install(page, workers) {
  return page.evaluate(async W => {
    try {
      if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined' || typeof Worker === 'undefined') return 'this Chrome has no OffscreenCanvas or workers';
      const src = 'onmessage=async e=>{const{id,bm}=e.data;try{const oc=new OffscreenCanvas(bm.width,bm.height);oc.getContext("2d").drawImage(bm,0,0);bm.close();const bl=await oc.convertToBlob({type:"image/png"});postMessage({id,buf:await bl.arrayBuffer()})}catch(err){postMessage({id,err:String(err&&err.message||err)})}}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const pend = new Map(); let next = 0, rr = 0;
      const pool = [...Array(W)].map(() => { const w = new Worker(url); w.onmessage = e => { const r = pend.get(e.data.id); pend.delete(e.data.id); if (r) e.data.err ? r[1](new Error(e.data.err)) : r[0](e.data.buf) }; w.onerror = e => { for (const r of pend.values()) r[1](new Error('encode worker failed: ' + (e.message || 'error'))); pend.clear() }; return w });
      const enc = bm => new Promise((ok, no) => { const id = next++; pend.set(id, [ok, no]); pool[rr++ % pool.length].postMessage({ id, bm }, [bm]) });
      const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) };
      window.__capBatch = async (ts, layer) => {
        const c = document.getElementById('c'), jobs = [];
        for (const t of ts) { window.seek(t, layer); jobs.push(enc(await createImageBitmap(c))) }
        return (await Promise.all(jobs)).map(b64);
      };
      // one test frame, so a canvas Chrome cannot read falls back before any frame is written
      await window.__capBatch([0], 'all');
      return null;
    } catch (e) { return String((e && e.message) || e) }
  }, workers);
}

export const batch = async (page, ts, layer) => (await page.evaluate(([ts, l]) => window.__capBatch(ts, l), [ts, layer])).map(s => Buffer.from(s, 'base64'));

// Draws the reel once at a few moments a second before any frame is kept, then waits for what that started loading.
// A font weight or a screen recording frame is loaded the first time something draws it, so a page that had not drawn
// it yet showed a fallback face or no card for a frame or two (seen with two pages drawing at once).
export async function warm(page, times) {
  await page.evaluate(async ts => {
    for (const t of ts) window.seek(t, 'all');
    await document.fonts.ready;
    // eslint-disable-next-line no-undef
    if (typeof IMGP !== 'undefined') await Promise.all(IMGP);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, times);
}
export const warmTimes = (dur, step = 0.2) => [...Array(Math.max(1, Math.ceil(dur / step))).keys()].map(k => +(k * step).toFixed(3));
