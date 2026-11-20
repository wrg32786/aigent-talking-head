// Folder fields for Settings: type a full path, or Browse. Browse asks the local server to open this computer's own
// folder dialog (Explorer, Finder, zenity or kdialog) and fills in the full path. When there is no dialog (or with
// Folder list) the page shows its own folder browser, backed by /api/folders: folder names only, never files.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon, IconBtn, toast } from './lib.jsx';

// every folder call carries x-studio-page: 1; the server refuses folder calls without it
export async function fapi(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-studio-page': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}

export function FolderField({ id, label, value, onChange, placeholder, defaultPath, title, note }) {
  const [browse, setBrowse] = useState(null), [busy, setBusy] = useState(false);
  const start = value.trim() || defaultPath || '';
  const pick = async () => {
    setBusy(true);
    try { const j = await fapi('/api/folders/pick', { start, title: title || 'Choose a folder for ' + label.toLowerCase() });
      if (j.path) { onChange(j.path); toast('Folder picked. Save to keep it.', true); } else if (j.unavailable) setBrowse(start || ''); }
    catch (e) { setBrowse(start || ''); } finally { setBusy(false); }
  };
  const open = () => fapi('/api/folders/open', { path: start }).then(j => toast(j.dry ? 'Would open ' + j.opened : 'Opened ' + j.opened, true)).catch(e => toast(e.message));
  return <div className="ffield" id={id + '-field'}>
    <label className="lbl" htmlFor={id}>{label}</label>
    <div className="ff-row">
      <input id={id} className="grow" placeholder={placeholder} spellCheck="false" autoComplete="off" value={value} onChange={e => onChange(e.target.value)} />
      <Button type="button" id={id + '-browse'} variant="secondary" size="sm" label="Browse" icon={<Icon n="folder" />} isLoading={busy} onClick={pick} />
    </div>
    <div className="ff-act">
      <button type="button" className="linkish" id={id + '-list'} onClick={() => setBrowse(start || '')}>Folder list</button>
      <button type="button" className="linkish" id={id + '-open'} onClick={open}>Open folder</button>
      <button type="button" className="linkish" id={id + '-reset'} disabled={!value} onClick={() => onChange('')}>Reset to default</button>
    </div>
    {note && <p className="fine">{note}</p>}
    {browse !== null && <FolderBrowser start={browse} title={title || label} onClose={() => setBrowse(null)} onPick={p => { onChange(p); setBrowse(null); toast('Folder picked. Save to keep it.', true); }} />}
  </div>;
}

export function FolderBrowser({ start, title, onClose, onPick }) {
  const ref = useRef(null), [v, setV] = useState(null), [err, setErr] = useState(''), [mk, setMk] = useState(null);
  const go = p => fapi('/api/folders' + (p ? '?path=' + encodeURIComponent(p) : '')).then(j => { setV(j); setErr(''); setMk(null); })
    .catch(e => { if (p && !v) return go(''); setErr(e.message); });
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); go(start); }, []);
  const make = async e => { if (e) e.preventDefault(); if (!mk || !mk.trim()) return; try { const j = await fapi('/api/folders/new', { path: v.path, name: mk }); setV(j); setMk(null); setErr(''); } catch (x) { setErr(x.message); } };
  const home = v && v.places.find(x => x.id === 'home');
  return <dialog ref={ref} className="fb glass" id="folder-browser" aria-labelledby="fb-h" onClose={onClose} onCancel={e => { e.preventDefault(); ref.current.close(); }}
    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); } }}>
    <header className="fb-h"><h2 id="fb-h">{title}</h2><IconBtn n="x" label="Close the folder list" onClick={() => ref.current.close()} /></header>
    {v && <>
      <ul className="fb-places" aria-label="Places">{v.places.map(x => <li key={x.id}><button type="button" className={'chip' + (x.path === v.path ? ' on' : '')} data-place={x.id} onClick={() => go(x.path)}>{x.label}</button></li>)}</ul>
      <div className="fb-bar">
        <IconBtn n="up" label="Up one folder" id="fb-up" disabled={!v.parent} onClick={() => go(v.parent)} />
        <IconBtn n="home" label="Home folder" id="fb-home" onClick={() => home && go(home.path)} />
        <nav className="fb-crumbs" aria-label="Folder path"><ol>{v.crumbs.map((c, i) => <li key={c.path}><button type="button" aria-current={i === v.crumbs.length - 1 ? 'location' : undefined} onClick={() => go(c.path)}>{c.name}</button></li>)}</ol></nav>
      </div>
      <ul className="fb-list" id="fb-list" aria-label={'Folders in ' + v.path}>
        {v.folders.length ? v.folders.map(f => <li key={f.path}><button type="button" data-name={f.name} onClick={() => go(f.path)}><Icon n="folder" /><span>{f.name}</span></button></li>)
          : <li className="fine fb-empty">No folders in here.</li>}
      </ul>
      {mk !== null && <div className="fb-new" role="group" aria-label="New folder"><label className="sr" htmlFor="fb-new-name">New folder name</label>
        <input id="fb-new-name" autoFocus placeholder="New folder name" value={mk} onChange={e => setMk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') make(e); }} />
        <Button type="button" id="fb-new-ok" size="sm" variant="secondary" label="Make it" isDisabled={!mk.trim()} onClick={() => make()} /><Button type="button" size="sm" variant="ghost" label="Cancel" onClick={() => setMk(null)} /></div>}
    </>}
    <p className="fine fb-err" role="status">{err}</p>
    <footer className="fb-f">
      <span className="fb-path mono" id="fb-path" title={v ? v.path : ''}>{v ? v.path : 'Loading...'}</span>
      <Button type="button" id="fb-new" size="sm" variant="ghost" label="New folder" icon={<Icon n="plus" />} isDisabled={!v || !v.writable || mk !== null} onClick={() => setMk('')} />
      <Button type="button" id="fb-use" size="sm" variant="primary" label="Use this folder" isDisabled={!v} onClick={() => onPick(v.path)} />
    </footer>
  </dialog>;
}
