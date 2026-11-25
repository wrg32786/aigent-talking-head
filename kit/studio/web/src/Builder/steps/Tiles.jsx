import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { RadioGroup, Radio } from '@headlessui/react';
import { file, isPaused, showName, Icon } from '../../lib.jsx';

// Option tiles for a builder step: one choice (a radio group, arrow keys move it) or several (toggle buttons).
// items: [{ id, name, preview: { src, animated, still } | null, line }]. The featured ones show first; See all shows
// the rest. allowNone adds a None tile (value null, or [] for several). onHover(id|null) feeds a live preview.
const s = stylex.create({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10, marginBlock: 0, marginInline: 0, paddingBlock: 0, paddingInline: 0 },
  tile: { position: 'relative', display: 'grid', gap: 4, alignContent: 'start', padding: 6, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'inherit', cursor: 'pointer', textAlign: 'left', fontSize: 13, outlineOffset: 2 },
  on: { borderColor: 'var(--primary)', boxShadow: '0 0 0 2px var(--primary) inset' },
  img: { width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 8, display: 'block', backgroundColor: 'var(--muted)' },
  none: { width: '100%', aspectRatio: '3 / 4', borderRadius: 8, display: 'grid', placeItems: 'center', backgroundColor: 'var(--muted)', fontSize: 12, opacity: 0.8 },
  name: { fontWeight: 600 },
  mark: { position: 'absolute', top: 10, right: 10, display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 999, backgroundColor: 'var(--primary)', color: 'var(--primary-foreground, #fff)' },
  more: { marginTop: 8 },
});

// the catalog's items of some kinds, as tiles, featured first
export function itemsOf(CAT, kinds, only = null) {
  if (!CAT) return [];
  return Object.values(CAT.items).filter(it => kinds.includes(it.kind) && (!only || only.includes(it.id)) && it.mode !== 'info')
    .map(it => ({ id: it.id, kind: it.kind, name: showName(it.id), preview: it.preview || null, line: it.label || '' }));
}

function Media({ it }) {
  const p = it.preview, still = isPaused() || !p || !p.animated ? (p && (p.still || p.src)) : p.src;
  return still ? <img src={p.url || file(still)} alt="" loading="lazy" decoding="async" {...stylex.props(s.img)} /> : <span {...stylex.props(s.none)} aria-hidden="true">{it.name}</span>;
}

export function Tiles({ id, label, items, featured = [], value, multi = false, allowNone = false, noneLabel = 'None', onChange, onHover = () => {}, disabled = false }) {
  const [all, setAll] = useState(false);
  const rank = x => { const i = featured.indexOf(x.id); return i < 0 ? 1e3 : i; };
  const sorted = [...items].sort((a, b) => rank(a) - rank(b)), top = featured.length ? sorted.filter(x => featured.includes(x.id)) : sorted;
  const chosen = multi ? (value || []) : value;
  // a chosen tile is always shown, even when it is not featured
  const shown = all ? sorted : sorted.filter(x => top.includes(x) || (multi ? chosen.includes(x.id) : chosen === x.id));
  const hover = x => ({ onMouseEnter: () => onHover(x), onFocus: () => onHover(x), onMouseLeave: () => onHover(null), onBlur: () => onHover(null) });
  const body = x => <>{x.id === null ? <span {...stylex.props(s.none)} aria-hidden="true">{noneLabel}</span> : <Media it={x} />}
    {(multi ? x.id === null ? !chosen.length : chosen.includes(x.id) : chosen === x.id) && <span aria-hidden="true" {...stylex.props(s.mark)}><Icon n="check" /></span>}
    <span {...stylex.props(s.name)}>{x.id === null ? noneLabel : x.name}</span></>;
  const list = [...(allowNone ? [{ id: null, name: noneLabel }] : []), ...shown];
  const more = sorted.length > top.length && <button type="button" className="btn ghost sm" id={id + '-all'} aria-expanded={all} onClick={() => setAll(a => !a)} {...stylex.props(s.more)}>{all ? 'Show fewer' : `See all ${sorted.length}`}</button>;
  if (!multi) return <div><RadioGroup value={chosen ?? null} by={(a, b) => a === b} onChange={v => { if (!disabled) onChange(v); }} aria-label={label} id={id} {...stylex.props(s.grid)}>
    {list.map(x => <Radio key={String(x.id)} value={x.id} data-opt={x.id ?? 'none'} aria-label={x.id === null ? noneLabel : x.name} {...hover(x)} {...stylex.props(s.tile, chosen === x.id && s.on)}>{body(x)}</Radio>)}
  </RadioGroup>{more}</div>;
  const toggle = x => { if (disabled) return; if (x.id === null) return onChange([]); onChange(chosen.includes(x.id) ? chosen.filter(v => v !== x.id) : [...chosen, x.id]); };
  return <div><div role="group" aria-label={label} id={id} {...stylex.props(s.grid)}>
    {list.map(x => { const on = x.id === null ? !chosen.length : chosen.includes(x.id);
      return <button key={String(x.id)} type="button" data-opt={x.id ?? 'none'} aria-pressed={on} aria-label={x.id === null ? noneLabel : x.name} onClick={() => toggle(x)} {...hover(x)} {...stylex.props(s.tile, on && s.on)}>{body(x)}</button>; })}
  </div>{more}</div>;
}
