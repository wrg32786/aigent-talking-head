import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Button } from '@astryxdesign/core/Button';
import { useEffect, useState } from 'react';
import { Icon } from './lib.jsx';
import { tookWords } from '../../stages.mjs';

// seconds since a time on the server's clock (the same computer), counted up once a second
function useSince(since) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (since == null) return undefined; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [since]);
  return since == null ? null : Math.max(0, Math.round((now - since) / 1000));
}

// Where a reference breakdown is: the bar, one live line naming the stage, and a folded list with a check as each
// stage finishes. v is the view the server keeps on the item (kit/studio/stages.mjs), so a reload shows the same.
// The live line carries how long the stage has run ("Reading graphics, 1 min 20 s") and counts up, so a long stage
// is seen to be working; each finished stage keeps its time in the list.
// A stage that stopped shows one plain line with Try again.
export function Stages({ v, id, onRetry }) {
  if (!v || !Array.isArray(v.list)) return null;
  const done = v.list.filter(x => x.state === 'done').length, busy = !!v.stage;
  const secs = useSince(busy ? v.since : null);
  if (!busy && !v.failed) return null;
  return <div className="stg" id={id} data-stage={v.stage || ''} data-failed={v.failed || ''}>
    {busy && <ProgressBar label={v.label} isLabelHidden value={v.percent} />}
    {busy ? <p className="stg-line" role="status"><span className="rn-spin" aria-hidden="true" /><span><span className="stg-now">{v.label}</span>{secs != null && <span className="stg-time" id={id + '-time'}>, {tookWords(secs)}</span>}</span></p>
      : <p className="stg-line stg-failed" role="alert"><span>{v.message} Nothing was changed.</span>{onRetry && <Button size="sm" variant="secondary" label="Try again" onClick={onRetry} />}</p>}
    <details className="stg-fold">
      <summary>{done} of {v.list.length} steps done</summary>
      <ol className="stg-list">
        {v.list.map(x => <li key={x.id} data-state={x.state}><span className="stg-mark" aria-hidden="true">{x.state === 'done' ? <Icon n="check" /> : null}</span>
          <span>{x.label}</span>{x.took != null && x.state !== 'now' && <span className="stg-took">, {tookWords(x.took)}</span>}{x.state === 'failed' ? <span className="stg-stop">, stopped here</span> : <span className="sr">{x.state === 'done' ? ', done' : x.state === 'now' ? ', in progress' : ''}</span>}</li>)}
      </ol>
    </details>
  </div>;
}
