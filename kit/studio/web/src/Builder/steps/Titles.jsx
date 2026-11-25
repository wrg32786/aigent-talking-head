import * as stylex from '@stylexjs/stylex';
import { Switch } from '@headlessui/react';
import { Tiles, itemsOf } from './Tiles.jsx';

// Step 4 (kinetic words only): big title words over you. On or off; when on, how they come in (one or several, taken in
// turn), one effect and one exit, each with None.
const s = stylex.create({
  h: { fontSize: 14, marginTop: 0, marginBottom: 8 },
  sw: { display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  track: { position: 'relative', width: 40, height: 22, borderRadius: 999, backgroundColor: 'var(--muted)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' },
  trackOn: { backgroundColor: 'var(--primary)' },
  knob: { position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: 999, backgroundColor: '#fff', transitionProperty: 'transform', transitionDuration: '120ms' },
  knobOn: { transform: 'translateX(18px)' },
});
export function Titles({ CAT, step, words, save, busy, setHover }) {
  const t = words.titles, on = t.on !== false;
  return <>
    <label {...stylex.props(s.sw)}><Switch checked={on} id="build-titles-on" disabled={busy} onChange={v => save({ titles: { on: v ? null : false } })} {...stylex.props(s.track, on && s.trackOn)}>
      <span {...stylex.props(s.knob, on && s.knobOn)} /></Switch><span>Big title words</span></label>
    {on && <>
      <section aria-labelledby="build-ti-h"><h3 id="build-ti-h" {...stylex.props(s.h)}>How they come in</h3>
        <Tiles id="build-ti" label="How titles come in" multi items={itemsOf(CAT, ['entrance'])} featured={step.featured} value={t.entrances} allowNone noneLabel="We pick" disabled={busy}
          onChange={entrances => save({ titles: { entrances } })} onHover={x => setHover(x && x.id ? { titles: { ...t, entrances: [x.id] } } : null)} /></section>
      <section aria-labelledby="build-te-h"><h3 id="build-te-h" {...stylex.props(s.h)}>Effect</h3>
        <Tiles id="build-te" label="Title effect" items={itemsOf(CAT, ['titleEffect'])} value={t.effect} allowNone disabled={busy}
          onChange={effect => save({ titles: { effect } })} onHover={x => setHover(x ? { titles: { ...t, effect: x.id } } : null)} /></section>
      <section aria-labelledby="build-tx-h"><h3 id="build-tx-h" {...stylex.props(s.h)}>Exit</h3>
        <Tiles id="build-tx" label="Title exit" items={itemsOf(CAT, ['titleExit'])} value={t.exit} allowNone disabled={busy}
          onChange={exit => save({ titles: { exit } })} onHover={x => setHover(x ? { titles: { ...t, exit: x.id } } : null)} /></section>
    </>}
  </>;
}
