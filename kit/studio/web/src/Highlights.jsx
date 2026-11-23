// Highlights: an optional Start view for a long talk or podcast. We transcribe it locally, suggest up to N complete
// moments, and the ones you tick become the take for the reel. Your agent can rescore them through MCP tools.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { NeedFix } from './Fix.jsx';
import { copyText } from './Connect.jsx';
import { api, file, toast, Icon, IconBtn } from './lib.jsx';
import { clock } from './Player.jsx';

export function Highlights({ V, s, apply, go, hidden }) {
  const h = V.highlights || {}, running = !!(V.task && V.task.status === 'running');
  const tx = h.tx || {}, finding = h.pending === 'transcript' || tx.status === 'running';
  const extracting = running && V.task.kind === 'highlights';
  const cands = h.candidates || [], kept = cands.filter(c => c.keep);
  const [playing, setPlaying] = useState(null), [n, setN] = useState(h.n || 10);
  useEffect(() => { if (h.n) setN(h.n); }, [h.n]);
  const src = h.source, canFind = !!s.job && !!src && !finding && !extracting;
  const pickId = useRef(null);
  const find = () => api('/api/highlights/find', { n, min: h.min || 20, max: h.max || 60 }).then(apply).catch(() => {});
  const keep = (id, on) => api('/api/highlights/keep', { ids: [id], keep: on }).then(apply).catch(() => {});
  const pick = () => api('/api/highlights/pick', {}).then(j => { apply(j); pickId.current = j.task && j.task.id; toast('Extracting your highlights as the take.', true); }).catch(() => {});
  useEffect(() => {
    if (!pickId.current || !V.task || V.task.id !== pickId.current) return;
    if (V.task.status === 'done') { pickId.current = null; go('cut', true); toast('These highlights are your take.', true); }
    if (V.task.status === 'failed' || V.task.status === 'cancelled') { pickId.current = null; }
  }, [V.task, go]);
  const txPct = tx.total ? Math.round(100 * (tx.done || 0) / tx.total) : null;
  const status = !s.job ? 'Name the reel at the top to start.' : !src ? 'Add a talk or podcast on Start first.'
    : finding ? (txPct != null ? `Transcribing on this computer, ${txPct}%` : 'Transcribing on this computer.')
    : extracting ? 'Cutting the highlights into your take.'
    : tx.status === 'failed' ? (tx.error || 'Transcription failed.')
    : h.error ? h.error
    : h.usedAsTake ? 'These clips are your take. You can tick a different set and use them instead.'
    : cands.length ? `${cands.length} moment${cands.length === 1 ? '' : 's'} to pick from${h.scoredBy === 'agent' ? ', scored by your agent' : ', scored on this computer'}.`
    : h.long ? 'A long talk. Find highlights to pick the moments for a reel.'
    : 'Find highlights to pick the best moments.';
  return <section className="step" id="s-highlights" data-step="start" data-view="highlights" aria-labelledby="h-highlights" hidden={hidden}>
    <header className="sh"><h2 id="h-highlights">Highlights</h2><p className="sub">We transcribe a long talk on your computer, then suggest complete moments. Tick the ones to use as your take.</p></header>
    <NeedFix V={V} ids={['python', 'ffmpeg']} what="Finding highlights" apply={apply} />
    <div className="runbar glass-card" id="hl-bar">
      <Button id="hl-find" size="lg" variant={cands.length ? 'secondary' : 'primary'} label={cands.length ? 'Find again' : 'Find highlights'} isDisabled={!canFind} onClick={find} />
      <span className="stepper-n" id="hl-n"><span className="fine">Moments</span>
        <IconBtn n="minus" label="Fewer moments" disabled={n <= 1 || finding} onClick={() => setN(Math.max(1, n - 1))} />
        <b>{n}</b>
        <IconBtn n="plus" label="More moments" disabled={n >= 20 || finding} onClick={() => setN(Math.min(20, n + 1))} /></span>
      {kept.length > 0 && <Button id="hl-pick" variant="primary" label={extracting ? 'Cutting' : `Use ${kept.length} as my take`} isDisabled={extracting || finding} isLoading={extracting} onClick={pick} />}
      <span id="hl-status" className="fine" role="status">{status}</span>
    </div>
    {(finding || extracting) && <div id="hl-progress"><ProgressBar label={finding ? 'Transcribing' : 'Cutting highlights'} isLabelHidden isIndeterminate={txPct == null || extracting} value={finding && txPct != null ? txPct : undefined} /></div>}
    {src && <p className="fine" id="hl-src">Source: <b>{src.split('/').pop()}</b>{h.duration ? `, ${clock(h.duration)}` : ''}</p>}
    {playing && src && <div className="hl-now glass-card" id="hl-now">
      <video src={file(src)} controls autoPlay playsInline preload="auto" aria-label={playing.label || 'Highlight preview'}
        onLoadedMetadata={e => { e.currentTarget.currentTime = playing.start; }}
        onTimeUpdate={e => { if (playing.end && e.currentTarget.currentTime >= playing.end) { e.currentTarget.pause(); } }} />
      <IconBtn n="x" label="Close preview" onClick={() => setPlaying(null)} />
    </div>}
    <ul className="hl-list" id="hl-list" aria-label="Highlight moments">
      {cands.map(c => <li key={c.id} className={'hl glass-card' + (c.keep ? ' on' : '')} data-id={c.id}>
        <label className="hl-keep"><input type="checkbox" checked={!!c.keep} onChange={e => keep(c.id, e.target.checked)} aria-label={`Use ${c.label}`} /><span className="sr">Use {c.label}</span></label>
        <button type="button" className="hl-play" aria-label={`Play ${c.label} from ${clock(c.start)}`} onClick={() => setPlaying(playing && playing.id === c.id ? null : { id: c.id, start: c.start, end: c.end, label: c.label })}>
          {src ? <video src={file(src) + `#t=${Math.max(0, c.start)}`} muted preload="metadata" aria-hidden="true" tabIndex={-1} /> : <Icon n="play" />}
          <span className="clip-ov" aria-hidden="true"><Icon n="play" /></span>
          <span className="clip-dur mono">{clock(c.seconds)}</span>
        </button>
        <div className="hl-body">
          <header><b>{c.label}</b><span className="fine mono">{clock(c.start)} to {clock(c.end)}</span>{c.score != null && <Badge label={String(c.score)} variant="cyan" />}</header>
          <p className="hl-why">{c.reason}</p>
          <p className="fine hl-text">"{c.text}"</p>
        </div>
      </li>)}
    </ul>
    {cands.length > 0 && <div className="hl-agent glass-card" id="hl-agent">
      <p className="fine">Want your agent to rescore these? Copy the brief and send it, or use Ask my agent. The tools are find_highlights, score_highlights and pick_highlights.</p>
      <Button id="hl-copy" variant="secondary" size="sm" label="Copy brief for my agent" onClick={() => copyText(h.brief || '', 'Brief copied')} />
    </div>}
  </section>;
}
