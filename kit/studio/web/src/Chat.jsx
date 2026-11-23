import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Button } from '@astryxdesign/core/Button';
import { api, file, toast, grow, Icon, IconBtn, MSG_STATUS } from './lib.jsx';
import { clock } from './Review.jsx';
import { ASKS } from './Agent.jsx';

const DOT = { on: 'success', busy: 'warning', off: 'error', alt: 'neutral' };

// Apply on an answer that carries a suggested change (studio_reply suggest): the change is made only on that click
function Suggest({ m, apply, go }) {
  const g = m.suggest, [busy, setBusy] = useState(false);
  const doIt = async () => { setBusy(true); try { apply(await api('/api/chat/apply', { id: m.id })); toast('Applied', true); if (g.step) go(g.step, true); } catch {} finally { setBusy(false); } };
  return <span className="sg-row">{m.applied ? <span className="sg-done fine"><Icon n="check" />Applied</span>
    : <Button className="sg-apply" size="sm" variant="primary" label={g.label || 'Apply'} isLoading={busy} onClick={doIt} />}
    {g.step && <Button className="sg-show" size="sm" variant="ghost" label="Show me" onClick={() => go(g.step, true)} />}</span>;
}

export function Chat({ V, s, apply, go, open, setOpen, close, agentState, openConnect, step }) {
  const e = V.env, a = e.agent || {}, backend = e.backend, name = a.name || 'Your agent';
  const ol = useRef(null), input = useRef(null), fab = useRef(null), atBottom = useRef(true);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [attach, setAttach] = useState(null);
  // a moment marked on the video (Review, Comment on this frame) arrives here and rides along with the next message
  useEffect(() => {
    const on = ev => { setAttach(ev.detail); setOpen(true); setTimeout(() => input.current?.focus(), 0); };
    window.addEventListener('studio-attach', on); return () => window.removeEventListener('studio-attach', on);
  }, []);
  const chips = !text && !attach ? (ASKS[step] || []) : [];
  // the always-on agent: Studio runs its own agent so the chat stays connected
  const wk = e.worker || {}, wakeable = backend === 'agent' && wk.available && !wk.enabled && !a.listening;
  const wake = async () => { try { apply(await api('/api/agent/wake', {})); toast('Starting your Studio agent. It answers here in a few seconds.', true); } catch {} };
  const sleep = async () => { try { apply(await api('/api/agent/sleep', {})); toast('Studio agent stopped', true); } catch {} };
  const ask = async q => { setBusy(true); try { atBottom.current = true; apply(await api('/api/chat', { text: q, step })); } catch {} finally { setBusy(false); } };
  const label = backend === 'agent' ? (a.listening ? `${name}, listening` : a.connected ? `${name}, busy` : a.recent ? `${name}, between replies` : 'No agent') : e.llm ? e.llm : backend === 'keywords' ? 'Built-in helper' : 'Built-in helper (no model ready)';
  useLayoutEffect(() => { const o = ol.current; if (o && atBottom.current) o.scrollTop = o.scrollHeight; }, [s.chat]);
  useEffect(() => {
    if (open) { const o = ol.current; if (o) o.scrollTop = o.scrollHeight; input.current?.focus({ preventScroll: true }); }
    const onKey = ev => { if (ev.key === 'Escape' && open) { setOpen(false); document.getElementById('chat-open')?.focus({ preventScroll: true }); } };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const send = async ev => {
    ev.preventDefault(); const t = text.trim(); if (!t) return;
    setText(''); requestAnimationFrame(() => grow(input.current)); setBusy(true);
    try { atBottom.current = true; if (attach) { const { label, ...at } = attach; apply(await api('/api/comment', { text: t, ...at })); setAttach(null); } else apply(await api('/api/chat', { text: t })); } catch {} finally { setBusy(false); requestAnimationFrame(() => input.current?.focus()); }
  };
  const waiting = s.chat.filter(m => m.role === 'user' && m.to === 'agent' && m.status !== 'answered');
  const empty = backend === 'agent' && !a.connected
    ? <li className="empty"><Icon n="plug" /><p>Connect your terminal agent to chat with it here.</p><Button id="chat-connect" variant="primary" size="sm" label="Connect agent" onClick={openConnect} /></li>
    : <li className="empty"><Icon n="chat" /><p>{backend === 'agent' ? `${name} is here. Say what you want.` : 'Describe the vibe.'}</p><p className="fine">"Calm and cinematic, no glitch"</p></li>;
  return <aside className={'chat glass' + (open ? ' open' : '')} id="chat" aria-labelledby="h-chat">
    <header className="ch"><h2 id="h-chat">Chat</h2>
      <div id="agentbar" className={'agentbar ' + agentState} role="status" aria-live="polite" title={agentState === 'busy' ? 'Busy in the terminal. Messages wait for its next step.' : undefined}>
        <StatusDot variant={DOT[agentState]} label={label} isPulsing={agentState === "on"} /><span aria-hidden="true">{label}</span></div>
      <IconBtn id="chat-close" n="x" label="Close chat" onClick={() => { close(); setTimeout(() => document.getElementById('chat-open')?.focus({ preventScroll: true }), 0); }} />
      {backend === 'agent' && wk.enabled && <span className={'wk-state ' + wk.phase} id="worker-state" role="status">{wk.phase === 'running' ? 'Always on' : wk.phase === 'restarting' ? 'Reconnecting' : 'Starting'}<button type="button" className="rp-chip" id="worker-stop" onClick={sleep}>Stop</button></span>}
      {wakeable && <button type="button" className="rp-chip wake" id="worker-wake" onClick={wake} title="Studio starts its own agent and keeps it connected">Wake agent</button>}
    </header>
    <p id="chatmode" className="sr">{backend === 'agent' ? 'Separate from your terminal conversation.' : ''}</p>
    <ol id="msgs" className="msgs" aria-live="polite" ref={ol} onScroll={ev => { const o = ev.currentTarget; atBottom.current = o.scrollHeight - o.scrollTop - o.clientHeight < 40; }}>
      {s.chat.length ? s.chat.map((m, i) => m.kind === 'action' ? <li key={i} className="action">{m.text}</li>
        : m.role === 'user' ? <li key={i} className={'user' + (m.attach && m.attach.kind === 'comment' ? ' comment' : '')}>{m.attach && m.attach.kind === 'comment' ? <>
          {m.attach.frame && <img className="cm-thumb" src={file(m.attach.frame)} alt={`Your reel at ${clock(m.attach.t)}, with the spot marked`} />}<span className="cm-at">{m.attach.end != null ? `Note on ${clock(m.attach.t)} to ${clock(m.attach.end)}` : `Comment at ${clock(m.attach.t)}`}</span>{m.attach.note}</> : m.attach && m.attach.kind === 'fix' ? `Please install ${m.attach.label} for Studio.` : m.attach && m.attach.kind === 'ref-titles' ? 'Please read the titles of my reference.' : m.text}{m.to === 'agent' && <span className={'meta ' + (m.status || '')}>{m.status === 'answered' && <Icon n="check" />}{MSG_STATUS[m.status] || m.status}</span>}</li>
        : <li key={i} className="assistant"><span className="who">{m.from === 'keywords' ? 'Studio' : (m.from && m.from !== 'agent' ? m.from : name)}</span>{m.text}{m.suggest && <Suggest m={m} apply={apply} go={go} />}</li>) : empty}
      {waiting.length > 0 && backend === 'agent' && <li className="typing" aria-label="waiting for your agent"><i /><i /><i />{waiting.some(m => m.status === 'seen') ? `${name} is on it` : a.connected ? `${name} reads it at its next step` : 'Waiting for your agent to connect'}</li>}
    </ol>
    {chips.length > 0 && <ul className="ask-chips chat-chips" id="ask-chips" aria-label="Quick asks for this step">{chips.map(q => <li key={q}><button type="button" className="chip" disabled={busy} onClick={() => ask(q)}>{q}</button></li>)}</ul>}
    {attach && <div className="chat-attach" id="chat-attach"><Icon n="film" /><span>Frame at {attach.label}</span><button type="button" className="icon-btn" aria-label="Remove the frame" onClick={() => setAttach(null)}><Icon n="x" /></button></div>}
    <form id="chatform" className="composer" onSubmit={send}>
      <label className="sr" htmlFor="chatin">Message</label>
      <textarea id="chatin" ref={input} rows={1} value={text} disabled={busy} placeholder={attach ? 'What should change at this moment?' : backend === 'agent' ? (a.connected ? `Message ${name}` : 'Message your agent') : 'Calm and cinematic, no glitch'}
        onChange={ev => { setText(ev.target.value); grow(ev.target); }} onKeyDown={ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.currentTarget.form.requestSubmit(); } }} />
      <button className="icon-btn primary" type="submit" aria-label="Send"><Icon n="send" /></button>
    </form>
  </aside>;
}
