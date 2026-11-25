// The live text preview (docs/specs/studio-builder.md 7.1): the real caption renderer, kit/overlay.html, on a short
// sample script over the sample presenter, drawn in the page instead of a render. The files overlay.html loads next to
// it come from the same code a render uses (kit/overlay-files.mjs, kit/themes, kit/fonts.mjs), with font file URLs
// pointed at Studio's /files/ route, and the sample captions carry the sample presenter's face zone (faceTrack), so the
// layout pass keeps every word off the face exactly as it does in a render.
//   GET /api/preview/overlay/<key>/overlay.html   and its captions.js, theme.js, fonts.js, fxzones.js, lockover.js, gfx.js
// <key> is the words part of a plan (kit/studio/wizard/plan.mjs words, plus behind: true when titles go behind the
// head), as base64url JSON, so every choice has its own address and nothing is stored.
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as OF from '../overlay-files.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url))), ROOT = dirname(KIT);
export const SAMPLE = { title: 'THIS WEEKEND', lines: ['Build your first agent this weekend', 'with one take on your phone'], hero: ['agent', 'phone'], seconds: 6 };
export const FACE = join(ROOT, 'showcase', 'source', 'presenter-face.json');
// where the caption band sits for each place (px in the 1080x1920 frame): chest just under the chin, lower third lower
export const CAPTION_Y = { chest: 1340, lower: 1560 };
const THEMES = ['aigent', 'magazine', 'neutral'];
const HEX = /^#[0-9a-f]{6}$/i;

export const keyOf = words => Buffer.from(JSON.stringify(words || {})).toString('base64url');
export const wordsOf = key => { try { const w = JSON.parse(Buffer.from(String(key), 'base64url').toString('utf8')); return w && typeof w === 'object' && !Array.isArray(w) ? w : {}; } catch { return {}; } };

// the sample captions.js document for the words of a plan
export function sampleDoc(w = {}, face = faceTrack()) {
  const kinetic = w.type === 'kinetic' || (!w.type && (!w.look || w.look === 'kinetic'));
  const style = w.look || (kinetic ? 'kinetic' : 'classic');
  const words = (line, t0, t1) => { const ws = line.split(' '), d = (t1 - t0) / ws.length; return ws.map((x, i) => [+(t0 + i * d).toFixed(3), +(t0 + (i + 1) * d).toFixed(3), x]); };
  const flips = [], titles = w.titles || {};
  if (kinetic && titles.on !== false) {
    const t = { start: 0.3, end: 2.7, text: SAMPLE.title, mode: 7, hero: [1], entrance: (titles.entrances || [])[0] || 'slam' };
    if (titles.effect) t.effect = titles.effect; if (titles.exit) t.exit = titles.exit;
    const place = ((w.place || {}).titles || [])[0]; if (place) t.place = place;
    flips.push(t);
  }
  flips.push({ start: 0.3, end: 2.9, text: SAMPLE.lines[0], mode: 0, words: words(SAMPLE.lines[0], 0.3, 2.9), hero: SAMPLE.hero[0] });
  flips.push({ start: 3.1, end: 5.7, text: SAMPLE.lines[1], mode: 0, words: words(SAMPLE.lines[1], 3.1, 5.7), hero: SAMPLE.hero[1] });
  const doc = { captionStyle: style, flips };
  if (kinetic && w.entrance) doc.captionEntrance = w.entrance;
  const kw = (w.keyWords || {}).level; if (kinetic && ['subtle', 'strong', 'dramatic'].includes(kw)) doc.keyWords = kw;
  const y = CAPTION_Y[(w.place || {}).captions]; if (y) { doc.captionY = y; doc.kineticY = y; doc.pillY = y; }
  const c = w.colors || {}, colors = {}; if (HEX.test(c.text || '')) colors.text = c.text; if (HEX.test(c.accent || '')) colors.accent = c.accent;
  if (Object.keys(colors).length) doc.theme = { colors };
  if (w.behind) doc.titleLayer = 'behind';
  if (face) { doc.faceTrack = face; doc.faceTop = Math.round(Math.min(...face.zones.filter(Boolean).map(z => z[1]))); doc.faceBottom = Math.round(Math.max(...face.zones.filter(Boolean).map(z => z[3]))); }
  return doc;
}
let FACE_CACHE;
export function faceTrack() {
  // the still presenter's zone, held for the whole loop (the layout pass reads the track over each caption's time)
  if (FACE_CACHE === undefined) { try { const f = JSON.parse(readFileSync(FACE, 'utf8')), last = f.zones.filter(Boolean).pop(); FACE_CACHE = { fps: f.fps, zones: Array.from({ length: Math.ceil(SAMPLE.seconds * f.fps) + 1 }, (_, i) => f.zones[i] || last) }; } catch { FACE_CACHE = null; } }
  return FACE_CACHE;
}
// a file:// URL inside the repo -> the same file through Studio's /files/ route
const served = u => String(u).split(pathToFileURL(ROOT + '/').href).join('/files/');

// the body and type of one preview file, or null
export function file(key, name) {
  const w = wordsOf(key);
  const js = body => ({ type: 'text/javascript; charset=utf-8', body });
  if (name === 'overlay.html') return { type: 'text/html; charset=utf-8', body: readFileSync(join(KIT, 'overlay.html'), 'utf8') };
  if (name === 'captions.js') return js('window.CAPTIONS=' + JSON.stringify(sampleDoc(w)) + ';\n');
  if (name === 'theme.js') { const t = join(KIT, 'themes', (THEMES.includes((w.colors || {}).theme) ? w.colors.theme : 'aigent') + '.js'); return js(existsSync(t) ? readFileSync(t, 'utf8') : ''); }
  if (name === 'fonts.js') { let text; try { text = OF.fontsDoc(typeof w.fonts === 'string' ? w.fonts : 'theme').text; } catch { text = OF.fontsDoc('theme').text; } return js(served(text)); }
  if (name === 'fxzones.js') return js('window.FXZONES=[];\n');
  if (name === 'lockover.js') return js('window.LOCKOVER=' + JSON.stringify({ lockup: null, hero: null, titleLayer: null, inserts: [] }) + ';\n');
  if (name === 'gfx.js') return js('window.GFX=' + JSON.stringify(OF.gfxDoc({}, f => served(pathToFileURL(f).href))) + ';\nwindow.DATAURLS={};\n');
  return null;
}

export function route(p, M, res) {
  const m = p.match(/^\/api\/preview\/overlay\/([A-Za-z0-9_-]*)\/([a-z]+\.(?:html|js))$/);
  if (!m || M !== 'GET') return false;
  const f = file(m[1], m[2]);
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no such preview file'); return true; }
  res.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-store' }); res.end(f.body); return true;
}
