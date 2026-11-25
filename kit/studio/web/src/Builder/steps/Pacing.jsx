import * as stylex from '@stylexjs/stylex';
import { RadioGroup, Radio } from '@headlessui/react';
import { file, isPaused, Icon } from '../../lib.jsx';

// Step 1: Pacing. Each card plays the cut speed of that pace on the sample presenter (docs/menu/paces, kit/demos.mjs).
// The strips show how often the picture changes, not the exact cuts your video gets. With previews paused (Settings)
// or reduced motion the cards show the still presenter instead. Arrow keys move between paces, as in any radio group.
const ORDER = ['look', 'calm', 'steady', 'lively', 'high'];
const s = stylex.create({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBlock: 0, marginInline: 0, paddingBlock: 0, paddingInline: 0 },
  tile: { position: 'relative', display: 'grid', gap: 6, padding: 8, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', cursor: 'pointer', textAlign: 'left', outlineOffset: 2 },
  on: { borderColor: 'var(--primary)', boxShadow: '0 0 0 2px var(--primary) inset' },
  busy: { cursor: 'progress' },
  img: { width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 10, display: 'block', backgroundColor: 'var(--muted)' },
  name: { fontWeight: 650 },
  mark: { position: 'absolute', top: 14, right: 14, display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 999, backgroundColor: 'var(--primary)', color: 'var(--primary-foreground, #fff)' },
});

export function Pacing({ paces, value, onPick, busy }) {
  const still = isPaused();
  return <><RadioGroup value={value} onChange={id => { if (!busy) onPick(id); }} aria-label="Pacing" id="build-paces" {...stylex.props(s.grid)}>
    {ORDER.filter(id => paces[id]).map(id => {
      const on = value === id, src = id === 'look' || still ? 'docs/menu/demo-plate.webp' : `docs/menu/paces/${id}.webp`;
      return <Radio key={id} value={id} data-pace={id} aria-busy={busy || undefined} {...stylex.props(s.tile, on && s.on, busy && s.busy)}>
        <img src={file(src)} alt="" loading="lazy" {...stylex.props(s.img)} />
        {on && <span aria-hidden="true" {...stylex.props(s.mark)}><Icon n="check" /></span>}
        <span {...stylex.props(s.name)}>{paces[id].label}</span>
      </Radio>;
    })}
  </RadioGroup>
  <p className="fine" id="build-paces-note">The cards show how often the picture changes. Your own cuts follow your words.</p></>;
}
