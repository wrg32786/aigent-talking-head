// Session report 2, E: a logo file (captions.js "logo", a brand plate's "logo", theme.logo) loaded from disk tainted the
// overlay canvas, so the face check (window.__faceInk, getImageData) threw and no reel was made. render.mjs now hands
// every logo and graphic image to the page as a data URL. This renders 2 s of overlay with an SVG logo plate and a PNG
// brand plate over a face zone and checks the face check ran. Needs Chrome. Run: node tests/logo-dataurl.e2e.mjs
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit'), d = mkdtempSync(join(tmpdir(), 'logo-'));
try {
  copyFileSync(join(KIT, 'example', 'skool-logo.svg'), join(d, 'skool-logo.svg'));
  // a 4x4 PNG (a brand mark from a file)
  writeFileSync(join(d, 'brand-1-mark.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP4z8DwHxkzMNBAAACbTA/xtdJZ+AAAAABJRU5ErkJggg==', 'base64'));
  const zone = [300, 520, 780, 1060, 440], faceTrack = { fps: 8, size: [1080, 1920], zones: Array(16).fill(zone) };
  const flips = [{ start: 0, end: 0.9, mode: 5, text: '' }, { start: 0.9, end: 1.6, mode: 5, text: '', logo: 'brand-1-mark.png', brand: 'Mark' }, { start: 0, end: 2, mode: 0, text: 'join us on skool', y: 1300 }];
  writeFileSync(join(d, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ captionStyle: 'phrase', fonts: 'theme', logo: 'skool-logo.svg', faceTrack, flips }) + ';\n');
  const out = execFileSync(process.execPath, [join(KIT, 'render.mjs'), '2'], { cwd: d, env: { ...process.env, THEME: 'aigent', FONTS: 'theme', FPS: '6' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.ok(existsSync(join(d, 'facecheck.json')), 'the face check ran: ' + out.slice(-400));
  const fc = JSON.parse(readFileSync(join(d, 'facecheck.json'), 'utf8'));
  assert.ok(fc.samples > 0 && !fc.tainted, JSON.stringify(fc).slice(0, 300));
  const g = readFileSync(join(d, 'gfx.js'), 'utf8');
  assert.ok(/data:image\/svg\+xml;base64,/.test(g) && /data:image\/png;base64,/.test(g), 'both logos went to the page as data URLs');
  console.log('ok logo files reach the overlay as data URLs; the face check runs (' + fc.samples + ' samples)');
} finally { rmSync(d, { recursive: true, force: true }); }
