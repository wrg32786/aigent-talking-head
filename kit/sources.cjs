// Screen-card sources: a public web page (a GitHub repo, a site, a tool's docs) captured by kit/capture.mjs to a
// screenshot (shot.png) and a short scrolling recording (scroll.mp4), cached in assets/web/ (gitignored). This file is
// the cache lookup, shared by reelmd.cjs, reel.cjs and capture.mjs. Only public http(s) pages; see capture.mjs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const cacheRoot = () => process.env.ATH_ASSETS || path.join(ROOT, 'assets', 'web');

// "github.com/x/y" or "https://..." is a web source; anything else is a file path
const isUrl = s => /^https?:\/\//i.test(String(s)) || (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/|$)/i.test(String(s)) && !/\.(mp4|mov|m4v|webm|mkv|png|jpe?g|gif|webp|svg)$/i.test(String(s)));
const normUrl = s => (/^[a-z][a-z0-9+.-]*:/i.test(String(s)) ? String(s) : 'https://' + String(s)).replace(/\s+/g, ''); // another scheme stays as is (and is refused)
function key(url) {
  const u = normUrl(url);
  const slug = u.replace(/^https?:\/\//i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase();
  return `${slug}-${crypto.createHash('sha1').update(u).digest('hex').slice(0, 8)}`;
}
const dirOf = url => path.join(cacheRoot(), key(url));
// what has been captured for a URL: { dir, video, image, meta } (video and image are null when missing)
function cached(url) {
  const dir = dirOf(url), f = n => (fs.existsSync(path.join(dir, n)) ? path.join(dir, n) : null);
  let meta = null; try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch {}
  return { dir, video: f('scroll.mp4'), image: f('shot.png'), meta };
}

module.exports = { isUrl, normUrl, key, dirOf, cached, cacheRoot };
