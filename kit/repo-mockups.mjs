// Repo mode, when the README has few good pictures (Will, 2026-11-27): animated mockups of what the repo does, drawn
// from the repo's own facts and README, never made-up claims. Rendered on this computer with headless Chrome (JavaScript
// off, no network, every CSS animation set to its time per frame, as kit/studio/broll-make.mjs) to short MP4s that
// kit/repo-broll.mjs places in the repo card. Every scene sits in a window card on a 3D stage, with an editor-style
// selection box, a moving cursor and a camera move (see BASE); nothing is ever plain text on its own.
//   node kit/repo-mockups.mjs <https://github.com/owner/repo> [--force] [--json]   fetch (cached) and render the scenes
//
// The scenes (each picks itself only when the facts it needs are there):
//   proof     a browser card: the repo's URL typed in, its name, About, topics and stars, a highlight box on About
//             (the one short look at the page, used once per reel)
//   terminal  a terminal window typing the README's real install or usage command, then lines from the same code
//             block; for a plain `git clone`, the repo's real top-level files under `ls`
//   features  the README's feature list (bold labels or short bullets under a features-like heading) as an icon wheel
//             (up to 6) or a tile grid (up to 9), popping in one by one, a highlight box on the first
//   topics    the repo's GitHub topics as a tile grid (3 or more)
//   flow      inputs -> the repo -> output, from a description that says "X into Y" or "from X to Y"
//   stats     the stars counting up over a dot grid, with the language, license and forks
//   shot      one README picture inside a window card (how README pictures are always shown)
// readmeScore(meta) says whether the README's own pictures and videos are enough; when they are not, every scene that
// fits is made; when they are, the proof card and the terminal join the README's pictures.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { tmpdir, freemem } from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
export const GEN = 2; // bump when a scene's look changes, so cached renders are made again
export const SECONDS = 4, FPS = 24, VIEW = [600, 480]; // 5:4 at 2x: 1200x960, fits the repo card whole
const MIN_FREE = 0.8 * 2 ** 30; // one Chrome page and FFmpeg; under this the README's own pictures are used instead
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = s => String(s || '').trim().split(/\s+/).filter(Boolean);

// ---------- is the README enough? ----------
// a video 3, a big picture (600x300 or more) 2, a smaller one 1; 4 or more is good
export function readmeScore(meta) {
  const as = ((meta && meta.assets) || []).filter(a => !a.header && !a.capture && !a.mock);
  let score = 0, vids = 0, big = 0, small = 0;
  for (const a of as) { if (a.kind === 'video') { score += 3; vids++; } else if ((a.w || 0) >= 600 && (a.h || 0) >= 300) { score += 2; big++; } else { score += 1; small++; } }
  return { score, good: score >= 4, why: `${vids} video${vids === 1 ? '' : 's'}, ${big} big and ${small} small picture${small === 1 ? '' : 's'} in the README` };
}

// ---------- the README, read ----------
const plain = s => String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
// the README as sections: [{ heading, parent (the H1 or H2 above it), lines, code: [{ lang, lines }] }]
export function sections(md) {
  const out = [{ heading: '', parent: '', lines: [], code: [] }]; let fence = null, top = '';
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const cur = out[out.length - 1];
    const f = raw.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (f) { if (fence) { cur.code.push(fence); fence = null; } else fence = { lang: f[2].toLowerCase(), lines: [] }; continue; }
    if (fence) { fence.lines.push(raw.replace(/\s+$/, '')); continue; }
    const h = raw.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) { const lv = raw.trim().match(/^#+/)[0].length, t = plain(h[1]); if (lv <= 2) top = t; out.push({ heading: t, parent: lv <= 2 ? '' : top, lines: [], code: [] }); continue; }
    cur.lines.push(raw);
  }
  return out;
}
const CMD = /^(?:\$\s*)?((?:npm|npx|pnpm|yarn|bun|pip3?|pipx|uv|uvx|brew|cargo|go|gem|composer|dotnet|docker|kubectl|helm|deno|git clone|curl|wget|make|node|python3?|gh|claude|codex|\/plugin|\/[a-z][\w-]*(?=\s|$))\b.*)$/; // a slash command is one word (/plugin), never a path (/etc/app)
const SHELL_LANG = /^(sh|bash|zsh|fish|shell|console|terminal|shell-session|shellsession|powershell|pwsh|ps1?|cmd|bat|text|txt|plaintext)$/;
const SETUP = /install|quick ?start|getting started|setup|set up|usage|use it|try it|run/i, NOT_SETUP = /uninstall|remov|troubleshoot|if something/i;
const SKIP = /licen[cs]e|contribut|credit|thank|acknowledg|support|sponsor|changelog|repo(sitory)? map|links|faq|citation|security|limit|status|evidence|known|alternativ|compar|uninstall|remov|troubleshoot/i;
const setupHead = h => SETUP.test(h) && !NOT_SETUP.test(h);
const isSetup = s => setupHead(s.heading) || (!!s.parent && setupHead(s.parent) && !NOT_SETUP.test(s.heading));
// the install and usage commands. Output lines only from a block written as a session ("$ cmd" lines, the lines without
// "$" under them are what it printed); any other line in a plain block may be another command, so it is never output.
// A command that runs on with "\" is left out (only its whole text is ever typed).
export function commands(md) {
  const secs = sections(md), out = [];
  // only plain or shell blocks: a YAML or JSON block's "node-version: 20" is not a command
  const take = s => { for (const c of s.code) {
    if (c.lang && !SHELL_LANG.test(c.lang)) continue;
    const ls = c.lines.filter(l => l.trim()), session = ls.some(l => /^\s*\$\s/.test(l));
    for (let i = 0; i < ls.length; i++) {
      const line = ls[i].trim(); if (session && !line.startsWith('$')) continue;
      const m = line.match(CMD); if (!m || /\\$/.test(line)) continue;
      const after = []; if (session) for (let j = i + 1; j < ls.length && !/^\s*\$/.test(ls[j]) && after.length < 3; j++) after.push(ls[j]);
      const cmd = m[1].replace(/\s+#\s.*$/, '').trim(); if (!out.some(x => x.cmd === cmd)) out.push({ cmd, after: after.filter(l => !/^\s*#/.test(l) && l.length <= 60), heading: s.heading });
    } } };
  secs.filter(isSetup).forEach(take); secs.filter(s => !isSetup(s) && !SKIP.test(s.heading) && !SKIP.test(s.parent || '')).forEach(take);
  // a command that runs on over several lines with "\" keeps only its first line: that is the part typed in
  return out.filter(x => x.cmd.length <= 90);
}
// a short label from a list item or table cell: the bold lead, or the words before " - ", ":" or " — "; null if long
function label(item) {
  const b = String(item).match(/^\s*(?:\d+\.\s+|[-*+]\s+)?\*\*([^*]{2,40})\*\*/);
  let t = b ? b[1] : plain(String(item).replace(/^\s*(?:\d+\.\s+|[-*+]\s+)/, '')).split(/\s+[-—–]\s+|:\s/)[0];
  t = plain(t).replace(/[.:,;]+$/, '');
  return t.length >= 3 && t.length <= 30 && words(t).length <= 4 && !/https?:|\//.test(t) ? t : null;
}
const FEAT = /feature|what it does|what you get|highlight|hypothes|capabilit|meet the|agents|roster|what.s inside|what else ships|commands/i;
// the feature list: list items or a table's first column, under a features-like heading first
export function features(md) {
  const secs = sections(md).filter(s => !SKIP.test(s.heading) && !isSetup(s));
  const from = s => {
    const items = s.lines.filter(l => /^\s*(?:[-*+]|\d+\.)\s+\S/.test(l)).map(label).filter(Boolean);
    const rows = s.lines.filter(l => /^\s*\|/.test(l) && !/^\s*\|\s*:?-{2,}/.test(l)).slice(1).map(l => l.split('|')[1]).filter(c => /\*\*/.test(c || '')).map(label).filter(Boolean);
    return [...new Set([...items, ...rows])];
  };
  for (const s of secs.filter(x => FEAT.test(x.heading))) { const f = from(s); if (f.length >= 3) return { heading: s.heading, items: f.slice(0, 9) }; }
  return null;
}
// inputs -> the repo -> output, only when the description says "turns (converts, transforms) X into Y" 
export function flow(desc) {
  const d = String(desc || '').split(/(?<=[.!?])\s/)[0];
  const m = d.match(/\b(?:turns?|converts?|transforms?)\s+(.+?)\s+into\s+(.+?)(?:\s+(?:for|with|in|on)\s+.*)?[.:;]?$/i);
  if (!m) return null;
  const ins = m[1].split(/,\s*|\s+or\s+|\s+and\s+/).map(x => plain(x).replace(/^(?:a|an|the|one|your)\s+/i, '')).filter(Boolean), out = plain(m[2]).replace(/^(?:a|an|the|one|your)\s+/i, '');
  if (!ins.length || ins.length > 3 || ins.some(x => x.length > 28) || out.length > 30 || !out) return null;
  return { inputs: ins, output: out };
}

// ---------- the scenes ----------
const ACCENT = '#3d8bff';
// the look (GEN 2, Will 2026-11-27 "more 3d and animated"): a camera on a perspective stage. The window flies in tilted
// from depth on a springy curve, settles almost flat by about 1 s (so it reads), then orbits slowly and pushes in. Inside
// the window things sit on layers at different depths (parallax as the camera turns): the panels just above the glass,
// the selection box higher, the cursor highest. A soft ambient shadow and a tight contact shadow under the window, a rim
// light on its top edge, a light sweep across the glass once things are in, and a dark backdrop with a slow glow for
// contrast. CSS only (3D transforms, no WebGL), so it renders offline and costs about what the flat cards did.
const BASE = `*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#14161a}
body{background:radial-gradient(60% 22% at 50% 86%,#3a4b70 0%,transparent 100%),radial-gradient(85% 70% at 50% 38%,#2a3650 0%,#141b2b 55%,#090c14 100%)}
body::before{content:'';position:absolute;width:520px;height:520px;left:40px;top:-120px;border-radius:50%;background:radial-gradient(closest-side,${ACCENT}55,transparent);animation:glow ${SECONDS}s ease-in-out both}
@keyframes glow{from{transform:translate(-60px,0) scale(.9);opacity:.5}to{transform:translate(120px,60px) scale(1.1);opacity:.9}}
body::after{content:'';position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 45%,transparent 55%,#0008 100%);pointer-events:none}
.stage{position:absolute;inset:0;perspective:1100px;perspective-origin:50% 42%}
.rig{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform-style:preserve-3d;animation:cam ${SECONDS}s linear both}
@keyframes cam{
  0%{transform:translateZ(-420px) translateY(70px) rotateX(24deg) rotateY(calc(var(--o) * -28deg));opacity:0;animation-timing-function:cubic-bezier(.2,.9,.25,1)}
  6%{opacity:1}
  22%{transform:translateZ(14px) translateY(-4px) rotateX(-2deg) rotateY(calc(var(--o) * 3deg));animation-timing-function:cubic-bezier(.4,0,.3,1)}
  32%{transform:translateZ(0) translateY(0) rotateX(5deg) rotateY(calc(var(--o) * -5deg));animation-timing-function:cubic-bezier(.45,0,.55,1)}
  100%{transform:translateZ(36px) translateY(-6px) rotateX(3deg) rotateY(calc(var(--o) * 9deg))}}
.win{position:relative;background:#fff;border-radius:16px;transform-style:preserve-3d;
  box-shadow:0 1px 0 #ffffffb0 inset,0 0 0 1px #ffffff18,0 2px 4px #0006,0 14px 28px -8px #000a,0 46px 90px -24px #000c}
.win div{transform-style:preserve-3d}
.win::before{content:'';position:absolute;left:6%;right:6%;bottom:-26px;height:56px;border-radius:50%;background:radial-gradient(closest-side,#000e,#0008 45%,transparent);transform:translateZ(-60px) rotateX(70deg);pointer-events:none}
.win::after{content:'';position:absolute;inset:0;border-radius:16px;pointer-events:none;transform:translateZ(1px);background:linear-gradient(105deg,transparent 35%,#ffffff66 47%,#ffffff1c 53%,transparent 62%) -300% 0/300% 100% no-repeat;animation:sweep 1.1s cubic-bezier(.4,0,.2,1) 1.25s both}
@keyframes sweep{from{background-position:-300% 0}to{background-position:250% 0}}
.bar{display:flex;align-items:center;gap:7px;height:30px;padding:0 12px;background:#f1f3f6;border-bottom:1px solid #e3e6eb;font-size:11px;color:#5b6270;border-radius:16px 16px 0 0;transform:translateZ(4px)}
.bar i{width:10px;height:10px;border-radius:50%;background:#ff6058}.bar i:nth-child(2){background:#ffbd2e}.bar i:nth-child(3){background:#28c840}.bar>span{margin-left:8px;white-space:nowrap;overflow:hidden}
.sel{position:absolute;border:2px solid ${ACCENT};border-radius:6px;pointer-events:none;opacity:0;translate:0 0 44px;box-shadow:0 0 0 4px ${ACCENT}22,0 10px 24px -6px ${ACCENT}88;animation:selin .5s cubic-bezier(.2,1.5,.35,1) forwards}
.sel b{position:absolute;width:9px;height:9px;background:#fff;border:2px solid ${ACCENT};border-radius:2px}
.sel b:nth-child(1){left:-6px;top:-6px}.sel b:nth-child(2){right:-6px;top:-6px}.sel b:nth-child(3){left:-6px;bottom:-6px}.sel b:nth-child(4){right:-6px;bottom:-6px}
@keyframes selin{from{opacity:0;transform:scale(1.14) translateZ(40px)}to{opacity:1;transform:none}}
.cur{position:absolute;width:24px;height:24px;z-index:9;translate:0 0 110px;filter:drop-shadow(0 10px 8px #0007)}
.cur svg{width:100%;height:100%}.cur::after{content:'';position:absolute;left:-8px;top:-8px;width:20px;height:20px;border-radius:50%;border:2px solid ${ACCENT};opacity:0;animation:ring .5s ease-out forwards;animation-delay:var(--click,9s)}
@keyframes ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.8)}}
.pop{opacity:0;transform:scale(.5) translateZ(90px);translate:0 0 22px;animation:pop .6s cubic-bezier(.2,1.65,.35,1) forwards}@keyframes pop{to{opacity:1;transform:none}}
.lf{animation-name:pop,lift;animation-duration:.6s,.55s;animation-timing-function:cubic-bezier(.2,1.65,.35,1),cubic-bezier(.2,1.6,.35,1);animation-fill-mode:forwards}
.up.lf{animation-name:up,lift}
@keyframes lift{to{translate:0 0 64px}}@keyframes lifts{to{translate:0 0 64px;box-shadow:0 28px 36px -14px ${ACCENT}aa,0 2px 4px #1b23351c}}
.tl.lf{animation-name:pop,lifts}.up.lf.ab{animation-name:up,lifts}
.up{opacity:0;transform:translateY(16px) translateZ(60px) rotateX(-35deg);translate:0 0 10px;animation:up .55s cubic-bezier(.2,1.45,.35,1) forwards}@keyframes up{to{opacity:1;transform:none}}`;
const SEL = (x, y, w, h, delay) => `<div class="sel" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;animation-delay:${delay}s"><b></b><b></b><b></b><b></b></div>`;
// the same box around its parent (which is position:relative), pad px outside it
const SELIN = (pad, delay) => `<div class="sel" style="inset:${-pad}px;animation-delay:${delay}s"><b></b><b></b><b></b><b></b></div>`;
// a cursor that glides from one point to another and clicks there (an arrow, drawn here)
let cid = 0;
const CURSOR = (from, to, t0, t1) => { const n = 'mv' + (cid++); return `<style>@keyframes ${n}{0%{left:${from[0]}px;top:${from[1]}px}100%{left:${to[0]}px;top:${to[1]}px}}</style><div class="cur" style="left:${from[0]}px;top:${from[1]}px;animation:${n} ${(t1 - t0).toFixed(2)}s cubic-bezier(.5,0,.2,1) ${t0}s both;--click:${t1}s"><svg viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`; };
// letters typed in one by one (each its own span, so a long command wraps instead of shrinking)
const TYPE = (text, t0, per = 0.035) => [...String(text)].map((c, i) => `<span class="ch" style="animation-delay:${(t0 + i * per).toFixed(3)}s">${esc(c)}</span>`).join('');
const TYPE_CSS = '.ch{opacity:0;animation:ch .01s linear forwards}@keyframes ch{to{opacity:1}}';
// --o: which way the camera orbits (one way or the other per card, from the card's own text, so cards cut together alternate)
const page = (css, body) => { const o = [...body].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) & 1 ? 1 : -1;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}${TYPE_CSS}${css}</style></head><body><div class="stage"><div class="rig" style="--o:${o}">${body}</div></div></body></html>`; };
const fmt = n => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n));

export function proofHtml(f) {
  const url = `github.com/${f.owner}/${f.repo}`, desc = String(f.description || ''), fs = desc.length > 220 ? 12 : desc.length > 140 ? 13.5 : 15;
  const topics = (f.topics || []).slice(0, 5).map((t, i) => `<em class="up" style="animation-delay:${(0.75 + i * 0.06).toFixed(2)}s">${esc(t)}</em>`).join('');
  const css = `.win{width:540px}.url{margin:0 0 0 10px;flex:1;height:20px;line-height:18px;white-space:nowrap;overflow:hidden;padding:0 10px;border-radius:10px;background:#fff;border:1px solid #dde1e7;font:11px ui-monospace,Menlo,monospace;color:#2b2f36}
    .pg{padding:18px 22px 22px}.nm{font-size:19px;font-weight:600;color:#1f2328;display:flex;align-items:center;gap:8px}.nm s{text-decoration:none;color:#0969da}.pub{font-size:10px;border:1px solid #d0d7de;border-radius:10px;padding:1px 7px;color:#59636e;font-weight:500}
    .row{display:flex;gap:8px;margin-top:12px}.btn{font-size:11px;border:1px solid #d0d7de;border-radius:6px;padding:4px 9px;background:#f6f8fa;color:#1f2328}
    .ab{margin-top:16px;padding:12px 14px;border-radius:10px;background:#fff;border:1px solid #eef0f3;box-shadow:0 2px 5px #1b233522}.ab h4{margin:0 0 6px;font-size:12px;color:#59636e}.ab p{margin:0;font-size:${fs}px;line-height:1.4;color:#1f2328}
    .tp{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.tp em{font-style:normal;font-size:10.5px;color:#0969da;background:#ddf4ff;border-radius:10px;padding:2px 8px}`;
  const body = `<div class="win"><div class="bar"><i></i><i></i><i></i><div class="url">${TYPE(url, 0.05, Math.min(0.015, 0.3 / url.length))}</div></div>
    <div class="pg"><div class="nm up" style="animation-delay:.4s">${esc(f.owner)} / <s>${esc(f.repo)}</s> <span class="pub">Public</span></div>
    <div class="row up" style="animation-delay:.55s">${f.stars != null ? `<span class="btn">&#9734; Star <b>${esc(fmt(f.stars))}</b></span>` : ''}${f.forks != null ? `<span class="btn">Fork <b>${esc(fmt(f.forks))}</b></span>` : ''}${f.language ? `<span class="btn">${esc(f.language)}</span>` : ''}</div>
    <div class="ab up lf" style="position:relative;animation-delay:.65s,1.05s"><h4>About</h4><p>${esc(desc)}</p><div class="tp">${topics}</div>${SELIN(6, 1.1)}</div></div></div>
    ${CURSOR([520, 440], [300, 300], 0.4, 1.1)}`;
  return page(css, body);
}
export function terminalHtml(f, cmds) {
  const c = cmds[0], lines = [];
  // the first command is typed by about 1 s and the rest is up by 1.6 s, so a card cut after 1.2 s already reads as
  // done; whole lines only, as many as fit the window (about 11 rows of 52 characters)
  let t = 0.2, rows = 0; const fits = s => { const n = Math.ceil((String(s).length + 2) / 52) || 1; if (rows + n > 10) return false; rows += n; return true; };
  const typed = (s, cls) => { fits(s); const per = Math.min(0.03, 0.75 / Math.max(s.length, 1)); const h = `<div class="ln up ${cls}" style="animation-delay:${t.toFixed(2)}s;animation-duration:.01s"><span class="ps">$</span> ${TYPE(s, t, per)}</div>`; t += s.length * per + 0.15; return h; };
  const out = (s, cls = '') => { const h = `<div class="ln out up ${cls}" style="animation-delay:${t.toFixed(2)}s">${esc(s)}</div>`; t += 0.12; return h; };
  lines.push(typed(c.cmd, 'cmd first'));
  const files = f.files || [];
  if (/^git clone\b/.test(c.cmd)) {
    lines.push(out(`Cloning into '${f.repo}'...`)); fits('x');
    // the whole top level or nothing, so the list never looks complete when it is not
    if (files.length && files.length <= 12 && rows + 1 + Math.ceil(files.length / 2) <= 10) { lines.push(typed('ls', 'cmd')); lines.push(`<div class="ln out files up" style="animation-delay:${t.toFixed(2)}s">${files.map(x => `<span>${esc(x)}</span>`).join('')}</div>`); t += 0.1; }
  } else {
    for (const l of c.after) if (fits(l)) lines.push(out(l));
    if (cmds[1] && rows + Math.ceil((cmds[1].cmd.length + 2) / 52) <= 10) { lines.push(typed(cmds[1].cmd, 'cmd')); for (const l of cmds[1].after.slice(0, 2)) if (fits(l)) lines.push(out(l)); }
  }
  const css = `.win{width:540px;background:linear-gradient(180deg,#141820,#0b0e13);box-shadow:0 1px 0 #ffffff30 inset,0 0 0 1px #ffffff26,0 14px 28px -8px #000c,0 40px 90px -20px ${ACCENT}70}.bar{background:#1a1e25;border-color:#252a33;color:#9aa3ae}
    .tx{padding:16px 18px 20px;min-height:230px;font:14px/1.55 'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;color:#d6dbe1}
    .ln{white-space:pre-wrap;word-break:break-word}.ps{color:#5ee08f}.cmd{color:#f5f7fa}.out{color:#9aa3ae}
    .first{position:relative}.files{display:grid;grid-template-columns:repeat(2,1fr);gap:1px 14px;color:#8fb8ff;font-size:12px;overflow-wrap:anywhere}
    .caret{display:inline-block;width:8px;height:16px;background:#d6dbe1;vertical-align:middle;animation:blink 1s steps(2) infinite}@keyframes blink{50%{opacity:0}}`;
  const body = `<div class="win" style="position:relative"><div class="bar"><i></i><i></i><i></i><span>${esc(f.repo)} — zsh</span></div><div class="tx">${lines.join('')}<div class="ln up" style="animation-delay:${t.toFixed(2)}s;animation-duration:.01s"><span class="ps">$</span> <span class="caret"></span></div></div>
    ${SEL(8, 38, 524, 30 + Math.ceil((c.cmd.length + 2) / 52) * 22, (0.2 + Math.min(0.75, c.cmd.length * 0.03) + 0.1).toFixed(2))}</div>
    ${CURSOR([560, 60], [120, 120], 0, 0.2)}`;
  return page(css, body);
}
// a small glyph per tile (plain shapes drawn here, no icon set and no brand marks)
const GLYPHS = ['<circle cx="12" cy="12" r="7"/>', '<rect x="5" y="5" width="14" height="14" rx="3"/>', '<path d="M12 4l8 15H4z"/>', '<path d="M4 12h16M12 4v16"/>', '<path d="M5 17l5-6 4 4 5-8"/>', '<path d="M12 3l2.6 5.6 6 .7-4.5 4 1.3 6-5.4-3-5.4 3 1.3-6-4.5-4 6-.7z"/>', '<path d="M4 7h16v10H4zM8 7V5h8v2"/>', '<path d="M7 4h10v16l-5-3-5 3z"/>', '<circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/>'];
const glyph = i => `<svg viewBox="0 0 24 24" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${GLYPHS[i % GLYPHS.length]}</svg>`;
export function featuresHtml(f, feat) {
  const items = feat.items, n = items.length;
  if (n <= 6 && !feat.grid) {
    // a wheel: the repo in the middle, its features around it, the spokes drawing out one by one
    const R = 150, cx = 270, cy = 205;
    const pts = items.map((_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + R * Math.cos(a), cy + R * 0.82 * Math.sin(a)]; });
    const spokes = pts.map(([x, y], i) => `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" pathLength="1" style="animation-delay:${(0.2 + i * 0.13).toFixed(2)}s"/>`).join('');
    const nodes = items.map((t, i) => `<div class="nd pop${i ? '' : ' lf'}" style="left:${pts[i][0].toFixed(1)}px;top:${pts[i][1].toFixed(1)}px;animation-delay:${(0.3 + i * 0.13).toFixed(2)}s${i ? '' : `,${(0.3 + n * 0.13 + 0.1).toFixed(2)}s`}"><span class="g">${glyph(i)}</span><span class="t">${esc(t)}</span></div>`).join('');
    const css = `.win{width:540px;height:430px}.wh{position:absolute;left:0;top:30px;width:540px;height:400px}
      svg.sp{position:absolute;inset:0}svg.sp line{stroke:${ACCENT};stroke-opacity:.45;stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1;animation:draw .4s ease-out forwards}@keyframes draw{to{stroke-dashoffset:0}}
      .hub{position:absolute;left:${cx}px;top:${cy}px;transform:translate(-50%,-50%);width:118px;height:118px;border-radius:50%;background:radial-gradient(circle at 34% 28%,#9cc4ff 0%,${ACCENT} 45%,#1a4fb0 100%);translate:0 0 40px;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;font-size:${f.repo.length > 16 ? 11.5 : 14}px;padding:10px;box-shadow:0 18px 34px -8px ${ACCENT}aa,0 4px 10px #0b1a3a55,inset 0 -6px 14px #0b2a6a55;word-break:break-word}
      .nd{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:5px;width:130px;text-align:center}.nd.pop{transform:translate(-50%,-50%) scale(.6)}
      @keyframes pop{to{opacity:1;transform:translate(-50%,-50%)}}.g{width:38px;height:38px;border-radius:11px;background:#fff;border:1.5px solid #dfe5ee;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 18px -6px #1b23354d,0 2px 3px #1b233522;background:linear-gradient(180deg,#fff,#eef2f8)}.g svg{width:22px;height:22px}
      .t{font-size:12.5px;font-weight:650;line-height:1.2;background:#fff;padding:2px 6px;border-radius:6px;box-shadow:0 4px 10px -4px #1b233544}`;
    const [hx, hy] = pts[0];
    return page(css, `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(feat.heading || f.repo)}</span></div><div class="wh"><svg class="sp" viewBox="0 0 540 400">${spokes}</svg><div class="hub pop" style="animation-delay:.05s">${esc(f.repo)}</div>${nodes}${SEL(hx - 72, hy - 32, 144, 64, (0.3 + n * 0.13 + 0.15).toFixed(2))}</div></div>${CURSOR([560, 470], [hx + 60, hy + 80], 0.3, 0.3 + n * 0.13 + 0.2)}`);
  }
  const cols = 3, rows = Math.ceil(n / cols);
  const tiles = items.map((t, i) => `<div class="tl pop${i ? '' : ' lf'}" style="animation-delay:${(0.15 + i * 0.1).toFixed(2)}s${i ? '' : `,${(0.15 + n * 0.1 + 0.1).toFixed(2)}s`}"><span class="g">${glyph(i)}</span><span>${esc(t)}</span></div>`).join('');
  const css = `.win{width:540px}.gr{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:16px;position:relative}
    .tl{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:linear-gradient(180deg,#ffffff,#eef2f8);border:1.5px solid #e4e9f1;box-shadow:0 14px 22px -12px #1b233566,0 2px 4px #1b23351c;font-size:13px;font-weight:650;min-height:${rows > 2 ? 84 : 104}px}
    .g{width:32px;height:32px;border-radius:9px;background:#fff;border:1.5px solid #dfe5ee;display:flex;align-items:center;justify-content:center}.g svg{width:19px;height:19px}`;
  return page(css, `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(feat.heading || f.repo)}</span></div><div class="gr">${tiles}${SEL(12, 12, 166, rows > 2 ? 90 : 110, (0.15 + n * 0.1 + 0.15).toFixed(2))}</div></div>${CURSOR([560, 470], [150, 140], 0.3, 0.15 + n * 0.1 + 0.2)}`);
}
export function flowHtml(f, fl) {
  const ins = fl.inputs.map((x, i) => `<div class="ch2 up" style="animation-delay:${(0.1 + i * 0.1).toFixed(2)}s">${esc(x)}</div>`).join('');
  const css = `.win{width:550px}.fl{display:grid;grid-template-columns:1fr 46px 150px 46px 1fr;align-items:center;padding:34px 16px 40px;gap:0;position:relative}
    .col{display:flex;flex-direction:column;gap:9px}.ch2{padding:10px 11px;border-radius:10px;background:linear-gradient(180deg,#fff,#eef2f8);border:1.5px solid #e1e6ee;box-shadow:0 12px 18px -10px #1b233566;font-size:13px;font-weight:600;text-align:center;line-height:1.25}
    .ar{height:4px;background:linear-gradient(90deg,${ACCENT} 50%,transparent 0) 0 0/12px 4px;transform-origin:left;transform:scaleX(0);animation:grow .45s ease-out forwards;position:relative}
    .ar::after{content:'';position:absolute;right:-2px;top:-5px;border:7px solid transparent;border-left:9px solid ${ACCENT};border-right:0}
    @keyframes grow{to{transform:scaleX(1)}}.tool{height:120px;border-radius:18px;background:${ACCENT};color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px;font-weight:700;font-size:${f.repo.length > 16 ? 12.5 : 15}px;word-break:break-word;background:linear-gradient(160deg,#7fb1ff 0%,${ACCENT} 40%,#1d54b8 100%);translate:0 0 36px;box-shadow:0 22px 34px -10px ${ACCENT}aa,inset 0 1px 0 #ffffff70,inset 0 -8px 16px #0b2a6a55;animation:pop .4s cubic-bezier(.2,1.6,.4,1) .5s forwards,pulse 1.2s ease-in-out 1.3s 2}
    @keyframes pulse{50%{transform:scale(1.05)}}.outc{background:#fff;border-color:${ACCENT};color:#0b3b8c}`;
  return page(css, `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(f.repo)}</span></div><div class="fl"><div class="col">${ins}</div><div class="ar" style="animation-delay:.3s"></div><div class="tool pop">${esc(f.repo)}</div><div class="ar" style="animation-delay:.8s"></div><div class="col"><div class="ch2 outc up" style="animation-delay:1.1s">${esc(fl.output)}</div></div>${SEL(392, 40, 146, 120, 1.35)}</div></div>${CURSOR([40, 460], [470, 150], 0.6, 1.35)}`);
}
export function statsHtml(f) {
  const stars = Math.max(0, f.stars | 0), dots = Math.min(stars, 100), cells = stars <= 100 ? Math.max(25, Math.ceil(stars / 5) * 5) : 100;
  const grid = Array.from({ length: cells }, (_, i) => `<i class="${i < dots ? 'on' : ''}" style="${i < dots ? `animation-delay:${(0.2 + (i / Math.max(dots, 1)) * 0.9).toFixed(2)}s` : ''}"></i>`).join('');
  const chip = (k, v, d) => (v ? `<div class="kv up" style="animation-delay:${d}s"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '');
  const css = `@property --n{syntax:'<integer>';initial-value:0;inherits:false}.win{width:540px}.st{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:22px;align-items:center;position:relative}
    .big{font-size:${String(stars).length > 5 ? 54 : 70}px;font-weight:800;letter-spacing:-.03em;color:#14161a;font-variant-numeric:tabular-nums;--n:0;counter-reset:n var(--n);animation:count 1s cubic-bezier(.2,.7,.2,1) .15s forwards}.big::after{content:counter(n)}
    @keyframes count{to{--n:${stars}}}.lb{font-size:14px;color:#59636e;font-weight:600;margin-top:2px}.lb s{text-decoration:none;color:${ACCENT}}
    .dg{display:grid;grid-template-columns:repeat(${cells > 50 ? 10 : 5},1fr);gap:${cells > 50 ? 4 : 7}px}.dg i{aspect-ratio:1;border-radius:50%;background:#e3e7ee}.dg i.on{animation:fill .25s ease-out forwards}@keyframes fill{to{background:${ACCENT};transform:scale(1.08)}}
    .kvs{grid-column:1/3;display:flex;gap:10px;flex-wrap:wrap}.kv{display:flex;gap:6px;align-items:baseline;padding:7px 11px;border-radius:9px;background:#f4f6fa;border:1.5px solid #e1e6ee;font-size:12.5px}.kv span{color:#59636e}`;
  return page(css, `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(f.owner)}/${esc(f.repo)}</span></div><div class="st"><div style="position:relative"><div class="big"></div><div class="lb"><s>&#9733;</s> stars on GitHub</div>${SELIN(10, 1.25)}</div><div class="dg">${grid}</div>
    <div class="kvs">${chip('Language', f.language, 0.9)}${chip('License', f.license, 1.0)}${chip('Forks', f.forks != null ? String(f.forks) : '', 1.1)}</div></div></div>${CURSOR([560, 460], [200, 150], 0.6, 1.25)}`);
}
// one README picture in a window card (data: URL, as nothing else may load), drifting in with the selection box
export function shotHtml(f, img, title) {
  const css = `.win{width:560px}.im{display:block;width:100%;max-height:400px;object-fit:contain;background:#fff;animation:drift ${SECONDS}s ease-in-out both}@keyframes drift{from{transform:scale(1)}to{transform:scale(1.06)}}.vw{overflow:hidden;position:relative}`;
  return page(css, `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(title || f.repo)}</span></div><div class="vw"><img class="im" src="${img}">${SELIN(-10, 0.6)}</div></div>${CURSOR([580, 470], [420, 330], 0.4, 1.6)}`);
}

// ---------- which scenes ----------
// facts: { owner, repo, description, stars, forks, language, license, topics, files }; md: the README text
export function scenesFor(facts, md, meta = null) {
  const q = readmeScore(meta), out = [];
  if (String(facts.description || '').trim()) out.push({ id: 'proof', heading: 'About', alt: `${facts.owner}/${facts.repo} on GitHub: ${facts.description}`, once: true });
  let cmds = commands(md); if (!cmds.length) cmds = [{ cmd: `git clone https://github.com/${facts.owner}/${facts.repo}`, after: [], heading: 'Install' }];
  out.push({ id: 'terminal', heading: cmds[0].heading || 'Install', alt: `install ${cmds.map(c => c.cmd).join(' ')}`, cmds: cmds.slice(0, 2) });
  if (!q.good) {
    const feat = features(md); if (feat) out.push({ id: 'features', heading: feat.heading, alt: feat.items.join(' '), feat });
    // the repo's GitHub topics as a tile grid (a second look at what it is about, in GitHub's own words)
    const tops = (facts.topics || []).map(x => String(x).replace(/-/g, ' ')).filter(x => x.length <= 24).slice(0, 6);
    if (tops.length >= 3) out.push({ id: 'topics', heading: 'Topics', alt: tops.join(' '), feat: { heading: 'Topics', items: tops, grid: true } });
    const fl = flow(facts.description); if (fl) out.push({ id: 'flow', heading: 'How it works', alt: `${fl.inputs.join(' ')} ${fl.output}`, flow: fl });
    if (facts.stars >= 10) out.push({ id: 'stars', heading: 'Stars', alt: `stars ${facts.language || ''}` });
  }
  return { quality: q, scenes: out };
}
export function sceneHtml(s, facts) {
  if (s.id === 'proof') return proofHtml(facts);
  if (s.id === 'terminal') return terminalHtml(facts, s.cmds);
  if (s.id === 'features' || s.id === 'topics') return featuresHtml(facts, s.feat);
  if (s.id === 'flow') return flowHtml(facts, s.flow);
  if (s.id === 'stars') return statsHtml(facts);
  if (s.id === 'shot') return shotHtml(facts, s.img, s.title);
  throw new Error('no such scene: ' + s.id);
}

// ---------- render ----------
// pages: [{ html, out }] -> each to an MP4 of SECONDS at FPS, one Chrome for all
export async function renderPages(pages, { seconds = SECONDS, fps = FPS } = {}) {
  if (!pages.length) return [];
  const { chromium } = require('playwright-core'); const { findChrome } = await import('./chrome.mjs');
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-first-run', '--disable-extensions'] });
  try {
    for (const p of pages) {
      const dir = join(tmpdir(), 'repo-mock-' + createHash('sha1').update(p.out).digest('hex').slice(0, 10)); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width: VIEW[0], height: VIEW[1] }, deviceScaleFactor: 2, javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false, offline: true });
      try {
        await ctx.route('**/*', r => (/^(data|about):/.test(r.request().url()) ? r.continue() : r.abort()));
        const pg = await ctx.newPage(); await pg.setContent(p.html, { waitUntil: 'load' });
        const n = Math.round(seconds * fps);
        for (let i = 0; i < n; i++) {
          await pg.evaluate(ms => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, (i * 1000) / fps);
          await pg.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 });
        }
        await ctx.close();
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, '%04d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '19', '-an', '-movflags', '+faststart', p.out], { timeout: 120000 });
      } finally { await ctx.close().catch(() => {}); rmSync(dir, { recursive: true, force: true }); }
    }
  } finally { await browser.close(); }
  return pages.map(p => p.out);
}
// a README picture as a data: URL, scaled down first (FFmpeg) so the page stays small (a picture over 40 megapixels is
// left out rather than decoded)
function dataUrl(file) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8', timeout: 30000 }).trim().split(',').map(Number);
  if (!(w * h > 0) || w * h > 40e6) throw new Error('too big or unreadable');
  const tmp = join(tmpdir(), `repo-shot-${process.pid}-${Date.now()}.jpg`);
  try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-i', file, '-vf', "scale='min(1200,iw)':-2", '-frames:v', '1', '-q:v', '3', tmp], { stdio: 'ignore', timeout: 60000 }); return 'data:image/jpeg;base64,' + readFileSync(tmp).toString('base64'); }
  finally { rmSync(tmp, { force: true }); }
}
// a fetched repo folder (kit/repo-broll.mjs fetchRepo) -> the card assets for planRepo: the mockups, the README's pictures
// each in a window card, and its videos as they are. Rendered once per folder and look (mock/<hash>/), then cached.
// { assets: [{ file (relative to dir), kind: 'video', seconds, heading, alt, mock, once }], quality }
export async function cardAssets(meta, dir, { render = renderPages, log = () => {} } = {}) {
  const facts = { owner: meta.owner, repo: meta.repo, ...(meta.facts || {}), description: (meta.header && meta.header.description) || '', stars: meta.header ? meta.header.stars : null };
  const md = existsSync(join(dir, 'readme.md')) ? readFileSync(join(dir, 'readme.md'), 'utf8') : '';
  const { quality, scenes } = scenesFor(facts, md, meta);
  const own = (meta.assets || []).filter(a => !a.header && !a.capture);
  const pics = own.filter(a => a.kind === 'image').map(a => ({ id: 'shot', heading: a.heading, alt: a.alt, title: [facts.repo, a.heading].filter(Boolean).join(' — '), src: a.file }));
  // at most 6 README pictures (a reel changes its card every 2 to 4 s, so about 8 cards cover 30 s; fewer renders)
  const proof = scenes.filter(x => x.id === 'proof'), term = scenes.filter(x => x.id === 'terminal');
  const all = (quality.good ? [...proof, ...pics.slice(0, 1), ...term, ...pics.slice(1, 6)] : [...scenes, ...pics.slice(0, 3)]).slice(0, 8);
  const key = createHash('sha1').update(JSON.stringify({ GEN, facts, all: all.map(({ img, ...s }) => s) })).digest('hex').slice(0, 12), mdir = join(dir, 'mock', key);
  const listF = join(mdir, 'list.json');
  let list = null; try { list = JSON.parse(readFileSync(listF, 'utf8')); if (!list.every(x => existsSync(join(dir, x.file)))) list = null; } catch {}
  if (!list) {
    // other looks stay (a cut made before may still point at them); a new look gets its own folder
    if (freemem() < MIN_FREE) throw new Error(`only ${(freemem() / 2 ** 30).toFixed(1)} GB of memory free, the cards need about ${(MIN_FREE / 2 ** 30).toFixed(1)} GB`);
    mkdirSync(mdir, { recursive: true });
    const pages = all.map((s, i) => ({ s, out: join(mdir, `${String(i + 1).padStart(2, '0')}-${s.id}.mp4`) }))
      .filter(p => { if (p.s.id !== 'shot') return true; try { p.s.img = dataUrl(join(dir, p.s.src)); return true; } catch { log(`a README picture could not be read, left out: ${p.s.src}`); return false; } });
    log(`making ${pages.length} animated cards (${pages.map(p => p.s.id).join(', ')}): ${quality.why}`);
    await render(pages.map(p => ({ html: sceneHtml(p.s, facts), out: p.out })));
    list = pages.map(p => ({ file: join('mock', key, p.out.split(/[\\/]/).pop()), kind: 'video', seconds: SECONDS, heading: p.s.heading || '', alt: p.s.alt || '', mock: p.s.id, ...(p.s.once ? { once: true } : {}) }));
    writeFileSync(listF, JSON.stringify(list, null, 1) + '\n');
  }
  const vids = own.filter(a => a.kind === 'video');
  return { quality, assets: [...list, ...vids] };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2), url = a.find(x => !x.startsWith('--'));
  if (!url) { console.error('usage: repo-mockups.mjs <https://github.com/owner/repo> [--force] [--json]'); process.exit(2); }
  const RB = await import('./repo-broll.mjs');
  const m = await RB.fetchRepo(url, { force: a.includes('--force'), log: x => console.error(x) });
  if (m.failed) { console.error('we could not read that repo: check the link, or try again online'); process.exit(1); }
  const r = await cardAssets(m, m.dir, { log: x => console.error(x) });
  console.log(a.includes('--json') ? JSON.stringify({ quality: r.quality, files: r.assets.map(x => join(m.dir, x.file)) }) : [`${m.url}: ${r.quality.why} (${r.quality.good ? 'good' : 'weak'})`, ...r.assets.map(x => `  ${x.mock || 'readme video'}: ${join(m.dir, x.file)}`)].join('\n'));
}
