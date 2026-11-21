// Review tools on the Review and Render steps: show the original next to or over your build on one clock, comment on a frame for
// your agent, the clean-up pass (pauses, filler words, retakes) and the edit receipt (choices.json in plain words).
import { Hint } from './ui.jsx';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, file, toast, Icon, IconBtn } from './lib.jsx';

export const clock = t => { const s = Math.max(0, +t || 0), m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };

// ---------- show original ----------
export function Compare({ V, s, apply, outputs }) {
  const outs = outputs || V.currentOutputs || [], hasRef = !!s.reference.file;
  const [pick, setPick] = useState(outs[0] || ''), [mode, setMode] = useState(hasRef ? 'side' : 'build'), [op, setOp] = useState(50), [off, setOff] = useState(0);
  const [t, setT] = useState(0), [dur, setDur] = useState(0), [playing, setPlaying] = useState(false), [refSound, setRefSound] = useState(false);
  const [draw, setDraw] = useState(false), [box, setBox] = useState(null), [note, setNote] = useState(''), [sending, setSending] = useState(false);
  const [from, setFrom] = useState(0), [end, setEnd] = useState(null);
  const bv = useRef(null), rv = useRef(null), layer = useRef(null), drag = useRef(null);
  useEffect(() => { if (!outs.includes(pick)) setPick(outs[0] || ''); }, [outs.join('|')]);
  // one clock: the build leads, the reference follows at the offset
  const sync = (force) => { const b = bv.current, r = rv.current; if (!b || !r || !r.duration) return; const want = Math.max(0, Math.min(r.duration - 0.05, b.currentTime + off)); if (force || Math.abs(r.currentTime - want) > 0.12) r.currentTime = want; };
  useEffect(() => { let id; const tick = () => { const b = bv.current; if (b) { setT(b.currentTime); sync(false); } id = requestAnimationFrame(tick); }; if (playing) id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); }, [playing, off]);
  useEffect(() => { sync(true); }, [off]);
  if (!outs.length) return <div className="review glass-card" id="compare"><h3>Show original</h3><p className="fine">Render this draft to compare it with {hasRef ? 'the reference' : 'a reference'} here. Earlier reels stay in Outputs.</p></div>;
  const play = () => { const b = bv.current, r = rv.current; if (!b) return; if (b.paused) { sync(true); b.play().catch(() => {}); r && r.play().catch(() => {}); setPlaying(true); setDraw(false); } else { b.pause(); r && r.pause(); setPlaying(false); } };
  const seek = x => { const b = bv.current; if (!b) return; b.currentTime = x; setT(x); sync(true); };
  const ended = () => { rv.current && rv.current.pause(); setPlaying(false); };
  const startComment = () => { const b = bv.current; if (b && !b.paused) { b.pause(); rv.current && rv.current.pause(); setPlaying(false); } setDraw(true); setBox(null); setNote(''); setFrom(b ? b.currentTime : t); setEnd(null); };
  // a stretch, not one frame: play or scrub on to where it should stop, Mark the end, and the frame goes back to the start
  const markEnd = () => { const b = bv.current; if (!b) return; if (!b.paused) { b.pause(); rv.current && rv.current.pause(); setPlaying(false); }
    const e = b.currentTime; if (e <= from + 0.05) { toast('Play or scrub past the start first, then Mark the end'); return; } setEnd(e); seek(from); };
  const pt = e => { const r = layer.current.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  const down = e => { e.preventDefault(); layer.current.setPointerCapture(e.pointerId); const [x, y] = pt(e); drag.current = [x, y]; setBox({ x, y, w: 0, h: 0 }); };
  const move = e => { if (!drag.current) return; const [x0, y0] = drag.current, [x, y] = pt(e); setBox({ x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) }); };
  const up = () => { drag.current = null; setTimeout(() => document.getElementById('comment-text')?.focus(), 0); };
  const frame = () => {
    const b = bv.current; if (!b || !b.videoWidth) return null;
    const k = Math.min(1, 960 / b.videoHeight), c = document.createElement('canvas'); c.width = Math.round(b.videoWidth * k); c.height = Math.round(b.videoHeight * k);
    const g = c.getContext('2d'); g.drawImage(b, 0, 0, c.width, c.height);
    if (box) { g.strokeStyle = '#ff3b6b'; g.lineWidth = Math.max(3, c.width / 180); const big = box.w > 0.02 || box.h > 0.02;
      if (big) g.strokeRect(box.x * c.width, box.y * c.height, box.w * c.width, box.h * c.height); else { g.beginPath(); g.arc(box.x * c.width, box.y * c.height, c.width / 22, 0, Math.PI * 2); g.stroke(); } }
    try { return c.toDataURL('image/jpeg', 0.85); } catch { return null; }
  };
  const send = async e => {
    e.preventDefault(); if (!note.trim()) { toast('Say what should change'); return; }
    setSending(true);
    try { const j = await api('/api/comment', { text: note.trim(), t: end != null ? from : bv.current ? bv.current.currentTime : t, ...(end != null ? { end } : {}), region: box, video: pick, image: frame() }); apply(j); toast(j.via === 'agent' ? 'Sent to your agent with the frame' : 'Sent to the chat', true); setDraw(false); setBox(null); setNote(''); setEnd(null); }
    catch {} finally { setSending(false); }
  };
  const BoxMark = () => box && (box.w > 0.02 || box.h > 0.02 ? <span className="cm-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} /> : <span className="cm-dot" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%` }} />);
  const buildPane = <div className="cmp-pane build" style={mode === 'overlay' ? { zIndex: 1 } : undefined}>
    <video ref={bv} src={file(pick) + '?v=' + s.rev} preload="auto" playsInline aria-label={'Your build, ' + pick.split('/').pop()}
      onLoadedMetadata={e => setDur(e.currentTarget.duration)} onEnded={ended} onSeeked={() => !playing && sync(true)} />
    {mode === 'side' && <span className="cmp-tag">Yours</span>}
    {draw && <div className="cm-layer" ref={layer} onPointerDown={down} onPointerMove={move} onPointerUp={up} role="application" aria-label="Click a spot or drag a box on the frame"><BoxMark /></div>}
  </div>;
  const refPane = hasRef && <div className="cmp-pane ref" hidden={mode === 'build'} style={mode === 'overlay' ? { opacity: op / 100, zIndex: 2, pointerEvents: 'none' } : undefined}>
    <video ref={rv} src={'/api/reference/video?v=' + encodeURIComponent(s.reference.file)} preload="auto" playsInline muted={!refSound} aria-label="The reference" />
    {mode === 'side' && <span className="cmp-tag">Original</span>}
  </div>;
  return <div className="review glass-card" id="compare">
    <div className="rv-head"><h3>Show original</h3>
      <SegmentedControl label="Compare layout" value={mode} onChange={setMode} size="sm">
        <SegmentedControlItem value="side" label="Side by side" isDisabled={!hasRef} /><SegmentedControlItem value="overlay" label="Overlay" isDisabled={!hasRef} /><SegmentedControlItem value="build" label="Yours only" />
      </SegmentedControl>
      {outs.length > 1 && <label className="lbl-in"><span className="lbl">Reel</span><select id="cmp-pick" value={pick} onChange={e => { setPick(e.target.value); setPlaying(false); }}>{outs.map(o => <option key={o} value={o}>{o.split('/').pop()}</option>)}</select></label>}
    </div>
    {!hasRef && <p className="fine">Add a reference on Start to see it next to yours here.</p>}
    <div className={'cmp-stage ' + (hasRef ? mode : 'build')}>{refPane}{buildPane}</div>
    <div className="cmp-bar">
      <IconBtn id="cmp-play" n={playing ? 'pause' : 'play'} label={playing ? 'Pause both' : 'Play both'} onClick={play} />
      <input id="cmp-seek" type="range" min={0} max={dur || 0} step={0.04} value={t} aria-label="Time, both videos" aria-valuetext={clock(t)} onChange={e => seek(+e.target.value)} />
      <span className="mono" aria-live="off">{clock(t)} / {clock(dur)}</span>
    </div>
    {hasRef && <div className="cmp-opts">
      {mode === 'overlay' && <label className="lbl-in"><span className="lbl">Original opacity</span><input id="cmp-opacity" type="range" min={0} max={100} value={op} onChange={e => setOp(+e.target.value)} aria-valuetext={op + '%'} /><span className="mono">{op}%</span></label>}
      <label className="lbl-in"><span className="lbl">Original starts at</span><input id="cmp-offset" type="number" min={-30} max={30} step={0.1} value={off} onChange={e => setOff(+e.target.value || 0)} /><span className="fine">s</span></label>
      <label className="lbl-in"><input type="checkbox" checked={refSound} onChange={e => setRefSound(e.target.checked)} /> Original's sound</label>
    </div>}
    <div className="cm-row">
      {!draw ? <Button id="comment-start" variant="secondary" size="sm" label="Comment on this frame" icon={<Icon n="chat" />} onClick={startComment} />
        : <form className="cm-form" onSubmit={send}>
          <p className="fine" id="cm-hint">{end != null ? `From ${clock(from)} to ${clock(end)}. ` : ''}{box ? `At ${clock(end != null ? from : bv.current ? bv.current.currentTime : t)}. ${box.w > 0.02 || box.h > 0.02 ? 'Box drawn.' : 'Spot marked.'} Drag again to change it.` : `At ${clock(bv.current ? bv.current.currentTime : t)}. Click a spot or drag a box on your reel, or send it for the whole frame.`}</p>
          <label className="sr" htmlFor="comment-text">What should change here</label>
          <textarea id="comment-text" rows={2} value={note} placeholder="Make this title smaller" onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } if (e.key === 'Escape') setDraw(false); }} />
          <div className="row"><Button id="comment-send" type="submit" variant="primary" size="sm" label="Send to chat" isLoading={sending} />
            {end == null ? <Button id="comment-end" variant="ghost" size="sm" label="Mark the end here" onClick={markEnd} /> : <Button id="comment-end-clear" variant="ghost" size="sm" label="Just this frame" onClick={() => setEnd(null)} />}<Button variant="ghost" size="sm" label="Cancel" onClick={() => { setDraw(false); setBox(null); }} /></div>
        </form>}
    </div>
  </div>;
}

// ---------- clean-up pass ----------
const TYPE = { silence: 'Pause', filler: 'Filler', take: 'Retake' };
export function Cleanup({ V, s, apply, drafted }) {
  const [d, setD] = useState(null), [dec, setDec] = useState({}), [only, setOnly] = useState('all'), [busy, setBusy] = useState(false), [sil, setSil] = useState(0.7);
  const player = useRef(null), stopAt = useRef(0);
  const running = V.task && V.task.status === 'running';
  const load = async (silence) => { const j = await api('/api/cleanup' + (silence ? `?silence=${silence}` : '')).catch(() => null); if (j) { setD(j); setSil(j.silence || 0.7); setDec({}); } };
  useEffect(() => { if (V.cleanupReady && drafted) load(); else setD(null); }, [V.cleanupReady, drafted, s.job]);
  if (!V.cleanupReady || !drafted) return <div className="review glass-card" id="cleanup"><h3>Clean-up pass</h3><p className="fine">Draft first. We then list long pauses, filler words and retakes for you to keep or remove.</p></div>;
  if (!d) return <div className="review glass-card" id="cleanup"><h3>Clean-up pass</h3><p className="fine">Reading the word timings.</p></div>;
  const items = d.items.map(it => ({ ...it, remove: dec[it.id] !== undefined ? dec[it.id] : it.remove }));
  const shown = items.filter(it => only === 'all' || it.type === only);
  const out = items.filter(it => it.remove && it.type !== 'take').reduce((a, it) => a + (it.to - it.from), 0);
  const count = k => items.filter(it => it.type === k).length;
  const hear = it => { const c = d.clips[it.clip], p = player.current; if (!c || !p) return; p.src = file(c.file); p.currentTime = Math.max(0, it.from - 0.6); stopAt.current = Math.min(c.dur, it.to + 0.6); p.play().catch(() => {}); };
  const applyIt = async redraft => { setBusy(true); try { const j = await api('/api/cleanup', { decisions: Object.fromEntries(items.map(it => [it.id, it.remove])), silence: sil, redraft }); apply(j); setD(j); setDec({}); toast(redraft ? 'Clean-up applied. Redrafting.' : 'Saved for the next draft.', true); } catch {} finally { setBusy(false); } };
  const off = async () => { const j = await api('/api/cleanup', { on: false }); apply(j); setD(j); toast('Clean-up off for the next draft', true); };
  return <div className="review glass-card" id="cleanup">
    <div className="rv-head"><h3>Clean-up pass</h3><Hint id="cleanup-hint" label="How clean-up works">From the word timings of your draft. Retakes are already left out; switch one to Keep to bring it back. Nothing is deleted.</Hint>{d.on && <Badge label="On" variant="success" />}{d.stale && <Badge label="Footage changed" variant="warning" />}
      <span className="fine grow">{items.length ? `${items.filter(x => x.remove).length} of ${items.length} marked to remove, about ${out.toFixed(1)} s` : 'Nothing to clean up.'}</span></div>
    <div className="cl-opts">
      <div className="chips" role="group" aria-label="Show">{['all', 'silence', 'filler', 'take'].map(k => <button key={k} type="button" className={'chip' + (only === k ? ' on' : '')} aria-pressed={String(only === k)} onClick={() => setOnly(k)}>{k === 'all' ? `All ${items.length}` : `${TYPE[k]}s ${count(k)}`}</button>)}</div>
      <label className="lbl-in"><span className="lbl">Pauses longer than</span><input id="cl-silence" type="number" min={0.3} max={3} step={0.1} value={sil} onChange={e => setSil(+e.target.value)} onBlur={() => sil !== d.silence && sil >= 0.3 && sil <= 3 && load(sil)} /><span className="fine">s</span></label>
    </div>
    <audio ref={player} hidden onTimeUpdate={e => { if (e.currentTarget.currentTime >= stopAt.current) e.currentTarget.pause(); }} />
    {shown.length > 0 && <ul className="cl-list" id="cl-list" aria-label="Clean-up review">{shown.map(it => <li key={it.id} className={it.remove ? 'rm' : ''}>
      <Badge label={TYPE[it.type]} variant={it.type === 'take' ? 'warning' : 'neutral'} />
      <span className="mono">{it.clip} {clock(it.from)}{it.type === 'take' ? '' : `-${clock(it.to)}`}</span>
      <span className="cl-text" title={it.why}>{it.type === 'take' ? `"${it.text}"` : it.type === 'filler' ? `"${it.text}"` : it.text}<em> {it.why}</em></span>
      <IconBtn n="play" label={`Hear ${TYPE[it.type].toLowerCase()} in ${it.clip}`} onClick={() => hear(it)} disabled={!(d.clips[it.clip] && d.clips[it.clip].file)} />
      <SegmentedControl label={`${TYPE[it.type]} in ${it.clip} at ${clock(it.from)}`} value={it.remove ? 'remove' : 'keep'} onChange={v => setDec(x => ({ ...x, [it.id]: v === 'remove' }))} size="sm">
        <SegmentedControlItem value="keep" label="Keep" /><SegmentedControlItem value="remove" label="Remove" />
      </SegmentedControl>
    </li>)}</ul>}
    <div className="row">
      <Button id="cl-apply" variant="primary" size="sm" label="Apply and redraft" isLoading={busy} isDisabled={running || !items.length} onClick={() => applyIt(true)} />
      <Button variant="secondary" size="sm" label="Save for the next draft" isDisabled={running || !items.length} onClick={() => applyIt(false)} />
      {d.on && <Button variant="ghost" size="sm" label="Turn off" onClick={off} />}
      <Button variant="ghost" size="sm" label="Remove all" onClick={() => setDec(Object.fromEntries(items.filter(x => x.type !== 'take').map(x => [x.id, true])))} />
      <Button variant="ghost" size="sm" label="Keep all" onClick={() => setDec(Object.fromEntries(items.filter(x => x.type !== 'take').map(x => [x.id, false])))} />
    </div>
  </div>;
}

// ---------- edit receipt ----------
export function Receipt({ r }) {
  if (!r) return <div className="review glass-card" id="receipt"><h3>Edit receipt</h3><p className="fine">Draft first. The receipt then says what we picked for each beat, title and graphic, and why.</p></div>;
  return <div className="review glass-card" id="receipt">
    <div className="rv-head"><h3>Edit receipt</h3><span className="fine grow">{r.summary}</span>
      <Button variant="ghost" size="sm" label="Copy" icon={<Icon n="copy" />} onClick={() => navigator.clipboard && navigator.clipboard.writeText(r.text).then(() => toast('Receipt copied', true))} /></div>
    {r.sections.map(sec => <section key={sec.h} className="rc-sec" aria-label={sec.h}><h4>{sec.h}</h4><ul>{sec.rows.map((x, i) => <li key={i} className={x.at != null ? '' : 'nt'}>
      {x.at != null && <span className="mono rc-t">{clock(x.at)}</span>}<span><b>{x.what}.</b>{x.why && <span className="why"> {x.why}.</span>}</span></li>)}</ul></section>)}
  </div>;
}
