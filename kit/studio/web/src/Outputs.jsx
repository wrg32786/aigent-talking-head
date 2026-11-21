// The Outputs library: every render of this video with the settings that made it (look, length, pieces, b-roll,
// files), and the other videos' latest. Edit this reel puts a version back in the editor exactly as it was; Compare plays
// two versions side by side and marks what changed. Nothing is deleted from here.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { api, file, toast, Icon, IconBtn } from './lib.jsx';
import { Spinner } from './ui.jsx';

const when = iso => { if (!iso) return ''; const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return (today ? 'Today ' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ') + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const ROWS = [['Rendered', v => when(v.at)], ['Take', v => v.take || 'Not recorded'], ['Draft', v => v.draft || 'Not recorded'], ['Look', v => v.settings ? v.settings.look : 'Not recorded'], ['Length', v => [v.seconds ? `${Math.round(v.seconds)} s` : null, v.settings && v.settings.pieces ? (k => `${k} piece${k === 1 ? '' : 's'}`)(v.settings.count != null ? v.settings.count : v.settings.pieces.length) : null].filter(Boolean).join(', ') || 'Not recorded'],
  ['B-roll', v => v.settings ? v.settings.broll : 'Not recorded']];

function Version({ v, latest, running, onReopen, cmp, onCompare }) {
  const [files, setFiles] = useState(v.files.length > 1);
  return <li className={'ov glass-card' + (latest ? ' latest' : '')} data-version={v.v}>
    <video src={file(v.reel)} preload="metadata" controls playsInline aria-label={`Version ${v.v}`} />
    <header><b>v{v.v}</b><span className="ov-flags">{v.current && <Badge label="This draft" variant="cyan" />}{latest && <Badge label="Latest" variant="cyan" />}</span></header>
    <dl>{ROWS.map(([k, f]) => <div key={k}><dt>{k}</dt><dd>{f(v)}</dd></div>)}</dl>
    {files && <ul className="ov-files">{v.files.map(f => <li key={f.path} data-size={f.size || ''}><a href={file(f.path)} download>{f.label}</a> <span className="fine mono">{f.path.split('/').pop()}</span></li>)}</ul>}
    <footer>
      <Button size="sm" variant="secondary" label="Edit this reel" className="ov-reopen" isDisabled={!v.reopen || running} onClick={() => onReopen(v)} />
      <Button size="sm" variant={cmp ? 'primary' : 'ghost'} label={cmp ? 'Comparing' : 'Compare'} className="ov-compare" onClick={() => onCompare(v)} />
      <a className="btn ghost sm ov-download" href={file(v.reel) + '?download'} download={(v.reel || '').split('/').pop()}>Download</a>
      <Button size="sm" variant="ghost" label={files ? 'Hide files' : 'Files'} className="ov-files-btn" onClick={() => setFiles(!files)} />
    </footer>
    {!v.reopen && <p className="fine">No saved build behind this one, so it plays but cannot re-open.</p>}
  </li>;
}

export function Outputs({ V, s, apply, go, open, setOpen }) {
  const ref = useRef(null), [scope, setScope] = useState('job'), [lib, setLib] = useState(null), [cmp, setCmp] = useState([]), [err, setErr] = useState('');
  const running = V.task && V.task.status === 'running';
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  useEffect(() => { if (!open) return; let live = true; setErr('');
    api('/api/outputs?all=' + (scope === 'all' ? 1 : 0)).then(j => live && setLib(j)).catch(e => live && setErr(e.message));
    return () => { live = false; }; }, [open, scope, (V.outputs || []).length, s.job]);
  const close = () => setOpen(false);
  const reopen = v => api('/api/reopen', { reel: v.reel }).then(j => { apply(j); close(); go('review', true); toast(`v${v.v} is back in the editor. Render makes the next version.`, true); }).catch(e => setErr(e.message));
  const compare = v => setCmp(c => c.includes(v.v) ? c.filter(x => x !== v.v) : [...c, v.v].slice(-2));
  const openJob = job => api('/api/videos/open', { job }).then(j => { apply(j); close(); go('review', true); toast(`Opened ${job}`, true); }).catch(e => setErr(e.message));
  const vs = lib ? lib.versions : [], pair = cmp.map(n => vs.find(v => v.v === n)).filter(Boolean);
  return <dialog ref={ref} className="fb outputs glass" id="outputs" aria-labelledby="out-h" onClose={close} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="fb-h"><div><h2 id="out-h">Outputs</h2><p className="fine">Every finished render, with its date, source take and draft. Edit this reel puts one back in the editor.</p></div>
      <div className="seg" role="group" aria-label="Show"><button type="button" id="out-job" aria-pressed={scope === 'job' ? 'true' : 'false'} onClick={() => setScope('job')}>This video</button><button type="button" id="out-all" aria-pressed={scope === 'all' ? 'true' : 'false'} onClick={() => setScope('all')}>All videos</button></div>
      <IconBtn n="x" label="Close" onClick={close} /></header>
    <div className="out-b">
      {!lib ? <Spinner label="Loading outputs" /> : vs.length ? <ol className="out-list" id="out-list" aria-label="Versions">{vs.map((v, i) => <Version key={v.v} v={v} latest={i === 0} running={running} onReopen={reopen} cmp={cmp.includes(v.v)} onCompare={compare} />)}</ol>
        : <p className="fine fb-empty" id="out-empty">No renders of {s.job || 'this video'} yet. Render makes one.</p>}
      {pair.length === 2 && <section className="out-cmp glass-card" id="out-compare" aria-label={`Compare v${pair[0].v} and v${pair[1].v}`}>
        <div className="oc-vids">{pair.map(v => <figure key={v.v}><video src={file(v.reel)} controls playsInline preload="metadata" /><figcaption>v{v.v}</figcaption></figure>)}</div>
        <table><tbody>{ROWS.slice(1).map(([k, f]) => { const a = f(pair[0]), b = f(pair[1]); return <tr key={k} className={a !== b ? 'diff' : ''}><th>{k}</th><td>{a}</td><td>{b}</td></tr>; })}</tbody></table>
      </section>}
      {pair.length === 1 && <p className="fine" id="out-cmp-hint">Pick one more version to compare.</p>}
      {scope === 'all' && lib && lib.jobs && <section className="out-jobs" aria-labelledby="out-jobs-h"><h3 id="out-jobs-h" className="eyebrow">Other videos</h3>
        {lib.jobs.length ? <ul id="out-jobs">{lib.jobs.map(j => <li key={j.job}><button type="button" data-job={j.job} disabled={running} onClick={() => openJob(j.job)}>
          <span className="oj-n">{j.job}</span><span className="fine">{j.versions} version{j.versions === 1 ? '' : 's'}{j.at ? `, last ${when(j.at)}` : ''}</span><span className="fine">{j.look || ''}</span><span className="fine">{j.seconds ? `${Math.round(j.seconds)} s` : ''}</span></button></li>)}</ul>
          : <p className="fine">No other videos with renders.</p>}</section>}
      <p className="fine fb-err" role="alert" id="out-err">{err}</p>
    </div>
  </dialog>;
}
