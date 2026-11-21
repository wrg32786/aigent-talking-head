// AIgent talking-head ad assembler. Run from the job's build/ folder (it holds ovl/ and cut.json).
//   node <kit>/assemble.cjs <out.mp4>
// Any number of segments from any source: HeyGen cinematic takes, phone or camera footage, or clips made by
// clip.py. Every segment is scaled to cover 1080x1920 (crop position per segment) and conformed to 24 fps and
// 48 kHz stereo, so real footage can replace a HeyGen take one for one.
//
// cut.json
// {
//   "segs": [ {"file":"../clips/clip-003.mp4","in":0.0,"out":6.2,"pad":0,"cropX":0.5,"cropY":0.5,"norm":false,"fadeIn":0.25}, ... ],
//   "tail": 0.3,                        seconds to hold the last frame at the end
//   "hits": [[11.66,24],[12.66,14]],     output-time glitch/shake hits [time, strength]
//   "sfx": {"F":[11.66],"D":[12.66]},    output times. F = cinematic woosh on cuts, D = quick woosh on card moves
//   "bed": "vinyl-sunrise" (a kit/music library name) or "music.wav", "bedStart": 0, "bedVol": 0.16, "bedNoFade": true, "bedFadeOut": 1.4,
//   "overlay": "ovl/%04d.png",           optional; leave out for a clean cut
//   "titles": "ovlt/%04d.png",           optional kinetic-title layer (render.mjs writes it); drawn under the person when
//   "mask": "mask.mkv",                  a person mask is given (kit/mask.py), else in front of the picture
//   "maskModel": "birefnet",             birefnet (rembg birefnet-general-lite, quality) or mediapipe (fast)
//   "person": "person.mkv",              optional BGRA person layer from mask.py --person (edge-decontaminated)
//   "panels": "ovlp/%04d.png",           optional screen cards behind the head (render.mjs writes it), with
//   "headMask": "maskhead.mkv",          the crown mask (kit/headmask.py) drawn over them
//   "punch": 0.10                        zoom punch: every cut toggles a 10% punch-in (true = 0.10, false/absent = off)
//   "beatSync": true                     snap punches, SFX, title entrances and fx hits to the bed's beat grid
//                                        (default on when a bed is set; --no-beat-sync / false to leave times alone)
//   "beatWindow": 0.12                   max snap distance in seconds; speech cuts never move
//   "frame": { "name": "feed45", "h": 1350, "y0": 285, "expr": "..." }   a 4:5 or 1:1 version (kit/export-frame.cjs, with
//                                        BASE): the picture and its masks slide up and down so the face-tracked window
//                                        (kit/facewindow.cjs, expr) always lands on rows y0..y0+h; full b-roll is fitted
//                                        to that frame and the split layouts halve it. The caller crops the frame out.
//   "finish": "grain"                    optional film look on the picture (before titles): grain, vignette, chroma,
//                                        scan-lines, warm, cool, teal, crushed, mono, bleach. A list or {grain:0.4}
//                                        also works. Per segment: "finish" on a seg. No LUT or light-leak files.
// }
// Per segment, also: "bigPunch": true (an extra 12% push over 0.3 s from this cut; use it on the cut after the hook
// and the cut into the payoff), "punchDelay": 0.08 (start the punch this many seconds into the segment, set by beat-sync),
// "zoom": 1.15 (fixed zoom for this segment, overrides the toggle), "push": 0.07 (a slow push-in over the segment, minus
// for a pull-out; the reference's camera move), "punchY": 0.4
// (zoom centre, 0 top .. 1 bottom), "punchX": 0.5 (zoom centre, 0 left .. 1 right; kit/reframe.cjs sets zoom, punchX and
// punchY to match a reference's face size and eye line), "lut": "grade-shot-01.cube" (a 3D LUT on this segment, the
// base grade matched to a reference by kit/grade-match.cjs; finishes still go on top), "transition": "crossfade" (named transition INTO this segment, see
// kit/transitions.json; default is the hard cut with the glitch seam) and "transitionDur": 0.3.
// sfx keys: whoosh, swipe, boom, click, typing (the locked set in kit/rules.cjs), plus the legacy F and D. Each entry is a
// time or [time, gain]. "sfxHits": [{ "id": "01-cinematic-hit-a", "t": 4.2 }] places a pack sound (kit/sfx/sfx.json) so
// its hit point lands on t. fx.cjs auto-picks these from the effect plan unless --sfx off. Fewer and deeper: never a
// sound on every cut, the key moment gets the loudest one. SFX and the bed both duck under the voice.
// "sfxMap": true maps pack sounds to the moves (kit/sfx-map.cjs: whoosh on transitions, swipe on cards, pop on text,
// typing under a typewriter title, click on a big punch); "sfxCap": {"minGap":0.25,"per10":6} is the density cap, on by
// default ("sfxCap": false turns it off).
// "norm": true runs loudnorm -16 LUFS on that segment (raw camera audio sits near -32 LUFS; HeyGen and clip.py output do not need it).
// Env overrides: NOSFX=1, NOBED=1, BEDVOL=<n>, BEDNOFADE=1. "bedStart" (or --bed-start on npm run reel) is where the track begins.
// Effects pass (kit/fx.cjs drives these): BASEONLY=1 writes just the graded cut with the voice (no overlay, hits,
// sfx or bed) for the effects to draw on. BASE=<file> then uses that file as the picture instead of the segments,
// with the audio still built from the segments. OVL_OFF="a-b,c-d" hides the caption overlay in those output windows.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const C = JSON.parse(fs.readFileSync('cut.json', 'utf8'));
const out = process.argv[2] || 'out.mp4';
const KIT = __dirname;
const R = require('./rules.cjs');
const SFXPLAN = require('./sfx-plan.cjs');
const SFXMAP = require('./sfx-map.cjs');
const B = require('./beats.cjs');
const XFX = require('./xfx.cjs');
const A = 'aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS';
// the trailing fps=24 matters: after setpts the link loses its frame rate and tpad then silently adds nothing
const V = 'fps=24,format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS,fps=24';
const G = "unsharp=5:5:0.3:3:3:0,eq=contrast=1.03:saturation=0.93:gamma=0.99,curves=all='0/0.02 0.5/0.495 1/0.975',noise=c0s=5:c0f=t+u,vignette=PI/6";
const Gfin = C.finish ? ',' + B.finishChain(C.finish) : '';
const segs = C.segs, tail = C.tail ?? 0.3, hits = [...(C.hits || []), ...(C.dropHits || [])];
const PZ = C.punch === true ? R.PUNCH.zoom : (+C.punch || 0);
const zoomOf = (s, i) => s.zoom != null ? +s.zoom : 1 + (PZ && i % 2 === 1 ? PZ : 0);
const TL = R.timeline(C);
const trans = segs.map((s, i) => { if (!i || !s.transition) return null; const m = R.xfadeMode(s.transition); if (m === undefined) { console.error(`unknown transition "${s.transition}" on seg ${i} (see kit/transitions.json)`); process.exit(1); } return m ? { m, d: +(s.transitionDur || 0.3) } : null; });
const segLen = s => (s.out - s.in) + (s.pad || 0);
const LEN = +(segs.reduce((a, s) => a + segLen(s), 0) + tail).toFixed(3);
const hasAudio = f => { try { return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).toString().trim() !== ''; } catch { return false; } };

const BASE = process.env.BASE, BASEONLY = !!process.env.BASEONLY;
// a 4:5 or 1:1 version: slide the picture (and every mask of it) so the window sits at FR.y0, black (or clear) outside
const FR = C.frame && +C.frame.h > 0 && +C.frame.h < 1920 && C.frame.expr ? { h: Math.round(+C.frame.h), y0: Math.round(+C.frame.y0 || 0), expr: String(C.frame.expr).replace(/'/g, ''), top: +((C.frame.safe || {}).top || 0) } : null;
if (FR && !BASE && !BASEONLY) { console.error('cut.json "frame" needs BASE=<the picture> (kit/export-frame.cjs sets it)'); process.exit(1); }
const slide = clear => (FR && !BASEONLY ? `,crop=1080:${FR.h}:0:'${FR.expr}':exact=1,pad=1080:1920:0:${FR.y0}:color=${clear ? 'black@0' : 'black'}` : '');
const args = ['-v', 'error', '-y'];
const f = [];
let idx = 0;
const inp = (...a) => { args.push(...a); return idx++; };

segs.forEach((s, i) => {
  const n = inp('-i', s.file);
  const last = i === segs.length - 1;
  const cx = s.cropX ?? 0.5, cy = s.cropY ?? 0.5;
  const fit = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*${cx}:(ih-1920)*${cy},setsar=1`;
  const tp = [];
  if (s.pad) tp.push(`start_duration=${s.pad}:start_mode=clone`);
  if (last && tail) tp.push(`stop_duration=${tail}:stop_mode=clone`);
  const fadeIn = i === 0 ? (s.fadeIn ?? 0.25) : 0;
  // zoom punch: a fixed punch-in is a plain scale + crop; a big punch eases in 12% more over 0.3 s with zoompan.
  // punchDelay (from beat-sync) starts that move on a nearby beat, never before this segment (speech cuts stay put).
  const z = zoomOf(s, i), py = s.punchY ?? R.PUNCH.y, px = s.punchX ?? 0.5;
  const delayN = Math.max(0, Math.round((+s.punchDelay || 0) * 24));
  let zf = '';
  if (s.push && !s.bigPunch) {
    // a camera move from the reference (Reel.md shot "move"): the zoom eases from z to z*(1+push) over the segment
    // (a minus push starts closer and pulls out)
    const p = +s.push, N = Math.max(1, Math.round((s.out - s.in) * 24)), za = p > 0 ? z : z * (1 - p), zb = p > 0 ? z * (1 + p) : z;
    zf = `,scale=2160:3840,zoompan=z='${za.toFixed(4)}+${(zb - za).toFixed(4)}*min(on/${N},1)':x='(iw-iw/zoom)*${px}':y='(ih-ih/zoom)*${py}':d=1:s=1080x1920:fps=24,setsar=1`;
  } else if (s.bigPunch) {
    const z1 = z * (1 + R.PUNCH.big), n = Math.round(R.PUNCH.bigDur * 24);
    zf = `,scale=2160:3840,zoompan=z='${z}+${(z1 - z).toFixed(4)}*(1-pow(1-min(max(on-${delayN},0)/${n},1),3))':x='(iw-iw/zoom)*${px}':y='(ih-ih/zoom)*${py}':d=1:s=1080x1920:fps=24,setsar=1`;
  } else if (z > 1.0001 && delayN > 0) {
    const nEase = 3;
    zf = `,scale=2160:3840,zoompan=z='1+${(z - 1).toFixed(4)}*(1-pow(1-min(max(on-${delayN},0)/${nEase},1),3))':x='(iw-iw/zoom)*${px}':y='(ih-ih/zoom)*${py}':d=1:s=1080x1920:fps=24,setsar=1`;
  } else if (z > 1.0001) {
    const w = Math.round(1080 * z / 2) * 2, h = Math.round(1920 * z / 2) * 2;
    // a reframed shot (kit/reframe.cjs) zooms far closer than a punch: crop first, then scale, so the frame is never
    // blown up to several times 1080x1920 in memory. The same picture as scale then crop.
    const cw = Math.round(1080 / z / 2) * 2, ch = Math.round(1920 / z / 2) * 2;
    zf = s.reframed || z > 1.4 ? `,crop=${cw}:${ch}:(iw-ow)*${px}:(ih-oh)*${py},scale=1080:1920:flags=lanczos,setsar=1` : `,scale=${w}:${h},crop=1080:1920:(iw-ow)*${px}:(ih-oh)*${py},setsar=1`;
  }
  // hold the last frame so every segment's picture is exactly out-in long (phone clips often end a frame short of
  // their audio, which left gaps and a variable frame rate after concat)
  const exact = `,tpad=stop_mode=clone:stop_duration=0.25,trim=duration=${(s.out - s.in).toFixed(4)}`;
  const segFinish = s.finish ? `,${B.finishChain(s.finish)}` : '';
  // the matched base grade (kit/grade-match.cjs): a 3D LUT on this segment, under any finish
  const lut = s.lut && fs.existsSync(s.lut) ? `,lut3d=file='${String(s.lut).replace(/\\/g, '/').replace(/'/g, '')}':interp=tetrahedral` : '';
  if (!BASE) f.push(`[${n}:v]trim=${s.in}:${s.out},${V}${exact},${fit}${lut}${zf}${segFinish}${fadeIn ? `,fade=t=in:st=0:d=${fadeIn}` : ''}${tp.length ? `,tpad=${tp.join(':')}` : ''}[v${i}]`);
  const d = s.out - s.in;
  const delay = s.pad ? `,adelay=${Math.round(s.pad * 1000)}|${Math.round(s.pad * 1000)}` : '';
  const apad = last && tail ? `,apad=pad_dur=${tail}` : '';
  if (hasAudio(s.file)) {
    f.push(`[${n}:a]atrim=${s.in}:${s.out},${A}${s.norm ? ',loudnorm=I=-16:TP=-1.5:LRA=11,' + A : ''},afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, d - 0.05).toFixed(3)}:d=0.05${delay}${apad}[a${i}]`);
  } else {
    f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${(segLen(s) + (last ? tail : 0)).toFixed(3)},${A}[a${i}]`);
  }
});
if (BASE) {
  f.push(`${segs.map((_, i) => `[a${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[ca]`);
  const b = inp('-i', BASE);
  f.push(`[${b}:v]${V},scale=1080:1920,setsar=1${slide()},tpad=stop_duration=1:stop_mode=clone[g]`);
} else {
  if (trans.some(Boolean)) {
    // named transitions: the outgoing shot holds its last frame for the blend, so every segment still starts on the
    // same output time (captions and sfx stay put) and picture stays in sync with the voice
    f.push(`${segs.map((_, i) => `[a${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[ca]`);
    let cur = 'v0';
    segs.forEach((s, i) => {
      if (!i) return;
      const tr = trans[i], o = `x${i}`;
      if (tr) f.push(`[${cur}]tpad=stop_duration=${tr.d}:stop_mode=clone,fps=24,settb=AVTB[p${i}]`, `[v${i}]fps=24,settb=AVTB[q${i}]`, `[p${i}][q${i}]xfade=${XFX.xfadeOpts(tr.m)}:duration=${tr.d}:offset=${TL.segs[i].start.toFixed(3)}[${o}]`);
      else f.push(`[${cur}][v${i}]concat=n=2:v=1:a=0,fps=24,settb=AVTB[${o}]`);
      cur = o;
    });
    f.push(`[${cur}]${G}${Gfin}[g]`);
  } else {
    f.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[cv][ca]`);
    f.push(`[cv]${G}${Gfin}[g]`);
  }
}
let vcur = 'g';
if (BASEONLY) {
  f.push(`[g]fps=24,trim=0:${LEN}[vo]`, `[ca]atrim=0:${LEN},aresample=48000[ao]`);
  args.push('-filter_complex', f.join(';'), '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', out);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log('wrote base', out, 'len', LEN);
  process.exit(0);
}
// split and framed b-roll (kit/split.cjs) draw the top of your head over the panel: your picture cut out by the person
// mask, so it needs the graded picture once more before the titles go on
const SPL = require('./split.cjs');
const splitIns = (C.inserts || []).filter(s => SPL.SPLIT.includes(s.place));
const pmSpec = splitIns.length ? R.maskSpec(C) : {};
const pmPerson = pmSpec.person && fs.existsSync(pmSpec.person) ? pmSpec.person : null, pmMask = pmSpec.file && fs.existsSync(pmSpec.file) ? pmSpec.file : null;
const splitMask = !process.env.SPLIT_NO_MASK && !!(pmPerson || pmMask);
let G0 = 'g';
if (splitIns.length && splitMask && !pmPerson) { f.push('[g]split[gsp][gq]'); G0 = 'gsp'; vcur = G0; }
// kinetic titles sit between the picture and the person: picture -> titles -> person cut out by the mask -> captions
const ovlOff = (process.env.OVL_OFF || '').split(',').filter(Boolean).map(w => w.split('-').map(Number)).filter(([a, b]) => b > a);
const offEn = ovlOff.length ? `:enable='not(${ovlOff.map(([a, b]) => `between(t,${a},${b})`).join('+')})'` : '';
// screen cards and b-roll panels behind the head (ovlp/, the panel layer in kit/overlay.html): the panels go over the
// picture and the titles, then the top of the presenter's head (hair and crown, kit/headmask.py) over the
// panels, so where the head reaches into a panel the panel is behind it; the body stays under the panel
const panelsOn = !!(C.panels && fs.existsSync(path.dirname(path.resolve(C.panels))));
const headFile = panelsOn && C.headMask && fs.existsSync(C.headMask) ? C.headMask : null;
if (panelsOn && !headFile && !process.env.MASK_WARNED) console.warn(`note: no head mask${C.headMask ? ' (' + C.headMask + ' not found)' : ''}; screen cards go in front of the presenter (kit/headmask.py)`);
let pic = G0;
if (headFile) { f.push(`[${G0}]split[g0][gh]`); pic = 'g0'; }
if (C.titles) {
  const t = inp('-framerate', '24', '-i', C.titles);
  const spec = require('./rules.cjs').maskSpec(C);
  const personFile = spec.person && fs.existsSync(spec.person) ? spec.person : null;
  const maskFile = spec.file && fs.existsSync(spec.file) ? spec.file : null;
  if (personFile) {
    const p = inp('-i', personFile);
    f.push(`[${pic}][${t}:v]overlay=format=auto:eof_action=pass${offEn}[gt]`,
      `[${p}:v]format=bgra,scale=1080:1920,setsar=1,fps=24,setpts=PTS-STARTPTS${slide(true)}[pr]`,
      `[gt][pr]overlay=format=auto:eof_action=pass[gm]`);
    vcur = 'gm';
  } else if (maskFile) {
    const m = inp('-i', maskFile);
    f.push(`[${pic}]split[gb][gp]`, `[gb][${t}:v]overlay=format=auto:eof_action=pass${offEn}[gt]`, `[${m}:v]format=gray,scale=1080:1920,setsar=1,fps=24,setpts=PTS-STARTPTS${slide()}[mk]`,
      `[gp][mk]alphamerge[person]`, `[gt][person]overlay=format=auto:eof_action=pass[gm]`);
    vcur = 'gm';
  } else {
    if ((spec.file || C.mask) && !process.env.MASK_WARNED) console.warn(`note: mask ${spec.file || C.mask} not found; titles go in front of the picture (run kit/mask.py)`);
    f.push(`[${pic}][${t}:v]overlay=format=auto:eof_action=pass${offEn}[gm]`); vcur = 'gm';
  }
}
if (vcur === G0) vcur = pic;
if (panelsOn) {
  const pp = inp('-framerate', '24', '-i', C.panels);
  f.push(`[${vcur}][${pp}:v]overlay=format=auto:eof_action=pass${offEn}[gpn]`); vcur = 'gpn';
  if (headFile) {
    const hm = inp('-i', headFile);
    f.push(`[${hm}:v]format=gray,scale=1080:1920,setsar=1,fps=24,setpts=PTS-STARTPTS${slide()}[hmk]`, `[gh][hmk]alphamerge[head]`, `[${vcur}][head]overlay=format=auto:eof_action=pass[gph]`);
    vcur = 'gph';
  }
}
// b-roll inserts: "inserts": [{"file": "../broll/typing.mov", "at": 12.3, "dur": 1.5, "in": 0, "bw": true}] in cut.json.
// The insert's picture replaces yours for its span while the voice runs on (its own audio is dropped). It covers the
// picture and any titles, and the captions draw on top of it. "in" is where to start in the clip; "bw" makes it black
// and white. Captions in the oneword look move up into the insert's open space ("y", default 640) and can take a
// "tint" to match its light.
// "place" (Studio's b-roll lane, kit/studio/broll-run.mjs): "full" (the default, as above), "top" (split: the insert fills the top half and you
// fill the bottom half, your head over the panel's lower edge, see below), "frame" (framed cards, below) or "pip" (a 16:9 box "pipW" wide,
// default 460, with a thin white edge, top right; "pipX" and "pipY" move it). A still picture ("image": true, or a
// .jpg, .png or .webp file) holds for the span with a slow push in.
// "place": "frame" (Framed, kit/split.cjs): the b-roll in a rounded card up top and you smaller in a card below, your head
// over its top edge, on a soft backdrop. "top" now moves you so the top of your head reaches a little into the panel
// and draws it over the panel with the person mask (the panel sits behind your head); without the mask, the head
// stays just under the seam. Both follow your face per moment (build/facezone.json), "faceY" when there is none.
let FZ = null; try { FZ = JSON.parse(fs.readFileSync('facezone.json', 'utf8')); } catch {}
const bands = [];
if (splitIns.length && splitMask) {
  if (pmPerson) { const pi = inp('-i', pmPerson); f.push(`[${pi}:v]format=bgra,scale=1080:1920,setsar=1,fps=24,setpts=PTS-STARTPTS${slide(true)}[pq0]`); }
  else { const mi = inp('-i', pmMask); f.push(`[${mi}:v]format=gray,scale=1080:1920,setsar=1,fps=24,setpts=PTS-STARTPTS${slide()}[mq]`, '[gq][mq]alphamerge[pq0]'); }
  if (splitIns.length === 1) bands.push('pq0'); else { const ls = splitIns.map((_, j) => `pq${j + 1}`); f.push(`[pq0]split=${ls.length}${ls.map(l => `[${l}]`).join('')}`); bands.push(...ls); }
} else if (splitIns.length && !process.env.MASK_WARNED) console.warn('note: no person mask for the split b-roll; your head stays under the panel instead of over it (kit/mask.py)');
const chromeFile = g => {
  const ex = SPL.chromeGeq(g), file = `frame-chrome-${require('crypto').createHash('sha1').update(ex).digest('hex').slice(0, 10)}.png`;
  if (!fs.existsSync(file)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920,format=rgba', '-vf', ex, '-frames:v', '1', file]);
  return file;
};
(C.inserts || []).forEach((s, k) => {
  const a0 = +s.at, d = +s.dur, i0 = +(s.in || 0), place = SPL.PLACES.includes(s.place) ? s.place : 'full';
  const still = s.image === true || /\.(jpe?g|png|webp)$/i.test(String(s.file));
  const g = SPL.layout({ ...s, place }, SPL.faceOver(FZ, a0, d), { mask: splitMask, frame: FR });
  const pw = Math.round((+s.pipW || 460) / 2) * 2, ph = Math.round(pw * 9 / 32) * 2;
  // full b-roll fills the frame it is shown in: the whole reel, or the 4:5 or 1:1 window
  const [W, H] = g ? [g.panel.w, g.panel.h] : place === 'pip' ? [pw, ph] : [1080, FR ? FR.h : 1920];
  const n = still ? inp('-loop', '1', '-framerate', '24', '-t', (d + 0.5).toFixed(3), '-i', s.file) : inp('-i', s.file);
  const fit = still ? `scale=${Math.round(W * 1.1 / 2) * 2}:${Math.round(H * 1.1 / 2) * 2}:force_original_aspect_ratio=increase,crop=${Math.round(W * 1.1 / 2) * 2}:${Math.round(H * 1.1 / 2) * 2},zoompan=z='1+0.08*on/${Math.max(1, Math.round(d * 24))}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=24`
    : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const src = still ? `[${n}:v]${V},${fit}` : `[${n}:v]trim=${i0}:${(i0 + d).toFixed(3)},${V},${fit}`;
  const on = `enable='between(t,${a0},${(a0 + d).toFixed(3)})'`, win = `trim=start=${a0}:end=${(a0 + d + 0.05).toFixed(3)}`;
  f.push(`${src},setsar=1${s.bw ? ',hue=s=0' : ''}${place === 'pip' ? ',pad=iw+8:ih+8:4:4:white' : ''},setpts=PTS+${a0}/TB[ins${k}]`);
  // the top of your head over the panel (or the card's top edge): rows y0..y1 of your picture, moved like it
  const band = (cur, scale) => {
    if (!g.band || !bands.length) return cur;
    const lbl = bands.shift(), sy0 = Math.max(0, Math.round((g.band.y0 - g.dy) / g.s)), sy1 = Math.min(1920, Math.round((g.band.y1 - g.dy) / g.s));
    if (sy1 - sy0 < 8) { f.push(`[${lbl}]nullsink`); return cur; }
    const hgt = Math.round((sy1 - sy0) * g.s / 2) * 2, oy = Math.round(sy0 * g.s + g.dy);
    f.push(`[${lbl}]${win},crop=1080:${sy1 - sy0}:0:${sy0}${scale ? `,scale=${g.sw}:${hgt}` : ''}[hb${k}]`, `[${cur}][hb${k}]overlay=${g.dx}:${oy}:format=auto:eof_action=pass:${on}[hv${k}]`);
    return `hv${k}`;
  };
  if (g && place === 'top') {
    const seam = g.seam, y = seam - g.dy, sh = `color=c=black:s=1080x36:r=24:d=${(d + 0.1).toFixed(3)},format=rgba,${SPL.shadowGeq()},setpts=PTS+${a0}/TB[shd${k}]`;
    f.push(`[${vcur}]split[vs${k}a][vs${k}b]`, `[vs${k}b]crop=1080:${g.panel.h}:0:${y}[spk${k}]`, `[vs${k}a][spk${k}]overlay=0:${seam}:${on}[vt${k}]`, `[vt${k}][ins${k}]overlay=0:${g.panel.y}:eof_action=pass:${on}[vp${k}]`, sh, `[vp${k}][shd${k}]overlay=0:${seam}:format=auto:eof_action=pass:${on}[vq${k}]`);
    vcur = band(`vq${k}`, false);
  } else if (g && place === 'frame') {
    const ch = inp('-loop', '1', '-framerate', '24', '-t', (d + 0.1).toFixed(3), '-i', chromeFile(g));
    f.push(`[${vcur}]split[vs${k}a][vs${k}b]`, `[vs${k}b]${win},scale=${g.sw}:${g.sh}[spk${k}]`, `[vs${k}a][spk${k}]overlay=${g.dx}:${g.dy}:eof_action=pass:${on}[vt${k}]`,
      `[vt${k}][ins${k}]overlay=${g.panel.x}:${g.panel.y}:eof_action=pass:${on}[vp${k}]`, `[${ch}:v]format=rgba,setpts=PTS+${a0}/TB[chr${k}]`, `[vp${k}][chr${k}]overlay=0:0:format=auto:eof_action=pass:${on}[vq${k}]`);
    vcur = band(`vq${k}`, true);
  } else if (place === 'pip') {
    const x = s.pipX != null ? Math.round(+s.pipX) : 1080 - pw - 8 - 44, y = FR ? Math.round(FR.y0 + (s.pipY != null ? +s.pipY * FR.h / 1920 : FR.top + 30)) : s.pipY != null ? Math.round(+s.pipY) : 170;
    f.push(`[${vcur}][ins${k}]overlay=${x}:${y}:eof_action=pass:${on}[vi${k}]`); vcur = `vi${k}`;
  } else { f.push(`[${vcur}][ins${k}]overlay=0:${FR ? FR.y0 : 0}:eof_action=pass:${on}[vi${k}]`); vcur = `vi${k}`; }
});
for (const l of bands) f.push(`[${l}]nullsink`);
// The caption layer and the glitch shake go on in a second pass when there are captions. In one graph, the caption
// frames together with the person mask and the b-roll inserts ran ffmpeg at a tenth of real time or less (2026-11-11,
// oneword look); split in two, both passes run faster than real time.
const ovlOn = (process.env.OVL_OFF || '').split(',').filter(Boolean).map(w => w.split('-').map(Number)).filter(([a, b]) => b > a);
const ovlEn = ovlOn.length ? `:enable='not(${ovlOn.map(([a, b]) => `between(t,${a},${b})`).join('+')})'` : '';
function shake(g, src) {
  if (!hits.length) return src;
  const env = hz => hits.map(([h, a]) => `${a}*gte(t,${h})*exp(-8*(t-${h}))*sin(2*PI*${hz}*(t-${h}))`).join('+');
  const win = hits.map(([h]) => `between(t,${(h - .04).toFixed(2)},${(h + .17).toFixed(2)})`).join('+');
  g.push(`[${src}]split[sa][sb]`, `[sa][sb]overlay=x='${env(17)}':y='${env(23)}':eval=frame[sh]`, `[sh]rgbashift=rh=-16:bh=16:rv=4:bv=-4:enable='${win}',noise=c0s=46:c0f=t+u:enable='${win}'[hv]`);
  return 'hv';
}
if (!C.overlay) vcur = shake(f, vcur);
f.push(`[${vcur}]fps=24,trim=0:${LEN}[vo]`);

// Sound: the locked set in kit/rules.cjs, plus pack hits from cut.json sfxHits (or sfx-hits.json).
// Each sound's hit point (measured peak, or the cutoff for a riser) lands on the time given.
// A job can add its own sound files in cut.json: "sounds": {"name": {"file": "../sfx/x.wav", "peak": 0.2, "vol": 0.4}} (file relative to build/).
const lbl = [], SFX = { ...R.SFX, ...Object.fromEntries(Object.entries(C.sounds || {}).map(([k, s]) => [k, { peak: 0, vol: 0.4, ...s, file: path.resolve(s.file) }])) };
if (!process.env.NOSFX) {
  // the density cap (kit/sfx-map.cjs): at least minGap s between sounds, at most per10 in any 10 s, the bigger move
  // and the sound you placed winning; cut.json "sfxCap": false turns it off
  const packHits = Array.isArray(C.sfxHits) ? C.sfxHits
    : (fs.existsSync('sfx-hits.json') ? (JSON.parse(fs.readFileSync('sfx-hits.json', 'utf8')).hits || []) : []);
  const ev = [];
  for (const k of Object.keys(C.sfx || {})) {
    if (!SFX[k]) { console.error(`unknown sfx "${k}"; use one of ${Object.keys(SFX).join(', ')}`); process.exit(1); }
    R.sfxHits(C.sfx[k]).forEach(h => ev.push({ t: h.t, kind: SFXMAP.kindOf(k), manual: true, k, h }));
  }
  packHits.forEach(h => { if (!SFXPLAN.lookup(h.id)) { console.error(`unknown sfx id "${h.id}" (kit/sfx/sfx.json)`); process.exit(1); } ev.push({ t: +h.t, kind: SFXMAP.kindOf(h.id), manual: !h.auto, p: h }); });
  const capped = SFXMAP.capHits(ev, C.sfxCap), dropped = capped.filter(e => !e.keep);
  if (dropped.length) console.log(`sfx cap: ${dropped.length} of ${ev.length} sounds left out (too close together or too many in 10 s): ${dropped.map(e => `${e.k || e.p.id}@${(+e.t).toFixed(2)}`).join(', ')}`);
  const keptEv = capped.filter(e => e.keep);
  for (const k of Object.keys(C.sfx || {})) {
    const S = SFX[k], ts = keptEv.filter(e => e.k === k).map(e => e.h); if (!ts.length) continue;
    const n = inp('-i', path.resolve(KIT, S.file));
    f.push(`[${n}:a]${A},asplit=${ts.length}` + ts.map((_, j) => `[${k}s${j}]`).join(''));
    ts.forEach((h, j) => { const ms = Math.max(0, Math.round((h.t - S.peak) * 1000)); f.push(`[${k}s${j}]volume=${h.g ?? S.vol},adelay=${ms}|${ms}[${k}d${j}]`); lbl.push(`[${k}d${j}]`); });
  }
  keptEv.filter(e => e.p).map(e => e.p).forEach((h, j) => {
    const S = SFXPLAN.lookup(h.id);
    const n = inp('-i', path.join(KIT, 'sfx', S.file));
    const hit = h.hit != null ? +h.hit : S.hit, gain = h.gain != null ? +h.gain : S.gain;
    let st = h.t - hit, cut = 0; if (st < 0) { cut = -st; st = 0; }
    const ms = Math.round(st * 1000);
    f.push(`[${n}:a]atrim=start=${cut.toFixed(3)},asetpts=PTS-STARTPTS,${A},volume=${gain},adelay=${ms}|${ms}[pk${j}]`);
    lbl.push(`[pk${j}]`);
  });
}
// fewer and deeper: say so when a cut sound sits on every seam
const seamSet = TL.seams.map(x => x.toFixed(2));
if (seamSet.length >= 3) for (const k of R.CUT_SOUNDS) { const on = R.sfxHits((C.sfx || {})[k]).map(h => h.t.toFixed(2)); if (seamSet.every(x => on.includes(x))) console.warn(`note: sfx.${k} is on every cut. Rule: fewer and deeper; keep it for the big cuts.`); }
const mix = ['[ca]'];
if (lbl.length) f.push(`${lbl.join('')}amix=inputs=${lbl.length}:normalize=0,volume=0.8[sfxraw]`);
const bed = !process.env.NOBED && C.bed;
if (bed) {
  const bf = R.bedFile(bed); if (!fs.existsSync(bf)) { console.error(`bed "${bed}": no such file ${bf}` + (R.isBed(bed) ? ' (beds.json lists it; restore kit/music)' : ' (not a library bed either: npm run music)')); process.exit(1); }
  const n = inp('-i', bf);
  const st = +(C.bedStart || 0), vol = +(process.env.BEDVOL || C.bedVol || 0.22), nofade = process.env.BEDNOFADE || C.bedNoFade, fo = +(C.bedFadeOut ?? 1.4);
  f.push(`[${n}:a]atrim=${st}:${(st + LEN + .2).toFixed(2)},${A},volume=${vol}${nofade ? '' : ',afade=t=in:d=0.3'},afade=t=out:st=${(LEN - fo).toFixed(2)}:d=${fo}[bed]`);
}
// Duck SFX and the bed under the voice. Without bed ducking, hi-hats masked "school" into "pool".
if (lbl.length || bed) {
  const keys = ['[cak]'];
  if (lbl.length) keys.push('[keyS]');
  if (bed) keys.push('[keyB]');
  f.push(`[ca]asplit=${keys.length}${keys.join('')}`);
  mix[0] = '[cak]';
  if (lbl.length) { f.push('[sfxraw][keyS]sidechaincompress=threshold=0.04:ratio=3:attack=5:release=180:makeup=1[sfx]'); mix.push('[sfx]'); }
  if (bed) {
    // "bedDuckRatio": lower = the music dips less under the voice. "bedDuckLead": seconds the dip starts BEFORE each word
    // (the key is the voice moved earlier), so a soft first consonant isn't masked while the compressor is still reacting.
    const lead = +(C.bedDuckLead || 0);
    if (lead > 0) f.push(`[keyB]atrim=start=${lead},asetpts=PTS-STARTPTS[keyBl]`);
    f.push(`[bed][keyB${lead > 0 ? 'l' : ''}]sidechaincompress=threshold=0.03:ratio=${+(C.bedDuckRatio || 6)}:attack=15:release=${lead > 0 ? 250 + Math.round(lead * 1000) : 250}:makeup=1[bedd]`); mix.push('[bedd]');
  }
}
f.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,atrim=0:${LEN},loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[ao]`);
const pre = C.overlay ? out.replace(/(\.[^.\\/]+)?$/, '.pre.mp4') : null;
args.push('-filter_complex', f.join(';'), '-map', '[vo]', '-map', '[ao]', '-fps_mode', 'cfr', '-r', '24', '-c:v', 'libx264', ...(pre ? ['-crf', '12', '-preset', 'veryfast'] : ['-crf', '17', '-preset', 'medium']), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', ...(pre ? [] : ['-movflags', '+faststart']), pre || out);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
if (pre) {
  const g = [`[0:v][1:v]overlay=format=auto:eof_action=pass${ovlEn}[o]`], v = shake(g, 'o');
  g.push(`[${v}]fps=24,trim=0:${LEN}[vo]`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', pre, '-framerate', '24', '-i', C.overlay, '-filter_complex', g.join(';'), '-map', '[vo]', '-map', '0:a', '-fps_mode', 'cfr', '-r', '24', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
  fs.rmSync(pre, { force: true });
}
console.log('wrote', out, 'len', LEN);
