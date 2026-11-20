// A stretch dragged on the waveform, snapped to whole words (words are [start, end, text]): the start goes to the start
// of the word it lands in (or the next word, in a gap), the end to the end of the word it lands in (or the word
// before, in a gap). It never starts or ends mid-word. With no transcript yet it keeps the drag as it is; a drag that
// holds no whole word gives null. Plain JS so tests/studio-agent-ux.test.mjs can run it with no browser.
export function snapToWords(words, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (!words || !words.length) return [lo, hi];
  const s = words.find(w => w[1] > lo), e = [...words].reverse().find(w => w[0] < hi);
  if (!s || !e || e[1] <= s[0]) return null;
  return [s[0], e[1]];
}
