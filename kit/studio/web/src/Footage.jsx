import { useRef, useState } from 'react';
import { api, file, Icon, IconBtn } from './lib.jsx';
import { upload } from './upload.js';

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

export function Footage({ s, apply }) {
  return <section className="step" id="s-footage" data-step="footage" aria-labelledby="h-footage">
    <header className="sh"><h2 id="h-footage">Footage</h2><p className="sub">Your raw clip or a few takes.</p></header>
    <Dropzone id="drop-footage" inputId="file-footage" kind="footage" s={s} apply={apply} big multiple accept="video/*,.mov,.mp4,.m4v,.webm,.mkv" label="Add footage: drop video files or press Enter to choose">
      <Icon n="upload" className="di" /><strong>Drop video here</strong><span>or click to choose</span>
    </Dropzone>
    <ul id="footage" className="clips">
      {s.clips && <li className="note">Using the clips folder {s.clips}</li>}
      {s.footage.map(f => <li key={f} className="glass-card">
        <video src={file(f) + '#t=0.5'} muted preload="metadata" aria-label={f} />
        <span className="cap">{f.split('/').pop()}</span>
        <IconBtn n="x" label={'Remove ' + f.split('/').pop()} onClick={() => api('/api/footage/remove', { path: f }).then(apply)} />
      </li>)}
    </ul>
  </section>;
}
