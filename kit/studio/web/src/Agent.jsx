// Ask my agent and the wizards (1.17.0). Ask my agent sits in the step footer on every step: a few prompts for that
// step, or your own words, sent through the Studio chat with the step attached (POST /api/chat { text, step }).
// The wizards are three short guided starts; each step has Let my agent decide, which hands the rest to the chat.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, file, toast, Icon, IconBtn } from './lib.jsx';

export const ASKS = {
  footage: ['Which take is best?', 'Is my audio clean enough?'],
  cut: ['Pick the strongest hook', 'Drop the weak lines', 'Make a 15 s ad from this too'],
  look: ['Make it calmer', 'Make it punchier', 'Match my brand colors'],
  broll: ['Suggest b-roll for the proof lines', 'Use fewer cards'],
  finish: ['Check the draft for me', 'Why was this line cut?'],
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
  const send = async t => { if (!t.trim()) return; setBusy(true); try { await askAgent(t.trim(), step, apply, openChat); setOpen(false); setText(''); } catch {} finally { setBusy(false); } };
  return <div className="ask" ref={box}>
    <Button id="ask-agent" variant="ghost" size="sm" label="Ask my agent" icon={<Icon n="spark" />} aria-expanded={open ? 'true' : 'false'} aria-controls="ask-pop" onClick={() => setOpen(!open)} />
    {open && <div className="ask-pop glass" id="ask-pop" role="dialog" aria-label="Ask my agent">
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
const GOALS = [
  { id: 'grow', label: 'Grow followers', sub: 'One short reel, hook first', out: { format: 'short', kind: 'full', length: 'short', goal: 'organic' } },
  { id: 'sell', label: 'Sell or sign up', sub: 'Short, with 15 s and 30 s ad cuts', out: { format: 'short', kind: 'full', length: 'short', goal: 'ad', adCuts: true } },
  { id: 'teach', label: 'Teach one thing', sub: 'A little longer, every step kept', out: { format: 'short', kind: 'full', length: 'medium', goal: 'organic' } },
  { id: 'clean', label: 'Full clean take', sub: 'Everything, retakes and fillers out', out: { format: 'long', kind: 'full', length: 'long', goal: 'organic' } },
];
const WIZ = [
  { id: 'reel', title: 'Make a reel from a long take', sub: 'Pick the goal and a Look; AI picks the lines; you check it in Finish.' },
  { id: 'ref', title: 'Copy a reference', sub: 'Paste a reel you like; Studio borrows its look.' },
  { id: 'clips', title: 'Clips and ads from one take', sub: 'Several short clips, plus ad cuts if you sell.' },
];

export function Wizards({ CAT, V, s, apply, patch, go, open, setOpen, openChat }) {
  const ref = useRef(null), [w, setW] = useState(null), [n, setN] = useState(0), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [url, setUrl] = useState(''), [clips, setClips] = useState(5), [ads, setAds] = useState(false), [goal, setGoal] = useState(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) { d.showModal(); setW(null); setN(0); setErr(''); } if (!open && d.open) d.close(); }, [open]);
  const close = () => setOpen(false);
  const src = (V.cut && V.cut.source) || s.footage[0] || null;
  const run = async f => { setBusy(true); setErr(''); try { await f(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const agent = text => run(async () => { await askAgent(text, null, apply, openChat); close(); });
  const looks = CAT.packs.filter(p => !/^ref-/.test(p.name)).slice(0, 8);
  const finishReel = () => run(async () => {
    if (!src) throw new Error('Add footage first, on the Footage step.');
    const j = await api('/api/pieces', { choose: true }).catch(e => { if (/transcribe/i.test(e.message)) return null; throw e; });
    if (!j) { await api('/api/cut/find', { path: src }); close(); go('cut', true); toast('Transcribing your take first. Let AI choose on Cut when it is ready.', true); return; }
    apply(j); close(); go('finish', true); toast(j.note || 'Your Combo is ready. Draft it in Finish.', true);
  });
  const deciders = { reel: ['Pick the goal for this take and set the output.', 'Pick a Look that fits this take.', 'Choose the pieces for the Combo.'], ref: ['Find a reference reel that fits what I am making.'], clips: ['Pick the best clips from this take, and say if ad cuts make sense.'] };
  const Decide = ({ k }) => <Button className="wz-agent" variant="ghost" size="sm" label="Let my agent decide" icon={<Icon n="spark" />} isDisabled={busy} onClick={() => agent(deciders[w][k] || deciders[w][0])} />;
  const body = () => {
    if (!w) return <ul className="wz-list" id="wz-list">{WIZ.map(x => <li key={x.id}><button type="button" className="wz-pick glass-card" data-wizard={x.id} onClick={() => { setW(x.id); setN(0); setErr(''); }}><b>{x.title}</b><span className="fine">{x.sub}</span><Icon n="right" /></button></li>)}</ul>;
    if (w === 'reel') {
      if (n === 0) return <><h3 className="wz-q">What is this reel for?</h3>
        <div className="wz-opts" role="radiogroup" aria-label="Goal">{GOALS.map(g => <button key={g.id} type="button" role="radio" className="wz-opt" data-goal={g.id} aria-checked={goal === g.id ? 'true' : 'false'} disabled={busy}
          onClick={() => run(async () => { setGoal(g.id); apply(await api('/api/cut/output', { ...g.out, ...(src ? { source: src } : {}) })); setN(1); })}><b>{g.label}</b><span className="fine">{g.sub}</span></button>)}</div><Decide k={0} /></>;
      if (n === 1) return <><h3 className="wz-q">Pick a Look</h3>
        <div className="wz-looks" role="radiogroup" aria-label="Look">{looks.map(p => <button key={p.name} type="button" role="radio" className="wz-look" data-look={p.name} aria-checked={s.pack === p.name ? 'true' : 'false'} disabled={busy}
          onClick={() => run(async () => { await patch({ pack: p.name }); setN(2); })}>{p.preview ? <img src={file(p.preview)} alt="" width={64} height={114} loading="lazy" /> : <span className="ph" />}<b>{p.name}</b></button>)}</div>
        <div className="row"><Button variant="ghost" size="sm" label="Keep my Look" onClick={() => setN(2)} /><Decide k={1} /></div></>;
      return <><h3 className="wz-q">Let AI choose the lines</h3><p className="fine">It picks a hook first and the call to action last, on whole words, to fit the length. You check the draft in Finish.</p>
        <div className="row"><Button id="wz-choose" variant="primary" label="Let AI choose" isLoading={busy} onClick={finishReel} /><Decide k={2} /></div></>;
    }
    if (w === 'ref') return <><h3 className="wz-q">Paste a reel you like</h3><p className="fine">A link from Instagram, TikTok, YouTube or a file link. Studio reads its titles, colors, cuts and sound.</p>
      <form className="wz-url" onSubmit={e => { e.preventDefault(); run(async () => { if (!url.trim()) throw new Error('Paste a link first.'); apply(await api('/api/reference/url', { url: url.trim(), mode: 'all' })); close(); go('reference', true); toast('Reading the reference. Use all is on.', true); }); }}>
        <label className="sr" htmlFor="wz-url-in">Reference link</label><input id="wz-url-in" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/..." />
        <Button id="wz-ref-go" type="submit" variant="primary" size="sm" label="Copy its look" isLoading={busy} /></form><Decide k={0} /></>;
    return <><h3 className="wz-q">How many clips?</h3>
      <div className="seg" role="radiogroup" aria-label="Clips">{[3, 5, 8].map(k => <button key={k} type="button" role="radio" aria-checked={clips === k ? 'true' : 'false'} onClick={() => setClips(k)}>{k}</button>)}</div>
      <label className="lbl-in"><input type="checkbox" id="wz-ads" checked={ads} onChange={e => setAds(e.target.checked)} /> Add 15 s and 30 s ad cuts</label>
      <div className="row"><Button id="wz-clips-go" variant="primary" label="Find the clips" isLoading={busy} onClick={() => run(async () => {
        if (!src) throw new Error('Add footage first, on the Footage step.');
        apply(await api('/api/cut/output', { format: 'short', kind: 'clips', clips, clipLength: 'short', goal: ads ? 'ad' : 'organic', adCuts: ads, source: src }));
        apply(await api('/api/cut/find', { path: src })); close(); go('cut', true); toast(`Finding ${clips} clips on whole words`, true); })} /><Decide k={0} /></div></>;
  };
  const cur = WIZ.find(x => x.id === w), steps = w === 'reel' ? 3 : 1;
  return <dialog ref={ref} className="fb wizards glass" id="wizards" aria-labelledby="wz-h" onClose={close} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="fb-h"><div><h2 id="wz-h">{cur ? cur.title : 'Wizards'}</h2><p className="fine">{cur ? (steps > 1 ? `Step ${n + 1} of ${steps}` : cur.sub) : 'A guided start. You can change anything after.'}</p></div>
      <IconBtn n="x" label="Close" onClick={close} /></header>
    <div className="wz-b" data-wizard={w || ''}>{body()}
      {w && <button type="button" className="btn ghost sm wz-back" id="wz-back" onClick={() => n ? setN(n - 1) : setW(null)}><Icon n="left" />Back</button>}
      <p className="fine fb-err" role="alert" id="wz-err">{err}</p></div>
  </dialog>;
}
