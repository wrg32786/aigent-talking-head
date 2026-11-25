import { useEffect, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import * as stylex from '@stylexjs/stylex';
import { api, file, toast, Icon } from './lib.jsx';
import { MoreMenu } from './ui.jsx';

// The Template Library grid (spec 2.4), the same on the Teardowns tab and on New video's Use a template: each template
// with its picture (a starter's moving preview), name, where it came from, date and pace. manage: the menu with Rename,
// Duplicate, Edit in builder, Delete (asks first) and Use for a new video. pick: a click starts the video with it.
const s = stylex.create({
  grid: { listStyle: 'none', marginBlock: 0, paddingInline: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 },
  card: { position: 'relative', display: 'grid', gap: 4, alignContent: 'start', padding: 8, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', textAlign: 'left' },
  pick: { cursor: 'pointer', ':focus-visible': { outline: '2px solid var(--primary)', outlineOffset: 2 }, ':hover': { borderColor: 'var(--primary)' } },
  img: { width: '100%', aspectRatio: '9 / 16', maxHeight: 220, objectFit: 'cover', borderRadius: 10, display: 'block', backgroundColor: 'var(--muted)' },
  ph: { width: '100%', aspectRatio: '9 / 16', maxHeight: 220, borderRadius: 10, display: 'grid', placeItems: 'center', backgroundColor: 'var(--muted)', opacity: 0.8 },
  name: { fontWeight: 600, overflowWrap: 'anywhere' },
  menu: { position: 'absolute', top: 12, right: 12 },
  row: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: 6, borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'transparent', color: 'inherit', font: 'inherit', width: '100%', boxSizing: 'border-box' },
  h: { marginTop: 18, marginBottom: 8, fontSize: 14 },
});
// the card's own class kept beside StyleX's (a className before the spread would be replaced)
const cardProps = (...st) => { const p = stylex.props(...st); return { ...p, className: ['tpl-card', p.className].filter(Boolean).join(' ') }; };
const PACE = { look: 'Pace from the look', calm: 'Calm', steady: 'Steady', lively: 'Lively', high: 'High energy' };
const when = iso => { const d = iso && new Date(iso); return d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null; };
export const useTemplates = () => {
  const [list, setList] = useState(null), [err, setErr] = useState('');
  const reload = () => api('/api/templates').then(j => { setList(j.templates); setErr(''); }).catch(e => setErr(e.message));
  useEffect(() => { reload(); }, []);
  return { list, err, reload, setList };
};

function Card({ x, mode, act, busy }) {
  const [renaming, setRenaming] = useState(false), [label, setLabel] = useState(x.label), [asking, setAsking] = useState(false);
  // Keep it (or Escape) puts focus back on this template's options button: the menu item that opened the dialog is gone by then
  const keep = () => { setAsking(false); setTimeout(() => { const b = document.getElementById(`tpl-menu-${x.name}`); if (b) b.focus(); }, 0); };
  const src = x.thumb || (x.preview ? file(x.preview) : null);
  const pic = src ? <img src={src} alt="" loading="lazy" {...stylex.props(s.img)} /> : <span {...stylex.props(s.ph)} aria-hidden="true"><Icon n="spark" /></span>;
  const meta = [x.source, when(x.createdAt), PACE[x.pace] || null].filter(Boolean).join(', ');
  const body = <>{pic}<span {...stylex.props(s.name)}>{x.label}</span><span className="fine">{meta}</span>{x.line && <span className="fine">{x.line}</span>}</>;
  if (mode === 'pick') return <li><button type="button" data-template={x.name} disabled={busy} onClick={() => act('use', x)} {...cardProps(s.card, s.pick)} aria-label={`Use ${x.label}: ${meta}`}>{body}</button></li>;
  const items = [
    { id: `tpl-use-${x.name}`, label: 'Use for a new video', icon: 'right', onClick: () => act('use', x) },
    { id: `tpl-edit-${x.name}`, label: 'Edit in builder', icon: 'sliders', onClick: () => act('edit', x) },
    !x.readOnly && { id: `tpl-rename-${x.name}`, label: 'Rename', icon: 'edit', onClick: () => setRenaming(true) },
    { id: `tpl-dup-${x.name}`, label: 'Duplicate', icon: 'dup', onClick: () => act('duplicate', x) },
    !x.readOnly && { id: `tpl-del-${x.name}`, label: 'Delete', icon: 'trash', onClick: () => setAsking(true) },
  ];
  return <li data-template={x.name} {...cardProps(s.card)}>
    {body}
    <span {...stylex.props(s.menu)}><MoreMenu id={`tpl-menu-${x.name}`} label={`Options for ${x.label}`} items={items} /></span>
    {renaming && <form {...stylex.props(s.row)} onSubmit={e => { e.preventDefault(); act('rename', x, label).then(ok => { if (ok) setRenaming(false); }); }}>
      <input aria-label="New name" id={`tpl-name-${x.name}`} value={label} maxLength={60} autoFocus onChange={e => setLabel(e.target.value)} {...stylex.props(s.input)} />
      <button type="submit" className="btn sm" disabled={busy}>Save</button><button type="button" className="btn sm ghost" onClick={() => { setLabel(x.label); setRenaming(false); }}>Cancel</button></form>}
    {/* asks first, in a real dialog: focus moves into it, Escape or Keep it closes it and focus goes back to the menu */}
    <Dialog open={asking} onClose={keep} className="tpl-dlg-wrap" role="alertdialog">
      <DialogBackdrop className="tpl-dlg-back" />
      <DialogPanel className="tpl-dlg glass-card" id={`tpl-del-dlg-${x.name}`}>
        <DialogTitle as="h3">Delete {x.label}?</DialogTitle>
        <Description className="fine">{x.look ? 'Its saved look goes too. ' : ''}This cannot be undone.</Description>
        <div {...stylex.props(s.row)}>
          <button type="button" className="btn sm ghost" data-autofocus onClick={keep}>Keep it</button>
          <button type="button" className="btn sm" id={`tpl-del-yes-${x.name}`} disabled={busy} onClick={() => act('delete', x).then(ok => { if (ok) setAsking(false); })}>Delete</button>
        </div>
      </DialogPanel>
    </Dialog>
  </li>;
}

// onUse(edit): after a template set the plan; Use opens Your notes, Edit in builder opens the first step
export function Library({ T, mode = 'manage', apply, onUse }) {
  const [busy, setBusy] = useState(false);
  const act = async (what, x, label) => {
    setBusy(true);
    try {
      if (what === 'use' || what === 'edit') {
        // from the Teardowns tab, Use for a new video starts one first (the video open now is saved, nothing is lost)
        if (what === 'use' && mode === 'manage') { await api('/api/videos/new', { keepLook: false }); toast(`New video started with ${x.label}. Add your clip.`, true); }
        apply(await api('/api/templates/use', { name: x.name, edit: what === 'edit' })); onUse(what === 'edit', mode === 'manage' && what === 'use'); return true;
      }
      const j = await api('/api/templates/' + what, what === 'rename' ? { name: x.name, label } : { name: x.name });
      T.setList(j.templates); if (what === 'duplicate' && j.template) toast(`Made ${j.template.label}`);
      // the card it came from is gone: focus lands on the list heading, not the top of the page
      if (what === 'delete') { toast(`Deleted ${x.label}`, true); requestAnimationFrame(() => { const h = document.getElementById(`tlib-yours-h-${mode}`); if (h) h.focus(); }); }
      return true;
    } catch (e) { toast(e.message, false); return false; } finally { setBusy(false); }
  };
  if (T.err && !T.list) return <div role="alert" id={`tlib-err-${mode}`} {...stylex.props(s.row)}><p className="fine">The library could not load: {T.err}</p>
    <button type="button" className="btn sm outline" id={`tlib-retry-${mode}`} onClick={() => T.reload()}>Try again</button></div>;
  if (!T.list) return <p className="fine" role="status">Loading your templates</p>;
  const yours = T.list.filter(x => !x.readOnly), starters = T.list.filter(x => x.readOnly);
  return <>
    <h3 {...stylex.props(s.h)} id={`tlib-yours-h-${mode}`} tabIndex={-1}>Your templates</h3>
    {yours.length ? <ul {...stylex.props(s.grid)} aria-labelledby={`tlib-yours-h-${mode}`}>{yours.map(x => <Card key={x.name} x={x} mode={mode} act={act} busy={busy} />)}</ul>
      : <p className="fine" id={`tlib-empty-${mode}`}>None yet. Break down a video on the Teardowns tab and save it, or save one at the end of the builder.</p>}
    <h3 {...stylex.props(s.h)} id={`tlib-start-h-${mode}`}>Starter templates</h3>
    <ul {...stylex.props(s.grid)} aria-labelledby={`tlib-start-h-${mode}`}>{starters.map(x => <Card key={x.name} x={x} mode={mode} act={act} busy={busy} />)}</ul>
  </>;
}
