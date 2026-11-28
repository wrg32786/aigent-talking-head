// A short playable sample of a saved style look, for the Teardowns Look library.
// Built locally from the look (the kit's sample presenter, a fixed sample script, never the reference's words).
// Cached as looks/local/<name>/sample.mp4 with sample.sig; rebuilt when the look changes.
// One way on every computer: an ffmpeg-only sample at 540x960 (no overlay render, no person mask), as long as its plan.
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { resolveFonts } from '../fonts.mjs';

const require = createRequire(import.meta.url);
const SL = require('../stylelook.cjs');
const B = require('../beats.cjs');

const KIT = dirname(fileURLToPath(import.meta.url)); // kit/studio
const ROOT = dirname(dirname(KIT));
const PRESENTER = join(ROOT, 'showcase', 'source', 'presenter.jpg');
const FONT_FALLBACK = join(ROOT, 'kit', 'fonts', 'InterTight-VF.ttf');
const WORDS = { title: 'THIS WEEKEND', lineA: 'Build your first agent', lineB: 'with one take on your phone' };

const fail = (msg, code = 400) => { throw Object.assign(new Error(msg), { code }); };
// ffmpeg -version works on every system (Windows has no "which" outside Git Bash)
const hasFfmpeg = () => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

export function samplePlan(look) {
  if (!look || typeof look !== 'object') fail('No look to sample.');
  const cap = look.captions || {}, titles = look.titles || {}, trans = look.transitions || {};
  const grade = look.grade || {}, moves = look.moves || {}, pace = look.pace || {};
  const music = look.music || {}, sfx = look.sfx || {}, brand = look.brand || {}, stickers = look.stickers || {};
  const mean = Math.min(3.0, Math.max(1.4, Number(pace.shotMean) || 2.2));
  const mix = trans.mix || {};
  const named = trans.default && trans.default !== 'cut' ? trans.default : (Object.keys(mix).filter(k => k !== 'cut').sort((a, b) => (mix[b] || 0) - (mix[a] || 0))[0] || 'cut');
  const font = (cap.font && cap.font.pairing) || (titles.font && titles.font.pairing) || brand.fonts || 'theme';
  const sounds = sfx.sounds && typeof sfx.sounds === 'object' ? Object.keys(sfx.sounds) : [];
  return {
    title: WORDS.title,
    lineA: WORDS.lineA,
    lineB: WORDS.lineB,
    shotA: +mean.toFixed(2),
    shotB: +Math.min(2.4, mean).toFixed(2),
    transition: named,
    transDur: named === 'cut' ? 0 : 0.4,
    finish: grade.finish || null,
    theme: brand.theme || 'neutral',
    fonts: font && font !== 'none' ? font : 'theme',
    captionStyle: cap.style || 'kinetic',
    captionColor: cap.color || '#f1e8dc',
    captionPosition: cap.position || 'bottom',
    captionCase: cap.case || null,
    titleOn: titles.on !== false,
    titleEntrance: (titles.entrances || [])[0] || null,
    punch: moves.punch !== false,
    move: (moves.push || 0) >= 0.15 ? 'push' : (moves.pull || 0) >= 0.15 ? 'pull' : null,
    graphic: stickers.ordinal ? 'ordinal' : stickers.appLabel ? 'app-label' : stickers.screenCard ? 'screen-card' : null,
    graphicColor: (stickers.ordinal && stickers.ordinal.color) || '#e8c547',
    music: !!music.present,
    bed: music.bed || null,
    energy: music.energy || null,
    bpm: music.bpm || null,
    sfx: !!(sfx.count > 0 || sounds.length),
    sfxSound: sounds[0] || (sfx.types && Object.keys(sfx.types)[0]) || null,
  };
}

export function secondsOf(plan) {
  const a = plan.shotA, b = plan.shotB, d = plan.transDur || 0;
  return +(a + b - (d ? d : 0)).toFixed(2);
}

// fields that change the picture or the sound; created/label/from/file do not
export function sigOf(look) {
  const plan = samplePlan(look);
  // v: the sample builder's version, so a sample from an older builder (a minute long, 270x480) counts as out of date
  const body = JSON.stringify({ v: 2, plan, mix: look.mix || null, grade: look.grade || null, captions: look.captions || null, titles: look.titles || null, transitions: look.transitions || null, moves: look.moves || null, pace: look.pace || null, music: look.music || null, sfx: look.sfx || null, brand: look.brand || null, stickers: look.stickers || null, style: look.style || null });
  return createHash('sha256').update(body).digest('hex').slice(0, 24);
}

export const sampleFile = (name, ext = 'mp4') => join(SL.dirOf(), name, 'sample.' + ext);
export const sigFile = name => join(SL.dirOf(), name, 'sample.sig');

export function statusOf(name, look) {
  if (!SL.NAME_RE.test(String(name || ''))) return { status: 'missing' };
  const mp4 = sampleFile(name, 'mp4'), webp = sampleFile(name, 'webp');
  const file = existsSync(mp4) ? mp4 : (existsSync(webp) ? webp : null);
  if (!file) return { status: 'missing' };
  let sig = '';
  try { sig = readFileSync(sigFile(name), 'utf8').trim(); } catch {}
  const want = look ? sigOf(look) : sig;
  if (sig && want && sig !== want) return { status: 'stale', file, url: `/api/style-looks/sample/${name}` };
  return { status: 'ready', file, url: `/api/style-looks/sample/${name}?v=${sig || '1'}`, sig };
}

export function modeOf() {
  return { ffmpeg: hasFfmpeg() };
}

function fontFile(pairing) {
  if (pairing && pairing !== 'theme') {
    try {
      const r = resolveFonts(pairing), url = r && ((r.display && r.display.url) || (r.secondary && r.secondary.url));
      if (url && url.startsWith('file://')) {
        const f = decodeURIComponent(url.slice('file://'.length));
        if (existsSync(f)) return f;
      }
    } catch {}
  }
  return existsSync(FONT_FALLBACK) ? FONT_FALLBACK : null;
}

function escDraw(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

function bedFile(plan) {
  const dir = join(ROOT, 'kit', 'music');
  const named = plan.bed && existsSync(join(dir, plan.bed + '.mp3')) ? join(dir, plan.bed + '.mp3') : null;
  if (named) return named;
  const fallback = join(dir, 'cinematic-build.mp3');
  return existsSync(fallback) ? fallback : null;
}

function sfxFile(plan) {
  // the look's own sound when the kit has it, else a known short pop in the kit; otherwise none
  const cands = [plan.sfxSound && join(ROOT, 'kit', 'sfx', plan.sfxSound), join(ROOT, 'kit', 'sfx', 'pop', '11-pop-sticker.mp3'), join(ROOT, 'kit', 'sfx', 'pop', 'pop.wav')].filter(Boolean);
  for (const c of cands) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function finishVf(name) {
  if (!name || name === 'none') return '';
  try { const c = B.finishChain(name); return c ? ',' + c : ''; } catch { return ''; }
}

const STOCK = new Set(['fade','wipeleft','wiperight','wipeup','wipedown','slideleft','slideright','slideup','slidedown','circlecrop','rectcrop','distance','fadeblack','fadewhite','radial','smoothleft','smoothright','smoothup','smoothdown','circleopen','circleclose','vertopen','vertclose','horzopen','horzclose','dissolve','pixelize','diagtl','diagtr','diagbl','diagbr','hlslice','hrslice','vuslice','vdslice','hblur','fadegrays','wipetl','wipetr','wipebl','wipebr','squeezeh','squeezev','zoomin','fadefast','fadeslow','hlwind','hrwind','vuwind','vdwind','coverleft','coverright','coverup','coverdown','revealleft','revealright','revealup','revealdown']);
function stockXfade(name) {
  try {
    const R = require('../rules.cjs');
    const m = R.xfadeMode(name);
    if (typeof m === 'string' && STOCK.has(m)) return m;
  } catch {}
  const n = String(name || '').toLowerCase();
  if (STOCK.has(n)) return n;
  if (/flash|white/.test(n)) return 'fadewhite';
  if (/black/.test(n)) return 'fadeblack';
  if (/whip|slide/.test(n)) return 'slideright';
  if (/zoom/.test(n)) return 'zoomin';
  return 'fade';
}


function ff(args) {
  try { return execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error([e.message, e.stderr && e.stderr.toString()].filter(Boolean).join('\n').slice(0, 400)); }
}

function buildLite(look, dest, work) {
  if (!existsSync(PRESENTER)) fail('The sample presenter picture is missing.', 500);
  const plan = samplePlan(look), font = fontFile(plan.fonts);
  const W = 540, H = 960, FPS = 24, k = W / 270; // laid out on a 270 wide grid, drawn at 540x960
  const aLen = plan.shotA, bLen = plan.shotB, d = plan.transDur || 0;
  // d=1: one zoomed frame for each input frame, so a shot is as long as its plan (d=n made n x n frames, about a minute)
  const zoom = plan.move === 'pull' ? "zoompan=z='1.12-0.12*on/(({n}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=" + FPS
    : (plan.punch || plan.move === 'push') ? "zoompan=z='1.02+0.10*on/(({n}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=" + FPS
    : null;
  const capY = (plan.captionPosition === 'top' ? 80 : plan.captionPosition === 'middle' ? 240 : 400) * k;
  const title = plan.titleOn ? (plan.captionCase === 'lower' ? plan.title.toLowerCase() : plan.title) : '';
  const lineA = plan.captionCase === 'upper' ? plan.lineA.toUpperCase() : plan.lineA;
  const lineB = plan.captionCase === 'upper' ? plan.lineB.toUpperCase() : plan.lineB;
  const rawColor = String(plan.captionColor || '').replace(/^#/, '');
  const hex = /^[0-9a-f]{6}$/i.test(rawColor) ? rawColor : 'f1e8dc';
  const fontOpt = font ? `:fontfile='${escDraw(font)}'` : '';
  // a title or a line never runs off the frame: its size shrinks to fit the width (min(size, w*0.9 per character))
  const text = (t, size, y) => `drawtext=text='${escDraw(t)}'${fontOpt}:fontsize=${Math.min(size, Math.floor((W * 0.9) / Math.max(1, t.length * 0.56)))}:fontcolor=0x${hex}:x=(w-tw)/2:y=${y}:borderw=${2 * k}:bordercolor=0x0b0907@0.8`;
  const textA = [];
  if (title) textA.push(text(title, 22 * k, 36 * k));
  textA.push(text(lineA, 16 * k, capY));
  const textB = [text(lineB, 16 * k, capY)];
  if (plan.graphic === 'ordinal') { const b = 48 * k, x = `w-${70 * k}`, y = 24 * k; textA.push(`drawbox=x=${x}:y=${y}:w=${b}:h=${b}:color=${plan.graphicColor.replace('#', '0x')}@0.95:t=fill,drawtext=text='1'${fontOpt}:fontsize=${18 * k}:fontcolor=0x0b0907:x=${x}+(${b}-tw)/2:y=${y}+(${b}-th)/2`); }
  const fin = finishVf(plan.finish);
  const framesA = Math.max(2, Math.round(aLen * FPS)), framesB = Math.max(2, Math.round(bLen * FPS));
  const zA = zoom ? zoom.replaceAll('{n}', String(framesA)) + ',' : '';
  const zB = zoom ? zoom.replaceAll('{n}', String(framesB)) + ',' : '';
  const aOut = join(work, 'a.mp4'), bOut = join(work, 'b.mp4'), vOut = join(work, 'v.mp4');
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];
  const shot = (flip, z, txt, frames, len, out) => ff(['-loop', '1', '-framerate', String(FPS), '-t', String(len), '-i', PRESENTER, '-filter_complex',
    `[0:v]${flip}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${z}setsar=1${fin},scale=${W}:${H}:flags=lanczos,setsar=1,${txt.join(',')}[v]`, '-map', '[v]', '-frames:v', String(frames), ...enc, out]);
  shot('', zA, textA, framesA, aLen, aOut);
  shot('hflip,', zB, textB, framesB, bLen, bOut);
  if (d > 0 && plan.transition !== 'cut') ff(['-i', aOut, '-i', bOut, '-filter_complex', `xfade=transition=${stockXfade(plan.transition)}:duration=${d}:offset=${+(aLen - d).toFixed(2)}`, ...enc, vOut]);
  else ff(['-i', aOut, '-i', bOut, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', ...enc, vOut]);
  const dur = secondsOf(plan);
  const bed = plan.music ? bedFile(plan) : null, hit = plan.sfx ? sfxFile(plan) : null;
  if (!bed && !hit) { copyFileSync(vOut, dest); return; }
  // one mix: the bed faded in and out, the pop on the cut; padded to the video and cut at its length (-t)
  const at = Math.round(Math.max(0, aLen - 0.05) * 1000), ins = ['-i', vOut], parts = [];
  if (bed) { ins.push('-t', String(dur), '-i', bed); parts.push(`[1:a]volume=0.22,afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, dur - 0.4)}:d=0.4[b]`); }
  if (hit) { ins.push('-i', hit); parts.push(`[${bed ? 2 : 1}:a]volume=0.5,adelay=${at}|${at}[s]`); }
  const mix = bed && hit ? '[b][s]amix=inputs=2:duration=first:dropout_transition=0,apad[a]' : `[${bed ? 'b' : 's'}]apad[a]`;
  ff([...ins, '-filter_complex', [...parts, mix].join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-t', String(dur), dest]);
}

// Build or reuse the cached sample. Returns { status, file, url, sig, mode, note }.
export function build(name, { force = false, look: given } = {}) {
  const n = SL.slug(name);
  if (!SL.exists(n)) fail(`No saved look "${name}".`, 404);
  const look = given || SL.load(n);
  const sig = sigOf(look);
  const st = statusOf(n, look);
  if (!force && st.status === 'ready' && st.file) return { ...st, mode: 'cached', note: null };
  const mode = modeOf();
  if (!mode.ffmpeg) {
    return { status: 'unavailable', file: null, url: null, sig, mode: 'none', note: 'We could not make a sample on this computer because FFmpeg is not available. The look is saved; we will make the sample when FFmpeg is here.' };
  }
  const dir = dirname(sampleFile(n));
  mkdirSync(dir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'look-sample-'));
  const dest = sampleFile(n, 'mp4');
  try {
    buildLite(look, dest, work);
    writeFileSync(sigFile(n), sig + '\n');
    return { status: 'ready', file: dest, url: `/api/style-looks/sample/${n}?v=${sig}`, sig, mode: 'lite', note: null };
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

export function copySample(fromName, toName) {
  const src = statusOf(fromName);
  if (src.status !== 'ready' || !src.file) return false;
  const destDir = dirname(sampleFile(toName));
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src.file, sampleFile(toName, src.file.endsWith('.webp') ? 'webp' : 'mp4'));
  if (existsSync(sigFile(fromName))) copyFileSync(sigFile(fromName), sigFile(toName));
  return true;
}
