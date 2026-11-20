// Settings, API keys and providers: one row per provider with set or not and where from (never a character of the
// key), a password box to save one on this computer, Test key, Remove, and links to get a key and to the docs.
// Below: which b-roll sources are on, Allow generating (off by default) with models, and the library folder.
import { useEffect, useState } from 'react';
import { Drawer } from '@astryxdesign/core/Drawer';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Switch } from '@astryxdesign/core/Switch';
import { api, toast, Icon, IconBtn } from './lib.jsx';

const GROUPS = [['stock', 'Stock footage (free)'], ['generate', 'Generate (paid, your account)'], ['text', 'Text']];

function KeyRow({ k, setKeys }) {
  const [v, setV] = useState(''), [v2, setV2] = useState(''), [busy, setBusy] = useState(''), [res, setRes] = useState(null);
  const env = k.from && k.from.startsWith('env');
  const save = async () => {
    setBusy('save'); setRes(null);
    try { const j = await api('/api/keys', { id: k.id, value: k.pair ? { id: v.trim(), secret: v2.trim() } : v.trim() }); setKeys(j); setV(''); setV2(''); toast(`${k.name} key saved on this computer`, true); } catch {} setBusy('');
  };
  const test = async () => { setBusy('test'); setRes(null); try { const j = await api('/api/keys/test', { id: k.id }); setRes(j); setKeys(j); } catch {} setBusy(''); };
  const remove = async () => { setBusy('rm'); try { setKeys(await api('/api/keys', { id: k.id, remove: true })); setRes(null); } catch {} setBusy(''); };
  const tested = res || (k.tested && { ok: k.tested.ok });
  return <li className="key-row" data-id={k.id}>
    <div className="kr-h"><b>{k.name}</b>
      <span className="kr-st" id={'key-status-' + k.id}>{k.set ? <Badge label={env ? `Set from ${k.from.slice(4)}` : 'Saved on this computer'} variant="success" /> : <Badge label="Not set" variant="neutral" />}
        {tested && tested.ok === true && <Badge label="Works" variant="cyan" />}{tested && tested.ok === false && <Badge label="Failed" variant="error" />}</span></div>
    <small className="fine">{k.for}</small>
    {!env && <div className="kr-in">
      {k.pair ? <>
        <input type="password" id={'key-in-' + k.id} aria-label={`${k.name} ${k.pair[0]}`} placeholder={k.set ? `${k.pair[0]}: saved, type to replace` : k.pair[0]} autoComplete="off" spellCheck="false" value={v} onChange={e => setV(e.target.value)} />
        <input type="password" id={'key-in2-' + k.id} aria-label={`${k.name} ${k.pair[1]}`} placeholder={k.pair[1]} autoComplete="off" spellCheck="false" value={v2} onChange={e => setV2(e.target.value)} /></>
        : <input type="password" id={'key-in-' + k.id} aria-label={`${k.name} key`} placeholder={k.set ? 'Saved. Type to replace' : 'Paste your key'} autoComplete="off" spellCheck="false" value={v} onChange={e => setV(e.target.value)} />}
      <Button id={'key-save-' + k.id} size="sm" variant="secondary" label="Save" isDisabled={!v.trim() || (k.pair && !v2.trim())} isLoading={busy === 'save'} onClick={save} />
    </div>}
    <div className="kr-act">
      {k.set && <Button id={'key-test-' + k.id} size="sm" variant="ghost" label="Test key" isLoading={busy === 'test'} onClick={test} />}
      {k.set && !env && <Button id={'key-rm-' + k.id} size="sm" variant="ghost" label="Remove" isLoading={busy === 'rm'} onClick={remove} />}
      <a href={k.get} target="_blank" rel="noreferrer" className="fine">Get a key</a><a href={k.docs} target="_blank" rel="noreferrer" className="fine">Docs</a>
    </div>
    {env && <p className="fine">Comes from the environment. Change it where you start Studio.</p>}
    {res && <p className="fine kr-res" role="status" id={'key-res-' + k.id}>{res.ok ? res.note : res.ok === null ? res.note : res.error}</p>}
  </li>;
}

export function Keys({ V, apply, open, setOpen }) {
  const [keys, setKeys] = useState(null), [f, setF] = useState(null), [msg, setMsg] = useState('');
  useEffect(() => { if (!open) return; api('/api/keys').then(j => { setKeys(j); const b = V.env.broll || {}; setF({ generate: !!b.generate, library: b.library || '', models: { ...(b.models || {}) } }); }).catch(() => {}); setMsg(''); }, [open]);
  // a key change turns sources on or off: refresh the page's view too (keys are not in the session, so no live push)
  const merge = j => { setKeys(x => ({ ...x, ...j })); api('/api/state').then(apply).catch(() => {}); };
  const save = async () => {
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ broll: { generate: f.generate, library: f.library.trim() || null, models: Object.fromEntries(Object.entries(f.models).map(([k, v]) => [k, (v || '').trim() || null])) } }) });
    const j = await r.json(); if (!r.ok) { setMsg(j.error); return; } apply(j); toast('B-roll settings saved', true); merge(await api('/api/keys'));
  };
  const gens = keys ? keys.generate.providers.filter(p => !p.stub) : [];
  return <Drawer id="keys" className="settings-sheet" isOpen={open} onOpenChange={setOpen} side="end" width={520} label="API keys and providers" padding={0} experimental={{ isFullWidthOnMobile: true }}>
    <header className="sheet-h"><h2 id="h-keys">API keys and providers</h2><IconBtn n="x" label="Close" onClick={() => setOpen(false)} /></header>
    <div className="sheet-b">
      <p className="fine" id="keys-where">Keys stay on this computer, in a file only you can read ({keys ? keys.file.replace(/^.*?(jobs\/\.studio\/)/, '$1') : 'jobs/.studio/keys.json'}){keys && /jobs\/\.studio\//.test(keys.file) ? ', which git ignores' : ''}. Studio never shows a key again and your agent only sees whether one is set. A key set in the environment wins.</p>
      {keys && GROUPS.map(([g, label]) => <fieldset key={g}><legend>{label}</legend>
        <ul className="key-list">{keys.keys.filter(k => k.group === g).map(k => <KeyRow key={k.id} k={k} setKeys={merge} />)}</ul></fieldset>)}
      {keys && <fieldset id="broll-sources"><legend>B-roll sources</legend>
        <ul className="src-list">{keys.sources.map(x => <li key={x.id} data-id={x.id} className={x.on ? 'on' : ''}><Icon n={x.on ? 'check' : 'minus'} /><b>{x.name}</b><small className="fine">{x.note}</small></li>)}</ul></fieldset>}
      {f && <fieldset><legend>Generating</legend>
        <Switch id="allow-generate" label="Allow generating" description="Off by default. Every generate shows the estimated cost and asks you first. Your agent can only ask." value={f.generate} onChange={v => setF(x => ({ ...x, generate: v }))} />
        {gens.map(p => <label key={p.id} className="col model-in"><span className="lbl">{p.name} model{p.needsModel ? ' (required)' : ''}{!p.verified && <em className="fine"> not verified</em>}</span>
          <input id={'model-' + p.id} spellCheck="false" autoComplete="off" placeholder={Object.values(p.defaults || {}).join(' or ') || 'owner/model'} value={f.models[p.id] || ''} onChange={e => setF(x => ({ ...x, models: { ...x.models, [p.id]: e.target.value } }))} />
          <small className="fine">{p.note}</small></label>)}
        {keys && <p className="fine">Not wired yet: {keys.generate.providers.filter(p => p.stub).map(p => p.note).join(' ')}</p>}
        <label className="lbl" htmlFor="broll-lib">B-roll library folder</label>
        <input id="broll-lib" spellCheck="false" autoComplete="off" placeholder={V.broll ? V.broll.library.dir : 'broll-library in the kit'} value={f.library} onChange={e => setF(x => ({ ...x, library: e.target.value }))} />
        <p className="fine">A full path. Reused by every job. Empty uses broll-library in the kit (git ignores it).</p>
        <p id="keys-msg" className="fine" role="status">{msg}</p>
      </fieldset>}
    </div>
    <footer className="sheet-f"><Button variant="ghost" label="Close" onClick={() => setOpen(false)} /><Button id="save-broll-settings" variant="primary" label="Save" onClick={save} /></footer>
  </Drawer>;
}
