import { createRoot } from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/theme-neutral/theme.css';
import 'open-props/easings';
import 'open-props/shadows';
import 'open-props/animations';
import './studio.css';
import './polish.css';
import './liquid.css';
import { App } from './App.jsx';
// sliders paint their filled part from --fill (the Liquid glass track), kept in step with the value however it changes
const fill = el => { const lo = +el.min || 0, hi = el.max === '' ? 100 : +el.max, v = +el.value; el.style.setProperty('--fill', (hi > lo ? Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100)) : 0) + '%'); };
const fillAll = root => root.querySelectorAll?.('input[type=range]').forEach(fill);
document.addEventListener('input', e => { if (e.target.type === 'range') fill(e.target); }, true);
new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') { if (m.target.type === 'range') fill(m.target); } else m.addedNodes.forEach(n => n.nodeType === 1 && (n.type === 'range' ? fill(n) : fillAll(n))); } })
  .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', 'max', 'min'] });
createRoot(document.getElementById('root')).render(<App />);
