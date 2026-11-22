import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { api, file, toast, grow, pickState, Icon, IconBtn, SITE, STATUS, KIND_NAME } from './lib.jsx';
import { upload } from './upload.js';
import { canWrite, NO_WRITER } from './Scripts.jsx';
import { FixActions } from './Fix.jsx';
import { Stages } from './Stages.jsx';
import { RefMode, RefNotice, RefParts, RefPlan, SavedLookNote } from './RefCard.jsx';

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
    <header className="sh"><h2 id="h-ref">Reference</h2><Badge label="Optional" variant="neutral" /><p className="sub">A reel you like. We break it down for you and your agent.</p></header>
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
      : <><Badge label="yt-dlp not installed" variant="warning" /> <FixActions V={V} id="ytdlp" apply={apply} /> Direct .mp4 links work now{t.instaloader ? ', and Instagram' : ''}. Use videos you have the rights to.</>}</p>
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
          {it.stages && (busy || it.status === 'failed') ? <div className="qbar"><Stages v={it.stages} id={`ref-stages-${it.id}`} onRetry={() => item(it.id, 'retry')} /></div> : busy && <div className="qbar"><ProgressBar label={STATUS[it.status]} isLabelHidden value={it.status === 'downloading' && it.progress ? it.progress : undefined} isIndeterminate={it.status === 'tearing' || !it.progress} /></div>}
          {it.error && <p className="err">{it.error}</p>}
          {it.fix && it.status === 'failed' && <FixActions V={V} id={it.fix} apply={apply} />}
          {it.trimmed && <p className="fine">Kept the first part of a longer video.</p>}
        </li>;
      })}
    </ol>
    {r.status === 'uploaded' && <Button id="ref-go" variant="secondary" label="Break down the file" isDisabled={running} onClick={() => api('/api/reference', {}).then(apply).catch(() => {})} />}
    {r.stages && (r.status === 'running' || r.stages.failed) && !r.extracted && <Stages v={r.stages} id="ref-stages-file" onRetry={running ? null : () => api('/api/reference', {}).then(apply).catch(() => {})} />}
    <span id="ref-status" className="sr" role="status">{r.status === 'running' ? 'Breaking it down' : r.status === 'ready' ? 'Reference ready' : ''}</span>
    {(r.file || r.out) && <PullScript V={V} s={s} apply={apply} />}
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
  const engine = sm.engine;
  return <div id="ref-out" className="teardown glass-card">
    <div className="td-head">
      <h3 title={item ? item.url : ''}>Breakdown<span className="fine"> {item ? SITE[item.site] || 'Link' : 'File'}</span></h3>
      <RefMode id="ref-mode" mode={r.mode} patch={patch} />
    </div>
    <RefRan V={V} s={s} apply={apply} ran={Array.isArray(ex.ran) ? ex.ran : []} fallback={/fallback/.test(engine || '')} />
    {/* one notice: when your saved look sits over the reference's, that line replaces "We set your look" */}
    {V.savedLook && V.savedLook.inUse ? <SavedLookNote V={V} apply={apply} id="saved-look-td" /> : <RefNotice s={s} patch={patch} id="ref-notice-td" />}
    {r.mode === 'influence' && <RefParts V={V} s={s} patch={patch} />}
    <RefPlan ex={ex} mode={r.mode} id="ref-plan-td" />
    <TitleChecks list={ex.checks || []} apply={apply} />
    <div className="row ref-script"><Button id="ref-script" variant="secondary" size="sm" label="Write script from this reference" icon={<Icon n="script" />} isDisabled={!canWrite(V.env)}
      onClick={() => api('/api/scripts/from-reference', {}).then(j => { apply(j); toast(V.env.backend === 'agent' ? 'Sent to your agent with the breakdown' : 'Writing the script', true); }).catch(() => {})} />
      {!canWrite(V.env) && <span className="fine">{NO_WRITER}</span>}</div>
    <details className="td-fold" id="ref-details"><summary>Details</summary>
      <div className="td-body">
        {r.contact ? <img src={file(r.contact)} alt="Contact sheet of the reference, one frame per shot" loading="lazy" /> : <div className="empty-art"><Icon n="film" /></div>}
        <div>
          <div className="stats">
            <Stat b={len ? `${Math.round(len)} s` : '?'} l="length" /><Stat b={String(ex.shots)} l="shots" />
            <Stat b={mu.bpm ? String(mu.bpm) : '?'} l={'BPM' + (mu.energy ? `, ${mu.energy} energy` : '')} /><Stat b={sm.averageShot ? `${sm.averageShot} s` : '?'} l={(sm.pacing || 'pace') + ' cut'} />
          </div>
          {len > 0 && <div className="timeline" role="img" aria-label={`Timeline: ${shots.length} shots over ${Math.round(len)} seconds${mu.bpm ? `, beats at ${mu.bpm} BPM` : ''}`}>
            <div className="tl">{shots.map(([a, b], i) => <div key={i} className="shot" style={{ width: `${((b - a) / len) * 100}%` }} title={`Shot ${i + 1}: ${a.toFixed(1)} to ${b.toFixed(1)} s`}>{(b - a) / len > 0.06 ? i + 1 : ''}</div>)}</div>
            {beats.length > 0 && <div className="beats" aria-hidden="true">{beats.map((x, i) => <i key={i} style={{ left: `${(x / len) * 100}%` }} />)}</div>}
            <div className="tl-legend"><span>0 s</span><span>{Math.round(len)} s</span></div>
          </div>}
          {found.length > 0 && <div className="found" aria-label="Found in the reference">{found.map(([k, v], i) => <span key={i} className="tag"><em>{k}</em>{v}</span>)}</div>}
        </div>
      </div>
    </details>
    {V.swap && V.swap.parts && V.swap.parts.length > 0 && <details className="td-fold" id="ref-byhand"><summary>Pick parts by hand</summary><Swap CAT={CAT} sw={V.swap} s={s} apply={apply} patch={patch} /></details>}
  </div>;
}

// Titles whose text the breakdown is not sure it read right (the recipe's check field): each with the reason and a field
// to fix the words before a draft. Save writes the text into the reference's recipe; saving it as it is says it was right.
const tcAt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, cap = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
function TitleChecks({ list, apply }) {
  if (!list.length) return null;
  return <div className="title-checks" id="title-checks" role="group" aria-labelledby="title-checks-h">
    <div className="tc-h"><span className="lbl" id="title-checks-h"><Icon n="info" />Check this text</span><span className="fine">{list.length === 1 ? 'We may have misread this title.' : `We may have misread these ${list.length} titles.`} Fix the words, or save them as they are.</span></div>
    <ul className="tc-list">{list.map(c => <TitleCheck key={c.n} c={c} apply={apply} />)}</ul>
  </div>;
}
function TitleCheck({ c, apply }) {
  const [text, setText] = useState(c.text), [busy, setBusy] = useState(false), id = 'tc-' + c.n;
  const save = e => { e.preventDefault(); if (!text.trim()) return; setBusy(true);
    api('/api/reference/title', { n: c.n, text }).then(j => { apply(j); toast(j.note, true); }).catch(() => {}).finally(() => setBusy(false)); };
  return <li className="tc" data-title={c.n}><form className="tc-row" onSubmit={save}>
    <span className="tc-at mono" aria-hidden="true">{tcAt(c.at)}</span>
    <label className="sr" htmlFor={id}>Text of the title at {tcAt(c.at)}</label>
    <input id={id} className="grow" value={text} spellCheck="false" autoComplete="off" aria-describedby={id + '-why'} onChange={e => setText(e.target.value)} />
    <Button id={id + '-save'} type="submit" size="sm" variant="secondary" label="Save" isLoading={busy} isDisabled={!text.trim()} /></form>
    <p className="fine tc-why" id={id + '-why'}>{cap(c.why)}.</p></li>;
}

// One row, only when something was not read: which parts ran, a fix for each that did not (never a command), and the
// built-in analyzer's warning when it did the reading
function RefRan({ V, s, apply, ran, fallback }) {
  const miss = ran.filter(x => !x.ok), fixes = [...new Set(miss.map(x => x.fix).filter(Boolean))], r = s.reference;
  if (!miss.length && !fallback) return null;
  const again = () => api('/api/reference/item', { id: r.active, action: 'retry' }).then(v => { apply(v); toast('Reading the reference again', true); }).catch(() => {});
  return <div className="ref-ran" id="ref-ran" role="note">
    <div className="ran-top">{fallback && <span id="ref-engine" title="It is rougher and can miss shots, titles and the grade."><Badge label="Read by the built-in analyzer" variant="warning" /></span>}
      {ran.length > 0 && <ul className="ran" aria-label="What we read from the reference">{ran.map(x => <li key={x.id} className={x.ok ? 'ok' : 'miss'} title={x.why} data-part={x.id}><i aria-hidden="true" />{x.label}<span className="sr">{x.ok ? ', read' : ', not read: ' + x.why}</span></li>)}</ul>}</div>
    <div className="ran-fix fine">
      {fallback && !fixes.includes('rea') && <div className="ran-row" data-fix="rea"><span>It can miss shots, titles and the grade. <b>{(V.env && V.env.fixes && V.env.fixes.rea && V.env.fixes.rea.label) || 'rea-video'}</b> reads it in full.</span><FixActions V={V} id="rea" apply={apply} /></div>}
      {fixes.map(id => { const ls = miss.filter(x => x.fix === id).map(x => x.label), parts = ls.length > 1 ? ls.slice(0, -1).join(', ') + ' and ' + ls[ls.length - 1].toLowerCase() : ls[0], f = V.env && V.env.fixes && V.env.fixes[id];
        return <div className="ran-row" key={id} data-fix={id}><span>{parts} did not run. <b>{f ? f.label : id}</b> reads {ls.length > 1 ? 'them' : 'it'}.</span><FixActions V={V} id={id} apply={apply} /></div>; })}
      {r.active != null && <span><Button id="ref-again" variant="secondary" size="sm" label="Read it again" onClick={again} /> after a fix.</span>}</div>
  </div>;
}

// What to swap: the reference's parts on its own clock, each mapped to Studio picks you can use in one click
const PART = { hook: 'Hook', cut: 'Cut', title: 'Title', broll: 'B-roll', cta: 'CTA', graphic: 'Graphic' };
function Swap({ CAT, sw, s, apply, patch }) {
  const vid = useRef(null), [only, setOnly] = useState('all');
  const kinds = ['hook', 'cut', 'title', 'broll', 'cta', 'graphic'].filter(k => sw.parts.some(p => p.kind === k));
  const parts = sw.parts.filter(p => only === 'all' || p.kind === only);
  const at = x => { const v = vid.current; if (!v) return; v.currentTime = x; v.play().catch(() => {}); };
  const use = p => api('/api/reference/apply', { refs: p.refs.map(r => r.ref) }).then(v => { apply(v); toast(`${p.label}: ${p.refs.map(r => r.id).join(', ')} picked`, true); }).catch(() => {});
  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`;
  return <div className="swap" id="swap">
    <div className="sugg-h"><span className="lbl">What to swap</span><span className="fine">The reference's parts in order. Click a time to watch it, then use its look.</span></div>
    <div className="sw-body">
      {s.reference.file && <video ref={vid} className="sw-vid" src={'/api/reference/video?v=' + encodeURIComponent(s.reference.file)} controls preload="metadata" playsInline muted aria-label="The reference" />}
      <div>
        <div className="chips" role="group" aria-label="Show parts">{['all', ...kinds].map(k => <button key={k} type="button" className={'chip' + (only === k ? ' on' : '')} aria-pressed={String(only === k)} onClick={() => setOnly(k)}>{k === 'all' ? 'All' : PART[k]}</button>)}</div>
        <ol className="sw-list" aria-label="Parts of the reference">{parts.map(p => <li key={p.id} className={'sw-' + p.kind}>
          <button type="button" className="sw-t mono" onClick={() => at(p.at)} aria-label={`Watch ${p.label} at ${fmt(p.at)}`} disabled={!s.reference.file}>{fmt(p.at)}</button>
          <span className="sw-k">{PART[p.kind]}</span>
          <span className="sw-d"><b>{p.label === PART[p.kind] ? '' : p.label + '. '}</b>{p.detail}</span>
          <span className="sw-refs">{p.refs.map(x => { const it = CAT.items[x.ref], st = it && pickState(s, it);
            return <button key={x.ref} type="button" className={'chip sm' + (st === 'allow' ? ' on' : '')} aria-pressed={String(st === 'allow')} title={KIND_NAME[x.kind] || x.kind}
              onClick={() => patch({ picks: { [x.ref]: st === 'allow' ? 'clear' : 'allow' } })}><Icon n={st === 'allow' ? 'check' : 'plus'} /><span className="k">{KIND_NAME[x.kind] || x.kind}</span>{x.id}</button>; })}</span>
          {p.refs.length > 0 ? <Button variant="secondary" size="sm" label="Use" aria-label={`Use the ${p.label} look at ${fmt(p.at)}`} onClick={() => use(p)} /> : <span className="fine">no match in the menu</span>}
        </li>)}</ol>
      </div>
    </div>
  </div>;
}
// the reference's own words as a script (hook, body and CTA marked), and the same script rewritten for your topic
function PullScript({ V, s, apply }) {
  const [topic, setTopic] = useState(''), [busy, setBusy] = useState(false);
  const pulled = (V.scripts || []).find(x => x.by === 'reference transcript'), rf = s.reference.file, tx = rf ? (s.tx || {})[rf] : null;
  const pull = () => api('/api/reference/script', {}).then(j => { apply(j); toast(j.transcribing ? 'Transcribing the reference first' : 'Script pulled into Scripts', true); }).catch(() => {});
  const adapt = async e => { e.preventDefault(); if (!topic.trim() || !pulled) return; setBusy(true);
    try { const j = await api('/api/scripts/adapt', { id: pulled.id, topic }); apply(j); toast(j.via === 'agent' ? 'Sent to your agent. The adapted script shows up in Scripts.' : 'Adapted script saved in Scripts', true); setTopic(''); } catch {} finally { setBusy(false); } };
  return <div className="pull glass-card" id="pull-script">
    <div className="row"><Button id="pull-script-btn" variant="secondary" size="sm" label={pulled ? 'Pull the script again' : 'Pull script'} icon={<Icon n="script" />} isLoading={tx && tx.status === 'running'} onClick={pull} />
      <span className="fine">{tx && tx.status === 'running' ? `Transcribing the reference${tx.total ? `, part ${Math.min(tx.done + 1, tx.total)} of ${tx.total}` : ''}` : pulled ? `In Scripts: "${pulled.title}", ${pulled.words} words` : 'Its words go into Scripts with the hook, body and CTA marked.'}</span></div>
    {pulled && <form className="row" onSubmit={adapt}><label className="sr" htmlFor="adapt-topic">Your topic</label>
      <input id="adapt-topic" className="grow" placeholder="Your topic, e.g. meal prep for busy parents" value={topic} onChange={e => setTopic(e.target.value)} />
      <Button id="adapt-btn" type="submit" size="sm" variant="primary" label="Adapt to my topic" isLoading={busy} isDisabled={!canWrite(V.env) || !topic.trim()} /></form>}
    {pulled && !canWrite(V.env) && <p className="fine">{NO_WRITER}</p>}
  </div>;
}
const Stat = ({ b, l }) => <div className="stat"><b>{b}</b><span>{l}</span></div>;
