import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Icon } from '../lib.jsx';
import { Dropzone, FootageLink } from '../Footage.jsx';
import { Recordings } from '../Recording.jsx';

// The New video start screen (spec 2.1): your clip, then how to build it. Use a template waits for the Template Library
// and Your notes (spec 14.11), so only Build my own shows for now.
export const TEMPLATES_READY = false;
const s = stylex.create({
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  card: { display: 'grid', gap: 6, justifyItems: 'start', textAlign: 'left', padding: 16, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', cursor: 'pointer' },
  chosen: { borderColor: 'var(--primary)', boxShadow: '0 0 0 1px var(--primary) inset' },
  big: { padding: 20, minHeight: 110 },
  h3: { marginTop: 20, marginBottom: 8, fontSize: 15 },
  chip: { display: 'inline-block', paddingBlock: 2, paddingInline: 8, borderRadius: 999, fontSize: 12, backgroundColor: 'color-mix(in srgb, var(--primary) 16%, transparent)' },
  have: { marginTop: 10, marginBottom: 0 },
});
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : null; };

export function Start({ s: st, apply, onBuild }) {
  const [src, setSrc] = useState(null);
  const n = (st.footage || []).length;
  // a take made in the last hour that is in this video's footage
  const fresh = (st.takes || []).filter(t => t.status === 'ready' && t.file && st.footage.includes(t.file) && ago(t.at)).pop();
  return <section className="step" id="build-start" aria-labelledby="build-h-start">
    <header className="sh"><h2 id="build-h-start">New video</h2><p className="sub">Pick your clip, then build the look one choice at a time.</p></header>
    <h3 {...stylex.props(s.h3)}>Your clip</h3>
    <div {...stylex.props(s.cards)} role="group" aria-label="Your clip">
      <button type="button" id="build-src-recording" aria-pressed={src === 'recording'} onClick={() => setSrc('recording')} {...stylex.props(s.card, src === 'recording' && s.chosen)}>
        <Icon n="camera" /><strong>Use a recording</strong><span className="fine">A take you made on the Recording tab</span></button>
      <Dropzone id="build-src-upload" inputId="build-file" kind="footage" s={st} apply={apply} multiple accept="video/*,.mov,.mp4,.m4v,.webm,.mkv" label="Upload a video: drop files or press Enter to choose">
        <Icon n="upload" className="di" /><strong>Upload a video</strong><span>Drop it here or click to choose</span>
      </Dropzone>
      <button type="button" id="build-src-link" aria-pressed={src === 'link'} onClick={() => setSrc('link')} {...stylex.props(s.card, src === 'link' && s.chosen)}>
        <Icon n="link" /><strong>Paste a link</strong><span className="fine">A Dropbox, Google Drive or direct video link</span></button>
    </div>
    {src === 'recording' && <Recordings s={st} apply={apply} toNew={() => {}} />}
    {src === 'link' && <FootageLink s={st} apply={apply} />}
    <p id="build-have" className="fine" role="status" {...stylex.props(s.have)}>
      {n ? `${n} clip${n === 1 ? '' : 's'} in this video.` : 'No clip yet. You can also add one later.'}
      {fresh && <> <span id="build-fresh" {...stylex.props(s.chip)}>From Recording, {ago(fresh.at)}</span></>}
    </p>
    <h3 {...stylex.props(s.h3)}>How do you want to build it?</h3>
    <div {...stylex.props(s.cards)}>
      {TEMPLATES_READY && <button type="button" id="build-template" {...stylex.props(s.card, s.big)}><Icon n="spark" /><strong>Use a template</strong><span className="fine">Pick a look from your Template Library and go straight to your notes</span></button>}
      <button type="button" id="build-own" onClick={onBuild} {...stylex.props(s.card, s.big)}>
        <Icon n="right" /><strong>Build my own</strong><span className="fine">One choice per screen, starting with the pace</span></button>
    </div>
  </section>;
}
