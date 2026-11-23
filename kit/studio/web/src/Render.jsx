import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { NeedFix } from './Fix.jsx';
import { copyText } from './Connect.jsx';
import { api, file, toast, fmtS, cap1, Icon, matchChips } from './lib.jsx';
import { Compare, Cleanup, Receipt } from './Review.jsx';
import { Fold, Hint } from './ui.jsx';
import { TitleCheckLine } from './RefCard.jsx';
import { PublishKit } from './PublishKit.jsx';

// What Review and Render share (both stay mounted): the last draft's choices and receipt, the task log and a clock
// while something runs. One copy, held by the App, so a redraft on Review is what Render sees.
export function useRun(V, s, log, setLog) {
  const t = V.task, running = !!(t && t.status === 'running');
  const [choices, setChoices] = useState(null), [receipt, setReceipt] = useState(null), [dirty, setDirty] = useState(false), [now, setNow] = useState(Date.now());
  const last = useRef(''), loadedFor = useRef(null);
  const loadChoices = async () => { const j = await api('/api/choices').catch(() => ({})); setChoices(j.choices || null); setReceipt(j.receipt || null); setDirty(false); };
  const clear = () => { setChoices(null); setReceipt(null); setLog(''); };
  useEffect(() => { if (t && !running && (t.kind === 'draft' || t.kind === 'render') && last.current !== t.id + t.status) { last.current = t.id + t.status; loadChoices(); } });
  useEffect(() => { if (!choices && s.job && loadedFor.current !== s.job) { loadedFor.current = s.job; loadChoices(); } }, [s.job, choices]);
  // a new or opened video: the last board's draft picks are not this one's. This hook lives above the per-video key
  // in App, so it resets here (else the new board said "Draft ready" and Render was on with no draft)
  const vid = (s.videoSeq || 0) + ':' + (s.job || ''), vidSeen = useRef(vid);
  useEffect(() => { if (vidSeen.current === vid) return; vidSeen.current = vid; loadedFor.current = s.job || null; setChoices(null); setReceipt(null); setDirty(false); if (s.job) loadChoices(); }, [vid]);
  useEffect(() => { if (!running) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [running]);
  useEffect(() => { if (t && (!running || !log)) setLog(t.lines.join('\n')); }, [t && t.id, t && t.status, t && t.lines && t.lines.length]);
  return { choices, setChoices, receipt, setReceipt, dirty, setDirty, loadChoices, clear, now, running };
}

// where the edit stands, read the same way by Review and Render
function standing(V, s, run) {
  const t = V.task, running = run.running, ed = V.edit || {}, fin = { reel: true, clips: false, plain: false, from: 'auto', ...(s.finish || {}) };
  const combo = V.combo || { pieces: [], seconds: 0, from: 'take' }, n = combo.pieces.length;
  // drafted: the server's record of the last draft (s.drafted) matches what you have now; a session from before 1.13.0
  // has only the draft's choices.json
  const isDrafted = !!ed.drafted || (!s.drafted && !!run.choices), stale = fin.reel && !!ed.stale;
  const outputs = (V.currentOutputs || []).slice(0, 6);
  const took = t && t.endedAt ? `${cap1(t.kind)} ${t.status} in ${fmtS(t.endedAt - t.startedAt)}` : '';
  return { t, running, ed, fin, combo, n, isDrafted, stale, outputs, took, ticking: running ? `${cap1(t.kind)}, ${fmtS(run.now - t.startedAt)}` : '' };
}

// Review: Draft (a quick plan, no video), then check what we picked: how close it is to the reference, the receipt,
// the clean-up pass and every pick with its reason. Only the current draft shows here, never an earlier render.
export function ReviewStep({ CAT, V, s, apply, patch, go, hidden, run }) {
  const { t, running, fin, combo, n, isDrafted, stale, took, ticking } = standing(V, s, run), c = V.compose;
  const drafted = !!run.choices, mine = running && t.kind !== 'render';
  const lineN = combo.pieces.reduce((a, x) => a + (x.kind === 'piece' && x.lines ? x.lines.length : 1), 0), fromPieces = combo.from === 'pieces';
  const notes = [...(c.notes || []), ...(c.errs || []).map(e => 'Problem: ' + e)];
  if (s.reference.mode === 'recreate' && s.reference.out && s.reference.extracted) notes.unshift('Recreate: we follow the reference, and it sets the look.');
  // a draft is a plan, not a video: say so when it ends, so it never reads like a finished render
  const planReady = t && !running && t.kind === 'draft' && t.status === 'done';
  const status = stale && !running ? 'Your clips changed since the draft. Draft again first.' : !fin.reel ? 'The reel is switched off under What to make, on Render.' : mine ? ticking : running ? '' : planReady || (isDrafted && !stale) ? 'Draft ready. Check it below, then go to Render.' : t && t.kind === 'draft' ? took : 'A draft is a quick plan of the reel, with no video yet.';
  // only when a reference or a saved look is in use: there is nothing to be close to otherwise
  const guided = !!(s.reference.extracted && s.reference.mode !== 'off') || !!s.styleLook;
  const match = guided ? matchChips(V.match || (V.edit && V.edit.match) || s.match) : [];
  const good = isDrafted && !stale;
  return <section className="step" id="s-review" data-step="review" aria-labelledby="h-review" hidden={hidden}>
    <header className="sh"><h2 id="h-review">Review</h2><p className="sub">Draft first, check what we picked, then render once.</p></header>
    <NeedFix V={V} ids={['ffmpeg', 'python', 'npm']} what="Drafting" apply={apply} />
    <TitleCheckLine s={s} go={go} id="draft-title-check" />
    <div className="runbar glass-card" id="draft-bar">
      <Button id="draft" size="lg" variant={good ? 'secondary' : 'primary'} label={isDrafted || stale ? 'Draft again' : 'Draft'} isDisabled={running || !s.job || (!s.footage.length && !s.clips) || !fin.reel}
        onClick={() => { run.clear(); api('/api/draft', {}).then(apply).catch(() => {}); }} />
      {mine && <Button id="cancel" variant="ghost" label="Cancel" onClick={() => api('/api/task/cancel', {}).then(apply)} />}
      <span id="elapsed" className="fine" role="status">{!s.job ? 'Name the reel at the top to start.' : status}</span>
      {n > 0 && <div className="draft-from"><span className="lbl" id="fin-from-l">Draft from</span><div className="seg" role="radiogroup" aria-labelledby="fin-from-l" aria-describedby="fin-from-note" id="fin-from">
        <button type="button" role="radio" aria-checked={fromPieces} data-from="pieces" onClick={() => patch({ finish: { from: 'pieces' } }).catch(() => {})}>{combo.pieces.some(x => x.kind === 'piece') ? `Your ${lineN} line${lineN > 1 ? 's' : ''}` : `Your ${combo.pieces.length} clip${combo.pieces.length > 1 ? 's' : ''}`}, {Math.round(combo.seconds)} s</button>
        <button type="button" role="radio" aria-checked={!fromPieces} data-from="take" onClick={() => patch({ finish: { from: 'take' } }).catch(() => {})}>The whole take</button>
      </div><span className="sr" id="fin-from-note">{fromPieces ? 'The reel is the clips you kept on the Cut step, in your order, already cut. Nothing is cut twice.' : 'The reel is cut from the whole take. Your clips are left out.'}</span></div>}
    </div>
    {mine && <div id="progress"><ProgressBar label={`${cap1(t.kind)} running`} isLabelHidden isIndeterminate /></div>}
    {notes.length > 0 && <div id="notes" className="notes">{notes.map((x, i) => <p key={i}>{x}</p>)}</div>}
    {good && match.length > 0 && <div className="match glass-card" id="match"><span className="lbl" id="match-h">How close to your reference</span>
      <ul className="match-chips" id="match-chips" aria-labelledby="match-h">{match.map(m => <li key={m.id} className={'match-chip ' + m.word.toLowerCase()} data-part={m.id} data-match={m.word.toLowerCase()} title={m.note || undefined}><span>{m.label}</span><b>{m.word}</b></li>)}</ul></div>}
    <div id="draft-view" className="outputs">
      {good && V.draftPreview ? <DraftPreview preview={V.draftPreview} s={s} />
        : !good && <div className="empty-art" id="fin-plan"><Icon n="film" /><p>{!s.job ? 'Name the reel at the top to start.' : stale ? 'Your clips changed. Draft again to see the new plan.' : 'Your draft shows up here. Earlier reels stay in Outputs.'}</p></div>}
    </div>
    {(isDrafted || drafted) && <>
      <Receipt r={run.receipt} />
      <Cleanup V={V} s={s} apply={apply} drafted={drafted} />
      <details className="fold glass-card" id="choices-fold"><summary>Every pick and why</summary>
        <div id="choices" className="choices"><Choices CAT={CAT} x={run.choices} setX={run.setChoices} setReceipt={run.setReceipt} dirty={run.dirty} setDirty={run.setDirty} s={s} patch={patch} /></div></details>
    </>}
  </section>;
}

// Render: the one place that makes the video. Render with progress, the finished reel of this draft, what else to make
// in the same run, and the way to Post. Earlier versions stay in Outputs.
export function Render({ CAT, V, s, apply, patch, hidden, go, run, openOutputs, openNewVideo, toPost }) {
  const { t, running, fin, n, isDrafted, stale, outputs, took, ticking } = standing(V, s, run), c = V.compose;
  const [mem, setMem] = useState(null), mine = running && t.kind === 'render';
  // a render that needs the person mask checks free memory first (kit/memcheck.cjs); short, the server answers 409 with
  // the numbers and the ways out, shown here: titles in front, the lighter mask, or try anyway
  const doRender = memory => { run.clear(); setMem(null);
    fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(memory ? { memory } : {}) })
      .then(async r => { const j = await r.json().catch(() => ({})); if (r.status === 409 && j.memory) return setMem(j.memory); if (!r.ok) return toast(j.error || `request failed (${r.status})`, false, j.fix); apply(j); if (j.effectsSkipped) toast(j.effectsSkipped, false, j.fix); })
      .catch(e => toast(String(e.message || e))); };
  const bites = useBites(V, s);
  const reopen = o => api('/api/reopen', { reel: o }).then(j => { apply(j); run.loadChoices(); toast(`${o.split('/').pop()} is back in the editor. Render makes the next version.`, true); }).catch(() => {});
  const canReopen = new Set(V.reopenable || []), earlier = Math.max(0, (V.outputs || []).length - (V.currentOutputs || []).length);
  const setFin = p => patch({ finish: p }).catch(() => {});
  const needDraft = fin.reel && (!isDrafted || stale);
  const canRender = !running && !!s.job && !needDraft && (fin.reel || n > 0);
  const what = [fin.reel && 'the reel', fin.clips && n && `${n} clip${n > 1 ? 's' : ''}`, fin.plain && n && 'plain clips'].filter(Boolean);
  // the version number lives in the file name only: Render the first time, Render again after
  const renderLabel = fin.reel ? ((V.outputs || []).some(o => /reel-v\d+\.mp4$/.test(o)) ? 'Render again' : 'Render') : `Render ${what.join(' and ')}`;
  const extra = [fin.clips && n ? `${n} clip${n > 1 ? 's' : ''}` : null, fin.plain && n ? 'plain clips' : null].filter(Boolean);
  // sizes: the 9:16 is always made; the Feed 4:5 and the square are made in the same run when ticked
  const SZ = V.sizes || { list: [], on: [], files: {} }, sizeOn = SZ.on || [];
  const setSize = (id, on) => patch({ sizes: on ? [...sizeOn, id] : sizeOn.filter(x => x !== id) }).catch(() => {});
  const useOf = o => (SZ.files && SZ.files[o] && SZ.files[o].use) || '';
  return <section className="step" id="s-render" data-step="render" aria-labelledby="h-render" hidden={hidden}>
    <header className="sh"><h2 id="h-render">Render</h2><p className="sub">Full quality, once. This is the only place that makes the video.</p></header>
    <NeedFix V={V} ids={['ffmpeg', 'python', 'chrome', 'npm']} what="Rendering" apply={apply} />
    {c.effects && c.effects.length > 0 && !V.env.effectsReady && <NeedFix V={V} ids={['effects']} what="The effects you picked" apply={apply} />}
    <div className="runbar glass-card" id="render-bar">
      <Button id="render" size="lg" variant={canRender ? 'primary' : 'secondary'} label={renderLabel} isDisabled={!canRender} onClick={() => doRender()} />
      {mine && <Button id="cancel" variant="ghost" label="Cancel" onClick={() => api('/api/task/cancel', {}).then(apply)} />}
      <span id="render-status" className="fine" role="status">{!s.job ? 'Name the reel at the top to start.' : needDraft && !running ? <>{stale ? 'Your clips changed since the draft. ' : ''}<button type="button" className="linkish" id="render-to-review" onClick={() => go('review', true)}>Draft it on Review first</button></> : mine ? ticking : running ? `${cap1(t.kind)} running` : t && t.kind === 'render' ? took : outputs.length ? '' : 'Ready when you are.'}</span>
    </div>
    {fin.reel && SZ.list.length > 0 && <div className="sizes-row glass-card" id="sizes" role="group" aria-labelledby="sizes-l">
      <span className="lbl" id="sizes-l">Sizes</span>
      {SZ.list.map(z => <label key={z.id} className={'size-opt' + (z.always ? ' locked' : '')} title={z.always ? 'We always make this one. The other sizes are made from the same edit.' : undefined}>
        <input type="checkbox" id={'size-' + z.id} checked={!!z.on} disabled={!!z.always || running} onChange={e => setSize(z.id, e.target.checked)} /><span>{z.label}</span></label>)}
      <Hint id="sizes-hint" label="About sizes">One render makes every size you tick. The Instagram Feed does not take 9:16, so the 4:5 (1080 by 1350) and the square are their own versions: the frame follows your face and the captions are laid out again to fit.</Hint>
    </div>}
    {mem && !running && <div id="mem-short" className="notes glass-card" role="alert"><p>{mem.message}</p>
      <div className="row">{(mem.options || []).map(o => <Button key={o.id} id={'mem-' + o.id} size="sm" variant={o.id === 'front' ? 'primary' : o.id === 'light' ? 'secondary' : 'ghost'} label={o.label} onClick={() => doRender(o.id)} />)}</div>
      <p className="fine">{(mem.options || []).map(o => `${o.label}: ${o.detail}`).join(' ')}</p></div>}
    {mine && <div id="progress"><ProgressBar label="Render running" isLabelHidden isIndeterminate /></div>}
    <div id="outputs" className="outputs">
      {outputs.length ? outputs.map(o => <figure key={o} className="glass-card" data-size={(SZ.files && SZ.files[o] && SZ.files[o].size) || '9:16'}><video src={file(o) + '?v=' + s.rev + '#t=1.2'} controls preload="metadata" aria-label={o} />
        <figcaption><span className="out-name" title={o.split('/').pop()}>{useOf(o) ? <b className="out-use">{useOf(o)}</b> : <small className="fine mono">{o.split('/').pop()}</small>}</span>{canReopen.has(o) && <button type="button" className="btn ghost sm" data-reopen={o} disabled={running} onClick={() => reopen(o)}><Icon n="edit" />Edit this reel</button>}<a className="btn ghost sm" href={file(o) + '?download'} download={o.split('/').pop()}><Icon n="download" />Download</a></figcaption></figure>)
        : <div className="empty-art" id="render-empty"><Icon n="film" /><p>{mine ? 'Rendering. Your reel shows up here when it is done.' : 'Your finished reel shows up here.'}</p></div>}
    </div>
    {outputs.length > 0 && !running && <div className="row render-next"><Button id="to-post" variant="secondary" label="Post it" icon={<Icon n="send" />} onClick={toPost} /><span className="fine">Each channel gets the size it needs, saved as drafts in Buffer.</span></div>}
    {outputs.length > 0 && !running && <PublishKit V={V} s={s} apply={apply} />}
    {earlier > 0 && <p className="fine" id="fin-library-note">{earlier} earlier reel{earlier === 1 ? '' : 's'} {earlier === 1 ? 'is' : 'are'} in <button type="button" className="linkish" id="fin-open-outputs" onClick={() => openOutputs && openOutputs()}>Outputs</button>. <button type="button" className="linkish" id="fin-open-new" onClick={() => openNewVideo && openNewVideo()}>New video</button> starts a new job if you want them kept apart.</p>}
    <CutOutputs V={V} s={s} bites={bites} />
    <Fold id="make-fold" title={<>What to make<span className="fine fold-sum" id="make-sum">{[fin.reel ? 'The reel' : null, ...extra].filter(Boolean).join(', ') || 'Nothing yet'}</span></>}>
      <div className="fin-make" id="fin-make" role="group" aria-label="What Render makes">
        <div className="chips" id="fin-exports">
          <Chip id="exp-reel" on={fin.reel} label="The reel" onClick={() => setFin({ reel: !fin.reel })} />
          <Chip id="exp-clips" on={fin.clips} disabled={!n} label={n ? `${n} clip${n > 1 ? 's' : ''} on their own` : 'Each clip on its own'} onClick={() => setFin({ clips: !fin.clips })} />
          <Chip id="exp-plain" on={fin.plain} disabled={!n} label="Plain clips, no edit" onClick={() => setFin({ plain: !fin.plain })} />
          <label className="exp"><span className="lbl">Keep text clear of the buttons on</span><select id="export" value={s.export || ''} onChange={e => patch({ export: e.target.value || null })}><option value="">No app in mind</option>{CAT.exports.filter(x => !['feed45', 'square'].includes(x)).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
        <p className="fine">{n ? 'Each kept clip also renders as its own reel with the same look, in the same run. Plain clips are just the words you kept, joined.' : 'These come from the clips you keep on the Cut step.'}</p>
      </div>
    </Fold>
    {outputs.length > 0 && <details className="fold glass-card" id="compare-fold"><summary>Compare with the original, or comment on a frame</summary>
      {!hidden && <Compare V={V} s={s} apply={apply} outputs={outputs} />}</details>}
  </section>;
}

// Under Review and Render: one closed fold, Details, with the same reel as an instruction for your agent and the task log
export function RunFoot({ V, s, log }) {
  const c = V.compose, logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  const src = s.clips ? `--clips ${s.clips}` : s.footage.map(f => /\s/.test(f) ? JSON.stringify(f) : f).join(' ') || '<your clip>';
  // the reel as an instruction for an agent (Copy in the For your agent fold); the page never shows the command
  const forAgent = `In my aigent-talking-head folder, make this reel by running npm run reel -- ${src} --name ${s.job || '<job>'} --draft ${(c.args || []).map(a => /[\s;]/.test(a) ? JSON.stringify(a) : a).join(' ')} and tell me when it is done.`;
  return <div className="step run-foot" id="run-foot">
    <Fold id="details-fold" title="Details"><div className="row" id="cmd"><span className="fine grow">Your agent can make this same reel.</span>
      <Button id="cmd-copy" size="sm" variant="secondary" label="Copy for my agent" icon={<Icon n="copy" />} onClick={() => copyText(forAgent, 'Copied. Paste it into your agent.')} /></div>
      <span className="lbl" id="log-l">What ran</span><pre id="log" className="log" aria-live="off" aria-labelledby="log-l" ref={logRef}>{log.split('\n').filter(l => !l.startsWith('$ ')).join('\n')}</pre></Fold>
  </div>;
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
    <p className="fine">Your locked picks: {x.locksText || 'none'}. Captions: {x.captions.style}, entering with {x.captions.entrance || 'pop'}. Music: {x.music.bed || 'none'}. Zoom punch: {x.punch ? 'on' : 'off'}.</p>
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
        <td><Sel opts={ents} val={t.entrance} blank="(picked for you)" label={`Entrance for title ${t.n}`} on={v => edit('titles', t.n, 'entrance', v)} /></td>
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
  return <section className="cut-outs" id="cut-outputs" aria-labelledby="h-cut-outs"><h3 id="h-cut-outs" className="lbl">Your clips on their own</h3>
    <div className="outputs">{done.map(c => { const o = c.outputs[0]; return <figure key={c.key} className="glass-card" data-id={c.id}><video src={file(o) + '?v=' + s.rev + '#t=1.2'} controls preload="metadata" aria-label={c.label} />
      <figcaption><span>{c.label}</span><a className="btn ghost sm" href={file(o) + '?download'} download={o.split('/').pop()}><Icon n="download" />Download</a></figcaption></figure>; })}</div></section>;
}
