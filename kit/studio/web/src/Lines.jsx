// The Lines view on the Cut step: a long take as its lines (text, length, play, keep or retake), grouped into named
// bites you can reorder and play, plus one clean take of the whole thing. Bites render on the Render step (Render.jsx),
// the one place that makes videos. Your agent can do the picking (get_lines and set_bites over MCP) and its bites show
// here as picked by it.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { api, file, toast, Icon, IconBtn } from './lib.jsx';
import { clock } from './Player.jsx';

const len = t => (t < 60 ? (+t).toFixed(1) + ' s' : clock(t));
const ASK = 'Pick bites from my take on the Cut step: read get_lines, mark retakes and fragments with keep, and send named bites with set_bites (each one complete thought with a strong first line, lines in the order they should play). Also make the clean take with clean true.';

export function Lines({ s, src, player, apply, t, backend, open: open0 }) {
  const [lv, setLv] = useState(null), [sel, setSel] = useState([]), [name, setName] = useState(''), [show, setShow] = useState('all');
  const [open, setOpen] = useState(open0), [playing, setPlaying] = useState(null);
  const ls = JSON.stringify(((s.lines || {})[src]) || null), txs = ((s.tx || {})[src] || {}).status;
  useEffect(() => { setOpen(open0); }, [open0]);
  useEffect(() => { if (!src) return; let on = true; fetch('/api/lines?path=' + encodeURIComponent(src)).then(r => r.json()).then(j => { if (on) setLv(j); }).catch(() => {}); return () => { on = false; }; }, [src, ls, txs, s.outputs && s.outputs.length, t && t.status]);
  // play a list of ranges one after another on the Cut step's player
  const seq = useRef(null);
  useEffect(() => { const id = setInterval(() => { const q = seq.current, p = player.current; if (!q || !p) return;
    if (p.now() >= q.ranges[q.k][1] - 0.06) { q.k++; if (q.k >= q.ranges.length) { seq.current = null; setPlaying(null); } else p.play(q.ranges[q.k][0], q.ranges[q.k][1]); } }, 80); return () => clearInterval(id); }, [player]);
  const play = (id, ranges) => { if (!player.current || !ranges.length) return; if (playing === id) { seq.current = null; setPlaying(null); player.current.seek(player.current.now()); return; }
    seq.current = { ranges, k: 0 }; setPlaying(id); player.current.play(ranges[0][0], ranges[0][1]); };
  const post = b => api('/api/lines', { path: src, ...b }).then(j => { setLv(j.lines); apply(j); return j; });
  if (!lv || !src) return null;
  const head = <button type="button" className="lines-h" id="lines-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
    <Icon n={open ? 'down' : 'right'} /><b>Lines and bites</b>
    <span className="fine">{lv.lines ? `${lv.lines.length} lines, ${lv.kept} kept${lv.bites.length ? `, ${lv.bites.length} bite${lv.bites.length > 1 ? 's' : ''}` : ''}` : 'after the transcript'}</span></button>;
  if (!open) return <div className="lines glass-card" id="lines">{head}</div>;
  if (!lv.lines) return <div className="lines glass-card" id="lines">{head}<p className="fine">Every line of the take shows here once it is transcribed (Find cuts does that).</p></div>;
  const byId = Object.fromEntries(lv.lines.map(l => [l.id, l]));
  const list = lv.lines.filter(l => show === 'all' || (show === 'kept' ? l.keep : !l.keep));
  const selSecs = sel.reduce((a, id) => a + (byId[id] ? byId[id].seconds : 0), 0);
  const toggle = id => setSel(x => (x.includes(id) ? x.filter(y => y !== id) : x.concat(id)));
  const make = () => post({ action: 'add', name: name.trim() || undefined, lines: sel }).then(() => { setSel([]); setName(''); toast('Bite made', true); }).catch(() => {});
  return <div className="lines glass-card" id="lines">
    {head}
    <div className="lines-bar">
      <Button id="lines-clean" variant="secondary" label={`One clean take (${clock(lv.cleanTake.seconds)})`} isDisabled={!lv.cleanTake.lines} onClick={() => post({ action: 'clean' }).then(() => toast('Clean take made from every kept line', true)).catch(() => {})} />
      <Button id="lines-ask" variant="ghost" label="Ask my agent to pick" onClick={() => { if (backend !== 'agent') { toast('Connect your agent first (Connect agent, top right)'); return; } api('/api/chat', { text: ASK }).then(j => { apply(j); toast('Sent to your agent', true); }).catch(() => {}); }} />
      {lv.by && <span className="fine" id="lines-by">Bites picked by {lv.by}</span>}
      <label className="inl"><span className="fine">Show</span><select id="lines-show" value={show} onChange={e => setShow(e.target.value)}><option value="all">All lines</option><option value="kept">Kept</option><option value="retake">Retakes and fragments</option></select></label>
    </div>
    <div className="lines-grid">
      <ol className="line-list" id="lines-list" aria-label="Lines">
        {list.map(l => <li key={l.id} data-line={l.id} className={(l.keep ? '' : 'off ') + (sel.includes(l.id) ? 'sel ' : '') + (l.hint ? 'h-' + l.hint : '')}>
          <input type="checkbox" aria-label={`Select line ${l.n}`} checked={sel.includes(l.id)} onChange={() => toggle(l.id)} />
          <span className="ln mono">{l.n}</span>
          <IconBtn n={playing === l.id ? 'pause' : 'play'} label={`Play line ${l.n}`} onClick={() => play(l.id, [[l.start, l.end]])} />
          <span className="lt">{l.text}{l.hint && <span className="fine lh" title={l.why || ''}> {l.hint === 'retake' ? 'Likely retake' : 'Fragment'}{l.why ? `: ${l.why}` : ''}</span>}</span>
          <span className="mono fine">{len(l.seconds)}</span>
          <button type="button" role="switch" aria-checked={l.keep} className={'keep-sw' + (l.keep ? ' on' : '')} id={'keep-' + l.id} aria-label={`Keep line ${l.n}`}
            onClick={() => post({ keep: { [l.id]: !l.keep } }).catch(() => {})}>{l.keep ? 'Keep' : 'Retake'}</button>
        </li>)}
      </ol>
      <div className="bites" id="bites">
        <div className="bite-new">
          <span className="fine" id="sel-count">{sel.length ? `${sel.length} line${sel.length > 1 ? 's' : ''} selected, ${len(selSecs)}` : 'Tick lines to group them into a bite.'}</span>
          <label className="sr" htmlFor="bite-name">Bite name</label>
          <input id="bite-name" placeholder="Name it (optional)" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
          <Button id="bite-add" size="sm" label="Make a bite" isDisabled={!sel.length} onClick={make} />
        </div>
        {lv.bites.length > 0 && <p className="fine" id="bites-hint">{`Your ${lv.bites.length > 1 ? lv.bites.length + ' bites render' : 'bite renders'} at the end, on the Render step.`}</p>}
        <ol className="bite-list" aria-label="Bites">{lv.bites.map((b, i) => <Bite key={b.id} b={b} byId={byId} first={i === 0} last={i === lv.bites.length - 1} playing={playing === b.id}
          onPlay={() => play(b.id, b.ranges)} onPost={x => post({ id: b.id, ...x }).catch(() => {})} />)}</ol>
      </div>
    </div>
  </div>;
}

function Bite({ b, byId, first, last, playing, onPlay, onPost }) {
  const [nm, setNm] = useState(b.name), drag = useRef(null);
  useEffect(() => setNm(b.name), [b.name]);
  const move = (k, j) => { if (j < 0 || j >= b.lines.length) return; const a = b.lines.slice(), [x] = a.splice(k, 1); a.splice(j, 0, x); onPost({ action: 'update', lines: a }); };
  const out = (b.outputs || [])[0];
  const [all, setAll] = useState(false), MAX = 6, shown = all ? b.lines : b.lines.slice(0, MAX);
  return <li className={'bite' + (b.kind === 'full' ? ' clean' : '')} data-bite={b.id}>
    <div className="bite-h">
      <label className="sr" htmlFor={'bn-' + b.id}>Bite name</label>
      <input id={'bn-' + b.id} className="bite-n" value={nm} onChange={e => setNm(e.target.value)} onBlur={() => nm.trim() && nm !== b.name && onPost({ action: 'update', name: nm.trim() })} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <span className="bite-i">
        <IconBtn n="up" label={`Move ${b.name} up`} disabled={first} onClick={() => onPost({ action: 'move', dir: -1 })} />
        <IconBtn n="down" label={`Move ${b.name} down`} disabled={last} onClick={() => onPost({ action: 'move', dir: 1 })} />
        <IconBtn n="trash" label={`Delete ${b.name}`} onClick={() => onPost({ action: 'remove' })} />
      </span>
    </div>
    <div className="bite-m"><span className="mono fine">{len(b.seconds)}, {b.lines.length} line{b.lines.length > 1 ? 's' : ''}</span>{b.by && b.by !== 'you' && <Badge label={`By ${b.by}`} variant="cyan" />}</div>
    {b.reason && <p className="fine">{b.reason}</p>}
    <ol className="bite-lines" aria-label={`Lines in ${b.name}`}>{shown.map((id, k) => byId[id] && <li key={id} data-line={id} draggable
      onDragStart={e => { drag.current = k; e.dataTransfer.effectAllowed = 'move'; }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (drag.current != null) move(drag.current, k); drag.current = null; }}>
      <Icon n="grip" className="grip" /><span className="ln mono">{byId[id].n}</span><span className="lt">{byId[id].text}</span>
      <IconBtn n="up" label={`Move line ${byId[id].n} up`} disabled={k === 0} onClick={() => move(k, k - 1)} />
      <IconBtn n="down" label={`Move line ${byId[id].n} down`} disabled={k === b.lines.length - 1} onClick={() => move(k, k + 1)} />
      {b.lines.length > 1 && <IconBtn n="x" label={`Take line ${byId[id].n} out of ${b.name}`} onClick={() => onPost({ action: 'update', lines: b.lines.filter(x => x !== id) })} />}
    </li>)}</ol>
    {b.lines.length > MAX && <button type="button" className="linkish fine" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${b.lines.length} lines`}</button>}
    <div className="bite-a">
      <Button size="sm" variant="secondary" label={playing ? 'Stop' : 'Play'} onClick={onPlay} />
      {out && <a className="fine" href={file(out)} target="_blank" rel="noreferrer">{out.split('/').pop()}</a>}
      {!out && b.file && <a className="fine" href={file(b.file)} target="_blank" rel="noreferrer" download>{b.id}.mp4</a>}
    </div>
  </li>;
}
