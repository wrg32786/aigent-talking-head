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

// ---------- render from state ----------
function apply(v) {
  if (!v || !v.state) return;
  V = v; const s = v.state;
  if (document.activeElement !== $('#job')) $('#job').value = s.job || '';
  renderFootage(s); renderRef(s); renderPacks(s); renderTabs(); renderGrid(); renderChips(s); renderMusic(s); renderRender(v); renderChat(s);
}
function renderFootage(s) {
  const ul = $('#footage'); ul.replaceChildren();
  if (s.clips) ul.append(el('li', {}, `Using an existing clips folder: ${s.clips}`));
  for (const f of s.footage) ul.append(el('li', {}, el('video', { src: file(f), muted: true, preload: 'metadata', 'aria-label': f }), el('span', {}, f.split('/').pop()),
    el('button', { class: 'btn ghost small', onclick: () => api('/api/footage/remove', { path: f }).then(apply), 'aria-label': 'Remove ' + f }, 'Remove')));
}
const SITE = { youtube: 'YouTube', 'youtube-shorts': 'YouTube Shorts', tiktok: 'TikTok', x: 'X', vimeo: 'Vimeo', instagram: 'Instagram', file: 'Video file', other: 'Link' };
const STATUS = { queued: 'Waiting', downloading: 'Downloading', tearing: 'Breaking it down', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
function renderRef(s) {
  const r = s.reference, env = V.env, q = r.queue || [];
  for (const b of $('#ref-mode').children) b.setAttribute('aria-checked', String(b.dataset.v === r.mode));
  const t = env.tools || {};
  $('#ref-tools').textContent = t.ytdlp ? `YouTube, Shorts, TikTok, X and Vimeo through yt-dlp ${t.ytdlp}; direct video links; one public Instagram post${t.instaloader ? '' : ' (needs pip install instaloader)'}, anonymous, no login. Only use videos you have the rights to use as a reference.`
    : `Direct video links work now. For YouTube, TikTok, X and Vimeo install yt-dlp (free): pip install yt-dlp. Only use videos you have the rights to use as a reference.`;
  $('#ref-go').hidden = r.status !== 'uploaded';
  $('#ref-status').textContent = r.status === 'none' ? (q.length ? '' : 'No reference yet.') : r.status === 'uploaded' ? `Ready to break down: ${(r.file || '').split('/').pop()}` : r.status === 'running' ? 'Breaking it down...' : r.status === 'ready' ? `Using ${r.active ? 'reference ' + r.active : (r.file || '').split('/').pop()}${r.applied ? ', picks applied' : ''}.` : r.status;
  $('#ref-queue').replaceChildren(...q.slice().reverse().map(it => {
    const busy = it.status === 'downloading' || it.status === 'tearing', isActive = r.active === it.id;
    const bar = busy ? el('div', { class: 'bar' + (it.status === 'tearing' || !it.progress ? ' indet' : ''), role: 'progressbar', 'aria-label': STATUS[it.status], 'aria-valuemin': 0, 'aria-valuemax': 100, ...(it.status === 'downloading' && it.progress ? { 'aria-valuenow': it.progress } : {}) }, el('span', { style: it.status === 'downloading' && it.progress ? `width:${it.progress}%` : '' })) : null;
    return el('li', { class: `qi ${it.status}${isActive ? ' active' : ''}` },
      el('div', { class: 'qh' }, el('span', { class: 'site' }, SITE[it.site] || 'Link'), el('span', { class: 'qt', title: it.url }, it.title || it.url),
        el('span', { class: 'st' }, (STATUS[it.status] || it.status) + (it.status === 'downloading' && it.progress ? ` ${it.progress}%` : '') + (isActive ? ', in use' : ''))),
      bar, it.error ? el('p', { class: 'err' }, it.error) : null, it.trimmed ? el('p', { class: 'fine' }, `Kept the first part of a longer video for the teardown.`) : null,
      el('div', { class: 'row qa' }, it.status === 'ready' && !isActive ? el('button', { class: 'btn ghost small', type: 'button', onclick: () => api('/api/reference/item', { id: it.id, action: 'use' }).then(apply) }, 'Use this one') : null,
        ['failed', 'cancelled'].includes(it.status) ? el('button', { class: 'btn ghost small', type: 'button', onclick: () => api('/api/reference/item', { id: it.id, action: 'retry' }).then(apply) }, 'Try again') : null,
        el('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Remove ' + it.url, onclick: () => api('/api/reference/item', { id: it.id, action: 'remove' }).then(apply) }, busy ? 'Stop' : 'Remove')));
  }));
  const out = $('#ref-out'); const ex = r.extracted;
  out.hidden = !ex; if (!ex) return;
  const sm = ex.summary || {}, mu = sm.music || {};
  const tr = Object.entries(ex.transitions).map(([k, n]) => `${k} x${n}`).join(', ') || 'none found';
  const rows = [['Length', sm.seconds ? `${sm.seconds} s, ${ex.shots} shots` : `${ex.shots} shots`], ['Pace', sm.averageShot ? `${sm.pacing}: a cut every ${sm.averageShot} s` : 'not measured'],
    ['Cuts at', sm.cuts && sm.cuts.length ? sm.cuts.slice(0, 14).map(c => c + ' s').join(', ') + (sm.cuts.length > 14 ? ` and ${sm.cuts.length - 14} more` : '') : 'none'],
    ['Music', [mu.bpm && mu.bpm + ' BPM', mu.beats && mu.beats + ' beats', mu.energy && mu.energy + ' energy', mu.beatSync === 'on' && 'cuts on the beat', mu.bed && 'closest bed ' + mu.bed].filter(Boolean).join(', ') || 'none'],
    ['Captions', [sm.captions && sm.captions.style, sm.captions && sm.captions.position].filter(Boolean).join(', ') || 'kit default'], ['Titles', ex.titles + (sm.titles && sm.titles.length ? ': ' + sm.titles.slice(0, 5).map(t => t.text).join(', ') : '')],
    ['Transitions', tr], ['Title entrances', ex.entrances.join(', ') || 'none'], ['Finishes', ex.finishes.join(', ') || 'none'], ['Graphics', ex.graphics.join(', ') || 'none'], ['Effects', ex.effects.join(', ') || 'none']];
  const dl = el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))]));
  const sugg = (sm.suggestions || []).filter(x => CAT.items[x.ref]);
  const chips = sugg.length ? el('div', { class: 'sugg' }, el('span', { class: 'lbl' }, 'Suggested from the menu'), el('div', { class: 'chips' }, ...sugg.map(x => {
    const it = CAT.items[x.ref], st = pickState(s, it);
    return el('button', { class: 'chip' + (st === 'allow' ? ' on' : ''), type: 'button', title: x.why, 'aria-pressed': String(st === 'allow'), onclick: () => patch({ picks: { [x.ref]: st === 'allow' ? 'clear' : 'allow' } }) }, `${KIND_NAME[it.kind] || it.kind}: ${it.id}`);
  }))) : null;
  const how = r.mode === 'recreate' ? 'Recreate: the draft follows this recipe (shots, titles, cards) with your clip.' : r.mode === 'influence' ? 'Influence: these become soft defaults in a reference pack (ref-' + s.job + '); your picks still win.' : 'Off: the reference is ignored.';
  out.replaceChildren(...[el('div', {}, dl, chips, el('p', { class: 'fine' }, how + ' The chat knows this teardown: try "use the transitions from the reference but calmer".'),
    el('div', { class: 'row' }, el('button', { class: 'btn ghost small', onclick: () => api('/api/reference/apply', {}).then(v => { apply(v); toast('Reference picks added to your picks', true); }) }, 'Use all as my picks'),
      r.out ? el('span', { class: 'fine' }, `Recipe: ${r.out}/Reel.md`) : null)), r.contact ? el('img', { src: file(r.contact), alt: 'Contact sheet of the reference, one frame per shot' }) : el('div', { class: 'muted' }, 'No contact sheet.')].filter(Boolean));
}
function renderPacks(s) {
  const box = $('#packs');
  const mk = (name, label, prev, desc) => el('button', { class: 'pack', role: 'radio', 'aria-checked': String((s.pack || null) === name), title: desc || label, onclick: () => patch({ pack: name }) },
    prev ? el('img', { src: file(prev), alt: '', loading: 'lazy', width: 180, height: 320 }) : el('div', { class: 'ph' }, name ? 'no preview' : 'kit default'), el('span', {}, el('b', {}, name || 'No pack'), label));
  box.replaceChildren(mk(null, 'kit defaults, your picks only', null), ...CAT.packs.filter(p => !/^ref-/.test(p.name)).map(p => mk(p.name, (p.label || '').split(':')[0], p.preview, p.description)));
  const n = $('#look-note'), infl = s.reference.mode === 'influence' && s.reference.extracted;
  n.hidden = !infl; n.textContent = infl ? `Influence is on: ${s.pack ? 'the ' + s.pack + ' pack' : 'the kit defaults'} plus the reference's look are drafted as the pack ref-${s.job} (packs/local/, not shared).` : '';
}
const pickState = (s, it) => { const k = it.kind === 'editing' ? 'editing' : it.kind; const p = s.picks[k]; if (!p) return null; return p.allow.includes(it.id) ? 'allow' : p.deny.includes(it.id) ? 'deny' : null; };
function renderTabs() {
  const box = $('#tabs'), s = V.state, hadFocus = box.contains(document.activeElement);
  const cats = CAT.categories.filter(c => c.count > 0);
  if (!TAB || !cats.some(c => c.id === TAB)) TAB = cats[0].id;
  box.replaceChildren(...cats.map(c => {
    const any = c.items.some(r => pickState(s, CAT.items[r]));
    return el('button', { class: 'tab', role: 'tab', id: 'tab-' + c.id, 'aria-selected': String(c.id === TAB), 'aria-controls': 'grid', tabindex: c.id === TAB ? '0' : '-1', onclick: () => { TAB = c.id; history.replaceState(null, '', '#menu=' + TAB); renderTabs(); renderGrid(); } },
      c.label, el('span', { class: 'c' }, c.count), any ? el('span', { class: 'dot', title: 'has picks', 'aria-label': 'has picks' }) : null);
  }));
  if (hadFocus) $('#tab-' + TAB).focus({ preventScroll: true });
  const ts = $('#tabselect');
  ts.replaceChildren(...cats.map(c => el('option', { value: c.id }, `${c.label} (${c.count})`))); ts.value = TAB;
  ts.onchange = () => { TAB = ts.value; history.replaceState(null, '', '#menu=' + TAB); renderTabs(); renderGrid(); };
  box.onkeydown = e => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const i = cats.findIndex(c => c.id === TAB); TAB = cats[(i + (e.key === 'ArrowRight' ? 1 : cats.length - 1)) % cats.length].id; history.replaceState(null, '', '#menu=' + TAB); renderTabs(); renderGrid(); $('#tab-' + TAB).focus(); };
}
const KIND_NAME = { transition: 'transition', entrance: 'title entrance', captionEntrance: 'caption entrance', captionStyle: 'caption style', graphic: 'graphic', effect: 'effect', finish: 'finish', font: 'font pairing', look: 'look', theme: 'theme', titleLayer: 'title layer', bed: 'music bed', sfx: 'sound', beatSync: 'beat sync', editing: 'editing' };
function renderGrid() {
  const c = CAT.categories.find(x => x.id === TAB), s = V.state, q = $('#filter').value.trim().toLowerCase();
  $('#grid').setAttribute('aria-labelledby', 'tab-' + TAB);
  $('#tabhint').textContent = c.hint;
  const tiles = c.items.map(r => CAT.items[r]).filter(it => !q || it.id.includes(q) || (it.label || '').toLowerCase().includes(q)).map(it => {
    const st = pickState(s, it), info = it.mode === 'info';
    const still = paused() && it.preview && it.preview.animated ? it.preview.still : null, showAnim = it.preview && (!paused() || !it.preview.animated);
    const media = el('div', { class: 'media' }, showAnim ? el('img', { src: file(it.preview.src), alt: '', loading: 'lazy', decoding: 'async', width: 120, height: 160 }) : still ? el('img', { src: file(still), alt: '', loading: 'lazy', width: 120, height: 160 }) : el('div', { class: 'np' }, it.preview ? 'Preview paused' : 'No preview yet'),
      it.preview && (!it.preview.animated || still) ? el('span', { class: 'badge' }, 'Still') : null, it.needsCopy ? el('span', { class: 'badge b2' }, 'Needs your words') : null);
    const kind = KIND_NAME[it.kind] || it.kind, canDeny = !info && it.mode !== 'one';
    const setPick = how => patch({ picks: { [it.ref]: how } });
    const pick = el('button', { class: 'pick', type: 'button', 'data-focus': 'p:' + it.ref, 'aria-pressed': info ? null : String(st === 'allow'), 'aria-describedby': 'd-' + it.ref.replace(/[^a-z0-9]/gi, '-'),
      'aria-label': info ? `${it.id}, ${kind}, shown for reference` : `Pick ${it.id}, ${kind}`,
      onclick: () => { if (info) return toast(`${it.id}: set it with ${it.flag}`, true); setPick(st === 'allow' ? 'clear' : 'allow'); },
      oncontextmenu: e => { if (!canDeny) return; e.preventDefault(); setPick(st === 'deny' ? 'clear' : 'deny'); },
      onkeydown: e => { if ((e.key === 'f' || e.key === 'F') && canDeny) { e.preventDefault(); setPick(st === 'deny' ? 'clear' : 'deny'); } } },
      media, el('span', { class: 'state', 'aria-hidden': 'true' }, st === 'allow' ? '\u2713' : st === 'deny' ? '\u00d7' : ''),
      el('span', { class: 'meta' }, el('span', { class: 'kd' }, kind), el('span', { class: 'nm' }, it.id), el('span', { class: 'ds', id: 'd-' + it.ref.replace(/[^a-z0-9]/gi, '-') }, it.label || '')));
    const t = el('div', { class: `tile ${st || ''} ${info ? 'info' : ''}`, title: (it.label || '') + (it.flag ? '\n' + it.flag : '') }, pick,
      canDeny ? el('button', { class: 'forbid', type: 'button', 'data-focus': 'f:' + it.ref, 'aria-pressed': String(st === 'deny'), 'aria-label': `Forbid ${it.id}`, onclick: () => setPick(st === 'deny' ? 'clear' : 'deny') }, st === 'deny' ? 'Forbidden' : 'Forbid')
        : el('span', { class: 'forbid-none' }, info ? 'Reference' : 'Pick one'));
    return t;
  });
  const g = $('#grid'), fk = g.contains(document.activeElement) && document.activeElement.dataset.focus;
  g.replaceChildren(...(tiles.length ? tiles : [el('p', { class: 'muted' }, 'Nothing matches that filter.')]));
  if (fk) { const b = [...g.querySelectorAll('[data-focus]')].find(x => x.dataset.focus === fk); if (b) b.focus({ preventScroll: true }); }
}
function renderChips(s) {
  const chips = [];
  for (const [kind, p] of Object.entries(s.picks)) {
    for (const id of p.allow) chips.push(el('button', { class: 'chip', onclick: () => patch({ picks: { [`${kind}:${id}`]: 'clear' } }), 'aria-label': `Remove pick ${id}` }, `${KIND_NAME[kind] || kind}: ${id}`));
    for (const id of p.deny) chips.push(el('button', { class: 'chip deny', onclick: () => patch({ picks: { [`${kind}:${id}`]: 'clear' } }), 'aria-label': `Remove forbid ${id}` }, `${KIND_NAME[kind] || kind}: ${id}`));
  }
  $('#chips').replaceChildren(...(chips.length ? chips : [el('span', { class: 'chip none' }, 'Nothing picked: the kit and your pack choose.')]));
}
function seg(id, value, fn) { const box = $(id); for (const b of box.children) { b.setAttribute('aria-checked', String(b.dataset.v === String(value))); b.onclick = () => fn(b.dataset.v); } }
function renderMusic(s) {
  const bed = $('#bed');
  if (!bed.options.length) {
    bed.append(el('option', { value: 'auto' }, 'Auto: pick by energy'), el('option', { value: 'none' }, 'No music'), el('option', { value: 'upload' }, 'My upload'));
    for (const b of CAT.beds) bed.append(el('option', { value: b.id }, `${b.title} (${b.energy}, ${Math.round(b.seconds)} s)`));
    bed.onchange = () => patch({ music: { bed: bed.value } });
  }
  bed.value = s.music.bed; bed.querySelector('option[value=upload]').disabled = !s.music.upload;
  const b = CAT.beds.find(x => x.id === s.music.bed), a = $('#bed-audio'), src = b ? file(b.file) : s.music.bed === 'upload' && s.music.upload ? file(s.music.upload) : '';
  if (a.dataset.src !== src) { a.dataset.src = src; if (src) a.src = src; else a.removeAttribute('src'); a.hidden = !src; }
  seg('#energy', s.music.energy, v => patch({ music: { energy: v } }));
  seg('#sfx', s.sound.sfx, v => patch({ sound: { sfx: v } }));
  $('#cap').checked = s.sound.cap !== 'off'; $('#cap').onchange = e => patch({ sound: { cap: e.target.checked ? 'on' : 'off' } });
  seg('#tighten', s.pace.tighten == null ? '' : s.pace.tighten, v => patch({ pace: { tighten: v === '' ? null : v === 'off' ? 'off' : +v } }));
  $('#punch').checked = s.pace.punch !== 'off'; $('#punch').onchange = e => patch({ pace: { punch: e.target.checked ? 'on' : 'off' } });
  const ex = $('#export');
  if (!ex.options.length) { ex.append(el('option', { value: '' }, 'No export, just the reel')); for (const x of CAT.exports) ex.append(el('option', { value: x }, x)); ex.onchange = () => patch({ export: ex.value || null }); }
  ex.value = s.export || '';
}
const fmtS = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
function renderRender(v) {
  const s = v.state, t = v.task, c = v.compose;
  const src = s.clips ? `--clips ${s.clips}` : s.footage.map(f => /\s/.test(f) ? JSON.stringify(f) : f).join(' ') || '<your clip>';
  $('#cmd').textContent = `npm run reel -- ${src} --name ${s.job || '<job>'} --draft ${(c.args || []).map(a => /[\s;]/.test(a) ? JSON.stringify(a) : a).join(' ')}`;
  const notes = [...(c.notes || []), ...(c.errs || []).map(e => 'Problem: ' + e)];
  if (s.reference.mode === 'recreate' && s.reference.out) notes.unshift(`Recreate: adds --recipe ${s.reference.out}/Reel.md (the pack is left out; the recipe sets the look).`);
  if (c.effects && c.effects.length && !v.env.effectsReady) notes.push('Effects are picked, but the effects pass is not set up on this computer (npm run effects:setup). The reel renders without them.');
  $('#notes').replaceChildren(...notes.map(n => el('p', {}, n)));
  const running = t && t.status === 'running';
  $('#draft').disabled = running || !s.job || (!s.footage.length && !s.clips);
  $('#render').disabled = running || !s.job;
  $('#cancel').hidden = !running; $('#ref-go').disabled = running;
  const drafted = !!choicesCache;
  $('#draft').className = 'btn' + (drafted ? ' ghost' : ''); $('#render').className = 'btn' + (drafted ? '' : ' ghost');
  $('#draft').textContent = drafted ? 'Redraft' : 'Draft';
  const pill = $('#taskpill');
  pill.className = 'pill' + (running ? ' run' : t && t.status === 'failed' ? ' fail' : '');
  pill.textContent = !t ? 'Ready' : running ? `${t.kind[0].toUpperCase() + t.kind.slice(1)} running` : t.status === 'failed' ? `${t.kind[0].toUpperCase() + t.kind.slice(1)} failed: see the log` : `${t.kind[0].toUpperCase() + t.kind.slice(1)} ${t.status}`;
  const log = $('#log');
  if (t) { log.hidden = false; if (!running || !log.textContent) log.textContent = t.lines.join('\n'); log.scrollTop = log.scrollHeight; }
  clearInterval(renderRender.tick);
  if (running) renderRender.tick = setInterval(() => { $('#elapsed').textContent = `${t.kind} running for ${fmtS(Date.now() - t.startedAt)}`; }, 1000);
  else $('#elapsed').textContent = t && t.endedAt ? `${t.kind} ${t.status} in ${fmtS(t.endedAt - t.startedAt)}` : '';
  if (t && !running && (t.kind === 'draft' || t.kind === 'render') && renderRender.last !== t.id + t.status) { renderRender.last = t.id + t.status; loadChoices(); }
  if (!choicesCache && s.job && renderRender.loadedFor !== s.job) { renderRender.loadedFor = s.job; loadChoices(); }
  if (!(v.outputs || []).length) { $('#outputs').replaceChildren(el('p', { class: 'empty' }, s.job ? 'No reels yet. Draft, check the picks below, then render; the reel shows up here to watch and download.' : 'Name the job at the top to start.')); return; }
  $('#outputs').replaceChildren(...(v.outputs || []).slice(0, 6).map(o => el('figure', {}, el('video', { src: file(o) + '?v=' + s.rev + '#t=1.2', controls: true, preload: 'metadata', 'aria-label': o }),
    el('figcaption', {}, el('span', {}, o.split('/').pop()), el('a', { href: file(o) + '?download', download: o.split('/').pop() }, 'Download')))));
}
async function loadChoices() { const j = await api('/api/choices').catch(() => ({})); choicesCache = j.choices || null; choicesDirty = false; renderChoices(); }
function renderChoices() {
  const box = $('#choices'), x = choicesCache;
  if (!x) { box.replaceChildren(el('p', { class: 'empty' }, 'After a draft, every pick shows here with the reason it was made: locked by you, from the pack, from the reference, or the kit default.')); return; }
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
  box.replaceChildren(...[el('h3', {}, 'What was picked and why'), el('p', { class: 'fine' }, `Locks: ${x.locksText || 'none'}. Captions: ${x.captions.style}, entrance ${x.captions.entrance || 'pop'}. Music: ${x.music.bed || 'none'}. Punch: ${x.punch}.`),
    wrap(beats, 'Beats'), el('h3', {}, 'Titles'), wrap(titles, 'Titles'), gfx ? el('h3', {}, 'Graphics') : null, gfx ? wrap(gfx, 'Graphics') : null,
    el('div', { class: 'row' }, el('button', { class: 'btn ghost', id: 'apply-choices', disabled: !choicesDirty, onclick: applyChoices }, 'Apply my edits'), el('span', { class: 'fine' }, 'Edits win over locks. Render to see them.'))].filter(Boolean));
}
const wrap = (t, label) => t.tagName === 'TABLE' ? el('div', { class: 'tablewrap', tabindex: '0', role: 'region', 'aria-label': label + ' table' }, t) : t;
async function applyChoices() {
  const j = await api('/api/choices', { beats: choicesCache.beats, titles: choicesCache.titles, graphics: choicesCache.graphics });
  choicesCache = j.choices; choicesDirty = false; renderChoices(); toast('Edits applied. Render to see them.', true);
}
const MSG_STATUS = { queued: 'queued', seen: 'seen by your agent', answered: 'answered' };
function renderChat(s) {
  const e = V.env, a = e.agent || {}, backend = e.backend;
  const bar = $('#agentbar');
  if (backend === 'agent') {
    bar.className = 'agentbar ' + (a.listening ? 'on' : a.connected ? 'busy' : 'off');
    bar.replaceChildren(el('span', { class: 'dot', 'aria-hidden': 'true' }), a.listening ? `${a.name || 'Your agent'} connected, listening` : a.connected ? `${a.name || 'Your agent'} connected, busy in the terminal. Messages wait until its next step.` : 'No agent connected');
  } else { bar.className = 'agentbar alt'; bar.replaceChildren(el('span', { class: 'dot', 'aria-hidden': 'true' }), e.llm ? `Chat: ${e.llm}` : `Chat: ${backend === 'keywords' ? 'keywords only' : 'keywords (no ' + backend + ' backend ready)'}`); }
  $('#chatmode').textContent = backend === 'agent' ? 'This chat is its own channel: your terminal conversation stays in the terminal. Edits from either place update this page.' : 'Change who answers in Settings.';
  const ol = $('#msgs'); const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
  const empty = backend === 'agent' && !a.connected
    ? el('li', { class: 'empty' }, el('b', {}, 'Connect your terminal agent'), '\nIn Claude Code, Codex or Cursor, in the kit folder, say:\n', el('code', {}, 'Set up Studio from AGENTS.md and run the Studio chat loop'), '\nIt registers itself, opens this page and answers here. Or pick another chat in Settings.')
    : el('li', { class: 'empty' }, 'Tell the editor the vibe: "calm and cinematic", "punchy, only whip and zoom transitions", "use the transitions from the reference but calmer".');
  ol.replaceChildren(...(s.chat.length ? s.chat.map(m => el('li', { class: m.role + (m.kind === 'action' ? ' action' : '') }, m.text,
    el('small', {}, m.role === 'user' ? ['you', m.to === 'agent' ? MSG_STATUS[m.status] || m.status : null].filter(Boolean).join(', ') : m.kind === 'action' ? 'action note' : m.from === 'keywords' ? 'studio' : (m.from && m.from !== 'agent' ? m.from : a.name || 'agent')))) : [empty]));
  const waiting = s.chat.filter(m => m.role === 'user' && m.to === 'agent' && m.status !== 'answered');
  if (waiting.length && backend === 'agent') ol.append(el('li', { class: 'typing', 'aria-label': 'waiting for your agent' }, waiting.some(m => m.status === 'seen') ? `${a.name || 'Your agent'} is working on it...` : a.connected ? `Queued: ${a.name || 'your agent'} picks it up at its next step.` : 'Queued until your agent connects.'));
  if (atBottom) ol.scrollTop = ol.scrollHeight;
  $('#chatin').placeholder = backend === 'agent' ? (a.connected ? `Message ${a.name || 'your agent'}` : 'Message your agent (it reads this when it connects)') : 'Calm and cinematic, no glitch, typewriter titles';
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

// ---------- wiring ----------
async function main() {
  CAT = await api('/api/catalog');
  apply(await api('/api/state'));
  $('#job').addEventListener('change', e => patch({ job: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || null }));
  dropzone('#drop-footage', '#file-footage', 'footage'); dropzone('#drop-ref', '#file-ref', 'reference'); dropzone('#drop-music', '#file-music', 'music');
  for (const b of $('#ref-mode').children) b.addEventListener('click', () => patch({ reference: { mode: b.dataset.v } }));
  $('#ref-go').addEventListener('click', () => api('/api/reference', {}).then(apply).catch(() => {}));
  const addLinks = () => { const urls = $('#ref-urls').value.split(/\s+/).filter(Boolean); if (!urls.length) { toast('Paste a link first'); return; } if (!V.state.job) { toast('Name the job first (top left)'); $('#job').focus(); return; }
    api('/api/reference/url', { urls }).then(j => { apply(j); $('#ref-urls').value = ''; const bad = j.added.filter(x => x.status === 'failed'); if (bad.length) toast(bad[0].error); }).catch(() => {}); };
  $('#ref-add').addEventListener('click', addLinks);
  $('#ref-urls').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addLinks(); } });
  $('#ref-urls').addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\/\S+$/.test($('#ref-urls').value.trim()) && V.state.job) addLinks(); }, 0));
  $('#open-settings').addEventListener('click', openSettings);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#find-models').addEventListener('click', findModels);
  for (const r of document.querySelectorAll('input[name=backend]')) r.addEventListener('change', syncLocal);
  $('#filter').addEventListener('input', renderGrid);
  const pb = $('#pause'); const syncPause = () => { pb.setAttribute('aria-pressed', String(paused())); pb.textContent = paused() ? 'Play previews' : 'Pause previews'; };
  syncPause(); pb.addEventListener('click', () => { localStorage.setItem('studio.paused', paused() ? '0' : '1'); syncPause(); renderGrid(); });
  $('#clear-picks').addEventListener('click', () => patch({ clearPicks: true }));
  $('#save-pack').addEventListener('submit', e => { e.preventDefault(); api('/api/pack/save', { name: $('#pack-name').value.trim() }).then(async j => { CAT = await api('/api/catalog'); apply(j); $('#pack-msg').textContent = `Saved ${j.path}`; }).catch(() => {}); });
  $('#draft').addEventListener('click', () => { choicesCache = null; $('#log').textContent = ''; api('/api/draft', {}).then(apply).catch(() => {}); });
  $('#render').addEventListener('click', () => { $('#log').textContent = ''; api('/api/render', {}).then(j => { apply(j); if (j.effectsSkipped) toast(j.effectsSkipped); }).catch(() => {}); });
  $('#cancel').addEventListener('click', () => api('/api/task/cancel', {}).then(apply));
  $('#chatform').addEventListener('submit', async e => {
    e.preventDefault(); const t = $('#chatin').value.trim(); if (!t) return;
    $('#chatin').value = ''; $('#chatin').disabled = true;
    try { apply(await api('/api/chat', { text: t })); } catch {} finally { $('#chatin').disabled = false; $('#chatin').focus(); }
  });
  $('#chatin').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatform').requestSubmit(); } });
  const links = [...document.querySelectorAll('.steps a')];
  const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) for (const a of links) a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + e.target.id)); }, { rootMargin: '-40% 0px -55% 0px' });
  for (const a of links) { const t = document.querySelector(a.getAttribute('href')); if (t && t.tagName === 'SECTION') io.observe(t); }
  const es = new EventSource('/api/events');
  es.addEventListener('state', e => apply(JSON.parse(e.data)));
  es.addEventListener('log', e => { const d = JSON.parse(e.data), log = $('#log'); log.hidden = false; log.textContent += (log.textContent ? '\n' : '') + d.line; log.scrollTop = log.scrollHeight; });
  es.addEventListener('task', () => api('/api/state').then(apply));
}
main().catch(e => toast('Studio could not load: ' + e.message));
