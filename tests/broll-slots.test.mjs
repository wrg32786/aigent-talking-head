// B-roll slots (1.28.0), with no Chrome, no keys and no network:
// - detection: a speaker shot (a face on screen, the speaker's size and place) is never a cutaway, a shot with no
//   face is; the teardown's panels merge when they touch, keep their kind and effects, and round-trip through the
//   Reel.md B-roll block; an older recipe gives slots from its screen cards and cutaway shots
// - the planner keeps slots with no assets: Recreate maps the reference's moments onto your words (never inside a
//   word, a full cutaway off the hook), Copy the look lands the same number a minute on your lines; the effects are
//   carried into plan.json; a panel is moved under the chin
// - Studio: a plan slot is a spot with a need (what it should show, the instruction for an agent), no stock without
//   a key, Skip and back, a clip placed on it sits as a panel, and the render step keeps the slot's state in plan.json
// Run: node tests/broll-slots.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BS = require('../kit/broll-slots.cjs'), SPL = require('../kit/shotplan.cjs'), RM = require('../kit/reelmd.cjs'), RC = require('../kit/recreate.cjs'), SL = require('../kit/stylelook.cjs'), R = require('../kit/rules.cjs');
const STATE = mkdtempSync(join(tmpdir(), 'broll-slots-test-')), LIB = join(STATE, 'lib'), JOB = 'broll-slots-test-' + process.pid;
process.env.STUDIO_DIR = join(STATE, 'studio'); process.env.STUDIO_BROLL_LIBRARY = LIB;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const NO_DASH = s => assert.ok(!/—/.test(String(s)), 'no em dash: ' + s);

// your words: 12 lines of 2 s
const LINES = ['Editing ate my weekends.', 'I tried every app.', 'Then I found one prompt.', 'It plans the whole edit.', 'Here is how to set it up.', 'Open the dashboard.', 'Type your topic.', 'And press go.', 'Leads went up 312 percent.', 'In three months.', 'Follow the repo for more.', 'Tell me how it went.'];
const WORDS = LINES.flatMap((l, k) => { const ws = l.split(' '), d = 1.6 / ws.length; return ws.map((w, i) => ({ start: +(k * 2 + 0.1 + i * d).toFixed(3), end: +(k * 2 + 0.1 + (i + 1) * d - 0.03).toFixed(3), word: w })); });
const LEN = 24;
const MD = (extra = []) => ['---', 'videomd: 1', 'name: ref', 'source:', '  file: ref.mp4', '  duration: 48', 'x-reel: 1', '---', '', '# Ref', '', '## Style', '- captions: one-word', '',
  '## Shots', '', '```videomd-timeline', '#01 0-10 | framing close-up', '#02 10-14 | framing close-up | cutaway on | broll a city street at night', '#03 14-48 | framing close-up', '```', '',
  '## Graphics', '', '```reel-graphics', '#01 20-26 | type screen-card | border #d87b5b | y 0.68 | w 0.62 | subject~ Dashboard', '```', '', ...extra,
  '## Script', '', '```reel-script', '#01 20-25 | say Open the dashboard and look', '```', ''].join('\n');

try {
  await t('detection: a speaker shot is not a cutaway, a shot with no face is (the live reference bug)', () => {
    const face = (h, cy) => ({ aspects: { framing: { measured: { face_h: h, center_y: cy, center_x: 0.5 } } } });
    const shots = [{ talk_share: 1, faces: 1, ...face(0.16, 0.34) }, { talk_share: 0.9, faces: 1, ...face(0.17, 0.33) }, { talk_share: 0.8, faces: 1, ...face(0.16, 0.34) }];
    const sp = SPL.speakerOf(shots); assert.ok(sp && Math.abs(sp.faceH - 0.16) < 0.011);
    assert.strictEqual(SPL.isCutaway({ talk_share: 0, faces: 1, ...face(0.17, 0.34) }, sp), false, 'the speaker, quiet for a moment');
    assert.strictEqual(SPL.isCutaway({ talk_share: 0.1, faces: 1, ...face(0.4, 0.6) }, sp), true, 'someone else, filling the frame');
    assert.strictEqual(SPL.isCutaway({ talk_share: 0, faces: 0 }, sp), true, 'no face at all');
    assert.strictEqual(SPL.isCutaway({ talk_share: 0.2, faces: 1 }), true, 'with no speaker known, the old rule');
  });
  await t('detection: panels that touch are one slot, kinds from the box, the effects kept, a panel the head reaches into is behind', () => {
    assert.deepStrictEqual([BS.kindOf(null), BS.kindOf([0.19, 0.57, 0.62, 0.21]), BS.kindOf([0, 0, 1, 0.5]), BS.kindOf([0.62, 0.05, 0.34, 0.2])], ['full', 'panel', 'split', 'pip']);
    const cands = [{ start: 3.5, end: 11, box: [0.19, 0.57, 0.62, 0.21], border: '#D87B5B', shows: 'OmniRoute', shot: 'screen recording' }, { start: 15.75, end: 17.75, box: [0.19, 0.57, 0.62, 0.21], shows: 'Ouediun·/effo' },
      { start: 30, end: 33, kind: 'full', shows: 'a city street' }, { start: 40, end: 44, box: [0, 0, 1, 0.5] }];
    const meas = [{ motion: 'push', zoom: 1.22, in: 'pop', out: 'slide-up', at: [3.33, 15.92] }, { motion: 'still', in: 'slide-down', out: 'fade', at: [15.38, 17.79] }, { motion: 'drift', colour: 'bw', shake: true, glitch: true, in: 'flash', out: 'cut' }, {}];
    const s = BS.detect(cands, meas, { faces: [{ start: 38, end: 46, eyeY: 0.6, faceH: 0.16 }], script: [{ start: 4, end: 9, say: 'It gives you more' }] });
    assert.deepStrictEqual(s.map(x => [x.kind, x.start, x.end]), [['panel', 3.33, 17.79], ['full', 30, 33], ['split', 40, 44]]);
    assert.deepStrictEqual(s[0].fx, { motion: 'push', zoom: 1.22, shake: false, glitch: false, colour: 'none', in: 'pop', out: 'fade' }, 'arrives like the first part, leaves like the last');
    assert.strictEqual(s[0].shows, 'OmniRoute', 'misread text is not a name'); assert.strictEqual(s[0].border, '#d87b5b'); assert.strictEqual(s[0].says, 'It gives you more');
    assert.deepStrictEqual([s[1].fx.colour, s[1].fx.shake, s[1].fx.glitch, s[1].fx.in], ['bw', true, true, 'flash']);
    assert.strictEqual(s[2].layer, 'behind'); assert.strictEqual(s[0].layer, 'front');
  });
  await t('the Reel.md B-roll block: written, read back the same, written once', () => {
    const slots = BS.detect([{ start: 20, end: 26, box: [0.19, 0.57, 0.62, 0.21], border: '#d87b5b', shows: 'Dashboard', shot: 'screen recording' }], [{ motion: 'push', zoom: 1.1, in: 'pop', out: 'fade' }]);
    const md = BS.appendBlock(BS.appendBlock(MD(), slots), slots); assert.strictEqual(md.match(/```reel-broll/g).length, 1); NO_DASH(md);
    assert.ok(md.indexOf('## B-roll') < md.indexOf('## Script'));
    const r = RM.parse(md, 'Reel.md'); assert.strictEqual(r.broll.length, 1);
    const back = BS.fromRecipe(r); assert.deepStrictEqual([back[0].kind, back[0].start, back[0].end, back[0].shows, back[0].border, back[0].fx.motion, back[0].fx.zoom, back[0].fx.in], ['panel', 20, 26, 'Dashboard', '#d87b5b', 'push', 1.1, 'pop']);
  });
  await t('an older recipe (no B-roll block): its screen cards and cutaway shots are the slots', () => {
    const r = RM.parse(MD(), 'Reel.md'), s = BS.fromRecipe(r);
    assert.deepStrictEqual(s.map(x => [x.kind, x.start, x.end]), [['full', 10, 14], ['panel', 20, 26]]);
    assert.ok(/city street/.test(s[0].shows) && s[1].shows === 'Dashboard'); assert.ok(BS.ownsCard(s, r.graphics[0]));
  });
  let PLAN;
  await t('planner, Recreate: every slot is kept with no assets, at the reference moments on your words, effects carried', () => {
    const md = BS.appendBlock(MD(), BS.detect([{ start: 1, end: 5, kind: 'full', shows: 'a city street' }, { start: 20, end: 26, box: [0.19, 0.57, 0.62, 0.21], border: '#d87b5b', shows: 'Dashboard', shot: 'screen recording' }, { start: 44, end: 47.9, kind: 'full' }],
      [{ motion: 'pull', zoom: 0.92, colour: 'bw', shake: true, in: 'flash', out: 'fade' }, { motion: 'push', zoom: 1.15, glitch: true, in: 'pop', out: 'slide-down' }, {}]));
    const ref = BS.fromRecipe(RM.parse(md, 'Reel.md')), log = [];
    const s = BS.forRecreate(ref, { k: 0.5, len: LEN, words: WORDS, refLen: 48, log: m => log.push(m) });
    assert.strictEqual(s.length, 3, 'no slot is dropped for having no clip'); assert.ok(s.every(x => x.state === 'needs' && !x.file));
    assert.deepStrictEqual(s.map(x => x.n), [1, 2, 3]); assert.deepStrictEqual(s.map(x => x.ref.n), [1, 2, 3]);
    // the panel: 20 to 26 s of 48 is 10 to 13 s of 24, on a word start and a word end
    const p = s[1]; assert.ok(Math.abs(p.start - 10) < 0.7 && Math.abs(p.end - 13) < 0.7, JSON.stringify(p));
    assert.ok(WORDS.some(w => Math.abs(w.start - 0.08 - p.start) < 0.002), 'starts on a word'); assert.ok(WORDS.some(w => Math.abs(w.end - p.end) < 0.002), 'ends on a word');
    assert.ok(/Open the dashboard/.test(p.line), p.line);
    assert.deepStrictEqual(p.fx, { motion: 'push', zoom: 1.15, shake: false, glitch: true, colour: 'none', in: 'pop', out: 'slide-down' });
    assert.deepStrictEqual([s[0].fx.motion, s[0].fx.colour, s[0].fx.shake, s[0].fx.in], ['pull', 'bw', true, 'flash']);
    // the reference covered its own hook and its last line, so ours may too; one that did not stays off them
    assert.ok(s[0].start < 1.2 && s[2].end > 22);
    const shy = BS.forRecreate([{ ...ref[0], start: 2.6, end: 6 }], { k: 0.5, len: LEN, words: WORDS, refLen: 48 }); assert.ok(shy[0].start >= 1.2, 'a full cutaway stays off the hook');
    // plan.json carries them
    PLAN = RC.planOf({ recipe: { file: 'Reel.md' }, cut: { segs: [{ in: 0, out: LEN }] }, broll: s });
    assert.strictEqual(PLAN.broll.length, 3); assert.strictEqual(PLAN.broll[1].fx.zoom, 1.15);
    const out = BS.forRecreate(ref, { k: 0.1, len: 4.8, words: WORDS.filter(w => w.end < 4.8), refLen: 48, log: m => log.push(m) });
    assert.ok(out.length < 3 && log.some(m => /no room/.test(m)), 'a slot with no room is said, not silent');
  });
  await t('planner, Copy the look: the same number a minute and the same kinds, on your lines that fit', () => {
    const ref = BS.fromRecipe(RM.parse(MD(), 'Reel.md')), sum = BS.lookSummary(ref, 48);
    assert.deepStrictEqual([sum.perMin, sum.kinds], [2.5, { full: 1, panel: 1 }]); assert.strictEqual(sum.slots.length, 2); assert.ok(sum.share > 0.2);
    const s = BS.forLook(sum, { len: LEN, words: WORDS });
    assert.strictEqual(s.length, 1, '2.5 a minute on 24 s'); assert.ok(s[0].state === 'needs' && !s[0].ref && !s[0].what);
    const many = BS.forLook({ ...sum, perMin: 10 }, { len: LEN, words: WORDS });
    assert.ok(many.length >= 3, 'more a minute, more slots: ' + many.length); assert.ok(new Set(many.map(x => x.kind)).size === 2, 'the kinds of the reference, in turn');
    for (const x of many) { assert.ok(x.start >= 1.2, 'never on the hook'); assert.ok(WORDS.some(w => Math.abs(w.start - 0.08 - x.start) < 0.002) || x.kind === 'full', 'on a line of yours'); assert.ok(x.line.length > 3); }
    for (let k = 1; k < many.length; k++) assert.ok(many[k].start >= many[k - 1].end, 'no two overlap');
    assert.ok(many.some(x => /312|dashboard/i.test(x.line)), 'a number or a thing named first: ' + many.map(x => x.line).join(' | '));
    assert.deepStrictEqual(BS.forLook({ perMin: 0, slots: [] }, { len: LEN, words: WORDS }), [], 'a look with no B-roll adds none');
  });
  await t('drawing: a panel is a screen card with the slot effects, a full slot an insert; a panel never sits on the face', () => {
    const p = PLAN.broll[1], f = BS.flipOf(p);
    assert.deepStrictEqual([f.mode, f.slot, f.enter, f.exit, f.glitch, f.border, !!f.need, f.src], [11, 2, 'pop', 'slide-down', true, '#d87b5b', true, undefined]); assert.ok(/^1 \.5 \.5; 1\.15/.test(f.cam));
    const g = BS.flipOf({ ...p, file: '/x/clip.mp4' }); assert.strictEqual(g.src, '/x/clip.mp4'); assert.strictEqual(g.need, undefined);
    assert.strictEqual(BS.insertOf(PLAN.broll[0]), null, 'no clip, no insert');
    const ins = BS.insertOf({ ...PLAN.broll[0], file: '/x/a.mp4' }); assert.deepStrictEqual([ins.place, ins.fx.colour, ins.fx.in, ins.slot], ['full', 'bw', 'flash', 1]);
    // the face runs down to 1400 px (of 1920) over the slot: the panel moves under the chin
    const fz = { fps: 8, zones: Array.from({ length: 200 }, () => [300, 900, 780, 1400, 820]) }, fl = [{ ...f }];
    assert.strictEqual(BS.clearFaces(fl, fz), 1); const h = Math.min(0.42, fl[0].w * 1080 * 0.6 / 1920 + 0.045); assert.ok(fl[0].y - h / 2 >= 1400 / 1920, 'top edge under the chin: ' + JSON.stringify(fl[0]));
    assert.strictEqual(BS.clearFaces([{ ...f }], { fps: 8, zones: Array.from({ length: 200 }, () => [300, 300, 780, 800, 220]) }), 0, 'already clear');
  });
  await t('what a slot needs, in plain words, and the instruction for an agent', () => {
    const b = BS.brief(PLAN.broll[1]); assert.strictEqual(b.what, 'a screen recording (the reference showed Dashboard)'); assert.ok(/framed panel/.test(b.shape) && /slow push in/.test(b.treat) && /glitch/.test(b.treat)); assert.strictEqual(b.frame, 'wide 16:9');
    assert.strictEqual(BS.brief({ ...PLAN.broll[1], ref: null }).what, 'a screen recording of Dashboard');
    assert.ok(/that fits "Open the dashboard/.test(BS.brief({ ...PLAN.broll[1], what: null }).what));
    const ask = BS.agentAsk(PLAN.broll[1], { job: 'my-reel', spot: 4 }); NO_DASH(ask);
    assert.ok(/slot 2/.test(ask) && /spot 4/.test(ask) && /Open the dashboard/.test(ask) && /wide 16:9/.test(ask) && /allowed to show/.test(ask) && /add_broll on beat 4/.test(ask), ask);
    assert.ok(!/npm |node |\$ /.test(ask), 'no terminal command');
  });

  // ---------- Studio ----------
  const flips = LINES.map((l, k) => ({ start: +(k * 2 + 0.1).toFixed(2), end: +(k * 2 + 1.8).toFixed(2), text: l }));
  const CUT = { segs: [{ file: 'x.mp4', in: 0, out: 24 }] }, jobDir = join(ROOT, 'jobs', JOB), build = join(jobDir, 'build'); mkdirSync(build, { recursive: true });
  const slots = BS.forRecreate(BS.fromRecipe(RM.parse(BS.appendBlock(MD(), BS.detect([{ start: 20, end: 26, box: [0.19, 0.57, 0.62, 0.21], border: '#d87b5b', shows: 'Dashboard', shot: 'screen recording' }, { start: 34, end: 38, box: [0.19, 0.57, 0.62, 0.21], shows: 'Leads' }, { start: 42, end: 45, kind: 'full' }],
    [{ motion: 'push', zoom: 1.15, in: 'pop', out: 'fade' }, { in: 'pop', out: 'fade' }, { colour: 'bw', in: 'cut', out: 'cut' }])), 'Reel.md')), { k: 0.5, len: LEN, words: WORDS, refLen: 48 });
  writeFileSync(join(build, 'cut.json'), JSON.stringify(CUT));
  writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify({ flips: [...flips, ...slots.filter(x => x.kind === 'panel').map(BS.flipOf)] }) + ';\n');
  RC.writePlan(build, RC.planOf({ recipe: { file: 'Reel.md' }, cut: CUT, broll: slots }));
  const env = { ...process.env, CI: '1', STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome'), PEXELS_API_KEY: '', PIXABAY_API_KEY: '', STUDIO_BROLL_AUTO: '' };
  const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  let srvOut = '';
  const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
  const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };
  try {
    await req('/api/state', { job: JOB });
    let needs;
    await t('Studio: every plan slot is its own spot with a need; nothing is silently skipped', async () => {
      const v = (await req('/api/broll')).j; assert.ok(v.draft, 'the draft is read');
      needs = v.beats.filter(b => b.need); assert.strictEqual(needs.length, 3, JSON.stringify(v.beats.map(b => [b.n, b.start, !!b.need])));
      assert.deepStrictEqual(needs.map(b => b.need.slot), [1, 2, 3]);
      const a = needs[0].need; assert.strictEqual(a.what, 'a screen recording (the reference showed Dashboard)'); assert.ok(a.seconds > 2 && /framed panel/.test(a.shape) && /slow push in/.test(a.treat) && /Open the dashboard/.test(a.line));
      assert.strictEqual(a.stock, null, 'no key, no stock'); assert.ok(/slot 1/.test(a.ask) && new RegExp(`beat ${needs[0].n}\\b`).test(a.ask)); NO_DASH(JSON.stringify(v));
      assert.ok(Math.abs(needs[0].start - slots[0].start) < 0.45, 'the spot starts with the slot');
    });
    await t('Studio: Suggest makes no idea of an empty slot and puts nothing on top of one; the note counts what the step shows', async () => {
      const sg = await req('/api/broll/suggest', { all: true }); assert.strictEqual(sg.status, 200, sg.text);
      for (const b of sg.j.broll.beats) { if (b.need) assert.ok(!b.idea, 'a need is not an idea'); if (b.under) assert.ok(!b.idea, 'nothing on top of a slot'); }
      assert.strictEqual(sg.j.broll.beats.filter(b => b.need).length, 3);
    });
    await t('Studio: Skip keeps the slot and says so; Put it back; stock and send say what is missing', async () => {
      const sk = await req('/api/broll/need', { beat: needs[2].n, action: 'skip' }); assert.strictEqual(sk.status, 200, sk.text);
      assert.strictEqual(sk.j.broll.beats.find(b => b.n === needs[2].n).need.skipped, true);
      const st = await req('/api/broll/need', { beat: needs[0].n, action: 'stock' }); assert.strictEqual(st.status, 400); assert.ok(/key/.test(st.j.error) && /stays on this computer/.test(st.j.error));
      // Send to my agent: the ready instruction is queued for the agent on the Studio channel; with no agent backend it says so
      const sd = await req('/api/broll/need', { beat: needs[0].n, action: 'send' }); assert.strictEqual(sd.status, 200, sd.text);
      const msg = (await req('/api/state')).j.state.chat.find(m => m.attach && m.attach.kind === 'broll'); assert.ok(msg && msg.attach.slot === 1 && /Capture a screen recording/.test(msg.text), JSON.stringify(msg));
      await req('/api/settings', { chat: { backend: 'keywords' } });
      const s2 = await req('/api/broll/need', { beat: needs[0].n, action: 'send' }); assert.strictEqual(s2.status, 400); assert.ok(/Connect your agent/.test(s2.j.error));
      { const free = (await req('/api/broll')).j.beats.find(b => !b.ref); assert.strictEqual((await req('/api/broll/need', { beat: free.n, action: 'skip' })).status, 400, 'only a plan slot'); }
    });
    await t('Studio: a clip on a slot sits as a panel for the slot length; the render step draws it and keeps every slot state', async () => {
      const clip = join(STATE, 'screen.mp4');
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=8', '-pix_fmt', 'yuv420p', clip]);
      const up = await fetch(`${url}/api/broll/upload?name=screen.mp4&type=screen-recording&beat=${needs[0].n}`, { method: 'POST', body: readFileSync(clip) }); const uj = await up.json(); assert.strictEqual(up.status, 200, JSON.stringify(uj));
      const b = uj.broll.beats.find(x => x.n === needs[0].n); assert.ok(b.slot && !b.need, 'filled, the need is gone'); assert.strictEqual(b.slot.place, 'card');
      assert.ok(Math.abs(b.slot.at - slots[0].start) < 0.02 && Math.abs(b.slot.dur - (slots[0].end - slots[0].start)) < 0.05, JSON.stringify(b.slot));
      // what Render runs first (kit/studio/broll-run.mjs)
      const LANE = await import('../kit/studio/lane.mjs'), lib = JSON.parse(readFileSync(join(LIB, 'library.json'), 'utf8')).clips, byId = Object.fromEntries(lib.map(c => [c.id, c]));
      const ins = LANE.inserts({ [b.n]: b.slot && { clip: b.slot.clip.id, place: b.slot.place, offset: b.slot.offset, dur: b.slot.dur, in: 0 } }, uj.broll.beats, id => byId[id], c => join(LIB, c.file));
      assert.deepStrictEqual([ins[0].slot, ins[0].place, ins[0].fx.motion, ins[0].border], [1, 'card', 'push', '#d87b5b']);
      const pf = join(jobDir, 'broll.json'); writeFileSync(pf, JSON.stringify({ inserts: ins, credits: 'x', skipped: [3] }));
      const out = execFileSync(process.execPath, [join(ROOT, 'kit', 'studio', 'broll-run.mjs'), 'apply', '--name', JOB, '--plan', pf], { cwd: ROOT, encoding: 'utf8' });
      assert.ok(/1 slot still needs a clip/.test(out) && /you stay on screen there/.test(out), out);
      const caps = R.readCaptions(join(build, 'captions.js')), cards = caps.flips.filter(f => f.slot != null);
      assert.strictEqual(cards.length, 1, 'only the filled slot is drawn: a final reel never ships an empty card'); assert.ok(/screen/.test(cards[0].src) && cards[0].enter === 'pop' && cards[0].need === undefined && /1\.15/.test(cards[0].cam));
      assert.ok(!JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')).inserts, 'a panel is not a cut.json insert');
      assert.deepStrictEqual(RC.readPlan(build).broll.map(x => x.state), ['filled', 'needs', 'skipped']);
      // taking the clip off brings the need back
      const cl = await req('/api/broll/slot', { beat: b.n, clear: true }); assert.ok(cl.j.broll.beats.find(x => x.n === b.n).need, 'the slot needs a clip again');
    });
  } finally { srv.kill(); }
  console.log(`\nB-ROLL SLOTS PASS (${n} tests)`);
} finally { rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); }
