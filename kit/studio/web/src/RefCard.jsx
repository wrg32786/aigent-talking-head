// The reference's shared pieces, used by the Look step card (Style.jsx) and the Breakdown (Reference.jsx):
// RefMode (one control, one vocabulary), RefPlan (what Recreate brings, as chips), RefParts (Influence switches)
// and RefNotice (one line while a reference is read, or when it set your Look).
import { useEffect, useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { toast, Icon } from './lib.jsx';

export const REF_MODES = [['recreate', 'Recreate'], ['influence', 'Influence'], ['off', 'Off']];
export const REF_HINT = {
  recreate: 'Your take re-cut to its shots, with its look, titles, sounds and music.',
  influence: 'Only the parts you switch on, as soft defaults.',
  off: 'Kept here, not used.',
};

// How the reference is used: Recreate, Influence or Off, with one line for the mode you are in
export function RefMode({ id, mode, patch }) {
  const box = useRef(null), refocus = useRef(false);
  // the card moves when the mode changes (above the Looks in Recreate), so put the focus back on the mode you chose
  useEffect(() => { if (!refocus.current) return; refocus.current = false; const b = box.current && box.current.querySelector('[aria-checked="true"]'); if (b) b.focus({ preventScroll: true }); }, [mode]);
  const set = m => { if (m === mode) return; refocus.current = true; Promise.resolve(patch({ reference: { mode: m } })).catch(() => { refocus.current = false; }); };
  const onKey = e => {
    const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0; if (!d) return;
    e.preventDefault(); const i = Math.max(0, REF_MODES.findIndex(([m]) => m === mode)); set(REF_MODES[(i + d + REF_MODES.length) % REF_MODES.length][0]);
  };
  return <div className="ref-mode">
    <div className="seg" role="radiogroup" aria-label="Use the reference" aria-describedby={id + '-hint'} id={id} ref={box} onKeyDown={onKey}>
      {REF_MODES.map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={mode === m ? 'true' : 'false'} tabIndex={mode === m ? 0 : -1} data-mode={m} onClick={() => set(m)}>{l}</button>)}
    </div>
    <p className="fine ref-mode-hint" id={id + '-hint'}>{REF_HINT[mode] || ''}</p>
  </div>;
}

// What Recreate takes besides the Look (shots, framing, cutaways, sounds, no music), one small chip each, and what
// was made for the menu from it (kit/scenes.cjs). onMade makes the made chip a button (the Look step shows the tiles).
const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
export function RefPlan({ ex, mode, onMade, id = 'ref-plan' }) {
  if (!ex || mode === 'off') return null;
  const pl = mode === 'recreate' ? ex.plan : null, made = ex.scenes || [];
  const bits = pl ? [pl.shots > 1 && ['shots', count(pl.shots, 'shot')], pl.framing && pl.framing.length > 0 && ['framing', pl.framing.slice(0, 3).join(', ')],
    pl.cutaways > 0 && ['cutaways', count(pl.cutaways, 'cutaway')], pl.sounds > 0 && ['sounds', count(pl.sounds, 'sound')], pl.noBed && ['music', 'No music']].filter(Boolean) : [];
  if (!bits.length && !made.length) return null;
  const names = made.map(x => x.name).join(', '), madeId = id === 'ref-plan' ? 'ref-made' : id.replace('ref-plan', 'ref-made');
  return <ul className="ref-plan" id={id} aria-label="From the reference">
    {bits.map(([k, v]) => <li key={k} className="rp-chip" data-plan={k}>{v}</li>)}
    {made.length > 0 && <li className="rp-li">{onMade
      ? <button type="button" className="rp-chip rp-made" id={madeId} title={names} onClick={() => onMade(made)}><Icon n="spark" />{made.length} made for you</button>
      : <span className="rp-chip rp-made" id={madeId} title={names}><Icon n="spark" />{made.length} made for you</span>}</li>}
  </ul>;
}

// Influence: which parts of the reference to take, one switch each (reference.parts)
export function RefParts({ V, s, patch }) {
  const parts = (V.env && V.env.refParts) || [], on = { ...((V.env && V.env.influenceParts) || {}), ...(s.reference.parts || {}) };
  if (!parts.length) return null;
  return <div className="ref-parts" id="ref-parts">
    <span className="lbl">Take</span>
    <div className="chips" role="group" aria-label="Parts of the reference to take">{parts.map(p => <button key={p.id} type="button" id={'ref-part-' + p.id} className={'chip' + (on[p.id] ? ' on' : '')} aria-pressed={String(!!on[p.id])}
      onClick={() => patch({ reference: { parts: { [p.id]: !on[p.id] } } })}><Icon n={on[p.id] ? 'check' : 'plus'} />{p.label}</button>)}</div>
  </div>;
}

// One short line when the reference set the Look (or is about to), with the way back to your own picks
const READING = ['queued', 'downloading', 'tearing'];
export function RefNotice({ s, patch, id = 'ref-notice' }) {
  const r = s.reference, a = r.auto, reading = !r.extracted && r.mode !== 'off' && (r.status === 'running' || (r.queue || []).some(x => READING.includes(x.status)));
  if (reading) return <div className="ref-notice glass-card" id={id} role="status"><span className="rn-spin" aria-hidden="true" /><p><b>Reading the reference.</b> We will set your look from it when it is ready.</p></div>;
  if (!r.extracted || !a || r.mode === 'off') return null;
  const back = () => patch({ reference: { mode: 'off' } }).then(() => toast('Back to your own look. The reference is off.', true)).catch(() => {});
  return <div className="ref-notice glass-card" id={id} role="status" data-mode={a.mode}><Icon n="spark" />
    <p><b>{a.mode === 'recreate' ? 'We set your look from the reference.' : 'We set your picks from the reference.'}</b> {a.mode === 'recreate' ? 'Change anything you like.' : (a.sound ? 'Your Look stays yours. Change anything you like.' : 'Your Look and sound stay yours. Change anything you like.')}</p>
    <Button id={id + '-back'} size="sm" variant="secondary" label="Back to my look" onClick={back} /></div>;
}
