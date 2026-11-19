// Studio tests: the catalog only names what the engine has, a session becomes valid reel arguments, the server refuses
// other hosts and paths outside what it serves, uploads land in the job's inbox, chat works in keyword mode and in
// direct API mode (against a local fake API, no key or network), and the reference helpers make a valid pack.
// Run: node tests/studio.test.mjs   (npm run check runs it too)
import assert from 'assert';
import http from 'http';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const L = require('../kit/locks.cjs'), K = require('../kit/packs.cjs');
const STATE = mkdtempSync(join(tmpdir(), 'studio-test-'));
process.env.STUDIO_DIR = STATE;
const C = await import('../kit/studio/core.mjs');
const LLM = await import('../kit/studio/llm.mjs');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const JOB = 'studio-test-' + process.pid;

try {
  await t('catalog: every tab entry is an engine name, every tab has items, previews exist on disk', () => {
    const c = C.catalog({ fresh: true });
    assert.deepStrictEqual(c.errs, []);
    assert.ok(c.categories.length >= 17);
    for (const cat of c.categories) for (const r of cat.items) { const it = c.items[r]; assert.ok(it, r); if (it.preview) assert.ok(existsSync(join(ROOT, it.preview.src)), it.preview.src); }
    assert.strictEqual(c.categories.find(x => x.id === 'transitions').count, L.transitionNames().length);
    assert.ok(c.categories.find(x => x.id === 'camera').items.every(r => r.startsWith('effect:') || r === 'editing:punch'));
  });
  await t('vibes.json only names real packs and engine names', () => {
    const V = JSON.parse(readFileSync(join(ROOT, 'kit', 'studio', 'vibes.json'), 'utf8')), c = C.catalog();
    for (const v of V.vibes) { if (v.pack) assert.ok(c.packs.some(p => p.name === v.pack), v.pack); for (const r of Object.keys(v.picks || {})) assert.ok(c.items[r], r); assert.ok(!/\u2014/.test(v.say)); }
  });
  await t('patch: picks, refusals and the reel arguments they add up to', () => {
    const s = C.defaultState();
    let r = C.applyPatch(s, { picks: { 'transition:whip': 'allow', 'transition:zoom': 'allow', 'graphic:checklist': 'deny', 'captionStyle:hormozi': 'allow', 'finish:grain': 'deny', 'editing:punch': 'deny' }, music: { energy: 'high' }, pack: 'magazine' });
    assert.deepStrictEqual(r.errs, []);
    r = C.applyPatch(s, { picks: { 'transition:teleport': 'allow', 'sfx:01-cinematic-hit-a': 'allow', 'captionStyle:pill': 'deny' }, pack: 'nope', music: { energy: 'loud' } });
    assert.strictEqual(r.errs.length, 5, r.errs.join('\n'));
    const comp = C.compose(s);
    assert.deepStrictEqual(comp.errs, []);
    assert.deepStrictEqual(comp.locks.transitions, ['whip', 'zoom']);
    assert.ok(!comp.locks.finishes.includes('grain') && comp.locks.finishes.length === 9);
    assert.deepStrictEqual(L.validate(L.parse(comp.lockString)), []);
    for (const a of ['--pack', 'magazine', '--style', 'hormozi', '--no-punch', '--music-energy', 'high']) assert.ok(comp.args.includes(a), a);
    C.applyPatch(s, { picks: { 'captionStyle:pill': 'allow' } });
    assert.strictEqual(C.compose(s).args[C.compose(s).args.indexOf('--style') + 1], 'pill');
  });
  await t('vibes: clauses, negation, the last pack named wins', () => {
    const v = C.vibes('make it punchy but keep the magazine look, no glitch, typewriter titles', C.defaultState());
    assert.strictEqual(v.patch.pack, 'magazine');
    assert.strictEqual(v.patch.picks['transition:glitch'], 'deny');
    assert.strictEqual(v.patch.picks['entrance:typewriter'], 'allow');
    assert.ok(!v.patch.picks['captionEntrance:typewriter'] && !v.patch.picks['theme:magazine']);
    assert.strictEqual(C.vibes('retro vibe without scan lines', C.defaultState()).patch.picks['finish:scan-lines'], 'deny');
  });
  await t('reference: a recipe becomes suggestions and a valid influence pack that keeps a base pack\'s locks', () => {
    const ex = C.extract(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'));
    assert.deepStrictEqual(ex.transitions, { film: 1, crossfade: 1 });
    assert.ok(ex.entrances.includes('blur-rise') && ex.effects.includes('slow-push'));
    const p1 = C.influencePack(ex, 'demo'); assert.deepStrictEqual(K.validate(p1), []); assert.strictEqual(p1.style.transition, 'film');
    const p2 = C.influencePack(ex, 'demo', 'magazine'); assert.deepStrictEqual(K.validate(p2), []);
    assert.deepStrictEqual(p2.locks.transitions, K.load('magazine').locks.transitions); assert.ok(p2.style.transition !== 'film');
  });
  await t('effects pass plan: only effects that need no copy, one per beat after the hook', () => {
    const ch = { beats: [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6.5 }] };
    const r = C.fxPlan(ch, ['lean-in', 'slow-push', 'checklist']);
    assert.ok(r.skipped.includes('checklist'));
    assert.deepStrictEqual(r.plan.effects.map(e => e.fx), ['lean-in', 'slow-push']);
    assert.ok(r.plan.effects.every(e => e.start >= 2 && e.end > e.start));
  });
  await t('llm: prompt lists only engine names; replies parse, em dashes removed', () => {
    const sp = LLM.systemPrompt(C.defaultState(), C.catalog());
    assert.ok(sp.includes('whip') && sp.includes('magazine'));
    assert.deepStrictEqual(LLM.parseReply('Sure! {"reply":"Done \u2014 calm","patch":{"pack":"cinematic"}}'), { reply: 'Done ,  calm', patch: { pack: 'cinematic' } });
    assert.strictEqual(LLM.provider({}), null);
    assert.strictEqual(LLM.provider({ OPENAI_API_KEY: 'x' }).name, 'openai');
  });

  // ---------- the server ----------
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const body = JSON.parse(b); const asked = body.messages[body.messages.length - 1].content;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'Made it calmer.', patch: /bad/.test(asked) ? { picks: { 'transition:teleport': 'allow' } } : { pack: 'cinematic', picks: { 'transition:dissolve': 'allow' }, music: { energy: 'low' } } }) } }] }));
  }); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const start = env => new Promise((ok, bad) => {
    const p = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env: { ...process.env, CI: '1', STUDIO_DIR: STATE, ...env } });
    let out = ''; p.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok({ p, url: m[1] }); });
    p.stderr.on('data', d => { out += d; }); p.on('close', c => bad(new Error('server exited ' + c + ': ' + out)));
  });
  const { p: srv, url } = await start({ OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ANTHROPIC_API_KEY: '' });
  const req = async (path, { method, body, headers, raw } = {}) => {
    const r = await fetch(url + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...(headers || {}) }, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || ''; return { status: r.status, j: ct.includes('json') ? await r.json() : null, text: ct.includes('json') ? null : await r.text() };
  };
  try {
    await t('server: page, catalog and state', async () => {
      const page = await req('/'); assert.strictEqual(page.status, 200); assert.ok(page.text.includes('AIgent'));
      const c = await req('/api/catalog'); assert.ok(c.j.categories.length >= 17);
      const s = await req('/api/state'); assert.strictEqual(s.j.state.format, 'aigent-studio'); assert.ok(s.j.env.llm.startsWith('openai'));
    });
    await t('server: refuses other hosts, cross-site posts and paths outside what it serves', async () => {
      const raw = (path, headers) => new Promise(ok => { const u = new URL(url); http.get({ host: u.hostname, port: u.port, path, headers }, r => { r.resume(); ok(r.statusCode); }); });
      assert.strictEqual(await raw('/api/state', { host: 'evil.example' }), 403);
      assert.strictEqual((await req('/api/state', { body: { job: 'x' }, headers: { origin: 'https://evil.example' } })).status, 403);
      for (const p of ['/files/package.json', '/files/jobs/.studio/state.json', '/files/docs/menu/../../package.json', '/files/kit/studio/server.mjs']) assert.strictEqual((await req(p)).status === 200, false, p);
      assert.strictEqual((await req('/files/docs/menu/transitions/whip.webp')).status, 200);
    });
    await t('server: a patch with an unknown name changes nothing', async () => {
      const before = (await req('/api/state')).j.state.rev;
      const r = await req('/api/state', { body: { picks: { 'transition:teleport': 'allow' } } }); assert.strictEqual(r.status, 400);
      assert.strictEqual((await req('/api/state')).j.state.rev, before);
    });
    await t('server: uploads need a job, check the type, and land in inbox/studio/<job>/', async () => {
      assert.strictEqual((await req('/api/upload?kind=footage&name=a.mp4', { body: 'x', raw: true })).status, 400);
      await req('/api/state', { body: { job: JOB } });
      assert.strictEqual((await req('/api/upload?kind=footage&name=a.exe', { body: 'x', raw: true })).status, 400);
      const up = await req('/api/upload?kind=footage&name=../../take one.mp4', { body: 'not really a video', raw: true });
      assert.strictEqual(up.status, 200); assert.strictEqual(up.j.path, `inbox/studio/${JOB}/take-one.mp4`);
      assert.ok(existsSync(join(ROOT, up.j.path))); assert.deepStrictEqual(up.j.state.footage, [up.j.path]);
      assert.strictEqual((await req('/api/reference', { body: { url: 'https://example.com/reel.mp4' } })).status, 400);
    });
    await t('server: chat in direct API mode applies a checked patch; a bad name is skipped, not applied', async () => {
      const r = await req('/api/chat', { body: { text: 'make it calm' } });
      assert.strictEqual(r.status, 200); assert.strictEqual(r.j.via, 'openai'); assert.strictEqual(r.j.state.pack, 'cinematic');
      assert.deepStrictEqual(r.j.state.picks.transition.allow, ['dissolve']);
      const b = await req('/api/chat', { body: { text: 'bad one' } }); assert.ok(/Skipped/.test(b.j.reply)); assert.ok(!b.j.state.picks.transition.allow.includes('teleport'));
      const k = await req('/api/chat', { body: { text: 'no glitch, punchy', offline: true } }); assert.strictEqual(k.j.via, 'keywords'); assert.strictEqual(k.j.state.pack, 'hormozi-bold');
      assert.ok(k.j.state.chat.length >= 6);
    });
    await t('server: save my selections as a pack writes a valid local pack', async () => {
      const name = 'studio-test-' + process.pid;
      const r = await req('/api/pack/save', { body: { name } }); assert.strictEqual(r.status, 200, JSON.stringify(r.j));
      const pk = K.load(join(K.LOCAL, name)); assert.deepStrictEqual(K.validate(pk), []); assert.strictEqual(r.j.state.pack, name);
      rmSync(join(K.LOCAL, name), { recursive: true, force: true });
      assert.strictEqual((await req('/api/pack/save', { body: { name: 'magazine' } })).status, 400);
    });
    await t('server: draft without footage is refused with the next step', async () => {
      await req('/api/reset', { body: {} }); await req('/api/state', { body: { job: JOB + '-empty' } });
      const r = await req('/api/draft', { body: {} }); assert.strictEqual(r.status, 400); assert.ok(/footage/.test(r.j.error));
    });
  } finally { srv.kill(); fake.close(); }
} finally {
  rmSync(STATE, { recursive: true, force: true });
  rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true });
}
console.log(`\n${n} studio tests passed`);
