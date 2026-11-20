// The Look step (1.16.0), with no Chrome, no keys and no network:
// - 9 layers, every option in exactly one (categories.json layers), the old duplicates where the plan puts them, and a
//   layer map that loses an option or names an unknown one is an error (npm run check runs this)
// - the badges: where each choice came from (the Look, the reference, you)
// - Clear reference takes the reference and every pick Use parts added, as one undo; Undo puts it all back
// - Save as a Look keeps the reference's look
// - MCP: clear_reference and save_look, and the catalog by layer
// Run: node tests/studio-look.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-look-test-')), JOB = 'look-test-' + process.pid, LOOK = 'look-test-' + process.pid, SDIR = join(STATE, 'studio');
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const cat = C.catalog(), first = k => Object.values(cat.items).find(i => i.kind === k && i.mode !== 'info').id;
const TR = 'glitch', EN = first('entrance'), GR = 'lower-third';
// a reference already broken down: what Use parts would add
const EX = { name: 'Hormozi hook', shots: 23, transitions: { [TR]: 3 }, entrances: [EN], finishes: [], graphics: [GR], effects: [], music: {}, summary: { seconds: 31, music: { bpm: 128 } } };
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB, pack: 'magazine', reference: { ...C.defaultState().reference, status: 'ready', mode: 'influence', extracted: EX } }));

const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome'), STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
let srvOut = '';
const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
const req = async (path, body) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; };

let client;
try {
  await t('9 layers, every option in exactly one, nothing lost', async () => {
    assert.deepStrictEqual(cat.errs, []);
    assert.deepStrictEqual(cat.layers.map(l => l.id), ['text', 'fonts', 'graphics', 'transitions', 'color', 'motion', 'audio', 'broll', 'layout']);
    const seen = new Map(); for (const l of cat.layers) for (const r of l.items) { assert.ok(!seen.has(r), `${r} is in ${seen.get(r)} and ${l.id}`); seen.set(r, l.id); }
    const all = new Set(cat.categories.flatMap(c => c.items)); all.delete('look:oneword');
    assert.strictEqual(seen.size, all.size, 'every option of every tab lands in a layer');
    for (const l of cat.layers) assert.strictEqual(l.count, l.groups.reduce((a, g) => a + g.items.length, 0));
  });
  await t('the old duplicates sit where the plan puts them', async () => {
    const where = r => cat.layers.find(l => l.items.includes(r)).id;
    for (const r of ['transition:glitch', 'transition:light-leak', 'transition:zoom-blur']) assert.strictEqual(where(r), 'transitions', r);
    for (const r of ['graphic:keyword-caption', 'graphic:split-flap', 'effect:led-sign', 'effect:backdrop-word', 'editing:place-face', 'look:kinetic']) assert.strictEqual(where(r), 'text', r);
    for (const r of ['effect:spotlight', 'effect:slow-push', 'effect:orbit', 'effect:pause-point', 'effect:wave-trim']) assert.strictEqual(where(r), 'motion', r);
    for (const r of ['graphic:screen-card', 'effect:broll-split', 'effect:match-cut']) assert.strictEqual(where(r), 'broll', r);
    for (const r of ['effect:noise', 'finish:scan-lines']) assert.strictEqual(where(r), 'color', r);
    for (const r of ['graphic:lower-third', 'graphic:versus', 'graphic:cta-card']) assert.strictEqual(where(r), 'graphics', r);
    assert.ok(cat.layers.find(l => l.id === 'fonts').items.every(r => r.startsWith('font:')));
    assert.ok(!cat.layers.some(l => l.items.includes('look:oneword')), 'oneword (a second name for one-word) is gone');
  });
  await t('a layer map that loses an option, or names an unknown layer or option, is an error', async () => {
    const map = JSON.parse(readFileSync(join(ROOT, 'kit', 'studio', 'categories.json'), 'utf8'));
    const lost = { ...map, layers: map.layers.filter(l => l.id !== 'layout') }, errs = []; C.layersOf(lost, cat.categories, cat.items, errs);
    assert.ok(errs.some(e => /is in no layer/.test(e)), errs.join('; '));
    const bad = { ...map, owners: { 'effect:nope': 'color', 'effect:noise': 'sideways' } }, e2 = []; C.layersOf(bad, cat.categories, cat.items, e2);
    assert.ok(e2.some(e => /no option effect:nope/.test(e)) && e2.some(e => /names no layer sideways/.test(e)), e2.join('; '));
  });
  await t('badges: the reference suggests, the Look sets, you pick', async () => {
    const v = await req('/api/state');
    assert.ok(v.look.ref.includes(`transition:${TR}`) && v.look.ref.includes(`graphic:${GR}`), JSON.stringify(v.look.ref));
    assert.ok(v.look.pack.length > 0, 'magazine sets some options'); assert.strictEqual(v.look.packName, 'magazine'); assert.strictEqual(v.look.refName, 'Hormozi hook');
    const off = await req('/api/state', { reference: { mode: 'off' } }); assert.deepStrictEqual(off.look.ref, [], 'off: no REF badges');
    await req('/api/state', { reference: { mode: 'influence' } });
  });
  let before;
  await t('Clear reference: the reference and every pick it added go as one undo; your own picks stay; Undo puts it back', async () => {
    const mine = first('finish'); await req('/api/state', { picks: { [`finish:${mine}`]: 'allow' } });
    const ap = await req('/api/reference/apply', {}); assert.strictEqual(ap.status, 200);
    assert.ok(ap.state.picks.transition.allow.includes(TR) && ap.state.picks.graphic.allow.includes(GR));
    assert.ok(ap.look.added.includes(`transition:${TR}`) && !ap.look.added.includes(`finish:${mine}`), 'your pick is yours: ' + ap.look.added);
    before = ap.state;
    const cl = await req('/api/reference/clear', {}); assert.strictEqual(cl.status, 200); assert.match(cl.note, /Undo puts it back/);
    assert.strictEqual(cl.state.reference.extracted, null); assert.strictEqual(cl.state.reference.status, 'none');
    assert.ok(!cl.state.picks.transition.allow.includes(TR) && !cl.state.picks.graphic.allow.includes(GR), 'its picks are gone');
    assert.ok(cl.state.picks.finish.allow.includes(mine), 'your own pick stays');
    assert.ok(cl.state.undoRef); assert.deepStrictEqual(cl.look.ref, []);
    const un = await req('/api/reference/clear', { undo: true }); assert.strictEqual(un.status, 200);
    assert.deepStrictEqual(un.state.reference.extracted, EX); assert.deepStrictEqual(un.state.picks, before.picks); assert.ok(!un.state.undoRef);
    assert.strictEqual((await req('/api/reference/clear', { undo: true })).status, 400, 'one undo');
  });
  await t('Save as a Look keeps the reference\'s look, and it is a Look you can pick', async () => {
    const sv = await req('/api/pack/save', { name: LOOK, fromReference: true }); assert.strictEqual(sv.status, 200, JSON.stringify(sv).slice(0, 300));
    const pk = JSON.parse(readFileSync(join(ROOT, sv.path), 'utf8'));
    assert.match(pk.label, /Hormozi hook/); assert.strictEqual(pk.style.transition, TR, 'the reference\'s top transition is in the Look');
    assert.strictEqual(sv.state.pack, LOOK);
    const c = await req('/api/catalog'); assert.ok(c.packs.some(p => p.name === LOOK));
  });
  await t('MCP: clear_reference and save_look; the catalog comes by layer', async () => {
    client = new Client({ name: 'look-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, env: { ...process.env, STUDIO_DIR: SDIR, STUDIO_PORT: url.split(':').pop() } }));
    const by = Object.fromEntries((await client.listTools()).tools.map(x => [x.name, x]));
    assert.ok(by.clear_reference.inputSchema.properties.undo); assert.deepStrictEqual(by.save_look.inputSchema.required, ['name']);
    const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, name + ': ' + JSON.stringify(r.content).slice(0, 300)); return r.structuredContent || JSON.parse(r.content[0].text); };
    const cr = await call('clear_reference', {}); assert.strictEqual(cr.reference.status, 'none'); assert.strictEqual(cr.undo, true);
    const un = await call('clear_reference', { undo: true }); assert.strictEqual(un.reference.status, 'ready');
    const gs = await call('studio_get_state', { catalog: true }); assert.strictEqual(gs.catalog.layers.length, 9);
  });
  console.log(`studio-look: ${n} passed`);
} finally {
  try { await client?.close(); } catch {}
  srv.kill();
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'packs', 'local', LOOK), { recursive: true, force: true }); rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`), { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true });
}
