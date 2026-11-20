import { useCallback, useEffect, useRef, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { aigentTheme } from './theme.js';
import { api, toast, onToast, STEPS, stepName, Icon, IconBtn, cap1 } from './lib.jsx';
import { BRoll } from './BRoll.jsx';
import { Keys } from './Keys.jsx';
import { Footage } from './Footage.jsx';
import { Reference } from './Reference.jsx';
import { Cut } from './Cut.jsx';
import { Style } from './Style.jsx';
import { Render } from './Render.jsx';
import { Chat } from './Chat.jsx';
import { Settings } from './Settings.jsx';
import { MoreMenu } from './ui.jsx';
import { PicksTray } from './Picks.jsx';
import { Connect } from './Connect.jsx';
// the AIgent wordmark (from the AIgent brand's assets/Marks): one file per ground, never one colour
import wordmarkDark from './brand/aigent-wordmark-for-dark.svg';
import wordmarkLight from './brand/aigent-wordmark-for-white.svg';
import { SetupCheck } from './Setup.jsx';

const hashStep = () => (location.hash.match(/step=([a-z]+)/) || [])[1];
const hashMenu = () => (location.hash.match(/menu=([a-z-]+)/) || [])[1];
function firstStep() {
  const s = hashStep() || (hashMenu() ? 'style' : localStorage.getItem('studio.step')) || 'footage';
  return STEPS.includes(s) ? s : 'footage';
}

export function App() {
  const [CAT, setCat] = useState(null);
  const [V, setV] = useState(null);
  const [step, setStep] = useState(firstStep);
  const [tab, setTab] = useState(hashMenu() || null);
  const [theme, setThemeState] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [glass, setGlassState] = useState(document.documentElement.dataset.glass !== 'off');
  const [chatOpen, setChatOpen] = useState(/chat/.test(location.hash));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(/keys/.test(location.hash));
  const [connectOpen, setConnectOpen] = useState(/connect/.test(location.hash));
  const [setupOpen, setSetupOpen] = useState(/setup/.test(location.hash));
  const [log, setLog] = useState('');
  const [recLive, setRecLive] = useState(null);
  const mainRef = useRef(null);

  const apply = useCallback(v => { if (v && v.state) setV(v); return v; }, []);
  const patch = useCallback(p => api('/api/state', p).then(apply), [apply]);
  const reloadCat = useCallback(async () => setCat(await api('/api/catalog')), []);

  const setTheme = t => { document.documentElement.dataset.theme = t; localStorage.setItem('studio.theme', t); setThemeState(t); };
  const setGlass = on => { if (on) delete document.documentElement.dataset.glass; else document.documentElement.dataset.glass = 'off'; localStorage.setItem('studio.glass', on ? '1' : '0'); setGlassState(on); };

  const go = useCallback((s, focus) => {
    setStep(s); localStorage.setItem('studio.step', s);
    if (!/menu=/.test(location.hash) || s !== 'style') history.replaceState(null, '', '#step=' + s);
    if (focus) requestAnimationFrame(() => { window.scrollTo({ top: 0 }); const h = document.querySelector(`.step[data-step="${s}"] h2`); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } });
  }, []);
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
    })();
    const onHash = () => { const m = hashMenu(), st = hashStep(); if (m) { setStep('style'); setTab(m); } else if (st && STEPS.includes(st)) go(st, true); };
    const onKey = e => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); go('style'); setTimeout(() => document.getElementById('filter')?.focus(), 30); }
    };
    addEventListener('hashchange', onHash); document.addEventListener('keydown', onKey);
    return () => { es && es.close(); removeEventListener('hashchange', onHash); document.removeEventListener('keydown', onKey); };
  }, [apply, go]);

  if (!CAT || !V) return <Theme theme={aigentTheme} mode={theme}><div className="boot" role="status"><span className="spin" aria-hidden="true" />Loading Studio</div><Toast /></Theme>;

  const s = V.state, t = V.task, running = t && t.status === 'running';
  const picksAny = Object.values(s.picks).some(p => p.allow.length || p.deny.length);
  const done = { footage: !!(s.footage.length || s.clips), cut: !!(V.cut && V.cut.candidates && V.cut.candidates.length), reference: !!s.reference.extracted, style: !!(s.pack || picksAny), broll: !!(V.broll && V.broll.beats && V.broll.beats.some(b => b.slot)), render: !!(V.outputs || []).length };
  const i = STEPS.indexOf(step);
  const openConnect = () => { setSettingsOpen(false); setChatOpen(false); setConnectOpen(true); };
  const openSetup = () => { setSettingsOpen(false); setSetupOpen(true); };
  const openKeys = () => { setSettingsOpen(false); setKeysOpen(true); };
  const ctx = { CAT, V, s, apply, patch, go, reloadCat, setLog, log, openConnect, openSetup, openKeys };
  const env = V.env, a = env.agent || {}, agentState = env.backend !== 'agent' ? 'alt' : a.listening ? 'on' : a.connected ? 'busy' : 'off';
  const pill = !t ? 'Ready' : running ? `${cap1(t.kind)} running` : t.status === 'failed' ? `${cap1(t.kind)} failed` : `${cap1(t.kind)} ${t.status}`;

  return (
    <Theme theme={aigentTheme} mode={theme}>
      <a className="skip" href="#main">Skip to the editor</a>
      <div className="ambient" aria-hidden="true" />
      <header className="top glass">
        <div className="brand"><img className="wm wm-dark" src={wordmarkDark} alt="AIgent" width="127" height="59" /><img className="wm wm-light" src={wordmarkLight} alt="AIgent" width="127" height="59" /><span className="bname">Studio</span></div>
        <JobName s={s} patch={patch} />
        <nav className="stepper" aria-label="Steps"><ol id="stepper">
          {STEPS.map((st, k) => <li key={st} className={done[st] ? 'done' : ''}>
            <button type="button" data-step={st} aria-current={st === step ? 'step' : 'false'} title={stepName(st)} aria-label={`${k + 1}. ${stepName(st)}${done[st] && st !== step ? ', done' : ''}`} onClick={() => go(st, true)}>
              <span className="sn">{done[st] && st !== step ? <Icon n="check" /> : k + 1}</span><span className="sl">{stepName(st)}</span>
            </button></li>)}
        </ol></nav>
        <div className="topr">
          {recLive && step !== 'footage' && <button type="button" className="rec-pill" id="rec-pill" onClick={() => go('footage', true)} aria-label="Recording, go back to the recorder"><i aria-hidden="true" />{recLive.phase === 'paused' ? 'Paused' : recLive.phase === 'saving' ? 'Saving take' : 'Recording'}</button>}
          {env.setup && !env.setup.ready && (() => { const nm = Object.values(env.setup.missing).filter(x => x.need === 'core').length; return <button type="button" className="setup-pill" id="setup-pill" onClick={openSetup} aria-label={`${nm} missing, open Setup check`} title="Setup check"><Icon n="ban" /><span className="sp-n">{nm}</span><span className="sp-l"> missing</span></button>; })()}
          <button type="button" className={'connect-btn ' + agentState} id="connect-open" aria-haspopup="dialog" onClick={openConnect} title={agentState === 'on' ? `${a.name} connected` : 'Connect your terminal agent'}><Icon n="plug" /><span className="cb-l">{agentState === 'on' || agentState === 'busy' ? (a.name || 'Agent') : 'Connect agent'}</span></button>
          <span id="taskpill" role="status" aria-live="polite" className={t ? '' : 'idle'}>{t ? <Badge label={pill} variant={running ? 'cyan' : t.status === 'failed' ? 'error' : 'neutral'} /> : <span className="sr">{pill}</span>}</span>
          <button type="button" className="icon-btn theme-btn" id="theme" data-mode={theme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon n="moon" className="tm-moon" /><Icon n="sun" className="tm-sun" /></button>
          <button className="icon-btn fab" id="chat-open" type="button" aria-controls="chat" aria-expanded={String(chatOpen)} aria-label="Open chat" onClick={() => setChatOpen(true)}><Icon n="chat" /><span className={'dot ' + agentState} id="fab-dot" aria-hidden="true" /></button>
          <IconBtn id="open-settings" n="sliders" label="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)} />
          <MoreMenu id="more-open" label="More" items={[
            { id: 'more-connect', label: 'Connect agent', icon: 'plug', onClick: openConnect },
            { id: 'more-setup', label: 'Setup check', icon: 'check', onClick: openSetup },
            { id: 'more-keys', label: 'API keys and providers', icon: 'link', onClick: openKeys },
            { id: 'more-theme', label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'sun' : 'moon', onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
          ]} />
        </div>
      </header>
      <div className="layout">
        <main id="main" data-step={step} ref={mainRef}>
          <Footage {...ctx} hidden={step !== 'footage'} onLive={setRecLive} />
          {step === 'cut' && <Cut {...ctx} />}
          {step === 'reference' && <Reference {...ctx} />}
          <Style {...ctx} hidden={step !== 'style'} tab={tab} setTab={pickTab} />
          {step === 'broll' && <BRoll {...ctx} />}
          <Render {...ctx} hidden={step !== 'render'} />
          <footer className="stepnav glass" id="stepnav">
            <span style={{ visibility: i ? 'visible' : 'hidden' }}><Button id="prev" variant="ghost" label="Back" icon={<Icon n="left" />} onClick={() => go(STEPS[Math.max(0, i - 1)], true)} /></span>
            <PicksTray s={s} patch={patch} />
            {i < STEPS.length - 1 ? <Button id="next" variant="primary" label={stepName(STEPS[i + 1])} endContent={<Icon n="right" />} onClick={() => go(STEPS[i + 1], true)} /> : <span className="nextpad" />}
          </footer>
        </main>
        <Chat {...ctx} open={chatOpen} setOpen={setChatOpen} agentState={agentState} />
      </div>
      <Settings {...ctx} open={settingsOpen} setOpen={setSettingsOpen} theme={theme} setTheme={setTheme} glass={glass} setGlass={setGlass} />
      <Connect {...ctx} open={connectOpen} setOpen={setConnectOpen} />
      <SetupCheck open={setupOpen} setOpen={setSetupOpen} />
      <Keys {...ctx} open={keysOpen} setOpen={setKeysOpen} />
      <Toast />
    </Theme>
  );
}

function JobName({ s, patch }) {
  const [val, setVal] = useState(s.job || '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setVal(s.job || ''); }, [s.job]);
  const commit = () => { const j = val.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || null; if (j === (s.job || null)) { setVal(s.job || ''); return; } patch({ job: j }).catch(() => {}); };
  return <label className="job"><span className="sr">Job name</span>
    <input id="job" name="job" placeholder="name-your-reel" autoComplete="off" spellCheck="false" aria-describedby="job-hint" value={val}
      onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}
      onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onBlurCapture={commit} />
    <span id="job-hint" className="sr">Lowercase letters, numbers and dashes. Your files go in jobs/ under this name.</span></label>;
}

function Toast() {
  const [t, setT] = useState(null);
  useEffect(() => { let timer; const off = onToast(x => { setT(x); clearTimeout(timer); timer = setTimeout(() => setT(null), 4200); }); return () => { off(); clearTimeout(timer); }; }, []);
  return <div id="toast" className={'toast glass' + (t && t.ok ? ' ok' : '')} role="alert" hidden={!t}>{t ? t.msg : ''}</div>;
}
