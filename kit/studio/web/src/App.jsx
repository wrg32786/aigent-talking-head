import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { aigentTheme } from './theme.js';
import { api, quiet, toast, onToast, onOffline, setOffline, isOffline, STEPS, stepName, stepShort, stepOf, viewOf, menuStep, layerOf, STEP_LAYERS, LAYER_STEP, pickState, Icon, IconBtn, cap1 } from './lib.jsx';
import { YourEdit } from './Edit.jsx';
import { BRoll } from './BRoll.jsx';
import { Keys } from './Keys.jsx';
import { Footage } from './Footage.jsx';
import { Highlights } from './Highlights.jsx';
import { Teardowns } from './Teardowns.jsx';
import { Recording } from './Recording.jsx';
import { TabGroup, TabList, Tab } from '@headlessui/react';
import { Cut } from './Cut.jsx';
import { Outputs } from './Outputs.jsx';
import { AskAgent } from './Agent.jsx';
import { Picture, TextStep, Music, BrollLayer } from './Style.jsx';
import { Render, ReviewStep, RunFoot, useRun } from './Render.jsx';
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
import { Vault } from './Vault.jsx';

const hashStep = () => (location.hash.match(/step=([a-z]+)/) || [])[1];
const hashMenu = () => (location.hash.match(/menu=([a-z-]+)/) || [])[1];
// where the page opens: a #step= link (old names land on the step that holds them now), a #menu= link (the step
// that owns that layer), or the place you left
function firstStep() {
  const m = hashMenu(), s = m ? menuStep(m) : stepOf(hashStep() || localStorage.getItem('studio.step') || 'start');
  return STEPS.includes(s) ? s : 'start';
}
// the three tabs: New video (the steps), Teardowns (break down a video you like, and the Template Library) and Recording.
// A link names one (#tab=teardowns); old links land where their screen lives now: #step=reference on Teardowns, #record on
// Recording, any other #step= or #menu= on New video. Otherwise the tab you left
const AREAS = [['new', 'New video', 'plus'], ['teardowns', 'Teardowns', 'spark'], ['recording', 'Recording', 'camera']], AREA_IDS = AREAS.map(a => a[0]);
const hashArea = () => {
  const h = location.hash, a = (h.match(/tab=([a-z]+)/) || [])[1];
  return AREA_IDS.includes(a) ? a : hashStep() === 'reference' ? 'teardowns' : /record/.test(h) ? 'recording' : hashStep() || hashMenu() || /build=/.test(h) ? 'new' : null;
};
const firstArea = () => hashArea() || (AREA_IDS.includes(localStorage.getItem('studio.tab')) ? localStorage.getItem('studio.tab') : 'new');
// Start and Render each hold a second view: Highlights and Post. A link names it (#step=highlights, #step=post);
// otherwise the view you left
const firstOutView = () => { const h = hashStep(); return h ? (h === 'post' ? 'post' : 'main') : localStorage.getItem('studio.render') === 'post' ? 'post' : 'main'; };
const firstStartView = () => { const h = hashStep(); return h === 'highlights' ? 'highlights' : 'main'; };

import { Builder, buildOf } from './Builder/Builder.jsx';

export function App() {
  const [CAT, setCat] = useState(null);
  const [V, setV] = useState(null);
  const [step, setStep] = useState(firstStep);
  // an old #wizards link opens the builder, which took their place
  if (/wizards/.test(location.hash) && !buildOf()) history.replaceState(null, '', '#build=start');
  const [build, setBuild] = useState(buildOf); // the step by step builder page, or null for the classic steps
  const buildRef = useRef(build); buildRef.current = build;
  const [tab, setTab] = useState(hashMenu() || null);
  const [area, setAreaState] = useState(firstArea);
  const [outView, setOutViewState] = useState(firstOutView);
  const [startView, setStartView] = useState(firstStartView);
  // switching tab: New video writes its step back into the address, the other two their own #tab=
  const setArea = useCallback((a, write = true) => {
    setAreaState(a); localStorage.setItem('studio.tab', a);
    if (write) history.replaceState(null, '', a === 'new' ? (buildRef.current ? '#build=' + buildRef.current : '#step=' + (localStorage.getItem('studio.step') || 'start')) : '#tab=' + a);
  }, []);
  const setOutView = useCallback(v => { setOutViewState(v); localStorage.setItem('studio.render', v); }, []);
  const [looksList, setLooksList] = useState(null);
  const [theme, setThemeState] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [glass, setGlassState] = useState(document.documentElement.dataset.glass !== 'off');
  const [chatOpen, setChatOpenState] = useState(/chat/.test(location.hash));
  // the chat can be put away at any width (Close in its header) and comes back from the chat button in the top bar;
  // on a wide screen that is remembered, so a reload keeps it away
  const [chatAway, setChatAway] = useState(() => !/chat/.test(location.hash) && localStorage.getItem('studio.chat') === 'away');
  const setChatOpen = useCallback(on => { setChatOpenState(on); if (on) { setChatAway(false); localStorage.setItem('studio.chat', 'open'); } }, []);
  const closeChat = useCallback(() => { setChatOpenState(false); if (matchMedia('(min-width: 901px)').matches) { setChatAway(true); localStorage.setItem('studio.chat', 'away'); } }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(/keys/.test(location.hash));
  const [connectOpen, setConnectOpen] = useState(/connect/.test(location.hash));
  const [setupOpen, setSetupOpen] = useState(/setup/.test(location.hash));
  const [videoMode, setVideoMode] = useState(/new-video/.test(location.hash) ? 'new' : null);
  const [outputsOpen, setOutputsOpen] = useState(/outputs/.test(location.hash));
  // the Vault panel: null when closed, { beat } when open (the B-roll spot it was opened for, or null from the top bar)
  const [vault, setVault] = useState(null);
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
      // a new video opens where you started it: the builder's first screen, or the classic Start step
      setStep('start'); setStartView('main'); localStorage.setItem('studio.step', 'start'); history.replaceState(null, '', buildRef.current ? '#build=start' : '#step=start');
      if (buildRef.current) { buildRef.current = 'start'; setBuild('start'); }
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

  const catRef = useRef(null); catRef.current = CAT;
  const go = useCallback((s0, focus) => {
    const s = stepOf(s0), v = viewOf(s0);
    // the breakdown of a reference lives on Teardowns now
    if (v === 'reference') { setArea('teardowns'); if (focus) requestAnimationFrame(() => window.scrollTo({ top: 0 })); return; }
    setArea('new', false); setBuild(null);
    if (s === 'render' && v) setOutView(v); if (s === 'start' && v) setStartView(v);
    setStep(s); localStorage.setItem('studio.step', s);
    // a #menu= link stays while you are on the step that owns its layer
    const m = hashMenu(); if (!m || menuStep(m, catRef.current && catRef.current.layers) !== s) history.replaceState(null, '', '#step=' + (v === 'post' || v === 'highlights' ? v : s));
    if (focus) requestAnimationFrame(() => { window.scrollTo({ top: 0 }); const h = document.querySelector('main .step:not([hidden]) h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } });
  }, [setArea, setOutView]);
  // open a layer: the step that owns it comes up with that layer showing
  const pickTab = useCallback(id => { const layers = catRef.current && catRef.current.layers, l = layerOf(id, layers) || id, st = menuStep(l, layers);
    setTab(l); setArea('new', false); setBuild(null); setStep(st); localStorage.setItem('studio.step', st); history.replaceState(null, '', '#menu=' + l); }, [setArea]);
  // the looks saved from earlier references (GET /api/style-looks); null when this server does not have them
  const reloadLooks = useCallback(() => quiet('/api/style-looks').then(j => { setLooksList(j && Array.isArray(j.looks) ? j.looks : null); }), []);

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
    const onHash = () => { if (/wizards/.test(location.hash) && !buildOf()) history.replaceState(null, '', '#build=start'); const b = buildOf(); if (b) { setBuild(b); setArea('new', false); return; } if (!location.hash || location.hash === '#' || hashArea() === 'new') setBuild(null); const a = hashArea(), m = hashMenu(), st = hashStep(); if (a && a !== 'new') setArea(a, false); else if (m) pickTab(m); else if (st && STEPS.includes(stepOf(st))) go(st, true); else if (a) setArea(a, false); };
    // "/" searches every option: from Picture or Text and graphics it stays there, from anywhere else it opens Picture
    const onKey = e => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); if (!document.getElementById('filter')) go('picture'); setTimeout(() => document.getElementById('filter')?.focus(), 30); }
    };
    addEventListener('hashchange', onHash); document.addEventListener('keydown', onKey);
    return () => { es && es.close(); removeEventListener('hashchange', onHash); document.removeEventListener('keydown', onKey); };
  }, [apply, go, pickTab, reloadLooks, setArea]);
  // an old tab name in a link (#menu=captions) is a group inside a layer: once the catalog is in, open the step that holds it
  useEffect(() => { const m = hashMenu(); if (CAT && m) { const st = menuStep(m, CAT.layers); if (st !== step) pickTab(m); } }, [!!CAT]);
  // the saved looks are asked for only when they can matter: the server knows them (the state has styleLook), the
  // reference is on Copy the look, or you pick Copy the look on Start. An older server is never asked on a page load
  const wantLooks = !!V && (V.state.styleLook !== undefined || V.state.reference.mode === 'look');
  useEffect(() => { if (wantLooks) reloadLooks(); }, [wantLooks, reloadLooks]);
  const run = useRun(V || { compose: {} }, V ? V.state : { footage: [] }, log, setLog);

  if (!CAT || !V) return <Theme theme={aigentTheme} mode={theme}><div className="boot" role="status"><span className="spin" aria-hidden="true" />Loading Studio</div><StudioOffline onBack={() => location.reload()} /><Toast /></Theme>;

  const s = V.state, t = V.task, running = t && t.status === 'running';
  const pickedIn = st => (STEP_LAYERS[st] || []).some(id => { const l = (CAT.layers || []).find(x => x.id === id); return !!l && l.items.some(r => CAT.items[r] && pickState(s, CAT.items[r])); });
  const refOn = !!(s.reference.extracted && s.reference.mode !== 'off'), drafted = !!(V.edit && V.edit.drafted);
  const done = { start: !!(s.footage.length || s.clips), cut: !!(V.cut && V.cut.candidates && V.cut.candidates.length), picture: !!(s.pack || refOn || s.styleLook || pickedIn('picture')), text: pickedIn('text'),
    broll: !!(V.broll && V.broll.beats && V.broll.beats.some(b => b.slot)), music: s.music.bed !== 'auto' || s.sound.sfx === 'off' || pickedIn('music'), review: drafted, render: !!(V.currentOutputs || []).length };
  const looks = { on: looksList !== null, list: looksList || [], reload: reloadLooks,
    save: name => quiet('/api/style-looks/save', { name }).then(j => { if (!j) return false; if (Array.isArray(j.looks)) setLooksList(j.looks); else reloadLooks(); return true; }),
    pick: name => quiet('/api/state', { styleLook: name }).then(j => { if (j) apply(j); else toast('We could not switch the saved look.'); }) };
  const i = STEPS.indexOf(step);
  const openConnect = () => { setSettingsOpen(false); setChatOpen(false); setConnectOpen(true); };
  const openSetup = () => { setSettingsOpen(false); setSetupOpen(true); };
  const openKeys = () => { setSettingsOpen(false); setKeysOpen(true); };
  const openChat = () => setChatOpen(true);
  const openOutputs = () => setOutputsOpen(true), openNewVideo = () => setVideoMode('new'), openVault = beat => setVault({ beat: typeof beat === 'number' ? beat : null });
  const openRecording = () => setArea('recording');
  const ctx = { CAT, V, s, apply, patch, go, reloadCat, setLog, log, openConnect, openSetup, openKeys, openChat, openOutputs, openNewVideo, openVault, looks, openRecording };
  const building = area === 'new' && !!build;
  const onNew = area === 'new' && !building, post = onNew && step === 'render' && outView === 'post';
  const env = V.env, a = env.agent || {}, agentState = env.backend !== 'agent' ? 'alt' : a.listening ? 'on' : a.connected ? 'busy' : 'off';
  const pill = !t ? 'Ready' : running ? `${cap1(t.kind)} running` : t.status === 'failed' ? `${cap1(t.kind)} failed` : `${cap1(t.kind)} ${t.status}`;

  return (
    <Theme theme={aigentTheme} mode={theme}>
      <a className="skip" href="#main">Skip to the editor</a>
      <div className="ambient" aria-hidden="true" />
      <header className="top glass">
        <div className="brand"><img className="wm wm-dark" src={wordmarkDark} alt="AIgent" width="127" height="59" /><img className="wm wm-light" src={wordmarkLight} alt="AIgent" width="127" height="59" /><span className="bname">Studio</span></div>
        <div className="jobrow"><JobName s={s} patch={patch} /><IconBtn id="new-video-open" n="plus" className="nv-btn" label="New video" aria-haspopup="dialog" onClick={() => setVideoMode('new')} /></div>
        <TabGroup as="nav" className="areas" id="areas" aria-label="Studio" selectedIndex={AREA_IDS.indexOf(area)} onChange={k => setArea(AREA_IDS[k])}>
          <TabList className="seg areas-list">{AREAS.map(([a, label, icon]) => <Tab key={a} id={'tab-' + a} data-area={a} title={label} aria-label={label}><Icon n={icon} /><span className="al">{label}</span></Tab>)}</TabList>
        </TabGroup>
        <div className="topr">
          {recLive && area !== 'recording' && <button type="button" className="rec-pill" id="rec-pill" onClick={() => setArea('recording')} aria-label="Recording, go back to the recorder"><i aria-hidden="true" />{recLive.phase === 'paused' ? 'Paused' : recLive.phase === 'saving' ? 'Saving take' : 'Recording'}</button>}
          {env.setup && !env.setup.ready && (() => { const nm = Object.values(env.setup.missing).filter(x => x.need === 'core').length; return <button type="button" className="setup-pill" id="setup-pill" onClick={openSetup} aria-label={`${nm} to fix, open Setup check`} title="Setup check"><Icon n="ban" /><span className="sp-n">{nm}</span><span className="sp-l"> to fix</span></button>; })()}
          <button type="button" className={'connect-btn ' + agentState} id="connect-open" aria-haspopup="dialog" onClick={openConnect} title={agentState === 'on' ? `${a.name} connected` : 'Connect your agent'}><Icon n="plug" /><span className="cb-l">{agentState === 'on' || agentState === 'busy' ? (a.name || 'Agent') : 'Connect agent'}</span></button>
          <button type="button" className="connect-btn vault-btn" id="open-vault" aria-label="Vault" aria-haspopup="dialog" onClick={openVault} title="Everything you can show, in one place"><Icon n="grid" /><span className="cb-l">Vault</span></button>
          <span id="taskpill" role="status" aria-live="polite" className={t ? '' : 'idle'}>{t ? <Badge label={pill} variant={running ? 'cyan' : t.status === 'failed' ? 'error' : 'neutral'} /> : <span className="sr">{pill}</span>}</span>
          <button type="button" className="icon-btn theme-btn" id="theme" data-mode={theme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon n="moon" className="tm-moon" /><Icon n="sun" className="tm-sun" /></button>
          <button className={'icon-btn fab' + (chatAway ? ' away' : '')} id="chat-open" type="button" aria-controls="chat" aria-expanded={String(chatOpen || (!chatAway && matchMedia('(min-width: 901px)').matches))} title="Open chat" aria-label="Open chat" onClick={() => setChatOpen(true)}><Icon n="chat" /><span className={'dot ' + agentState} id="fab-dot" aria-hidden="true" /></button>
          <IconBtn id="open-settings" n="sliders" label="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)} />
          <MoreMenu id="more-open" label="More" items={[
            { id: 'more-open-video', label: 'Past videos', icon: 'film', onClick: () => setVideoMode('open') },
            { id: 'more-setup', label: 'Setup check', icon: 'check', onClick: openSetup },
            { id: 'more-keys', label: 'API keys', icon: 'link', onClick: openKeys },
            { id: 'more-outputs', label: 'Outputs', hint: 'Every render', icon: 'film', onClick: () => setOutputsOpen(true) },
            narrow && { id: 'more-theme', label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'sun' : 'moon', onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
          ]} />
        </div>
      </header>
      <div className={'layout' + (chatAway ? ' nochat' : '')}>
        <main id="main" data-area={area} data-build={building ? build : undefined} data-step={step} data-view={step === 'render' ? outView : step === 'start' ? startView : 'main'} ref={mainRef}>
          {onNew && <div className="stepbar"><nav className="stepper" aria-label="Steps"><ol id="stepper">
          {STEPS.map((st, k) => <li key={st} className={done[st] ? 'done' : ''}>
            <button type="button" data-step={st} aria-current={st === step ? 'step' : 'false'} title={stepName(st)} aria-label={`${k + 1}. ${stepName(st)}${done[st] && st !== step ? ', done' : ''}`} onClick={() => go(st, true)}>
              <span className="sn">{done[st] && st !== step ? <Icon n="check" /> : k + 1}</span><span className="sl">{stepShort(st)}</span>
            </button></li>)}
          </ol></nav></div>}
          <Recording key={'r' + (s.videoSeq || 0)} {...ctx} hidden={area !== 'recording'} onLive={setRecLive} toNew={() => setArea('new')} />
          {area === 'teardowns' && <Teardowns {...ctx} />}
          {building && <Builder key={'b' + (s.videoSeq || 0)} {...ctx} page={build} setPage={setBuild} />}
          {onNew && <>
          {!post && step !== 'start' && <YourEdit V={V} s={s} go={go} step={step} />}
          {step === 'render' && <ViewSwitch id="render-switch" label="Render" value={outView} set={v => { setOutView(v); history.replaceState(null, '', '#step=' + (v === 'post' ? 'post' : 'render')); }} views={[['main', 'Render', 'render-sub-main'], ['post', 'Post', 'render-sub-post']]} />}
          {/* a new or opened video remounts the steps, so no step keeps the last board's local picks */}
          <Fragment key={'v' + (s.videoSeq || 0)}>
          {step === 'start' && V.highlights && V.highlights.offer && <ViewSwitch id="start-switch" label="Start" value={startView} set={v => { setStartView(v); history.replaceState(null, '', '#step=' + (v === 'highlights' ? 'highlights' : 'start')); }} views={[['main', 'Start', 'start-sub-main'], ['highlights', 'Highlights', 'start-sub-highlights', !!(V.highlights.candidates && V.highlights.candidates.length)]]} />}
          <Footage {...ctx} hidden={step !== 'start' || startView === 'highlights'} />
          <Highlights {...ctx} hidden={step !== 'start' || startView !== 'highlights'} />
          {step === 'cut' && <Cut {...ctx} />}
          {step === 'picture' && <Picture {...ctx} tab={tab} setTab={pickTab} />}
          {step === 'text' && <TextStep {...ctx} tab={tab} setTab={pickTab} />}
          {step === 'broll' && <BRoll {...ctx} />}
          {step === 'broll' && <BrollLayer {...ctx} tab={tab} setTab={pickTab} />}
          {step === 'music' && <Music {...ctx} tab={tab} setTab={pickTab} />}
          <ReviewStep {...ctx} run={run} hidden={step !== 'review'} />
          <Render {...ctx} run={run} hidden={step !== 'render' || post} toPost={() => go('post', true)} />
          {post && <Post {...ctx} />}
          {(step === 'review' || (step === 'render' && !post)) && <RunFoot V={V} s={s} log={log} />}
          </Fragment>
          <footer className="stepnav glass" id="stepnav">
            <span style={{ visibility: i ? 'visible' : 'hidden' }}><Button id="prev" variant="ghost" label="Back" icon={<Icon n="left" />} onClick={() => go(STEPS[Math.max(0, i - 1)], true)} /></span>
            <PicksTray step={step} s={s} patch={patch} cat={CAT} added={(V.look && V.look.added) || []} openLayer={pickTab} />
            <AskAgent step={post ? 'post' : step} apply={apply} openChat={openChat} />
            {i < STEPS.length - 1 ? <Button id="next" variant={step === 'review' && !drafted ? 'secondary' : 'primary'} label={stepName(STEPS[i + 1])} endContent={<Icon n="right" />} onClick={() => go(STEPS[i + 1], true)} /> : <span className="nextpad" />}
          </footer>
          </>}
        </main>
        <Chat key={s.videoSeq || 0} {...ctx} open={chatOpen} setOpen={setChatOpen} close={closeChat} agentState={agentState} />
      </div>
      <Settings {...ctx} open={settingsOpen} setOpen={setSettingsOpen} theme={theme} setTheme={setTheme} glass={glass} setGlass={setGlass} />
      <Connect {...ctx} open={connectOpen} setOpen={setConnectOpen} />
      <SetupCheck {...ctx} open={setupOpen} setOpen={setSetupOpen} />
      <Keys {...ctx} open={keysOpen} setOpen={setKeysOpen} />
      <NewVideo {...ctx} mode={videoMode} setMode={setVideoMode} />
      <Outputs {...ctx} open={outputsOpen} setOpen={setOutputsOpen} />
      <Vault at={vault} close={() => setVault(null)} apply={apply} />
      <StudioOffline onBack={apply} prompt={V.env.restart} />
      <Toast V={V} />
    </Theme>
  );
}

// A step with two views (Start and Highlights; Render and Post): one small switch above the step
function ViewSwitch({ id, label, value, set, views }) {
  return <div className="look-switch" id={id}><div className="seg" role="radiogroup" aria-label={label}>
    {views.map(([v, l, bid, mark]) => <button key={v} type="button" role="radio" id={bid} aria-checked={value === v} onClick={() => set(v)}>{l}{mark ? <span className="dotmark" aria-label=", in use" /> : null}</button>)}
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
