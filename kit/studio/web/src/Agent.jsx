// Ask my agent and the wizards (1.17.0). Ask my agent sits in the step footer on every step: a few prompts for that
// step, or your own words, sent through the Studio chat with the step attached (POST /api/chat { text, step }).
// The wizards are three short guided starts; each step has Let my agent decide, which hands the rest to the chat.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, file, toast, onOffline, Icon, IconBtn } from './lib.jsx';

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

// ---------- wizards ----------
// the wizards, their goals and clip counts come from the server (kit/studio/wizards.mjs), so MCP run_wizard matches
const WIZ_ORDER = ['reel', 'reference', 'clips'];

export function Wizards({ CAT, V, s, apply, patch, go, open, setOpen, openChat }) {
  const ref = useRef(null), [w, setW] = useState(null), [n, setN] = useState(0), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [url, setUrl] = useState(''), [clips, setClips] = useState(5), [ads, setAds] = useState(false), [goal, setGoal] = useState(null), [W, setWdef] = useState(null);
  // the wizards load from the server; if Studio was stopped, Try again (or Studio coming back) loads them
  const [tries, setTries] = useState(0);
  useEffect(() => onOffline(v => { if (!v) setTries(k => k + 1); }), []);
  useEffect(() => { if (open && !W) api('/api/wizard').then(j => { setWdef(j); setErr(''); }).catch(e => setErr(e.message)); }, [open, tries]);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) { d.showModal(); setW(null); setN(0); setErr(''); } if (!open && d.open) d.close(); }, [open]);
  const close = () => setOpen(false);
  const run = async f => { setBusy(true); setErr(''); try { return await f(); } catch (e) { setErr(e.message); return null; } finally { setBusy(false); } };
  const agent = text => run(async () => { await askAgent(text, null, apply, openChat); close(); });
  const looks = CAT.packs.filter(p => !/^ref-/.test(p.name)).slice(0, 8);
  // one wizard step on the server; the last one closes the wizard and opens the step it says comes next
  const step = (body, last) => run(async () => { const j = await api('/api/wizard', body); apply(j); const z = j.wizard || {};
    if (last || z.pending) { close(); if (z.next && z.next !== 'choose' && z.next !== 'look' && z.next !== 'picture') go(z.next, true); if (z.note) toast(z.note, true); } return j; });
  const deciders = { reel: ['Pick the goal for this take and set the output.', 'Pick a Look that fits this take.', 'Choose the lines for my clip.'], reference: ['Find a reference reel that fits what I am making.'], clips: ['Pick the best clips from this take, and say if ad cuts make sense.'] };
  const Decide = ({ k }) => <Button className="wz-agent" variant="ghost" size="sm" label="Let my agent decide" icon={<Icon n="spark" />} isDisabled={busy} onClick={() => agent(deciders[w][k] || deciders[w][0])} />;
  const body = () => {
    if (!W) return err ? <div className="row"><Button id="wz-retry" variant="ghost" size="sm" label="Try again" onClick={() => { setErr(''); setTries(k => k + 1); }} /></div> : <p className="fine">Loading</p>;
    if (!w) return <ul className="wz-list" id="wz-list">{WIZ_ORDER.map(id => <li key={id}><button type="button" className="wz-pick glass-card" data-wizard={id} onClick={() => { setW(id); setN(0); setErr(''); }}><b>{W.wizards[id].title}</b><span className="fine">{W.wizards[id].sub}</span><Icon n="right" /></button></li>)}</ul>;
    if (w === 'reel') {
      if (n === 0) return <><h3 className="wz-q">What is this reel for?</h3>
        <div className="wz-opts" role="radiogroup" aria-label="Goal">{Object.entries(W.goals).map(([id, g]) => <button key={id} type="button" role="radio" className="wz-opt" data-goal={id} aria-checked={goal === id ? 'true' : 'false'} disabled={busy}
          onClick={() => { setGoal(id); step({ wizard: 'reel', goal: id }).then(j => j && setN(1)); }}><b>{g.label}</b><span className="fine">{g.sub}</span></button>)}</div><Decide k={0} /></>;
      if (n === 1) return <><h3 className="wz-q">Pick a Look</h3>
        <div className="wz-looks" role="radiogroup" aria-label="Look">{looks.map(p => <button key={p.name} type="button" role="radio" className="wz-look" data-look={p.name} aria-checked={s.pack === p.name ? 'true' : 'false'} disabled={busy}
          onClick={() => step({ wizard: 'reel', look: p.name }).then(j => j && setN(2))}>{p.preview ? <img src={file(p.preview)} alt="" width={64} height={114} loading="lazy" /> : <span className="ph" />}<b>{p.name}</b></button>)}</div>
        <div className="row"><Button variant="ghost" size="sm" label="Keep my Look" onClick={() => setN(2)} /><Decide k={1} /></div></>;
      return <><h3 className="wz-q">Let AI choose the lines</h3><p className="fine">It picks a hook first and the call to action last, on whole words, to fit the length. You check the draft on Review.</p>
        <div className="row"><Button id="wz-choose" variant="primary" label="Let AI choose" isLoading={busy} onClick={() => step({ wizard: 'reel', choose: true }, true)} /><Decide k={2} /></div></>;
    }
    if (w === 'reference') return <><h3 className="wz-q">Paste a reel you like</h3><p className="fine">A link from Instagram, TikTok, YouTube or a file link. Studio reads its titles, colors, cuts and sound.</p>
      <form className="wz-url" onSubmit={e => { e.preventDefault(); if (!url.trim()) { setErr('Paste a link first.'); return; } step({ wizard: 'reference', url: url.trim() }, true); }}>
        <label className="sr" htmlFor="wz-url-in">Reference link</label><input id="wz-url-in" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/..." />
        <Button id="wz-ref-go" type="submit" variant="primary" size="sm" label="Add this video" isLoading={busy} /></form><Decide k={0} /></>;
    return <><h3 className="wz-q">How many clips?</h3>
      <div className="seg" role="radiogroup" aria-label="Clips">{W.clipCounts.map(k => <button key={k} type="button" role="radio" aria-checked={clips === k ? 'true' : 'false'} onClick={() => setClips(k)}>{k}</button>)}</div>
      <label className="lbl-in"><input type="checkbox" id="wz-ads" checked={ads} onChange={e => setAds(e.target.checked)} /> Add 15 s and 30 s ad cuts</label>
      <div className="row"><Button id="wz-clips-go" variant="primary" label="Find the clips" isLoading={busy} onClick={() => step({ wizard: 'clips', clips, ads }, true)} /><Decide k={0} /></div></>;
  };
  const cur = W && w ? W.wizards[w] : null, steps = w === 'reel' ? 3 : 1;
  return <dialog ref={ref} className="fb wizards glass" id="wizards" aria-labelledby="wz-h" onClose={close} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="fb-h"><div><h2 id="wz-h">{cur ? cur.title : 'Wizards'}</h2><p className="fine">{cur ? (steps > 1 ? `Step ${n + 1} of ${steps}` : cur.sub) : 'A guided start. You can change anything after.'}</p></div>
      <IconBtn n="x" label="Close" onClick={close} /></header>
    <div className="wz-b" data-wizard={w || ''}>{body()}
      {w && <button type="button" className="btn ghost sm wz-back" id="wz-back" onClick={() => n ? setN(n - 1) : setW(null)}><Icon n="left" />Back</button>}
      <p className="fine fb-err" role="alert" id="wz-err">{err}</p></div>
  </dialog>;
}
