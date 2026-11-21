// The Cut step in 1.28.0, with no Chrome, no keys and no network:
// - the point of the video ("What's the point of this video?"): stemmed word and phrase overlap, stop words out; a
//   line that serves it scores higher and says so; Let AI choose, the full edit and the clips follow; the prompt a
//   model or your agent gets carries the same line; it is saved with the session and cleared with a fresh edit
// - topics: 3 to 5 themes of two or more words from the transcript; the old chips (help, youre, back, build,
//   different, friends, able, business) never come back; nothing good hides the row; an agent's themes are checked
// - pacing: Natural, Tight, Very tight; the stitched spans only ever lose quiet, never part of a word
// - the server: POST /api/state { point }, pieces with fits, best and topics, GET /api/cut/preview, MCP fields
// Run: node tests/studio-point.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url);
const STATE = mkdtempSync(join(tmpdir(), 'studio-point-test-')), JOB = 'point-test-' + process.pid;
process.env.STUDIO_DIR = join(STATE, 'studio');
const W = await import('../kit/studio/words.mjs'), PT = await import('../kit/studio/point.mjs'), TP = await import('../kit/studio/topics.mjs');
const P = await import('../kit/studio/pieces.mjs'), CUT = await import('../kit/studio/cut.mjs'), PACE = await import('../kit/studio/pacing.mjs');
const C = await import('../kit/studio/core.mjs'), MEDIA = await import('../kit/studio/media.mjs'), CH = await import('../kit/studio/channel.mjs');
const CP = require('../kit/cutpoints.cjs'), { speech } = require('./fixtures/speech.cjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

// the fixture take: lines of a made-up but real-sounding talk, timed at about three words a second
const TEXT = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'topics-take.json'), 'utf8')).lines;
const WORDS = []; { let at = 0.4; for (const line of TEXT) { for (const w of line.split(' ')) { WORDS.push([+at.toFixed(2), +(at + 0.28).toFixed(2), w]); at += 0.32; } at += 0.9; } }
const LINES = CUT.lines(WORDS, null);
const POINT = 'Show beginners they can build an app with AI in a weekend';
const OLD_BAD = ['help', 'youre', 'back', 'build', 'different', 'friends', 'able', 'business'];

await t('words: contractions and filler are never content, and build, builds, building and built meet', () => {
  assert.deepStrictEqual(W.contentStems("You're able to help, and that's it"), [], 'only stop words');
  assert.strictEqual(new Set(['build', 'builds', 'building', 'built'].map(W.stem)).size, 1);
  assert.strictEqual(W.stem('beginners'), W.stem('beginning'));
  assert.ok(W.contentStems('Building with AI in a weekend').includes('ai'), 'a two letter subject counts');
});
await t('the point: overlap of stemmed content words and phrases; one shared word is not enough', () => {
  const p = PT.pointScorer(POINT);
  assert.deepStrictEqual(p.words.sort(), ['ai', 'app', 'begin', 'build', 'weekend']);
  assert.strictEqual(p.fit("You're able to build a working app in a weekend if you pick one small problem."), 1);
  assert.ok(p.fits('Most people think building with AI is only for developers.'), 'two of its words');
  assert.ok(p.fit('My friends thought I was wasting my time.') === 0 && !p.fits('My friends thought I was wasting my time.'));
  assert.ok(p.fit('Third, ask it to build the smallest version.') > 0 && !p.fits('Third, ask it to build the smallest version.'), 'one word lifts the score a little but is not a fit');
  assert.strictEqual(PT.pointScorer(''), null); assert.strictEqual(PT.pointScorer('to be or not to be'), null, 'only small words');
  assert.strictEqual(PT.cleanPoint('  Sell the course — fast  '), 'Sell the course , fast', 'no em dash is kept');
  assert.strictEqual(PT.cleanPoint('x'.repeat(400)).length, PT.POINT_MAX);
});
await t('lines: one that serves the point scores higher and carries fits; without a point nothing does', () => {
  const plain = P.build(LINES).pieces, steered = P.build(LINES, { point: POINT }).pieces;
  assert.ok(plain.every(p => !p.fits));
  const up = steered.filter(p => p.fits); assert.ok(up.length >= 3, 'lines that fit: ' + up.length);
  for (const p of up) assert.ok(p.score > plain.find(x => x.id === p.id).score || p.score === 100, p.text);
  const off = steered.find(p => /wasting my time/.test(p.text)); assert.strictEqual(off.score, plain.find(x => x.id === off.id).score, 'a line off the point keeps its score');
});
await t('Let AI choose follows the point and says "Fits your point" on the lines it boosted', () => {
  const plain = P.choose(P.build(LINES).pieces, { min: 20, max: 40 }), steered = P.choose(P.build(LINES, { point: POINT }).pieces, { min: 20, max: 40 });
  const fitN = ch => ch.ids.filter(id => PT.pointScorer(POINT).fits(LINES.find(l => l.id === id).text)).length;
  assert.ok(fitN(steered) >= fitN(plain) && fitN(steered) >= 2, `${fitN(steered)} of ${steered.ids.length} serve the point (was ${fitN(plain)})`);
  assert.ok(Object.values(steered.reasons).some(r => r.endsWith(PT.FITS + '.')), JSON.stringify(steered.reasons));
  assert.ok(!Object.values(plain.reasons).some(r => r.includes(PT.FITS)));
});
await t('clips and the full edit: the point moves the picks, marks them, and reaches the model prompt', () => {
  const o = { ...CUT.defaultOutput(), kind: 'both', clips: 3, length: 'short', clipLength: 'short', auto: false };
  const plain = CUT.candidates(WORDS, o), steered = CUT.candidates(WORDS, o, { point: POINT });
  assert.ok(plain.every(c => !c.fits)); assert.ok(steered.some(c => c.fits), 'a clip that fits');
  const avg = L => L.filter(c => c.kind === 'clip').reduce((a, c) => a + c.score, 0);
  assert.ok(avg(steered) >= avg(plain), 'clip scores do not fall');
  const pr = CUT.scorePrompt(steered, o, POINT); assert.ok(pr.includes(POINT) && /Prefer the parts that serve it/.test(pr));
  assert.ok(!CUT.scorePrompt(steered, o, '').includes('point of this video'));
});
await t('topics: 3 to 5 themes of two or more words; the old single word chips are gone', () => {
  const themes = TP.themesOf(LINES), labels = themes.map(x => x.label);
  assert.ok(labels.length >= 3 && labels.length <= 5, labels.join(' | '));
  for (const l of labels) { assert.ok(l.split(' ').length >= 2, 'multiword: ' + l); assert.ok(!OLD_BAD.includes(l.toLowerCase()), 'old chip: ' + l); }
  assert.ok(labels.includes('starting with ChatGPT') && labels.includes('building with AI'), labels.join(' | '));
  for (const th of themes) assert.ok(th.lines.length >= 2, `${th.label} is in ${th.lines.length} line`);
  const first = l => W.tokens(l)[0], last = l => W.tokens(l).slice(-1)[0];
  for (const l of labels) assert.ok(!first(l).stop && !last(l).stop, 'a theme starts and ends on a real word: ' + l);
  assert.strictEqual(new Set(labels.map(l => l.toLowerCase())).size, labels.length);
  // near duplicates merge: no two themes share all their content words or nearly all their lines
  for (const a of themes) for (const b of themes) if (a !== b) assert.ok(a.lines.filter(x => b.lines.includes(x)).length / Math.min(a.lines.length, b.lines.length) < 0.75, `${a.label} and ${b.label} are the same lines`);
  assert.deepStrictEqual(P.topicsOf(LINES), labels, 'pieces.mjs gives the same themes');
});
await t('topics: clicking one filters the lines; each line lists the themes it is in', () => {
  const b = P.build(LINES), th = TP.themesOf(LINES)[0];
  const got = b.pieces.filter(p => p.topics.includes(th.label)).map(p => p.id); assert.deepStrictEqual(got, th.lines);
  assert.ok(got.length < LINES.length, 'a theme is not every line');
});
await t('topics: nothing good comes out, so there is no row', () => {
  const list = ['Every effect in this reel lands the second I say its name,', 'rabbit hole,', 'spotlight,', 'backdrop,', 'orbit,', 'LED sign,', 'dot reveal,', 'You film it.', 'Claude edits it.'].map((text, i) => ({ id: 'l' + (i + 1), n: i + 1, text }));
  assert.deepStrictEqual(TP.themesOf(list), []); assert.deepStrictEqual(P.build(list).topics, []);
  assert.deepStrictEqual(TP.themesOf(LINES.slice(0, 2)), [], 'two lines are too few');
});
await t('topics from a model or an agent: checked, cut to 5, bad ones dropped, and they filter the same way', () => {
  const reply = 'Sure: {"topics":[{"label":"starting with ChatGPT","lines":[1,6,24]},{"label":"AI","lines":[4]},{"label":"your first working app","lines":[5,20,25,999]},{"label":"an em dash — here","lines":[2]},{"label":"no lines","lines":[]}]}';
  const list = TP.readTopics(reply, LINES); assert.deepStrictEqual(list.map(x => x.label), ['starting with ChatGPT', 'your first working app', 'an em dash , here']);
  assert.deepStrictEqual(list[1].lines, ['l5', 'l20', 'l25'], 'a line that does not exist is dropped');
  assert.strictEqual(TP.readTopics('not json', LINES), null); assert.strictEqual(TP.readTopics({ topics: [{ label: 'one theme only', lines: [1] }] }, LINES), null, 'fewer than two is nothing');
  const b = P.build(LINES, { topics: list }); assert.deepStrictEqual(b.topics, list.map(x => x.label)); assert.deepStrictEqual(b.pieces.find(p => p.id === 'l6').topics, ['starting with ChatGPT']);
  const pr = TP.topicsPrompt(LINES, POINT); assert.ok(pr.includes(POINT) && /2 to 4 plain words/.test(pr) && !pr.includes('—'));
});
await t('pacing: three choices, read from the flags the draft gets', () => {
  assert.deepStrictEqual(PACE.PACING.map(p => p.id), ['natural', 'tight', 'very']);
  assert.strictEqual(PACE.pacingOf(['--export', 'reels']).id, 'natural'); assert.strictEqual(PACE.pacingOf(['--no-tighten']).id, 'natural');
  assert.strictEqual(PACE.pacingOf(['--tighten', '0.45']).id, 'tight'); assert.strictEqual(PACE.pacingOf(['--tighten', '0.25']).id, 'very'); assert.strictEqual(PACE.pacingOf(['--tighten', '0.3']).id, 'very');
  assert.deepStrictEqual(PACE.pacePatch('very'), { pace: { tighten: 0.25 } }); assert.deepStrictEqual(PACE.pacePatch('natural'), { pace: { tighten: 'off' } });
  for (const p of PACE.PACING) assert.ok(p.says && !p.says.includes('—'));
});
await t('pacing: the stitched spans only lose quiet; no edge is inside a word, and no word is lost', () => {
  // four words: a 1.4 s pause after the second, a 0.5 s pause after the third
  const voiced = [[0.5, 0.9], [1.0, 1.5], [2.9, 3.4], [3.9, 4.5]], words = voiced.map(([a, b], i) => [a, b, 'w' + i]);
  const env = CP.envelopeFromSamples(speech(5.5, { voiced })), range = [[0.3, 4.8]];
  const nat = PACE.playSpans(range, words, env, null, 5.5), tight = PACE.playSpans(range, words, env, 0.45, 5.5), very = PACE.playSpans(range, words, env, 0.25, 5.5);
  assert.deepStrictEqual(nat.spans, range); assert.strictEqual(nat.saved, 0);
  assert.ok(tight.spans.length >= 2 && tight.saved > 0.8, JSON.stringify(tight));
  assert.ok(very.spans.length >= tight.spans.length && very.saved >= tight.saved, JSON.stringify(very));
  for (const r of [tight, very]) {
    for (const [a, b] of r.spans) for (const edge of [a, b]) assert.ok(!voiced.some(([x, y]) => edge > x + 0.001 && edge < y - 0.001), `edge ${edge} is inside a word`);
    for (const [x, y] of voiced) assert.ok(r.spans.some(([a, b]) => a <= x && b >= y), `the word at ${x} is whole in one span`);
    assert.ok(Math.abs(r.seconds + r.saved - 4.5) < 0.02, 'what plays plus what went is the clip');
  }
  assert.deepStrictEqual(PACE.playSpans(range, words, null, 0.25, 5.5).spans, range, 'no audio read yet: nothing is trimmed');
});
await t('the session: the point is saved, sent to your agent, and cleared when new footage starts a fresh edit', () => {
  const s = C.defaultState(); assert.strictEqual(s.point, '');
  assert.deepStrictEqual(C.applyPatch(s, { point: '  ' + POINT + '  ' }).errs, []); assert.strictEqual(s.point, POINT);
  assert.strictEqual(CH.context(s).point, POINT, 'the chat context your agent reads');
  assert.ok(Object.keys(C.videoSession(s)).includes('point'), 'saved with the video');
  C.resetEdit(s); assert.strictEqual(s.point, '', 'a fresh edit has no point');
  C.applyPatch(s, { point: POINT }); C.freshSession(s, { job: 'next', keepLook: true }); assert.strictEqual(s.point, '', 'a new video has no point, even with Keep my look');
  C.applyPatch(s, { point: POINT }); C.applyPatch(s, { point: '' }); assert.strictEqual(s.point, '');
});

// ---------- the server ----------
const rel = `inbox/studio/${JOB}/take.mp4`;
mkdirSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true }); writeFileSync(join(ROOT, rel), 'not a real video');
mkdirSync(dirname(MEDIA.txFile(rel)), { recursive: true });
writeFileSync(MEDIA.txFile(rel), JSON.stringify({ file: rel, duration: WORDS[WORDS.length - 1][1] + 0.5, total: 1, done: [0], aligned: { shift: 0, n: 0 }, words: WORDS }));
writeFileSync(join(STATE, 'studio', 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, footage: [rel] }));
const env = { ...process.env, CI: '1', STUDIO_DIR: join(STATE, 'studio'), STUDIO_CHAT: 'keywords', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome'), STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; };
try {
  await t('server: the lines come with topics and our best picks; a point marks the lines that fit', async () => {
    const p0 = await req('/api/pieces'); assert.strictEqual(p0.status, 200, JSON.stringify(p0).slice(0, 200));
    assert.ok(p0.topics.length >= 3 && p0.topics.every(x => x.split(' ').length >= 2 && !OLD_BAD.includes(x)), p0.topics.join(' | ')); assert.strictEqual(p0.topicsBy, 'rules');
    assert.ok(p0.best.ids.length >= 2 && p0.best.ids.every(id => p0.best.reasons[id])); assert.ok(p0.pieces.every(x => !x.fits));
    const r = await req('/api/state', { point: POINT }); assert.strictEqual(r.status, 200); assert.strictEqual(r.state.point, POINT); assert.strictEqual(r.cut.point, POINT);
    assert.ok(r.pieces.pieces.filter(x => x.fits).length >= 3); assert.strictEqual(r.pieces.point, POINT);
    assert.strictEqual((await req('/api/edit')).point, POINT, 'get_edit reads it'); assert.strictEqual((await req('/api/cut')).point, POINT, 'get_cuts reads it');
    const ch = await req('/api/pieces', { choose: true }); assert.match(ch.note, /^Picked \d+ lines, \d+ s, for your clip/); assert.ok(Object.values(ch.pieces.combo.reasons).some(x => x.includes(PT.FITS)));
    assert.match(ch.edit.from.text, /^\d+ lines?, /, 'Your edit says lines: ' + ch.edit.from.text);
  });
  await t('server: a new point finds the suggested clips again and keeps what you dropped', async () => {
    await req('/api/pieces', { clear: true }); await req('/api/state', { point: '' });
    const f = await req('/api/cut/find', { scorer: 'rules' }); assert.ok(f.cut.candidates.length >= 1 && f.cut.candidates.every(c => !c.fits));
    const id = f.cut.candidates[0].id; await req('/api/cut/edit', { id, keep: false });
    const r = await req('/api/state', { point: POINT });
    assert.ok(r.cut.candidates.some(c => c.fits), 'the clips were found again with the point'); assert.strictEqual(r.cut.candidates.find(c => c.id === id).keep, false, 'a dropped clip stays dropped');
    assert.match(r.edit.from.text, /clip|whole take/);
  });
  await t('server: the stitched previews, your own clip you can untick, and pacing from the state', async () => {
    await req('/api/pieces', { choose: true });
    const pv = await req('/api/cut/preview'); assert.strictEqual(pv.pacing, 'natural'); assert.deepStrictEqual(pv.options.map(o => o.id), ['natural', 'tight', 'very']);
    assert.ok(pv.clips.own && pv.clips.own.spans.length >= 1 && pv.clips.own.seconds > 0); assert.ok(Object.keys(pv.clips).length >= 2, 'your clip and the suggested ones');
    const on = await req('/api/edit'); assert.ok(on.combo.pieces.every(x => x.kind === 'piece'), 'your own clip moves on');
    const off = await req('/api/pieces', { off: true }); assert.strictEqual(off.pieces.combo.off, true); assert.ok(off.combo.pieces.every(x => x.kind !== 'piece'), 'unticked: the kept suggested clips move on');
    const back = await req('/api/pieces', { off: false }); assert.strictEqual(back.pieces.combo.off, false);
    const v = await req('/api/state', { pace: { tighten: 0.25 } }); assert.strictEqual(v.cut.pacing, 'very'); assert.strictEqual((await req('/api/cut/preview')).pacing, 'very');
    const nat = await req('/api/state', { pace: { tighten: 'off' } }); assert.strictEqual(nat.cut.pacing, 'natural');
  });
  await t('server: an agent names the themes; a bad list is refused; an empty list goes back to our own', async () => {
    const r = await req('/api/pieces', { by: 'claude-code', topics: [{ label: 'starting with ChatGPT', lines: [1, 6] }, { label: 'your first working app', lines: [5, 20] }] });
    assert.strictEqual(r.status, 200, JSON.stringify(r).slice(0, 200)); assert.deepStrictEqual(r.pieces.topics, ['starting with ChatGPT', 'your first working app']); assert.strictEqual(r.pieces.topicsBy, 'Claude Code');
    assert.strictEqual((await req('/api/pieces', { topics: [{ label: 'help', lines: [1] }] })).status, 400);
    const back = await req('/api/pieces', { topics: [] }); assert.strictEqual(back.pieces.topicsBy, 'rules');
  });
  await t('MCP: the point, topics and pacing are in the tools agents already have (no new tool)', async () => {
    const src = readFileSync(join(ROOT, 'kit', 'mcp.mjs'), 'utf8');
    const tool = name => { const i = src.indexOf(`{ name: '${name}'`); assert.ok(i > 0, name); return src.slice(i, src.indexOf('\n  { name:', i + 10)); };
    assert.match(tool('studio_set_selections'), /point: \{ type: 'string'/); assert.match(tool('get_pieces'), /point: j\.point/); assert.match(tool('get_pieces'), /best: j\.best/);
    assert.match(tool('set_combo'), /topics: \{ type: 'array'/); assert.match(tool('get_cuts'), /point \(/); assert.match(tool('get_edit'), /point \(/);
  });
} finally { srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); }
console.log(`studio-point: ${n} passed`);
