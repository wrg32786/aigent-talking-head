// The reference's shared pieces, used by Start (RecreateStart.jsx), the Picture step card (Style.jsx) and the Breakdown (Reference.jsx):
// RefMode (one control, one vocabulary), RefPlan (what Recreate brings, as chips), RefParts (Influence switches)
// RefNotice (one line while a reference is read, or when it set your Look), SavedLookNote (your saved look is in use,
// not the reference's, with the one switch) and TitleCheckLine (titles the breakdown may have misread).
import { useEffect, useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, toast, Icon } from './lib.jsx';

// the two labels for what a reference gives you: a built-in option it picked, and a scene made from it for the menu
export const REF_LABEL = 'From reference', MADE_LABEL = 'Made for you';
export const READING = ['queued', 'downloading', 'tearing'];
// one vocabulary everywhere a reference is used: Recreate, Copy the look, Influence, Off (reference.mode)
export const REF_MODES = [['recreate', 'Recreate'], ['look', 'Copy the look'], ['influence', 'Influence'], ['off', 'Off']];
export const REF_HINT = {
  recreate: 'Same edit, your take: its cuts and timing, with its look, titles, sounds and music.',
  look: 'Same style, your script: its look and sound, with the timing from your own words.',
  influence: 'Only the parts you switch on. Everything else stays yours.',
  off: 'Kept here, not used.',
};
// the name we show for the reference in use
export function refName(s) {
  const r = s.reference || {}, ex = r.extracted, item = (r.queue || []).find(x => x.id === r.active);
  return (ex && ex.name) || (item && (item.title || item.url)) || 'your reference';
}
// the mode in plain words for the Your edit line: null when no reference and no saved look is in use
export function refSays(s) {
  const r = s.reference || {}, on = !!r.extracted && r.mode !== 'off';
  if (on && r.mode === 'recreate') return `Recreating ${refName(s)}`;
  if (on && r.mode === 'look') return `The look of ${refName(s)}, your words`;
  if (!on && s.styleLook) return `The look of ${s.styleLook}, your words`;
  return null;
}
// what the reference brought to the sound, in plain words (no tempo numbers): "no music, 4 sounds, fast tempo"
export function refBrought(s) {
  const r = s.reference || {}, ex = r.extracted; if (!ex || r.mode === 'off') return null;
  const mu = { ...((ex.summary && ex.summary.music) || {}), ...(ex.music || {}) }, pl = ex.plan || {}, bpm = +((ex.summary && ex.summary.music) || {}).bpm || 0;
  const music = mu.noBed || pl.noBed ? 'no music' : mu.energy ? `${mu.energy} energy music` : mu.bed ? 'music' : null;
  const bits = [music, pl.sounds > 0 ? `${pl.sounds} sound${pl.sounds === 1 ? '' : 's'}` : null, bpm ? `${bpm < 90 ? 'slow' : bpm < 118 ? 'medium' : 'fast'} tempo` : null].filter(Boolean);
  return bits.length ? bits.join(', ') : null;
}
// a saved look in a few words (GET /api/style-looks summary): only the parts it has, never an empty row
const LOOK_PARTS = [['framing', 'Framing'], ['grade', 'Color'], ['captions', 'Captions'], ['pace', 'Pace'], ['music', 'Music'], ['sfx', 'Sounds']];
const calm = t => t.split(';')[0].replace(/\s*\([^)]*\)/g, '').replace(/,?\s*#[0-9a-f]{3,8}\b/gi, '').replace(/\s+/g, ' ').trim();
const say0 = v => (v == null || v === '' ? null : v === true ? 'yes' : v === false ? 'none' : Array.isArray(v) ? v.slice(0, 3).join(', ') : typeof v === 'object' ? (v.label || v.name || v.style || null) : String(v));
const say = v => { const t = say0(v); return t ? calm(t) || null : null; };
export function LookChips({ summary, id }) {
  const bits = summary ? LOOK_PARTS.map(([k, l]) => [k, l, say(summary[k])]).filter(x => x[2]) : [];
  if (!bits.length) return null;
  return <ul className="ref-plan look-chips" id={id} aria-label="What this look sets">{bits.map(([k, l, v]) => <li key={k} className="rp-chip" data-part={k}><span className="rp-k">{l}</span>{v}</li>)}</ul>;
}

// How the reference is used: Recreate, Copy the look, Influence or Off, with one line for the mode you are in
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
  const pl = mode === 'recreate' ? ex.plan : mode === 'look' && ex.plan ? { framing: ex.plan.framing, sounds: ex.plan.sounds, noBed: ex.plan.noBed } : null, made = ex.scenes || [];
  const bits = pl ? [pl.shots > 1 && ['shots', count(pl.shots, 'shot')], pl.framing && pl.framing.length > 0 && ['framing', pl.framing.slice(0, 3).join(', ')],
    pl.cutaways > 0 && ['cutaways', count(pl.cutaways, 'cutaway')], pl.sounds > 0 && ['sounds', count(pl.sounds, 'sound')], pl.noBed && ['music', 'No music']].filter(Boolean) : [];
  if (!bits.length && !made.length) return null;
  const names = made.map(x => x.name).join(', '), madeId = id === 'ref-plan' ? 'ref-made' : id.replace('ref-plan', 'ref-made');
  return <ul className="ref-plan" id={id} aria-label={REF_LABEL}>
    {bits.map(([k, v]) => <li key={k} className="rp-chip" data-plan={k}>{v}</li>)}
    {made.length > 0 && <li className="rp-li">{onMade
      ? <button type="button" className="rp-chip rp-made" id={madeId} title={names} onClick={() => onMade(made)}><Icon n="spark" />{made.length} {MADE_LABEL.toLowerCase()}</button>
      : <span className="rp-chip rp-made" id={madeId} title={names}><Icon n="spark" />{made.length} {MADE_LABEL.toLowerCase()}</span>}</li>}
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
export function RefNotice({ s, patch, id = 'ref-notice' }) {
  const r = s.reference, a = r.auto, reading = !r.extracted && r.mode !== 'off' && (r.status === 'running' || (r.queue || []).some(x => READING.includes(x.status)));
  if (reading) return <div className="ref-notice glass-card" id={id} role="status"><span className="rn-spin" aria-hidden="true" /><p><b>Reading the reference.</b> We will set your look from it when it is ready.</p></div>;
  if (!r.extracted || !a || r.mode === 'off') return null;
  const back = () => patch({ reference: { mode: 'off' } }).then(() => toast('Back to your own look. The reference is off.', true)).catch(() => {});
  return <div className="ref-notice glass-card" id={id} role="status" data-mode={a.mode}><Icon n="spark" />
    <p><b>{a.mode === 'recreate' || a.mode === 'look' ? 'We set your look from the reference.' : 'We set your picks from the reference.'}</b> {a.mode === 'recreate' || a.mode === 'look' ? 'Change anything you like.' : (a.sound ? 'Your Look stays yours. Change anything you like.' : 'Your Look and sound stay yours. Change anything you like.')}</p>
    <Button id={id + '-back'} size="sm" variant="secondary" label="Back to my look" onClick={back} /></div>;
}

// The reference wins by default, so this shows only when an earlier look is in use over it: the reference is Off
// (Back to my look) or on Influence (the server's savedLook, kit/studio/reference.mjs savedLookOf). One line, one
// button that sets the board from the reference alone; Undo is on the change note.
export function SavedLookNote({ V, apply, id = 'saved-look' }) {
  const sl = V && V.savedLook; if (!sl || !sl.inUse) return null;
  const use = () => api('/api/reference/use-look', {}).then(j => { apply(j); toast(j.note, true); }).catch(() => {});
  return <div className="ref-notice saved-look glass-card" id={id} role="status" title={'In use: ' + sl.by.map(b => b.label).join(', ')}><Icon n="info" />
    <p><b id={id + '-text'}>{sl.text}</b></p>
    <Button id={id + '-use'} size="sm" variant="primary" label="Use the reference's look" onClick={use} /></div>;
}

// Recreate draws the reference's titles, so titles the breakdown is not sure of are worth a look before a draft
export const titleChecks = s => { const r = s.reference || {}; return r.mode === 'recreate' && r.extracted ? (r.extracted.checks || []).length : 0; };
export function TitleCheckLine({ s, go, id = 'title-check-line' }) {
  const n = titleChecks(s); if (!n) return null;
  return <p className="fine title-check-line" id={id} role="status"><Icon n="info" /><span>{n === 1 ? '1 title may be misread.' : `${n} titles may be misread.`} <button type="button" className="linkish" id={id + '-go'} onClick={() => go && go('reference', true)}>{n === 1 ? 'Check it before you draft.' : 'Check them before you draft.'}</button></span></p>;
}
