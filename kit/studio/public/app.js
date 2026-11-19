// AIgent Studio page. Plain JavaScript, no build step. Everything goes through the local server's /api.
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const file = p => '/files/' + p.split('/').map(encodeURIComponent).join('/');
const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const paused = () => localStorage.getItem('studio.paused') ? localStorage.getItem('studio.paused') === '1' : RM;
let CAT = null, V = null, TAB = (location.hash.match(/menu=([a-z-]+)/) || [])[1] || null, choicesCache = null, choicesDirty = false;

async function api(path, body, method) {
  const r = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || `request failed (${r.status})`); throw new Error(j.error || r.status); }
  return j;
}
function toast(msg, ok) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (ok ? ' ok' : ''); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200); }
const patch = p => api('/api/state', p).then(apply);

// ---------- icons and small helpers ----------
const svgNS = 'http://www.w3.org/2000/svg';
const icon = n => { const s = document.createElementNS(svgNS, 'svg'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS(svgNS, 'use'); u.setAttribute('href', '#i-' + n); s.append(u); return s; };
const ibtn = (name, label, onclick, extra = {}) => el('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick, ...extra }, icon(name));
const STEPS = ['footage', 'reference', 'style', 'render'];
let STEP = (location.hash.match(/step=([a-z]+)/) || [])[1] || (TAB ? 'style' : localStorage.getItem('studio.step')) || 'footage';
if (!STEPS.includes(STEP)) STEP = 'footage';
function go(step, focus) {
  STEP = step; localStorage.setItem('studio.step', step);
  $('#main').dataset.step = step;
  for (const b of document.querySelectorAll('#stepper button')) b.setAttribute('aria-current', b.dataset.step === step ? 'step' : 'false');
  const i = STEPS.indexOf(step);
  $('#prev').style.visibility = i ? 'visible' : 'hidden';
  $('#next').hidden = i === STEPS.length - 1;
  $('#next').querySelector('span').textContent = i < STEPS.length - 1 ? STEPS[i + 1][0].toUpperCase() + STEPS[i + 1].slice(1) : '';
  if (!/menu=/.test(location.hash)) history.replaceState(null, '', '#step=' + step);
  if (focus) { window.scrollTo({ top: 0 }); const h = document.querySelector(`.step[data-step="${step}"] h2`); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
}
function renderSteps(v) {
  const s = v.state, picks = Object.values(s.picks).some(p => p.allow.length || p.deny.length);
  const done = { footage: !!(s.footage.length || s.clips), reference: !!s.reference.extracted, style: !!(s.pack || picks), render: !!(v.outputs || []).length };
  for (const b of document.querySelectorAll('#stepper button')) { b.parentElement.classList.toggle('done', done[b.dataset.step]); const n = b.querySelector('.sn'); n.replaceChildren(done[b.dataset.step] && b.dataset.step !== STEP ? icon('check') : String(STEPS.indexOf(b.dataset.step) + 1)); }
}

// ---------- render from state ----------
function apply(v) {
  if (!v || !v.state) return;
  V = v; const s = v.state;
  if (document.activeElement !== $('#job')) $('#job').value = s.job || '';
  renderSteps(v); renderFootage(s); renderRef(s); renderPacks(s); renderTabs(); renderGrid(); renderChips(s); renderMusic(s); renderRender(v); renderChat(s);
}
function renderFootage(s) {
  const ul = $('#footage'); ul.replaceChildren();
  if (s.clips) ul.append(el('li', { class: 'note' }, `Using the clips folder ${s.clips}`));
  for (const f of s.footage) ul.append(el('li', {}, el('video', { src: file(f) + '#t=0.5', muted: true, preload: 'metadata', 'aria-label': f }), el('span', { class: 'cap' }, f.split('/').pop()),
    ibtn('x', 'Remove ' + f.split('/').pop(), () => api('/api/footage/remove', { path: f }).then(apply))));
}
const SITE = { youtube: 'YouTube', 'youtube-shorts': 'Shorts', tiktok: 'TikTok', x: 'X', vimeo: 'Vimeo', instagram: 'Instagram', file: 'File', other: 'Link' };
const STATUS = { queued: 'Waiting', downloading: 'Downloading', tearing: 'Breaking down', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
const KIND_NAME = { transition: 'transition', entrance: 'title entrance', captionEntrance: 'caption entrance', captionStyle: 'caption style', graphic: 'graphic', effect: 'effect', finish: 'finish', font: 'font pairing', look: 'look', theme: 'theme', titleLayer: 'title layer', bed: 'music bed', sfx: 'sound', beatSync: 'beat sync', editing: 'editing' };
const MODE_TIP = { influence: 'Influence: borrows its style as soft defaults. Your picks still win.', recreate: 'Recreate: follows its shots, titles and cards with your clip.', off: 'Off: the reference is ignored.' };
function renderRef(s) {
  const r = s.reference, env = V.env, q = r.queue || [], t = env.tools || {};
  $('#ref-tools').replaceChildren(...(t.ytdlp ? [`Works with YouTube, TikTok, X, Vimeo, Instagram and .mp4 links. Use videos you have the rights to.`]
    : [el('span', { class: 'badge warn' }, 'yt-dlp not installed'), ` Direct .mp4 and Instagram links work now. For the rest: `, el('code', {}, 'pip install yt-dlp'), '. Use videos you have the rights to.']));
  $('#ref-go').hidden = r.status !== 'uploaded';
  $('#ref-status').textContent = r.status === 'running' ? 'Breaking it down' : r.status === 'ready' ? 'Reference ready' : '';
  $('#ref-queue').replaceChildren(...q.slice().reverse().map(it => {
    const busy = it.status === 'downloading' || it.status === 'tearing', isActive = r.active === it.id;
    const bar = busy ? el('div', { class: 'bar' + (it.status === 'tearing' || !it.progress ? ' indet' : ''), role: 'progressbar', 'aria-label': STATUS[it.status], 'aria-valuemin': 0, 'aria-valuemax': 100, ...(it.status === 'downloading' && it.progress ? { 'aria-valuenow': it.progress } : {}) }, el('span', { style: it.status === 'downloading' && it.progress ? `width:${it.progress}%` : '' })) : null;
    return el('li', { class: `qi ${it.status}${isActive ? ' active' : ''}` },
      el('span', { class: 'site' }, SITE[it.site] || 'Link'), el('span', { class: 'qt', title: it.url }, it.title || it.url),
      el('span', { class: 'badge' }, isActive && it.status === 'ready' ? 'In use' : (STATUS[it.status] || it.status) + (it.status === 'downloading' && it.progress ? ` ${it.progress}%` : '')),
      el('span', { class: 'qa' }, it.status === 'ready' && !isActive ? ibtn('check', 'Use this reference', () => api('/api/reference/item', { id: it.id, action: 'use' }).then(apply)) : null,
        ['failed', 'cancelled'].includes(it.status) ? ibtn('retry', 'Try again', () => api('/api/reference/item', { id: it.id, action: 'retry' }).then(apply)) : null,
        ibtn('x', (busy ? 'Stop ' : 'Remove ') + (it.title || it.url), () => api('/api/reference/item', { id: it.id, action: 'remove' }).then(apply))),
      bar, it.error ? el('p', { class: 'err' }, it.error) : null, it.trimmed ? el('p', { class: 'fine' }, 'Kept the first part of a longer video.') : null);
  }));
  const out = $('#ref-out'), ex = r.extracted;
  $('#ref-empty').hidden = !!ex || q.length > 0;
  out.hidden = !ex; if (!ex) return;
  const sm = ex.summary || {}, mu = sm.music || {}, item = q.find(x => x.id === r.active);
  const len = sm.seconds || 0, cuts = (sm.cuts || []).filter(c => c > 0 && (!len || c < len));
  const head = el('div', { class: 'td-head' }, el('h3', { title: item ? item.url : '' }, 'Breakdown', el('span', { class: 'fine' }, ' ' + (item ? SITE[item.site] || 'Link' : 'File') + ((ex.summary || {}).engine ? ', ' + ex.summary.engine : ''))),
    el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Reference mode', id: 'ref-mode' }, ...['influence', 'recreate', 'off'].map(m => el('button', { type: 'button', role: 'radio', 'data-v': m, 'aria-checked': String(r.mode === m), title: MODE_TIP[m], onclick: () => patch({ reference: { mode: m } }) }, m[0].toUpperCase() + m.slice(1)))));
  const stat = (b, l) => el('div', { class: 'stat' }, el('b', {}, b), el('span', {}, l));
  const stats = el('div', { class: 'stats' }, stat(len ? `${Math.round(len)} s` : '?', 'length'), stat(String(ex.shots), 'shots'), stat(mu.bpm ? String(mu.bpm) : '?', 'BPM' + (mu.energy ? `, ${mu.energy} energy` : '')), stat(sm.averageShot ? `${sm.averageShot} s` : '?', (sm.pacing || 'pace') + ' cut'));
  let timeline = null;
  if (len) {
    const edges = [0, ...cuts, len], shots = edges.slice(1).map((e, i) => [edges[i], e]);
    const beatGap = mu.bpm ? 60 / mu.bpm : 0, beats = beatGap ? Array.from({ length: Math.min(400, Math.floor(len / beatGap)) }, (_, i) => (i + 1) * beatGap) : [];
    timeline = el('div', { class: 'timeline', role: 'img', 'aria-label': `Timeline: ${shots.length} shots over ${Math.round(len)} seconds${mu.bpm ? `, beat grid at ${mu.bpm} BPM` : ''}` },
      el('div', { class: 'tl' }, ...shots.map(([a, b], i) => el('div', { class: 'shot', style: `width:${((b - a) / len) * 100}%`, title: `Shot ${i + 1}: ${a.toFixed(1)} to ${b.toFixed(1)} s` }, (b - a) / len > 0.06 ? String(i + 1) : ''))),
      beats.length ? el('div', { class: 'beats', 'aria-hidden': 'true' }, ...beats.map(x => el('i', { style: `left:${(x / len) * 100}%` }))) : null,
      el('div', { class: 'tl-legend' }, el('span', {}, '0 s'), mu.bpm ? el('span', {}, `beat grid, ${mu.bpm} BPM`) : el('span', {}), el('span', {}, `${Math.round(len)} s`)));
  }
  const tag = (k, v) => el('span', { class: 'tag' }, el('em', {}, k), v);
  const found = [];
  if (sm.captions && sm.captions.style) found.push(tag('captions', sm.captions.style));
  for (const [k, n] of Object.entries(ex.transitions || {})) found.push(tag('transition', n > 1 ? `${k} x${n}` : k));
  for (const x of ex.entrances || []) found.push(tag('title', x));
  for (const x of ex.finishes || []) found.push(tag('finish', x));
  for (const x of ex.graphics || []) found.push(tag('graphic', x));
  for (const x of ex.effects || []) found.push(tag('effect', x));
  if (ex.titles) found.push(tag('titles', String(ex.titles)));
  const sugg = (sm.suggestions || []).filter(x => CAT.items[x.ref]);
  const chips = sugg.length ? el('div', {}, el('div', { class: 'sugg-h' }, el('span', { class: 'lbl' }, 'Suggested picks'),
      el('button', { class: 'btn outline sm', type: 'button', onclick: () => api('/api/reference/apply', {}).then(v => { apply(v); toast('Reference picks added', true); }) }, 'Pick all')),
    el('div', { class: 'chips' }, ...sugg.map(x => {
      const it = CAT.items[x.ref], st = pickState(s, it);
      return el('button', { class: 'chip' + (st === 'allow' ? ' on' : ''), type: 'button', title: x.why, 'aria-pressed': String(st === 'allow'), onclick: () => patch({ picks: { [x.ref]: st === 'allow' ? 'clear' : 'allow' } }) },
        icon(st === 'allow' ? 'check' : 'plus'), el('span', { class: 'k' }, KIND_NAME[it.kind] || it.kind), it.id);
    }))) : null;
  out.replaceChildren(head, el('div', { class: 'td-body' }, r.contact ? el('img', { src: file(r.contact), alt: 'Contact sheet of the reference, one frame per shot' }) : el('div', { class: 'empty-art' }, icon('film')),
    el('div', {}, stats, timeline, found.length ? el('div', { class: 'found', 'aria-label': 'Found in the reference' }, ...found) : null, chips,
      el('p', { class: 'fine' }, 'Your agent sees this breakdown. Try: "use the transitions from the reference but calmer".'))));
}
function renderPacks(s) {
  const box = $('#packs');
  const mk = (name, label, prev, desc) => el('button', { class: 'pack', type: 'button', role: 'radio', 'aria-checked': String((s.pack || null) === name), title: desc || label, onclick: () => patch({ pack: name }) },
    el('span', { class: 'pv' }, prev ? el('img', { src: file(prev), alt: '', loading: 'lazy', width: 112, height: 199 }) : el('span', { class: 'ph' }, name ? 'No preview' : 'Your picks only')), el('b', {}, name || 'None'));
  box.replaceChildren(mk(null, 'kit defaults, your picks only', null), ...CAT.packs.filter(p => !/^ref-/.test(p.name)).map(p => mk(p.name, (p.label || '').split(':')[0], p.preview, p.description)));
  const n = $('#look-note'), infl = s.reference.mode === 'influence' && s.reference.extracted;
  n.hidden = !infl; n.textContent = infl ? `Plus the reference's look, as the local pack ref-${s.job}.` : '';
}
const pickState = (s, it) => { const k = it.kind === 'editing' ? 'editing' : it.kind; const p = s.picks[k]; if (!p) return null; return p.allow.includes(it.id) ? 'allow' : p.deny.includes(it.id) ? 'deny' : null; };
function setTab(id) { TAB = id; history.replaceState(null, '', '#menu=' + TAB); renderTabs(); renderGrid(); }
function renderTabs() {
  const box = $('#tabs'), s = V.state, hadFocus = box.contains(document.activeElement);
  const cats = CAT.categories.filter(c => c.count > 0);
  if (!TAB || !cats.some(c => c.id === TAB)) TAB = cats[0].id;
  box.replaceChildren(...cats.map(c => {
    const any = c.items.some(r => pickState(s, CAT.items[r]));
    return el('button', { class: 'tab', role: 'tab', type: 'button', id: 'tab-' + c.id, 'aria-selected': String(c.id === TAB), 'aria-controls': 'grid', tabindex: c.id === TAB ? '0' : '-1', onclick: () => setTab(c.id) },
      c.label, el('span', { class: 'c' }, c.count), any ? el('span', { class: 'pd', title: 'has picks', 'aria-label': 'has picks' }) : null);
  }));
  if (hadFocus) $('#tab-' + TAB).focus({ preventScroll: true });
  const ts = $('#tabselect');
  ts.replaceChildren(...cats.map(c => el('option', { value: c.id }, `${c.label} (${c.count})`))); ts.value = TAB;
  ts.onchange = () => setTab(ts.value);
  box.onkeydown = e => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const i = cats.findIndex(c => c.id === TAB); setTab(cats[(i + (e.key === 'ArrowRight' ? 1 : cats.length - 1)) % cats.length].id); $('#tab-' + TAB).focus(); };
}
// hover card: the detail for a tile, instead of text on every tile
function tip(target, it) {
  const t = $('#tip');
  if (!target) { t.hidden = true; return; }
  t.replaceChildren(el('span', { class: 'k' }, KIND_NAME[it.kind] || it.kind), el('b', {}, it.id), it.label ? el('p', {}, it.label) : null,
    it.mode === 'info' ? el('p', {}, el('code', {}, it.flag || '')) : el('p', { class: 'k' }, it.mode === 'one' ? 'Click to pick. One per reel.' : 'Click to pick. Right-click or F to forbid.'));
  t.hidden = false;
  const r = target.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
  let x = r.right + 8, y = r.top;
  if (x + w > innerWidth - 8) x = r.left - w - 8;
  if (x < 8) { x = Math.max(8, Math.min(innerWidth - w - 8, r.left)); y = r.bottom + 8; }
  if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function renderGrid() {
  const c = CAT.categories.find(x => x.id === TAB), s = V.state, q = $('#filter').value.trim().toLowerCase();
  $('#grid').setAttribute('aria-labelledby', 'tab-' + TAB);
  $('#tabhint').textContent = c.hint || '';
  const tiles = c.items.map(r => CAT.items[r]).filter(it => !q || it.id.includes(q) || (it.label || '').toLowerCase().includes(q)).map(it => {
    const st = pickState(s, it), info = it.mode === 'info';
    const still = paused() && it.preview && it.preview.animated ? it.preview.still : null, showAnim = it.preview && (!paused() || !it.preview.animated);
    const media = el('span', { class: 'media' }, showAnim ? el('img', { src: file(it.preview.src), alt: '', loading: 'lazy', decoding: 'async', width: 120, height: 160 }) : still ? el('img', { src: file(still), alt: '', loading: 'lazy', width: 120, height: 160 }) : el('span', { class: 'np' }, it.preview ? 'Paused' : it.id));
    const kind = KIND_NAME[it.kind] || it.kind, canDeny = !info && it.mode !== 'one', did = 'd-' + it.ref.replace(/[^a-z0-9]/gi, '-');
    const setPick = how => patch({ picks: { [it.ref]: how } });
    const pick = el('button', { class: 'pick', type: 'button', 'data-focus': 'p:' + it.ref, 'aria-pressed': info ? null : String(st === 'allow'), 'aria-describedby': did,
      'aria-label': info ? `${it.id}, ${kind}, shown for reference` : `Pick ${it.id}, ${kind}`,
      onclick: () => { if (info) return toast(`${it.id}: set it with ${it.flag}`, true); setPick(st === 'allow' ? 'clear' : 'allow'); },
      oncontextmenu: e => { if (!canDeny) return; e.preventDefault(); setPick(st === 'deny' ? 'clear' : 'deny'); },
      onkeydown: e => { if ((e.key === 'f' || e.key === 'F') && canDeny) { e.preventDefault(); setPick(st === 'deny' ? 'clear' : 'deny'); } } },
      media, el('span', { class: 'nm' }, it.id), el('span', { class: 'ds', id: did }, it.label || ''));
    const flag = info ? 'info' : it.needsCopy ? 'your words' : it.preview && (!it.preview.animated || still) ? 'still' : null;
    const t = el('div', { class: `tile ${st || ''} ${info ? 'info' : ''}`, onmouseenter: e => tip(e.currentTarget, it), onmouseleave: () => tip(null), onfocusin: e => tip(e.currentTarget, it), onfocusout: () => tip(null) }, pick,
      flag ? el('span', { class: 'flag', 'aria-hidden': 'true' }, flag) : null,
      el('span', { class: 'state', 'aria-hidden': 'true' }, st === 'allow' ? icon('check') : st === 'deny' ? icon('x') : null),
      canDeny ? el('button', { class: 'forbid', type: 'button', 'data-focus': 'f:' + it.ref, 'aria-pressed': String(st === 'deny'), 'aria-label': `Forbid ${it.id}`, title: st === 'deny' ? 'Forbidden. Click to allow again.' : 'Forbid', onclick: () => setPick(st === 'deny' ? 'clear' : 'deny') }, icon('ban')) : null);
    return t;
  });
  const g = $('#grid'), fk = g.contains(document.activeElement) && document.activeElement.dataset.focus;
  g.replaceChildren(...(tiles.length ? tiles : [el('p', { class: 'fine' }, 'Nothing matches that search.')]));
  if (fk) { const b = [...g.querySelectorAll('[data-focus]')].find(x => x.dataset.focus === fk); if (b) b.focus({ preventScroll: true }); }
}
function renderChips(s) {
  const chips = [];
  for (const [kind, p] of Object.entries(s.picks)) {
    for (const id of p.allow) chips.push(el('button', { class: 'chip on', type: 'button', onclick: () => patch({ picks: { [`${kind}:${id}`]: 'clear' } }), 'aria-label': `Remove pick ${id}` }, el('span', { class: 'k' }, KIND_NAME[kind] || kind), id, icon('x')));
    for (const id of p.deny) chips.push(el('button', { class: 'chip deny', type: 'button', onclick: () => patch({ picks: { [`${kind}:${id}`]: 'clear' } }), 'aria-label': `Remove forbid ${id}` }, icon('ban'), el('span', { class: 'k' }, KIND_NAME[kind] || kind), id, icon('x')));
  }
  $('#pickcount').textContent = chips.length;
  $('#chips').replaceChildren(...(chips.length ? chips : [el('span', { class: 'none' }, 'None yet. Click a tile to pick it.')]));
}
function seg(id, value, fn) { const box = $(id); for (const b of box.children) { b.setAttribute('aria-checked', String(b.dataset.v === String(value))); b.onclick = () => fn(b.dataset.v); } }
function renderMusic(s) {
  const bed = $('#bed');
  if (!bed.options.length) {
    bed.append(el('option', { value: 'auto' }, 'Auto, by energy'), el('option', { value: 'none' }, 'No music'), el('option', { value: 'upload' }, 'My upload'));
    for (const b of CAT.beds) bed.append(el('option', { value: b.id }, `${b.title} (${b.energy}, ${Math.round(b.seconds)} s)`));
    bed.onchange = () => patch({ music: { bed: bed.value } });
  }
  bed.value = s.music.bed; bed.querySelector('option[value=upload]').disabled = !s.music.upload;
  const b = CAT.beds.find(x => x.id === s.music.bed), a = $('#bed-audio'), src = b ? file(b.file) : s.music.bed === 'upload' && s.music.upload ? file(s.music.upload) : '';
  if (a.dataset.src !== src) { a.pause(); a.dataset.src = src; if (src) a.src = src; else a.removeAttribute('src'); }
  $('#bed-play').disabled = !src;
  seg('#energy', s.music.energy, v => patch({ music: { energy: v } }));
  seg('#sfx', s.sound.sfx, v => patch({ sound: { sfx: v } }));
  $('#cap').checked = s.sound.cap !== 'off'; $('#cap').onchange = e => patch({ sound: { cap: e.target.checked ? 'on' : 'off' } });
  seg('#tighten', s.pace.tighten == null ? '' : s.pace.tighten, v => patch({ pace: { tighten: v === '' ? null : v === 'off' ? 'off' : +v } }));
  $('#punch').checked = s.pace.punch !== 'off'; $('#punch').onchange = e => patch({ pace: { punch: e.target.checked ? 'on' : 'off' } });
  const ex = $('#export');
  if (!ex.options.length) { ex.append(el('option', { value: '' }, 'Just the reel')); for (const x of CAT.exports) ex.append(el('option', { value: x }, x)); ex.onchange = () => patch({ export: ex.value || null }); }
  ex.value = s.export || '';
}
const fmtS = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
const cap1 = x => x[0].toUpperCase() + x.slice(1);
function renderRender(v) {
  const s = v.state, t = v.task, c = v.compose;
  const src = s.clips ? `--clips ${s.clips}` : s.footage.map(f => /\s/.test(f) ? JSON.stringify(f) : f).join(' ') || '<your clip>';
  $('#cmd').textContent = `npm run reel -- ${src} --name ${s.job || '<job>'} --draft ${(c.args || []).map(a => /[\s;]/.test(a) ? JSON.stringify(a) : a).join(' ')}`;
  const notes = [...(c.notes || []), ...(c.errs || []).map(e => 'Problem: ' + e)];
  if (s.reference.mode === 'recreate' && s.reference.out) notes.unshift(`Recreate: follows ${s.reference.out}/Reel.md; the recipe sets the look.`);
  if (c.effects && c.effects.length && !v.env.effectsReady) notes.push('Effects are picked but not set up on this computer (npm run effects:setup). The reel renders without them.');
  $('#notes').replaceChildren(...notes.map(n => el('p', {}, n)));
  const running = t && t.status === 'running';
  $('#draft').disabled = running || !s.job || (!s.footage.length && !s.clips);
  $('#render').disabled = running || !s.job;
  $('#cancel').hidden = !running; $('#ref-go').disabled = running;
  $('#progress').hidden = !running;
  const drafted = !!choicesCache;
  $('#draft').className = 'btn lg' + (drafted ? ' outline' : ''); $('#render').className = 'btn lg' + (drafted ? '' : ' outline');
  $('#draft').textContent = drafted ? 'Redraft' : 'Draft';
  const pill = $('#taskpill');
  pill.className = 'badge' + (running ? ' run' : t && t.status === 'failed' ? ' fail' : '');
  pill.textContent = !t ? 'Ready' : running ? `${cap1(t.kind)} running` : t.status === 'failed' ? `${cap1(t.kind)} failed` : `${cap1(t.kind)} ${t.status}`;
  const log = $('#log');
  if (t) { if (!running || !log.textContent) log.textContent = t.lines.join('\n'); log.scrollTop = log.scrollHeight; }
  clearInterval(renderRender.tick);
  if (running) renderRender.tick = setInterval(() => { $('#elapsed').textContent = `${cap1(t.kind)}, ${fmtS(Date.now() - t.startedAt)}`; }, 1000);
  else $('#elapsed').textContent = t && t.endedAt ? `${cap1(t.kind)} ${t.status} in ${fmtS(t.endedAt - t.startedAt)}` : '';
  if (t && !running && (t.kind === 'draft' || t.kind === 'render') && renderRender.last !== t.id + t.status) { renderRender.last = t.id + t.status; loadChoices(); }
  if (!choicesCache && s.job && renderRender.loadedFor !== s.job) { renderRender.loadedFor = s.job; loadChoices(); }
  if (!(v.outputs || []).length) { $('#outputs').replaceChildren(el('div', { class: 'empty-art' }, icon('film'), el('p', {}, s.job ? 'Your reels show up here.' : 'Name the reel at the top to start.'))); return; }
  $('#outputs').replaceChildren(...(v.outputs || []).slice(0, 6).map(o => el('figure', {}, el('video', { src: file(o) + '?v=' + s.rev + '#t=1.2', controls: true, preload: 'metadata', 'aria-label': o }),
    el('figcaption', {}, el('span', {}, o.split('/').pop()), el('a', { class: 'btn ghost sm', href: file(o) + '?download', download: o.split('/').pop() }, icon('download'), 'Download')))));
}
async function loadChoices() { const j = await api('/api/choices').catch(() => ({})); choicesCache = j.choices || null; choicesDirty = false; renderChoices(); if (choicesCache) $('#choices-fold').open = true; }
function renderChoices() {
  const box = $('#choices'), x = choicesCache;
  if (!x) { box.replaceChildren(el('p', { class: 'empty' }, 'Draft first. Every pick then shows here with its reason.')); return; }
  const trans = Object.values(CAT.items).filter(i => i.kind === 'transition').map(i => i.id), ents = Object.values(CAT.items).filter(i => i.kind === 'entrance').map(i => i.id);
  const sel = (opts, val, blank, on, label) => { const s = el('select', { 'aria-label': label, onchange: e => { on(e.target.value || null); choicesDirty = true; $('#apply-choices').disabled = false; } }, el('option', { value: '' }, blank), ...opts.map(o => el('option', { value: o }, o))); s.value = val || ''; return s; };
  const beats = el('table', {}, el('thead', {}, el('tr', {}, ...['Beat', 'Time', 'Transition in', 'Why', 'Finish', 'Why'].map(h => el('th', {}, h)))),
    el('tbody', {}, ...x.beats.map(b => el('tr', {}, el('td', {}, b.n), el('td', {}, `${b.start.toFixed(1)}-${b.end.toFixed(1)} s`),
      el('td', {}, b.n === 1 || b.jump ? (b.n === 1 ? 'first shot' : 'cut') : sel(trans, b.transition, 'glitch (default)', v => { b.transition = v; }, `Transition into beat ${b.n}`)),
      el('td', { class: 'why' }, b.transitionWhy), el('td', {}, el('input', { value: b.finish || '', size: 10, 'aria-label': `Finish for beat ${b.n}`, oninput: e => { b.finish = e.target.value || null; choicesDirty = true; $('#apply-choices').disabled = false; } })), el('td', { class: 'why' }, b.finishWhy)))));
  const titles = x.titles.length ? el('table', {}, el('thead', {}, el('tr', {}, ...['Title', 'At', 'Words', 'Entrance', 'Why', 'Place'].map(h => el('th', {}, h)))),
    el('tbody', {}, ...x.titles.map(t => el('tr', {}, el('td', {}, t.n), el('td', {}, `${t.start.toFixed(1)} s`), el('td', {}, t.text), el('td', {}, sel(ents, t.entrance, '(engine picks)', v => { t.entrance = v; }, `Entrance for title ${t.n}`)), el('td', { class: 'why' }, t.entranceWhy), el('td', { class: 'why' }, `${t.place}, ${t.layer}`))))) : el('p', { class: 'muted' }, 'No kinetic titles in this draft.');
  const gfx = x.graphics.length ? el('table', {}, el('thead', {}, el('tr', {}, ...['Graphic', 'At', 'Type', 'Words', 'Keep', 'Why'].map(h => el('th', {}, h)))),
    el('tbody', {}, ...x.graphics.map(g => el('tr', {}, el('td', {}, g.n), el('td', {}, `${g.start.toFixed(1)} s`), el('td', {}, g.id), el('td', {}, g.text), el('td', {}, el('input', { type: 'checkbox', checked: g.keep !== false, 'aria-label': `Keep graphic ${g.n}`, onchange: e => { g.keep = e.target.checked; choicesDirty = true; $('#apply-choices').disabled = false; } })), el('td', { class: 'why' }, g.why))))) : null;
  box.replaceChildren(...[el('p', { class: 'fine' }, `Locks: ${x.locksText || 'none'}. Captions: ${x.captions.style}, entrance ${x.captions.entrance || 'pop'}. Music: ${x.music.bed || 'none'}. Punch: ${x.punch}.`),
    wrap(beats, 'Beats'), el('h3', {}, 'Titles'), wrap(titles, 'Titles'), gfx ? el('h3', {}, 'Graphics') : null, gfx ? wrap(gfx, 'Graphics') : null,
    el('div', { class: 'row' }, el('button', { class: 'btn outline sm', id: 'apply-choices', disabled: !choicesDirty, onclick: applyChoices }, 'Apply my edits'), el('span', { class: 'fine' }, 'Edits win over locks. Render to see them.'))].filter(Boolean));
}
const wrap = (t, label) => t.tagName === 'TABLE' ? el('div', { class: 'tablewrap', tabindex: '0', role: 'region', 'aria-label': label + ' table' }, t) : t;
async function applyChoices() {
  const j = await api('/api/choices', { beats: choicesCache.beats, titles: choicesCache.titles, graphics: choicesCache.graphics });
  choicesCache = j.choices; choicesDirty = false; renderChoices(); toast('Edits applied. Render to see them.', true);
}
const MSG_STATUS = { queued: 'Queued', seen: 'Seen', answered: 'Answered' };
const SETUP_LINE = 'Set up Studio from AGENTS.md and run the Studio chat loop';
function renderChat(s) {
  const e = V.env, a = e.agent || {}, backend = e.backend, name = a.name || 'Your agent';
  const bar = $('#agentbar'), state = backend !== 'agent' ? 'alt' : a.listening ? 'on' : a.connected ? 'busy' : 'off';
  bar.className = 'agentbar ' + state;
  bar.title = state === 'busy' ? 'Busy in the terminal. Messages wait for its next step.' : '';
  bar.replaceChildren(el('span', { class: 'dot', 'aria-hidden': 'true' }), backend === 'agent' ? (a.listening ? `${name}, listening` : a.connected ? `${name}, busy` : 'No agent') : e.llm ? e.llm : backend === 'keywords' ? 'Keywords' : 'Keywords (no model ready)');
  $('#fab-dot').className = 'dot ' + state;
  $('#chatmode').textContent = backend === 'agent' ? 'Separate from your terminal conversation.' : '';
  const ol = $('#msgs'); const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
  const copyBtn = ibtn('copy', 'Copy', () => navigator.clipboard && navigator.clipboard.writeText(SETUP_LINE).then(() => toast('Copied', true)));
  const empty = backend === 'agent' && !a.connected
    ? el('li', { class: 'empty' }, icon('chat'), el('p', {}, 'Tell your terminal agent:'), el('div', { class: 'copyline' }, el('code', {}, SETUP_LINE), copyBtn))
    : el('li', { class: 'empty' }, icon('chat'), el('p', {}, backend === 'agent' ? `${name} is here. Say what you want.` : 'Describe the vibe.'), el('p', { class: 'fine' }, '"Calm and cinematic, no glitch"'));
  const meta = m => el('span', { class: 'meta ' + (m.status || '') }, m.status === 'answered' ? icon('check') : null, MSG_STATUS[m.status] || m.status);
  ol.replaceChildren(...(s.chat.length ? s.chat.map(m => m.kind === 'action' ? el('li', { class: 'action' }, m.text)
    : m.role === 'user' ? el('li', { class: 'user' }, m.text, m.to === 'agent' ? meta(m) : null)
    : el('li', { class: 'assistant' }, el('span', { class: 'who' }, m.from === 'keywords' ? 'Studio' : (m.from && m.from !== 'agent' ? m.from : name)), m.text)) : [empty]));
  const waiting = s.chat.filter(m => m.role === 'user' && m.to === 'agent' && m.status !== 'answered');
  if (waiting.length && backend === 'agent') ol.append(el('li', { class: 'typing', 'aria-label': 'waiting for your agent' }, el('i'), el('i'), el('i'), waiting.some(m => m.status === 'seen') ? `${name} is on it` : a.connected ? `${name} reads it at its next step` : 'Waiting for your agent to connect'));
  if (atBottom) ol.scrollTop = ol.scrollHeight;
  $('#chatin').placeholder = backend === 'agent' ? (a.connected ? `Message ${name}` : 'Message your agent') : 'Calm and cinematic, no glitch';
}
// ---------- settings ----------
function openSettings() {
  const e = V.env, st = e.settings, d = $('#settings');
  for (const r of document.querySelectorAll('input[name=backend]')) r.checked = r.value === (st.chat.backend === 'auto' ? (e.keys.anthropic ? 'anthropic' : e.keys.openai ? 'openai' : 'keywords') : st.chat.backend);
  $('#key-anthropic').textContent = e.keys.anthropic ? 'ANTHROPIC_API_KEY is set.' : 'Set ANTHROPIC_API_KEY before starting Studio.';
  $('#key-openai').textContent = e.keys.openai ? 'OPENAI_API_KEY is set.' : 'Set OPENAI_API_KEY before starting Studio.';
  $('#local-url').value = st.chat.baseUrl || ''; $('#local-url').placeholder = e.localPresets[0].url;
  const pre = $('#local-preset'); pre.replaceChildren(el('option', { value: '' }, 'Common servers'), ...e.localPresets.map(x => el('option', { value: x.url }, `${x.label} (${x.url.replace('http://', '')})`)));
  pre.onchange = () => { if (pre.value) $('#local-url').value = pre.value; };
  const ms = $('#local-model'); if (st.chat.model && ![...ms.options].some(o => o.value === st.chat.model)) ms.append(el('option', { value: st.chat.model }, st.chat.model)); ms.value = st.chat.model || '';
  $('#action-notes').checked = st.actionNotes !== false;
  $('#set-downloads').value = st.downloads || ''; $('#set-downloads').placeholder = e.settings.defaultDownloads;
  $('#set-renders').value = st.renders || ''; $('#set-renders').placeholder = 'none: reels stay in ' + e.settings.defaultRenders;
  $('#settings-msg').textContent = Object.entries(st.from || {}).filter(([, v]) => v.startsWith('env')).map(([k, v]) => `${k} comes from ${v}`).join('; ');
  syncLocal(); d.showModal();
}
const syncLocal = () => { $('#local-box').hidden = !document.querySelector('input[name=backend][value=local]').checked; };
async function findModels() {
  const base = $('#local-url').value.trim() || $('#local-url').placeholder, msg = $('#local-msg');
  msg.textContent = 'Asking ' + base + '...';
  try { const r = await fetch('/api/llm/models?base=' + encodeURIComponent(base)); const j = await r.json(); if (!r.ok) throw new Error(j.error);
    const ms = $('#local-model'), cur = ms.value; ms.replaceChildren(el('option', { value: '' }, 'First model the server lists'), ...j.models.map(m => el('option', { value: m }, m))); ms.value = j.models.includes(cur) ? cur : j.models[0] || '';
    msg.textContent = j.models.length ? `${j.models.length} model${j.models.length > 1 ? 's' : ''} found.` : 'The server answered but lists no models. Pull one first (for example: ollama pull llama3.2).';
  } catch (e) { msg.textContent = e.message; }
}
async function saveSettings() {
  const backend = (document.querySelector('input[name=backend]:checked') || {}).value || 'agent';
  const body = { downloads: $('#set-downloads').value.trim() || null, renders: $('#set-renders').value.trim() || null, actionNotes: $('#action-notes').checked,
    chat: { backend, ...(backend === 'local' ? { baseUrl: $('#local-url').value.trim() || null, model: $('#local-model').value || null } : {}) } };
  const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json();
  if (!r.ok) { $('#settings-msg').textContent = j.error; return; }
  apply(j); $('#settings').close(); toast('Settings saved', true);
}

// ---------- uploads ----------
async function upload(kind, files) {
  const s = V.state;
  if (!s.job) { toast('Name the job first (top left)'); $('#job').focus(); return; }
  for (const f of files) {
    $('#taskpill').textContent = `uploading ${f.name}`;
    const r = await fetch(`/api/upload?kind=${kind}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'upload failed'); break; }
    apply(j);
  }
}
function dropzone(zoneSel, inputSel, kind) {
  const z = $(zoneSel), i = $(inputSel);
  z.addEventListener('click', () => i.click());
  z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); i.click(); } });
  i.addEventListener('change', () => { upload(kind, [...i.files]); i.value = ''; });
  z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); upload(kind, [...e.dataTransfer.files]); });
}

// ---------- theme ----------
function setTheme(t) {
  document.documentElement.dataset.theme = t; localStorage.setItem('studio.theme', t);
  const b = $('#theme'); b.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); b.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon'));
  for (const x of $('#theme-seg').children) x.setAttribute('aria-checked', String(x.dataset.v === t));
}
const grow = t => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 160) + 'px'; };

// ---------- wiring ----------
async function main() {
  setTheme(document.documentElement.dataset.theme || 'dark');
  go(STEP);
  CAT = await api('/api/catalog');
  apply(await api('/api/state'));
  $('#job').addEventListener('change', e => patch({ job: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || null }));
  dropzone('#drop-footage', '#file-footage', 'footage'); dropzone('#drop-ref', '#file-ref', 'reference'); dropzone('#drop-music', '#file-music', 'music');
  for (const b of document.querySelectorAll('#stepper button')) b.addEventListener('click', () => go(b.dataset.step, true));
  $('#prev').addEventListener('click', () => go(STEPS[Math.max(0, STEPS.indexOf(STEP) - 1)], true));
  $('#next').addEventListener('click', () => go(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(STEP) + 1)], true));
  $('#ref-go').addEventListener('click', () => api('/api/reference', {}).then(apply).catch(() => {}));
  const addLinks = () => { const urls = $('#ref-urls').value.split(/\s+/).filter(Boolean); if (!urls.length) { toast('Paste a link first'); $('#ref-urls').focus(); return; } if (!V.state.job) { toast('Name the reel first (top left)'); $('#job').focus(); return; }
    api('/api/reference/url', { urls }).then(j => { apply(j); $('#ref-urls').value = ''; grow($('#ref-urls')); const bad = j.added.filter(x => x.status === 'failed'); if (bad.length) toast(bad[0].error); }).catch(() => {}); };
  $('#ref-add').addEventListener('click', addLinks);
  $('#ref-urls').addEventListener('input', e => grow(e.target));
  $('#ref-urls').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addLinks(); } });
  $('#ref-urls').addEventListener('paste', () => setTimeout(() => { grow($('#ref-urls')); if (/^https?:\/\/\S+$/.test($('#ref-urls').value.trim()) && V.state.job) addLinks(); }, 0));
  $('#open-settings').addEventListener('click', openSettings);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#find-models').addEventListener('click', findModels);
  $('#theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  for (const x of $('#theme-seg').children) x.addEventListener('click', () => setTheme(x.dataset.v));
  for (const r of document.querySelectorAll('input[name=backend]')) r.addEventListener('change', syncLocal);
  $('#filter').addEventListener('input', renderGrid);
  document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); go('style'); $('#filter').focus(); } });
  const pb = $('#pause'); const syncPause = () => { pb.setAttribute('aria-pressed', String(paused())); const l = paused() ? 'Play previews' : 'Pause previews'; pb.setAttribute('aria-label', l); pb.title = l; pb.replaceChildren(icon(paused() ? 'play' : 'pause')); };
  syncPause(); pb.addEventListener('click', () => { localStorage.setItem('studio.paused', paused() ? '0' : '1'); syncPause(); renderGrid(); });
  const audio = $('#bed-audio'), bp = $('#bed-play'), syncPlay = () => { bp.replaceChildren(icon(audio.paused ? 'play' : 'pause')); bp.setAttribute('aria-label', audio.paused ? 'Play the music bed' : 'Pause the music bed'); };
  bp.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }); audio.addEventListener('play', syncPlay); audio.addEventListener('pause', syncPlay);
  $('#clear-picks').addEventListener('click', () => patch({ clearPicks: true }));
  $('#save-pack').addEventListener('submit', e => { e.preventDefault(); api('/api/pack/save', { name: $('#pack-name').value.trim() }).then(async j => { CAT = await api('/api/catalog'); apply(j); $('#pack-msg').textContent = `Saved ${j.path}`; }).catch(() => {}); });
  $('#draft').addEventListener('click', () => { choicesCache = null; $('#log').textContent = ''; api('/api/draft', {}).then(apply).catch(() => {}); });
  $('#render').addEventListener('click', () => { $('#log').textContent = ''; api('/api/render', {}).then(j => { apply(j); if (j.effectsSkipped) toast(j.effectsSkipped); }).catch(() => {}); });
  $('#cancel').addEventListener('click', () => api('/api/task/cancel', {}).then(apply));
  $('#chatform').addEventListener('submit', async e => {
    e.preventDefault(); const t = $('#chatin').value.trim(); if (!t) return;
    $('#chatin').value = ''; grow($('#chatin')); $('#chatin').disabled = true;
    try { apply(await api('/api/chat', { text: t })); } catch {} finally { $('#chatin').disabled = false; $('#chatin').focus(); }
  });
  $('#chatin').addEventListener('input', e => grow(e.target));
  $('#chatin').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatform').requestSubmit(); } });
  const chat = $('#chat'), fab = $('#chat-open');
  const openChat = on => { chat.classList.toggle('open', on); fab.setAttribute('aria-expanded', String(on)); if (on) { const ol = $('#msgs'); ol.scrollTop = ol.scrollHeight; $('#chatin').focus({ preventScroll: true }); } else fab.focus({ preventScroll: true }); };
  fab.addEventListener('click', () => openChat(true)); $('#chat-close').addEventListener('click', () => openChat(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chat.classList.contains('open')) openChat(false); });
  if (/chat/.test(location.hash)) openChat(true);
  addEventListener('hashchange', () => { const m = location.hash.match(/menu=([a-z-]+)/), st = location.hash.match(/step=([a-z]+)/); if (m) { go('style'); setTab(m[1]); } else if (st && STEPS.includes(st[1])) go(st[1], true); });
  const es = new EventSource('/api/events');
  es.addEventListener('state', e => apply(JSON.parse(e.data)));
  es.addEventListener('log', e => { const d = JSON.parse(e.data), log = $('#log'); log.textContent += (log.textContent ? '\n' : '') + d.line; log.scrollTop = log.scrollHeight; });
  es.addEventListener('task', () => api('/api/state').then(apply));
}
main().catch(e => toast('Studio could not load: ' + e.message));
