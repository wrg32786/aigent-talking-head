import * as stylex from '@stylexjs/stylex';
import { Tiles } from './Tiles.jsx';

// Step 8 (kinetic words only): how big the strongest word of a line gets, its color and how many per line.
const s = stylex.create({ h: { fontSize: 14, marginTop: 0, marginBottom: 8 } });
const LEVELS = [['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong'], ['dramatic', 'Dramatic']].map(([id, name]) => ({ id, name, preview: null }));
const COLORS = [{ id: 'accent', name: 'Key word color' }, { id: 'text', name: 'Same as the text' }];
const PER = [{ id: 1, name: 'At most 1' }, { id: 2, name: 'At most 2' }];
export const KEY_SAYS = { off: 'Every word the same size as the look sets it.', subtle: 'The key word a little bigger.', strong: 'The key word clearly bigger.', dramatic: 'The key word huge, the rest small beside it.' };
export function KeyWords({ words, save, busy, setHover }) {
  const k = words.keyWords;
  return <>
    <section aria-labelledby="build-kl-h"><h3 id="build-kl-h" {...stylex.props(s.h)}>How big</h3>
      <Tiles id="build-kw" label="How big the key words get" items={LEVELS} value={k.level} disabled={busy}
        onChange={level => save({ keyWords: { level } })} onHover={x => setHover(x ? { keyWords: { ...k, level: x.id } } : null)} /></section>
    {k.level !== 'off' && <>
      <section aria-labelledby="build-kc-h"><h3 id="build-kc-h" {...stylex.props(s.h)}>Color</h3>
        <Tiles id="build-kc" label="Key word color" items={COLORS} value={k.color} disabled={busy} onChange={color => save({ keyWords: { color } })} /></section>
      <section aria-labelledby="build-kn-h"><h3 id="build-kn-h" {...stylex.props(s.h)}>How many per line</h3>
        <Tiles id="build-kn" label="Key words per line" items={PER} value={k.maxPerLine} disabled={busy} onChange={maxPerLine => save({ keyWords: { maxPerLine } })} /></section>
    </>}
  </>;
}
