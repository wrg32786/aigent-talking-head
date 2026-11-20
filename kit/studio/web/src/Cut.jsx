// The Cut step: what to make from the take (format, length, output, goal, with smart defaults), then the candidates
// on the take's timeline to keep, drop, trim, reorder or add to. Nothing renders here: the kept cuts and bites render
// on the Render step, the one place that makes videos.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { api, file, toast, cap1, fmtS, Icon, IconBtn } from './lib.jsx';
import { Lines } from './Lines.jsx';
import { FixActions } from './Fix.jsx';
import { Player, useMedia, useTranscript, Wave, clock } from './Player.jsx';

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
      <Opt id="out-clips" group="kind" on={o.kind === 'clips'} onClick={() => set({ kind: 'clips' })} title="Clips" sub={`${o.clips} highlights`} art={<Icon n="grid" />} />
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
      <span className="fine">Each cut snaps to the quiet in the audio next to its words{cut.candidates.some(c => c.snapped) ? '' : ' (no audio envelope yet)'}.</span></div>
    {debug && <CutPoints c={cut.candidates.find(c => c.id === sel) || cut.candidates[0]} onSeek={onSeek} />}
    <p className="fine tl-help">Drag a region's edge to trim it. Drag on an empty part of a lane to add your own. Red ticks are filler words, grey bands are long pauses.</p>
  </div>;
}

const secs = t => (t == null ? '' : (+t).toFixed(2) + ' s');
// where each cut landed and why: the transcript time, the audio dip, the cut, and the shift between them
function CutPoints({ c, onSeek }) {
  if (!c) return null;
  if (!c.cuts || !c.cuts.length) return <p className="fine" id="cut-points">{c.label}: no cut points on the audio (no envelope, or the range has no words).</p>;
  return <div className="cut-points" id="cut-points"><b>{c.label}</b>
    <table><thead><tr><th>Edge</th><th>Word</th><th>Transcript</th><th>Audio</th><th>Cut</th><th>Shift</th><th>Why</th></tr></thead>
      <tbody>{c.cuts.map((p, i) => <tr key={i} data-edge={p.edge}>
        <td>{c.ranges.length > 1 ? `${cap1(p.edge)} ${p.part + 1}` : cap1(p.edge)}</td><td>"{p.word}"</td>
        <td className="mono">{secs(p.transcript)}</td><td className="mono">{secs(p.audio)}</td>
        <td className="mono"><button type="button" className="linkish" onClick={() => onSeek(Math.max(0, p.cut - (p.edge === 'end' ? 1.5 : 0)), false)} aria-label={`Seek near the ${p.edge} cut`}>{secs(p.cut)}</button></td>
        <td className="mono">{p.shift > 0 ? '+' : ''}{(+p.shift).toFixed(2)}</td><td>{p.by}</td></tr>)}</tbody></table></div>;
}

function Candidate({ c, sel, setSel, onEdit, onPreview, first, last, rendered }) {
  const span = c.ranges.length > 1 ? `${c.ranges.length} parts from ${clock(c.ranges[0][0])} to ${clock(c.ranges[c.ranges.length - 1][1])}` : `${clock(c.ranges[0][0])} to ${clock(c.ranges[0][1])}`;
  return <li className={'cand k-' + c.kind + (c.keep ? '' : ' off') + (sel ? ' sel' : '')} data-id={c.id} onClick={() => setSel(c.id)}>
    <span className="cd-dot" aria-hidden="true" />
    <div className="cd-main">
      <div className="cd-h"><b>{c.label}</b><span className="mono fine">{span}, {fmtS(c.seconds * 1000)}</span>{c.score != null && <span className="score" title="Score out of 100">{c.score}</span>}{c.trimmed && <Badge label="Trimmed" variant="neutral" />}{c.snapped && <span className="fine snap-b" title="Cut points snapped to the audio">on the audio</span>}</div>
      <p className="cd-why">{c.reason}</p>
      <p className="cd-tx">"{c.text}"</p>
      {rendered && <a className="cd-out" href={file(rendered)} target="_blank" rel="noreferrer"><Icon n="film" />{rendered.split('/').slice(-2).join('/')}</a>}
    </div>
    <div className="cd-a" onClick={e => e.stopPropagation()}>
      <IconBtn n="play" label={'Preview ' + c.label} onClick={() => onPreview(c)} />
      <button type="button" className={'chip sm keep' + (c.keep ? ' on' : '')} aria-pressed={String(!!c.keep)} onClick={() => onEdit(c.id, { keep: !c.keep })}>{c.keep ? <><Icon n="check" />Keep</> : 'Dropped'}</button>
      <IconBtn n="left" className="up" label={'Move ' + c.label + ' up'} disabled={first} onClick={() => onEdit(c.id, { move: -1 })} />
      <IconBtn n="right" className="down" label={'Move ' + c.label + ' down'} disabled={last} onClick={() => onEdit(c.id, { move: 1 })} />
      {c.by === 'you' && <IconBtn n="trash" label={'Remove ' + c.label} onClick={() => onEdit(c.id, { remove: true })} />}
    </div>
  </li>;
}

export function Cut({ V, s, apply, go }) {
  const cut = V.cut || { candidates: [] }, t = V.task, running = t && t.status === 'running';
  const src = cut.source, tx = src ? (s.tx || {})[src] || cut.tx : null;
  const { peaks } = useMedia(src);
  const tr = useTranscript(src, tx);
  const player = useRef(null), [now, setNow] = useState(0), [sel, setSel] = useState(null);
  useEffect(() => { const id = setInterval(() => { if (player.current) setNow(player.current.now()); }, 200); return () => clearInterval(id); }, []);
  const set = p => api('/api/cut/output', { ...p, source: src }).then(apply).catch(() => {});
  const edit = (id, b) => api('/api/cut/edit', { id, ...b }).then(apply).catch(() => {});
  const add = (ranges, kind = 'clip') => api('/api/cut/edit', { add: { ranges, kind } }).then(j => { apply(j); toast('Added your clip', true); }).catch(() => {});
  const seek = (x, playIt, c) => { if (!player.current) return; if (playIt && c) player.current.play(c.ranges[0][0], c.ranges[0][1]); else player.current.seek(x); setNow(x); };
  const preview = c => { setSel(c.id); player.current && player.current.play(c.ranges[0][0], c.ranges[c.ranges.length - 1][1]); };
  const find = () => api('/api/cut/find', { path: src }).then(apply).catch(() => {});
  const kept = cut.candidates.filter(c => c.keep), dur = cut.seconds || (tr && tr.duration) || 0;
  const scored = cut.pending === 'agent' ? 'Your agent is picking. These are the rules picks until it answers.' : cut.pending === 'model' ? 'A model is scoring them.' : cut.pending === 'transcript' ? null
    : cut.scoredBy ? (cut.scoredBy === 'rules' ? 'Scored by the rules (connect your agent or a model to score with AI)' : `Scored by ${cut.scoredBy}`) : null;
  const renderedFor = c => (c.outputs || [])[0];
  if (!s.footage.length) return <section className="step" id="s-cut" data-step="cut" aria-labelledby="h-cut">
    <header className="sh"><h2 id="h-cut">Cut</h2><p className="sub">What to make from your take.</p></header>
    <div className="empty-art"><Icon n="film" /><p>Add footage first.</p><Button variant="secondary" label="Go to Footage" onClick={() => go('footage', true)} /></div></section>;
  return <section className="step" id="s-cut" data-step="cut" aria-labelledby="h-cut">
    <header className="sh"><h2 id="h-cut">Cut</h2><p className="sub">What to make from your take. The picks below are a smart start, so you can just hit Next.</p></header>
    <div className="cut-sum glass-card" id="cut-summary-box">
      <Icon n="spark" className="cs-i" /><p id="cut-summary" className="cs-t">{cut.summary}</p>
      {cut.output && cut.output.auto ? <Badge label={`Smart pick for a ${clock(cut.seconds)} take`} variant="cyan" /> : <Button id="cut-reset" size="sm" variant="ghost" label="Smart pick" onClick={() => api('/api/cut/output', { reset: true }).then(apply)} />}
      {cut.footage && cut.footage.length > 1 && <label className="inl"><span className="fine">Take</span><select id="cut-source" value={src || ''} onChange={e => set({ source: e.target.value })}>{cut.footage.map(f => <option key={f.path} value={f.path}>{f.path.split('/').pop()} ({clock(f.seconds)})</option>)}</select></label>}
    </div>
    <Picker cut={cut} set={set} key={src} />
    <div className="runbar glass-card">
      <Button id="cut-find" size="lg" variant={cut.candidates.length ? 'secondary' : 'primary'} label={cut.candidates.length ? 'Find again' : 'Find cuts'} isLoading={tx && tx.status === 'running'} onClick={find} />
      <span className="fine" id="cut-scored">{scored}</span>
      {kept.length > 0 && <span className="fine" id="cut-hint">{`${kept.length} kept. ${kept.length > 1 ? 'They render' : 'It renders'} at the end, on the Render step.`}</span>}
    </div>
    {tx && tx.status === 'running' && <div className="tx-run" id="cut-tx"><ProgressBar label="Transcribing the take" value={tx.total ? Math.round(100 * tx.done / tx.total) : undefined} isIndeterminate={!tx.total} />
      <span className="fine">Transcribing{tx.total ? ` part ${Math.min(tx.done + 1, tx.total)} of ${tx.total}` : ''}, then finding cuts. Safe to leave this page.</span></div>}
    {tx && tx.status === 'failed' && <p className="err" role="alert">{tx.error}</p>}
    {tx && tx.status === 'failed' && tx.fix && <FixActions V={V} id={tx.fix} apply={apply} />}
    <div className="cut-grid">
      <div className="cut-play">{src && <Player path={src} tx={tx} playerRef={player} onAddRange={r => add(r, 'clip')} />}</div>
      <div className="cut-list">
        {cut.candidates.length ? <ol className="cands" id="cut-candidates" aria-label="Cuts">{cut.candidates.map((c, i) => <Candidate key={c.id} c={c} sel={sel === c.id} setSel={setSel} onEdit={edit} onPreview={preview} first={i === 0} last={i === cut.candidates.length - 1} rendered={renderedFor(c)} />)}</ol>
          : <div className="empty-art"><Icon n="grid" /><p>{tx && tx.status === 'running' ? 'Cuts show up here when the transcript is done.' : 'Find cuts to see the candidates, with their times, score and why.'}</p></div>}
      </div>
    </div>
    {src && <Lines s={s} src={src} player={player} apply={apply} t={t} backend={V.env && V.env.backend} open={dur >= 180} key={'lines-' + src} />}
    {src && dur > 0 && (cut.candidates.length > 0 || tr) && <Timeline cut={cut} peaks={peaks} marks={(tr && tr.marks) || []} now={now} dur={dur} sel={sel} setSel={setSel} onSeek={seek} onEdit={edit} onAdd={add} />}
  </section>;
}
