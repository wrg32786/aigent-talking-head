import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Toggle } from './Toggle.jsx';
import { Tiles, itemsOf } from './Tiles.jsx';

// Step 10: transitions between shots. Let the look pick, or choose several (None is straight cuts only), then how
// often they play: every cut, topic changes only, or the hook and call to action only (reel.cjs --transitions-when).
const s = stylex.create({ h: { fontSize: 14, marginTop: 0, marginBottom: 8 }, row: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 } });
const WHEN = [['every-cut', 'Every cut'], ['topic', 'Topic changes only'], ['hook-cta', 'Hook and CTA only']].map(([id, name]) => ({ id, name, preview: null }));
export const WHEN_SAYS = { 'every-cut': 'A transition on every join.', topic: 'Only where a new take or a new part starts. The rest are straight cuts.', 'hook-cta': 'Only in the hook and the call to action. The rest are straight cuts.' };
export function Transitions({ CAT, step, plan, save, busy, setHover }) {
  // switching Let the look pick off opens the list; nothing is saved until you pick a tile or None
  const [open, setOpen] = useState(false), t = plan.transitions, ours = t.ids === null && !open;
  const items = itemsOf(CAT, ['transition']).filter(x => x.id !== 'cut');
  return <>
    <div {...stylex.props(s.row)}>
      <Toggle id="build-tr-ours" checked={ours} disabled={busy} onChange={on => { setOpen(!on); if (on) save({ ids: null }); }}>Let the look pick the transitions</Toggle>
    </div>
    {!ours && <section aria-labelledby="build-tr-h"><h3 id="build-tr-h" {...stylex.props(s.h)}>Which ones</h3>
      <Tiles id="build-tr" label="Transitions" items={items} featured={step.featured || []} value={t.ids} multi allowNone noneLabel="Straight cuts only" disabled={busy}
        onChange={ids => { setOpen(false); save({ ids }); }} onHover={setHover} /></section>}
    {(ours || (t.ids || []).length > 0) && <section aria-labelledby="build-tw-h"><h3 id="build-tw-h" {...stylex.props(s.h)}>How often</h3>
      <Tiles id="build-tw" label="How often transitions play" items={WHEN} value={t.when} disabled={busy} onChange={when => save({ when })} /></section>}
  </>;
}
