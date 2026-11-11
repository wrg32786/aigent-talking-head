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
//   "punch": 0.10                        zoom punch: every cut toggles a 10% punch-in (true = 0.10, false/absent = off)
// }
// Per segment, also: "bigPunch": true (an extra 12% push over 0.3 s from this cut; use it on the cut after the hook
// and the cut into the payoff), "zoom": 1.15 (fixed zoom for this segment, overrides the toggle), "punchY": 0.4
// (zoom centre, 0 top .. 1 bottom), "transition": "crossfade" (named transition INTO this segment, see
// kit/transitions.json; default is the hard cut with the glitch seam) and "transitionDur": 0.3.
// sfx keys: whoosh, swipe, boom, click, typing (the locked set in kit/rules.cjs), plus the legacy F and D. Each entry is a
// time or [time, gain]. "sfxHits": [{ "id": "01-cinematic-hit-a", "t": 4.2 }] places a pack sound (kit/sfx/sfx.json) so
// its hit point lands on t. fx.cjs auto-picks these from the effect plan unless --sfx off. Fewer and deeper: never a
// sound on every cut, the key moment gets the loudest one. SFX and the bed both duck under the voice.
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
const A = 'aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS';
// the trailing fps=24 matters: after setpts the link loses its frame rate and tpad then silently adds nothing
const V = 'fps=24,format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS,fps=24';
const G = "unsharp=5:5:0.3:3:3:0,eq=contrast=1.03:saturation=0.93:gamma=0.99,curves=all='0/0.02 0.5/0.495 1/0.975',noise=c0s=5:c0f=t+u,vignette=PI/6";
const segs = C.segs, tail = C.tail ?? 0.3, hits = C.hits || [];
const PZ = C.punch === true ? R.PUNCH.zoom : (+C.punch || 0);
const zoomOf = (s, i) => s.zoom != null ? +s.zoom : 1 + (PZ && i % 2 === 1 ? PZ : 0);
const TL = R.timeline(C);
const trans = segs.map((s, i) => { if (!i || !s.transition) return null; const m = R.xfadeMode(s.transition); if (m === undefined) { console.error(`unknown transition "${s.transition}" on seg ${i} (see kit/transitions.json)`); process.exit(1); } return m ? { m, d: +(s.transitionDur || 0.3) } : null; });
const segLen = s => (s.out - s.in) + (s.pad || 0);
const LEN = +(segs.reduce((a, s) => a + segLen(s), 0) + tail).toFixed(3);
const hasAudio = f => { try { return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).toString().trim() !== ''; } catch { return false; } };

const BASE = process.env.BASE, BASEONLY = !!process.env.BASEONLY;
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
  // zoom punch: a fixed punch-in is a plain scale + crop; a big punch eases in 12% more over 0.3 s with zoompan
  const z = zoomOf(s, i), py = s.punchY ?? R.PUNCH.y;
  let zf = '';
  if (s.bigPunch) {
    const z1 = z * (1 + R.PUNCH.big), n = Math.round(R.PUNCH.bigDur * 24);
    zf = `,scale=2160:3840,zoompan=z='${z}+${(z1 - z).toFixed(4)}*(1-pow(1-min(on/${n},1),3))':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*${py}':d=1:s=1080x1920:fps=24,setsar=1`;
  } else if (z > 1.0001) {
    const w = Math.round(1080 * z / 2) * 2, h = Math.round(1920 * z / 2) * 2;
    zf = `,scale=${w}:${h},crop=1080:1920:(iw-ow)/2:(ih-oh)*${py},setsar=1`;
  }
  // hold the last frame so every segment's picture is exactly out-in long (phone clips often end a frame short of
  // their audio, which left gaps and a variable frame rate after concat)
  const exact = `,tpad=stop_mode=clone:stop_duration=0.25,trim=duration=${(s.out - s.in).toFixed(4)}`;
  if (!BASE) f.push(`[${n}:v]trim=${s.in}:${s.out},${V}${exact},${fit}${zf}${fadeIn ? `,fade=t=in:st=0:d=${fadeIn}` : ''}${tp.length ? `,tpad=${tp.join(':')}` : ''}[v${i}]`);
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
  f.push(`[${b}:v]${V},scale=1080:1920,setsar=1,tpad=stop_duration=1:stop_mode=clone[g]`);
} else {
  if (trans.some(Boolean)) {
    // named transitions: the outgoing shot holds its last frame for the blend, so every segment still starts on the
    // same output time (captions and sfx stay put) and picture stays in sync with the voice
    f.push(`${segs.map((_, i) => `[a${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[ca]`);
    let cur = 'v0';
    segs.forEach((s, i) => {
      if (!i) return;
      const tr = trans[i], o = `x${i}`;
      if (tr) f.push(`[${cur}]tpad=stop_duration=${tr.d}:stop_mode=clone,fps=24,settb=AVTB[p${i}]`, `[v${i}]fps=24,settb=AVTB[q${i}]`, `[p${i}][q${i}]xfade=transition=${tr.m}:duration=${tr.d}:offset=${TL.segs[i].start.toFixed(3)}[${o}]`);
      else f.push(`[${cur}][v${i}]concat=n=2:v=1:a=0,fps=24,settb=AVTB[${o}]`);
      cur = o;
    });
    f.push(`[${cur}]${G}[g]`);
  } else {
    f.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[cv][ca]`);
    f.push(`[cv]${G}[g]`);
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
// kinetic titles sit between the picture and the person: picture -> titles -> person cut out by the mask -> captions
const ovlOff = (process.env.OVL_OFF || '').split(',').filter(Boolean).map(w => w.split('-').map(Number)).filter(([a, b]) => b > a);
const offEn = ovlOff.length ? `:enable='not(${ovlOff.map(([a, b]) => `between(t,${a},${b})`).join('+')})'` : '';
if (C.titles) {
  const t = inp('-framerate', '24', '-i', C.titles);
  const spec = require('./rules.cjs').maskSpec(C);
  const personFile = spec.person && fs.existsSync(spec.person) ? spec.person : null;
  const maskFile = spec.file && fs.existsSync(spec.file) ? spec.file : null;
  if (personFile) {
    const p = inp('-i', personFile);
    f.push(`[g][${t}:v]overlay=format=auto:eof_action=pass${offEn}[gt]`,
      `[${p}:v]format=bgra,scale=1080:1920,setsar=1,fps=24,setpts=PTS-STARTPTS[pr]`,
      `[gt][pr]overlay=format=auto:eof_action=pass[gm]`);
    vcur = 'gm';
  } else if (maskFile) {
    const m = inp('-i', maskFile);
    f.push(`[g]split[gb][gp]`, `[gb][${t}:v]overlay=format=auto:eof_action=pass${offEn}[gt]`, `[${m}:v]format=gray,scale=1080:1920,setsar=1,fps=24,setpts=PTS-STARTPTS[mk]`,
      `[gp][mk]alphamerge[person]`, `[gt][person]overlay=format=auto:eof_action=pass[gm]`);
    vcur = 'gm';
  } else {
    if (spec.file || C.mask) console.warn(`note: mask ${spec.file || C.mask} not found; titles go in front of the picture (run kit/mask.py)`);
    f.push(`[g][${t}:v]overlay=format=auto:eof_action=pass${offEn}[gm]`); vcur = 'gm';
  }
}
if (C.overlay) {
  const o = inp('-framerate', '24', '-i', C.overlay);
  const off = (process.env.OVL_OFF || '').split(',').filter(Boolean).map(w => w.split('-').map(Number)).filter(([a, b]) => b > a);
  const en = off.length ? `:enable='not(${off.map(([a, b]) => `between(t,${a},${b})`).join('+')})'` : '';
  f.push(`[${vcur}][${o}:v]overlay=format=auto:eof_action=pass${en}[o]`); vcur = 'o';
}
if (hits.length) {
  const env = hz => hits.map(([h, a]) => `${a}*gte(t,${h})*exp(-8*(t-${h}))*sin(2*PI*${hz}*(t-${h}))`).join('+');
  const win = hits.map(([h]) => `between(t,${(h - .04).toFixed(2)},${(h + .17).toFixed(2)})`).join('+');
  f.push(`[${vcur}]split[sa][sb]`, `[sa][sb]overlay=x='${env(17)}':y='${env(23)}':eval=frame[sh]`, `[sh]rgbashift=rh=-16:bh=16:rv=4:bv=-4:enable='${win}',noise=c0s=46:c0f=t+u:enable='${win}'[hv]`);
  vcur = 'hv';
}
f.push(`[${vcur}]fps=24,trim=0:${LEN}[vo]`);

// Sound: the locked set in kit/rules.cjs, plus pack hits from cut.json sfxHits (or sfx-hits.json).
// Each sound's hit point (measured peak, or the cutoff for a riser) lands on the time given.
// A job can add its own sound files in cut.json: "sounds": {"name": {"file": "../sfx/x.wav", "peak": 0.2, "vol": 0.4}} (file relative to build/).
const lbl = [], SFX = { ...R.SFX, ...Object.fromEntries(Object.entries(C.sounds || {}).map(([k, s]) => [k, { peak: 0, vol: 0.4, ...s, file: path.resolve(s.file) }])) };
if (!process.env.NOSFX) {
  for (const k of Object.keys(C.sfx || {})) {
    const S = SFX[k]; if (!S) { console.error(`unknown sfx "${k}"; use one of ${Object.keys(SFX).join(', ')}`); process.exit(1); }
    const ts = R.sfxHits(C.sfx[k]); if (!ts.length) continue;
    const n = inp('-i', path.resolve(KIT, S.file));
    f.push(`[${n}:a]${A},asplit=${ts.length}` + ts.map((_, j) => `[${k}s${j}]`).join(''));
    ts.forEach((h, j) => { const ms = Math.max(0, Math.round((h.t - S.peak) * 1000)); f.push(`[${k}s${j}]volume=${h.g ?? S.vol},adelay=${ms}|${ms}[${k}d${j}]`); lbl.push(`[${k}d${j}]`); });
  }
  const packHits = Array.isArray(C.sfxHits) ? C.sfxHits
    : (fs.existsSync('sfx-hits.json') ? (JSON.parse(fs.readFileSync('sfx-hits.json', 'utf8')).hits || []) : []);
  packHits.forEach((h, j) => {
    const S = SFXPLAN.lookup(h.id); if (!S) { console.error(`unknown sfx id "${h.id}" (kit/sfx/sfx.json)`); process.exit(1); }
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
args.push('-filter_complex', f.join(';'), '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
console.log('wrote', out, 'len', LEN);
