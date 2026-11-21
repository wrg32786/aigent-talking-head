import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from './lib.jsx';

// Where a reference breakdown is: the bar, one live line naming the stage, and a folded list with a check as each
// stage finishes. v is the view the server keeps on the item (kit/studio/stages.mjs), so a reload shows the same.
// A stage that stopped shows one plain line with Try again.
export function Stages({ v, id, onRetry }) {
  if (!v || !Array.isArray(v.list)) return null;
  const done = v.list.filter(x => x.state === 'done').length, busy = !!v.stage;
  if (!busy && !v.failed) return null;
  return <div className="stg" id={id} data-stage={v.stage || ''} data-failed={v.failed || ''}>
    {busy && <ProgressBar label={v.label} isLabelHidden value={v.percent} />}
    {busy ? <p className="stg-line" role="status"><span className="rn-spin" aria-hidden="true" /><span className="stg-now">{v.label}</span></p>
      : <p className="stg-line stg-failed" role="alert"><span>{v.message} Nothing was changed.</span>{onRetry && <Button size="sm" variant="secondary" label="Try again" onClick={onRetry} />}</p>}
    <details className="stg-fold">
      <summary>{done} of {v.list.length} steps done</summary>
      <ol className="stg-list">
        {v.list.map(x => <li key={x.id} data-state={x.state}><span className="stg-mark" aria-hidden="true">{x.state === 'done' ? <Icon n="check" /> : null}</span>
          <span>{x.label}</span>{x.state === 'failed' ? <span className="stg-stop">, stopped here</span> : <span className="sr">{x.state === 'done' ? ', done' : x.state === 'now' ? ', in progress' : ''}</span>}</li>)}
      </ol>
    </details>
  </div>;
}
