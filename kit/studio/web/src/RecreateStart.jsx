// The mode choice on Start: Just my footage, Recreate a video (same edit, your take) or Copy the look (same style,
// your script). Recreate and Copy the look open the reference box (a link or a file) and set reference.mode; Copy the
// look can also use a look saved from an earlier reference, with no reference at all. The same queue and breakdown
// as the Picture step (RefCard.jsx and the /api/reference routes); nothing is read or decided here.
import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, quiet, toast, Icon, STATUS } from './lib.jsx';
import { upload } from './upload.js';
import { READING, refName, LookChips } from './RefCard.jsx';

export const START_MODES = [
  ['own', 'Just my footage', 'We edit it from your picks', 'film'],
  ['recreate', 'Recreate a video', 'Same edit, your take', 'dup'],
  ['look', 'Copy the look', 'Same style, your script', 'spark'],
];

export function StartMode({ s, apply, patch, go, looks }) {
  const r = s.reference, q = r.queue || [], ex = r.extracted, sm = (ex && ex.summary) || {};
  const [local, setLocal] = useState(null), [url, setUrl] = useState(''), [busy, setBusy] = useState(false);
  const fileIn = useRef(null), box = useRef(null);
  const reading = q.find(x => READING.includes(x.status)), last = q[q.length - 1];
  const failed = !ex && !reading && last && last.status === 'failed' ? last : null;
  const has = !!(ex || reading || r.status === 'running' || r.status === 'uploaded');
  // what is in use decides the choice; before any reference is in, the card you clicked does
  const choice = has ? (r.mode === 'recreate' ? 'recreate' : r.mode === 'look' ? 'look' : r.mode === 'off' ? (s.styleLook ? 'look' : 'own') : null) : s.styleLook ? 'look' : local || 'own';
  const needJob = () => { if (s.job) return false; toast('Name the reel first (top left)'); document.getElementById('job')?.focus(); return true; };
  const setMode = m => (m === 'look' ? quiet('/api/state', { reference: { mode: m } }).then(j => { if (j) apply(j); }) : patch({ reference: { mode: m } }).catch(() => {}));
  const pick = m => {
    if (m === choice) return;
    if (m !== 'own' && needJob()) return;
    setLocal(m);
    if (m === 'own') { if (has && r.mode !== 'off') setMode('off'); if (s.styleLook && looks) looks.pick(null); return; }
    if (r.mode !== m) setMode(m);
    if (m === 'recreate' && s.styleLook && looks) looks.pick(null);
  };
  const onKey = e => {
    const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0; if (!d) return;
    e.preventDefault(); const i = Math.max(0, START_MODES.findIndex(([m]) => m === choice)), n = START_MODES[(i + d + START_MODES.length) % START_MODES.length][0];
    pick(n); requestAnimationFrame(() => document.getElementById('mode-' + n)?.focus());
  };
  const breakDown = () => api('/api/reference', {}).then(apply).catch(() => {});
  const addLink = async e => {
    e.preventDefault(); const u = url.trim(); if (!u) { toast('Paste a link first'); return; }
    setBusy(true);
    try { const j = await api('/api/reference/url', { urls: u.split(/\s+/) }); apply(j); setUrl(''); const bad = j.added.find(x => x.status === 'failed'); if (bad) toast(bad.error, false, bad.fix); } catch {} finally { setBusy(false); }
  };
  const addFile = async files => { if (!files.length) return; await upload('reference', files.slice(0, 1), s, apply); breakDown(); };

  const meta = [sm.seconds ? `${Math.round(sm.seconds)} s` : null, ex && ex.shots ? `${ex.shots} shots` : null].filter(Boolean).join(', ');
  const isLook = choice === 'look', open = choice === 'recreate' || isLook;
  const saved = isLook && looks && looks.list.length ? looks.list : null, using = !has && s.styleLook ? s.styleLook : null;
  return <div className="start-mode" id="start-mode-box">
    <h3 className="lbl" id="start-mode-h">What should guide the edit?</h3>
    <div className="mode-cards" role="radiogroup" aria-labelledby="start-mode-h" id="start-mode" onKeyDown={onKey}>
      {START_MODES.map(([m, label, line, icon], k) => <button key={m} type="button" role="radio" id={'mode-' + m} data-mode={m} className="mode-card glass-card" aria-checked={choice === m ? 'true' : 'false'} tabIndex={choice === m || (!choice && k === 0) ? 0 : -1} onClick={() => pick(m)}>
        <Icon n={icon} /><span className="mc-t"><b>{label}</b><span className="fine">{line}</span></span><span className="mc-on" aria-hidden="true"><Icon n="check" /></span></button>)}
    </div>
    {has && !choice && <p className="fine" id="start-mode-note">Your reference is on Influence: we take only the parts you switched on. <button type="button" className="linkish" onClick={() => go('picture', true)}>Change it on Picture</button></p>}
    {open && <div className="rs glass-card" id="recreate-card" ref={box} data-state={ex ? 'ready' : has ? 'reading' : 'empty'} data-mode={choice}>
      <b className="rs-h" id="recreate-h">{has ? 'Your reference' : isLook ? 'The video whose look you want' : 'The video to recreate'}</b>
      {ex ? <p className="rs-line" id="recreate-ready"><Icon n="check" /><span><b>{refName(s)}</b>{meta ? `, ${meta}` : ''}. {isLook ? 'We copy its style. Your own words set the timing.' : 'We follow its cuts and timing on your take.'}</span>
          <button type="button" className="linkish" id="recreate-details" onClick={() => go('reference', true)}>See how it was made</button></p>
        : r.status === 'uploaded' ? <p className="rs-line" id="recreate-uploaded"><span>Your file is here.</span><Button id="recreate-go" size="sm" variant="secondary" label="Break down the file" onClick={breakDown} /></p>
        : has ? <p className="rs-line" id="recreate-reading" role="status"><span className="rn-spin" aria-hidden="true" /><span>{reading ? `${STATUS[reading.status]}${reading.status === 'downloading' && reading.progress ? ` ${reading.progress}%` : ''}` : 'Breaking down'}. Record or add your footage while we read it.</span></p>
        : using ? <p className="rs-line" id="recreate-using"><Icon n="check" /><span>Using your saved look <b>{using}</b>. No reference needed.</span></p>
        : <form className="row rs-form" onSubmit={addLink}>
          <label className="sr" htmlFor="recreate-link">{isLook ? 'Link to the video whose look you want' : 'Link to the video to recreate'}</label>
          <input id="recreate-link" className="grow" type="url" inputMode="url" placeholder="Paste a video link" spellCheck="false" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} />
          <Button id="recreate-add" type="submit" variant="primary" label="Add" isLoading={busy} />
          <Button id="recreate-upload" type="button" variant="secondary" label="Upload" icon={<Icon n="upload" />} onClick={() => fileIn.current.click()} />
          <input type="file" id="recreate-file" ref={fileIn} accept="video/*,.mov,.mp4,.m4v,.webm,.mkv" hidden onChange={e => { addFile([...e.target.files]); e.target.value = ''; }} />
        </form>}
      {failed && <p className="err" id="recreate-err" role="alert">{failed.error}</p>}
      {saved && !has && <div className="saved-looks" id="saved-looks"><span className="lbl" id="saved-looks-h">{using ? 'Your saved looks' : 'Or use a saved look'}</span>
        <ul className="sl-list" aria-labelledby="saved-looks-h">{saved.map(x => <li key={x.name}><button type="button" className={'chip' + (s.styleLook === x.name ? ' on' : '')} data-look={x.name} aria-pressed={String(s.styleLook === x.name)} title={x.from ? `Saved from ${x.from}` : undefined} onClick={() => looks.pick(s.styleLook === x.name ? null : x.name)}>
          {s.styleLook === x.name && <Icon n="check" />}{x.name}</button></li>)}</ul>
        {using && <LookChips summary={(saved.find(x => x.name === using) || {}).summary} id="saved-look-chips" />}</div>}
    </div>}
  </div>;
}
