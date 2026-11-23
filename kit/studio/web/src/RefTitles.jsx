// Read the titles with my agent (1.29.0): one small card in the reference's breakdown. The breakdown's text reader
// misreads designed titles, so the user's agent looks at pictures of the stretches with big text and sends the titles
// back (the set_reference_titles tool, kit/studio/ref-titles.mjs). Send to my agent when one is connected, Copy for my
// agent always; the instruction is made by the server and never shown. A model reads the pictures only on its own
// button, and the line beside it says who gets them.
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, toast, Icon } from './lib.jsx';
import { agentOn } from './Fix.jsx';
import { copyText } from './Connect.jsx';

export function RefTitles({ V, apply }) {
  const rt = V.refTitles, [busy, setBusy] = useState('');
  if (!rt) return null;
  const act = async (name, path, body, done) => { setBusy(name); try { done(await api(path, body)); } catch {} setBusy(''); };
  const send = () => act('send', '/api/reference/titles/ask', { send: true }, j => { apply(j); toast('Sent to your agent. Its answer shows in the chat.', true); });
  const copy = () => act('copy', '/api/reference/titles/ask', {}, j => copyText(j.ask, 'Copied. Paste it into your agent.'));
  const read = () => act('read', '/api/reference/titles/read', {}, j => { apply(j); toast(j.note, true); });
  const rd = rt.read;
  return <div className="ref-titles" id="ref-titles" role="group" aria-labelledby="ref-titles-h" data-read={rd ? rd.n : 0}>
    <div className="rt-t"><span className="lbl" id="ref-titles-h"><Icon n={rd ? 'check' : 'spark'} />{rd ? `Titles read by ${rd.by}: ${rd.n}` : 'Read the titles with my agent'}</span>
      <span className="fine" id="ref-titles-state" role="status">{rd ? rd.first.join(', ') + (rd.n > rd.first.length ? ' and more' : '') : 'Your agent looks at pictures of the reference and reads each title as it was designed.'}</span></div>
    <div className="rt-acts">
      {agentOn(V) && <Button id="ref-titles-send" size="sm" variant="secondary" label={rd ? 'Read them again' : 'Send to my agent'} isLoading={busy === 'send'} onClick={send} />}
      <Button id="ref-titles-copy" size="sm" variant="ghost" label="Copy for my agent" icon={<Icon n="copy" />} isLoading={busy === 'copy'} onClick={copy} />
      {rt.vision && <Button id="ref-titles-read" size="sm" variant="ghost" label={`Read them with ${rt.vision.name}`} isLoading={busy === 'read'} onClick={read} />}
      {rt.vision && <span className="fine" id="ref-titles-vision">Sends these pictures to {rt.vision.name}.</span>}
    </div>
  </div>;
}
