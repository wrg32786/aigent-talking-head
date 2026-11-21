// The Cut step's Pieces view: the take's lines sorted into what they do (hook, story, tip, proof, list, CTA, with
// asides and retakes hidden until you ask), and Your combo, the pieces in the order the reel plays them. Let AI choose
// fills the combo with one reason a piece; Build my own starts it empty. Pieces are whole transcript lines, so every
// edge sits on a word boundary and no word is ever cut. Nothing renders here: Render renders the combo.
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { api, toast, Icon, IconBtn } from './lib.jsx';
import { clock } from './Player.jsx';

const HIDDEN = ['aside', 'retake'];
const byLabel = b => !b ? null : b === 'ai' ? 'Picked by AI' : b === 'you' ? 'Built by you' : b === 'ai, changed by you' ? 'Picked by AI, changed by you' : `Set by ${b}`;

function PieceCard({ p, n, onToggle, onPlay, cats, onMove }) {
  const [menu, setMenu] = useState(false);
  return <li className={'pz' + (n ? ' in' : '')} data-piece={p.id} data-cat={p.category}>
    {n > 0 && <span className="pz-n" aria-label={`Number ${n} in your combo`}>{n}</span>}
    <button type="button" className="pz-play" aria-label={`Play: ${p.text}`} onClick={() => onPlay(p)}><Icon n="play" /></button>
    <button type="button" className="pz-body" aria-pressed={n ? 'true' : 'false'} onClick={() => onToggle(p)} title={n ? 'Drop from your combo' : 'Add to your combo'}>
      <span className="pz-t">{p.text}</span>
      <span className="pz-m"><span>{clock(p.start)}</span><span>{p.seconds.toFixed(1)} s</span><span>score {p.score}</span>{p.hint && <span className="pz-hint">{p.hint === 'retake' ? 'said again later' : p.hint}</span>}{p.category !== p.rule && <span className="pz-you">moved by you</span>}</span>
    </button>
    <IconBtn n="more" className="pz-more" label="Move to another category" aria-expanded={menu ? 'true' : 'false'} onClick={() => setMenu(!menu)} />
    {menu && <div className="pz-menu" role="group" aria-label="Move to">{cats.filter(c => c.id !== p.category).map(c => <button type="button" key={c.id} data-move-to={c.id} onClick={() => { setMenu(false); onMove(p, c.id === p.rule ? null : c.id); }}>{c.label}</button>)}</div>}
  </li>;
}

export function Pieces({ V, apply, player, src }) {
  const P = V.pieces, [showAll, setShowAll] = useState(false), [topic, setTopic] = useState(null), [drag, setDrag] = useState(null), [busy, setBusy] = useState(false);
  if (!P) return <div className="empty-art" id="pieces-wait"><Icon n="grid" /><p>Pieces show up here when the transcript is done.</p></div>;
  const by = Object.fromEntries(P.pieces.map(p => [p.id, p])), ids = P.combo.ids, pos = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  const send = (b, msg) => { setBusy(true); return api('/api/pieces', { path: src, ...b }).then(j => { apply(j); if (msg || j.note) toast(msg || j.note, true); }).catch(() => {}).finally(() => setBusy(false)); };
  const toggle = p => send(pos[p.id] ? { remove: p.id } : { add: p.id });
  const play = p => player.current && player.current.play(p.start, p.end);
  const move = (p, c) => send({ cats: { [p.id]: c } }, c ? `Moved to ${P.cats.find(x => x.id === c).label}` : 'Back where the rules put it');
  const cats = P.cats.filter(c => showAll || !HIDDEN.includes(c.id));
  const shown = p => !topic || p.topics.includes(topic);
  const hiddenN = P.pieces.filter(p => HIDDEN.includes(p.category)).length;
  const drop = to => { if (drag != null && drag !== ids[to]) send({ move: { id: drag, to } }); setDrag(null); };
  return <div className="pieces" id="pieces">
    <div className="pz-bar">
      <Button id="pieces-choose" variant="primary" label="Let AI choose" icon={<Icon n="spark" />} isLoading={busy} onClick={() => send({ choose: true })} />
      <Button id="pieces-own" variant="secondary" label="Build my own" onClick={() => send({ clear: true }, 'Your combo is empty. Click a piece to add it.')} />
      <button type="button" className="linkish" id="pieces-retakes" aria-pressed={showAll ? 'true' : 'false'} onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide asides and retakes' : `Show asides and retakes (${hiddenN})`}</button>
      <span className="fine grow-r" id="pieces-edges">Each piece is a whole line, so every edge sits between words.</span>
    </div>
    {P.topics.length > 0 && <div className="pz-topics" role="group" aria-label="Topics">
      <span className="fine">Topics</span>
      {P.topics.map(t => <button type="button" key={t} className={'chip' + (topic === t ? ' on' : '')} aria-pressed={topic === t ? 'true' : 'false'} data-topic={t} onClick={() => setTopic(topic === t ? null : t)}>{t}</button>)}
    </div>}
    <div className="pz-grid" id="pieces-grid">
      {cats.map(c => { const list = P.pieces.filter(p => p.category === c.id && shown(p));
        return <section key={c.id} className="pz-cat glass-card" data-cat={c.id} aria-label={c.label}>
          <header><i className="pz-dot" aria-hidden="true" /><h3>{c.label}</h3><span className="fine">{list.length}</span></header>
          {list.length ? <ul>{list.map(p => <PieceCard key={p.id} p={p} n={pos[p.id] || 0} onToggle={toggle} onPlay={play} cats={P.cats} onMove={move} />)}</ul> : <p className="fine pz-none">{c.use}</p>}
        </section>; })}
    </div>
    <section className="combo glass-card" id="combo" aria-labelledby="combo-h">
      <header><h3 id="combo-h">Your combo</h3>{byLabel(P.combo.by) && <Badge label={byLabel(P.combo.by)} variant="cyan" />}
        <span className="fine" id="combo-sum">{ids.length ? `${ids.length} piece${ids.length === 1 ? '' : 's'}, ${Math.round(P.combo.seconds)} s. Drag to reorder, x to drop.` : 'Empty. Let AI choose, or click pieces above to add them in order.'}</span></header>
      {ids.length > 0 && <ol className="combo-strip" id="combo-strip">{ids.map((id, i) => { const p = by[id]; if (!p) return null;
        return <li key={id} draggable className={'cb' + (drag === id ? ' dragging' : '')} data-combo={id} onDragStart={() => setDrag(id)} onDragEnd={() => setDrag(null)} onDragOver={e => e.preventDefault()} onDrop={() => drop(i)}>
          <b>{i + 1} {(P.cats.find(c => c.id === p.category) || {}).label}</b>
          <span className="cb-t">{p.text}</span>
          {P.combo.reasons[id] && <small className="cb-why">{P.combo.reasons[id]}</small>}
          <span className="cb-ctl">
            <IconBtn n="left" label="Earlier" className="cb-up" disabled={i === 0} onClick={() => send({ move: { id, to: i - 1 } })} />
            <IconBtn n="right" label="Later" className="cb-down" disabled={i === ids.length - 1} onClick={() => send({ move: { id, to: i + 1 } })} />
            <IconBtn n="x" label="Drop from your combo" className="cb-x" onClick={() => send({ remove: id })} />
          </span></li>; })}</ol>}
    </section>
  </div>;
}
