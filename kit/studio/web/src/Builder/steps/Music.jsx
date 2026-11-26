import { useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Toggle } from './Toggle.jsx';
import { Tiles } from './Tiles.jsx';
import { BedList } from '../../SoundTiles.jsx';
import { upload } from '../../upload.js';

// Step 16, last of the style steps: what plays under your voice. We pick, no music, a track you heard here, or your
// own file; then how lively, cutting on the beat, and sounds on the cuts. The same tiles and upload as the Music step.
const s = stylex.create({ h: { fontSize: 14, marginTop: 16, marginBottom: 8 }, list: { display: 'grid', gap: 10, marginTop: 12 }, own: { marginTop: 10 } });
const PICK = [['auto', 'We pick'], ['none', 'No music']].map(([id, name]) => ({ id, name, preview: null }));
const ENERGY = [['auto', 'Match the pace'], ['low', 'Low'], ['mid', 'Medium'], ['high', 'High']].map(([id, name]) => ({ id, name, preview: null }));
export const MUSIC_SAYS = { auto: 'We pick a track that fits the pace.', none: 'Just your voice.', upload: 'Your own track under your voice.' };
export function Music({ CAT, plan, save, busy, st, apply }) {
  const m = plan.music, fileIn = useRef(null), own = st && st.music && st.music.upload;
  return <>
    <Tiles id="build-mu" label="Music" items={PICK} value={['auto', 'none'].includes(m.bed) ? m.bed : null} disabled={busy} onChange={bed => save({ bed })} />
    <h3 {...stylex.props(s.h)}>Or choose a track</h3>
    <BedList CAT={CAT} value={m.bed} disabled={busy} onChoose={bed => save({ bed })} />
    <div {...stylex.props(s.own)}>
      {own && <button type="button" className={'btn sm ' + (m.bed === 'upload' ? '' : 'outline')} id="build-mu-mine" aria-current={m.bed === 'upload' ? 'true' : undefined} disabled={busy} onClick={() => save({ bed: 'upload' })}>{m.bed === 'upload' ? 'Using your file' : 'Use your file'}</button>}{' '}
      <button type="button" className="btn sm outline" id="build-mu-upload" disabled={busy} onClick={() => fileIn.current.click()}>{own ? 'Another file of your own' : 'Your own file'}</button>
      <input type="file" ref={fileIn} accept="audio/*" hidden onChange={e => { upload('music', [...e.target.files], st, apply); e.target.value = ''; }} />
    </div>
    {m.bed !== 'none' && <><h3 {...stylex.props(s.h)}>How lively</h3>
      <Tiles id="build-mu-energy" label="How lively the music is" items={ENERGY} value={m.energy} disabled={busy} onChange={energy => save({ energy })} /></>}
    <div {...stylex.props(s.list)}>
      {m.bed !== 'none' && <Toggle id="build-mu-beat" checked={m.beatSync !== false} disabled={busy} onChange={beatSync => save({ beatSync })}>Cut on the beat</Toggle>}
      <Toggle id="build-mu-sfx" checked={m.sfx} disabled={busy} onChange={sfx => save({ sfx })}>Sounds on the cuts</Toggle>
    </div>
  </>;
}
