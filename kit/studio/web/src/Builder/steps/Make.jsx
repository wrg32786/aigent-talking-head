import { useEffect, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Field, Label, Input } from '@headlessui/react';
import { api, toast } from '../../lib.jsx';

// Step 18: save the plan as a template (the name is optional) and make the video: the plan is kept as the session's
// own, the draft starts (it writes jobs/<job>/build/video-plan.json beside the cut), and Review shows it coming in.
// StyleX's className with the shared fine-print class kept beside it
const fine = st => { const p = stylex.props(st); return { ...p, className: ['fine', p.className].filter(Boolean).join(' ') }; };
const s = stylex.create({
  box: { display: 'grid', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)' },
  row: { display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' },
  input: { padding: 8, borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'transparent', color: 'inherit', font: 'inherit', minWidth: 220 },
  label: { display: 'block', fontSize: 13, marginBottom: 4 },
  go: { marginTop: 16 },
  h: { margin: 0, fontSize: 14 },
  p: { margin: 0 },
});
// a call to action the plan leans on (the CTA card, or filters timed for it) but we did not hear one in your clip
export const ctaNeeds = plan => { const f = (plan && plan.filters) || {}, g = (plan && plan.graphics) || {}; const fil = ['cta', 'hook-cta'].includes(f.when) && Array.isArray(f.ids) && f.ids.length > 0; return { card: g.cta !== false, filter: fil, hookToo: f.when === 'hook-cta' }; };
export function Make({ apply, go, flush, plan }) {
  const [heard, setHeard] = useState(null);
  // (asked again every few seconds while the words are still being heard, up to about a minute)
  useEffect(() => { let live = true, n = 0, tm = null; const ask = () => api('/api/plan/cta').then(j => { if (!live) return; setHeard(j.heard); if (j.heard == null && ++n < 20) tm = setTimeout(ask, 3000); }).catch(() => {}); ask(); return () => { live = false; clearTimeout(tm); }; }, []);
  const need = ctaNeeds(plan);
  const [name, setName] = useState(''), [saved, setSaved] = useState(null), [err, setErr] = useState(''), [making, setMaking] = useState(false);
  const blocked = () => setErr('A choice did not save. Go back to it and pick it again, then try once more.');
  const saveT = async () => { setErr(''); if (!(await flush())) return blocked(); try { const r = await api('/api/templates', { name }); setSaved(r.template); toast(`Saved as ${r.template.label}`); } catch (e) { setErr(e.message); } };
  const make = async () => {
    setErr('');
    if (!(await flush())) return blocked();
    setMaking(true);
    // plan: true keeps the plan read from a classic session as it is, beside the draft, without setting it again
    try { apply(await api('/api/draft', { plan: true })); go('review', true); } catch (e) { setErr(e.message); } finally { setMaking(false); }
  };
  return <>
    <section {...stylex.props(s.box)} aria-labelledby="build-tpl-h">
      <h3 id="build-tpl-h" {...stylex.props(s.h)}>Save as a template</h3>
      <p {...fine(s.p)}>Use this look again for another video. Your notes stay with this one.</p>
      <div {...stylex.props(s.row)}>
        <Field><Label {...stylex.props(s.label)}>Name (optional)</Label><Input id="build-tpl-name" value={name} maxLength={60} onChange={e => { setName(e.target.value); setSaved(null); }} {...stylex.props(s.input)} /></Field>
        <button type="button" className="btn sm outline" id="build-tpl-save" disabled={!!saved} onClick={saveT}>{saved ? 'Saved' : 'Save as a template'}</button>
      </div>
      {saved && <p id="build-tpl-done" role="status" {...fine(s.p)}>Saved as {saved.label}.</p>}
    </section>
    {heard === false && (need.card || need.filter) && <p className="fine" role="note" id="build-make-cta">
      We did not hear a call to action in your clip, like "follow for more". {need.filter ? (need.hookToo ? 'The filter you timed for it shows only on the hook' : 'The filter you timed for it has nowhere to go') : 'The call to action card has nowhere to go'}. Say one at the end of a take, or{' '}
      <a href={need.filter ? '#build=filterTiming' : '#build=graphics'}>{need.filter ? 'pick another filter timing' : 'turn the call to action off'}</a>.</p>}
    <div {...stylex.props(s.go)}>
      <button type="button" className="btn" id="build-make-go" disabled={making} onClick={make}>{making ? 'Starting' : 'Make my video'}</button>
    </div>
    {err && <p className="fine" role="alert" id="build-make-err">{err}</p>}
  </>;
}
