import { useEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { file, isPaused } from '../../lib.jsx';

// The live text preview (spec 7.1): the real caption renderer, kit/overlay.html, served by GET /api/preview/overlay
// for the words you chose, over the sample presenter. Two copies of the overlay: the titles layer under a cut-out of the
// presenter (so a title can sit behind the head) and the front layer on top, both seeked from one 6 s clock.
// With previews paused or reduced motion it shows one settled moment. Only one runs per screen.
const LOOP = 6, SETTLED = 2.2;
const s = stylex.create({
  box: { position: 'relative', overflow: 'hidden', borderRadius: 12, backgroundColor: 'var(--muted)', flexShrink: 0 },
  layer: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  frame: { position: 'absolute', top: 0, left: 0, width: 1080, height: 1920, borderWidth: 0, transformOrigin: '0 0', pointerEvents: 'none', backgroundColor: 'transparent', colorScheme: 'light' }, // the overlay page has no color scheme; a dark one here would paint the frame white
  bar: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 },
});
// the address part for a set of words (base64url JSON, as kit/studio/preview.mjs reads it)
export const keyOf = w => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(w || {})))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function LivePreview({ words, behind = false, width = 270, id = 'build-live', controls = true, label = 'Live preview of your words' }) {
  const [key, setKey] = useState(() => keyOf({ ...words, ...(behind ? { behind: true } : {}) })), [playing, setPlaying] = useState(!isPaused()), [ready, setReady] = useState(false);
  const back = useRef(null), front = useRef(null), t0 = useRef(performance.now());
  const want = keyOf({ ...words, ...(behind ? { behind: true } : {}) });
  // a new choice reloads the overlay after a short pause, so moving across tiles does not reload on every one
  useEffect(() => { if (want === key) return; const h = setTimeout(() => { setReady(false); setKey(want); }, 60); return () => clearTimeout(h); }, [want, key]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = playing ? ((performance.now() - t0.current) / 1000) % LOOP : SETTLED;
      for (const [ref, layer] of [[back, 'titles'], [front, 'front']]) { const w = ref.current && ref.current.contentWindow; if (w && w.__ready && w.seek) { try { w.seek(t, layer); } catch {} } }
      const ok = !!(front.current && front.current.contentWindow && front.current.contentWindow.__ready); if (ok !== ready) setReady(ok);
      if (playing || !ok) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing, key, ready]);
  const h = Math.round(width * 16 / 9), scale = width / 1080, src = `/api/preview/overlay/${key}/overlay.html`;
  const mask = { WebkitMaskImage: `url(${file('showcase/source/presenter-mask.png')})`, maskImage: `url(${file('showcase/source/presenter-mask.png')})`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%', maskMode: 'luminance' };
  return <figure id={id} data-key={key} data-ready={ready ? '1' : undefined} style={{ margin: 0 }}>
    <div {...stylex.props(s.box)} style={{ width, height: h }} role="img" aria-label={label}>
      <img src={file('showcase/source/presenter.jpg')} alt="" {...stylex.props(s.layer)} />
      <iframe ref={back} title="" aria-hidden="true" tabIndex={-1} src={src} {...stylex.props(s.frame)} style={{ transform: `scale(${scale})` }} />
      <img src={file('showcase/source/presenter.jpg')} alt="" {...stylex.props(s.layer)} style={mask} />
      <iframe ref={front} title="" aria-hidden="true" tabIndex={-1} src={src} {...stylex.props(s.frame)} style={{ transform: `scale(${scale})` }} />
    </div>
    {controls && <div {...stylex.props(s.bar)}>
      <button type="button" className="btn ghost sm" id={id + '-replay'} onClick={() => { t0.current = performance.now(); setPlaying(true); }}>Replay</button>
      <button type="button" className="btn ghost sm" id={id + '-pause'} aria-pressed={!playing} onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</button>
      <span className="fine" role="status">{ready ? '' : 'Loading the preview'}</span>
    </div>}
  </figure>;
}
