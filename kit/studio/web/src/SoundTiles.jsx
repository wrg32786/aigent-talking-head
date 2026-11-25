import { useEffect, useRef, useState } from 'react';
import { file, IconBtn } from './lib.jsx';
import { Fold } from './ui.jsx';

// Sound tiles: hear a music bed or a sound before you choose. One player for the whole page, so starting one tile stops
// the last. The waveform is drawn from docs/menu/sounds.json; the audio loads only when you press play.
const secs = n => n < 60 ? `${Math.round(n * 10) / 10 < 10 ? Math.round(n * 10) / 10 : Math.round(n)} s` : `${Math.floor(n / 60)} min ${Math.round(n % 60)} s`;
const CAT_NAME = { hit: 'Hits', riser: 'Build ups', release: 'Releases', whoosh: 'Whooshes', swipe: 'Swipes', pop: 'Pops', ui: 'Clicks and taps', glitch: 'Glitches', camera: 'Camera', paper: 'Paper', counter: 'Counters', sub: 'Low drops', shimmer: 'Sparkles' };

function Wave({ peaks, at }) {
  if (!peaks || !peaks.length) return <div className="wave wave-none" aria-hidden="true" />;
  const n = peaks.length;
  return <svg className="wave" viewBox={`0 0 ${n * 3} 32`} preserveAspectRatio="none" aria-hidden="true">
    {peaks.map((v, i) => { const h = Math.max(2, v * 0.3); return <rect key={i} x={i * 3} y={16 - h / 2} width="2" height={h} rx="1" className={at != null && i / n <= at ? 'on' : ''} />; })}
  </svg>;
}

function usePlayer() {
  const a = useRef(null), [cur, setCur] = useState(null), [at, setAt] = useState(0);
  useEffect(() => { const el = new Audio(); el.preload = 'none'; a.current = el;
    // the pause event arrives after a switch to the next tile has already started it, so it only clears a player that is
    // still paused
    const tick = () => setAt(el.duration ? el.currentTime / el.duration : 0), end = () => { if (el.paused || el.ended) { setCur(null); setAt(0); } };
    el.addEventListener('timeupdate', tick); el.addEventListener('ended', end); el.addEventListener('pause', end);
    return () => { el.pause(); el.removeAttribute('src'); };
  }, []);
  const toggle = x => { const el = a.current; if (cur === x.file) { el.pause(); return; } el.pause(); document.querySelectorAll('audio').forEach(o => o.pause()); el.src = file(x.file); setCur(x.file); setAt(0); el.play().catch(() => setCur(null)); };
  return { cur, at, toggle };
}

function Tile({ x, sub, p, chosen, onChoose }) {
  const on = p.cur === x.file;
  return <div className={'snd-tile glass-card' + (chosen ? ' chosen' : '') + (on ? ' playing' : '')} data-id={x.id}>
    <IconBtn n={on ? 'pause' : 'play'} className="snd-play" label={(on ? 'Pause ' : 'Play ') + x.title} onClick={() => p.toggle(x)} />
    <div className="snd-body">
      <span className="snd-name">{x.title}</span>
      <Wave peaks={x.peaks} at={on ? p.at : null} />
      <span className="fine snd-sub">{sub}</span>
    </div>
    {onChoose && <button type="button" className={'btn sm ' + (chosen ? '' : 'outline')} aria-pressed={!!chosen} onClick={onChoose}>{chosen ? 'Chosen' : 'Use this'}</button>}
  </div>;
}

// the music beds as tiles: play to hear it, Use this to make it the reel's music
export function BedTiles({ CAT, s, patch }) {
  const p = usePlayer();
  return <Fold id="bed-tiles" title="Hear the music">
    <div className="snd-grid">{CAT.beds.map(b => <Tile key={b.id} x={b} p={p} sub={`${b.energy} energy, ${secs(b.seconds)}`} chosen={s.music.bed === b.id} onChoose={() => patch({ music: { bed: b.id } })} />)}</div>
  </Fold>;
}

// the sounds, by kind, to listen to. Studio places them on the cuts by itself, so there is nothing to choose here
export function SfxTiles({ CAT }) {
  const p = usePlayer(), groups = [];
  for (const x of CAT.sfx || []) { let g = groups.find(y => y.id === x.category); if (!g) groups.push(g = { id: x.category, items: [] }); g.items.push(x); }
  if (!groups.length) return null;
  return <Fold id="sfx-tiles" title="Hear the sounds">
    <p className="fine">Studio places these on the cuts for you. Listen here to know what you will hear.</p>
    {groups.map(g => <div key={g.id} className="snd-group" role="group" aria-label={CAT_NAME[g.id] || g.id}>
      <h4 className="lbl">{CAT_NAME[g.id] || g.id}</h4>
      <div className="snd-grid">{g.items.map(x => <Tile key={x.id} x={x} p={p} sub={secs(x.seconds)} />)}</div>
    </div>)}
  </Fold>;
}
