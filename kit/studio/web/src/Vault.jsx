// The Vault (1.29.0): everything you can show, in one place. A panel over any step, opened from the top bar or from
// a B-roll slot ("Open the Vault", which adds Use in this reel for that spot). A grid with search and four filters,
// Add (upload files or paste a link), and a sheet for one item: tags, brand, where it came from, the rights mark,
// where it was used and Delete, with Undo for 7 days. The server does the work (kit/studio/vault-api.mjs); every
// change there bumps the session, so the B-roll step's suggestions follow by themselves.
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { Button } from '@astryxdesign/core/Button';
import { api, setOffline, OFFLINE_MSG, Icon, IconBtn } from './lib.jsx';
import './vault.css';

const FILTERS = [
  ['kind', 'Kind', [['', 'All'], ['video', 'Video'], ['image', 'Image'], ['page', 'Page'], ['screen', 'Screen']]],
  ['source', 'Source', [['', 'All'], ['uploaded', 'Uploaded'], ['links', 'Links'], ['stock', 'Stock'], ['made', 'Made']]],
  ['tag', 'Tag', null],
  ['used', 'Show', [['', 'All'], ['true', 'Used'], ['false', 'Not used yet']]],
];

// one call for the panel: a failure comes back as plain words for the line under the header, not a toast behind it
async function call(path, body) {
  const raw = body instanceof Blob;
  let r;
  try { r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: raw ? {} : { 'content-type': 'application/json', 'x-studio-page': '1' }, body: raw ? body : JSON.stringify(body) }); }
  catch { setOffline(true); throw new Error(OFFLINE_MSG); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'That did not work. Try again.');
  return j;
}

function Pic({ it, big }) {
  if (it.media === 'video' && it.url) return big ? <video src={it.url} poster={it.thumb || undefined} controls muted playsInline preload="metadata" />
    : <video src={it.url} poster={it.thumb || undefined} muted loop playsInline preload="none" onMouseEnter={e => e.currentTarget.play().catch(() => {})} onMouseLeave={e => e.currentTarget.pause()} />;
  const src = it.media === 'image' && big && it.url ? it.url : it.thumb || (it.media === 'image' ? it.url : null);
  return src ? <img src={src} alt="" loading="lazy" /> : <span className="bt-ph"><Icon n={it.media === 'link' ? 'link' : 'film'} /></span>;
}

// chips you can remove, and a box to add one
function Chips({ id, label, list, set }) {
  const [v, setV] = useState('');
  const add = e => { e.preventDefault(); const t = v.trim(); if (t && !list.includes(t)) set([...list, t]); setV(''); };
  return <div className="col" id={id}><span className="lbl">{label}</span>
    <form className="seg-row" onSubmit={add}>
      {list.map(t => <span key={t} className="chip sm" data-value={t}>{t}<button type="button" className="chip-x" aria-label={`Remove ${t}`} onClick={() => set(list.filter(x => x !== t))}><Icon n="x" /></button></span>)}
      <input className="chip-in" aria-label={`Add to ${label.toLowerCase()}`} placeholder="Add" value={v} onChange={e => setV(e.target.value)} />
    </form></div>;
}

function Sheet({ it, rights, pick, busy, back, change, del, use }) {
  const from = [it.link ? <a key="l" href={it.link} target="_blank" rel="noreferrer">{it.site || 'Open the link'}</a> : it.site, it.license, it.author && it.author.name ? `By ${it.author.name}` : null].filter(Boolean);
  return <div className="vault-sheet" id="vault-sheet" data-id={it.id}>
    <div className="vs-pic"><Pic it={it} big /></div>
    <div className="col vs-info">
      <button type="button" className="linkish" id="vault-back" onClick={back}>Back</button>
      <b className="vs-name">{it.name}</b>
      <span className="fine">{it.status === 'getting' ? 'Getting it ready' : it.line}</span>
      {it.note && <span className="fine">{it.note}</span>}
      <Chips id="vault-tags" label="Tags" list={it.tags} set={tags => change(it.id, { tags })} />
      <Chips id="vault-brand" label="Brand" list={it.brand} set={brand => change(it.id, { brand })} />
      {from.length > 0 && <><span className="lbl">Where it came from</span><span className="fine" id="vault-from">{from.map((x, k) => <span key={k}>{k ? ', ' : ''}{x}</span>)}</span></>}
      <label className="inl"><span className="lbl">Rights</span><select id="vault-rights" value={it.rights} onChange={e => change(it.id, { rights: e.target.value })}>{Object.entries(rights || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {it.check && <span className="fine" id="vault-check">{it.check}</span>}
      {it.captured && <span className="fine" id="vault-captured">Captured {it.captured}</span>}
      <span className="fine" id="vault-used">{it.usedIn.length ? `Used in ${it.usedIn.join(', ')}` : 'Not used yet'}</span>
      {pick && !it.placeable && <span className="fine" id="vault-ref-only">Reference only. It is never placed in a reel.</span>}
      <div className="row vs-acts">
        {pick && it.placeable && it.status !== 'getting' && <Button id="vault-use" size="sm" variant="secondary" label="Use in this reel" icon={<Icon n="check" />} isLoading={busy === 'use'} onClick={() => use(it.id)} />}
        <Button id="vault-delete" size="sm" variant="ghost" label="Delete from Vault" icon={<Icon n="trash" />} isLoading={busy === 'del'} onClick={() => del(it.id)} />
      </div>
    </div>
  </div>;
}

// at: null when closed, { beat } when open (beat is the B-roll spot it was opened for, or null from the top bar)
export function Vault({ at, close, apply }) {
  const open = !!at, beat = at ? at.beat : null, pick = beat != null;
  const [D, setD] = useState(null), [q, setQ] = useState(''), [f, setF] = useState({}), [add, setAdd] = useState(''), [cur, setCur] = useState(null);
  const [msg, setMsg] = useState(''), [gone, setGone] = useState(null), [busy, setBusy] = useState(''), [link, setLink] = useState(''), [mine, setMine] = useState(false);
  const fileIn = useRef(null);
  // only the keys the server knows, and none that are empty
  const load = () => call('/api/vault?' + new URLSearchParams(Object.entries({ q: q.trim(), ...f }).filter(([, v]) => v))).then(setD).catch(e => setMsg(e.message));
  useEffect(() => { if (open) { setCur(null); setAdd(''); setMsg(''); setGone(null); } }, [open]);
  useEffect(() => { if (!open) return; const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [open, q, f]);
  // a link is still being captured: look again every two seconds until it is ready
  const getting = !!D && D.items.some(it => it.status === 'getting');
  useEffect(() => { if (!open || !getting) return; const t = setInterval(load, 2000); return () => clearInterval(t); }, [open, getting, q, f]);

  const act = async (key, fn) => { setBusy(key); setMsg(''); try { await fn(); } catch (e) { setMsg(e.message); } setBusy(''); load(); };
  const upload = files => act('up', async () => { for (const file of files) { const j = await call('/api/vault/upload?name=' + encodeURIComponent(file.name), file); if (j.duplicate) setMsg(j.note || 'You already have this.'); } setAdd(''); });
  const saveLink = e => { e.preventDefault(); act('link', async () => { const j = await call('/api/vault/link', { link: link.trim(), mine }); setMsg(j.duplicate ? 'You already have this.' : j.reference || j.note || ''); setLink(''); setMine(false); setAdd(''); }); };
  const change = (id, o) => act('', () => call('/api/vault/item', { id, action: 'update', ...o }));
  const del = id => act('del', async () => { const j = await call('/api/vault/item', { id, action: 'delete' }); setCur(null); setGone(j.undo); });
  const undo = () => act('undo', async () => { await call('/api/vault/item', { action: 'undo', id: gone.id }); setGone(null); });
  const use = id => act('use', async () => { await call('/api/broll/slot', { beat, clip: id }); api('/api/state').then(apply).catch(() => {}); close(); });

  const it = D && cur ? D.items.find(x => x.id === cur) : null, empty = D && D.total === 0;
  return <Dialog open={open} onClose={close} className="vault-wrap">
    <DialogBackdrop className="vault-back" />
    <DialogPanel id="vault" className="vault glass" data-pick={pick ? beat : undefined} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); }}>
      <header className="vault-h">
        <div className="vault-t"><DialogTitle as="h2">Vault</DialogTitle><p className="fine">Everything you can show, in one place.</p></div>
        <input id="vault-search" type="search" placeholder="Search your Vault" aria-label="Search your Vault" value={q} onChange={e => { setQ(e.target.value); setCur(null); }} />
        <Button id="vault-add" size="sm" variant="primary" label="Add" icon={<Icon n="plus" />} onClick={() => setAdd(add ? '' : 'menu')} />
        <IconBtn n="x" label="Close" onClick={close} />
      </header>
      <div className="vault-b">
        <input type="file" id="vault-file" accept="video/*,image/*" multiple hidden ref={fileIn} onChange={e => { upload([...e.target.files]); e.target.value = ''; }} />
        {add === 'menu' && <div className="row vault-addrow" id="vault-add-menu">
          <Button id="vault-add-upload" size="sm" variant="secondary" label="Upload files" icon={<Icon n="upload" />} isLoading={busy === 'up'} onClick={() => fileIn.current.click()} />
          <Button id="vault-add-link" size="sm" variant="secondary" label="Paste a link" icon={<Icon n="link" />} onClick={() => setAdd('link')} />
          <span className="fine">You can also drop files here.</span></div>}
        {add === 'link' && <form className="row vault-addrow" id="vault-link-form" onSubmit={saveLink}>
          <input id="vault-link" className="grow" autoFocus placeholder="Paste a link to your site, a profile, a product page or a video." aria-label="Link" value={link} onChange={e => setLink(e.target.value)} />
          <label className="tick"><input type="checkbox" id="vault-mine" checked={mine} onChange={e => setMine(e.target.checked)} />This is mine</label>
          <Button id="vault-link-save" type="submit" size="sm" variant="secondary" label="Save" isLoading={busy === 'link'} isDisabled={!link.trim()} /></form>}
        {msg && <p className="fine vault-line" id="vault-msg" role="status">{msg}</p>}
        {gone && <p className="fine vault-line" id="vault-gone" role="status">Deleted from your Vault. You can undo for 7 days. <button type="button" className="linkish" id="vault-undo" onClick={undo}>Undo</button></p>}
        {D && D.usage && D.usage.line && <p className="fine vault-line" id="vault-usage">{D.usage.line}</p>}
        {it ? <Sheet it={it} rights={D.rights} pick={pick} busy={busy} back={() => setCur(null)} change={change} del={del} use={use} />
          : empty ? <div className="empty-art" id="vault-empty"><Icon n="grid" /><p>Your Vault is empty. Add your site, your profiles and a few clips, and we will pull B-roll from them.</p>
            <Button id="vault-empty-add" size="sm" variant="secondary" label="Add" onClick={() => setAdd('menu')} /></div>
          : D && <>
            <div className="vault-filters" id="vault-filters">{FILTERS.map(([k, label, opts]) => <div key={k} className="vf" role="radiogroup" aria-label={label}><span className="lbl">{label}</span>
              {(opts || [['', 'any'], ...D.tags.map(t => [t, t])]).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={String((f[k] || '') === v)} className={'chip sm' + ((f[k] || '') === v ? ' on' : '')} data-filter={k} data-value={v || 'all'} onClick={() => setF(x => ({ ...x, [k]: v }))}>{l}</button>)}</div>)}</div>
            {!D.items.length && <p className="fine" id="vault-none">Nothing in your Vault fits yet.</p>}
            <div className="bgrid vault-grid" id="vault-grid">{D.items.map(x => <button key={x.id} type="button" className="bthumb vault-item" data-id={x.id} data-kind={x.kind} onClick={() => setCur(x.id)}>
              <span className="vi-pic"><Pic it={x} />{x.rights !== 'mine' && <em className="vi-rights">{x.rightsLabel}</em>}</span>
              <span className="bt-n">{x.name}</span><span className="bt-m vi-line">{x.status === 'getting' ? 'Getting it ready' : x.line}</span>
              {x.note && <span className="bt-m vi-note">{x.note}</span>}</button>)}</div>
          </>}
      </div>
    </DialogPanel>
  </Dialog>;
}
