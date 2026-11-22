// New video: clear the board and start a fresh reel, or open a past one. One small dialog with two short views.
// Nothing on disk is deleted: the server (kit/studio/core.mjs switchVideo) saves the current video's session first.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, toast, Icon, IconBtn } from './lib.jsx';
import { Toggle, Spinner } from './ui.jsx';

export const cleanJob = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 49).replace(/-+$/, '');
const when = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };
const reels = n => n ? `${n} reel${n === 1 ? '' : 's'}` : 'no reels yet';

export function NewVideo({ s, V, apply, go, mode, setMode }) {
  const ref = useRef(null), nameRef = useRef(null);
  const [name, setName] = useState(''), [keep, setKeep] = useState(true), [list, setList] = useState(null), [busy, setBusy] = useState(null), [err, setErr] = useState(''), [working, setWorking] = useState(false);
  const open = !!mode, running = V.task && V.task.status === 'running';
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) { d.showModal(); setErr(''); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setList(null);
    if (mode === 'new') { setName(''); requestAnimationFrame(() => nameRef.current && nameRef.current.focus()); }
  }, [open, mode]);
  // the list and what is still running, again whenever the session changes while the dialog is open
  useEffect(() => {
    if (!open) return;
    let live = true;
    api('/api/videos').then(j => { if (live) { setList(j.videos.filter(x => !x.current)); setBusy(j.busy); } }).catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [open, mode, running, s.rev]);
  const close = () => setMode(null);
  const done = (v, msg) => { apply(v); close(); go('start', true); toast(msg, true); };
  const start = async e => {
    if (e) e.preventDefault(); setWorking(true); setErr('');
    try { const v = await api('/api/videos/new', { name: cleanJob(name), keepLook: keep }); done(v, `New video: ${v.state.job}`); }
    catch (x) { setErr(x.message); } finally { setWorking(false); }
  };
  const openJob = async job => {
    setWorking(true); setErr('');
    try { const v = await api('/api/videos/open', { job }); done(v, `Opened ${job}`); }
    catch (x) { setErr(x.message); } finally { setWorking(false); }
  };
  const cancelTask = () => api('/api/task/cancel', {}).then(apply).catch(() => {});
  const blocked = busy || (running ? 'A task is running' : null);
  const clean = cleanJob(name);

  return <dialog ref={ref} className="fb nv glass" id="new-video" aria-labelledby="nv-h" onClose={close} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="fb-h"><h2 id="nv-h">{mode === 'open' ? 'Open a past video' : 'New video'}</h2><IconBtn n="x" label="Close" onClick={close} /></header>
    {mode === 'new' && <form className="nv-b" id="nv-form" onSubmit={start}>
      <p className="fine">A clean board for your next reel. Nothing is deleted{s.job ? <>: <b>{s.job}</b> is saved and you can open it again</> : ''}.</p>
      <label className="nv-name" htmlFor="nv-name"><span>Name</span>
        <input id="nv-name" ref={nameRef} placeholder="name-your-reel" autoComplete="off" spellCheck="false" value={name} onChange={e => setName(e.target.value)} aria-describedby="nv-name-hint" /></label>
      <p className="fine" id="nv-name-hint">{name && clean !== name ? <>Saved as <b className="mono">{clean || 'video-' + new Date().toISOString().slice(0, 10)}</b></> : 'Lowercase letters, numbers and dashes. Leave it empty for today\'s date.'}</p>
      <Toggle id="nv-keep" label="Keep my look" description="Pack, style picks, music, sound, pace, export and brand logos. After a reference, your own look." checked={keep} onChange={setKeep} />
    </form>}
    {mode === 'open' && <ul className="fb-list nv-list" id="nv-list" aria-label="Past videos">
      {!list ? <li className="fb-empty"><Spinner label="Loading videos" /></li>
        : list.length ? list.map(x => <li key={x.job}><button type="button" data-job={x.job} disabled={working || !!blocked} onClick={() => openJob(x.job)}>
          <Icon n="film" /><span className="nv-j">{x.job}</span><small className="nv-m">{[when(x.at), reels(x.outputs)].filter(Boolean).join(', ')}</small></button></li>)
        : <li className="fine fb-empty">No past videos yet.</li>}
    </ul>}
    {blocked && <p className="nv-busy" role="status" id="nv-busy"><Icon n="info" />{blocked}. Cancel it or let it finish first.{running && <button type="button" className="linkish" id="nv-cancel-task" onClick={cancelTask}>Cancel it</button>}</p>}
    <p className="fine fb-err" role="alert" id="nv-err">{err}</p>
    <footer className="fb-f">
      <span className="grow">{mode === 'new'
        ? <button type="button" className="linkish" id="nv-to-open" onClick={() => setMode('open')}>Open a past video</button>
        : <button type="button" className="linkish" id="nv-to-new" onClick={() => setMode('new')}>Start a new one instead</button>}</span>
      <Button type="button" id="nv-cancel" variant="ghost" size="sm" label="Cancel" onClick={close} />
      {mode === 'new' && <Button type="submit" form="nv-form" id="nv-start" variant="primary" size="sm" label="Start fresh" isLoading={working} isDisabled={!!blocked} />}
    </footer>
  </dialog>;
}
