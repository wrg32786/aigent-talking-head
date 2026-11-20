// The teleprompter: the scrolling text, its speed controls, and the pop-out window. The text moves smoothly at the
// chosen WPM (each line takes its spoken time, [pause] adds 1.5 s), and the speed can change while it scrolls without
// a jump. The pop-out is rendered by the same React tree into another window (a portal), so the script, speed, line,
// mirror, size and the record and rehearse state are the same object in both windows, and the controls in either one
// drive it. Chrome and Edge get a Document Picture-in-Picture window, which stays on top of other apps; other browsers
// get a normal popup window.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconBtn } from './lib.jsx';

export const WPM_MIN = 60, WPM_MAX = 260, WPM_STEP = 10;
export const pace = w => (w < 130 ? 'Slow' : w <= 175 ? 'Normal' : 'Fast');
export const clampWpm = w => Math.max(WPM_MIN, Math.min(WPM_MAX, Math.round(w)));
// studio.rp.pip = 0 in localStorage forces the plain popup (the browser test uses it)
export const canPip = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window && localStorage.getItem('studio.rp.pip') !== '0';

export function SpeedBar({ wpm, setWpm, id = 'rp-speed' }) {
  const p = pace(wpm), pct = (wpm - WPM_MIN) / (WPM_MAX - WPM_MIN) * 100;
  return <div className="rp-speed" id={id} role="group" aria-label="Teleprompter speed">
    <IconBtn n="minus" className="rp-slower" label="Slower" onClick={() => setWpm(clampWpm(wpm - WPM_STEP))} disabled={wpm <= WPM_MIN} />
    <input type="range" className="rp-range" aria-label="Speed in words a minute" aria-valuetext={`${wpm} words a minute, ${p.toLowerCase()}`} min={WPM_MIN} max={WPM_MAX} step={5} value={wpm} style={{ '--pct': pct + '%' }} onChange={e => setWpm(clampWpm(+e.target.value))} />
    <IconBtn n="plus" className="rp-faster" label="Faster" onClick={() => setWpm(clampWpm(wpm + WPM_STEP))} disabled={wpm >= WPM_MAX} />
    <span className="rp-read" aria-live="polite"><b className="rp-wpm">{wpm}</b> WPM <span className={'rp-pace ' + p.toLowerCase()}>{p}</span></span>
  </div>;
}

// smooth scroll: pos is a fractional line index; rolling advances it by frame time over the current line's duration
export function useRoll({ lines, rolling, reset, still, win }) {
  const pos = useRef(0), roll = useRef(null), [line, setLine] = useState(0);
  const place = () => {
    const box = roll.current; if (!box || !lines.length) return;
    const i = Math.max(0, Math.min(lines.length - 1, Math.floor(pos.current))), f = still ? 0 : pos.current - i;
    const a = box.querySelector(`[data-line="${i}"]`), b = box.querySelector(`[data-line="${i + 1}"]`); if (!a) return;
    const y = a.offsetTop + (b ? (b.offsetTop - a.offsetTop) * f : 0);
    box.style.transform = `translateY(${-y + 6}px)`;
  };
  useEffect(() => { pos.current = 0; setLine(0); place(); }, [reset]);
  useEffect(() => {
    if (!rolling || !lines.length) { place(); return; }
    const w = win || window; let raf, last = performance.now();
    const loop = now => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (!(pos.current >= 0)) pos.current = 0;
      const cur = lines[Math.max(0, Math.min(Math.floor(pos.current), lines.length - 1))], d = (cur && cur.dur) || 0.5;
      pos.current = Math.min(lines.length - 0.001, pos.current + dt / Math.max(0.3, d));
      const n = Math.floor(pos.current); setLine(l => (l === n ? l : n)); place();
      raf = w.requestAnimationFrame(loop);
    };
    raf = w.requestAnimationFrame(loop);
    return () => { try { w.cancelAnimationFrame(raf); } catch {} };
  }, [rolling, lines, win, still]);
  const nudge = k => { pos.current = Math.max(0, Math.min(lines.length - 0.001, Math.floor(pos.current) + k)); setLine(Math.floor(pos.current)); place(); };
  return { roll, line, nudge, place };
}

export function PrompterText({ lines, line, roll, flip, still, fontPx, className = '' }) {
  return <div className={'rec-prompter ' + className + (flip ? ' flip' : '') + (still ? ' still' : '')} aria-label="Teleprompter" style={{ fontSize: fontPx }}>
    <div className="rp-roll" ref={roll}>{lines.length ? lines.map((x, i) => <p key={i} data-line={i} className={(i === line ? 'now' : i < line ? 'past' : '') + (x.pause ? ' hold' : '')}>{x.section && <em>{x.section}</em>}{x.text}{x.pause > 0 && <span className="rp-pause" aria-label="pause">||</span>}</p>)
      : <p className="fine">Pick a script or paste one on the right.</p>}</div>
  </div>;
}

// copy this page's styles into the pop-out window
function copyStyles(doc) {
  for (const n of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (n.tagName === 'LINK') { const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = new URL(n.getAttribute('href'), location.href).href; doc.head.appendChild(l); }
    else doc.head.appendChild(n.cloneNode(true));
  }
  doc.documentElement.dataset.theme = 'dark';
}

// open or close the pop-out; returns { win, open, close, kind }
export function usePopout(onKey) {
  const [st, setSt] = useState({ win: null, el: null, kind: null });
  const close = () => { if (st.win && !st.win.closed) st.win.close(); setSt({ win: null, el: null, kind: null }); };
  const open = async () => {
    if (st.win && !st.win.closed) { st.win.focus(); return; }
    let win = null, kind = 'popup';
    try { if (canPip()) { win = await window.documentPictureInPicture.requestWindow({ width: 520, height: 380 }); kind = 'pip'; } } catch { win = null; }
    if (!win) win = window.open('', 'studio-prompter', 'popup,width=560,height=420');
    if (!win) return false;
    const doc = win.document; doc.title = 'Teleprompter'; doc.body.innerHTML = ''; doc.body.className = 'rp-window-body'; copyStyles(doc);
    const el = doc.createElement('div'); el.id = 'rp-window-root'; doc.body.appendChild(el);
    const gone = () => setSt(s => (s.win === win ? { win: null, el: null, kind: null } : s));
    win.addEventListener('pagehide', gone); win.addEventListener('beforeunload', gone);
    setSt({ win, el, kind }); return true;
  };
  useEffect(() => {
    if (!st.win) return;
    const k = e => onKey.current && onKey.current(e); st.win.document.addEventListener('keydown', k);
    const t = setInterval(() => { if (st.win.closed) setSt({ win: null, el: null, kind: null }); }, 500);
    return () => { clearInterval(t); try { st.win.document.removeEventListener('keydown', k); } catch {} };
  }, [st.win]);
  useEffect(() => () => { if (st.win && !st.win.closed) st.win.close(); }, [st.win]);
  return { ...st, open, close };
}

const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// the pop-out window's content: status, the text, speed, and the record and rehearse controls
export function PopoutPanel({ pop, text, wpm, setWpm, phase, secs, count, rehearse, onRecord, onStop, onPause, onRehearse, onRehearsePause, onRehearseStop, flip, setFlip, fontPx, setFontPx }) {
  if (!pop.el) return null;
  const rec = phase === 'recording' || phase === 'paused', status = phase === 'countdown' ? `Starting in ${count}` : phase === 'recording' ? `Recording ${clock(secs)}` : phase === 'paused' ? `Paused ${clock(secs)}` : phase === 'saving' ? 'Saving the take'
    : rehearse === 'running' ? 'Rehearsing' : rehearse === 'paused' ? 'Rehearsal paused' : phase === 'ready' ? 'Camera ready' : 'Camera off';
  return createPortal(<div className="rp-window" id="rp-window">
    <div className="rp-wtop"><span className={'rp-state ' + (rec ? 'rec' : rehearse !== 'off' ? 'reh' : '')} id="rp-state" role="status">{rec && <i aria-hidden="true" />}{status}</span>
      <span className="rp-wtools">
        <IconBtn n="minus" label="Smaller text" onClick={() => setFontPx(Math.max(14, fontPx - 2))} /><span className="rp-size">{fontPx}</span><IconBtn n="plus" label="Bigger text" onClick={() => setFontPx(Math.min(64, fontPx + 2))} />
        <button type="button" className={'rp-chip' + (flip ? ' on' : '')} aria-pressed={flip} onClick={() => setFlip(!flip)}>Mirror</button>
        <button type="button" className="rp-chip" id="rp-back" onClick={pop.close}>Back to page</button>
      </span></div>
    {text}
    {phase === 'countdown' && <div className="rp-count" aria-live="assertive">{count}</div>}
    <div className="rp-wbar">
      <SpeedBar wpm={wpm} setWpm={setWpm} id="rp-speed-pop" />
      <span className="rp-wbtns">
        {phase === 'ready' && rehearse === 'off' && <button type="button" className="rp-btn rec" id="rp-record" onClick={onRecord}><i />Record</button>}
        {rec && <><IconBtn n={phase === 'paused' ? 'play' : 'pause'} label={phase === 'paused' ? 'Resume' : 'Pause'} onClick={onPause} /><button type="button" className="rp-btn stop" id="rp-stop" onClick={onStop}><Icon n="stop" />Stop</button></>}
        {!rec && phase !== 'countdown' && phase !== 'saving' && (rehearse === 'off'
          ? <button type="button" className="rp-btn" id="rp-rehearse" onClick={onRehearse}><Icon n="play" />Rehearse</button>
          : <><IconBtn n={rehearse === 'paused' ? 'play' : 'pause'} label={rehearse === 'paused' ? 'Resume rehearsal' : 'Pause rehearsal'} onClick={onRehearsePause} /><button type="button" className="rp-btn" id="rp-rehearse-stop" onClick={onRehearseStop}><Icon n="stop" />Stop</button></>)}
      </span>
    </div>
    <p className="rp-note">{pop.kind === 'pip' ? 'Stays on top of other windows. Drag it next to your camera and resize it.' : 'A normal window: drag it next to your camera. Chrome and Edge keep it on top.'}</p>
  </div>, pop.el);
}
