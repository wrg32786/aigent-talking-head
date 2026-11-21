// On-screen words never overlap (Will, 2026-11-21: a big blackletter "Terms" sat on a small "on" in a Recreate).
// Each case is a small captions.js drawn by the real overlay (kit/overlay.html through kit/render.mjs, TEXTCHECK=only):
// on every frame every text box (a caption's current word, a title, a sticker word) is measured where it is drawn, and
// the test fails when any two share any area at the same moment, for 9:16, 4:5 and 1:1. Each case is also drawn with
// the layout pass off, to show the check does catch a clash when nothing is done about it.
// Run: node tests/text-overlap.test.mjs   (needs Chrome; part of npm run check)
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit'), X = createRequire(import.meta.url)('../kit/exports.cjs');
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.error('FAIL ' + m); } };
// a face in the middle of the picture for the whole clip, as kit/facezone.py would write it
const face = (secs, z = [380, 640, 700, 1000, 470]) => ({ fps: 8, zones: Array.from({ length: Math.ceil(secs * 8) }, () => z) });
const top = { captionStyle: 'one-word', captionPosition: 'top', captionColor: '#ffffff', captionOutline: 'none', captionShadow: 'none', captionCase: 'lower', titleLayer: 'front' };
const CASES = [
  { name: 'a said word under the next title ("on" then "Terms")', dur: 5, rawClash: false, caps: { ...top, fonts: 'pirata', flips: [
    { start: 1.0, end: 2.1, text: 'we agree on', mode: 0, words: [[1.0, 1.3, 'we'], [1.3, 1.8, 'agree'], [1.9, 2.05, 'on']] },
    { start: 2.3, end: 3.2, text: 'Terms', hero: [0], mode: 7 },
    { start: 3.3, end: 4.2, text: 'and more', mode: 0, words: [[3.3, 3.6, 'and'], [3.6, 4.1, 'more']] }] },
    also: d => { const w = JSON.parse(readFileSync(join(d, 'words.json'), 'utf8')).find(x => x.word === 'on'); ok(w && w.end <= 2.3 + 1e-6, `"on" leaves when "Terms" enters (it ends at ${w && w.end}, the title starts at 2.3)`); } },
  { name: 'a title that enters while a word is still being said', dur: 5, rawClash: true, caps: { ...top, fonts: 'pirata', flips: [
    { start: 1.0, end: 2.7, text: 'we agree on', mode: 0, words: [[1.0, 1.3, 'we'], [1.3, 1.8, 'agree'], [1.9, 2.6, 'on']] },
    { start: 2.2, end: 3.4, text: 'Terms', hero: [0], mode: 7, y: 230 },
    { start: 3.0, end: 4.2, text: 'and more', mode: 0, words: [[3.0, 3.5, 'and'], [3.6, 4.1, 'more']] }] } },
  { name: 'two titles up together', dur: 5, rawClash: true, caps: { ...top, fonts: 'pirata', flips: [
    { start: 1.0, end: 3.0, text: 'Terms', hero: [0], mode: 7 },
    { start: 2.2, end: 4.0, text: 'Conditions', hero: [0], mode: 7 }] } },
  { name: 'kinetic caption lines with a title on the same line', dur: 5, rawClash: true, caps: { captionStyle: 'kinetic', captionPosition: 'top', fonts: 'pirata', titleLayer: 'front', flips: [
    { start: 1.0, end: 3.0, text: 'read the small print', mode: 0, words: [[1.0, 1.3, 'read'], [1.3, 1.6, 'the'], [1.6, 2.2, 'small'], [2.2, 2.9, 'print']] },
    { start: 1.6, end: 2.8, text: 'Terms on', hero: [0], mode: 7 }] } },
  { name: 'an ordinal word and a caption on the same spot', dur: 4, rawClash: true, caps: { captionStyle: 'one-word', fonts: 'theme', flips: [
    { start: 1.0, end: 3.0, text: 'First', mode: 9 },
    { start: 1.2, end: 2.8, text: 'on these now', mode: 0, y: 820, words: [[1.2, 1.7, 'on'], [1.7, 2.2, 'these'], [2.2, 2.7, 'now']] }] } },
  { name: 'two caption lines up together', dur: 4, rawClash: true, stacked: true, caps: { captionStyle: 'kinetic', fonts: 'pirata', flips: [
    { start: 1.0, end: 2.6, text: 'read the terms', mode: 0, words: [[1.0, 1.3, 'read'], [1.3, 1.6, 'the'], [1.6, 2.5, 'terms']] },
    { start: 2.0, end: 3.5, text: 'on this page', mode: 0, words: [[2.0, 2.3, 'on'], [2.3, 2.6, 'this'], [2.6, 3.4, 'page']] }] } },
];
const SIZES = [['9:16', null], ['4:5', 'feed45'], ['1:1', 'square']];
const run = (caps, dur) => {
  const d = mkdtempSync(join(tmpdir(), 'textov-'));
  writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify(caps) + ';\n');
  try { execFileSync('node', [join(KIT, 'render.mjs'), String(dur)], { cwd: d, env: { ...process.env, TEXTCHECK: 'only' }, stdio: ['ignore', 'pipe', 'pipe'] }); return { d, tc: JSON.parse(readFileSync(join(d, 'textcheck.json'), 'utf8')), lay: JSON.parse(readFileSync(join(d, 'layout.json'), 'utf8')) }; }
  catch (e) { return { d, err: String(e.stderr || e.message).slice(-400) }; }
};
for (const c of CASES) {
  for (const [label, ex] of SIZES) {
    // on a 4:5 or 1:1 version the frame sits in the middle of the canvas and the face is already placed inside it
    const fr = ex ? X.frameOf(ex) : null, z = fr ? [380, fr.y0 + fr.h * 0.38, 700, fr.y0 + fr.h * 0.62, fr.y0 + fr.h * 0.25] : undefined;
    const caps = { ...c.caps, faceTrack: face(c.dur, z), ...(fr ? { exportFrame: fr } : {}) };
    const r = run(caps, c.dur);
    if (r.err) { ok(false, `${c.name}, ${label}: the overlay did not draw (${r.err})`); continue; }
    ok(r.tc.frames >= c.dur * 24 - 1, `${c.name}, ${label}: every frame is checked (${r.tc.frames})`);
    ok(r.tc.clashFrames === 0, `${c.name}, ${label}: ${r.tc.clashFrames} frames with two words on the same spot: ${r.tc.pairs.map(p => `"${p.a}" on "${p.b}" from ${p.from}s`).join('; ')}`);
    // nothing left the safe area to get clear
    const S = r.lay.safe, out = r.lay.elements.filter(e => e.final && !e.takeover && /text/.test(e.action) && (e.final.y0 < S.y0 - 2 || e.final.y1 > S.y1 + 2 || e.final.x0 < S.x0 - 2 || e.final.x1 > S.x1 + 2));
    ok(!out.length, `${c.name}, ${label}: a word left the safe area to get clear (${out.map(e => e.text).join(', ')})`);
    if (process.env.TEXT_OVERLAP_SHOW) console.log(`${c.name}, ${label}: ${r.lay.elements.map(e => `${e.kind} "${e.text}" ${e.action}`).join('; ')}`);
    if (c.stacked && !ex) ok(r.lay.elements.some(e => /(^|\+)text$/.test(e.action)), `${c.name}: one line should stack clear of the other with a gap (${r.lay.elements.map(e => e.action).join(', ')})`);
    if (c.also && !ex) c.also(r.d);
    rmSync(r.d, { recursive: true, force: true });
    if (ex) continue;
    // the same case with nothing done about it: the check must see the clash
    const raw = run({ ...caps, layout: false }, c.dur);
    if (raw.err) { ok(false, `${c.name}: the overlay did not draw with the layout pass off`); continue; }
    if (c.rawClash) ok(raw.tc.clashFrames > 0, `${c.name}: with the layout pass off the check should find the clash (it found ${raw.tc.clashFrames})`);
    rmSync(raw.d, { recursive: true, force: true });
  }
}
console.log(failed ? `\n${failed} FAILED, ${pass} passed` : `\n${pass} text overlap checks passed`);
process.exit(failed ? 1 : 0);
