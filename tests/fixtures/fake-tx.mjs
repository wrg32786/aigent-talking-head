// A stand-in for kit/studio/tx_chunks.py in the tests (STUDIO_TX): the same <video> <out.json> --chunk N arguments and
// the same "progress <done> <total>" lines and JSON, with made-up word times for a talk about filming reels.
// FAKE_TX_DELAY waits between chunks (ms), FAKE_TX_FAIL exits with an error, FAKE_TX_SECONDS sets the length.
// FAKE_TX_WORDS is a JSON file of { "<part of a file name>": { duration, words: [[start, end, word]] } } for exact words.
import { writeFileSync, readFileSync, renameSync } from 'fs';

const [src, out] = process.argv.slice(2), chunk = +(process.argv[process.argv.indexOf('--chunk') + 1] || 120);
if (process.env.FAKE_TX_FAIL) { console.error('faster-whisper said no (test)'); process.exit(3); }
const LINES = [
  'What if your next reel took ten minutes to film?', 'Most people overthink the camera.', 'Um, I did too for years.',
  'Here is the setup I use every single morning.', 'One window, one phone, and a cheap clip on mic.', 'The light is soft before nine.',
  'Nobody calls, nobody knocks.', 'I read three hooks out loud and keep the one that makes me smile.', 'Then I film it twice.',
  'The first take is always stiff.', 'The second one sounds like me.', 'Uh, that is the whole trick honestly.',
  'Here is the mistake I see the most.', 'People record one long take and hope.', 'Short lines are easier to say and easier to cut.',
  'So write like you talk.', 'Read it once before you press record.', 'Keep your eyes on the lens, not the screen.',
  'The number one thing is energy.', 'Smile before the first word.', 'It changes your voice.',
  'Why does this work so well?', 'Because viewers decide in about a second.', 'If your face says bored, they swipe.',
  'Here is a quick story.', 'A friend of mine posted every day for a month.', 'Her views tripled when she cut the intros.',
  'She started with the answer, not the question.', 'That is the secret to retention.', 'Every reel needs a reason to stay.',
  'Try this tomorrow morning.', 'Film three takes, keep the best one.', 'Follow for more filming tips and tell me how it went.',
];
const secs = +(process.env.FAKE_TX_SECONDS || 0);
const words = []; let t = 0.4;
for (let k = 0; ; k++) {
  const line = LINES[k % LINES.length].split(' ');
  for (const w of line) { const d = 0.22 + (w.length % 5) * 0.05; words.push([+t.toFixed(2), +(t + d).toFixed(2), w]); t += d + 0.06; }
  t += k % 7 === 6 ? 1.6 : 0.35; // a long pause now and then
  if (secs ? t > secs - 2 : k >= LINES.length - 1) break;
}
let duration = +(secs || t + 0.6).toFixed(2);
if (process.env.FAKE_TX_WORDS) {
  const map = JSON.parse(readFileSync(process.env.FAKE_TX_WORDS, 'utf8')), k = Object.keys(map).find(k => src.includes(k));
  if (k) { words.length = 0; words.push(...map[k].words); duration = map[k].duration; }
}
const total = Math.max(1, Math.ceil(duration / chunk));
let st; try { st = JSON.parse(readFileSync(out, 'utf8')); } catch { st = { file: src, duration, chunk, total, done: [], words: [], model: 'fake' }; }
const save = () => { writeFileSync(out + '.tmp', JSON.stringify(st)); renameSync(out + '.tmp', out); };
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log(`progress ${st.done.length} ${total}`);
for (let i = 0; i < total; i++) {
  if (st.done.includes(i)) continue;
  await wait(+(process.env.FAKE_TX_DELAY || 0));
  st.words = st.words.concat(words.filter(w => w[0] >= i * chunk && w[0] < (i + 1) * chunk)); st.done.push(i); save();
  console.log(`progress ${st.done.length} ${total}`);
}
