// A small breakdown in the shape rea-video writes (videomd/breakdown.json), modelled on the reference 5 table
// (/th-reports ref5 text effects teardown): designed phrase titles, no running captions. Text items every half second.
'use strict';
const W = '#ffffff', Y = '#ffd400', G = '#8a8a8a';
const it = (t, text, y, o = {}) => ({ t, text, conf: o.conf ?? 0.93, bbox: [o.x ?? 0.2, y, o.w ?? 0.6, o.h ?? 0.04], angle: 0, style: { fill: o.fill || W, weight: 0.15 }, band: y < 0.36 ? 'top' : y > 0.6 ? 'bottom' : 'middle' });
const shots = [
  // #2 WAS THE / LOWEST / WE EVER MADE: word by word, LOWEST yellow, ends on the cut at 2.2
  { start: 0, end: 2.2, transition_in: 'cut', items: [it(1, 'WAS THE', 0.2), it(1, 'LOWEST', 0.25, { fill: Y }), it(1.5, 'WAS THE', 0.2), it(1.5, 'LOWEST', 0.25, { fill: Y }), it(1.5, 'WE EVER', 0.3), it(2, 'WAS THE', 0.2), it(2, 'LOWEST', 0.25, { fill: Y }), it(2, 'WE EVER MADE', 0.3),
    it(1, 'Read src/routes/auth.ts (75 lines)', 0.7, { h: 0.013 })] },
  // #3 stacks line by line, older lines grey
  { start: 2.2, end: 6, transition_in: 'cut', items: [it(3.5, 'AND IT ONLY HAPPENED', 0.2), it(4, 'AND IT ONLY HAPPENED', 0.2, { fill: G }), it(4, 'BECAUSE WE', 0.25), it(4.5, 'AND IT ONLY HAPPENED', 0.2, { fill: G }), it(4.5, 'BECAUSE WE', 0.25, { fill: G }), it(4.5, 'REALIZED', 0.31, { fill: Y, h: 0.06 })] },
  // #4 THE ONLY / Question / YOU NEED: typed letter by letter; "Question" survives the cut at 8 (#5)
  { start: 6, end: 8, transition_in: 'cut', items: [it(6.5, 'THE ON', 0.2), it(7, 'THE ONLY', 0.2), it(7, 'Quest', 0.26, { fill: Y, h: 0.07 }), it(7.5, 'THE ONLY', 0.2), it(7.5, 'Question', 0.26, { fill: Y, h: 0.07 }), it(7.5, 'YOU NEED', 0.33)] },
  { start: 8, end: 10, transition_in: 'cut', items: [it(8, 'THE ONLY', 0.2), it(8, 'Question', 0.26, { fill: Y, h: 0.07 }), it(8, 'YOU NEED', 0.33), it(8.5, 'Question', 0.26, { fill: Y, h: 0.07 })] },
  // #8 PEOPLE DON'T / Buy: starts on the cut, read badly, the next shot comes in on a flash
  { start: 10, end: 11, transition_in: 'cut', items: [it(10, "PEOPLE DON'T", 0.22), it(10, 'Kng', 0.29, { fill: Y, h: 0.08, conf: 0.62 }), it(10.5, "PEOPLE DON'T", 0.22), it(10.5, 'Kng', 0.29, { fill: Y, h: 0.08, conf: 0.62 })] },
  // #18 THAT'D KEEP ME GOING FOR / 1 Day ... 365 Days
  { start: 11, end: 14, transition_in: 'flash', items: [it(12, "THAT'D KEEP ME GOING FOR", 0.2), it(12, '12 Days', 0.27, { fill: Y, h: 0.07 }), it(12.5, "THAT'D KEEP ME GOING FOR", 0.2), it(12.5, '190 Days', 0.27, { fill: Y, h: 0.07 }), it(13, "THAT'D KEEP ME GOING FOR", 0.2), it(13, '365 Days', 0.27, { fill: Y, h: 0.07 })] },
  // #20 I DON'T KNOW / How to pitch, market, sell: the last word swaps
  { start: 14, end: 17, transition_in: 'fade', items: [it(14.5, "I DON'T KNOW", 0.66), it(14.5, 'How to pitch', 0.72, { fill: Y, h: 0.06 }), it(15, "I DON'T KNOW", 0.66), it(15, 'How to market', 0.72, { fill: Y, h: 0.06 }), it(15.5, "I DON'T KNOW", 0.66), it(15.5, 'How to sell', 0.72, { fill: Y, h: 0.06 })] },
  // one word alone (a sticker) and a handle: not phrase titles
  { start: 17, end: 20, transition_in: 'cut', items: [it(18, 'FIRST', 0.4, { h: 0.1 }), it(19, '@thechrisdo', 0.9), it(19.5, 'I REALIZED', 0.2), it(19.5, 'A PROBLEM', 0.26, { fill: Y, h: 0.06 })] },
].map((s, i) => ({ index: i + 1, start: s.start, end: s.end, transition_in: s.transition_in, text: { tracks: [], items: s.items } }));
const say = (t0, text) => text.split(' ').map((w, i) => [+(t0 + i * 0.3).toFixed(2), +(t0 + i * 0.3 + 0.25).toFixed(2), w]);
const breakdown = () => JSON.parse(JSON.stringify({ source: { file: 'ref5.mp4', duration: 20 }, analysis: { vlm: 'not_configured', ocr: true }, shots, packaging: { text_cues: [] },
  speech: { ok: true, words: [...say(0.9, 'was the lowest we ever made'), ...say(6.4, 'the only question you need'), ...say(10, "people don't buy"), ...say(12, "that'd keep me going for 365 days"), ...say(14.4, "I don't know how to pitch")] } }));
module.exports = { breakdown };
