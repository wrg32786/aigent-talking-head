// Title effects and exits (1.29.0, from the frame by frame teardown of reference 5). Each case is a small captions.js
// drawn by the real overlay (kit/overlay.html through kit/render.mjs) and read back from the pixels.
//   phrase titles   the lines as given, a yellow key word, white partner words; no word is drawn before its start
//   glow and dim    per title, in a job that has both off, on the lockup path and on the phrase path
//   type            letter by letter with a caret; slot-roll: digits roll and lock, "swap" rolls one word of a line
//   count-up        an eased count that rolls to its final text; stack-fade: older lines grey and fade
//   decode          glyphs settle into the key word; split-flap: the title on a flap board
//   exits           blow-up, polaroid, glitch-slice, dip-black in the overlay; kit/rules.cjs titleExitSeams picks the cut
//                   and kit/assemble.cjs plays the exit there in place of the segment's own transition
//   every effect    the same moment drawn twice, in another order, is the same picture
//   runningCaptions false: no caption word is drawn in any style, a phrase title still is
// Run: node tests/title-effects.test.mjs   (needs Chrome and ffmpeg; part of npm run check)
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit'), R = require('../kit/rules.cjs'), XFX = require('../kit/xfx.cjs');
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('skip the title effect tests (needs ffmpeg to read the frames)'); process.exit(0); }
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.error('FAIL ' + m); } };
const dirs = [];
const tmp = p => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const rgba = png => execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 << 20 });
// draw stills at the given times; px(t) is the frame as RGBA
const draw = (caps, dur, stills) => {
  const d = tmp('titlefx-');
  writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
  const log = execFileSync('node', [join(KIT, 'render.mjs'), String(dur), stills.join(',')], { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return { d, log, px: t => rgba(join(d, 'stills', `t${t.toFixed(2)}.png`)) };
};
const base = { captionStyle: 'one-word', captionOutline: 'none', captionShadow: 'none', fonts: 'instrument', titleLayer: 'front', theme: { colors: { accent: '#ffd400', text: '#ffffff', muted: '#808080' } }, lockup: { heroColor: 'accent' } };
const W = 1080, H = 1920;
const count = (b, f) => { let n = 0; for (let i = 0; i < b.length; i += 4) if (f(b[i], b[i + 1], b[i + 2], b[i + 3])) n++; return n; };
const inked = b => count(b, (r, g, bl, a) => a > 100);
const yellow = (r, g, b, a) => a > 200 && r > 200 && g > 160 && b < 90, white = (r, g, b, a) => a > 200 && r > 225 && g > 225 && b > 225;
// the box of the pixels that pass f
const box = (b, f = (r, g, bl, a) => a > 100) => { let x0 = W, x1 = -1, y0 = H, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (f(b[i], b[i + 1], b[i + 2], b[i + 3])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return x1 < 0 ? null : { x0, x1, y0, y1, w: x1 - x0 + 1 }; };
// the box of the pixels where two frames differ
const diff = (a, b) => { let n = 0, x0 = W, x1 = -1, y0 = H, y1 = -1; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) { n++; const p = i / 4, x = p % W, y = (p - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { n, x0, x1, y0, y1 }; };
const at = (b, x, y) => [...b.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
const halo = b => count(b, (r, g, bl, a) => a > 110 && a < 250 && Math.max(r, g, bl) > 30);

// ---- rules.cjs and the overlay resolve effects the same way
{ const flips = [{ start: 1, end: 2, text: 'one', mode: 7 }, { start: 3, end: 4, text: 'two words', mode: 7, effect: 'decode' }, { start: 5, end: 6, text: 'three', mode: 7, swap: ['a', 'b'] },
    { start: 7, end: 8, text: 'four 4', mode: 7, count: { from: 1, to: 4 } }, { start: 9, end: 10, text: 'five', mode: 7, exit: 'polaroid' }, { start: 11, end: 12, text: 'six', mode: 7, effect: 'nope' }, { start: 13, end: 14, text: 'seven', mode: 7 }];
  const line = ts => ts.map(t => `${t.start}s ${t.entrance}${t.flicker ? '+flicker' : ''}`).join(', ');
  for (const [what, job] of [['per title', {}], ['with a job titleEffect and titleExit', { titleEffect: 'type', titleExit: 'dip-black' }]]) {
    const caps = { ...base, ...job, flips }, rt = R.resolveTitles(caps), r = draw(caps, 15, [1.5]);
    ok(r.log.includes('titles ' + line(rt)), `${what}: the overlay and rules.cjs resolveTitles agree on every title (${line(rt)}): ${(r.log.match(/^titles .*/m) || [''])[0]}`);
    if (!job.titleEffect) {
      ok(rt[1].effect === 'decode' && rt[2].effect === 'slot-roll' && rt[3].effect === 'count-up' && rt[5].effect === null && rt[4].exit === 'polaroid', 'an effect is named, or comes from "swap" or "count"; an unknown one is ignored');
      ok(rt[1].entrance === 'decode' && !rt.some(t => t.flicker && t.effect), 'a title with an effect has the effect as its entrance and no flicker');
      const pool = rt.filter(t => !t.effect).map(t => t.entrance);
      ok(pool.join() === R.ENTRANCES.slice(0, pool.length).join(), `titles with an effect take no entrance from the pool: the others get ${pool.join(', ')}`);
    } else ok(rt.every((t, i) => i === 5 ? t.effect === null : t.effect) && rt[0].effect === 'type' && rt[1].effect === 'decode' && rt[0].exit === 'dip-black' && rt[4].exit === 'polaroid', 'the job default reaches the titles that name none (an unknown name stays none)');
  }
}
// ---- every effect and exit at once: drawn twice, the second time in the opposite order, every frame is the same
const ALL = { ...base, flips: [
  { start: 0.5, end: 2.5, mode: 7, text: 'THE ONLY|Question|YOU NEED', phrase: true, key: 'Question', effect: 'type', exit: 'glitch-slice' },
  { start: 3, end: 5, mode: 7, text: '$3.9M|WAS THE LOWEST', phrase: true, key: '$3.9M', effect: 'slot-roll', exit: 'blow-up' },
  { start: 6, end: 9, mode: 7, text: "THAT'D KEEP ME GOING FOR|365 Days", phrase: true, key: '365 Days', count: { from: 1, to: 365, unit: 'Days', final: '1 Year' }, exit: 'polaroid' },
  { start: 10, end: 13, mode: 7, text: 'AND IT ONLY HAPPENED|BECAUSE WE|Realized', phrase: true, key: 'Realized', effect: 'stack-fade', exit: 'dip-black' },
  { start: 14, end: 16, mode: 7, text: 'THE BEST WAY|TO USE|AI', phrase: true, key: 'AI', effect: 'decode' },
  { start: 17, end: 20, mode: 7, text: "I'M GONNA SHOW YOU|HOW TO DEAL|WITH IT", phrase: true, key: 'DEAL', effect: 'split-flap' },
  { start: 21, end: 25, mode: 7, text: "I DON'T KNOW|How to pitch", phrase: true, key: 'How to pitch', swap: ['pitch', 'market', 'do sales'] }] };
{ const ts = [0.9, 2.35, 3.5, 4.9, 6.6, 8.7, 11.2, 12.9, 14.3, 17.7, 22.3];
  const a = draw(ALL, 26, ts), b = draw(ALL, 26, [...ts].reverse());
  const bad = ts.filter(t => Buffer.compare(a.px(t), b.px(t)) !== 0);
  ok(!bad.length, `type, slot-roll, count-up, stack-fade, decode, split-flap, the word swap and the four exits draw the same picture for the same moment, whatever the order (${ts.length} moments; different at ${bad.join(', ') || 'none'})`);
  ok(ts.every(t => inked(a.px(t)) > 500), 'each of those moments has the title on it');
}
// ---- phrase titles: the key word yellow and larger, partner words white, no word before its start
{ const flips = [{ start: 1, end: 4, mode: 7, text: "PEOPLE DON'T|Buy", phrase: true, key: 'Buy', words: [[1, 1.3, 'PEOPLE'], [1.3, 1.6, "DON'T"], [2.5, 2.9, 'Buy']] }];
  const r = draw({ ...base, flips }, 5, [1.27, 2.4, 3.8]), early = r.px(1.27), mid = r.px(2.4), late = r.px(3.8);
  ok(count(mid, yellow) === 0 && count(mid, white) > 3000, `the key word "Buy", said at 2.5 s, is not on the frame at 2.4 s; the partner words are (${count(mid, yellow)} yellow, ${count(mid, white)} white pixels)`);
  ok(box(early, white).w < box(mid, white).w - 150, '"DON\'T", said at 1.3 s, is not on the frame at 1.27 s');
  const kb = box(late, yellow), pb = box(late, white);
  ok(kb && pb && kb.y0 > pb.y1 - 10 && kb.y1 - kb.y0 > (pb.y1 - pb.y0) * 1.6, `the key word is yellow, under the white partner line and larger (${kb && kb.y1 - kb.y0} px against ${pb && pb.y1 - pb.y0})`);
  ok(pb.y1 < 420 && kb.y1 < 620, `the phrase sits in the title band above the head (it ends at y ${kb.y1})`);
}
// ---- glow and dim per title, in a job with both off: the old lockup path and the phrase path
{ const lock = { start: 1, end: 3, text: 'if we made $30K', mode: 7, hero: '$30K' }, phr = { start: 4, end: 6, text: 'IF WE MADE|$30K', mode: 7, phrase: true, key: '$30K' };
  const off = draw({ ...base, flips: [lock, phr] }, 7, [2.5, 5.5]), on = draw({ ...base, flips: [{ ...lock, glow: 'strong', dim: 0.4 }, { ...phr, glow: 'strong' }] }, 7, [2.5, 3.5, 5.5]);
  const corner = b => at(b, 20, 1900)[3];
  ok(halo(on.px(2.5)) > halo(off.px(2.5)) + 20000, `"glow" on a lockup title puts the glow round its key word with the job's glow off (${halo(on.px(2.5))} soft coloured pixels against ${halo(off.px(2.5))})`);
  ok(halo(on.px(5.5)) > halo(off.px(5.5)) + 20000, `"glow" on a phrase title does the same (${halo(on.px(5.5))} against ${halo(off.px(5.5))})`);
  ok(Math.abs(corner(on.px(2.5)) - 102) <= 3 && corner(off.px(2.5)) === 0, `"dim": 0.4 on a title darkens the picture by 40% while it is up (alpha ${corner(on.px(2.5))})`);
  ok(corner(on.px(3.5)) === 0 && corner(on.px(5.5)) === 0, 'the dim is only there while that title is up: not after it, not under the next title');
}
// ---- type
{ const flips = [{ start: 1, end: 5, mode: 7, text: 'AB CD|Key', phrase: true, key: 'Key', effect: 'type' }]; // 10 letters and spaces at 0.083 s: typed by 1.747 s
  const r = draw({ ...base, flips }, 6, [1.1, 1.3, 1.78, 1.95, 2.6]);
  const cols = t => { const b = box(r.px(t)); return b ? b.w : 0; };
  ok(cols(1.1) < cols(1.3) && inked(r.px(1.3)) < inked(r.px(1.95)) * 0.6, `type: fewer letters early than late (${cols(1.1)} px wide at 0.1 s, ${cols(1.3)} at 0.3 s)`);
  ok(count(r.px(1.3), yellow) === 0 && count(r.px(1.95), yellow) > 2000, 'type: line after line, the key word on the second line comes after the first line is typed');
  const car = diff(r.px(1.78), r.px(1.95));
  ok(car.n > 300 && car.x1 - car.x0 < 40 && car.y1 - car.y0 > 60 && inked(r.px(1.78)) > inked(r.px(1.95)), `type: a caret stands after the last letter and blinks (a bar ${car.x1 - car.x0 + 1} by ${car.y1 - car.y0 + 1} px)`);
  ok(diff(r.px(1.95), r.px(2.6)).n === 0, 'type: the caret goes and the title holds');
  const w = draw({ ...base, flips: [{ ...flips[0], words: [[1, 1.2, 'AB'], [1.2, 1.4, 'CD'], [3, 3.4, 'Key']] }] }, 6, [2.9, 3.3]);
  ok(count(w.px(2.9), yellow) === 0 && count(w.px(3.3), yellow) > 300, 'type with word times: a word\'s letters never start before the word is said');
  const b = draw({ ...base, flips: [{ start: 1, end: 5, mode: 7, text: 'AB CD|Key', phrase: true, key: 'Key', build: 'letter' }] }, 6, [1.3, 2.6]);
  ok(diff(b.px(1.3), r.px(1.3)).n === 0 && diff(b.px(2.6), r.px(2.6)).n === 0, '"build": "letter" types the title the same way');
}
// ---- slot-roll (digits), decode and split-flap against the same title with no effect
{ const t = { start: 1, end: 5, mode: 7, text: '$3.9M|WAS THE LOWEST', phrase: true, key: '$3.9M' };
  const plain = draw({ ...base, flips: [t] }, 6, [4.2]).px(4.2);
  const roll = draw({ ...base, flips: [{ ...t, effect: 'slot-roll' }] }, 6, [1.5, 4.2]), dec = draw({ ...base, flips: [{ ...t, effect: 'decode' }] }, 6, [1.2, 4.2]), flap = draw({ ...base, flips: [{ ...t, effect: 'split-flap' }] }, 6, [1.3, 4.2]);
  ok(diff(roll.px(4.2), plain).n === 0, 'slot-roll: once every digit has locked the frame is the plain title');
  const d = diff(roll.px(1.5), plain), kb = box(plain, yellow);
  ok(d.n > 2000 && d.x0 > kb.x0 + 40, `slot-roll: mid-roll the digits differ and the "$" before them stands still (the frames differ from x ${d.x0}, the key word starts at ${kb.x0})`);
  ok(diff(dec.px(4.2), plain).n === 0 && diff(dec.px(1.2), plain).n > 2000, 'decode: scrambled glyphs mid-way, the plain title once settled');
  const tiles = b => count(b, (r, g, bl, a) => a > 200 && Math.max(r, g, bl) < 70);
  ok(tiles(flap.px(4.2)) > 20000 && tiles(plain) < 2000, `split-flap: the title sits on dark tiles (${tiles(flap.px(4.2))} dark pixels against ${tiles(plain)})`);
  ok(diff(flap.px(1.3), flap.px(4.2)).n > 2000 && count(flap.px(4.2), yellow) > 500 && count(flap.px(4.2), white) > 500, 'split-flap: the tiles flip through characters, then settle with the key word in the accent');
}
// ---- slot-roll with "swap": one word of the line rolls, the rest stays put
{ const flips = [{ start: 1, end: 5, mode: 7, text: "I DON'T KNOW|How to pitch", phrase: true, key: 'How to pitch', swap: ['pitch', 'market', 'do sales'] }]; // the words come in 0.2 s apart, so the last one is up at 2 s and each text holds 0.95 s
  const r = draw({ ...base, flips }, 6, [2.6, 3.05, 3.5, 4.5]), a = r.px(2.6), m = r.px(3.5), z = r.px(4.5);
  const top = box(a, white), key = box(a, yellow), d1 = diff(a, m), d2 = diff(m, z);
  ok(d1.n > 1000 && d2.n > 1000, 'swap: the last word of the key line changes twice (pitch, market, do sales)');
  ok(d1.y0 > top.y1 && d2.y0 > top.y1, 'swap: the line above does not change');
  ok(d1.x0 > key.x0 + 150 && d2.x0 > key.x0 + 150 && box(m, yellow).x0 === key.x0 && box(z, yellow).x0 === key.x0, `swap: "How to" stays where it is while the word after it rolls (changes start at x ${d1.x0} and ${d2.x0}, the line at ${key.x0})`);
  ok(diff(r.px(3.05), a).n > 500 && diff(r.px(3.05), m).n > 500, 'swap: mid-roll both words are moving');
}
// ---- count-up
{ const flips = [{ start: 1, end: 5, mode: 7, text: "THAT'D KEEP ME GOING FOR|365 Days", phrase: true, key: '365 Days', count: { from: 1, to: 365, unit: 'Days', final: '1 Year' } }]; // the key word is up at 2 s, counts for 1.4 s, rolls at 3.58 s
  const r = draw({ ...base, flips }, 6, [2.05, 2.5, 2.9, 3.45, 4.4, 4.8]), w = t => box(r.px(t), yellow).w;
  ok(w(2.05) < w(2.5) && w(2.5) < w(2.9) && w(2.5) < w(3.45), `count-up: the number grows from "1 Day" to "365 Days" (${[2.05, 2.5, 2.9, 3.45].map(w).join(', ')} px wide)`);
  ok(diff(r.px(3.45), r.px(4.4)).n > 1000 && w(4.4) < w(3.45), 'count-up: it then rolls to the final text, "1 Year"');
  ok(diff(r.px(4.4), r.px(4.8)).n === 0, 'count-up: the final text holds');
}
// ---- stack-fade
{ const flips = [{ start: 1, end: 5, mode: 7, text: 'AND IT ONLY|HAPPENED BECAUSE|Sales', phrase: true, key: 'Sales', effect: 'stack-fade' }]; // lines at 1, 1.5 and 2 s
  const r = draw({ ...base, flips }, 6, [1.4, 3.5]), a = r.px(1.4), z = r.px(3.5), l1 = box(a);
  const rows = (b, y0, y1) => { let al = 0, lum = 0; for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) { const p = at(b, x, y); if (p[3] > al) al = p[3]; if (p[3] > 60 && p[0] > lum) lum = p[0]; } return { al, lum }; };
  const young = rows(a, l1.y0, l1.y1), old = rows(z, l1.y0, l1.y1), kb = box(z, yellow);
  ok(young.al > 250 && young.lum > 250, 'stack-fade: the first line arrives alone, white and solid');
  ok(old.al < 150 && old.lum < 190, `stack-fade: two lines later it is fainter and greyer (alpha ${old.al} of 255, brightness ${old.lum})`);
  ok(kb && kb.y0 > l1.y1 && count(z, yellow) > 2000, 'stack-fade: the newest line is sharp and in full colour under it');
  ok(box(z).y0 >= l1.y0 - 12, 'stack-fade: the lines stack downward, the first one stays where it came in');
}
// ---- exits in the overlay
{ const t = { start: 1, end: 3, mode: 7, text: "PEOPLE DON'T|Buy", phrase: true, key: 'Buy' };
  const fr = k => +(k / 24).toFixed(4), still = 2.5, plain = draw({ ...base, flips: [t] }, 4, [still]).px(still);
  const blow = draw({ ...base, flips: [{ ...t, exit: 'blow-up' }] }, 4, [still, 2.85, 3, 3.125, 3.3]);
  ok(diff(blow.px(still), plain).n === 0, 'an exit changes nothing before its last moments');
  ok(box(blow.px(2.85), yellow).w > box(plain, yellow).w * 1.4, 'blow-up: the key word grows past its size');
  const full = blow.px(3);
  ok([[30, 30], [540, 960], [1050, 1890], [100, 1500], [900, 300]].every(([x, y]) => yellow(...at(full, x, y))), `blow-up: at the cut the whole frame is the key word's colour (${at(full, 540, 960)})`);
  ok(at(blow.px(3.125), 540, 960)[3] < 200 && at(blow.px(3.125), 540, 960)[3] > 40 && inked(blow.px(3.3)) === 0, 'blow-up: the flash fades over the first frames after the cut');
  const pol = draw({ ...base, flips: [{ ...t, exit: 'polaroid' }] }, 4, [2.75, fr(71)]), pb = box(pol.px(2.75)), b0 = box(plain);
  ok(pb && pb.w < b0.w * 0.85 && pb.y0 > b0.y0, `polaroid: the title shrinks toward the middle of the frame with the picture (${pb && pb.w} px wide against ${b0.w})`);
  ok(!box(pol.px(fr(71))) || box(pol.px(fr(71))).x0 > 800, 'polaroid: it has slid off to the right by the cut');
  const gl = draw({ ...base, flips: [{ ...t, exit: 'glitch-slice' }] }, 4, [2.85]), gb = box(gl.px(2.85));
  ok(gb && (gb.x0 < b0.x0 - 60 || gb.x1 > b0.x1 + 60) && gb.y0 >= b0.y0 - 2 && gb.y1 <= b0.y1 + 40, `glitch-slice: bands of the title move sideways, none up or down (x ${gb && gb.x0} to ${gb && gb.x1} against ${b0.x0} to ${b0.x1})`);
  const dip = draw({ ...base, flips: [{ ...t, exit: 'dip-black' }] }, 4, [2.9]);
  const mx = b => { let m = 0; for (let i = 3; i < b.length; i += 4) if (b[i] > m) m = b[i]; return m; };
  ok(mx(dip.px(2.9)) < 160 && mx(dip.px(2.9)) > 60 && mx(plain) === 255, `dip-black: the title fades out over its last 0.2 s (alpha ${mx(dip.px(2.9))} of 255 half way)`);
}
// ---- a title's exit is the transition at the cut it ends on
{ const cut = { segs: [{ file: 'a.mp4', in: 0, out: 1.5 }, { file: 'b.mp4', in: 0, out: 1.5, transition: 'whip' }, { file: 'a.mp4', in: 0, out: 1 }], tail: 0 };
  const caps = { ...base, flips: [{ start: 0.2, end: 1.45, mode: 7, text: 'ONE|Two', phrase: true, exit: 'polaroid' }, { start: 1.8, end: 2.4, mode: 7, text: 'mid shot', exit: 'glitch-slice' }, { start: 2.5, end: 3.1, mode: 7, text: 'three', exit: 'blow-up' }] };
  const S = R.titleExitSeams(caps, cut);
  ok(Object.keys(S).join() === '1,2', `titleExitSeams: a title that ends within 0.2 s of a cut names that cut; one that ends mid shot names none (${Object.keys(S).join()})`);
  ok(S[1] && S[1].exit === 'polaroid' && S[1].m.custom === 'polaroid' && S[1].lead === 0.45 && S[2] && S[2].exit === 'blow-up' && S[2].m === null, 'titleExitSeams: polaroid is a drawn blend that plays before the cut, blow-up a hard cut under the flash');
  ok(R.TITLE_EXITS.every(x => R.TITLE_EXIT_MOVES[x]) && XFX.isCustom({ custom: 'polaroid' }) && XFX.isCustom({ custom: 'glitch-slice' }) && R.xfadeMode('fadeblack') === 'fadeblack', 'every exit has its move in the picture');
  ok(!Object.keys(R.titleExitSeams({ flips: [{ start: 0.2, end: 1.45, mode: 7, text: 'x' }] }, cut)).length, 'a title with no exit asks for nothing');
  // the real assembler on two flat clips: red, then blue
  const d = tmp('titlefx-asm-'), ff = a => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { cwd: d, stdio: 'pipe' });
  for (const [f, c] of [['a.mp4', 'red'], ['b.mp4', 'blue']]) ff(['-f', 'lavfi', '-i', `color=c=${c}:s=1080x1920:r=24:d=2`, '-f', 'lavfi', '-i', 'sine=f=300:d=2', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f]);
  writeFileSync(join(d, 'cut.json'), JSON.stringify(cut)); writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ ...caps, flips: caps.flips.slice(0, 1) }) + ';\n');
  let log = '';
  try { log = execFileSync(process.execPath, [join(KIT, 'assemble.cjs'), 'out.mp4'], { cwd: d, env: { ...process.env, NOBED: '1', NOSFX: '1' }, stdio: 'pipe' }).toString(); } catch (e) { log = 'assemble failed: ' + String(e.stderr || e.message).slice(-600); }
  ok(/cut at 1\.50 s: the title "ONE Two" leaves by polaroid, which is the transition there \(in place of whip\)/.test(log), 'assemble says in one line that the exit is the transition there: ' + log.split('\n').filter(l => /cut at|failed/.test(l)).join(' | ').slice(0, 700));
  const frame = t => { ff(['-ss', String(t), '-i', 'out.mp4', '-frames:v', '1', '-vf', 'scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'f.raw']); const b = readFileSync(join(d, 'f.raw')); let r = 0, bl = 0, wh = 0; for (let i = 0; i < b.length; i += 3) { if (b[i] > 150 && b[i + 2] < 90) r++; else if (b[i + 2] > 150 && b[i] < 90) bl++; else if (b[i] > 190 && b[i + 1] > 190 && b[i + 2] > 190) wh++; } return { r, bl, wh, n: b.length / 3 }; };
  try { const a = frame(0.9), m = frame(1.3), z = frame(1.54);
    ok(a.r > a.n * 0.6 && a.bl < a.n * 0.02, 'assemble: before the exit the first shot fills the frame');
    ok(m.r > m.n * 0.1 && m.bl > m.n * 0.2 && m.wh > 500, `assemble: 0.2 s before the cut the first shot is a small print with a white border over the next shot (${m.r} red, ${m.bl} blue, ${m.wh} white of ${m.n})`);
    ok(z.bl > z.n * 0.6 && z.r < z.n * 0.02, 'assemble: the exit is over by the cut, so the next shot starts on its own time');
  } catch (e) { ok(false, 'assemble wrote no readable out.mp4: ' + String(e.message).slice(0, 300)); }
  // the two drawn blends alone, half way: both shots on the frame
  for (const id of ['polaroid', 'glitch-slice']) {
    try { ff(['-f', 'lavfi', '-i', 'color=c=red:s=270x480:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=270x480:r=24:d=1', '-filter_complex', `[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]xfade=${XFX.xfadeOpts({ custom: id })}:duration=0.5:offset=0.25,select=eq(n\\,13)`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', id + '.raw']);
      const b = readFileSync(join(d, id + '.raw')); let r = 0, bl = 0; for (let i = 0; i < b.length; i += 3) { if (b[i] > 150 && b[i + 2] < 90) r++; else if (b[i + 2] > 150 && b[i] < 90) bl++; }
      ok(r > 3000 && bl > 3000, `${id}: the xfade expression runs in ffmpeg and shows both shots half way (${r} red, ${bl} blue pixels)`);
    } catch (e) { ok(false, `${id}: ffmpeg refused the xfade expression: ` + String(e.stderr || e.message).slice(-300)); }
  }
}
// ---- "runningCaptions": false: no caption word in any style, the titles still draw
{ const flips = [{ start: 1, end: 2.4, text: 'you pay a designer', mode: 0, words: [[1, 1.3, 'you'], [1.3, 1.6, 'pay'], [1.6, 1.8, 'a'], [1.8, 2.3, 'designer']] }, { start: 3, end: 5, mode: 7, text: 'THE ONLY|Question', phrase: true, key: 'Question' }];
  for (const style of ['one-word', 'kinetic', 'pill', 'hormozi']) {
    const on = draw({ ...base, captionStyle: style, flips }, 6, [2, 4.5]), off = draw({ ...base, captionStyle: style, runningCaptions: false, flips }, 6, [2, 4.5]);
    ok(inked(on.px(2)) > 1000 && inked(off.px(2)) === 0, `${style}: with "runningCaptions": false the frame is empty where only a caption word was up (${inked(on.px(2))} inked pixels with it on, ${inked(off.px(2))} off)`);
    ok(count(off.px(4.5), yellow) > 2000 && count(off.px(4.5), white) > 2000, `${style}: the phrase title still draws with running captions off`);
    if (style === 'one-word') ok(!/one-word captions: \d+ words/.test(off.log) && /one-word captions: 4 words/.test(on.log), 'no caption word is counted for the title and caption checks');
  }
}
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED, ${pass} passed` : `\n${pass} title effect checks passed`);
process.exit(failed ? 1 : 0);
