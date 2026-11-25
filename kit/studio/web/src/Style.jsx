import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, quiet, file, toast, Icon, IconBtn, RM, showName, layerOf } from './lib.jsx';
import { RefMode, RefNotice, RefParts, RefPlan, refName, refBrought, LookChips, SavedLookNote, TitleCheckLine } from './RefCard.jsx';
import { Fold } from './ui.jsx';
import { Layers, ChangeNote } from './AllOptions.jsx';
export { ChangeNote };
import { BedTiles, SfxTiles, stopTiles } from './SoundTiles.jsx';
import { upload } from './upload.js';
import { WordsBrands } from './Brands.jsx';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { contextOf, controlOf } from '../../conflicts.mjs';

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
        <IconBtn id="bed-play" n={playing ? 'pause' : 'play'} label={playing ? 'Pause the music' : 'Play the music'} disabled={!src} onClick={() => { const a = audio.current; if (a.paused) stopTiles(); if (a.paused) a.play().catch(() => {}); else a.pause(); }} />
        <audio id="bed-audio" ref={audio} preload="none" hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        <Button id="drop-music" variant="ghost" size="sm" label="Your own" icon={<Icon n="upload" />} onClick={() => musicIn.current.click()} />
        <input type="file" id="file-music" ref={musicIn} accept="audio/*" hidden onChange={e => { upload('music', [...e.target.files], s, apply); e.target.value = ''; }} />
      </div>
      <div className="ctl"><span className="lbl">Energy</span>
        <Seg id="energy" label="Energy" value={s.music.energy} onChange={v => patch({ music: { energy: v } })} options={[['auto', 'Auto'], ['low', 'Low'], ['mid', 'Mid'], ['high', 'High']]} off={en && en.reason} />
        {en && <span className="fine ctl-off" id="energy-off">{en.reason}. <button type="button" className="linkish" onClick={() => patch(en.fix)}>{en.act}</button></span>}</div>
      <Switch id="beat-sync" size="sm" label="Land the cuts and sounds on the beat" value={sync && !noBed} isDisabled={noBed} disabledMessage={noBed ? 'There is no music to follow' : undefined} onChange={on => patch({ picks: { 'beatSync:no-beat-sync': on ? 'clear' : 'allow' } })} />
      <BedTiles CAT={CAT} s={s} patch={patch} />
    </div>
    <div className="block glass-card sound-card" role="group" aria-labelledby="h-sfx">
      <h3 className="lbl" id="h-sfx">Sounds</h3>
      <Switch id="sfx" size="sm" label="Sounds on the cuts" value={s.sound.sfx !== 'off'} onChange={on => patch({ sound: { sfx: on ? 'on' : 'off' } })} />
      <Switch id="cap" size="sm" label="Fewer sounds, only the strong moments" value={s.sound.cap !== 'off'} onChange={on => patch({ sound: { cap: on ? 'on' : 'off' } })} isDisabled={!!cp} disabledMessage={cp ? cp.reason : undefined} />
      <SfxTiles CAT={CAT} />
    </div>
    <p className="fine sound-pace" id="pacing-line">Pacing: <b>{paceName}</b>. <a className="linkish" href="#step=cut" onClick={() => localStorage.setItem('studio.cutLayer', 'clips')}>Change it on Cut</a></p>
  </div>;
}
