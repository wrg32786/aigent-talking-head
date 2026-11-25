import { Tiles, itemsOf } from './Tiles.jsx';

// Step 3 for kinetic words: how each word arrives (None: the look's own way)
export function WordsIn({ CAT, step, words, save, busy, setHover }) {
  return <Tiles id="build-in" label={step.title} items={itemsOf(CAT, ['captionEntrance'])} featured={step.featured} value={words.entrance} allowNone noneLabel="The look's own" disabled={busy}
    onChange={entrance => save({ entrance })} onHover={x => setHover(x ? { entrance: x.id } : null)} />;
}
