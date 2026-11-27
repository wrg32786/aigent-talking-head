// Stacked plates of what a finished teardown measured. CSS 3D only; click a plate to read the lines.
import { useState } from 'react';
import { layersView } from '../../teardown-layers.mjs';

export function TeardownLayers({ extracted, recipe = null }) {
  const layers = (extracted && extracted.layers) || layersView(extracted, recipe);
  const [open, setOpen] = useState(null);
  const current = layers.find(l => l.id === open) || null;
  const toggle = id => setOpen(x => x === id ? null : id);
  const onKey = (e, i) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); const n = layers[(i + 1) % layers.length]; setOpen(n.id); document.getElementById('td-layer-' + n.id)?.focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); const n = layers[(i + layers.length - 1) % layers.length]; setOpen(n.id); document.getElementById('td-layer-' + n.id)?.focus(); }
  };
  return <div className="td-layers" id="td-layers">
    <p className="lbl" id="td-layers-h">What we measured</p>
    <div className="td-stack" role="list" aria-labelledby="td-layers-h">
      {layers.map((l, i) => (
        <button key={l.id} type="button" role="listitem" id={'td-layer-' + l.id} className={'td-plate' + (open === l.id ? ' open' : '') + (l.empty ? ' empty' : '')}
          aria-pressed={open === l.id} aria-controls="td-layer-detail" style={{ '--i': i }}
          onClick={() => toggle(l.id)} onKeyDown={e => onKey(e, i)}>
          <span className="td-plate-name">{l.label}</span>
          {!l.empty && <span className="fine td-plate-hint">{l.lines[0]}</span>}
        </button>
      ))}
    </div>
    <div className="td-layer-detail" id="td-layer-detail" role="region" aria-live="polite" aria-label={current ? current.label : 'Layer details'}>
      {current ? <><h4>{current.label}</h4><ul>{current.lines.map((x, i) => <li key={i}>{x}</li>)}</ul></>
        : <p className="fine">Click a plate to see what we measured.</p>}
    </div>
  </div>;
}

