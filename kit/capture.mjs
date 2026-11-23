// Capture a public web page for a screen card: a screenshot of the top (for a GitHub repo, the top of the README) and
// a short scrolling screen recording, cached in assets/web/<page>/ (gitignored): shot.png, scroll.mp4, meta.json.
//
//   npm run capture -- <url> [<url> ...] [--scroll 8] [--width 780] [--force] [--image-only]
//   npm run capture -- --recipe <Reel.md> [--list]     the screen-card sources in a recipe (--list only prints them)
//
// Only public pages: http(s) only, no localhost or private network addresses (checked by DNS before loading, and
// every request the page makes is checked too), a fresh browser profile with no cookies, no login. Agents propose
// the URL list to the user and capture only after they confirm it (skills/talking-head-teardown).
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { join } from 'path';
import { createRequire } from 'module';
import { findChrome } from './chrome.mjs';

const require = createRequire(import.meta.url);
const S = require('./sources.cjs');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const flag = k => argv.includes('--' + k);
const VALUED = new Set(['scroll', 'width', 'recipe']);
const die = m => { console.error(m); process.exit(1); };

// private, loopback, link-local and other non-public addresses
export function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; // 198.18/15 (benchmark range) is allowed: proxies with fake-IP DNS hand it out for public hosts
  }
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
  }
  return true;
}
const badHost = h => !h || /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(h) || (isIP(h) && privateIp(h));
export async function publicUrl(u) {
  let url; try { url = new URL(S.normUrl(u)); } catch { return 'not a URL'; }
  if (!/^https?:$/.test(url.protocol)) return 'only http and https pages';
  if (badHost(url.hostname)) return 'not a public host';
  try { const as = await lookup(url.hostname, { all: true }); if (!as.length || as.some(a => privateIp(a.address))) return 'resolves to a private address'; } catch { return 'host not found'; }
  return null;
}

// screen-card sources in a recipe: [{ n, source, confirmed }]; a `source~` (a teardown's guess) is listed, not captured
function recipeSources(file) {
  const RM = require('./reelmd.cjs');
  const r = RM.load(file);
  return (r.graphics || []).filter(g => (g.type || g['type~']) === 'screen-card' && (g.source || g['source~']))
    .map(g => ({ n: g.n, start: g.start, source: g.source || g['source~'], confirmed: !!g.source, subject: g.subject || g['subject~'] }));
}

export async function capture(url, o = {}) {
  const why = await publicUrl(url);
  if (why) throw new Error(`${url}: ${why}; only public pages are captured`);
  const u = S.normUrl(url), dir = S.dirOf(u), secs = o.scroll ?? 8, W = o.width || 780, Hh = Math.round(W * 0.66);
  if (!o.force && existsSync(join(dir, 'shot.png')) && (o.imageOnly || existsSync(join(dir, 'scroll.mp4')))) return { dir, cached: true };
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-first-run', '--disable-extensions'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: Hh }, deviceScaleFactor: 2, colorScheme: 'dark', acceptDownloads: false, serviceWorkers: 'block' });
    await ctx.route('**/*', r => { let h = ''; try { h = new URL(r.request().url()).hostname; } catch {} return /^(data|blob):/.test(r.request().url()) || !badHost(h) ? r.continue() : r.abort(); });
    const page = await ctx.newPage();
    try { await page.goto(u, { waitUntil: 'networkidle', timeout: 30000 }); } catch { await page.goto(u, { waitUntil: 'load', timeout: 30000 }); }
    const final = page.url(), why2 = await publicUrl(final);
    if (why2) throw new Error(`${url} went to ${final}: ${why2}`);
    await page.waitForTimeout(800);
    // start at the content: a repo's README, else the top of the page
    const y0 = await page.evaluate(() => { const el = ['article.markdown-body', '#readme', 'main article'].map(q => document.querySelector(q)).find(Boolean); const y = el && /github|gitlab|huggingface/.test(location.hostname) ? el.getBoundingClientRect().top + scrollY - 12 : 0; scrollTo(0, y); return y; });
    // lazy images and late layout under the fold: let them load, then aim again
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const y1 = await page.evaluate(() => { const el = ['article.markdown-body', '#readme', 'main article'].map(q => document.querySelector(q)).find(Boolean); const y = el && /github|gitlab|huggingface/.test(location.hostname) ? el.getBoundingClientRect().top + scrollY - 12 : 0; scrollTo(0, y); return y; });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(dir, 'shot.png') });
    if (!o.imageOnly && secs > 0) {
      const fr = join(dir, 'frames'); rmSync(fr, { recursive: true, force: true }); mkdirSync(fr);
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const dist = Math.max(0, Math.min(max - y1, secs * 140)), n = Math.round(secs * 12);
      for (let i = 0; i < n; i++) {
        const q = i / Math.max(1, n - 1), e = q < 0.15 ? 0 : (q - 0.15) / 0.85, ease = e * e * (3 - 2 * e); // a short hold, then a smooth scroll
        await page.evaluate(y => scrollTo(0, y), Math.round(y1 + dist * ease));
        await page.screenshot({ path: join(fr, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
      }
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '12', '-i', join(fr, '%04d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', join(dir, 'scroll.mp4')]);
      rmSync(fr, { recursive: true, force: true });
    }
    const title = await page.title().catch(() => '');
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ url: u, final, title, captured: new Date().toISOString(), viewport: [W, Hh], scroll: o.imageOnly ? 0 : secs }, null, 1) + '\n');
    // extras (the Asset Vault, kit/studio/vault.mjs): the full page, the share image, the words on the page, and
    // whether the page is a sign in wall (then the Vault keeps only the link)
    if (o.extras) {
      await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
      await page.screenshot({ path: join(dir, 'full.png'), fullPage: true }).catch(() => {});
      const info = await page.evaluate(() => { const m = q => (document.querySelector(q) || {}).content || null;
        return { og: m('meta[property="og:image"]') || m('meta[name="twitter:image"]'), about: m('meta[property="og:description"]') || m('meta[name="description"]'), text: (document.body ? document.body.innerText : '').slice(0, 6000), pass: !!document.querySelector('input[type="password"]') }; }).catch(() => ({}));
      let og = null;
      if (info.og) { try { const ou = new URL(info.og, final).toString(); if (!(await publicUrl(ou))) { const r = await ctx.request.get(ou, { timeout: 15000 }), ct = String(r.headers()['content-type'] || '');
        const ext = /png/.test(ct) ? '.png' : /webp/.test(ct) ? '.webp' : /jpe?g/.test(ct) ? '.jpg' : null; if (r.ok() && ext) { og = 'og' + ext; writeFileSync(join(dir, og), await r.body()); } } } catch {} }
      const signin = !!info.pass || /\/(login|log-in|signin|sign-in|sign_in|accounts\/login|checkpoint|auth)(\/|$)/i.test(new URL(final).pathname);
      return { dir, cached: false, title, final, og, text: [info.about, info.text].filter(Boolean).join(' '), signin };
    }
    return { dir, cached: false, title };
  } finally { await browser.close(); }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('capture.mjs')) {
  const urls = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has((argv[i - 1] || '').replace(/^--/, '')));
  if (opt('recipe')) {
    const src = recipeSources(opt('recipe'));
    if (!src.length) die('no screen-card sources in ' + opt('recipe') + ' (add `source <url or file>` to a screen-card line)');
    for (const s of src) console.log(`#${String(s.n).padStart(2, '0')} ${s.start}s  ${s.source}${s.confirmed ? '' : '  (a guess: source~, confirm it first)'}${s.subject ? '  [shown: ' + s.subject + ']' : ''}`);
    if (flag('list')) process.exit(0);
    urls.push(...src.filter(s => s.confirmed && S.isUrl(s.source)).map(s => s.source));
  }
  if (!urls.length) die('usage: npm run capture -- <url> [<url> ...] [--scroll 8] [--width 780] [--force] [--image-only] | --recipe <Reel.md> [--list]');
  let bad = 0;
  for (const u of urls) {
    try {
      const r = await capture(u, { scroll: +(opt('scroll', 8)), width: +(opt('width', 780)), force: flag('force'), imageOnly: flag('image-only') });
      console.log(`${r.cached ? 'cached' : 'captured'} ${u} -> ${r.dir}${r.title ? '  (' + r.title.slice(0, 60) + ')' : ''}`);
    } catch (e) { bad++; console.error('skipped ' + (e.message || e)); }
  }
  process.exit(bad ? 1 : 0);
}
