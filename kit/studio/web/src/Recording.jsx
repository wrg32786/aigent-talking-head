// The Recording tab: film yourself (Recorder.jsx, with Scripts and the teleprompter), and every take you have filmed in
// any video (GET /api/recordings). A take joins a video from here: Use in this video, or Use in a new video, which starts
// a fresh video and puts the take in it. Takes filmed before a video is named wait in a holding folder (kit/studio/recordings.mjs).
import { useEffect, useState } from 'react';
import { api, file, toast, Icon } from './lib.jsx';
import { Recorder } from './Recorder.jsx';
import { Scripts } from './Scripts.jsx';
import { clock } from './Player.jsx';

const day = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };

export function Recordings({ s, apply, toNew }) {
  const [list, setList] = useState(null), [busy, setBusy] = useState(null), [failed, setFailed] = useState(false), [tries, setTries] = useState(0);
  const takesSig = (s.takes || []).map(t => t.id + t.status).join() + '|' + s.job + '|' + (s.footage || []).length;
  useEffect(() => { let live = true; setFailed(false); api('/api/recordings').then(j => { if (live) setList(j.recordings); }).catch(() => { if (live) { setFailed(true); setList([]); } }); return () => { live = false; }; }, [takesSig, tries]);
  const use = async (x, newVideo) => {
    setBusy(x.file);
    try { const v = await api('/api/recordings/use', { file: x.file, newVideo }); apply(v); toast(newVideo ? `New video ${v.state.job} started with this take` : `Added to ${v.state.job}`, true); toNew(); }
    catch {} finally { setBusy(null); }
  };
  return <section className="recs" id="recordings" aria-labelledby="recs-h">
    <h3 className="lbl" id="recs-h">Your recordings</h3>
    {failed ? <p className="fine" id="recs-err" role="alert">We could not load your recordings. <button type="button" className="linkish" onClick={() => setTries(k => k + 1)}>Try again</button></p>
      : !list ? <p className="fine">Loading your recordings</p>
      : !list.length ? <p className="fine" id="recs-empty">Nothing filmed yet. Takes you record show up here, ready to use in any video.</p>
      : <ul className="rec-list">{list.map(x => <li key={x.file} className="rec-item glass-card" data-file={x.file}>
        <a className="rec-thumb" href={file(x.file)} target="_blank" rel="noreferrer" aria-label={`Play ${x.script || 'this take'}`}>{x.thumb ? <img src={file(x.thumb)} alt="" /> : <Icon n="film" />}<span className="rec-ov" aria-hidden="true"><Icon n="play" /></span></a>
        <span className="rec-meta"><b>{x.script || 'Take'}</b><span className="fine">{[x.seconds != null ? clock(x.seconds) : null, day(x.at), x.job ? `from ${x.job}` : 'not in a video yet'].filter(Boolean).join(', ')}</span></span>
        <span className="rec-act">
          {x.inVideo ? <span className="fine rec-in"><Icon n="check" />In this video</span>
            : s.job && <button type="button" className="btn outline sm rec-use" disabled={!!busy} onClick={() => use(x, false)}>Use in this video</button>}
          <button type="button" className={'btn sm rec-new' + (s.job ? ' ghost' : '')} disabled={!!busy} onClick={() => use(x, true)}>Use in a new video</button>
        </span>
      </li>)}</ul>}
  </section>;
}

export function Recording({ V, s, apply, hidden, onLive, toNew }) {
  const [rec, setRec] = useState(() => localStorage.getItem('studio.rec.open') === '1' || /#record(?![a-z])/.test(location.hash));
  const [readId, setReadId] = useState(null);
  const open = v => { localStorage.setItem('studio.rec.open', v ? '1' : '0'); setRec(v); };
  return <section className="step" id="s-recording" aria-labelledby="h-recording" hidden={hidden}>
    <header className="sh"><h2 id="h-recording">Recording</h2><p className="sub">Film yourself with this computer's camera and mic. Use any take in a video, now or later.</p></header>
    {rec ? <Recorder V={V} s={s} apply={apply} onClose={() => open(false)} onLive={onLive} visible={!hidden} scriptId={readId} />
      : <div className="sources"><button type="button" className="drop big recsrc" id="record-now" onClick={() => open(true)}>
        <Icon n="camera" className="di" /><strong>Record now</strong><span>Camera and mic on this computer</span>
      </button></div>}
    <Recordings s={s} apply={apply} toNew={toNew} />
    {s.job ? <Scripts V={V} s={s} apply={apply} onRead={id => { setReadId(id); open(true); requestAnimationFrame(() => document.getElementById('recorder')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }} />
      : <p className="fine" id="scripts-need-job">Saved scripts belong to a video. Name your video at the top to write one. You can still paste a script into the teleprompter.</p>}
  </section>;
}
