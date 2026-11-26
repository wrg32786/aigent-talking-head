import * as stylex from '@stylexjs/stylex';
import { RadioGroup, Radio } from '@headlessui/react';
import { Tiles, itemsOf } from './Tiles.jsx';
import { NeedFix } from '../../Fix.jsx';
import { PRESENTER_EFFECTS } from '../../../../wizard/plan.mjs';

// Step 11: presenter effects. Words behind your head, Zoom punch, Frame breakout and the camera and room effects, each
// picked one with when it plays: the hook, key moments (the hook, the call to action and the big punches) or the whole
// video. Catalog effects play at Render only with the effects add-on; without it they say so, with its Set up button.
const s = stylex.create({
  h: { fontSize: 14, marginTop: 0, marginBottom: 8 },
  list: { display: 'grid', gap: 8, marginTop: 12 },
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  name: { minWidth: 160, fontWeight: 600 },
  seg: { display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' },
  opt: { paddingBlock: 4, paddingInline: 10, borderRadius: 999, cursor: 'pointer', fontSize: 13, outlineStyle: { default: 'none', ':focus-visible': 'solid' }, outlineWidth: 2, outlineColor: 'var(--primary)', outlineOffset: 2,
    backgroundColor: { default: 'transparent', ':is([data-checked])': 'var(--primary)' }, color: { default: 'inherit', ':is([data-checked])': 'var(--primary-foreground, #fff)' } },
  onText: { fontWeight: 700 },
});
const OWN = [['behind-head', 'Words behind your head'], ['punch', 'Zoom punch'], ['frame-breakout', 'Frame breakout']];
const WHEN = [['hook', 'Hook'], ['key-moments', 'Key moments'], ['whole', 'Whole video']];
// words behind your head: where it fits (the agent picks the titles), or every title
const BEHIND = [['key-moments', 'Where it fits'], ['whole', 'Every title']];
// what each item may be set to (Zoom punch is the whole video for now; frame breakout in repo mode uses the framed cards)
const optsFor = id => (id === 'punch' || id === 'frame-breakout' ? [] : id === 'behind-head' ? BEHIND : WHEN);
const nameOf = (id, items) => (OWN.find(o => o[0] === id) || [0, (items.find(x => x.id === id) || {}).name || id])[1];

export function Presenter({ CAT, step, plan, save, busy, setHover, V, apply }) {
  const pres = plan.presenter, ready = !(V && V.env && V.env.effectsReady === false);
  const items = [...OWN.map(([id, name]) => ({ id, name, preview: id === 'behind-head' ? ((CAT && CAT.items['titleLayer:behind']) || {}).preview || null : null })),
    ...itemsOf(CAT, ['effect'], [...PRESENTER_EFFECTS]).map(x => ({ ...x, id: 'effect:' + x.id, name: ready ? x.name : `${x.name} (needs the effects add-on)` }))];
  const featured = ['behind-head', 'punch', 'frame-breakout', ...(step.featured || []).map(id => 'effect:' + id)];
  const pick = ids => save(ids.map(id => pres.find(x => x.id === id) || { id, when: id === 'punch' || String(id).startsWith('effect:') ? 'whole' : id === 'behind-head' ? 'key-moments' : 'whole' }));
  const setWhen = (id, when) => save(pres.map(x => (x.id === id ? { ...x, when } : x)));
  const fx = pres.some(x => String(x.id).startsWith('effect:'));
  return <>
    <Tiles id="build-pres" label="Presenter effects" items={items} featured={featured} value={pres.map(x => x.id)} multi allowNone disabled={busy} onChange={pick} onHover={setHover} />
    {pres.length > 0 && <section aria-labelledby="build-pw-h" {...stylex.props(s.list)}><h3 id="build-pw-h" {...stylex.props(s.h)}>When each one plays</h3>
      {pres.map(x => <div key={x.id} {...stylex.props(s.row)}>
        <span {...stylex.props(s.name)} id={`build-pw-${x.id.replace(':', '-')}`}>{nameOf(x.id, items)}</span>
        {optsFor(x.id).length ? <RadioGroup value={x.id === 'behind-head' && x.when === 'hook' ? 'key-moments' : x.when} onChange={w => setWhen(x.id, w)} aria-labelledby={`build-pw-${x.id.replace(':', '-')}`} disabled={busy} data-when-for={x.id} {...stylex.props(s.seg)}>
          {optsFor(x.id).map(([id, label]) => <Radio key={id} value={id} data-when={id} {...stylex.props(s.opt)}>{({ checked }) => <span {...stylex.props(checked && s.onText)}>{checked ? <span aria-hidden="true">{'\u2713 '}</span> : ''}{label}</span>}</Radio>)}
        </RadioGroup> : <span className="fine">{x.id === 'punch' ? 'The whole video' : x.id === 'frame-breakout' && plan.content && plan.content.repoFeature ? 'On the repo split shots' : 'Kept in your plan. It does not show in your video yet.'}</span>}
      </div>)}
    </section>}
    {fx && !ready && V && <NeedFix V={V} ids={['effects']} what="The camera and room effects" apply={apply} />}
  </>;
}
