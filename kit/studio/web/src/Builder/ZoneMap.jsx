import * as stylex from '@stylexjs/stylex';

// A small 9:16 phone outline with a presenter shape. The part of the frame a step changes glows in the accent:
// captions, titles, presenter, seam (two frames and their join), frame, time (a bar with hook and CTA marks),
// sound (a speaker) or layout (top and bottom halves). Pure SVG; colours come from the theme tokens.
const s = stylex.create({
  map: { width: 72, height: 128, flexShrink: 0, display: 'block' },
  line: { fill: 'none', stroke: 'color-mix(in srgb, currentColor 45%, transparent)', strokeWidth: 1.5 },
  soft: { fill: 'color-mix(in srgb, currentColor 14%, transparent)' },
  on: { fill: 'color-mix(in srgb, var(--primary) 55%, transparent)', stroke: 'var(--primary)', strokeWidth: 1.5 },
  onLine: { fill: 'none', stroke: 'var(--primary)', strokeWidth: 2 },
});

const Person = ({ glow }) => <g {...stylex.props(glow ? s.on : s.soft)}>
  <circle cx="36" cy="50" r="11" /><path d="M14 112 C14 84 22 70 36 70 C50 70 58 84 58 112 Z" />
</g>;

export function ZoneMap({ zone, label }) {
  const frame = zone === 'frame';
  return <svg viewBox="0 0 72 128" {...stylex.props(s.map)} role="img" aria-label={label}>
    <rect x="2" y="2" width="68" height="124" rx="10" {...stylex.props(frame ? s.on : s.line)} />
    {zone === 'layout' && <><rect x="6" y="6" width="60" height="56" rx="5" {...stylex.props(s.on)} /><line x1="6" y1="64" x2="66" y2="64" {...stylex.props(s.onLine)} /></>}
    {zone === 'seam'
      ? <><rect x="8" y="30" width="24" height="44" rx="3" {...stylex.props(s.soft)} /><rect x="40" y="30" width="24" height="44" rx="3" {...stylex.props(s.soft)} /><line x1="36" y1="26" x2="36" y2="78" {...stylex.props(s.onLine)} /></>
      : <Person glow={zone === 'presenter'} />}
    {zone === 'titles' && <rect x="10" y="16" width="52" height="12" rx="3" {...stylex.props(s.on)} />}
    {zone === 'captions' && <rect x="10" y="88" width="52" height="10" rx="3" {...stylex.props(s.on)} />}
    {zone === 'time' && <><rect x="8" y="114" width="56" height="5" rx="2.5" {...stylex.props(s.on)} /><line x1="18" y1="110" x2="18" y2="122" {...stylex.props(s.onLine)} /><line x1="54" y1="110" x2="54" y2="122" {...stylex.props(s.onLine)} /></>}
    {zone === 'sound' && <path d="M26 16 h6 l8 -6 v20 l-8 -6 h-6 Z M44 13 q4 7 0 14" {...stylex.props(s.on)} />}
  </svg>;
}
