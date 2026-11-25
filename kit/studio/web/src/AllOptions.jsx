import { useEffect, useRef, useState } from 'react';
import { Switch } from '@astryxdesign/core/Switch';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { file, toast, pickState, isPaused, Icon, KIND_NAME, showName, STEP_LAYERS, LAYER_STEP, LAYER_LABEL, layerOf, stepName } from './lib.jsx';
import { REF_LABEL, MADE_LABEL } from './RefCard.jsx';
import { contextOf, blockOf, needsOf } from '../../conflicts.mjs';

// All options: every layer's tiles (pick, forbid, search across layers), as the classic steps show them and as the
// builder's Your notes step shows them in its All options fold. Moved here unchanged from Style.jsx (Phase 7).
export function Layers({ step, bare, CAT, V, s, apply, patch, tab, setTab }) {
  const [q, setQ] = useState(''), [paused, setPaused] = useState(isPaused()), [tip, setTip] = useState(null);
  const tabsRef = useRef(null), gridRef = useRef(null), focusKey = useRef(null);
  const every = (CAT.layers || []).map(l => ({ ...l, label: LAYER_LABEL[l.id] || l.label }));
  // this step's layers, in the step's order; a layer the map does not know yet shows on Picture
  // step 'all' (the builder's All options): every layer, with its tabs and the search
  const mine = step === 'all' ? every.map(l => l.id) : STEP_LAYERS[step] || [], layers = [...mine.map(id => every.find(l => l.id === id)).filter(Boolean), ...(step === 'picture' ? every.filter(l => !LAYER_STEP[l.id]) : [])];
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
        {ql && step !== 'all' && g.layer && LAYER_STEP[g.layer] && LAYER_STEP[g.layer] !== step && <button type="button" className="linkish lg-jump" data-jump={g.layer} onClick={() => { setQ(''); setTab(g.layer); }}>Open in {stepName(LAYER_STEP[g.layer])}</button>}</h4>}
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
      {!ql && cur === 'motion' && <div className="layer-extra" id="motion-extra"><Switch id="punch" size="sm" label="Zoom punch on the cuts" value={s.pace.punch !== 'off'} onChange={on => patch({ pace: { punch: on ? 'on' : 'off' } })} />
        {V.motion && V.motion.on && <div className="motion-size" id="motion-size" data-motion={V.motion.value}><span className="lbl" id="motion-size-l">Camera moves</span>
          <SegmentedControl label="Camera moves" size="sm" value={V.motion.value} onChange={v => patch({ pace: { motion: v } })}>
            {V.motion.options.map(x => <SegmentedControlItem key={x.id} value={x.id} label={x.label} />)}</SegmentedControl></div>}</div>}
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

// one line when a pick turned something off, or a greyed option switched what it needed: what changed, and Undo
export function ChangeNote({ s, patch }) {
  const c = s.lastChange, [gone, setGone] = useState(null);
  if (!c || !c.text || gone === c.at) return null;
  return <p className="change-note glass-card" id="change-note" role="status"><Icon n="spark" /><span>{c.text}</span>
    <button type="button" className="linkish" id="change-undo" onClick={() => patch({ undoChange: true }).catch(() => {})}>Undo</button>
    <button type="button" className="x" aria-label="Dismiss" onClick={() => setGone(c.at)}><Icon n="x" /></button></p>;
}
