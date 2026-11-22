// The B-roll step: spots on the drafted reel (a long take splits into spots of about 7 s), already picked from what
// you said after every draft. Swap a spot from the library, an upload, stock (Pexels, Pixabay), a card made here, a
// screen recording or a generate, and set how it sits: full cutaway, split top panel or picture in picture. Ideas
// from your agent (or the rules) say why and wait for Approve or Keep empty. Raw uploads are cut into pieces first,
// and testimonial pieces can play in your reel with their own sound.
// 1.28.0: a draft from a reference or a look plans its B-roll slots (build/plan.json "broll"). A slot with no clip is
// never dropped: it shows one card, "Needs B-roll: <what it should show>", with Upload, Use stock (only with a key),
// Send to my agent or Copy for my agent (a ready instruction to capture it) and Skip. A waiting idea looks like an
// idea, and the other sources sit behind "Choose something else".
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, toast, cap1, Icon, IconBtn } from './lib.jsx';
import { Hint } from './ui.jsx';
import { FixActions, agentOn } from './Fix.jsx';
import { copyText } from './Connect.jsx';
import './broll.css';
import { PLACE_NEEDS } from '../../conflicts.mjs';

const TAB_ICON = { library: 'grid', run: 'film', upload: 'upload', stock: 'search', make: 'spark', record: 'camera', generate: 'film' };
const TABS = [['library', 'Library'], ['run', 'Fast run'], ['upload', 'Upload'], ['stock', 'Stock'], ['make', 'Make a card'], ['record', 'Record my screen'], ['generate', 'Generate (paid)']];
const t1 = x => (+x).toFixed(1);
const money = e => (e && e.usd != null ? `$${(+e.usd).toFixed(2)}` : 'cost unknown');
const STOP = new Set('the a an and or but so of to in on at for with by from is are was were be it its this that i you we they my your our just really very like about into than then there here what when where which who how all can will would not now used every'.split(' '));
// the short name on a filled spot, and the placements whose preview shows where you sit (kit/split.cjs)
const SHORT = { full: 'Full', top: 'Split', pip: 'PiP', frame: 'Framed', card: 'Panel' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const LAYOUT_PREVIEW = new Set(['top', 'frame', 'pip']);
const PLACE_TIP = { card: 'A framed panel under your face', full: 'The clip covers the frame', top: 'The clip on top, you below with your head over its edge', pip: 'A small box over you', frame: 'Two rounded cards: the clip up top, you smaller below, head breaking out' };
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

// Fast run: pick clips, pictures or captured sites in the order they should play. We cut them one after another on
// the beat and place them as one piece of B-roll, each shown whole. A link is captured into the library first.
function Run({ beat, B, done }) {
  const [q, setQ] = useState(''), [clips, setClips] = useState(null), [picked, setPicked] = useState([]), [step, setStep] = useState('half'), [busy, setBusy] = useState(''), [url, setUrl] = useState('');
  const load = () => api(`/api/broll/library?q=${encodeURIComponent(q)}`).then(j => setClips(j.clips.filter(c => !c.run))).catch(() => {});
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q]);
  const want = beat.need && beat.need.run ? beat.need.run : null, pace = (B.run && B.run[step]) || (step === 'beat' ? 0.5 : 0.25);
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const addSite = async e => { e.preventDefault(); if (!url.trim()) return; setBusy('site'); try { const j = await api('/api/broll/capture', { url: url.trim() }); setUrl(''); setPicked(p => [...p, j.clip.id]); setQ(''); load(); } catch {} setBusy(''); };
  const make = async () => { setBusy('make'); try { const j = await api('/api/broll/run', { beat: beat.n, clips: picked, step }); setPicked([]); done(j); toast(`Fast run placed: ${plural(picked.length, 'cut')} in ${t1(j.seconds)} s.`, true); } catch {} setBusy(''); };
  return <div className="bpanel" id="bp-run">
    <p className="fine" id="run-hint">Pick 2 or more in the order they should play{want ? ` (the reference cuts ${want} here)` : ''}. We cut them on the beat as one piece of B-roll. Each one is shown whole, so a wide site stays a site.</p>
    <div className="row run-opts"><span className="lbl" id="run-step-l">One every</span>
      <SegmentedControl label="One every" size="sm" value={step} onChange={setStep}><SegmentedControlItem value="half" label="Half beat" /><SegmentedControlItem value="beat" label="Beat" /></SegmentedControl>
      <span className="fine" id="run-pace">{picked.length >= 2 ? `${plural(picked.length, 'cut')}, about ${t1(picked.length * pace)} s${B.run && B.run.bpm ? ` at ${B.run.bpm} BPM` : ''}` : B.run && B.run.bpm ? `${B.run.bpm} BPM` : 'It follows your music when you render.'}</span>
      <span className="grow" /><Button id="run-make" size="sm" variant="primary" label={picked.length >= 2 ? `Make the run (${picked.length})` : 'Make the run'} isDisabled={picked.length < 2} isLoading={busy === 'make'} onClick={make} /></div>
    <div className="row"><input id="run-q" className="grow" placeholder="Search your library" value={q} onChange={e => setQ(e.target.value)} /></div>
    {clips && !clips.length && <p className="fine">{q ? 'Nothing matches.' : 'Your library is empty. Add a site below, or upload pictures and clips on the Upload tab.'}</p>}
    <div className="bgrid run-grid" id="run-grid">{(clips || []).map(c => { const k = picked.indexOf(c.id); return <button key={c.id} type="button" className={'bthumb run-pick' + (k >= 0 ? ' on' : '')} aria-pressed={String(k >= 0)} onClick={() => toggle(c.id)} title={c.name} data-id={c.id}>
      {c.thumb ? <img src={c.thumb} alt="" loading="lazy" /> : <span className="bt-ph"><Icon n="film" /></span>}{k >= 0 && <em className="run-n">{k + 1}</em>}
      <span className="bt-n">{c.name}</span><span className="bt-m">{c.source}</span></button>; })}</div>
    {B.card && <form className="row run-site" id="run-site" onSubmit={addSite}><input id="run-url" className="grow" type="url" placeholder="Add a site: paste a public link" value={url} onChange={e => setUrl(e.target.value)} />
      <Button id="run-add-site" type="submit" size="sm" variant="secondary" label="Add" isLoading={busy === 'site'} isDisabled={!url.trim()} /></form>}
  </div>;
}

const RAW_LABEL = { transcribing: 'Listening for words', cutting: 'Cutting into pieces', done: 'Cut', failed: 'Could not cut' };
function Upload({ beat, done, B, V }) {
  const [busy, setBusy] = useState(false), [type, setType] = useState('lifestyle'), [raw, setRaw] = useState(false);
  const send = async files => {
    setBusy(true);
    for (const f of files) { const isRaw = raw && /^video\//.test(f.type || 'video/'), r = await fetch(`/api/broll/upload?name=${encodeURIComponent(f.name)}&type=${type}${isRaw ? '&raw=1' : `&beat=${beat.n}`}`, { method: 'POST', body: f }); const j = await r.json().catch(() => ({})); if (!r.ok) { toast(j.error || 'upload failed'); break; } done(j); if (isRaw) toast('Cutting it into pieces on whole words. They land in your library.', true); }
    setBusy(false);
  };
  const raws = (B.raws || []).filter(x => x.status !== 'done' || Date.now() - x.at < 6e5);
  return <div className="bpanel" id="bp-upload">
    <div className="row up-opts"><label className="inl"><span className="fine">It is</span><select id="up-type" value={type} onChange={e => { setType(e.target.value); if (e.target.value === 'testimonial') setRaw(true); }}>{Object.entries(B.types || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="tick"><input type="checkbox" id="up-raw" checked={raw} onChange={e => setRaw(e.target.checked)} />It is raw: cut it into pieces first</label>
      <Hint id="up-raw-hint" label="About raw uploads">Studio listens for the words and cuts the clip the same way as your footage: every edge in a pause, never mid-word, retakes left out. Each piece lands in your library with its words as tags. Testimonial pieces can play in your reel with their own sound.</Hint></div>
    <label className="drop"><input type="file" id="broll-file" accept="video/*,image/*" multiple hidden onChange={e => send([...e.target.files])} />
      <Icon n="upload" /><span>{busy ? 'Adding...' : 'Choose a video or picture'}</span><small className="fine">{raw ? 'Cut into pieces, then into your library.' : `Goes into your library, then onto spot ${beat.n}.`}</small></label>
    {raws.length > 0 && <ul className="raws" id="up-raws">{raws.map(x => <li key={x.id} className={'raw ' + x.status} data-id={x.id}><b>{x.name}</b><span className="fine">{RAW_LABEL[x.status] || x.status}{x.pieces && x.pieces.length ? `, ${x.pieces.length} piece${x.pieces.length === 1 ? '' : 's'}` : ''}{x.error ? `: ${x.error}` : ''}</span>{x.fix && x.fix.length > 0 && <FixActions V={V} id={x.fix[0]} />}</li>)}</ul>}
  </div>;
}

function Stock({ beat, V, fill, openKeys }) {
  const on = V.broll.sources.filter(s => (s.id === 'pexels' || s.id === 'pixabay') && s.on).map(s => s.id);
  const [prov, setProv] = useState(on[0] || 'pexels'), [q, setQ] = useState((beat.idea && beat.idea.query) || queryOf(beat.text)), [ori, setOri] = useState('portrait'), [max, setMax] = useState('');
  const [res, setRes] = useState(null), [busy, setBusy] = useState(false), [adding, setAdding] = useState(null);
  useEffect(() => setQ((beat.idea && beat.idea.query) || queryOf(beat.text)), [beat.n]);
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
  const agentOk = (V.broll.sources.find(s => s.id === 'agent') || {}).on, card = beat.idea && beat.idea.card;
  const [kind, setKind] = useState(card ? card.kind : 'counter'), [f, setF] = useState(card ? { ...card, lines: Array.isArray(card.lines) ? card.lines.join('\n') : card.lines } : {}), [busy, setBusy] = useState(false);
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
  if (!agentOk) return <div className="bpanel" id="bp-make"><p className="fine">Cards render with Chrome on this computer, and it is not installed yet.</p><FixActions V={V} id="chrome" /></div>;
  return <div className="bpanel" id="bp-make">
    <div className="seg-row" role="radiogroup" aria-label="Card">{CARD_KINDS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={String(kind === k)} className={'chip' + (kind === k ? ' on' : '')} id={'mk-kind-' + k} onClick={() => setKind(k)}>{l}</button>)}</div>
    <div className="mk-form">
      {kind === 'chart' && <>{inp('title', 'Title, for example Hours saved a week')}{ta('bars', 'One bar a line: label, value\nEdit, 6\nCut, 3')}{inp('unit', 'Unit, for example h or %')}</>}
      {kind === 'counter' && <><div className="row">{inp('prefix', 'Prefix ($)')}{inp('to', 'Counts to', 'number')}{inp('suffix', 'Suffix (k, %)')}</div>{inp('label', 'Label, for example saved a month')}</>}
      {kind === 'quote' && <>{ta('text', 'The quote')}{inp('author', 'Who said it')}</>}
      {kind === 'code' && <>{inp('title', 'File name')}{ta('code', 'The code')}</>}
      {kind === 'terminal' && <>{inp('title', 'Window title')}{ta('lines', '$ ls\nreel.mp4  notes.md')}</>}
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
      : <Button id="rec-screen" variant="primary" size="sm" label={busy ? 'Adding...' : 'Record screen'} isLoading={busy} icon={<Icon n="camera" />} onClick={start} />}
      <Hint id="rec-hint" label="About screen recording">Your browser asks which screen, window or tab to share. Nothing leaves this computer. Your agent can also capture a public web page (add_broll with a url).</Hint></div>
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

const clock = x => { const t = Math.max(0, Math.round(+x || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const SRC = { library: 'Library', upload: 'Upload', pexels: 'Stock', pixabay: 'Stock', agent: 'Card', screen: 'Screen rec', capture: 'Web capture', generate: 'AI gen' };
// an idea in plain words: what it is, never a search term as a title ("Stock: effect second")
const ideaWords = i => { const t = String((i && i.idea) || ''), m = t.match(/^Stock:\s*(.+)$/i), sc = t.match(/^Screen recording:\s*(.+)$/i), lk = t.match(/^Like the reference:\s*(.+)$/i);
  return m ? `A stock clip about "${m[1]}"` : sc ? `A screen recording of ${sc[1]}` : lk ? cap1(lk[1]) : t; };
const SITS = { full: 'It covers the whole screen.', top: 'It takes the top half, you stay below.', pip: 'It sits in a small box over you.', frame: 'It sits in a card above you.', card: 'It sits in a panel under your face.' };
// a reason worth showing: not the one that only repeats the search words
const ideaWhy = i => (i && i.why && !/^You talk about /i.test(i.why) ? i.why : '');
const spotTitle = b => b.slot ? (b.slot.clip.source === 'agent' || b.slot.clip.source === 'run' ? b.slot.clip.name : `${SRC[b.slot.clip.source] || cap1(b.slot.clip.source)}: ${b.slot.clip.name}`) : b.need ? (b.need.skipped ? 'Skipped' : 'Needs B-roll') : b.under ? 'B-roll runs on' : b.idea ? `Idea: ${ideaWords(b.idea)}` : b.ref ? 'Reference b-roll' : 'Empty';

// One card for a slot that needs B-roll: what it should show, then the ways to get it. Upload puts your file straight
// on the slot; Use stock shows only when a key is set; the agent buttons carry a ready instruction to capture it.
function Need({ b, V, after, onPick, sel, onRun }) {
  const n = b.need, [busy, setBusy] = useState('');
  const act = async action => { setBusy(action); try { const j = await api('/api/broll/need', { beat: b.n, action }); after(j); if (action === 'send') toast('Sent to your agent. Its answer shows in the chat.', true); if (action === 'stock') toast('Stock clip placed. Swap it if it does not fit.', true); } catch {} setBusy(''); };
  const up = async files => { setBusy('up'); for (const f of files) { const r = await fetch(`/api/broll/upload?name=${encodeURIComponent(f.name)}&type=${n.kind === 'panel' ? 'screen-recording' : 'lifestyle'}&beat=${b.n}`, { method: 'POST', body: f }); const j = await r.json().catch(() => ({})); if (!r.ok) { toast(j.error || 'upload failed'); break; } after(j); } setBusy(''); };
  if (n.skipped) return <li className={'need glass skipped' + (sel ? ' sel' : '')} data-beat={b.n} data-slot={n.slot}>
    <span className="need-t"><b>Skipped</b><span className="fine">{clock(b.start)} · You stay on screen here.</span></span>
    <Button className="need-undo" size="sm" variant="ghost" label="Put it back" onClick={() => act('unskip')} /></li>;
  return <li className={'need glass' + (sel ? ' sel' : '')} data-beat={b.n} data-slot={n.slot} onClick={onPick}>
    <span className="need-t"><b className="need-h">Needs B-roll: {n.what}</b>
      <span className="fine need-d">{clock(b.start)} · {t1(n.seconds)} s · {n.shape}{n.treat ? ` · ${n.treat}` : ''}</span></span>
    <span className="need-acts" onClick={e => e.stopPropagation()}>
      {n.run ? <Button className="need-run" size="sm" variant="secondary" label="Pick clips for the run" icon={<Icon n="film" />} onClick={onRun} />
        : <label className={'need-up' + (busy === 'up' ? ' busy' : '')}><input type="file" accept="video/*,image/*" hidden onChange={e => up([...e.target.files])} /><Icon n="upload" />{busy === 'up' ? 'Adding...' : 'Upload'}</label>}
      {n.stock && !n.run && <Button className="need-stock" size="sm" variant="secondary" label="Use stock" isLoading={busy === 'stock'} onClick={() => act('stock')} />}
      {agentOn(V) && <Button className="need-send" size="sm" variant="secondary" label="Send to my agent" isLoading={busy === 'send'} onClick={() => act('send')} />}
      <Button className="need-copy" size="sm" variant="ghost" label="Copy for my agent" icon={<Icon n="copy" />} onClick={() => copyText(n.ask, 'Copied. Paste it into your agent.')} />
      <Button className="need-skip" size="sm" variant="ghost" label="Skip" onClick={() => act('skip')} /></span>
  </li>;
}

// testimonial pieces from raw uploads, played in your reel with their own sound after the piece you pick
function Testimonials({ B, V, after }) {
  const pieces = ((V.combo && V.combo.pieces) || []).filter(x => x.kind !== 'testimonial'), on = Object.fromEntries((B.cutins || []).map(x => [x.clip.id, x]));
  const set = async (clip, o) => { try { after(await api('/api/broll/cutin', { clip, ...o })); } catch {} };
  if (!(B.testimonials || []).length) return null;
  return <div className="testis glass" id="broll-testimonials">
    <div className="bp-h"><b>Testimonials</b><span className="fine">They play in your reel with their own sound, between your clips. Draft again to hear them.</span></div>
    <ul>{B.testimonials.map(c => { const x = on[c.id]; return <li key={c.id} data-id={c.id} className={x ? 'on' : ''}>
      <span className="ts-t"><b>{c.name}</b><span className="fine">{c.raw && c.raw.seconds ? `${t1(c.raw.seconds)} s` : ''}{c.raw && c.raw.text && !c.raw.text.startsWith(c.name) ? ` · "${c.raw.text.slice(0, 80)}"` : ''}</span></span>
      {!pieces.length ? <span className="fine">Keep a clip on the Cut step first.</span>
        : x ? <><label className="inl"><span className="fine">After</span><select className="ts-after" value={x.after || ''} onChange={e => set(c.id, { after: e.target.value || null })}><option value="">Before my last clip</option>{pieces.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <Button size="sm" variant="ghost" label="Take out" onClick={() => set(c.id, { remove: true })} /></>
        : <Button className="ts-add" size="sm" variant="secondary" label="Play in my reel" icon={<Icon n="plus" />} onClick={() => set(c.id, {})} />}
    </li>; })}</ul>
  </div>;
}

export function BRoll({ V, apply, go, openKeys }) {
  const noMask = !!(V && V.env && V.env.effectsReady === false);
  const B = V.broll || { beats: [], sources: [], asks: [], gens: [], generate: { providers: [] }, library: {} };
  const [sel, setSel] = useState(null), [tab, setTab] = useState('library'), [busy, setBusy] = useState(''), [addAt, setAddAt] = useState(null), [confirmClear, setConfirmClear] = useState(false), [more, setMore] = useState(null);
  const beat = B.beats.find(b => b.n === sel) || null;
  useEffect(() => { if (!beat && B.beats.length) setSel((B.beats.find(b => b.need && !b.need.skipped) || B.beats.find(b => b.idea) || B.beats.find(b => b.slot) || B.beats[0]).n); }, [B.beats.length]);
  // a reply can land after a newer live update (an agent's idea, a clear from the API). Merging it into this render's V
  // with seq 0 used to put the older lane back on screen, so ask for a fresh view instead: it carries a seq, and apply
  // drops it if something newer is already showing.
  const after = j => { if (j && (j.state || j.broll)) api('/api/state').then(apply).catch(() => {}); };
  const fill = async (o, j) => { if (j) return after(j); try { after(await api('/api/broll/slot', { beat: beat.n, ...o })); } catch {} };
  const idea = async (n, action) => { setBusy('idea' + n); try { after(await api('/api/broll/idea', { beat: n, action })); } catch {} setBusy(''); };
  const suggest = async () => { setBusy('suggest'); try { const j = await api('/api/broll/suggest', {}); after(j); toast(j.count ? `${j.count} idea${j.count === 1 ? '' : 's'} to approve` : 'Every spot that needs b-roll has some. Add a spot or swap one.', !!j.count); } catch {} setBusy(''); };
  const clearAll = async (undo) => { setBusy('clear'); try { const j = await api('/api/broll/clear', undo ? { undo: true } : {}); after(j); setConfirmClear(false); toast(j.note || (undo ? 'B-roll is back on the timeline.' : 'Cleared b-roll from every spot.'), true); } catch {} setBusy(''); };
  const auto = async on => { try { after(await api('/api/broll/auto', { on })); } catch {} };
  const addSpot = async e => { e.preventDefault(); try { after(await api('/api/broll/spot', { at: +addAt })); setAddAt(null); } catch {} };
  const ask = async (a, yes) => {
    if (!yes) { try { after(await api('/api/broll/ask', { action: 'decline', id: a.id })); } catch {} return; }
    const r = await fetch('/api/broll/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-page': '1' }, body: JSON.stringify({ ...a, ask: a.id, confirm: true }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) toast(j.error || 'generate failed'); else after(j);
  };
  const L = B.length || 1, filled = B.beats.filter(b => b.slot).length, waiting = B.beats.filter(b => b.idea && !b.slot).length;
  const needs = B.beats.filter(b => b.need), open = needs.filter(b => !b.need.skipped).length;
  // the plan's B-roll slots (from the reference or the look) and how many have a clip: said first, so empty slots are not a surprise
  const SL = B.slots && B.slots.total ? B.slots : null;
  const openRun = n => { setSel(n); setMore(n); setTab('run'); };
  // the other sources stay behind "Choose something else" while the spot has an idea, a need or a clip
  const showTabs = beat && (more === beat.n || !(beat.idea || beat.need || beat.slot));
  return <section className="step" id="s-broll" data-step="broll" aria-labelledby="h-broll">
    <header className="sh"><h2 id="h-broll">B-roll</h2><p className="sub">{SL ? <><b id="broll-count" data-filled={SL.filled} data-total={SL.total}>{SL.filled} of {SL.total} B-roll spots filled.</b> {open ? `Your ${SL.from === 'look' ? 'look' : 'reference'} has B-roll at each one; ${open} still need${open === 1 ? 's' : ''} a clip from you.` : SL.skipped ? `You skipped ${SL.skipped}.` : `Your ${SL.from === 'look' ? 'look' : 'reference'} has B-roll at each one.`}</> : open ? `${open} slot${open === 1 ? '' : 's'} need${open === 1 ? 's' : ''} a clip from you. The rest is picked from what you said.` : B.auto ? 'Picked for you from what you said, after every draft. Click a spot to swap, change or remove it.' : 'Spots on your draft. Suggest picks from what you said; click a spot to fill it.'}</p></header>
    <div className="row broll-bar"><Button id="broll-suggest" size="sm" variant="secondary" label="Suggest b-roll again" icon={<Icon n="spark" />} isDisabled={!B.draft} isLoading={busy === 'suggest'} onClick={suggest} /></div>
    {B.asks.length > 0 && <div className="asks" id="broll-asks">{B.asks.map(a => <div key={a.id} className="ask" data-id={a.id}>
      <span><b>{a.by}</b> asks to generate{a.beat != null ? ` for spot ${a.beat}` : ''} with {a.provider}: "{a.prompt}" <Badge label={money(a.estimate)} variant="warning" /></span>
      <Button size="sm" variant="primary" label={`Approve ${money(a.estimate)}`} onClick={() => ask(a, true)} /><Button size="sm" variant="ghost" label="Decline" onClick={() => ask(a, false)} /></div>)}</div>}
    {B.gens.filter(g => g.status !== 'done').map(g => <p key={g.id} className={'gen-st ' + g.status} data-id={g.id}>{g.status === 'running' ? `Generating with ${g.provider}${g.phase ? ' (' + g.phase.replace('_', ' ') + ')' : ''}: "${g.prompt.slice(0, 60)}"` : `Generate failed: ${g.error}`}</p>)}
    {!B.draft ? <div className="empty-art" id="broll-empty"><Icon n="film" /><p>The spots come from a draft. Draft on the Review step and b-roll picks itself from what you said.</p><Button id="broll-to-render" variant="secondary" size="sm" label="Go to Review" onClick={() => go('review', true)} /></div>
      : <>
        {needs.length > 0 && <ul className="need-list" id="broll-needs" aria-label="Slots that need B-roll">{needs.map(b => <Need key={b.need.slot} b={b} V={V} after={after} sel={b.n === sel} onPick={() => setSel(b.n)} onRun={() => openRun(b.n)} />)}</ul>}
        <div className="blane spots" id="broll-lane" role="list" aria-label="Spots">
          {B.beats.map(b => <button key={b.n} type="button" role="listitem" className={'beat spot' + (b.n === sel ? ' sel' : '') + (b.slot ? ' filled' : '') + (b.idea ? ' has-idea' : '') + (b.ref ? ' ref' : '') + (b.need && !b.slot ? (b.need.skipped ? ' skipped' : ' needs') : '')} data-beat={b.n} style={{ flexGrow: Math.max(1, b.seconds) }} onClick={() => setSel(b.n)} aria-pressed={String(b.n === sel)}>
            <span className="sp-top"><span className="bt">{clock(b.slot ? b.slot.at : b.start)}</span>{b.ref && !b.need && <em className="sp-ref" title={b.ref.detail}>REF</em>}{b.slot && b.slot.by && b.slot.by !== 'you' && <em className="sp-by">{b.slot.by === 'Studio' ? 'picked' : b.slot.by}</em>}</span>
            {b.slot ? <span className="bslot"><img src={b.slot.clip.thumb || ''} alt="" /><em>{SHORT[b.slot.place] || 'Full'}</em></span> : null}
            <span className="sp-t">{spotTitle(b)}</span>
            <span className="btx">{b.text ? `"${b.text.length > 64 ? b.text.slice(0, 62) + '...' : b.text}"` : 'Nothing said here'}</span>
          </button>)}
        </div>
        <div className="blane-scale" aria-hidden="true">{B.beats.map(b => <i key={b.n} style={{ left: (b.start / L * 100) + '%' }} />)}</div>
        <p className="fine broll-clear-row" id="broll-clear-row">{filled} of {B.beats.length} spots have b-roll.
          {filled > 0 && !confirmClear && <> <button type="button" className="linkish" id="broll-clear-all" onClick={() => setConfirmClear(true)}>Clear all B-roll</button>.</>}
          {confirmClear && <span className="broll-clear-confirm" id="broll-clear-confirm"> Clear b-roll from every spot? <Button id="broll-clear-yes" size="sm" variant="primary" label="Clear all" isLoading={busy === 'clear'} onClick={() => clearAll(false)} /><Button id="broll-clear-no" size="sm" variant="ghost" label="Cancel" onClick={() => setConfirmClear(false)} /></span>}
          {!!B.undo && !confirmClear && <span className="broll-undo" id="broll-undo"> B-roll cleared. <button type="button" className="linkish" id="broll-undo-btn" onClick={() => clearAll(true)}>Undo</button></span>}
        </p>
        {beat && <div className="beat-panel glass" id="beat-panel">
          <div className="bp-h"><b>Spot {beat.n} at {clock(beat.start)}</b><span className="fine">{t1(beat.start)} to {t1(beat.end)} s · "{beat.text}"</span></div>
          {beat.ref && !beat.need && <p className="fine sp-refnote" id="spot-ref"><Icon n="film" />{beat.ref.slot && !beat.ref.slot.ref ? 'The look has B-roll here' : 'The reference shows B-roll here'}{beat.ref.detail && !beat.ref.slot ? `: ${beat.ref.detail}` : ''}.</p>}
          {beat.need && !beat.slot && <p className="fine sp-refnote" id="spot-need"><Icon n="film" />{beat.need.skipped ? 'You skipped this slot. You stay on screen here.' : `This slot needs ${beat.need.what}. Use the card above, or choose something else.`}</p>}
          {beat.idea && <div className="idea waiting" id="beat-idea"><Icon n="spark" /><span><b>Idea{beat.idea.by && beat.idea.by !== 'the rules' && beat.idea.by !== 'Studio' ? ` from ${beat.idea.by}` : ''}</b>: {ideaWords(beat.idea)}. {SITS[beat.idea.place] || SITS.full}{ideaWhy(beat.idea) && <small className="why" id="idea-why">{ideaWhy(beat.idea)}</small>}</span>
            <Button id="idea-approve" size="sm" variant="primary" label="Use it" isLoading={busy === 'idea' + beat.n} onClick={() => idea(beat.n, 'approve')} /><Button id="idea-dismiss" size="sm" variant="ghost" label="Keep empty" onClick={() => idea(beat.n, 'dismiss')} /></div>}
          {beat.slot && <div className="slot-set" id="slot-set">
            <div className={'slot-prev lay-' + (beat.slot.place || 'full')} id="slot-prev">{beat.slot.clip.kind === 'video' ? <video src={beat.slot.clip.url + '#t=' + beat.slot.in} muted playsInline preload="metadata" controls={beat.slot.place === 'full' || !beat.slot.place} /> : <img src={beat.slot.clip.url} alt="" />}{LAYOUT_PREVIEW.has(beat.slot.place) && <span className="lay-you" aria-hidden="true"><i className="bd" /><i className="hd" /></span>}</div>
            <div className="col">
              <span className="fine">{beat.slot.clip.name} · {beat.slot.clip.run ? `${plural(beat.slot.clip.run.n, 'cut')}, one every ${beat.slot.clip.run.step} s, on the beat` : beat.slot.clip.source}{beat.slot.by && beat.slot.by !== 'you' ? ` · ${beat.slot.by === 'Studio' ? 'picked from your words' : 'placed by ' + beat.slot.by}` : ''}</span>
              <span className="lbl">How it sits</span>
              <div className="seg-row" role="radiogroup" aria-label="Placement">{Object.entries(B.places).map(([k, l]) => <button key={k} type="button" role="radio" id={'place-' + k} aria-checked={String(beat.slot.place === k)} className={'chip place plc-' + k + (beat.slot.place === k ? ' on' : '')} title={PLACE_TIP[k] + (noMask && PLACE_NEEDS[k] ? '. ' + PLACE_NEEDS[k] : '')} onClick={() => fill({ clip: beat.slot.clip.id, place: k })}><i aria-hidden="true" />{l}</button>)}</div>
              {noMask && PLACE_NEEDS[beat.slot.place] && <p className="fine ctl-off" id="place-need">{PLACE_NEEDS[beat.slot.place]}</p>}
              <span className="lbl">Timing</span>
              <div className="row">
                <label className="inl"><span className="fine">Starts</span><input id="slot-offset" type="number" step={0.1} min={0} max={beat.seconds} defaultValue={beat.slot.offset} key={'o' + beat.n + beat.slot.offset} onBlur={e => fill({ clip: beat.slot.clip.id, offset: +e.target.value })} /><span className="fine">s in</span></label>
                <label className="inl"><span className="fine">Length</span><input id="slot-dur" type="number" step={0.1} min={0.4} max={beat.seconds} defaultValue={beat.slot.dur} key={'d' + beat.n + beat.slot.dur} onBlur={e => fill({ clip: beat.slot.clip.id, dur: +e.target.value })} /><span className="fine">s</span></label>
                {beat.slot.clip.kind === 'video' && <label className="inl"><span className="fine">From</span><input id="slot-in" type="number" step={0.1} min={0} defaultValue={beat.slot.in} key={'i' + beat.n + beat.slot.in} onBlur={e => fill({ clip: beat.slot.clip.id, in: +e.target.value })} /><span className="fine">s of the clip</span></label>}
              </div>
              {beat.slot.why && <><span className="lbl">Why this</span><p className="fine why" id="slot-why">{beat.slot.why}</p></>}
              <div className="row"><Button id="slot-clear" size="sm" variant="secondary" label="Remove" icon={<Icon n="trash" />} onClick={() => fill({ clear: true })} /></div>
              {beat.slot.clip.license && <span className="fine">{beat.slot.clip.author && beat.slot.clip.author.name ? `By ${beat.slot.clip.author.name}. ` : ''}{beat.slot.clip.license.name}</span>}
            </div></div>}
          {!showTabs && <div className="row"><Button id="broll-more" size="sm" variant="ghost" label="Choose something else" icon={<Icon n="grid" />} onClick={() => setMore(beat.n)} /></div>}
          {showTabs && <TabGroup className="btabs" selectedIndex={TABS.findIndex(([k]) => k === tab)} onChange={i => setTab(TABS[i][0])}>
            <TabList className="tabs" aria-label="Fill from">{TABS.map(([k, l]) => <Tab key={k} id={'btab-' + k} className={({ selected }) => 'tab' + (selected ? ' on' : '')}><Icon n={TAB_ICON[k]} />{l}</Tab>)}</TabList>
            <TabPanels className="btab-panels">
              <TabPanel><Library fill={fill} /></TabPanel>
              <TabPanel><Run beat={beat} B={B} done={after} /></TabPanel>
              <TabPanel><Upload beat={beat} done={after} B={B} V={V} /></TabPanel>
              <TabPanel><Stock beat={beat} V={V} fill={fill} openKeys={openKeys} /></TabPanel>
              <TabPanel><Make beat={beat} V={V} fill={fill} /></TabPanel>
              <TabPanel><Record beat={beat} done={after} /></TabPanel>
              <TabPanel><Generate beat={beat} V={V} done={after} openKeys={openKeys} /></TabPanel>
            </TabPanels>
          </TabGroup>}
        </div>}
        <Testimonials B={B} V={V} after={after} />
        <details className="fold glass-card" id="broll-more-fold"><summary>More</summary>
          <div className="row broll-bar"><Button id="broll-add-spot" size="sm" variant="secondary" label="Add a spot" icon={<Icon n="plus" />} isDisabled={!B.draft} onClick={() => setAddAt(addAt == null ? (beat ? +((beat.start + beat.end) / 2).toFixed(1) : 1) : null)} />
            <label className="tick" title="After every draft, Studio fills spots from your library, free stock when you set a key, and cards made from your words. Generating always asks first."><input type="checkbox" id="broll-auto" checked={!!B.auto} onChange={e => auto(e.target.checked)} />Picks itself after each draft</label>
            <span className="grow" /><Button id="open-keys" size="sm" variant="ghost" label="Stock and generate keys" icon={<Icon n="plug" />} onClick={openKeys} /></div>
          {addAt != null && <form className="row add-spot" id="add-spot" onSubmit={addSpot}><label className="inl"><span className="fine">New spot at</span><input id="add-spot-at" type="number" min={0.5} max={Math.max(1, L - 0.5)} step={0.1} value={addAt} onChange={e => setAddAt(e.target.value)} /><span className="fine">s</span></label>
            <Button id="add-spot-go" type="submit" size="sm" variant="secondary" label="Add" /><Button size="sm" variant="ghost" label="Cancel" onClick={() => setAddAt(null)} /></form>}
          <p className="fine" id="broll-note">{filled} of {B.beats.length} spots have b-roll{waiting ? `, ${waiting} waiting for you` : ''}{open ? `, ${open} need a clip` : ''}. Render puts them in and writes credits.txt next to the reel. Library: {B.library.count} clips in {B.library.dir}.</p>
        </details>
      </>}
  </section>;
}
