// Magazine theme: muted olive and cream, the colours of the magazine preset (`--preset magazine`, or `--theme magazine`).
// Text stays white on your picture; the accent is a warm cream that reads on skin and on dark backgrounds, and the
// olive is the ink on cream stickers and tiles. The colour cards (olive, ivory) use the same two colours.
// The fonts come from the preset's pairing (playfair: Playfair Display, Inter Tight, Playfair Display Italic), all
// OFL files in kit/fonts/, so this works offline.
window.THEME = {
  name: 'magazine',
  fontCss: null,
  colors: {
    accent: '#f4edd4',                 // cream: hero words, number tiles, stickers
    text: '#ffffff',                   // plain captions
    ink: '#4b5a3a',                    // olive: text on cream stickers and tiles
    muted: '#c9c3a8',
    cardBg: 'rgba(75,90,58,.95)',      // olive takeover plate
    cardStroke: 'rgba(244,237,212,.18)',
    plate: '#f4edd4'
  },
  fonts: {
    caption: { family: '"Inter Tight", "Helvetica Neue", Arial, sans-serif', weight: 600, size: 76 },
    display: { family: '"Playfair Display", Georgia, "Times New Roman", serif', hero: 700, sticker: 700, kicker: 600, tracking: -0.015 }
  },
  logo: null
};
