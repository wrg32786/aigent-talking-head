import { createRoot } from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/theme-neutral/theme.css';
import './studio.css';
import { App } from './App.jsx';
createRoot(document.getElementById('root')).render(<App />);
