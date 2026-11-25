// Ask my agent (1.17.0) sits in the step footer on every step: a few prompts for that step, or your own words, sent
// through the Studio chat with the step attached (POST /api/chat { text, step }). The Wizards dialog is gone (Phase 7):
// New video's builder asks one thing per screen, and MCP run_wizard maps a goal onto its plan.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, toast, Icon } from './lib.jsx';

export const ASKS = {
  start: ['Which take is best?', 'Is my audio clean enough?'],
  cut: ['Pick the strongest hook', 'Drop the weak lines', 'Make a 15 s ad from this too'],
  picture: ['Make it calmer', 'Make it punchier', 'Match my brand colors'],
  text: ['Make the captions easier to read', 'Use fewer graphics'],
  broll: ['Suggest b-roll for the proof lines', 'Use fewer cards'],
  music: ['Pick music that fits my voice', 'Use fewer sounds'],
  review: ['Check the draft for me', 'Why was this line cut?'],
  render: ['Is this ready to post?', 'What would you change in the next version?'],
  post: ['Write the caption', 'Which channels fit this one?'],
};

export async function askAgent(text, step, apply, openChat) {
  const j = await api('/api/chat', { text, step }); apply(j); openChat && openChat();
  toast('Sent to your agent', true); return j;
}

export function AskAgent({ step, apply, openChat }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false), box = useRef(null);
  useEffect(() => { if (!open) return; const off = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; const esc = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc); setTimeout(() => document.getElementById('ask-text')?.focus(), 0);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); }; }, [open]);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 640px)').matches);
  useEffect(() => { const q = matchMedia('(max-width: 640px)'), f = () => setNarrow(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, []);
  const send = async t => { if (!t.trim()) return; setBusy(true); try { await askAgent(t.trim(), step, apply, openChat); setOpen(false); setText(''); } catch {} finally { setBusy(false); } };
  return <div className="ask" ref={box}>
    <Button id="ask-agent" variant="ghost" size="sm" label={narrow ? 'Ask' : 'Ask my agent'} aria-label="Ask my agent" icon={<Icon n="spark" />} aria-expanded={open ? 'true' : 'false'} aria-controls="ask-pop" onClick={() => setOpen(!open)} />
    {open && <div className="ask-pop" id="ask-pop" role="dialog" aria-label="Ask my agent">
      <ul className="ask-chips" id="ask-chips">{(ASKS[step] || []).map(q => <li key={q}><button type="button" className="chip" disabled={busy} onClick={() => send(q)}>{q}</button></li>)}</ul>
      <form onSubmit={e => { e.preventDefault(); send(text); }} className="ask-own">
        <label className="sr" htmlFor="ask-text">Ask about this step</label>
        <input id="ask-text" value={text} onChange={e => setText(e.target.value)} placeholder="Or ask in your own words" />
        <Button id="ask-send" type="submit" variant="primary" size="sm" label="Send" isLoading={busy} />
      </form>
      <p className="fine">It goes to the chat with this step attached. Changes it suggests come with Apply.</p>
    </div>}
  </div>;
}
