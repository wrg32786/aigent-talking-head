// Sizes: one render makes the 9:16 reel and, when ticked, the Instagram Feed 4:5 and the square 1:1.
// - state: sizes default to 9:16 only; a patch takes 4:5, 1:1 and their preset names, refuses anything else
// - compose and Render pass one --export list (the 9:16 preset first, then the sizes); an older session whose export
//   was a 4:5 or 1:1 preset becomes a size
// - files: every name a render writes gets a plain label; the reel sorts before its sizes
// - which file goes where: the Feed gets the 4:5 of the same version, or says it is missing
// - POST /api/sizes/make: bad input refused, no render refused, then one task that makes the file (a stub stands in for
//   kit/export.mjs here; the real one is covered by the engine tests)
// - MCP: the same tools, with sizes on get_edit, studio_run, studio_set_selections and render
// Run: node tests/studio-sizes.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-sizes-test-')), JOB = 'sizes-test-' + process.pid;
process.env.STUDIO_DIR = join(STATE, 'studio');
const C = await import('../kit/studio/core.mjs'), SZ = await import('../kit/studio/sizes.mjs');
const X = createRequire(import.meta.url)('../kit/exports.cjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const jobDir = join(ROOT, 'jobs', JOB);
// a stand-in for kit/export.mjs: writes the file the real one would and prints the same JSON line
const STUB = join(STATE, 'export-stub.mjs');
writeFileSync(STUB, `import { writeFileSync } from 'fs'; import { createRequire } from 'module';
const X = createRequire(import.meta.url)(${JSON.stringify(join(ROOT, 'kit', 'exports.cjs'))}), a = process.argv.slice(2), ex = a[a.indexOf('--export') + 1], file = a[a.indexOf('--file') + 1];
const out = X.outName(file, ex); writeFileSync(out, 'stub'); writeFileSync(${JSON.stringify(join(STATE, 'stub-args.json'))}, JSON.stringify(a)); console.log(JSON.stringify({ ok: true, export: ex, file: out }));\n`);

let srv, client;
try {
  await t('state: 9:16 only by default; a patch takes 4:5 and 1:1 by any of their names; anything else is refused', async () => {
    const s = C.defaultState(); assert.deepStrictEqual(s.sizes, []);
    assert.deepStrictEqual(SZ.norm(['1:1', '9:16', 'feed']).sizes, ['feed45', 'square'], 'fixed order, 9:16 dropped (always made)');
    assert.deepStrictEqual(SZ.norm('4:5').sizes, ['feed45']); assert.deepStrictEqual(SZ.norm({ feed45: true, square: false }).sizes, ['feed45']); assert.deepStrictEqual(SZ.norm(null).sizes, []);
    assert.deepStrictEqual(SZ.norm(['16:9']).bad, ['16:9']);
    let r = C.applyPatch(s, { sizes: ['4:5'] }); assert.deepStrictEqual([r.errs, s.sizes], [[], ['feed45']]);
    r = C.applyPatch(s, { sizes: ['4:5', 'widescreen'] }); assert.match(r.errs.join(), /sizes: 9:16 \(always made\), 4:5 or 1:1/); assert.deepStrictEqual(s.sizes, ['feed45'], 'a refused patch changes nothing');
    r = C.applyPatch(s, { sizes: [] }); assert.deepStrictEqual(s.sizes, []);
    assert.ok(C.LOOK_KEYS.includes('sizes'), 'sizes stay with Keep my look, like export');
  });
  await t('compose: one --export list, the 9:16 preset first; an old 4:5 export is a size now', async () => {
    const arg = s => { const a = C.compose(s).args, i = a.indexOf('--export'); return i < 0 ? null : a[i + 1]; };
    const s = C.defaultState(); assert.strictEqual(arg(s), 'reels');
    s.sizes = ['feed45']; assert.strictEqual(arg(s), 'reels,feed45');
    s.sizes = ['feed45', 'square']; assert.strictEqual(arg(s), 'reels,feed45,square');
    s.export = null; assert.strictEqual(arg(s), 'feed45,square'); s.sizes = []; assert.strictEqual(arg(s), null);
    s.export = 'feed45'; assert.strictEqual(arg(s), 'feed45'); assert.deepStrictEqual(SZ.sizesOf(s), ['feed45']);
    s.export = 'tiktok'; s.sizes = ['square']; assert.strictEqual(arg(s), 'tiktok,square');
    // a board saved before 1.28.0 with the 4:5 as its export: read as a size, so unticking it on Render takes it off
    { const fsx = await import('fs'), f = join(process.env.STUDIO_DIR, 'state.json'), had = fsx.existsSync(f) ? fsx.readFileSync(f) : null;
      fsx.mkdirSync(process.env.STUDIO_DIR, { recursive: true }); fsx.writeFileSync(f, JSON.stringify({ ...C.defaultState(), export: 'feed45', sizes: ['square'] }));
      const o = C.load(); assert.deepStrictEqual([o.export, o.sizes], [null, ['feed45', 'square']]);
      assert.deepStrictEqual(C.applyPatch(o, { sizes: ['square'] }).errs, []); assert.strictEqual(arg(o), 'square', 'the 4:5 is gone once unticked');
      assert.deepStrictEqual(C.applyPatch(o, { export: 'feed45' }).errs, []); assert.deepStrictEqual([o.export, o.sizes], [null, ['feed45', 'square']], 'an agent that sets export to a 4:5 ticks the size');
      if (had) fsx.writeFileSync(f, had); else fsx.rmSync(f, { force: true }); }
    assert.deepStrictEqual(X.parseList(arg(s)), { names: ['tiktok', 'square'], main: 'tiktok', extra: [], reframed: ['square'], bad: [] }, 'the engine reads the list the same way');
  });
  await t('files: plain labels for every name, the reel before its sizes, the Feed file of a version', async () => {
    assert.deepStrictEqual(['reel-v1.mp4', 'reel-v1-feed-4x5.mp4', 'reel-v1-square-1x1.mp4', 'reel-fx-v1.mp4', 'reel-v1-feed45.mp4', 'reel-v3-tiktok.mp4'].map(SZ.labelOf),
      ['For Reels and Stories', 'For the Instagram Feed', 'Square, for feeds', 'With effects', 'For the Instagram Feed', 'For TikTok, a smaller file']);
    for (const l of SZ.SIZES.flatMap(z => [z.label, z.use]).concat(SZ.WHERE, SZ.MAKE_FEED)) assert.ok(!/\u2014|--/.test(l), l);
    assert.deepStrictEqual(SZ.SIZES.map(z => z.label), ['Reels and Stories 9:16', 'Instagram Feed 4:5', 'Square 1:1']);
    assert.deepStrictEqual(SZ.sortFiles(['reel-v1.mp4', 'reel-v2-feed-4x5.mp4', 'reel-v2.mp4', 'reel-fx-v2.mp4', 'reel-v10-square-1x1.mp4', 'reel-v10.mp4']), ['reel-v10.mp4', 'reel-v10-square-1x1.mp4', 'reel-fx-v2.mp4', 'reel-v2.mp4', 'reel-v2-feed-4x5.mp4', 'reel-v1.mp4']);
    assert.ok(SZ.isReel('reel-v1-feed-4x5.mp4') && !SZ.isReel('reel-v1.pre.mp4') && !SZ.isReel('notes-v1.mp4'));
    mkdirSync(jobDir, { recursive: true }); writeFileSync(join(jobDir, 'reel-v1.mp4'), ''); writeFileSync(join(jobDir, 'reel-v2.mp4'), ''); writeFileSync(join(jobDir, 'reel-v2-feed-4x5.mp4'), '');
    assert.deepStrictEqual(C.outputsOf({ job: JOB }), [`jobs/${JOB}/reel-v2.mp4`, `jobs/${JOB}/reel-v2-feed-4x5.mp4`, `jobs/${JOB}/reel-v1.mp4`]);
    assert.deepStrictEqual(SZ.fileFor(`jobs/${JOB}/reel-v2.mp4`, 'feed', ROOT), { file: `jobs/${JOB}/reel-v2-feed-4x5.mp4`, size: '4:5', missing: false });
    assert.deepStrictEqual(SZ.fileFor(`jobs/${JOB}/reel-v1.mp4`, 'feed', ROOT), { file: `jobs/${JOB}/reel-v1-feed-4x5.mp4`, size: '4:5', missing: true }, 'never the 9:16 in its place');
    assert.strictEqual(SZ.fileFor(`jobs/${JOB}/reel-v2.mp4`, 'reel', ROOT).file, `jobs/${JOB}/reel-v2.mp4`);
    assert.strictEqual(SZ.fileFor(`jobs/${JOB}/reel-v2-feed-4x5.mp4`, 'feed', ROOT).file, `jobs/${JOB}/reel-v2-feed-4x5.mp4`, 'a 4:5 picked by hand goes as it is');
  });

  const env = { ...process.env, CI: '1', STUDIO_CHAT: '', STUDIO_EXPORT: relative(ROOT, STUB) };
  srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  let out = '';
  const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
  const req = async (path, b) => { const r = await fetch(url + path, { method: b !== undefined ? 'POST' : 'GET', headers: b !== undefined ? { 'content-type': 'application/json' } : {}, body: b !== undefined ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  const idle = async () => { for (let i = 0; i < 300; i++) { const v = (await req('/api/state')).j; if (!v.task || v.task.status !== 'running') return v; await new Promise(z => setTimeout(z, 100)); } throw new Error('task did not end'); };

  await t('server: the page gets the three boxes and a label per file; a patch ticks a size; Outputs lists each file with its label', async () => {
    let v = (await req('/api/state', { job: JOB })).j;
    assert.deepStrictEqual(v.sizes.list.map(z => [z.id, z.on, !!z.always]), [['reels', true, true], ['feed45', false, false], ['square', false, false]]);
    assert.strictEqual(v.sizes.files[`jobs/${JOB}/reel-v2-feed-4x5.mp4`].use, 'For the Instagram Feed'); assert.strictEqual(v.sizes.files[`jobs/${JOB}/reel-v2.mp4`].use, 'For Reels and Stories');
    v = await req('/api/state', { sizes: ['feed45'] }); assert.strictEqual(v.status, 200); assert.deepStrictEqual(v.j.sizes.on, ['feed45']); assert.ok(v.j.compose.args.join(' ').includes('--export reels,feed45'));
    assert.strictEqual((await req('/api/state', { sizes: ['3:4'] })).status, 400);
    const o = (await req('/api/outputs')).j;
    assert.deepStrictEqual(o.versions[0].files.map(f => [f.label, f.size]), [['For Reels and Stories', '9:16'], ['For the Instagram Feed', '4:5']]);
    const e = (await req('/api/edit')).j; assert.deepStrictEqual(e.sizes.map(z => [z.size, z.file]), [['9:16', 'reel-vN.mp4'], ['4:5', 'reel-vN-feed-4x5.mp4']]);
  });
  await t('make a size: bad input and a missing reel refused; then one task writes the 4:5 beside the reel it was asked for', async () => {
    let r = await req('/api/sizes/make', { size: '16:9' }); assert.strictEqual(r.status, 400); assert.match(r.j.error, /4:5 or 1:1/);
    r = await req('/api/sizes/make', { size: '9:16' }); assert.strictEqual(r.status, 400, 'the 9:16 is the reel itself');
    r = await req('/api/sizes/make', { size: 'feed45', file: 'jobs/other-job/reel-v1.mp4' }); assert.strictEqual(r.status, 400); assert.match(r.j.error, /not one of this video/);
    r = await req('/api/sizes/make', { size: 'feed45', file: `jobs/${JOB}/reel-v1.mp4` });
    if (r.status === 400 && r.j.fix) { console.log('  (render tools missing here; the task itself is skipped)'); return; }
    assert.strictEqual(r.status, 202, JSON.stringify(r.j)); assert.deepStrictEqual([r.j.size, r.j.from, r.j.file], ['feed45', `jobs/${JOB}/reel-v1.mp4`, `jobs/${JOB}/reel-v1-feed-4x5.mp4`]);
    assert.strictEqual((await req('/api/sizes/make', { size: 'square' })).status, 409, 'one task at a time');
    const v = await idle(); assert.strictEqual(v.task.status, 'done', JSON.stringify(v.task));
    assert.ok(existsSync(join(jobDir, 'reel-v1-feed-4x5.mp4'))); assert.ok(v.outputs.includes(`jobs/${JOB}/reel-v1-feed-4x5.mp4`));
    const a = JSON.parse(readFileSync(join(STATE, 'stub-args.json'), 'utf8')); assert.deepStrictEqual([a[0], a[1], a[2], a[3], a[5]], [JOB, '--export', 'feed45', '--file', '--json']); assert.ok(a[4].endsWith(join(JOB, 'reel-v1.mp4')));
    // from a 4:5 file name, the square of the same version; with no file, the newest reel
    r = await req('/api/sizes/make', { size: '1:1' }); assert.strictEqual(r.status, 202); assert.strictEqual(r.j.file, `jobs/${JOB}/reel-v2-square-1x1.mp4`); await idle();
  });
  await t('MCP: the same tools, and sizes on get_edit, studio_run, studio_set_selections and render', async () => {
    client = new Client({ name: 'sizes-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...env, STUDIO_PORT: new URL(url).port }, stderr: 'ignore' }));
    const tools = (await client.listTools()).tools, by = Object.fromEntries(tools.map(x => [x.name, x]));
    const pinned = JSON.parse(readFileSync(join(ROOT, 'contract.json'), 'utf8')); const count = JSON.stringify(pinned).match(/"(?:toolCount|tool_count|tools_count)":\s*(\d+)/); if (count) assert.strictEqual(tools.length, +count[1], 'the tool count did not change');
    assert.deepStrictEqual(by.studio_run.inputSchema.properties.sizes.items.enum, ['9:16', '4:5', '1:1', 'reels', 'feed45', 'square']);
    assert.ok(by.studio_set_selections.inputSchema.properties.sizes); assert.match(by.get_edit.description, /reel-vN-feed-4x5\.mp4/);
    assert.deepStrictEqual(by.render.inputSchema.properties.export.type, ['string', 'array']); assert.match(by.render.inputSchema.properties.export.description, /feed45/);
    for (const x of tools) assert.ok(!/\u2014/.test(x.description), x.name + ' has an em dash');
    let r = await client.callTool({ name: 'studio_set_selections', arguments: { sizes: ['4:5', '1:1'] } }); assert.ok(!r.isError, JSON.stringify(r));
    r = await client.callTool({ name: 'get_edit', arguments: {} }); assert.ok(!r.isError, JSON.stringify(r)); assert.deepStrictEqual(r.structuredContent.sizes.map(z => z.size), ['9:16', '4:5', '1:1']);
    r = await client.callTool({ name: 'studio_set_selections', arguments: { sizes: ['2:3'] } }); assert.ok(r.isError); assert.match(r.content[0].text, /sizes/);
    r = await client.callTool({ name: 'render', arguments: { name: 'x', rebuild: true, export: ['reels', 'nope'] } }); assert.ok(r.isError); assert.match(r.content[0].text, /export must be/);
  });
} finally {
  if (client) await client.close().catch(() => {});
  if (srv) srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(jobDir, { recursive: true, force: true });
}
console.log(`\n${n} studio sizes tests passed`);
