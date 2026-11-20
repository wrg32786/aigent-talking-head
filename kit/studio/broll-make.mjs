// Agent-made b-roll: cards drawn from words, rendered on this computer with headless Chrome to a short mp4.
//   chart     { title, bars: [{ label, value }], unit }          bars grow in
//   counter   { from, to, prefix, suffix, label }                a number counts up
//   quote     { text, author }                                   a pull quote
//   code      { code, lang, title }                              a code card
//   terminal  { lines: ["$ npm i", "added 12 packages"], title } lines type in
//   html      { html, css }                                      your own HTML and CSS scene (no scripts, no network)
// Every kind also takes seconds (1 to 8, default 3), aspect (9:16, 16:9, 1:1), theme (dark, light) and accent (#hex).
// The page runs with JavaScript off and every request blocked except data: URLs, so a scene cannot reach anything.
// Each frame sets every CSS animation to its time and takes a screenshot, so motion is exact at 24 fps.
import { mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { createRequire } from 'module';
import { findChrome } from '../chrome.mjs';

const require = createRequire(import.meta.url);
export const KINDS = ['chart', 'counter', 'quote', 'code', 'terminal', 'html'];
const bad = m => Object.assign(new Error(m), { code: 400 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const SIZES = { '9:16': [540, 960], '16:9': [960, 540], '1:1': [720, 720] };

export function titleOf(spec) {
  const s = spec || {};
  if (s.kind === 'chart') return `Chart: ${s.title || (s.bars || []).map(b => b.label).join(', ')}`.slice(0, 70);
  if (s.kind === 'counter') return `Counter: ${s.prefix || ''}${s.to}${s.suffix || ''} ${s.label || ''}`.trim().slice(0, 70);
  if (s.kind === 'quote') return `Quote: ${String(s.text || '').slice(0, 50)}`;
  if (s.kind === 'code') return `Code: ${s.title || s.lang || 'snippet'}`;
  if (s.kind === 'terminal') return `Terminal: ${String((s.lines || [])[0] || '').slice(0, 50)}`;
  return 'HTML scene';
}
export function html(spec) {
  const s = spec || {}; if (!KINDS.includes(s.kind)) throw bad(`kind: ${KINDS.join(', ')}`);
  const dark = s.theme !== 'light', fg = dark ? '#f5f5f2' : '#111', bg = dark ? '#0d0f12' : '#f6f4ef', muted = dark ? '#9aa0a8' : '#5a5f66';
  const accent = /^#[0-9a-f]{3,8}$/i.test(String(s.accent || '')) ? s.accent : '#ffcc33';
  const secs = Math.max(1, Math.min(8, num(s.seconds, 3)));
  let body = '', css = '';
  if (s.kind === 'chart') {
    const bars = (Array.isArray(s.bars) ? s.bars : []).slice(0, 8).map(b => ({ label: String(b.label || '').slice(0, 24), value: num(b.value, 0) }));
    if (!bars.length) throw bad('chart: bars: [{ label, value }]');
    const max = Math.max(...bars.map(b => Math.abs(b.value)), 1e-9), unit = esc(s.unit || '');
    body = `<h1>${esc(s.title || '')}</h1><div class="bars">${bars.map((b, i) => `<div class="row"><span class="l">${esc(b.label)}</span><span class="track"><i style="--w:${(Math.abs(b.value) / max * 100).toFixed(1)}%;animation-delay:${(0.15 + i * 0.12).toFixed(2)}s"></i></span><b style="animation-delay:${(0.5 + i * 0.12).toFixed(2)}s">${esc(b.value)}${unit}</b></div>`).join('')}</div>`;
    css = `h1{font-size:6vmin;margin:0 0 6vmin}.bars{display:flex;flex-direction:column;gap:4.4vmin;width:100%}.row{display:grid;grid-template-columns:28% 1fr auto;align-items:center;gap:3vmin;font-size:4.2vmin}.l{color:${muted}}
      .track{height:5vmin;background:${dark ? '#1d2127' : '#e4e1da'};border-radius:1vmin;overflow:hidden}.track i{display:block;height:100%;width:var(--w);background:${accent};border-radius:1vmin;transform-origin:left;transform:scaleX(0);animation:grow .8s cubic-bezier(.2,.8,.2,1) forwards}
      b{opacity:0;animation:in .4s ease forwards}@keyframes grow{to{transform:scaleX(1)}}@keyframes in{to{opacity:1}}`;
  } else if (s.kind === 'counter') {
    const from = Math.round(num(s.from, 0)), to = Math.round(num(s.to, NaN)); if (!Number.isFinite(to)) throw bad('counter: to (a whole number)');
    body = `<div class="n"><span class="p">${esc(s.prefix || '')}</span><span class="c"></span><span class="p">${esc(s.suffix || '')}</span></div><div class="lab">${esc(s.label || '')}</div>`;
    css = `@property --n{syntax:'<integer>';initial-value:0;inherits:false}.c{--n:${from};counter-reset:n var(--n);animation:count ${Math.max(0.6, secs * 0.6).toFixed(2)}s cubic-bezier(.2,.7,.2,1) .15s forwards}.c::after{content:counter(n)}
      @keyframes count{from{--n:${from}}to{--n:${to}}}.n{font-size:${String(Math.abs(to)).length > 6 ? 13 : 18}vmin;font-weight:800;color:${accent};letter-spacing:-.02em;font-variant-numeric:tabular-nums}.lab{font-size:5vmin;color:${muted};margin-top:2vmin;text-align:center}`;
  } else if (s.kind === 'quote') {
    if (!String(s.text || '').trim()) throw bad('quote: text');
    body = `<blockquote>${esc(String(s.text).slice(0, 220))}</blockquote>${s.author ? `<cite>${esc(s.author)}</cite>` : ''}`;
    css = `blockquote{font-size:${String(s.text).length > 120 ? 5.4 : 7}vmin;line-height:1.25;margin:0;font-weight:700;border-left:1.4vmin solid ${accent};padding-left:4vmin;opacity:0;transform:translateY(3vmin);animation:up .7s ease forwards .1s}
      cite{display:block;margin-top:5vmin;font-size:4vmin;color:${muted};font-style:normal;opacity:0;animation:up .6s ease forwards .6s}@keyframes up{to{opacity:1;transform:none}}`;
  } else if (s.kind === 'code') {
    if (!String(s.code || '').trim()) throw bad('code: code');
    const lines = String(s.code).split('\n').slice(0, 16);
    body = `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(s.title || s.lang || '')}</span></div><pre>${lines.map((l, i) => `<div class="ln" style="animation-delay:${(0.1 + i * 0.08).toFixed(2)}s"><em>${i + 1}</em>${esc(l) || ' '}</div>`).join('')}</pre></div>`;
    css = `.win{width:100%;background:#15181d;border-radius:2vmin;overflow:hidden;box-shadow:0 2vmin 6vmin #0008}.bar{display:flex;gap:1.4vmin;align-items:center;padding:2.4vmin 3vmin;background:#1e2228}.bar i{width:2.2vmin;height:2.2vmin;border-radius:50%;background:#ff5f56}.bar i:nth-child(2){background:#ffbd2e}.bar i:nth-child(3){background:#27c93f}
      .bar span{margin-left:2vmin;color:#9aa0a8;font:3vmin ui-monospace,monospace}pre{margin:0;padding:3vmin;font:4vmin/1.45 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#e6e6e6;white-space:pre-wrap;word-break:break-word}.ln{opacity:0;animation:in .25s ease forwards}.ln em{color:#5c6370;font-style:normal;display:inline-block;width:6vmin}@keyframes in{to{opacity:1}}`;
  } else if (s.kind === 'terminal') {
    const lines = (Array.isArray(s.lines) ? s.lines : String(s.lines || '').split('\n')).map(String).filter(Boolean).slice(0, 12); if (!lines.length) throw bad('terminal: lines');
    const fs = Math.min(4.4, 76 / (0.62 * Math.max(...lines.map(l => l.length)))).toFixed(2); let t = 0.2; const per = Math.max(0.25, (secs * 0.7) / lines.length);
    body = `<div class="win"><div class="bar"><span>${esc(s.title || 'terminal')}</span></div><div class="tx">${lines.map(l => { const cmd = /^\s*[$>#]/.test(l), d = t; t += cmd ? per * 1.2 : per * 0.5;
      return `<div class="ln${cmd ? ' cmd' : ''}" style="--c:${Math.max(1, l.length)};animation-delay:${d.toFixed(2)}s;animation-duration:${cmd ? (per).toFixed(2) : '0.05'}s">${esc(l)}</div>`; }).join('')}</div></div>`;
    css = `.win{width:100%;background:#0b0d10;border:.3vmin solid #2a2f36;border-radius:2vmin;overflow:hidden}.bar{padding:2vmin 3vmin;background:#171a1f;color:#9aa0a8;font:3vmin ui-monospace,monospace}.tx{padding:3vmin;font:${fs}vmin/1.5 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#cfd3d8}
      .ln{white-space:pre;overflow:hidden;width:0;animation-name:type;animation-fill-mode:forwards;animation-timing-function:steps(var(--c))}.cmd{color:${accent}}@keyframes type{to{width:calc(var(--c) * 1ch)}}`;
  } else {
    if (!String(s.html || '').trim()) throw bad('html: html (and css)');
    if (/<script|javascript:|\son\w+\s*=/i.test(String(s.html))) throw bad('html: no scripts (the scene renders with JavaScript off)');
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:${bg};color:${fg};font-family:Inter,'Helvetica Neue',Arial,sans-serif;overflow:hidden}${String(s.css || '').replace(/<\/style/gi, '')}</style></head><body>${String(s.html).slice(0, 20000)}</body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:${bg};color:${fg};font-family:Inter,'Helvetica Neue',Arial,sans-serif;overflow:hidden}
    body{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0 8vmin;box-sizing:border-box}${css}</style></head><body>${body}</body></html>`;
}
// render a card to mp4; resolves { file, seconds }
export async function make(spec, { out } = {}) {
  const page0 = html(spec), secs = Math.max(1, Math.min(8, num(spec.seconds, 3))), [w, h] = SIZES[spec.aspect] || SIZES['9:16'];
  const { chromium } = require('playwright-core');
  const dir = join(tmpdir(), 'studio-card-' + randomBytes(4).toString('hex')); mkdirSync(dir, { recursive: true });
  const file = out || join(tmpdir(), `card-${randomBytes(4).toString('hex')}.mp4`);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-first-run', '--disable-extensions'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false, offline: true });
    await ctx.route('**/*', r => (/^(data|about):/.test(r.request().url()) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await page.setContent(page0, { waitUntil: 'load' });
    const n = Math.round(secs * 24);
    for (let i = 0; i < n; i++) {
      await page.evaluate(ms => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, (i * 1000) / 24);
      await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 });
    }
  } finally { await browser.close(); }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '24', '-i', join(dir, '%04d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '19', '-an', file]);
  rmSync(dir, { recursive: true, force: true });
  return { file, seconds: secs };
}
