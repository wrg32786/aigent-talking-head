#!/usr/bin/env node
// Explainer: a proof panel on top, the presenter in a rounded frame below, short captions in between, full-frame
// moments for cutaways, a keyword punch-in and the call to action. Built and rendered with HyperFrames.
//   npm run explainer -- <job> [--spec jobs/<job>/Explainer.json] [--no-render]
// Needs a drafted job (npm run reel -- inbox/<clip> --name <job> --draft) and an Explainer.json (docs/explainer.md).
// Writes jobs/<job>/explainer/ (an editable HyperFrames project) and jobs/<job>/explainer-vN.mp4.
// Nothing leaves the computer except the first fetch of HyperFrames and GSAP from npm (docs/explainer.md);
// HyperFrames runs with its telemetry off.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join, resolve, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import { runInNewContext } from 'vm';
import { python } from './setup.mjs';
import { r2, norm, placeCuts, planBeats } from './explainer-timing.mjs';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const HF = 'hyperframes@0.9.68', GSAP = 'gsap@3.15.0', WIN = process.platform === 'win32';
const NOTRACK = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' };
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const die = m => { console.error('explainer: ' + m); process.exit(1); };

const job = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--spec'));
if (!job) die('usage: npm run explainer -- <job> [--spec <Explainer.json>] [--no-render]');
const J = join(ROOT, 'jobs', job);
const specPath = resolve(opt('spec') || join(J, 'Explainer.json'));
if (!existsSync(join(J, 'build', 'cut.json'))) die(`no draft for "${job}": run npm run reel -- inbox/<clip> --name ${job} --draft first`);
if (!existsSync(specPath)) die(`no spec at ${specPath}: copy examples/explainer/Explainer.json and edit it (docs/explainer.md)`);
const S = JSON.parse(readFileSync(specPath, 'utf8'));
const specDir = dirname(specPath);
const findFile = p => [resolve(specDir, p), resolve(ROOT, p), resolve(p)].find(existsSync) || die(`file not found: ${p}`);

const P = join(J, 'explainer'), A = join(P, 'assets'), C = join(P, 'compositions');
mkdirSync(A, { recursive: true });
rmSync(C, { recursive: true, force: true }); mkdirSync(C, { recursive: true }); // no scene files left from an earlier run
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...o }).toString();
const ffprobeDur = f => parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]));
const hasAudio = f => sh('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).trim() !== '';
const mtime = f => (existsSync(f) ? statSync(f).mtimeMs : 0);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const AV = 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p';
const AA = 'aresample=48000,aformat=channel_layouts=stereo';

// the AIgent palette and the kit's own fonts (kit/themes/aigent.js, kit/fonts), so the look does not depend on what
// is installed and the colours follow the theme
const THEME = (() => { const ctx = { window: {} }; runInNewContext(readFileSync(join(KIT, 'themes', 'aigent.js'), 'utf8'), ctx); return ctx.window.THEME; })();
const K = THEME.colors, INK = K.ink, TXT = K.text, ACC = K.accent, MUT = K.muted, PAPER = K.plate;
const FONTS = [['Hanken Grotesk', 'HankenGrotesk-VF.ttf', 'normal', '100 900'], ['Sofia Sans Extra Condensed', 'SofiaSansExtraCondensed-VF.ttf', 'normal', '100 900'],
  ['Playfair Display', 'PlayfairDisplay-Italic-VF.ttf', 'italic', '400 900'], ['JetBrains Mono', 'JetBrainsMono-VF.ttf', 'normal', '100 800']];
mkdirSync(join(A, 'fonts'), { recursive: true });
for (const [, f] of FONTS) copyFileSync(join(KIT, 'fonts', f), join(A, 'fonts', f));
const FONT_CSS = FONTS.map(([fam, f, style, w]) => `@font-face { font-family: "${fam}"; src: url("assets/fonts/${f}"); font-style: ${style}; font-weight: ${w}; }`).join('\n    ');
const BODY = '"Hanken Grotesk", sans-serif', DISPLAY = '"Sofia Sans Extra Condensed", sans-serif', SERIF = '"Playfair Display", serif', MONO = '"JetBrains Mono", monospace';

// 1. the talk track: the draft's segments back to back (made again only when the draft changed)
const cutFile = join(J, 'build', 'cut.json');
const cut = JSON.parse(readFileSync(cutFile, 'utf8'));
const segs = cut.segs || cut.segments || [];
if (!segs.length) die('cut.json has no segments');
const base = join(A, 'base.mp4');
if (mtime(base) < mtime(cutFile)) {
  const ins = [], f = [];
  segs.forEach((s, i) => {
    ins.push('-i', resolve(J, 'build', s.file));
    const len = (s.out ?? ffprobeDur(resolve(J, 'build', s.file))) - (s.in || 0);
    f.push(`[${i}:v]trim=${s.in || 0}:${s.out ?? 99999},setpts=PTS-STARTPTS,${AV}[v${i}]`);
    f.push(`[${i}:a]atrim=${s.in || 0}:${s.out ?? 99999},asetpts=PTS-STARTPTS,${AA},afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, len - 0.04)}:d=0.04[a${i}]`);
  });
  f.push(segs.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${segs.length}:v=1:a=1[v][a]`);
  sh('ffmpeg', ['-v', 'error', '-y', ...ins, '-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '16', '-g', '30', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', base]);
}

// 2. word times with the kit's own Python (faster-whisper in .venv), kept beside base.mp4 so --no-render and the
//    real render see the same times
const wordsFile = join(A, 'words.json');
let baseWords;
if (mtime(wordsFile) >= mtime(base)) baseWords = JSON.parse(readFileSync(wordsFile, 'utf8'));
else {
  console.log('explainer: transcribing');
  let out;
  try {
    out = sh(python(), ['-I', '-c', `
import json,sys
from faster_whisper import WhisperModel
m=WhisperModel(${JSON.stringify(S.model || 'small.en')},device="cpu",compute_type="int8")
segs,_=m.transcribe(sys.argv[1],word_timestamps=True)
print(json.dumps([[round(w.start,2),round(w.end,2),w.word.strip()] for s in segs for w in s.words]))`, base]);
  } catch (e) { die('transcribing failed (run npm run setup:all if Whisper is missing): ' + String(e.stderr || e.message).trim().split('\n').pop()); }
  baseWords = JSON.parse(out);
  writeFileSync(wordsFile, JSON.stringify(baseWords));
}

// 3. cutaways in the pause after their phrase; a cutaway with no sound gets silence of its length
let placed;
try { placed = placeCuts(baseWords, (S.cutaways || []).map(c => { const file = findFile(c.file); return { file, dur: ffprobeDur(file), after: c.after, audio: hasAudio(file) }; })); }
catch (e) { die(e.message); }
const { cuts, words } = placed;
const talk = join(A, 'talk.mp4');
if (!cuts.length) copyFileSync(base, talk);
else {
  const ins = ['-i', base], f = [], order = [];
  let prev = 0;
  cuts.forEach((c, k) => {
    ins.push('-i', c.file);
    f.push(`[0:v]trim=${prev}:${c.at},setpts=PTS-STARTPTS[bv${k}]`, `[0:a]atrim=${prev}:${c.at},asetpts=PTS-STARTPTS,afade=t=out:st=${Math.max(0, c.at - prev - 0.04)}:d=0.04[ba${k}]`);
    f.push(`[${k + 1}:v]fps=30,split[x${k}][y${k}]`, `[x${k}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2,eq=brightness=-0.15[bg${k}]`,
      `[y${k}]scale=1080:1920:force_original_aspect_ratio=decrease[fg${k}]`, `[bg${k}][fg${k}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[cv${k}]`,
      c.audio ? `[${k + 1}:a]${AA},afade=t=in:d=0.03[ca${k}]` : `anullsrc=r=48000:cl=stereo,atrim=0:${c.dur},asetpts=PTS-STARTPTS[ca${k}]`);
    order.push(`[bv${k}][ba${k}]`, `[cv${k}][ca${k}]`);
    prev = c.at;
  });
  f.push(`[0:v]trim=start=${prev},setpts=PTS-STARTPTS[bvz]`, `[0:a]atrim=start=${prev},asetpts=PTS-STARTPTS,afade=t=in:d=0.04[baz]`);
  order.push('[bvz][baz]');
  f.push(order.join('') + `concat=n=${order.length}:v=1:a=1[v][a]`);
  sh('ffmpeg', ['-v', 'error', '-y', ...ins, '-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '16', '-g', '30', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', talk]);
}
const T = r2(ffprobeDur(talk));

// 4. beats on the timeline (kit/explainer-timing.mjs)
let plan;
try { plan = planBeats(words, S, T, cuts); } catch (e) { die(e.message); }
const { beats, cta, hookEnd, full } = plan;
const isBoxed = t => !full.some(w => t >= w.a && t < w.b); // cutaways are full-frame windows too

// 5. scenes
const assets = {};
const asset = p => { const f = findFile(p), n = 'img-' + Object.keys(assets).length + extname(f); if (!assets[f]) { copyFileSync(f, join(A, n)); assets[f] = n; } return 'assets/' + assets[f]; };
const WINCSS = `border-radius: 26px; overflow: hidden; border: 3px solid ${ACC}; box-shadow: 0 24px 60px ${INK}59;`;
const BAR = (txt, id) => `<div class="${id}-bar"><i></i><i></i><i></i><span>${esc(txt || '')}</span></div>`;
const barCss = id => `.${id}-bar { height: 64px; background: ${INK}; display: flex; align-items: center; padding: 0 22px; gap: 10px; }
    .${id}-bar i { width: 15px; height: 15px; border-radius: 50%; display: block; background: ${MUT}; }
    .${id}-bar span { margin-left: 16px; flex: 1; font-family: ${BODY}; font-size: 28px; color: ${MUT}; white-space: nowrap; overflow: hidden; }`;
const fade = (sel, at, y = 40) => `tl.fromTo("${sel}", { opacity: 0, y: ${y} }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }, ${at});`;

function scene(id, d, css, body, js) {
  writeFileSync(join(C, id + '.html'), `<template>
  <style>
    ${FONT_CSS}
    #root { position: absolute; inset: 0; }
    ${css}
  </style>
  <div id="root" data-composition-id="${id}" data-width="1080" data-height="1920">
${body}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${js}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`);
  return { id, d };
}

const scenes = [];
if (S.hook) {
  const [l1, l2] = S.hook;
  scenes.push({ ...scene('hook', hookEnd, `#hook-l1 { position: absolute; left: 0; width: 1080px; top: 300px; text-align: center; font-family: ${BODY}; font-weight: 900; font-size: 74px; letter-spacing: -0.03em; color: ${INK}; }
    #hook-l2 { position: absolute; left: 0; width: 1080px; top: 398px; text-align: center; }
    #hook-l2 span { display: inline-block; padding: 4px 30px 14px; background: ${ACC}; color: ${INK}; border-radius: 14px; font-family: ${SERIF}; font-style: italic; font-weight: 700; font-size: 84px; }`,
  `    <div id="hook-l1" class="clip" data-start="0" data-duration="${hookEnd}">${esc(l1 || '')}</div>
    <div id="hook-l2" class="clip" data-start="0" data-duration="${hookEnd}"><span>${esc(l2 || '')}</span></div>`,
  `tl.fromTo("#hook-l2 span", { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "back.out(2)" }, 0);`), start: 0 });
}

beats.forEach((b, n) => {
  const id = 'b' + n, d = r2(b.end - b.start);
  let made;
  if (b.type === 'browser' || b.type === 'image') {
    const src = asset(b.image);
    const chrome = b.type === 'browser';
    made = scene(id, d, `#${id}-win { position: absolute; left: 60px; top: 290px; width: 960px; height: 560px; background: ${INK}; ${WINCSS} }
    ${barCss(id)}
    #${id}-view { position: absolute; left: 0; right: 0; top: ${chrome ? 64 : 0}px; bottom: 0; overflow: hidden; }
    #${id}-img { position: absolute; left: 0; top: 0; width: 960px; height: auto; transform-origin: 30% 10%; }`,
    `    <div id="${id}-win" class="clip" data-start="0" data-duration="${d}">
      ${chrome ? BAR(b.url, id) : ''}
      <div id="${id}-view"><img id="${id}-img" src="${src}" alt="" /></div>
    </div>`,
    `${fade(`#${id}-win`, 0)}
    ${b.pan === 'down' ? `tl.fromTo("#${id}-img", { y: 0 }, { y: -260, duration: ${d}, ease: "none" }, 0);` : `tl.fromTo("#${id}-img", { scale: 1 }, { scale: 1.1, duration: ${d}, ease: "none" }, 0);`}`);
  } else if (b.type === 'terminal') {
    const lines = (b.lines || []).map((l, k) => {
      const m = l.match(/^(\$|✓|>)\s?(.*)$/);
      const pre = m ? `<span class="${m[1] === '✓' ? 'ok' : 'dim'}">${esc(m[1])}</span> ` : '';
      return `<div id="${id}-l${k}" class="ln">${pre}${esc(m ? m[2] : l)}</div>`;
    });
    made = scene(id, d, `#${id}-win { position: absolute; left: 110px; top: 300px; width: 860px; height: 500px; background: ${INK}; ${WINCSS} }
    ${barCss(id)}
    #${id}-win .body { padding: 30px; font-family: ${MONO}; font-size: 28px; line-height: 1.6; color: ${TXT}; }
    #${id}-win .ln { white-space: nowrap; overflow: hidden; } #${id}-win .ok { color: ${ACC}; } #${id}-win .dim { color: ${MUT}; }`,
    `    <div id="${id}-win" class="clip" data-start="0" data-duration="${d}">
      ${BAR(b.title || 'terminal', id)}
      <div class="body">${lines.join('')}</div>
    </div>`,
    `${fade(`#${id}-win`, 0)}
    ${lines.map((_, k) => k === 0
      ? `tl.fromTo("#${id}-l0", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.5, ease: "steps(40)" }, 0.1);`
      : `tl.fromTo("#${id}-l${k}", { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.18, ease: "power2.out" }, ${r2(0.55 + k * 0.12)});`).join('\n    ')}`);
  } else if (b.type === 'progress') {
    made = scene(id, d, `#${id}-card { position: absolute; left: 130px; top: ${b.start < hookEnd ? 570 : 400}px; width: 820px; height: 290px; border-radius: 28px; background: ${INK}; border: 3px solid ${ACC}; box-shadow: 0 24px 60px ${INK}59; padding: 40px 48px; color: ${TXT}; }
    #${id}-card .k { font-family: ${MONO}; font-size: 30px; color: ${MUT}; letter-spacing: .04em; }
    #${id}-card .t { font-family: ${BODY}; font-weight: 900; font-size: 64px; margin-top: 14px; }
    #${id}-card .bar { position: absolute; left: 48px; right: 48px; bottom: 44px; height: 26px; border-radius: 13px; background: ${MUT}40; overflow: hidden; }
    #${id}-fill { position: absolute; inset: 0; background: ${ACC}; transform-origin: 0 50%; }
    #${id}-pct { position: absolute; right: 70px; top: 44px; font-family: ${MONO}; font-size: 34px; color: ${ACC}; }`,
    `    <div id="${id}-card" class="clip" data-start="0" data-duration="${d}">
      <div class="k">${esc(b.label || '')}</div><div class="t">${esc(b.title || '')}</div>
      <div id="${id}-pct">0%</div><div class="bar"><div id="${id}-fill"></div></div>
    </div>`,
    `${fade(`#${id}-card`, 0)}
    tl.fromTo("#${id}-fill", { scaleX: 0 }, { scaleX: 1, duration: ${r2(Math.max(0.6, d - 0.5))}, ease: "power1.inOut" }, 0.15);
    const pct = { v: 0 };
    tl.fromTo(pct, { v: 0 }, { v: 100, duration: ${r2(Math.max(0.6, d - 0.5))}, ease: "power1.inOut", onUpdate: () => { document.getElementById("${id}-pct").textContent = Math.round(pct.v) + "%"; } }, 0.15);`);
  } else if (b.type === 'equation') {
    const rows = (b.rows || []).map((r, k) => `<div id="${id}-r${k}" class="row" style="top:${105 + k * 180}px"><span>${esc(r[0])}</span><span class="eq">=</span><span class="acc">${esc(r[1])}</span></div>`);
    made = scene(id, d, `#${id}-card { position: absolute; left: 90px; top: 300px; width: 900px; height: ${140 + rows.length * 180}px; border-radius: 30px; background: ${INK}; border: 3px solid ${ACC}; box-shadow: 0 24px 60px ${INK}38; }
    #${id}-card .row { position: absolute; left: 0; width: 900px; display: flex; align-items: center; justify-content: center; gap: 34px; font-family: ${BODY}; font-weight: 900; font-size: 70px; color: ${TXT}; }
    #${id}-card .eq { color: ${ACC}; } #${id}-card .acc { font-family: ${SERIF}; font-style: italic; font-weight: 700; color: ${ACC}; }`,
    `    <div id="${id}-card" class="clip" data-start="0" data-duration="${d}">${rows.join('')}</div>`,
    `${fade(`#${id}-card`, 0)}
    ${rows.map((_, k) => fade(`#${id}-r${k}`, r2(0.3 + k * Math.min(1.1, (d - 0.6) / Math.max(1, rows.length))), 24)).join('\n    ')}`);
  } else if (b.type === 'stat') {
    made = scene(id, d, `#${id}-card { position: absolute; left: 90px; top: 300px; width: 900px; height: 500px; border-radius: 30px; background: ${INK}; border: 3px solid ${ACC}; box-shadow: 0 24px 60px ${INK}59; text-align: center; }
    #${id}-card .v { margin-top: 70px; font-family: ${DISPLAY}; font-weight: 860; font-size: 240px; color: ${TXT}; letter-spacing: -0.01em; }
    #${id}-card .l { margin-top: 0; font-family: ${BODY}; font-weight: 700; font-size: 44px; color: ${ACC}; }`,
    `    <div id="${id}-card" class="clip" data-start="0" data-duration="${d}"><div class="v">${esc(b.value || '')}</div><div class="l">${esc(b.label || '')}</div></div>`,
    `${fade(`#${id}-card`, 0)}`);
  } else if (b.type === 'keyword') {
    made = scene(id, d, `#${id}-scrim { position: absolute; left: 0; top: 0; width: 1080px; height: 900px; background: linear-gradient(${INK}8c, ${INK}00); }
    #${id}-w { position: absolute; left: 0; width: 1080px; top: 250px; text-align: center; color: ${TXT}; font-family: ${SERIF}; font-style: italic; font-weight: 700; font-size: 190px; text-shadow: 0 8px 30px ${INK}73; }
    #${id}-s { position: absolute; left: 0; width: 1080px; top: 500px; text-align: center; color: ${TXT}; font-family: ${BODY}; font-weight: 800; font-size: 54px; text-shadow: 0 4px 18px ${INK}80; }`,
    `    <div id="${id}-scrim" class="clip" data-start="0" data-duration="${d}"></div>
    <div id="${id}-w" class="clip" data-start="0.35" data-duration="${r2(d - 0.35)}">${esc(b.word || '')}</div>
    ${b.sub ? `<div id="${id}-s" class="clip" data-start="0.45" data-duration="${r2(d - 0.45)}">${esc(b.sub)}</div>` : ''}`,
    `tl.fromTo("#${id}-scrim", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0);
    tl.fromTo("#${id}-w", { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, 0.35);
    ${b.sub ? `tl.fromTo("#${id}-s", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, 0.45);` : ''}`);
  } else die(`beat ${n + 1}: unknown type "${b.type}" (browser, image, terminal, progress, equation, stat, keyword)`);
  scenes.push({ ...made, start: b.start });
});

if (cta) {
  const d = r2(T - cta.start);
  scenes.push({ ...scene('cta', d, `#cta-scrim { position: absolute; left: 0; top: 0; width: 1080px; height: 950px; background: linear-gradient(${INK}99, ${INK}00); }
    #cta-c { position: absolute; left: 0; width: 1080px; top: 300px; text-align: center; color: ${TXT}; font-family: ${SERIF}; font-style: italic; font-weight: 700; font-size: 96px; text-shadow: 0 6px 24px ${INK}80; }
    #cta-k { position: absolute; left: 0; width: 1080px; top: 405px; text-align: center; color: ${ACC}; font-family: ${DISPLAY}; font-weight: 860; font-size: 150px; text-transform: uppercase; text-shadow: 0 8px 30px ${INK}80; }
    #cta-s { position: absolute; left: 0; width: 1080px; top: 585px; text-align: center; color: ${TXT}; font-family: ${BODY}; font-weight: 800; font-size: 48px; text-shadow: 0 4px 18px ${INK}8c; }`,
  `    <div id="cta-scrim" class="clip" data-start="0" data-duration="${d}"></div>
    <div id="cta-c" class="clip" data-start="0.35" data-duration="${r2(d - 0.35)}">comment</div>
    <div id="cta-k" class="clip" data-start="0.6" data-duration="${r2(d - 0.6)}">“${esc(cta.word || '')}”</div>
    ${cta.sub ? `<div id="cta-s" class="clip" data-start="0.75" data-duration="${r2(d - 0.75)}">${esc(cta.sub)}</div>` : ''}`,
  `tl.fromTo("#cta-scrim", { opacity: 0 }, { opacity: 1, duration: 0.35 }, 0);
    tl.fromTo("#cta-c", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, 0.35);
    tl.fromTo("#cta-k", { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.2)" }, 0.6);
    ${cta.sub ? `tl.fromTo("#cta-s", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, 0.75);` : ''}`), start: cta.start });
}

// 6. captions: 1 to 3 words, only while the presenter is boxed, the spec's keywords on an accent highlight
const ALIAS = S.aliases || {}, ACCW = new Set((S.accent || []).map(norm));
const say = k => (Object.hasOwn(ALIAS, k) ? ALIAS[k] : k); // a plain object: "constructor" must stay a word
const chunks = []; let cur = null;
for (const [s, e, raw] of words) {
  if (!isBoxed(s)) { cur = null; continue; }
  const w = say(raw.replace(/[.,?!]/g, ''));
  if (!cur || cur.w.length >= 3 || s - cur.e > 0.25 || /[.,?!]$/.test(cur.raw)) { cur = { s, e, w: [] }; chunks.push(cur); }
  cur.w.push(w); cur.e = e; cur.raw = raw;
}
chunks.forEach((c, i) => {
  const nx = chunks[i + 1];
  const end = nx && nx.s - c.e < 0.6 ? nx.s : c.e + 0.35;
  const stop = [...full.map(w => w.a), T].filter(x => x > c.s);
  c.end = r2(Math.min(end, ...stop)); c.d = r2(c.end - c.s);
});
scene('captions', T, `.cap { position: absolute; left: 0; width: 1080px; top: 888px; text-align: center; color: ${INK}; font-family: ${BODY}; font-weight: 900; font-size: 58px; letter-spacing: -0.02em; }
    .cap em { font-family: ${SERIF}; font-style: italic; font-weight: 700; color: ${INK}; background: ${ACC}; padding: 0 10px 4px; border-radius: 8px; }`,
  chunks.map((c, i) => `    <div id="cap-${i}" class="clip cap" data-start="${c.s}" data-duration="${c.d}">${c.w.map(w => ACCW.has(norm(w)) ? `<em>${esc(w)}</em>` : esc(w)).join(' ')}</div>`).join('\n'),
  chunks.map((c, i) => `tl.fromTo("#cap-${i}", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.12, ease: "back.out(2)" }, ${c.s});`).join('\n    '));

// 7. GSAP for the page, from npm once per kit (jobs/.explainer/gsap) and copied into the project, so the page renders
//    offline. GSAP ships under its own no-charge licence (gsap.com/standard-license), so it is fetched, not committed.
const hf = (args, o = {}) => {
  const r = spawnSync('npx', ['--yes', HF, ...args], { cwd: P, env: NOTRACK, encoding: 'utf8', maxBuffer: 1 << 26, shell: WIN, ...o });
  if (r.error) die(`could not start npx (${r.error.code || r.error.message}): install Node.js 18 or newer, with npm`);
  return r;
};
const gsapFile = join(A, 'gsap.min.js');
if (!existsSync(gsapFile)) {
  const cache = join(ROOT, 'jobs', '.explainer', 'gsap'), src = join(cache, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
  if (!existsSync(src)) {
    mkdirSync(cache, { recursive: true });
    console.log('explainer: fetching GSAP from npm (once)');
    const r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', cache, GSAP], { env: NOTRACK, encoding: 'utf8', shell: WIN });
    if (r.error || !existsSync(src)) die('could not fetch GSAP from npm (needs the network once): ' + String(r.error ? r.error.message : (r.stderr || '')).trim().split('\n').pop());
  }
  copyFileSync(src, gsapFile);
}

// 8. root: grid paper, the presenter (boxed or full), music, scene hosts
const fr = S.frame || {}, top = fr.top ?? 560, bot = fr.bottom ?? 1560;
const sc = 0.85, boxTop = 1000, boxH = Math.min(880, r2(sc * (bot - top))), y = r2(boxTop - sc * top);
const BOX = `{ scale: ${sc}, y: ${y}, clipPath: "inset(${top}px 0px ${1920 - top - boxH / sc}px 0px round 48px)" }`;
const FULL = `{ scale: 1, y: 0, clipPath: "inset(0px 0px 0px 0px round 0px)" }`;
const moves = [];
for (const w of full) {
  if (w.hard) moves.push(`tl.set("#presenter", FULL, ${w.a}).set("#rim", { opacity: 0 }, ${w.a});`, `tl.set("#presenter", BOX, ${w.b}).set("#rim", { opacity: 1 }, ${w.b});`);
  else {
    moves.push(`tl.to("#presenter", { ...FULL, duration: 0.4, ease: "power3.inOut" }, ${w.a}).to("#rim", { opacity: 0, duration: 0.2 }, ${w.a});`);
    if (w.b < T - 0.1) moves.push(`tl.to("#presenter", { ...BOX, duration: 0.4, ease: "power3.inOut" }, ${w.b}).to("#rim", { opacity: 1, duration: 0.2 }, ${r2(w.b + 0.2)});`);
  }
}
let music = '';
if (S.music) {
  const lib = join(KIT, 'music', S.music + '.mp3');
  const mf = existsSync(lib) ? lib : findFile(S.music);
  copyFileSync(mf, join(A, 'music' + extname(mf)));
  music = `<audio id="music" class="clip" src="assets/music${extname(mf)}" data-start="0" data-duration="${T}" data-track-index="1" data-volume="${S.musicVolume ?? 0.12}"></audio>`;
}
const host = (s, k) => `      <div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.d}" data-track-index="${2 + (k % 2)}" data-track-kind="graphics" data-width="1080" data-height="1920" style="z-index:5"></div>`;
writeFileSync(join(P, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="assets/gsap.min.js"></script>
    <style>
      ${FONT_CSS}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: ${PAPER}; }
      #root { width: 100%; height: 100%; position: relative; font-family: ${BODY}; }
      #bg { position: absolute; inset: 0; background-color: ${PAPER};
        background-image: linear-gradient(${INK}1a 1px, transparent 1px), linear-gradient(90deg, ${INK}1a 1px, transparent 1px),
          linear-gradient(${INK}0d 1px, transparent 1px), linear-gradient(90deg, ${INK}0d 1px, transparent 1px);
        background-size: 180px 180px, 180px 180px, 36px 36px, 36px 36px; }
      #presenter { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; transform-origin: 50% 0; z-index: 2; }
      #talk { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; object-fit: cover; }
      #rim { position: absolute; left: 81px; top: ${boxTop}px; width: 918px; height: ${boxH}px; z-index: 3; border: 5px solid ${ACC}; border-radius: 41px; box-shadow: 0 18px 50px ${INK}40; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${T}" data-width="1080" data-height="1920">
      <div id="bg"></div>
      <div id="presenter"><video id="talk" class="clip" src="assets/talk.mp4" data-start="0" data-duration="${T}" data-track-index="0" data-has-audio="true" playsinline></video></div>
      <div id="rim"></div>
      ${music}
${scenes.map(host).join('\n')}
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${T}" data-track-index="4" data-track-kind="captions" data-width="1080" data-height="1920" style="z-index:6"></div>
    </div>
    <script>
      const BOX = ${BOX};
      const FULL = ${FULL};
      const tl = gsap.timeline({ paused: true });
      tl.set("#presenter", BOX, 0).set("#rim", { opacity: 1 }, 0);
      ${moves.join('\n      ')}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`);
writeFileSync(join(P, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', assets: 'assets' }, media: { autoProxy: true }, authoringSkill: 'hyperframes' }, null, 2));
writeFileSync(join(P, 'meta.json'), JSON.stringify({ id: job + '-explainer', name: job + '-explainer' }, null, 2));
// npm run dev / check / render in the project go through hf.mjs: HyperFrames with its telemetry off, on every system
writeFileSync(join(P, 'hf.mjs'), `// Runs HyperFrames for this project with its telemetry off (HYPERFRAMES_NO_TELEMETRY, DO_NOT_TRACK).
import { spawnSync } from 'child_process';
const r = spawnSync('npx', ['--yes', '${HF}', ...process.argv.slice(2)], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' } });
if (r.error) { console.error('could not start npx: ' + r.error.message); process.exit(1); }
process.exit(r.status ?? 1);
`);
writeFileSync(join(P, 'package.json'), JSON.stringify({ name: job + '-explainer', private: true, type: 'module',
  scripts: { dev: 'node hf.mjs preview', check: 'node hf.mjs check', render: 'node hf.mjs render' } }, null, 2));
console.log(`explainer: ${scenes.length} scenes, ${chunks.length} captions, ${cuts.length} cutaway(s), ${T} s -> ${P}`);
for (const c of cuts) console.log(`  cutaway ${basename(c.file)} at ${c.start} s (pause after the phrase${c.audio ? '' : ', no sound in the clip: silence'})`);

// 9. check (a fresh report: the folder is emptied first), then render a numbered version
const checks = join(P, '.hyperframes', 'artifacts', 'checks');
rmSync(checks, { recursive: true, force: true });
const chk = hf(['check', '--json']);
const reports = existsSync(checks) ? readdirSync(checks).filter(f => f.endsWith('.json')).map(f => join(checks, f)).sort((a, b) => mtime(b) - mtime(a)) : [];
if (!reports.length) die('the HyperFrames check did not run:\n  ' + String((chk.stdout || '') + (chk.stderr || '')).trim().split('\n').slice(-6).join('\n  '));
const errors = [];
(function walk(o) { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') { if (o.code && o.severity === 'error') errors.push(`${o.code}: ${o.message}`); for (const k in o) walk(o[k]); } })(JSON.parse(readFileSync(reports[0], 'utf8')));
if (errors.length) die('HyperFrames check failed:\n  ' + [...new Set(errors)].join('\n  '));
console.log('explainer: CHECK OK (warnings, if any, are in ' + checks + ')');
if (flag('no-render')) { console.log(`explainer: project ready. Preview: cd ${P} && npm run dev`); process.exit(0); }
let v = 1; while (existsSync(join(J, `explainer-v${v}.mp4`))) v++;
const out = join(J, `explainer-v${v}.mp4`);
console.log('explainer: rendering');
const rr = hf(['render', '--output', out]);
if (!existsSync(out)) die('render failed:\n  ' + String((rr.stdout || '') + (rr.stderr || '')).trim().split('\n').slice(-6).join('\n  ') + `\n  (run it by hand to see more: cd ${P} && npm run render)`);
console.log(`Explainer: ${out}`);
