// The Cut step, in three layers, each with one plain line under its name:
//   1 Raw take    the full take, playable, with its words
//   2 Best lines  every line sorted by what it does, the ones we recommend marked Best (Pieces.jsx)
//   3 Clips       those lines stitched into clips (the full edit and the short clips), the quiet trimmed; Play plays
//                 the stitched result on the take itself, and a tick keeps a clip. The kept clips are what moves on
// On top: the point of the video (one optional line that steers our picks) and What to make (format, length, output,
// goal), folded. Pacing, one control on Clips, says how much quiet comes out; it changes the stitched previews at once
// and is what the draft uses. Nothing renders here. (The server and agents still say candidates, pieces, the Combo and
// bites; the page says lines and clips.)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { api, file, toast, cap1, fmtS, Icon, IconBtn } from './lib.jsx';
import { FixActions } from './Fix.jsx';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Player, useMedia, useTranscript, useStitch, Wave, clock } from './Player.jsx';
import { Pieces, FITS } from './Pieces.jsx';

const KIND = { full: 'Full edit', part: 'Parts', clip: 'Clips', ad: 'Ad cuts' };
const FRAME = { '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5] };

function Opt({ id, on, onClick, title, sub, art, group }) {
  return <button type="button" id={id} className={'opt' + (on ? ' on' : '')} role="radio" aria-checked={String(!!on)} onClick={onClick} data-group={group}>
    {art}<span className="opt-t">{title}</span>{sub && <span className="opt-s">{sub}</span>}{on && <Icon n="check" className="opt-k" />}</button>;
}
const Frame = ({ a }) => { const [w, h] = FRAME[a] || [9, 16], k = 26 / Math.max(w, h); return <span className="frame" aria-hidden="true" style={{ width: w * k, height: h * k }} />; };

function Picker({ cut, set }) {
  const o = cut.output, F = cut.formats, [more, setMore] = useState(!!(o.seconds || o.aspect || o.max || o.clipSeconds));
  const num = (k, v) => set({ [k]: v === '' ? null : +v });
  return <div className="picker">
    <div className="pk-row" role="radiogroup" aria-label="Format"><span className="pk-l">Format</span>
      {Object.entries(F).map(([k, f]) => <Opt key={k} id={'fmt-' + k} group="format" on={o.format === k} onClick={() => set({ format: k })} title={f.label} sub={f.sub} art={<Frame a={f.aspect} />} />)}</div>
    <div className="pk-row" role="radiogroup" aria-label="Length"><span className="pk-l">Length</span>
      {['short', 'medium', 'long'].map(k => <Opt key={k} id={'len-' + k} group="length" on={o.length === k && !o.seconds} onClick={() => set({ length: k, seconds: null })} title={cap1(k)} sub={F[o.format].lengths[k]} />)}</div>
    <div className="pk-row" role="radiogroup" aria-label="Output"><span className="pk-l">Output</span>
      <Opt id="out-full" group="kind" on={o.kind === 'full'} onClick={() => set({ kind: 'full' })} title="Full edit" sub={o.split ? 'Split into parts' : 'One best version'} art={<Icon n="film" />} />
      <Opt id="out-clips" group="kind" on={o.kind === 'clips'} onClick={() => set({ kind: 'clips' })} title="Clips" sub={`${o.clips} short clips`} art={<Icon n="grid" />} />
      <Opt id="out-both" group="kind" on={o.kind === 'both'} onClick={() => set({ kind: 'both' })} title="Both" sub={`Full edit + ${o.clips} clips`} art={<Icon n="spark" />} /></div>
    <div className="pk-sub">
      {o.kind === 'full' && <label className="tick"><input type="checkbox" id="out-split" checked={!!o.split} onChange={e => set({ split: e.target.checked })} />Split into parts of ~{F[o.format].lengths[o.length]}</label>}
      {o.kind !== 'full' && <span className="stepper-n"><span className="fine">Clips</span><IconBtn n="minus" label="Fewer clips" onClick={() => set({ clips: Math.max(1, o.clips - 1) })} /><b id="clip-count">{o.clips}</b><IconBtn n="plus" label="More clips" onClick={() => set({ clips: Math.min(20, o.clips + 1) })} /></span>}
    </div>
    <div className="pk-row" role="radiogroup" aria-label="Goal"><span className="pk-l">Goal</span>
      <Opt id="goal-organic" group="goal" on={o.goal === 'organic'} onClick={() => set({ goal: 'organic' })} title="Organic" sub="Story pacing, loops" />
      <Opt id="goal-ad" group="goal" on={o.goal === 'ad'} onClick={() => set({ goal: 'ad' })} title="Ad" sub="Hook fast, end on a CTA" /></div>
    {o.goal === 'ad' && <div className="pk-sub"><label className="tick"><input type="checkbox" id="ad-cuts" checked={!!o.adCuts} onChange={e => set({ adCuts: e.target.checked })} />Also make 15 s and 30 s ad cuts</label>
      <label className="inl"><span className="fine">End card</span><input id="cta-text" defaultValue={o.cta || 'Learn more'} maxLength={60} onBlur={e => set({ cta: e.target.value.trim() || null })} /></label></div>}
    <details className="pk-more" open={more} onToggle={e => setMore(e.currentTarget.open)}><summary>More</summary>
      <div className="pk-grid">
        <label><span className="fine">Aspect</span><select id="more-aspect" value={o.aspect || ''} onChange={e => set({ aspect: e.target.value || null })}><option value="">From the format ({F[o.format].aspect})</option>{['9:16', '16:9', '1:1', '4:5'].map(a => <option key={a}>{a}</option>)}</select></label>
        <label><span className="fine">Exact length (s)</span><input id="more-seconds" type="number" min={5} max={7200} defaultValue={o.seconds || ''} onBlur={e => num('seconds', e.target.value)} /></label>
        <label><span className="fine">Clip length (s)</span><input id="more-clip" type="number" min={5} max={600} defaultValue={o.clipSeconds || ''} onBlur={e => num('clipSeconds', e.target.value)} /></label>
        <label><span className="fine">Max (s)</span><input id="more-max" type="number" min={5} max={7200} defaultValue={o.max || ''} onBlur={e => num('max', e.target.value)} /></label>
        {o.kind === 'both' && <label><span className="fine">Clip length</span><select id="more-cliplen" value={o.clipLength} onChange={e => set({ clipLength: e.target.value })}>{['short', 'medium', 'long'].map(k => <option key={k} value={k}>{cap1(k)} ({F[o.format === 'square' ? 'square' : 'short'].lengths[k]})</option>)}</select></label>}
      </div></details>
  </div>;
}

// the take's timeline: waveform, clean-up marks, playhead, one lane per kind with draggable regions
function Timeline({ cut, peaks, marks, now, dur, sel, setSel, onSeek, onEdit, onAdd }) {
  const [debug, setDebug] = useState(false);
  const kinds = [...new Set(cut.candidates.map(c => c.kind))];
  const lanes = kinds.length ? kinds : ['clip'];
  const pct = t => (dur ? (t / dur) * 100 : 0) + '%';
  const [drag, setDrag] = useState(null); // { id, k (range index), edge: a|b, ranges } or { lane, from, to } for a new one
  const at = (e, el) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)); };
  const startEdge = (e, c, k, edge) => { e.stopPropagation(); e.preventDefault(); e.currentTarget.closest('.lane-track').setPointerCapture(e.pointerId); setSel(c.id); setDrag({ id: c.id, k, edge, ranges: c.ranges.map(r => r.slice()) }); };
  const move = e => {
    if (!drag) return; const t = at(e, e.currentTarget);
    if (drag.id) { const r = drag.ranges.map(x => x.slice()), x = r[drag.k]; if (drag.edge === 'a') x[0] = Math.min(t, x[1] - 0.5); else x[1] = Math.max(t, x[0] + 0.5); setDrag({ ...drag, ranges: r }); onSeek(drag.edge === 'a' ? x[0] : x[1]); }
    else setDrag({ ...drag, to: t });
  };
  const up = () => {
    if (!drag) return;
    if (drag.id) onEdit(drag.id, { ranges: drag.ranges.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]) });
    else { const a = Math.min(drag.from, drag.to), b = Math.max(drag.from, drag.to); if (b - a >= 1) onAdd([[a, b]], drag.lane); else onSeek(drag.from); }
    setDrag(null);
  };
  return <div className="timeline glass-card" id="cut-timeline">
    <div className="tl-ruler mono" aria-hidden="true">{[0, 0.25, 0.5, 0.75, 1].map(f => <span key={f} style={{ left: f * 100 + '%' }}>{clock(f * dur)}</span>)}</div>
    <div className="tl-wave" onPointerDown={e => onSeek(at(e, e.currentTarget))}>
      <Wave peaks={peaks} height={52} />
      {marks.map((m, i) => <i key={i} className={'mk ' + m.type} style={{ left: pct(m.from), width: `max(2px, ${pct(m.to - m.from)})` }} title={m.type === 'filler' ? `"${m.text}" at ${clock(m.from)}` : `${(m.to - m.from).toFixed(1)} s pause at ${clock(m.from)}`} />)}
      <i className="playhead" style={{ left: pct(now) }} aria-hidden="true" />
    </div>
    {lanes.map(k => <div key={k} className={'lane k-' + k} data-lane={k}>
      <span className="lane-l">{KIND[k]}</span>
      <div className="lane-track" onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
        onPointerDown={e => { if (e.target.closest('[data-region]')) return; e.currentTarget.setPointerCapture(e.pointerId); const t = at(e, e.currentTarget); setDrag({ lane: k, from: t, to: t }); }}>
        {cut.candidates.filter(c => c.kind === k).map(c => (drag && drag.id === c.id ? drag.ranges : c.ranges).map((r, ri) =>
          <div key={c.id + ri} data-region={c.id} className={'region' + (c.keep ? '' : ' off') + (sel === c.id ? ' sel' : '')} style={{ left: pct(r[0]), width: pct(r[1] - r[0]) }}
            title={`${c.label}: ${clock(r[0])} to ${clock(r[1])}`} onClick={() => { setSel(c.id); onSeek(r[0], true, c); }}>
            <i className="edge a" onPointerDown={e => startEdge(e, c, ri, 'a')} aria-label={`Trim the start of ${c.label}`} />
            {ri === 0 && <span className="rg-l">{c.label}</span>}
            {debug && (c.cuts || []).filter(p => p.part === ri).map(p => <i key={p.edge} className={'cp-tx ' + p.edge} aria-hidden="true"
              style={{ left: `${((p.transcript - r[0]) / Math.max(0.01, r[1] - r[0])) * 100}%` }} title={`${p.edge}: transcript ${secs(p.transcript)}, cut ${secs(p.cut)}`} />)}
            <i className="edge b" onPointerDown={e => startEdge(e, c, ri, 'b')} aria-label={`Trim the end of ${c.label}`} />
          </div>))}
        {drag && !drag.id && drag.lane === k && Math.abs(drag.to - drag.from) > 0.2 && <div className="region new" style={{ left: pct(Math.min(drag.from, drag.to)), width: pct(Math.abs(drag.to - drag.from)) }} />}
        <i className="playhead" style={{ left: pct(now) }} aria-hidden="true" />
      </div>
    </div>)}
    <div className="tl-dbg"><label className="tick"><input type="checkbox" id="cut-debug" checked={debug} onChange={e => setDebug(e.target.checked)} />Show cut points</label>
      <span className="fine">Every edge sits in the quiet next to its words{cut.candidates.some(c => c.snapped) ? '' : ' (we have not read the audio yet)'}.</span></div>
    {debug && <CutPoints c={cut.candidates.find(c => c.id === sel) || cut.candidates[0]} onSeek={onSeek} />}
    <p className="fine tl-help">Drag a clip's edge to trim it. Drag on an empty part of a row to add your own. Red ticks are filler words, grey bands are long pauses.</p>
  </div>;
}

const secs = t => (t == null ? '' : (+t).toFixed(2) + ' s');
// where each cut landed and why: the transcript time, the audio dip, the cut, and the shift between them
function CutPoints({ c, onSeek }) {
  if (!c) return null;
  if (!c.cuts || !c.cuts.length) return <p className="fine" id="cut-points">{c.label}: no cut points on the audio (we have not read the audio, or this stretch has no words).</p>;
  return <div className="cut-points" id="cut-points"><b>{c.label}</b>
    <table><thead><tr><th>Edge</th><th>Word</th><th>Transcript</th><th>Audio</th><th>Cut</th><th>Shift</th><th>Why</th></tr></thead>
      <tbody>{c.cuts.map((p, i) => <tr key={i} data-edge={p.edge}>
        <td>{c.ranges.length > 1 ? `${cap1(p.edge)} ${p.part + 1}` : cap1(p.edge)}</td><td>"{p.word}"</td>
        <td className="mono">{secs(p.transcript)}</td><td className="mono">{secs(p.audio)}</td>
        <td className="mono"><button type="button" className="linkish" onClick={() => onSeek(Math.max(0, p.cut - (p.edge === 'end' ? 1.5 : 0)), false)} aria-label={`Seek near the ${p.edge} cut`}>{secs(p.cut)}</button></td>
        <td className="mono">{p.shift > 0 ? '+' : ''}{(+p.shift).toFixed(2)}</td><td>{p.by}</td></tr>)}</tbody></table></div>;
}

// "What's the point of this video?" One optional line, saved with the project. It steers which lines and clips we
// pick, and it goes to your agent with every ask. Also on Start when Copy the look is picked (the same value)
export const POINT_EXAMPLE = 'Show beginners they can build an app with AI in a weekend';
export function PointField({ s, apply, id = 'point', compact }) {
  const [v, setV] = useState(s.point || ''), saved = useRef(s.point || '');
  useEffect(() => { if ((s.point || '') !== saved.current) { saved.current = s.point || ''; setV(s.point || ''); } }, [s.point]);
  const save = () => { const t = v.replace(/\s+/g, ' ').trim(); if (t === saved.current) return; saved.current = t; api('/api/state', { point: t }).then(apply).catch(() => {}); };
  return <div className={'point glass-card' + (compact ? ' compact' : '')} id={id + '-box'}>
    <label className="point-l" htmlFor={id}>What's the point of this video?</label>
    <input id={id} className="point-i" value={v} maxLength={200} placeholder={POINT_EXAMPLE} autoComplete="off" onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    {!s.point && <span className="fine point-h" id={id + '-hint'}>Optional. One line helps us pick the right lines and clips.</span>}
  </div>;
}

const LAYERS = [
  ['raw', 'Raw take', 'Your take in full, just as you filmed it. Play it, or click a word to jump there.'],
  ['lines', 'Best lines', 'Every line of the take, sorted by what it does. The ones marked Best are the lines we recommend. Play any of them.'],
  ['clips', 'Clips', 'Our best lines stitched into clips, with the quiet trimmed. Play each one as it will sound, and tick the ones to keep.'],
];
const KIND_ONE = { full: 'Full edit', part: 'Part', clip: 'Short clip', ad: 'Ad cut' };
const secsOf = x => (x < 60 ? `${Math.round(x)} s` : clock(x));

// one clip: a tick to keep it, what it is made of, why, and Play for the stitched result
function ClipRow({ c, pv, n, playing, onPlay, onKeep, onRemove, muted, sel, onSel, rendered }) {
  const secs = pv ? pv.seconds : c.seconds, saved = pv ? pv.saved : 0;
  return <li className={'clip-row k-' + (c.kind || 'clip') + (c.keep ? '' : ' off') + (muted ? ' muted' : '') + (sel ? ' sel' : '')} data-id={c.id} data-keep={c.keep ? '1' : '0'} onClick={onSel}>
    {onKeep ? <input type="checkbox" className="clip-keep" id={'keep-' + c.id} checked={!!c.keep} aria-label={`Keep ${c.label}`} onChange={e => onKeep(e.target.checked)} onClick={e => e.stopPropagation()} />
      : <span className="clip-keep fixed" aria-hidden="true"><Icon n="check" /></span>}
    <div className="clip-main">
      <div className="clip-h"><label htmlFor={onKeep ? 'keep-' + c.id : undefined}><b>{c.label}</b></label>
        <span className="fine clip-m">{[n ? `${n} line${n === 1 ? '' : 's'} stitched` : null, secsOf(secs), saved >= 0.2 ? `${saved.toFixed(1)} s of quiet out` : null].filter(Boolean).join(', ')}</span>
        {c.fits && <span className="pz-fits">{FITS}</span>}{c.trimmed && <Badge label="Trimmed by you" variant="neutral" />}{c.byName && <Badge label={`By ${c.byName}`} variant="cyan" />}</div>
      {c.reason && <p className="clip-why">{c.reason}</p>}
      {c.text && <p className="clip-tx">"{c.text}"</p>}
      {rendered && <a className="cd-out" href={file(rendered)} target="_blank" rel="noreferrer"><Icon n="film" />{rendered.split('/').slice(-2).join('/')}</a>}
    </div>
    <div className="clip-a" onClick={e => e.stopPropagation()}>
      <Button size="sm" variant="secondary" className="cc-play" label={playing ? 'Stop' : 'Play'} icon={<Icon n={playing ? 'pause' : 'play'} />} aria-label={`${playing ? 'Stop' : 'Play'} ${c.label} stitched`} onClick={onPlay} />
      {onRemove && <IconBtn n="trash" label={'Remove ' + c.label} onClick={onRemove} />}
    </div>
  </li>;
}

export function Cut({ V, s, apply, go }) {
  const cut = V.cut || { candidates: [] }, t = V.task;
  const src = cut.source, tx = src ? (s.tx || {})[src] || cut.tx : null;
  const { peaks } = useMedia(src);
  const tr = useTranscript(src, tx);
  const player = useRef(null), [now, setNow] = useState(0), [sel, setSel] = useState(null);
  const [layer, setLayerRaw] = useState(() => { const v = localStorage.getItem('studio.cutLayer'); return LAYERS.some(l => l[0] === v) ? v : 'raw'; });
  const stitch = useStitch(player);
  const setLayer = l => { localStorage.setItem('studio.cutLayer', l); stitch.stop(); setLayerRaw(l); };
  const [pickOpen, setPickOpen] = useState(false), [pv, setPv] = useState(null), [tlOpen, setTlOpen] = useState(false);
  const P = V.pieces, combo = P ? P.combo : { ids: [] }, bites = (((s.lines || {})[src] || {}).bites) || [];
  useEffect(() => { const id = setInterval(() => { if (player.current) setNow(player.current.now()); }, 200); return () => clearInterval(id); }, []);
  // the stitched previews: which stretches of the take each clip plays, with the quiet the Pacing choice takes out
  const sig = JSON.stringify([src, cut.candidates.map(c => [c.id, c.ranges]), combo.ids, bites.map(b => [b.id, b.lines]), cut.pacing, !!P]);
  useEffect(() => { if (!src) return; let on = true; fetch('/api/cut/preview?path=' + encodeURIComponent(src)).then(r => (r.ok ? r.json() : null)).then(j => { if (on && j && j.clips) setPv(j); }).catch(() => {}); return () => { on = false; }; }, [sig]);
  const spans = id => (pv && pv.clips[id] ? pv.clips[id].spans : null);
  const set = p => api('/api/cut/output', { ...p, source: src }).then(apply).catch(() => {});
  const edit = (id, b) => api('/api/cut/edit', { id, ...b }).then(apply).catch(() => {});
  const add = (ranges, kind = 'clip') => api('/api/cut/edit', { add: { ranges, kind } }).then(j => { apply(j); toast('Added to Clips', true); }).catch(() => {});
  const seek = (x, playIt, c) => { if (!player.current) return; stitch.stop(); if (playIt && c) player.current.play(c.ranges[0][0], c.ranges[0][1]); else player.current.seek(x); setNow(x); };
  const find = scorer => api('/api/cut/find', { path: src, ...(scorer ? { scorer } : {}) }).then(apply).catch(() => {});
  // Clips opens with our suggestions already there: once the words are read, the rules find them (no model, no agent)
  const asked = useRef({});
  useEffect(() => { if (layer === 'clips' && src && P && !cut.candidates.length && !cut.pending && !asked.current[src]) { asked.current[src] = 1; find('rules'); } }, [layer, src, !!P, cut.candidates.length, cut.pending]);
  const dur = cut.seconds || (tr && tr.duration) || 0;
  const scored = cut.pending === 'agent' ? 'Your agent is picking. These are our picks until it answers.' : cut.pending === 'model' ? 'A model is scoring them.' : cut.pending === 'transcript' ? null
    : cut.scoredBy && cut.scoredBy !== 'rules' ? `Picked by ${cut.scoredBy}` : null;
  const renderedFor = c => (c.outputs || [])[0];
  if (!s.footage.length) return <section className="step" id="s-cut" data-step="cut" aria-labelledby="h-cut">
    <header className="sh"><h2 id="h-cut">Cut</h2><p className="sub">From your raw take, to the best lines, to the clips that move on.</p></header>
    <div className="empty-art"><Icon n="film" /><p>Add footage first.</p><Button variant="secondary" label="Go to Start" onClick={() => go('start', true)} /></div></section>;
  const own = combo.ids.length ? { id: 'own', kind: 'own', label: 'Your clip', keep: !combo.off, seconds: combo.seconds, reason: 'The lines you picked on Best lines, in your order.', text: (() => { const by = Object.fromEntries(P.pieces.map(p => [p.id, p])), x = combo.ids.map(id => by[id] && by[id].text).filter(Boolean).join(' '); return x.length > 160 ? x.slice(0, 157).replace(/\s+\S*$/, '') + '...' : x; })() } : null;
  const ownOn = !!(own && own.keep);
  const linesIn = ranges => (P ? P.pieces.filter(p => ranges.some(([a, b]) => (p.start + p.end) / 2 >= a && (p.start + p.end) / 2 <= b)).length : 0);
  const keptCands = cut.candidates.filter(c => c.keep), movingN = ownOn ? 1 : keptCands.length + bites.length;
  const movingS = ownOn ? ((pv && pv.clips.own) || own).seconds : [...keptCands, ...bites].reduce((a, c) => a + (pv && pv.clips[c.id] ? pv.clips[c.id].seconds : c.seconds || 0), 0);
  const count = { raw: dur ? clock(dur) : '', lines: P ? String(P.pieces.filter(p => !['aside', 'retake'].includes(p.category)).length) : '', clips: cut.candidates.length + bites.length + (own ? 1 : 0) || '' };
  const marks = (tr && tr.marks) || [], pauses = marks.filter(m => m.type === 'silence'), fillers = marks.filter(m => m.type === 'filler').length;
  const pace = (cut.pacings || []).find(x => x.id === cut.pacing);
  return <section className="step" id="s-cut" data-step="cut" aria-labelledby="h-cut">
    <header className="sh"><h2 id="h-cut">Cut</h2><p className="sub">From your raw take, to the best lines, to the clips that move on. Our picks are a smart start, so you can just hit Next.</p></header>
    <PointField s={s} apply={apply} />
    <div className="cut-sum glass-card" id="cut-summary-box">
      <span className="lbl cs-l">What to make</span><p id="cut-summary" className="cs-t">{cut.summary}</p>
      {cut.output && cut.output.auto ? <Badge label={`Smart pick for a ${clock(cut.seconds)} take`} variant="cyan" /> : <Button id="cut-reset" size="sm" variant="ghost" label="Smart pick" onClick={() => api('/api/cut/output', { reset: true }).then(apply)} />}
      <Button id="cut-change" size="sm" variant="ghost" label={pickOpen ? 'Done' : 'Change'} aria-expanded={pickOpen ? 'true' : 'false'} onClick={() => setPickOpen(!pickOpen)} />
      {cut.footage && cut.footage.length > 1 && <label className="inl"><span className="fine">Take</span><select id="cut-source" value={src || ''} onChange={e => set({ source: e.target.value })}>{cut.footage.map(f => <option key={f.path} value={f.path}>{f.path.split('/').pop()} ({clock(f.seconds)})</option>)}</select></label>}
    </div>
    {pickOpen && <Picker cut={cut} set={set} key={src} />}
    <div className="cut-layers" role="tablist" aria-label="The three layers of the Cut step" id="cut-layers">
      {LAYERS.map(([id, label], k) => <button key={id} type="button" role="tab" id={'cut-layer-' + id} aria-selected={layer === id ? 'true' : 'false'} aria-controls="cut-body" className="cut-layer" onClick={() => setLayer(id)}>
        <span className="cl-n" aria-hidden="true">{k + 1}</span><span className="cl-t">{label}</span>{count[id] !== '' && <span className="cl-c mono">{count[id]}</span>}</button>)}
    </div>
    <p className="cut-explain" id="cut-explain">{LAYERS.find(l => l[0] === layer)[2]}</p>
    {tx && tx.status === 'running' && <div className="tx-run" id="cut-tx"><ProgressBar label="Reading the words of your take" value={tx.total ? Math.round(100 * tx.done / tx.total) : undefined} isIndeterminate={!tx.total} />
      <span className="fine">Reading the words{tx.total ? `, part ${Math.min(tx.done + 1, tx.total)} of ${tx.total}` : ''}. Lines and clips show up when it is done. Safe to leave this page.</span></div>}
    {tx && tx.status === 'failed' && <p className="err" role="alert">{tx.error}</p>}
    {tx && tx.status === 'failed' && tx.fix && <FixActions V={V} id={tx.fix} apply={apply} />}
    <div className={'cut-body v-' + layer} id="cut-body" role="tabpanel" aria-labelledby={'cut-layer-' + layer} data-layer={layer}>
      <div className="cut-play">{src && <Player apply={apply} path={src} tx={tx} playerRef={player} onAddRange={r => add(r, 'clip')} />}</div>
      <div className="cut-side">
        {layer === 'raw' && <div className="raw-facts glass-card" id="cut-raw">
          <span><b>{dur ? clock(dur) : '...'}</b> long</span>
          {P && <span><b>{P.pieces.length}</b> line{P.pieces.length === 1 ? '' : 's'}</span>}
          {tr && <span><b>{pauses.length}</b> long pause{pauses.length === 1 ? '' : 's'}{pauses.length ? ` (${pauses.reduce((a, m) => a + m.to - m.from, 0).toFixed(1)} s)` : ''}</span>}
          {tr && fillers > 0 && <span><b>{fillers}</b> filler word{fillers === 1 ? '' : 's'}</span>}
          <Button id="cut-to-lines" size="sm" variant="secondary" label="See the best lines" onClick={() => setLayer('lines')} />
        </div>}
        {layer === 'lines' && <Pieces V={V} apply={apply} player={player} src={src} stitch={stitch} spans={spans('own')} onClips={() => setLayer('clips')} />}
        {layer === 'clips' && <div className="cut-clips" id="cut-clips">
          <div className="cut-clips-bar glass-card">
            <div className="pacing" id="pacing" data-pacing={cut.pacing || 'natural'}><span className="lbl" id="pacing-l">Pacing</span>
              <SegmentedControl label="Pacing" value={cut.pacing || 'natural'} size="sm" onChange={v => { stitch.stop(); api('/api/state', { pace: { tighten: v === 'natural' ? 'off' : v === 'tight' ? 0.45 : 0.25 } }).then(apply).catch(() => {}); }}>
                {(cut.pacings || []).map(x => <SegmentedControlItem key={x.id} value={x.id} label={x.label} />)}</SegmentedControl>
              <span className="fine" id="pacing-says">{pace ? pace.says : ''} We only trim quiet between words, never a word.</span></div>
            <Button id="cut-find" size="sm" variant={cut.candidates.length ? 'ghost' : 'primary'} label={cut.candidates.length ? 'Find clips again' : 'Find the clips'} isLoading={!!(tx && tx.status === 'running')} onClick={() => find()} />
          </div>
          {scored && <p className="fine" id="cut-scored">{scored}</p>}
          {cut.note && <p className="fine" id="cut-note">{cut.note}</p>}
          {own || cut.candidates.length || bites.length ? <ol className="clip-list" id="cut-candidates" aria-label="Clips">
            {own && <ClipRow c={own} pv={pv && pv.clips.own} n={combo.ids.length} playing={stitch.playing === 'own'} onPlay={() => stitch.play('own', spans('own'))} onKeep={on => api('/api/pieces', { path: src, off: !on }).then(apply).catch(() => {})} />}
            {ownOn && (cut.candidates.length > 0 || bites.length > 0) && <li className="clip-note fine" id="cut-own-wins">Your own clip is what moves on. Untick it to use the clips below instead.</li>}
            {cut.candidates.map(c => <ClipRow key={c.id} c={{ ...c, label: c.kind === 'full' && (!c.label || c.label === 'Best version') ? 'Full edit' : c.label || KIND_ONE[c.kind] }} pv={pv && pv.clips[c.id]} n={linesIn(c.ranges)} muted={ownOn} sel={sel === c.id} onSel={() => setSel(c.id)} playing={stitch.playing === c.id} rendered={renderedFor(c)}
              onPlay={() => { setSel(c.id); stitch.play(c.id, spans(c.id) || c.ranges); }} onKeep={on => edit(c.id, { keep: on })} onRemove={c.by === 'you' ? () => edit(c.id, { remove: true }) : null} />)}
            {bites.map(b => <ClipRow key={b.id} c={{ id: b.id, kind: 'clip', label: b.name || 'Clip', keep: true, seconds: pv && pv.clips[b.id] ? pv.clips[b.id].seconds : 0, reason: b.reason || null, byName: b.by && b.by !== 'you' ? b.by : null }} pv={pv && pv.clips[b.id]} n={b.lines.length} muted={ownOn}
              playing={stitch.playing === b.id} onPlay={() => stitch.play(b.id, spans(b.id))} onRemove={() => api('/api/lines', { path: src, action: 'remove', id: b.id }).then(apply).catch(() => {})} />)}
          </ol> : <div className="empty-art"><Icon n="grid" /><p>{tx && tx.status === 'running' ? 'Clips show up here once we have read the words.' : cut.pending === 'transcript' ? 'Reading the words, then finding the clips.' : 'Find the clips to see our suggestions, each with its length and why.'}</p></div>}
          {(own || cut.candidates.length > 0 || bites.length > 0) && <p className="clips-kept" id="cut-hint" data-kept={movingN}><Icon n="check" /><span id="cut-kept">{movingN ? `${movingN} clip${movingN === 1 ? '' : 's'} kept, ${secsOf(movingS)}. ${movingN === 1 ? 'It moves' : 'They move'} on to the next steps as one reel.` : 'No clip is kept, so the whole take moves on.'}</span></p>}
          {src && dur > 0 && cut.candidates.length > 0 && <details className="clips-tl" id="cut-trim" open={tlOpen} onToggle={e => setTlOpen(e.currentTarget.open)}><summary>Trim on the timeline</summary>
            {tlOpen && <Timeline cut={cut} peaks={peaks} marks={marks} now={now} dur={dur} sel={sel} setSel={setSel} onSeek={seek} onEdit={edit} onAdd={add} />}</details>}
        </div>}
      </div>
    </div>
  </section>;
}
