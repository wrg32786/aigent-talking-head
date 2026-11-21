// Recreate a video, from the first screen: add the reel to copy (a link or a file), choose how to use it, then record
// or add your footage as usual. The same queue, breakdown and mode control as the Look step (RefCard.jsx and the
// /api/reference routes); nothing is read or decided here.
import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, toast, Icon, IconBtn, STATUS } from './lib.jsx';
import { upload } from './upload.js';
import { RefMode, READING } from './RefCard.jsx';

export function RecreateStart({ s, apply, patch, go }) {
  const r = s.reference, q = r.queue || [], ex = r.extracted, sm = (ex && ex.summary) || {};
  const [open, setOpen] = useState(false), [url, setUrl] = useState(''), [busy, setBusy] = useState(false);
  const fileIn = useRef(null);
  const reading = q.find(x => READING.includes(x.status)), last = q[q.length - 1];
  const failed = !ex && !reading && last && last.status === 'failed' ? last : null;
  const has = !!(ex || reading || r.status === 'running' || r.status === 'uploaded');
  const needJob = () => { if (s.job) return false; toast('Name the reel first (top left)'); document.getElementById('job')?.focus(); return true; };
  // opening it is the choice: the reference you add next is used to Recreate (change it on the control below)
  const start = () => { if (needJob()) return; setOpen(true); if (r.mode !== 'recreate') patch({ reference: { mode: 'recreate' } }).catch(() => {}); };
  const breakDown = () => api('/api/reference', {}).then(apply).catch(() => {});
  const addLink = async e => {
    e.preventDefault(); const u = url.trim(); if (!u) { toast('Paste a link first'); return; }
    setBusy(true);
    try { const j = await api('/api/reference/url', { urls: u.split(/\s+/) }); apply(j); setUrl(''); const bad = j.added.find(x => x.status === 'failed'); if (bad) toast(bad.error, false, bad.fix); } catch {} finally { setBusy(false); }
  };
  const addFile = async files => { if (!files.length) return; await upload('reference', files.slice(0, 1), s, apply); breakDown(); };

  if (!open && !has) return <button type="button" className="rs-open glass-card" id="recreate-open" onClick={start}>
    <Icon n="spark" /><span className="rs-t"><b>Recreate a video</b><span className="fine">Start from a reel you like</span></span><Icon n="right" className="rs-go" /></button>;

  const meta = [sm.seconds ? `${Math.round(sm.seconds)} s` : null, ex && ex.shots ? `${ex.shots} shots` : null].filter(Boolean).join(', ');
  const item = q.find(x => x.id === r.active), name = ex ? (ex.name || (item && (item.title || item.url)) || 'Your reference') : '';
  return <div className="rs glass-card" id="recreate-card" data-state={ex ? 'ready' : has ? 'reading' : 'empty'}>
    <div className="rs-h"><b id="recreate-h">{has ? 'Your reference' : 'Recreate a video'}</b>{!has && <IconBtn n="x" label="Close" onClick={() => setOpen(false)} />}</div>
    {ex ? <p className="rs-line" id="recreate-ready"><Icon n="check" /><span><b>{name}</b>{meta ? `, ${meta}` : ''}. Now add your footage.</span>
        <button type="button" className="linkish" id="recreate-details" onClick={() => go('reference', true)}>Breakdown</button></p>
      : r.status === 'uploaded' ? <p className="rs-line" id="recreate-uploaded"><span>Your file is here.</span><Button id="recreate-go" size="sm" variant="secondary" label="Break down the file" onClick={breakDown} /></p>
      : has ? <p className="rs-line" id="recreate-reading" role="status"><span className="rn-spin" aria-hidden="true" /><span>{reading ? `${STATUS[reading.status]}${reading.status === 'downloading' && reading.progress ? ` ${reading.progress}%` : ''}` : 'Breaking down'}. Record or add your footage while it reads.</span></p>
      : <form className="row rs-form" onSubmit={addLink}>
        <label className="sr" htmlFor="recreate-link">Link to the video to recreate</label>
        <input id="recreate-link" className="grow" type="url" inputMode="url" placeholder="Paste a video link" spellCheck="false" autoComplete="off" autoFocus value={url} onChange={e => setUrl(e.target.value)} />
        <Button id="recreate-add" type="submit" variant="primary" label="Add" isLoading={busy} />
        <Button id="recreate-upload" type="button" variant="secondary" label="Upload" icon={<Icon n="upload" />} onClick={() => fileIn.current.click()} />
        <input type="file" id="recreate-file" ref={fileIn} accept="video/*,.mov,.mp4,.m4v,.webm,.mkv" hidden onChange={e => { addFile([...e.target.files]); e.target.value = ''; }} />
      </form>}
    {failed && <p className="err" id="recreate-err" role="alert">{failed.error}</p>}
    <RefMode id="recreate-mode" mode={r.mode} patch={patch} />
  </div>;
}
