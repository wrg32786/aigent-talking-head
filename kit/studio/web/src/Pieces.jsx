// The Cut step's second layer, Best lines: every line of the take sorted by what it does (hook, story, tip, proof,
// list, CTA, with asides and retakes hidden until you ask), each one playable. The lines we would pick carry a Best
// mark, and a line that serves the point of the video says "Fits your point". Click a line to put it in your own
// clip, the strip at the bottom, in the order it plays. Lines are whole transcript lines, so every edge sits between
// words and no word is ever cut. (The server and agents call a line a piece and your clip the Combo; only the words
// on the page changed.)
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { api, toast, Icon, IconBtn } from './lib.jsx';
import { clock } from './Player.jsx';

const HIDDEN = ['aside', 'retake'];
const byLabel = b => !b ? null : b === 'ai' ? 'Our pick' : b === 'you' ? 'Built by you' : b === 'ai, changed by you' ? 'Our pick, changed by you' : `Set by ${b}`;
export const FITS = 'Fits your point';
// an empty group says what the take is missing, in plain words
const NONE = { hook: 'No clear opening line in this take.', cta: 'No ask at the end.' };

function LineCard({ p, n, best, onToggle, onPlay, cats, onMove }) {
  const [menu, setMenu] = useState(false);
  return <li className={'pz' + (n ? ' in' : '') + (best ? ' best' : '')} data-piece={p.id} data-cat={p.category}>
    {n > 0 && <span className="pz-n" aria-label={`Number ${n} in your clip`}>{n}</span>}
    <button type="button" className="pz-play" aria-label={`Play: ${p.text}`} onClick={() => onPlay(p)}><Icon n="play" /></button>
    <button type="button" className="pz-body" aria-pressed={n ? 'true' : 'false'} onClick={() => onToggle(p)} title={n ? 'Take it out of your clip' : 'Add it to your clip'}>
      <span className="pz-t">{p.text}</span>
      <span className="pz-m"><span title={`At ${clock(p.start)} in the take`}>{p.seconds.toFixed(1)} s</span>
        {best && <span className="pz-best" title={best}>Best</span>}{p.fits && <span className="pz-fits">{FITS}</span>}
        {p.hint && <span className="pz-hint">{p.hint === 'retake' ? 'said again later' : p.hint}</span>}{p.category !== p.rule && <span className="pz-you">moved by you</span>}</span>
    </button>
    <IconBtn n="more" className="pz-more" label="Move to another group" aria-expanded={menu ? 'true' : 'false'} onClick={() => setMenu(!menu)} />
    {menu && <div className="pz-menu" role="group" aria-label="Move to">{cats.filter(c => c.id !== p.category).map(c => <button type="button" key={c.id} data-move-to={c.id} onClick={() => { setMenu(false); onMove(p, c.id === p.rule ? null : c.id); }}>{c.label}</button>)}</div>}
  </li>;
}

export function Pieces({ V, apply, player, src, stitch, spans, onClips }) {
  const P = V.pieces, [showAll, setShowAll] = useState(false), [topic, setTopic] = useState(null), [drag, setDrag] = useState(null), [busy, setBusy] = useState(false);
  if (!P) return <div className="empty-art" id="pieces-wait"><Icon n="grid" /><p>Your lines show up here once we have read the words.</p></div>;
  const by = Object.fromEntries(P.pieces.map(p => [p.id, p])), ids = P.combo.ids, pos = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  const best = (P.best && P.best.reasons) || {}, bestN = ((P.best && P.best.ids) || []).length;
  const send = (b, msg) => { setBusy(true); return api('/api/pieces', { path: src, ...b }).then(j => { apply(j); if (msg || j.note) toast(msg || j.note, true); }).catch(() => {}).finally(() => setBusy(false)); };
  const toggle = p => send(pos[p.id] ? { remove: p.id } : { add: p.id });
  const play = p => { stitch.stop(); player.current && player.current.play(p.start, p.end); };
  const move = (p, c) => send({ cats: { [p.id]: c } }, c ? `Moved to ${P.cats.find(x => x.id === c).label}` : 'Back where we first put it');
  const cats = P.cats.filter(c => showAll || !HIDDEN.includes(c.id));
  const tp = P.topics.includes(topic) ? topic : null, shown = p => !tp || p.topics.includes(tp);
  const hiddenN = P.pieces.filter(p => HIDDEN.includes(p.category)).length;
  const drop = to => { if (drag != null && drag !== ids[to]) send({ move: { id: drag, to } }); setDrag(null); };
  return <div className="pieces" id="pieces">
    <div className="pz-bar">
      <Button id="pieces-choose" variant={ids.length ? 'secondary' : 'primary'} label={bestN ? `Use our ${bestN} best lines` : 'Use our best lines'} icon={<Icon n="spark" />} isLoading={busy} onClick={() => send({ choose: true })} />
      {ids.length > 0 && <Button id="pieces-own" variant="secondary" label="Clear my clip" onClick={() => send({ clear: true }, 'Your clip is empty. Click a line to add it.')} />}
      {hiddenN > 0 && <button type="button" className={'chip sm grow-r' + (showAll ? ' on' : '')} id="pieces-retakes" aria-pressed={showAll ? 'true' : 'false'} onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide asides and retakes' : `Show asides and retakes (${hiddenN})`}</button>}
    </div>
    {P.topics.length > 0 && <div className="pz-topics" role="group" aria-label="Topics" id="pieces-topics">
      <span className="fine">Topics</span>
      {P.topics.map(t => <button type="button" key={t} className={'chip' + (tp === t ? ' on' : '')} aria-pressed={tp === t ? 'true' : 'false'} data-topic={t} onClick={() => setTopic(tp === t ? null : t)}>{t}</button>)}
    </div>}
    {P.topics.length > 0 && P.topicsBy && P.topicsBy !== 'rules' && <p className="fine" id="pieces-topics-by">Themes named by your chat's model from this transcript.</p>}
    <div className="pz-grid" id="pieces-grid">
      {cats.map(c => { const list = P.pieces.filter(p => p.category === c.id && shown(p)); if (tp && !list.length) return null;
        return <section key={c.id} className="pz-cat glass-card" data-cat={c.id} aria-label={c.label}>
          <header><i className="pz-dot" aria-hidden="true" /><h3>{c.label}</h3></header>
          {list.length ? <ul>{list.map(p => <LineCard key={p.id} p={p} n={pos[p.id] || 0} best={best[p.id]} onToggle={toggle} onPlay={play} cats={P.cats} onMove={move} />)}</ul> : <p className="fine pz-none">{NONE[c.id] || c.use}</p>}
        </section>; })}
    </div>
    <section className="combo glass-card" id="combo" aria-labelledby="combo-h">
      <header><h3 id="combo-h">Your clip</h3>{ids.length > 0 && byLabel(P.combo.by) && <Badge label={byLabel(P.combo.by)} variant="cyan" />}
        <span className="fine" id="combo-sum">{ids.length ? `${ids.length} line${ids.length === 1 ? '' : 's'}, ${Math.round(P.combo.seconds)} s, stitched in this order.` : 'Click lines above to stitch your own clip, or use our best lines.'}</span>
        {ids.length > 0 && <span className="combo-a"><Button id="combo-play" size="sm" variant="secondary" label={stitch.playing === 'own' ? 'Stop' : 'Play it stitched'} icon={<Icon n={stitch.playing === 'own' ? 'pause' : 'play'} />} onClick={() => stitch.play('own', spans || ids.map(id => by[id]).filter(Boolean).map(p => [p.start, p.end]))} />
          <Button id="combo-to-clips" size="sm" variant="ghost" label="See it in Clips" onClick={onClips} /></span>}</header>
      {ids.length > 0 && <ol className="combo-strip" id="combo-strip">{ids.map((id, i) => { const p = by[id]; if (!p) return null;
        return <li key={id} draggable className={'cb' + (drag === id ? ' dragging' : '')} data-combo={id} onDragStart={() => setDrag(id)} onDragEnd={() => setDrag(null)} onDragOver={e => e.preventDefault()} onDrop={() => drop(i)}>
          <b>{i + 1} {(P.cats.find(c => c.id === p.category) || {}).label}</b>
          <span className="cb-t">{p.text}</span>
          {P.combo.reasons[id] && <small className="cb-why">{P.combo.reasons[id]}</small>}
          <span className="cb-ctl">
            <IconBtn n="left" label="Earlier" className="cb-up" disabled={i === 0} onClick={() => send({ move: { id, to: i - 1 } })} />
            <IconBtn n="right" label="Later" className="cb-down" disabled={i === ids.length - 1} onClick={() => send({ move: { id, to: i + 1 } })} />
            <IconBtn n="x" label="Take it out of your clip" className="cb-x" onClick={() => send({ remove: id })} />
          </span></li>; })}</ol>}
    </section>
  </div>;
}
