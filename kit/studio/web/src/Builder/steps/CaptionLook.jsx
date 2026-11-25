import { Tiles, itemsOf } from './Tiles.jsx';
import { KINETIC_LOOKS, CAPTION_LOOKS } from '../../../../wizard/plan.mjs';

// Step 3: the caption look, from the looks that fit the caption type
export function CaptionLook({ CAT, step, words, save, busy, setHover }) {
  const ids = words.type === 'kinetic' ? KINETIC_LOOKS : CAPTION_LOOKS;
  return <Tiles id="build-look" label={step.title} items={itemsOf(CAT, ['captionStyle'], ids)} featured={step.featured} value={words.look} disabled={busy}
    onChange={look => save({ look })} onHover={x => setHover(x ? { look: x.id } : null)} />;
}
