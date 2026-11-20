// The AIgent theme for Astryx (MIT, Meta). Extends Astryx Neutral and swaps in the AIgent brand palette
// (AIgent Brand Guide tokens.css): Plinth for dark, Paper (the brand cream) for light, one accent each.
// The same values are Studio's own tokens in studio.css, so Astryx parts and Studio parts match. Pairs are [light, dark].
import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

const ink = { bg: '#0b0907', fg: '#f1e8dc', card: '#15110e', muted: '#211b16', mutedFg: '#a39585', accent: '#5cf9e2', accentText: '#5cf9e2' };
// accentText: on cream the brand teal is for fills and rings; small teal text uses the brand's accent-hi so it clears 4.5:1
const paper = { bg: '#f1e8dc', fg: '#0b0907', card: '#ffffff', muted: '#e6ded2', mutedFg: '#6b5f53', accent: '#0b8168', accentText: '#086553' };
const pair = k => [paper[k], ink[k]];

export const aigentTheme = defineTheme({
  name: 'aigent',
  extends: neutralTheme,
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: 'Hanken Grotesk', fallbacks: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    heading: { family: 'Hanken Grotesk', fallbacks: 'system-ui, sans-serif', weights: { 3: 'bold', 4: 'bold' } }, // the display face is for Studio's own headlines only
    code: { family: 'JetBrains Mono', fallbacks: 'ui-monospace, Consolas, monospace' },
  },
  tokens: {
    '--color-background-body': pair('bg'),
    '--color-background-surface': pair('card'),
    '--color-background-card': pair('card'),
    '--color-background-popover': pair('card'),
    '--color-background-muted': pair('muted'),
    '--color-accent': pair('accent'),
    '--color-accent-muted': ['#cfe6dc', '#123b36'],
    '--color-text-primary': pair('fg'),
    '--color-text-secondary': pair('mutedFg'),
    '--color-text-accent': pair('accentText'),
    '--color-icon-accent': pair('accent'),
    '--color-icon-primary': pair('fg'),
    '--color-icon-secondary': pair('mutedFg'),
    '--color-on-accent': ['#ffffff', '#0b0907'],
    '--color-border': ['rgba(11,9,7,.12)', 'rgba(241,232,220,.12)'],
    '--color-border-emphasized': ['rgba(11,9,7,.24)', 'rgba(241,232,220,.2)'],
    '--color-success': ['#276a17', 'oklch(76% 0.13 150)'],
    '--color-error': ['#b02e23', 'oklch(72% 0.15 27)'],
    '--color-text-success': ['#276a17', 'oklch(76% 0.13 150)'],
    '--color-text-error': ['#b02e23', '#ff8a7f'],
    '--color-text-warning': ['#7a5600', '#f2c14e'],
    '--radius-inner': '10px', // brand radius-inner
    '--radius-element': '8px',
    '--radius-container': '14px', // brand radius-draft
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
