// Titles and the caption bar (Studio report 4, items 2 to 6, 8, 13 and 14). Each case is a small captions.js drawn by
// the real overlay (kit/overlay.html through kit/render.mjs).
//   2  while a title is up the caption bar shows nothing; a word that started before it ends at the title's start
//   3  the 0.12 s minimum never carries a word past a title's start ("You pay a designer for it" said in half a second)
//   4  beat snap: one line per title moved, the title's own caption word moves with it, "snap": false is honoured
//   5  the title check (kit/titlecheck.mjs, part of npm run verify) fails on the report's DESIGNER on "For" frame,
//      from the caption words and from the drawn text layer, and passes on the same job with the rule on
//   6  "titleLockup": "full" draws the partner line with the key word in the one-word style; lockups.json lists what is drawn
//   8  "titleGlow" and "titleDim": a glow round the key word, the picture darker while a title is up
//   13 an app label that only repeats the caption word is not drawn
//   14 a low-contrast caption moment ("boost") gets the shadow even when the style has none
// Run: node tests/title-rules.test.mjs   (needs Chrome and ffmpeg; part of npm run check)
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { titleCheck } from '../kit/titlecheck.mjs';
const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit'), B = createRequire(import.meta.url)('../kit/beats.cjs');
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.error('FAIL ' + m); } };
const dirs = [];
const draw = (caps, dur, { env = {}, stills = null } = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'titlerules-')); dirs.push(d);
  writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
  const log = execFileSync('node', [join(KIT, 'render.mjs'), String(dur), ...(stills ? [stills.join(',')] : [])], { cwd: d, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const j = f => (existsSync(join(d, f)) ? JSON.parse(readFileSync(join(d, f), 'utf8')) : null);
  return { d, log, words: j('words.json') || [], held: j('words-held.json') || [], lockups: j('lockups.json') || [] };
};
const hasFf = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const rgba = png => execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 << 20 });
const base = { captionStyle: 'one-word', captionColor: '#ffffff', captionOutline: 'none', captionShadow: 'none', fonts: 'pirata', titleLayer: 'front' };

// ---- the report's case: "You pay a designer for it" in half a second, the title "for it" at 12.77
const T0 = 12.77, T1 = 13.64;
const report = { ...base, flips: [
  { start: 11.9, end: 12.75, text: 'You pay a designer', mode: 0, words: [[12.35, 12.45, 'You'], [12.47, 12.55, 'pay'], [12.59, 12.6, 'a'], [12.6, 12.74, 'designer']] },
  { start: T0, end: T1, text: 'for it', mode: 7, hero: 'for' },
  { start: 12.75, end: 13.9, text: 'for it', mode: 0, words: [[12.75, 13.71, 'for'], [13.71, 13.9, 'it']] },
  { start: 14.0, end: 15.0, text: 'every single time', mode: 0, words: [[14.0, 14.3, 'every'], [14.3, 14.6, 'single'], [14.6, 14.95, 'time']] }] };
{ // the old rule first: the check must fail on it, on frame 307, from the words and from the pixels
  const r = draw({ ...report, titleClear: false }, 14.5);
  const des = r.words.find(w => w.word === 'designer');
  ok(des && des.end > T0, `old rule: the minimum carries "designer" past the title's start (it ends at ${des && des.end})`);
  const tc = titleCheck(r.d, { dur: 14.5 });
  ok(tc.ran && tc.frames === 16, `the check reads two frames before to five after the title's start and its end (${tc.frames} frames)`);
  ok(tc.fails.some(f => /^frame 307 /.test(f) && /"designer"/.test(f) && /is up/.test(f)), 'the check fails on frame 307: "designer" in the bar while the title is up: ' + tc.fails.join(' | '));
  if (!hasFf) console.log('skip the drawn text layer check (needs ffmpeg)'); else ok(tc.fails.some(f => /^frame 307 /.test(f) && /letter pixels/.test(f) && /ovl\/0307\.png/.test(f)), 'the check finds the word in the drawn text layer (build/ovl/0307.png): ' + tc.fails.join(' | '));
  ok(tc.fails.some(f => /"for" is in the caption bar just after its own title/.test(f)), 'the check fails on the key word in the bar after its title has left: ' + tc.fails.join(' | '));
}
{ const r = draw(report, 14.5);
  const up = r.words.filter(w => w.start < T1 - 1e-6 && w.end > T0 + 1e-6);
  ok(!up.length, `no caption word is on screen while the title is up (${up.map(w => `${w.word} ${w.start}-${w.end}`).join(', ')})`);
  const des = r.words.find(w => w.word === 'designer'), a = r.words.find(w => w.word === 'a');
  ok(des && Math.abs(des.end - T0) < 0.002 && des.start <= T0 - 0.12 + 1e-6, `"designer" ends at the title's start and is up for the minimum before it (${des && des.start} to ${des && des.end})`);
  ok(a && a.end - a.start < 0.12 && a.end - a.start > 0.04, `the word before gives up time instead ("a" is up ${a && (a.end - a.start).toFixed(3)} s)`);
  ok(r.words.every((w, i) => !i || w.start >= r.words[i - 1].end - 1e-6), 'the words stay in order, one at a time');
  ok(!r.words.some(w => w.word === 'for'), 'the title\'s own word "for" is never in the bar');
  ok(r.held.some(h => h.word === 'for' && h.why === 'title word'), 'words-held.json says why "for" was left out');
  ok(/1 word left out of the bar while a title is up/.test(r.log), 'the build log says a word was left out of the bar');
  const tc = titleCheck(r.d, { dur: 14.5 });
  ok(tc.ran && !tc.fails.length && tc.pixelFrames >= 8, `the check passes with the rule on (${tc.pixelFrames} frames read from the text layer): ${tc.fails.join(' | ')}`);
}
// ---- a word that holds on under a title ("SAY" inside "What", report 3 item 18), and a word said under a title
{ const r = draw({ ...base, flips: [
    { start: 2.4, end: 3.2, text: 'what would you say', mode: 0, words: [[2.4, 2.6, 'what'], [2.6, 2.75, 'would'], [2.75, 2.9, 'you'], [2.9, 3.15, 'say']] },
    { start: 3.3, end: 4.3, text: 'what do I do', mode: 7, hero: 'what' },
    { start: 3.3, end: 5.2, text: 'what do I do now then', mode: 0, words: [[3.3, 3.5, 'what'], [3.5, 3.65, 'do'], [3.65, 3.8, 'I'], [3.8, 4.25, 'do'], [4.4, 4.7, 'now'], [4.7, 5.1, 'then']] }] }, 6, { env: { TEXTCHECK: 'only' } });
  const say = r.words.find(w => w.word === 'say'), up = r.words.filter(w => w.start < 4.3 - 1e-6 && w.end > 3.3 + 1e-6);
  ok(say && say.end <= 3.3 + 1e-6, `"say" leaves when the title "What" enters (it ends at ${say && say.end})`);
  ok(!up.length, `nothing is in the bar from 3.3 to 4.3 s (${up.map(w => w.word).join(', ')})`);
  ok(r.words.filter(w => w.word === 'what').length === 1, 'the "what" said before the title still shows; the one the title says does not');
  ok(r.words.some(w => w.word === 'now' && Math.abs(w.start - 4.4) < 0.002), 'the bar comes back with the next word after the title');
}
// ---- 4 beat snap
{ const caps = { flips: [{ start: 12.84, end: 13.71, text: 'for it', mode: 7 }, { start: 12.84, end: 13.71, text: 'for', mode: 0, words: [[12.84, 13.71, 'for']] },
    { start: 11.9, end: 12.8, text: 'pay for it', mode: 0, words: [[11.9, 12.2, 'pay'], [12.2, 12.5, 'for'], [12.5, 12.8, 'it']] }, { start: 20, end: 21, text: 'stay put', mode: 7, snap: false }, { start: 30.02, end: 31, text: 'near', mode: 7 }] };
  const r = B.applySync({ segs: [{ file: 'a.mp4', in: 0, out: 40 }] }, caps, { beats: [12.77, 20.1, 30.02], downbeats: [], tempo_bpm: 144 });
  const f = r.captions.flips, lines = B.snapLines(r.moved);
  ok(f[0].start === 12.77 && f[0].end === 13.64, `the title moves to the beat (${f[0].start} to ${f[0].end})`);
  ok(f[1].words[0][0] === 12.77 && f[1].words[0][1] === 13.64 && f[1].start === 12.77 && f[1].end === 13.64, `its own caption word moves with it (${JSON.stringify(f[1].words)})`);
  ok(f[2].words[1][0] === 12.2, 'the same word said before the title stays where it was said');
  ok(f[3].start === 20 && f[3].end === 21, '"snap": false keeps a title where it is');
  ok(lines.length === 1 && lines[0].startsWith("title 'for it' 12.84 to 12.77, on the beat"), 'one line per snapped title: ' + JSON.stringify(lines));
  ok(caps.flips[1].words[0][0] === 12.84, 'the captions passed in are not changed in place');
}
// ---- 6 the partner line in the one-word style
{ const flips = [{ start: 1, end: 2.4, text: 'if we made $30K', mode: 7, hero: '$30K' }, { start: 3, end: 4.4, text: "I don't know how to pitch", mode: 7, hero: 'how to pitch' }];
  const one = draw({ ...base, fonts: 'instrument', flips }, 5, { stills: [1.5] });
  ok(one.lockups.length === 2 && one.lockups.every(l => !l.partners.length), 'one-word titles: lockups.json lists no partner line, because none is drawn');
  const full = draw({ ...base, fonts: 'instrument', titleLockup: 'full', lockup: { partnerUpper: true, heroUpper: false }, flips }, 5, { stills: [1.5] });
  const l = full.lockups[0];
  ok(l && l.partners.length === 1 && l.partners[0].txt === 'IF WE MADE' && l.hero === '$30K', `"titleLockup": "full" draws the partner line: ${JSON.stringify(l && [l.hero, l.partners.map(p => p.txt)])}`);
  ok(l && l.partners[0].size < l.heroSize * 0.6 && l.faces[0] === 'Instrument Serif' && l.faces[1] === 'Inter Tight', `the partner is small, in the sans, the key word in the italic serif (${l && l.faces}, ${l && l.partners[0].size} against ${l && l.heroSize})`);
  ok(full.lockups[1].partners[0].txt === "I DON'T KNOW" && /pitch/i.test(full.lockups[1].hero), 'a key phrase of several words keeps its partner line');
  const per = draw({ ...base, fonts: 'instrument', flips: [{ ...flips[0], partner: true }, flips[1]] }, 5, { stills: [1.5] });
  ok(per.lockups[0].partners.length === 1 && !per.lockups[1].partners.length, '"partner": true on one title draws its partner line only');
}
// ---- 8 glow and dim, 13 the label, 14 the shadow: read from stills
{ const flips = [{ start: 1, end: 3, text: 'if we made $30K', mode: 7, hero: '$30K' }, { start: 3.2, end: 4.4, text: 'it adds up', mode: 0, words: [[3.2, 3.5, 'it'], [3.5, 3.9, 'adds'], [3.9, 4.3, 'up']] }];
  const px = (r, t) => rgba(join(r.d, 'stills', `t${t.toFixed(2)}.png`));
  const plain = draw({ ...base, fonts: 'instrument', flips }, 5, { stills: [2, 3.7] }), lit = draw({ ...base, fonts: 'instrument', titleGlow: 'strong', titleDim: 0.4, flips }, 5, { stills: [2, 3.7] });
  const A = px(plain, 2), Bf = px(lit, 2), corner = b => b[(1900 * 1080 + 20) * 4 + 3];
  ok(corner(A) === 0, 'no dim by default: the corner of the frame is clear while a title is up');
  ok(Math.abs(corner(Bf) - 102) <= 3, `"titleDim": 0.4 darkens the picture by 40% while a title is up (alpha ${corner(Bf)} of 255)`);
  ok(corner(px(lit, 3.7)) === 0, 'the dim is gone once the title has left');
  // glow: coloured pixels that are neither clear nor solid, round the key word (the dim and the shadow are black, so they are not counted)
  const halo = b => { let n = 0; for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 110 && b[i + 3] < 250 && Math.max(b[i], b[i + 1], b[i + 2]) > 30) n++; return n; };
  ok(halo(Bf) > halo(A) + 20000, `"titleGlow" puts a glow in the key word's colour round it (${halo(Bf)} soft coloured pixels against ${halo(A)})`);
  ok(/glow 1, picture dimmed by 40%/.test(lit.log), 'the build log says the glow and the dim are on');
  const off = draw({ ...base, fonts: 'instrument', titleGlow: 'strong', titleDim: 0.4, flips: [{ ...flips[0], glow: false, dim: false }, flips[1]] }, 5, { stills: [2] });
  ok(corner(px(off, 2)) === 0 && halo(px(off, 2)) < halo(A) + 2000, '"glow": false and "dim": false on a title leave that one out');
}
{ const flips = [{ start: 1, end: 2.4, text: 'you pay a designer', mode: 0, words: [[1, 1.2, 'you'], [1.2, 1.4, 'pay'], [1.4, 1.5, 'a'], [1.5, 2.3, 'designer']] },
    { start: 1.3, end: 2.6, text: 'DESIGNER', mode: 10 }, { start: 3, end: 4, text: 'FIGMA', mode: 10 }, { start: 3, end: 4, text: 'then it ships', mode: 0, words: [[3, 3.3, 'then'], [3.3, 3.6, 'it'], [3.6, 3.95, 'ships']] }];
  const r = draw({ ...base, flips }, 5, { stills: [2] });
  ok(/label 'DESIGNER' at 1\.30 s not drawn: the caption says the same word at that moment/.test(r.log), 'a label that repeats the caption word is not drawn, and the build log says so');
  ok(!/label 'FIGMA'/.test(r.log), 'a label with a word of its own stays');
  const lay = JSON.parse(readFileSync(join(r.d, 'layout.json'), 'utf8')).elements.filter(e => e.mode === 10).map(e => e.text);
  ok(lay.length === 1 && lay[0] === 'FIGMA', `only the label with its own word is laid out (${lay.join(', ')})`);
}
{ // a real app with its own icon is not a misread caption word: it stays when the caption says its name
  const flips = [{ start: 1, end: 2.4, text: 'I use Figma daily', mode: 0, words: [[1, 1.2, 'I'], [1.2, 1.5, 'use'], [1.5, 2.1, 'Figma'], [2.1, 2.4, 'daily']] }, { start: 1.4, end: 2.9, text: 'Figma', mode: 10, icon: 'figma.png' }];
  const r = draw({ ...base, flips }, 4);
  ok(!/label 'Figma'.*not drawn/.test(r.log), 'a label with its own icon stays when the caption says its name');
}
{ // a word said before a title that is also one of the title's words leaves ahead of it, so the check passes on a plain draft
  const flips = [{ start: 3, end: 4.6, text: 'that is the plan', mode: 0, words: [[3, 3.3, 'that'], [3.3, 3.5, 'is'], [3.5, 3.7, 'the'], [3.7, 4.4, 'plan']] },
    { start: 4.9, end: 5.5, text: 'plan today', mode: 7, hero: [0] }, { start: 5.6, end: 7, text: 'ok then', mode: 0, words: [[5.6, 6.0, 'ok'], [6.0, 6.9, 'then']] }];
  const r = draw({ ...base, flips }, 7.5), plan = r.words.find(w => w.word === 'plan'), tc = titleCheck(r.d, { dur: 7.5 });
  ok(plan && plan.start === 3.7 && plan.end <= 4.9 - 2 / 24 && plan.end > 4.4, `"plan", said a second before the title "plan today", is shown and leaves before the frames just ahead of the title (${plan && plan.start} to ${plan && plan.end})`);
  ok(tc.ran && !tc.fails.length, 'the title check passes on it: ' + tc.fails.join(' | '));
}
{ const flips = [{ start: 1, end: 3, text: 'hold on', mode: 0, words: [[1, 1.9, 'hold'], [1.9, 2.9, 'on']] }];
  const dark = b => { let n = 0; for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 60 && b[i] < 60 && b[i + 1] < 60 && b[i + 2] < 60) n++; return n; };
  const r = draw({ ...base, boost: [[1.8, 2.9]], flips }, 4, { stills: [1.5, 2.4] });
  const before = dark(rgba(join(r.d, 'stills', 't1.50.png'))), boosted = dark(rgba(join(r.d, 'stills', 't2.40.png')));
  ok(before === 0, `the style has no shadow: none is drawn outside the low-contrast moment (${before} dark pixels)`);
  ok(boosted > 3000, `the low-contrast word gets the shadow though the style has none (${boosted} dark pixels round "on")`);
}
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED, ${pass} passed` : `\n${pass} title and caption bar checks passed`);
process.exit(failed ? 1 : 0);
