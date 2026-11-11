// AIgent preset (Plinth dark brand guide), the default look. Accent #5cf9e2 is the only cyan; cards are square.
// Captions: Hanken Grotesk 400. Hero words, stickers, cards: Sofia Sans Extra Condensed caps 760-860.
window.THEME = {
  name: 'aigent',
  fontCss: 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&family=Sofia+Sans+Extra+Condensed:wght@760;820;860&display=swap',
  colors: {
    accent: '#5cf9e2',
    text: '#f1e8dc',
    ink: '#0b0907',
    muted: '#a39585',
    cardBg: 'rgba(11,9,7,.93)',
    cardStroke: 'rgba(241,232,220,.14)',
    plate: '#f1e8dc'
  },
  fonts: {
    caption: { family: '"Hanken Grotesk", Arial, sans-serif', weight: 400, size: 76 },
    display: { family: '"Sofia Sans Extra Condensed", "Arial Narrow", sans-serif', hero: 860, sticker: 820, kicker: 760, tracking: -0.01 }
  },
  logo: null  // job-specific: set "logo" in captions.js (only the Awakening example uses one, kit/example/skool-logo.svg)
};
