// Publish kit: a cover title off the face, post copy per platform, a ZIP of the reel, and no mid-word cuts.
import assert from 'assert';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import * as P from '../kit/publish-kit.mjs';

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
  const out = lines.join(' ').split(' ');
  assert.ok(out.every(w => words.includes(w)), 'every token is a whole word: ' + lines.join(' | '));
  assert.ok(lines[0].startsWith('Building'));
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

console.log('\n' + n + ' checks passed');
