// The plan check (kit/plan-check.mjs, spec section 10): a drafted job against its builder plan. A filter set to Hook
// only but laid over the whole video is caught, fixed in round 2 and shows green; transitions not picked or outside
// their timing, key words, titles, repo shots and the call to action are checked; the moments to look at; the render's
// own face, text and contrast checks; an agent's looked-at checks are kept beside the measured ones.
// Run: node tests/plan-check.test.mjs   (npm run check runs it)
import assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as PC from '../kit/plan-check.mjs';
import { blank } from '../kit/studio/wizard/plan.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = mkdtempSync(join(tmpdir(), 'plan-check-test-'));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
// a 20 s job: hook to 4 s, body, then "Follow for more tools like this." from 16 s, in four pieces of one take
const LINES = [[0, 4, 'This tool saves me hours every single week.'], [4, 8, 'It reads your notes and makes a draft.'], [8, 12, 'The preview shows every change you make.'], [12, 16, 'It sorts the files in your folder too.'], [16, 20, 'Follow for more tools like this.']];
function job(name, { plan = blank(), cut = {}, caps = {} } = {}) {
  const jobs = join(TMP, 'jobs'), build = join(jobs, name, 'build'), clips = join(TMP, 'clips-' + name); mkdirSync(build, { recursive: true }); mkdirSync(clips, { recursive: true });
  const words = []; for (const [a, b, text] of LINES) { const ws = text.split(' '), step = (b - a) / ws.length; ws.forEach((w, i) => words.push([+(a + i * step).toFixed(2), +(a + (i + 0.8) * step).toFixed(2), w])); }
  writeFileSync(join(clips, 'clips.json'), JSON.stringify({ clips: [{ file: 'take.mp4', words }] }));
  const segs = [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20]].map(([a, b]) => ({ file: join(clips, 'take.mp4'), in: a, out: b }));
  writeFileSync(join(build, 'cut.json'), JSON.stringify({ segs, ...cut }));
  writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS=' + JSON.stringify({ flips: [{ start: 0.2, end: 2, text: 'This tool saves me hours', mode: 0 }], ...caps }) + ';\n');
  writeFileSync(join(build, 'video-plan.json'), JSON.stringify(plan));
  return { jobs, build };
}
const P = f => { const p = blank(); f(p); return p; };

try {
  await t('a filter set to Hook only but over the whole video is caught, fixed in round 2 and shows green', () => {
    const { build } = job('filt', { plan: P(p => { p.filters = { ids: ['mono'], when: 'hook' }; }), cut: { finish: 'mono' } });
    const first = PC.run(build); const f1 = first.checks.find(c => c.id === 'filters');
    assert.strictEqual(f1.ok, false); assert.match(f1.note, /covers the whole video/); assert.strictEqual(first.round, 1);
    const r = PC.run(build, { fix: true });
    assert.strictEqual(r.round, 2); assert.deepStrictEqual(r.rounds.map(x => x.failed.includes('filters')), [true, false]);
    assert.ok(r.checks.find(c => c.id === 'filters').ok, 'green after the fix'); assert.ok(r.needsRender && /only on the hook/.test(r.fixed[0].note));
    assert.ok(PC.run(build).needsRender, 'Check again still says to render');
    const cut = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8'));
    assert.ok(!cut.finish && cut.segs[0].finish === 'mono' && cut.segs.slice(1).every(s => !s.finish), 'only the hook has the filter');
    assert.ok(existsSync(join(build, 'scene-plan.json')) && existsSync(join(build, 'plan-check.json')));
    assert.ok(PC.run(build).checks.find(c => c.id === 'filters').ok, 'and it stays fixed');
  });
  await t('filters: missing on the hook, No filters taken off, and no fix when Studio\'s own setting differs', () => {
    const { build } = job('fmiss', { plan: P(p => { p.filters = { ids: ['mono'], when: 'hook' }; }) });
    const r1 = PC.run(build), f1 = r1.checks.find(c => c.id === 'filters'); assert.strictEqual(f1.ok, false); assert.match(f1.note, /missing on the hook/);
    const held = PC.run(build, { fix: true, state: { finishWhen: 'none' } }); assert.strictEqual(held.fixed.length, 0); assert.match(held.checks.find(c => c.id === 'filters').note, /pick it again/);
    assert.ok(PC.run(build, { fix: true, state: { finishWhen: 'hook' } }).checks.find(c => c.id === 'filters').ok);
    const { build: b2 } = job('fnone', { plan: P(p => { p.filters = { ids: [], when: 'hook' }; }), cut: { finish: 'mono' } });
    const r2 = PC.run(b2, { fix: true }); assert.ok(r2.checks.find(c => c.id === 'filters').ok, 'No filters: taken off, never added');
    const cut = JSON.parse(readFileSync(join(b2, 'cut.json'), 'utf8')); assert.ok(!cut.finish && cut.segs.every(x => !x.finish));
  });
  await t('transitions: only picked ones, only where the timing keeps them, both fixed', () => {
    const { build } = job('tr', { plan: P(p => { p.transitions = { ids: ['whip'], when: 'hook-cta' }; }) });
    const c = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')); c.segs[1].transition = 'whip'; c.segs[2].transition = 'zoom'; c.segs[4].transition = 'whip'; writeFileSync(join(build, 'cut.json'), JSON.stringify(c));
    const r1 = PC.run(build); assert.strictEqual(r1.checks.find(x => x.id === 'transitions').ok, false); assert.match(r1.checks.find(x => x.id === 'transitions').note, /zoom/);
    assert.strictEqual(r1.checks.find(x => x.id === 'transitions-when').ok, false);
    const r = PC.run(build, { fix: true }); assert.ok(r.checks.find(x => x.id === 'transitions').ok && r.checks.find(x => x.id === 'transitions-when').ok, JSON.stringify(r.checks));
    const after = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')); assert.strictEqual(after.segs[2].transition, 'cut', 'the body seam is a plain cut'); assert.strictEqual(after.segs[1].transition, 'whip');
    // a seam you set yourself stays yours
    const { build: b3 } = job('tr2', { plan: P(p => { p.transitions = { ids: ['whip'], when: 'every-cut' }; }) });
    const c3 = JSON.parse(readFileSync(join(b3, 'cut.json'), 'utf8')); c3.segs[2].transition = 'zoom'; c3.edited = { transitions: [2] }; writeFileSync(join(b3, 'cut.json'), JSON.stringify(c3));
    assert.ok(PC.run(b3, { fix: true }).checks.find(x => x.id === 'transitions').ok); assert.strictEqual(JSON.parse(readFileSync(join(b3, 'cut.json'), 'utf8')).segs[2].transition, 'zoom');
  });
  await t('key words, titles, repo shots and the call to action', () => {
    const { build } = job('kw', { plan: P(p => { p.words.keyWords.level = 'strong'; p.words.titles.on = false; }), cut: { inserts: [{ file: 'x.png', at: 5, dur: 2, place: 'top', repo: true }] }, caps: { flips: [{ start: 0.2, end: 2, text: 'This tool', mode: 0 }, { start: 5, end: 7, text: 'Big title', mode: 7 }] } });
    const r1 = PC.run(build), by = id => r1.checks.find(x => x.id === id);
    assert.strictEqual(by('key-words').ok, false); assert.strictEqual(by('titles').ok, false); assert.match(by('titles').note, /draft again/);
    assert.strictEqual(by('repo').ok, false); assert.match(by('repo').note, /earlier plan/); assert.ok(by('cta').ok, 'follow for more is a call to action');
    const r = PC.run(build, { fix: true }), b2 = id => r.checks.find(x => x.id === id);
    assert.ok(b2('key-words').ok && !r.checks.some(x => x.id === 'repo'), 'repo shots taken out');
    assert.strictEqual(PC.readCaptions(join(build, 'captions.js')).keyWords, 'strong');
    assert.strictEqual(b2('titles').ok, false, 'titles need a new draft: not fixed here');
  });
  await t('no call to action heard: said on the page, with what to do', () => {
    const { build } = job('nocta', { plan: blank() });
    const c = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')); c.segs = c.segs.slice(0, 4); writeFileSync(join(build, 'cut.json'), JSON.stringify(c));
    const r = PC.run(build); const cta = r.checks.find(x => x.id === 'cta');
    assert.strictEqual(cta.ok, false); assert.match(cta.note, /did not hear a call to action/); assert.match(cta.note, /Extras/);
  });
  await t('the moments to look at, and the render\'s own face, text and contrast checks', async () => {
    const { build } = job('pts', { plan: blank(), caps: { flips: [{ start: 0.2, end: 2, text: 'This tool', mode: 0 }, { start: 5, end: 7, text: 'Big title', mode: 7 }] } });
    const c = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')); c.segs[2].transition = 'whip'; c.segs[0].finish = 'mono'; writeFileSync(join(build, 'cut.json'), JSON.stringify(c));
    writeFileSync(join(build, 'facecheck.json'), JSON.stringify({ faceSafe: false, hits: [{ t: 6.2 }] })); writeFileSync(join(build, 'legibility.json'), JSON.stringify({ under: 1, spans: [[8.4, 9, 2.1]] }));
    const st = PC.load(build); const pts = PC.checkpoints(st.cut, st.caps, build).map(p => p.id);
    for (const id of ['caption-1', 'hook-end', 'cta', 'title-1-in', 'title-1', 'seam-2', 'filter-1']) assert.ok(pts.includes(id), id + ' in ' + pts.join());
    const r = PC.run(build); const face = r.checks.find(x => x.id === 'face'); assert.strictEqual(face.ok, false); assert.strictEqual(face.time, 6.2);
    assert.strictEqual(r.checks.find(x => x.id === 'contrast').time, 8.4, 'legibility spans are [start, end, ratio]');
    // a render result older than the cut is from an earlier render: left out
    const { utimesSync } = await import('fs'); const old = new Date(Date.now() - 60000); utimesSync(join(build, 'facecheck.json'), old, old);
    assert.ok(!PC.run(build).checks.some(x => x.id === 'face'));
  });
  await t('an agent\'s looked-at checks sit beside the measured ones; the command line', () => {
    const { jobs, build } = job('cli', { plan: P(p => { p.filters = { ids: ['mono'], when: 'cta' }; }), cut: { finish: 'mono' } });
    const out = execFileSync(process.execPath, [join(ROOT, 'kit', 'plan-check.mjs'), 'check', '--name', 'cli', '--jobs', jobs, '--fix'], { encoding: 'utf8' });
    assert.match(out, /fixed \(round 1\): Filters \(mono\) now show only on the call to action/); assert.match(out, /Render again/);
    const lf = join(TMP, 'looked.json'); writeFileSync(lf, JSON.stringify([{ id: 'title-1', selection: 'Title: slam entrance', ok: false, note: 'The title comes in without the slam.', time: 5.1 }]));
    const rep = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'kit', 'plan-check.mjs'), 'report', '--name', 'cli', '--jobs', jobs, '--looked', lf], { encoding: 'utf8' }));
    assert.strictEqual(rep.looked[0].measured, false); assert.ok(rep.checks.length, 'measured rows stay');
    assert.throws(() => PC.run(join(TMP, 'jobs', 'none', 'build')), /make a draft first/);
    assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'kit', 'plan-check.mjs'), 'check', '--name', '../../x', '--jobs', jobs], { stdio: 'pipe' }), /status 2|Command failed/);
  });
  console.log(`\nplan check: ${n} tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
