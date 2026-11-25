import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { api, Icon } from '../lib.jsx';
import { cleanJob } from '../NewVideo.jsx';
import { Dropzone, FootageLink } from '../Footage.jsx';
import { Recordings } from '../Recording.jsx';
import { Library, useTemplates } from '../Library.jsx';

// The New video start screen (spec 2.1): your clip, then how to build it: Use a template (the Template Library grid;
// picking one sets the plan and goes straight to Your notes) or Build my own.
const s = stylex.create({
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  card: { display: 'grid', gap: 6, justifyItems: 'start', textAlign: 'left', padding: 16, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', cursor: 'pointer' },
  chosen: { borderColor: 'var(--primary)', boxShadow: '0 0 0 1px var(--primary) inset' },
  big: { padding: 20, minHeight: 110 },
  h3: { marginTop: 20, marginBottom: 8, fontSize: 15 },
  chip: { display: 'inline-block', paddingBlock: 2, paddingInline: 8, borderRadius: 999, fontSize: 12, backgroundColor: 'color-mix(in srgb, var(--primary) 16%, transparent)' },
  have: { marginTop: 10, marginBottom: 0 },
  name: { display: 'grid', gap: 4, maxWidth: 360, marginTop: 8 },
});
// a take from the last hour counts as just recorded
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m <= 60 ? `${m} min ago` : null; };
// the name Studio gives a new video you do not name (core.mjs switchVideo; a taken one gets -2, -3)
const today = () => { const d = new Date(); return `video-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Pick({ apply, onUse }) { const T = useTemplates(); return <div id="build-tlib"><Library T={T} mode="pick" apply={apply} onUse={onUse} /></div>; }

export function Start({ s: st, apply, onBuild, onTemplate, headRef }) {
  const n = (st.footage || []).length;
  // the newest take made in the last hour: its card starts chosen
  const fresh = (st.takes || []).filter(t => t.status === 'ready' && t.file && t.at && ago(t.at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).pop();
  const [src, setSrc] = useState(() => (fresh ? 'recording' : null)), [name, setName] = useState(''), [pick, setPick] = useState(false);
  // a clip needs a video to go in: an unnamed one is started with the name you typed (refused when it is taken) or
  // today's date (Studio adds -2 when that is taken). Returns the state to upload into, or null.
  const named = async () => { if (st.job) return st; try { const v = apply(await api('/api/videos/new', { name: cleanJob(name) || '', keepLook: true })); return v && v.state; } catch { return null; } };
  return <section className="step" id="build-start" aria-labelledby="build-h-start">
    <header className="sh"><h2 id="build-h-start" ref={headRef} tabIndex={-1}>New video</h2><p className="sub">Pick your clip, then build the look one choice at a time.</p></header>
    {!st.job && <label id="build-name-row" {...stylex.props(s.name)}><span>Name <span className="fine">(optional)</span></span>
      <input id="build-name" value={name} autoComplete="off" spellCheck="false" aria-describedby="build-name-hint" placeholder={today()} onChange={e => setName(e.target.value)} />
      <span id="build-name-hint" className="fine">Lowercase letters, numbers and dashes. Today's date if you leave it empty.</span></label>}
    <h3 {...stylex.props(s.h3)}>Your clip</h3>
    <div {...stylex.props(s.cards)} role="group" aria-label="Your clip">
      <button type="button" id="build-src-recording" aria-pressed={src === 'recording'} onClick={() => setSrc('recording')} {...stylex.props(s.card, src === 'recording' && s.chosen)}>
        <Icon n="camera" /><strong>Use a recording</strong><span className="fine">A take you made on the Recording tab</span></button>
      <Dropzone id="build-src-upload" inputId="build-file" kind="footage" s={st} apply={apply} prepare={named} multiple accept="video/*,.mov,.mp4,.m4v,.webm,.mkv" label="Upload a video: drop files or press Enter to choose">
        <Icon n="upload" className="di" /><strong>Upload a video</strong><span>Drop it here or click to choose</span>
      </Dropzone>
      <button type="button" id="build-src-link" aria-pressed={src === 'link'} onClick={() => setSrc('link')} {...stylex.props(s.card, src === 'link' && s.chosen)}>
        <Icon n="link" /><strong>Paste a link</strong><span className="fine">A Dropbox, Google Drive or direct video link</span></button>
    </div>
    {src === 'recording' && <Recordings s={st} apply={apply} toNew={() => setSrc(null)} idp="build-" />}
    {src === 'link' && <FootageLink s={st} apply={apply} prepare={named} />}
    <p id="build-have" className="fine" role="status" {...stylex.props(s.have)}>
      {n ? `${n} clip${n === 1 ? '' : 's'} in this video.` : 'No clip yet. You can also add one later.'}
      {fresh && <> <span id="build-fresh" {...stylex.props(s.chip)}>From Recording, {ago(fresh.at)}: {(fresh.script && fresh.script.title) || 'your newest take'}</span></>}
    </p>
    <h3 {...stylex.props(s.h3)}>How do you want to build it?</h3>
    <div {...stylex.props(s.cards)}>
      <button type="button" id="build-template" aria-expanded={pick} onClick={() => setPick(!pick)} {...stylex.props(s.card, s.big, pick && s.chosen)}><Icon n="spark" /><strong>Use a template</strong><span className="fine">Pick one from your Template Library and go straight to your notes</span></button>
      <button type="button" id="build-own" onClick={onBuild} {...stylex.props(s.card, s.big)}>
        <Icon n="right" /><strong>Build my own</strong><span className="fine">One choice per screen, starting with the pace</span></button>
    </div>
    {pick && <Pick apply={apply} onUse={edit => (edit ? onBuild() : onTemplate())} />}
  </section>;
}
