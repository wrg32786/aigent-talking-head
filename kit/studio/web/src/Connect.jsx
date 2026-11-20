// Connect agent: pick your terminal agent, copy what it needs (with this install's real paths), and watch it connect.
import { useEffect, useState } from 'react';
import { Drawer } from '@astryxdesign/core/Drawer';
import { Badge } from '@astryxdesign/core/Badge';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, toast, Icon, IconBtn } from './lib.jsx';

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast('Copied', true);
}
export function CopyBlock({ code, label, id }) {
  return <div className="copyblock" id={id}><pre><code>{code}</code></pre><IconBtn n="copy" label={'Copy ' + (label || '')} onClick={() => copyText(code)} /></div>;
}

export function connState(a) {
  if (a && a.listening) return { k: 'on', dot: 'success', text: `Connected: ${a.name || 'your agent'}, listening` };
  if (a && a.connected) return { k: 'busy', dot: 'warning', text: `Connected: ${a.name || 'your agent'}, busy in the terminal` };
  return { k: 'off', dot: 'neutral', text: 'Waiting for your agent' };
}

export function Connect({ V, apply, open, setOpen }) {
  const [info, setInfo] = useState(null), [pick, setPick] = useState(null), [mode, setMode] = useState('steps');
  useEffect(() => {
    if (!open) return;
    api('/api/connect').then(j => { setInfo(j); setPick(p => p || j.selected || 'claude'); }).catch(() => {});
  }, [open]);
  const choose = id => { setPick(id); api('/api/settings', { agent: id }).then(apply).catch(() => {}); };
  const a = V.env.agent || {}, st = connState(a), ag = info && info.agents.find(x => x.id === pick);
  return <Drawer id="connect" className="settings-sheet connect-sheet" isOpen={open} onOpenChange={setOpen} side="end" width={540} label="Connect agent" padding={0} experimental={{ isFullWidthOnMobile: true }}>
    <header className="sheet-h"><h2 id="h-connect">Connect agent</h2><IconBtn n="x" label="Close" onClick={() => setOpen(false)} /></header>
    <div className="sheet-b">
      <div id="connect-status" className={'conn-status ' + st.k} role="status" aria-live="polite">
        {st.k === 'on' ? <Icon n="check" className="conn-ok" /> : <StatusDot variant={st.dot} label={st.text} isPulsing={st.k === 'off'} />}
        <span><b>{st.text}</b><small>{st.k === 'on' ? 'Type in the Studio chat. It answers there.' : st.k === 'busy' ? 'Studio messages wait for its next step.' : 'Do the steps below. This turns green when it connects.'}</small></span>
      </div>
      {!info ? <p className="fine">Loading</p> : <>
        <fieldset><legend>Your agent</legend>
          <div className="agent-grid" role="radiogroup" aria-label="Your agent">
            {info.agents.map(x => <button key={x.id} type="button" role="radio" aria-checked={pick === x.id} className={'agent-card' + (pick === x.id ? ' on' : '')} data-agent={x.id} onClick={() => choose(x.id)}>{x.name}</button>)}
          </div>
        </fieldset>
        <div id="connect-mode"><SegmentedControl label="How" size="sm" value={mode} onChange={setMode}>
          <SegmentedControlItem value="steps" label="Step by step" /><SegmentedControlItem value="agent" label="Let my agent set it up" /></SegmentedControl></div>
        {mode === 'agent' ? <div className="conn-steps" id="connect-prompt">
          <p className="fine">Paste this into {ag ? ag.name : 'your agent'}. It reads AGENTS.md, registers itself and starts listening.</p>
          <CopyBlock id="setup-prompt" code={info.prompt} label="the setup prompt" />
        </div> : ag && <ol className="conn-steps" id="connect-steps">
          {ag.steps.map((s, i) => <li key={i}><b>{s.title}</b>{s.note && <small>{s.note}</small>}<CopyBlock code={s.code} label={s.title.toLowerCase()} /></li>)}
          <li><b>Restart {ag.name}</b><small>{ag.restart}{ag.check ? ` Check with: ${ag.check}` : ''}</small></li>
          <li><b>Then say this to it</b><CopyBlock id="say-line" code={ag.say} label="what to say" /></li>
        </ol>}
        {ag && <p className="fine conn-docs">{ag.verified ? <Badge label="Checked against the docs" variant="success" /> : <Badge label="Not verified" variant="warning" />}{' '}
          {ag.docs.map((d, i) => <a key={d} href={d} target="_blank" rel="noreferrer">{i ? `docs ${i + 1}` : 'Official docs'}</a>)}</p>}
      </>}
    </div>
  </Drawer>;
}
