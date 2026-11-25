import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
const withClass = (name, ...st) => { const p = stylex.props(...st); return { ...p, className: name + (p.className ? ' ' + p.className : '') }; };
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Tiles, itemsOf } from './Tiles.jsx';

// Step 6: text colors. A theme (AIgent, Magazine, Neutral), then your own text, key word and outline colors, each a
// color picker in a popover. The contrast between your text and its outline is shown, with a plain warning under 4.5 to 1.
const s = stylex.create({
  h: { fontSize: 14, marginTop: 0, marginBottom: 8 },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  sw: { width: 18, height: 18, borderRadius: 6, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' },
  panel: { display: 'grid', gap: 8, padding: 12, borderRadius: 12, zIndex: 50 },
  warn: { color: 'var(--warning, #d97706)' },
});
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// each theme's own text, key word and outline (ink) colors (kit/themes), so the swatches and the contrast match what shows
const THEME_COLORS = { aigent: { text: '#f1e8dc', accent: '#5cf9e2', outline: '#0b0907' }, magazine: { text: '#ffffff', accent: '#f4edd4', outline: '#4b5a3a' }, neutral: { text: '#ffffff', accent: '#ffd400', outline: '#111111' } };
const ROLES = [['text', 'Text'], ['accent', 'Key words'], ['outline', 'Outline']];

function Pick({ role, name, value, fallback, onPick, busy }) {
  const [v, setV] = useState(value || fallback);
  return <Popover {...stylex.props(s.chip)}>
    <PopoverButton className="btn outline sm" id={`build-color-${role}`} disabled={busy}><span {...stylex.props(s.sw)} style={{ backgroundColor: value || fallback }} aria-hidden="true" />{name}{value ? '' : ': theme'}</PopoverButton>
    <PopoverPanel anchor={{ to: 'bottom start', gap: 8 }} {...withClass('popover glass', s.panel)}>
      {({ close }) => <>
        <label htmlFor={`build-color-${role}-in`}>{name} color</label>
        <input type="color" id={`build-color-${role}-in`} value={v} onChange={e => setV(e.target.value)} />
        <div {...stylex.props(s.row)}>
          <button type="button" className="btn sm" onClick={() => { onPick(v); close(); }}>Use this color</button>
          {value && <button type="button" className="btn ghost sm" onClick={() => { onPick(null); close(); }}>Use the theme's</button>}
        </div></>}
    </PopoverPanel>
  </Popover>;
}

export function Colors({ CAT, step, words, save, busy, setHover }) {
  const c = words.colors, th = THEME_COLORS[c.theme] || THEME_COLORS.aigent, text = c.text || th.text, outline = c.outline || th.outline, ratio = contrast(text, outline);
  return <>
    <section aria-labelledby="build-th-h"><h3 id="build-th-h" {...stylex.props(s.h)}>Theme</h3>
      <Tiles id="build-theme" label="Theme" items={itemsOf(CAT, ['theme'])} value={c.theme} allowNone noneLabel="We pick" disabled={busy}
        onChange={theme => save({ colors: { theme } })} onHover={x => setHover(x ? { colors: { ...c, theme: x.id } } : null)} /></section>
    <section aria-labelledby="build-own-h"><h3 id="build-own-h" {...stylex.props(s.h)}>Your own colors</h3>
      <div {...stylex.props(s.row)}>{ROLES.map(([role, name]) => <Pick key={role + (c[role] || '') + (c.theme || '')} role={role} name={name} value={c[role]} fallback={th[role]} busy={busy} onPick={v => save({ colors: { [role]: v } })} />)}</div>
      <p id="build-contrast" role="status" {...withClass('fine', ratio < 4.5 && s.warn)}>
        Text against its outline: {ratio.toFixed(1)} to 1. {ratio < 4.5 ? 'That is hard to read on a busy picture. Pick colors further apart.' : 'Easy to read.'} The outline color is not drawn in the preview yet.</p>
    </section>
  </>;
}
