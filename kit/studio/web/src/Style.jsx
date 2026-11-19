import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { Kbd } from '@astryxdesign/core/Kbd';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, file, toast, pickState, isPaused, Icon, IconBtn, KIND_NAME } from './lib.jsx';
import { upload } from './upload.js';

export function Style({ CAT, s, apply, patch, reloadCat, hidden, tab, setTab }) {
  return <>
    <Packs CAT={CAT} s={s} apply={apply} patch={patch} reloadCat={reloadCat} hidden={hidden} />
    <Effects CAT={CAT} s={s} patch={patch} hidden={hidden} tab={tab} setTab={setTab} />
    <Sound CAT={CAT} s={s} apply={apply} patch={patch} hidden={hidden} />
  </>;
}

function Packs({ CAT, s, apply, patch, reloadCat, hidden }) {
  const [name, setName] = useState(''), [msg, setMsg] = useState('');
  const infl = s.reference.mode === 'influence' && s.reference.extracted;
  const packs = [{ name: null, label: 'kit defaults, your picks only' }, ...CAT.packs.filter(p => !/^ref-/.test(p.name))];
  const save = e => { e.preventDefault(); api('/api/pack/save', { name: name.trim() }).then(async j => { await reloadCat(); apply(j); setMsg(`Saved ${j.path}`); }).catch(() => {}); };
  return <section className="step" id="s-look" data-step="style" aria-labelledby="h-look" hidden={hidden}>
    <header className="sh"><h2 id="h-look">Style</h2><p className="sub">Start from a pack, then pick the effects you want.</p></header>
    <div className="block glass-card">
      <div className="bh"><h3>Pack</h3>
        <details className="pop" id="save-pop"><summary className="btn ghost sm">Save as pack</summary>
          <form className="popover glass" id="save-pack" onSubmit={save}><label className="lbl" htmlFor="pack-name">Pack name</label>
            <div className="row"><input id="pack-name" placeholder="my-look" pattern="[a-z0-9][a-z0-9\-]{1,40}" required value={name} onChange={e => setName(e.target.value)} /><Button type="submit" size="sm" variant="primary" label="Save" /></div>
            <span id="pack-msg" className="fine" role="status">{msg}</span></form>
        </details>
      </div>
      <div id="packs" className="packs" role="radiogroup" aria-label="Style pack">
        {packs.map(p => <button key={p.name || 'none'} className="pack" type="button" role="radio" aria-checked={String((s.pack || null) === p.name)} title={p.description || (p.label || '').split(':')[0]} onClick={() => patch({ pack: p.name })}>
          <span className="pv">{p.preview ? <img src={file(p.preview)} alt="" loading="lazy" width={112} height={199} /> : <span className="ph">{p.name ? 'No preview' : 'Your picks only'}</span>}</span><b>{p.name || 'None'}</b>
        </button>)}
      </div>
      {infl && <p id="look-note" className="fine">Plus the reference's look, as the local pack ref-{s.job}.</p>}
    </div>
  </section>;
}

function Effects({ CAT, s, patch, hidden, tab, setTab }) {
  const [q, setQ] = useState(''), [paused, setPaused] = useState(isPaused()), [tip, setTip] = useState(null);
  const tabsRef = useRef(null), gridRef = useRef(null), focusKey = useRef(null);
  const cats = CAT.categories.filter(c => c.count > 0);
  const cur = cats.some(c => c.id === tab) ? tab : cats[0].id;
  const c = cats.find(x => x.id === cur), ql = q.trim().toLowerCase();
  useEffect(() => { if (focusKey.current) { const b = [...gridRef.current.querySelectorAll('[data-focus]')].find(x => x.dataset.focus === focusKey.current); if (b) b.focus({ preventScroll: true }); focusKey.current = null; } });
  const items = c.items.map(r => CAT.items[r]).filter(it => !ql || it.id.includes(ql) || (it.label || '').toLowerCase().includes(ql));
  const togglePause = () => { localStorage.setItem('studio.paused', paused ? '0' : '1'); setPaused(!paused); };
  const keyTabs = e => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const i = cats.findIndex(x => x.id === cur); const n = cats[(i + (e.key === 'ArrowRight' ? 1 : cats.length - 1)) % cats.length].id; setTab(n); requestAnimationFrame(() => document.getElementById('tab-' + n)?.focus()); };
  const setPick = (it, how, key) => { focusKey.current = key; patch({ picks: { [it.ref]: how } }); };
  return <section className="step" id="s-menu" data-step="style" aria-labelledby="h-menu" hidden={hidden}>
    <div className="block glass-card">
      <div className="bh"><h3 id="h-menu">Effects</h3>
        <div className="tools">
          <label className="search"><Icon n="search" /><span className="sr">Filter effects</span><input id="filter" type="search" placeholder="Search effects" aria-label="Filter effects" value={q} onChange={e => setQ(e.target.value)} /><span className="kbdwrap"><Kbd keys="/" /></span></label>
          <IconBtn id="pause" n={paused ? 'play' : 'pause'} label={paused ? 'Play previews' : 'Pause previews'} aria-pressed={String(paused)} onClick={togglePause} />
        </div>
      </div>
      <div className="tabs" role="tablist" id="tabs" aria-label="Effect categories" ref={tabsRef} onKeyDown={keyTabs}>
        {cats.map(x => { const any = x.items.some(r => pickState(s, CAT.items[r]));
          return <button key={x.id} className="tab" role="tab" type="button" id={'tab-' + x.id} aria-selected={String(x.id === cur)} aria-controls="grid" tabIndex={x.id === cur ? 0 : -1} onClick={() => setTab(x.id)}>
            {x.label}<span className="c">{x.count}</span>{any && <span className="pd" title="has picks" aria-label="has picks" />}</button>; })}
      </div>
      <label className="tabselect"><span className="sr">Category</span><select id="tabselect" value={cur} onChange={e => setTab(e.target.value)}>{cats.map(x => <option key={x.id} value={x.id}>{x.label} ({x.count})</option>)}</select></label>
      <p id="tabhint" className="fine">{c.hint || ''}</p>
      <div id="grid" className="grid" role="tabpanel" aria-labelledby={'tab-' + cur} ref={gridRef}>
        {items.length ? items.map(it => <Tile key={it.ref} it={it} st={pickState(s, it)} paused={paused} setPick={setPick} setTip={setTip} />) : <p className="fine">Nothing matches that search.</p>}
      </div>
    </div>
    <HoverCard tip={tip} />
  </section>;
}

function Tile({ it, st, paused, setPick, setTip }) {
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

function Sound({ CAT, s, apply, patch, hidden }) {
  const audio = useRef(null), musicIn = useRef(null), [playing, setPlaying] = useState(false);
  const b = CAT.beds.find(x => x.id === s.music.bed), src = b ? file(b.file) : s.music.bed === 'upload' && s.music.upload ? file(s.music.upload) : '';
  useEffect(() => { const a = audio.current; if (!a) return; a.pause(); if (src) a.src = src; else a.removeAttribute('src'); }, [src]);
  const tight = s.pace.tighten == null ? 'pack' : String(s.pace.tighten);
  return <section className="step" id="s-music" data-step="style" aria-labelledby="h-music" hidden={hidden}>
    <div className="block glass-card">
      <div className="bh"><h3 id="h-music">Sound and pace</h3></div>
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
  </section>;
}
