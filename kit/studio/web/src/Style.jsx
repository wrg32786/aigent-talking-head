import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { Kbd } from '@astryxdesign/core/Kbd';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, file, toast, pickState, isPaused, Icon, IconBtn, KIND_NAME } from './lib.jsx';
import { upload } from './upload.js';
import { WordsBrands } from './Brands.jsx';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';

export function Style({ CAT, V, s, apply, patch, reloadCat, hidden, tab, setTab, go }) {
  return <>
    <Looks CAT={CAT} V={V} s={s} apply={apply} patch={patch} reloadCat={reloadCat} hidden={hidden} go={go} />
    <Layers CAT={CAT} V={V} s={s} apply={apply} patch={patch} hidden={hidden} tab={tab} setTab={setTab} />
    {!hidden && <WordsBrands s={s} patch={patch} apply={apply} />}
  </>;
}

const MODE = [['recreate', 'Use all'], ['influence', 'Use parts'], ['off', 'Off']];
function SaveLook({ id, label, fromReference, reloadCat, apply, variant = 'ghost' }) {
  const [name, setName] = useState(''), [msg, setMsg] = useState('');
  const save = e => { e.preventDefault(); api('/api/pack/save', { name: name.trim(), fromReference: !!fromReference }).then(async j => { await reloadCat(); apply(j); setMsg(`Saved as the Look ${j.pack}`); toast(`Saved as the Look ${j.pack}`, true); }).catch(() => {}); };
  return <Popover className="pop" id={id + '-pop'}><PopoverButton className={'btn sm ' + variant} id={id}>{label}</PopoverButton>
    <PopoverPanel anchor={{ to: 'bottom end', gap: 8, padding: 8 }} className="popover glass pop-panel" transition><form id={id + '-form'} onSubmit={save}><label className="lbl" htmlFor={id + '-name'}>Name the Look</label>
      <div className="row"><input id={id + '-name'} placeholder="my-look" pattern="[a-z0-9][a-z0-9\-]{1,40}" required value={name} onChange={e => setName(e.target.value)} /><Button type="submit" size="sm" variant="primary" label="Save" /></div>
      <span className="fine" role="status" id={id + '-msg'}>{msg}</span></form></PopoverPanel>
  </Popover>;
}

// One row of Looks (the built-in packs and the ones you saved), then the reference card when one is in use
function Looks({ CAT, V, s, apply, patch, reloadCat, hidden, go }) {
  const r = s.reference, ex = r.extracted, item = (r.queue || []).find(x => x.id === r.active);
  const looks = [{ name: null, label: 'Your picks only' }, ...CAT.packs.filter(p => !/^ref-/.test(p.name))];
  const clear = () => api('/api/reference/clear', {}).then(j => { apply(j); toast(j.note, true); }).catch(() => {});
  const undo = () => api('/api/reference/clear', { undo: true }).then(j => { apply(j); toast(j.note, true); }).catch(() => {});
  const sm = (ex && ex.summary) || {}, mu = sm.music || {};
  return <section className="step" id="s-look" data-step="style" aria-labelledby="h-look" hidden={hidden}>
    <header className="sh look-h"><div><h2 id="h-look">Look</h2><p className="sub">One Look sets every layer. Change any layer below; the badge says where each choice came from.</p></div>
      <SaveLook id="save-look" label="Save as a new Look" reloadCat={reloadCat} apply={apply} variant="secondary" /></header>
    <div id="looks" className="packs looks" role="radiogroup" aria-label="Look">
      {looks.map(p => <button key={p.name || 'none'} className="pack" type="button" role="radio" data-look={p.name || ''} aria-checked={String((s.pack || null) === p.name)} title={p.description || (p.label || '').split(':')[0]} onClick={() => patch({ pack: p.name })}>
        <span className="pv">{p.preview ? <img src={file(p.preview)} alt="" loading="lazy" width={112} height={199} /> : <span className="ph">{p.name ? 'No preview' : 'Your picks only'}</span>}</span>
        <b>{p.name || 'None'}</b><small className="fine">{!p.name ? 'kit defaults' : p.shipped ? 'built in' : /reference/i.test(p.label || '') ? 'saved from a reference' : 'your saved Look'}</small>
      </button>)}
    </div>
    {ex ? <div className="ref-card glass-card" id="ref-card">
      <span className="src src-ref">Reference</span>
      <div className="rc-t"><b>{ex.name || (item && item.url) || 'Your reference'}</b>
        <span className="fine">{[item && item.url ? item.url.replace(/^https?:\/\//, '').slice(0, 40) : null, sm.seconds ? `${Math.round(sm.seconds)} s` : null, ex.shots ? `${ex.shots} shots` : null, mu.bpm ? `${mu.bpm} BPM` : null].filter(Boolean).join(', ')}</span>
        <span className="fine" id="ref-card-note">{r.mode === 'recreate' ? 'Using all of it: its cuts, captions and graphics.' : r.mode === 'influence' ? `Using its parts as soft defaults${(V.look && V.look.ref.length) ? `, ${V.look.ref.length} shown with REF below` : ''}.` : 'Off: kept here, not used.'}</span></div>
      <div className="seg" role="radiogroup" aria-label="Use the reference" id="ref-card-mode">{MODE.map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={r.mode === m ? 'true' : 'false'} data-mode={m} onClick={() => patch({ reference: { mode: m } })}>{l}</button>)}</div>
      <SaveLook id="save-ref-look" label="Save as a Look" fromReference reloadCat={reloadCat} apply={apply} />
      <Button id="ref-clear" size="sm" variant="ghost" label="Clear reference" onClick={clear} />
      <button type="button" className="linkish" id="ref-open" onClick={() => go && go('reference', true)}>Breakdown</button>
    </div> : s.undoRef ? <p className="fine ref-undo" id="ref-undo">Reference cleared. <button type="button" className="linkish" id="ref-undo-btn" onClick={undo}>Undo</button></p> : null}
  </section>;
}

// The 9 layers (kit/studio/categories.json layers): every option in exactly one, with a badge for where a choice came from
function Layers({ CAT, V, s, apply, patch, hidden, tab, setTab }) {
  const [q, setQ] = useState(''), [paused, setPaused] = useState(isPaused()), [tip, setTip] = useState(null);
  const tabsRef = useRef(null), gridRef = useRef(null), focusKey = useRef(null);
  const layers = (CAT.layers && CAT.layers.length ? CAT.layers : CAT.categories.filter(c => c.count > 0).map(c => ({ id: c.id, label: c.label, hint: c.hint, groups: [{ id: c.id, label: c.label, items: c.items }], items: c.items, count: c.count })));
  // an old tab name (#tab=captions) opens the layer that now holds it
  const cur = layers.some(c => c.id === tab) ? tab : ((layers.find(l => l.groups.some(g => g.id === tab)) || layers[0]).id);
  const L = layers.find(x => x.id === cur), ql = q.trim().toLowerCase();
  useEffect(() => { if (focusKey.current) { const b = [...gridRef.current.querySelectorAll('[data-focus]')].find(x => x.dataset.focus === focusKey.current); if (b) b.focus({ preventScroll: true }); focusKey.current = null; } });
  const match = it => !ql || it.id.includes(ql) || (it.label || '').toLowerCase().includes(ql);
  // search looks across every layer, so you never need to know which one holds it
  const groups = ql ? layers.flatMap(l => l.groups.map(g => ({ ...g, label: `${l.label}: ${g.label}`, items: g.items.filter(r => match(CAT.items[r])) }))).filter(g => g.items.length) : L.groups;
  const togglePause = () => { localStorage.setItem('studio.paused', paused ? '0' : '1'); setPaused(!paused); };
  const keyTabs = e => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const i = layers.findIndex(x => x.id === cur); const n = layers[(i + (e.key === 'ArrowRight' ? 1 : layers.length - 1)) % layers.length].id; setTab(n); requestAnimationFrame(() => document.getElementById('tab-' + n)?.focus()); };
  const setPick = (it, how, key) => { focusKey.current = key; patch({ picks: { [it.ref]: how } }); };
  const src = V && V.look ? { pack: new Set(V.look.pack), ref: new Set(V.look.ref), added: new Set(V.look.added) } : { pack: new Set(), ref: new Set(), added: new Set() };
  const sourceOf = (it, st) => st === 'allow' ? (src.added.has(it.ref) ? 'ref' : 'you') : src.ref.has(it.ref) ? 'ref' : src.pack.has(it.ref) ? 'look' : null;
  return <section className="step" id="s-menu" data-step="style" aria-labelledby="h-menu" hidden={hidden}>
    <div className="block glass-card">
      <div className="bh"><h3 id="h-menu">Layers</h3>
        <div className="tools">
          <label className="search"><Icon n="search" /><span className="sr">Filter effects</span><input id="filter" type="search" placeholder="Search every layer" aria-label="Filter effects" value={q} onChange={e => setQ(e.target.value)} /><span className="kbdwrap"><Kbd keys="/" /></span></label>
          <IconBtn id="pause" n={paused ? 'play' : 'pause'} label={paused ? 'Play previews' : 'Pause previews'} aria-pressed={String(paused)} onClick={togglePause} />
        </div>
      </div>
      <div className="tabs" role="tablist" id="tabs" aria-label="Layers" ref={tabsRef} onKeyDown={keyTabs}>
        {layers.map(x => { const any = x.items.some(r => pickState(s, CAT.items[r])) || (x.id === 'audio' && (s.music.bed !== 'auto' || s.sound.sfx === 'off' || s.pace.tighten != null));
          return <button key={x.id} className="tab" role="tab" type="button" id={'tab-' + x.id} aria-selected={String(x.id === cur)} aria-controls="grid" tabIndex={x.id === cur ? 0 : -1} onClick={() => setTab(x.id)}>
            {x.label}{any && <span className="pd" title="has your picks" aria-label="has your picks" />}</button>; })}
      </div>
      <label className="tabselect"><span className="sr">Layer</span><select id="tabselect" value={cur} onChange={e => setTab(e.target.value)}>{layers.map(x => <option key={x.id} value={x.id}>{x.label} ({x.count})</option>)}</select></label>
      <p id="tabhint" className="fine">{ql ? `Every layer, matching "${q.trim()}".` : L.hint || ''}</p>
      {!ql && cur === 'audio' && <Sound CAT={CAT} s={s} apply={apply} patch={patch} />}
      <div id="grid" className="layer-groups" role="tabpanel" aria-labelledby={'tab-' + cur} ref={gridRef}>
        {groups.length ? groups.map(g => <section key={g.label} className="lg" data-group={g.id} aria-label={g.label}>
          {(groups.length > 1 || ql) && <h4 className="lg-h">{g.label}<span className="fine"> {g.items.length}</span></h4>}
          <div className="grid">{g.items.map(r => CAT.items[r]).filter(Boolean).map(it => { const st = pickState(s, it); return <Tile key={it.ref} it={it} st={st} src={sourceOf(it, st)} paused={paused} setPick={setPick} setTip={setTip} />; })}</div>
        </section>) : <p className="fine">Nothing matches that search.</p>}
      </div>
    </div>
    <HoverCard tip={tip} />
  </section>;
}

const SRC = { you: 'YOU', ref: 'REF', look: 'LOOK' }, SRC_TIP = { you: 'Your pick', ref: 'From the reference', look: 'From the Look' };
function Tile({ it, st, src, paused, setPick, setTip }) {
  const info = it.mode === 'info', kind = KIND_NAME[it.kind] || it.kind, canDeny = !info && it.mode !== 'one', did = 'd-' + it.ref.replace(/[^a-z0-9]/gi, '-');
  const still = paused && it.preview && it.preview.animated ? it.preview.still : null, showAnim = it.preview && (!paused || !it.preview.animated);
  const flag = info ? 'info' : it.needsCopy ? 'your words' : it.preview && (!it.preview.animated || still) ? 'still' : null;
  const deny = () => setPick(it, st === 'deny' ? 'clear' : 'deny', 'p:' + it.ref);
  return <div className={`tile ${st || ''} ${info ? 'info' : ''}`} onMouseEnter={e => setTip({ el: e.currentTarget, it })} onMouseLeave={() => setTip(null)} onFocus={e => setTip({ el: e.currentTarget, it })} onBlur={() => setTip(null)}>
    <button className="pick" type="button" data-focus={'p:' + it.ref} aria-pressed={info ? undefined : String(st === 'allow')} aria-describedby={did}
      aria-label={info ? `${it.id}, ${kind}, shown for reference` : `Pick ${it.id}, ${kind}`}
      onClick={() => { if (info) return toast(`${it.id}: set it with ${it.flag}`, true); setPick(it, st === 'allow' ? 'clear' : 'allow', 'p:' + it.ref); }}
      onContextMenu={e => { if (!canDeny) return; e.preventDefault(); deny(); }}
      onKeyDown={e => { if ((e.key === 'f' || e.key === 'F') && canDeny) { e.preventDefault(); deny(); } }}>
      <span className="media">{showAnim ? <img src={file(it.preview.src)} alt="" loading="lazy" decoding="async" width={120} height={160} /> : still ? <img src={file(still)} alt="" loading="lazy" width={120} height={160} /> : <span className="np">{it.preview ? 'Paused' : it.id}</span>}</span>
      <span className="nm">{it.id}</span><span className="ds" id={did}>{it.label || ''}</span>
    </button>
    {flag && <span className="flag" aria-hidden="true">{flag}</span>}
    {src && <span className={'src src-' + src} title={SRC_TIP[src]} data-src={src}>{SRC[src]}<span className="sr">, {SRC_TIP[src]}</span></span>}
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
    {it && <><span className="k">{KIND_NAME[it.kind] || it.kind}</span><b>{it.id}</b>{it.label && <p>{it.label}</p>}
      {it.mode === 'info' ? <p><code>{it.flag || ''}</code></p> : <p className="k">{it.mode === 'one' ? 'Click to pick. One per reel.' : 'Click to pick. Right-click or F to forbid.'}</p>}</>}
  </div>;
}

function Seg({ id, label, value, onChange, options }) {
  return <div id={id}><SegmentedControl label={label} value={value} onChange={onChange} size="sm">{options.map(([v, l]) => <SegmentedControlItem key={v} value={v} label={l} />)}</SegmentedControl></div>;
}

function Sound({ CAT, s, apply, patch }) {
  const audio = useRef(null), musicIn = useRef(null), [playing, setPlaying] = useState(false);
  const b = CAT.beds.find(x => x.id === s.music.bed), src = b ? file(b.file) : s.music.bed === 'upload' && s.music.upload ? file(s.music.upload) : '';
  useEffect(() => { const a = audio.current; if (!a) return; a.pause(); if (src) a.src = src; else a.removeAttribute('src'); }, [src]);
  const tight = s.pace.tighten == null ? 'pack' : String(s.pace.tighten);
  return <div id="s-music" className="sound-layer" aria-labelledby="h-music">
    <div>
      <h4 className="lg-h" id="h-music">Music, sound effects and pace</h4>
      <div className="controls">
        <div className="ctl wide"><label className="lbl" htmlFor="bed">Music</label>
          <div className="row">
            <select id="bed" value={s.music.bed} onChange={e => patch({ music: { bed: e.target.value } })}>
              <option value="auto">Auto, by energy</option><option value="none">No music</option><option value="upload" disabled={!s.music.upload}>My upload</option>
              {CAT.beds.map(x => <option key={x.id} value={x.id}>{x.title} ({x.energy}, {Math.round(x.seconds)} s)</option>)}
            </select>
            <IconBtn id="bed-play" n={playing ? 'pause' : 'play'} label={playing ? 'Pause the music bed' : 'Play the music bed'} disabled={!src} onClick={() => { const a = audio.current; if (a.paused) a.play().catch(() => {}); else a.pause(); }} />
            <audio id="bed-audio" ref={audio} preload="none" hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
            <Button id="drop-music" variant="ghost" size="sm" label="Your own" icon={<Icon n="upload" />} onClick={() => musicIn.current.click()} />
            <input type="file" id="file-music" ref={musicIn} accept="audio/*" hidden onChange={e => { upload('music', [...e.target.files], s, apply); e.target.value = ''; }} />
          </div></div>
        <div className="ctl"><span className="lbl">Energy</span>
          <Seg id="energy" label="Energy" value={s.music.energy} onChange={v => patch({ music: { energy: v } })} options={[['auto', 'Auto'], ['low', 'Low'], ['mid', 'Mid'], ['high', 'High']]} /></div>
        <div className="ctl"><span className="lbl">Sound effects</span>
          <div className="row"><Seg id="sfx" label="Sound effects" value={s.sound.sfx} onChange={v => patch({ sound: { sfx: v } })} options={[['on', 'On'], ['off', 'Off']]} />
            <Switch id="cap" size="sm" label="Sparse" value={s.sound.cap !== 'off'} onChange={on => patch({ sound: { cap: on ? 'on' : 'off' } })} /></div></div>
        <div className="ctl wide"><span className="lbl">Pace</span>
          <div className="row"><Seg id="tighten" label="Pace" value={tight} onChange={v => patch({ pace: { tighten: v === 'pack' ? null : v === 'off' ? 'off' : +v } })} options={[['pack', 'Pack'], ['off', 'Keep pauses'], ['0.5', 'Tight'], ['0.3', 'Tighter'], ['0.2', 'Tightest']]} />
            <Switch id="punch" size="sm" label="Zoom punch" value={s.pace.punch !== 'off'} onChange={on => patch({ pace: { punch: on ? 'on' : 'off' } })} /></div></div>
      </div>
    </div>
  </div>;
}
