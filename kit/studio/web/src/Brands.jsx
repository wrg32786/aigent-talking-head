// Words and brands: the glossary (words Whisper mishears, written your way in every draft's captions and titles,
// kit/glossary.cjs) and keyword logos (a plate with a brand's mark when its word is said, kit/brands.cjs). Logos are
// files you add here, or the kit's own Skool mark; nothing is downloaded.
import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { api, toast, Icon, IconBtn } from './lib.jsx';

const KIT_MARK = 'kit/example/skool-logo.svg';
const asText = g => (g || []).map(e => `${e.heard.join(' | ')} = ${e.say}${e.after && e.after.length ? ' after ' + e.after.join(', ') : ''}`).join('\n');

export function WordsBrands({ s, patch, apply }) {
  const [text, setText] = useState(asText(s.glossary)), [word, setWord] = useState(''), fileIn = useRef(null);
  const brands = s.brands || [], dirty = text !== asText(s.glossary);
  const saveWords = () => patch({ glossary: text.split('\n').map(x => x.trim()).filter(Boolean).join('; ') });
  const add = async f => {
    if (!word.trim()) { toast('Type the word first, e.g. Skool'); return; }
    const r = await fetch(`/api/upload?kind=brand&word=${encodeURIComponent(word.trim())}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'upload failed'); return; }
    apply(j); setWord(''); toast(`Logo added for "${word.trim()}"`, true);
  };
  const remove = w => patch({ brands: brands.filter(b => b.word !== w) });
  const kitSkool = () => patch({ brands: brands.filter(b => b.word.toLowerCase() !== 'skool').concat({ word: 'Skool', logo: KIT_MARK }) });
  return <section className="step" id="s-words" data-step="style" aria-labelledby="h-words">
    <div className="block glass-card">
      <div className="bh"><h3 id="h-words">Words and brands</h3></div>
      <div className="controls">
        <div className="ctl wide"><label className="lbl" htmlFor="glossary">Your words</label>
          <textarea id="glossary" rows={3} spellCheck="false" placeholder={'Agent Academy = AIgent Academy\nschool = Skool after on, in\nchat GBT | chat GPT = ChatGPT'} value={text} onChange={e => setText(e.target.value)} />
          <div className="row"><Button id="glossary-save" size="sm" variant="secondary" label="Save words" isDisabled={!dirty} onClick={saveWords} />
            <span className="fine">What Whisper writes = how you write it. Fixed in every draft; a word like AIgent keeps its own capitals.</span></div></div>
        <div className="ctl wide"><span className="lbl">Logos when you say a word</span>
          <ul className="brand-list" id="brand-list">
            {brands.map(b => <li key={b.word} data-word={b.word}><img src={'/api/brand?name=' + encodeURIComponent(b.logo)} alt="" height={28} /><b>{b.word}</b>
              <IconBtn n="x" label={`Remove the ${b.word} logo`} onClick={() => remove(b.word)} /></li>)}
            {!brands.length && <li className="fine">None yet. When a listed word is said, its logo lands on it for about a second.</li>}
          </ul>
          <div className="row"><label className="sr" htmlFor="brand-word">Word</label>
            <input id="brand-word" placeholder="Word, e.g. Skool" value={word} onChange={e => setWord(e.target.value)} />
            <Button id="brand-add" size="sm" variant="secondary" label="Add its logo" icon={<Icon n="upload" />} onClick={() => word.trim() ? fileIn.current.click() : toast('Type the word first, e.g. Skool')} />
            <input type="file" ref={fileIn} hidden accept=".svg,.png,.webp,.jpg,.jpeg,image/svg+xml,image/png,image/webp,image/jpeg" onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) add(f); }} />
            {!brands.some(b => b.logo === KIT_MARK) && <Button id="brand-skool" size="sm" variant="ghost" label="Use the kit's Skool mark" onClick={kitSkool} />}</div>
          <p className="fine">Use only logos you have the right to use.</p></div>
      </div>
    </div>
  </section>;
}
