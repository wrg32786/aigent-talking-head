import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, file, toast, grow, pickState, Icon, IconBtn, SITE, STATUS, KIND_NAME, MODE_TIP } from './lib.jsx';
import { upload } from './upload.js';
import { canWrite, NO_WRITER } from './Scripts.jsx';

export function Reference({ CAT, V, s, apply, patch }) {
  const r = s.reference, env = V.env, q = r.queue || [], t = env.tools || {};
  const [urls, setUrls] = useState('');
  const ta = useRef(null), fileIn = useRef(null);
  const running = V.task && V.task.status === 'running';
  const addLinks = text => {
    const list = (text ?? urls).split(/\s+/).filter(Boolean);
    if (!list.length) { toast('Paste a link first'); ta.current.focus(); return; }
    if (!s.job) { toast('Name the reel first (top left)'); document.getElementById('job')?.focus(); return; }
    api('/api/reference/url', { urls: list }).then(j => { apply(j); setUrls(''); requestAnimationFrame(() => grow(ta.current)); const bad = j.added.filter(x => x.status === 'failed'); if (bad.length) toast(bad[0].error); }).catch(() => {});
  };
  const item = (id, action) => api('/api/reference/item', { id, action }).then(apply);
  return <section className="step" id="s-ref" data-step="reference" aria-labelledby="h-ref">
    <header className="sh"><h2 id="h-ref">Reference</h2><Badge label="Optional" variant="neutral" /><p className="sub">A reel you like. Studio breaks it down for you and your agent.</p></header>
    <div className="urlbar glass-card">
      <Icon n="link" className="ui" />
      <label className="sr" htmlFor="ref-urls">Reference links, one per line</label>
      <textarea id="ref-urls" ref={ta} rows={1} placeholder="Paste a video link" autoComplete="off" spellCheck="false" aria-describedby="ref-tools" value={urls}
        onChange={e => { setUrls(e.target.value); grow(e.target); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addLinks(); } }}
        onPaste={e => { const txt = e.clipboardData.getData('text').trim(); if (!urls.trim() && /^https?:\/\/\S+$/.test(txt) && s.job) { e.preventDefault(); addLinks(txt); } }} />
      <Button id="ref-add" variant="primary" size="lg" label="Add" onClick={() => addLinks()} />
      <span className="hide-sm"><Button id="drop-ref" variant="secondary" size="lg" label="Upload" icon={<Icon n="upload" />} onClick={() => fileIn.current.click()} /></span>
      <span className="ph-only"><Button variant="secondary" size="lg" isIconOnly label="Upload a reference video file" icon={<Icon n="upload" />} onClick={() => fileIn.current.click()} /></span>
      <input type="file" id="file-ref" ref={fileIn} accept="video/*,.mov,.mp4,.m4v,.webm,.mkv" hidden onChange={e => { upload('reference', [...e.target.files], s, apply); e.target.value = ''; }} />
    </div>
    <p className="fine" id="ref-tools">{t.ytdlp ? 'Works with YouTube, TikTok, X, Vimeo, Instagram and .mp4 links. Use videos you have the rights to.'
      : <><Badge label="yt-dlp not installed" variant="warning" /> Direct .mp4 and Instagram links work now. For the rest: <code>pip install yt-dlp</code>. Use videos you have the rights to.</>}</p>
    <ol id="ref-queue" className="queue" aria-label="Reference queue" aria-live="polite">
      {q.slice().reverse().map(it => {
        const busy = it.status === 'downloading' || it.status === 'tearing', isActive = r.active === it.id;
        const label = isActive && it.status === 'ready' ? 'In use' : (STATUS[it.status] || it.status) + (it.status === 'downloading' && it.progress ? ` ${it.progress}%` : '');
        return <li key={it.id} className={`qi glass-card ${it.status}${isActive ? ' active' : ''}`}>
          <span className="site">{SITE[it.site] || 'Link'}</span><span className="qt" title={it.url}>{it.title || it.url}</span>
          <span className="qb"><Badge label={label} variant={isActive ? 'cyan' : it.status === 'failed' ? 'error' : it.status === 'ready' ? 'success' : 'neutral'} /></span>
          <span className="qa">
            {it.status === 'ready' && !isActive && <IconBtn n="check" label="Use this reference" onClick={() => item(it.id, 'use')} />}
            {['failed', 'cancelled'].includes(it.status) && <IconBtn n="retry" label="Try again" onClick={() => item(it.id, 'retry')} />}
            <IconBtn n="x" label={(busy ? 'Stop ' : 'Remove ') + (it.title || it.url)} onClick={() => item(it.id, 'remove')} />
          </span>
          {busy && <div className="qbar"><ProgressBar label={STATUS[it.status]} isLabelHidden value={it.status === 'downloading' && it.progress ? it.progress : undefined} isIndeterminate={it.status === 'tearing' || !it.progress} /></div>}
          {it.error && <p className="err">{it.error}</p>}
          {it.trimmed && <p className="fine">Kept the first part of a longer video.</p>}
        </li>;
      })}
    </ol>
    {r.status === 'uploaded' && <Button id="ref-go" variant="secondary" label="Break down the file" isDisabled={running} onClick={() => api('/api/reference', {}).then(apply).catch(() => {})} />}
    <span id="ref-status" className="sr" role="status">{r.status === 'running' ? 'Breaking it down' : r.status === 'ready' ? 'Reference ready' : ''}</span>
    {r.extracted ? <Breakdown CAT={CAT} V={V} s={s} apply={apply} patch={patch} /> : !q.length && <div id="ref-empty" className="empty-art"><Icon n="film" /><p>Add a link to see its shots, beats and effects.</p></div>}
  </section>;
}

function Breakdown({ CAT, V, s, apply, patch }) {
  const r = s.reference, ex = r.extracted, q = r.queue || [];
  const sm = ex.summary || {}, mu = sm.music || {}, item = q.find(x => x.id === r.active);
  const len = sm.seconds || 0, cuts = (sm.cuts || []).filter(c => c > 0 && (!len || c < len));
  const edges = [0, ...cuts, len], shots = len ? edges.slice(1).map((e, i) => [edges[i], e]) : [];
  const beatGap = mu.bpm ? 60 / mu.bpm : 0, beats = beatGap && len ? Array.from({ length: Math.min(400, Math.floor(len / beatGap)) }, (_, i) => (i + 1) * beatGap) : [];
  const found = [];
  if (sm.captions && sm.captions.style) found.push(['captions', sm.captions.style]);
  for (const [k, n] of Object.entries(ex.transitions || {})) found.push(['transition', n > 1 ? `${k} x${n}` : k]);
  for (const x of ex.entrances || []) found.push(['title', x]);
  for (const x of ex.finishes || []) found.push(['finish', x]);
  for (const x of ex.graphics || []) found.push(['graphic', x]);
  for (const x of ex.effects || []) found.push(['effect', x]);
  if (ex.titles) found.push(['titles', String(ex.titles)]);
  const sugg = (sm.suggestions || []).filter(x => CAT.items[x.ref]);
  const engine = sm.engine;
  return <div id="ref-out" className="teardown glass-card">
    <div className="td-head">
      <h3 title={item ? item.url : ''}>Breakdown<span className="fine"> {item ? SITE[item.site] || 'Link' : 'File'}{engine ? ', ' + engine : ''}</span></h3>
      <div id="ref-mode" title={MODE_TIP[r.mode]}>
        <SegmentedControl label="Reference mode" value={r.mode} onChange={m => patch({ reference: { mode: m } })} size="sm">
          {['influence', 'recreate', 'off'].map(m => <SegmentedControlItem key={m} value={m} label={m[0].toUpperCase() + m.slice(1)} />)}
        </SegmentedControl>
      </div>
    </div>
    <div className="td-body">
      {r.contact ? <img src={file(r.contact)} alt="Contact sheet of the reference, one frame per shot" /> : <div className="empty-art"><Icon n="film" /></div>}
      <div>
        <div className="stats">
          <Stat b={len ? `${Math.round(len)} s` : '?'} l="length" /><Stat b={String(ex.shots)} l="shots" />
          <Stat b={mu.bpm ? String(mu.bpm) : '?'} l={'BPM' + (mu.energy ? `, ${mu.energy} energy` : '')} /><Stat b={sm.averageShot ? `${sm.averageShot} s` : '?'} l={(sm.pacing || 'pace') + ' cut'} />
        </div>
        {len > 0 && <div className="timeline" role="img" aria-label={`Timeline: ${shots.length} shots over ${Math.round(len)} seconds${mu.bpm ? `, beat grid at ${mu.bpm} BPM` : ''}`}>
          <div className="tl">{shots.map(([a, b], i) => <div key={i} className="shot" style={{ width: `${((b - a) / len) * 100}%` }} title={`Shot ${i + 1}: ${a.toFixed(1)} to ${b.toFixed(1)} s`}>{(b - a) / len > 0.06 ? i + 1 : ''}</div>)}</div>
          {beats.length > 0 && <div className="beats" aria-hidden="true">{beats.map((x, i) => <i key={i} style={{ left: `${(x / len) * 100}%` }} />)}</div>}
          <div className="tl-legend"><span>0 s</span><span>{mu.bpm ? `beat grid, ${mu.bpm} BPM` : ''}</span><span>{Math.round(len)} s</span></div>
        </div>}
        {found.length > 0 && <div className="found" aria-label="Found in the reference">{found.map(([k, v], i) => <span key={i} className="tag"><em>{k}</em>{v}</span>)}</div>}
        {sugg.length > 0 && <div>
          <div className="sugg-h"><span className="lbl">Suggested picks</span><Button variant="secondary" size="sm" label="Pick all" onClick={() => api('/api/reference/apply', {}).then(v => { apply(v); toast('Reference picks added', true); })} /></div>
          <div className="chips">{sugg.map(x => {
            const it = CAT.items[x.ref], st = pickState(s, it);
            return <button key={x.ref} className={'chip' + (st === 'allow' ? ' on' : '')} type="button" title={x.why} aria-pressed={String(st === 'allow')} onClick={() => patch({ picks: { [x.ref]: st === 'allow' ? 'clear' : 'allow' } })}>
              <Icon n={st === 'allow' ? 'check' : 'plus'} /><span className="k">{KIND_NAME[it.kind] || it.kind}</span>{it.id}</button>;
          })}</div>
        </div>}
        <div className="row ref-script"><Button id="ref-script" variant="secondary" size="sm" label="Write script from this reference" icon={<Icon n="script" />} isDisabled={!canWrite(V.env)}
          onClick={() => api('/api/scripts/from-reference', {}).then(j => { apply(j); toast(V.env.backend === 'agent' ? 'Sent to your agent with the breakdown' : 'Writing the script', true); }).catch(() => {})} />
          {!canWrite(V.env) && <span className="fine">{NO_WRITER}</span>}</div>
        <p className="fine">Your agent sees this breakdown. Try: "use the transitions from the reference but calmer".</p>
      </div>
    </div>
  </div>;
}
const Stat = ({ b, l }) => <div className="stat"><b>{b}</b><span>{l}</span></div>;
