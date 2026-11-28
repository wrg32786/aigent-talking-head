// Publish kit: a cover title off the face, post copy per platform, a ZIP of the reel, and no mid-word cuts.
import assert from 'assert';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import * as P from '../kit/publish-kit.mjs';
import { kitOf, NINE16 } from '../kit/studio/publish-api.mjs';
import { mkdirSync } from 'fs';

const KIT = dirname(fileURLToPath(import.meta.url));
let n = 0; const ok = (m, f) => { f(); n++; console.log('ok ' + m); };

ok('SAFE is the intersection of the 9:16 platform UI zones', () => {
  assert.equal(P.SAFE.y0, 220);
  assert.equal(P.SAFE.y1, 1480);
  assert.equal(P.SAFE.x0, 60);
  assert.equal(P.SAFE.x1, 940);
});

ok('wrapTitle never splits a word, and stays on two lines', () => {
  const lines = P.wrapTitle('Building an app with AI in a weekend', { max: 18, lines: 2 });
  assert.ok(lines.length <= 2);
  const words = 'Building an app with AI in a weekend'.split(' ');
  const out = lines.join(' ').split(' ').map(w => w.replace(/…$/, ''));
  assert.ok(out.every(w => words.includes(w)), 'every token is a whole word: ' + lines.join(' | '));
  assert.ok(lines[0].startsWith('Building'));
  if (lines.join(' ').includes('weekend') === false) assert.ok(lines[lines.length - 1].endsWith('…'));
});

ok('titleBox stays in the safe area and off a face in the lower half', () => {
  const zone = [200, 800, 880, 1500, 600];
  const box = P.titleBox(zone);
  assert.ok(box.y + box.h <= zone[1] + 1e-6, 'title should sit above the face');
  assert.equal(P.overlapsFace(box, zone), false);
  assert.ok(box.y >= P.SAFE.y0 && box.y + box.h <= P.SAFE.y1);
  assert.ok(box.x >= P.SAFE.x0 && box.x + box.w <= P.SAFE.x1);
});

ok('titleBox moves under a face that fills the top of the frame', () => {
  const zone = [80, 200, 1000, 900, 120];
  const box = P.titleBox(zone);
  assert.ok(box.y >= zone[3] - 1e-6, 'title should sit below the face');
  assert.equal(P.overlapsFace(box, zone), false);
});

ok('with no face, the title sits in the top of the safe area', () => {
  const box = P.titleBox(null);
  assert.equal(box.y, P.SAFE.y0);
  assert.ok(box.h >= 160);
});

ok('copyOf keeps each platform under its caption limit, and YouTube titles under 100', () => {
  const long = 'This is a long description of the reel. '.repeat(80);
  const copy = P.copyOf({ title: 'A weekend with AI tools and a plan that actually ships for founders', description: long, point: 'Show beginners they can build an app' });
  assert.ok(P.units(copy.platforms.youtube.title) <= 100);
  for (const p of Object.values(copy.platforms)) {
    assert.ok(P.units(p.caption) <= p.limit, p.name + ' over limit: ' + P.units(p.caption));
    assert.equal(p.over, false);
  }
  assert.ok(copy.hashtags.length > 0);
  assert.ok(copy.hashtags.every(t => t.startsWith('#') && !t.includes(' ')));
});

ok('tags skip short and stop words, and stay at 8', () => {
  const tags = P.tagsOf('the and a weekend with beginners building apps');
  assert.ok(!tags.includes('#the') && !tags.includes('#and'));
  assert.ok(tags.includes('#weekend') && tags.includes('#beginners'));
  assert.ok(tags.length <= 8);
});

ok('copyText is readable and has no em dash', () => {
  const copy = P.copyOf({ title: 'A weekend build', description: 'We made an app in two days.', hashtags: ['#build', '#weekend'] });
  const t = P.copyText(copy);
  assert.ok(t.includes('Title: A weekend build'));
  assert.ok(t.includes('#build'));
  assert.ok(t.includes('YouTube Shorts'));
  assert.ok(!/\u2014/.test(t));
  assert.ok(!/\u2014/.test(readFileSync(new URL('../kit/publish-kit.mjs', import.meta.url), 'utf8')));
});

ok('pathsOf names the cover, copy and ZIP beside the reel', () => {
  const p = P.pathsOf('/tmp/job/reel-v1.mp4');
  assert.equal(p.srt, '/tmp/job/reel-v1.srt');
  assert.equal(p.cover, '/tmp/job/reel-v1-cover.jpg');
  assert.equal(p.copyJson, '/tmp/job/reel-v1-copy.json');
  assert.equal(p.zip, '/tmp/job/reel-v1-kit.zip');
});

ok('writeCopy and zipKit pack the reel, srt, cover and copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pub-kit-'));
  const reel = join(dir, 'reel-v1.mp4');
  writeFileSync(reel, 'fake-mp4');
  writeFileSync(join(dir, 'reel-v1.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
  writeFileSync(join(dir, 'reel-v1-cover.jpg'), 'fake-jpg');
  P.writeCopy(reel, P.copyOf({ title: 'Hi there', description: 'A short hello.' }));
  const z = P.zipKit(reel);
  assert.ok(existsSync(z.zip));
  const names = z.files.map(f => f.split('/').pop());
  assert.ok(names.includes('reel-v1.mp4') && names.includes('reel-v1.srt') && names.includes('reel-v1-cover.jpg'));
  assert.ok(names.includes('reel-v1-copy.json') && names.includes('reel-v1-copy.txt'));
});

ok('no em dashes in the cover script', () => {
  assert.ok(!/\u2014/.test(readFileSync(new URL('../kit/publish-cover.py', import.meta.url), 'utf8')));
});


ok('a tight face band is clamped, never grown into the face', () => {
  const zone = [80, 250, 1000, 1450, 200];
  const box = P.titleBox(zone);
  assert.ok(box.h <= 30 + 1e-6, 'height stays in the 30 px band, was ' + box.h);
  assert.equal(P.overlapsFace(box, zone), false);
});

ok('titleFromJob keeps an apostrophe in the title', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pub-title-'));
  writeFileSync(join(dir, 'captions.js'), 'module.exports = { titles: [{ text: "Don\'t stop now", start: 0, end: 2 }] };\n');
  assert.equal(P.titleFromJob(dir), "Don't stop now");
});

ok('publish-cover.py places the title off a given face zone', () => {
  const py = process.env.PYTHON || 'python3';
  try { execFileSync(py, ['-c', 'from PIL import Image'], { stdio: 'pipe' }); }
  catch { console.log('  note: skipped (Pillow is not installed on this Python)'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'pub-cover-'));
  const src = join(dir, 'frame.jpg'), out = join(dir, 'cover.jpg');
  execFileSync(py, ['-c', 'from PIL import Image; Image.new("RGB", (1080, 1920), (20, 40, 50)).save("' + src.replace(/\\/g, '/') + '")']);
  const r = execFileSync(py, [join(KIT, '..', 'kit', 'publish-cover.py'), '--in', src, '--out', out, '--title', 'Hello there', '--zone', '200,800,880,1500,600'], { encoding: 'utf8' });
  const j = JSON.parse(r.trim().split('\n').pop());
  assert.equal(j.onFace, false);
  assert.ok(j.box.y + j.box.h <= 800 + 1e-6, JSON.stringify(j.box));
  assert.ok(existsSync(out));
  assert.equal(j.detector, 'given');
});

ok('Make again keeps the saved (edited) description and hashtags, and only changes the title', () => {
  const saved = P.copyOf({ title: 'Old title', description: 'My own words about this reel.', hashtags: ['#mine', '#edited'] });
  const next = P.remakeCopy(saved, { title: 'New title', point: 'something else entirely' });
  assert.equal(next.title, 'New title');
  assert.equal(next.description, 'My own words about this reel.');
  assert.deepEqual(next.hashtags, ['#mine', '#edited']);
  assert.ok(next.platforms.instagram.caption.startsWith('My own words'));
  const fresh = P.remakeCopy(null, { title: 'First', text: 'What I said.' });
  assert.equal(fresh.description, 'What I said.');
  const given = P.remakeCopy(saved, { title: 'T', description: 'Sent now.', hashtags: ['#x'] });
  assert.equal(given.description, 'Sent now.');
  assert.deepEqual(given.hashtags, ['#x']);
});

ok('saving from a short-limit tab keeps the full description for every platform', () => {
  const long = 'A sentence that goes on for a while about the reel. '.repeat(12).trim();
  const copy = P.copyOf({ title: 'T', description: long, hashtags: ['#a'] });
  assert.ok(copy.platforms.twitter.description.length < long.length, 'X is shortened');
  // what the page sends now: the full description, so Instagram keeps all of it
  const saved = P.copyOf({ title: 'T', description: copy.description, hashtags: copy.hashtags });
  assert.equal(saved.platforms.instagram.description, long);
  assert.ok(P.units(saved.platforms.twitter.caption) <= 280);
  const jsx = readFileSync(new URL('../kit/studio/web/src/PublishKit.jsx', import.meta.url), 'utf8');
  assert.ok(!/description:\s*\(p && p\.description\)/.test(jsx), 'Save copy must not send the tab\'s shortened description');
});

ok('the kit view returns coverMeta, so the face-on-cover notes can show', () => {
  const root = mkdtempSync(join(tmpdir(), 'pub-view-')), d = join(root, 'jobs', 'j');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'reel-v1.mp4'), 'x');
  writeFileSync(join(d, 'reel-v1-cover.json'), JSON.stringify({ t: 1.2, onFace: true, detector: 'off' }));
  const k = kitOf(root, 'jobs/j/reel-v1.mp4');
  assert.deepEqual(k.coverMeta, { onFace: true, detector: 'off' });
  assert.equal(kitOf(root, 'jobs/j/reel-v2.mp4').coverMeta, null);
});

ok('every 9:16 reel gets a kit (effects and smaller copies too), never a 4:5 or 1:1 one', () => {
  for (const f of ['reel-v2.mp4', 'reel-fx-v2.mp4', 'reel-v2-reels.mp4', 'reel-v2-tiktok.mp4', 'reel-v2-shorts.mp4']) assert.ok(NINE16.test('jobs/j/' + f), f);
  for (const f of ['reel-v2-feed45.mp4', 'reel-v2-square.mp4', 'reel-v2-cover.jpg', 'take.mp4']) assert.ok(!NINE16.test('jobs/j/' + f), f);
});

ok('descriptions keep their paragraphs; titles stay on one line', () => {
  const c = P.copyOf({ title: 'Two\nlines', description: 'First para.\n\n\n\nSecond   para.\r\nThird.', hashtags: ['#a'] });
  assert.equal(c.description, 'First para.\n\nSecond para.\nThird.');
  assert.equal(c.title, 'Two lines');
  assert.ok(c.platforms.instagram.caption.startsWith('First para.\n\nSecond para.'));
  const long = ('Word '.repeat(30).trim() + '\n\n').repeat(10);
  const x = P.copyOf({ title: 'T', description: long, hashtags: ['#a'] }).platforms.twitter;
  assert.ok(P.units(x.caption) <= 280 && !/\s$/.test(x.description) && x.description.split(/\s+/).every(w => w === 'Word'));
});

ok('a title that cannot fit a thin band off the face is reported as onFace (measured on the drawn letters)', () => {
  const py = process.env.PYTHON || 'python3';
  try { execFileSync(py, ['-c', 'from PIL import Image'], { stdio: 'pipe' }); }
  catch { console.log('  note: skipped (Pillow is not installed on this Python)'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'pub-thin-'));
  const src = join(dir, 'frame.jpg'), out = join(dir, 'cover.jpg');
  execFileSync(py, ['-c', 'from PIL import Image; Image.new("RGB", (1080, 1920), (20, 40, 50)).save("' + src.replace(/\\/g, '/') + '")']);
  const r = execFileSync(py, [join(KIT, '..', 'kit', 'publish-cover.py'), '--in', src, '--out', out, '--title', 'A long title that needs two lines here', '--zone', '80,270,1000,1500,200'], { encoding: 'utf8' });
  const j = JSON.parse(r.trim().split('\n').pop());
  assert.equal(j.lines.length, 2);
  assert.equal(j.onFace, true, 'two lines at the floor size do not fit a 50 px band: ' + JSON.stringify(j));
});

console.log('\n' + n + ' checks passed');
