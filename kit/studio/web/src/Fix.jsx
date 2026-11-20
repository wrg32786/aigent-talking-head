// Fix buttons: anything Studio needs that is missing, in plain words, with Install (Studio does it), Send to my agent
// (the Studio chat channel, when a terminal agent is connected) and Copy for my agent. The steps for an agent live only
// in the copied or sent instruction (env.fixes[id].prompt from kit/studio/fixes.mjs); the page never shows a command.
import { Button } from '@astryxdesign/core/Button';
import { api, toast, Icon } from './lib.jsx';
import { copyText } from './Connect.jsx';

export const fixOf = (V, id) => (V && V.env && V.env.fixes && V.env.fixes[id]) || null;
export const agentOn = V => !!(V && V.env && V.env.backend === 'agent' && V.env.agent && V.env.agent.connected);

// the buttons for one fix id; apply is optional (the server pushes the new state either way)
export function FixActions({ V, id, apply }) {
  const f = fixOf(V, id); if (!f) return null;
  const t = V.task, inst = !!(t && t.kind === 'install'), running = inst && t.status === 'running', mine = inst && t.fix === id;
  const ended = mine && !running, ok = ended && t.status === 'done' && t.result && t.result.ready, failed = ended && !ok && t.status !== 'cancelled';
  const install = () => api('/api/fix/install', { id }).then(j => { if (apply) apply(j); toast(`Installing ${f.label}. This can take a few minutes.`, true); }).catch(() => {});
  const send = () => api('/api/fix/send', { id }).then(j => { if (apply) apply(j); toast('Sent to your agent. Its answer shows in the chat.', true); }).catch(() => {});
  const copy = () => copyText(f.prompt, 'Copied. Paste it into your agent.');
  if (ok) return <span className="fix" data-fix={id}><span className="fix-ok" role="status"><Icon n="check" />{f.label} installed</span></span>;
  return <span className="fix" data-fix={id}>
    {f.install && <Button size="sm" variant="secondary" label={mine && running ? 'Installing' : failed ? 'Try again' : 'Install'} isLoading={mine && running} isDisabled={running && !mine} onClick={install} />}
    {f.link && <a className="fix-link" href={f.link} target="_blank" rel="noreferrer">{f.linkLabel}</a>}
    {agentOn(V) && <Button size="sm" variant="ghost" label="Send to my agent" onClick={send} />}
    <Button size="sm" variant="ghost" label="Copy for my agent" icon={<Icon n="copy" />} onClick={copy} />
    {failed && <span className="fine fix-note" role="status">That did not finish. Your agent can take it from here.</span>}
  </span>;
}

// one note where a feature needs something missing: what is missing and why, then the buttons for each
export function NeedFix({ V, ids, what, apply }) {
  const miss = V && V.env.setup ? ids.filter(k => V.env.setup.missing[k] && fixOf(V, k)) : [];
  if (!miss.length) return null;
  const names = miss.map(k => fixOf(V, k).label), list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  return <div className="needfix" role="note">
    <p><Icon n="ban" />{what} needs {list}, and {names.length > 1 ? 'they are' : 'it is'} not installed yet.</p>
    {miss.map(k => <div className="fix-row" key={k}><span className="fine">{miss.length > 1 && <b>{fixOf(V, k).label}. </b>}{fixOf(V, k).why}</span><FixActions V={V} id={k} apply={apply} /></div>)}
  </div>;
}
