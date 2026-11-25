import * as stylex from '@stylexjs/stylex';
import { Tiles } from './Tiles.jsx';

// Step 5: where words sit. A caption band (chest or lower third) and the places a title may take (left, right, above
// your head). Nothing here can put words on your face: the layout pass keeps every word off it in any case.
const s = stylex.create({ h: { fontSize: 14, marginTop: 0, marginBottom: 8 } });
const art = id => ({ src: `docs/menu/places/${id}.svg`, animated: false, still: `docs/menu/places/${id}.svg` });
const BANDS = [{ id: 'chest', name: 'Chest', preview: art('chest') }, { id: 'lower', name: 'Lower third', preview: art('lower') }];
const TITLES = [{ id: 'above', name: 'Above your head', preview: art('above') }, { id: 'left', name: 'Left side', preview: art('left') }, { id: 'right', name: 'Right side', preview: art('right') }];
export function Place({ words, save, busy, setHover }) {
  const p = words.place, kinetic = words.type === 'kinetic';
  return <>
    <section aria-labelledby="build-pc-h"><h3 id="build-pc-h" {...stylex.props(s.h)}>Captions</h3>
      <Tiles id="build-pc" label="Where captions sit" items={BANDS} value={p.captions} allowNone noneLabel="We pick" disabled={busy}
        onChange={captions => save({ place: { captions } })} onHover={x => setHover(x ? { place: { ...p, captions: x.id } } : null)} /></section>
    {kinetic && words.titles.on !== false && <section aria-labelledby="build-pt-h"><h3 id="build-pt-h" {...stylex.props(s.h)}>Big titles</h3>
      <Tiles id="build-pt" label="Where titles may sit" multi items={TITLES} value={p.titles} allowNone noneLabel="We pick" disabled={busy}
        onChange={titles => save({ place: { titles } })} onHover={x => setHover(x && x.id ? { place: { ...p, titles: [x.id] } } : null)} /></section>}
  </>;
}
