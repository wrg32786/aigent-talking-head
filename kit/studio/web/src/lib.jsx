// Shared helpers for the Studio page. Everything goes through the local server's /api.
export const file = p => '/files/' + p.split('/').map(encodeURIComponent).join('/');
export const RM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isPaused = () => localStorage.getItem('studio.paused') ? localStorage.getItem('studio.paused') === '1' : RM;

const toastSubs = new Set();
export const onToast = fn => { toastSubs.add(fn); return () => toastSubs.delete(fn); };
// fix: fix ids (kit/studio/fixes.mjs) from an error; the toast then shows the fix buttons instead of a command
export const toast = (msg, ok, fix) => toastSubs.forEach(fn => fn({ msg, ok, fix: fix ? [].concat(fix) : null, at: Date.now() }));

export async function api(path, body, method) {
  const r = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || `request failed (${r.status})`, false, j.fix); throw new Error(j.error || r.status); }
  return j;
}

export const STEPS = ['footage', 'cut', 'look', 'broll', 'finish', 'post'];
export const STEP_LABEL = { broll: 'B-roll' };
// the step names before 1.13.0, so old links and saved places still land: Style and Reference are both in Look now,
// and Render is Finish
export const STEP_ALIAS = { style: 'look', reference: 'look', render: 'finish' };
export const stepOf = st => STEP_ALIAS[st] || st;
export const lookSubOf = st => (st === 'reference' ? 'reference' : st === 'style' ? 'style' : null);
export const stepName = st => STEP_LABEL[st] || cap1(st);
export const SITE = { youtube: 'YouTube', 'youtube-shorts': 'Shorts', tiktok: 'TikTok', x: 'X', vimeo: 'Vimeo', instagram: 'Instagram', file: 'File', other: 'Link' };
export const STATUS = { queued: 'Waiting', downloading: 'Downloading', tearing: 'Breaking down', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
export const KIND_NAME = { transition: 'transition', entrance: 'title entrance', captionEntrance: 'caption entrance', captionStyle: 'caption style', graphic: 'graphic', effect: 'effect', finish: 'finish', font: 'font pairing', look: 'look', theme: 'theme', titleLayer: 'title layer', bed: 'music bed', sfx: 'sound', beatSync: 'beat sync', editing: 'editing' };
export const MSG_STATUS = { queued: 'Queued', seen: 'Seen', answered: 'Answered' };
export const SETUP_LINE = 'Set up Studio from AGENTS.md and run the Studio chat loop';
export const pickState = (s, it) => { if (it && it.kind === 'bed') return s.music && s.music.bed === it.id ? 'allow' : null; const p = s.picks[it.kind === 'editing' ? 'editing' : it.kind]; if (!p) return null; return p.allow.includes(it.id) ? 'allow' : p.deny.includes(it.id) ? 'deny' : null; };
export const fmtS = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
export const cap1 = x => x[0].toUpperCase() + x.slice(1);
export const grow = t => { if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 160) + 'px'; };

// Icons: drawn for Studio on a 24 px grid, stroke only.
const P = {
  sliders: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  upload: <path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  ban: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  send: <path d="M5 12h13M13 6l6 6-6 6" />,
  chat: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  play: <path d="M8 5.5v13l10-6.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  retry: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  film: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M16 3v18M4 8h4M4 13h4M16 8h4M16 13h4M4 17h4M16 17h4" /></>,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  camera: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  grid: <path d="M9 4v16M15 4v16M4 9h16M4 15h16" />,
  script: <path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  dup: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V5a1 1 0 0 1 1-1h11" /></>,
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  minus: <path d="M5 12h14" />,
  up: <path d="M5 15l7-7 7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="3" strokeLinecap="round" />,
  popout: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  home: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="3" />,
  spark: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
};
export const Icon = ({ n, className }) => <svg className={'ic' + (className ? ' ' + className : '')} viewBox="0 0 24 24" aria-hidden="true">{P[n]}</svg>;
export const IconBtn = ({ n, label, onClick, className = '', ...rest }) => <button type="button" className={'icon-btn ' + className} aria-label={label} title={label} onClick={onClick} {...rest}><Icon n={n} /></button>;

// Script timing, the same rules as kit/studio/scripts.mjs: [hook] [body] [cta] lines start sections, [pause] holds 1.5 s.
export const PAUSE_S = 1.5;
const countWords = t => t.split(/\s+/).filter(x => /[\p{L}\p{N}]/u.test(x)).length;
export function cue(text, wpm = 150) {
  const out = []; let t = 0, section = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    const m = l.match(/^\[(hook|body|cta)\]$/i); if (m) { section = m[1].toLowerCase(); continue; }
    const pause = (l.match(/\[pause\]/gi) || []).length, shown = l.replace(/\s*\[pause\]\s*/gi, ' ').trim();
    const words = countWords(shown), dur = (words / wpm) * 60 + pause * PAUSE_S;
    out.push({ text: shown, words, pause, section, at: t, dur }); section = null; t += dur;
  }
  return out;
}
export function scriptStats(text, wpm = 150) {
  const c = cue(text, wpm), secs = [];
  let pending = null;
  for (const raw of String(text || '').split(/\r?\n/)) { const m = raw.trim().match(/^\[(hook|body|cta)\]$/i); if (m) pending = m[1].toLowerCase(); else if (raw.trim() && pending) { const line = c.find(x => x.section === pending && !secs.some(s => s.line === x)); if (line) secs.push({ name: pending, at: line.at, line }); pending = null; } }
  const total = c.reduce((a, x) => a + x.dur, 0);
  return { words: c.reduce((a, x) => a + x.words, 0), pauses: c.reduce((a, x) => a + x.pause, 0), seconds: Math.round(total), sections: secs.map(s => ({ name: s.name, at: Math.round(s.at) })) };
}
