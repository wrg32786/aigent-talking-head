import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { aigentTheme } from './theme.js';
import { api, toast, onToast, onOffline, setOffline, isOffline, STEPS, stepName, stepOf, lookSubOf, Icon, IconBtn, cap1 } from './lib.jsx';
import { YourEdit } from './Edit.jsx';
import { BRoll } from './BRoll.jsx';
import { Keys } from './Keys.jsx';
import { Footage } from './Footage.jsx';
import { Reference } from './Reference.jsx';
import { Cut } from './Cut.jsx';
import { Outputs } from './Outputs.jsx';
import { AskAgent, Wizards } from './Agent.jsx';
import { Style } from './Style.jsx';
import { Render } from './Render.jsx';
import { Post } from './Post.jsx';
import { Chat } from './Chat.jsx';
import { Settings } from './Settings.jsx';
import { MoreMenu } from './ui.jsx';
import { PicksTray } from './Picks.jsx';
import { Connect, copyText } from './Connect.jsx';
// the AIgent wordmark (from the AIgent brand's assets/Marks): one file per ground, never one colour
import wordmarkDark from './brand/aigent-wordmark-for-dark.svg';
import wordmarkLight from './brand/aigent-wordmark-for-white.svg';
import { SetupCheck } from './Setup.jsx';
import { NewVideo, cleanJob } from './NewVideo.jsx';
import { FixActions } from './Fix.jsx';

const hashStep = () => (location.hash.match(/step=([a-z]+)/) || [])[1];
const hashMenu = () => (location.hash.match(/menu=([a-z-]+)/) || [])[1];
function firstStep() {
  const s = stepOf(hashStep() || (hashMenu() ? 'look' : localStorage.getItem('studio.step')) || 'footage');
  return STEPS.includes(s) ? s : 'footage';
}
// Look holds two views: your look (packs, effects, sound) and the reference
function firstLookSub() { return lookSubOf(hashStep()) || (hashMenu() ? 'style' : localStorage.getItem('studio.look')) || 'style'; }

export function App() {
  const [CAT, setCat] = useState(null);
  const [V, setV] = useState(null);
  const [step, setStep] = useState(firstStep);
  const [tab, setTab] = useState(hashMenu() || null);
  const [lookSub, setLookSubState] = useState(firstLookSub);
  const setLookSub = useCallback(v => { setLookSubState(v); localStorage.setItem('studio.look', v); }, []);
  const [theme, setThemeState] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [glass, setGlassState] = useState(document.documentElement.dataset.glass !== 'off');
  const [chatOpen, setChatOpen] = useState(/chat/.test(location.hash));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(/keys/.test(location.hash));
  const [connectOpen, setConnectOpen] = useState(/connect/.test(location.hash));
  const [setupOpen, setSetupOpen] = useState(/setup/.test(location.hash));
  const [videoMode, setVideoMode] = useState(/new-video/.test(location.hash) ? 'new' : null);
  const [outputsOpen, setOutputsOpen] = useState(/outputs/.test(location.hash));
  const [wizOpen, setWizOpen] = useState(/wizards/.test(location.hash));
  const [log, setLog] = useState('');
  const [recLive, setRecLive] = useState(null);
  // the theme button leaves the top bar on a phone (studio.css), so only there does More carry it
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 640px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 640px)'), on = () => setNarrow(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  const mainRef = useRef(null);

  const seen = useRef({ boot: null, seq: 0, video: null });
  const apply = useCallback(v => {
    if (!v || !v.state) return v;
    const k = seen.current;
    if (v.seq && v.boot === k.boot && v.seq < k.seq) return v; // an older reply than what is on screen
    const video = v.state.videoSeq || 0;
    if (k.video !== null && video !== k.video) {
      setStep('footage'); localStorage.setItem('studio.step', 'footage'); history.replaceState(null, '', '#step=footage');
      setLog(''); setRecLive(null); // a task log and a recorder status belong to the previous board
    }
    if (v.seq) seen.current = { boot: v.boot, seq: v.seq, video };
    setV(v); return v;
  }, []);
  const patch = useCallback(p => api('/api/state', p).then(apply), [apply]);
  const reloadCat = useCallback(async () => setCat(await api('/api/catalog')), []);
  // a scene made from a reference or by your agent joins the menu: the catalog is read again when the list changes
  useEffect(() => { if (V && CAT && V.scenes != null && (CAT.scenesSig || '') !== V.scenes) reloadCat().catch(() => {}); }, [V && V.scenes, CAT && CAT.scenesSig]);

  const setTheme = t => { document.documentElement.dataset.theme = t; localStorage.setItem('studio.theme', t); setThemeState(t); };
  const setGlass = on => { if (on) delete document.documentElement.dataset.glass; else document.documentElement.dataset.glass = 'off'; localStorage.setItem('studio.glass', on ? '1' : '0'); setGlassState(on); };

  const go = useCallback((s0, focus) => {
    const s = stepOf(s0), sub = lookSubOf(s0); if (sub) setLookSub(sub);
    setStep(s); localStorage.setItem('studio.step', s);
    if (!/menu=/.test(location.hash) || s !== 'look') history.replaceState(null, '', '#step=' + s);
    if (focus) requestAnimationFrame(() => { window.scrollTo({ top: 0 }); const h = document.querySelector(`main .step[data-step="${s === 'look' ? (sub || localStorage.getItem('studio.look') || 'style') : s}"]:not([hidden]) h2`); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } });
  }, [setLookSub]);
  const pickTab = useCallback(id => { setTab(id); history.replaceState(null, '', '#menu=' + id); }, []);

  useEffect(() => {
    let es;
    (async () => {
      try {
        setCat(await api('/api/catalog'));
        apply(await api('/api/state'));
      } catch (e) { toast('Studio could not load: ' + e.message); return; }
      es = new EventSource('/api/events');
      es.addEventListener('state', e => apply(JSON.parse(e.data)));
      es.addEventListener('log', e => { const d = JSON.parse(e.data); setLog(l => (l ? l + '\n' : '') + d.line); });
      es.addEventListener('task', () => api('/api/state').then(apply).catch(() => {}));
      // the live line drops when Studio stops: check once, so the Studio stopped bar shows before anyone clicks
      es.addEventListener('error', () => { fetch('/api/state', { cache: 'no-store' }).then(r => { if (r.ok) setOffline(false); }).catch(() => setOffline(true)); });
      es.addEventListener('open', () => { if (isOffline()) { setOffline(false); api('/api/state').then(apply).catch(() => {}); } });
    })();
    const onHash = () => { const m = hashMenu(), st = hashStep(); if (m) { setStep('look'); setLookSub('style'); setTab(m); } else if (st && STEPS.includes(stepOf(st))) go(st, true); };
    const onKey = e => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); go('style'); setTimeout(() => document.getElementById('filter')?.focus(), 30); }
    };
    addEventListener('hashchange', onHash); document.addEventListener('keydown', onKey);
    return () => { es && es.close(); removeEventListener('hashchange', onHash); document.removeEventListener('keydown', onKey); };
  }, [apply, go, setLookSub]);

  if (!CAT || !V) return <Theme theme={aigentTheme} mode={theme}><div className="boot" role="status"><span className="spin" aria-hidden="true" />Loading Studio</div><StudioOffline onBack={() => location.reload()} /><Toast /></Theme>;

  const s = V.state, t = V.task, running = t && t.status === 'running';
  const picksAny = Object.values(s.picks).some(p => p.allow.length || p.deny.length);
  const done = { footage: !!(s.footage.length || s.clips), cut: !!(V.cut && V.cut.candidates && V.cut.candidates.length), look: !!(s.pack || picksAny || s.reference.extracted), broll: !!(V.broll && V.broll.beats && V.broll.beats.some(b => b.slot)), finish: !!(V.currentOutputs || []).length };
  const i = STEPS.indexOf(step);
  const openConnect = () => { setSettingsOpen(false); setChatOpen(false); setConnectOpen(true); };
  const openSetup = () => { setSettingsOpen(false); setSetupOpen(true); };
  const openKeys = () => { setSettingsOpen(false); setKeysOpen(true); };
  const openChat = () => setChatOpen(true);
  const openOutputs = () => setOutputsOpen(true), openNewVideo = () => setVideoMode('new');
  const ctx = { CAT, V, s, apply, patch, go, reloadCat, setLog, log, openConnect, openSetup, openKeys, openChat, openOutputs, openNewVideo };
  const env = V.env, a = env.agent || {}, agentState = env.backend !== 'agent' ? 'alt' : a.listening ? 'on' : a.connected ? 'busy' : 'off';
  const pill = !t ? 'Ready' : running ? `${cap1(t.kind)} running` : t.status === 'failed' ? `${cap1(t.kind)} failed` : `${cap1(t.kind)} ${t.status}`;

  return (
    <Theme theme={aigentTheme} mode={theme}>
      <a className="skip" href="#main">Skip to the editor</a>
      <div className="ambient" aria-hidden="true" />
      <header className="top glass">
        <div className="brand"><img className="wm wm-dark" src={wordmarkDark} alt="AIgent" width="127" height="59" /><img className="wm wm-light" src={wordmarkLight} alt="AIgent" width="127" height="59" /><span className="bname">Studio</span></div>
        <div className="jobrow"><JobName s={s} patch={patch} /><IconBtn id="new-video-open" n="plus" className="nv-btn" label="New video" aria-haspopup="dialog" onClick={() => setVideoMode('new')} /></div>
        <nav className="stepper" aria-label="Steps"><ol id="stepper">
          {STEPS.map((st, k) => <li key={st} className={done[st] ? 'done' : ''}>
            <button type="button" data-step={st} aria-current={st === step ? 'step' : 'false'} title={stepName(st)} aria-label={`${k + 1}. ${stepName(st)}${done[st] && st !== step ? ', done' : ''}`} onClick={() => go(st, true)}>
              <span className="sn">{done[st] && st !== step ? <Icon n="check" /> : k + 1}</span><span className="sl">{stepName(st)}</span>
            </button></li>)}
        </ol></nav>
        <div className="topr">
          {recLive && step !== 'footage' && <button type="button" className="rec-pill" id="rec-pill" onClick={() => go('footage', true)} aria-label="Recording, go back to the recorder"><i aria-hidden="true" />{recLive.phase === 'paused' ? 'Paused' : recLive.phase === 'saving' ? 'Saving take' : 'Recording'}</button>}
          {env.setup && !env.setup.ready && (() => { const nm = Object.values(env.setup.missing).filter(x => x.need === 'core').length; return <button type="button" className="setup-pill" id="setup-pill" onClick={openSetup} aria-label={`${nm} missing, open Setup check`} title="Setup check"><Icon n="ban" /><span className="sp-n">{nm}</span><span className="sp-l"> missing</span></button>; })()}
          <button type="button" className="out-btn" id="wizards-open" aria-haspopup="dialog" onClick={() => setWizOpen(true)} title="A guided start"><Icon n="spark" /><span className="ob-l">Wizards</span></button>
          <button type="button" className="out-btn" id="outputs-open" aria-haspopup="dialog" onClick={() => setOutputsOpen(true)} title="Every render, with its settings"><Icon n="film" /><span className="ob-l">Outputs</span></button>
          <button type="button" className={'connect-btn ' + agentState} id="connect-open" aria-haspopup="dialog" onClick={openConnect} title={agentState === 'on' ? `${a.name} connected` : 'Connect your terminal agent'}><Icon n="plug" /><span className="cb-l">{agentState === 'on' || agentState === 'busy' ? (a.name || 'Agent') : 'Connect agent'}</span></button>
          <span id="taskpill" role="status" aria-live="polite" className={t ? '' : 'idle'}>{t ? <Badge label={pill} variant={running ? 'cyan' : t.status === 'failed' ? 'error' : 'neutral'} /> : <span className="sr">{pill}</span>}</span>
          <button type="button" className="icon-btn theme-btn" id="theme" data-mode={theme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon n="moon" className="tm-moon" /><Icon n="sun" className="tm-sun" /></button>
          <button className="icon-btn fab" id="chat-open" type="button" aria-controls="chat" aria-expanded={String(chatOpen)} aria-label="Open chat" onClick={() => setChatOpen(true)}><Icon n="chat" /><span className={'dot ' + agentState} id="fab-dot" aria-hidden="true" /></button>
          <IconBtn id="open-settings" n="sliders" label="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)} />
          <MoreMenu id="more-open" label="More" items={[
            { id: 'more-open-video', label: 'Past videos', icon: 'film', onClick: () => setVideoMode('open') },
            { id: 'more-setup', label: 'Setup check', icon: 'check', onClick: openSetup },
            { id: 'more-keys', label: 'API keys', icon: 'link', onClick: openKeys },
            narrow && { id: 'more-theme', label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'sun' : 'moon', onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
          ]} />
        </div>
      </header>
      <div className="layout">
        <main id="main" data-step={step} data-look={lookSub} ref={mainRef}>
          {step !== 'post' && <YourEdit V={V} s={s} go={go} step={step} />}
          {step === 'look' && <LookSwitch sub={lookSub} setSub={v => { setLookSub(v); }} s={s} />}
          {/* a new or opened video remounts the steps, so no step keeps the last board's local picks */}
          <Fragment key={'v' + (s.videoSeq || 0)}>
          <Footage {...ctx} hidden={step !== 'footage'} onLive={setRecLive} />
          {step === 'cut' && <Cut {...ctx} />}
          {step === 'look' && lookSub === 'reference' && <Reference {...ctx} />}
          <Style {...ctx} hidden={step !== 'look' || lookSub !== 'style'} tab={tab} setTab={pickTab} />
          {step === 'broll' && <BRoll {...ctx} />}
          <Render {...ctx} hidden={step !== 'finish'} />
          {step === 'post' && <Post {...ctx} />}
          </Fragment>
          <footer className="stepnav glass" id="stepnav">
            <span style={{ visibility: i ? 'visible' : 'hidden' }}><Button id="prev" variant="ghost" label="Back" icon={<Icon n="left" />} onClick={() => go(STEPS[Math.max(0, i - 1)], true)} /></span>
            <PicksTray s={s} patch={patch} cat={CAT} added={(V.look && V.look.added) || []} openLayer={pickTab} />
            <AskAgent step={step} apply={apply} openChat={openChat} />
            {i < STEPS.length - 1 ? <Button id="next" variant="primary" label={stepName(STEPS[i + 1])} endContent={<Icon n="right" />} onClick={() => go(STEPS[i + 1], true)} /> : <span className="nextpad" />}
          </footer>
        </main>
        <Chat key={s.videoSeq || 0} {...ctx} open={chatOpen} setOpen={setChatOpen} agentState={agentState} />
      </div>
      <Settings {...ctx} open={settingsOpen} setOpen={setSettingsOpen} theme={theme} setTheme={setTheme} glass={glass} setGlass={setGlass} />
      <Connect {...ctx} open={connectOpen} setOpen={setConnectOpen} />
      <SetupCheck {...ctx} open={setupOpen} setOpen={setSetupOpen} />
      <Keys {...ctx} open={keysOpen} setOpen={setKeysOpen} />
      <NewVideo {...ctx} mode={videoMode} setMode={setVideoMode} />
      <Outputs {...ctx} open={outputsOpen} setOpen={setOutputsOpen} />
      <Wizards {...ctx} open={wizOpen} setOpen={setWizOpen} />
      <StudioOffline onBack={apply} prompt={V.env.restart} />
      <Toast V={V} />
    </Theme>
  );
}

// Look is one step with two views: your look (packs, effects, sound and pace) and a reference to borrow from
function LookSwitch({ sub, setSub, s }) {
  const r = s.reference, refOn = !!(r && r.extracted && r.mode !== 'off');
  return <div className="look-switch" id="look-switch"><div className="seg" role="radiogroup" aria-label="Look">
    <button type="button" role="radio" id="look-sub-style" aria-checked={sub === 'style'} onClick={() => setSub('style')}>Your look</button>
    <button type="button" role="radio" id="look-sub-reference" aria-checked={sub === 'reference'} onClick={() => setSub('reference')}>Reference{refOn ? <span className="dotmark" aria-label=", in use" /> : null}</button>
  </div></div>;
}

function JobName({ s, patch }) {
  const [val, setVal] = useState(s.job || '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setVal(s.job || ''); }, [s.job]);
  const commit = () => { const j = cleanJob(val) || null; if (j === (s.job || null)) { setVal(s.job || ''); return; } patch({ job: j }).catch(() => {}); };
  return <label className="job"><span className="sr">Job name</span>
    <input id="job" name="job" placeholder="name-your-reel" autoComplete="off" spellCheck="false" aria-describedby="job-hint" value={val}
      onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}
      onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onBlurCapture={commit} />
    <span id="job-hint" className="sr">Lowercase letters, numbers and dashes. Your files go in jobs/ under this name.</span></label>;
}

// a toast with fix ids stays longer and shows the fix buttons (web/src/Fix.jsx) under the message
// Studio stopped while the page was open (the window that ran it closed, the PC slept, or it crashed). Every click would
// say "Failed to fetch", so we say it once, plainly, with a prompt for the agent, and reconnect by ourselves when it is back.
// the instruction comes from the server (kit/studio/fixes.mjs restartPrompt) and is kept from the last state; before
// Studio ever loaded we only have plain words
const RESTART_PLAIN = 'AIgent Studio stopped. Start it again from my aigent-talking-head folder, then tell me when the page is back.';
function StudioOffline({ onBack, prompt }) {
  const [off, setOff] = useState(isOffline()), back = useRef(onBack); back.current = onBack;
  useEffect(() => onOffline(setOff), []);
  useEffect(() => {
    if (!off) return;
    const t = setInterval(async () => {
      try { const r = await fetch('/api/state', { cache: 'no-store' }); if (!r.ok) return; const j = await r.json(); setOffline(false); back.current && back.current(j); toast('Studio is back.', true); } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [off]);
  if (!off) return null;
  return <div className="offline glass" id="studio-offline" role="alert">
    <p><b>Studio stopped.</b> Nothing can load or save until it runs again. Ask your agent to start it; this page reconnects by itself.</p>
    <Button size="sm" variant="primary" label="Copy for my agent" icon={<Icon n="copy" />} onClick={() => copyText(prompt || RESTART_PLAIN, 'Copied. Paste it into your agent.')} />
  </div>;
}

function Toast({ V }) {
  const [t, setT] = useState(null);
  useEffect(() => { let timer; const off = onToast(x => { setT(x); clearTimeout(timer); timer = setTimeout(() => setT(null), x.fix ? 15000 : 4200); }); return () => { off(); clearTimeout(timer); }; }, []);
  const fixes = t && t.fix && V ? t.fix.filter(id => V.env.fixes && V.env.fixes[id]) : [];
  return <div id="toast" className={'toast glass' + (t && t.ok ? ' ok' : '') + (fixes.length ? ' has-fix' : '')} role="alert" hidden={!t}>{t ? t.msg : ''}
    {fixes.map(id => <div className="fix-row" key={id}>{fixes.length > 1 && <b className="fine">{V.env.fixes[id].label}</b>}<FixActions V={V} id={id} /></div>)}</div>;
}
