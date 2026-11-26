// Studio 1.13.0, without a browser or ffmpeg: the finish choice (what the one Render makes) is checked and saved, a new
// video starts with the defaults, the page has eight steps with the old names as aliases, one render path (no second
// render card), Your edit, and the MCP tools get_edit and studio_run (from, exports) are listed.
// Run: node tests/studio-finish.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-finish-test-'));
process.env.STUDIO_DIR = STATE;
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const src = f => readFileSync(join(ROOT, 'kit', 'studio', 'web', 'src', f), 'utf8');
let client;
try {
  await t('finish: defaults, from auto, pieces or take, reel, clips and plain; at least one thing to make', async () => {
    const s = C.defaultState(); assert.deepStrictEqual(s.finish, { from: 'auto', reel: true, clips: false, plain: false }); assert.strictEqual(s.drafted, null);
    let r = C.applyPatch(s, { finish: { from: 'pieces', clips: true } }); assert.deepStrictEqual(r.errs, []); assert.deepStrictEqual(s.finish, { from: 'pieces', reel: true, clips: true, plain: false });
    assert.ok(/finish pieces, reel, clips/.test(r.log.join(' ')), r.log.join(' '));
    r = C.applyPatch(s, { finish: { from: 'everything' } }); assert.ok(/finish.from/.test(r.errs.join(' '))); assert.strictEqual(s.finish.from, 'pieces');
    r = C.applyPatch(s, { finish: { reel: false, clips: false, plain: false } }); assert.ok(/at least one/.test(r.errs.join(' '))); assert.strictEqual(s.finish.reel, true);
    r = C.applyPatch(s, { finish: { reel: false } }); assert.deepStrictEqual(r.errs, []); assert.strictEqual(s.finish.reel, false);
    r = C.applyPatch(s, { finish: 'reel' }); assert.ok(r.errs.length);
  });
  await t('a new video starts with the default finish and no draft', async () => {
    const s = C.defaultState(); s.job = 'one'; C.applyPatch(s, { finish: { from: 'take', plain: true } }); s.drafted = { key: 'take:x', from: 'take' };
    C.freshSession(s, { job: 'two', keepLook: true }); assert.deepStrictEqual(s.finish, C.defaultState().finish); assert.strictEqual(s.drafted, null);
  });
  await t('the page: eight steps, old step names land, one render path, Your edit on every step', async () => {
    const steps = src('steps.js');
    assert.ok(steps.includes("export const STEPS = ['start', 'cut', 'picture', 'text', 'broll', 'music', 'review', 'render'];"));
    assert.ok(steps.includes("STEP_ALIAS = { footage: 'start', highlights: 'start', look: 'picture', style: 'picture', reference: 'picture', finish: 'review', post: 'render' }"));
    const render = src('Render.jsx'), app = src('App.jsx');
    assert.ok(!/Render my|kept-cuts|More ways to save|Draft whole take/.test(render), 'no second render card');
    assert.strictEqual((render.match(/<Button id="render"/g) || []).length, 1, 'one Render button');
    assert.strictEqual((render.match(/<Button id="draft"/g) || []).length, 1, 'one Draft button');
    for (const id of ['fin-from', 'exp-reel', 'exp-clips', 'exp-plain', 'match-chips']) assert.ok(render.includes(`id="${id}"`) || render.includes(`id={'${id}'}`), id);
    assert.ok(/<YourEdit /.test(app) && /<ViewSwitch /.test(app) && /<ReviewStep /.test(app) && /<Music /.test(app));
    assert.ok(!/\u2014/.test(render + app + steps + src('Edit.jsx') + src('Style.jsx') + src('AllOptions.jsx') + src('RecreateStart.jsx') + src('RefCard.jsx')), 'no em dashes in the page copy');
    const built = readFileSync(join(ROOT, 'kit', 'studio', 'public', 'assets', 'app.js'), 'utf8');
    assert.ok(built.includes('your-edit') && built.includes('fin-exports'), 'the built page has Review, Render and Your edit (npm run studio:build)');
  });
  await t('MCP: get_edit, studio_run with from and exports, finish in studio_set_selections', async () => {
    client = new Client({ name: 'finish-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: STATE, STUDIO_PORT: '9' } }));
    const tools = (await client.listTools()).tools, by = Object.fromEntries(tools.map(x => [x.name, x]));
    assert.ok(by.get_edit, 'get_edit'); const run = by.studio_run.inputSchema.properties;
    assert.deepStrictEqual(run.from.enum, ['auto', 'pieces', 'take']); assert.deepStrictEqual(Object.keys(run.exports.properties), ['reel', 'clips', 'plain']);
    assert.ok(by.studio_set_selections.inputSchema.properties.finish);
    const r = await client.callTool({ name: 'get_edit', arguments: {} }); assert.ok(r.isError && /not running/.test(r.content[0].text), 'says Studio is not running');
    const s = await client.callTool({ name: 'studio_set_selections', arguments: { finish: { from: 'take' } } }); assert.ok(!s.isError, JSON.stringify(s));
    assert.strictEqual(C.load().finish.from, 'take');
  });
  console.log(`\nStudio finish tests: ${n} passed`);
} finally {
  if (client) await client.close().catch(() => {});
  rmSync(STATE, { recursive: true, force: true });
}
