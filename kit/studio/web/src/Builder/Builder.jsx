import { useEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { api } from '../lib.jsx';
import { Start } from './Start.jsx';
import { StepFrame } from './StepFrame.jsx';
import { SectionBar } from './SectionBar.jsx';
import { Pacing } from './steps/Pacing.jsx';

// The step by step builder on New video (#build=start, #build=pace). A pace is saved with POST /api/video-plan { pace }:
// the server reads the plan from the session as it is right then and changes only what a pace sets, so a choice made
// on a classic step, in the chat or by an agent is never written over. Steps that are not built yet hand over to the
// classic steps.
export const BUILT = ['pace'];        // builder steps with their own screen so far
const READY = ['pace'];               // sections that can be opened
export const buildOf = () => { const m = location.hash.match(/build=([A-Za-z]+)/); return m ? m[1] : null; };
const s = stylex.create({ wrap: { display: 'grid', gap: 12 } });

export function Builder({ s: st, apply, go, page, setPage }) {
  const [steps, setSteps] = useState(null), [view, setView] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const ask = useRef(0), head = useRef(null), startHead = useRef(null), moved = useRef(false);
  const known = page === 'start' || BUILT.includes(page);
  useEffect(() => { api('/api/wizard/steps').then(setSteps).catch(e => setErr(e.message)); }, []);
  // read the plan again whenever the session changes anywhere; an older reply never replaces a newer one
  useEffect(() => { const k = ++ask.current; api('/api/video-plan').then(v => { if (k === ask.current) setView(v); }).catch(e => setErr(e.message)); }, [st.rev, st.videoSeq]);
  // a link to a step that has no screen yet starts at the beginning
  useEffect(() => { if (!known) { history.replaceState(null, '', '#build=start'); setPage('start'); } }, [known, setPage]);
  // focus the new screen's heading after Build my own, Back or a section, not on first load
  useEffect(() => { if (!moved.current) return; window.scrollTo({ top: 0 }); const h = page === 'start' ? startHead.current : head.current; if (h) h.focus({ preventScroll: true }); }, [page, !!view]);
  const open = p => { moved.current = true; setPage(p); history.replaceState(null, '', '#build=' + p); };
  const pick = async pace => {
    if (busy) return; setBusy(true); const k = ++ask.current;
    try { const v = await api('/api/video-plan', { pace }); if (k === ask.current) setView(v); apply(v); } catch {} finally { setBusy(false); }
  };
  if (!known) return null;
  if (page === 'start') return <Start s={st} apply={apply} onBuild={() => open('pace')} headRef={startHead} />;
  if (err) return <p className="fine" role="alert">The builder could not load: {err}</p>;
  if (!steps || !view) return <p className="fine" role="status">Loading the builder</p>;
  const step = steps.steps.find(x => x.id === page) || steps.steps[0], sec = steps.sections.find(x => x.id === step.section);
  const inSec = steps.steps.filter(x => x.section === step.section), k = inSec.indexOf(step) + 1;
  const plan = view.plan, P = view.paces[plan.pace];
  // past the last built step: carry on in the classic steps, the plan stays as set
  const toClassic = () => { history.replaceState(null, '', '#step=picture'); setPage(null); go('picture', true); };
  return <div id="builder" {...stylex.props(s.wrap)}>
    <SectionBar sections={steps.sections} current={step.section} done={plan.touched.includes('pace') ? ['pace'] : []} ready={READY} onOpen={id => open(steps.steps.find(x => x.section === id).id)} />
    <StepFrame step={step} count={`${sec.label}, ${k} of ${inSec.length}`} does={P ? P.says : ''} back={() => open('start')} headRef={head}
      next={toClassic} nextLabel="Continue in the classic steps">
      {step.id === 'pace' && <Pacing paces={view.paces} value={plan.pace} onPick={pick} busy={busy} />}
    </StepFrame>
    {view.pending && view.pending.length > 0 && <p className="fine" id="build-pending">Coming soon, kept in your plan for later: {view.pending.map(x => x.text).join(', ')}.</p>}
  </div>;
}
