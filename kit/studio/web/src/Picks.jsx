// The Picks tray on the Look step: one quiet count that opens your picks grouped by layer. A group is one line: up to
// three short names (a made scene shows its name, never its id) and "+N" for the rest, which opens that layer.
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { toast, Icon } from './lib.jsx';
import { REF_LABEL, MADE_LABEL } from './RefCard.jsx';

const MAX = 3;
export const pickName = (cat, ref) => { const it = cat && cat.items[ref], id = ref.slice(ref.indexOf(':') + 1); return it && it.made ? it.made.name : /^ref-/.test(id) ? 'Made scene' : id; };

export function PicksTray({ s, patch, cat, added = [], openLayer }) {
  const layers = (cat && cat.layers) || [], from = new Set(added), groups = new Map();
  for (const [kind, p] of Object.entries(s.picks)) for (const [how, ids] of [['allow', p.allow], ['deny', p.deny]]) for (const id of ids) {
    const ref = `${kind}:${id}`, L = layers.find(l => l.items.includes(ref)) || { id: 'other', label: 'Other' };
    if (!groups.has(L.id)) groups.set(L.id, { ...L, picks: [] });
    groups.get(L.id).picks.push({ ref, deny: how === 'deny' });
  }
  const list = [...layers.map(l => groups.get(l.id)), groups.get('other')].filter(Boolean), n = list.reduce((a, g) => a + g.picks.length, 0);
  const r = s.reference, byRef = !!(r && r.extracted && r.mode !== 'off' && from.size);
  const undoRef = () => patch({ reference: { mode: 'off' } }).then(() => toast('Back to your own look. The reference is off.', true)).catch(() => {});
  if (!n) return <div className="picks" id="picksbar"><span className="none">No picks yet. Click a tile to pick it.</span><b id="pickcount" hidden>0</b></div>;
  return <Popover className="picks" id="picksbar">{({ close }) => <>
    <PopoverButton className="btn sm ghost picks-btn" id="picks-open">Picks <b id="pickcount">{n}</b><Icon n="up" /></PopoverButton>
    <PopoverPanel anchor={{ to: 'top start', gap: 10, padding: 8 }} className="menu-panel glass picks-panel" id="picks-panel" transition>
      <ul className="pk-groups" id="chips" aria-label="Your picks, by layer">{list.map(g => { const more = g.picks.length - MAX;
        return <li key={g.id} className="pk-g" data-layer={g.id}><span className="pk-l">{g.label}</span>
          <span className="pk-c">{g.picks.slice(0, MAX).map(({ ref, deny }) => { const it = cat.items[ref], nm = pickName(cat, ref), src = it && it.made ? MADE_LABEL : from.has(ref) && !deny ? REF_LABEL : null;
            return <button key={ref} type="button" className={'chip sm' + (deny ? ' deny' : ' on') + (src ? ' from-ref' : '')} data-pick={ref} title={src || undefined} onClick={() => patch({ picks: { [ref]: 'clear' } })} aria-label={`Remove ${deny ? 'forbid' : 'pick'} ${nm}${src ? ', ' + src.toLowerCase() : ''}`}>
              {deny ? <Icon n="ban" /> : src ? <i className="pk-dot" aria-hidden="true" /> : null}<span className="pk-n">{nm}</span><Icon n="x" /></button>; })}
            {more > 0 && <button type="button" className="pk-more" aria-label={`${more} more in ${g.label}, open the layer`} onClick={() => { if (openLayer && g.id !== 'other') openLayer(g.id); close(); }}>+{more}</button>}</span></li>; })}</ul>
      <div className="pk-f">
        {byRef && <button type="button" className="btn sm ghost" id="picks-undo-ref" onClick={() => { close(); undoRef(); }}>Undo reference</button>}
        <button type="button" className="btn sm ghost" id="clear-picks" onClick={() => { close(); patch({ clearPicks: true }); }}>Clear all</button>
      </div>
    </PopoverPanel></>}</Popover>;
}
