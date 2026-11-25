import * as stylex from '@stylexjs/stylex';
import { ZoneMap } from './ZoneMap.jsx';

// The frame every builder step uses (spec section 6): the question, an Applies to chip with the zone map, the options,
// one line on what the chosen option does, and Back, the step count and Next (none on the last step, which has its own).
const s = stylex.create({
  frame: { padding: 20, borderRadius: 16 },
  head: { display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 },
  title: { margin: 0, fontSize: 22 },
  sub: { marginTop: 4, marginBottom: 0, opacity: 0.8 },
  chip: { display: 'inline-block', marginTop: 8, paddingBlock: 3, paddingInline: 10, borderRadius: 999, fontSize: 12, backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'inherit' },
  does: { minHeight: '1.4em', marginTop: 12, marginBottom: 0 },
  foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 20, flexWrap: 'wrap' },
  count: { fontSize: 13, opacity: 0.8 },
});

// stylex.props gives a className, so a plain class for tests and CSS goes in with it
const withClass = (name, ...st) => { const p = stylex.props(...st); return { ...p, className: name + ' ' + (p.className || '') }; };

export function StepFrame({ step, count, does, back, next, nextLabel = 'Next', headRef, face = false, nextDisabled = false, children }) {
  return <section {...withClass('step glass-card', s.frame)} id={'build-' + step.id} aria-labelledby={'build-h-' + step.id}>
    <div {...stylex.props(s.head)}>
      <ZoneMap zone={step.zone} label={'Applies to: ' + step.appliesTo} face={face} />
      <div>
        <h2 id={'build-h-' + step.id} ref={headRef} tabIndex={-1} {...stylex.props(s.title)}>{step.question}</h2>
        <p {...stylex.props(s.sub)}>{step.title}</p>
        <span {...withClass('applies', s.chip)}>Applies to: {step.appliesTo}</span>
      </div>
    </div>
    {children}
    <p id="build-does" role="status" aria-live="polite" {...stylex.props(s.does)}>{does}</p>
    <div {...stylex.props(s.foot)}>
      <button type="button" className="btn ghost" id="build-back" onClick={back}>Back</button>
      <span id="build-count" {...stylex.props(s.count)}>{count}</span>
      {next ? <button type="button" className="btn" id="build-next" onClick={next} disabled={nextDisabled}>{nextLabel}</button> : <span />}
    </div>
  </section>;
}
