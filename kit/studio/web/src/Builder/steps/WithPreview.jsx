import * as stylex from '@stylexjs/stylex';
import { LivePreview } from './LivePreview.jsx';

// A words step: the options, and beside them one live preview that follows the option you point at or focus
// (debounced in LivePreview), else what you chose. On a phone the preview sits above the options.
const s = stylex.create({
  row: { display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap-reverse' },
  main: { flexGrow: 1, flexBasis: 320, minWidth: 0, display: 'grid', gap: 16 },
  side: { position: 'sticky', top: 12 },
});
export const mergeWords = (w, over) => { if (!over) return w; const o = { ...w }; for (const [k, v] of Object.entries(over)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && w[k] && typeof w[k] === 'object' ? { ...w[k], ...v } : v; return o; };
export function WithPreview({ words, hover, behind, children }) {
  return <div {...stylex.props(s.row)}>
    <div {...stylex.props(s.main)}>{children}</div>
    <div {...stylex.props(s.side)}><LivePreview words={mergeWords(words, hover)} behind={behind} width={216} /></div>
  </div>;
}
