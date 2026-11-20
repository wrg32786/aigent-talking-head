// B-roll spots (1.13.0), with no Chrome, no keys and no network:
// - spots: a long take splits at caption ends into spots of about 7 s, short segments stay whole, your own spots
//   (marks) and the reference's b-roll parts split and tag the spot they land in; remap keeps a slot on its moment
// - what to show, from the words: a number is a counter card, "doubled" a 2x counter, a quote a quote card, else the
//   strongest nouns (no verbs like follow); the role (proof, tip, story) and the start on the word, never in the hook
// - the server: Suggest includes the first spot (after 1.2 s) and says why, one idea every 6 s unless all: true; your
//   uploads' kind (testimonial, screen recording) is kept and used; Approve with no key and no Chrome says how to fix
//   it (the Chrome fix button) instead of asking for a Pexels key; Add a spot; B-roll picks itself on and off; cut-ins
//   need a raw testimonial piece
// - MCP: pick_broll, add_spot and add_testimonial are listed with their inputs
// Run: node tests/studio-spots.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-spots-test-')), LIB = join(STATE, 'lib'), JOB = 'spots-test-' + process.pid;
process.env.STUDIO_DIR = join(STATE, 'studio'); process.env.STUDIO_BROLL_LIBRARY = LIB;
const LANE = await import('../kit/studio/lane.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

// a drafted job: one 24 s take and a short tail segment, with caption flips every 2 s
const flips = []; for (let k = 0; k < 12; k++) flips.push({ start: +(k * 2 + 0.1).toFixed(2), end: +(k * 2 + 1.8).toFixed(2), text: ['Editing ate my weekends', 'I tried every app', 'Then I found one prompt', 'that plans the whole edit', 'Here is how to set it up', 'open the dashboard', 'type your topic', 'and press go', 'Leads went up 312 percent', 'in three months', 'Follow the repo for more', 'and tell me how it went'][k] });
flips.push({ start: 24.2, end: 26.8, text: 'Revenue doubled' });
const CUT = { segs: [{ file: 'x.mp4', in: 0, out: 24 }, { file: 'x.mp4', in: 30, out: 33 }], tail: 0.3 }, CAPS = { flips };
const jobDir = join(ROOT, 'jobs', JOB); mkdirSync(join(jobDir, 'build'), { recursive: true });
writeFileSync(join(jobDir, 'build', 'cut.json'), JSON.stringify(CUT));
writeFileSync(join(jobDir, 'build', 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify(CAPS) + ';\n');

// no Chrome here on purpose (CHROME_PATH points nowhere), so the no-key, no-Chrome path is what Approve meets
const env = { ...process.env, CI: '1', STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome'), PEXELS_API_KEY: '', PIXABAY_API_KEY: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };

let client;
try {
  await t('spots: a 24 s take splits at caption ends into spots of 6 to 10 s; a short segment stays whole', async () => {
    const sp = LANE.spots(CUT, CAPS);
    assert.ok(sp.length >= 4, JSON.stringify(sp.map(x => [x.start, x.end])));
    for (const s of sp.slice(0, -1)) assert.ok(s.seconds <= LANE.SPOT_MAX + 0.01 && s.seconds >= 2.5, `spot ${s.n} is ${s.seconds} s`);
    assert.strictEqual(sp[0].start, 0); assert.strictEqual(sp[sp.length - 1].end, 27);
    for (let k = 1; k < sp.length; k++) assert.strictEqual(sp[k].start, sp[k - 1].end, 'spots touch');
    const inTake = sp.filter(s => s.seg === 1); assert.ok(inTake.every(s => flips.some(f => Math.abs(f.end - s.end) < 0.01) || s.end === 24), 'splits sit at a caption end');
    assert.strictEqual(sp[sp.length - 1].text, 'Revenue doubled'); assert.strictEqual(sp[sp.length - 1].seg, 2);
    assert.deepStrictEqual(LANE.beats(CUT, CAPS).map(b => b.n), [1, 2], 'beats() is unchanged');
  });
  await t('spots: Add a spot and the reference split and tag; remap keeps a slot on its moment', async () => {
    const before = LANE.spots(CUT, CAPS), after = LANE.spots(CUT, CAPS, { marks: [3.5], refs: [{ at: 20.5, label: 'B-roll', detail: 'screen-card' }] });
    assert.ok(after.length > before.length, 'more spots');
    const m = after.find(s => s.mark); assert.ok(m && Math.abs(m.start - 3.8) < 0.05, 'snapped to the caption end at 3.8: ' + JSON.stringify(m));
    const r = after.find(s => s.ref); assert.ok(r && r.ref.detail === 'screen-card' && r.start <= 20.5 && r.end > 20.5);
    const last = before[before.length - 1], moved = LANE.remap({ [last.n]: { clip: 'a', offset: 0.5, at: last.start + 0.5 } }, before, after);
    const k = Object.keys(moved).map(Number)[0]; assert.strictEqual(after.find(s => s.n === k).text, 'Revenue doubled'); assert.strictEqual(moved[k].offset, 0.5);
  });
  await t('what to show: numbers are counters, doubled is 2x, quotes are quote cards, else the strongest nouns', async () => {
    const a = LANE.pick({ text: 'Leads went up 312 percent in three months' }); assert.deepStrictEqual([a.role, a.card.kind, a.card.to, a.card.suffix], ['proof', 'counter', 312, '%']); assert.ok(/312 percent/.test(a.why));
    const b = LANE.pick({ text: 'Revenue doubled' }); assert.deepStrictEqual([b.card.to, b.card.suffix, b.query], [2, 'x', 'revenue doubled']);
    const q = LANE.pick({ text: 'My client told me this changed her whole business' }); assert.strictEqual(q.card.kind, 'quote'); assert.ok(/changed her whole business/.test(q.card.text));
    assert.strictEqual(LANE.nounQuery('Follow the repo for more filming tips'), 'repo tips', 'no verbs, no -ing words');
    assert.strictEqual(LANE.pick({ text: 'Here is how to set it up, open the dashboard' }).role, 'tip');
    assert.strictEqual(LANE.pick({ text: 'um so yeah' }), null);
    const sp = LANE.spots(CUT, CAPS);
    assert.ok(LANE.offsetFor(sp[0], 'editing', CAPS) >= 1.2, 'never in the first 1.2 s: the hook shows your face');
    const s312 = sp.find(s => /312/.test(s.text)), o = LANE.offsetFor(s312, '312', CAPS); assert.ok(Math.abs(s312.start + o - 15.999) < 0.2, 'starts on the word: ' + (s312.start + o));
  });
  await t('server: Suggest includes the first spot, says why and keeps one idea every 6 s (all: true for every spot)', async () => {
    assert.strictEqual((await req('/api/state', { job: JOB })).status, 200);
    const v = await req('/api/broll'); assert.strictEqual(v.j.draft, true); assert.strictEqual(v.j.beats.length, LANE.spots(CUT, CAPS).length); assert.strictEqual(v.j.length, 27);
    assert.strictEqual(v.j.auto, true, 'B-roll picks itself is on by default'); assert.strictEqual(v.j.card, false, 'no Chrome here');
    const sg = await req('/api/broll/suggest', {}); assert.strictEqual(sg.status, 200, sg.text);
    const ideas = sg.j.broll.beats.filter(b => b.idea); assert.ok(ideas.length >= 2 && ideas[0].n === 1, 'the first spot: ' + JSON.stringify(ideas.map(b => b.n)));
    assert.ok(ideas[0].idea.offset >= 1.2 && ideas[0].idea.why, JSON.stringify(ideas[0].idea));
    const at = ideas.map(b => b.start + b.idea.offset); for (let k = 1; k < at.length; k++) assert.ok(at[k] - at[k - 1] >= 6, 'about one every 6 s: ' + at.join(', '));
    const all = await req('/api/broll/suggest', { all: true }); assert.ok(all.j.broll.beats.filter(b => b.idea).length > ideas.length);
    const proof = all.j.broll.beats.find(b => /312/.test(b.text)); assert.strictEqual(proof.idea.card.kind, 'counter'); assert.strictEqual(proof.idea.role, 'proof');
  });
  await t('server: an upload keeps its kind; Suggest puts your screen recording on a tip spot as a split', async () => {
    for (const b of (await req('/api/broll')).j.beats) await req('/api/broll/idea', { beat: b.n, action: 'dismiss' });
    const up = await fetch(url + '/api/broll/upload?name=setup%20walkthrough.mp4&type=screen-recording', { method: 'POST', body: Buffer.alloc(2048) }); const uj = await up.json(); assert.strictEqual(up.status, 200, JSON.stringify(uj));
    assert.strictEqual(uj.clip.type, 'screen-recording'); assert.ok(uj.clip.tags.includes('screen-recording'));
    assert.strictEqual((await fetch(url + '/api/broll/upload?name=x.mp4&type=nope', { method: 'POST', body: Buffer.alloc(16) }).then(r => r.json())).clip.type, null, 'an unknown kind is dropped');
    const sg = await req('/api/broll/suggest', { all: true }), tip = sg.j.broll.beats.find(b => b.idea && b.idea.clip && b.idea.clip.id === uj.clip.id);
    assert.ok(tip && tip.idea.role === 'tip', JSON.stringify(sg.j.broll.beats.map(b => b.idea))); assert.strictEqual(tip.idea.place, 'top'); assert.ok(/prompt|set it up|dashboard/.test(tip.text));
    assert.strictEqual(sg.j.broll.beats.filter(b => b.idea && b.idea.clip && b.idea.clip.id === uj.clip.id).length, 1, 'one clip, one spot');
    for (const b of sg.j.broll.beats) await req('/api/broll/idea', { beat: b.n, action: 'dismiss' });
  });
  await t('server: Approve with no key and no Chrome says what fixes it (the Chrome fix button), not "add a Pexels key"', async () => {
    await req('/api/broll/ideas', { ideas: [{ beat: 1, idea: 'A dark desk', query: 'dark desk nothing' }] });
    const ap = await req('/api/broll/idea', { beat: 1, action: 'approve' }); assert.strictEqual(ap.status, 400);
    assert.ok(/Install Chrome/.test(ap.j.error) && /fill the spot by hand/.test(ap.j.error), ap.j.error); assert.deepStrictEqual(ap.j.fix, ['chrome']);
    await req('/api/broll/idea', { beat: 1, action: 'dismiss' });
  });
  await t('server: Add a spot splits the spot and keeps slots on their words; remove takes it out', async () => {
    const lib = (await req('/api/broll/library?q=walkthrough')).j.clips; const last = (await req('/api/broll')).j.beats.slice(-1)[0];
    await req('/api/broll/slot', { beat: last.n, clip: lib[0].id, offset: 0.5 });
    const n0 = (await req('/api/broll')).j.beats.length, add = await req('/api/broll/spot', { at: 3.5 }); assert.strictEqual(add.status, 200, add.text);
    assert.strictEqual(add.j.broll.beats.length, n0 + 1); const moved = add.j.broll.beats.find(b => b.slot); assert.strictEqual(moved.text, 'Revenue doubled'); assert.strictEqual(moved.slot.offset, 0.5);
    assert.ok(add.j.broll.beats.some(b => b.mark));
    assert.strictEqual((await req('/api/broll/spot', { at: 99 })).status, 400);
    const rm = await req('/api/broll/spot', { at: 3.8, remove: true }); assert.strictEqual(rm.j.broll.beats.length, n0);
  });
  await t('server: B-roll picks itself turns off and on; a cut-in needs a raw testimonial piece', async () => {
    assert.strictEqual((await req('/api/broll/auto', { on: false })).j.broll.auto, false); assert.strictEqual((await req('/api/broll/auto', { on: true })).j.broll.auto, true);
    assert.strictEqual((await req('/api/broll/auto', { on: 'yes' })).status, 400);
    const lib = (await req('/api/broll/library?q=walkthrough')).j.clips; assert.strictEqual((await req('/api/broll/cutin', { clip: lib[0].id })).status, 404);
  });
  await t('MCP: pick_broll, add_spot and add_testimonial are listed with their inputs; add_broll takes type and raw', async () => {
    client = new Client({ name: 'spots-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_PORT: url.split(':').pop() } }));
    const by = Object.fromEntries((await client.listTools()).tools.map(x => [x.name, x]));
    for (const k of ['pick_broll', 'add_spot', 'add_testimonial']) assert.ok(by[k], k);
    assert.deepStrictEqual(by.add_spot.inputSchema.required, ['at']); assert.ok(by.pick_broll.inputSchema.properties.auto && by.pick_broll.inputSchema.properties.fill);
    assert.ok(by.add_broll.inputSchema.properties.type.enum.includes('testimonial') && by.add_broll.inputSchema.properties.raw);
    assert.ok(by.suggest_broll.inputSchema.properties.ideas.items.properties.why);
    assert.ok(!/Skip the hook/.test(by.suggest_broll.description));
  });
} finally {
  try { await client?.close(); } catch {}
  srv.kill();
  rmSync(STATE, { recursive: true, force: true }); rmSync(jobDir, { recursive: true, force: true });
}
console.log(`\n${n} studio spots tests passed`);
process.exit(0);
