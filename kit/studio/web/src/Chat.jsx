import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Button } from '@astryxdesign/core/Button';
import { api, file, toast, grow, Icon, IconBtn, MSG_STATUS, SETUP_LINE } from './lib.jsx';
import { clock } from './Review.jsx';

const DOT = { on: 'success', busy: 'warning', off: 'error', alt: 'neutral' };

export function Chat({ V, s, apply, open, setOpen, agentState, openConnect }) {
  const e = V.env, a = e.agent || {}, backend = e.backend, name = a.name || 'Your agent';
  const ol = useRef(null), input = useRef(null), fab = useRef(null), atBottom = useRef(true);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const label = backend === 'agent' ? (a.listening ? `${name}, listening` : a.connected ? `${name}, busy` : 'No agent') : e.llm ? e.llm : backend === 'keywords' ? 'Keywords' : 'Keywords (no model ready)';
  useLayoutEffect(() => { const o = ol.current; if (o && atBottom.current) o.scrollTop = o.scrollHeight; }, [s.chat]);
  useEffect(() => {
    if (open) { const o = ol.current; if (o) o.scrollTop = o.scrollHeight; input.current?.focus({ preventScroll: true }); }
    const onKey = ev => { if (ev.key === 'Escape' && open) { setOpen(false); document.getElementById('chat-open')?.focus({ preventScroll: true }); } };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const send = async ev => {
    ev.preventDefault(); const t = text.trim(); if (!t) return;
    setText(''); requestAnimationFrame(() => grow(input.current)); setBusy(true);
    try { atBottom.current = true; apply(await api('/api/chat', { text: t })); } catch {} finally { setBusy(false); requestAnimationFrame(() => input.current?.focus()); }
  };
  const waiting = s.chat.filter(m => m.role === 'user' && m.to === 'agent' && m.status !== 'answered');
  const empty = backend === 'agent' && !a.connected
    ? <li className="empty"><Icon n="plug" /><p>Connect your terminal agent to chat with it here.</p><Button id="chat-connect" variant="primary" size="sm" label="Connect agent" onClick={openConnect} /><p className="fine">Already set up? Tell it:</p><div className="copyline"><code>{SETUP_LINE}</code><IconBtn n="copy" label="Copy" onClick={() => navigator.clipboard && navigator.clipboard.writeText(SETUP_LINE).then(() => toast('Copied', true))} /></div></li>
    : <li className="empty"><Icon n="chat" /><p>{backend === 'agent' ? `${name} is here. Say what you want.` : 'Describe the vibe.'}</p><p className="fine">"Calm and cinematic, no glitch"</p></li>;
  return <aside className={'chat glass' + (open ? ' open' : '')} id="chat" aria-labelledby="h-chat">
    <header className="ch"><h2 id="h-chat">Chat</h2>
      <div id="agentbar" className={'agentbar ' + agentState} role="status" aria-live="polite" title={agentState === 'busy' ? 'Busy in the terminal. Messages wait for its next step.' : undefined}>
        <StatusDot variant={DOT[agentState]} label={label} isPulsing={agentState === "on"} /><span aria-hidden="true">{label}</span></div>
      <IconBtn className="only-sm" id="chat-close" n="x" label="Close chat" onClick={() => { setOpen(false); document.getElementById('chat-open')?.focus({ preventScroll: true }); }} />
    </header>
    <p id="chatmode" className="sr">{backend === 'agent' ? 'Separate from your terminal conversation.' : ''}</p>
    <ol id="msgs" className="msgs" aria-live="polite" ref={ol} onScroll={ev => { const o = ev.currentTarget; atBottom.current = o.scrollHeight - o.scrollTop - o.clientHeight < 40; }}>
      {s.chat.length ? s.chat.map((m, i) => m.kind === 'action' ? <li key={i} className="action">{m.text}</li>
        : m.role === 'user' ? <li key={i} className={'user' + (m.attach && m.attach.kind === 'comment' ? ' comment' : '')}>{m.attach && m.attach.kind === 'comment' ? <>
          {m.attach.frame && <img className="cm-thumb" src={file(m.attach.frame)} alt={`Your reel at ${clock(m.attach.t)}, with the spot marked`} />}<span className="cm-at">Comment at {clock(m.attach.t)}</span>{m.attach.note}</> : m.attach && m.attach.kind === 'fix' ? `Please install ${m.attach.label} for Studio.` : m.text}{m.to === 'agent' && <span className={'meta ' + (m.status || '')}>{m.status === 'answered' && <Icon n="check" />}{MSG_STATUS[m.status] || m.status}</span>}</li>
        : <li key={i} className="assistant"><span className="who">{m.from === 'keywords' ? 'Studio' : (m.from && m.from !== 'agent' ? m.from : name)}</span>{m.text}</li>) : empty}
      {waiting.length > 0 && backend === 'agent' && <li className="typing" aria-label="waiting for your agent"><i /><i /><i />{waiting.some(m => m.status === 'seen') ? `${name} is on it` : a.connected ? `${name} reads it at its next step` : 'Waiting for your agent to connect'}</li>}
    </ol>
    <form id="chatform" className="composer" onSubmit={send}>
      <label className="sr" htmlFor="chatin">Message</label>
      <textarea id="chatin" ref={input} rows={1} value={text} disabled={busy} placeholder={backend === 'agent' ? (a.connected ? `Message ${name}` : 'Message your agent') : 'Calm and cinematic, no glitch'}
        onChange={ev => { setText(ev.target.value); grow(ev.target); }} onKeyDown={ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.currentTarget.form.requestSubmit(); } }} />
      <button className="icon-btn primary" type="submit" aria-label="Send"><Icon n="send" /></button>
    </form>
  </aside>;
}
