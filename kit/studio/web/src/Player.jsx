// The footage player: click a clip to play it, scrub on the waveform, read along in the transcript and click a word to
// jump there. Space plays or pauses, J and L jump 5 s back and forward, K pauses, the arrow keys move 1 s.
// Big or browser-unfriendly files play from a 540p preview copy the server makes (kit/studio/media.mjs).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { api, file, toast, Icon, IconBtn } from './lib.jsx';

export const clock = t => { const s = Math.max(0, Math.floor(+t || 0)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0'); };
const nice = n => n == null ? '' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB';

// the file's info, its preview copy when it needs one, and its waveform
export function useMedia(path) {
  const [info, setInfo] = useState(null), [peaks, setPeaks] = useState(null);
  useEffect(() => {
    if (!path) return; let live = true, timer;
    const load = () => api('/api/footage/info?path=' + encodeURIComponent(path)).then(j => { if (!live) return; setInfo(j); if (j.proxy && j.proxy.status === 'making') timer = setTimeout(load, 2500); }).catch(() => {});
    setInfo(null); setPeaks(null); load();
    fetch('/api/footage/peaks?path=' + encodeURIComponent(path)).then(r => r.ok ? r.json() : null).then(j => { if (live && j && j.peaks) setPeaks(j); }).catch(() => {});
    return () => { live = false; clearTimeout(timer); };
  }, [path]);
  const src = !path ? null : info && info.proxy && info.proxy.url ? info.proxy.url : file(path);
  return { info, peaks, src, proxy: info && info.proxy };
}
// the transcript, once there is one (it polls while transcribing)
export function useTranscript(path, tx) {
  const [t, setT] = useState(null);
  const ready = tx && tx.status === 'ready';
  useEffect(() => { setT(null); if (!path) return; fetch('/api/cut/transcript?path=' + encodeURIComponent(path)).then(r => r.ok ? r.json() : null).then(j => { if (j && j.words) setT(j); }).catch(() => {}); }, [path, ready]);
  return t;
}

export function Wave({ peaks, className = '', height = 56 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || !peaks) return;
    const draw = () => { const w = c.clientWidth || 600, dpr = devicePixelRatio || 1; c.width = w * dpr; c.height = height * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, height);
      g.fillStyle = getComputedStyle(c).color; const n = peaks.peaks.length, bw = w / n;
      for (let i = 0; i < n; i++) { const v = Math.max(0.03, peaks.peaks[i]) * (height - 4); g.fillRect(i * bw, (height - v) / 2, Math.max(1, bw - 0.4), v); } };
    draw(); const ro = new ResizeObserver(draw); ro.observe(c); return () => ro.disconnect();
  }, [peaks, height]);
  return <canvas ref={ref} className={'wave ' + className} style={{ height }} aria-hidden="true" />;
}

// seek by clicking or dragging on a bar that spans the whole take
export function useScrub(dur, seek) {
  const drag = useRef(false);
  const at = (e, el) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)); };
  return {
    onPointerDown: e => { if (e.target.closest('[data-region]')) return; drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); seek(at(e, e.currentTarget)); },
    onPointerMove: e => { if (drag.current) seek(at(e, e.currentTarget)); },
    onPointerUp: () => { drag.current = false; },
  };
}

// a dragged stretch snapped to whole words: the start goes to the start of the word it lands in (or the next word, in
// a gap), the end to the end of the word it lands in (or the word before, in a gap). Never starts or ends mid-word.
export function snapToWords(words, a, b) {
  if (!words || !words.length) return [a, b];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let s = words.find(w => w[1] > lo); let e = [...words].reverse().find(w => w[0] < hi);
  if (!s || !e || e[1] <= s[0]) return null;
  return [s[0], e[1]];
}
export const DRAG_MIN = 0.25;

export function Player({ path, tx, onClose, playerRef, onAddRange, apply, children }) {
  const { info, peaks, src, proxy } = useMedia(path);
  const t = useTranscript(path, tx);
  const vid = useRef(null), box = useRef(null);
  const [now, setNow] = useState(0), [playing, setPlaying] = useState(false), [stopAt, setStopAt] = useState(null), [sel, setSel] = useState(null);
  const dur = (info && info.info && info.info.duration) || (vid.current && vid.current.duration) || 0;
  const seek = x => { const v = vid.current; if (!v) return; v.currentTime = Math.max(0, Math.min(dur || v.duration || 0, x)); setNow(v.currentTime); };
  const play = (from, to) => { const v = vid.current; if (!v) return; if (from != null) seek(from); setStopAt(to ?? null); v.play().catch(() => {}); };
  useEffect(() => { if (playerRef) playerRef.current = { seek, play, pause: () => vid.current && vid.current.pause(), now: () => (vid.current ? vid.current.currentTime : 0) }; });
  useEffect(() => {
    const onKey = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.metaKey || e.ctrlKey || e.altKey || !box.current || box.current.closest('[hidden]')) return;
      const v = vid.current; if (!v) return; const k = e.key.toLowerCase();
      if (k === ' ' && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause(); }
      else if (k === 'k') v.pause(); else if (k === 'j') seek(v.currentTime - 5); else if (k === 'l') seek(v.currentTime + 5);
      else if (k === 'arrowleft') { e.preventDefault(); seek(v.currentTime - 1); } else if (k === 'arrowright') { e.preventDefault(); seek(v.currentTime + 1); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  });
  const words = (t && t.words) || [];
  // the waveform: click or a short drag seeks, a drag longer than a quarter second selects that stretch on whole words
  const drag = useRef(null), [wsel, setWsel] = useState(null), [note, setNote] = useState(null), [sending, setSending] = useState(false);
  const atX = (e, el) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)); };
  const scrub = {
    onPointerDown: e => { if (e.target.closest('[data-region]') || !dur) return; e.currentTarget.setPointerCapture(e.pointerId); const x = atX(e, e.currentTarget); drag.current = { a: x, sel: false }; seek(x); },
    onPointerMove: e => { const d = drag.current; if (!d) return; const x = atX(e, e.currentTarget);
      if (d.sel || Math.abs(x - d.a) > DRAG_MIN) { d.sel = true; setWsel([Math.min(d.a, x), Math.max(d.a, x)]); setSel(null); } else seek(x); },
    onPointerUp: e => { const d = drag.current; drag.current = null; if (!d || !d.sel) return; const x = atX(e, e.currentTarget);
      const r = snapToWords(words, d.a, x); if (!r) { setWsel(null); return; } setWsel(r); setSel(r); setNote(null); seek(r[0]); },
  };
  const clearSel = () => { setSel(null); setWsel(null); setNote(null); getSelection().removeAllRanges(); };
  const sendNote = async ev => { ev.preventDefault(); if (!note || !note.trim()) { toast('Say what should change'); return; } setSending(true);
    try { const j = await api('/api/comment', { text: note.trim(), t: sel[0], end: sel[1], source: path }); apply && apply(j); toast(j.via === 'agent' ? 'Sent to your agent' : 'Sent to the chat', true); clearSel(); } catch {} finally { setSending(false); } };
  const curWord = useMemo(() => { let lo = 0, hi = words.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (words[m][0] <= now) { k = m; lo = m + 1; } else hi = m - 1; } return k; }, [now, words]);
  const trRef = useRef(null);
  useEffect(() => { const el = trRef.current && trRef.current.querySelector('.w.now'); if (el && playing) el.scrollIntoView({ block: 'nearest' }); }, [curWord, playing]);
  // select words in the transcript to make a clip from them
  const onSelect = () => {
    const s = getSelection(); if (!s || s.isCollapsed || !trRef.current || !trRef.current.contains(s.anchorNode)) { setSel(null); return; }
    const ws = [...trRef.current.querySelectorAll('.w')].filter(el => s.containsNode(el, true)); if (ws.length < 2) { setSel(null); return; }
    setSel([+ws[0].dataset.a, +ws[ws.length - 1].dataset.b]); setWsel(null);
  };
  const txRun = tx && tx.status === 'running';
  return <div className="player glass-card" id="player" ref={box} data-path={path}>
    <div className="pl-top"><b className="pl-name">{path.split('/').pop()}</b>
      <span className="fine">{dur ? clock(dur) : ''}{info && info.info ? `, ${info.info.width}x${info.info.height}, ${nice(info.info.size)}` : ''}{proxy ? (proxy.status === 'ready' ? ', playing a preview copy' : proxy.status === 'making' ? ', making a preview copy' : '') : ''}</span>
      {onClose && <IconBtn n="x" label="Close the player" onClick={onClose} className="pl-x" />}</div>
    <div className="pl-stage"><video ref={vid} id="player-video" src={src || undefined} preload="metadata" playsInline onClick={() => { const v = vid.current; v.paused ? v.play().catch(() => {}) : v.pause(); }}
      onTimeUpdate={e => { const v = e.currentTarget; setNow(v.currentTime); if (stopAt != null && v.currentTime >= stopAt) { v.pause(); setStopAt(null); } }}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} aria-label={'Footage ' + path.split('/').pop()} /></div>
    <div className="pl-bar">
      <IconBtn id="player-play" n={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={() => { const v = vid.current; v.paused ? v.play().catch(() => {}) : v.pause(); }} />
      <span className="mono pl-time" id="player-time">{clock(now)} / {clock(dur)}</span>
      <div className="scrub" id="player-scrub" role="slider" tabIndex={0} aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(now)} aria-valuetext={clock(now)} {...scrub}>
        <Wave peaks={peaks} height={44} />
        {(wsel || sel) && dur > 0 && (r => <i className="scrub-sel" id="scrub-sel" data-a={r[0].toFixed(2)} data-b={r[1].toFixed(2)} style={{ left: (r[0] / dur) * 100 + '%', width: ((r[1] - r[0]) / dur) * 100 + '%' }} aria-hidden="true" />)(wsel || sel)}
        {children}
        <i className="playhead" style={{ left: (dur ? (now / dur) * 100 : 0) + '%' }} aria-hidden="true" />
      </div>
      <span className="fine keys hide-sm">Space, J K L</span>
    </div>
    <div className="pl-tr" ref={trRef} onMouseUp={onSelect} onKeyUp={onSelect} id="player-transcript">
      {t ? <p>{words.map((w, i) => <span key={i} className={'w' + (i === curWord ? ' now' : '')} data-a={w[0]} data-b={w[1]} onClick={() => { if (getSelection().isCollapsed) seek(w[0]); }}>{w[2]} </span>)}</p>
        : txRun ? <div className="tx-run"><ProgressBar label="Transcribing" value={tx.total ? Math.round(100 * tx.done / tx.total) : undefined} isIndeterminate={!tx.total} /><span className="fine">Transcribing{tx.total ? `, part ${Math.min(tx.done + 1, tx.total)} of ${tx.total}` : ''}. Long takes go a chunk at a time and pick up where they stopped.</span></div>
        : <div className="row"><Button id="player-tx" size="sm" variant="secondary" label="Show transcript" onClick={() => api('/api/cut/transcribe', { path }).catch(() => {})} /><span className="fine">{tx && tx.status === 'failed' ? tx.error : 'Whisper on this computer. Click a word to jump there.'}</span></div>}
    </div>
    {sel && <div className="pl-sel" id="pl-sel"><span className="fine" id="pl-sel-at">{clock(sel[0])} to {clock(sel[1])}{words.length ? ', on whole words' : ''}</span>
      <Button id="play-selection" size="sm" variant="ghost" label="Play it" onClick={() => play(sel[0], sel[1])} />
      {onAddRange && <Button id="add-selection" size="sm" variant="primary" label="Add as a clip" onClick={() => { onAddRange([[Math.max(0, sel[0] - 0.1), sel[1] + 0.1]]); clearSel(); }} />}
      {apply && note == null && <Button id="note-selection" size="sm" variant="secondary" label="Note for my agent" icon={<Icon n="chat" />} onClick={() => { setNote(''); setTimeout(() => document.getElementById('sel-note')?.focus(), 0); }} />}
      <IconBtn n="x" label="Clear the selection" onClick={clearSel} />
      {note != null && <form className="sel-note" onSubmit={sendNote}><label className="sr" htmlFor="sel-note">What should change in this stretch</label>
        <input id="sel-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Tighten this part" onKeyDown={e => e.key === 'Escape' && setNote(null)} />
        <Button id="sel-note-send" type="submit" size="sm" variant="primary" label="Send" isLoading={sending} /></form>}
    </div>}
  </div>;
}
