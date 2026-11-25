// Review: Plan check (kit/plan-check.mjs, docs/studio.md). Does the draft do what you built? One row per selection with
// a check or a warning, the moment it is about and a still of it after a render, and Ask the agent to fix this (sent
// through the chat when your agent is connected, copied otherwise). Fix what we can applies the fixes the check knows
// (up to 3 rounds); the video shows them on the next render. With no agent, the panel says the looked-at checks need one.
import { useEffect, useState } from 'react';
import { api, file, toast } from './lib.jsx';
import { clock } from './Review.jsx';

const ask = r => `In the video, "${r.selection}" is off: ${r.note}${r.time != null ? ` (at ${clock(r.time)})` : ''} Please fix it so it matches the plan, then check it again.`;

export function PlanCheck({ V, s, drafted, apply }) {
  const [rep, setRep] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const a = (V.env && V.env.agent) || {}, agentOn = !!(a.connected || a.listening);
  useEffect(() => { let live = true; setRep(null); if (s.job) api('/api/plan-check').then(j => { if (live) setRep(j.report || null); }).catch(() => {}); return () => { live = false; }; }, [s.job, drafted && drafted.at]);
  const run = async fix => { setBusy(true); setErr(''); try { const j = await api('/api/plan-check', { fix }); setRep(j.report); if (fix && j.report.fixed.length) toast(`Fixed ${j.report.fixed.length}. Render again to see it.`, true); } catch (e) { setErr(e.message || 'The check did not run.'); } finally { setBusy(false); } };
  const send = async r => {
    const text = ask(r);
    if (agentOn) { try { const j = await api('/api/chat', { text }); if (apply) apply(j); toast('Sent to your agent', true); return; } catch {} }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it to your agent.', true); } catch { toast('Copy did not work. Select the note and copy it.'); }
  };
  if (!s.videoPlan) return null; // only for a video built with Build my own
  const rows = rep ? [...rep.checks, ...(rep.looked || [])] : [], bad = rows.filter(r => !r.ok), fixable = rep && rep.checks.some(r => !r.ok && r.fix);
  const frame = f => f && s.job ? file(`jobs/${s.job}/build/${f}`) : null;
  return <div className="review glass-card" id="plan-check" aria-labelledby="plan-check-h">
    <div className="rv-head"><h3 id="plan-check-h">Plan check</h3>
      <span className="fine grow" role="status" id="plan-check-sum">{!rep ? 'Check that the video does what you built.' : bad.length ? `${bad.length} to look at` : 'Everything matches your plan.'}</span>
      <button type="button" className="btn sm outline" id="plan-check-run" disabled={busy} onClick={() => run(false)}>{busy ? 'Checking' : rep ? 'Check again' : 'Check the plan'}</button>
      {fixable && <button type="button" className="btn sm" id="plan-check-fix" disabled={busy} onClick={() => run(true)}>Fix what we can</button>}
    </div>
    {err && <p className="fine" role="alert" id="plan-check-err">{err}</p>}
    {rep && rep.needsRender && <p className="fine" id="plan-check-render">Fixed: {rep.fixed.map(x => x.note).join(' ')} Render again to see it in the video.</p>}
    {rep && <ul className="pc-list" id="plan-check-rows">{rows.map(r => <li key={(r.measured ? 'm-' : 'l-') + r.id} className={'pc-row ' + (r.ok ? 'ok' : 'warn')} data-check={r.id} data-ok={String(r.ok)}>
      {frame(r.frame) ? <img src={frame(r.frame)} alt="" width="54" height="96" loading="lazy" /> : <span className="pc-mark" aria-hidden="true">{r.ok ? '✓' : '!'}</span>}
      <span className="pc-text"><b>{r.selection}</b> <span className="sr">{r.ok ? 'matches' : 'needs a look'}</span>{r.time != null && <span className="mono"> {clock(r.time)}</span>}<br /><span className="fine">{r.note}{!r.measured && ' (your agent looked)'}</span></span>
      {!r.ok && <button type="button" className="btn sm ghost pc-ask" onClick={() => send(r)}>Ask the agent to fix this</button>}
    </li>)}</ul>}
    {rep && !agentOn && !(rep.looked || []).length && <p className="fine" id="plan-check-agent">We ran the measured checks. Looking at each frame against your picks and notes needs your agent: connect one to add those.</p>}
  </div>;
}
