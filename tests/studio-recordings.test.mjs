// Recordings across videos (kit/studio/recordings.mjs), behind the Recording tab: the list finds takes in every video and
// in the holding folder, newest first; Use in this video moves a held take (so it is in one place) and copies one from
// another video (so that video keeps its footage); a take from the open video just joins its footage; take numbers never
// clash with files on disk; bad paths and no video are refused in plain words. Also record.mjs with no video named:
// the take goes to the holding folder and does not join any footage.
// Run: node tests/studio-recordings.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-recordings-'));
process.env.STUDIO_DIR = STATE;
const C = await import('../kit/studio/core.mjs');
const R = await import('../kit/studio/recordings.mjs');
const REC = await import('../kit/studio/record.mjs');
const P = process.pid, A = `recs-a-${P}`, B = `recs-b-${P}`, HID = 900000 + (P % 90000);
const HOLD = join(ROOT, 'inbox', 'studio', '_recordings', 'takes');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const take = (job, id, at, script) => {
  const dir = join(ROOT, 'inbox', 'studio', job, 'takes'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `take-${id}.mp4`), 'x'); writeFileSync(join(dir, `take-${id}.jpg`), 'j');
  writeFileSync(join(dir, `take-${id}.json`), JSON.stringify({ seconds: 4.2, at, script: script ? { title: script, text: script + ' text' } : null }));
  return `inbox/studio/${job}/takes/take-${id}.mp4`;
};
const fresh = job => { const s = C.load(); C.freshSession(s, { job, keepLook: false }); return s; };
const code = (fn, c, re) => { try { fn(); } catch (e) { assert.strictEqual(e.code, c, e.message); if (re) assert.match(e.message, re); return; } assert.fail('did not throw'); };

try {
  const a1 = take(A, 1, '2026-11-01T10:00:00Z', 'Morning'), b1 = take(B, 1, '2026-11-03T10:00:00Z'), h = take('_recordings', HID, '2026-11-05T10:00:00Z', 'Held');
  t('list: every video and the holding folder, newest first, with length, date, script and which video', () => {
    const s = fresh(A), mine = R.list(s).filter(x => [a1, b1, h].includes(x.file));
    assert.deepStrictEqual(mine.map(x => x.file), [h, b1, a1]);
    assert.deepStrictEqual(mine.map(x => x.job), [null, B, A]);
    assert.strictEqual(mine[0].script, 'Held'); assert.strictEqual(mine[0].seconds, 4.2); assert.ok(mine[0].thumb.endsWith('.jpg'));
    assert.ok(mine.every(x => !x.inVideo));
  });
  t('use: a take from the open video joins its footage; a take from another video is copied', () => {
    const s = fresh(A);
    R.use(s, a1); assert.deepStrictEqual(s.footage, [a1]);
    R.use(s, b1); const got = s.footage[1];
    assert.ok(got.startsWith(`inbox/studio/${A}/takes/take-`) && got !== a1, got);
    assert.ok(existsSync(join(ROOT, b1)), 'the other video keeps its take');
    assert.strictEqual(s.takes.find(x => x.file === got).status, 'ready');
    assert.ok(R.list(s).find(x => x.file === got).inVideo);
    assert.ok(R.list(s).find(x => x.file === b1).inVideo, 'the original shows as in this video');
    R.use(s, b1); assert.strictEqual(s.footage.length, 2, 'using it again reuses the copy');
  });
  t('use: a held take moves into the video, with its script and thumbnail', () => {
    const s = fresh(B); R.use(s, h);
    const got = s.footage[0], tk = s.takes.find(x => x.file === got);
    assert.ok(!existsSync(join(ROOT, h)) && !existsSync(join(ROOT, h.replace('.mp4', '.json'))), 'moved, not copied');
    assert.ok(existsSync(join(ROOT, got)) && existsSync(join(ROOT, got.replace('.mp4', '.jpg'))));
    assert.strictEqual(tk.script.title, 'Held'); assert.strictEqual(tk.id, 2, 'next number above take-1 on disk');
  });
  t('take numbers are never reused, even after a take moves away', () => {
    const s = fresh(A), dir = `inbox/studio/${A}/takes`, n1 = R.nextId(s, dir), n2 = R.nextId(s, dir);
    assert.ok(n2 > n1, `${n1} then ${n2}`);
  });
  t('use: refused for a bad path, a missing file, or no video', () => {
    const s = fresh(A);
    code(() => R.use(s, '../../etc/passwd'), 404, /not there/);
    code(() => R.use(s, `inbox/studio/${A}/takes/take-77.mp4`), 404);
    s.job = null; code(() => R.use(s, a1), 400, /Name the video/);
  });
  t('record with no video named: the take waits in the holding folder, out of any footage', () => {
    take('_recordings', HID + 1, '2026-11-06T10:00:00Z');
    const s = fresh(A); s.job = null;
    const id = REC.start(s, { mime: 'video/webm' }), tk = s.takes.find(x => x.id === id);
    assert.ok(tk.held && !tk.kept && tk.raw.startsWith('inbox/studio/_recordings/takes/'), JSON.stringify(tk));
    assert.ok(id > HID + 1, 'numbered above the takes already in the folder');
    REC.abort(s, id); assert.ok(!existsSync(join(ROOT, tk.raw)));
  });
} finally {
  for (const j of [A, B]) rmSync(join(ROOT, 'inbox', 'studio', j), { recursive: true, force: true });
  for (const k of [HID, HID + 1]) for (const ext of ['mp4', 'jpg', 'json']) rmSync(join(HOLD, `take-${k}.${ext}`), { force: true });
  rmSync(STATE, { recursive: true, force: true });
}
console.log(`\n${n} recordings tests passed`);
