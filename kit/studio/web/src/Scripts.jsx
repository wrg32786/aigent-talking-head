// Scripts: what you will say on camera, per job. Plain editor with word count and read time; your agent can write
// and rewrite them (write_script), and the teleprompter in Record now reads them.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, toast, scriptStats, Icon, IconBtn } from './lib.jsx';

const MARKS = [['[hook]', 'Hook'], ['[body]', 'Body'], ['[cta]', 'CTA'], ['[pause]', 'Pause']];
export const canWrite = env => env.backend === 'agent' || !!env.llm;
export const NO_WRITER = 'Writing scripts needs your terminal agent, an API key or a local model (Settings).';
const secs = n => n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${n % 60} s`;

export function Scripts({ V, s, apply, onRead }) {
  const list = V.scripts || [], env = V.env;
  const [openId, setOpenId] = useState(() => localStorage.getItem('studio.script.open') || null);
  const [doc, setDoc] = useState(null), [dirty, setDirty] = useState(false), [ask, setAsk] = useState('');
  const ta = useRef(null), saveT = useRef(null), docRef = useRef(null); docRef.current = doc;
  const cur = list.find(x => x.id === openId) || null;
  // load the open script; reload when someone else (your agent) saved it
  useEffect(() => {
    if (!openId || !s.job) { setDoc(null); return; }
    if (dirty && doc && doc.id === openId) return;
    api('/api/scripts/get?id=' + encodeURIComponent(openId)).then(j => setDoc(j.script)).catch(() => { setOpenId(null); setDoc(null); });
  }, [openId, cur && cur.updated, s.job]);
  const open = id => { localStorage.setItem('studio.script.open', id || ''); setDirty(false); setOpenId(id); };
  const save = async d => { const j = await api('/api/scripts', { id: d.id, title: d.title, text: d.text, wpm: d.wpm }).catch(() => null); if (j) { setDirty(false); apply(j); } };
  const edit = patch => { const d = { ...docRef.current, ...patch }; setDoc(d); setDirty(true); clearTimeout(saveT.current); saveT.current = setTimeout(() => save(d), 600); };
  useEffect(() => () => clearTimeout(saveT.current), []);
  const create = async () => { if (!s.job) { toast('Name the reel first (top left)'); return; } const j = await api('/api/scripts', { title: 'New script', text: '[hook]\n\n[body]\n\n[cta]\n' }); apply(j); open(j.script.id); requestAnimationFrame(() => ta.current?.focus()); };
  const action = async (id, a, extra) => { const j = await api('/api/scripts/action', { id, action: a, ...extra }).catch(() => null); if (!j) return; apply(j); if (a === 'delete' && id === openId) open(null); if (a === 'duplicate' && j.script) open(j.script.id); };
  const mark = m => { const t = ta.current; if (!t) return; const a = t.selectionStart, b = t.selectionEnd, v = doc.text, ins = m === '[pause]' ? ' [pause] ' : (a && v[a - 1] !== '\n' ? '\n' : '') + m + '\n';
    edit({ text: v.slice(0, a) + ins + v.slice(b) }); requestAnimationFrame(() => { t.focus(); t.selectionStart = t.selectionEnd = a + ins.length; }); };
  const askAgent = e => { e.preventDefault(); const q = ask.trim(); if (!q) return; if (!canWrite(env)) return toast(NO_WRITER);
    const cur = doc ? ` Current script "${doc.title}" (id ${doc.id}) is open.` : '';
    api('/api/chat', { text: `Script request: ${q}.${cur}` }).then(j => { apply(j); setAsk(''); toast(env.backend === 'agent' ? 'Sent to your agent' : 'Writing', true); }).catch(() => {}); };
  const st = doc ? scriptStats(doc.text, doc.wpm || 150) : null;

  return <div className="scripts glass-card" id="scripts" aria-labelledby="h-scripts">
    <div className="bh"><h3 id="h-scripts"><Icon n="script" />Scripts</h3><Button id="script-new" size="sm" variant="secondary" label="New script" icon={<Icon n="plus" />} onClick={create} /></div>
    <div className="sc-body">
      <ul className="sc-list" aria-label="Scripts">
        {list.length ? list.map(x => <li key={x.id} className={x.id === openId ? 'on' : ''}>
          <button type="button" className="sc-item" aria-current={x.id === openId ? 'true' : undefined} onClick={() => open(x.id)}>
            <b>{x.title}</b><span>{x.words} words, {secs(x.seconds)}{x.by && x.by !== 'you' ? `, by ${x.by}` : ''}</span></button>
          <span className="sc-acts">
            <IconBtn n="dup" label={`Duplicate ${x.title}`} onClick={() => action(x.id, 'duplicate')} />
            <IconBtn n="trash" label={`Delete ${x.title}`} onClick={() => { if (confirm(`Delete the script "${x.title}"?`)) action(x.id, 'delete'); }} />
          </span></li>)
          : <li className="fine sc-empty">No scripts yet. Write one, or ask your agent below.</li>}
      </ul>
      {doc ? <div className="sc-edit">
        <label className="sr" htmlFor="script-title">Script title</label>
        <input id="script-title" className="sc-title" value={doc.title} onChange={e => edit({ title: e.target.value })} />
        <div className="sc-tools" role="toolbar" aria-label="Insert a marker">
          {MARKS.map(([m, l]) => <button key={m} type="button" className="chip" onClick={() => mark(m)} aria-label={`Insert ${l} marker`}>{l}</button>)}
          <label className="sc-wpm"><span className="lbl">WPM</span><input id="script-wpm" type="number" min={60} max={260} step={5} value={doc.wpm || 150} onChange={e => edit({ wpm: Math.max(60, Math.min(260, +e.target.value || 150)) })} /></label>
        </div>
        <label className="sr" htmlFor="script-text">Script text</label>
        <textarea id="script-text" ref={ta} rows={10} spellCheck="true" value={doc.text} onChange={e => edit({ text: e.target.value })} />
        <div className="sc-stats" aria-live="polite"><span id="script-stats">{st.words} words, about {secs(st.seconds)} at {doc.wpm || 150} WPM{st.pauses ? `, ${st.pauses} pause${st.pauses > 1 ? 's' : ''}` : ''}</span>
          {st.sections.map((x, i) => <span key={i} className="tag"><em>{x.name}</em>{x.at} s</span>)}
          <span className="fine">{dirty ? 'Saving' : 'Saved'}</span>
          <Button id="script-read" size="sm" variant="primary" label="Read it in Record" icon={<Icon n="camera" />} onClick={() => onRead(doc.id)} /></div>
      </div> : <div className="sc-edit empty-art"><Icon n="script" /><p>Pick a script or start a new one.</p></div>}
    </div>
    <form className="sc-ask" onSubmit={askAgent}>
      <Icon n="spark" />
      <label className="sr" htmlFor="script-ask">Ask for a script</label>
      <input id="script-ask" placeholder={doc ? 'Rewrite this tighter, or: a 30 s script on...' : 'Write a 30 s script on...'} value={ask} onChange={e => setAsk(e.target.value)} disabled={!canWrite(env)} />
      <Button type="submit" size="sm" variant="secondary" label={env.backend === 'agent' ? 'Ask agent' : 'Write'} isDisabled={!canWrite(env)} />
    </form>
    {!canWrite(env) && <p className="fine" id="script-nowriter">{NO_WRITER}</p>}
  </div>;
}
