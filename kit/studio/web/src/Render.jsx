import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { NeedFix } from './Fix.jsx';
import { copyText } from './Connect.jsx';
import { api, file, toast, fmtS, cap1, Icon } from './lib.jsx';
import { Compare, Cleanup, Receipt } from './Review.jsx';
import { Fold } from './ui.jsx';

export function Render({ CAT, V, s, apply, patch, hidden, log, setLog, openOutputs, openNewVideo }) {
  const t = V.task, c = V.compose, running = t && t.status === 'running';
  const [mem, setMem] = useState(null);
  // a render that needs the person mask checks free memory first (kit/memcheck.cjs); short, the server answers 409 with
  // the numbers and the ways out, shown here: titles in front, the lighter mask, or try anyway
  const doRender = memory => { setLog(''); setMem(null);
    fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(memory ? { memory } : {}) })
      .then(async r => { const j = await r.json().catch(() => ({})); if (r.status === 409 && j.memory) return setMem(j.memory); if (!r.ok) return toast(j.error || `request failed (${r.status})`, false, j.fix); apply(j); if (j.effectsSkipped) toast(j.effectsSkipped, false, j.fix); })
      .catch(e => toast(String(e.message || e))); };
  const [choices, setChoices] = useState(null), [receipt, setReceipt] = useState(null), [dirty, setDirty] = useState(false), [now, setNow] = useState(Date.now());
  const foldRef = useRef(null), logRef = useRef(null), last = useRef(''), loadedFor = useRef(null);
  const loadChoices = async () => { const j = await api('/api/choices').catch(() => ({})); setChoices(j.choices || null); setReceipt(j.receipt || null); setDirty(false); if (j.choices && foldRef.current) foldRef.current.open = true; };
  useEffect(() => { if (t && !running && (t.kind === 'draft' || t.kind === 'render') && last.current !== t.id + t.status) { last.current = t.id + t.status; loadChoices(); } });
  useEffect(() => { if (!choices && s.job && loadedFor.current !== s.job) { loadedFor.current = s.job; loadChoices(); } }, [s.job, choices]);
  useEffect(() => { if (!running) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [running]);
  useEffect(() => { if (t && (!running || !log)) setLog(t.lines.join('\n')); }, [t && t.id, t && t.status, t && t.lines && t.lines.length]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const src = s.clips ? `--clips ${s.clips}` : s.footage.map(f => /\s/.test(f) ? JSON.stringify(f) : f).join(' ') || '<your clip>';
  // the reel as an instruction for an agent (Copy or Send in the For your agent fold); the page never shows the command
  const forAgent = `In my aigent-talking-head folder, make this reel by running npm run reel -- ${src} --name ${s.job || '<job>'} --draft ${(c.args || []).map(a => /[\s;]/.test(a) ? JSON.stringify(a) : a).join(' ')} and tell me when it is done.`;
  const notes = [...(c.notes || []), ...(c.errs || []).map(e => 'Problem: ' + e)];
  if (s.reference.mode === 'recreate' && s.reference.out) notes.unshift(`Recreate: follows ${s.reference.out}/Reel.md; the recipe sets the look.`);
  const drafted = !!choices;
  // a draft is a plan, not a video: say so when it ends, so it never reads like a finished render
  const planReady = t && !running && t.kind === 'draft' && t.status === 'done';
  const elapsed = running ? `${cap1(t.kind)}, ${fmtS(now - t.startedAt)}` : planReady ? 'Plan ready, no video yet. Check it below, then Render.' : t && t.endedAt ? `${cap1(t.kind)} ${t.status} in ${fmtS(t.endedAt - t.startedAt)}` : '';
  // the one render path: Draft makes the plan from your pieces (or the whole take), Check is the review below, Render
  // makes the reel and, in the same run, the exports you tick (each piece as its own reel, or as a plain clip)
  const bites = useBites(V, s);
  const combo = V.combo || { pieces: [], seconds: 0, from: 'take' }, ed = V.edit || {}, fin = { reel: true, clips: false, plain: false, from: 'auto', ...(s.finish || {}) };
  const reopen = o => api('/api/reopen', { reel: o }).then(j => { apply(j); loadChoices(); toast(`${o.split('/').pop()} is back in the editor. Render makes the next version.`, true); }).catch(() => {});
  const canReopen = new Set(V.reopenable || []);
  const outputs = (V.currentOutputs || []).slice(0, 6), earlier = Math.max(0, (V.outputs || []).length - (V.currentOutputs || []).length);
  const n = combo.pieces.length, lineN = combo.pieces.reduce((a, x) => a + (x.kind === 'piece' && x.lines ? x.lines.length : 1), 0), fromPieces = combo.from === 'pieces';
  const setFin = p => patch({ finish: p }).catch(() => {});
  // drafted: the server's record of the last draft (s.drafted) matches what you have now; a session from before 1.13.0
  // has only the draft's choices.json
  const isDrafted = !!ed.drafted || (!s.drafted && drafted), stale = fin.reel && !!ed.stale;
  const stage = running && t.kind === 'render' ? 3 : isDrafted && !stale ? (outputs.length ? 3 : 2) : 1;
  const canRender = !running && !!s.job && (!fin.reel || (isDrafted && !stale)) && (fin.reel || n > 0);
  const what = [fin.reel && 'the reel', fin.clips && n && `${n} clip${n > 1 ? 's' : ''}`, fin.plain && n && 'plain clips'].filter(Boolean);
  const renderLabel = fin.reel ? `Render v${(V.outputs || []).filter(o => /reel-v\d+\.mp4$/.test(o)).length + 1}` : `Render ${what.join(' and ')}`;

  return <section className="step" id="s-render" data-step="finish" aria-labelledby="h-render" hidden={hidden}>
    <header className="sh"><h2 id="h-render">Finish</h2><p className="sub">Draft first to check it, then Render once. This is the only place that renders.</p></header>
    <NeedFix V={V} ids={['ffmpeg', 'python', 'chrome', 'npm']} what="Drafting and rendering" apply={apply} />
    {c.effects && c.effects.length > 0 && !V.env.effectsReady && <NeedFix V={V} ids={['effects']} what="The effects you picked" apply={apply} />}
    <ol className="fin-stages" id="fin-stages" aria-label="Finish in three steps">
      {[['Draft', isDrafted && !stale ? 'done, a plan of the reel' : 'a quick plan, no video yet'], ['Check', 'the picks and the clean-up, below'], ['Render', 'full quality, saved to Outputs']].map(([h, d], k) =>
        <li key={h} className={'glass-card' + (stage === k + 1 ? ' now' : stage > k + 1 ? ' done' : '')} aria-current={stage === k + 1 ? 'step' : undefined}><span className="sn">{stage > k + 1 ? <Icon n="check" /> : k + 1}</span><span><b>{h}</b><span className="fine">{d}</span></span></li>)}
    </ol>
    <div className="fin-make glass-card" id="fin-make" role="group" aria-labelledby="fin-make-h">
      <h3 className="lbl" id="fin-make-h">Make</h3>
      {n > 0 && <div className="seg" role="radiogroup" aria-label="Draft from" id="fin-from">
        <button type="button" role="radio" aria-checked={fromPieces} data-from="pieces" onClick={() => setFin({ from: 'pieces' })}>Your {lineN} piece{lineN > 1 ? 's' : ''}, {Math.round(combo.seconds)} s</button>
        <button type="button" role="radio" aria-checked={!fromPieces} data-from="take" onClick={() => setFin({ from: 'take' })}>The whole take</button>
      </div>}
      <p className="fine" id="fin-from-note">{fromPieces ? 'The reel is your pieces from the Cut step, in your order, already cut. Nothing is cut twice.' : n ? 'The reel is cut from the whole take. Your pieces are left out.' : 'The reel is cut from the whole take. Keep pieces on the Cut step to make it from those.'}</p>
      <div className="chips" id="fin-exports" role="group" aria-label="What Render makes">
        <Chip id="exp-reel" on={fin.reel} label="The reel" onClick={() => setFin({ reel: !fin.reel })} />
        <Chip id="exp-clips" on={fin.clips} disabled={!n} label={n ? `${n} clip${n > 1 ? 's' : ''} from your pieces` : 'Clips from your pieces'} onClick={() => setFin({ clips: !fin.clips })} />
        <Chip id="exp-plain" on={fin.plain} disabled={!n} label="Plain clips, no edit" onClick={() => setFin({ plain: !fin.plain })} />
        <label className="exp"><span className="lbl">Export</span><select id="export" value={s.export || ''} onChange={e => patch({ export: e.target.value || null })}><option value="">Just the reel</option>{CAT.exports.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      <p className="fine">{n ? 'Clips render each piece as its own reel with the same look, in the same run. Plain clips are just the words you kept, joined.' : 'Clips and plain clips come from the pieces you keep on the Cut step.'}</p>
    </div>
    <div className="runbar glass-card">
      <Button id="draft" size="lg" variant={isDrafted && !stale ? 'secondary' : 'primary'} label={isDrafted || stale ? 'Redraft' : 'Draft'} isDisabled={running || !s.job || (!s.footage.length && !s.clips) || !fin.reel}
        onClick={() => { setChoices(null); setReceipt(null); setLog(''); api('/api/draft', {}).then(apply).catch(() => {}); }} />
      <Button id="render" size="lg" variant={canRender ? 'primary' : 'secondary'} label={renderLabel} isDisabled={!canRender}
        onClick={() => doRender()} />
      {running && <Button id="cancel" variant="ghost" label="Cancel" onClick={() => api('/api/task/cancel', {}).then(apply)} />}
      <span id="elapsed" className="fine">{stale && !running ? 'Your pieces changed since the draft. Draft again first.' : fin.reel && !isDrafted && !running ? 'Draft first, then Render.' : elapsed}</span>
    </div>
    {mem && !running && <div id="mem-short" className="notes glass-card" role="alert"><p>{mem.message}</p>
      <div className="row">{(mem.options || []).map(o => <Button key={o.id} id={'mem-' + o.id} size="sm" variant={o.id === 'front' ? 'primary' : o.id === 'light' ? 'secondary' : 'ghost'} label={o.label} onClick={() => doRender(o.id)} />)}</div>
      <p className="fine">{(mem.options || []).map(o => `${o.label}: ${o.detail}`).join(' ')}</p></div>}
    {running && <div id="progress"><ProgressBar label={`${cap1(t.kind)} running`} isLabelHidden isIndeterminate /></div>}
    <div id="notes" className="notes">{notes.map((n, i) => <p key={i}>{n}</p>)}</div>
    {earlier > 0 && <p className="fine" id="fin-library-note">{earlier} earlier reel{earlier === 1 ? '' : 's'} {earlier === 1 ? 'is' : 'are'} in <button type="button" className="linkish" id="fin-open-outputs" onClick={() => openOutputs && openOutputs()}>Outputs</button>. <button type="button" className="linkish" id="fin-open-new" onClick={() => openNewVideo && openNewVideo()}>New video</button> starts a new job if you want them kept apart.</p>}
    {(isDrafted || drafted) && <>
      {!hidden && <Compare V={V} s={s} apply={apply} outputs={outputs} />}
      <Receipt r={receipt} />
      <Cleanup V={V} s={s} apply={apply} drafted={drafted} />
      <details className="fold glass-card" id="choices-fold" ref={foldRef}><summary>Picks and why</summary>
        <div id="choices" className="choices"><Choices CAT={CAT} x={choices} setX={setChoices} setReceipt={setReceipt} dirty={dirty} setDirty={setDirty} s={s} patch={patch} /></div></details>
    </>}
    <div id="outputs" className="outputs">
      {outputs.length ? outputs.map(o => <figure key={o} className="glass-card"><video src={file(o) + '?v=' + s.rev + '#t=1.2'} controls preload="metadata" aria-label={o} />
        <figcaption><span>{o.split('/').pop()}</span>{canReopen.has(o) && <button type="button" className="btn ghost sm" data-reopen={o} disabled={running} onClick={() => reopen(o)}><Icon n="edit" />Edit this reel</button>}<a className="btn ghost sm" href={file(o) + '?download'} download={o.split('/').pop()}><Icon n="download" />Download</a></figcaption></figure>)
        : isDrafted && !stale && V.draftPreview ? <DraftPreview preview={V.draftPreview} s={s} />
        : <div className="empty-art" id="fin-plan"><Icon n="film" /><p>{!s.job ? 'Name the reel at the top to start.' : isDrafted && !stale ? 'Plan ready, no video yet. Check the picks below, then Render.' : 'Your current draft shows up here after you render it. Earlier reels stay in Outputs.'}</p></div>}
    </div>
    <CutOutputs V={V} s={s} bites={bites} />
    <Fold id="log-fold" title="Log"><pre id="log" className="log" aria-live="off" ref={logRef}>{log}</pre></Fold>
    <Fold id="cmd-fold" title="For your agent"><div className="row" id="cmd"><span className="fine grow">Your agent can make this same reel from its terminal.</span>
      <Button id="cmd-copy" size="sm" variant="secondary" label="Copy for my agent" icon={<Icon n="copy" />} onClick={() => copyText(forAgent, 'Copied. Paste it into your agent.')} /></div></Fold>
  </section>;
}

// a fast preview of the current draft: the cut segments only, no captions or look
function DraftPreview({ preview, s }) {
  const segs = preview.segs || [], v = useRef(null), [i, setI] = useState(0), [playing, setPlaying] = useState(false);
  const seg = segs[i];
  useEffect(() => { const el = v.current; if (!el || !seg) return;
    const go = () => { try { el.currentTime = seg.in; } catch {} if (playing) el.play().catch(() => {}); };
    if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
  }, [i, seg && seg.file, seg && seg.in, playing]);
  const onTime = () => { const el = v.current; if (!el || !seg) return; if (el.currentTime >= seg.out - 0.05) { if (i + 1 < segs.length) setI(i + 1); else { el.pause(); setPlaying(false); setI(0); } } };
  if (!seg) return null;
  return <figure className="glass-card draft-preview" id="draft-preview">
    <video ref={v} src={file(seg.file) + '?v=' + s.rev} preload="auto" playsInline onTimeUpdate={onTime} aria-label="Draft preview, cuts only" />
    <figcaption>
      <span>Draft preview, {Math.round(preview.seconds)} s, cuts only</span>
      <button type="button" className="btn ghost sm" id="draft-preview-play" onClick={() => { const el = v.current; if (!el) return; if (playing) { el.pause(); setPlaying(false); } else setPlaying(true); }}>{playing ? 'Pause' : 'Play'}</button>
    </figcaption>
  </figure>;
}

function Chip({ id, on, label, onClick, disabled }) {
  return <button type="button" id={id} className={'chip' + (on ? ' on' : '')} aria-pressed={!!on} disabled={disabled} onClick={onClick}>{on && <Icon n="check" />}{label}</button>;
}

const Wrap = ({ label, children }) => <div className="tablewrap" tabIndex={0} role="region" aria-label={label + ' table'}>{children}</div>;

function Choices({ CAT, x, setX, setReceipt, dirty, setDirty, s, patch }) {
  if (!x) return <p className="empty">Draft first. Every pick then shows here with its reason.</p>;
  const trans = Object.values(CAT.items).filter(i => i.kind === 'transition').map(i => i.id), ents = Object.values(CAT.items).filter(i => i.kind === 'entrance').map(i => i.id);
  const edit = (list, n, k, v) => { setX({ ...x, [list]: x[list].map(r => r.n === n ? { ...r, [k]: v } : r) }); setDirty(true); };
  const Sel = ({ opts, val, blank, on, label }) => <select aria-label={label} value={val || ''} onChange={e => on(e.target.value || null)}><option value="">{blank}</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select>;
  const applyEdits = async () => { const j = await api('/api/choices', { beats: x.beats, titles: x.titles, graphics: x.graphics }); setX(j.choices); setReceipt(j.receipt || null); setDirty(false); toast('Edits applied. Render to see them.', true); };
  return <>
    <p className="fine">Locks: {x.locksText || 'none'}. Captions: {x.captions.style}, entrance {x.captions.entrance || 'pop'}. Music: {x.music.bed || 'none'}. Punch: {String(x.punch)}.</p>
    <Wrap label="Beats"><table><thead><tr>{['Beat', 'Time', 'Transition in', 'Why', 'Finish', 'Why'].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>
      {x.beats.map(b => <tr key={b.n}><td>{b.n}</td><td>{b.start.toFixed(1)}-{b.end.toFixed(1)} s</td>
        <td>{b.n === 1 ? 'first shot' : b.jump ? 'cut' : <Sel opts={trans} val={b.transition} blank="glitch (default)" label={`Transition into beat ${b.n}`} on={v => edit('beats', b.n, 'transition', v)} />}</td>
        <td className="why">{b.transitionWhy}</td>
        <td><input defaultValue={b.finish || ''} size={10} aria-label={`Finish for beat ${b.n}`} onChange={e => edit('beats', b.n, 'finish', e.target.value || null)} /></td>
        <td className="why">{b.finishWhy}</td></tr>)}
    </tbody></table></Wrap>
    <h3>Titles</h3>
    {x.titles.length ? <Wrap label="Titles"><table><thead><tr>{['Title', 'At', 'Words', 'Entrance', 'Why', 'Place'].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>
      {x.titles.map(t => <tr key={t.n}><td>{t.n}</td><td>{t.start.toFixed(1)} s</td><td>{t.text}</td>
        <td><Sel opts={ents} val={t.entrance} blank="(engine picks)" label={`Entrance for title ${t.n}`} on={v => edit('titles', t.n, 'entrance', v)} /></td>
        <td className="why">{t.entranceWhy}</td><td className="why">{t.place}, {t.layer}</td></tr>)}
    </tbody></table></Wrap> : <p className="muted">No kinetic titles in this draft.</p>}
    {x.graphics.length > 0 && <><h3>Graphics</h3><Wrap label="Graphics"><table><thead><tr>{['Graphic', 'At', 'Type', 'Words', 'Keep', 'Why'].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>
      {x.graphics.map(g => <tr key={g.n}><td>{g.n}</td><td>{g.start.toFixed(1)} s</td><td>{g.id}</td><td>{g.text}</td>
        <td><input type="checkbox" checked={g.keep !== false} aria-label={`Keep graphic ${g.n}`} onChange={e => edit('graphics', g.n, 'keep', e.target.checked)} /></td><td className="why">{g.why}</td></tr>)}
    </tbody></table></Wrap></>}
    {x.pauses && x.pauses.length > 0 && <><h3>Pauses cut</h3><p className="fine">Pace cut these pauses inside a line. Keep one and draft again to hear it.</p>
      <Wrap label="Pauses cut"><table><thead><tr>{['Clip', 'Pause', 'After', ''].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>
        {x.pauses.map(p => { const kept = ((s && s.pace.keepPauses) || []).includes(p.keep); return <tr key={p.keep} data-pause={p.keep}><td>{p.clip}</td><td>{p.gap} s at {p.at} s</td><td>"{p.after}"</td>
          <td><Button size="sm" variant="ghost" label={kept ? 'Kept, draft again' : 'Keep this pause'} isDisabled={kept || !patch} onClick={() => patch({ pace: { keepPauses: [...((s && s.pace.keepPauses) || []), p.keep] } })} /></td></tr>; })}
      </tbody></table></Wrap></>}
    <div className="row"><Button id="apply-choices" variant="secondary" size="sm" label="Apply my edits" isDisabled={!dirty} onClick={applyEdits} /><span className="fine">Edits win over locks. Render to see them.</span></div>
  </>;
}

// the bites made in Lines and bites on the Cut step (GET /api/lines), refreshed when a task ends or the bites change
function useBites(V, s) {
  const src = V.cut && V.cut.source, t = V.task, [bites, setBites] = useState([]);
  const key = JSON.stringify(((s.lines || {})[src]) || null);
  useEffect(() => { if (!src) { setBites([]); return; } let on = true; fetch('/api/lines?path=' + encodeURIComponent(src)).then(r => r.json()).then(j => { if (on) setBites(j.bites || []); }).catch(() => {}); return () => { on = false; }; }, [src, key, t && t.id, t && t.status]);
  return bites;
}

// what the Cut step rendered: one row per kept cut and per bite with its own video
function CutOutputs({ V, s, bites = [] }) {
  const done = [...((V.cut && V.cut.candidates) || []).map(c => ({ key: 'c-' + c.id, id: c.id, label: c.label, outputs: c.outputs })), ...bites.map(b => ({ key: 'b-' + b.id, id: b.id, label: b.name, outputs: b.outputs }))].filter(c => c.outputs && c.outputs.length);
  if (!done.length) return null;
  return <section className="cut-outs" id="cut-outputs" aria-labelledby="h-cut-outs"><h3 id="h-cut-outs" className="lbl">Clips from your pieces</h3>
    <div className="outputs">{done.map(c => { const o = c.outputs[0]; return <figure key={c.key} className="glass-card" data-id={c.id}><video src={file(o) + '?v=' + s.rev + '#t=1.2'} controls preload="metadata" aria-label={c.label} />
      <figcaption><span>{c.label}</span><a className="btn ghost sm" href={file(o) + '?download'} download={o.split('/').pop()}><Icon n="download" />Download</a></figcaption></figure>; })}</div></section>;
}
