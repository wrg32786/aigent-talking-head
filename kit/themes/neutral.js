// Neutral theme: the default. No brand, no web fonts, no logo. Works offline.
// Copy a theme into your build/ folder as theme.js (render.mjs does this for you; THEME=<name> picks one),
// then edit it. captions.js can also override any field with a "theme": {...} block.
window.THEME = {
  name: 'neutral',
  fontCss: null,                       // optional stylesheet URL for web fonts (e.g. a Google Fonts css2 link)
  colors: {
    accent: '#ffd400',                 // hero words, stickers, count-ups, bursts, glitch streaks
    text: '#ffffff',                   // plain captions
    ink: '#111111',                    // text on stickers
    muted: '#bdbdbd',                  // card kicker
    cardBg: 'rgba(17,17,17,.93)',      // takeover card plate
    cardStroke: 'rgba(255,255,255,.14)',
    plate: '#ffffff'                   // logo plate behind the logo (mode 5)
  },
  fonts: {
    caption: { family: '"Helvetica Neue", Arial, "Liberation Sans", sans-serif', weight: 700, size: 76 },
    display: { family: '"Arial Narrow", "Liberation Sans Narrow", "Helvetica Neue", Arial, sans-serif', hero: 900, sticker: 800, kicker: 700, tracking: -0.01 }
  },
  logo: null                           // or { src: 'logo.svg' } (file next to overlay.html in build/); null = no logo plate
};
