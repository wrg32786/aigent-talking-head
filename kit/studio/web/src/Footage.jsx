import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { api, file, toast, Icon, IconBtn } from './lib.jsx';
import { upload } from './upload.js';
import { Recorder } from './Recorder.jsx';
import { Scripts } from './Scripts.jsx';
import { Player, clock } from './Player.jsx';
import { Toggle, Hint } from './ui.jsx';
import { RecreateStart } from './RecreateStart.jsx';

export function Dropzone({ id, inputId, kind, s, apply, accept, multiple, big, children, label }) {
  const input = useRef(null); const [over, setOver] = useState(false);
  const pick = () => input.current.click();
  return <div className={'drop' + (big ? ' big' : '') + (over ? ' over' : '')} id={id} tabIndex={0} role="button" aria-label={label}
    onClick={pick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
    onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={e => { e.preventDefault(); setOver(false); upload(kind, [...e.dataTransfer.files], s, apply); }}>
    {children}
    <input type="file" id={inputId} ref={input} accept={accept} multiple={multiple} hidden onClick={e => e.stopPropagation()} onChange={e => { upload(kind, [...e.target.files], s, apply); e.target.value = ''; }} />
  </div>;
}

const SITES = { dropbox: 'Dropbox', drive: 'Google Drive', direct: 'Link' };
export const bytes = n => n == null ? '' : n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
// paste a public Dropbox or Google Drive share link, or a direct video URL; the server downloads it into the footage
export function FootageLink({ s, apply }) {
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false);
  const add = async ev => {
    ev.preventDefault(); const u = url.trim(); if (!u) return;
    if (!s.job) { toast('Name the reel first (top left)'); document.getElementById('job')?.focus(); return; }
    setBusy(true); try { apply(await api('/api/footage/url', { url: u })); setUrl(''); } catch {} finally { setBusy(false); }
  };
  const items = (s.imports || []).slice().reverse();
  return <div className="flink glass-card" id="footage-link-box">
    <form className="row" onSubmit={add}>
      <Icon n="link" className="fl-ic" />
      <label className="sr" htmlFor="footage-link">Footage link</label>
      <input id="footage-link" className="grow" type="url" inputMode="url" placeholder="Paste a Dropbox or Google Drive link, or a video URL" spellCheck="false" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} />
      <Button id="footage-link-add" type="submit" variant="secondary" label="Add" isLoading={busy} />
      <Hint id="footage-link-hint" label="Which links work" align="end">Public share links only. Private links need a login, so download those and drop the file in.</Hint>
    </form>

    {items.length > 0 && <ul className="imports" id="imports">
      {items.map(x => <li key={x.id} className={'imp ' + x.status} data-status={x.status}>
        <span className="imp-h"><b>{x.name || SITES[x.site]}</b><span className="fine">{SITES[x.site]}{x.status === 'downloading' ? `, ${bytes(x.received)}${x.size ? ' of ' + bytes(x.size) : ''}` : x.status === 'ready' ? `, ${bytes(x.size)}, in your footage` : ''}</span></span>
        {x.status === 'downloading' && <ProgressBar label={`Downloading ${x.name || 'the file'}`} isLabelHidden value={x.size ? Math.round(100 * x.received / x.size) : undefined} isIndeterminate={!x.size} />}
        {x.status === 'failed' && <span className="err" role="alert">{x.error}</span>}
        <span className="imp-a">{x.status === 'downloading' ? <IconBtn n="x" label="Cancel the download" onClick={() => api('/api/footage/import', { id: x.id, action: 'cancel' }).then(apply).catch(() => {})} />
          : <IconBtn n="x" label="Dismiss" onClick={() => api('/api/footage/import', { id: x.id, action: 'dismiss' }).then(apply).catch(() => {})} />}</span>
      </li>)}
    </ul>}
  </div>;
}

export function Footage({ V, s, apply, patch, go, hidden, onLive }) {
  const [readId, setReadId] = useState(null);
  const [playing, setPlaying] = useState(null), drag = useRef(null), [over, setOver] = useState(null);
  // reorder in place: drag a clip onto another, or the arrow buttons; the draft uses this order
  const move = (f, to) => api('/api/footage/move', { path: f, to }).then(apply).catch(() => {});
  const secs = Object.fromEntries(((V.cut && V.cut.footage) || []).map(x => [x.path, x.seconds]));
  const showing = playing && s.footage.includes(playing) ? playing : null;
  const [rec, setRec] = useState(() => localStorage.getItem('studio.rec.open') === '1' || /record/.test(location.hash));
  const open = v => { localStorage.setItem('studio.rec.open', v ? '1' : '0'); setRec(v); };
  const needJob = () => { if (s.job) return false; toast('Name the reel first (top left)'); document.getElementById('job')?.focus(); return true; };
  return <section className="step" id="s-footage" data-step="footage" aria-labelledby="h-footage" hidden={hidden}>
    <header className="sh"><h2 id="h-footage">Footage</h2><p className="sub">Your raw clip, a few takes, or film one now from a script.</p></header>
    {rec ? <Recorder V={V} s={s} apply={apply} onClose={() => open(false)} onLive={onLive} visible={!hidden} scriptId={readId} />
      : <div className="sources">
        <Dropzone id="drop-footage" inputId="file-footage" kind="footage" s={s} apply={apply} big multiple accept="video/*,.mov,.mp4,.m4v,.webm,.mkv" label="Add footage: drop video files or press Enter to choose">
          <Icon n="upload" className="di" /><strong>Drop video here</strong><span>or click to choose</span>
        </Dropzone>
        <button type="button" className="drop big recsrc" id="record-now" onClick={() => { if (!needJob()) open(true); }}>
          <Icon n="camera" className="di" /><strong>Record now</strong><span>Camera and mic on this computer</span>
        </button>
      </div>}
    {!rec && <FootageLink s={s} apply={apply} />}
    {!rec && <RecreateStart s={s} apply={apply} patch={patch} go={go} />}
    <Scripts V={V} s={s} apply={apply} onRead={id => { if (needJob()) return; setReadId(id); open(true); requestAnimationFrame(() => document.getElementById('recorder')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }} />
    {showing && <Player apply={apply} path={showing} tx={(s.tx || {})[showing]} onClose={() => setPlaying(null)} />}
    <ul id="footage" className="clips">
      {s.clips && <li className="note">Using the clips folder {s.clips}</li>}
      {s.footage.map((f, k) => <li key={f} data-path={f} className={'glass-card' + (showing === f ? ' on' : '') + (over === k ? ' drop-to' : '')} draggable={s.footage.length > 1}
        onDragStart={e => { drag.current = k; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f); }}
        onDragOver={e => { if (drag.current == null) return; e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(o => (o === k ? null : o))}
        onDrop={e => { if (drag.current == null) return; e.preventDefault(); const from = drag.current; drag.current = null; setOver(null); if (from !== k) move(s.footage[from], k); }}
        onDragEnd={() => { drag.current = null; setOver(null); }}>
        {s.footage.length > 1 && <span className="clip-n mono" aria-hidden="true">{k + 1}</span>}
        <button type="button" className="clip-play" aria-label={'Play ' + f.split('/').pop()} onClick={() => setPlaying(showing === f ? null : f)}>
          <video src={file(f) + '#t=0.5'} muted preload="metadata" aria-label={f} tabIndex={-1} />
          <span className="clip-ov" aria-hidden="true"><Icon n="play" /></span>{secs[f] ? <span className="clip-dur mono">{clock(secs[f])}</span> : null}
        </button>
        <span className="cap">{f.split('/').pop()}</span>
        {s.footage.length > 1 && <span className="clip-mv">
          <IconBtn n="left" label={'Move ' + f.split('/').pop() + ' earlier'} disabled={k === 0} onClick={() => move(f, k - 1)} />
          <IconBtn n="right" label={'Move ' + f.split('/').pop() + ' later'} disabled={k === s.footage.length - 1} onClick={() => move(f, k + 1)} />
        </span>}
        <IconBtn n="x" label={'Remove ' + f.split('/').pop()} onClick={() => api('/api/footage/remove', { path: f }).then(apply)} />
      </li>)}
    </ul>
    {s.footage.length > 0 && !s.clips && <div className="as-is"><Toggle id="as-is" label="Already cut: use each file as it is" description="One clip per file, in this order, no second cut." checked={!!s.asIs} onChange={v => api('/api/state', { asIs: v }).then(apply).catch(() => {})} /></div>}
  </section>;
}
