import * as stylex from '@stylexjs/stylex';
import { LivePreview } from './LivePreview.jsx';

// Step 9: the whole Words section in the live preview, a one-line summary and Lock and continue (in the frame's Next)
const s = stylex.create({ row: { display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }, sum: { flexBasis: 260, flexGrow: 1, marginTop: 0 } });
export function WordsPreview({ words, behind, summary }) {
  return <div {...stylex.props(s.row)}>
    <LivePreview id="build-final" words={words} behind={behind} width={288} label="Live preview of your words on the sample presenter" />
    <div {...stylex.props(s.sum)}><p id="build-words-sum">{summary}</p><p className="fine">Lock it and we keep these choices when you go on. You can come back and change them.</p></div>
  </div>;
}
