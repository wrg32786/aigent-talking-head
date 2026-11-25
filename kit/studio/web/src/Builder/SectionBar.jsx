import * as stylex from '@stylexjs/stylex';
import { Icon } from '../lib.jsx';

// The builder's sections (not its steps). Built sections can be opened; the rest say Coming soon until their phase ships.
const s = stylex.create({
  bar: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: 0, padding: 0, listStyle: 'none' },
  item: { display: 'inline-flex', alignItems: 'center', gap: 6, paddingBlock: 6, paddingInline: 10, borderRadius: 999, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'transparent', color: 'inherit', fontSize: 13, cursor: 'pointer' },
  current: { borderColor: 'var(--primary)', backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)', fontWeight: 650 },
  soon: { opacity: 0.75, cursor: 'default', borderStyle: 'dashed' },
  tag: { fontSize: 11, paddingBlock: 1, paddingInline: 6, borderRadius: 999, backgroundColor: 'var(--muted)' },
});

export function SectionBar({ sections, current, done, ready, onOpen }) {
  return <nav aria-label="Sections"><ol id="build-sections" {...stylex.props(s.bar)}>
    {sections.map(x => {
      const ok = ready.includes(x.id), here = x.id === current;
      return <li key={x.id}>
        <button type="button" data-section={x.id} disabled={!ok} title={ok ? undefined : 'Coming soon'} aria-current={here ? 'step' : undefined} onClick={() => ok && onOpen(x.id)}
          {...stylex.props(s.item, here && s.current, !ok && s.soon)}>
          {done.includes(x.id) && <Icon n="check" />}{x.label}{!ok && <span {...stylex.props(s.tag)}><span className="sr">, </span>Soon</span>}
        </button>
      </li>;
    })}
  </ol></nav>;
}
