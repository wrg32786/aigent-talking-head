import { Tiles, itemsOf } from './Tiles.jsx';

// Step 7: one font pairing for captions and titles (a bold face with a thin one)
export function Fonts({ CAT, step, words, save, busy, setHover }) {
  return <Tiles id="build-fonts" label={step.title} items={itemsOf(CAT, ['font'])} featured={step.featured} value={words.fonts} allowNone noneLabel="We pick" disabled={busy}
    onChange={fonts => save({ fonts })} onHover={x => setHover(x ? { fonts: x.id } : null)} />;
}
