// The B-roll step: one slot per beat of the draft. Fill a slot from the library, an upload, stock (Pexels, Pixabay),
// a card made here, a screen recording or a generate, and set how it sits: full cutaway, split top panel or picture
// in picture. Ideas from your agent (or the rules) wait here for Approve or Dismiss.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { api, toast, cap1, Icon, IconBtn } from './lib.jsx';

const TABS = [['library', 'Library'], ['upload', 'Upload'], ['stock', 'Stock'], ['make', 'Make'], ['record', 'Record'], ['generate', 'Generate']];
const t1 = x => (+x).toFixed(1);
const money = e => (e && e.usd != null ? `$${(+e.usd).toFixed(2)}` : 'cost unknown');
const STOP = new Set('the a an and or but so of to in on at for with by from is are was were be it its this that i you we they my your our just really very like about into than then there here what when where which who how all can will would not now used every'.split(' '));
const queryOf = t => [...new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)).sort((a, b) => b.length - a.length))].slice(0, 2).join(' ');

function Thumb({ c, onClick, on }) {
  return <button type="button" className={'bthumb' + (on ? ' on' : '')} onClick={onClick} title={c.name} data-id={c.id}>
    {c.thumb ? <img src={c.thumb} alt="" loading="lazy" /> : <span className="bt-ph"><Icon n="film" /></span>}
    <span className="bt-n">{c.name}</span><span className="bt-m">{c.source}{c.seconds ? ` · ${t1(c.seconds)} s` : ''}</span></button>;
}

function Library({ fill }) {
  const [q, setQ] = useState(''), [clips, setClips] = useState(null);
  const load = () => api(`/api/broll/library?q=${encodeURIComponent(q)}`).then(j => setClips(j.clips)).catch(() => {});
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q]);
  return <div className="bpanel" id="bp-library">
    <div className="row"><input id="lib-q" className="grow" placeholder="Search names and tags (dark, portrait, laptop...)" value={q} onChange={e => setQ(e.target.value)} /></div>
    {clips && !clips.length && <p className="fine">{q ? 'Nothing matches.' : 'The library is empty. Upload, search stock or make a card; everything lands here for every job.'}</p>}
    <div className="bgrid">{(clips || []).map(c => <Thumb key={c.id} c={c} onClick={() => fill({ clip: c.id })} />)}</div>
  </div>;
}

function Upload({ beat, done }) {
  const [busy, setBusy] = useState(false);
  const send = async files => {
    setBusy(true);
    for (const f of files) { const r = await fetch(`/api/broll/upload?name=${encodeURIComponent(f.name)}&beat=${beat.n}`, { method: 'POST', body: f }); const j = await r.json().catch(() => ({})); if (!r.ok) { toast(j.error || 'upload failed'); break; } done(j); }
    setBusy(false);
  };
  return <div className="bpanel" id="bp-upload"><label className="drop"><input type="file" id="broll-file" accept="video/*,image/*" multiple hidden onChange={e => send([...e.target.files])} />
    <Icon n="upload" /><span>{busy ? 'Adding...' : 'Choose a video or picture'}</span><small className="fine">Goes into your library, then onto beat {beat.n}.</small></label></div>;
}

function Stock({ beat, V, fill, openKeys }) {
  const on = V.broll.sources.filter(s => (s.id === 'pexels' || s.id === 'pixabay') && s.on).map(s => s.id);
  const [prov, setProv] = useState(on[0] || 'pexels'), [q, setQ] = useState(queryOf(beat.text)), [ori, setOri] = useState('portrait'), [max, setMax] = useState('');
  const [res, setRes] = useState(null), [busy, setBusy] = useState(false), [adding, setAdding] = useState(null);
  useEffect(() => setQ(queryOf(beat.text)), [beat.n]);
  if (!on.length) return <div className="bpanel" id="bp-stock"><p className="fine">Stock search needs your free Pexels key (or Pixabay). It stays on this computer.</p><Button id="stock-keys" size="sm" variant="secondary" label="Add a key" onClick={openKeys} /></div>;
  const search = async () => { setBusy(true); try { const j = await api(`/api/broll/stock?provider=${prov}&q=${encodeURIComponent(q)}&orientation=${ori}${max ? '&max=' + max : ''}`); setRes(j.results); } catch {} setBusy(false); };
  const add = async it => { setAdding(it.id); try { const j = await api('/api/broll/stock/add', { provider: prov, item: it, beat: beat.n }); fill(null, j); } catch {} setAdding(null); };
  return <div className="bpanel" id="bp-stock">
    <form className="row" onSubmit={e => { e.preventDefault(); search(); }}>
      {on.length > 1 && <select id="stock-prov" value={prov} onChange={e => setProv(e.target.value)}>{on.map(p => <option key={p} value={p}>{cap1(p)}</option>)}</select>}
      <input id="stock-q" className="grow" value={q} onChange={e => setQ(e.target.value)} placeholder="What to show" />
      <select id="stock-ori" value={ori} onChange={e => setOri(e.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option><option value="">Any</option></select>
      <select id="stock-max" value={max} onChange={e => setMax(e.target.value)} aria-label="Longest"><option value="">Any length</option><option value="10">Up to 10 s</option><option value="20">Up to 20 s</option></select>
      <Button id="stock-go" type="submit" size="sm" variant="secondary" label="Search" isLoading={busy} /></form>
    {res && !res.length && <p className="fine">Nothing found. Try other words or another orientation.</p>}
    <div className="bgrid">{(res || []).map(it => <div key={it.id} className="bthumb stock" data-id={it.id}>
      <video src={it.preview} poster={it.thumb} muted loop playsInline preload="none" onMouseEnter={e => e.currentTarget.play().catch(() => {})} onMouseLeave={e => e.currentTarget.pause()} />
      <span className="bt-n">{it.author ? <a href={it.author.url} target="_blank" rel="noreferrer">{it.author.name}</a> : cap1(prov)}</span>
      <span className="bt-m">{it.duration} s · {it.width}x{it.height}{it.inLibrary ? ' · in library' : ''}</span>
      <Button size="sm" variant="primary" label={adding === it.id ? 'Adding' : 'Use'} isLoading={adding === it.id} onClick={() => add(it)} /></div>)}</div>
    <p className="fine attrib">{prov === 'pexels' ? <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Videos provided by Pexels</a> : <a href="https://pixabay.com" target="_blank" rel="noreferrer">Videos from Pixabay</a>}. Credits go into credits.txt with each render.</p>
  </div>;
}

const CARD_KINDS = [['chart', 'Chart'], ['counter', 'Counter'], ['quote', 'Quote'], ['code', 'Code'], ['terminal', 'Terminal'], ['html', 'HTML scene']];
function Make({ beat, fill, V }) {
  const agentOk = (V.broll.sources.find(s => s.id === 'agent') || {}).on;
  const [kind, setKind] = useState('counter'), [f, setF] = useState({}), [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const spec = () => {
    if (kind === 'chart') return { kind, title: f.title, unit: f.unit, bars: String(f.bars || '').split('\n').map(l => { const m = l.split(/[,:]\s*/); return { label: m[0], value: +m[1] }; }).filter(b => b.label && Number.isFinite(b.value)) };
    if (kind === 'counter') return { kind, from: +(f.from || 0), to: +f.to, prefix: f.prefix, suffix: f.suffix, label: f.label };
    if (kind === 'quote') return { kind, text: f.text, author: f.author };
    if (kind === 'code') return { kind, code: f.code, title: f.title };
    if (kind === 'terminal') return { kind, lines: String(f.lines || '').split('\n'), title: f.title };
    return { kind, html: f.html, css: f.css };
  };
  const go = async () => { setBusy(true); try { const j = await api('/api/broll/make', { spec: { ...spec(), seconds: +(f.seconds || 3) }, beat: beat.n }); fill(null, j); toast('Card made', true); } catch {} setBusy(false); };
  const inp = (k, ph, type) => <input id={'mk-' + k} type={type || 'text'} placeholder={ph} value={f[k] || ''} onChange={e => set(k, e.target.value)} />;
  const ta = (k, ph) => <textarea id={'mk-' + k} rows={4} placeholder={ph} value={f[k] || ''} onChange={e => set(k, e.target.value)} />;
  if (!agentOk) return <div className="bpanel" id="bp-make"><p className="fine">Cards render with Chrome on this computer. Install it with <code>npm run setup:all</code>.</p></div>;
  return <div className="bpanel" id="bp-make">
    <div className="seg-row" role="radiogroup" aria-label="Card">{CARD_KINDS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={String(kind === k)} className={'chip' + (kind === k ? ' on' : '')} id={'mk-kind-' + k} onClick={() => setKind(k)}>{l}</button>)}</div>
    <div className="mk-form">
      {kind === 'chart' && <>{inp('title', 'Title, for example Hours saved a week')}{ta('bars', 'One bar a line: label, value\nEdit, 6\nCut, 3')}{inp('unit', 'Unit, for example h or %')}</>}
      {kind === 'counter' && <><div className="row">{inp('prefix', 'Prefix ($)')}{inp('to', 'Counts to', 'number')}{inp('suffix', 'Suffix (k, %)')}</div>{inp('label', 'Label, for example saved a month')}</>}
      {kind === 'quote' && <>{ta('text', 'The quote')}{inp('author', 'Who said it')}</>}
      {kind === 'code' && <>{inp('title', 'File name')}{ta('code', 'The code')}</>}
      {kind === 'terminal' && <>{inp('title', 'Window title')}{ta('lines', '$ npm run studio\nStudio on http://127.0.0.1:4757')}</>}
      {kind === 'html' && <>{ta('html', '<h1>Your scene</h1> (no scripts)')}{ta('css', 'h1 { animation: in 1s both } @keyframes in { from { opacity: 0 } }')}</>}
      <div className="row"><label className="inl"><span className="fine">Seconds</span><input id="mk-seconds" type="number" min={1} max={8} step={0.5} value={f.seconds || 3} onChange={e => set('seconds', e.target.value)} /></label>
        <Button id="mk-go" variant="primary" size="sm" label="Make card" isLoading={busy} onClick={go} /></div>
      <p className="fine">Rendered here with Chrome, scripts off and no network. About five seconds.</p>
    </div></div>;
}

// screen recording in this browser (getDisplayMedia), with an optional round webcam bubble drawn over it
function Record({ beat, done }) {
  const [cam, setCam] = useState(true), [live, setLive] = useState(false), [secs, setSecs] = useState(0), [busy, setBusy] = useState(false);
  const R = useRef({});
  const stopAll = () => { const r = R.current; cancelAnimationFrame(r.raf); clearInterval(r.tick); for (const s of [r.screen, r.cam]) if (s) s.getTracks().forEach(t => t.stop()); };
  useEffect(() => stopAll, []);
  const start = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast('This browser cannot record the screen'); return; }
    const r = R.current = {};
    try { r.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false }); } catch { return; }
    if (cam) { try { r.cam = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320 }, audio: false }); } catch { toast('No camera, recording the screen only'); } }
    const sv = document.createElement('video'); sv.srcObject = r.screen; sv.muted = true; await sv.play();
    let cv = null; if (r.cam) { cv = document.createElement('video'); cv.srcObject = r.cam; cv.muted = true; await cv.play(); }
    const st = r.screen.getVideoTracks()[0].getSettings(), W = st.width || 1280, H = st.height || 720;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const g = canvas.getContext('2d');
    const draw = () => { g.drawImage(sv, 0, 0, W, H); if (cv) { const d = Math.round(Math.min(W, H) * 0.24), x = W - d - 32, y = H - d - 32; g.save(); g.beginPath(); g.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); g.clip();
      const s = Math.min(cv.videoWidth, cv.videoHeight); g.drawImage(cv, (cv.videoWidth - s) / 2, (cv.videoHeight - s) / 2, s, s, x, y, d, d); g.restore(); g.lineWidth = 6; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); g.stroke(); }
      r.raf = requestAnimationFrame(draw); };
    draw();
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    r.chunks = []; r.rec = new MediaRecorder(canvas.captureStream(30), mime ? { mimeType: mime } : {});
    r.rec.ondataavailable = e => e.data.size && r.chunks.push(e.data);
    r.rec.onstop = async () => { stopAll(); setLive(false); setBusy(true);
      const blob = new Blob(r.chunks, { type: 'video/webm' }), res = await fetch(`/api/broll/upload?name=screen-${Date.now()}.webm&source=screen&beat=${beat.n}`, { method: 'POST', body: blob });
      const j = await res.json().catch(() => ({})); setBusy(false); if (!res.ok) toast(j.error || 'upload failed'); else { done(j); toast('Screen recording added', true); } };
    r.screen.getVideoTracks()[0].onended = () => r.rec.state === 'recording' && r.rec.stop();
    r.rec.start(1000); setLive(true); setSecs(0); r.tick = setInterval(() => setSecs(x => x + 1), 1000);
  };
  return <div className="bpanel" id="bp-record">
    <label className="tick"><input type="checkbox" id="rec-cam" checked={cam} disabled={live} onChange={e => setCam(e.target.checked)} />Webcam bubble</label>
    <div className="row">{live ? <Button id="rec-stop" variant="primary" size="sm" label={`Stop (${secs} s)`} icon={<Icon n="stop" />} onClick={() => R.current.rec.stop()} />
      : <Button id="rec-screen" variant="primary" size="sm" label={busy ? 'Adding...' : 'Record screen'} isLoading={busy} icon={<Icon n="camera" />} onClick={start} />}</div>
    <p className="fine">Your browser asks which screen, window or tab to share. Nothing leaves this computer. Your agent can also capture a public web page (add_broll with a url).</p>
  </div>;
}

function Generate({ beat, V, done, openKeys }) {
  const G = V.broll.generate, ready = G.providers.filter(p => !p.stub && p.set);
  const [prov, setProv] = useState(ready[0] ? ready[0].id : ''), [kind, setKind] = useState('video'), [prompt, setPrompt] = useState(''), [secs, setSecs] = useState(5), [aspect, setAspect] = useState('9:16');
  const [est, setEst] = useState(null), [busy, setBusy] = useState('');
  const p = G.providers.find(x => x.id === prov);
  useEffect(() => { setEst(null); }, [prov, kind, prompt, secs, aspect]);
  useEffect(() => { if (p && !p.kinds.includes(kind)) setKind(p.kinds[0]); }, [prov]);
  if (!G.on) return <div className="bpanel" id="bp-generate"><p className="fine">Generating is off. Turn on Allow generating in API keys and providers. It uses your own account, shows the cost first and asks every time.</p><Button id="gen-keys" size="sm" variant="secondary" label="API keys and providers" onClick={openKeys} /></div>;
  if (!ready.length) return <div className="bpanel" id="bp-generate"><p className="fine">Add a key for Higgsfield, Google, OpenAI, Replicate or fal first.</p><Button id="gen-keys" size="sm" variant="secondary" label="Add a key" onClick={openKeys} /></div>;
  const body = { provider: prov, kind, prompt, seconds: kind === 'video' ? +secs : undefined, aspect, beat: beat.n };
  const estimate = async () => { setBusy('est'); try { setEst(await api('/api/broll/generate/estimate', body)); } catch {} setBusy(''); };
  const go = async () => { setBusy('go'); const r = await fetch('/api/broll/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-page': '1' }, body: JSON.stringify({ ...body, confirm: true, estimate: est }) });
    const j = await r.json().catch(() => ({})); setBusy(''); if (!r.ok) toast(j.error || 'generate failed'); else { setEst(null); done(j); toast('Generating. It lands on the beat when done.', true); } };
  return <div className="bpanel" id="bp-generate">
    <div className="row"><select id="gen-prov" value={prov} onChange={e => setProv(e.target.value)}>{ready.map(x => <option key={x.id} value={x.id}>{x.name}{x.verified ? '' : ' (not verified)'}</option>)}</select>
      <select id="gen-kind" value={kind} onChange={e => setKind(e.target.value)}>{(p ? p.kinds : ['video']).map(k => <option key={k} value={k}>{cap1(k)}</option>)}</select>
      {kind === 'video' && <select id="gen-secs" value={secs} onChange={e => setSecs(e.target.value)}>{(p && p.seconds ? p.seconds : [5, 10]).map(n => <option key={n} value={n}>{n} s</option>)}</select>}
      <select id="gen-aspect" value={aspect} onChange={e => setAspect(e.target.value)}>{['9:16', '16:9', '1:1'].map(a => <option key={a}>{a}</option>)}</select></div>
    <textarea id="gen-prompt" rows={3} placeholder={`What to show on beat ${beat.n}: "${beat.text.slice(0, 60)}"`} value={prompt} onChange={e => setPrompt(e.target.value)} />
    <p className="fine">{p && p.note}</p>
    {!est ? <Button id="gen-est" size="sm" variant="secondary" label="Estimate cost" isDisabled={!prompt.trim()} isLoading={busy === 'est'} onClick={estimate} />
      : <div className="gen-ok" id="gen-confirm"><span>Estimated <b id="gen-cost">{money(est)}</b> on your {p.name} account <small className="fine">({est.from})</small></span>
        <Button id="gen-go" size="sm" variant="primary" label={`Generate for ${money(est)}`} isLoading={busy === 'go'} onClick={go} /><Button size="sm" variant="ghost" label="Cancel" onClick={() => setEst(null)} /></div>}
  </div>;
}

export function BRoll({ V, apply, go, openKeys }) {
  const B = V.broll || { beats: [], sources: [], asks: [], gens: [], generate: { providers: [] }, library: {} };
  const [sel, setSel] = useState(null), [tab, setTab] = useState('library'), [busy, setBusy] = useState('');
  const beat = B.beats.find(b => b.n === sel) || null;
  useEffect(() => { if (!beat && B.beats.length) setSel((B.beats.find(b => b.idea) || B.beats.find(b => !b.slot && b.n > 1) || B.beats[0]).n); }, [B.beats.length]);
  const after = j => { if (j && j.state) apply({ ...V, state: j.state, broll: j.broll }); else if (j && j.broll) apply({ ...V, broll: j.broll }); };
  const fill = async (o, j) => { if (j) return after(j); try { after(await api('/api/broll/slot', { beat: beat.n, ...o })); } catch {} };
  const idea = async (n, action) => { setBusy('idea' + n); try { after(await api('/api/broll/idea', { beat: n, action })); } catch {} setBusy(''); };
  const suggest = async () => { setBusy('suggest'); try { const j = await api('/api/broll/suggest', {}); after(j); toast(j.count ? `${j.count} ideas to approve` : 'No new ideas. Fill a beat by hand.', !!j.count); } catch {} setBusy(''); };
  const ask = async (a, yes) => {
    if (!yes) { try { after(await api('/api/broll/ask', { action: 'decline', id: a.id })); } catch {} return; }
    const r = await fetch('/api/broll/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-page': '1' }, body: JSON.stringify({ ...a, ask: a.id, confirm: true }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) toast(j.error || 'generate failed'); else after(j);
  };
  const L = B.length || 1;
  return <section className="step" id="s-broll" data-step="broll" aria-labelledby="h-broll">
    <header className="sh"><h2 id="h-broll">B-roll</h2><p className="sub">One slot per beat. Pick a clip and how it sits: full cutaway, split top panel or picture in picture. Your voice keeps running underneath.</p></header>
    <div className="row broll-bar"><Button id="broll-suggest" size="sm" variant="secondary" label="Suggest" icon={<Icon n="spark" />} isDisabled={!B.draft} isLoading={busy === 'suggest'} onClick={suggest} />
      <Button id="open-keys" size="sm" variant="ghost" label="API keys and providers" icon={<Icon n="plug" />} onClick={openKeys} /></div>
    <ul className="src-strip" id="broll-src">{B.sources.map(x => <li key={x.id} className={x.on ? 'on' : ''} title={x.note}>{x.on ? <Icon n="check" /> : <Icon n="minus" />}{x.name}</li>)}</ul>
    {B.asks.length > 0 && <div className="asks" id="broll-asks">{B.asks.map(a => <div key={a.id} className="ask" data-id={a.id}>
      <span><b>{a.by}</b> asks to generate{a.beat != null ? ` for beat ${a.beat}` : ''} with {a.provider}: "{a.prompt}" <Badge label={money(a.estimate)} variant="warning" /></span>
      <Button size="sm" variant="primary" label={`Approve ${money(a.estimate)}`} onClick={() => ask(a, true)} /><Button size="sm" variant="ghost" label="Decline" onClick={() => ask(a, false)} /></div>)}</div>}
    {B.gens.filter(g => g.status !== 'done').map(g => <p key={g.id} className={'gen-st ' + g.status} data-id={g.id}>{g.status === 'running' ? `Generating with ${g.provider}${g.phase ? ' (' + g.phase.replace('_', ' ') + ')' : ''}: "${g.prompt.slice(0, 60)}"` : `Generate failed: ${g.error}`}</p>)}
    {!B.draft ? <div className="empty-art" id="broll-empty"><Icon n="film" /><p>The beats come from a draft. Make one on the Render step, then come back.</p><Button id="broll-to-render" variant="secondary" size="sm" label="Go to Render" onClick={() => go('render', true)} /></div>
      : <>
        <div className="lane" id="broll-lane" role="list">
          {B.beats.map(b => <button key={b.n} type="button" role="listitem" className={'beat' + (b.n === sel ? ' sel' : '') + (b.slot ? ' filled' : '') + (b.idea ? ' has-idea' : '')} data-beat={b.n} style={{ flexGrow: Math.max(1, b.seconds) }} onClick={() => setSel(b.n)} aria-pressed={String(b.n === sel)}>
            <span className="bn">{b.n}</span><span className="bt">{t1(b.start)} s</span>
            {b.slot ? <span className="bslot"><img src={b.slot.clip.thumb || ''} alt="" /><em>{b.slot.place === 'full' ? 'Full' : b.slot.place === 'top' ? 'Split' : 'PiP'}</em></span> : <span className="bempty"><Icon n="plus" /></span>}
            <span className="btx">{b.text || 'No words'}</span>
          </button>)}
        </div>
        <div className="lane-scale" aria-hidden="true">{B.beats.map(b => <i key={b.n} style={{ left: (b.start / L * 100) + '%' }} />)}</div>
        {beat && <div className="beat-panel glass" id="beat-panel">
          <div className="bp-h"><b>Beat {beat.n}</b><span className="fine">{t1(beat.start)} to {t1(beat.end)} s · "{beat.text}"</span></div>
          {beat.idea && <div className="idea" id="beat-idea"><Icon n="spark" /><span><b>{beat.idea.by}</b> suggests: {beat.idea.idea}{beat.idea.place ? ` (${B.places[beat.idea.place].toLowerCase()})` : ''}</span>
            <Button id="idea-approve" size="sm" variant="primary" label="Approve" isLoading={busy === 'idea' + beat.n} onClick={() => idea(beat.n, 'approve')} /><Button id="idea-dismiss" size="sm" variant="ghost" label="Dismiss" onClick={() => idea(beat.n, 'dismiss')} /></div>}
          {beat.slot && <div className="slot-set" id="slot-set">
            <div className="slot-prev">{beat.slot.clip.kind === 'video' ? <video src={beat.slot.clip.url + '#t=' + beat.slot.in} muted playsInline preload="metadata" controls /> : <img src={beat.slot.clip.url} alt="" />}</div>
            <div className="col">
              <span className="fine">{beat.slot.clip.name} · {beat.slot.clip.source}{beat.slot.by && beat.slot.by !== 'you' ? ` · placed by ${beat.slot.by}` : ''}</span>
              <div className="seg-row" role="radiogroup" aria-label="Placement">{Object.entries(B.places).map(([k, l]) => <button key={k} type="button" role="radio" id={'place-' + k} aria-checked={String(beat.slot.place === k)} className={'chip place ' + k + (beat.slot.place === k ? ' on' : '')} onClick={() => fill({ clip: beat.slot.clip.id, place: k })}><i aria-hidden="true" />{l}</button>)}</div>
              <div className="row">
                <label className="inl"><span className="fine">Starts</span><input id="slot-offset" type="number" step={0.1} min={0} max={beat.seconds} defaultValue={beat.slot.offset} key={'o' + beat.n + beat.slot.offset} onBlur={e => fill({ clip: beat.slot.clip.id, offset: +e.target.value })} /><span className="fine">s in</span></label>
                <label className="inl"><span className="fine">Length</span><input id="slot-dur" type="number" step={0.1} min={0.4} max={beat.seconds} defaultValue={beat.slot.dur} key={'d' + beat.n + beat.slot.dur} onBlur={e => fill({ clip: beat.slot.clip.id, dur: +e.target.value })} /><span className="fine">s</span></label>
                {beat.slot.clip.kind === 'video' && <label className="inl"><span className="fine">From</span><input id="slot-in" type="number" step={0.1} min={0} defaultValue={beat.slot.in} key={'i' + beat.n + beat.slot.in} onBlur={e => fill({ clip: beat.slot.clip.id, in: +e.target.value })} /><span className="fine">s of the clip</span></label>}
                <Button id="slot-clear" size="sm" variant="ghost" label="Clear" icon={<Icon n="trash" />} onClick={() => fill({ clear: true })} />
              </div>
              {beat.slot.clip.license && <span className="fine">{beat.slot.clip.author && beat.slot.clip.author.name ? `By ${beat.slot.clip.author.name}. ` : ''}{beat.slot.clip.license.name}</span>}
            </div></div>}
          <div className="tabs" role="tablist" aria-label="Fill from">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={'btab-' + k} aria-selected={String(tab === k)} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
          {tab === 'library' && <Library fill={fill} />}
          {tab === 'upload' && <Upload beat={beat} done={after} />}
          {tab === 'stock' && <Stock beat={beat} V={V} fill={fill} openKeys={openKeys} />}
          {tab === 'make' && <Make beat={beat} V={V} fill={fill} />}
          {tab === 'record' && <Record beat={beat} done={after} />}
          {tab === 'generate' && <Generate beat={beat} V={V} done={after} openKeys={openKeys} />}
        </div>}
        <p className="fine" id="broll-note">{B.beats.filter(b => b.slot).length} of {B.beats.length} beats have b-roll. Render puts them in and writes credits.txt next to the reel. Library: {B.library.count} clips in {B.library.dir}.</p>
      </>}
  </section>;
}
