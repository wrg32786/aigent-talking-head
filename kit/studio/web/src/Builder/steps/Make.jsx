import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Field, Label, Input } from '@headlessui/react';
import { api, toast } from '../../lib.jsx';

// Step 18: save the plan as a template (the name is optional) and make the video: the plan is set as the session's
// own, the draft starts (it writes jobs/<job>/build/video-plan.json beside the cut), and Review shows it coming in.
const s = stylex.create({
  box: { display: 'grid', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)' },
  row: { display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' },
  input: { padding: 8, borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'transparent', color: 'inherit', font: 'inherit', minWidth: 220 },
  label: { display: 'block', fontSize: 13, marginBottom: 4 },
  go: { marginTop: 16 },
});
export function Make({ V, st, apply, go, flush }) {
  const [name, setName] = useState(''), [saved, setSaved] = useState(null), [err, setErr] = useState(''), [making, setMaking] = useState(false);
  const saveT = async () => { setErr(''); if (!(await flush())) return; try { const r = await api('/api/templates', { name }); setSaved(r.template); toast(`Saved as ${r.template.label}`); } catch (e) { setErr(e.message); } };
  const make = async () => {
    setErr(''); setMaking(true);
    try {
      if (!(await flush())) return;
      if (!V.own) apply(await api('/api/video-plan', { plan: V.plan })); // a plan left all to us is still the plan
      apply(await api('/api/draft', {}));
      go('review', true);
    } catch (e) { setErr(e.message); } finally { setMaking(false); }
  };
  return <>
    <section {...stylex.props(s.box)} aria-labelledby="build-tpl-h">
      <h3 id="build-tpl-h" style={{ margin: 0, fontSize: 14 }}>Save as a template</h3>
      <p className="fine" style={{ margin: 0 }}>Use this look again for another video. Your notes stay with this one.</p>
      <div {...stylex.props(s.row)}>
        <Field><Label {...stylex.props(s.label)}>Name (optional)</Label><Input id="build-tpl-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} {...stylex.props(s.input)} /></Field>
        <button type="button" className="btn sm outline" id="build-tpl-save" disabled={!!saved} onClick={saveT}>{saved ? 'Saved' : 'Save as a template'}</button>
      </div>
      {saved && <p className="fine" id="build-tpl-done" role="status" style={{ margin: 0 }}>Saved as {saved.label}.</p>}
    </section>
    <div {...stylex.props(s.go)}>
      <button type="button" className="btn" id="build-make-go" disabled={making} onClick={make}>{making ? 'Starting' : 'Make my video'}</button>
    </div>
    {err && <p className="fine" role="alert" id="build-make-err">{err}</p>}
  </>;
}
