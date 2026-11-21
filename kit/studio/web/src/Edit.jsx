import { Icon, stepName } from './lib.jsx';
import { refSays } from './RefCard.jsx';

// Your edit: one quiet line on every step after Start that says what you are making, from what, the look, b-roll and sound
// (the server works it out: view.edit, GET /api/edit, MCP get_edit). Each part opens its step. The one Next button is
// in the bar at the bottom, so this line carries none.
export function YourEdit({ V, s, go, step }) {
  const e = V.edit; if (!e || e.error) return null;
  // the mode in plain words: Recreating a reference, or its look on your own words
  const says = s ? refSays(s) : null;
  const parts = [
    ['making', 'Making', `${e.making.text}, ${e.making.aspect}${e.making.goal === 'ad' ? ', ad' : ''}`, 'cut'],
    ['from', 'From', e.from.text, 'cut'],
    ['look', 'Look', says ? [says, e.look.picks ? `${e.look.picks} change${e.look.picks === 1 ? '' : 's'} by you` : null].filter(Boolean).join(', ') : e.look.text, 'picture'],
    ['broll', 'B-roll', e.broll.text, 'broll'],
    (e.sound.bed !== 'auto' || e.sound.sfx !== 'on') && ['sound', 'Sound', e.sound.text, 'music'],
  ].filter(Boolean);
  return <section className="your-edit glass-card" id="your-edit" aria-label="Your edit">
    <span className="ye-h lbl">Your edit</span>
    <dl className="ye-list">{parts.map(([k, label, text, to]) => <div key={k} className="ye-i" data-part={k}>
      <dt>{label}</dt><dd><button type="button" className="ye-link" onClick={() => go(to, true)} aria-label={`${label}: ${text}. Open ${stepName(to)}`}>{text}</button></dd></div>)}</dl>
    {e.stale && <span className="ye-warn fine" id="ye-stale" role="status"><Icon n="ban" />Your clips changed since the draft</span>}
  </section>;
}
