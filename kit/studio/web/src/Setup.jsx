// Setup check: every dependency as ready or missing. A missing one says why it matters and offers the fix buttons
// (web/src/Fix.jsx): Install when Studio can do it itself, a link for what only you can install, and Send or Copy
// for my agent. The same list is the MCP setup_status tool (kit/setup.mjs).
import { useEffect, useRef, useState } from 'react';
import { Drawer } from '@astryxdesign/core/Drawer';
import { Button } from '@astryxdesign/core/Button';
import { api, Icon, IconBtn } from './lib.jsx';
import { FixActions, fixOf } from './Fix.jsx';
export { NeedFix } from './Fix.jsx';

// missing first, the ones only you (or your agent) can install at the top
const rank = x => x.status === 'ready' ? 2 : x.user ? 0 : 1;

export function SetupCheck({ V, open, setOpen }) {
  const [st, setSt] = useState(null), [busy, setBusy] = useState(false);
  const load = fresh => { setBusy(true); api('/api/setup' + (fresh ? '?fresh=1' : '')).then(setSt).catch(() => {}).finally(() => setBusy(false)); };
  useEffect(() => { if (open) load(false); }, [open]);
  // an install that ends while this is open: read the list again
  const t = V && V.task, ended = useRef(null);
  useEffect(() => { if (open && t && t.kind === 'install' && t.status !== 'running' && ended.current !== t.id) { ended.current = t.id; load(false); } }, [open, t && t.id, t && t.status]);
  const items = st ? st.items.slice().sort((a, b) => rank(a) - rank(b)) : null, missing = items ? items.filter(x => x.status !== 'ready').length : 0;
  return <Drawer id="setup" className="settings-sheet" isOpen={open} onOpenChange={setOpen} side="end" width={500} label="Setup check" padding={0} experimental={{ isFullWidthOnMobile: true }}>
    <header className="sheet-h"><h2 id="h-setup">Setup check</h2><IconBtn n="x" label="Close" onClick={() => setOpen(false)} /></header>
    <div className="sheet-b">
      <p className="fine" id="setup-lead">{!st ? 'Checking this computer.' : missing ? 'Missing things come first. Install does it for you. For the rest, send or copy the steps to your agent.' : 'Everything Studio uses is installed.'}</p>
      <ul className="setup-list" id="setup-list">
        {items ? items.map(x => { const f = fixOf(V, x.id); return <li key={x.id} data-id={x.id} className={x.status}>
          <span className="sdot" aria-hidden="true">{x.status === 'ready' ? <Icon n="check" /> : <Icon n="x" />}</span>
          <span className="sl"><b>{f ? f.label : x.label}</b><small>{x.status === 'ready' ? x.detail : f ? f.why : `Needed for ${x.feature}.`}</small>
            {x.status !== 'ready' && <FixActions V={V} id={x.id} />}</span>
          <span className="sr">{x.status === 'ready' ? 'ready' : x.user ? 'needs you' : 'missing'}</span>
        </li>; }) : <li className="fine">Checking</li>}
      </ul>
    </div>
    <footer className="sheet-f"><Button id="setup-recheck" variant="secondary" label="Check again" isLoading={busy} onClick={() => load(true)} /></footer>
  </Drawer>;
}
