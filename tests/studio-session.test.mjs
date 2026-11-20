// Fixes from the 2026-11-19 Studio session: a footage change is applied or refused (never a silent success), a patch that
// changes nothing says so, one music bed, your words and keyword logos, the yt-dlp fallback for Instagram, the Install
// button, kept pauses, and a render whose cancel lands after it finished ends done.
// Run: node tests/studio-session.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { setTimeout as sleep } from 'timers/promises';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const STATE = mkdtempSync(join(tmpdir(), 'studio-session-'));
const FAKE_LOG = join(STATE, 'ytdlp.log'), FAKE_MP4 = join(STATE, 'fake.mp4');
// the downloader reads these when it loads: a "Python" without instaloader (node refuses -c and -m), a stand-in yt-dlp
process.env.STUDIO_DIR = STATE;
process.env.PYTHON = process.execPath;
process.env.YTDLP = join(ROOT, 'tests', 'fixtures', 'fake-ytdlp.mjs');
process.env.FAKE_YTDLP_LOG = FAKE_LOG; process.env.FAKE_YTDLP_MP4 = FAKE_MP4;
const C = await import('../kit/studio/core.mjs');
const CH = await import('../kit/studio/channel.mjs');
const GL = require('../kit/glossary.cjs'), BR = require('../kit/brands.cjs'), CHO = require('../kit/choices.cjs'), K = require('../kit/packs.cjs');
const JOB = 'session-test-' + process.pid, INBOX = join(ROOT, 'inbox', 'studio', JOB), JOBDIR = join(ROOT, 'jobs', JOB);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

try {
  await t('footage: a new order is applied, an unknown or repeated file is an error, the same order is a no-op', () => {
    const s = C.defaultState(); s.job = JOB; s.footage = ['inbox/a.mp4', 'inbox/b.mp4', 'inbox/c.mp4']; s.clips = 'jobs/x/clips';
    let r = C.applyPatch(s, { footage: ['inbox/c.mp4', 'inbox/a.mp4'] });
    assert.deepStrictEqual(r.errs, []); assert.deepStrictEqual(s.footage, ['inbox/c.mp4', 'inbox/a.mp4']); assert.strictEqual(s.clips, null, 'old clips are not reused');
    assert.ok(r.log[0].startsWith('footage c.mp4, a.mp4'));
    r = C.applyPatch(s, { footage: ['inbox/zzz.mp4'] }); assert.ok(/not in this job: inbox\/zzz\.mp4/.test(r.errs[0])); assert.deepStrictEqual(s.footage, ['inbox/c.mp4', 'inbox/a.mp4']);
    r = C.applyPatch(s, { footage: ['inbox/a.mp4', 'inbox/a.mp4'] }); assert.ok(/twice/.test(r.errs[0]));
    r = C.applyPatch(s, { footage: 'inbox/a.mp4' }); assert.ok(/a list of file paths/.test(r.errs[0]));
    r = C.applyPatch(s, { footage: ['inbox/c.mp4', 'inbox/a.mp4'] }); assert.strictEqual(r.noop, true);
    mkdirSync(INBOX, { recursive: true }); writeFileSync(join(INBOX, 'd.mp4'), 'x');
    r = C.applyPatch(s, { footage: ['inbox/c.mp4', `inbox/studio/${JOB}/d.mp4`] }); assert.deepStrictEqual(r.errs, []);
    r = C.applyPatch(s, { clips: 'jobs/nope-' + process.pid }); assert.ok(/no clips\.json/.test(r.errs[0]));
  });
  await t('no-op: a patch that changes nothing says so, over the agent channel too', () => {
    const s = C.defaultState();
    assert.strictEqual(C.applyPatch(s, { asIs: true }).noop, false);
    assert.strictEqual(C.applyPatch(s, { asIs: true }).noop, true);
    assert.strictEqual(C.applyPatch(s, { say: 'hi' }).noop, false, 'a chat line is not a change request');
    assert.strictEqual(C.applyPatch(s, { music: { bed: 'none' } }).noop, false);
    assert.strictEqual(C.applyPatch(s, { music: { bed: 'none' } }).noop, true);
    const st = C.defaultState(); st.job = JOB; st.asIs = true; C.save(st);
    const r = CH.reply({ text: 'Done, used as is.', patch: { asIs: true }, agent: 'claude-code' });
    assert.strictEqual(r.noChange, true); assert.ok(/Do not tell the user it changed/.test(r.note));
    assert.ok(C.load().chat.some(m => m.kind === 'action' && /that change did nothing/.test(m.text)));
    assert.ok(!CH.reply({ patch: { asIs: false } }).noChange);
  });
  await t('music bed: one source of truth; an old bed pick moves into music.bed; none means --no-bed', () => {
    const cat = C.catalog(), bed = cat.beds[0].id;
    const s = C.defaultState(); s.picks.bed = { allow: [bed], deny: [] }; s.music.bed = 'auto'; C.save(s);
    const l = C.load(); assert.strictEqual(l.music.bed, bed); assert.ok(!l.picks.bed);
    assert.strictEqual(C.compose(l).bed, bed); assert.strictEqual(C.compose(l).args[C.compose(l).args.indexOf('--bed') + 1], bed);
    C.applyPatch(l, { picks: { ['bed:' + bed]: 'clear' } }); assert.strictEqual(l.music.bed, 'auto');
    C.applyPatch(l, { music: { bed: 'none', energy: 'high' } });
    const a = C.compose(l).args; assert.ok(a.includes('--no-bed') && !a.includes('--bed') && !a.includes('--music-energy'));
  });
  await t('your words: the glossary fixes words, keeps their capitals, and reaches the draft', () => {
    assert.deepStrictEqual(GL.selfTest(), []);
    const s = C.defaultState();
    assert.deepStrictEqual(C.applyPatch(s, { glossary: 'Agent Academy | AI gent Academy = AIgent Academy; school = Skool after on, in' }).errs, []);
    assert.strictEqual(s.glossary.length, 2);
    const a = C.compose(s).args, g = a[a.indexOf('--glossary') + 1];
    assert.strictEqual(GL.applyText('join the Agent Academy on school', GL.parseText(g)), 'join the AIgent Academy on Skool');
    assert.ok(C.applyPatch(s, { glossary: [{ heard: ['x'] }] }).errs.length, 'an entry needs say');
    const pk = K.load('aigent'); assert.ok(pk.style.glossary.some(e => e.say === 'AIgent Academy'));
    assert.ok(GL.keepCase(GL.merge(GL.shipped(), GL.parse(pk.style.glossary))).includes('AIgent'));
    const html = readFileSync(join(ROOT, 'kit', 'overlay.html'), 'utf8'); assert.ok(/keepCase/.test(html), 'captions keep the capitals of your words');
  });
  await t('keyword logos: only marks you added or the kit has; a plate per said word, spaced out', () => {
    assert.deepStrictEqual(BR.selfTest(), []);
    const s = C.defaultState();
    let r = C.applyPatch(s, { brands: [{ word: 'Skool', logo: 'kit/example/skool-logo.svg' }] }); assert.deepStrictEqual(r.errs, []);
    assert.ok(existsSync(join(ROOT, 'kit', 'example', 'skool-logo.svg')));
    r = C.applyPatch(s, { brands: [{ word: 'Nike', logo: 'https://example.com/nike.png' }] }); assert.ok(/not one you added/.test(r.errs[0]));
    mkdirSync(C.brandsDir(), { recursive: true }); writeFileSync(join(C.brandsDir(), 'mine.png'), 'x');
    r = C.applyPatch(s, { brands: [{ word: 'Mine', logo: 'mine.png' }, { word: 'Skool', logo: 'kit/example/skool-logo.svg' }] }); assert.deepStrictEqual(r.errs, []);
    const a = C.compose(s).args, b = JSON.parse(a[a.indexOf('--brands') + 1]);
    assert.strictEqual(b[0].logo, join(C.brandsDir(), 'mine.png')); assert.strictEqual(b[1].logo, join(ROOT, 'kit', 'example', 'skool-logo.svg'));
  });
  await t('pauses: each tightened pause is listed with a keep id; keepPauses becomes --keep-pauses', () => {
    const b = join(STATE, 'job', 'build'); mkdirSync(b, { recursive: true });
    writeFileSync(join(b, 'cut.json'), JSON.stringify({ segs: [{ in: 0, out: 2 }], hits: [], tightened: [{ clip: 'clip-002', at: 3.1, resume: 4.2, gap: 1.3, after: 'so' }] }));
    const x = CHO.explain(b); assert.deepStrictEqual(x.pauses[0], { clip: 'clip-002', at: 3.1, resume: 4.2, gap: 1.3, after: 'so', keep: 'clip-002@3.1' });
    assert.ok(/pauses cut/.test(CHO.printTable(x)));
    const s = C.defaultState(); assert.deepStrictEqual(C.applyPatch(s, { pace: { keepPauses: ['clip-002@3.1'] } }).errs, []);
    const a = C.compose(s).args; assert.strictEqual(a[a.indexOf('--keep-pauses') + 1], 'clip-002@3.1');
    assert.ok(C.applyPatch(s, { pace: { keepPauses: ['oops'] } }).errs.length);
    const reel = readFileSync(join(ROOT, 'kit', 'reel.cjs'), 'utf8'); assert.ok(/KEEPP\[c\.id\]/.test(reel) && /keep-pauses/.test(reel));
  });
  const F = await import('../kit/studio/fetch.mjs');
  if (process.platform !== 'win32') await t('Instagram: no instaloader, so yt-dlp fetches it, with no config and no cookies', async () => {
    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=90x160:rate=24:duration=1', '-pix_fmt', 'yuv420p', FAKE_MP4]);
    else { const b = Buffer.alloc(4096); b.writeUInt32BE(32, 0); b.write('ftypisom', 4); writeFileSync(FAKE_MP4, b); }
    const tl = F.tools({ fresh: true }); assert.strictEqual(tl.instaloader, false); assert.ok(tl.ytdlp);
    assert.strictEqual(F.missingFor(F.classify('https://www.instagram.com/reel/ABC123xyz/')), null);
    assert.ok(F.missingFor(F.classify('https://www.instagram.com/reel/ABC123xyz/'), { ytdlp: null, instaloader: false }));
    const said = [], out = join(STATE, 'ig', 'ref.mp4');
    const r = await F.download('https://www.instagram.com/reel/ABC123xyz/', out, { say: x => said.push(x) });
    assert.ok(existsSync(out)); assert.strictEqual(r.site, 'instagram');
    assert.ok(said.some(x => /fetching with yt-dlp, anonymously/.test(x)), said.join(' | '));
    const args = JSON.parse(readFileSync(FAKE_LOG, 'utf8').trim().split('\n').pop());
    for (const a of ['--ignore-config', '--no-cookies', '--no-cookies-from-browser']) assert.ok(args.includes(a), a);
    assert.ok(!args.some(a => /^--(username|password|cookies$|cookies-from-browser$)/.test(a)));
  });
  await t('setup --only runs just those steps', () => {
    const src = readFileSync(join(ROOT, 'kit', 'setup.mjs'), 'utf8'); assert.ok(/opt\('only'\)/.test(src) && /STEP_IDS\.filter\(x => !only\.includes\(x\)\)/.test(src));
  });

  // ---------- through the server: the Install button, a brand upload, a cancel that lands after the work finished ----------
  const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_SETUP: 'tests/fixtures/fake-setup.mjs', STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
  const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
  const req = async (p, body) => { const r = await fetch(url + p, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(150); } };
  try {
    await req('/api/state', { job: JOB });
    await t('server: Install runs setup --only for that tool and finishes', async () => {
      assert.strictEqual((await req('/api/tools/install', { tool: 'nope' })).status, 400);
      assert.strictEqual((await req('/api/tools/install', { tool: 'instaloader' })).status, 202);
      const v = await until(async () => { const x = (await req('/api/state')).j; return x.task && x.task.kind === 'install' && x.task.status !== 'running' ? x : null; });
      assert.strictEqual(v.task.status, 'done'); assert.ok(v.task.lines.some(l => l === 'fake setup --only ytdlp'), v.task.lines.join(' | '));
    });
    await t('server: a brand mark upload joins the list and is served; the state patch refuses others', async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
      const r = await fetch(url + '/api/upload?kind=brand&word=Acme&name=acme.svg', { method: 'POST', body: svg }); assert.strictEqual(r.status, 200);
      assert.deepStrictEqual((await r.json()).state.brands.find(b => b.word === 'Acme'), { word: 'Acme', logo: 'acme.svg' });
      assert.strictEqual((await fetch(url + '/api/brand?name=acme.svg')).status, 200);
      assert.strictEqual((await fetch(url + '/api/brand?name=../state.json')).status, 404);
      assert.strictEqual((await fetch(url + '/api/upload?kind=brand&name=a.svg', { method: 'POST', body: svg })).status, 400, 'needs a word');
      assert.strictEqual((await req('/api/state', { brands: [{ word: 'X', logo: '/etc/passwd' }] })).status, 400);
    });
    await t('server: a cancel that lands after the result was written keeps it (done, not cancelled)', async () => {
      const wrote = `jobs/${JOB}/late.mp4`;
      srv.kill(); await new Promise(r => srv.once('close', r));
      const s2 = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env: { ...env, FAKE_SETUP_WROTE: wrote } });
      const u2 = await new Promise((ok, bad) => { let out = ''; s2.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); s2.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
      const q = async (p, body) => (await fetch(u2 + p, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })).json();
      try {
        await q('/api/tools/install', { tool: 'ytdlp' });
        await until(async () => (await q('/api/state')).task.lines.some(l => l.startsWith('wrote ')));
        await q('/api/task/cancel', {});
        const v = await until(async () => { const x = await q('/api/state'); return x.task.status !== 'running' ? x : null; });
        assert.strictEqual(v.task.status, 'done', v.task.lines.join(' | ')); assert.ok(v.task.lines.includes('finished before the cancel landed; kept the result'));
      } finally { s2.kill(); }
    });
  } finally { srv.kill(); }
  console.log(`\n${n} studio session tests passed`);
} finally {
  rmSync(STATE, { recursive: true, force: true }); rmSync(INBOX, { recursive: true, force: true }); rmSync(JOBDIR, { recursive: true, force: true });
}
