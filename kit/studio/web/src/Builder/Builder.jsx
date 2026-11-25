import { useEffect, useState } from 'react';
import { api } from '../lib.jsx';
import * as VP from '../../../wizard/plan.mjs';
import { Start } from './Start.jsx';
import { StepFrame } from './StepFrame.jsx';
import { SectionBar } from './SectionBar.jsx';
import { Pacing } from './steps/Pacing.jsx';

// The step by step builder on New video (#build=start, #build=pace). Every choice is saved through POST /api/video-plan,
// and the server turns the plan into today's picks, so a draft from the classic steps works at every point. Steps that
// are not built yet hand over to the classic steps.
export const BUILT = ['pace'];        // builder steps with their own screen so far
const READY = ['pace'];               // sections that can be opened
export const buildOf = () => { const m = location.hash.match(/build=([a-z]+)/); return m ? m[1] : null; };

export function Builder({ s, apply, go, page, setPage }) {
  const [steps, setSteps] = useState(null), [view, setView] = useState(null), [err, setErr] = useState('');
  useEffect(() => { api('/api/wizard/steps').then(setSteps).catch(e => setErr(e.message)); }, []);
  useEffect(() => { api('/api/video-plan').then(setView).catch(e => setErr(e.message)); }, [s.videoSeq]);
  const open = p => { setPage(p); history.replaceState(null, '', '#build=' + p); requestAnimationFrame(() => { window.scrollTo({ top: 0 }); const h = document.querySelector('#main h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }); };
  const save = async plan => { try { const v = await api('/api/video-plan', { plan }); setView(v); apply(v); } catch {} };
  if (page === 'start') return <Start s={s} apply={apply} onBuild={() => open('pace')} />;
  if (err) return <p className="fine" role="alert">The builder could not load: {err}</p>;
  if (!steps || !view) return <p className="fine" role="status">Loading the builder</p>;
  const step = steps.steps.find(x => x.id === page) || steps.steps[0], sec = steps.sections.find(x => x.id === step.section);
  const inSec = steps.steps.filter(x => x.section === step.section), k = inSec.indexOf(step) + 1;
  const plan = view.plan, P = view.paces[plan.pace];
  // past the last built step: carry on in the classic steps, the plan stays as set
  const toClassic = () => { history.replaceState(null, '', '#step=picture'); setPage(null); go('picture', true); };
  return <div id="builder">
    <SectionBar sections={steps.sections} current={step.section} done={plan.touched.includes('pace') ? ['pace'] : []} ready={READY} onOpen={id => open(steps.steps.find(x => x.section === id).id)} />
    <StepFrame step={step} count={`${sec.label}, ${k} of ${inSec.length}`} does={P ? P.says : ''} back={() => open('start')}
      next={toClassic} nextLabel="Continue in the classic steps">
      {step.id === 'pace' && <Pacing paces={view.paces} value={plan.pace} onPick={id => save(VP.touch(VP.applyPace(plan, id), 'pace'))} />}
    </StepFrame>
    {view.pending && view.pending.length > 0 && <p className="fine" id="build-pending">Coming soon, kept in your plan for later: {view.pending.map(x => x.text).join(', ')}.</p>}
  </div>;
}
