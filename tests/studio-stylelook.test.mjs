// Copy the look in Studio (1.28.0), with no Chrome, no keys and no network (a stand-in reel, looks kept in a temp folder):
// - reference mode "look" is accepted and kept; an unknown mode is refused
// - a draft in mode look saves the reference's style as look-<job> and drafts with --style-look, never --recipe or --recut
// - a saved style look (state.styleLook) drafts with --style-look when no reference is in use; a reference on Recreate wins
// - an unknown styleLook is refused; one that is gone is cleared at Draft with a line in the task log
// - GET /api/style-looks lists, POST /api/style-looks/save checks the name and the reference
// - build/match.json is passed through as match; MCP get_edit, studio_set_selections and save_look see and set all of it
// Run: node tests/studio-stylelook.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-stylelook-test-')), LOOKS = join(STATE, 'looks'), JOB = 'stylelook-test-' + process.pid;
const TD = `teardown/studio-${JOB}-r1`, AUTO = `look-${JOB}`;
process.env.STUDIO_DIR = STATE; process.env.LOOKS_DIR = LOOKS;
const C = await import('../kit/studio/core.mjs');
const SLK = await import('../kit/studio/stylelooks.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// a reference already broken down: a small Reel.md with a face and a colour on every shot
mkdirSync(join(ROOT, TD), { recursive: true });
writeFileSync(join(ROOT, TD, 'Reel.md'), ['---', 'videomd: 1', 'name: ref4', 'description: a 4-shot reference', 'source:', '  file: ref.mp4', '  duration: 12', 'shots: 4', 'lang: en', 'x-reel: 1', '---', '', '# ref4', '',
  '## Brand kit', '- preset: auto', '- theme: neutral', '- colors: #101010, #FF5A1F, #f0f0f0', '- fonts: theme', '- logo: none', '',
  '## Shots', '', '```videomd-timeline', '#01 0-3 | framing close-up | face 0.17@0.33 | lab 42,2,10~22,5,7', '#02 3-6 | framing medium shot | transition flash | face 0.17@0.33 | lab 42,2,10~22,5,7',
  '#03 6-9 | framing close-up | face 0.17@0.33 | lab 42,2,10~22,5,7', '#04 9-12 | framing medium shot | face 0.17@0.33 | lab 42,2,10~22,5,7', '```', '',
  '## Sound effects', '', '```reel-sfx', '#01 3-3.2 | type pop | sound 11-pop-sticker', '```', ''].join('\n'));
const EX = C.extract(join(ROOT, TD, 'Reel.md'));
const base = C.defaultState();
writeFileSync(join(STATE, 'state.json'), JSON.stringify({ ...base, job: JOB, pack: 'magazine', sound: { ...base.sound, sfx: 'off' }, music: { ...base.music, bed: 'none' },
  reference: { ...base.reference, status: 'ready', mode: 'off', out: TD, extracted: EX } }));

const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, LOOKS_DIR: LOOKS, STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', STUDIO_TX: 'tests/fixtures/fake-tx.mjs', FAKE_TX_DELAY: '50',
  STUDIO_REEL: 'tests/fixtures/fake-reel.mjs', STUDIO_BROLL_AUTO: '', CHROME_PATH: join(STATE, 'no-chrome') };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let out = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => { const r = await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json(); j.status = r.status; return j; };
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(150); } };
const waitTask = async () => { await wait(300); return until(async () => { const v = await api('/api/state'); return v.task && v.task.status !== 'running' ? v : null; }, 60000); };
const lastCall = () => readFileSync(join(ROOT, 'jobs', JOB, 'fake-reel.log'), 'utf8').trim().split('\n').pop();
const draft = async () => { const d = await api('/api/draft', {}); assert.ok(!d.error, JSON.stringify(d).slice(0, 300)); const v = await waitTask(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task).slice(0, 600)); return v; };

let client;
try {
  // the stand-in reel only needs a file to be there
  const up = await (await fetch(`${url}/api/upload?kind=footage&name=take.mp4`, { method: 'POST', body: Buffer.alloc(2048) })).json();
  assert.ok(up.path, JSON.stringify(up).slice(0, 300));

  await t('mode look is accepted and kept; an unknown mode is refused; your earlier Look is set aside, not lost', async () => {
    const bad = await api('/api/state', { reference: { mode: 'copy' } }); assert.strictEqual(bad.status, 400); assert.match(bad.error, /influence, recreate, look or off/);
    const v = await api('/api/state', { reference: { mode: 'look' } }); assert.strictEqual(v.status, 200, JSON.stringify(v).slice(0, 300));
    assert.strictEqual(v.state.reference.mode, 'look'); assert.strictEqual(v.state.pack, null, 'the Look from before is set aside: the reference is the look (Back to my look brings it back)'); assert.strictEqual(v.state.reference.prevLook.pack, 'magazine');
    assert.strictEqual((await api('/api/state')).state.reference.mode, 'look', 'kept');
    assert.strictEqual(v.state.styleLook, null); assert.deepStrictEqual(v.styleLooks, []); assert.strictEqual(v.match, null);
    assert.strictEqual(v.swap, null, 'no what to swap from its script');
    const e = await api('/api/edit'); assert.strictEqual(e.referenceMode, 'look'); assert.strictEqual(e.edit.look.reference, 'look'); assert.strictEqual(e.edit.look.styleLook, AUTO);
  });

  await t('a draft in mode look saves look-<job> and drafts with --style-look, no recipe, no re-cut, no pack', async () => {
    const v = await draft(), L = lastCall();
    assert.ok(new RegExp(`--style-look ${AUTO}( |$)`).test(L), L);
    assert.ok(!/--recipe|--recut|--pack/.test(L), L);
    assert.ok(/take\.mp4/.test(L) && /--draft/.test(L), L);
    const f = join(LOOKS, AUTO, 'look.json'); assert.ok(existsSync(f), 'the look file, under LOOKS_DIR');
    const look = JSON.parse(readFileSync(f, 'utf8')); assert.strictEqual(look.kind, 'style-look'); assert.strictEqual(look.name, AUTO);
    assert.ok(look.framing.measured && look.grade.target, 'framing and grade from the teardown');
    assert.ok(v.task.lines.some(l => /Copy the look: we saved the style of the reference/.test(l)), v.task.lines.join(' | '));
    assert.ok(!existsSync(join(ROOT, 'looks', 'local', AUTO)), 'nothing written into the repo');
  });

  await t('GET /api/style-looks lists the saved looks with a summary; the polled state carries the same list', async () => {
    const r = await api('/api/style-looks'); assert.strictEqual(r.status, 200); assert.strictEqual(r.looks.length, 1);
    const l = r.looks[0]; assert.strictEqual(l.name, AUTO); assert.ok(l.created);
    for (const k of ['framing', 'grade', 'captions', 'pace', 'music', 'sfx']) assert.strictEqual(typeof l.summary[k], 'string', k);
    assert.deepStrictEqual((await api('/api/state')).styleLooks.map(x => x.name), [AUTO]);
  });

  await t('POST /api/style-looks/save: an empty name is refused, a name is cleaned, the list comes back', async () => {
    for (const name of ['', '   ', '!!!']) { const r = await api('/api/style-looks/save', { name }); assert.strictEqual(r.status, 400, name); assert.match(r.error, /name/); assert.ok(!/npm |node /.test(r.error)); }
    const r = await api('/api/style-looks/save', { name: 'My Brand Look!' }); assert.strictEqual(r.status, 200, JSON.stringify(r).slice(0, 300));
    assert.strictEqual(r.ok, true); assert.strictEqual(r.name, 'my-brand-look'); assert.deepStrictEqual(r.looks.map(x => x.name), [AUTO, 'my-brand-look'].sort());
    assert.ok(existsSync(join(LOOKS, 'my-brand-look', 'look.json')));
  });

  await t('POST /api/state styleLook: an unknown name is refused, a saved one is kept, null clears', async () => {
    const bad = await api('/api/state', { styleLook: 'no-such-look' }); assert.strictEqual(bad.status, 400); assert.match(bad.error, /no saved look named "no-such-look"/);
    assert.strictEqual((await api('/api/state', { styleLook: 'my-brand-look' })).state.styleLook, 'my-brand-look');
    assert.strictEqual((await api('/api/state', { styleLook: null })).state.styleLook, null);
    assert.strictEqual((await api('/api/state', { styleLook: 'my-brand-look' })).state.styleLook, 'my-brand-look');
  });

  await t('mode look still uses the reference\'s own look; a reference on Recreate wins over the saved look', async () => {
    assert.ok(new RegExp(`--style-look ${AUTO}( |$)`).test((await draft(), lastCall())), 'look-<job>, saved again');
    await api('/api/state', { reference: { mode: 'recreate' } });
    const e = await api('/api/edit'); assert.strictEqual(e.edit.look.styleLook, null); assert.strictEqual(e.styleLook, 'my-brand-look');
    await draft(); const L = lastCall();
    assert.ok(/--recipe \S*Reel\.md/.test(L) && /--recut/.test(L) && !/--style-look/.test(L), L);
    const s = { ...(await api('/api/state')).state };
    assert.strictEqual(SLK.plan({ ...s, reference: { ...s.reference, mode: 'influence' } }, ROOT), null, 'Influence wins too');
  });

  await t('with the reference off, the saved look drafts with --style-look', async () => {
    await api('/api/state', { reference: { mode: 'off' } });
    assert.strictEqual((await api('/api/edit')).edit.look.styleLook, 'my-brand-look');
    const v = await draft(), L = lastCall();
    assert.ok(/--style-look my-brand-look( |$)/.test(L) && !/--recipe|--recut|--pack/.test(L), L);
    assert.ok(v.task.lines.some(l => /Using your saved look "my-brand-look"/.test(l)));
  });

  await t('match: build/match.json of the current draft is passed through', async () => {
    const m = { version: 1, mode: 'look', against: 'my-brand-look', overall: 81, estimate: true, parts: { framing: { score: 90, note: 'x' }, grade: { score: null, note: 'not matched' }, captions: { score: 100, note: '' }, stickers: { score: 60, note: '' }, sfx: { score: 70, note: '' }, pace: { score: 85, note: '' } } };
    writeFileSync(join(ROOT, 'jobs', JOB, 'build', 'match.json'), JSON.stringify(m));
    assert.deepStrictEqual((await api('/api/state')).match, m); assert.deepStrictEqual((await api('/api/edit')).match, m);
  });

  await t('MCP: get_edit shows the mode, the looks and the match; studio_set_selections and save_look set them', async () => {
    client = new Client({ name: 'stylelook-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: STATE, LOOKS_DIR: LOOKS, STUDIO_PORT: url.split(':').pop() } }));
    const tools = (await client.listTools()).tools, desc = name => tools.find(x => x.name === name).description;
    assert.match(desc('studio_set_selections'), /Copy the look/); assert.match(desc('get_edit'), /styleLooks/); assert.match(desc('save_look'), /styleLook: true/);
    const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content.map(c => c.text).join(''), get json() { return JSON.parse(this.text); } }; };
    let e = (await call('get_edit')).json;
    assert.strictEqual(e.referenceMode, 'off'); assert.strictEqual(e.styleLook, 'my-brand-look'); assert.strictEqual(e.match.overall, 81);
    assert.deepStrictEqual(e.styleLooks.map(x => x.name), [AUTO, 'my-brand-look'].sort()); assert.ok(e.styleLooks[0].summary.framing);
    const bad = await call('studio_set_selections', { styleLook: 'no-such-look' }); assert.ok(bad.err && /no saved look/.test(bad.text), bad.text);
    assert.ok(!(await call('studio_set_selections', { reference: { mode: 'look' }, styleLook: null })).err);
    await until(async () => (await api('/api/state')).state.reference.mode === 'look');
    e = (await call('get_edit')).json; assert.strictEqual(e.referenceMode, 'look'); assert.strictEqual(e.styleLook, null); assert.strictEqual(e.edit.look.styleLook, AUTO);
    const sv = await call('save_look', { name: 'From Agent', styleLook: true }); assert.ok(!sv.err, sv.text);
    assert.strictEqual(sv.json.styleLook, 'from-agent'); assert.ok(sv.json.styleLooks.some(x => x.name === 'from-agent')); assert.ok(existsSync(join(LOOKS, 'from-agent', 'look.json')));
    assert.ok(!(await call('studio_set_selections', { reference: { mode: 'off' }, styleLook: 'from-agent' })).err);
    await until(async () => (await api('/api/state')).state.styleLook === 'from-agent');
  });

  await t('a saved look that is gone: the draft goes on without it, the field is cleared and the task log says so', async () => {
    rmSync(join(LOOKS, 'from-agent'), { recursive: true, force: true });
    const v = await draft(), L = lastCall();
    assert.ok(!/--style-look|--recipe/.test(L), L); assert.ok(/--pack magazine/.test(L), 'back to your Look: ' + L);
    assert.strictEqual(v.state.styleLook, null);
    assert.ok(v.task.lines.some(l => /The saved look "from-agent" is no longer there/.test(l)), v.task.lines.join(' | '));
  });

  await t('a reference still being broken down: Copy the look refuses the draft in plain words', async () => {
    const s = C.load(); s.reference = { ...s.reference, mode: 'look', out: null, extracted: null, status: 'running' }; C.save(s);
    const d = await api('/api/draft', {}); assert.strictEqual(d.status, 409, JSON.stringify(d).slice(0, 300));
    assert.match(d.error, /still being broken down\. Copy the look needs it/); assert.ok(!/npm |node /.test(d.error));
  });

  await t('saving with no reference broken down is refused in plain words', async () => {
    const r = await api('/api/style-looks/save', { name: 'nothing' }); assert.strictEqual(r.status, 400); assert.match(r.error, /reference/); assert.ok(!existsSync(join(LOOKS, 'nothing')));
  });

  await t('New video: the saved look stays with Keep my look, and goes without it', async () => {
    const a = C.freshSession({ ...C.defaultState(), job: 'a', styleLook: 'my-brand-look' }, { job: 'b', keepLook: true }); assert.strictEqual(a.styleLook, 'my-brand-look');
    const b = C.freshSession({ ...C.defaultState(), job: 'a', styleLook: 'my-brand-look' }, { job: 'b', keepLook: false }); assert.strictEqual(b.styleLook, null);
    const c = C.resetEdit({ ...C.defaultState(), job: 'a', styleLook: 'my-brand-look' }, { keepLook: false }); assert.strictEqual(c.styleLook, null);
    const d = C.resetEdit({ ...C.defaultState(), job: 'a', styleLook: 'my-brand-look' }, { keepLook: true }); assert.strictEqual(d.styleLook, 'my-brand-look');
  });
  console.log(`studio-stylelook: ${n} passed`);
} catch (e) { console.error('server said: ' + out.slice(-1500)); throw e;
} finally {
  try { await client?.close(); } catch {}
  srv.kill();
  rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, TD), { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
}
process.exit(0);
