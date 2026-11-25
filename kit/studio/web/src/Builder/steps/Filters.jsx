import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Toggle } from './Toggle.jsx';
import { Tiles, itemsOf } from './Tiles.jsx';

// Step 13: filters on the picture. Let the look pick, or choose some (None is no filter). Step 14: when they show,
// the whole video, the hook, the call to action or both (reel.cjs --finish-when puts them only on those pieces).
const s = stylex.create({ row: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 } });
export const FILTER_WHEN = [['whole', 'The whole video'], ['hook', 'The hook only'], ['cta', 'The call to action only'], ['hook-cta', 'Hook and call to action']].map(([id, name]) => ({ id, name, preview: null }));
export const FILTER_SAYS = { whole: 'On every shot.', hook: 'Only on the first lines. The rest stays clean.', cta: 'Only on the ask at the end. The rest stays clean.', 'hook-cta': 'On the first lines and the ask at the end. The middle stays clean.' };
export function Filters({ CAT, step, plan, save, busy, setHover }) {
  const [open, setOpen] = useState(false), f = plan.filters, ours = f.ids === null && !open;
  return <>
    <div {...stylex.props(s.row)}>
      <Toggle id="build-fi-ours" checked={ours} disabled={busy} onChange={on => { setOpen(!on); if (on) save({ ids: null }); }}>Let the look pick the filters</Toggle>
    </div>
    {!ours && <Tiles id="build-fi" label="Filters" items={itemsOf(CAT, ['finish'])} featured={step.featured || []} value={f.ids} multi allowNone noneLabel="No filter" disabled={busy}
      onChange={ids => { setOpen(false); save({ ids }); }} onHover={setHover} />}
  </>;
}
export function FilterTiming({ plan, save, busy }) {
  const f = plan.filters;
  if (!(f.ids || []).length) return <p className="fine" id="build-ft-none">{f.ids === null ? 'The look picks the filters, so they show where the look puts them.' : 'No filter chosen, so there is nothing to time.'} Go back to pick one, or carry on.</p>;
  return <Tiles id="build-ft" label="When filters show" items={FILTER_WHEN} value={f.when} disabled={busy} onChange={when => save({ when })} />;
}
