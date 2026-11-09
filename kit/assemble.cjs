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
//   "bed": "music.wav", "bedStart": 0, "bedVol": 0.16, "bedNoFade": true,
//   "overlay": "ovl/%04d.png"            optional; leave out for a clean cut
// }
// "norm": true runs loudnorm -16 LUFS on that segment (raw camera audio sits near -32 LUFS; HeyGen and clip.py output do not need it).
// Env overrides: NOSFX=1, NOBED=1, BEDVOL=<n>, BEDNOFADE=1.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const C = JSON.parse(fs.readFileSync('cut.json', 'utf8'));
const out = process.argv[2] || 'out.mp4';
const KIT = __dirname;
const A = 'aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS';
const V = 'fps=24,format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS';
const G = "unsharp=5:5:0.3:3:3:0,eq=contrast=1.03:saturation=0.93:gamma=0.99,curves=all='0/0.02 0.5/0.495 1/0.975',noise=c0s=5:c0f=t+u,vignette=PI/6";
const segs = C.segs, tail = C.tail ?? 0.3, hits = C.hits || [];
const segLen = s => (s.out - s.in) + (s.pad || 0);
const LEN = +(segs.reduce((a, s) => a + segLen(s), 0) + tail).toFixed(3);
const hasAudio = f => { try { return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).toString().trim() !== ''; } catch { return false; } };

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
  f.push(`[${n}:v]trim=${s.in}:${s.out},${V},${fit}${fadeIn ? `,fade=t=in:st=0:d=${fadeIn}` : ''}${tp.length ? `,tpad=${tp.join(':')}` : ''}[v${i}]`);
  const d = s.out - s.in;
  const delay = s.pad ? `,adelay=${Math.round(s.pad * 1000)}|${Math.round(s.pad * 1000)}` : '';
  const apad = last && tail ? `,apad=pad_dur=${tail}` : '';
  if (hasAudio(s.file)) {
    f.push(`[${n}:a]atrim=${s.in}:${s.out},${A}${s.norm ? ',loudnorm=I=-16:TP=-1.5:LRA=11,' + A : ''},afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, d - 0.05).toFixed(3)}:d=0.05${delay}${apad}[a${i}]`);
  } else {
    f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${(segLen(s) + (last ? tail : 0)).toFixed(3)},${A}[a${i}]`);
  }
});
f.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[cv][ca]`);
f.push(`[cv]${G}[g]`);
let vcur = 'g';
if (C.overlay) {
  const o = inp('-framerate', '24', '-i', C.overlay);
  f.push(`[g][${o}:v]overlay=format=auto:eof_action=pass[o]`); vcur = 'o';
}
if (hits.length) {
  const env = hz => hits.map(([h, a]) => `${a}*gte(t,${h})*exp(-8*(t-${h}))*sin(2*PI*${hz}*(t-${h}))`).join('+');
  const win = hits.map(([h]) => `between(t,${(h - .04).toFixed(2)},${(h + .17).toFixed(2)})`).join('+');
  f.push(`[${vcur}]split[sa][sb]`, `[sa][sb]overlay=x='${env(17)}':y='${env(23)}':eval=frame[sh]`, `[sh]rgbashift=rh=-16:bh=16:rv=4:bv=-4:enable='${win}',noise=c0s=46:c0f=t+u:enable='${win}'[hv]`);
  vcur = 'hv';
}
f.push(`[${vcur}]trim=0:${LEN}[vo]`);

// Woosh hits (Will's picks, Freesound CC0): F 648729 "Cinematic Woosh SFX-010" by AudioPapkin on every cut,
// D 683101 "quick woosh" by florianreichelt on cards moving in or out. The measured peak lands on the time given.
const SFX = { F: { file: 'sfx/F-cinematic-woosh-648729.mp3', peak: 0.69, vol: 0.6 }, D: { file: 'sfx/D-quick-woosh-683101.mp3', peak: 0.24, vol: 0.5 } };
const lbl = [];
if (!process.env.NOSFX) for (const k of Object.keys(SFX)) {
  const ts = (C.sfx && C.sfx[k]) || []; if (!ts.length) continue;
  const n = inp('-i', path.join(KIT, SFX[k].file));
  f.push(`[${n}:a]${A},asplit=${ts.length}` + ts.map((_, j) => `[${k}s${j}]`).join(''));
  ts.forEach((h, j) => { const ms = Math.max(0, Math.round((h - SFX[k].peak) * 1000)); f.push(`[${k}s${j}]volume=${SFX[k].vol},adelay=${ms}|${ms}[${k}d${j}]`); lbl.push(`[${k}d${j}]`); });
}
const mix = ['[ca]'];
if (lbl.length) { f.push(`${lbl.join('')}amix=inputs=${lbl.length}:normalize=0,volume=0.8[sfx]`); mix.push('[sfx]'); }
const bed = !process.env.NOBED && C.bed;
if (bed) {
  const n = inp('-i', bed);
  const st = +(C.bedStart || 0), vol = +(process.env.BEDVOL || C.bedVol || 0.22), nofade = process.env.BEDNOFADE || C.bedNoFade;
  f.push(`[${n}:a]atrim=${st}:${(st + LEN + .2).toFixed(2)},${A},volume=${vol}${nofade ? '' : ',afade=t=in:d=0.3'},afade=t=out:st=${(LEN - 1.4).toFixed(2)}:d=1.4[bed]`);
  // Duck the bed under the voice. Without it, hi-hats masked "school" into "pool".
  mix[0] = '[cak]';
  f.push('[ca]asplit[cak][key]', '[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=250:makeup=1[bedd]');
  mix.push('[bedd]');
}
f.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,atrim=0:${LEN},loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[ao]`);
args.push('-filter_complex', f.join(';'), '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
console.log('wrote', out, 'len', LEN);
