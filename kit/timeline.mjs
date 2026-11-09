// Print where every segment and every word lands on the OUTPUT clock, so captions.js and the hit lists can be
// written straight from it. Run from build/ after tx.py has written words.json for the segment files.
//   node <kit>/timeline.mjs            -> segment table + word list in output seconds
//   node <kit>/timeline.mjs --cuts     -> just the seam times (use them for "hits" and sfx.F)
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
const C = JSON.parse(readFileSync('cut.json', 'utf8'));
const W = existsSync('words.json') ? JSON.parse(readFileSync('words.json', 'utf8')) : {};
let t = 0; const seams = [];
console.log('seg | file | src in-out | output start-end');
C.segs.forEach((s, i) => {
  const start = t, speech = t + (s.pad || 0), end = speech + (s.out - s.in);
  if (i) seams.push(+start.toFixed(3));
  console.log(`${i} | ${s.file} | ${s.in}-${s.out} | ${start.toFixed(2)}-${end.toFixed(2)}`);
  if (!process.argv.includes('--cuts')) {
    const ws = W[basename(s.file)] || [];
    const line = ws.filter(([a, b]) => a >= s.in - 0.05 && b <= s.out + 0.05).map(([a, , w]) => `${(speech + a - s.in).toFixed(2)}:${w}`).join(' ');
    if (line) console.log('    ' + line);
  }
  t = end;
});
console.log('seams:', JSON.stringify(seams), ' total:', (t + (C.tail ?? 0.3)).toFixed(2));
console.log('Word times from Whisper can run 0.3-0.6 s early on cinematic takes: confirm caption starts against silencedetect blocks.');
