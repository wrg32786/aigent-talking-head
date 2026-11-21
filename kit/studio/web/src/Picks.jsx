import { Button } from '@astryxdesign/core/Button';
import { Icon, KIND_NAME } from './lib.jsx';

// a scene (ref-...) shows by its name, not its id
export function PicksTray({ s, patch, cat }) {
  const nm = (kind, id) => { const it = cat && cat.items[`${kind}:${id}`]; return it && it.made ? it.made.name : id; };
  const chips = [];
  for (const [kind, p] of Object.entries(s.picks)) {
    const clear = id => patch({ picks: { [`${kind}:${id}`]: 'clear' } });
    for (const id of p.allow) chips.push(<button key={'a' + kind + id} className="chip on" type="button" onClick={() => clear(id)} aria-label={`Remove pick ${nm(kind, id)}`}><span className="k">{KIND_NAME[kind] || kind}</span>{nm(kind, id)}<Icon n="x" /></button>);
    for (const id of p.deny) chips.push(<button key={'d' + kind + id} className="chip deny" type="button" onClick={() => clear(id)} aria-label={`Remove forbid ${nm(kind, id)}`}><Icon n="ban" /><span className="k">{KIND_NAME[kind] || kind}</span>{nm(kind, id)}<Icon n="x" /></button>);
  }
  return <div className="picks" id="picksbar"><span className="lbl">Picks <b id="pickcount">{chips.length}</b></span>
    <div id="chips" className="chips" aria-live="polite">{chips.length ? chips : <span className="none">None yet. Click a tile to pick it.</span>}</div>
    {chips.length > 0 && <span id="clear-picks"><Button variant="ghost" size="sm" label="Clear" onClick={() => patch({ clearPicks: true })} /></span>}
  </div>;
}
