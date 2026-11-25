import { Tiles } from './Tiles.jsx';

// Step 2: Caption type, asked first because how words come in moves kinetic words only.
const TYPES = [
  { id: 'captions', name: 'Just captions', preview: { src: 'docs/menu/caption-styles/classic.webp', animated: true, still: 'showcase/media/caption/classic.jpg' } },
  { id: 'kinetic', name: 'Kinetic words', preview: { src: 'docs/menu/caption-styles/kinetic.webp', animated: true, still: 'showcase/media/caption/kinetic.jpg' } },
];
export const TYPE_SAYS = { captions: 'Your words run along the bottom in one clean style.', kinetic: 'Your words arrive one by one, with the strongest word big.' };
export function CaptionType({ words, save, busy }) {
  return <Tiles id="build-type" label="Caption type" items={TYPES} value={words.type} disabled={busy}
    onChange={type => save(type === 'captions' ? { type, look: words.look && ['classic', 'pill', 'hormozi', 'karaoke'].includes(words.look) ? words.look : 'classic', entrance: null, keyWords: { level: 'off' } } : { type, look: words.look && ['kinetic', 'oneword', 'one-word'].includes(words.look) ? words.look : 'kinetic' })} />;
}
