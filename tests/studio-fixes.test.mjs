// Studio never shows a terminal command for an install or a fix (Will's rule, v1.10.2). Things that are missing show
// plain words plus buttons: Install (Studio runs it), Send to my agent, Copy for my agent. The command lives only in
// the instruction an agent gets. This checks:
// - every fix (kit/studio/fixes.mjs): plain label and why, an instruction with the kit's folder and the command
// - the page source and the built page: a command appears only inside an instruction for an agent (forAgent)
// - the server's user-facing messages (errors, notes, toasts) carry no command, and errors carry fix ids
// - through the server: the setup list, a refused draft, Install, Send to my agent, and a reference link that needs yt-dlp
// Run: node tests/studio-fixes.test.mjs   (npm run check runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
import { CMD } from './studio-fixes.cmd.mjs';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FX = await import('../kit/studio/fixes.mjs');
const F = await import('../kit/studio/fetch.mjs');

await t('fixes: plain label and why, an instruction with the kit folder and the command, installs only setup steps', () => {
  const all = FX.all('/home/me/aigent-talking-head');
  assert.deepStrictEqual(Object.keys(all).sort(), ['chrome', 'effects', 'ffmpeg', 'humanizer', 'instaloader', 'mask', 'model', 'node', 'npm', 'python', 'rea', 'studio', 'ytdlp']);
  const steps = readFileSync(join(ROOT, 'kit', 'setup.mjs'), 'utf8').match(/STEP_IDS = \[([^\]]+)\]/)[1];
  for (const f of Object.values(all)) {
    for (const k of ['label', 'why', 'linkLabel']) assert.ok(!CMD.test(f[k] || ''), `${f.id}.${k}: ${f[k]}`);
    assert.ok(!/\u2014/.test(f.why + f.prompt), `${f.id}: no em dash`);
    assert.ok(f.prompt.startsWith('In my aigent-talking-head folder (/home/me/aigent-talking-head), install ') && /tell me when it is done\.$/.test(f.prompt), f.prompt);
    assert.ok(CMD.test(f.prompt) || /nodejs\.org/.test(f.prompt), `${f.id}: the instruction says what to run`);
    if (f.install) assert.ok(steps.includes(`'${FX.stepOf(f.id)}'`), `${f.id}: --only ${FX.stepOf(f.id)} is a setup step`);
    if (f.user) assert.ok(f.link && f.linkLabel && !f.install, `${f.id}: only you can install it, so a link and no Install`);
  }
  assert.strictEqual(all.rea.install, true); assert.strictEqual(all.ytdlp.install, true); assert.strictEqual(all.effects.install, true); assert.strictEqual(all.python.install, true);
  assert.strictEqual(all.chrome.install, false); assert.strictEqual(all.humanizer.install, false);
  assert.match(all.rea.prompt, /npm run setup:all -- --only rea/);
  assert.strictEqual(FX.missingLine(['ffmpeg', 'chrome'], 'Studio cannot render yet'), 'ffmpeg and Chrome are missing, so Studio cannot render yet.');
});

await t('reference link messages: plain words, a fix id, the command only in the CLI', () => {
  for (const [k, m] of Object.entries(F.INSTALL)) { assert.ok(!CMD.test(m), `${k}: ${m}`); assert.strictEqual(F.fixOf('download failed: ' + m), k); }
  assert.strictEqual(F.fixOf('something else'), null);
});

// a line of source that is a user-facing string with a command, outside comments and CLI-only output
const COMMENT = /^\s*(\/\/|\*|\/\*|#)/;
const CLI_ONLY = /console\.(log|error|warn)|process\.stderr|usage:|README\.md|die\(|^\s*\/\/|kit\/setup\.mjs['"]|STUDIO_SETUP/;
await t('page source: a command only inside an instruction for an agent (forAgent)', () => {
  const dir = join(ROOT, 'kit', 'studio', 'web', 'src'), bad = [];
  for (const f of readdirSync(dir).filter(x => /\.jsx?$/.test(x))) readFileSync(join(dir, f), 'utf8').split('\n').forEach((l, i) => { if (!COMMENT.test(l) && CMD.test(l) && !/forAgent/.test(l)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  assert.deepStrictEqual(bad, []);
});
await t('built page: every command sits inside an "In my aigent-talking-head folder" instruction', () => {
  const dir = join(ROOT, 'kit', 'studio', 'public', 'assets'), bad = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8'), re = new RegExp(CMD.source, 'g'); let m;
    while ((m = re.exec(src))) { const before = src.slice(Math.max(0, m.index - 90), m.index); if (!/In my aigent-talking-head folder/.test(before)) bad.push(`${f}: ...${src.slice(m.index - 40, m.index + 40)}...`); }
  }
  assert.deepStrictEqual(bad, []);
});
await t('server messages: no command in an error, note or toast the page shows', () => {
  const files = ['server.mjs', 'core.mjs', 'media.mjs', 'broll-api.mjs', 'broll.mjs', 'broll-make.mjs', 'post-api.mjs', 'post.mjs', 'folders.mjs', 'cut.mjs', 'review.mjs', 'record.mjs', 'scripts.mjs', 'gen.mjs', 'llm.mjs', 'settings.mjs', 'keys.mjs', 'cloud.mjs', 'channel.mjs', 'lane.mjs', 'cut-run.mjs'];
  const bad = [];
  for (const f of files) readFileSync(join(ROOT, 'kit', 'studio', f), 'utf8').split('\n').forEach((l, i) => { if (!COMMENT.test(l) && CMD.test(l) && !CLI_ONLY.test(l)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 140)}`); });
  assert.deepStrictEqual(bad, []);
});

// ---------- through the server: a fixed setup status with ffmpeg, Chrome, yt-dlp, effects and rea-video missing ----------
const STATE = mkdtempSync(join(tmpdir(), 'studio-fixes-')), JOB = 'fixes-test-' + process.pid;
const env = { ...process.env, CI: '1', STUDIO_DIR: STATE, STUDIO_SETUP: 'tests/fixtures/fake-setup.mjs', STUDIO_SETUP_STATUS: join(ROOT, 'tests', 'fixtures', 'setup-missing.json'), STUDIO_CHAT: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const req = async (p, body) => { const r = await fetch(url + p, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(150); } };
// the view with each fix's instruction taken out: what the page can show as text
const shown = v => JSON.stringify({ ...v, env: { ...v.env, fixes: Object.fromEntries(Object.entries(v.env.fixes || {}).map(([k, f]) => [k, { ...f, prompt: null }])) } });
try {
  await req('/api/state', { job: JOB });
  await t('server: the setup list and the page state carry fix ids and plain words, never a command', async () => {
    const st = (await req('/api/setup')).j;
    assert.strictEqual(st.items.length, 13);
    assert.ok(!CMD.test(JSON.stringify(st)), JSON.stringify(st).match(new RegExp('.{40}(' + CMD.source + ').{40}'))?.[0]);
    assert.deepStrictEqual(st.items.filter(x => x.status !== 'ready').map(x => x.fix), ['ffmpeg', 'chrome', 'ytdlp', 'effects', 'rea']);
    assert.deepStrictEqual(st.forUser, ['ffmpeg: Studio needs it to draft, render and trim video.', 'Chrome: Studio draws titles, graphics and B-roll cards with it.']);
    const v = (await req('/api/state')).j;
    assert.deepStrictEqual(Object.keys(v.env.setup.missing), ['ffmpeg', 'chrome', 'ytdlp', 'effects', 'rea']);
    assert.ok(v.env.fixes.rea.prompt.includes(ROOT));
    assert.ok(!CMD.test(shown(v)), shown(v).match(new RegExp('.{60}(' + CMD.source + ').{40}'))?.[0]);
  });
  await t('server: a draft that cannot work says what is missing and carries the fix ids', async () => {
    const up = await fetch(`${url}/api/upload?kind=footage&name=take.mp4`, { method: 'POST', body: Buffer.alloc(64) }); assert.strictEqual(up.status, 200);
    const r = await req('/api/draft', {});
    assert.strictEqual(r.status, 400); assert.deepStrictEqual(r.j.fix, ['ffmpeg']);
    assert.strictEqual(r.j.error, 'ffmpeg is missing, so Studio cannot draft yet.');
  });
  await t('server: Install runs setup --only <step> and only for a fix Studio can do itself', async () => {
    const no = await req('/api/fix/install', { id: 'chrome' }); assert.strictEqual(no.status, 400); assert.ok(!CMD.test(no.j.error), no.j.error);
    assert.strictEqual((await req('/api/fix/install', { id: '../../evil' })).status, 400);
    assert.strictEqual((await req('/api/fix/install', { id: 'rea' })).status, 202);
    const v = await until(async () => { const x = (await req('/api/state')).j; return x.task && x.task.kind === 'install' && x.task.status !== 'running' ? x : null; });
    assert.strictEqual(v.task.status, 'done'); assert.strictEqual(v.task.fix, 'rea'); assert.strictEqual(v.task.result.fix, 'rea');
    assert.ok(v.task.lines.includes('fake setup --only rea'), v.task.lines.join(' | '));
    assert.strictEqual(v.task.result.ready, false, 'the fixed status still says missing, so the page offers the agent');
  });
  await t('server: Send to my agent queues the instruction in the Studio chat for the terminal agent', async () => {
    assert.strictEqual((await req('/api/fix/send', { id: 'nope' })).status, 400);
    const r = await req('/api/fix/send', { id: 'ytdlp' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.via, 'agent');
    const last = r.j.state.chat.filter(m => m.role === 'user').pop();
    assert.strictEqual(last.to, 'agent'); assert.strictEqual(last.status, 'queued'); assert.deepStrictEqual(last.attach, { kind: 'fix', fix: 'ytdlp', label: 'yt-dlp' }); assert.match(last.text, /^In my aigent-talking-head folder .*npm run setup:all -- --only ytdlp/);
    await req('/api/settings', { chat: { backend: 'keywords' } });
    const off = await req('/api/fix/send', { id: 'ytdlp' }); assert.strictEqual(off.status, 400); assert.match(off.j.error, /Connect your agent/);
    await req('/api/settings', { chat: { backend: 'agent' } });
  });
  await t('server: a link that needs yt-dlp fails with plain words and the ytdlp fix', async () => {
    const r = await req('/api/reference/url', { urls: ['https://www.youtube.com/watch?v=abcdefghijk'] });
    const it = r.j.added[0];
    if (it.status === 'failed') { assert.strictEqual(it.fix, 'ytdlp'); assert.ok(!CMD.test(it.error), it.error); }
    else assert.strictEqual(it.fix, null, 'yt-dlp is installed here, so nothing to fix');
  });
} finally { srv.kill(); rmSync(STATE, { recursive: true, force: true }); rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'inbox', 'studio', JOB), { recursive: true, force: true }); }
console.log(`\n${n} studio fix tests passed`);
