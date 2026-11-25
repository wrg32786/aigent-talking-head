// The Teardowns tab: break down a video you like (Reference.jsx: paste a link or upload a file, then the breakdown),
// Save as template once it is broken down, and the Template Library below (Library.jsx, the same grid New video's
// Use a template shows).
import { useState } from 'react';
import { Reference } from './Reference.jsx';
import { api, toast } from './lib.jsx';
import { Library, useTemplates } from './Library.jsx';

function SaveTemplate({ s, T, looks }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const r = s.reference || {};
  if (!r.extracted || !r.out) return null;
  const save = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const j = await api('/api/templates/from-teardown', { name }); T.setList(j.templates); if (looks && looks.reload) looks.reload(); toast(`Saved as ${j.template.label}`); setName(''); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return <form className="tlib-save glass-card" id="tlib-save" onSubmit={save}>
    <label htmlFor="tlib-save-name"><b>Save as template</b> <span className="fine">Use this look for your next videos.</span></label>
    <div className="row"><input id="tlib-save-name" value={name} maxLength={60} placeholder="Name it, like my podcast look" onChange={e => setName(e.target.value)} />
      <button type="submit" className="btn sm" id="tlib-save-go" disabled={busy || !name.trim()}>Save as template</button></div>
    {err && <p className="fine" role="alert" id="tlib-save-err">{err}</p>}
  </form>;
}

export function TemplateLibrary({ s, apply, looks }) {
  const T = useTemplates();
  const go = edit => { location.hash = edit ? '#build=pace' : '#build=notes'; };
  return <section className="tlib" id="template-library" aria-labelledby="tlib-h">
    <header className="sh"><h2 id="tlib-h">Template Library</h2><p className="sub">Your templates and our starters. Use one for a new video, or open it in the builder to change it.</p></header>
    <SaveTemplate s={s} T={T} looks={looks} />
    <Library T={T} mode="manage" apply={apply} onUse={go} />
  </section>;
}

export function Teardowns(ctx) {
  return <div className="teardowns" id="s-teardowns">
    <Reference {...ctx} />
    <TemplateLibrary s={ctx.s} apply={ctx.apply} looks={ctx.looks} />
  </div>;
}
