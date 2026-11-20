// Setup check: every dependency as ready or missing, with the one fix (kit/setup.mjs, also the MCP setup_status tool).
import { useEffect, useState } from 'react';
import { Drawer } from '@astryxdesign/core/Drawer';
import { Button } from '@astryxdesign/core/Button';
import { api, Icon, IconBtn } from './lib.jsx';
import { CopyBlock } from './Connect.jsx';

export function SetupCheck({ open, setOpen }) {
  const [st, setSt] = useState(null), [busy, setBusy] = useState(false);
  const load = fresh => { setBusy(true); api('/api/setup' + (fresh ? '?fresh=1' : '')).then(setSt).catch(() => {}).finally(() => setBusy(false)); };
  useEffect(() => { if (open) load(false); }, [open]);
  return <Drawer id="setup" className="settings-sheet" isOpen={open} onOpenChange={setOpen} side="end" width={500} label="Setup check" padding={0} experimental={{ isFullWidthOnMobile: true }}>
    <header className="sheet-h"><h2 id="h-setup">Setup check</h2><IconBtn n="x" label="Close" onClick={() => setOpen(false)} /></header>
    <div className="sheet-b">
      <p className="fine">Your agent installs all of this with <code>npm run setup:all</code>. Anything only you can do is listed first.</p>
      {st && st.forUser.length > 0 && <div className="for-user" id="setup-for-user"><b>For you</b><ul>{st.forUser.map(x => <li key={x}>{x}</li>)}</ul></div>}
      <ul className="setup-list" id="setup-list">
        {st ? st.items.map(x => <li key={x.id} data-id={x.id} className={x.status}>
          <span className="sdot" aria-hidden="true">{x.status === 'ready' ? <Icon n="check" /> : <Icon n="x" />}</span>
          <span className="sl"><b>{x.label}</b><small>{x.status === 'ready' ? x.detail : `Missing. Needed for ${x.feature}.`}</small>
            {x.fix && <CopyBlock code={x.fix} label={'the fix for ' + x.label} />}</span>
          <span className="sr">{x.status}</span>
        </li>) : <li className="fine">Checking</li>}
      </ul>
    </div>
    <footer className="sheet-f"><Button id="setup-recheck" variant="secondary" label="Check again" isLoading={busy} onClick={() => load(true)} /></footer>
  </Drawer>;
}

// one line where a feature needs something missing: what and the fix
export function NeedFix({ V, ids, what }) {
  const m = V.env.setup ? ids.map(k => V.env.setup.missing[k]).filter(Boolean) : [];
  if (!m.length) return null;
  return <p className="needfix" role="note"><Icon n="ban" />{what} needs {m.map(x => x.label).join(' and ')}. Fix: <code>{m.map(x => x.fix).join('; ')}</code></p>;
}
