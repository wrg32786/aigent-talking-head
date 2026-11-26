import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Field, Label, Input, Description } from '@headlessui/react';
import { Toggle } from './Toggle.jsx';
import { Tiles } from './Tiles.jsx';
import { REPO_RE } from '../../../../wizard/plan.mjs';

// Step 15: is this video about a GitHub repo or a tool? When it is: 1 to 3 repo links (we take the pictures and videos
// from each README, kit/repo-broll.mjs), Split (the repo on top, you below), takeovers (the repo full screen when you
// point at it, you full screen on the hook, punch lines and CTA) or none, Frame breakout on by default (a note, and a way to turn it off on You on screen), and an
// example video, handed to Teardowns to break down. A link that is not a repo link is said once you leave the box (or
// press Enter) and never saved. Clearing every link saves none, which turns the mode off in the plan.
const s = stylex.create({
  list: { display: 'grid', gap: 10, marginTop: 14 },
  input: { width: '100%', padding: 8, borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', font: 'inherit', boxSizing: 'border-box' },
  bad: { borderColor: 'var(--danger, #e5484d)' },
  h: { fontSize: 14, marginTop: 18, marginBottom: 8 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
});
export { REPO_RE };
const TAKE = [['auto', 'Automatic'], ['off', 'Off']].map(([id, name]) => ({ id, name, preview: null }));
export const CONTENT_SAYS = { auto: 'Split on most lines; the repo full screen when you point at it, you full screen on the hook, punch lines and the call to action.', off: 'Split on every line in the middle; you full screen on the hook and the call to action.' };
const LINK = /^https?:\/\/\S+$/;
export function Content({ plan, save, busy }) {
  const c = plan.content, [on, setOn] = useState(c.repoFeature), [links, setLinks] = useState([...(c.repos.length ? c.repos : ['']), '', ''].slice(0, 3));
  const [example, setExample] = useState(c.example || ''), [seen, setSeen] = useState({}), [exBad, setExBad] = useState(false);
  const ok = u => REPO_RE.test(u.trim()), good = links.map(u => u.trim()).filter(ok);
  // saved links follow the boxes: the good ones, or none (the mode is off in the plan until one is added)
  const keep = ls => { const g = [...new Set(ls.map(u => u.trim()).filter(ok).map(u => u.replace(/\/$/, '')))]; save(g.length ? { repoFeature: true, repos: g } : { repoFeature: false, repos: [] }); };
  const leave = i => { setSeen(x => ({ ...x, [i]: true })); keep(links); };
  const flip = v => { setOn(v); if (!v) save({ repoFeature: false }); else if (good.length) keep(links); };
  const saveExample = () => { const v = example.trim(); const bad = !!v && !LINK.test(v); setExBad(bad); if (!bad && v !== (c.example || '')) save({ example: v || null }); };
  const enter = f => e => { if (e.key === 'Enter') { e.preventDefault(); f(); } };
  const breakout = (plan.presenter || []).some(x => x.id === 'frame-breakout');
  return <>
    <Toggle id="build-repo-on" checked={on} disabled={busy} onChange={flip}>This video features a GitHub repo or tool</Toggle>
    {on && <>
      <div {...stylex.props(s.list)} id="build-repo-links">
        {links.map((u, i) => { const bad = !!seen[i] && !!u.trim() && !ok(u); return <Field key={i}>
          <Label className="sr">{`Repo link ${i + 1}`}</Label>
          <Input id={`build-repo-${i}`} type="url" inputMode="url" value={u} placeholder={i === 0 ? 'https://github.com/owner/repo' : 'Another repo (optional)'} invalid={bad}
            onChange={e => { const ls = links.slice(); ls[i] = e.target.value; setLinks(ls); if (seen[i]) setSeen(x => ({ ...x, [i]: false })); }} onBlur={() => leave(i)} onKeyDown={enter(() => leave(i))} {...stylex.props(s.input, bad && s.bad)} />
          {bad && <Description className="fine" role="alert" id={`build-repo-${i}-err`}>Use a link like https://github.com/owner/repo.</Description>}
        </Field>; })}
        {!good.length && <p className="fine" id="build-repo-need">Add at least one repo link. We take the pictures and videos from its README.</p>}
      </div>
      <h3 {...stylex.props(s.h)}>Layout</h3>
      <p className="fine" id="build-repo-layout">Split: the repo on top, you below, with your head just over the edge.</p>
      <h3 {...stylex.props(s.h)}>Full screen moments</h3>
      <Tiles id="build-repo-take" label="Full screen moments" items={TAKE} value={c.takeovers} disabled={busy || !good.length} onChange={takeovers => save({ takeovers })} />
      <p className="fine" id="build-repo-take-says">{CONTENT_SAYS[c.takeovers === 'off' ? 'off' : 'auto']}</p>
      {breakout
        ? <p className="fine" id="build-repo-breakout">Frame breakout is on (You on screen): the repo sits in a card and your head breaks out over it. Turn it off there if you want.</p>
        : <p className="fine" id="build-repo-breakout-off">Frame breakout is off. You can turn it on in the You on screen step if you want your head to break out over the repo card.</p>}
      <h3 {...stylex.props(s.h)}>Example video (optional)</h3>
      <Field {...stylex.props(s.row)}>
        <Label className="sr">Example video link</Label>
        <Input id="build-repo-example" type="url" value={example} placeholder="A video made this way, to copy its look" invalid={exBad}
          onChange={e => { setExample(e.target.value); setExBad(false); }} onBlur={saveExample} onKeyDown={enter(saveExample)} {...stylex.props(s.input, exBad && s.bad)} />
        {exBad && <Description className="fine" role="alert" id="build-repo-example-err">Use a web link, like https://www.youtube.com/watch?v=...</Description>}
        {example.trim() && !exBad && <a className="btn sm outline" id="build-repo-example-go" href="#tab=teardowns" onClick={() => { saveExample(); try { sessionStorage.setItem('ath-ref-prefill', example.trim()); } catch {} }}>Break it down on Teardowns</a>}
      </Field>
    </>}
  </>;
}
