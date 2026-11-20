import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { NeedFix } from './Setup.jsx';
import { api, file, toast, fmtS, cap1, Icon } from './lib.jsx';
import { Compare, Cleanup, Receipt } from './Review.jsx';

export function Render({ CAT, V, s, apply, patch, hidden, log, setLog }) {
  const t = V.task, c = V.compose, running = t && t.status === 'running';
  const [choices, setChoices] = useState(null), [receipt, setReceipt] = useState(null), [dirty, setDirty] = useState(false), [now, setNow] = useState(Date.now());
  const foldRef = useRef(null), logRef = useRef(null), last = useRef(''), loadedFor = useRef(null);
  const loadChoices = async () => { const j = await api('/api/choices').catch(() => ({})); setChoices(j.choices || null); setReceipt(j.receipt || null); setDirty(false); if (j.choices && foldRef.current) foldRef.current.open = true; };
  useEffect(() => { if (t && !running && (t.kind === 'draft' || t.kind === 'render') && last.current !== t.id + t.status) { last.current = t.id + t.status; loadChoices(); } });
  useEffect(() => { if (!choices && s.job && loadedFor.current !== s.job) { loadedFor.current = s.job; loadChoices(); } }, [s.job, choices]);
  useEffect(() => { if (!running) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [running]);
  useEffect(() => { if (t && (!running || !log)) setLog(t.lines.join('\n')); }, [t && t.id, t && t.status, t && t.lines && t.lines.length]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const src = s.clips ? `--clips ${s.clips}` : s.footage.map(f => /\s/.test(f) ? JSON.stringify(f) : f).join(' ') || '<your clip>';
  const cmd = `npm run reel -- ${src} --name ${s.job || '<job>'} --draft ${(c.args || []).map(a => /[\s;]/.test(a) ? JSON.stringify(a) : a).join(' ')}`;
  const notes = [...(c.notes || []), ...(c.errs || []).map(e => 'Problem: ' + e)];
  if (s.reference.mode === 'recreate' && s.reference.out) notes.unshift(`Recreate: follows ${s.reference.out}/Reel.md; the recipe sets the look.`);
  if (c.effects && c.effects.length && !V.env.effectsReady) notes.push('Effects are picked but not set up on this computer (npm run effects:setup). The reel renders without them.');
  const drafted = !!choices;
  const elapsed = running ? `${cap1(t.kind)}, ${fmtS(now - t.startedAt)}` : t && t.endedAt ? `${cap1(t.kind)} ${t.status} in ${fmtS(t.endedAt - t.startedAt)}` : '';
  const outputs = (V.outputs || []).slice(0, 6);

  return <section className="step" id="s-render" data-step="render" aria-labelledby="h-render" hidden={hidden}>
    <header className="sh"><h2 id="h-render">Render</h2><p className="sub">Draft, check the picks, then render.</p></header>
    <NeedFix V={V} ids={['ffmpeg', 'python', 'chrome', 'npm']} what="Drafting and rendering" />
    <div className="runbar glass-card">
      <Button id="draft" size="lg" variant={drafted ? 'secondary' : 'primary'} label={drafted ? 'Redraft' : 'Draft'} isDisabled={running || !s.job || (!s.footage.length && !s.clips)}
        onClick={() => { setChoices(null); setReceipt(null); setLog(''); api('/api/draft', {}).then(apply).catch(() => {}); }} />
      <Button id="render" size="lg" variant={drafted ? 'primary' : 'secondary'} label="Render" isDisabled={running || !s.job}
        onClick={() => { setLog(''); api('/api/render', {}).then(j => { apply(j); if (j.effectsSkipped) toast(j.effectsSkipped); }).catch(() => {}); }} />
      {running && <Button id="cancel" variant="ghost" label="Cancel" onClick={() => api('/api/task/cancel', {}).then(apply)} />}
      <label className="exp"><span className="lbl">Export</span><select id="export" value={s.export || ''} onChange={e => patch({ export: e.target.value || null })}><option value="">Just the reel</option>{CAT.exports.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      <span id="elapsed" className="fine">{elapsed}</span>
    </div>
    {running && <div id="progress"><ProgressBar label={`${cap1(t.kind)} running`} isLabelHidden isIndeterminate /></div>}
    <div id="notes" className="notes">{notes.map((n, i) => <p key={i}>{n}</p>)}</div>
    <div id="outputs" className="outputs">
      {outputs.length ? outputs.map(o => <figure key={o} className="glass-card"><video src={file(o) + '?v=' + s.rev + '#t=1.2'} controls preload="metadata" aria-label={o} />
        <figcaption><span>{o.split('/').pop()}</span><a className="btn ghost sm" href={file(o) + '?download'} download={o.split('/').pop()}><Icon n="download" />Download</a></figcaption></figure>)
        : <div className="empty-art"><Icon n="film" /><p>{s.job ? 'Your reels show up here.' : 'Name the reel at the top to start.'}</p></div>}
    </div>
    <CutOutputs V={V} s={s} />
    {!hidden && <Compare V={V} s={s} apply={apply} />}
    <Receipt r={receipt} />
    <Cleanup V={V} s={s} apply={apply} drafted={drafted} />
    <details className="fold glass-card" id="choices-fold" ref={foldRef}><summary>Picks and why</summary>
      <div id="choices" className="choices"><Choices CAT={CAT} x={choices} setX={setChoices} setReceipt={setReceipt} dirty={dirty} setDirty={setDirty} /></div></details>
    <details className="fold glass-card"><summary>Log</summary><pre id="log" className="log" aria-live="off" ref={logRef}>{log}</pre></details>
    <details className="fold glass-card"><summary>Command</summary><pre id="cmd" className="cmd" aria-label="The command Studio will run">{cmd}</pre></details>
  </section>;
}

const Wrap = ({ label, children }) => <div className="tablewrap" tabIndex={0} role="region" aria-label={label + ' table'}>{children}</div>;

function Choices({ CAT, x, setX, setReceipt, dirty, setDirty }) {
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
    <div className="row"><Button id="apply-choices" variant="secondary" size="sm" label="Apply my edits" isDisabled={!dirty} onClick={applyEdits} /><span className="fine">Edits win over locks. Render to see them.</span></div>
  </>;
}

// what the Cut step rendered: one row per kept cut with its own video
function CutOutputs({ V, s }) {
  const done = ((V.cut && V.cut.candidates) || []).filter(c => c.outputs && c.outputs.length);
  if (!done.length) return null;
  return <section className="cut-outs" id="cut-outputs" aria-labelledby="h-cut-outs"><h3 id="h-cut-outs" className="lbl">From the Cut step</h3>
    <div className="outputs">{done.map(c => { const o = c.outputs[0]; return <figure key={c.id} className="glass-card" data-id={c.id}><video src={file(o) + '?v=' + s.rev + '#t=1.2'} controls preload="metadata" aria-label={c.label} />
      <figcaption><span>{c.label}</span><a className="btn ghost sm" href={file(o) + '?download'} download={o.split('/').pop()}><Icon n="download" />Download</a></figcaption></figure>; })}</div></section>;
}
