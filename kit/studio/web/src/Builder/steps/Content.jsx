import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Field, Label, Input, Description } from '@headlessui/react';
import { Toggle } from './Toggle.jsx';
import { Tiles } from './Tiles.jsx';

// Step 15: is this video about a GitHub repo or a tool? When it is: 1 to 3 repo links (we take the pictures and videos
// from each README, kit/repo-broll.mjs), Split (the repo on top, you below), takeovers (the repo full screen when you
// point at it, you full screen on the hook, punch lines and CTA) or none, a note when Frame breakout is on, and an
// example video to break down on Teardowns. A link that is not a repo link is said at once and never saved.
const s = stylex.create({
  list: { display: 'grid', gap: 10, marginTop: 14 },
  input: { width: '100%', padding: 8, borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', font: 'inherit', boxSizing: 'border-box' },
  bad: { borderColor: 'var(--danger, #e5484d)' },
  h: { fontSize: 14, marginTop: 18, marginBottom: 8 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
});
export const REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;
const TAKE = [['auto', 'Automatic'], ['off', 'Off']].map(([id, name]) => ({ id, name, preview: null }));
export const CONTENT_SAYS = { auto: 'Split on most lines; the repo full screen when you point at it, you full screen on the hook, punch lines and the call to action.', off: 'Split the whole way: the repo on top, you below.' };
export function Content({ plan, save, busy }) {
  const c = plan.content, [on, setOn] = useState(c.repoFeature), [links, setLinks] = useState([...(c.repos.length ? c.repos : ['']), '', ''].slice(0, 3));
  const [example, setExample] = useState(c.example || '');
  const ok = u => REPO_RE.test(u.trim()), good = links.map(u => u.trim()).filter(ok);
  const keep = ls => { const g = ls.map(u => u.trim()).filter(ok); if (g.length) save({ repoFeature: true, repos: [...new Set(g.map(u => u.replace(/\/$/, '')))] }); };
  const flip = v => { setOn(v); if (!v) save({ repoFeature: false }); else keep(links); };
  const breakout = (plan.presenter || []).some(x => x.id === 'frame-breakout');
  return <>
    <Toggle id="build-repo-on" checked={on} disabled={busy} onChange={flip}>This video features a GitHub repo or tool</Toggle>
    {on && <>
      <div {...stylex.props(s.list)} id="build-repo-links">
        {links.map((u, i) => { const bad = !!u.trim() && !ok(u); return <Field key={i}>
          <Label className="sr">{`Repo link ${i + 1}`}</Label>
          <Input id={`build-repo-${i}`} type="url" inputMode="url" value={u} placeholder={i === 0 ? 'https://github.com/owner/repo' : 'Another repo (optional)'} invalid={bad}
            onChange={e => { const ls = links.slice(); ls[i] = e.target.value; setLinks(ls); }} onBlur={() => keep(links)} {...stylex.props(s.input, bad && s.bad)} />
          {bad && <Description className="fine" role="alert" id={`build-repo-${i}-err`}>Use a link like https://github.com/owner/repo.</Description>}
        </Field>; })}
        {!good.length && <p className="fine" id="build-repo-need">Add at least one repo link. We take the pictures and videos from its README.</p>}
      </div>
      <h3 {...stylex.props(s.h)}>Layout</h3>
      <p className="fine" id="build-repo-layout">Split: the repo on top, you below, with your head just over the edge.</p>
      <h3 {...stylex.props(s.h)}>Full screen moments</h3>
      <Tiles id="build-repo-take" label="Full screen moments" items={TAKE} value={c.takeovers} disabled={busy || !good.length} onChange={takeovers => save({ takeovers })} />
      {breakout && <p className="fine" id="build-repo-breakout">Frame breakout is on (You on screen): the repo sits in a card and your head breaks out over it.</p>}
      <h3 {...stylex.props(s.h)}>Example video (optional)</h3>
      <Field {...stylex.props(s.row)}>
        <Label className="sr">Example video link</Label>
        <Input id="build-repo-example" type="url" value={example} placeholder="A video made this way, to copy its look" onChange={e => setExample(e.target.value)}
          onBlur={() => { const v = example.trim(); if (v !== (c.example || '') && (!v || /^https?:\/\//.test(v))) save({ example: v || null }); }} {...stylex.props(s.input)} />
        {example.trim() && <a className="btn sm outline" id="build-repo-example-go" href="#tab=teardowns">Break it down on Teardowns</a>}
      </Field>
    </>}
  </>;
}
