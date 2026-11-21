// Scenes: effects and graphics the menu did not have, made as small HTML and CSS pages and kept for every job.
// When a reference shows something the kit has no item for (a sticker image, a styled text label, a light leak),
// the teardown writes it as a scene, adds it to the menu with a REF badge and keeps it here. Your agent can add its
// own the same way (studio_make_scene). A scene is drawn the way the Make card renders a card (kit/broll-make.mjs):
// headless Chrome with JavaScript off and every request blocked, each CSS animation set to the frame's time, one
// screenshot a frame, here with a clear background so it sits over your video (kit/render.mjs, overlay.html mode 39).
//
// A scene: { id: "ref-<name>", name, kind: "graphic" | "effect", html, css, seconds (0.4 to 8), box: { x, y, w, h }
// (fractions of the 1080x1920 frame, top left), text (the default for {{text}} in the html), loop, from: { reference,
// t, what }, by: "reference" | "agent", made }. {{text}} in the html is filled with the words said at that moment.
// Saved in scenes/local/<id>.json (SCENES_DIR overrides).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.dirname(__dirname);
const dir = () => process.env.SCENES_DIR || path.join(ROOT, 'scenes', 'local');
const KINDS = ['graphic', 'effect'];
const r3 = x => +(+x).toFixed(3), cl = (v, a, z) => Math.min(z, Math.max(a, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const MAX_HTML = 20000, MAX_CSS = 20000, MAX_DATA = 3 * 2 ** 20;

// what a scene may not hold: scripts, event handlers, and anything that loads from outside the page (only data: URLs)
function check(sc) {
  const errs = [], s = sc || {};
  if (!/^ref-[a-z0-9][a-z0-9-]{0,60}$/.test(String(s.id || ''))) errs.push('id: ref- then lower case letters, digits and dashes');
  if (!String(s.name || '').trim()) errs.push('name: what it is, a few words');
  if (!KINDS.includes(s.kind)) errs.push('kind: graphic or effect');
  const html = String(s.html || ''), css = String(s.css || '');
  if (!html.trim() && !css.trim()) errs.push('html (and css): the scene');
  if (html.length > MAX_HTML + MAX_DATA || css.length > MAX_CSS + MAX_DATA) errs.push('html and css: 20 KB each, plus up to 3 MB of data: images');
  const both = html + '\n' + css;
  if (/<\s*script|javascript:|\son[a-z]+\s*=|<\s*(iframe|object|embed|link|meta|base|form)\b|@import/i.test(both)) errs.push('no scripts, event handlers, frames, links or @import (the scene renders with JavaScript off)');
  for (const m of both.matchAll(/(?:url\(\s*['"]?|\b(?:src|href|srcset|poster|xlink:href)\s*=\s*['"]?)\s*([^'")\s>]+)/gi)) if (!/^(data:|#)/i.test(m[1])) { errs.push(`only data: URLs (no ${m[1].slice(0, 40)})`); break; }
  const sec = +s.seconds; if (!(sec >= 0.4 && sec <= 8)) errs.push('seconds: 0.4 to 8');
  const b = s.box || {}; for (const k of ['x', 'y', 'w', 'h']) if (!(+b[k] >= -0.5 && +b[k] <= 1.5)) { errs.push('box: { x, y, w, h } as fractions of the frame'); break; }
  if (+b.w <= 0.02 || +b.h <= 0.01) errs.push('box: w and h too small');
  return errs;
}
function normal(sc) {
  const s = { ...sc };
  s.name = String(s.name || '').trim().slice(0, 60); s.kind = KINDS.includes(s.kind) ? s.kind : 'graphic';
  s.seconds = r3(cl(+s.seconds || 2, 0.4, 8));
  const b = s.box || {}; s.box = { x: r3(+b.x || 0), y: r3(+b.y || 0), w: r3(b.w == null ? 1 : +b.w), h: r3(b.h == null ? 1 : +b.h) };
  if (!s.id) s.id = 'ref-' + (slug(s.name) || 'scene') + '-' + hash(s).slice(0, 6);
  if (s.text != null) s.text = String(s.text).slice(0, 80);
  s.made = s.made || new Date().toISOString(); s.by = s.by || 'reference';
  return s;
}
// the same look is the same scene: where it sat (its box) does not make a new one
const hash = s => crypto.createHash('sha1').update(JSON.stringify([s.kind, s.html || '', s.css || '', +s.seconds || 0])).digest('hex');

// the page: the scene alone on a clear frame of the box's size, its text slot filled
function page(sc, text) {
  const s = sc || {}, t = esc(text != null && String(text).trim() ? text : s.text || '');
  const html = String(s.html || '').replace(/\{\{\s*text\s*\}\}/g, t);
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:Inter,'Helvetica Neue',Arial,sans-serif}*{box-sizing:border-box}${String(s.css || '').replace(/<\/style/gi, '')}</style></head><body>${html}</body></html>`;
}

function list() {
  let fl = []; try { fl = fs.readdirSync(dir()).filter(f => f.endsWith('.json')); } catch { return []; }
  return fl.map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')); } catch { return null; } }).filter(s => s && !check(s).length).sort((a, b) => String(b.made).localeCompare(String(a.made)));
}
function get(id) { if (!/^ref-[a-z0-9-]+$/.test(String(id || ''))) return null; try { const s = JSON.parse(fs.readFileSync(path.join(dir(), id + '.json'), 'utf8')); return check(s).length ? null : s; } catch { return null; } }
// save: the same scene twice (same html, css, length and box) keeps the one already there
function save(sc) {
  const s = normal(sc), errs = check(s); if (errs.length) throw Object.assign(new Error('scene: ' + errs.join('; ')), { code: 400 });
  const h = hash(s), same = list().find(x => hash(x) === h);
  if (same) return { scene: same, added: false };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), s.id + '.json'), JSON.stringify(s, null, 1) + '\n');
  return { scene: s, added: true };
}
function remove(id) { const s = get(id); if (!s) return false; fs.rmSync(path.join(dir(), id + '.json'), { force: true }); fs.rmSync(path.join(dir(), id + '.png'), { force: true }); return true; }
const stillPath = id => path.join(dir(), id + '.png');

// ---- made from a reference ----
const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d;
// a sticker the reference used (its own image): a die-cut card that springs in with a little wobble and floats
function stickerScene(img, { t, what, ref, bbox } = {}) {
  const b = Array.isArray(bbox) && bbox.length === 4 ? bbox : [0.62, 0.2, 0.28, 0.16];
  const w = cl(+b[2] || 0.28, 0.14, 0.6), h = cl((+b[3] || 0.16) * 1, 0.08, 0.4);
  return { kind: 'graphic', name: `Sticker: ${String(what || 'from the reference').slice(0, 40)}`, seconds: 1.6, box: { x: r3(cl(+b[0], 0, 1 - w)), y: r3(cl(+b[1], 0, 1 - h)), w: r3(w), h: r3(h) },
    html: `<div class="st"><img src="${img}" alt=""></div>`,
    css: `.st{position:absolute;inset:6%;display:grid;place-items:center;animation:pop .55s cubic-bezier(.2,1.6,.4,1) both,float 1.6s ease-in-out .55s both}
.st img{max-width:100%;max-height:100%;border-radius:12%;border:6px solid #fff;box-shadow:0 10px 30px rgba(0,0,0,.35)}
@keyframes pop{0%{transform:scale(0) rotate(-14deg)}100%{transform:scale(1) rotate(-4deg)}}@keyframes float{0%{translate:0 0}50%{translate:0 -3%}100%{translate:0 0}}`,
    from: { reference: ref || null, t: t != null ? r3(t) : null, what: 'sticker' } };
}
// a styled text label the menu has no match for (rea-video text_cues "huazi" or a boxed label): its fill, outline,
// box colour, tilt and place, and how it came in; {{text}} is your word at that moment
// a colour's everyday name, for a scene's name in the menu
const NAMES = [['white', 255, 255, 255], ['black', 0, 0, 0], ['grey', 128, 128, 128], ['yellow', 255, 225, 0], ['orange', 255, 140, 0], ['red', 220, 30, 40], ['pink', 255, 80, 160], ['purple', 140, 60, 200], ['blue', 30, 90, 230], ['sky blue', 80, 190, 255], ['teal', 0, 170, 160], ['green', 40, 190, 70], ['brown', 130, 80, 40]];
const colourName = h => { const v = parseInt(String(h).slice(1), 16), c = [v >> 16 & 255, v >> 8 & 255, v & 255]; let best = NAMES[0], d = Infinity; for (const x of NAMES) { const e = (x[1] - c[0]) ** 2 + (x[2] - c[1]) ** 2 + (x[3] - c[2]) ** 2; if (e < d) { d = e; best = x; } } return best[0]; };
function labelScene(cue, { ref } = {}) {
  const st = cue.style || {}, fill = hex(st.fill, '#ffffff'), stroke = hex(st.stroke, '#111111'), boxc = st.box ? hex(st.box_color, '#ffcc33') : null;
  const ow = st.stroke_ratio > 0.01 ? Math.round(cl(st.stroke_ratio * 300, 2, 12)) : 0;
  const bb = Array.isArray(cue.bbox) ? cue.bbox : [0.15, 0.4, 0.7, 0.08], h = cl((+bb[3] || 0.06) * 2.2, 0.06, 0.3), y = cl((+bb[1] || 0.4) - (h - (+bb[3] || 0.06)) / 2, 0.02, 0.95 - h);
  const ang = cl(+cue.angle || 0, -20, 20), kind = String((cue.anim_in && cue.anim_in.kind) || (cue.reveal ? 'typewriter' : 'pop'));
  const enter = /type|reveal|write/.test(kind) ? 'clip-path:inset(0 100% 0 0);animation:wipe .45s steps(12) forwards' : /slide|fly|left|right/.test(kind) ? 'transform:translateX(-40%);opacity:0;animation:slide .35s cubic-bezier(.2,.9,.2,1) forwards' : /fade/.test(kind) ? 'opacity:0;animation:fade .3s ease forwards' : 'transform:scale(.2);opacity:0;animation:pop .4s cubic-bezier(.2,1.5,.4,1) forwards';
  const sig = [fill, stroke, boxc, ow, Math.round(ang)].join(' ');
  return { kind: 'graphic', name: `Label: ${st.fill_name || colourName(fill)}${boxc ? ' on ' + (st.box_name || colourName(boxc)) : ow ? ', ' + colourName(stroke) + ' outline' : ''}${ang ? ', tilted' : ''}`.slice(0, 60), seconds: 1.2, text: 'WORD',
    box: { x: 0.05, y: r3(y), w: 0.9, h: r3(h) },
    html: `<div class="lb"><span>{{text}}</span></div>`,
    css: `.lb{position:absolute;inset:0;display:grid;place-items:center;transform:rotate(${ang.toFixed(1)}deg)}
.lb span{display:inline-block;${enter};font:900 min(46vh,12vw)/1 'Archivo Black','Arial Black',Impact,sans-serif;text-transform:uppercase;letter-spacing:.01em;color:${fill};${ow ? `-webkit-text-stroke:${ow}px ${stroke};paint-order:stroke fill;` : ''}${boxc ? `background:${boxc};padding:.12em .32em;border-radius:.14em;box-shadow:0 .08em 0 rgba(0,0,0,.25);` : 'text-shadow:0 .05em .12em rgba(0,0,0,.45);'}}
@keyframes pop{to{transform:none;opacity:1}}@keyframes slide{to{transform:none;opacity:1}}@keyframes fade{to{opacity:1}}@keyframes wipe{to{clip-path:inset(0 0 0 0)}}`,
    sig, from: { reference: ref || null, t: cue.t0 != null ? r3(cue.t0) : null, what: 'text label' } };
}
// effects a reference's description names that the kit has nothing for, as full-frame scenes
const EFFECTS = {
  'light-leak': { re: /light[- ]?leak|lens flare|warm flare/i, name: 'Light leak', seconds: 1.4,
    css: `.fx{position:absolute;inset:-20%;background:radial-gradient(40% 60% at 20% 30%,rgba(255,170,60,.75),transparent 70%),radial-gradient(35% 50% at 80% 60%,rgba(255,80,120,.55),transparent 70%);mix-blend-mode:screen;opacity:0;animation:leak 1.4s ease-in-out forwards}@keyframes leak{0%{opacity:0;transform:translateX(-25%)}40%{opacity:1}100%{opacity:0;transform:translateX(25%)}}` },
  flash: { re: /\bwhite flash|flash frame|\bflash(es)?\b/i, name: 'White flash', seconds: 0.5,
    css: `.fx{position:absolute;inset:0;background:#fff;opacity:0;animation:fl .5s ease-out forwards}@keyframes fl{0%{opacity:.95}100%{opacity:0}}` },
  'vignette-pulse': { re: /vignette/i, name: 'Vignette pulse', seconds: 1.2,
    css: `.fx{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.75) 100%);opacity:0;animation:vg 1.2s ease-in-out forwards}@keyframes vg{0%{opacity:0}35%{opacity:1}100%{opacity:0}}` },
  'speed-lines': { re: /speed lines|motion lines|anime lines|action lines/i, name: 'Speed lines', seconds: 0.8,
    css: `.fx{position:absolute;inset:-30%;background:repeating-conic-gradient(from 0deg at 50% 50%,rgba(255,255,255,.0) 0deg 4deg,rgba(255,255,255,.55) 4.4deg 5deg);-webkit-mask:radial-gradient(circle at center,transparent 28%,#000 62%);mask:radial-gradient(circle at center,transparent 28%,#000 62%);opacity:0;animation:sl .8s linear forwards}@keyframes sl{0%{opacity:0;transform:rotate(0)}20%{opacity:1}100%{opacity:0;transform:rotate(8deg) scale(1.1)}}` },
  scanlines: { re: /scan ?lines|vhs|crt|retro tv/i, name: 'Scanlines', seconds: 1.5,
    css: `.fx{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,transparent 2px 5px);opacity:0;animation:sc 1.5s ease forwards}@keyframes sc{0%{opacity:0;background-position:0 0}20%{opacity:1}80%{opacity:1}100%{opacity:0;background-position:0 40px}}` },
  confetti: { re: /confetti|celebrat/i, name: 'Confetti burst', seconds: 1.6,
    html: `<div class="fx">${Array.from({ length: 28 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(0.2 + ((i * 13) % 9) / 10).toFixed(2)}s;--c:${['#ffcc33', '#ff5f8a', '#4fd1c5', '#7c83ff', '#ffffff'][i % 5]};--r:${(i * 47) % 360}deg"></i>`).join('')}</div>`,
    css: `.fx{position:absolute;inset:0}.fx i{position:absolute;left:var(--x);top:-4%;width:1.6%;height:.9%;background:var(--c);border-radius:2px;transform:rotate(var(--r));animation:fall 1.6s cubic-bezier(.3,.6,.5,1) var(--d) both}@keyframes fall{0%{top:-4%;opacity:1}100%{top:104%;opacity:.8;transform:rotate(calc(var(--r) + 540deg))}}` },
};
function effectScene(key, { ref, t } = {}) {
  const e = EFFECTS[key]; if (!e) return null;
  return { kind: 'effect', name: e.name, seconds: e.seconds, box: { x: 0, y: 0, w: 1, h: 1 }, html: e.html || '<div class="fx"></div>', css: e.css, from: { reference: ref || null, t: t != null ? r3(t) : null, what: 'effect' } };
}
// effect names in the reference's descriptions (rea-video VLM text, when it ran) the kit has no item for
function effectsNamed(b) {
  const texts = [], walk = (v, d = 0) => { if (d > 6 || v == null) return; if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.slice(0, 200).forEach(x => walk(x, d + 1)); else if (typeof v === 'object') Object.values(v).forEach(x => walk(x, d + 1)); };
  walk(b && b.whole_video_vlm); for (const s of (b && b.shots) || []) walk(s && s.vlm);
  const all = texts.join('\n'), out = [];
  for (const [k, e] of Object.entries(EFFECTS)) if (e.re.test(all)) out.push(k);
  return out;
}

module.exports = { dir, check, normal, page, list, get, save, remove, stillPath, stickerScene, labelScene, effectScene, effectsNamed, EFFECTS, KINDS, hash };
