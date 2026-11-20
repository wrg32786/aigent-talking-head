import { useEffect, useState } from 'react';
import { Drawer } from '@astryxdesign/core/Drawer';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { toast, IconBtn } from './lib.jsx';

const BACKENDS = [
  ['agent', 'Terminal agent', 'Claude Code, Codex, Cursor or any MCP client'],
  ['local', 'Local model', 'Ollama, LM Studio, llama.cpp'],
  ['anthropic', 'Claude API', null],
  ['openai', 'OpenAI API', null],
  ['keywords', 'Keywords', 'No model'],
];

export function Settings({ V, apply, open, setOpen, theme, setTheme, glass, setGlass, openConnect, openSetup, openKeys }) {
  const e = V.env, st = e.settings;
  const [f, setF] = useState(null), [models, setModels] = useState([]), [localMsg, setLocalMsg] = useState(''), [msg, setMsg] = useState('');
  useEffect(() => {
    if (!open) return;
    const backend = st.chat.backend === 'auto' ? (e.keys.anthropic ? 'anthropic' : e.keys.openai ? 'openai' : 'keywords') : st.chat.backend;
    setF({ backend, baseUrl: st.chat.baseUrl || '', model: st.chat.model || '', actionNotes: st.actionNotes !== false, downloads: st.downloads || '', renders: st.renders || '' });
    setModels(st.chat.model ? [st.chat.model] : []); setLocalMsg('');
    setMsg(Object.entries(st.from || {}).filter(([, v]) => v.startsWith('env')).map(([k, v]) => `${k} comes from ${v}`).join('; '));
  }, [open]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const findModels = async () => {
    const base = f.baseUrl.trim() || e.localPresets[0].url; setLocalMsg('Asking ' + base + '...');
    try { const r = await fetch('/api/llm/models?base=' + encodeURIComponent(base)); const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setModels(j.models); set('model', j.models.includes(f.model) ? f.model : j.models[0] || '');
      setLocalMsg(j.models.length ? `${j.models.length} model${j.models.length > 1 ? 's' : ''} found.` : 'The server answered but lists no models. Pull one first (for example: ollama pull llama3.2).');
    } catch (err) { setLocalMsg(err.message); }
  };
  const save = async () => {
    const body = { downloads: f.downloads.trim() || null, renders: f.renders.trim() || null, actionNotes: f.actionNotes,
      chat: { backend: f.backend, ...(f.backend === 'local' ? { baseUrl: f.baseUrl.trim() || null, model: f.model || null } : {}) } };
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json();
    if (!r.ok) { setMsg(j.error); return; }
    apply(j); setOpen(false); toast('Settings saved', true);
  };
  const keyNote = k => e.keys[k] ? 'Key set.' : 'Add the key in API keys and providers below, or set ' + (k === 'anthropic' ? 'ANTHROPIC' : 'OPENAI') + '_API_KEY.';
  return <Drawer id="settings" className="settings-sheet" isOpen={open} onOpenChange={setOpen} side="end" width={440} label="Settings" padding={0} experimental={{ isFullWidthOnMobile: true }}>
    {f && <form id="settings-form" onSubmit={ev => { ev.preventDefault(); save(); }}>
      <header className="sheet-h"><h2 id="h-settings">Settings</h2><IconBtn n="x" label="Close settings" onClick={() => setOpen(false)} /></header>
      <div className="sheet-b">
        <fieldset><legend>Chat</legend>
          <div className="radios" id="backend">
            {BACKENDS.map(([v, l, d]) => <label key={v} className="rcard"><input type="radio" name="backend" value={v} checked={f.backend === v} onChange={() => set('backend', v)} />
              <span><b>{l}</b><small id={v === 'anthropic' || v === 'openai' ? 'key-' + v : undefined}>{d || keyNote(v)}</small></span></label>)}
          </div>
          {f.backend === 'local' && <div id="local-box" className="col">
            <label className="lbl" htmlFor="local-url">Server address</label>
            <div className="row"><input id="local-url" type="url" placeholder={e.localPresets[0].url} className="grow" value={f.baseUrl} onChange={ev => set('baseUrl', ev.target.value)} />
              <select id="local-preset" aria-label="Common local servers" value="" onChange={ev => ev.target.value && set('baseUrl', ev.target.value)}><option value="">Common servers</option>{e.localPresets.map(x => <option key={x.url} value={x.url}>{x.label} ({x.url.replace('http://', '')})</option>)}</select></div>
            <label className="lbl" htmlFor="local-model">Model</label>
            <div className="row"><select id="local-model" className="grow" value={f.model} onChange={ev => set('model', ev.target.value)}><option value="">First model the server lists</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>
              <Button id="find-models" variant="secondary" size="sm" label="Find models" onClick={findModels} /></div>
            <p className="fine" id="local-msg" role="status">{localMsg}</p>
          </div>}
          {f.backend === 'agent' && <div className="row"><Button id="settings-connect" variant="secondary" size="sm" label="Connect agent" onClick={openConnect} /><span className="fine">{e.agent && e.agent.connected ? `${e.agent.name} connected` : 'No agent connected yet'}</span></div>}
          <Switch id="action-notes" label="Note terminal edits here" description="One line, never the terminal conversation" value={f.actionNotes} onChange={v => set('actionNotes', v)} />
        </fieldset>
        <fieldset><legend>API keys and providers</legend>
          <div className="row"><Button id="settings-keys" variant="secondary" size="sm" label="API keys and providers" onClick={openKeys} /><span className="fine" id="keys-summary">{(() => { const k = V.broll ? V.broll.sources.filter(x => x.on && !['upload', 'library', 'screen'].includes(x.id)).map(x => x.name) : []; return k.length ? `On: ${k.join(', ')}` : 'Pexels, Pixabay, Higgsfield, OpenAI, Anthropic, Google, Replicate, fal'; })()}</span></div>
          <p className="fine">Stock footage and b-roll generators with your own keys. Keys stay on this computer.</p>
        </fieldset>
        <fieldset><legend>Folders</legend>
          <label className="lbl" htmlFor="set-downloads">Reference downloads</label>
          <input id="set-downloads" placeholder={st.defaultDownloads} spellCheck="false" autoComplete="off" value={f.downloads} onChange={ev => set('downloads', ev.target.value)} />
          <label className="lbl" htmlFor="set-renders">Copy finished reels to</label>
          <input id="set-renders" placeholder={'none: reels stay in ' + st.defaultRenders} spellCheck="false" autoComplete="off" value={f.renders} onChange={ev => set('renders', ev.target.value)} />
          <p className="fine">Full paths. Empty uses the default.</p>
        </fieldset>
        <fieldset><legend>Look</legend>
          <div id="theme-seg"><SegmentedControl label="Theme" value={theme} onChange={setTheme} size="sm"><SegmentedControlItem value="dark" label="Dark" /><SegmentedControlItem value="light" label="Light" /></SegmentedControl></div>
          <Switch id="glass" label="Glass panels" description="Off uses solid panels. Faster on older computers." value={glass} onChange={setGlass} />
        </fieldset>
        <fieldset><legend>Setup</legend>
          <div className="row"><Button id="settings-setup" variant="secondary" size="sm" label="Setup check" onClick={openSetup} /><span className="fine">{e.setup ? (e.setup.ready ? (Object.keys(e.setup.missing).length ? `Ready. ${Object.keys(e.setup.missing).length} optional extra${Object.keys(e.setup.missing).length > 1 ? 's' : ''} missing.` : 'Everything is installed.') : 'Something needed is missing.') : 'Checking'}</span></div>
        </fieldset>
        <p id="settings-msg" className="fine" role="status">{msg}</p>
      </div>
      <footer className="sheet-f"><Button variant="ghost" label="Cancel" onClick={() => setOpen(false)} /><Button id="save-settings" type="submit" variant="primary" label="Save" /></footer>
    </form>}
  </Drawer>;
}
