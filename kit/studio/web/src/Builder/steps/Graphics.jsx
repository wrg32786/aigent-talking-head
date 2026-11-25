import * as stylex from '@stylexjs/stylex';
import { Toggle } from './Toggle.jsx';

// Step 12: graphics, one screen. Let the agent choose is on by default; off, each kind can be switched on or off
// (kit/studio/wizard/plan.mjs GRAPHIC_GROUPS, and cards-auto for colour and chapter cards).
const s = stylex.create({ list: { display: 'grid', gap: 10, marginTop: 12 }, row: { display: 'flex', gap: 10, alignItems: 'center' } });
const KINDS = [['nameTag', 'Name tag', 'Your name when you say it'], ['numbers', 'Numbers and lists', 'Counts, prices, steps and checklists'], ['stickers', 'Stickers and callouts', 'Small stickers, badges and highlights'], ['cta', 'Call to action', 'The card or button at the end'], ['cards', 'Colour and chapter cards', 'A full card between parts']];
function Row({ id, label, line, checked, onChange, disabled }) {
  return <Toggle id={'build-gx-' + id} checked={checked} onChange={onChange} disabled={disabled}><b>{label}</b> <span className="fine">{line}</span></Toggle>;
}
export function Graphics({ plan, save, busy }) {
  const g = plan.graphics;
  return <>
    <Row id="agent" label="Let the agent choose" line="We add what fits what you say" checked={g.agent} disabled={busy} onChange={agent => save({ agent })} />
    {!g.agent && <div {...stylex.props(s.list)} role="group" aria-label="Kinds of graphics">
      {KINDS.map(([k, label, line]) => <Row key={k} id={k} label={label} line={line} checked={k === 'cards' ? g.cards !== false : g[k]} disabled={busy}
        onChange={on => save({ [k]: on })} />)}
    </div>}
  </>;
}
