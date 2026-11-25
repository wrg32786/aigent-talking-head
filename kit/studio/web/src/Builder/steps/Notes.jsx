import { useEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Field, Label, Textarea } from '@headlessui/react';
import { Fold } from '../../ui.jsx';
import { Layers } from '../../AllOptions.jsx';
import { NOTE_LINES } from '../../../../wizards.mjs';

// Step 17: anything else for the agent (saved as plan.notes, which studio_get_state and get_video_plan show), four
// examples that add a line, the plan so far with Change on each row (opens only that step, then comes back here), and
// All options: every layer's tiles, as the classic steps show them.
const s = stylex.create({
  area: { width: '100%', minHeight: 110, padding: 10, borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', font: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
  label: { display: 'block', fontWeight: 600, marginBottom: 6 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  rows: { display: 'grid', gap: 6, marginTop: 18, marginBottom: 0, paddingInline: 0, listStyle: 'none' },
  row: { display: 'grid', gridTemplateColumns: '9em 1fr auto', gap: 10, alignItems: 'baseline' },
  sec: { fontWeight: 600 },
  fold: { marginTop: 16 },
});
// what the old guided starts asked for, one line per goal (grow, sell, teach, clean; kit/studio/wizards.mjs)
export const NOTE_CHIPS = NOTE_LINES;
export const MAX_NOTES = 2000;
export function Notes({ CAT, plan, V, save, busy, rows, onChange, st, appV, patch }) {
  const [text, setText] = useState(plan.notes || ''), saved = useRef(plan.notes || ''), [tab, setTab] = useState(null);
  // a note set elsewhere (the chat, an agent) shows here unless you are typing
  useEffect(() => { if ((plan.notes || '') !== saved.current) { saved.current = plan.notes || ''; setText(plan.notes || ''); } }, [plan.notes]);
  const keep = t => { const v = t.slice(0, MAX_NOTES); if (v === saved.current) return; saved.current = v; save(v); };
  const add = line => { const v = (text.trim() ? text.trim() + '\n' : '') + line; setText(v); keep(v); };
  return <>
    <Field>
      <Label {...stylex.props(s.label)}>Anything else for the agent?</Label>
      <Textarea id="build-notes-text" value={text} maxLength={MAX_NOTES} onChange={e => setText(e.target.value)} onBlur={() => keep(text)} {...stylex.props(s.area)} />
    </Field>
    <div {...stylex.props(s.chips)} role="group" aria-label="Examples to add">
      {NOTE_CHIPS.map((c, i) => <button key={i} type="button" className="btn sm outline" data-chip={i} disabled={text.includes(c)} onClick={() => add(c)}>{c}</button>)}
    </div>
    <ul id="build-summary" {...stylex.props(s.rows)} aria-label="Your plan so far">
      {rows.filter(r => r.step !== 'notes').map(r => <li key={r.step} {...stylex.props(s.row)} data-row={r.step}>
        <span {...stylex.props(s.sec)}>{r.section}</span><span>{r.text}</span>
        {onChange(r.step) ? <button type="button" className="linkish" aria-label={'Change ' + r.section} onClick={() => { keep(text); onChange(r.step)(); }}>Change</button> : <span />}
      </li>)}
    </ul>
    <div {...stylex.props(s.fold)}>
      <Fold id="build-all" title="All options">
        {['picture', 'text', 'broll', 'music'].map(step => <Layers key={step} step={step} bare CAT={CAT} V={appV} s={st} apply={null} patch={patch} tab={tab} setTab={setTab} />)}
      </Fold>
    </div>
  </>;
}
