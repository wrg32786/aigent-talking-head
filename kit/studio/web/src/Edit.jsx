import { Icon } from './lib.jsx';

// Your edit: one quiet line on every step that says what you are making, from what, the look, b-roll and sound, and
// what comes next (the server works it out: view.edit, GET /api/edit, MCP get_edit). Each part opens its step.
export function YourEdit({ V, go, step }) {
  const e = V.edit; if (!e || e.error) return null;
  const parts = [
    ['making', 'Making', `${e.making.text}, ${e.making.aspect}${e.making.goal === 'ad' ? ', ad' : ''}`, 'cut'],
    ['from', 'From', e.from.text, 'cut'],
    ['look', 'Look', e.look.text, 'look'],
    ['broll', 'B-roll', e.broll.text, 'broll'],
    ['sound', 'Sound', e.sound.text, 'look'],
  ];
  const next = e.next || {};
  return <section className="your-edit glass-card" id="your-edit" aria-label="Your edit">
    <span className="ye-h lbl">Your edit</span>
    <dl className="ye-list">{parts.map(([k, label, text, to]) => <div key={k} className="ye-i" data-part={k}>
      <dt>{label}</dt><dd><button type="button" className="ye-link" onClick={() => go(to, true)} aria-label={`${label}: ${text}. Open ${to === 'cut' ? 'Cut' : to === 'look' ? 'Look' : 'B-roll'}`}>{text}</button></dd></div>)}</dl>
    {e.stale && <span className="ye-warn fine" id="ye-stale" role="status"><Icon n="ban" />Pieces changed since the draft</span>}
    {next.step && next.step !== step && <button type="button" className="btn ghost sm ye-next" id="ye-next" onClick={() => go(next.step, true)}>{next.label}<Icon n="right" /></button>}
  </section>;
}
