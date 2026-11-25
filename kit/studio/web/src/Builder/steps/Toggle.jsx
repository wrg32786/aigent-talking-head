import * as stylex from '@stylexjs/stylex';
import { Field, Label, Switch } from '@headlessui/react';

// An on or off switch with its label (Headless UI Switch), as on the Big titles step.
const s = stylex.create({
  sw: { display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  track: { position: 'relative', width: 40, height: 22, borderRadius: 999, backgroundColor: 'var(--muted)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' },
  trackOn: { backgroundColor: 'var(--primary)' },
  knob: { position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: 999, backgroundColor: '#fff', transitionProperty: 'transform', transitionDuration: '120ms' },
  knobOn: { transform: 'translateX(18px)' },
});
export function Toggle({ id, checked, onChange, disabled, children }) {
  return <Field disabled={disabled} {...stylex.props(s.sw)}><Switch checked={checked} id={id} onChange={onChange} {...stylex.props(s.track, checked && s.trackOn)}>
    <span {...stylex.props(s.knob, checked && s.knobOn)} /></Switch><Label>{children}</Label></Field>;
}
