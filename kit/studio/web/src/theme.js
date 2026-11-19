// The AIgent theme for Astryx (MIT, Meta). Extends Astryx Neutral and swaps in the AIgent palette:
// warm ink and paper neutrals, one cyan accent. Pairs are [light, dark].
import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

const ink = { bg: '#0b0907', fg: '#f1e8dc', card: '#131110', muted: '#221e1a', mutedFg: '#a39585', accent: '#5cf9e2' };
const paper = { bg: '#f6f2ec', fg: '#17130f', card: '#ffffff', muted: '#ede6dc', mutedFg: '#625649', accent: '#0b7a6d' };
const pair = k => [paper[k], ink[k]];

export const aigentTheme = defineTheme({
  name: 'aigent',
  extends: neutralTheme,
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: 'Hanken Grotesk', fallbacks: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    heading: { family: 'Hanken Grotesk', fallbacks: 'system-ui, sans-serif', weights: { 3: 'bold', 4: 'bold' } },
    code: { family: 'JetBrains Mono', fallbacks: 'ui-monospace, Consolas, monospace' },
  },
  tokens: {
    '--color-background-body': pair('bg'),
    '--color-background-surface': pair('card'),
    '--color-background-card': pair('card'),
    '--color-background-popover': pair('card'),
    '--color-background-muted': pair('muted'),
    '--color-accent': pair('accent'),
    '--color-accent-muted': ['#d3efe9', '#123b36'],
    '--color-text-primary': pair('fg'),
    '--color-text-secondary': pair('mutedFg'),
    '--color-text-accent': pair('accent'),
    '--color-icon-accent': pair('accent'),
    '--color-icon-primary': pair('fg'),
    '--color-icon-secondary': pair('mutedFg'),
    '--color-on-accent': ['#ffffff', '#0b0907'],
    '--color-border': ['rgba(23,19,15,.1)', 'rgba(241,232,220,.1)'],
    '--color-border-emphasized': ['rgba(23,19,15,.22)', 'rgba(241,232,220,.2)'],
    '--color-success': ['#2f7d1d', '#8fdc6e'],
    '--color-error': ['#c8372b', '#ff6b5e'],
    '--color-text-success': ['#2f7d1d', '#8fdc6e'],
    '--color-text-error': ['#c8372b', '#ff8a7f'],
    '--color-text-warning': ['#8a6100', '#f2c14e'],
    '--radius-inner': '6px',
    '--radius-element': '8px',
    '--radius-container': '14px',
    '--radius-page': '20px',
  },
  // Roomier controls than Neutral: 36 px default, 44 px for the main actions (touch friendly).
  components: {
    button: {
      'size:md': { height: '36px', paddingInline: '14px' },
      'size:lg': { height: '44px', paddingInline: '22px', fontSize: '15px' },
    },
  },
});
