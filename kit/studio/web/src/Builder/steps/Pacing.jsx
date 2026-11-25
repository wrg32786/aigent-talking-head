import * as stylex from '@stylexjs/stylex';
import { file } from '../../lib.jsx';

// Step 1: Pacing. Each card plays the cut speed of that pace on the sample presenter (docs/menu/paces, kit/demos.mjs).
// With reduced motion the cards show the still presenter instead.
const ORDER = ['look', 'calm', 'steady', 'lively', 'high'];
const s = stylex.create({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, margin: 0, padding: 0 },
  tile: { display: 'grid', gap: 6, padding: 8, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
  on: { borderColor: 'var(--primary)', boxShadow: '0 0 0 2px var(--primary) inset' },
  img: { width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 10, display: 'block', backgroundColor: 'var(--muted)' },
  name: { fontWeight: 650 },
});
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Pacing({ paces, value, onPick }) {
  const calmMotion = still();
  return <div role="radiogroup" aria-label="Pacing" id="build-paces" {...stylex.props(s.grid)}>
    {ORDER.filter(id => paces[id]).map(id => {
      const on = value === id, src = id === 'look' || calmMotion ? 'docs/menu/demo-plate.webp' : `docs/menu/paces/${id}.webp`;
      return <button key={id} type="button" role="radio" aria-checked={on} data-pace={id} onClick={() => onPick(id)} {...stylex.props(s.tile, on && s.on)}>
        <img src={file(src)} alt="" loading="lazy" {...stylex.props(s.img)} />
        <span {...stylex.props(s.name)}>{paces[id].label}</span>
      </button>;
    })}
  </div>;
}
