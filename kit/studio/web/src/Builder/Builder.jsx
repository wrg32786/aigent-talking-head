import { useEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { api } from '../lib.jsx';
import { Start } from './Start.jsx';
import { StepFrame } from './StepFrame.jsx';
import { SectionBar } from './SectionBar.jsx';
import { Pacing } from './steps/Pacing.jsx';
import { CaptionType, TYPE_SAYS } from './steps/CaptionType.jsx';
import { CaptionLook } from './steps/CaptionLook.jsx';
import { WordsIn } from './steps/WordsIn.jsx';
import { Titles } from './steps/Titles.jsx';
import { Place } from './steps/Place.jsx';
import { Colors } from './steps/Colors.jsx';
import { Fonts } from './steps/Fonts.jsx';
import { KeyWords, KEY_SAYS } from './steps/KeyWords.jsx';
import { WordsPreview } from './steps/WordsPreview.jsx';
import { WithPreview, mergeWords } from './steps/WithPreview.jsx';

// The step by step builder on New video (#build=start, #build=<step>). A choice is saved with POST /api/video-plan
// { pace } or { words }: the server reads the plan from the session as it is right then and changes only the picks
// that choice moves, so a choice made on a classic step, in the chat or by an agent is never written over. Past the
// last built step you carry on in the classic steps.
const STEPS = { pace: null, captionType: CaptionType, captionLook: CaptionLook, wordsIn: WordsIn, titles: Titles, place: Place, colors: Colors, fonts: Fonts, keyWords: KeyWords, wordsPreview: WordsPreview };
export const BUILT = Object.keys(STEPS);   // builder steps with their own screen so far
const READY = ['pace', 'words'];          // sections that can be opened
const LIVE = ['captionLook', 'wordsIn', 'titles', 'place', 'colors', 'fonts', 'keyWords']; // steps with the live preview beside them
export const buildOf = () => { const m = location.hash.match(/build=([A-Za-z]+)/); return m ? m[1] : null; };
const s = stylex.create({ wrap: { display: 'grid', gap: 12 } });
// steps.json onlyIf: "words.type == kinetic"
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export const shows = (step, plan) => { if (!step.onlyIf) return true; const m = step.onlyIf.match(/^([\w.]+)\s*(==|!=)\s*(\w+)$/); if (!m) return true; const v = String(get(plan, m[1])); return m[2] === '==' ? v === m[3] : v !== m[3]; };
const behindOf = plan => plan.presenter.some(x => x.id === 'behind-head');

export function Builder({ s: st, CAT, apply, go, page, setPage }) {
  const [steps, setSteps] = useState(null), [view, setView] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [hover, setHover] = useState(null), [saveErr, setSaveErr] = useState('');
  const ask = useRef(0), head = useRef(null), startHead = useRef(null), moved = useRef(false);
  const known = page === 'start' || BUILT.includes(page);
  useEffect(() => { api('/api/wizard/steps').then(setSteps).catch(e => setErr(e.message)); }, []);
  // read the plan again whenever the session changes anywhere; an older reply never replaces a newer one
  useEffect(() => { const k = ++ask.current; api('/api/video-plan').then(v => { if (k === ask.current) { setView(v); setErr(''); } }).catch(e => { if (k === ask.current) setErr(e.message); }); }, [st.rev, st.videoSeq]);
  // a link to a step that has no screen yet starts at the beginning
  useEffect(() => { if (!known) { history.replaceState(null, '', '#build=start'); setPage('start'); } }, [known, setPage]);
  useEffect(() => { setHover(null); }, [page]);
  // focus the new screen's heading after a move inside the builder, not on first load
  useEffect(() => { if (!moved.current) return; window.scrollTo({ top: 0 }); const h = page === 'start' ? startHead.current : head.current; if (h) h.focus({ preventScroll: true }); }, [page, !!view]);
  const open = p => { moved.current = true; setPage(p); history.replaceState(null, '', '#build=' + p); };
  // A choice shows at once; choices made while one is saving wait in a queue (choices of the same kind merge, so only
  // the latest of each is sent) and are sent in order. Returns when the queue is empty.
  const [shown, setShown] = useState(null), queue = useRef([]), drain = useRef(null);
  const kindOf = b => ('pace' in b ? 'pace' : 'words');
  const send = body => {
    const q = queue.current, last = q[q.length - 1];
    if (last && kindOf(last) === kindOf(body)) q[q.length - 1] = 'pace' in body ? body : { words: mergeWords(last.words, body.words) }; else q.push(body);
    setShown(sh => ({ ...(sh || {}), ...('pace' in body ? { pace: body.pace } : { words: mergeWords((sh && sh.words) || {}, body.words) }) }));
    if (drain.current) return drain.current;
    setBusy(true);
    return (drain.current = (async () => {
      // a refused choice says why and keeps you on the screen (resolves false); the plan shown is the saved one
      let ok = true;
      try { while (queue.current.length) { const b = queue.current.shift(), k = ++ask.current; try { const v = await api('/api/video-plan', b); if (k === ask.current) setView(v); apply(v); setSaveErr(''); } catch (e) { ok = false; setSaveErr(e.message || 'it did not save'); } } }
      finally { drain.current = null; setBusy(false); setShown(null); }
      return ok;
    })());
  };
  if (!known) return null;
  if (page === 'start') return <Start s={st} apply={apply} onBuild={() => open('pace')} headRef={startHead} />;
  if (err && !view) return <p className="fine" role="alert">The builder could not load: {err}</p>;
  if (!steps || !view) return <p className="fine" role="status">Loading the builder</p>;
  const plan = view.plan, w = mergeWords(plan.words, shown && shown.words), pace = (shown && shown.pace) || plan.pace;
  const step = steps.steps.find(x => x.id === page) || steps.steps[0], sec = steps.sections.find(x => x.id === step.section);
  const now = { ...plan, words: w }; // the plan with choices still saving
  const visible = steps.steps.filter(x => BUILT.includes(x.id) && shows(x, now)), at = visible.indexOf(step);
  const inSec = steps.steps.filter(x => x.section === step.section && shows(x, now)), k = inSec.indexOf(step) + 1;
  // a step its condition hides (Key words after switching to Just captions) moves on to the next one that shows
  if (at < 0) { const after = steps.steps.slice(steps.steps.indexOf(step)).find(x => visible.includes(x)); if (after) queueMicrotask(() => open(after.id)); return null; }
  const toClassic = () => { history.replaceState(null, '', '#step=picture'); setPage(null); go('picture', true); };
  const nextStep = visible[at + 1], prevStep = visible[at - 1];
  const P = view.paces[pace], rows = view.summary || [];
  const does = step.id === 'pace' ? (P ? P.says : '') : step.id === 'captionType' ? TYPE_SAYS[w.type] || '' : step.id === 'keyWords' ? KEY_SAYS[w.keyWords.level] || ''
    : step.id === 'wordsPreview' ? '' : (rows.find(r => r.step === 'captionType') || {}).text || '';
  const pending = (view.pending || []).filter(x => x.field.startsWith(step.id === 'place' ? 'words.place' : step.id === 'colors' ? 'words.colors' : step.id === 'keyWords' ? 'words.keyWords' : '\u0000'));
  const Body = STEPS[step.id], props = { CAT, step, words: w, save: words => send({ words }), busy: false, setHover };
  const body = step.id === 'pace' ? <Pacing paces={view.paces} value={pace} onPick={p => send({ pace: p })} />
    : step.id === 'wordsPreview' ? <WordsPreview words={w} behind={behindOf(plan)} summary={(rows.find(r => r.step === 'captionType') || {}).text || ''} />
    : LIVE.includes(step.id) ? <WithPreview words={w} hover={hover} behind={behindOf(plan)}><Body {...props} /></WithPreview> : <Body {...props} />;
  const lock = step.lock, next = lock ? () => send({ words: {} }).then(ok => { if (ok) (nextStep ? open(nextStep.id) : toClassic()); }) : nextStep ? () => open(nextStep.id) : toClassic;
  const doneSecs = [...(plan.touched.includes('pace') ? ['pace'] : []), ...(plan.touched.includes('words') ? ['words'] : [])];
  return <div id="builder" {...stylex.props(s.wrap)}>
    <SectionBar sections={steps.sections} current={step.section} done={doneSecs} ready={READY} onOpen={id => open(visible.find(x => x.section === id).id)} />
    <StepFrame step={step} count={`${sec.label}, ${k} of ${inSec.length}`} does={does} back={() => open(prevStep ? prevStep.id : 'start')} headRef={head} face={step.id === 'place'}
      next={next} nextDisabled={busy || (step.id === 'captionType' && !w.type)} nextLabel={lock ? 'Lock and continue' : nextStep ? 'Next' : 'Continue in the classic steps'}>
      {body}
      {saveErr && <p className="fine" role="alert" id="build-save-err">We could not save that choice: {saveErr}</p>}
      {pending.length > 0 && <p className="fine" id="build-step-soon">Shows in the preview now. Coming soon in your rendered video: {pending.map(x => x.text).join(', ')}.</p>}
    </StepFrame>
    {view.pending && view.pending.length > 0 && <p className="fine" id="build-pending">Coming soon, kept in your plan for later: {view.pending.map(x => x.text).join(', ')}.</p>}
  </div>;
}
