// Record now: film takes with this computer's camera and mic, right in the Footage step.
// The preview is the camera as it is; the recording is cropped to the chosen frame (9:16 by default) on a canvas,
// recorded with MediaRecorder and sent to the server in numbered one-second chunks while you film.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Switch } from '@astryxdesign/core/Switch';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, file, toast, RM, cue, Icon, IconBtn } from './lib.jsx';
import { SpeedBar, PrompterText, PopoutPanel, useRoll, usePopout, clampWpm, pace, canPip, WPM_STEP } from './Prompter.jsx';
import { NeedFix } from './Setup.jsx';

const FRAMES = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1 };
const MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
export const pickMime = () => (typeof MediaRecorder !== 'undefined' && MIMES.find(m => MediaRecorder.isTypeSupported(m))) || '';
const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function cameraError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera or mic blocked. Allow them in the address bar, then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera found. Plug one in, or upload a clip instead.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy in another app. Close it there and try again.';
  return 'The camera did not start: ' + ((e && e.message) || 'unknown error');
}
// largest rect of the frame's shape inside the camera picture, at most 1920 px on the long side, even sizes
export function cropFor(vw, vh, aspect) {
  let cw = vw, ch = vh;
  if (vw / vh > aspect) cw = vh * aspect; else ch = vw / aspect;
  const k = Math.min(1, 1920 / Math.max(cw, ch)), even = x => Math.max(2, Math.floor(x / 2) * 2);
  return { sx: (vw - cw) / 2, sy: (vh - ch) / 2, sw: cw, sh: ch, w: even(cw * k), h: even(ch * k) };
}

export function Recorder({ V, s, apply, onClose, onLive, visible = true, scriptId }) {
  const video = useRef(null), canvas = useRef(null), meter = useRef(null), prompter = useRef(null);
  const stream = useRef(null), rec = useRef(null), audio = useRef(null), sendQ = useRef(null), tick = useRef(null);
  const [phase, setPhase] = useState(window.isSecureContext && navigator.mediaDevices ? 'off' : 'insecure');
  const [err, setErr] = useState('');
  const [devices, setDevices] = useState({ cams: [], mics: [] });
  const [cam, setCam] = useState(localStorage.getItem('studio.rec.cam') || '');
  const [mic, setMic] = useState(localStorage.getItem('studio.rec.mic') || '');
  const [frame, setFrame] = useState(localStorage.getItem('studio.rec.frame') || '9:16');
  const [mirror, setMirror] = useState(localStorage.getItem('studio.rec.mirror') !== '0');
  const [guides, setGuides] = useState(localStorage.getItem('studio.rec.guides') !== '0');
  const [countdownOn, setCountdownOn] = useState(localStorage.getItem('studio.rec.countdown') !== '0');
  const [prompt, setPrompt] = useState(localStorage.getItem('studio.rec.prompt') === '1');
  const [script, setScript] = useState(localStorage.getItem('studio.script') || '');
  const [src, setSrc] = useState(scriptId || localStorage.getItem('studio.rec.src') || 'paste');
  const [picked, setPicked] = useState(null);
  const [wpm, setWpm] = useState(+(localStorage.getItem('studio.rec.wpm') || 150));
  const [fontPx, setFontPx] = useState(+(localStorage.getItem('studio.rec.font') || 22));
  const [flipText, setFlipText] = useState(localStorage.getItem('studio.rec.flip') === '1');
  const [rehearse, setRehearse] = useState('off'); // off | running | paused: scroll the script with no recording
  const [rollKey, setRollKey] = useState(0);
  const [count, setCount] = useState(0), [secs, setSecs] = useState(0), [level, setLevel] = useState(0), [lastId, setLastId] = useState(null);
  const remember = (k, v) => localStorage.setItem('studio.rec.' + k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  const busy = ['countdown', 'recording', 'paused', 'saving'].includes(phase);
  useEffect(() => { onLive && onLive(busy ? { phase, secs } : null); }, [busy, phase, Math.floor(secs)]);

  // ---------- camera ----------
  async function startCamera(camId = cam, micId = mic) {
    setErr(''); setPhase('asking'); stopCamera();
    try {
      const st = await navigator.mediaDevices.getUserMedia({
        video: { ...(camId ? { deviceId: { exact: camId } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: { ...(micId ? { deviceId: { exact: micId } } : {}), echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      stream.current = st; video.current.srcObject = st; await video.current.play().catch(() => {});
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({ cams: all.filter(d => d.kind === 'videoinput'), mics: all.filter(d => d.kind === 'audioinput') });
      const vt = st.getVideoTracks()[0], at = st.getAudioTracks()[0];
      if (vt) setCam(vt.getSettings().deviceId || camId); if (at) setMic(at.getSettings().deviceId || micId);
      startMeter(st); setPhase('ready');
    } catch (e) { setErr(cameraError(e)); setPhase('off'); }
  }
  function stopCamera() {
    if (stream.current) for (const t of stream.current.getTracks()) t.stop();
    stream.current = null; if (video.current) video.current.srcObject = null;
    if (audio.current) { audio.current.ctx.close().catch(() => {}); cancelAnimationFrame(audio.current.raf); audio.current = null; }
  }
  function startMeter(st) {
    if (!st.getAudioTracks().length || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(st).connect(an);
    const buf = new Float32Array(an.fftSize); let last = 0;
    const loop = t => {
      an.getFloatTimeDomainData(buf); let sum = 0; for (const x of buf) sum += x * x;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6), v = Math.max(0, Math.min(1, (db + 60) / 60));
      if (meter.current) meter.current.style.transform = `scaleX(${v})`;
      if (t - last > 400) { last = t; setLevel(Math.round(v * 100)); }
      audio.current.raf = requestAnimationFrame(loop);
    };
    audio.current = { ctx, raf: requestAnimationFrame(loop) };
  }
  useEffect(() => () => { stopCamera(); clearInterval(tick.current); }, []);
  // the camera light goes off when you leave the step, unless a take is running
  useEffect(() => { if (!visible && phase === 'ready') { stopCamera(); setPhase('off'); } }, [visible, phase]);
  useEffect(() => { const warn = e => { if (busy) { e.preventDefault(); e.returnValue = ''; } }; addEventListener('beforeunload', warn); return () => removeEventListener('beforeunload', warn); }, [busy]);

  // ---------- recording ----------
  async function begin() {
    if (!stream.current) return;
    if (countdownOn) { setPhase('countdown'); for (const n of [3, 2, 1]) { setCount(n); await sleep(1000); if (!stream.current) return; } }
    setCount(0);
    const v = video.current, c = canvas.current, box = cropFor(v.videoWidth || 1280, v.videoHeight || 720, FRAMES[frame]);
    c.width = box.w; c.height = box.h; const g = c.getContext('2d');
    let drawing = true;
    // a timer, not requestAnimationFrame: it keeps drawing when you switch to another Studio step mid-take
    const draw = () => { if (drawing) g.drawImage(v, box.sx, box.sy, box.sw, box.sh, 0, 0, box.w, box.h); };
    draw(); const timer = setInterval(draw, 1000 / 30);
    const out = new MediaStream([...c.captureStream(30).getVideoTracks(), ...stream.current.getAudioTracks()]);
    const mime = pickMime();
    let id;
    try { const j = await api('/api/record/start', { mime, script: prompt && text.trim() ? { id: picked ? picked.id : null, title: picked ? picked.title : 'Pasted script', text } : null }); id = j.id; apply(j); setLastId(id); } catch { drawing = false; clearInterval(timer); setPhase('ready'); return; }
    // chunks go out one at a time, in order, with retries; nothing is dropped if a request fails
    const q = { id, seq: 0, items: [], running: false, failed: null, idle: Promise.resolve() };
    sendQ.current = q;
    const pump = async () => {
      if (q.running) return; q.running = true;
      while (q.items.length) {
        const blob = q.items[0];
        for (let tries = 0; ; tries++) {
          try { const r = await fetch(`/api/record/chunk?id=${id}&seq=${q.seq}`, { method: 'POST', body: blob }); if (r.ok) break; const j = await r.json().catch(() => ({})); if (r.status === 409 && j.next > q.seq) break; throw new Error(j.error || r.status); }
          catch (e) { if (tries >= 6) { q.failed = e.message; q.items.length = 0; q.running = false; return; } await sleep(500 * 2 ** tries); }
        }
        q.items.shift(); q.seq++;
      }
      q.running = false;
    };
    const mr = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8e6, audioBitsPerSecond: 192e3 });
    rec.current = { mr, stopDraw: () => { drawing = false; clearInterval(timer); for (const t of out.getVideoTracks()) t.stop(); } };
    mr.ondataavailable = e => { if (e.data && e.data.size) { q.items.push(e.data); pump(); } };
    let elapsed = 0, lastT = performance.now();
    tick.current = setInterval(() => { const now = performance.now(); if (mr.state === 'recording') elapsed += (now - lastT) / 1000; lastT = now; setSecs(elapsed); }, 250);
    mr.onstop = async () => {
      clearInterval(tick.current); rec.current.stopDraw(); setPhase('saving');
      while (q.items.length || q.running) { await sleep(100); if (!q.running && q.items.length) pump(); }
      if (q.failed) { toast('The take could not be saved: ' + q.failed); api('/api/record/abort', { id }).then(apply).catch(() => {}); setPhase('ready'); return; }
      try { apply(await api('/api/record/finish', { id, seconds: Math.round(elapsed * 10) / 10 })); } catch {}
      setPhase(stream.current ? 'ready' : 'off');
    };
    setSecs(0); mr.start(1000); setPhase('recording');
  }
  const pause = () => { const m = rec.current && rec.current.mr; if (!m) return; if (m.state === 'recording') { m.pause(); setPhase('paused'); } else if (m.state === 'paused') { m.resume(); setPhase('recording'); } };
  const stop = () => { const m = rec.current && rec.current.mr; if (m && m.state !== 'inactive') m.stop(); };
  const retake = async id => { await api('/api/record/take', { id, action: 'discard' }).then(apply).catch(() => {}); begin(); };

  // teleprompter: smooth scroll at the chosen WPM (Prompter.jsx), started by the take (after the countdown, stops
  // when you pause). [pause] holds a line 1.5 s longer. Voice follow is not used: Chrome's speech recognition sends
  // the audio to a server, and Studio keeps everything on this computer.
  const scripts = (V && V.scripts) || [];
  useEffect(() => { if (scriptId) { setSrc(scriptId); setPrompt(true); remember('src', scriptId); remember('prompt', true); } }, [scriptId]);
  useEffect(() => {
    if (src === 'paste') { setPicked(null); return; }
    api('/api/scripts/get?id=' + encodeURIComponent(src)).then(j => { setPicked(j.script); if (j.script.wpm && !localStorage.getItem('studio.rec.wpm')) setWpm(j.script.wpm); }).catch(() => { setSrc('paste'); });
  }, [src, (scripts.find(x => x.id === src) || {}).updated]);
  const text = picked ? picked.text : script;
  const lines = useMemo(() => cue(text, wpm), [text, wpm]);
  const total = lines.reduce((a, x) => a + x.dur, 0);
  const setSpeed = v => { const w = clampWpm(typeof v === 'function' ? v(wpm) : v); setWpm(w); remember('wpm', w); };
  const keyRef = useRef(null);
  const pop = usePopout(keyRef);
  const { roll, line, nudge, place } = useRoll({ lines, rolling: phase === 'recording' || rehearse === 'running', reset: rollKey, still: RM, win: pop.win });
  // a new take starts the script from the top: at the countdown, or straight into recording when the countdown is off
  const lastPhase = useRef(phase);
  useEffect(() => { const was = lastPhase.current; lastPhase.current = phase; if (phase === 'countdown' || (phase === 'recording' && was !== 'paused' && was !== 'countdown')) { setRehearse('off'); setRollKey(k => k + 1); } }, [phase]);
  useEffect(() => { requestAnimationFrame(place); }, [pop.el, fontPx, prompt, text]);
  const startRehearse = () => { setRollKey(k => k + 1); setRehearse('running'); };
  const stopRehearse = () => { setRehearse('off'); setRollKey(k => k + 1); };
  const popOut = async () => { if (!(await pop.open())) toast('The browser blocked the pop-out. Allow pop-ups for this page and try again.'); };
  // keys while the recorder is on screen: Space record or stop, P pause, up and down change the WPM, left and right move a line
  useEffect(() => {
    if (!visible) return;
    const onKey = e => {
      const el = e.target && e.target.tagName ? e.target : document.activeElement;
      if ((/INPUT|TEXTAREA|SELECT/.test(el.tagName) && el.type !== 'range') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' && !(e.target.closest && e.target.closest('button, [role="switch"]'))) { e.preventDefault(); if (rehearse !== 'off') setRehearse(r => (r === 'running' ? 'paused' : 'running')); else if (phase === 'ready') begin(); else if (phase === 'recording' || phase === 'paused') stop(); }
      else if (e.key === 'p' || e.key === 'P') { if (phase === 'recording' || phase === 'paused') { e.preventDefault(); pause(); } }
      else if (prompt && e.key === 'ArrowUp') { e.preventDefault(); setSpeed(w => w + WPM_STEP); }
      else if (prompt && e.key === 'ArrowDown') { e.preventDefault(); setSpeed(w => w - WPM_STEP); }
      else if (prompt && e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
      else if (prompt && e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
    };
    keyRef.current = onKey;
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  });

  const takes = (s.takes || []).slice().reverse();
  const live = phase !== 'off' && phase !== 'asking' && phase !== 'insecure';
  const showPrompt = prompt && (live || rehearse !== 'off' || !!pop.el);
  return <div className="recorder glass-card" id="recorder" aria-label="Record now">
    <div className="rec-head"><h3><Icon n="camera" />Record now</h3>
      {phase === 'recording' && <span className="rec-live" role="status"><i aria-hidden="true" />Recording {clock(secs)}</span>}
      {phase === 'paused' && <span className="rec-live paused" role="status">Paused {clock(secs)}</span>}
      {phase === 'saving' && <span className="rec-live saving" role="status">Saving the take</span>}
      <IconBtn n="x" label="Close the recorder" onClick={() => { if (busy) return toast('Stop the take first'); stopCamera(); onClose(); }} />
    </div>
    <div className="rec-body">
      <div className="rec-main">
      <div className={'rec-stage f' + frame.replace(':', 'x')} data-frame={frame}>
        <video ref={video} className={mirror ? 'mirror' : ''} muted playsInline aria-label="Camera preview" hidden={!live} />
        {!live && rehearse === 'off' && <div className="rec-off">
          {phase === 'insecure' ? <p>The camera needs Studio opened at http://127.0.0.1 or localhost on this computer.</p>
            : <><Icon n="camera" className="big" /><p>{err || 'Studio asks for your camera and mic. Nothing leaves this computer.'}</p>
              <Button id="rec-enable" variant="primary" size="lg" label={err ? 'Try again' : 'Turn on camera'} isLoading={phase === 'asking'} onClick={() => startCamera()} /></>}
        </div>}
        {live && guides && <div className="rec-guides" aria-hidden="true">
          <i className="v1" /><i className="v2" /><i className="h1" /><i className="h2" />
          <span className="head">Head</span><span className="caps">Captions</span>
        </div>}
        {showPrompt && !pop.el && <>
          <PrompterText lines={lines} line={line} roll={roll} flip={flipText} still={RM} fontPx={fontPx} className={live ? '' : 'solo'} />
          <div className="rp-dock"><SpeedBar wpm={wpm} setWpm={setSpeed} />
            <IconBtn id="rp-popout" n="popout" label="Pop out the teleprompter" onClick={popOut} /></div>
        </>}
        {showPrompt && pop.el && <div className="rp-away" role="status"><Icon n="popout" />The teleprompter is in its own window.<button type="button" className="rp-chip" id="rp-return" onClick={pop.close}>Bring it back</button></div>}
        {phase === 'countdown' && <div className={'rec-count' + (RM ? ' still' : '')} key={count} aria-live="assertive">{count}</div>}
      </div>
      <div className="rec-bar">
        <span className="rec-clock" aria-label="Take length">{clock(secs)}</span>
        {(phase === 'ready' || phase === 'off' || phase === 'asking') && <button type="button" className="rec-btn" id="rec-start" aria-label="Start recording" disabled={phase !== 'ready'} onClick={begin}><span /></button>}
        {(phase === 'recording' || phase === 'paused' || phase === 'countdown') && <>
          <IconBtn id="rec-pause" n={phase === 'paused' ? 'play' : 'pause'} label={phase === 'paused' ? 'Resume' : 'Pause'} disabled={phase === 'countdown'} onClick={pause} />
          <button type="button" className="rec-btn on" id="rec-stop" aria-label="Stop and save the take" disabled={phase === 'countdown'} onClick={stop}><span /></button>
        </>}
        {phase === 'saving' && <span className="fine">Saving</span>}
        {prompt && !busy && (rehearse === 'off'
          ? <Button id="rec-rehearse" size="sm" variant="secondary" label="Rehearse" onClick={startRehearse} />
          : <><IconBtn id="rec-rehearse-pause" n={rehearse === 'paused' ? 'play' : 'pause'} label={rehearse === 'paused' ? 'Resume rehearsal' : 'Pause rehearsal'} onClick={() => setRehearse(r => (r === 'running' ? 'paused' : 'running'))} />
            <Button id="rec-rehearse-stop" size="sm" variant="secondary" label="Stop rehearsal" onClick={stopRehearse} /></>)}
        {rehearse !== 'off' && <span className="rec-live reh" role="status">{rehearse === 'paused' ? 'Rehearsal paused' : 'Rehearsing, not recording'}</span>}
        <span className="rec-format fine">{frame}{pickMime() ? ', ' + pickMime().split(';')[0].replace('video/', '') : ''}</span>
      </div>
      </div>
      <div className="rec-side">
        <label className="lbl" htmlFor="rec-cam">Camera</label>
        <select id="rec-cam" value={cam} disabled={busy || !devices.cams.length} onChange={e => { setCam(e.target.value); remember('cam', e.target.value); startCamera(e.target.value, mic); }}>
          {devices.cams.length ? devices.cams.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>) : <option value="">Turn on the camera first</option>}
        </select>
        <label className="lbl" htmlFor="rec-mic">Mic</label>
        <select id="rec-mic" value={mic} disabled={busy || !devices.mics.length} onChange={e => { setMic(e.target.value); remember('mic', e.target.value); startCamera(cam, e.target.value); }}>
          {devices.mics.length ? devices.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${i + 1}`}</option>) : <option value="">Turn on the camera first</option>}
        </select>
        <div className="rec-meter" role="meter" aria-label="Mic level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}><span ref={meter} /></div>
        <span className="lbl">Frame</span>
        <div id="rec-frame"><SegmentedControl label="Frame" size="sm" value={frame} isDisabled={busy} onChange={v => { setFrame(v); remember('frame', v); }}>
          <SegmentedControlItem value="9:16" label="9:16" /><SegmentedControlItem value="16:9" label="16:9" /><SegmentedControlItem value="1:1" label="1:1" /></SegmentedControl></div>
        <Switch id="rec-mirror" size="sm" label="Mirror preview" value={mirror} onChange={v => { setMirror(v); remember('mirror', v); }} />
        <Switch id="rec-guides" size="sm" label="Framing guides" value={guides} onChange={v => { setGuides(v); remember('guides', v); }} />
        <Switch id="rec-countdown" size="sm" label="3, 2, 1 countdown" value={countdownOn} onChange={v => { setCountdownOn(v); remember('countdown', v); }} />
        <Switch id="rec-prompt" size="sm" label="Teleprompter" value={prompt} onChange={v => { setPrompt(v); remember('prompt', v); }} />
        {prompt && <>
          <label className="lbl" htmlFor="rec-src">Script</label>
          <select id="rec-src" value={src} disabled={busy} onChange={e => { setSrc(e.target.value); remember('src', e.target.value); }}>
            <option value="paste">Paste a script here</option>
            {scripts.map(x => <option key={x.id} value={x.id}>{x.title} ({x.words} words)</option>)}
          </select>
          {src === 'paste' && <textarea id="rec-script" rows={4} aria-label="Script to read" placeholder="Paste what you will say" value={script} onChange={e => { setScript(e.target.value); localStorage.setItem('studio.script', e.target.value); }} />}
          <label className="lbl" htmlFor="rec-wpm">Speed <b>{wpm} WPM, {pace(wpm).toLowerCase()}</b>{total ? `, about ${Math.round(total)} s` : ''}</label>
          <input id="rec-wpm" type="range" min={60} max={260} step={5} value={wpm} onChange={e => setSpeed(+e.target.value)} />
          <label className="lbl" htmlFor="rec-font">Text size <b>{fontPx}</b></label>
          <input id="rec-font" type="range" min={14} max={44} step={1} value={fontPx} onChange={e => { setFontPx(+e.target.value); remember('font', e.target.value); }} />
          <Switch id="rec-flip" size="sm" label="Mirror text (beam splitter)" value={flipText} onChange={v => { setFlipText(v); remember('flip', v); }} />
          <Button id="rec-popout" size="sm" variant="secondary" label={pop.el ? 'Bring the teleprompter back' : 'Pop out the teleprompter'} onClick={() => (pop.el ? pop.close() : popOut())} />
          <p className="fine">Scrolls at your speed from the start of the take. Up and down change the speed while it scrolls, left and right move a line, Space records or stops (or pauses a rehearsal), P pauses. {canPip() ? 'The pop-out stays on top of other windows in this browser.' : 'The pop-out is a normal window here; Chrome and Edge keep it on top.'}</p>
        </>}
      </div>
    </div>
    {takes.length > 0 && <ol className="takes" id="takes" aria-label="Takes">
      {takes.map(t => <li key={t.id} className={'take' + (t.kept ? ' kept' : '')}>
        <span className="tthumb">{t.thumb ? <img src={file(t.thumb)} alt="" /> : <Icon n="film" />}</span>
        <span className="tmeta"><b>Take {t.id}</b><span>{t.seconds != null ? clock(Math.round(t.seconds)) : ''}</span></span>
        <span className="tstate">{t.status === 'ready' ? (t.kept ? <Badge label="In footage" variant="success" /> : <Badge label="Not used" variant="neutral" />)
          : t.status === 'failed' ? <Badge label="Failed" variant="error" /> : <Badge label={t.status === 'converting' ? 'Saving' : 'Recording'} variant="cyan" />}</span>
        {t.status === 'failed' && <span className="err">{t.error}</span>}
        <span className="tact">
          {t.status === 'ready' && <a className="icon-btn" href={file(t.file)} target="_blank" rel="noreferrer" aria-label={`Play take ${t.id}`} title="Play"><Icon n="play" /></a>}
          {t.status === 'ready' && <Switch size="sm" label={`Keep take ${t.id}`} isLabelHidden value={!!t.kept} onChange={v => api('/api/record/take', { id: t.id, action: v ? 'keep' : 'unkeep' }).then(apply).catch(() => {})} />}
          {t.id === lastId && t.status === 'ready' && phase === 'ready' && <Button size="sm" variant="secondary" label="Retake" onClick={() => retake(t.id)} />}
          {(t.status === 'ready' || t.status === 'failed') && <IconBtn n="trash" label={`Discard take ${t.id}`} onClick={() => { if (confirm(`Discard take ${t.id}? Its file is deleted.`)) api('/api/record/take', { id: t.id, action: 'discard' }).then(apply).catch(() => {}); }} />}
        </span>
      </li>)}
    </ol>}
    {prompt && <PopoutPanel pop={pop} wpm={wpm} setWpm={setSpeed} phase={phase} secs={secs} count={count} rehearse={rehearse}
      text={<PrompterText lines={lines} line={line} roll={roll} flip={flipText} still={RM} fontPx={Math.round(fontPx * 1.4)} className="big" />}
      onRecord={begin} onStop={stop} onPause={pause} onRehearse={startRehearse} onRehearsePause={() => setRehearse(r => (r === 'running' ? 'paused' : 'running'))} onRehearseStop={stopRehearse}
      flip={flipText} setFlip={v => { setFlipText(v); remember('flip', v); }} fontPx={fontPx} setFontPx={v => { setFontPx(v); remember('font', v); }} />}
    <NeedFix V={V} ids={['ffmpeg']} what="Saving takes as mp4" />
    <canvas ref={canvas} hidden />
  </div>;
}
