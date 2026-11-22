import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, quiet, file, toast, pickState, isPaused, Icon, IconBtn, KIND_NAME, RM, showName, STEP_LAYERS, LAYER_STEP, LAYER_LABEL, layerOf, stepName } from './lib.jsx';
import { RefMode, RefNotice, RefParts, RefPlan, REF_LABEL, MADE_LABEL, refName, refBrought, LookChips, SavedLookNote, TitleCheckLine } from './RefCard.jsx';
import { Fold } from './ui.jsx';
import { upload } from './upload.js';
import { WordsBrands } from './Brands.jsx';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { contextOf, blockOf, needsOf, controlOf } from '../../conflicts.mjs';

// Picture: how it looks. One Look, then the four picture layers (color, motion, transitions, layout).
export function Picture({ CAT, V, s, apply, patch, reloadCat, tab, setTab, go, looks }) {
  return <>
    <Looks CAT={CAT} V={V} s={s} apply={apply} patch={patch} reloadCat={reloadCat} go={go} setTab={setTab} looks={looks} />
    <Layers step="picture" CAT={CAT} V={V} s={s} apply={apply} patch={patch} tab={tab} setTab={setTab} />
  </>;
}

// Text and graphics: the words on screen, their type, and the graphics. Your own words and logos sit in a fold.
export function TextStep({ CAT, V, s, apply, patch, tab, setTab }) {
  return <>
    <section className="step" id="s-text" data-step="text" aria-labelledby="h-text">
      <header className="sh"><h2 id="h-text">Text and graphics</h2><p className="sub">Captions and titles, the type they use, and the graphics that sit over you.</p></header>
    </section>
    <Layers step="text" CAT={CAT} V={V} s={s} apply={apply} patch={patch} tab={tab} setTab={setTab} />
    <Fold id="words-fold" title="Your words and logos" className="step words-fold"><WordsBrands s={s} patch={patch} apply={apply} /></Fold>
  </>;
}

// Music and sounds: sound on its own step. The music, the sounds and the pace up front; every bed and sound in a fold.
export function Music({ CAT, V, s, apply, patch, tab, setTab }) {
  const ctx = contextOf(s, CAT, { effectsReady: !V || !V.env || V.env.effectsReady !== false });
  const brought = refBrought(s);
  return <>
    <section className="step" id="s-sound" data-step="music" aria-labelledby="h-sound">
      <header className="sh"><h2 id="h-sound">Music and sounds</h2><p className="sub">The music under your voice and the sounds on the cuts.</p></header>
      {brought && <p className="ref-brought glass-card" id="music-ref"><Icon n="spark" /><span><b>From your reference:</b> {brought}.</span></p>}
      <ChangeNote s={s} patch={patch} />
      <Sound CAT={CAT} s={s} apply={apply} patch={patch} ctx={ctx} />
    </section>
    <Fold id="sounds-fold" title="All music and sounds" className="step" defaultOpen={!!tab && layerOf(tab, CAT.layers) === 'audio'}><Layers step="music" bare CAT={CAT} V={V} s={s} apply={apply} patch={patch} tab={tab} setTab={setTab} /></Fold>
  </>;
}

// The b-roll layer (how b-roll sits: splits, match cuts, phone fans) for the B-roll step, in a fold
export function BrollLayer({ CAT, V, s, apply, patch, tab, setTab }) {
  return <Fold id="broll-layer-fold" title="How b-roll sits" className="step" defaultOpen={!!tab && layerOf(tab, CAT.layers) === 'broll'}><Layers step="broll" bare CAT={CAT} V={V} s={s} apply={apply} patch={patch} tab={tab} setTab={setTab} /></Fold>;
}

function SaveLook({ id, label, reloadCat, apply, variant = 'ghost' }) {
  const [name, setName] = useState(''), [msg, setMsg] = useState('');
  const save = e => { e.preventDefault(); api('/api/pack/save', { name: name.trim() }).then(async j => { await reloadCat(); apply(j); setMsg(`Saved as the Look ${j.pack}`); toast(`Saved as the Look ${j.pack}`, true); }).catch(() => {}); };
  return <Popover className="pop" id={id + '-pop'}><PopoverButton className={'btn sm ' + variant} id={id}>{label}</PopoverButton>
    <PopoverPanel anchor={{ to: 'bottom end', gap: 8, padding: 8 }} className="popover glass pop-panel" transition><form id={id + '-form'} onSubmit={save}><label className="lbl" htmlFor={id + '-name'}>Name the Look</label>
      <div className="row"><input id={id + '-name'} placeholder="my-look" pattern="[a-z0-9][a-z0-9\-]{1,40}" required value={name} onChange={e => setName(e.target.value)} /><Button type="submit" size="sm" variant="primary" label="Save" /></div>
      <span className="fine" role="status" id={id + '-msg'}>{msg}</span></form></PopoverPanel>
  </Popover>;
}

// Copy the look: keep this reference's look under a name, so it works on a new video with no reference at all
function SaveStyleLook({ saved, from }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const save = async (e, close) => { e.preventDefault(); const n = name.trim(); if (!n) return; setBusy(true);
    const ok = await saved.save(n); setBusy(false); if (ok) { toast(`Saved the look as ${n}. It is on Start for your next video.`, true); setName(''); close(); } else toast('We could not save that look. Try another name.'); };
  return <Popover className="pop" id="save-style-look-pop">{({ close }) => <><PopoverButton className="btn sm outline" id="save-style-look">Save as a look</PopoverButton>
    <PopoverPanel anchor={{ to: 'bottom end', gap: 8, padding: 8 }} className="popover glass pop-panel" transition><form id="save-style-look-form" onSubmit={e => save(e, close)}><label className="lbl" htmlFor="save-style-look-name">Name the look</label>
      <div className="row"><input id="save-style-look-name" placeholder={String(from || 'my look').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'my-look'} required maxLength={40} autoFocus value={name} onChange={e => setName(e.target.value)} /><Button type="submit" size="sm" variant="primary" label="Save" isLoading={busy} /></div>
      <span className="fine">Use it on any new video from Start, Copy the look.</span></form></PopoverPanel></>}
  </Popover>;
}

// The reference card's More menu: Save as a Look (asks for a name in place), Clear reference and the Breakdown
function RefMoreItems({ close, reloadCat, apply, clear, open, canSave = true }) {
  const [naming, setNaming] = useState(false), [name, setName] = useState('');
  const save = e => { e.preventDefault(); api('/api/pack/save', { name: name.trim(), fromReference: true }).then(async j => { await reloadCat(); apply(j); toast(`Saved as the Look ${j.pack}`, true); close(); }).catch(() => {}); };
  return <>
    {canSave && <button type="button" className="menu-item" id="save-ref-look" aria-expanded={String(naming)} aria-controls="save-ref-look-form" onClick={() => setNaming(v => !v)}><Icon n="plus" /><span>Save as a Look</span></button>}
    {canSave && naming && <form id="save-ref-look-form" className="ref-more-form" onSubmit={save}><label className="lbl" htmlFor="save-ref-look-name">Name the Look</label>
      <div className="row"><input id="save-ref-look-name" placeholder="my-look" pattern="[a-z0-9][a-z0-9\-]{1,40}" required autoFocus value={name} onChange={e => setName(e.target.value)} /><Button type="submit" size="sm" variant="primary" label="Save" /></div></form>}
    <button type="button" className="menu-item" id="ref-clear" onClick={() => { close(); clear(); }}><Icon n="trash" /><span>Clear reference</span></button>
    <button type="button" className="menu-item" id="ref-open" onClick={() => { close(); open(); }}><Icon n="film" /><span>Breakdown</span></button>
  </>;
}
function RefMore(props) {
  return <Popover className="pop ref-more-pop">{({ close }) => <>
    <PopoverButton className="btn sm ghost ref-more" id="ref-more">More<Icon n="down" /></PopoverButton>
    <PopoverPanel anchor={{ to: 'bottom end', gap: 8, padding: 8 }} className="menu-panel glass ref-more-panel" id="ref-more-panel" transition><RefMoreItems close={close} {...props} /></PopoverPanel>
  </>}</Popover>;
}

// One row of Looks (the built-in packs and the ones you saved) and the reference card when one is in use. In Recreate
// the reference sets the Look, so its card comes first and the Looks row steps back
function Looks({ CAT, V, s, apply, patch, reloadCat, go, setTab, looks: saved }) {
  const r = s.reference, ex = r.extracted, item = (r.queue || []).find(x => x.id === r.active);
  const looks = [{ name: null, label: 'No Look' }, ...CAT.packs.filter(p => !/^ref-/.test(p.name))];
  const clear = () => api('/api/reference/clear', {}).then(j => { apply(j); toast(j.note, true); }).catch(() => {});
  const undo = () => api('/api/reference/clear', { undo: true }).then(j => { apply(j); toast(j.note, true); }).catch(() => {});
  const sm = (ex && ex.summary) || {}, byRef = !!ex && (r.mode === 'recreate' || r.mode === 'look'), isLook = !!ex && r.mode === 'look';
  const picked = !ex && s.styleLook ? ((saved && saved.list) || []).find(x => x.name === s.styleLook) || { name: s.styleLook } : null;
  // the made chip: open the layer that holds the scenes made from the reference and bring that group into view
  const showMade = made => { const layer = made[0] && made[0].kind === 'effect' ? 'color' : 'graphics'; setTab(layer);
    let n = 0; const find = () => { const g = document.querySelector(`#grid[aria-labelledby="tab-${layer}"] [data-group="ref-made"]`); if (g) g.scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' }); else if (n++ < 30) requestAnimationFrame(find); }; requestAnimationFrame(find); };
  // your own picks on top of the Look: the moment Save as a new Look means something
  const changed = Object.values(s.picks || {}).some(p => (p.allow || []).length || (p.deny || []).length);
  const row = <div className="looks-wrap" key="looks">
    {byRef && <p className="fine looks-by-ref" id="looks-by-ref">Set by your reference</p>}
    <div id="looks" className={'packs looks' + (byRef ? ' by-ref' : '')} role="radiogroup" aria-label="Look" aria-describedby={byRef ? 'looks-by-ref' : undefined}>
      {looks.map(p => <button key={p.name || 'none'} className="pack" type="button" role="radio" data-look={p.name || ''} aria-checked={String((s.pack || null) === p.name)} title={p.description || (p.label || '').split(':')[0]} onClick={() => patch({ pack: p.name })}>
        <span className="pv">{p.preview ? <img src={file(p.preview)} alt="" loading="lazy" width={112} height={199} /> : <span className="ph">{p.name ? 'No preview' : 'No Look'}</span>}</span>
        <b>{p.name ? (p.shipped ? showName(p.name) : p.name) : 'No Look'}</b>{(!p.name || !p.shipped) && <small className="fine">{!p.name ? 'Studio picks the basics' : /reference/i.test(p.label || '') ? 'saved from a reference' : 'yours'}</small>}
      </button>)}
    </div>
    {changed && <SaveLook id="save-look" label="Save as a new Look" reloadCat={reloadCat} apply={apply} variant="outline" />}
  </div>;
  const card = ex ? <div className={'ref-card glass-card' + (byRef ? ' first' : '')} id="ref-card" key="card" data-mode={r.mode}>
    <div className="rc-h">
      <span className="src src-ref">Reference</span>
      <div className="rc-t"><b id="ref-card-name">{isLook ? `Your look from ${refName(s)}` : refName(s)}</b>
        <span className="fine" id="ref-card-meta">{[sm.seconds ? `${Math.round(sm.seconds)} s` : null, ex.shots ? `${ex.shots} shots` : null].filter(Boolean).join(', ')}</span></div>
      {isLook && saved && saved.on && <SaveStyleLook saved={saved} from={refName(s)} />}
      <RefMore reloadCat={reloadCat} apply={apply} clear={clear} open={() => go && go('reference', true)} canSave={!(isLook && saved && saved.on)} />
    </div>
    <RefMode id="ref-card-mode" mode={r.mode} patch={patch} />
    <SavedLookNote V={V} apply={apply} />
    {r.mode === 'influence' && <RefParts V={V} s={s} patch={patch} />}
    <RefPlan ex={ex} mode={r.mode} onMade={showMade} />
    <TitleCheckLine s={s} go={go} />
  </div> : picked ? <div className="ref-card glass-card first" id="look-card" key="card">
    <div className="rc-h"><span className="src src-ref">Saved look</span>
      <div className="rc-t"><b id="look-card-name">Your look from {picked.name}</b><span className="fine">Its style on your own words. Change anything you like.</span></div>
      <Button id="look-card-off" size="sm" variant="ghost" label="Stop using it" onClick={() => saved && saved.pick(null)} /></div>
    <LookChips summary={picked.summary} id="look-card-chips" />
  </div> : s.undoRef ? <p className="fine ref-undo" id="ref-undo" key="undo">Reference cleared. <button type="button" className="linkish" id="ref-undo-btn" onClick={undo}>Undo</button></p> : null;
  return <section className="step" id="s-look" data-step="picture" aria-labelledby="h-look">
    <header className="sh look-h"><div><h2 id="h-look">Picture</h2><p className="sub">Pick one Look, then change the color, motion, transitions or layout below if you want to.</p></div></header>
    {!ex && <RefNotice s={s} patch={patch} />}
    {byRef || picked ? [card, row] : [row, card]}
  </section>;
}

// The 9 layers (kit/studio/categories.json layers): every option in exactly one, with a badge for where a choice came from
function Layers({ step, bare, CAT, V, s, apply, patch, tab, setTab }) {
  const [q, setQ] = useState(''), [paused, setPaused] = useState(isPaused()), [tip, setTip] = useState(null);
  const tabsRef = useRef(null), gridRef = useRef(null), focusKey = useRef(null);
  const every = (CAT.layers || []).map(l => ({ ...l, label: LAYER_LABEL[l.id] || l.label }));
  // this step's layers, in the step's order; a layer the map does not know yet shows on Picture
  const mine = STEP_LAYERS[step] || [], layers = [...mine.map(id => every.find(l => l.id === id)).filter(Boolean), ...(step === 'picture' ? every.filter(l => !LAYER_STEP[l.id]) : [])];
  // an old tab name (#menu=captions) opens the layer that now holds it
  const want = layerOf(tab, every), cur = layers.some(c => c.id === want) ? want : (layers[0] || {}).id;
  const L = layers.find(x => x.id === cur), ql = q.trim().toLowerCase();
  useEffect(() => { if (focusKey.current) { const b = [...gridRef.current.querySelectorAll('[data-focus]')].find(x => x.dataset.focus === focusKey.current); if (b) b.focus({ preventScroll: true }); focusKey.current = null; } });
  const match = it => !ql || it.id.includes(ql) || showName(it.id).toLowerCase().includes(ql) || (it.made && it.made.name.toLowerCase().includes(ql)) || (it.label || '').toLowerCase().includes(ql);
  // search looks across every layer, so you never need to know which one holds it
  // (and the step that holds it is one click away)
  const groups = ql ? every.flatMap(l => l.groups.map(g => ({ ...g, key: l.id + ':' + g.id, layer: l.id, label: l.label === g.label ? l.label : `${l.label}: ${g.label}`, items: g.items.filter(r => match(CAT.items[r])) }))).filter(g => g.items.length) : L ? L.groups : [];
  const togglePause = () => { localStorage.setItem('studio.paused', paused ? '0' : '1'); setPaused(!paused); };
  const keyTabs = e => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const i = layers.findIndex(x => x.id === cur); const n = layers[(i + (e.key === 'ArrowRight' ? 1 : layers.length - 1)) % layers.length].id; setTab(n); requestAnimationFrame(() => document.getElementById('tab-' + n)?.focus()); };
  const setPick = (it, how, key) => { focusKey.current = key; patch({ picks: { [it.ref]: how } }); };
  const src = V && V.look ? { pack: new Set(V.look.pack), ref: new Set(V.look.ref), added: new Set(V.look.added) } : { pack: new Set(), ref: new Set(), added: new Set() };
  // why the reference picked it (kit/studio/reference.mjs summarize), shown on the tile's card and on the layer line
  const why = (V && V.look && V.look.why) || {}, whyOf = (it, sc) => (sc === 'ref' && why[it.ref]) || null;
  const nameOf = it => (it.made ? it.made.name : it.id);
  // a badge only on what is picked (or set by the Look): From reference, Yours or From the Look
  const sourceOf = (it, st) => st === 'allow' ? (src.added.has(it.ref) ? 'ref' : 'you') : st ? null : src.pack.has(it.ref) ? 'look' : null;
  // what rules out what (kit/studio/conflicts.mjs, the same rules the server and the agent use)
  const ctx = contextOf(s, CAT, { effectsReady: !V || !V.env || V.env.effectsReady !== false });
  const refOn = s.reference && s.reference.mode !== 'off' && s.reference.extracted;
  const refPicks = x => refOn ? x.items.filter(r => CAT.items[r] && src.added.has(r) && pickState(s, CAT.items[r]) === 'allow') : [];
  const refIn = x => refPicks(x).length;
  // one short line for the layer: the first pick with its reason, and how many more
  const refLine = x => { const p = refPicks(x); if (!p.length) return null; const first = p.find(r => why[r]) || p[0], more = p.length - 1;
    return `From the reference: ${nameOf(CAT.items[first])}${why[first] ? ', ' + why[first] : ''}${more > 0 ? `, and ${more} more` : ''}.`; };
  // the Fonts layer says whose font the next draft uses while a reference's style is copied (kit/studio/reference.mjs)
  const rf = V && V.refFont, fontLine = !rf ? null : rf.locked ? `Your font is used, not the one from your ${rf.from === 'look' ? 'saved look' : 'reference'}.`
    : `From your ${rf.from === 'look' ? 'saved look' : 'reference'}: ${rf.font ? `${rf.font.face || 'its font'}${rf.font.kind ? ', ' + rf.font.kind : ''}` : 'its fonts'}. Pick one here to use yours instead.`;
  if (!L) return null;
  const grid = <div id="grid" className="layer-groups" role={bare ? 'group' : 'tabpanel'} aria-labelledby={bare ? undefined : 'tab-' + cur} aria-label={bare ? L.label : undefined} data-layer={cur} ref={gridRef}>
    {groups.length ? groups.map(g => <section key={g.key || g.label} className="lg" data-group={g.id} aria-label={g.label}>
      {(groups.length > 1 || ql) && <h4 className="lg-h">{g.label}<span className="fine"> {g.items.length}</span>
        {ql && g.layer && LAYER_STEP[g.layer] && LAYER_STEP[g.layer] !== step && <button type="button" className="linkish lg-jump" data-jump={g.layer} onClick={() => { setQ(''); setTab(g.layer); }}>Open in {stepName(LAYER_STEP[g.layer])}</button>}</h4>}
      <div className="grid">{g.items.map(r => CAT.items[r]).filter(Boolean).map(it => { const st = pickState(s, it); const block = st === 'deny' ? null : blockOf(it, ctx); const sc = sourceOf(it, st); return <Tile key={it.ref} it={it} st={st} src={sc} why={whyOf(it, sc)} paused={paused} setPick={setPick} setTip={setTip} block={block} need={needsOf(it, ctx)} sw={() => { focusKey.current = 'p:' + it.ref; patch({ switchFor: it.ref }); }} />; })}</div>
    </section>) : <p className="fine">Nothing matches that search.</p>}
  </div>;
  // one layer in a fold (Music and sounds, B-roll): just its tiles
  if (bare) return <div className="layer-bare" id="s-menu" data-step={step}>{L.hint && <p className="fine" id="tabhint">{L.hint}</p>}{grid}<HoverCard tip={tip} /></div>;
  return <section className="step" id="s-menu" data-step={step} aria-labelledby="h-menu">
    <div className="block glass-card">
      <div className="bh"><h3 id="h-menu" className="sr">Layers</h3>
        <div className="tabs" role="tablist" id="tabs" aria-label="Layers" ref={tabsRef} onKeyDown={keyTabs}>
          {layers.map(x => { const any = x.items.some(r => pickState(s, CAT.items[r]));
            return <button key={x.id} className="tab" role="tab" type="button" id={'tab-' + x.id} aria-selected={String(x.id === cur)} aria-controls="grid" tabIndex={x.id === cur ? 0 : -1} onClick={() => setTab(x.id)}>
              {x.label}{refIn(x) > 0 ? <span className="pd pd-ref" title={REF_LABEL} aria-label="has picks from the reference" /> : any && <span className="pd" title="has your picks" aria-label="has your picks" />}</button>; })}
        </div>
        <div className="tools">
          <label className="search"><Icon n="search" /><span className="sr">Filter effects</span><input id="filter" type="search" placeholder="Search all" aria-label="Filter effects" value={q} onChange={e => setQ(e.target.value)} /></label>
          <button type="button" className="btn sm ghost pause-btn" id="pause" aria-pressed={String(paused)} onClick={togglePause}><Icon n={paused ? 'play' : 'pause'} />{paused ? 'Play previews' : 'Pause previews'}</button>
        </div>
      </div>
      <label className="tabselect"><span className="sr">Layer</span><select id="tabselect" value={cur} onChange={e => setTab(e.target.value)}>{layers.map(x => <option key={x.id} value={x.id}>{x.label} ({x.count})</option>)}</select></label>
      <p id="tabhint" className="fine">{ql ? `Every step, matching "${q.trim()}".` : L.hint || ''}{!ql && refIn(L) > 0 && <span className="layer-ref" id="layer-ref" data-n={refIn(L)}>{refLine(L)}</span>}{!ql && cur === 'fonts' && fontLine && <span className="layer-ref" id="font-ref" data-locked={String(!!(V.refFont && V.refFont.locked))}>{fontLine}</span>}</p>
      <ChangeNote s={s} patch={patch} />
      {!ql && cur === 'motion' && <div className="layer-extra" id="motion-extra"><Switch id="punch" size="sm" label="Zoom punch on the cuts" value={s.pace.punch !== 'off'} onChange={on => patch({ pace: { punch: on ? 'on' : 'off' } })} /></div>}
      {!ql && cur === 'text' && <div className="layer-extra" id="text-extra"><Switch id="boost" size="sm" label="Make hard-to-read words easier to read" value={V && V.boost ? V.boost.on : s.boost !== 'off'} onChange={on => patch({ boost: on ? 'on' : 'off' })} /></div>}
      {grid}
    </div>
    <HoverCard tip={tip} />
  </section>;
}

// A tile wears one label: "Made for you" on a scene made from a reference (or by your agent), "From reference" on a
// built-in option the reference picked, and YOU or LOOK for the other two sources.
const SRC = { you: 'YOU', ref: REF_LABEL, look: 'LOOK' }, SRC_TIP = { you: 'Your pick', ref: 'Picked by the reference', look: 'From the Look' };
function Tile({ it, st, src, why, paused, setPick, setTip, block, need, sw }) {
  const info = it.mode === 'info', kind = KIND_NAME[it.kind] || it.kind, canDeny = !info && it.mode !== 'one' && !block, did = 'd-' + it.ref.replace(/[^a-z0-9]/gi, '-');
  const still = paused && it.preview && it.preview.animated ? it.preview.still : null, showAnim = it.preview && (!paused || !it.preview.animated);
  const flag = info ? 'info' : it.needsCopy ? 'your words' : null;
  const pv = p => (p && p.url) || (p && p.src ? file(p.src) : null);
  const deny = () => setPick(it, st === 'deny' ? 'clear' : 'deny', 'p:' + it.ref);
  return <div className={`tile ${st || ''} ${info ? 'info' : ''} ${block ? 'blocked' : ''} ${it.made ? 'scene' : ''}`} data-blocked={block ? block.id : undefined} onMouseEnter={e => setTip({ el: e.currentTarget, it, block, need, why })} onMouseLeave={() => setTip(null)} onFocus={e => setTip({ el: e.currentTarget, it, block, need, why })} onBlur={() => setTip(null)}>
    <button className="pick" type="button" data-focus={'p:' + it.ref} aria-pressed={info ? undefined : String(st === 'allow')} aria-describedby={did}
      aria-label={info ? `${it.id}, ${kind}, shown for reference` : block ? `${it.id}, ${kind}. ${block.reason}. ${block.act}` : `Pick ${it.id}, ${kind}`}
      onClick={() => { if (info) return toast(`${it.id} is set by your agent. Ask for it in the chat.`, true); if (block) return sw(); setPick(it, st === 'allow' ? 'clear' : 'allow', 'p:' + it.ref); }}
      onContextMenu={e => { if (!canDeny) return; e.preventDefault(); deny(); }}
      onKeyDown={e => { if ((e.key === 'f' || e.key === 'F') && canDeny) { e.preventDefault(); deny(); } }}>
      <span className="media">{showAnim ? <img src={pv(it.preview)} alt="" loading="lazy" decoding="async" width={120} height={160} /> : still ? <img src={file(still)} alt="" loading="lazy" width={120} height={160} /> : <span className="np">{it.preview ? 'Paused' : it.id}</span>}</span>
      <span className="nm">{it.made ? it.made.name : showName(it.id)}</span>{block ? <span className="ds why" id={did}>{block.reason}</span> : <span className="ds" id={did}>{why ? `From the reference: ${why}. ` : ''}{it.label || ''}</span>}
    </button>
    {!block && (need || flag) && <span className={'flag' + (need ? ' need' : '')} aria-hidden="true">{need ? 'Needs setup' : flag}</span>}
    {it.made && <span className="made" title={it.made.by === 'agent' ? 'Made by your agent' : 'Made from a reference'} data-made={it.made.by}>{MADE_LABEL}<span className="sr">, {it.made.by === 'agent' ? 'by your agent' : 'from a reference'}</span></span>}
    {src && !it.made && <span className={'src src-' + src} title={SRC_TIP[src]} data-src={src}>{SRC[src]}{src !== 'ref' && <span className="sr">, {SRC_TIP[src]}</span>}</span>}
    <span className="state" aria-hidden="true">{st === 'allow' ? <Icon n="check" /> : st === 'deny' ? <Icon n="x" /> : null}</span>
    {canDeny && <button className="forbid" type="button" data-focus={'f:' + it.ref} aria-pressed={String(st === 'deny')} aria-label={`Forbid ${it.id}`} title={st === 'deny' ? 'Forbidden. Click to allow again.' : 'Forbid'} onClick={() => setPick(it, st === 'deny' ? 'clear' : 'deny', 'f:' + it.ref)}><Icon n="ban" /></button>}
  </div>;
}

// One hover card for the whole grid: the detail for a tile, instead of text on every tile.
function HoverCard({ tip }) {
  const ref = useRef(null), [pos, setPos] = useState({ left: -999, top: 0 });
  useEffect(() => {
    if (!tip || !ref.current) return;
    const r = tip.el.getBoundingClientRect(), w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    let x = r.right + 8, y = r.top;
    if (x + w > innerWidth - 8) x = r.left - w - 8;
    if (x < 8) { x = Math.max(8, Math.min(innerWidth - w - 8, r.left)); y = r.bottom + 8; }
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
    setPos({ left: x, top: y });
  }, [tip]);
  const it = tip && tip.it;
  return <div id="tip" ref={ref} className="hovercard glass" role="tooltip" hidden={!tip} style={{ left: pos.left, top: pos.top }}>
    {it && <><span className="k">{it.made ? (it.made.kind === 'effect' ? 'Effect, made for you' : 'Graphic, made for you') : KIND_NAME[it.kind] || it.kind}</span><b>{it.made ? it.made.name : showName(it.id)}</b>{it.label && <p>{it.label}</p>}
      {tip.why && <p className="why ref" id="tip-ref">From the reference: {tip.why}.</p>}
      {tip.block ? <p className="why" id="tip-why"><b>{tip.block.reason}.</b> {tip.block.why} Click to {tip.block.act[0].toLowerCase() + tip.block.act.slice(1)}.</p> : tip.need ? <p className="why need" id="tip-why">{tip.need}</p> : null}
      {tip.block ? null : it.mode === 'info' ? <p className="k">Shown so you know it exists. Your agent can set it.</p> : <p className="k">{it.mode === 'one' ? 'Click to pick. One per reel.' : 'Click to pick. Right-click or F to forbid.'}</p>}</>}
  </div>;
}

function Seg({ id, label, value, onChange, options, off }) {
  return <div id={id}><SegmentedControl label={label} value={value} onChange={onChange} size="sm" isDisabled={!!off} disabledMessage={off || undefined}>{options.map(([v, l]) => <SegmentedControlItem key={v} value={v} label={l} />)}</SegmentedControl></div>;
}

// The sound controls, two calm groups: Music (the bed, its energy, beat sync) and Sounds (on or off, fewer), and one
// line that says the Pacing and points to the Cut step, where it is set
function Sound({ CAT, s, apply, patch, ctx }) {
  const en = controlOf('energy', ctx), cp = controlOf('cap', ctx);
  const audio = useRef(null), musicIn = useRef(null), [playing, setPlaying] = useState(false);
  const b = CAT.beds.find(x => x.id === s.music.bed), src = b ? file(b.file) : s.music.bed === 'upload' && s.music.upload ? file(s.music.upload) : '';
  useEffect(() => { const a = audio.current; if (!a) return; a.pause(); if (src) a.src = src; else a.removeAttribute('src'); }, [src]);
  // Pacing is one control, on the Cut step (kit/studio/pacing.mjs). Here we only say what it is set to
  const tg = s.pace.tighten, paceName = tg == null ? 'set by your Look' : tg === 'off' ? 'Natural' : +tg <= 0.3 ? 'Very tight' : 'Tight';
  const noBed = s.music.bed === 'none', sync = !((s.picks.beatSync || { allow: [] }).allow || []).includes('no-beat-sync');
  return <div id="s-music" className="sound-cards">
    <div className="block glass-card sound-card" role="group" aria-labelledby="h-music">
      <h3 className="lbl" id="h-music">Music</h3>
      <div className="row">
        <label className="sr" htmlFor="bed">Music</label>
        <select id="bed" value={s.music.bed} onChange={e => patch({ music: { bed: e.target.value } })}>
          <option value="auto">Picked for you</option><option value="none">No music</option><option value="upload" disabled={!s.music.upload}>My upload</option>
          {CAT.beds.map(x => <option key={x.id} value={x.id}>{x.title} ({x.energy}, {Math.round(x.seconds)} s)</option>)}
        </select>
        <IconBtn id="bed-play" n={playing ? 'pause' : 'play'} label={playing ? 'Pause the music' : 'Play the music'} disabled={!src} onClick={() => { const a = audio.current; if (a.paused) a.play().catch(() => {}); else a.pause(); }} />
        <audio id="bed-audio" ref={audio} preload="none" hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        <Button id="drop-music" variant="ghost" size="sm" label="Your own" icon={<Icon n="upload" />} onClick={() => musicIn.current.click()} />
        <input type="file" id="file-music" ref={musicIn} accept="audio/*" hidden onChange={e => { upload('music', [...e.target.files], s, apply); e.target.value = ''; }} />
      </div>
      <div className="ctl"><span className="lbl">Energy</span>
        <Seg id="energy" label="Energy" value={s.music.energy} onChange={v => patch({ music: { energy: v } })} options={[['auto', 'Auto'], ['low', 'Low'], ['mid', 'Mid'], ['high', 'High']]} off={en && en.reason} />
        {en && <span className="fine ctl-off" id="energy-off">{en.reason}. <button type="button" className="linkish" onClick={() => patch(en.fix)}>{en.act}</button></span>}</div>
      <Switch id="beat-sync" size="sm" label="Land the cuts and sounds on the beat" value={sync && !noBed} isDisabled={noBed} disabledMessage={noBed ? 'There is no music to follow' : undefined} onChange={on => patch({ picks: { 'beatSync:no-beat-sync': on ? 'clear' : 'allow' } })} />
    </div>
    <div className="block glass-card sound-card" role="group" aria-labelledby="h-sfx">
      <h3 className="lbl" id="h-sfx">Sounds</h3>
      <Switch id="sfx" size="sm" label="Sounds on the cuts" value={s.sound.sfx !== 'off'} onChange={on => patch({ sound: { sfx: on ? 'on' : 'off' } })} />
      <Switch id="cap" size="sm" label="Fewer sounds, only the strong moments" value={s.sound.cap !== 'off'} onChange={on => patch({ sound: { cap: on ? 'on' : 'off' } })} isDisabled={!!cp} disabledMessage={cp ? cp.reason : undefined} />
    </div>
    <p className="fine sound-pace" id="pacing-line">Pacing: <b>{paceName}</b>. <a className="linkish" href="#step=cut" onClick={() => localStorage.setItem('studio.cutLayer', 'clips')}>Change it on Cut</a></p>
  </div>;
}

// one line when a pick turned something off, or a greyed option switched what it needed: what changed, and Undo
export function ChangeNote({ s, patch }) {
  const c = s.lastChange, [gone, setGone] = useState(null);
  if (!c || !c.text || gone === c.at) return null;
  return <p className="change-note glass-card" id="change-note" role="status"><Icon n="spark" /><span>{c.text}</span>
    <button type="button" className="linkish" id="change-undo" onClick={() => patch({ undoChange: true }).catch(() => {})}>Undo</button>
    <button type="button" className="x" aria-label="Dismiss" onClick={() => setGone(c.at)}><Icon n="x" /></button></p>;
}
