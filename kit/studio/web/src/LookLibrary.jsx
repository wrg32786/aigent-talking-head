// The Look library on the Teardowns tab: saved looks with a playable sample, rename, duplicate and delete (asks first).
import { useEffect, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { api, toast, Icon } from './lib.jsx';
import { MoreMenu } from './ui.jsx';

export const PARTS = [
  { id: 'captions', label: 'Captions' },
  { id: 'titles', label: 'Titles' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'grade', label: 'Grade' },
  { id: 'effects', label: 'Effects' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'pace', label: 'Pace' },
  { id: 'sound', label: 'Music and sound' },
  { id: 'fonts', label: 'Fonts and theme' },
];

export function useLooks() {
  const [list, setList] = useState(null), [err, setErr] = useState('');
  const reload = () => api('/api/style-looks').then(j => { setList(j.looks || []); setErr(''); }).catch(e => setErr(e.message));
  useEffect(() => { reload(); }, []);
  return { list, err, reload, setList };
}

function Sample({ x, onBuild, busy }) {
  const [sound, setSound] = useState(false);
  const st = (x.sample && x.sample.status) || 'missing';
  if (st === 'ready' && x.sample.url) {
    return <div className="look-sample">
      <video src={x.sample.url} poster="" muted={!sound} loop playsInline autoPlay={ !sound } controls={sound} aria-label={`Sample of ${x.label}`} />
      <button type="button" className="btn sm ghost look-sound" id={`look-sound-${x.name}`} onClick={() => setSound(s => !s)}>{sound ? 'Mute' : 'Play with sound'}</button>
    </div>;
  }
  if (st === 'building') {
    return <div className="look-sample look-sample-wait"><Icon n="spark" /><p className="fine">Making the sample</p></div>;
  }
  // an old sample (the look changed, or it was made by an older Studio) is not remade on its own: one button does it
  return <div className="look-sample look-sample-wait">
    <Icon n="film" />
    <p className="fine">{st === 'stale' ? 'The sample is out of date.' : 'No sample yet.'}</p>
    <button type="button" className="btn sm" id={`look-sample-${x.name}`} disabled={busy} onClick={() => onBuild(x)}>{st === 'stale' ? 'Remake the sample' : 'Make the sample'}</button>
  </div>;
}

function Card({ x, act, busy }) {
  const [renaming, setRenaming] = useState(false), [label, setLabel] = useState(x.label), [asking, setAsking] = useState(false);
  const keep = () => { setAsking(false); setTimeout(() => { const b = document.getElementById(`look-menu-${x.name}`); if (b) b.focus(); }, 0); };
  const items = [
    { id: `look-rename-${x.name}`, label: 'Rename', icon: 'edit', onClick: () => setRenaming(true) },
    { id: `look-dup-${x.name}`, label: 'Duplicate', icon: 'dup', onClick: () => act('duplicate', x) },
    { id: `look-sample-go-${x.name}`, label: x.sample && x.sample.status === 'ready' ? 'Remake the sample' : 'Make the sample', icon: 'film', onClick: () => act('sample', x) },
    { id: `look-del-${x.name}`, label: 'Delete', icon: 'trash', onClick: () => setAsking(true) },
  ];
  return <li className="look-card glass-card" data-look={x.name}>
    <Sample x={x} onBuild={x => act('sample', x)} busy={busy} />
    {renaming ? <form className="look-rename" onSubmit={e => { e.preventDefault(); act('rename', x, label).then(ok => { if (ok) setRenaming(false); }); }}>
      <label className="sr" htmlFor={`look-name-${x.name}`}>New name</label>
      <input id={`look-name-${x.name}`} value={label} maxLength={60} autoFocus onChange={e => setLabel(e.target.value)} />
      <button type="submit" className="btn sm" disabled={busy || !label.trim()}>Save</button>
      <button type="button" className="btn sm ghost" onClick={() => { setLabel(x.label); setRenaming(false); }}>Cancel</button>
    </form> : <div className="look-meta">
      <b className="look-name">{x.label}</b>
      <span className="fine">{[x.mix, x.from].filter(Boolean).join(' · ')}</span>
    </div>}
    <span className="look-menu"><MoreMenu id={`look-menu-${x.name}`} label={`Options for ${x.label}`} items={items} /></span>
    <Dialog open={asking} onClose={keep} className="tpl-dlg-wrap" role="alertdialog">
      <DialogBackdrop className="tpl-dlg-back" />
      <DialogPanel className="tpl-dlg glass-card" id={`look-del-dlg-${x.name}`}>
        <DialogTitle as="h3">Delete {x.label}?</DialogTitle>
        <Description className="fine">This look and its sample go. This cannot be undone.</Description>
        <div className="row">
          <button type="button" className="btn sm ghost" data-autofocus onClick={keep}>Keep it</button>
          <button type="button" className="btn sm" id={`look-del-yes-${x.name}`} disabled={busy} onClick={() => act('delete', x).then(ok => { if (ok) setAsking(false); })}>Delete</button>
        </div>
      </DialogPanel>
    </Dialog>
  </li>;
}

export function LookLibrary({ looks, onChange }) {
  const L = looks || { list: [], err: '', reload: () => {}, setList: () => {} };
  const [busy, setBusy] = useState(false);
  const act = async (what, x, label) => {
    setBusy(true);
    try {
      if (what === 'rename') { const j = await api('/api/style-looks/rename', { name: x.name, label }); L.setList(j.looks); toast('Renamed'); return true; }
      if (what === 'duplicate') { const j = await api('/api/style-looks/duplicate', { name: x.name }); L.setList(j.looks); toast(`Made ${j.look.label}`); return true; }
      if (what === 'delete') { const j = await api('/api/style-looks/delete', { name: x.name }); L.setList(j.looks); toast(`Deleted ${x.label}`, true); return true; }
      if (what === 'sample') { toast('Making the sample', true); const j = await api('/api/style-looks/sample', { name: x.name, force: true }); L.setList(j.looks); if (j.sample && j.sample.note) toast(j.sample.note, true); else toast('Sample ready'); return true; }
      return false;
    } catch (e) { toast(e.message, false); return false; } finally { setBusy(false); if (onChange) onChange(); }
  };
  useEffect(() => {
    // when the session view refreshes with new sample urls, pick them up
    if (looks && looks.list) return;
  }, [looks]);
  if (L.err && !L.list) return <div role="alert" id="look-lib-err"><p className="fine">The look library could not load: {L.err}</p>
    <button type="button" className="btn sm outline" id="look-lib-retry" onClick={() => L.reload()}>Try again</button></div>;
  if (!L.list) return <p className="fine" role="status">Loading your looks</p>;
  return <section className="look-lib" id="look-library" aria-labelledby="look-lib-h">
    <header className="sh"><h2 id="look-lib-h">Look library</h2>
      <p className="sub">Looks you saved from teardowns, including mixes. Play a sample to see the parts in action.</p></header>
    {L.list.length ? <ul className="look-grid" aria-labelledby="look-lib-h">{L.list.map(x => <Card key={x.name} x={x} act={act} busy={busy} />)}</ul>
      : <p className="fine" id="look-lib-empty">None yet. Break down a video above and save it as a look, or combine parts from more than one.</p>}
  </section>;
}

export function CombineLooks({ s, looks }) {
  const queue = ((s && s.reference && s.reference.queue) || []).filter(x => x.status === 'ready' && x.out);
  const fileRef = s && s.reference && s.reference.extracted && s.reference.out && !queue.some(x => x.id === s.reference.active)
    ? [{ id: 'active', title: s.reference.extracted.name || s.reference.file || 'This video', kind: 'teardown', teardownId: s.reference.active, out: s.reference.out, ready: true }]
    : [];
  const videos = [
    ...queue.map(x => ({ key: 'td:' + x.id, kind: 'teardown', id: x.id, title: x.title || x.file || 'Video ' + x.id })),
    ...fileRef.map(x => ({ key: 'td:active', kind: 'teardown', id: x.teardownId, title: x.title })),
  ];
  const saved = (looks.list || []).map(x => ({ key: 'look:' + x.name, kind: 'look', name: x.name, title: x.label || x.name }));
  const sources = [...videos, ...saved];
  const [parts, setParts] = useState(() => Object.fromEntries(PARTS.map(p => [p.id, ''])));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (sources.length < 2) {
    return <section className="look-mix glass-card" id="look-mix">
      <header className="sh"><h2 id="look-mix-h">Combine a look</h2>
        <p className="sub">Break down at least two videos, or save one look and break down another, then pick captions from one and the grade from another.</p></header>
    </section>;
  }
  const setPart = (id, val) => setParts(p => ({ ...p, [id]: val }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const picked = {};
      for (const p of PARTS) {
        const v = parts[p.id]; if (!v) continue;
        if (v.startsWith('td:')) picked[p.id] = { kind: 'teardown', id: v === 'td:active' ? -1 : +v.slice(3) };
        else if (v.startsWith('look:')) picked[p.id] = { kind: 'look', name: v.slice(5) };
      }
      if (!Object.keys(picked).length) { setErr('Pick a source for at least one part.'); setBusy(false); return; }
      const j = await api('/api/style-looks/mix', { name, parts: picked, label: name });
      looks.setList(j.looks); toast(`Saved ${j.name}. We are making its sample.`); setName('');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return <section className="look-mix glass-card" id="look-mix" aria-labelledby="look-mix-h">
    <header className="sh"><h2 id="look-mix-h">Combine a look</h2>
      <p className="sub">Take each part from the video or look you want, then save it as a new look.</p></header>
    <form id="look-mix-form" onSubmit={save}>
      <div className="look-mix-parts" role="group" aria-label="Parts of the look">
        {PARTS.map(p => <label key={p.id} className="look-mix-row" htmlFor={`look-mix-${p.id}`}>
          <span>{p.label}</span>
          <select id={`look-mix-${p.id}`} value={parts[p.id]} onChange={e => setPart(p.id, e.target.value)}>
            <option value="">Leave from the first pick</option>
            {sources.map(src => <option key={src.key} value={src.key}>{src.title}</option>)}
          </select>
        </label>)}
      </div>
      <div className="row">
        <label className="sr" htmlFor="look-mix-name">Name of the new look</label>
        <input id="look-mix-name" value={name} maxLength={60} placeholder="Name it, like my mixed look" onChange={e => setName(e.target.value)} />
        <button type="submit" className="btn sm" id="look-mix-save" disabled={busy || !name.trim()}>Save mixed look</button>
      </div>
      {err && <p className="fine" role="alert" id="look-mix-err">{err}</p>}
    </form>
  </section>;
}

export function SaveLook({ s, looks }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const r = (s && s.reference) || {};
  if (!r.extracted || !r.out) return null;
  const save = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const j = await api('/api/style-looks/save', { name }); looks.setList(j.looks); toast(`Saved ${j.name}. We are making its sample.`); setName(''); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return <form className="look-save glass-card" id="look-save" onSubmit={save}>
    <label htmlFor="look-save-name"><b>Save as a look</b> <span className="fine">Keeps this video's style, with none of its words or timing.</span></label>
    <div className="row"><input id="look-save-name" value={name} maxLength={60} placeholder="Name it, like my podcast look" onChange={e => setName(e.target.value)} />
      <button type="submit" className="btn sm" id="look-save-go" disabled={busy || !name.trim()}>Save as a look</button></div>
    {err && <p className="fine" role="alert" id="look-save-err">{err}</p>}
  </form>;
}
