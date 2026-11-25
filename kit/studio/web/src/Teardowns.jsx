// The Teardowns tab: break down a video you like (Reference.jsx: paste a link or upload a file, then the breakdown), and
// the Template Library below it. For now the library lists the looks you saved from earlier teardowns and the starter
// looks that ship with the kit, read only; picking a template to start a video comes with the template step later.
import { useEffect } from 'react';
import { Reference } from './Reference.jsx';
import { Icon, cap1 } from './lib.jsx';

export function TemplateLibrary({ CAT, looks }) {
  useEffect(() => { if (looks && !looks.on) looks.reload(); }, []);
  const saved = (looks && looks.list) || [], starters = (CAT.packs || []).filter(p => p.shipped && !/^ref-/.test(p.name));
  return <section className="tlib" id="template-library" aria-labelledby="tlib-h">
    <header className="sh"><h2 id="tlib-h">Template Library</h2><p className="sub">Starter looks, and the looks you saved from your teardowns.</p></header>
    <h3 className="lbl" id="tlib-saved-h">Saved from your teardowns</h3>
    {saved.length ? <ul className="tlib-list" aria-labelledby="tlib-saved-h">{saved.map(x => <li key={x.name} className="tlib-card glass-card" data-look={x.name}>
      <Icon n="spark" /><span><b>{x.name}</b>{x.from && <span className="fine">From {x.from}</span>}</span></li>)}</ul>
      : <p className="fine" id="tlib-saved-empty">None yet. Break down a video above, then save its look.</p>}
    <h3 className="lbl" id="tlib-start-h">Starter templates</h3>
    <ul className="tlib-list" aria-labelledby="tlib-start-h">{starters.map(p => <li key={p.name} className="tlib-card glass-card" data-pack={p.name}>
      <Icon n="film" /><span><b>{cap1(p.name)}</b>{(p.label || p.description) && <span className="fine">{p.label || p.description}</span>}</span></li>)}</ul>
  </section>;
}

export function Teardowns(ctx) {
  return <div className="teardowns" id="s-teardowns">
    <Reference {...ctx} />
    <TemplateLibrary CAT={ctx.CAT} looks={ctx.looks} />
  </div>;
}
